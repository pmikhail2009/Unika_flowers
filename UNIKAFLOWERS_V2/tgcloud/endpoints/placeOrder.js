import { api, db, EndpointError } from 'sdk';
import { and, eq, gt } from 'sdk/db';
import { customers, products, orders } from '../schema.js';
import { ensureCatalog } from '../lib/catalog.js';
import { createOrder, formatOrder } from '../lib/orders.js';
import { requireUser, invalid } from '../lib/access.js';
import { cleanText, validateContact, validateItems } from '../lib/validation.js';
import { getSettings } from '../lib/settings.js';

export default async function placeOrder(input, ctx) {
  const user = requireUser(ctx);
  let note, contact, requestId;
  try {
    requestId = cleanText(input?.requestId, 100, 'Номер заявки', true);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error('Обновите страницу перед отправкой заказа.');
    validateItems(input.items);
    note = cleanText(input.note, 1000, 'Пожелания');
    contact = validateContact(input.contact);
  } catch (error) { invalid(error); }
  const existing = await db.select().from(orders).where(eq(orders.requestKey, `${user.id}:site:${requestId}`)).get();
  if (existing) return { orderId: existing.id, summary: formatOrder(existing) };
  if (!(await getSettings()).orderingOpen) throw new EndpointError('Приём заявок временно приостановлен. Напишите продавцу.', { code: 'SHOP_CLOSED' });
  if (await db.$count(orders, and(eq(orders.customerId, user.id), gt(orders.createdAt, Math.floor(Date.now() / 1000) - 60))) >= 3) throw new EndpointError('Вы уже отправили несколько заявок. Подождите минуту.', { code: 'RATE_LIMIT' });
  await ensureCatalog();
  const items = [];
  for (const request of input.items) {
    const product = await db.select().from(products).where(eq(products.id, request.id)).get();
    if (!product?.active || product.availability === 'soldout') throw new EndpointError('Один из сортов больше не доступен. Обновите каталог.', { code: 'PRODUCT_UNAVAILABLE' });
    if ((product.price ?? null) !== request.price) throw new EndpointError('Стоимость изменилась. Обновите каталог и проверьте сумму.', { code: 'PRICE_CHANGED' });
    items.push({ id: product.id, name: product.name, quantity: request.quantity, price: product.price, availability: product.availability });
  }
  await db.insert(customers).values({ telegramId: user.id, awaitingOrder: false })
    .onConflictDoUpdate({ target: customers.telegramId, set: { awaitingOrder: false } }).run();
  const order = await createOrder({ userId: user.id, customerName: user.first_name || user.username || 'Покупатель', items, note, contact, source: 'site', requestKey: `site:${requestId}` });
  if (!order.replayed) {
    try { await api.sendMessage({ chat_id: user.id, text: `✅ Заявка сохранена. Наличие и итоговую стоимость подтвердит продавец.\n\n${formatOrder(order)}`.slice(0, 4000) }); } catch { console.warn('Customer confirmation was not delivered', order.id); }
  }
  return { orderId: order.id, summary: formatOrder(order) };
}
