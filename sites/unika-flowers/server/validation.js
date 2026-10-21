export const STATUSES = { new: 'Новый', confirmed: 'Подтверждён', preparing: 'Собирается', ready: 'Готов к получению', done: 'Завершён', cancelled: 'Отменён' };
export const ACTIVE_ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'ready'];
export const ARCHIVED_ORDER_STATUSES = ['done', 'cancelled'];
export const TRANSITIONS = { new: ['confirmed', 'cancelled'], confirmed: ['done', 'preparing', 'cancelled'], preparing: ['done', 'ready', 'cancelled'], ready: ['done', 'cancelled'], done: [], cancelled: ['confirmed'] };
export const ORDER_ACTION_LABELS = { confirmed: '✅ Принять заказ', done: '🏁 Завершить заказ', cancelled: '❌ Отменить заказ', preparing: '📦 Начать сборку', ready: '🌸 Готов к выдаче' };
export const AVAILABILITY = { available: 'В наличии', preorder: 'Предзаказ', soldout: 'Нет в наличии' };
export const DEFAULT_SETTINGS = { orderingOpen: true, announcement: '', delivery: 'Получение и доставку согласуем после подтверждения заявки.', payment: 'Оплату согласуем с продавцом после подтверждения наличия.' };

export function cleanText(value, max, label, required = false) {
  if (value != null && typeof value !== 'string') throw new Error(`${label}: ожидается текст.`);
  const text = (value || '').trim();
  if ((required && !text) || text.length > max) throw new Error(`${label}: ${required ? 'от 1 до' : 'до'} ${max} символов.`);
  return text;
}
export function positiveId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Некорректный идентификатор.');
  return value;
}
export function parseHeight(value) {
  const match = String(value).trim().toLowerCase().replace(/,/g, '.').match(/^(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?\s*(см|м)?$/);
  if (!match) return null;
  const unit = match[3] === 'м' ? 100 : 1;
  const min = Math.round(Number(match[1]) * unit), max = Math.round(Number(match[2] || match[1]) * unit);
  return min >= 10 && max <= 1000 && min <= max ? [min, max] : null;
}
export function validateProduct(input) {
  const value = {
    name: cleanText(input.name, 100, 'Название', true),
    shortDescription: cleanText(input.shortDescription, 300, 'Краткое описание', true),
    description: cleanText(input.description, 3000, 'Описание', true),
  };
  for (const [key, min, max] of [['heightMin', 10, 1000], ['heightMax', 10, 1000], ['bloomMin', 0, 150], ['bloomMax', 0, 150]]) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error('Проверьте размеры растения и соцветия.');
    value[key] = input[key];
  }
  if (value.heightMin > value.heightMax || value.bloomMin > value.bloomMax) throw new Error('Минимальный размер не может быть больше максимального.');
  if (input.price !== null && (!Number.isInteger(input.price) || input.price < 1 || input.price > 100_000_000)) throw new Error('Укажите целую цену в рублях или оставьте поле пустым.');
  value.price = input.price;
  if (!Object.hasOwn(AVAILABILITY, input.availability)) throw new Error('Выберите доступность товара.');
  value.availability = input.availability;
  if (typeof input.active !== 'boolean') throw new Error('Проверьте видимость товара.');
  value.active = input.active;
  if (input.photoData != null) {
    if (typeof input.photoData !== 'string' || input.photoData.length > 1_000_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.photoData)) throw new Error('Загрузите фото JPG, PNG или WebP до 750 КБ.');
    value.photoData = input.photoData;
  }
  return value;
}
export function validateContact(input = {}) {
  const contact = { name: cleanText(input.name, 100, 'Имя', true), phone: cleanText(input.phone, 30, 'Телефон'), delivery: input.delivery || 'agree', address: cleanText(input.address, 300, 'Город и адрес') };
  if (contact.phone && !/^\+?[\d\s()-]{7,30}$/.test(contact.phone)) throw new Error('Проверьте номер телефона или оставьте его пустым.');
  if (!['agree', 'pickup', 'delivery'].includes(contact.delivery)) throw new Error('Выберите способ получения.');
  if (contact.delivery === 'delivery' && !contact.address) throw new Error('Укажите город для согласования доставки.');
  return contact;
}
export function totals(items) {
  return { amount: items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0), complete: items.every(item => item.price != null), quantity: items.reduce((sum, item) => sum + item.quantity, 0) };
}
export function validateItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) throw new Error('Выберите от 1 до 30 сортов.');
  const ids = new Set();
  for (const item of items) {
    positiveId(item?.id);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 || ids.has(item.id)) throw new Error('Проверьте сорта и количество (от 1 до 100).');
    if (item.price !== null && (!Number.isInteger(item.price) || item.price < 1)) throw new Error('Обновите цены в каталоге.');
    ids.add(item.id);
  }
}
