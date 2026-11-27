-- Freehire job questions (issue #710, part of epic #678). The rebuilt send path stores the fields one freehire job's
-- apply form asked beside the job in this database, so preparation and Review read them after launch without
-- mirroring freehire jobs into the retired catalog. `job_id` is a logical freehire posting id with no catalog
-- foreign key; `question_id` names a row in the shared `questions` table.
CREATE TABLE `job_questions` (
	`job_id` text NOT NULL,
	`question_id` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`field_name` text,
	PRIMARY KEY(`job_id`, `question_id`),
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `job_questions_job` ON `job_questions` (`job_id`,`position`);
