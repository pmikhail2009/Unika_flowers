import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/sqlite.mjs';
import { seed, execute, randomToken, handleApi, handleTelegramBridge } from '../server/shop.mjs';
import { flushTelegram } from '../server/telegram.mjs';

const secret = 'local-test-bridge-key-'.repeat(3);
async function fixture(t) {
  const db = await openDatabase(); await seed(db); t.after(() => db.close());
  const ctx = { guestToken: randomToken(), ip: 'browser-test' };
  const order = () => ({ requestId: randomToken(), items: [{ id: 1, quantity: 2, price: null }], contact: { name: 'Тестовый покупатель', phone: '+79990000000', delivery: 'delivery', address: 'Тестовый город' }, note: 'Пожелания покупателя' });
  const sent = []; let messageId = 500;
  const send = async (url, options) => { const body = JSON.parse(options.body); sent.push(body); return Response.json({ ok: true, result: { message_id: ++messageId } }); };
  const bridge = async (action, input, user = { id: 5211227935, isAdmin: true, isOwner: true }) => {
    const response = await handleTelegramBridge(new Request('https://shop.test/api/telegramBridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': secret }, body: JSON.stringify({ action, input, telegram: user }) }), db, secret);
    return { status: response.status, body: await response.json() };
  };
  return { db, ctx, order, sent, send, bridge };
}

test('browser and Mini App orders send complete cards to both Telegram administrators', async t => {
  const f = await fixture(t), payload = f.order();
  const request = new Request('https://shop.test/api/placeOrder', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${f.ctx.guestToken}` }, body: JSON.stringify(payload) });
  assert.equal((await handleApi(request, f.db, { telegramToken: 'test-only', telegramFetch: f.send })).status, 200);
  assert.equal(f.sent.length, 2); assert.deepEqual(f.sent.map(m => m.chat_id).sort(), [1154273072,5211227935]);
  assert.match(f.sent[0].text, /Тестовый город/); assert.match(f.sent[0].text, /Пожелания покупателя/); assert.match(f.sent[0].text, /сайт по ссылке/);
  assert.equal((await f.bridge('placeOrder', f.order(), { id: 100, name: 'Покупатель', isAdmin: false, isOwner: false })).status, 200);
  await flushTelegram(f.db, 'test-only', f.send);
  assert.equal(f.sent.length, 4); assert.match(f.sent[2].text, /Telegram Mini App/);
});

test('repeated orders and concurrent queue flushes do not duplicate notifications', async t => {
  const f = await fixture(t), payload = f.order();
  await Promise.all(Array.from({ length: 5 }, () => execute(f.db, 'placeOrder', payload, f.ctx)));
  await Promise.all(Array.from({ length: 5 }, () => flushTelegram(f.db, 'test-only', f.send)));
  assert.equal(f.sent.length, 2);
  await execute(f.db, 'placeOrder', payload, f.ctx); await flushTelegram(f.db, 'test-only', f.send);
  assert.equal(f.sent.length, 2);
});

test('a failed Telegram recipient stays queued without re-sending to the delivered recipient', async t => {
  const f = await fixture(t); await execute(f.db, 'placeOrder', f.order(), f.ctx);
  await flushTelegram(f.db, 'test-only', async (url, options) => JSON.parse(options.body).chat_id === 1154273072 ? Response.json({ ok: false }) : f.send(url, options));
  const pending = await f.db.prepare('SELECT * FROM telegram_outbox WHERE delivered=0').first();
  assert.equal(pending.chat_id, 1154273072); assert.equal(pending.attempts, 1);
  await f.db.prepare('UPDATE telegram_outbox SET retry_at=0 WHERE delivered=0').run();
  await flushTelegram(f.db, 'test-only', f.send); assert.equal(f.sent.length, 2);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM telegram_outbox WHERE delivered=0').first()).n, 0);
});

test('browser message arrives in Telegram and administrator reply returns to the same browser order', async t => {
  const f = await fixture(t), order = await execute(f.db, 'placeOrder', f.order(), f.ctx);
  await flushTelegram(f.db, 'test-only', f.send);
  const message = { id: order.orderId, text: 'Когда можно забрать?', requestId: randomToken() };
  await execute(f.db, 'sendMessage', message, f.ctx); await execute(f.db, 'sendMessage', message, f.ctx);
  await flushTelegram(f.db, 'test-only', f.send); assert.equal(f.sent.length, 4); assert.match(f.sent[2].text, /Когда можно забрать/);
  const link = await f.db.prepare('SELECT * FROM telegram_links WHERE chat_id=5211227935 LIMIT 1').first();
  const reply = { action: 'reply', replyTo: link.message_id, messageId: 999, text: 'Можно завтра.' };
  assert.equal((await f.bridge('bot', reply)).body.result.handled, true);
  await f.bridge('bot', reply);
  const messages = await execute(f.db, 'getMessages', { id: order.orderId }, f.ctx);
  assert.equal(messages.messages.length, 2); assert.equal(messages.messages[1].sender, 'shop'); assert.equal(messages.messages[1].text, 'Можно завтра.');
});

test('Telegram status buttons update website order and reject buyers and stale versions', async t => {
  const f = await fixture(t), order = await execute(f.db, 'placeOrder', f.order(), f.ctx);
  const input = { action: 'status', id: order.orderId, version: 0, status: 'confirmed' };
  assert.equal((await f.bridge('bot', input, { id: 100, isAdmin: false, isOwner: false })).status, 400);
  assert.equal((await f.bridge('bot', input)).status, 200);
  assert.equal((await f.bridge('bot', input)).status, 409);
  assert.equal((await execute(f.db, 'getMyOrders', {}, f.ctx)).orders[0].status, 'confirmed');
  const wrong = await f.bridge('bot', { action: 'link', id: order.orderId, messageId: 11 }, { id: 100, isAdmin: false, isOwner: false });
  assert.equal(wrong.status, 404);
  const publicRequest = new Request('https://shop.test/api/bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal((await handleApi(publicRequest, f.db)).status, 403);
});
