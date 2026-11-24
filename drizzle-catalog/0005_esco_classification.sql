ALTER TABLE `postings` ADD `job_category` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `primary_category` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `primary_role` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `esco_code` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `classified_at` integer;--> statement-breakpoint
ALTER TABLE `posting_tags` ADD `weight` real;--> statement-breakpoint
CREATE INDEX `postings_primary_category` ON `postings` (`primary_category`);--> statement-breakpoint
CREATE INDEX `postings_esco_code` ON `postings` (`esco_code`);
