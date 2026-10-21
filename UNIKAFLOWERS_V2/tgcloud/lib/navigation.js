import { db } from 'sdk';
import { eq, inArray } from 'sdk/db';
import { orders, conversations } from '../schema.js';
import { homeKeyboard } from './shop.js';
import { unreadNotifications } from './notifications.js';
import { ACTIVE_ORDER_STATUSES } from './validation.js';
import { sharedCall } from './shared-shop.js';
export async function mainKeyboard(userId, isAdmin) {
  if (!isAdmin) return homeKeyboard(false);
  let sharedCount = 0;
  try { sharedCount = (await sharedCall({ id: userId }, { action: 'counts' }))?.total || 0; } catch { /* Legacy menu stays usable during a site outage. */ }
  return homeKeyboard(true, sharedCount + await db.$count(orders, inArray(orders.status, ACTIVE_ORDER_STATUSES)), await unreadNotifications(userId), await db.$count(conversations, eq(conversations.unread, true)));
}
