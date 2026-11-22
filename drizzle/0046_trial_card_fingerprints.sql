CREATE TABLE `card_fingerprints` (
	`hmac` text PRIMARY KEY NOT NULL,
	`trial_used_at` integer,
	`created_at` integer NOT NULL
) STRICT;
