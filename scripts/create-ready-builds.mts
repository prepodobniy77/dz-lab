import {readFile,writeFile} from 'node:fs/promises';
import {readyMotherboard,type ReadyBoardChoice} from '../lib/ready-motherboards.mts';
import type {ReadyBuild} from '../lib/ready-builds.ts';
import {bestOffer,checkCompatibility} from '../lib/catalog.ts';
import type {Product,Category,Selection} from '../lib/catalog-types';
const products:Product[]=JSON.parse(await readFile('data/catalog.json','utf8')).products;
const pool=(category:Category)=>products.filter(p=>p.category===category&&bestOffer(p)).sort((a,b)=>bestOffer(a)!.price!-bestOffer(b)!.price!);
const exact=(c:Category,re:RegExp)=>{const p=pool(c).find(p=>re.test(p.name.replace(/\u00a0/g,' ')));if(!p)throw new Error('Missing '+c+' '+re);return p};
const setups:[string,string,string,string,RegExp,RegExp|null,number,number,number,boolean,number?][]=[
 ['office-am4','Office / AM4','office','Документы, браузер и видеосвязь. Используется графика процессора.',/Ryzen 5 5600GT$/,null,16,500,650,false],
 ['study-intel','Study / Intel','office','Учёба и повседневные задачи без отдельной видеокарты.',/i5-12400$/,null,16,500,650,false],
 ['home-am4','Home / 8 cores','office','Многозадачность и домашний ПК. Встроенная графика, память 32 ГБ.',/Ryzen 7 5700G$/,null,32,1000,650,false],
 ['start-am5','AM5 / Integrated','office','Начало на AM5 с DDR5. Встроенная графика; видеокарту можно добавить позже.',/Ryzen 5 8600G$/,null,32,1000,650,false],
 ['entry-1650','Entry / GTX 1650','budget','Недорогая основа с отдельной видеокартой. Настройки игр выбираются под нагрузку.',/Ryzen 5 5500$/,/GTX 1650,/,16,500,650,false],
 ['entry-intel','Entry / Intel + RTX','budget','Доступная основа Intel с RTX 3050 и SSD 1 ТБ.',/i3-12100F$/,/RTX 3050,.*8 ГБ/,16,1000,650,false],
 ['classic-am4','Classic / RTX 3060','budget','AM4, память DDR4 и RTX 3060 12 ГБ. Основу можно менять по компонентам.',/Ryzen 5 5600$/,/RTX 3060,.*12 ГБ/,32,1000,650,false],
 ['intel-5060','Intel / RTX 5060','gaming','Игровая основа Intel с 32 ГБ DDR4 и RTX 5060.',/i5-12400F$/,/RTX 5060,/,32,1000,650,false],
 ['am5-5060','AM5 / RTX 5060','gaming','AM5, DDR5 и RTX 5060. Вариант для дальнейшего обновления процессора.',/Ryzen 5 7500F$/,/RTX 5060,/,32,1000,650,false],
 ['intel-ti','Intel / 16 GB VRAM','gaming','Core i5-14600KF, RTX 5060 Ti 16 ГБ и башенный кулер.',/14600KF$/,/RTX 5060 TI,.*16 ГБ/,32,1000,850,false],
 ['radeon-9060','Radeon / AM5','gaming','Ryzen 5 и Radeon RX 9060 XT 16 ГБ, с DDR5 и SSD 1 ТБ.',/Ryzen 5 7500F$/,/RX 9060 XT,.*16 ГБ/,32,1000,650,false],
 ['ryzen-5070','Ryzen / RTX 5070','gaming','Ryzen 5 9600X, RTX 5070 и накопитель 2 ТБ.',/Ryzen 5 9600X$/,/RTX 5070,/,32,2000,850,false],
 ['radeon-9070','Radeon / RX 9070 XT','gaming','Восемь ядер Ryzen и Radeon RX 9070 XT 16 ГБ.',/Ryzen 7 9700X$/,/RX 9070 XT,.*16 ГБ/,32,2000,850,false],
 ['ultra-ti','Core Ultra / Ti','gaming','Платформа LGA1851, RTX 5070 Ti 16 ГБ и СЖО 360 мм.',/Ultra 5 245K$/,/RTX 5070 TI,.*16 ГБ/,32,2000,850,true],
 ['x3d-ti','X3D / RTX 5070 Ti','gaming','Ryzen 7 9800X3D и RTX 5070 Ti с 16 ГБ видеопамяти.',/Ryzen 7 9800X3D$/,/RTX 5070 TI,.*16 ГБ/,32,2000,850,false],
 ['x3d-5080','X3D / RTX 5080','premium','Ryzen 7 9800X3D, RTX 5080, 64 ГБ DDR5 и СЖО 360 мм.',/Ryzen 7 9800X3D$/,/RTX 5080,/,64,2000,1000,true],
 ['flagship-5090','Flagship / RTX 5090','premium','Ryzen 9 9950X3D, RTX 5090 32 ГБ, 64 ГБ памяти и SSD 4 ТБ.',/Ryzen 9 9950X3D$/,/RTX 5090,.*32 ГБ/,64,4000,1200,true],
 ['creator-ryzen','Creator / Ryzen 9','work','12 ядер, RTX 5070 Ti, 64 ГБ RAM и HDD 4 ТБ для проектов.',/Ryzen 9 9900X$/,/RTX 5070 TI,.*16 ГБ/,64,2000,850,true,4000],
 ['creator-intel','Creator / Core i7','work','Core i7-14700K, RTX 5080, 64 ГБ памяти и СЖО 360 мм.',/i7-14700K$/,/RTX 5080,/,64,2000,1000,true],
 ['home-archive','Home / Storage','work','Домашняя рабочая основа: SSD 1 ТБ и HDD 8 ТБ. HDD не заменяет резервную копию.',/Ryzen 7 5700G$/,null,32,1000,650,false,8000],
];
const boardPlan:ReadyBoardChoice[]=JSON.parse(await readFile('data/ready-board-plan.json','utf8'));
const adaptations:ReadyBuild[]=JSON.parse(await readFile('data/ready-build-adaptations.json','utf8'));
const ready:ReadyBuild[]=[];
for(const [id,name,group,description,cpuRe,gpuRe,ramGb,ssdGb,watts,water,hddGb] of setups){
 const adaptation=adaptations.find(b=>b.adaptation?.replaces===id);
 if(adaptation){
  const board=readyMotherboard(adaptation.id,products,boardPlan);
  if(adaptation.selection.motherboard!==board.id)throw Error('Adaptation board review mismatch '+id);
  const errors=checkCompatibility(adaptation.selection,products).filter(i=>i.level==='error');if(errors.length)throw Error(id+JSON.stringify(errors));
  ready.push(adaptation);continue;
 }
 const cpu=exact('cpu',cpuRe);const memory=cpu.specs.socket==='AM4'||cpu.specs.socket==='LGA1700'&&!['creator-intel'].includes(id)?'DDR4':'DDR5';
 const board=readyMotherboard(id,products,boardPlan);
 if(board.specs.socket!==cpu.specs.socket||board.specs.memory!==memory)throw Error('Reviewed motherboard platform mismatch '+id);
 const ram=pool('ram').find(p=>p.specs.memory===memory&&p.specs.capacity===ramGb&&p.specs.moduleType==='UDIMM'&&/Kingston|G.Skill|ADATA|Patriot|Corsair|Team|Crucial/i.test(p.name)&&/2[×xх]/i.test(p.name));if(!ram)throw new Error('Missing ram '+id);
 const ssd=pool('ssd').find(p=>(p.specs.capacity||0)>=ssdGb&&(p.specs.capacity||0)<=ssdGb*1.05&&p.specs.interface==='NVMe'&&/Samsung|Kingston|Western Digital|WD |ADATA|Crucial|Lexar/i.test(p.name)&&!/U\.2|2\.5|Solidigm|Micron/i.test(p.name));if(!ssd)throw new Error('Missing SSD '+id);
 const gpu=gpuRe?exact('gpu',gpuRe):undefined;const needed=Math.max(watts,gpu?.specs.recommendedPsu||0);const psu=pool('psu').find(p=>p.specs.watts===needed&&/Deepcool.*(?:PF650|PQ850G|PQ1000G|PQ1200G)/i.test(p.name));if(!psu)throw new Error('Missing PSU '+id);
 const cooler=water?pool('aio').find(p=>/ARCTIC Liquid Freezer III Pro 360$/.test(p.name)&&p.specs.sockets?.includes(cpu.specs.socket!)):pool('cooler').find(p=>(/creator|x3d|intel-ti/.test(id)?/Phantom Spirit 120 SE$/:/ID-Cooling SE-224-XTS$/).test(p.name)&&p.specs.sockets?.includes(cpu.specs.socket!));if(!cooler)throw new Error('Missing cooling '+id);
 const box=exact('case',gpu||water?/Deepcool CH560$/:/Zalman ZM-T6$/);const parts=[cpu,board,ram,ssd,psu,cooler,box,...(gpu?[gpu]:[])];
 if(hddGb){const hdd=pool('hdd').find(p=>p.specs.capacity===hddGb&&/Seagate|Western Digital|Toshiba/i.test(p.name)&&!/Purple|PURZ|PURP|VX\d/i.test(p.name+' '+p.mpn));if(!hdd)throw new Error('Missing HDD '+id);parts.push(hdd)}
 const selection:Selection=Object.fromEntries(parts.map(p=>[p.category,p.id]));const errors=checkCompatibility(selection,products).filter(x=>x.level==='error');if(errors.length)throw new Error(id+JSON.stringify(errors));
 ready.push({id,name,group,description,integratedGraphics:!gpu,selection});console.log(id,parts.length,parts.reduce((s,p)=>s+bestOffer(p)!.price!,0));
}
await writeFile('data/ready-builds.json',JSON.stringify(ready,null,2));
