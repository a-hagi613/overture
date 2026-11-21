CREATE TABLE `browser_profiles` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`country_code` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
