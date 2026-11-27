-- Simplify preferences (issue #684): roles are freehire category ids plus optional title words, and the only hard
-- filters left are role and location (SPEC §6.4, §8.1). Work mode, salary floor, seniority and employment type are no
-- longer stored as preferences, so their columns go. History and sent Applications keep their own snapshots.
--
-- `unresolved_roles` starts empty. The boot pass (`promoteStoredTargetRoles`) reads the saved roles with the retired
-- role taxonomy and the freehire category list in TypeScript, which SQL cannot do: a value that names exactly one
-- freehire category is written back, and a value that names none or several stays here for the person to resolve.
-- The old `roles` values stay until that pass runs, so this migration loses nothing and re-running the pass is a no-op.
ALTER TABLE `targets` ADD `unresolved_roles` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `seniorities`;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `workplaces`;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `employment_types`;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `salary_floor_minor`;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `salary_currency`;
--> statement-breakpoint
ALTER TABLE `targets` DROP COLUMN `salary_period`;
