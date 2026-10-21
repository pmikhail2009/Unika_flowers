CREATE TABLE `order_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`guest_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_access_unique` ON `order_access` (`order_id`,`guest_key`);--> statement-breakpoint
CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`sender` text NOT NULL,
	`sender_name` text NOT NULL,
	`text` text NOT NULL,
	`request_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_request_key_unique` ON `messages` (`request_key`);--> statement-breakpoint
CREATE INDEX `messages_order_id` ON `messages` (`order_id`,`id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guest_key` text NOT NULL,
	`ip_hash` text NOT NULL,
	`request_key` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`unread` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_request_key_unique` ON `orders` (`request_key`);--> statement-breakpoint
CREATE INDEX `orders_guest_created` ON `orders` (`guest_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_ip_created` ON `orders` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_status_id` ON `orders` (`status`,`id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`request_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_request_key_unique` ON `products` (`request_key`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`staff_id` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_staff` ON `sessions` (`staff_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_username_unique` ON `staff` (`username`);