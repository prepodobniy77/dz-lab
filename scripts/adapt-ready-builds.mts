/** Apply researched configurations using catalog parts, not a vendor's bundle price. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {readyMotherboard,type ReadyBoardChoice} from '../lib/ready-motherboards.mts';
import {bestOffer,checkCompatibility} from '../lib/catalog.ts';
import {readyBuildOverview,type ReadyBuild} from '../lib/ready-builds.ts';
import type {Product} from '../lib/catalog-types';
const products:Product[]=JSON.parse(await readFile('data/catalog.json','utf8')).products;
const recipes:ReadyBuild[]=JSON.parse(await readFile('data/ready-build-adaptations.json','utf8'));
const boardPlan:ReadyBoardChoice[]=JSON.parse(await readFile('data/ready-board-plan.json','utf8'));
const builds:ReadyBuild[]=JSON.parse(await readFile('data/ready-builds.json','utf8'));
for(const recipe of recipes){
 if(recipe.selection.motherboard!==readyMotherboard(recipe.id,products,boardPlan).id)throw Error('Adaptation requires motherboard review '+recipe.id);
 if(!recipe.adaptation||recipe.retail||!recipe.name.startsWith('DZ LAB '))throw Error('Invalid adaptation');
 for(const [slot,id] of Object.entries(recipe.selection)){
  const part=products.find(p=>p.id===id&&p.category===slot);
  if(!part||!bestOffer(part))throw Error('Missing component or price: '+id);
 }
 const errors=checkCompatibility(recipe.selection,products).filter(x=>x.level==='error');
 if(errors.length)throw Error(recipe.id+JSON.stringify(errors));
 const index=builds.findIndex(b=>b.id===recipe.id||b.id===recipe.adaptation!.replaces||b.retail?.replaces===recipe.adaptation!.replaces);
 if(index<0)throw Error('Missing replacement target '+recipe.id);
 builds[index]=recipe;console.log(recipe.name,readyBuildOverview(recipe,products).total);
}
if(new Set(builds.map(b=>b.id)).size!==builds.length)throw Error('Duplicate build IDs');
await writeFile('data/ready-builds.json.tmp',JSON.stringify(builds,null,2)+'\n');
await rename('data/ready-builds.json.tmp','data/ready-builds.json');
