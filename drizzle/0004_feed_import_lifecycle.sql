ALTER TABLE `price_feed_imports` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `price_feed_imports` ADD `rows_written` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE price_feed_imports SET status='abandoned', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE status='open' AND id NOT IN (
  SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY store ORDER BY started_at DESC,id DESC) AS position
    FROM price_feed_imports WHERE status='open') WHERE position=1
);--> statement-breakpoint
DELETE FROM price_feed_rows WHERE import_id IN (SELECT id FROM price_feed_imports WHERE status='abandoned');--> statement-breakpoint
CREATE UNIQUE INDEX `price_feed_active_store` ON `price_feed_imports` (`store`) WHERE status IN ('open','publishing');
