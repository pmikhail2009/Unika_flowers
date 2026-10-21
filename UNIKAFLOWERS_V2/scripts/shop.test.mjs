import test from 'node:test';
import assert from 'node:assert/strict';
import { homeKeyboard, orderKeyboard, orderSummary, adminKeyboard, draftKeyboard } from '../tgcloud/lib/shop.js';

test('customer navigation exposes help and all order actions', () => {
  assert.deepEqual(homeKeyboard().keyboard[0].map((button) => button.text), ['🛒 Заказ', '❓ /help']);
  assert.equal(homeKeyboard(true, 8, 2).keyboard[0][0].text, '📦 Заказы (8)');
  assert.ok(!homeKeyboard(true).keyboard.flat().some(button => button.text === '📦 Мои заказы'));
  const buttons = orderKeyboard().inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.text), ['🌸 Открыть каталог', '📝 Оформить заказ', '📦 Мой заказ', '📞 Вызов продавца', '✉️ Написать магазину', '⬅️ Назад']);
  assert.ok(buttons[0].web_app.url.startsWith('https://'));
  assert.deepEqual(buttons.slice(1).map((button) => button.callback_data), ['order:new', 'order:mine', 'order:seller', 'support:write', 'order:back']);
});

test('admin navigation and product confirmation include required actions', () => {
  const actions = adminKeyboard(3, 5).inline_keyboard.flat();
  assert.equal(actions.find(button => button.callback_data === 'admin:notifications').text, '🔔 Уведомления (3)');
  assert.equal(actions.find(button => button.callback_data === 'admin:orders').text, '📦 Текущие заказы (5)');
  assert.deepEqual(draftKeyboard().inline_keyboard.flat().map((button) => button.callback_data), ['admin:draft:save', 'admin:draft:edit', 'admin:draft:delete']);
});

test('my order shows the saved request and an empty state', () => {
  assert.match(orderSummary('Limelight — 2 шт.'), /Limelight — 2 шт./);
  assert.match(orderSummary(null), /пока нет заказа/);
});
