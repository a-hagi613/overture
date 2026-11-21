CREATE TABLE `consent_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`published_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`running` integer DEFAULT false NOT NULL,
	`pause_reason` text DEFAULT 'onboarding',
	`languages` text DEFAULT '[]' NOT NULL,
	`onboarding_step` integer DEFAULT 1 NOT NULL,
	`onboarded_at` integer,
	`timezone` text,
	`pending_timezone` text,
	`pending_timezone_at` integer,
	`consent_version` text DEFAULT '1' NOT NULL,
	`consent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_profiles`("user_id", "running", "pause_reason", "languages", "onboarding_step", "onboarded_at", "timezone", "pending_timezone", "pending_timezone_at", "consent_version", "consent_at", "created_at", "updated_at") SELECT "user_id", "running", "pause_reason", "languages", "onboarding_step", "onboarded_at", "timezone", "pending_timezone", "pending_timezone_at", "consent_version", "consent_at", "created_at", "updated_at" FROM `profiles`;--> statement-breakpoint
DROP TABLE `profiles`;--> statement-breakpoint
ALTER TABLE `__new_profiles` RENAME TO `profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
INSERT INTO `consent_versions` (`version`, `text`, `published_at`) VALUES ('1', 'Overture fills in each application for me from the resume and facts I saved. It sends an application only after I approve it, and the answers, resume and cover letter it sends are the ones I approved.', 1795219200);--> statement-breakpoint
UPDATE `profiles` SET `consent_version` = '1' WHERE `consent_version` = 'm1';
--> statement-breakpoint
CREATE TRIGGER `consent_versions_no_update`
BEFORE UPDATE ON `consent_versions`
BEGIN
SELECT RAISE(ABORT, 'a published consent version is never edited');
END;--> statement-breakpoint
CREATE TRIGGER `consent_versions_no_delete`
BEFORE DELETE ON `consent_versions`
BEGIN
SELECT RAISE(ABORT, 'a published consent version is never deleted');
END;
