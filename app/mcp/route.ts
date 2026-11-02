import {aiProductLimit} from '../../lib/price-update-policy';
import {env} from 'cloudflare:workers';
import {database} from '../../lib/catalog-server';
import {runPriceSweep} from '../../lib/price-sweep';
import {canAccessPriceJob} from '../../lib/price-job-access';
const tools=[{name:'get_price_update_status',description:'Read DZ LAB price update status and API readiness. Does not invoke paid AI.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},{name:'refresh_catalog_prices',description:'Run a bounded paid price update across all ten DZ LAB component categories. Owner only. Respects configured cooldown, budget limit and source verification. Returns actual coverage; partial does not mean all products are fresh.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}}];
export async function POST(request:Request){
 if(Number(request.headers.get('content-length')||0)>12000)return Response.json({error:'Request too large'},{status:413});
 let call:any;try{call=await request.json()}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}},{status:400})}
 const reply=(result:unknown)=>Response.json({jsonrpc:'2.0',id:call.id??null,result});
 if(call.method==='server/discover')return reply({supportedVersions:['2026-07-28'],serverInfo:{name:'dz-lab-prices',version:'1.0.0'},capabilities:{tools:{}}});
 if(call.method==='initialize')return reply({protocolVersion:'2026-07-28',serverInfo:{name:'dz-lab-prices',version:'1.0.0'},capabilities:{tools:{}}});
 if(call.method==='notifications/initialized')return new Response(null,{status:204});
 if(call.method==='ping')return reply({});
 if(call.method==='tools/list')return reply({tools});
 if(call.method!=='tools/call')return Response.json({jsonrpc:'2.0',id:call.id??null,error:{code:-32601,message:'Method not found'}});
 const config=env as unknown as Record<string,string|undefined>;
 const allowed=await canAccessPriceJob(config,request.headers);
 if(!allowed)return reply({content:[{type:'text',text:'Для этого инструмента требуется подтверждённая личность владельца DZ LAB.'}],isError:true});
 try{
  if(call.params?.name==='get_price_update_status'){const row=await database().prepare("SELECT error FROM source_health WHERE store='PRICE_SWEEP'").first<{error:string}>();return reply({content:[{type:'text',text:JSON.stringify({report:row?JSON.parse(row.error):null,configuration:{ai:!!(config.ROUTERAI_API_KEY||config.PERPLEXITY_API_KEY),provider:config.ROUTERAI_API_KEY?'RouterAI':'Perplexity',writer:true,limit:aiProductLimit(config.AI_MAX_PRODUCTS_PER_RUN)}})}]})}
  if(call.params?.name==='refresh_catalog_prices'){const result=await runPriceSweep('mcp');return reply({content:[{type:'text',text:JSON.stringify(result)}],isError:result.report.status==='blocked'||result.report.status==='failed'})}
  return reply({content:[{type:'text',text:'Unknown tool'}],isError:true});
 }catch{return reply({content:[{type:'text',text:'Обновитель недоступен или уже запускался в защитном интервале. Проверь статус; секреты не возвращаются.'}],isError:true})}
}
