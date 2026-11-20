CREATE TABLE `code_waits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`attempt_id` text,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`resolved_message_id` text,
	`code_enc` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE INDEX `code_waits_mailbox_open` ON `code_waits` (`mailbox_id`,`resolved_at`,`started_at`);--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text,
	`subject_enc` text NOT NULL,
	`employer_started` integer DEFAULT false NOT NULL,
	`last_message_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `mail_threads_user_last_message` ON `mail_threads` (`user_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_part` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`receive_until` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_user_id_unique` ON `mailboxes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_local_part_unique` ON `mailboxes` (`local_part`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename_enc` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `message_attachments_message_id` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`direction` text NOT NULL,
	`rfc_message_id` text NOT NULL,
	`in_reply_to` text,
	`sender_domain` text NOT NULL,
	`auth` text NOT NULL,
	`from_enc` text NOT NULL,
	`to_enc` text NOT NULL,
	`subject_enc` text NOT NULL,
	`text_enc` text NOT NULL,
	`html_object_key` text,
	`snippet_enc` text NOT NULL,
	`classification` text,
	`code_consumed_at` integer,
	`read_at` integer,
	`out_status` text,
	`provider_message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `mail_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_mailbox_rfc_message_id_unique` ON `messages` (`mailbox_id`,`rfc_message_id`);--> statement-breakpoint
CREATE INDEX `messages_thread_created` ON `messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `retired_addresses` (
	`local_part` text PRIMARY KEY NOT NULL,
	`retired_at` integer NOT NULL
) STRICT;
