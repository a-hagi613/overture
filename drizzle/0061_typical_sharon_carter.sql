ALTER TABLE `mailboxes` ADD `apply_address` text;--> statement-breakpoint
CREATE UNIQUE INDEX `mailboxes_apply_address_unique` ON `mailboxes` (`apply_address`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `use_personal_email` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- The local part of an apply alias is unique across domains, so swapping ALIAS_EMAIL_DOMAIN can never
-- hand `alex.chen.4k` to a second person on a new domain (issue #566).
CREATE UNIQUE INDEX `mailboxes_apply_local_part_unique` ON `mailboxes` (lower(substr(`apply_address`, 1, instr(`apply_address`, '@') - 1))) WHERE `apply_address` IS NOT NULL;--> statement-breakpoint
-- A deleted mailbox retires its apply alias, exactly like its forwarding local part, so mail for a
-- former account is never delivered to whoever gets the handle next.
CREATE TRIGGER `mailboxes_retire_apply_on_delete`
AFTER DELETE ON `mailboxes`
WHEN OLD.`apply_address` IS NOT NULL
BEGIN
INSERT INTO `retired_addresses` (`local_part`, `retired_at`)
VALUES (substr(OLD.`apply_address`, 1, instr(OLD.`apply_address`, '@') - 1), CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT (`local_part`) DO NOTHING;
END;--> statement-breakpoint
CREATE TRIGGER `mailboxes_no_retired_apply_alias`
BEFORE INSERT ON `mailboxes`
WHEN NEW.`apply_address` IS NOT NULL
  AND EXISTS (SELECT 1 FROM `retired_addresses` WHERE `retired_addresses`.`local_part` = substr(NEW.`apply_address`, 1, instr(NEW.`apply_address`, '@') - 1))
BEGIN
SELECT RAISE(ABORT, 'a retired apply alias is never reassigned');
END;--> statement-breakpoint
CREATE TRIGGER `mailboxes_no_retired_apply_alias_update`
BEFORE UPDATE OF `apply_address` ON `mailboxes`
WHEN NEW.`apply_address` IS NOT NULL AND NEW.`apply_address` IS NOT OLD.`apply_address`
  AND EXISTS (SELECT 1 FROM `retired_addresses` WHERE `retired_addresses`.`local_part` = substr(NEW.`apply_address`, 1, instr(NEW.`apply_address`, '@') - 1))
BEGIN
SELECT RAISE(ABORT, 'a retired apply alias is never reassigned');
END;
