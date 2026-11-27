ALTER TABLE `matches` ADD `scorer_version` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `role_fit` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `skills` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `level` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `logistics` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `blockers` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `reasons` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `posted_at` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `exact_role` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `company_key` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `description_hash` text;--> statement-breakpoint
CREATE INDEX `matches_user_scored` ON `matches` (`user_id`,`score`);