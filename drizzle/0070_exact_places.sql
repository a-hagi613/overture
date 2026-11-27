-- Exact locations (issue #683): both sides of a location match store canonical place ids.
--
-- `job_places` moves from freehire's raw facets to the ids a person picks from. The table is rebuilt because its key
-- changes; it is a cache derived from the `jobs` columns, never user data, so the boot pass (`rebuildStoredJobPlaces`)
-- refills it for every stored job and the store replaces a job's places on each upsert. No job row or application link
-- is touched.
DROP TABLE `job_places`;
--> statement-breakpoint
CREATE TABLE `job_places` (
	`job_id` text NOT NULL,
	`place_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`job_id`, `place_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `job_places_place_job` ON `job_places` (`place_id`,`job_id`);
--> statement-breakpoint
-- Additive: the column starts empty and the boot pass (`promoteStoredTargetPlaces`) resolves every saved location with
-- the committed geo catalog, writes the ids back to `locations`, and leaves only genuinely ambiguous values here. The
-- old raw values stay in `locations` until that pass runs, so this migration loses nothing and running the pass again
-- is a no-op.
ALTER TABLE `targets` ADD `unresolved_locations` text DEFAULT '[]' NOT NULL;
