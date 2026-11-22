CREATE TABLE `lab_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`provider` text NOT NULL,
	`page` text NOT NULL,
	`ats` text,
	`outcome` text NOT NULL,
	`challenge_seen` integer DEFAULT false NOT NULL,
	`code_asked` integer DEFAULT false NOT NULL,
	`captcha_score` real,
	`duration_ms` integer NOT NULL,
	`proxy_bytes` integer,
	`cost_micros` integer,
	`session_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `lab_runs_provider_started` ON `lab_runs` (`provider`,`started_at`);--> statement-breakpoint
CREATE INDEX `lab_runs_run` ON `lab_runs` (`run_id`);