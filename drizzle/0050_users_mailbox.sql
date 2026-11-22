ALTER TABLE `users` ADD `mailbox` text GENERATED ALWAYS AS (case
  when instr(lower(trim(email)), '@') = 0 then lower(trim(email))
  when lower(substr(lower(trim(email)), instr(lower(trim(email)), '@') + 1)) in ('gmail.com', 'googlemail.com')
    and replace(substr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1), 1, instr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1) || '+', '+') - 1), '.', '') <> ''
  then replace(substr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1), 1, instr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1) || '+', '+') - 1), '.', '') || '@gmail.com'
  else lower(trim(email))
end) VIRTUAL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_mailbox_unique` ON `users` (`mailbox`);