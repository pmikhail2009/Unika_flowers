import { db, fetch, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';
import { requireUser, isAdmin, isOwner } from '../lib/access.js';

const actions = ['getCatalog','placeOrder','getMyOrders','cancelOrder','getAdmin','mutateAdmin','getMessages','sendMessage','recoverOrder','renewOrderAccess','setupOwner','login','logout','changePassword'];
export default async function siteBridge(input, ctx) {
  const user = requireUser(ctx);
  if (!actions.includes(input?.action)) throw new EndpointError('Неизвестное действие магазина.', { code: 'INVALID_ACTION' });
  const config = (await db.select().from(settings).where(eq(settings.key, 'site-bridge')).get())?.value;
  if (!config?.secret || config.origin !== 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site') throw new EndpointError('Соединение с магазином ещё настраивается.', { code: 'SERVER_ERROR' });
  const response = await fetch(`${config.origin}/api/telegramBridge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unica-Bridge': config.secret },
    body: JSON.stringify({ action: input.action, input: input.input || {}, guestToken: input.guestToken, staffToken: input.staffToken,
      telegram: { id: user.id, name: user.first_name || user.username || '', isAdmin: await isAdmin(user.id), isOwner: isOwner(user.id) } }),
  });
  let data; try { data = await response.json(); } catch { throw new EndpointError('Магазин временно недоступен. Повторите чуть позже.', { code: 'SERVER_ERROR' }); }
  if (!response.ok || data.error) throw new EndpointError(data.error?.message || 'Магазин временно недоступен.', { code: data.error?.code || 'SERVER_ERROR' });
  return data;
}
