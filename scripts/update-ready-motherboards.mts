import {readFile,writeFile,rename} from 'node:fs/promises';
import {checkCompatibility} from '../lib/catalog.ts';
import {readyMotherboard,type ReadyBoardChoice} from '../lib/ready-motherboards.mts';
import type {Product} from '../lib/catalog-types.ts';
import type {ReadyBuild} from '../lib/ready-builds.ts';
const products:Product[]=JSON.parse(await readFile('data/catalog.json','utf8')).products;
const builds:ReadyBuild[]=JSON.parse(await readFile('data/ready-builds.json','utf8'));
const recipes:ReadyBuild[]=JSON.parse(await readFile('data/ready-build-adaptations.json','utf8'));
const plan:ReadyBoardChoice[]=JSON.parse(await readFile('data/ready-board-plan.json','utf8'));
let changed=0;
for(let i=0;i<builds.length;i++){
 const build=builds[i];const board=readyMotherboard(build.id,products,plan);
 const recipe=recipes.find(r=>r.id===build.id);
 if(recipe&&recipe.selection.motherboard!==board.id)throw Error('Adaptation must document the reviewed board: '+build.id);
 const next=recipe||{...build,selection:{...build.selection,motherboard:board.id}};
 const errors=checkCompatibility(next.selection,products).filter(i=>i.level==='error');
 if(errors.length)throw Error(build.id+JSON.stringify(errors));
 if(build.selection.motherboard!==board.id){changed++;console.log(build.name,'=>',board.name)}
 builds[i]=next;
}
await writeFile('data/ready-builds.json.tmp',JSON.stringify(builds,null,2)+'\n');await rename('data/ready-builds.json.tmp','data/ready-builds.json');
console.log('Changed motherboards:',changed);
