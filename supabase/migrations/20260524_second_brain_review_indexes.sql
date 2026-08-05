-- Digital Brain review and provenance indexes
-- Keeps resurfacing queues, base views, and agent-context filters fast as
-- circle_second_brain_notes grows.

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_review_due
  ON circle_second_brain_notes(circle_id, (metadata->>'reviewDueAt'), status)
  WHERE status <> 'archived'
    AND metadata ? 'reviewDueAt';

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_metadata_source
  ON circle_second_brain_notes(circle_id, (metadata->>'source'), note_kind)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_metadata_gin
  ON circle_second_brain_notes USING gin(metadata jsonb_path_ops);

NOTIFY pgrst, 'reload schema';
