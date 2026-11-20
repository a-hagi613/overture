CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value_enc` text NOT NULL,
	`source` text NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_user_key_unique` ON `facts` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`pages` integer NOT NULL,
	`filename_enc` text NOT NULL,
	`text_enc` text NOT NULL,
	`parsed_with` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `resumes_user_current_unique` ON `resumes` (`user_id`) WHERE is_current = 1;--> statement-breakpoint
CREATE TABLE `user_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wrapped_dek` blob NOT NULL,
	`master_key_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
