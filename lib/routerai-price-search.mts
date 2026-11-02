import {parsePriceLinks,priceSearchInstructions} from './ai-price-search.mts';
import {stores} from './stores.ts';import type {Product} from './catalog-types';
export function parseRouterAIPriceLinks(payload:any,products:Product[]){
 const choice=payload?.choices?.[0];if(choice?.finish_reason!=='stop'||!choice.message||typeof choice.message.content!=='string')throw new Error('RouterAI не завершил поиск корректно');
 // RouterAI прикрепляет цитаты url_citation к сообщению ассистента.
 return parsePriceLinks({status:'completed',output:[{type:'message',content:[{type:'output_text',text:choice.message.content,annotations:choice.message.annotations||[]}]}]},products);
}
export async function findRouterAIPriceLinks(products:Product[],key:string,model='z-ai/glm-5.3-flash',fetcher:typeof fetch=fetch,timeoutMs=60000){
 if(!key)throw new Error('Для RouterAI нужен ROUTERAI_API_KEY');if(!products.length||products.length>5)throw new Error('От 1 до 5 товаров в запросе RouterAI');
 const body={model:model||'z-ai/glm-5.3-flash',max_tokens:1800,stream:false,
  plugins:[{id:'web',engine:'exa',max_results:3,include_domains:stores.filter(s=>s.id!=='DELECT').flatMap(s=>s.hosts),search_prompt:'Find exact product part numbers and current retail offers in Moscow. Use primary product pages, never similar products.'}],
  messages:[{role:'system',content:priceSearchInstructions},{role:'user',content:JSON.stringify(products.map(p=>({productId:p.id,name:p.name,mpn:p.mpn,referenceUrls:p.offers.map(o=>o.url)})))}]};
 const response=await fetcher('https://routerai.ru/api/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(60000,timeoutMs)))});
 if(!response.ok)throw new Error('RouterAI: HTTP '+response.status);if(Number(response.headers.get('content-length'))>1000000)throw new Error('Ответ RouterAI слишком большой');const text=await response.text();if(text.length>1000000)throw new Error('Ответ RouterAI слишком большой');return parseRouterAIPriceLinks(JSON.parse(text),products);
}
