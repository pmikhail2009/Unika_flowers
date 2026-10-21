import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.mjs';
const OWNER = 5211227935, ADMIN = 1154273072;
const payload = id => ({ requestId: `request_${id || '00001'}`, items: [{id:1,quantity:1,price:null}], contact:{name:'Анна',delivery:'pickup'}, note:'' });
const message = (id, messageId, text, replyId) => ({ chat:{id,type:'private'},from:{id,first_name:`Клиент ${id}`},message_id:messageId,text,...(replyId ? {reply_to_message:{message_id:replyId}} : {}) });
async function fixture(work, options) { const app=await runtime(options); try { await app.endpoint('getCatalog',{},100); await work(app); } finally { app.close(); } }

test('order notification delivery failures are durable and retryable without user-profile links', () => {
  let fail = true;
  return fixture(async app => {
    await app.endpoint('placeOrder',payload());
    let record=app.sqlite.prepare('SELECT * FROM order_notifications WHERE admin_id = ?').get(ADMIN);
    assert.equal(record.delivered,0); assert.match(record.error,/blocked/);
    assert.equal(app.sqlite.prepare('SELECT delivered FROM order_notifications WHERE admin_id = ?').get(OWNER).delivered,1);
    fail=false; app.sqlite.prepare('UPDATE order_notifications SET last_attempt_at = 0 WHERE admin_id = ?').run(ADMIN);
    await (await app.load('lib/notifications.js')).retryNotifications(ADMIN);
    record=app.sqlite.prepare('SELECT * FROM order_notifications WHERE admin_id = ?').get(ADMIN);
    assert.equal(record.delivered,1); assert.equal(record.attempts,2); assert.equal(record.error,'');
    const outgoing=app.messages.filter(m=>m.method==='sendMessage'&&m.params.chat_id===ADMIN);
    assert.ok(outgoing.every(m=>!JSON.stringify(m.params).includes('tg://user')));
    assert.ok(outgoing.some(m=>m.params.reply_markup?.keyboard?.[0][0].text==='📦 Заказы (1)'));
    const buttons=outgoing.at(-1).params.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button=>button.text==='✅ Принять заказ'));
    assert.ok(buttons.some(button=>button.text==='❌ Отменить заказ'));
  }, {apiHandler(method,params){ if(fail&&method==='sendMessage'&&params.chat_id===ADMIN)throw Object.assign(new Error('bot was blocked'),{code:403}); }});
});
test('read state belongs to each admin; cancelled orders leave the main list and remain in the archive', () => fixture(async app => {
  const order=await app.endpoint('placeOrder',payload());
  await app.endpoint('mutateAdmin',{action:'read',id:order.orderId},OWNER);
  const notification=(await app.load('lib/notifications.js'));
  assert.equal(await notification.unreadNotifications(OWNER),0); assert.equal(await notification.unreadNotifications(ADMIN),1);
  await app.endpoint('cancelOrder',{id:order.orderId,version:0},100);
  const handler=(await app.load('handlers/message.js')).default;
  await handler(message(OWNER,300,'/start'));
  const keyboard=app.messages.findLast(m=>m.params?.text?.startsWith('Здравствуйте'))?.params.reply_markup.keyboard;
  assert.equal(keyboard[0][0].text,'📦 Заказы (0)');
  app.messages.length=0;
  await handler(message(OWNER,301,'📦 Заказы (1)'));
  assert.ok(!app.messages.some(m=>m.params?.text?.includes('Заказ №1')));
  assert.ok(app.messages.some(m=>m.params?.reply_markup?.inline_keyboard?.flat().some(b=>b.callback_data==='admin:archive:0')));
  const callback=(await app.load('handlers/callback_query.js')).default;
  await callback({id:'archive',message:{chat:{id:OWNER,type:'private'}},from:{id:OWNER},data:'admin:archive:0'});
  assert.ok(app.messages.some(m=>m.params?.text?.includes('Заказ №1')&&m.params.text.includes('Отменён')));
}));
test('customer text is copied to both admins; native replies return from the bot to the right buyer', () => fixture(async app => {
  const handler=(await app.load('handlers/message.js')).default;
  await handler(message(100,10,'Первый вопрос'));
  await handler(message(101,11,'Второй вопрос'));
  const copies=app.messages.filter(m=>m.method==='copyMessage');
  assert.equal(copies.length,4);
  const link=app.sqlite.prepare('SELECT message_id FROM message_links WHERE chat_id = ? AND customer_id = ? ORDER BY message_id DESC LIMIT 1').get(OWNER,100);
  app.messages.length=0;
  await handler(message(OWNER,20,'Ответ первому',link.message_id));
  const reply=app.messages.find(m=>m.method==='copyMessage');
  assert.equal(reply.params.chat_id,100); assert.equal(reply.params.from_chat_id,OWNER); assert.equal(reply.params.message_id,20);
  assert.ok(!app.messages.some(m=>m.method==='copyMessage'&&m.params.chat_id===101));
  const customerLink=app.sqlite.prepare('SELECT message_id FROM message_links WHERE chat_id = 100 ORDER BY message_id DESC LIMIT 1').get();
  app.messages.length=0;
  await handler(message(100,21,'Спасибо, ещё вопрос',customerLink.message_id));
  assert.equal(app.messages.filter(m=>m.method==='copyMessage'&&[OWNER,ADMIN].includes(m.params.chat_id)).length,2);
}));
test('reply button creates a ForceReply target; unaddressed admin notes are not sent to a buyer', () => fixture(async app => {
  const {orderId}=await app.endpoint('placeOrder',payload());
  const callback=(await app.load('handlers/callback_query.js')).default;
  await callback({id:'callback',message:{chat:{id:ADMIN,type:'private'}},from:{id:ADMIN},data:`chat:order:${orderId}`});
  const prompt=app.messages.findLast(m=>m.params?.reply_markup?.force_reply); assert.ok(prompt);
  const link=app.sqlite.prepare('SELECT * FROM message_links WHERE chat_id = ? ORDER BY message_id DESC LIMIT 1').get(ADMIN); assert.equal(link.customer_id,100);
  const handler=(await app.load('handlers/message.js')).default;
  app.messages.length=0; await handler(message(ADMIN,30,'Моя заметка без адресата'));
  assert.ok(!app.messages.some(m=>m.method==='copyMessage'));
  await handler({...message(ADMIN,31,undefined,link.message_id),voice:{file_id:'voice-file'}});
  assert.equal(app.messages.findLast(m=>m.method==='copyMessage').params.chat_id,100);
}));
test('a customer cannot forge a relay target or trigger admin reply buttons', () => fixture(async app => {
  const {orderId}=await app.endpoint('placeOrder',payload());
  const callback=(await app.load('handlers/callback_query.js')).default;
  app.messages.length=0;
  await callback({id:'forged',message:{chat:{id:101,type:'private'}},from:{id:101},data:`chat:order:${orderId}`});
  assert.ok(!app.messages.some(m=>m.params?.reply_markup?.force_reply));
  const handler=(await app.load('handlers/message.js')).default;
  await handler(message(101,33,'Чужой ответ',1001));
  assert.ok(!app.messages.some(m=>m.method==='copyMessage'&&m.params.chat_id===100));
}));
test('photos and voice are relayed and repeated inbound updates do not duplicate the copied content', () => fixture(async app => {
  const handler=(await app.load('handlers/message.js')).default;
  const photo={...message(100,40,undefined),photo:[{file_id:'photo-file'}],caption:'Фото для заказа'};
  await handler(photo); await handler(photo);
  assert.equal(app.messages.filter(m=>m.method==='copyMessage').length,2);
  await handler({...message(100,41,undefined),voice:{file_id:'voice'}});
  assert.equal(app.messages.filter(m=>m.method==='copyMessage').length,4);
  assert.equal(app.sqlite.prepare('SELECT count(*) n FROM support_messages').get().n,2);
}));
test('a failed inbound notification remains available in the inbox', () => fixture(async app => {
  const handler=(await app.load('handlers/message.js')).default;
  await handler(message(100,50,'Вопрос, который надо сохранить'));
  assert.equal(app.sqlite.prepare('SELECT unread FROM conversations WHERE customer_id=100').get().unread,1);
  const row=app.sqlite.prepare('SELECT errors FROM support_messages').get(); assert.match(row.errors,/недоступен/);
  assert.ok(app.messages.some(m=>m.params?.chat_id===100&&m.params?.text?.includes('сохранено')));
}, {apiHandler(method,params){if(method==='copyMessage'&&[OWNER,ADMIN].includes(params.chat_id))throw new Error('Telegram недоступен');}}));
