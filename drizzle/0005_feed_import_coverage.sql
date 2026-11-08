ALTER TABLE `price_feed_imports` ADD `bootstrap` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `price_feed_imports` ADD `forced` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `price_feed_imports` ADD `conflicts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `price_feed_imports` ADD `recognized` integer DEFAULT 0 NOT NULL;