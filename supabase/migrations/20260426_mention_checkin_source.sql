-- Extend mentions.source_type to include 'check_in' so the daily check-in
-- flow can persist @mention references back through the backlinks panel.

ALTER TABLE mentions
  DROP CONSTRAINT IF EXISTS mentions_source_type_check;

ALTER TABLE mentions
  ADD CONSTRAINT mentions_source_type_check
  CHECK (source_type IN ('message', 'mission', 'mission_task', 'proof', 'comment', 'check_in'));

NOTIFY pgrst, 'reload schema';
