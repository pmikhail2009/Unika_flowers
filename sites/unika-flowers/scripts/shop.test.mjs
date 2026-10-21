import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/sqlite.mjs';
import { seed, execute, createStaff, randomToken, digest, handleApi, handleTelegramBridge } from '../server/shop.mjs';

const password = 'test-only-password-2026';
async function fixture(t) {
  const db = await openDatabase(); await seed(db); t.after(() => db.close());
  const owner = await createStaff(db, { username: 'owner', name: 'Владелец', role: 'owner', password });
  const ctx = { guestToken: randomToken(), ip: 'test-ip' }, other = { guestToken: randomToken(), ip: 'other-ip' };
  const admin = { guestToken: randomToken(), ip: 'owner-ip' }; await execute(db, 'login', { username: 'owner', password }, admin); admin.staffToken = admin.setStaffToken;
  const order = (extra = {}) => ({ requestId: randomToken(), items: [{ id: 1, quantity: 2, price: null }], contact: { name: 'Мария Тестовая', phone: '+79990000000', delivery: 'pickup', address: '' }, note: 'Локальная проверка', ...extra });
  return { db, ctx, other, admin, owner, order, call: (name, input, context = ctx) => execute(db, name, input, context) };
}
test('public catalog uses server records, settings and no admin credentials', async t => {
  const f = await fixture(t), data = await f.call('getCatalog', {});
  assert.equal(data.products.length, 10); assert.equal(data.profile.isAdmin, false); assert.equal(data.products[0].availability, 'available'); assert.equal(data.products[0].price, null);
});
test('guest cannot access administration or bootstrap owner', async t => {
  const f = await fixture(t);
  for (const name of ['getAdmin', 'mutateAdmin', 'setupOwner', 'changePassword']) await assert.rejects(f.call(name, { action: 'team' }), /Войдите|владелец/);
  assert.equal((await f.call('getCatalog', {}, f.admin)).profile.isOwner, true);
});
test('order persists server-side and personal data are isolated between guests', async t => {
  const f = await fixture(t), result = await f.call('placeOrder', f.order());
  assert.match(result.recoveryCode, /^\d+\.[a-f0-9]{48}$/);
  const mine = (await f.call('getMyOrders', {})).orders; assert.equal(mine.length, 1); assert.equal(mine[0].contact.name, 'Мария Тестовая');
  assert.equal((await f.call('getMyOrders', {}, f.other)).orders.length, 0);
  await assert.rejects(f.call('getMessages', { id: result.orderId }, f.other), /нет доступа/);
  await assert.rejects(f.call('cancelOrder', { id: result.orderId, version: 0 }, f.other), /нет доступа/);
  assert.equal(mine[0].recoveryHash, undefined); assert.equal(mine[0].guestKey, undefined);
});
test('simultaneous retries produce exactly one order', async t => {
  const f = await fixture(t), payload = f.order();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.call('placeOrder', payload)));
  assert.equal(new Set(results.map(r => r.orderId)).size, 1); assert.equal((await f.call('getMyOrders', {})).orders.length, 1);
});
test('concurrent new orders respect 3 per minute limit atomically', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.call('placeOrder', f.order())));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.equal((await f.call('getMyOrders', {})).orders.length, 3);
});
test('IP limit cannot be bypassed by creating guest cookies', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => f.call('placeOrder', f.order(), { guestToken: randomToken(), ip: 'shared-ip' })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
});
test('prices, hidden and unavailable products validated on server', async t => {
  const f = await fixture(t); let p = (await f.call('getAdmin', { action: 'products' }, f.admin)).products[0];
  await f.call('mutateAdmin', { action: 'product', product: { ...p, price: 750 } }, f.admin);
  await assert.rejects(f.call('placeOrder', f.order()), e => e.code === 'PRICE_CHANGED');
  const result = await f.call('placeOrder', f.order({ items: [{ id: 1, price: 750, quantity: 2 }] }));
  assert.equal(result.orderId, 1); assert.equal((await f.call('getMyOrders', {})).orders[0].items[0].price, 750);
  p = (await f.call('getAdmin', { action: 'products' }, f.admin)).products[0]; await f.call('mutateAdmin', { action: 'product', product: { ...p, availability: 'soldout' } }, f.admin);
  await assert.rejects(f.call('placeOrder', f.order({ items: [{ id: 1, price: 750, quantity: 1 }] })), e => e.code === 'PRODUCT_UNAVAILABLE');
});
test('quantity, contact and address validation cannot be bypassed', async t => {
  const f = await fixture(t);
  for (const extra of [{ items: [] }, { items: [{ id: 1, price: null, quantity: 101 }] }, { contact: { name: '', delivery: 'pickup' } }, { contact: { name: 'Маша', delivery: 'delivery', address: '' } }, { contact: { name: 'Маша', phone: 'abc', delivery: 'pickup' } }]) await assert.rejects(f.call('placeOrder', f.order(extra)));
});
test('recovery code restores access on a different device, numbers and wrong tokens fail', async t => {
  const f = await fixture(t), r = await f.call('placeOrder', f.order());
  await assert.rejects(f.call('recoverOrder', { code: `${r.orderId}.${randomToken()}` }, f.other), /не найден/);
  await f.call('recoverOrder', { code: r.recoveryCode }, f.other);
  assert.equal((await f.call('getMyOrders', {}, f.other)).orders[0].id, r.orderId);
  const stored = await f.db.prepare('SELECT recovery_hash FROM orders WHERE id=?').bind(r.orderId).first();
  assert.equal(stored.recovery_hash, await digest(r.recoveryCode.split('.')[1]));
});
test('customer cancellation moves order into archive, replay retains history', async t => {
  const f = await fixture(t), r = await f.call('placeOrder', f.order());
  await f.call('cancelOrder', { id: r.orderId, version: 0 });
  assert.equal((await f.call('getAdmin', { action: 'orders' }, f.admin)).total, 0);
  const archived = await f.call('getAdmin', { action: 'orders', scope: 'archive' }, f.admin); assert.equal(archived.total, 1); assert.equal(archived.orders[0].history.length, 2);
  await f.call('mutateAdmin', { action: 'order', id: r.orderId, version: 1, status: 'confirmed' }, f.admin);
  assert.equal((await f.call('getAdmin', { action: 'orders' }, f.admin)).total, 1);
});
test('admin completes order, rejects stale versions and invalid transitions', async t => {
  const f = await fixture(t), r = await f.call('placeOrder', f.order());
  await assert.rejects(f.call('mutateAdmin', { action: 'order', id: r.orderId, version: 0, status: 'done' }, f.admin), /статус/);
  await f.call('mutateAdmin', { action: 'order', id: r.orderId, version: 0, status: 'confirmed' }, f.admin);
  await assert.rejects(f.call('cancelOrder', { id: r.orderId, version: 0 }), e => e.code === 'CONFLICT');
  await f.call('mutateAdmin', { action: 'order', id: r.orderId, version: 1, status: 'done' }, f.admin);
  assert.equal((await f.call('getAdmin', { action: 'orders', scope: 'archive' }, f.admin)).orders[0].status, 'done');
});
test('search finds submitted Russian name case-insensitively, phone and notes', async t => {
  const f = await fixture(t); await f.call('placeOrder', f.order());
  for (const search of ['мария', 'МАРИЯ', '+79990000000', 'локальная', '1']) assert.equal((await f.call('getAdmin', { action: 'orders', search }, f.admin)).total, 1);
  assert.equal((await f.call('getAdmin', { action: 'orders', search: '%' }, f.admin)).total, 0);
});
test('messages use real storage, idempotency, roles and access controls', async t => {
  const f = await fixture(t), r = await f.call('placeOrder', f.order()), input = { id: r.orderId, text: 'Подскажите получение', requestId: randomToken() };
  await Promise.all([f.call('sendMessage', input), f.call('sendMessage', input)]);
  await f.call('sendMessage', { id: r.orderId, text: 'Можно согласовать здесь', requestId: randomToken() }, f.admin);
  const messages = (await f.call('getMessages', { id: r.orderId })).messages; assert.equal(messages.length, 2); assert.equal(messages[1].sender, 'shop');
  await assert.rejects(f.call('sendMessage', { ...input, requestId: randomToken() }, f.other), /нет доступа/);
});
test('settings pause ordering and optimistic locks protect updates', async t => {
  const f = await fixture(t), s = (await f.call('getAdmin', { action: 'settings' }, f.admin)).settings;
  await f.call('mutateAdmin', { action: 'settings', settings: { ...s, orderingOpen: false, announcement: 'До весны' } }, f.admin);
  await assert.rejects(f.call('placeOrder', f.order()), e => e.code === 'SHOP_CLOSED');
  await assert.rejects(f.call('mutateAdmin', { action: 'settings', settings: s }, f.admin), e => e.code === 'CONFLICT');
  assert.equal((await f.call('getCatalog', {})).settings.announcement, 'До весны');
});
test('product create retries are idempotent; hidden products stay hidden after seeding', async t => {
  const f = await fixture(t), p = (await f.call('getAdmin', { action: 'products' }, f.admin)).products[0];
  await f.call('mutateAdmin', { action: 'product', product: { ...p, active: false } }, f.admin); await seed(f.db);
  assert.equal((await f.call('getCatalog', {})).products.length, 9);
  const data = { ...p, id: undefined, photoData: 'data:image/png;base64,YQ==' }, requestId = randomToken();
  const results = await Promise.all([f.call('mutateAdmin', { action: 'product', product: data, requestId }, f.admin), f.call('mutateAdmin', { action: 'product', product: data, requestId }, f.admin)]);
  assert.equal(results[0].product.id, results[1].product.id);
});
test('team access, revocation, password hashing, expired and logged out sessions', async t => {
  const f = await fixture(t), member = await f.call('mutateAdmin', { action: 'team', operation: 'create', name: 'Флорист', username: 'florist', password }, f.admin);
  const ctx = { guestToken: randomToken(), ip: 'staff-ip' }; await f.call('login', { username: 'florist', password }, ctx); ctx.staffToken = ctx.setStaffToken;
  assert.equal((await f.call('getCatalog', {}, ctx)).profile.isAdmin, true);
  await assert.rejects(f.call('getAdmin', { action: 'team' }, ctx), /владельцу/);
  await f.call('mutateAdmin', { action: 'team', id: member.member.id, grant: false }, f.admin);
  await assert.rejects(f.call('getAdmin', {}, ctx), /Войдите/);
  await f.call('logout', {}, f.admin); await assert.rejects(f.call('getAdmin', {}, f.admin), /Войдите/);
  const stored = await f.db.prepare('SELECT password_hash FROM staff WHERE id=?').bind(f.owner.id).first(); assert.notEqual(stored.password_hash, password);
});
test('HTTP rejects cross-origin writes, malformed JSON, oversized bodies and issues HttpOnly cookies', async t => {
  const f = await fixture(t);
  const req = (body, origin, type = 'application/json') => new Request('https://shop.test/api/getCatalog', { method: 'POST', headers: { 'Content-Type': type, ...(origin ? { Origin: origin } : {}) }, body });
  assert.equal((await handleApi(req('{}', 'https://evil.test'), f.db)).status, 403);
  assert.equal((await handleApi(req('{'), f.db)).status, 400);
  assert.equal((await handleApi(req('{}', '', 'text/plain'), f.db)).status, 415);
  assert.equal((await handleApi(req('a'.repeat(1200001)), f.db)).status, 413);
  const result = await handleApi(req('{}'), f.db); assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=31536000; Secure/);
});
test('Telegram-hosted browser can use public API without third-party cookies', async t => {
  const f = await fixture(t), origin = 'https://app8754275738.tgcloud.ai';
  const preflight = await handleApi(new Request('https://shop.test/api/getCatalog', { method: 'OPTIONS', headers: { Origin: origin } }), f.db);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin); assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  const request = (action, input = {}, token) => new Request(`https://shop.test/api/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const catalog = await (await handleApi(request('getCatalog'), f.db)).json();
  const token = catalog.auth.guestToken; assert.match(token, /^[a-f0-9]{48}$/);
  const order = await handleApi(request('placeOrder', f.order(), token), f.db); assert.equal(order.status, 200);
  const history = await (await handleApi(request('getMyOrders', {}, token), f.db)).json(); assert.equal(history.result.orders.length, 1);
  const forged = await handleApi(request('getAdmin', { telegram: { id: 5211227935, isOwner: true }, isAdmin: true }, token), f.db); assert.equal(forged.status, 401);
});
test('shared backend trusts Telegram identity only after server secret verification', async t => {
  const f = await fixture(t), secret = 'test-only-server-key-'.repeat(3);
  const req = (payload, key = secret) => new Request('https://shop.test/api/telegramBridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': key }, body: JSON.stringify(payload) });
  const buyer = { id: 100, name: 'Покупатель Telegram', isAdmin: false, isOwner: false }, owner = { id: 5211227935, name: 'Владелец Telegram', isAdmin: true, isOwner: true };
  assert.equal((await handleTelegramBridge(req({ action: 'getAdmin', telegram: owner }, 'wrong'), f.db, secret)).status, 403);
  assert.equal((await handleTelegramBridge(req({ action: 'getAdmin', telegram: buyer }), f.db, secret)).status, 401);
  const admin = await (await handleTelegramBridge(req({ action: 'getCatalog', telegram: owner }), f.db, secret)).json(); assert.equal(admin.result.profile.isOwner, true); assert.equal(admin.result.profile.authMethod, 'telegram');
  const a = await (await handleTelegramBridge(req({ action: 'getCatalog', telegram: buyer }), f.db, secret)).json();
  const b = await (await handleTelegramBridge(req({ action: 'getCatalog', telegram: buyer }), f.db, secret)).json(); assert.equal(a.auth.guestToken, b.auth.guestToken);
  const c = await (await handleTelegramBridge(req({ action: 'getCatalog', telegram: { ...buyer, id: 101 } }), f.db, secret)).json(); assert.notEqual(a.auth.guestToken, c.auth.guestToken);
});
test('same shared orders appear via Telegram and normal browser using personal access', async t => {
  const f = await fixture(t), secret = 'test-key-'.repeat(8), telegram = { id: 555, name: 'Анна', isAdmin: false, isOwner: false };
  const request = (action, input = {}) => new Request('https://shop.test/api/telegramBridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': secret }, body: JSON.stringify({ action, input, telegram }) });
  const created = await (await handleTelegramBridge(request('placeOrder', f.order()), f.db, secret)).json(); assert.ok(created.result.recoveryCode);
  const tgHistory = await (await handleTelegramBridge(request('getMyOrders'), f.db, secret)).json(); assert.equal(tgHistory.result.orders.length, 1);
  await f.call('recoverOrder', { code: created.result.recoveryCode }); assert.equal((await f.call('getMyOrders', {})).orders[0].id, created.result.orderId);
  const owner = { ...telegram, id: 5211227935, isAdmin: true, isOwner: true };
  const reply = await handleTelegramBridge(new Request('https://shop.test/api/telegramBridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': secret }, body: JSON.stringify({ action: 'mutateAdmin', telegram: owner, input: { action: 'order', id: created.result.orderId, version: 0, status: 'confirmed' } }) }), f.db, secret); assert.equal(reply.status, 200);
  assert.equal((await f.call('getMyOrders', {})).orders[0].status, 'confirmed');
});
