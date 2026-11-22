CREATE TABLE `application_receipts` (
	`application_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `application_receipts_message_unique` ON `application_receipts` (`message_id`);