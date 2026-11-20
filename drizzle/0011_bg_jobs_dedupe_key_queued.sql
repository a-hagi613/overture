DELETE FROM `bg_jobs`
WHERE `id` IN (
	SELECT `id` FROM (
		SELECT
			`id`,
			row_number() OVER (
				PARTITION BY `kind`, `dedupe_key`
				ORDER BY `run_at`, `created_at`, `id`
			) AS `duplicate_rank`
		FROM `bg_jobs`
		WHERE `status` = 'queued' AND `dedupe_key` IS NOT NULL
	)
	WHERE `duplicate_rank` > 1
);--> statement-breakpoint
DROP INDEX `bg_jobs_dedupe_key_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `bg_jobs_dedupe_key_queued` ON `bg_jobs` (`dedupe_key`) WHERE status = 'queued';
