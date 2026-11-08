import assert from 'node:assert/strict';
import {test} from 'node:test';
import {downloadFeed} from '../lib/feed-download.ts';
import {parseRetailFeed, requireFreshFeed, StaleFeedError} from '../lib/retail-feed.ts';

const csv = 'mpn,price\nPART-1,1200';
const now = Date.parse('2026-11-08T13:00Z');
const lastModified = '2026-11-07T12:00:00.000Z';

test('missing feed date falls back to Last-Modified but never to the current time', () => {
  assert.throws(() => parseRetailFeed(csv,undefined,now),/Last-Modified/);
  assert.equal(parseRetailFeed(csv,undefined,now,lastModified).checkedAt,lastModified);
  const dated = 'mpn,price,date\nPART-1,1200,2026-11-08T12:00:00Z';
  assert.equal(parseRetailFeed(dated,undefined,now,lastModified).checkedAt,'2026-11-08T12:00:00.000Z');
  assert.doesNotThrow(() => requireFreshFeed(lastModified,undefined,now));
  assert.throws(() => requireFreshFeed(lastModified,'24',now),StaleFeedError);
  assert.throws(() => requireFreshFeed(lastModified,undefined,now+12*3600_000),StaleFeedError);
});

test('download rejects a redirect to another host before sending authorization', async () => {
  const calls: {url:string; authorization:string|null}[] = [];
  const fetcher: typeof fetch = async (url,init) => {
    calls.push({url:String(url),authorization:new Headers(init?.headers).get('authorization')});
    return new Response(null,{status:302,headers:{location:'https://foreign.example/prices.csv'}});
  };
  await assert.rejects(downloadFeed('https://feed.example/start','https://feed.example/prices','feed-key',fetcher),/другой хост/);
  assert.deepEqual(calls,[{url:'https://feed.example/start',authorization:'Bearer feed-key'}]);
  await assert.rejects(downloadFeed('http://feed.example/start',undefined,undefined,fetcher),/HTTPS/);
});

test('download follows a same-origin redirect and does not send the token to an explicit foreign URL', async () => {
  const headers: (string|null)[] = [];
  const fetcher: typeof fetch = async (url,init) => {
    headers.push(new Headers(init?.headers).get('authorization'));
    return String(url).endsWith('/start')
      ? new Response(null,{status:302,headers:{location:'/prices'}})
      : new Response(csv,{headers:{'last-modified':'Sat, 07 Nov 2026 12:00:00 GMT'}});
  };
  const feed = await downloadFeed('https://feed.example/start','https://feed.example/start','key',fetcher);
  assert.deepEqual(feed,{text:csv,lastModified});
  await downloadFeed('https://foreign.example/prices','https://feed.example/start','key',fetcher);
  assert.deepEqual(headers,['Bearer key','Bearer key',null]);
});
