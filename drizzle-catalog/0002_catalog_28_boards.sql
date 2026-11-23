ALTER TABLE `postings` ADD `requisition_id` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `team` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `is_remote` integer;--> statement-breakpoint
ALTER TABLE `postings` ADD `commitment` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `experience` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `application_deadline` integer;--> statement-breakpoint
ALTER TABLE `postings` ADD `salary_summary` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `postings` ADD `apply_supported` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `postings` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `postings` ADD `skills_json` text;--> statement-breakpoint
UPDATE `postings` SET `apply_supported` = 1 WHERE `ats` IN ('greenhouse', 'lever', 'ashby', 'workable', 'personio');--> statement-breakpoint
UPDATE `postings` SET `status` = 'closed' WHERE `closed_at` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `postings_apply_supported_status` ON `postings` (`apply_supported`,`status`);--> statement-breakpoint
CREATE INDEX `postings_company_requisition` ON `postings` (`company_id`,`requisition_id`);
