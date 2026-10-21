import { db } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';
import { DEFAULT_SETTINGS } from './validation.js';

export async function getSettings() {
  const row = await db.select().from(settings).where(eq(settings.key, 'shop')).get();
  return { ...DEFAULT_SETTINGS, ...row?.value, version: row?.version ?? 0 };
}
