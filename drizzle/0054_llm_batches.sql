CREATE TABLE `llm_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`input_revision_hash` text NOT NULL,
	`model` text NOT NULL,
	`batch_id` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`results` text,
	`result_applied_at` integer,
	`expires_at` integer,
	`last_polled_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_batches_input_revision_hash_unique` ON `llm_batches` (`input_revision_hash`);--> statement-breakpoint
CREATE INDEX `llm_batches_status_updated` ON `llm_batches` (`status`,`updated_at`);