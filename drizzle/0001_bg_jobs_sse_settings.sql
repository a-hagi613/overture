DROP TABLE IF EXISTS `jobs`;
--> statement-breakpoint
CREATE TABLE `bg_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`run_at` integer NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 2 NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `bg_jobs_dedupe_key_unique` ON `bg_jobs` (`dedupe_key`);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `kill_switches` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`set_by` text DEFAULT 'owner' NOT NULL,
	`set_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `kill_switches_scope_key` ON `kill_switches` (`scope`,`key`);
