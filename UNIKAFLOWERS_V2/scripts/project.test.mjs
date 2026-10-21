import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('catalog entries have distinct IDs, usable heights and deployed photos', async () => {
  const { products } = JSON.parse(await readFile(new URL('../web/data/products.json', import.meta.url)));
  assert.equal(products.length, 10);
  assert.equal(new Set(products.map((item) => item.id)).size, products.length);
  for (const item of products) {
    assert.ok(item.name && item.description && item.shortDescription);
    assert.equal(item.heightCm.length, 2);
    assert.ok(item.heightCm[0] > 0 && item.heightCm[0] <= item.heightCm[1]);
    assert.ok(item.image.startsWith('/assets/products/'));
    const file = resolve('web', item.image.slice(1));
    assert.ok((await stat(file)).size < 500_000, `${item.image} is too large`);
  }
});

test('shop logo is shipped and used in the Mini App', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('/assets/logo.png'));
  assert.ok((await stat(resolve('web/assets/logo.png'))).size > 0);
});
