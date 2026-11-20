CREATE TABLE `application_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`question_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`sentences_enc` text NOT NULL,
	`word_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `application_answers_application_question_unique` ON `application_answers` (`application_id`,`question_id`);