import {getChatGPTUser} from '../app/chatgpt-auth';
export async function requireMutationUser(){const user=await getChatGPTUser();return user?null:Response.json({error:'Для сохранения и обновления войди через кнопку «Войти» в шапке сайта.'},{status:401})}
