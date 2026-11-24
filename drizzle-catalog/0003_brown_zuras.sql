CREATE TABLE `supply_facets` (
	`role` text NOT NULL,
	`country_code` text NOT NULL,
	`region` text NOT NULL,
	`workplace` text NOT NULL,
	`ats` text NOT NULL,
	`postings` integer NOT NULL,
	PRIMARY KEY(`role`, `country_code`, `region`, `workplace`, `ats`)
) STRICT;
--> statement-breakpoint
DROP INDEX `posting_tags_dimension_value`;--> statement-breakpoint
CREATE INDEX `posting_tags_dimension_value_posting` ON `posting_tags` (`dimension`,`value`,`posting_id`);--> statement-breakpoint
CREATE INDEX `postings_supply_ats` ON `postings` (`apply_supported`,`status`,`ats`) WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX `postings_supply_country` ON `postings` (`apply_supported`,`status`,`country_code`,`workplace`,`ats`) WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX `postings_live_city` ON `postings` (`country_code`,lower("city")) WHERE closed_at is null;--> statement-breakpoint
CREATE INDEX `postings_live_region` ON `postings` (`country_code`,lower("region")) WHERE closed_at is null;