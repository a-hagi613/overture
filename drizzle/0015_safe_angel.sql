CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`company_id` text NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`stage` text,
	`stage_locked` integer DEFAULT false NOT NULL,
	`board_position` real,
	`score_at_queue` integer,
	`scheduled_for` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`closed_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_posting_unique` ON `applications` (`user_id`,`posting_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_sending_unique` ON `applications` (`user_id`) WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX `applications_user_company` ON `applications` (`user_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `applications_user_sent_at` ON `applications` (`user_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`per_usd` real NOT NULL,
	PRIMARY KEY(`date`, `currency`),
	CONSTRAINT "fx_rates_per_usd_positive" CHECK("fx_rates"."per_usd" > 0)
) STRICT;--> statement-breakpoint
CREATE TABLE `matches` (
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
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;--> statement-breakpoint
CREATE INDEX `matches_user_code_rank` ON `matches` (`user_id`,`code_rank`);--> statement-breakpoint
CREATE TABLE `posting_user_state` (
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `posting_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;