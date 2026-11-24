-- Runtime posting flags (issue #576). The catalog is a read-only artifact the app hot-swaps and never writes, so a
-- Posting that keeps failing on the live form is flagged here in `app.sqlite` instead. `posting_id` is a plain
-- logical id into `catalog.sqlite`: no foreign key, so a swap or prune can never leave a dangling reference.
CREATE TABLE `catalog_posting_flags` (
	`posting_id` text PRIMARY KEY NOT NULL,
	`flag_reason` text NOT NULL,
	`fail_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;--> statement-breakpoint
CREATE INDEX `catalog_posting_flags_updated` ON `catalog_posting_flags` (`updated_at`);
