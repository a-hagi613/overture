CREATE INDEX `companies_name_norm` ON `companies` (`name_norm`);--> statement-breakpoint
CREATE INDEX `company_boards_ats_status_next_poll` ON `company_boards` (`ats`,`status`,`next_poll_at`);