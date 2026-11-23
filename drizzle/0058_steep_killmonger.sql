CREATE INDEX `applications_user_status` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `events_user_seq` ON `events` (`user_id`,`seq`);--> statement-breakpoint
CREATE INDEX `events_created_at` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `grants_user_starts` ON `grants` (`user_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `messages_user_created` ON `messages` (`user_id`,`created_at`);