import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './test-runtime.mjs';

async function configured(t, handler) {
  const app = await runtime({ fetchHandler: handler }); t.after(() => app.close());
  const { settings } = await app.load('schema.js');
  await app.db.insert(settings).values({ key: 'site-bridge', value: { secret: 'test-only', origin: 'https://unika-flowers-garden.brainy-chick-3547.chatgpt.site' } }).run();
  return app;
}
test('bot forwards verified roles and routes reply to shared website order before legacy support', async t => {
  const calls = []; const app = await configured(t, async (url, options) => {
    calls.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ result: { handled: true, text: 'Ответ сохранён' } }) };
  });
  const handler = (await app.load('handlers/message.js')).default;
  await handler({ message_id: 88, chat: { id: 5211227935, type: 'private' }, from: { id: 5211227935 }, text: 'Ответ покупателю', reply_to_message: { message_id: 77 } });
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'bot'); assert.equal(calls[0].input.replyTo, 77); assert.equal(calls[0].telegram.isOwner, true);
  assert.ok(app.messages.some(m => m.params.text === 'Ответ сохранён')); assert.ok(!app.messages.some(m => m.method === 'copyMessage'));
});
test('shared callback prompts reply and stores Telegram message mapping', async t => {
  const calls = []; const app = await configured(t, async (url, options) => {
    const payload = JSON.parse(options.body); calls.push(payload);
    return { ok: true, json: async () => ({ result: payload.input.action === 'prompt' ? { text: 'Ответ по заказу' } : { ok: true } }) };
  });
  const callback = (await app.load('handlers/callback_query.js')).default;
  await callback({ id: 'callback', data: 'web:reply:7', from: { id: 1154273072 }, message: { chat: { id: 1154273072, type: 'private' } } });
  assert.equal(calls[0].input.action, 'prompt'); assert.equal(calls[1].input.action, 'link'); assert.equal(calls[1].input.id, 7); assert.ok(calls[1].input.messageId);
  assert.ok(app.messages.find(m => m.params.reply_markup?.force_reply));
});
