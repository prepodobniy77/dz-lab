import {stagePrice} from '../../../../lib/price-cycle-data';
import {canAccessPriceJob} from '../../../../lib/price-job-access';
import {readJsonLimited,RequestBodyError} from '../../../../lib/http-body';
import {env} from 'cloudflare:workers';
import {requireMutationUser} from '../../../../lib/mutation-auth';
import {getCatalog,database,persistOffer} from '../../../../lib/catalog-server';
import {fetchPriceExport,apiOffers,PriceApiError} from '../../../../lib/price-api.mts';
export async function POST(request:Request){
 try{
  const denied=await requireMutationUser();if(denied)return denied;

  if(!await canAccessPriceJob(env as unknown as Record<string,string|undefined>,request.headers))return Response.json({error:'Обновление доступно только владельцу'},{status:401});
  const body=await readJsonLimited(request) as {ids?:unknown};
  if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>10||body.ids.some(x=>typeof x!=='string'))return Response.json({error:'Выбери от 1 до 10 товаров'},{status:400});
  const config=env as unknown as Record<string,string|undefined>;const key=config.DELECT_API_KEY||'',supplier=config.DELECT_DISTRIBUTOR||'';
  if(!key||!supplier)throw new PriceApiError('Обновление через API пока не активировано: нужен ключ владельца и поставщик Delect. Цены со страниц не запрашивались.',503);
  const catalog=await getCatalog();const products=catalog.products.filter(p=>(body.ids as string[]).includes(p.id));if(products.length!==new Set(body.ids).size)return Response.json({error:'Неизвестный товар'},{status:400});
  const health=await database().prepare('SELECT blocked_until FROM source_health WHERE store=?').bind('DELECT').first<{blocked_until:string|null}>();
  if(health?.blocked_until&&Date.parse(health.blocked_until)>Date.now())return Response.json({error:'API проверялся недавно. Повтори обновление через 15 минут; текущие результаты уже в каталоге.'},{status:429});
  const rows=await fetchPriceExport(key,supplier,fetch,async()=>{
   const now=new Date().toISOString();await database().prepare('INSERT INTO source_health (store,checked_at,blocked_until,error) VALUES (?,?,?,NULL) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,blocked_until=excluded.blocked_until,error=NULL').bind('DELECT',now,new Date(Date.now()+15*60*1000).toISOString()).run();
  });const fresh=apiOffers(products,rows,supplier);
  const pending=new Set<string>();for(const {id,offer} of fresh){const product=products.find(p=>p.id===id)!;const checked=stagePrice(product,offer);if(!checked)continue;if(checked.review){pending.add(id);await database().batch([database().prepare('INSERT INTO source_health(store,checked_at,error) VALUES(?,?,?) ON CONFLICT(store) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error').bind('PRICE_REVIEW:'+id+':'+offer.store,offer.checkedAt,JSON.stringify(checked))])}else await persistOffer(id,offer)}
  return Response.json({results:products.map(p=>{const match=pending.has(p.id)?undefined:fresh.find(x=>x.id===p.id);return{id:p.id,store:'DELECT',status:match?'updated':'skipped',price:match?.offer.price??null,message:pending.has(p.id)?'Изменение цены требует проверки':match?undefined:'Точный MPN отсутствует в прайсе API'}}),catalog:await getCatalog()});
 }catch(e){return Response.json({error:e instanceof RequestBodyError||e instanceof PriceApiError?e.message:'Не удалось обработать запрос API цен'},{status:e instanceof RequestBodyError||e instanceof PriceApiError?e.status:503})}
}
