/** Loopback-only form for public catalogue observations collected in a normal browser. */
import {createServer} from 'node:http';
import {mkdir, writeFile, rename} from 'node:fs/promises';
const origin='http://127.0.0.1:5195';
const path='.sites-runtime/store-snapshots';
const categories=new Set(['cpu','motherboard','gpu','ram','ssd','hdd','psu','case','cooler']);
await mkdir(path,{recursive:true});
createServer(async(req,res)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method==='GET'&&req.url==='/'){
   res.end('<!doctype html><meta charset="utf-8"><title>Снимки Ситилинка</title><form method="post"><label>Страницы каталога<textarea name="pages"></textarea></label><button>Сохранить страницы</button></form>');return;
  }
  if(req.method!=='POST'||req.url!=='/'||req.headers.origin!==origin){res.writeHead(403).end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>4_000_000)throw Error('Too large');}
  const pages=JSON.parse(new URLSearchParams(body).get('pages')||'null');
  if(!Array.isArray(pages)||!pages.length||pages.length>16)throw Error('Invalid batch');
  for(const s of pages)if(s.store!=='CITILINK'||s.region!=='Москва'||!categories.has(s.category)||!Number.isInteger(s.page)||s.page<1||s.page>300||!Array.isArray(s.items)||s.items.length>72)throw Error('Invalid page');
  for(const s of pages){const file=path+'/CITILINK-'+s.category+'-'+s.page+'.json';await writeFile(file+'.tmp',JSON.stringify(s));await rename(file+'.tmp',file);}
  res.end('<!doctype html><meta charset="utf-8"><h1>Страницы сохранены: '+pages.length+'</h1><a href="/">Следующая партия</a>');
  console.log(pages.map(s=>s.category+':'+s.page+':'+s.items.length).join(' '));
 }catch{res.writeHead(400).end('Снимок не сохранён');}
}).listen(5195,'127.0.0.1',()=>console.log(origin));
