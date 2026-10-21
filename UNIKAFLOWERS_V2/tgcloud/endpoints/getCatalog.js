import { db } from 'sdk';
import { eq, inArray } from 'sdk/db';
import { products, orders } from '../schema.js';
import { ensureCatalog, toPublicProduct } from '../lib/catalog.js';
import { getSettings } from '../lib/settings.js';
import { requireUser, isAdmin, isOwner } from '../lib/access.js';
import { ACTIVE_ORDER_STATUSES } from '../lib/validation.js';

export default async function getCatalog(input, ctx) {
  const user = requireUser(ctx);
  await ensureCatalog();
  const rows = await db.select().from(products).where(eq(products.active, true)).all();
  const admin = await isAdmin(user.id);
  return { products: rows.map(toPublicProduct), settings: await getSettings(), profile: { isAdmin: admin, isOwner: isOwner(user.id), name: user.first_name || '', orderCount: admin ? await db.$count(orders, inArray(orders.status, ACTIVE_ORDER_STATUSES)) : undefined } };
}
