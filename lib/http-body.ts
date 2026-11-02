export class RequestBodyError extends Error {
  status:number;
  constructor(message:string,status:number){super(message);this.status=status;}
}
// Ограничиваем реальные байты потока, независимо от Content-Length и кодировки текста.
export async function readJsonLimited(request:Request,limit=5000):Promise<unknown>{
  const reader=request.body?.getReader();if(!reader)throw new RequestBodyError('Пустое тело запроса',400);
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new RequestBodyError('Слишком большой запрос',413)}chunks.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}catch{throw new RequestBodyError('Некорректный JSON',400)}
}
