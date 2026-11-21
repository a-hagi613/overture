CREATE TABLE `account_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`object_key` text,
	`key_enc` text NOT NULL,
	`bytes` integer,
	`error` text,
	`notified_at` integer,
	`requested_at` integer NOT NULL,
	`ready_at` integer,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `account_exports_user_requested` ON `account_exports` (`user_id`,`requested_at`);
