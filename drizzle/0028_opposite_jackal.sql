CREATE TABLE `live_check_mail` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`code` text NOT NULL,
	`to_address` text NOT NULL,
	`sent_at` integer NOT NULL,
	`received_at` integer,
	`auth` text,
	`received_code` text,
	`resolved_at` integer
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `live_check_mail_token_unique` ON `live_check_mail` (`token`);--> statement-breakpoint
CREATE INDEX `live_check_mail_sent` ON `live_check_mail` (`sent_at`);--> statement-breakpoint
CREATE TABLE `live_check_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`check_name` text NOT NULL,
	`ok` integer NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `live_check_results_run` ON `live_check_results` (`run_id`);--> statement-breakpoint
CREATE INDEX `live_check_results_check_started` ON `live_check_results` (`check_name`,`started_at`);