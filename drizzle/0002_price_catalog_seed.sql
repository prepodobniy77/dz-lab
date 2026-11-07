ALTER TABLE `price_offers` ADD `is_seed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `price_offers_live` ON `price_offers` (`is_seed`) WHERE is_seed = 0;
--> statement-breakpoint
CREATE TRIGGER price_offers_promote_observation
AFTER UPDATE OF attempt_at ON price_offers
WHEN OLD.is_seed = 1 AND NEW.attempt_at > OLD.attempt_at
BEGIN
  UPDATE price_offers SET is_seed = 0 WHERE key = NEW.key;
END;
