CREATE TABLE `posting_questions` (
	`posting_id` text NOT NULL,
	`question_id` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`posting_id`, `question_id`),
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `question_variants` (
	`variant_hash` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`text_display` text NOT NULL,
	`text_norm_hash` text NOT NULL,
	`field_type` text NOT NULL,
	`options_hash` text,
	`fact_key` text,
	`answer_kind` text NOT NULL,
	`mapped_by` text,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_text_norm_hash_unique` ON `questions` (`text_norm_hash`);--> statement-breakpoint
CREATE TABLE `review_applications` (
	`review_id` text NOT NULL,
	`application_id` text NOT NULL,
	PRIMARY KEY(`review_id`, `application_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`fact_key` text,
	`prompt` text NOT NULL,
	`field_type` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_question_open_unique` ON `reviews` (`user_id`,`question_id`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `reviews_user_status` ON `reviews` (`user_id`,`status`);