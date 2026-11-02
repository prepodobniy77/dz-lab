CREATE TABLE `builds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`selection` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` text NOT NULL,
	`store` text NOT NULL,
	`price` integer NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_offers` (
	`key` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`store` text NOT NULL,
	`data` text NOT NULL,
	`attempt_at` text NOT NULL
);
