-- The freehire job source (issue #700). `jobs` is one freehire posting shared by every user, in freehire's own shape
-- and deduplicated by public slug then employer + title + places. Rows close, they never delete, so an Application's
-- stored link keeps resolving. `job_places` carries the geography facets for the matching reads.
CREATE TABLE `job_places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `job_places_job_kind_value_unique` ON `job_places` (`job_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `job_places_kind_value_job` ON `job_places` (`kind`,`value`,`job_id`);--> statement-breakpoint
CREATE TABLE `job_pull_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`mode` text NOT NULL,
	`user_count` integer NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`kept` integer DEFAULT 0 NOT NULL,
	`dropped_closed` integer DEFAULT 0 NOT NULL,
	`dropped_duplicate` integer DEFAULT 0 NOT NULL,
	`dropped_no_link` integer DEFAULT 0 NOT NULL,
	`dropped_unsupported` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
) STRICT;
--> statement-breakpoint
CREATE INDEX `job_pull_runs_group_started` ON `job_pull_runs` (`group_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `job_pull_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_full_pull_at` integer,
	`last_fresh_pull_at` integer,
	`last_query_key` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`freehire_source` text NOT NULL,
	`external_id` text NOT NULL,
	`board_token` text NOT NULL,
	`ats_job_id` text NOT NULL,
	`url` text,
	`apply_url` text NOT NULL,
	`apply_via` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`company` text NOT NULL,
	`company_norm` text NOT NULL,
	`company_slug` text,
	`location_raw` text,
	`countries` text DEFAULT '[]' NOT NULL,
	`regions` text,
	`metros` text,
	`cities` text,
	`work_mode` text,
	`category` text,
	`seniority` text,
	`employment_type` text,
	`experience_years_min` integer,
	`skills` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text,
	`salary_period` text,
	`description` text,
	`description_hash` text,
	`posted_at` integer,
	`source_created_at` integer,
	`source_updated_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`fake_freshness` integer DEFAULT false NOT NULL,
	`repost_count` integer,
	`age_days` integer,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_external_unique` ON `jobs` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_dedupe_key` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_posted` ON `jobs` (`status`,`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_category_status` ON `jobs` (`category`,`status`);