// Запуск на постоянном сервере. Секрет передаётся только через окружение.
const origin=process.env.SITE_URL?.replace(/\/$/,'');
const key=process.env.PRICE_JOB_TOKEN;
if(!origin||!key)throw new Error('Нужны SITE_URL и PRICE_JOB_TOKEN; запрос не отправлен');
const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('SITE_URL должен быть адресом HTTPS без учётных данных и параметров');
let complete=false;
for(let attempt=1;attempt<=40;attempt++){
 const response=await fetch(origin+'/api/prices/sweep',{method:'POST',headers:{Authorization:'Bearer '+key},redirect:'manual',signal:AbortSignal.timeout(150000)});
 if(!response.ok){console.error('Обновитель вернул HTTP',response.status);process.exitCode=1;break}
 const result=await response.json() as {done?:boolean;processed?:number;report?:{status?:string}};
 if(typeof result.done!=='boolean')throw new Error('Ответ не содержит признак завершения');
 console.log('Порция',attempt,'обработано',result.processed||0,'завершено',result.done);
 if(result.done){complete=true;break}if(attempt<40)await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!complete){console.error('Цикл не завершён; курсор сохранён. Проверь отчёт.');process.exitCode=1}
