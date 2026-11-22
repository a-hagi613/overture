PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`company_id` text NOT NULL,
	`ats` text,
	`company_name` text NOT NULL,
	`company_name_norm` text NOT NULL,
	`company_domain` text,
	`posting_title` text NOT NULL,
	`posting_url` text NOT NULL,
	`apply_url` text,
	`location_raw` text,
	`salary_currency` text,
	`salary_min_minor` integer,
	`salary_max_minor` integer,
	`salary_period` text,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`stage` text,
	`stage_locked` integer DEFAULT false NOT NULL,
	`board_position` real,
	`score_at_queue` integer,
	`scheduled_for` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`ready_at` integer,
	`approved_at` integer,
	`approved_plan_sha256` text,
	`approved_plan_enc` text,
	`changes` text,
	`sent_at` integer,
	`closed_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "user_id", "posting_id", "company_id", "ats", "company_name", "company_name_norm", "company_domain", "posting_title", "posting_url", "apply_url", "location_raw", "salary_currency", "salary_min_minor", "salary_max_minor", "salary_period", "origin", "status", "status_reason", "stage", "stage_locked", "board_position", "score_at_queue", "scheduled_for", "attempts", "ready_at", "approved_at", "approved_plan_sha256", "approved_plan_enc", "changes", "sent_at", "closed_reason", "created_at", "updated_at") SELECT a."id", a."user_id", a."posting_id", a."company_id", p."ats", coalesce(c."name", 'Unknown company'), coalesce(c."name_norm", 'unknown company'), c."domain", coalesce(p."title", 'Unknown role'), coalesce(p."url", ''), p."apply_url", p."location_raw", p."salary_currency", p."salary_min_minor", p."salary_max_minor", p."salary_period", a."origin", a."status", a."status_reason", a."stage", a."stage_locked", a."board_position", a."score_at_queue", a."scheduled_for", a."attempts", a."ready_at", a."approved_at", a."approved_plan_sha256", a."approved_plan_enc", a."changes", a."sent_at", a."closed_reason", a."created_at", a."updated_at" FROM `applications` a LEFT JOIN `postings` p ON p."id" = a."posting_id" LEFT JOIN `companies` c ON c."id" = a."company_id";--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_posting_unique` ON `applications` (`user_id`,`posting_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_sending_unique` ON `applications` (`user_id`) WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX `applications_user_company` ON `applications` (`user_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `applications_user_sent_at` ON `applications` (`user_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `__new_matches` (
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`code_rank` real NOT NULL,
	`score` integer,
	`reason` text,
	`resume_id` text,
	`targets_version` integer,
	`scored_at` integer,
	PRIMARY KEY(`user_id`, `posting_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_matches`("user_id", "posting_id", "code_rank", "score", "reason", "resume_id", "targets_version", "scored_at") SELECT "user_id", "posting_id", "code_rank", "score", "reason", "resume_id", "targets_version", "scored_at" FROM `matches`;--> statement-breakpoint
DROP TABLE `matches`;--> statement-breakpoint
ALTER TABLE `__new_matches` RENAME TO `matches`;--> statement-breakpoint
CREATE INDEX `matches_user_code_rank` ON `matches` (`user_id`,`code_rank`);--> statement-breakpoint
CREATE TABLE `__new_posting_user_state` (
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `posting_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_posting_user_state`("user_id", "posting_id", "state", "updated_at") SELECT "user_id", "posting_id", "state", "updated_at" FROM `posting_user_state`;--> statement-breakpoint
DROP TABLE `posting_user_state`;--> statement-breakpoint
ALTER TABLE `__new_posting_user_state` RENAME TO `posting_user_state`;--> statement-breakpoint
CREATE TABLE `__new_skip_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`domain` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_skip_companies`("id", "user_id", "company_id", "name", "name_norm", "domain", "reason", "created_at") SELECT "id", "user_id", "company_id", "name", "name_norm", "domain", "reason", "created_at" FROM `skip_companies`;--> statement-breakpoint
DROP TABLE `skip_companies`;--> statement-breakpoint
ALTER TABLE `__new_skip_companies` RENAME TO `skip_companies`;--> statement-breakpoint
CREATE UNIQUE INDEX `skip_companies_user_name_unique` ON `skip_companies` (`user_id`,`name_norm`);