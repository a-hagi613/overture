CREATE TABLE `workable_ingests` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_key` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`source_last_modified` text,
	`rows` integer NOT NULL,
	`content_hash` text NOT NULL,
	`added` integer NOT NULL,
	`updated` integer NOT NULL,
	`closed` integer NOT NULL,
	`ingested_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workable_ingests_snapshot_unique` ON `workable_ingests` (`snapshot_key`);--> statement-breakpoint
CREATE INDEX `workable_ingests_ingested_at` ON `workable_ingests` (`ingested_at`);--> statement-breakpoint
CREATE INDEX `postings_ats_closed_last_seen` ON `postings` (`ats`,`closed_at`,`last_seen_at`);--> statement-breakpoint
INSERT INTO `kill_switches` (`scope`, `key`, `enabled`, `reason`, `set_by`, `set_at`)
VALUES ('ats', 'workable', 1, 'Workable waits for its 20-form probe (#235)', 'owner', 1795263000000)
ON CONFLICT (`scope`, `key`) DO NOTHING;
