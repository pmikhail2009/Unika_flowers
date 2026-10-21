import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.mjs';
import { validateItems, validateProduct, parseHeight, totals } from '../tgcloud/lib/validation.js';

const OWNER = 5211227935, ADMIN = 1154273072;
const payload = (key = 'request_00001') => ({ requestId: key, items: [{ id: 1, quantity: 2, price: null }], note: 'Для сада', contact: { name: 'Анна', delivery: 'pickup' } });
const code = value => error => error.parameters?.code === value;
async function fixture(work) { const app = await runtime(); try { await app.endpoint('getCatalog', {}, 100); await work(app); } finally { app.close(); } }

test('strict input validation rejects malformed heights, quantities and inherited enum names', () => {
  assert.deepEqual(parseHeight('0,8–1,2 м'), [80, 120]); assert.equal(parseHeight('-80 см'), null); assert.equal(parseHeight('abc 80'), null); assert.equal(parseHeight('120–80'), null);
  assert.throws(() => validateItems([{ id: 1, quantity: 1.5, price: null }])); assert.throws(() => validateItems([{ id: 1, quantity: 1, price: null }, { id: 1, quantity: 1, price: null }]));
  assert.throws(() => validateProduct({ name: 'Сорт', shortDescription: 'с', description: 'д', heightMin: 80, heightMax: 100, bloomMin: 0, bloomMax: 0, price: null, availability: 'toString', active: true }));
  assert.deepEqual(totals([{ price: 200, quantity: 2 }, { price: null, quantity: 1 }]), { amount: 400, complete: false, quantity: 3 });
});
test('endpoints require verified identity and server-side admin permissions', () => fixture(async app => {
  await assert.rejects(app.endpoint('getCatalog', {}, null), code('AUTH_REQUIRED'));
  for (const id of [100, 101]) { await assert.rejects(app.endpoint('getAdmin', {}, id), code('FORBIDDEN')); await assert.rejects(app.endpoint('mutateAdmin', { action: 'team', id: 100, grant: true }, id), code('FORBIDDEN')); }
  assert.equal((await app.endpoint('getCatalog', {}, OWNER)).profile.isOwner, true);
  assert.equal((await app.endpoint('getCatalog', {}, ADMIN)).profile.isAdmin, true);
  await assert.rejects(app.endpoint('getAdmin', { action: 'team' }, ADMIN), code('FORBIDDEN'));
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'team', id: 123, grant: true }, ADMIN), code('FORBIDDEN'));
}));
test('concurrent retries create one order, scoped to the Telegram account', () => fixture(async app => {
  const results = await Promise.all([app.endpoint('placeOrder', payload()), app.endpoint('placeOrder', payload())]);
  assert.equal(results[0].orderId, results[1].orderId);
  assert.equal(app.sqlite.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
  assert.equal(app.messages.filter(message => message.params?.chat_id === 100).length, 1);
  const other = await app.endpoint('placeOrder', payload(), 101); assert.notEqual(other.orderId, results[0].orderId);
  assert.equal((await app.endpoint('getMyOrders', {}, 100)).orders.length, 1);
  assert.equal((await app.endpoint('getMyOrders', {}, 102)).orders.length, 0);
}));
test('server prices and availability cannot be bypassed by a stale or manipulated cart', () => fixture(async app => {
  app.sqlite.exec('UPDATE products SET price = 500 WHERE id = 1');
  await assert.rejects(app.endpoint('placeOrder', payload()), code('PRICE_CHANGED'));
  const input = payload(); input.items[0].price = 500;
  await app.endpoint('placeOrder', input);
  assert.equal(JSON.parse(app.sqlite.prepare('SELECT items FROM orders').get().items)[0].price, 500);
  app.sqlite.exec("UPDATE products SET availability = 'soldout' WHERE id = 1");
  await assert.rejects(app.endpoint('placeOrder', { ...input, requestId: 'request_00002' }), code('PRODUCT_UNAVAILABLE'));
}));
test('customer cancellation cannot touch another account and becomes immutable after confirmation', () => fixture(async app => {
  const first = await app.endpoint('placeOrder', payload());
  await assert.rejects(app.endpoint('cancelOrder', { id: first.orderId, version: 0 }, 101), code('NOT_FOUND'));
  await app.endpoint('cancelOrder', { id: first.orderId, version: 0 });
  await assert.rejects(app.endpoint('cancelOrder', { id: first.orderId, version: 0 }), code('CONFLICT'));
  const second = await app.endpoint('placeOrder', payload('request_00002'));
  await app.endpoint('mutateAdmin', { action: 'order', id: second.orderId, version: 0, status: 'confirmed' }, ADMIN);
  await assert.rejects(app.endpoint('cancelOrder', { id: second.orderId, version: 1 }), code('INVALID_STATUS'));
}));
test('status workflow enforces versions and preserves chronological history', () => fixture(async app => {
  const { orderId } = await app.endpoint('placeOrder', payload());
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'order', id: orderId, version: 0, status: 'done' }, OWNER), code('INVALID_STATUS'));
  let version = 0;
  for (const status of ['confirmed', 'preparing', 'ready', 'done']) {
    const result = await app.endpoint('mutateAdmin', { action: 'order', id: orderId, version, status }, ADMIN); assert.equal(result.order.version, ++version);
  }
  const order = (await app.endpoint('getMyOrders', {})).orders[0];
  assert.equal(order.history.length, 5); assert.equal(order.status, 'done');
  assert.equal(Object.hasOwn(order.history[1], 'actorId'), false);
  assert.equal(Object.hasOwn(order, 'requestKey'), false);
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'order', id: orderId, version: 0, status: 'cancelled' }, OWNER), code('CONFLICT'));
}));
test('concurrent product changes conflict, and hidden seed products remain hidden', () => fixture(async app => {
  const product = (await app.endpoint('getAdmin', { action: 'products' }, OWNER)).products[0];
  const input = { action: 'product', product: { ...product, active: false, photoData: undefined } };
  await app.endpoint('mutateAdmin', input, ADMIN);
  await assert.rejects(app.endpoint('mutateAdmin', input, OWNER), code('CONFLICT'));
  const catalog = await app.endpoint('getCatalog', {}); assert.equal(catalog.products.length, 9);
  assert.equal(app.sqlite.prepare('SELECT active FROM products WHERE id = 1').get().active, 0);
}));
test('pause applies to new orders while retries return the saved order', () => fixture(async app => {
  const first = await app.endpoint('placeOrder', payload());
  const settings = { orderingOpen: false, announcement: 'Скоро вернёмся', delivery: 'Самовывоз по договорённости', payment: 'После подтверждения', version: 0 };
  await app.endpoint('mutateAdmin', { action: 'settings', settings }, OWNER);
  assert.equal((await app.endpoint('placeOrder', payload())).orderId, first.orderId);
  await assert.rejects(app.endpoint('placeOrder', payload('request_00002')), code('SHOP_CLOSED'));
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'settings', settings }, ADMIN), code('CONFLICT'));
}));
test('owner can grant and revoke dynamic roles; fixed roles cannot be removed', () => fixture(async app => {
  await app.endpoint('mutateAdmin', { action: 'team', id: 1000, grant: true }, OWNER);
  assert.ok((await app.endpoint('getAdmin', {}, 1000)).counts);
  await app.endpoint('mutateAdmin', { action: 'team', id: 1000, grant: false }, OWNER);
  await assert.rejects(app.endpoint('getAdmin', {}, 1000), code('FORBIDDEN'));
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'team', id: OWNER, grant: false }, OWNER), code('FIXED_ROLE'));
}));
test('legacy phrase never grants a role and /id works without registration', () => fixture(async app => {
  const handler = (await app.load('handlers/message.js')).default;
  await handler({ chat: { id: 200, type: 'private' }, from: { id: 200 }, text: 'pmikhail1337', message_id: 1 });
  await assert.rejects(app.endpoint('getAdmin', {}, 200), code('FORBIDDEN'));
  await handler({ chat: { id: 200, type: 'private' }, from: { id: 200 }, text: '/id', message_id: 2 });
  assert.match(app.messages.at(-1).params.text, /200/);
}));

test('history pagination and order search include older records without mixing customers', () => fixture(async app => {
  const schema = await app.load('schema.js');
  for (let i = 0; i < 23; i++) await app.db.insert(schema.orders).values({ customerId: 100, customerName: 'Анна', items: [], note: `Заявка ${i}`, source: 'chat', createdAt: i + 1 }).run();
  await app.db.insert(schema.orders).values({ customerId: 101, customerName: 'Борис', items: [], note: 'Чужой заказ', source: 'chat', createdAt: 100 }).run();
  const first = await app.endpoint('getMyOrders', {}), second = await app.endpoint('getMyOrders', { offset: 10 }), last = await app.endpoint('getMyOrders', { offset: 20 });
  assert.equal(first.orders.length, 10); assert.equal(second.orders.length, 10); assert.equal(last.orders.length, 3); assert.equal(last.hasMore, false);
  assert.equal(new Set([...first.orders, ...second.orders, ...last.orders].map(order => order.id)).size, 23);
  assert.ok(first.orders.every(order => order.customerId === 100));
  const found = await app.endpoint('getAdmin', { action: 'orders', search: 'Борис' }, ADMIN); assert.equal(found.total, 1); assert.equal(found.orders[0].customerId, 101);
}));
test('rate limit rejects new requests while accepting an idempotent retry', () => fixture(async app => {
  for (let i = 0; i < 3; i++) await app.endpoint('placeOrder', payload(`request_0000${i}`));
  await assert.rejects(app.endpoint('placeOrder', payload('request_00004')), code('RATE_LIMIT'));
  const retry = await app.endpoint('placeOrder', payload('request_00000')); assert.ok(retry.orderId);
}));
test('new products require photos and validate delivery details', () => fixture(async app => {
  const product = { name: 'Новый сорт', shortDescription: 'Кратко', description: 'Описание', heightMin: 80, heightMax: 120, bloomMin: 0, bloomMax: 0, price: 500, active: true, availability: 'preorder' };
  await assert.rejects(app.endpoint('mutateAdmin', { action: 'product', product }, ADMIN), code('PHOTO_REQUIRED'));
  const result = await app.endpoint('mutateAdmin', { action: 'product', product: { ...product, photoData: 'data:image/jpeg;base64,YQ==' } }, ADMIN);
  assert.ok(result.product.id > 10);
  const input = payload(); input.contact = { name: 'Анна', delivery: 'delivery' };
  await assert.rejects(app.endpoint('placeOrder', input), code('VALIDATION'));
  input.contact.address = 'Тестовый город'; input.contact.phone = 'not-a-phone';
  await assert.rejects(app.endpoint('placeOrder', input), code('VALIDATION'));
}));

test('chat orders preserve earlier requests and /cancel only cancels input', () => fixture(async app => {
  const handler = (await app.load('handlers/message.js')).default;
  const callback = (await app.load('handlers/callback_query.js')).default;
  const chat = { id: 200, type: 'private' }, from = { id: 200, first_name: 'Анна' };
  await handler({ chat, from, text: '/start', message_id: 1 });
  for (const messageId of [2, 3]) {
    await callback({ id: `callback${messageId}`, message: { chat }, from, data: 'order:new' });
    await handler({ chat, from, text: 'Limelight — 2 шт.', message_id: messageId });
  }
  await handler({ chat, from, text: '/cancel', message_id: 4 });
  assert.equal((await app.endpoint('getMyOrders', {}, 200)).orders.length, 2);
  await handler({ chat, from, text: '/orders', message_id: 5 });
  assert.ok(app.messages.some(message => message.params?.text?.includes('Заказ №1')));
}));
