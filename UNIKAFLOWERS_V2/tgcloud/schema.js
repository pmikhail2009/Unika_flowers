import { table, integer, text, boolean, json, index, uniqueIndex } from 'sdk/db';

export const customers = table('customers', {
  telegramId: integer('telegram_id').primaryKey(),
  isAdmin: boolean('is_admin').notNull().default(false),
  awaitingOrder: boolean('awaiting_order').notNull().default(false),
  orderText: text('order_text'),
  adminStep: text('admin_step'),
  draft: json('draft'),
  menu: text('menu').notNull().default('home'),
  lastSellerAt: integer('last_seller_at').notNull().default(0),
});

export const products = table('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  shortDescription: text('short_description').notNull(),
  description: text('description').notNull(),
  heightMin: integer('height_min').notNull(),
  heightMax: integer('height_max').notNull(),
  bloomMin: integer('bloom_min').notNull().default(0),
  bloomMax: integer('bloom_max').notNull().default(0),
  image: text('image'),
  photoFileId: text('photo_file_id'),
  photoData: text('photo_data'),
  price: integer('price'),
  active: boolean('active').notNull().default(true),
  availability: text('availability').notNull().default('available'),
  version: integer('version').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0),
});

export const orders = table('orders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull(),
  customerName: text('customer_name').notNull(),
  items: json('items').notNull(),
  note: text('note').notNull().default(''),
  source: text('source').notNull(),
  status: text('status').notNull().default('new'),
  unread: boolean('unread').notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull().default(0),
  version: integer('version').notNull().default(0),
  requestKey: text('request_key'),
  contact: json('contact'),
  history: json('history').notNull().default([]),
}, (t) => ({
  customerIndex: index('orders_customer_id').on(t.customerId, t.id),
  statusIndex: index('orders_status_id').on(t.status, t.id),
  requestIndex: uniqueIndex('orders_request_key').on(t.requestKey),
}));

export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: json('value').notNull(),
  version: integer('version').notNull().default(0),
});

export const audit = table('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorId: integer('actor_id').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const orderNotifications = table('order_notifications', {
  key: text('key').primaryKey(),
  adminId: integer('admin_id').notNull(),
  orderId: integer('order_id').notNull(),
  delivered: boolean('delivered').notNull().default(false),
  read: boolean('read').notNull().default(false),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at').notNull().default(0),
  error: text('error').notNull().default(''),
  createdAt: integer('created_at').notNull(),
}, t => ({ recipientIndex: index('notifications_admin_order').on(t.adminId, t.orderId) }));

export const messageLinks = table('message_links', {
  key: text('key').primaryKey(),
  chatId: integer('chat_id').notNull(),
  messageId: integer('message_id').notNull(),
  customerId: integer('customer_id').notNull(),
  orderId: integer('order_id'),
  createdAt: integer('created_at').notNull(),
});

export const conversations = table('conversations', {
  customerId: integer('customer_id').primaryKey(),
  customerName: text('customer_name').notNull(),
  unread: boolean('unread').notNull().default(true),
  updatedAt: integer('updated_at').notNull(),
  preview: text('preview').notNull(),
});

export const supportMessages = table('support_messages', {
  key: text('key').primaryKey(),
  customerId: integer('customer_id').notNull(),
  orderId: integer('order_id'),
  direction: text('direction').notNull(),
  sourceChatId: integer('source_chat_id').notNull(),
  sourceMessageId: integer('source_message_id').notNull(),
  deliveredTo: json('delivered_to').notNull().default([]),
  errors: json('errors').notNull().default({}),
  createdAt: integer('created_at').notNull(),
}, t => ({ conversationIndex: index('support_customer_created').on(t.customerId, t.createdAt) }));
