import { env } from 'cloudflare:workers';
import { handleApi, handleTelegramBridge, seed } from '../../../server/shop.mjs';
export const dynamic = 'force-dynamic';
let seeded: Promise<void> | undefined;
export async function POST(request: Request) {
  const db = env.DB;
  if (!db) return Response.json({ error: { message: 'База данных не подключена.', code: 'SERVER_ERROR' } }, { status: 503 });
  try { await (seeded ??= seed(db).catch((error: unknown) => { seeded = undefined; throw error; })); }
  catch { return Response.json({ error: { message: 'База временно недоступна.', code: 'SERVER_ERROR' } }, { status: 503 }); }
  const delivery = { telegramToken: env.TELEGRAM_BOT_TOKEN };
  if (new URL(request.url).pathname.endsWith('/telegramBridge')) return handleTelegramBridge(request, db, env.TELEGRAM_BRIDGE_SECRET, delivery);
  const ownerVerified = request.headers.get('oai-authenticated-user-email')?.toLowerCase() === 'pmikhail2009@gmail.com';
  return handleApi(request, db, { ...delivery, ip: request.headers.get('cf-connecting-ip') || 'unknown', ownerVerified });
}
export async function OPTIONS(request: Request) {
  return handleApi(request, env.DB, {});
}
