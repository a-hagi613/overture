CREATE TABLE `posting_tags` (
	`posting_id` text NOT NULL,
	`dimension` text NOT NULL,
	`value` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`posting_id`, `dimension`, `value`),
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `posting_tags_dimension_value` ON `posting_tags` (`dimension`,`value`);