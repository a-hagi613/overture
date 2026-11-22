CREATE TABLE `calendar_feed_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_tokens_user_unique` ON `calendar_feed_tokens` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_tokens_hash_unique` ON `calendar_feed_tokens` (`token_hash`);