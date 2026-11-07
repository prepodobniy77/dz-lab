import type {Offer, Product} from '../lib/catalog-types';
import type {PriceObservation} from '../lib/price-feed';
import {mergeCatalogOffers} from '../lib/catalog-price-delta.ts';

type Patch = {start: number; end: number; bytes: Uint8Array};

function replaceBytes(body: ReadableStream<Uint8Array>, patches: Patch[]): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let offset = 0;
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      const {value, done} = await reader.read();
      if (done) {
        if (index !== patches.length) controller.error(new Error('Несовместимый снимок каталога'));
        else controller.close();
        return;
      }

      const nextOffset = offset + value.length;
      let cursor = 0;
      while (index < patches.length && patches[index].start < nextOffset) {
        const patch = patches[index];
        const start = patch.start - offset;
        if (start > cursor) controller.enqueue(value.subarray(cursor, start));
        if (start >= 0) controller.enqueue(patch.bytes);
        cursor = patch.end - offset;
        if (cursor > value.length) break;
        index++;
      }
      if (cursor < value.length) controller.enqueue(value.subarray(cursor));
      offset = nextOffset;
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export async function catalogResponse(
  assets: Fetcher, url: URL, products: ReadonlyMap<string, Product>, observations: PriceObservation[],
): Promise<Response> {
  const base = await assets.fetch(new Request(new URL('/api/catalog', url)));
  if (!base.ok || !base.body) return base;
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
  if (!observations.length) return new Response(base.body, {headers});

  const layoutResponse = await assets.fetch(new Request(new URL('/api/catalog-layout.json', url)));
  if (!layoutResponse.ok) {
    await base.body.cancel();
    throw new Error('Не найдена раскладка каталога');
  }
  const layout = await layoutResponse.json<Record<string, [number, number]>>();
  const encoder = new TextEncoder();
  const offers = new Map<string, Offer[]>();
  for (const {productId, offer} of observations) {
    const list = offers.get(productId);
    if (list) list.push(offer);
    else offers.set(productId, [offer]);
  }

  const patches: Patch[] = [];
  for (const [id, current] of offers) {
    const product = products.get(id);
    const position = layout[id];
    if (!product || !position) continue;
    patches.push({
      start: position[0],
      end: position[1],
      bytes: encoder.encode(JSON.stringify(mergeCatalogOffers(product, current))),
    });
  }
  patches.sort((a, b) => a.start - b.start);
  return new Response(replaceBytes(base.body, patches), {headers});
}
