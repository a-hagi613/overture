CREATE TABLE `checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `checkins_application_unique` ON `checkins` (`application_id`);--> statement-breakpoint
CREATE INDEX `checkins_user_status_due` ON `checkins` (`user_id`,`status`,`due_at`);