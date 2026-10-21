import { db, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { products, customers, orders, settings } from '../schema.js';
import { requireAdmin, invalid, logAction } from '../lib/access.js';
import { OWNER_IDS, ADMIN_IDS } from '../lib/config.js';
import { cleanText, positiveId, validateProduct, DEFAULT_SETTINGS } from '../lib/validation.js';
import { changeOrderStatus } from '../lib/orders.js';
import { markNotificationRead } from '../lib/notifications.js';

function conflict() { throw new EndpointError('Данные уже изменены другим администратором. Обновите страницу.', { code: 'CONFLICT' }); }
export default async function (input, ctx) {
  const user = await requireAdmin(ctx, input?.action === 'team');
  if (input?.action === 'product') {
    let value;
    try {
      value = validateProduct(input.product || {});
      if (input.product.id != null) positiveId(input.product.id);
    } catch (error) { invalid(error); }
    let row;
    const id = input.product.id;
    const now = Math.floor(Date.now() / 1000);
    if (id) {
      if (!Number.isInteger(input.product.version) || input.product.version < 0) conflict();
      [row] = await db.update(products).set({ ...value, updatedAt: now, version: input.product.version + 1 }).where(and(eq(products.id, id), eq(products.version, input.product.version))).returning().run();
      if (!row) conflict();
    } else {
      if (!value.photoData) throw new EndpointError('Добавьте фотографию товара.', { code: 'PHOTO_REQUIRED' });
      [row] = await db.insert(products).values({ ...value, updatedAt: now }).returning().run();
    }
    await logAction(user.id, id ? 'product:update' : 'product:create', row.id);
    return { product: row };
  }
  if (input?.action === 'order') {
    try { positiveId(input.id); } catch (error) { invalid(error); }
    const order = await changeOrderStatus({ id: input.id, status: input.status, version: input.version, actorId: user.id });
    await markNotificationRead(user.id, input.id);
    await logAction(user.id, `order:${input.status}`, input.id);
    return { order };
  }
  if (input?.action === 'read') {
    try { positiveId(input.id); } catch (error) { invalid(error); }
    await markNotificationRead(user.id, input.id);
    return { ok: true };
  }
  if (input?.action === 'settings') {
    let value;
    try {
      if (typeof input.settings?.orderingOpen !== 'boolean') throw new Error('Проверьте режим приёма заявок.');
      value = { orderingOpen: input.settings.orderingOpen, announcement: cleanText(input.settings.announcement, 200, 'Объявление'), delivery: cleanText(input.settings.delivery, 1000, 'Получение', true), payment: cleanText(input.settings.payment, 1000, 'Оплата', true) };
    } catch (error) { invalid(error); }
    if (!Number.isInteger(input.settings.version) || input.settings.version < 0) conflict();
    await db.insert(settings).values({ key: 'shop', value: DEFAULT_SETTINGS }).onConflictDoNothing({ target: settings.key }).run();
    const rows = await db.update(settings).set({ value, version: input.settings.version + 1 }).where(and(eq(settings.key, 'shop'), eq(settings.version, input.settings.version))).returning().run();
    if (!rows.length) conflict();
    await logAction(user.id, 'settings:update', 'shop');
    return { settings: { ...rows[0].value, version: rows[0].version } };
  }
  if (input?.action === 'team') {
    try { positiveId(input.id); if (typeof input.grant !== 'boolean') throw new Error('Выберите действие с доступом.'); } catch (error) { invalid(error); }
    if (OWNER_IDS.includes(input.id) || ADMIN_IDS.includes(input.id)) throw new EndpointError('Этот аккаунт закреплён в конфигурации магазина.', { code: 'FIXED_ROLE' });
    await db.insert(customers).values({ telegramId: input.id, isAdmin: input.grant }).onConflictDoUpdate({ target: customers.telegramId, set: { isAdmin: input.grant, adminStep: null, draft: null, awaitingOrder: false } }).run();
    await logAction(user.id, input.grant ? 'team:grant' : 'team:revoke', input.id);
    return { ok: true };
  }
  throw new EndpointError('Неизвестное действие.', { code: 'INVALID_ACTION' });
}
