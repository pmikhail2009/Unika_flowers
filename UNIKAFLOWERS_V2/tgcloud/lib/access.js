import { db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { customers, audit } from '../schema.js';
import { OWNER_IDS, ADMIN_IDS } from './config.js';

export const isOwner = id => OWNER_IDS.includes(id);
export function requireUser(ctx) {
  const user = ctx?.initData?.user;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new EndpointError('Откройте магазин через бота в Telegram.', { code: 'AUTH_REQUIRED' });
  return user;
}
export async function isAdmin(id) {
  if (isOwner(id) || ADMIN_IDS.includes(id)) return true;
  const customer = await db.select().from(customers).where(eq(customers.telegramId, id)).get();
  return !!customer?.isAdmin;
}
export async function requireAdmin(ctx, ownerOnly = false) {
  const user = requireUser(ctx);
  if (ownerOnly ? !isOwner(user.id) : !(await isAdmin(user.id))) throw new EndpointError('Доступно только администратору магазина.', { code: 'FORBIDDEN' });
  return user;
}
export async function logAction(actorId, action, target) {
  await db.insert(audit).values({ actorId, action, target: String(target), createdAt: Math.floor(Date.now() / 1000) }).run();
}
export function invalid(error) { throw new EndpointError(error.message, { code: 'VALIDATION' }); }
export async function adminIds() {
  const admins = await db.select().from(customers).where(eq(customers.isAdmin, true)).all();
  return [...new Set([...OWNER_IDS, ...ADMIN_IDS, ...admins.map(admin => admin.telegramId)])];
}
