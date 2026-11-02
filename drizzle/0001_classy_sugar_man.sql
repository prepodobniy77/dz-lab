CREATE TABLE `source_health` (
	`store` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`blocked_until` text,
	`error` text
);
