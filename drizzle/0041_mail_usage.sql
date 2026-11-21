CREATE TABLE `mail_usage` (
	`month` text PRIMARY KEY NOT NULL,
	`auth_sends` integer DEFAULT 0 NOT NULL,
	`system_sends` integer DEFAULT 0 NOT NULL,
	`notice_sends` integer DEFAULT 0 NOT NULL,
	`warned_at` integer,
	`reserve_refused_at` integer,
	`refused_at` integer
) STRICT;
