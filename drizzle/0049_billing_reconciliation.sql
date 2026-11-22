CREATE TABLE `billing_reconciliations` (
	`day` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`checked_at` integer NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`stripe_invoices` integer NOT NULL,
	`stripe_refunds` integer NOT NULL,
	`ledger_grants` integer NOT NULL,
	`ledger_refunds` integer NOT NULL,
	`mismatches` integer NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL
) STRICT;
--> statement-breakpoint
CREATE INDEX `billing_reconciliations_checked` ON `billing_reconciliations` (`checked_at`);
