-- One forwarded copy per inbound Message (issue #693). The row is written in the same transaction
-- that stores the Message, so a Message can never exist without its copy record. `status` is the
-- record the Inbox surfaces; `detail` is a short reason code, never any message content.
CREATE TABLE `mail_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`message_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`detail` text,
	`provider_message_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`mailbox_id`) REFERENCES `mailboxes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_deliveries_message_unique` ON `mail_deliveries` (`message_id`);--> statement-breakpoint
CREATE INDEX `mail_deliveries_mailbox_status` ON `mail_deliveries` (`mailbox_id`,`status`);
