CREATE TABLE `interview_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`message_id` text NOT NULL,
	`uid` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`tz` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_events_user_uid_unique` ON `interview_events` (`user_id`,`uid`);--> statement-breakpoint
CREATE INDEX `interview_events_user_starts` ON `interview_events` (`user_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `interview_events_message` ON `interview_events` (`message_id`);