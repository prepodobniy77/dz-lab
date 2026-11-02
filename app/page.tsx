import {getChatGPTUser} from './chatgpt-auth';
import Workbench from '../components/workbench';
import {getCatalog,snapshot} from '../lib/catalog-server';
export const dynamic='force-dynamic';
export default async function Home(){let data;try{data=await getCatalog()}catch{data={...snapshot,storage:'unavailable'}}return <Workbench initialData={{...data,signedIn:!!(await getChatGPTUser())}}/>}
