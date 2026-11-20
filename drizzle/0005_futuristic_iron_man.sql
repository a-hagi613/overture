CREATE TABLE `llm_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`cached_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_micros` integer NOT NULL,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `tag_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`file_sha256` text NOT NULL,
	`rows` integer NOT NULL,
	`matched` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`applied_at` integer NOT NULL
) STRICT;
