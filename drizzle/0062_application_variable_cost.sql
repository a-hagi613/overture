-- Actual per-Application variable cost (ADR 0041, issue #570). Every column is
-- additive so an older binary keeps reading and writing `applications` while a
-- try that finished before the deploy leaves its costs at zero.
ALTER TABLE `applications` ADD `browser_cost_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `retry_cost_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `llm_cost_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `cost_recorded_at` integer;--> statement-breakpoint
-- The active paying-subscriber count (`count(distinct user_id)` over unexpired
-- `period` grants) is read by the spend budgets and the margin report. This
-- covering index was deferred from #585 to this migration; IF NOT EXISTS keeps
-- a database that already carries it migratable.
CREATE INDEX IF NOT EXISTS `grants_paying_subscribers` ON `grants` (`source`,`starts_at`,`expires_at`,`user_id`);
