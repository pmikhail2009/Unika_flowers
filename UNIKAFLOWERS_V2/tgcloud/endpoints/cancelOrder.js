import { requireUser, invalid } from '../lib/access.js';
import { positiveId } from '../lib/validation.js';
import { changeOrderStatus } from '../lib/orders.js';
export default async function (input, ctx) {
  const user = requireUser(ctx);
  try { positiveId(input?.id); if (!Number.isInteger(input.version) || input.version < 0) throw new Error('Обновите список заказов.'); } catch (error) { invalid(error); }
  const order = await changeOrderStatus({ ...input, status: 'cancelled', actorId: user.id, customerOnly: true });
  return { order };
}
