ALTER TABLE `mailboxes` ADD `first_forwarded_at` integer;--> statement-breakpoint
-- `retired_at` is a drizzle mode: "timestamp" column, stored as whole seconds; strftime('%s','now') is the same unit.
CREATE TRIGGER `mailboxes_retire_on_delete`
AFTER DELETE ON `mailboxes`
BEGIN
INSERT INTO `retired_addresses` (`local_part`, `retired_at`) VALUES (OLD.`local_part`, CAST(strftime('%s','now') AS INTEGER)) ON CONFLICT (`local_part`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `mailboxes_no_retired_local_part`
BEFORE INSERT ON `mailboxes`
WHEN EXISTS (SELECT 1 FROM `retired_addresses` WHERE `retired_addresses`.`local_part` = NEW.`local_part`)
BEGIN
SELECT RAISE(ABORT, 'a retired forwarding address is never reassigned');
END;
