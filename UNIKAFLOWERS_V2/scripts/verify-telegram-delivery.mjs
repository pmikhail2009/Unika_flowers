import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';

const site = 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site';
const sources = {}, root = resolve('tgcloud');
async function scan(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = resolve(dir, entry.name); if (entry.isDirectory()) await scan(file); else if (file.endsWith('.js')) sources[relative(root, file).replaceAll('\\','/').slice(0,-3)] = await readFile(file, 'utf8'); } }
await scan(root);
const token = await resolveToken();
async function telegram(action, input = {}) {
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { result = await runFunction(token, 'endpoints/siteBridge', sources, { action, input }, { initData: { user: { id: 5211227935, first_name: 'Проверка подключения' } } }); break; }
    catch (error) { if (attempt || error.message !== 'fetch failed') throw error; }
  }
  assert.ok(result.result?.result, 'Telegram bridge failed'); return result.result.result;
}
let guest;
async function browser(action, input = {}) {
  const response = await fetch(`${site}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(guest ? { Authorization: `Bearer ${guest}` } : {}) }, body: JSON.stringify(input), signal: AbortSignal.timeout(25000) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error?.message || `HTTP ${response.status}`);
  guest = data.auth?.guestToken || guest; return data.result;
}
const catalog = await browser('getCatalog');
assert.equal(catalog.settings.orderingOpen, true);
const product = catalog.products.find(p => p.active && p.availability !== 'soldout'); assert.ok(product);
const payload = mode => ({ requestId: `delivery-test-${randomUUID()}`, items: [{ id: product.id, price: product.price, quantity: 1 }], contact: { name: `ТЕСТ ПОДКЛЮЧЕНИЯ (${mode})`, phone: '', delivery: 'pickup', address: '' }, note: 'ТЕСТ: проверка отправки в Telegram. Не обрабатывать. Заявка будет отменена после проверки.' });
const report = { verifiedAt: new Date().toISOString(), site, tests: [] };
for (const mode of process.argv.includes('--telegram-only') ? ['telegram'] : ['browser','telegram']) {
  const call = mode === 'browser' ? browser : telegram;
  const input = payload(mode); let created;
  try {
    created = await call('placeOrder', input); assert.ok(created.orderId);
    const replay = await call('placeOrder', input); assert.equal(replay.orderId, created.orderId); assert.equal(replay.replayed, true);
    const mine = await call('getMyOrders'); const order = mine.orders.find(o => o.id === created.orderId); assert.ok(order); assert.equal(order.source, mode === 'browser' ? 'website' : 'telegram');
    report.tests.push({ mode, orderId: order.id, saved: true, replayDeduplicated: true, source: order.source });
  } finally {
    if (created?.orderId) {
      const cancelled = await call('cancelOrder', { id: created.orderId, version: 0 }); assert.equal(cancelled.order.status, 'cancelled');
      const entry = report.tests.find(x => x.orderId === created.orderId); if (entry) entry.finalStatus = 'cancelled';
    }
  }
}
await writeFile('telegram-delivery-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
