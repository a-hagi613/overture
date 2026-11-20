CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`languages` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `skip_companies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text,
	`name` text NOT NULL,
	`name_norm` text NOT NULL,
	`domain` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `skip_companies_user_name_unique` ON `skip_companies` (`user_id`,`name_norm`);--> statement-breakpoint
CREATE TABLE `targets` (
	`user_id` text PRIMARY KEY NOT NULL,
	`roles` text NOT NULL,
	`seniorities` text NOT NULL,
	`workplaces` text NOT NULL,
	`locations` text NOT NULL,
	`employment_types` text NOT NULL,
	`salary_floor_minor` integer,
	`salary_currency` text,
	`salary_period` text DEFAULT 'year' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
