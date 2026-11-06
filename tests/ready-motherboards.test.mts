import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {readyMotherboard,type ReadyBoardChoice} from '../lib/ready-motherboards.mts';
import type {Product} from '../lib/catalog-types';import type {ReadyBuild} from '../lib/ready-builds';
const products:Product[]=JSON.parse(readFileSync('data/catalog.json','utf8')).products;
const builds:ReadyBuild[]=JSON.parse(readFileSync('data/ready-builds.json','utf8'));
const plan:ReadyBoardChoice[]=JSON.parse(readFileSync('data/ready-board-plan.json','utf8'));
test('every build uses its reviewed motherboard and board/cpu/RAM/case platforms remain compatible',()=>{
 assert.equal(plan.length,builds.length);assert.equal(new Set(plan.map(p=>p.buildId)).size,builds.length);
 for(const b of builds){const board=readyMotherboard(b.id,products,plan);assert.equal(b.selection.motherboard,board.id);const cpu=products.find(p=>p.id===b.selection.cpu)!;const ram=products.find(p=>p.id===b.selection.ram)!;assert.equal(board.specs.socket,cpu.specs.socket,b.id);assert.equal(board.specs.memory,ram.specs.memory,b.id);assert.ok(plan.find(p=>p.buildId===b.id)!.rationale)}
 const basic=builds.filter(b=>b.selection.motherboard==='xcom-1092923');assert.deepEqual(basic.map(b=>b.id),['start-am5']);
 for(const b of builds){const cpu=products.find(p=>p.id===b.selection.cpu)!;if(/Ryzen 9|14700K|14600KF/.test(cpu.name))assert.equal(plan.find(p=>p.buildId===b.id)!.role,'sustained')}
});
test('a cheaper matching-socket board cannot silently replace the reviewed board',()=>{
 const build=builds.find(b=>b.id==='flagship-5090')!;const chosen=readyMotherboard(build.id,products,plan);
 const cheap:Product={...chosen,id:'cheap-unreviewed',name:'Cheapest AM5',offers:[{store:'DNS',url:'https://www.dns-shop.ru/product/1234567890abcdef/board/',price:1,status:'ok',availability:'in-stock',checkedAt:new Date().toISOString()}]};
 assert.equal(readyMotherboard(build.id,[cheap,...products],plan).id,chosen.id);
 assert.throws(()=>readyMotherboard(build.id,[cheap],plan),/review a replacement/);
 assert.throws(()=>readyMotherboard('new-unreviewed-build',products,plan),/reviewed motherboard/);
});
