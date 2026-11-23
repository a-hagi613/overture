CREATE INDEX `admin_audit_at` ON `admin_audit` (`at`);--> statement-breakpoint
CREATE INDEX `admin_audit_target_user_at` ON `admin_audit` (`target_user_id`,`at`);--> statement-breakpoint
CREATE INDEX `application_events_user_kind_at` ON `application_events` (`user_id`,`kind`,`at`);--> statement-breakpoint
CREATE INDEX `attempts_started_at` ON `attempts` (`started_at`);--> statement-breakpoint
CREATE INDEX `bg_jobs_status_updated` ON `bg_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `llm_usage_created_at` ON `llm_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `session_user_id` ON `session` (`user_id`);