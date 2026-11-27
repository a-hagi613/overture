-- Retire the daily preparation run (issue #740, ADR 0029 amendment of 2026-11-26).
-- No new Application is prepared from a schedule, and the Recap email went with
-- that run. Queued jobs from the retired kinds are removed so the new build
-- never claims them and records a dead job; finished history is kept.
DELETE FROM `bg_jobs`
WHERE `kind` IN ('prep.daily', 'ready.notify')
  AND `status` IN ('queued', 'running', 'failed');
--> statement-breakpoint
-- The admin settings screen lists every default plus any stored override. Both
-- keys only configured the retired run, so a saved value must not keep showing.
DELETE FROM `settings`
WHERE `key` IN ('prep.run_local_time', 'match.auto_threshold_default');
