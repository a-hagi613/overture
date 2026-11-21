CREATE TABLE `plan_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`ats` text NOT NULL,
	`form_signature` text NOT NULL,
	`plan` text NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_cache_ats_signature_unique` ON `plan_cache` (`ats`,`form_signature`);