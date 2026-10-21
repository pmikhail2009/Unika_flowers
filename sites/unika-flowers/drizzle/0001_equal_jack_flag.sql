CREATE TABLE `telegram_links` (
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`order_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_chat_message` ON `telegram_links` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `telegram_outbox` (
	`event_key` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`order_id` integer NOT NULL,
	`text` text NOT NULL,
	`keyboard` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telegram_outbox_pending` ON `telegram_outbox` (`delivered`,`retry_at`);