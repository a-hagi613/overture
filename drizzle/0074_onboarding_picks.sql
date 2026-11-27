-- Durable onboarding picks (issue #687, part of epic #678). A person's chosen
-- postings, their request/batch state and an immutable display snapshot are
-- written before the Stripe card check, so the same picks and the same employer
-- and title come back after Checkout even when the Posting has closed. One row
-- per pick, one batch per account; the plan chooses the pick limit and is added
-- later by #709.
CREATE TABLE `onboarding_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_kind` text,
	`status` text NOT NULL,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_batches_user_unique` ON `onboarding_batches` (`user_id`);--> statement-breakpoint
CREATE TABLE `onboarding_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`application_id` text,
	`status` text NOT NULL,
	`status_reason` text,
	`company_id` text NOT NULL,
	`company_name` text NOT NULL,
	`company_name_norm` text NOT NULL,
	`company_domain` text,
	`posting_title` text NOT NULL,
	`posting_url` text NOT NULL,
	`apply_url` text,
	`ats` text,
	`location_raw` text,
	`salary_currency` text,
	`salary_min_minor` integer,
	`salary_max_minor` integer,
	`salary_period` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_picks_user_posting_unique` ON `onboarding_picks` (`user_id`,`posting_id`);--> statement-breakpoint
CREATE INDEX `onboarding_picks_user_status` ON `onboarding_picks` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `onboarding_picks_application` ON `onboarding_picks` (`application_id`);
