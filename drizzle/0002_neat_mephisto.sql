CREATE TABLE `probe_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`posting_url` text NOT NULL,
	`company` text NOT NULL,
	`posting_title` text NOT NULL,
	`confirm_mode` integer NOT NULL,
	`outcome` text NOT NULL,
	`submitted` integer DEFAULT 0 NOT NULL,
	`confirmation_seen` integer DEFAULT 0 NOT NULL,
	`code_asked` integer DEFAULT 0 NOT NULL,
	`submit_response_status` integer,
	`proxy_mb` real DEFAULT 0 NOT NULL,
	`browser_minutes` real DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL
) STRICT;
