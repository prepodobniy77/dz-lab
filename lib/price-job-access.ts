// Идентичность владельца проверяется только в доверенном окружении Sites.
export function canRunPriceJob(ownerEmail:unknown,userId:unknown,userEmail:unknown){return typeof ownerEmail==='string'&&!!ownerEmail.trim()&&typeof userId==='string'&&!!userId&&typeof userEmail==='string'&&userEmail.trim().toLowerCase()===ownerEmail.trim().toLowerCase()}

// Секрет сравнивается по хешам фиксированной длины; доверие заголовкам включается явно.
export async function verifyPriceJobBearer(provided:string,secret:unknown){
 if(typeof secret!=='string'||!secret||!provided.startsWith('Bearer '))return false;
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const a=await digest(provided.slice(7)),b=await digest(secret);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];return mismatch===0;
}
export async function canAccessPriceJob(config:Record<string,string|undefined>,headers:Headers){
 if(await verifyPriceJobBearer(headers.get('authorization')||'',config.PRICE_JOB_TOKEN))return true;
 return config.TRUST_OAI_HEADERS==='1'&&canRunPriceJob(config.PRICE_JOB_OWNER_EMAIL,headers.get('oai-authenticated-user-id'),headers.get('oai-authenticated-user-email'));
}
