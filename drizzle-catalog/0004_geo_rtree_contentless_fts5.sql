-- Global location hierarchy, city R-Tree, contentless FTS5 and annual USD salary (issue #630).
--
-- `geo_places` is the compact open-data table the ETL fills from the committed GeoNames/WOF snapshot.
-- `geo_places_rtree` is an R-Tree over cities only (never the 850k+ postings): a radius or metro query
-- scans a handful of city boxes and joins `posting_locations` by `city_geoname_id`.
CREATE TABLE `geo_places` (
	`geoname_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`norm_name` text NOT NULL,
	`alt_names` text,
	`kind` text NOT NULL,
	`continent_code` text,
	`country_code` text,
	`iso_region_code` text,
	`lat` real,
	`lon` real,
	`min_lat` real,
	`max_lat` real,
	`min_lon` real,
	`max_lon` real,
	`population` integer DEFAULT 0 NOT NULL
) STRICT;--> statement-breakpoint
CREATE INDEX `geo_places_norm_name` ON `geo_places` (`norm_name`);--> statement-breakpoint
CREATE INDEX `geo_places_kind_country` ON `geo_places` (`kind`,`country_code`);--> statement-breakpoint
CREATE INDEX `geo_places_country_region` ON `geo_places` (`country_code`,`iso_region_code`);--> statement-breakpoint
CREATE VIRTUAL TABLE `geo_places_rtree` USING rtree(`geoname_id`, `min_lat`, `max_lat`, `min_lon`, `max_lon`);--> statement-breakpoint
CREATE TABLE `posting_locations` (
	`id` integer PRIMARY KEY NOT NULL,
	`posting_id` text NOT NULL,
	`continent_code` text,
	`country_code` text,
	`region_code` text,
	`city_geoname_id` integer,
	`scope_kind` text NOT NULL,
	FOREIGN KEY (`posting_id`) REFERENCES `postings`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;--> statement-breakpoint
CREATE INDEX `posting_locations_continent_posting` ON `posting_locations` (`continent_code`,`posting_id`);--> statement-breakpoint
CREATE INDEX `posting_locations_country_posting` ON `posting_locations` (`country_code`,`posting_id`);--> statement-breakpoint
CREATE INDEX `posting_locations_country_region_posting` ON `posting_locations` (`country_code`,`region_code`,`posting_id`);--> statement-breakpoint
CREATE INDEX `posting_locations_city_posting` ON `posting_locations` (`city_geoname_id`,`posting_id`);--> statement-breakpoint
CREATE INDEX `posting_locations_scope_country_posting` ON `posting_locations` (`scope_kind`,`country_code`,`posting_id`);--> statement-breakpoint
ALTER TABLE `postings` ADD `salary_min_usd` integer;--> statement-breakpoint
ALTER TABLE `postings` ADD `salary_max_usd` integer;--> statement-breakpoint
-- Contentless FTS5: the index stores only tokens and positions, `postings` keeps the text, and `bm25()`
-- still ranks. `contentless_delete` lets the delete triggers remove a row by rowid without the old values.
DROP TRIGGER `postings_fts_insert`;--> statement-breakpoint
DROP TRIGGER `postings_fts_delete`;--> statement-breakpoint
DROP TRIGGER `postings_fts_update`;--> statement-breakpoint
DROP TRIGGER `companies_fts_update`;--> statement-breakpoint
DROP TABLE `postings_fts`;--> statement-breakpoint
CREATE VIRTUAL TABLE `postings_fts` USING fts5(`title`, `company`, `department`, `skills_text`, `esco_synonyms`, `location_text`, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE TRIGGER `postings_fts_insert` AFTER INSERT ON `postings` WHEN NEW.`closed_at` IS NULL BEGIN
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `department`, `skills_text`, `esco_synonyms`, `location_text`)
	SELECT NEW.`rowid`, NEW.`title`, `companies`.`name`, coalesce(NEW.`department`, ''), coalesce(NEW.`skills_json`, ''), '', coalesce(NEW.`location_raw`, '') FROM `companies` WHERE `companies`.`id` = NEW.`company_id`;
END;--> statement-breakpoint
CREATE TRIGGER `postings_fts_delete` AFTER DELETE ON `postings` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` = OLD.`rowid`;
END;--> statement-breakpoint
CREATE TRIGGER `postings_fts_update` AFTER UPDATE OF `title`, `department`, `location_raw`, `skills_json`, `company_id`, `closed_at` ON `postings` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` = OLD.`rowid`;
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `department`, `skills_text`, `esco_synonyms`, `location_text`)
	SELECT NEW.`rowid`, NEW.`title`, `companies`.`name`, coalesce(NEW.`department`, ''), coalesce(NEW.`skills_json`, ''), '', coalesce(NEW.`location_raw`, '') FROM `companies` WHERE `companies`.`id` = NEW.`company_id` AND NEW.`closed_at` IS NULL;
END;--> statement-breakpoint
CREATE TRIGGER `companies_fts_update` AFTER UPDATE OF `name` ON `companies` BEGIN
	DELETE FROM `postings_fts` WHERE `rowid` IN (SELECT `rowid` FROM `postings` WHERE `company_id` = OLD.`id`);
	INSERT INTO `postings_fts` (`rowid`, `title`, `company`, `department`, `skills_text`, `esco_synonyms`, `location_text`)
	SELECT `rowid`, `title`, NEW.`name`, coalesce(`department`, ''), coalesce(`skills_json`, ''), '', coalesce(`location_raw`, '') FROM `postings` WHERE `company_id` = OLD.`id` AND `closed_at` IS NULL;
END;
