import {readFile} from 'node:fs/promises';
import {isSodimm} from '../lib/catalog-scope.ts';
import type {CatalogData, Category, Offer, Product} from '../lib/catalog-types';
import type {StoreRefresh} from '../lib/price-feed.ts';
import {isAllowedStoreUrl} from '../lib/stores.ts';

type Section = {id:string; category:Category; title:string; expected:number};
type PageJob = {section:Section; page:number};
type ReefRow = {
  url:string; product_id:string; name:string; short_specs?:string; is_markdown?:boolean;
  price:number|null; avail_status?:string; orderable?:boolean; prepay_only?:boolean;
};
type ReefPage = {ok:boolean; meta:{api:string; endpoint:string; mode:string; currency:string; fetched_at:string; charged_credits:number; cache_hit:boolean};
  data:{category_id:string; page:number; last_page:number; results:ReefRow[]}};
const api = 'https://api.reefapi.com';
const perPageCost = 3;
const pageSize = 24;
const maxPage = 50;
const maxParallel = 3;
const moscow = /^(?:Москва|Moscow)$/iu;
type RecordOffer = (product: Product, offer: Offer) => void;

export function dnsSku(url:string): string | undefined {
  if (!isAllowedStoreUrl(url,'DNS')) return;
  return new URL(url).pathname.match(/^\/product\/([a-f0-9]{16})\//i)?.[1].toLowerCase();
}

function planPages(sections: Section[]): PageJob[] {
  const pages = sections.map(section => Math.min(maxPage, Math.ceil(section.expected / pageSize)));
  return Array.from({length:Math.max(...pages)},(_,i) =>
    sections.flatMap((section,j) => i<pages[j] ? [{section,page:i+1}] : [])
  ).flat();
}

async function request<T>(path: string, apiKey: string, query?: PageJob): Promise<T> {
  const response = await fetch(api + path, {
    method: query ? 'POST' : 'GET',
    redirect:'manual',
    signal:AbortSignal.timeout(45_000),
    headers: query ? {'x-api-key':apiKey,'Content-Type':'application/json'} : {'x-api-key':apiKey},
    ...(query ? {body:JSON.stringify({query:query.section.title,page:query.page})} : {}),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('ReefAPI: HTTP ' + response.status);
  }
  return await response.json() as T;
}

async function dnsSections(): Promise<Section[]> {
  const raw = JSON.parse(await readFile('data/dns-coverage.json','utf8')) as Section[];
  const sections = raw.filter(section => !isSodimm({category:section.category,name:section.title}) && section.expected > 0);
  if (!sections.length) throw Error('Нет разделов DNS для обновления');
  return sections;
}

function knownDnsOffers(catalog: CatalogData) {
  const known = new Map<string,{product:Product; offer:Offer}>();
  for (const product of catalog.products) {
    if (isSodimm(product)) continue;
    for (const offer of product.offers) {
      if (offer.store !== 'DNS') continue;
      const id = dnsSku(offer.url);
      if (id) known.set(id,{product,offer});
    }
  }
  return known;
}

/** Refresh existing Moscow DNS offers. A failed or ambiguous quote leaves its old date intact. */
export async function refreshDns(
  catalog: CatalogData, apiKey: string, pagesPerRun: number, previous: StoreRefresh|undefined,
  report: StoreRefresh, record: RecordOffer, deadline: number,
): Promise<void> {
  if (catalog.region !== 'Москва') throw Error('Регион каталога DNS должен быть Москва');
  if (!Number.isSafeInteger(pagesPerRun) || pagesPerRun < 1 || pagesPerRun > 240) throw Error('Лимит страниц DNS должен быть целым числом от 1 до 240');
  const jobs = planPages(await dnsSections());
  const start = previous?.provider === 'reefapi' ? previous.cursor ?? 0 : 0;
  report.provider = 'reefapi';
  const offset = Number.isSafeInteger(start) && start >= 0 ? start % jobs.length : 0;
  report.cursor = offset;

  const known = knownDnsOffers(catalog);

  // The balance endpoint is free. Never dispatch more credits than the current
  // balance and the explicit run limit allow, even after ambiguous timeouts.
  const balance = await request<{remaining?:number;data?:{remaining:number}}>('/account/v1/credits',apiKey);
  const remaining = balance.data?.remaining ?? balance.remaining;
  if (typeof remaining !== 'number' || !Number.isSafeInteger(remaining) || remaining < 0) throw Error('ReefAPI не подтвердил остаток кредитов');
  const budget = Math.min(pagesPerRun,Math.floor(remaining/perPageCost),jobs.length);
  if (!budget) {
    report.blocked = 'Недостаточно кредитов ReefAPI для обновления DNS';
    return;
  }

  async function readPage(job: PageJob) {
    report.requests++;
    const payload = await request<ReefPage>('/dns-shop/v1/search',apiKey,job);
    const {meta,data} = payload;
    if (!payload.ok || meta?.api !== 'dns-shop' || meta.endpoint !== 'search' ||
        meta.mode !== 'live' || meta.cache_hit !== false || meta.currency !== 'RUB' ||
        meta.charged_credits > perPageCost || !Array.isArray(data?.results) ||
        data.results.length > pageSize || data.category_id !== job.section.id ||
        data.page !== job.page || !Number.isSafeInteger(data.last_page) || data.last_page < job.page) {
      throw Error('ReefAPI вернул неподтверждённую страницу DNS');
    }
    const observed = Date.parse(meta.fetched_at);
    if (!Number.isFinite(observed) || observed > Date.now() + 60_000 || Date.now() - observed > 3600_000) {
      throw Error('ReefAPI не подтвердил время наблюдения DNS');
    }
    // ReefAPI documents Moscow-only search. Reject any explicit city mismatch
    // if a later version supplies a city on the page or an individual row.
    const cityMatches = (value: unknown) => {
      if (value == null) return true;
      if (typeof value === 'object') value = (value as {name?:string}).name;
      return typeof value === 'string' && moscow.test(value);
    };
    if (!cityMatches((data as {city?:unknown}).city) ||
        data.results.some(row => !cityMatches((row as {city?:unknown}).city))) throw Error('ReefAPI вернул другой город DNS');

    const seen = new Set<string>();
    for (const row of data.results) {
      const sku = dnsSku(row.url);
      if (!sku || sku !== row.product_id?.toLowerCase() || seen.has(sku)) continue;
      seen.add(sku);
      const match = known.get(sku);
      if (!match || match.product.category !== job.section.category ||
          isSodimm({category:job.section.category,name:row.name,description:row.short_specs}) ||
          row.is_markdown || row.prepay_only || row.orderable !== true || row.avail_status === 'out_of_stock' ||
          typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0 || row.price > 10_000_000) continue;
      if (observed <= Date.parse(match.offer.checkedAt)) continue;
      record(match.product,{
        store:'DNS',url:match.offer.url,price:row.price,checkedAt:meta.fetched_at,
        availability:row.avail_status === 'now' ? 'in-stock' : 'unknown',
        status:'ok',transport:'api',identity:'verified-reference',
      });
    }
  }

  let completed = 0;
  while (completed < budget && Date.now() < deadline) {
    const count = Math.min(maxParallel,budget-completed);
    const batch = Array.from({length:count},(_,i) => jobs[(offset+completed+i)%jobs.length]);
    const results = await Promise.allSettled(batch.map(readPage));
    const firstFailure = results.findIndex(result => result.status === 'rejected');
    completed += firstFailure === -1 ? count : firstFailure;
    report.cursor = (offset+completed)%jobs.length;
    if (firstFailure !== -1) {
      report.failures += results.filter(result=>result.status==='rejected').length;
      const error = (results[firstFailure] as PromiseRejectedResult).reason;
      report.blocked = error instanceof Error ? error.message : 'ReefAPI не завершил обновление DNS';
      break;
    }
  }
}

type AnysiteDnsRow = {
  url?:string; hex_id?:string; city?:string; name?:string; short_specs?:string;
  price?:number; availability?:{status?:string};
};

/** Use the documented Moscow category endpoint and bind every returned row to a known DNS SKU. */
export async function refreshDnsAnysite(
  catalog: CatalogData, apiKey: string, sectionsPerRun: number, previous: StoreRefresh|undefined,
  report: StoreRefresh, record: RecordOffer, deadline: number,
): Promise<void> {
  if (catalog.region !== 'Москва') throw Error('Регион каталога DNS должен быть Москва');
  if (!Number.isSafeInteger(sectionsPerRun) || sectionsPerRun < 1 || sectionsPerRun > 12) throw Error('Лимит разделов Anysite должен быть от 1 до 12');
  report.provider = 'anysite';
  const known = knownDnsOffers(catalog);
  const sections = await dnsSections();
  const start = previous?.provider === 'anysite' ? previous.cursor ?? 0 : 0;
  const offset = Number.isSafeInteger(start) && start >= 0 ? start % sections.length : 0;
  report.cursor = offset;
  for (let i = 0; i < Math.min(sectionsPerRun, sections.length) && Date.now() < deadline; i++) {
    const position = (offset+i)%sections.length;
    const section = sections[position];
    const prices = section.expected>850 ? [...known.values()]
      .filter(({product})=>product.category===section.category)
      .flatMap(({offer})=>typeof offer.price==='number'&&offer.price>0?[offer.price]:[])
      .sort((a,b)=>a-b) : [];
    const middle = prices.length ? Math.floor(prices[Math.floor(prices.length/2)]) : 0;
    const ranges = middle>0&&middle<9_999_999 ? [{max_price:middle},{min_price:middle+1}] : [{}];
    const count = ranges.length===2 ? 960 : Math.min(section.expected+50,960);
    const seen = new Set<string>();
    for (const range of ranges) {
      if (Date.now() >= deadline) return;
      report.requests++;
      const response = await fetch('https://api.anysite.io/api/dnsshop/products/search', {
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(95_000),
        headers:{'access-token':apiKey,'Content-Type':'application/json'},
        body:JSON.stringify({city:'Москва',category:section.id,count,timeout:85,...range}),
      });
      if (!response.ok || response.headers.has('X-Error') || response.headers.has('X-Warning')) {
        await response.body?.cancel();
        throw Error('Anysite не подтвердил раздел DNS (HTTP ' + response.status + ')');
      }
      const rows = await response.json() as AnysiteDnsRow[];
      if (!Array.isArray(rows) || rows.length > count) throw Error('Anysite вернул неподтверждённый формат DNS');
      const checkedAt = new Date().toISOString();
      if (rows.length === count && count === 960) report.blocked = 'Раздел DNS достиг лимита 960 позиций за запрос';
      for (const row of rows) {
        if (!row || !row.city || !moscow.test(row.city) || !row.url) continue;
        const sku = dnsSku(row.url);
        if (!sku || row.hex_id && row.hex_id.toLowerCase() !== sku || seen.has(sku)) continue;
        seen.add(sku);
        const match = known.get(sku);
        if (!match || match.product.category !== section.category ||
            isSodimm({category:section.category,name:row.name??'',description:row.short_specs}) ||
            row.availability?.status === 'out_of_stock' ||
            typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0 || row.price > 10_000_000) continue;
        record(match.product,{
          store:'DNS',url:match.offer.url,price:row.price,checkedAt,
          availability:row.availability?.status === 'now' ? 'in-stock' : 'unknown',
          status:'ok',transport:'api',identity:'verified-reference',
        });
      }
    }
    report.cursor = (position+1)%sections.length;
  }
  if (!report.updated) report.blocked = 'Anysite не подтвердил ни одной известной цены DNS для Москвы';
}
