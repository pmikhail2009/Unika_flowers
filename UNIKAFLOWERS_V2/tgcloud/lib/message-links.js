import { db } from 'sdk';
import { eq } from 'sdk/db';
import { messageLinks } from '../schema.js';
export async function rememberMessage(chatId, messageId, customerId, orderId = null) {
  if (!Number.isInteger(messageId)) return;
  await db.insert(messageLinks).values({ key: `${chatId}:${messageId}`, chatId, messageId, customerId, orderId, createdAt: Math.floor(Date.now() / 1000) }).onConflictDoNothing({ target: messageLinks.key }).run();
}
export async function replyTarget(chatId, messageId) {
  if (!Number.isInteger(messageId)) return null;
  return db.select().from(messageLinks).where(eq(messageLinks.key, `${chatId}:${messageId}`)).get();
}
