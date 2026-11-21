INSERT INTO `kill_switches` (`scope`, `key`, `enabled`, `reason`, `set_by`, `set_at`)
VALUES ('ats', 'personio', 1, 'Personio waits for its 20-form probe (#232)', 'owner', 1795250000000)
ON CONFLICT (`scope`, `key`) DO NOTHING;
