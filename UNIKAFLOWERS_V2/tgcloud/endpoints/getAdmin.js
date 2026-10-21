import { db, EndpointError } from 'sdk';
import { and, or, eq, desc, asc, like, inArray } from 'sdk/db';
import { orders, products, audit, customers, orderNotifications } from '../schema.js';
import { requireAdmin, isOwner } from '../lib/access.js';
import { OWNER_IDS, ADMIN_IDS } from '../lib/config.js';
import { ensureCatalog } from '../lib/catalog.js';
import { getSettings } from '../lib/settings.js';
import { STATUSES, ACTIVE_ORDER_STATUSES, ARCHIVED_ORDER_STATUSES } from '../lib/validation.js';
import { unreadNotifications, ensureNotifications } from '../lib/notifications.js';

export default async function (input, ctx) {
  const user = await requireAdmin(ctx);
  const offset = Number.isInteger(input?.offset) && input.offset >= 0 ? Math.min(input.offset, 100000) : 0;
  if (input?.action === 'counts') return { total: await db.$count(orders, inArray(orders.status, ACTIVE_ORDER_STATUSES)), unread: await unreadNotifications(user.id) };
  if (input?.action === 'products') {
    await ensureCatalog();
    const rows = await db.select().from(products).orderBy(asc(products.id)).limit(100).offset(offset).all();
    return { products: rows, hasMore: rows.length === 100 };
  }
  if (input?.action === 'orders') {
    const clauses = [inArray(orders.status, input.scope === 'archive' ? ARCHIVED_ORDER_STATUSES : ACTIVE_ORDER_STATUSES)];
    if (input.status && Object.hasOwn(STATUSES, input.status)) clauses.push(eq(orders.status, input.status));
    const query = typeof input.search === 'string' ? input.search.trim().slice(0, 100) : '';
    if (query) {
      // LIKE wildcards are not accepted as a shortcut to the entire customer database.
      const term = `%${query.replace(/[%_]/g, '')}%`;
      clauses.push(or(like(orders.customerName, term), like(orders.note, term), eq(orders.id, Number(query) || -1), eq(orders.customerId, Number(query) || -1)));
    }
    const where = clauses.length ? and(...clauses) : undefined;
    const rows = await db.select().from(orders).where(where).orderBy(desc(orders.id)).limit(20).offset(offset).all();
    await ensureNotifications(user.id);
    const receipts = await db.select().from(orderNotifications).where(and(eq(orderNotifications.adminId, user.id), inArray(orderNotifications.orderId, rows.length ? rows.map(row => row.id) : [-1]))).all();
    const read = new Set(receipts.filter(row => row.read).map(row => row.orderId));
    return { orders: rows.map(row => ({ ...row, unread: !read.has(row.id) })), hasMore: rows.length === 20, total: await db.$count(orders, where) };
  }
  if (input?.action === 'audit') return { events: await db.select().from(audit).orderBy(desc(audit.id)).limit(30).offset(offset).all() };
  if (input?.action === 'team') {
    if (!isOwner(user.id)) throw new EndpointError('Управлять командой может только владелец.', { code: 'FORBIDDEN' });
    const rows = await db.select().from(customers).where(eq(customers.isAdmin, true)).all();
    return { team: [...new Set([...OWNER_IDS, ...ADMIN_IDS, ...rows.map(row => row.telegramId)])].map(id => ({ id, owner: isOwner(id), fixed: OWNER_IDS.includes(id) || ADMIN_IDS.includes(id) })) };
  }
  if (input?.action === 'settings') return { settings: await getSettings() };
  const counts = {};
  for (const status of Object.keys(STATUSES)) counts[status] = await db.$count(orders, eq(orders.status, status));
  return { counts, unread: await unreadNotifications(user.id), products: await db.$count(products, eq(products.active, true)), customers: await db.$count(customers), isOwner: isOwner(user.id) };
}
