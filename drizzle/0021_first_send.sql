CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`source` text NOT NULL,
	`detail` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `application_events_application_at` ON `application_events` (`application_id`,`at`);--> statement-breakpoint
CREATE TABLE `application_snapshots` (
	`application_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`posting_url` text NOT NULL,
	`posting_title` text NOT NULL,
	`description_hash` text,
	`answers_enc` text NOT NULL,
	`cover_letter_enc` text,
	`resume_id` text NOT NULL,
	`resume_sha256` text NOT NULL,
	`consent_version` text NOT NULL,
	`provider` text NOT NULL,
	`provider_session_id` text,
	`submitted_at` integer NOT NULL,
	`confirmed_by` text NOT NULL,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`user_id` text NOT NULL,
	`n` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_session_id` text,
	`started_at` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`ended_at` integer,
	`submit_clicked_at` integer,
	`submit_response_status` integer,
	`outcome` text,
	`browser_ms` integer,
	`proxy_bytes` integer,
	`captcha_seen` integer DEFAULT false NOT NULL,
	`code_used` integer DEFAULT false NOT NULL,
	`cost_micros` integer,
	`error_code` text,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `attempts_application` ON `attempts` (`application_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `attempts_user_lease` ON `attempts` (`user_id`,`lease_until`);--> statement-breakpoint
ALTER TABLE `posting_questions` ADD `field_name` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `consent_version` text DEFAULT 'm1' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `consent_at` integer;--> statement-breakpoint
CREATE TRIGGER `application_snapshots_no_update`
BEFORE UPDATE ON `application_snapshots`
BEGIN
SELECT RAISE(ABORT, 'snapshots cannot be changed');
END;
--> statement-breakpoint
CREATE TRIGGER `application_snapshots_delete_only_without_user`
BEFORE DELETE ON `application_snapshots`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = OLD.`user_id`)
BEGIN
SELECT RAISE(ABORT, 'snapshots go only when their user goes');
END;
