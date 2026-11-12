import {test,mock} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {checkCompatibility,bestOffer} from '../lib/catalog.ts';import type {Product,Selection} from '../lib/catalog-types';
// Recipe tests use the committed snapshot date, not the wall clock.
mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-07T10:33:57.160Z')});
const products:Product[]=JSON.parse(readFileSync('data/catalog.json','utf8')).products;
import {readyBuildOverview,type ReadyBuild} from '../lib/ready-builds.ts';
import {isAllowedStoreUrl} from '../lib/stores.ts';
const builds:ReadyBuild[]=JSON.parse(readFileSync('data/ready-builds.json','utf8'));
const templates=builds.filter(b=>!b.retail);
const adapted=builds.filter(b=>b.adaptation);
test('twenty distinct editable DZ LAB configurations include four researched adaptations',()=>{assert.equal(builds.length,20);assert.equal(new Set(builds.map(b=>b.id)).size,20);assert.equal(templates.length,20);assert.equal(adapted.length,4);assert.equal(new Set(templates.map(b=>JSON.stringify(b.selection))).size,20);assert.equal(new Set(adapted.map(b=>b.adaptation!.url)).size,4);assert.deepEqual([...new Set(builds.map(b=>b.group))].sort(),['budget','gaming','office','premium','work'])});
test('every template references actual products in correct slots and all essential parts',()=>{for(const b of templates){for(const slot of ['cpu','motherboard','ram','ssd','psu','case'] as const)assert.ok(b.selection[slot],`${b.id} lacks ${slot}`);assert.ok(!!b.selection.cooler!==!!b.selection.aio);for(const [slot,id] of Object.entries(b.selection)){const p=products.find(p=>p.id===id);assert.equal(p?.category,slot);assert.ok(p&&p.offers.some(o=>o.status==='ok'&&typeof o.price==='number'&&o.price>0),`${b.id} missing source price`)}}});
test('no template has detected socket, DDR, dimensions or power conflict',()=>{for(const b of templates)assert.deepEqual(checkCompatibility(b.selection,products).filter(x=>x.level==='error'),[],b.id)});
test('templates without a GPU explicitly use a CPU with integrated graphics',()=>{for(const b of templates){assert.equal(!b.selection.gpu,b.integratedGraphics);if(b.integratedGraphics){const cpu=products.find(p=>p.id===b.selection.cpu)!;assert.match(cpu.name,/5600GT|5700G|8600G|i5-12400$/)}}});
test('storage and liquid-cooling configurations are included, prices span cheap and flagship',()=>{assert.ok(builds.some(b=>b.selection.hdd));assert.ok(builds.some(b=>b.selection.aio));const prices=builds.map(b=>readyBuildOverview(b,products).total);assert.ok(Math.min(...prices)<60000);assert.ok(Math.max(...prices)>500000)});

test('adaptations keep their own identities, source evidence, and prices of actual parts',()=>{const recipes=JSON.parse(readFileSync('data/ready-build-adaptations.json','utf8'));assert.equal(new Set(adapted.map(b=>new URL(b.adaptation!.url).hostname)).size,4);for(const build of adapted){assert.match(build.name,/^DZ LAB /);assert.doesNotMatch(build.name,/ARDOR|GAMING NEO|DigitalRazor|HYPERPC|BIT COMP/i);assert.equal(build.retail,undefined);assert.deepEqual(build,recipes.find((r:ReadyBuild)=>r.id===build.id));const a=build.adaptation!;assert.equal(new URL(a.url).protocol,'https:');assert.ok(Number.isFinite(Date.parse(a.checkedAt)));assert.ok(a.changes.length>=2);const overview=readyBuildOverview(build,products);assert.equal(overview.total,overview.parts.reduce((sum,p)=>sum+(bestOffer(p)?.price??0),0));assert.ok(overview.parts.length>=7);assert.equal(overview.missing,overview.parts.filter(p=>!bestOffer(p)).length);assert.equal(overview.unresolved,0);const cpu=overview.parts.find(p=>p.category==='cpu')!;const gpu=overview.parts.find(p=>p.category==='gpu')!;assert.ok(cpu.name.includes(a.basis.cpu));assert.ok(gpu.name.toUpperCase().includes(a.basis.gpu.replace(/ \d+ ГБ$/,'').toUpperCase()));const ram=overview.parts.find(p=>p.category==='ram')!;assert.ok(ram.specs.capacity!>=a.basis.ramGb)}});

test('gallery totals prefer fresh prices over cheaper expired quotes',()=>{
 const now=Date.now();const p:Product={id:'fresh-cpu',category:'cpu',name:'Test CPU',brand:'',mpn:'',image:'',description:'',specs:{},offers:[
  {store:'DNS',url:'https://www.dns-shop.ru/product/1234567890abcdef/cpu/',price:1000,status:'ok',availability:'in-stock',checkedAt:new Date(now-14*86400000).toISOString()},
  {store:'XCOM',url:'https://www.xcom-shop.ru/cpu_1.html',price:2000,status:'ok',availability:'in-stock',checkedAt:new Date(now-3600000).toISOString()},
 ]};
 const result=readyBuildOverview({id:'test',name:'Test',group:'office',description:'',integratedGraphics:true,selection:{cpu:p.id}},[p]);
 assert.equal(result.total,2000);assert.equal(result.checkedAt,p.offers[1].checkedAt);
});
