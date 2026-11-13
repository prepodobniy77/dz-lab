'use client';
import {useEffect,useRef,useState} from 'react';
import type {SourceStatus} from '../lib/source-status';
import {stores} from '../lib/stores';
import {ThemeToggle} from './theme-toggle';
import './source-admin.css';

const stamp=(date:string|null)=>date&&Number.isFinite(Date.parse(date))
  ?new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}).format(new Date(date))+' МСК':'Нет данных';
export default function SourceAdmin(){
  const [token,setToken]=useState('');
  const [sources,setSources]=useState<SourceStatus[]|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  async function load(){
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/prices/status',{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw new Error(response.status===401?'Ключ не принят. Проверь ключ владельца.':'Отчёт недоступен. Попробуй ещё раз.');
      const result=await response.json() as {sources?:SourceStatus[]};
      if(!Array.isArray(result.sources))throw new Error('Отчёт по источникам ещё не опубликован.');
      setSources(result.sources);
    }catch(e){if(!controller.signal.aborted){setSources(null);setError(e instanceof Error?e.message:'Не удалось загрузить отчёт.')}}
    finally{if(!controller.signal.aborted)setLoading(false)}
  }
  return <main className="source-admin">
    <header><a href="/">← К конфигуратору</a><ThemeToggle/></header>
    <h1>Обновление цен</h1>
    <p>Проверка по плану — в 06:00 и 18:00 МСК. Возраст цен считается по дате источника.</p>
    <form onSubmit={e=>{e.preventDefault();void load()}}>
      <label htmlFor="owner-key">Ключ владельца</label>
      <input id="owner-key" type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} required aria-describedby="key-note"/>
      <p id="key-note">Ключ используется только для этого запроса и не сохраняется в браузере.</p>
      <div><button className="primary-button" disabled={loading||!token}>{loading?'Загрузка…':'Показать отчёт'}</button>
        {sources&&<button className="subtle-button" type="button" onClick={()=>{request.current?.abort();setSources(null);setToken('');setLoading(false)}}>Закрыть отчёт</button>}</div>
    </form>
    {error&&<p className="auto-update-failed" role="alert">{error}</p>}
    {sources&&<section aria-label="Свежесть цен по магазинам">
      {sources.some(s=>s.configured&&s.overdue)&&<p className="auto-update-failed" role="alert">У подключённых источников нет обновления больше 26 часов или ещё не было подтверждённого запуска.</p>}
      <ul>{sources.map(source=><li key={source.store}>
        <h2>{stores.find(s=>s.id===source.store)?.label??source.store}</h2>
        <p className={source.overdue?'source-overdue':''}>{source.overdue?'Нет свежего обновления':'Есть подтверждённые цены'} · {source.configured?'Подключён':'Автоматическое получение не подключено'}</p>
        <dl><dt>Способ получения</dt><dd>{{api:'Прямое подключение',feed:'Прайс магазина',snapshot:'Сохранённые наблюдения'}[source.source]}</dd>
          <dt>Предложений</dt><dd>{source.offers}</dd>
          <dt>Самая старая цена</dt><dd>{stamp(source.oldestPriceAt)}{source.oldestPriceAgeHours!==null?' · '+Math.floor(source.oldestPriceAgeHours)+' ч':''}</dd>
          <dt>Самая свежая цена</dt><dd>{stamp(source.newestPriceAt)}</dd>
          <dt>Успешная публикация</dt><dd>{stamp(source.lastSuccessfulAt)}</dd>
          <dt>Интервал проверки</dt><dd>{source.intervalHours} ч</dd>
        </dl>
      </li>)}</ul>
    </section>}
  </main>;
}
