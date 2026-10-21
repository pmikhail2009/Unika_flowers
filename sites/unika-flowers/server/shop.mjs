import { cleanText, validateItems, validateContact, validateProduct, DEFAULT_SETTINGS, STATUSES, TRANSITIONS, ACTIVE_ORDER_STATUSES } from './validation.js';
import catalog from '../public/data/products.json' with { type: 'json' };
import { queueTelegram, flushTelegram, orderCard, botAction } from './telegram.mjs';

const now = () => Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();
const encoder = new TextEncoder();
const parse = row => row ? { ...JSON.parse(row.data), id: row.id, version: row.version } : null;
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(24)));
export async function digest(value) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }
export class ShopError extends Error { constructor(message, code = 'VALIDATION', status = 400) { super(message); this.code = code; this.status = status; } }
function fail(message, code, status) { throw new ShopError(message, code, status); }
function integer(value, min = 1) { if (!Number.isSafeInteger(value) || value < min) fail('Некорректный номер.'); return value; }
function requestKey(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) fail('Обновите страницу перед отправкой.'); return value; }
function safeStaff(row) { return { id: row.id, username: row.username, name: row.name, owner: row.role === 'owner', fixed: false, active: !!row.active }; }
export async function passwordHash(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('Пароль должен содержать от 12 до 128 символов.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256)));
}
function same(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
const q = (db, sql, ...args) => db.prepare(sql).bind(...args);
async function all(statement) { return (await statement.all()).results; }
export async function seed(db) {
  const rows = catalog.products.map(p => q(db, 'INSERT OR IGNORE INTO products (id,data,version) VALUES (?,?,0)', p.id, JSON.stringify({ ...p, heightMin: p.heightCm[0], heightMax: p.heightCm[1], bloomMin: p.bloomCm[0], bloomMax: p.bloomCm[1], price: null, availability: 'available', active: true })));
  await db.batch([...rows, q(db, 'INSERT OR IGNORE INTO settings (id,data,version) VALUES (1,?,0)', JSON.stringify(DEFAULT_SETTINGS))]);
}
export async function createStaff(db, { username, name, password, role = 'admin' }) {
  username = cleanText(username, 60, 'Логин', true).toLowerCase();
  if (!/^[a-z0-9_.-]{3,60}$/.test(username)) fail('Логин: 3–60 латинских букв, цифр, точек или дефисов.');
  name = cleanText(name, 100, 'Имя', true);
  const salt = randomToken(), hash = await passwordHash(password, salt);
  try { return await q(db, 'INSERT INTO staff (username,name,role,salt,password_hash,active) VALUES (?,?,?,?,?,1) RETURNING *', username, name, role, salt, hash).first(); }
  catch { fail('Такой логин уже занят.', 'CONFLICT', 409); }
}
async function audit(db, actor, action, target) { await q(db, 'INSERT INTO audit (actor_id,actor_name,action,target,created_at) VALUES (?,?,?,?,?)', actor.id, actor.name, action, String(target), now()).run(); }
async function getSettings(db) { const row = await q(db, 'SELECT * FROM settings WHERE id=1').first(); return { ...JSON.parse(row.data), version: row.version }; }
async function getStaff(db, token) {
  if (!token) return null;
  return q(db, 'SELECT staff.* FROM sessions JOIN staff ON staff.id=sessions.staff_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND staff.active=1', await digest(token), now()).first();
}
async function throttle(db, key, limit, window = 60) {
  const time = now(), bucket = Math.floor(time / window), hashedKey = await digest(key);
  const row = await q(db, `INSERT INTO rate_limits (key,bucket,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END RETURNING count`, hashedKey, bucket).first();
  if (row.count > limit) fail('Слишком много попыток. Подождите немного и повторите.', 'RATE_LIMIT', 429);
}
function publicOrder(row) { const order = parse(row); return { ...order, unread: !!row.unread }; }
async function authorizeOrder(db, id, guest, staff) {
  const row = await q(db, 'SELECT * FROM orders WHERE id=?', integer(id)).first();
  if (!row || (!staff && !await q(db, 'SELECT 1 FROM order_access WHERE order_id=? AND guest_key=?', id, guest).first())) fail('Заказ не найден или нет доступа.', 'NOT_FOUND', 404);
  return row;
}
async function profile(db, ctx, staff) {
  const count = await q(db, 'SELECT COUNT(*) AS n FROM staff WHERE active=1').first();
  return { isAdmin: !!staff, isOwner: staff?.role === 'owner', name: staff?.name || ctx.telegram?.name || '', standalone: true, authMethod: staff?.authMethod || (staff ? 'password' : 'guest'), telegram: !!ctx.telegram, needsSetup: !count.n, canSetup: !!ctx.ownerVerified, ...(staff ? { orderCount: (await q(db, "SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('done','cancelled')").first()).n } : {}) };
}
export async function execute(db, name, input = {}, ctx) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Некорректный запрос.');
  const staff = ctx.telegram?.isAdmin ? { id: -ctx.telegram.id, name: ctx.telegram.name || `Telegram ${ctx.telegram.id}`, role: ctx.telegram.isOwner ? 'owner' : 'admin', authMethod: 'telegram' } : await getStaff(db, ctx.staffToken);
  const guest = await digest(ctx.guestToken);
  const ip = await digest(ctx.ip || 'local');
  const admin = () => { if (!staff) fail('Войдите в панель управления.', 'AUTH_REQUIRED', 401); return staff; };
  const owner = () => { admin(); if (staff.role !== 'owner') fail('Доступно только владельцу.', 'FORBIDDEN', 403); return staff; };
  if (name === 'bot') return botAction(db, input, ctx, execute);
  if (name === 'getCatalog') {
    if (ctx.previousGuestToken && ctx.previousGuestToken !== ctx.guestToken) await q(db, 'INSERT OR IGNORE INTO order_access (order_id,guest_key) SELECT order_id,? FROM order_access WHERE guest_key=?', guest, await digest(ctx.previousGuestToken)).run();
    const products = (await all(q(db, 'SELECT * FROM products ORDER BY id'))).map(parse).filter(p => p.active).map(p => ({ ...p, image: p.photoData || p.image, heightCm: [p.heightMin, p.heightMax], bloomCm: [p.bloomMin, p.bloomMax] }));
    return { products, settings: await getSettings(db), profile: await profile(db, ctx, staff) };
  }
  if (name === 'setupOwner') {
    if (!ctx.ownerVerified) fail('Настройку магазина выполняет владелец после входа.', 'FORBIDDEN', 403);
    // Only one owner can be created by setup, even for simultaneous requests.
    if ((await q(db, 'SELECT COUNT(*) AS n FROM staff').first()).n) fail('Магазин уже настроен.', 'CONFLICT', 409);
    await throttle(db, `setup:${ip}`, 5, 3600);
    const salt = randomToken(), hash = await passwordHash(input.password, salt);
    const username = cleanText(input.username, 60, 'Логин', true).toLowerCase(), displayName = cleanText(input.name, 100, 'Имя', true);
    if (!/^[a-z0-9_.-]{3,60}$/.test(username)) fail('Логин: от 3 латинских букв, цифр, точек или дефисов.');
    const row = await q(db, 'INSERT INTO staff (username,name,role,salt,password_hash,active) SELECT ?,?,\'owner\',?,?,1 WHERE NOT EXISTS (SELECT 1 FROM staff) RETURNING *', username, displayName, salt, hash).first();
    if (!row) fail('Магазин уже настроен.', 'CONFLICT', 409);
    return { ok: true };
  }
  if (name === 'login') {
    await throttle(db, `login-ip:${ip}`, 20, 900);
    const username = cleanText(input.username, 60, 'Логин', true).toLowerCase();
    await throttle(db, `login-user:${username}`, 10, 900);
    const row = await q(db, 'SELECT * FROM staff WHERE username=? AND active=1', username).first();
    const computed = await passwordHash(input.password, row?.salt || 'unica-invalid-user');
    if (!row || !same(computed, row.password_hash)) fail('Неверный логин или пароль.', 'AUTH_REQUIRED', 401);
    const token = randomToken();
    await db.batch([q(db, 'DELETE FROM sessions WHERE expires_at<=?', now()), q(db, 'INSERT INTO sessions (token_hash,staff_id,expires_at) VALUES (?,?,?)', await digest(token), row.id, now() + 8 * 3600)]);
    ctx.setStaffToken = token;
    await audit(db, row, 'session:login', row.id);
    return { profile: await profile(db, ctx, row) };
  }
  if (name === 'logout') { if (ctx.staffToken) await q(db, 'DELETE FROM sessions WHERE token_hash=?', await digest(ctx.staffToken)).run(); ctx.setStaffToken = ''; return { ok: true }; }
  if (name === 'placeOrder') {
    requestKey(input.requestId); validateItems(input.items);
    const contact = validateContact(input.contact), note = cleanText(input.note, 1000, 'Пожелания');
    const key = `${guest}:${input.requestId}`;
    const existing = await q(db, 'SELECT * FROM orders WHERE request_key=?', key).first();
    if (existing) {
      await queueTelegram(db, `order:${existing.id}`, publicOrder(existing), orderCard(publicOrder(existing)));
      return { orderId: existing.id, summary: 'Заявка уже сохранена. Откройте «Мои заказы».', replayed: true };
    }
    if (!(await getSettings(db)).orderingOpen) fail('Приём заявок временно приостановлен.', 'SHOP_CLOSED', 409);
    const items = [];
    for (const item of input.items) {
      const p = parse(await q(db, 'SELECT * FROM products WHERE id=?', item.id).first());
      if (!p?.active || p.availability === 'soldout') fail('Один из сортов недоступен. Обновите корзину.', 'PRODUCT_UNAVAILABLE', 409);
      if (p.price !== item.price) fail('Цена изменилась. Обновите каталог и проверьте сумму.', 'PRICE_CHANGED', 409);
      items.push({ id: p.id, name: p.name, quantity: item.quantity, price: p.price, availability: p.availability });
    }
    const time = now(), recoveryToken = randomToken(), recoveryHash = await digest(recoveryToken);
    const order = { customerName: contact.name, contact, items, note, createdAt: time, updatedAt: time, status: 'new', source: ctx.telegram ? 'telegram' : 'website', ...(ctx.telegram ? { telegramId: ctx.telegram.id } : {}), history: [{ status: 'new', at: time }] };
    // The rate condition and insertion are ONE SQLite statement; concurrent requests cannot bypass the limit.
    const statements = [q(db, `INSERT INTO orders (guest_key,ip_hash,request_key,recovery_hash,customer_name,phone,search_text,status,unread,created_at,updated_at,data,version)
      SELECT ?,?,?,?,?,?,?,'new',1,?,?,?,0
      WHERE (SELECT COUNT(*) FROM orders WHERE guest_key=? AND created_at>?)<3
        AND (SELECT COUNT(*) FROM orders WHERE ip_hash=? AND created_at>?)<10
        AND json_extract((SELECT data FROM settings WHERE id=1),'$.orderingOpen')=1
        AND (SELECT COUNT(*) FROM products WHERE json_extract(data,'$.active')=1 AND json_extract(data,'$.availability')!='soldout' AND (${items.map(() => "(id=? AND json_extract(data,'$.price') IS ?)").join(' OR ')}))=?
      ON CONFLICT(request_key) DO NOTHING RETURNING id`, guest, ip, key, recoveryHash, contact.name, contact.phone, `${contact.name} ${contact.phone} ${contact.address} ${note}`.toLocaleLowerCase('ru-RU'), time, time, JSON.stringify(order), guest, time - 60, ip, time - 60, ...items.flatMap(p => [p.id, p.price]), items.length),
      q(db, 'INSERT OR IGNORE INTO order_access (order_id,guest_key) SELECT id,guest_key FROM orders WHERE request_key=?', key)];
    const result = await db.batch(statements);
    const row = await q(db, 'SELECT * FROM orders WHERE request_key=?', key).first();
    if (!row) fail('Приём временно недоступен или отправлено слишком много заявок. Обновите каталог и повторите через минуту.', 'RATE_LIMIT', 429);
    const inserted = !!result[0].results?.length;
    await queueTelegram(db, `order:${row.id}`, publicOrder(row), orderCard(publicOrder(row)));
    return { orderId: row.id, summary: items.map(p => `${p.name} × ${p.quantity}`).join('\n'), ...(inserted ? { recoveryCode: `${row.id}.${recoveryToken}` } : { replayed: true }) };
  }
  if (name === 'recoverOrder') {
    await throttle(db, `recover:${ip}`, 20, 900);
    const code = cleanText(input.code, 100, 'Код заказа', true).match(/^(\d+)\.([a-f0-9]{48})$/);
    if (!code) fail('Проверьте полный личный код заказа.');
    const row = await q(db, 'SELECT id,recovery_hash FROM orders WHERE id=?', Number(code[1])).first();
    if (!row || !same(row.recovery_hash, await digest(code[2]))) fail('Заказ не найден. Проверьте личный код.', 'NOT_FOUND', 404);
    await q(db, 'INSERT OR IGNORE INTO order_access (order_id,guest_key) VALUES (?,?)', row.id, guest).run();
    return { orderId: row.id };
  }
  if (name === 'renewOrderAccess') {
    await authorizeOrder(db, input.id, guest, null);
    await throttle(db, `access:${guest}`, 10, 900);
    const token = randomToken();
    await q(db, 'UPDATE orders SET recovery_hash=? WHERE id=?', await digest(token), input.id).run();
    return { recoveryCode: `${input.id}.${token}` };
  }
  if (name === 'getMyOrders') {
    const offset = Math.min(integer(input.offset ?? 0, 0), 100000);
    const rows = await all(q(db, 'SELECT orders.* FROM orders JOIN order_access ON orders.id=order_access.order_id WHERE order_access.guest_key=? ORDER BY orders.id DESC LIMIT 11 OFFSET ?', guest, offset));
    return { orders: rows.slice(0, 10).map(publicOrder), hasMore: rows.length > 10 };
  }
  if (name === 'cancelOrder' || name === 'mutateAdmin' && input.action === 'order') {
    const byAdmin = name === 'mutateAdmin'; if (byAdmin) admin();
    const row = await authorizeOrder(db, input.id, guest, byAdmin ? staff : null), order = publicOrder(row);
    const status = byAdmin ? input.status : 'cancelled';
    if (input.version !== row.version) fail('Заказ уже изменён. Обновите список.', 'CONFLICT', 409);
    if ((!byAdmin && row.status !== 'new') || !TRANSITIONS[row.status]?.includes(status)) fail('Изменить статус уже нельзя. Напишите магазину.', 'INVALID_STATUS', 409);
    const data = { ...order, status, updatedAt: now(), history: [...order.history, { status, at: now() }] };
    const changed = await q(db, 'UPDATE orders SET status=?,data=?,version=version+1,updated_at=?,unread=CASE WHEN ?=1 THEN 0 ELSE unread END WHERE id=? AND version=? RETURNING *', status, JSON.stringify(data), now(), byAdmin ? 1 : 0, row.id, input.version).first();
    if (!changed) fail('Заказ уже изменён. Обновите список.', 'CONFLICT', 409);
    if (byAdmin) await audit(db, staff, `order:${status}`, row.id);
    await queueTelegram(db, `status:${row.id}:${changed.version}`, publicOrder(changed), orderCard(publicOrder(changed)));
    await queueTelegram(db, `customer-status:${row.id}:${changed.version}`, publicOrder(changed), `Заказ №${row.id}: ${STATUSES[status]}.`, 'customer');
    return { order: publicOrder(changed) };
  }
  if (name === 'getMessages' || name === 'sendMessage') {
    const orderRow = await authorizeOrder(db, input.id, guest, staff);
    if (name === 'sendMessage') {
      await throttle(db, `message:${staff ? 'staff-' + staff.id : guest}`, 20);
      const text = cleanText(input.text, 2000, 'Сообщение', true), key = requestKey(input.requestId);
      await db.batch([q(db, 'INSERT OR IGNORE INTO messages (order_id,sender,sender_name,text,request_key,created_at) VALUES (?,?,?,?,?,?)', input.id, staff ? 'shop' : 'customer', staff ? 'UNICA & FLOWERS' : 'Покупатель', text, `${staff ? 'staff-' + staff.id : guest}:${key}`, now()), q(db, 'UPDATE orders SET unread=? WHERE id=?', staff ? 0 : 1, input.id)]);
      const message = await q(db, 'SELECT id,text FROM messages WHERE request_key=?', `${staff ? 'staff-' + staff.id : guest}:${key}`).first();
      const order = publicOrder(orderRow);
      await queueTelegram(db, `message:${message.id}`, order, `💬 ${staff ? 'Ответ магазина' : 'Сообщение покупателя'} · заказ сайта №${order.id}\n${order.customerName}\n\n${message.text}`, staff ? 'customer' : 'admins');
    }
    const offset = Math.min(integer(input.offset ?? 0, 0), 100000);
    const rows = await all(q(db, 'SELECT id,sender,sender_name AS senderName,text,created_at AS createdAt FROM messages WHERE order_id=? ORDER BY id DESC LIMIT 31 OFFSET ?', input.id, offset));
    return { messages: rows.slice(0, 30).reverse(), hasMore: rows.length > 30 };
  }
  if (name === 'getAdmin') {
    admin(); const offset = Math.min(integer(input.offset ?? 0, 0), 100000);
    if (input.action === 'counts') return { total: (await q(db, "SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('done','cancelled')").first()).n };
    if (input.action === 'products') { const rows = await all(q(db, 'SELECT * FROM products ORDER BY id LIMIT 101 OFFSET ?', offset)); return { products: rows.slice(0, 100).map(parse), hasMore: rows.length > 100 }; }
    if (input.action === 'settings') return { settings: await getSettings(db) };
    if (input.action === 'team') { owner(); return { team: (await all(q(db, 'SELECT * FROM staff ORDER BY id'))).map(safeStaff) }; }
    if (input.action === 'audit') return { events: await all(q(db, 'SELECT id,actor_id AS actorId,actor_name AS actorName,action,target,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 30 OFFSET ?', offset)) };
    if (input.action === 'orders') {
      const archive = input.scope === 'archive';
      const clauses = [`status ${archive ? '' : 'NOT'} IN ('done','cancelled')`], args = [];
      if (input.status && Object.hasOwn(STATUSES, input.status)) { clauses.push('status=?'); args.push(input.status); }
      const search = cleanText(input.search, 100, 'Поиск').toLocaleLowerCase('ru-RU');
      if (search) { clauses.push("(CAST(id AS TEXT)=? OR instr(search_text,?)>0)"); args.push(search.replace(/^№\s*/, ''), search); }
      const where = clauses.join(' AND ');
      const rows = await all(q(db, `SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT 21 OFFSET ?`, ...args, offset));
      return { orders: rows.slice(0, 20).map(publicOrder), total: (await q(db, `SELECT COUNT(*) AS n FROM orders WHERE ${where}`, ...args).first()).n, hasMore: rows.length > 20 };
    }
    const groups = await all(q(db, 'SELECT status,COUNT(*) AS n FROM orders GROUP BY status'));
    const counts = Object.fromEntries(Object.keys(STATUSES).map(status => [status, groups.find(g => g.status === status)?.n || 0]));
    return { counts, products: (await q(db, "SELECT COUNT(*) AS n FROM products WHERE json_extract(data,'$.active')=1").first()).n, customers: (await q(db, 'SELECT COUNT(DISTINCT guest_key) AS n FROM orders').first()).n, unread: (await q(db, 'SELECT COUNT(*) AS n FROM orders WHERE unread=1').first()).n, isOwner: staff.role === 'owner' };
  }
  if (name === 'mutateAdmin') {
    admin();
    if (input.action === 'read') { integer(input.id); await q(db, 'UPDATE orders SET unread=0 WHERE id=?', input.id).run(); return { ok: true }; }
    if (input.action === 'product') {
      const value = validateProduct(input.product || {}), id = input.product.id;
      if (id) {
        integer(id); integer(input.product.version, 0);
        const old = parse(await q(db, 'SELECT * FROM products WHERE id=?', id).first());
        if (!old) fail('Товар не найден.', 'NOT_FOUND', 404);
        const changed = await q(db, 'UPDATE products SET data=?,version=version+1 WHERE id=? AND version=? RETURNING *', JSON.stringify({ ...old, ...value }), id, input.product.version).first();
        if (!changed) fail('Товар уже изменён. Обновите список.', 'CONFLICT', 409);
        await audit(db, staff, 'product:update', id); return { product: parse(changed) };
      }
      if (!value.photoData) fail('Добавьте фотографию сорта.');
      const key = requestKey(input.requestId);
      const changed = await q(db, 'INSERT INTO products (data,version,request_key) VALUES (?,0,?) ON CONFLICT(request_key) DO NOTHING RETURNING *', JSON.stringify(value), `staff-${staff.id}:${key}`).first();
      const row = changed || await q(db, 'SELECT * FROM products WHERE request_key=?', `staff-${staff.id}:${key}`).first();
      if (changed) await audit(db, staff, 'product:create', row.id);
      return { product: parse(row) };
    }
    if (input.action === 'settings') {
      const s = input.settings || {}; integer(s.version, 0);
      if (typeof s.orderingOpen !== 'boolean') fail('Проверьте приём заявок.');
      const value = { orderingOpen: s.orderingOpen, announcement: cleanText(s.announcement, 200, 'Объявление'), delivery: cleanText(s.delivery, 1000, 'Получение', true), payment: cleanText(s.payment, 1000, 'Оплата', true) };
      const row = await q(db, 'UPDATE settings SET data=?,version=version+1 WHERE id=1 AND version=? RETURNING *', JSON.stringify(value), s.version).first();
      if (!row) fail('Настройки уже изменены. Обновите страницу.', 'CONFLICT', 409);
      await audit(db, staff, 'settings:update', 'shop'); return { settings: { ...value, version: row.version } };
    }
    if (input.action === 'team') {
      owner();
      if (input.operation === 'create') {
        if (!(await q(db, "SELECT COUNT(*) AS n FROM staff WHERE role='owner' AND active=1").first()).n) fail('Сначала создайте аккаунт владельца для входа из браузера.');
        const row = await createStaff(db, input); await audit(db, staff, 'team:create', row.id); return { member: safeStaff(row) };
      }
      integer(input.id);
      const member = await q(db, 'SELECT * FROM staff WHERE id=?', input.id).first();
      if (!member) fail('Сотрудник не найден.', 'NOT_FOUND', 404);
      if (member.role === 'owner') fail('Нельзя отключить аккаунт владельца.', 'FORBIDDEN', 403);
      if (input.operation === 'password') { const salt = randomToken(), hash = await passwordHash(input.password, salt); await db.batch([q(db, 'UPDATE staff SET salt=?,password_hash=? WHERE id=?', salt, hash, member.id), q(db, 'DELETE FROM sessions WHERE staff_id=?', member.id)]); }
      else { if (typeof input.grant !== 'boolean') fail('Выберите действие.'); await db.batch([q(db, 'UPDATE staff SET active=? WHERE id=?', Number(input.grant), member.id), q(db, 'DELETE FROM sessions WHERE staff_id=?', member.id)]); }
      await audit(db, staff, 'team:update', member.id); return { ok: true };
    }
  }
  if (name === 'changePassword') {
    admin();
    if (staff.authMethod === 'telegram') fail('Telegram-аккаунт не использует пароль магазина.');
    if (!same(await passwordHash(input.currentPassword, staff.salt), staff.password_hash)) fail('Текущий пароль неверен.', 'AUTH_REQUIRED', 401);
    const salt = randomToken(), hash = await passwordHash(input.password, salt);
    await db.batch([q(db, 'UPDATE staff SET salt=?,password_hash=? WHERE id=?', salt, hash, staff.id), q(db, 'DELETE FROM sessions WHERE staff_id=?', staff.id)]);
    ctx.setStaffToken = ''; return { ok: true };
  }
  fail('Неизвестное действие.', 'NOT_FOUND', 404);
}

const cookies = header => Object.fromEntries((header || '').split(';').map(v => v.trim().split('=')));
export async function handleApi(request, db, options = {}) {
  const url = new URL(request.url), headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const result = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  try {
    const origin = request.headers.get('origin');
    const allowedOrigin = origin === url.origin || origin === 'https://app8754275738.tgcloud.ai';
    if (origin && !allowedOrigin) fail('Запрос с другого сайта отклонён.', 'FORBIDDEN', 403);
    if (origin && allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Unica-Session');
      headers.set('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return result({ error: { message: 'Требуется POST.', code: 'METHOD' } }, 405);
    if (request.headers.get('sec-fetch-site') === 'cross-site' && !allowedOrigin) fail('Запрос с другого сайта отклонён.', 'FORBIDDEN', 403);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('Требуется JSON.', 'VALIDATION', 415);
    if (Number(request.headers.get('content-length')) > 1_200_000) fail('Слишком большой запрос.', 'VALIDATION', 413);
    let length = 0, chunks = []; const reader = request.body?.getReader();
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1_200_000) { await reader.cancel(); fail('Слишком большой запрос.', 'VALIDATION', 413); } chunks.push(value); }
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    let input; try { input = JSON.parse(new TextDecoder().decode(bytes) || '{}'); } catch { fail('Некорректный JSON.'); }
    const jar = cookies(request.headers.get('cookie')), secure = url.protocol === 'https:' ? '; Secure' : '';
    const bearer = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
    const deviceToken = bearer || (/^[a-f0-9]{48}$/.test(jar.unica_guest || '') ? jar.unica_guest : randomToken());
    const token = options.telegram ? (await digest(`${options.bridgeSecret}:telegram:${options.telegram.id}`)).slice(0, 48) : deviceToken;
    if (token !== jar.unica_guest) headers.append('Set-Cookie', `unica_guest=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
    const ctx = { guestToken: token, previousGuestToken: options.telegram ? deviceToken : undefined, telegram: options.telegram, staffToken: request.headers.get('x-unica-session') || jar.unica_staff, ip: options.ip || 'local', ownerVerified: options.ownerVerified || false };
    const action = url.pathname.split('/').at(-1);
    if (action === 'bot' && !options.telegram) fail('Требуется Telegram-соединение.', 'FORBIDDEN', 403);
    const data = await execute(db, action, input, ctx);
    if (options.telegramToken) {
      try { await flushTelegram(db, options.telegramToken, options.telegramFetch); }
      catch { console.error('Telegram delivery queue unavailable'); }
    }
    if (ctx.setStaffToken !== undefined) headers.append('Set-Cookie', `unica_staff=${ctx.setStaffToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ctx.setStaffToken ? 28800 : 0}${secure}`);
    return result({ result: data, auth: { guestToken: token, ...(ctx.setStaffToken !== undefined ? { staffToken: ctx.setStaffToken } : {}) } });
  } catch (error) {
    if (error instanceof ShopError) return result({ error: { message: error.message, code: error.code } }, error.status);
    // Validation helpers use ordinary Error; unknown storage errors must not expose SQL or records.
    if (error instanceof Error && !/SQLITE|D1_|constraint|database|syntax|no such|bind|UNIQUE/i.test(error.message)) return result({ error: { message: error.message, code: 'VALIDATION' } }, 400);
    console.error('Shop request failed', error?.name); return result({ error: { message: 'Сервис временно недоступен. Повторите позже.', code: 'SERVER_ERROR' } }, 503);
  }
}

export async function handleTelegramBridge(request, db, secret, delivery = {}) {
  const denied = () => Response.json({ error: { message: 'Нет доступа к Telegram-соединению.', code: 'FORBIDDEN' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST' || typeof secret !== 'string' || secret.length < 32) return denied();
  const supplied = request.headers.get('x-unica-bridge') || '';
  if (!same(await digest(supplied), await digest(secret))) return denied();
  const raw = await request.text();
  if (raw.length > 1_210_000) return Response.json({ error: { message: 'Слишком большой запрос.', code: 'VALIDATION' } }, { status: 413 });
  let payload; try { payload = JSON.parse(raw); } catch { return denied(); }
  const user = payload.telegram;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user.isAdmin !== 'boolean' || typeof user.isOwner !== 'boolean' || (user.isOwner && !user.isAdmin)) return denied();
  const actions = ['getCatalog','placeOrder','getMyOrders','cancelOrder','getAdmin','mutateAdmin','getMessages','sendMessage','recoverOrder','renewOrderAccess','setupOwner','login','logout','changePassword','bot'];
  if (!actions.includes(payload.action)) return denied();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (/^[a-f0-9]{48}$/.test(payload.guestToken || '')) headers.set('Authorization', `Bearer ${payload.guestToken}`);
  if (/^[a-f0-9]{48}$/.test(payload.staffToken || '')) headers.set('X-Unica-Session', payload.staffToken);
  const forwarded = new Request(`${new URL(request.url).origin}/api/${payload.action}`, { method: 'POST', headers, body: JSON.stringify(payload.input || {}) });
  return handleApi(forwarded, db, { ...delivery, bridgeSecret: secret, telegram: { id: user.id, name: String(user.name || '').slice(0, 100), isAdmin: user.isAdmin, isOwner: user.isOwner }, ip: `telegram:${user.id}`, ownerVerified: user.isOwner });
}
