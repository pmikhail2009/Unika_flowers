import { requireUser } from '../lib/access.js';
import { myOrders } from '../lib/orders.js';
export default async function (input, ctx) {
  const user = requireUser(ctx);
  const offset = Number.isInteger(input?.offset) && input.offset >= 0 ? Math.min(input.offset, 100000) : 0;
  const orders = await myOrders(user.id, offset);
  return { orders: orders.map(({ requestKey, history, ...order }) => ({ ...order, history: (history || []).map(({ status, at }) => ({ status, at })) })), hasMore: orders.length === 10 };
}
