CREATE TABLE `price_feed_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`store` text NOT NULL,
	`checked_at` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`expected` integer NOT NULL,
	`parts` integer NOT NULL,
	`next_part` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`pending_review` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `price_feed_rows` (
	`import_id` text NOT NULL,
	`product_id` text NOT NULL,
	`data` text NOT NULL,
	`price` real NOT NULL,
	`baseline_at` text NOT NULL,
	`baseline_price` real,
	`conflict` integer DEFAULT 0 NOT NULL,
	`decision` text,
	PRIMARY KEY(`import_id`, `product_id`),
	FOREIGN KEY (`import_id`) REFERENCES `price_feed_imports`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
