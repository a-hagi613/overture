ALTER TABLE `profiles` ADD `running` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `pause_reason` text DEFAULT 'onboarding';