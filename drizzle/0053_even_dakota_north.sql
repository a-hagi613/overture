CREATE TABLE `account_erasures` (
	`user_id` text PRIMARY KEY NOT NULL,
	`vendor_profiles` text DEFAULT '[]' NOT NULL,
	`object_prefixes` text NOT NULL,
	`notice_name` text,
	`notice_to` text,
	`user_deleted_at` integer,
	`vendor_cleaned_at` integer,
	`objects_cleaned_at` integer,
	`notice_queued_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
) STRICT;
