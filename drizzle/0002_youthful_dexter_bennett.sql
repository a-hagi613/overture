CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`domain` text,
	`industry` text,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `company_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`ats` text NOT NULL,
	`board_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_polled_at` integer,
	`next_poll_at` integer,
	`backoff_level` integer DEFAULT 0 NOT NULL,
	`not_found_polls` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `company_boards_ats_board_token_unique` ON `company_boards` (`ats`,`board_token`);--> statement-breakpoint
CREATE TABLE `postings` (
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
	`workplace` text DEFAULT 'unknown' NOT NULL,
	`employment_type` text DEFAULT 'unknown' NOT NULL,
	`language` text,
	`posted_at` integer,
	`source_updated_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`missing_polls` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`dedupe_key` text NOT NULL,
	`description_gz` integer,
	`description_hash` text,
	FOREIGN KEY (`board_id`) REFERENCES `company_boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `postings_board_ats_job_unique` ON `postings` (`board_id`,`ats_job_id`);--> statement-breakpoint
CREATE INDEX `postings_dedupe_key` ON `postings` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `postings_apply_url_norm` ON `postings` (`apply_url_norm`);--> statement-breakpoint
CREATE INDEX `postings_closed_at` ON `postings` (`closed_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE `postings_fts` USING fts5(`title`, `company`, `location`, `department`);
