-- Send now (issue #681, ADR 0046, amending ADR 0029). Approved Applications go
-- straight away, so the daytime send window and its 20-minute default are gone.
-- Paid sends are spaced five minutes apart; the onboarding trial's three go in
-- parallel.
--
-- The admin settings screen lists every default plus any stored override, so a
-- row left from the old rules would keep showing (and enforcing) them. Clear
-- the rows whose product value changed; the new defaults apply from this
-- migration on. Safety guards (daily cap, attempts, cooldowns, crowd and ATS
-- limits) are untouched.
DELETE FROM `settings`
WHERE `key` IN (
  'limits.send_window',
  'limits.send_spacing_minutes',
  'browser.max_concurrent_sessions',
  'llm.cap_user_day_usd',
  'llm.cap_subscriber_user_day_usd',
  'llm.cap_global_day_usd',
  'llm.daily_spend_cap_micros',
  'llm.cap_tagging_day_usd'
);
--> statement-breakpoint
-- An approved Application that the old planner booked hours ahead has no send
-- time under the new rules; clearing it makes the next planner run place it now.
UPDATE `applications`
SET `scheduled_for` = NULL
WHERE `status` = 'approved'
  AND `scheduled_for` IS NOT NULL
  AND `scheduled_for` > CAST(strftime('%s', 'now') AS integer) * 1000;
