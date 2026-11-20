DROP INDEX `facts_user_key_unique`;--> statement-breakpoint
ALTER TABLE `facts` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `facts_user_key_scope_unique` ON `facts` (`user_id`,`key`,`scope`);--> statement-breakpoint
DROP INDEX `reviews_user_question_open_unique`;--> statement-breakpoint
ALTER TABLE `reviews` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_user_question_scope_open_unique` ON `reviews` (`user_id`,`question_id`,`scope`) WHERE status = 'open';