import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.mjs';
import { orderActions } from '../tgcloud/lib/order-view.js';

test('order card actions are explicit for each status and include restoration for a cancelled order', () => {
  const labels = status => orderActions({id:1,version:2,status}).inline_keyboard.flat().map(button=>button.text);
  assert.ok(labels('new').includes('✅ Принять заказ'));
  assert.ok(labels('new').includes('❌ Отменить заказ'));
  for (const status of ['confirmed','preparing','ready']) {
    assert.ok(labels(status).includes('🏁 Завершить заказ'));
    assert.ok(labels(status).includes('❌ Отменить заказ'));
  }
  assert.ok(labels('cancelled').includes('↩️ Принять заново'));
  assert.ok(!labels('done').includes('❌ Отменить заказ'));
});
test('admin can finish an accepted order directly and restore an order without losing its history', async () => {
  const app=await runtime();
  try {
    await app.endpoint('getCatalog',{},100);
    const input={requestId:'actions_00001',items:[{id:1,quantity:1,price:null}],contact:{name:'Анна',delivery:'pickup'},note:''};
    const {orderId}=await app.endpoint('placeOrder',input,100);
    const mutate=(status,version)=>app.endpoint('mutateAdmin',{action:'order',id:orderId,status,version},5211227935);
    await mutate('cancelled',0);
    await assert.rejects(app.endpoint('cancelOrder',{id:orderId,version:1},100));
    await mutate('confirmed',1);
    const result=await mutate('done',2);
    assert.equal(result.order.status,'done');
    assert.deepEqual(Array.from(result.order.history,event=>event.status),['new','cancelled','confirmed','done']);
    await assert.rejects(mutate('cancelled',2),error=>error.parameters?.code==='CONFLICT');
  } finally {app.close();}
});

test('active orders, archive, filters and counters stay consistent across cancellation, restoration and completion', async () => {
  const app=await runtime();
  const owner=5211227935, admin=1154273072;
  try {
    await app.endpoint('getCatalog',{},100);
    const ids=[];
    for (const [index,status] of ['new','confirmed','preparing','ready','done','cancelled'].entries()) {
      const {orderId}=await app.endpoint('placeOrder',{requestId:`archive_${index}_0001`,items:[{id:1,quantity:1,price:null}],contact:{name:'Анна',delivery:'pickup'},note:''},100);
      app.sqlite.prepare('UPDATE orders SET status = ?, created_at = 1 WHERE id = ?').run(status,orderId); ids.push(orderId);
    }
    for (const id of [owner,admin]) {
      const active=await app.endpoint('getAdmin',{action:'orders'},id);
      assert.equal(active.total,4); assert.deepEqual(Array.from(active.orders,o=>o.id),ids.slice(0,4).reverse());
      const archive=await app.endpoint('getAdmin',{action:'orders',scope:'archive'},id);
      assert.equal(archive.total,2); assert.deepEqual(Array.from(archive.orders,o=>o.id),ids.slice(4).reverse());
      assert.equal((await app.endpoint('getAdmin',{action:'orders',status:'done'},id)).total,0);
      assert.equal((await app.endpoint('getAdmin',{action:'orders',scope:'archive',status:'done'},id)).total,1);
      assert.equal((await app.endpoint('getAdmin',{action:'orders',search:String(ids[4])},id)).total,0);
      assert.equal((await app.endpoint('getAdmin',{action:'counts'},id)).total,4);
      assert.equal((await app.endpoint('getCatalog',{},id)).profile.orderCount,4);
    }
    const callback=(await app.load('handlers/callback_query.js')).default;
    app.messages.length=0;
    await callback({id:'complete',message:{chat:{id:owner,type:'private'}},from:{id:owner},data:`admin:apply:${ids[1]}:0:done`});
    assert.ok(!app.messages.some(m=>m.params?.text?.includes('ID 100')&&m.params.text.includes(`Заказ №${ids[1]}`)));
    for (const id of [owner,admin]) assert.ok(app.messages.some(m=>m.params?.chat_id===id&&m.params.reply_markup?.keyboard?.[0][0].text==='📦 Заказы (3)'));
    await app.endpoint('cancelOrder',{id:ids[0],version:0},100);
    assert.equal((await app.endpoint('getAdmin',{action:'counts'},owner)).total,2);
    await app.endpoint('mutateAdmin',{action:'order',id:ids[0],version:1,status:'confirmed'},admin);
    assert.equal((await app.endpoint('getAdmin',{action:'counts'},owner)).total,3);
    assert.equal((await app.endpoint('getAdmin',{action:'orders',scope:'archive'},owner)).total,3);
    assert.equal((await app.endpoint('getMyOrders',{},100)).orders.length,6);
    assert.equal(app.sqlite.prepare('SELECT count(*) n FROM orders').get().n,6);
    app.messages.length=0;
    await callback({id:'legacy',message:{chat:{id:owner,type:'private'}},from:{id:owner},data:'admin:all:0'});
    assert.ok(!app.messages.some(m=>m.params?.text?.includes('Заказ завершён.')||m.params?.text?.includes('Заказ отменён.')));
  } finally {app.close();}
});
