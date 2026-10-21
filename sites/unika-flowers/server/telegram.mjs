import { STATUSES, TRANSITIONS } from './validation.js';

const admins = [5211227935, 1154273072];
const q = (db, sql, ...args) => db.prepare(sql).bind(...args);
export function orderCard(order) {
  const total = order.items.reduce((sum, p) => sum + (p.price || 0) * p.quantity, 0);
  return [`🌸 Заказ сайта №${order.id}`, order.source === 'telegram' ? 'Источник: Telegram Mini App' : 'Источник: сайт по ссылке',
    `Статус: ${STATUSES[order.status]}`, `Покупатель: ${order.contact.name}`, order.contact.phone && `Телефон: ${order.contact.phone}`,
    `Получение: ${{ pickup: 'Самовывоз', delivery: 'Доставка', discuss: 'Согласовать' }[order.contact.delivery] || order.contact.delivery}`,
    order.contact.address && `Адрес: ${order.contact.address}`, '', ...order.items.map(p => `${p.name} × ${p.quantity}${p.price == null ? ' · цена по запросу' : ` · ${p.price} ₽`}`),
    total ? `Известная сумма: ${total} ₽${order.items.some(p => p.price == null) ? ' + позиции по запросу' : ''}` : 'Стоимость уточнит продавец',
    order.note && `\nПожелания: ${order.note}`].filter(x => x !== false && x !== undefined).join('\n').slice(0, 3600);
}
export function orderButtons(order, staff = true) {
  const buttons = [];
  if (staff) {
    const allowed = TRANSITIONS[order.status] || [];
    for (const [status, label] of [['confirmed','Принять заказ'],['done','Завершить заказ'],['cancelled','Отменить заказ']]) {
      if (allowed.includes(status)) buttons.push([{ text: label, callback_data: `web:status:${order.id}:${order.version}:${status}` }]);
    }
  }
  buttons.push([{ text: staff ? 'Ответить покупателю' : 'Написать магазину', callback_data: `web:reply:${order.id}` }]);
  buttons.push([{ text: 'Открыть магазин', web_app: { url: 'https://app8754275738.tgcloud.ai/' } }]);
  return { inline_keyboard: buttons };
}
export async function queueTelegram(db, key, order, text, audience = 'admins') {
  const recipients = audience === 'admins' ? admins : order.telegramId ? [order.telegramId] : [];
  for (const chatId of recipients) await q(db, `INSERT OR IGNORE INTO telegram_outbox (event_key,chat_id,order_id,text,keyboard,created_at) VALUES (?,?,?,?,?,?)`,
    `${key}:${chatId}`, chatId, order.id, text.slice(0, 4000), JSON.stringify(orderButtons(order, audience === 'admins')), Math.floor(Date.now() / 1000)).run();
}
// Claimed rows survive failed sends. Each recipient has an independent retry state.
export async function flushTelegram(db, token, send = fetch) {
  if (!token) return;
  const time = Math.floor(Date.now() / 1000);
  const rows = (await q(db, 'SELECT * FROM telegram_outbox WHERE delivered=0 AND retry_at<=? ORDER BY created_at,event_key LIMIT 6', time).all()).results;
  await Promise.all(rows.map(async row => {
    const claimed = await q(db, 'UPDATE telegram_outbox SET retry_at=?,attempts=attempts+1 WHERE event_key=? AND delivered=0 AND retry_at<=? RETURNING event_key', time + 60, row.event_key, time).first();
    if (!claimed) return;
    try {
      const response = await send(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: row.chat_id, text: row.text, reply_markup: JSON.parse(row.keyboard) }), signal: AbortSignal.timeout(6000) });
      const body = await response.json();
      if (!body.ok || !Number.isSafeInteger(body.result?.message_id)) throw new Error('Telegram delivery failed');
      await db.batch([
        q(db, 'INSERT OR REPLACE INTO telegram_links (chat_id,message_id,order_id) VALUES (?,?,?)', row.chat_id, body.result.message_id, row.order_id),
        q(db, "UPDATE telegram_outbox SET delivered=1,error='' WHERE event_key=?", row.event_key),
      ]);
    } catch { await q(db, "UPDATE telegram_outbox SET error='Telegram delivery failed' WHERE event_key=?", row.event_key).run(); }
  }));
}

export async function botAction(db, input, ctx, execute) {
  if (!ctx.telegram) throw new Error('Требуется подтверждённый Telegram-аккаунт.');
  const staff = ctx.telegram.isAdmin, chatId = ctx.telegram.id;
  if (input.action === 'counts') {
    if (!staff) throw new Error('Доступно только администратору.');
    return execute(db, 'getAdmin', { action: 'counts' }, ctx);
  }
  if (input.action === 'list') {
    const data = await execute(db, staff ? 'getAdmin' : 'getMyOrders', staff ? { action: 'orders', scope: input.scope, offset: input.offset || 0 } : { offset: input.offset || 0 }, ctx);
    return { orders: data.orders.slice(0, 5).map(order => ({ id: order.id, text: orderCard(order), keyboard: orderButtons(order, staff) })), hasMore: data.orders.length > 5 || data.hasMore };
  }
  if (input.action === 'status') {
    if (!staff) throw new Error('Доступно только администратору.');
    const data = await execute(db, 'mutateAdmin', { action: 'order', id: input.id, status: input.status, version: input.version }, ctx);
    return { text: orderCard(data.order), keyboard: orderButtons(data.order) };
  }
  const link = input.replyTo ? await q(db, 'SELECT order_id FROM telegram_links WHERE chat_id=? AND message_id=?', chatId, input.replyTo).first() : null;
  if (input.action === 'reply' && !link) return { handled: false };
  const id = link?.order_id || input.id;
  // Authorize through the same order-access checks as the website.
  await execute(db, 'getMessages', { id }, ctx);
  if (input.action === 'link') {
    if (!Number.isSafeInteger(input.messageId) || input.messageId <= 0) throw new Error('Некорректное сообщение.');
    await q(db, 'INSERT OR REPLACE INTO telegram_links (chat_id,message_id,order_id) VALUES (?,?,?)', chatId, input.messageId, id).run();
    return { ok: true };
  }
  if (input.action === 'reply') {
    if (!input.text?.trim()) return { handled: true, text: 'Ответьте текстовым сообщением — оно появится в переписке заказа на сайте.' };
    await execute(db, 'sendMessage', { id, text: input.text, requestId: `telegram-${chatId}-${input.messageId}` }, ctx);
    return { handled: true, text: staff ? `✅ Ответ по заказу сайта №${id} сохранён. Покупатель увидит его в переписке заказа.` : `✅ Сообщение по заказу №${id} передано магазину.` };
  }
  if (input.action === 'prompt') return { text: `Ответ по заказу сайта №${id}. Напишите текст ответом на это сообщение. ${staff ? 'Покупатель увидит его в переписке заказа на сайте.' : 'Сообщение получит магазин в Telegram.'}` };
  throw new Error('Неизвестное действие.');
}
