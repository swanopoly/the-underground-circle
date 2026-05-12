-- Circle Second Brain
-- Obsidian-inspired knowledge layer that sits above memory_entries:
-- inbox capture, evergreen notes, note/memory links, and semantic retrieval.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS circle_second_brain_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_memory_id uuid REFERENCES memory_entries(id) ON DELETE SET NULL,
  parent_note_id uuid REFERENCES circle_second_brain_notes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'inbox'
    CHECK (status IN ('inbox', 'processed', 'evergreen', 'archived')),
  note_kind text NOT NULL DEFAULT 'note'
    CHECK (note_kind IN ('note', 'inbox', 'web_clip', 'agent_summary', 'memory_digest', 'question')),
  visibility text NOT NULL DEFAULT 'circle_shared'
    CHECK (visibility IN ('private', 'circle_shared')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  summary text,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  importance real NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  embedding_model text,
  embedded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circle_second_brain_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  from_note_id uuid NOT NULL REFERENCES circle_second_brain_notes(id) ON DELETE CASCADE,
  to_note_id uuid REFERENCES circle_second_brain_notes(id) ON DELETE CASCADE,
  to_memory_id uuid REFERENCES memory_entries(id) ON DELETE CASCADE,
  link_type text NOT NULL DEFAULT 'related'
    CHECK (link_type IN ('related', 'supports', 'contradicts', 'source', 'next_step', 'same_topic')),
  strength real NOT NULL DEFAULT 0.5 CHECK (strength >= 0 AND strength <= 1),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_note_id IS NOT NULL OR to_memory_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_circle_status
  ON circle_second_brain_notes(circle_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_source_memory
  ON circle_second_brain_notes(source_memory_id)
  WHERE source_memory_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_tags
  ON circle_second_brain_notes USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_second_brain_links_from
  ON circle_second_brain_links(circle_id, from_note_id, strength DESC);

CREATE INDEX IF NOT EXISTS idx_second_brain_links_to_note
  ON circle_second_brain_links(circle_id, to_note_id)
  WHERE to_note_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_second_brain_links_to_memory
  ON circle_second_brain_links(circle_id, to_memory_id)
  WHERE to_memory_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_second_brain_notes_embedding
  ON circle_second_brain_notes USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE OR REPLACE FUNCTION update_circle_second_brain_notes_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_circle_second_brain_notes_updated_at ON circle_second_brain_notes;
CREATE TRIGGER trg_circle_second_brain_notes_updated_at
  BEFORE UPDATE ON circle_second_brain_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_circle_second_brain_notes_updated_at();

ALTER TABLE circle_second_brain_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_second_brain_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS second_brain_notes_select ON circle_second_brain_notes;
CREATE POLICY second_brain_notes_select
  ON circle_second_brain_notes FOR SELECT TO authenticated
  USING (
    (
      visibility = 'circle_shared'
      AND circle_id IN (
        SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
      )
    )
    OR (
      visibility = 'private'
      AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_notes_insert ON circle_second_brain_notes;
CREATE POLICY second_brain_notes_insert
  ON circle_second_brain_notes FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_notes_update ON circle_second_brain_notes;
CREATE POLICY second_brain_notes_update
  ON circle_second_brain_notes FOR UPDATE TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
    AND (
      visibility = 'circle_shared'
      OR created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_notes_delete ON circle_second_brain_notes;
CREATE POLICY second_brain_notes_delete
  ON circle_second_brain_notes FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR circle_id IN (
      SELECT circle_id
      FROM circle_members
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin', 'moderator', 'creator')
    )
  );

DROP POLICY IF EXISTS second_brain_links_select ON circle_second_brain_links;
CREATE POLICY second_brain_links_select
  ON circle_second_brain_links FOR SELECT TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_links_insert ON circle_second_brain_links;
CREATE POLICY second_brain_links_insert
  ON circle_second_brain_links FOR INSERT TO authenticated
  WITH CHECK (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_links_update ON circle_second_brain_links;
CREATE POLICY second_brain_links_update
  ON circle_second_brain_links FOR UPDATE TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS second_brain_links_delete ON circle_second_brain_links;
CREATE POLICY second_brain_links_delete
  ON circle_second_brain_links FOR DELETE TO authenticated
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION match_second_brain_notes(
  p_query_embedding vector(1536),
  p_circle_id uuid,
  p_match_threshold float DEFAULT 0.0,
  p_match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  circle_id uuid,
  created_by uuid,
  source_memory_id uuid,
  status text,
  note_kind text,
  visibility text,
  title text,
  content text,
  summary text,
  tags text[],
  aliases text[],
  importance real,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    n.id,
    n.circle_id,
    n.created_by,
    n.source_memory_id,
    n.status,
    n.note_kind,
    n.visibility,
    n.title,
    n.content,
    n.summary,
    n.tags,
    n.aliases,
    n.importance,
    n.metadata,
    n.created_at,
    n.updated_at,
    (1 - (n.embedding <=> p_query_embedding))::float AS similarity
  FROM circle_second_brain_notes n
  WHERE n.circle_id = p_circle_id
    AND n.status <> 'archived'
    AND n.embedding IS NOT NULL
    AND (1 - (n.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY n.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION match_second_brain_notes TO authenticated;

NOTIFY pgrst, 'reload schema';
