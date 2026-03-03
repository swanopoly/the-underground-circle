-- ============================================================================
-- Prompt Management: versioned prompts with labels, A/B testing, trace linking
-- ============================================================================

-- ─── Table: prompts (prompt name registry) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS prompts (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id       uuid        REFERENCES circles(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  type            text        NOT NULL DEFAULT 'text'
                    CHECK (type IN ('text', 'chat')),
  description     text,
  is_shared       boolean     NOT NULL DEFAULT false,
  tags            text[]      DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (owner_id, circle_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prompts_owner   ON prompts(owner_id);
CREATE INDEX IF NOT EXISTS idx_prompts_circle  ON prompts(circle_id) WHERE is_shared = true;
CREATE INDEX IF NOT EXISTS idx_prompts_name    ON prompts(name);

-- ─── Table: prompt_versions (immutable snapshots) ───────────────────────────

CREATE TABLE IF NOT EXISTS prompt_versions (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id       uuid        NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version         int         NOT NULL,
  content         text        NOT NULL,
  config          jsonb       NOT NULL DEFAULT '{}',
  variables       text[]      DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL REFERENCES auth.users(id),

  UNIQUE (prompt_id, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt
  ON prompt_versions(prompt_id, version DESC);

-- ─── Table: prompt_labels (mutable pointers to versions) ────────────────────

CREATE TABLE IF NOT EXISTS prompt_labels (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id       uuid        NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  label           text        NOT NULL,
  version_id      uuid        NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        NOT NULL REFERENCES auth.users(id),

  UNIQUE (prompt_id, label)
);

CREATE INDEX IF NOT EXISTS idx_prompt_labels_prompt ON prompt_labels(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_labels_lookup ON prompt_labels(prompt_id, label);

-- ─── Trace linking (extend office_terminal_responses) ───────────────────────

ALTER TABLE office_terminal_responses
  ADD COLUMN IF NOT EXISTS prompt_version_id  uuid REFERENCES prompt_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_label       text;

CREATE INDEX IF NOT EXISTS idx_terminal_responses_prompt_version
  ON office_terminal_responses(prompt_version_id) WHERE prompt_version_id IS NOT NULL;

-- ─── RLS: prompts ───────────────────────────────────────────────────────────

ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own prompts"
  ON prompts FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can read shared prompts in their circles"
  ON prompts FOR SELECT
  USING (
    is_shared = true
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own prompts"
  ON prompts FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own prompts"
  ON prompts FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own prompts"
  ON prompts FOR DELETE
  USING (auth.uid() = owner_id);

-- ─── RLS: prompt_versions ───────────────────────────────────────────────────

ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read versions of accessible prompts"
  ON prompt_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_versions.prompt_id
        AND (prompts.owner_id = auth.uid()
          OR (prompts.is_shared = true AND prompts.circle_id IN (
            SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
          )))
    )
  );

CREATE POLICY "Users can create versions of own prompts"
  ON prompt_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_versions.prompt_id
        AND prompts.owner_id = auth.uid()
    )
  );

-- ─── RLS: prompt_labels ────────────────────────────────────────────────────

ALTER TABLE prompt_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read labels of accessible prompts"
  ON prompt_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_labels.prompt_id
        AND (prompts.owner_id = auth.uid()
          OR (prompts.is_shared = true AND prompts.circle_id IN (
            SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
          )))
    )
  );

CREATE POLICY "Users can manage labels of own prompts"
  ON prompt_labels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM prompts
      WHERE prompts.id = prompt_labels.prompt_id
        AND prompts.owner_id = auth.uid()
    )
  );

-- ─── Realtime ───────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE prompt_labels;

-- ─── RPC: create_prompt_version (atomic version + auto-label) ───────────────

CREATE OR REPLACE FUNCTION create_prompt_version(
  p_prompt_id   uuid,
  p_content     text,
  p_config      jsonb DEFAULT '{}',
  p_variables   text[] DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next_version int;
  v_version_id   uuid;
  v_user_id      uuid;
BEGIN
  v_user_id := auth.uid();

  -- Verify ownership
  IF NOT EXISTS (SELECT 1 FROM prompts WHERE id = p_prompt_id AND owner_id = v_user_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Get next version number
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM prompt_versions
  WHERE prompt_id = p_prompt_id;

  -- Insert version
  INSERT INTO prompt_versions (prompt_id, version, content, config, variables, created_by)
  VALUES (p_prompt_id, v_next_version, p_content, p_config, p_variables, v_user_id)
  RETURNING id INTO v_version_id;

  -- Auto-update 'latest' label
  INSERT INTO prompt_labels (prompt_id, label, version_id, updated_by)
  VALUES (p_prompt_id, 'latest', v_version_id, v_user_id)
  ON CONFLICT (prompt_id, label)
  DO UPDATE SET version_id = EXCLUDED.version_id, updated_at = now(), updated_by = EXCLUDED.updated_by;

  -- Update parent timestamp
  UPDATE prompts SET updated_at = now() WHERE id = p_prompt_id;

  RETURN v_version_id;
END; $$;

GRANT EXECUTE ON FUNCTION create_prompt_version(uuid, text, jsonb, text[]) TO authenticated;
