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
	`source` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`content_hash` text,
	`last_polled_at` integer,
	`next_poll_at` integer,
	`backoff_level` integer DEFAULT 0 NOT NULL,
	`consecutive_errors` integer DEFAULT 0 NOT NULL,
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
	`apply_url` text,
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
CREATE UNIQUE INDEX `postings_board_ats_job_unique` ON `postings` (`board_id`,`ats_job_id`);--> statement-breakpoint
CREATE INDEX `postings_dedupe_key` ON `postings` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `postings_apply_url_norm` ON `postings` (`apply_url_norm`);--> statement-breakpoint
CREATE INDEX `postings_closed_at` ON `postings` (`closed_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `postings_fts` USING fts5(`title`, `company`, `location`, `department`);--> statement-breakpoint
CREATE TRIGGER `postings_fts_insert` AFTER INSERT ON `postings` WHEN NEW.`closed_at` IS NULL BEGIN
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `location`, `department`)
	SELECT NEW.`rowid`, NEW.`title`, `companies`.`name`, NEW.`location_raw`, NEW.`department` FROM `companies` WHERE `companies`.`id` = NEW.`company_id`;
END;--> statement-breakpoint
CREATE TRIGGER `postings_fts_delete` AFTER DELETE ON `postings` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` = OLD.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `postings_fts_update` AFTER UPDATE OF `title`, `department`, `location_raw`, `company_id`, `closed_at` ON `postings` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` = OLD.`rowid`;
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `location`, `department`)
	SELECT NEW.`rowid`, NEW.`title`, `companies`.`name`, NEW.`location_raw`, NEW.`department` FROM `companies` WHERE `companies`.`id` = NEW.`company_id` AND NEW.`closed_at` IS NULL;
END;--> statement-breakpoint
CREATE TRIGGER `companies_fts_update` AFTER UPDATE OF `name` ON `companies` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` IN (SELECT `rowid` FROM `postings` WHERE `company_id` = OLD.`id`);
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `location`, `department`)
	SELECT `rowid`, `title`, NEW.`name`, `location_raw`, `department` FROM `postings` WHERE `company_id` = OLD.`id` AND `closed_at` IS NULL;
END;
