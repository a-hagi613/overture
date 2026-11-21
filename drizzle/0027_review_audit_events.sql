CREATE TABLE `review_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`application_id` text,
	`review_id` text,
	`question_id` text,
	`ats` text,
	`source` text,
	`fact_key` text,
	`fact_revision` integer,
	`scope` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `review_audit_events_user_at` ON `review_audit_events` (`user_id`,`at`);--> statement-breakpoint
CREATE INDEX `review_audit_events_kind_at` ON `review_audit_events` (`kind`,`at`);--> statement-breakpoint
CREATE INDEX `review_audit_events_application` ON `review_audit_events` (`application_id`);