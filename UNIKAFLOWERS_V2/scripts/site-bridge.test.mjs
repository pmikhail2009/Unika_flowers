import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.mjs';

async function configure(app) {
  const { settings } = await app.load('schema.js');
  await app.db.insert(settings).values({ key: 'site-bridge', value: { origin: 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site', secret: 'test-only-bridge-secret-'.repeat(3) } }).run();
}
test('Telegram bridge refuses missing auth and never contacts backend', async t => {
  let calls = 0; const app = await runtime({ fetchHandler: async () => { calls++; } }); t.after(() => app.close());
  await assert.rejects(app.endpoint('siteBridge', { action: 'getCatalog' }, null), /Telegram/); assert.equal(calls, 0);
});
test('Telegram bridge derives buyer, administrator and owner roles from verified context', async t => {
  const sent = []; const app = await runtime({ fetchHandler: async (url, options) => { sent.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ result: { ok: true }, auth: { guestToken: 'a'.repeat(48) } }) }; } }); t.after(() => app.close()); await configure(app);
  for (const id of [100, 1154273072, 5211227935]) await app.endpoint('siteBridge', { action: 'getCatalog', input: { isAdmin: true }, telegram: { id: 5211227935, isOwner: true } }, id);
  assert.equal(sent[0].body.telegram.id, 100); assert.equal(sent[0].body.telegram.isAdmin, false); assert.equal(sent[0].body.telegram.isOwner, false);
  assert.equal(sent[1].body.telegram.isAdmin, true); assert.equal(sent[1].body.telegram.isOwner, false);
  assert.equal(sent[2].body.telegram.isOwner, true);
  assert.equal(sent[0].url, 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site/api/telegramBridge');
  assert.ok(sent[0].headers['X-Unica-Bridge']);
});
test('Telegram bridge restricts actions and translates backend errors without exposing config', async t => {
  const app = await runtime({ fetchHandler: async () => ({ ok: false, json: async () => ({ error: { message: 'Заказ не найден.', code: 'NOT_FOUND' } }) }) }); t.after(() => app.close());
  await assert.rejects(app.endpoint('siteBridge', { action: 'dropDatabase' }), /Неизвестное/);
  await assert.rejects(app.endpoint('siteBridge', { action: 'getCatalog' }), /настраивается/); await configure(app);
  await assert.rejects(app.endpoint('siteBridge', { action: 'getMessages', input: { id: 99 } }), e => e.parameters?.code === 'NOT_FOUND' && !e.message.includes('secret'));
});
