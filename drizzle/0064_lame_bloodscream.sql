-- The public waitlist (WS-22). Strangers ask for an invite while public sign-up is closed, an admin approves one
-- with a single click, and the row moves to `joined` on the first verified sign in. The email is unique, so a repeat
-- submission updates its row instead of adding another, and there is no foreign key because the entry exists before
-- any account does.
CREATE TABLE `waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`target_role` text,
	`target_location` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`invited_at` integer
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_entries_email_unique` ON `waitlist_entries` (`email`);--> statement-breakpoint
CREATE INDEX `waitlist_entries_status_created` ON `waitlist_entries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `waitlist_entries_created` ON `waitlist_entries` (`created_at`);