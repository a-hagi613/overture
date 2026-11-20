CREATE TABLE `grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`quantity` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer,
	`stripe_invoice_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_stripe_invoice_id_unique` ON `grants` (`stripe_invoice_id`);--> statement-breakpoint
CREATE TABLE `ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`debit_account` text NOT NULL,
	`credit_account` text NOT NULL,
	`amount` integer NOT NULL,
	`grant_id` text NOT NULL,
	`application_id` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `grants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_amount_positive" CHECK("ledger"."amount" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_idempotency_key_unique` ON `ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `ledger_user_created_at` ON `ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_user_grant_kind` ON `ledger` (`user_id`,`grant_id`,`kind`);--> statement-breakpoint
CREATE TRIGGER `ledger_no_update`
BEFORE UPDATE ON `ledger`
BEGIN
SELECT RAISE(ABORT, 'ledger rows are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_delete_only_without_user`
BEFORE DELETE ON `ledger`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = OLD.`user_id`)
BEGIN
SELECT RAISE(ABORT, 'ledger rows go only when their user goes');
END;
