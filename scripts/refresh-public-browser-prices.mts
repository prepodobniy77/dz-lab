import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import type {CatalogData, Offer, Product} from '../lib/catalog-types';
import type {StoreRefresh} from '../lib/price-feed.ts';
import {robotsPolicy} from '../lib/robots-policy.ts';
import {isAllowedStoreUrl, storeInfo} from '../lib/stores.ts';

type BrowserStore = 'DNS' | 'CITILINK';
type Listing = {region: string; challenge: boolean; cards: number; nextPage: number | null; offers: {url:string; price:number}[]};

type PublicPage = {
  goto(url:string, options:{waitUntil:'domcontentloaded';timeout:number}):Promise<{status():number}|null>;
  evaluate(fn:(store:BrowserStore)=>Listing, store:BrowserStore):Promise<Listing>;
  url():string;
};
type StockBrowser = {newPage():Promise<PublicPage>;close():Promise<void>};

const dnsSections = [
  ['17a899cd16404e77','processory'], ['17a89aab16404e77','videokarty'],
  ['17a89a0416404e77','materinskie-platy'], ['17a89a3916404e77','operativnaya-pamyat-dimm'],
  ['8a9ddfba20724e77','ssd-nakopiteli'], ['dd58148920724e77','ssd-m2-nakopiteli'],
  ['17a8914916404e77','zhestkie-diski-35'], ['f09d15560cdd4e77','zhestkie-diski-25'],
  ['17a89c2216404e77','bloki-pitaniya'], ['17a89c5616404e77','korpusa'],
  ['17a9cc2d16404e77','kulery-dlya-processorov'], ['17a9cc9816404e77','sistemy-zhidkostnogo-ohlazhdeniya'],
];
const citySections = ['processory','videokarty','materinskie-platy','moduli-pamyati','ssd-nakopiteli',
  'zhestkie-diski','bloki-pitaniya','korpusa','sistemy-ohlazhdeniya-processora'];

export function retailKey(url: string, store: BrowserStore): string | undefined {
  if (!isAllowedStoreUrl(url, store)) return;
  const path = new URL(url).pathname;
  return store === 'DNS'
    ? path.match(/^\/product\/([a-f0-9]{16})\/[a-z\d-]+\/?$/i)?.[1].toLowerCase()
    : path.match(/^\/product\/[a-z\d_-]+-(\d+)\/?$/i)?.[1];
}

// This function runs in the public page. Keep it independent of Node or extensions.
export function readPublicListing(store: BrowserStore): Listing {
  const dns = store === 'DNS';
  const region = document.querySelector(dns ? '[class*="city-select__text"]' : '[data-meta-name="CityChangeButton"]')?.textContent?.trim() ?? '';
  const challenge = /captcha|access denied|just a moment|проверка браузера|доступ ограничен/i.test(document.title) ||
    Boolean(document.querySelector('form[action*="captcha"], iframe[src*="captcha"], #challenge-form'));
  const rows = document.querySelectorAll(dns ? '.catalog-product' : '[data-meta-name="ProductVerticalSnippet"]');
  const offers:Listing['offers'] = [];
  if (region === 'Москва' && !challenge) {
    for (const row of rows) {
      const link = row.querySelector<HTMLAnchorElement>(dns ? 'a.catalog-product__name' : 'a[data-meta-name="Snippet__title"]');
      const priceRoot = row.querySelector(dns ? '.product-buy__price' : '[data-meta-name="Snippet__price"] [data-meta-price]');
      if (!link || !priceRoot) continue;
      const text = priceRoot instanceof HTMLElement ? priceRoot.innerText.trim() : '';
      // Exact displayed retail price. Skip old prices, installments and ambiguous widgets.
      if (!/^\d[\d\s]*₽$/u.test(text)) continue;
      const price = Number(text.replace(/[^\d]/g,''));
      if (!Number.isSafeInteger(price) || price < 100 || price > 2_000_000) continue;
      if (!dns && Number(priceRoot.getAttribute('data-meta-price')) !== price) continue;
      offers.push({url:link.href,price});
    }
  }
  const href = dns ? null : document.querySelector<HTMLAnchorElement>('[data-meta-name="PageLink__page-page-next"]')?.href;
  let nextPage = null;
  if (href) {
    const url = new URL(href);
    const page = Number(url.searchParams.get('p'));
    if (url.origin === location.origin && url.pathname === location.pathname && Number.isSafeInteger(page) && page >= 2 && page <= 200) nextPage = page;
  }
  return {region,challenge,cards:rows.length,nextPage,offers};
}

export async function refreshPublicBrowser(
  store: BrowserStore, catalog: CatalogData, report: StoreRefresh, previous: StoreRefresh|undefined,
  record: (product:Product, offer:Offer)=>void,
) {
  if (catalog.region !== 'Москва') throw Error('Регион каталога должен быть Москва');
  const entry = process.env.DZ_PLAYWRIGHT_MODULE;
  if (!entry) throw Error('Не настроен браузер для проверки');
  const {chromium} = await import(pathToFileURL(entry).href) as {
    chromium:{launch(options:{headless:boolean;channel?:string}):Promise<StockBrowser>};
  };
  const root = storeInfo(store)!.url;
  report.provider = 'public-browser';
  const robots = await fetch(new URL('/robots.txt',root),{
    headers:{'User-Agent':'DZLAB-Catalog/1.0'},redirect:'manual',signal:AbortSignal.timeout(12000),
  });
  if (!robots.ok) {
    await robots.body?.cancel();
    throw Error('Не удалось проверить robots.txt: HTTP '+robots.status);
  }
  const policy = robotsPolicy(await robots.text());
  const urls = store === 'DNS'
    ? dnsSections.map(([id,slug])=>new URL('/catalog/'+id+'/'+slug+'/',root))
    : citySections.map(slug=>new URL('/catalog/'+slug+'/',root));
  const known = new Map<string,{product:Product;offer:Offer} | null>();
  for (const product of catalog.products) {
    for (const offer of product.offers) {
      if (offer.store !== store) continue;
      const key = retailKey(offer.url,store);
      if (key) known.set(key,known.has(key)?null:{product,offer});
    }
  }

  const start = previous?.provider === 'public-browser' ? previous.cursor ?? 0 : 0;
  const offset = Number.isSafeInteger(start) && start >= 0 ? start % urls.length : 0;
  report.cursor = offset;
  report.listingPages = previous?.provider === 'public-browser' ? {...previous.listingPages} : {};
  const browser = await chromium.launch({headless:true,...(process.env.DZ_CHROME_CHANNEL?{channel:process.env.DZ_CHROME_CHANNEL}:{})});
  try {
    const page = await browser.newPage();
    for (let i=0;i<3;i++) {
      const position = (offset+i)%urls.length;
      const url = new URL(urls[position]);
      const plannedPage = report.listingPages[url.pathname] ?? 1;
      if (store==='CITILINK' && plannedPage > 1) url.searchParams.set('p',String(plannedPage));
      if (!policy.allows(url.href)) throw Error('Путь запрещён в robots.txt');
      await pause(Math.max(6000,policy.delayMs));
      report.requests++;
      const response = await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:25000});
      const status = response?.status();
      if (!status || status<200 || status>=300) throw Error('Браузер: HTTP '+(status??'без ответа'));
      if (!isAllowedStoreUrl(page.url(),store) || new URL(page.url()).pathname !== url.pathname) throw Error('Магазин перенаправил на другой адрес');
      let result = await page.evaluate(readPublicListing,store);
      for(let j=0;j<10 && !result.challenge && (result.offers.length<8 || store==='CITILINK' && result.offers.length<=8);j++){
        await pause(1000);
        result = await page.evaluate(readPublicListing,store);
      }
      if (result.challenge) throw Error('Магазин запросил проверку браузера');
      if (result.region!=='Москва') throw Error('Браузер не подтвердил регион Москва');
      if (!result.offers.length) throw Error('На странице не появились розничные цены');
      const checkedAt = new Date().toISOString();
      const prices = new Map<string,number|null>();
      for (const item of result.offers) {
        const key = retailKey(item.url,store);
        if (key) prices.set(key,prices.has(key)&&prices.get(key)!==item.price ? null : item.price);
      }
      for (const [key,price] of prices) {
        const match = known.get(key);
        if (!match || price===null || Date.parse(match.offer.checkedAt)>=Date.parse(checkedAt)) continue;
        record(match.product,{
          store,url:match.offer.url,price,checkedAt,status:'ok',availability:'unknown',
          transport:'html-snapshot',identity:'verified-reference',
        });
      }
      report.cursor = (position+1)%urls.length;
      if (store==='CITILINK') {
        const next = new URL(url);
        next.searchParams.set('p',String(result.nextPage??1));
        report.listingPages[url.pathname] = result.nextPage && policy.allows(next.href) ? result.nextPage : 1;
      }
    }
  } finally {
    await browser.close();
  }
}
