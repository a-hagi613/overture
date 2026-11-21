ALTER TABLE `application_snapshots` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `application_snapshots` ADD `approved_plan_sha256` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `ready_at` integer;--> statement-breakpoint
ALTER TABLE `applications` ADD `approved_at` integer;--> statement-breakpoint
ALTER TABLE `applications` ADD `approved_plan_sha256` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `approved_plan_enc` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `changes` text;