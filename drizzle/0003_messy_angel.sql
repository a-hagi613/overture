PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_postings` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`company_id` text NOT NULL,
	`ats` text NOT NULL,
	`ats_job_id` text NOT NULL,
	`url` text NOT NULL,
	`apply_url_norm` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`department` text,
	`location_raw` text,
	`country_code` text,
	`region` text,
	`city` text,
	`language` text,
	`workplace` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text DEFAULT 'unknown' NOT NULL,
	`posted_at` integer,
	`salary_min_minor` integer,
	`salary_max_minor` integer,
	`salary_currency` text,
	`salary_period` text,
	`source_updated_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`missing_polls` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`dedupe_key` text NOT NULL,
	`description_gz` blob,
	`description_hash` text,
	`tag_source` text,
	`tagged_at` integer,
	`questions_fetched_at` integer,
	FOREIGN KEY (`board_id`) REFERENCES `company_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_postings`("id", "board_id", "company_id", "ats", "ats_job_id", "url", "apply_url_norm", "title", "title_norm", "department", "location_raw", "country_code", "region", "city", "language", "workplace", "employment_type", "posted_at", "salary_min_minor", "salary_max_minor", "salary_currency", "salary_period", "source_updated_at", "first_seen_at", "last_seen_at", "missing_polls", "closed_at", "dedupe_key", "description_gz", "description_hash", "tag_source", "tagged_at", "questions_fetched_at") SELECT "id", "board_id", "company_id", "ats", "ats_job_id", "url", "apply_url_norm", "title", "title_norm", "department", "location_raw", "country_code", "region", "city", "language", "workplace", "employment_type", "posted_at", "salary_min_minor", "salary_max_minor", "salary_currency", "salary_period", "source_updated_at", "first_seen_at", "last_seen_at", "missing_polls", "closed_at", "dedupe_key", "description_gz", "description_hash", "tag_source", "tagged_at", "questions_fetched_at" FROM `postings`;--> statement-breakpoint
DROP TABLE `postings`;--> statement-breakpoint
ALTER TABLE `__new_postings` RENAME TO `postings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `postings_board_ats_job_unique` ON `postings` (`board_id`,`ats_job_id`);--> statement-breakpoint
CREATE INDEX `postings_dedupe_key` ON `postings` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `postings_apply_url_norm` ON `postings` (`apply_url_norm`);--> statement-breakpoint
CREATE INDEX `postings_closed_at` ON `postings` (`closed_at`);--> statement-breakpoint
ALTER TABLE `company_boards` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `company_boards` ADD `consecutive_errors` integer DEFAULT 0 NOT NULL;