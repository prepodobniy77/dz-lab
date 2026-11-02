import {getCatalog,snapshot} from '../../../lib/catalog-server';
export async function GET(){try{return Response.json(await getCatalog(),{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({...snapshot,storage:'unavailable',storageError:'Серверная база недоступна. Показан проверенный импорт; обновление и сохранение временно недоступны.'},{headers:{'Cache-Control':'no-store'}})}}
