import {test} from 'node:test';
import assert from 'node:assert/strict';
import {externalRequest} from '../lib/external-request.ts';
import {readLocalBuilds,saveLocalBuild,LOCAL_BUILDS_KEY} from '../lib/local-builds.ts';
test('external hosting strips forged Sites identity and preserves body and bearer',async()=>{
 const r=externalRequest(new Request('https://example.test/api/prices/sweep',{method:'POST',headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test','Authorization':'Bearer test'},body:'payload'}));
 assert.equal(r.headers.get('oai-authenticated-user-id'),null);assert.equal(r.headers.get('oai-authenticated-user-email'),null);assert.equal(r.headers.get('authorization'),'Bearer test');assert.equal(await r.text(),'payload');
});
test('local builds round trip, update by id, and preserve other saved builds',()=>{
 const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}};
 const b={id:'one',name:'PC',selection:{cpu:'cpu-1'},created_at:new Date().toISOString()};
 assert.deepEqual(readLocalBuilds(storage),[]);saveLocalBuild(storage,b);saveLocalBuild(storage,{...b,id:'two'});saveLocalBuild(storage,{...b,name:'Updated'});
 assert.deepEqual(readLocalBuilds(storage).map(b=>b.name),['Updated','PC']);
 data.set(LOCAL_BUILDS_KEY,'broken');assert.throws(()=>readLocalBuilds(storage));
});
