ALTER TABLE `job_pull_runs` ADD `failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_pull_runs` ADD `first_error` text;