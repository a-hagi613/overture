DROP INDEX `company_boards_ats_board_token_unique`;--> statement-breakpoint
ALTER TABLE `company_boards` ADD `region` text DEFAULT 'us' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `company_boards_ats_region_board_token_unique` ON `company_boards` (`ats`,`region`,`board_token`);