CREATE TABLE `__new_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`email_enc` text,
	`invited_by` text,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	`grant_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `invites_accepted_user_id_users_id_fk` FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action,
	CONSTRAINT `invites_grant_id_grants_id_fk` FOREIGN KEY (`grant_id`) REFERENCES `grants`(`id`) ON DELETE set null ON UPDATE no action
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_invites` (`id`, `email_hash`, `email_enc`, `invited_by`, `accepted_at`, `accepted_user_id`, `revoked_at`, `grant_id`, `created_at`)
SELECT `id`, `email_hash`, NULL, `invited_by`, `accepted_at`, NULL, NULL, NULL, `created_at` FROM `invites`;
--> statement-breakpoint
DROP TABLE `invites`;
--> statement-breakpoint
ALTER TABLE `__new_invites` RENAME TO `invites`;
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_hash_unique` ON `invites` (`email_hash`);
