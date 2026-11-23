CREATE TABLE `calendar_custom_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`time` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `calendar_custom_events_user_day` ON `calendar_custom_events` (`user_id`,`day_key`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`subject` text NOT NULL,
	`message_enc` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`admin_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_reference_id_unique` ON `support_tickets` (`reference_id`);--> statement-breakpoint
CREATE INDEX `support_tickets_user_created` ON `support_tickets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_created` ON `support_tickets` (`status`,`created_at`);