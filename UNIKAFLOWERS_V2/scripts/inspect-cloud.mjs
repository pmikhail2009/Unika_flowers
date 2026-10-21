import { resolveToken } from '../node_modules/@tgcloud/cli/src/core/credentials.js';
import { runFunction } from '../node_modules/@tgcloud/cli/src/api/endpoints.js';
const source = `import { db, api } from 'sdk';
export default async function () {
 const orders = await db.all('SELECT id, customer_id, status, unread, created_at FROM orders ORDER BY id DESC LIMIT 30');
 const admins = [];
 for (const id of [5211227935,1154273072]) {
   try { const chat = await api.getChat({chat_id:id}); admins.push({id,type:chat.type,reachable:true}); }
   catch(error) { admins.push({id,reachable:false,code:error.code,description:error.description||error.message}); }
 }
 return {orders,admins,customers:await db.all('SELECT telegram_id, is_admin, menu FROM customers')};
}`;
const result = await runFunction(await resolveToken(), 'endpoints/inspect', {'endpoints/inspect':source}, {}, {});
console.log(JSON.stringify(result.result, null, 2));
