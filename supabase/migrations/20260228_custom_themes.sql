-- Custom Themes: user-created office themes stored in Supabase
-- Users can create, edit, delete their own themes
-- Shared themes are visible to all members of the same circle

CREATE TABLE IF NOT EXISTS user_custom_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid REFERENCES circles(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'My Theme',
  environment_type text NOT NULL DEFAULT 'office',
  colors jsonb NOT NULL DEFAULT '{}',
  is_shared boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_custom_themes_user ON user_custom_themes(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_themes_circle ON user_custom_themes(circle_id) WHERE is_shared = true;

-- RLS
ALTER TABLE user_custom_themes ENABLE ROW LEVEL SECURITY;

-- Users can read their own themes
CREATE POLICY "Users can read own themes"
  ON user_custom_themes FOR SELECT
  USING (auth.uid() = user_id);

-- Users can read shared themes in their circles
CREATE POLICY "Users can read shared themes in their circles"
  ON user_custom_themes FOR SELECT
  USING (
    is_shared = true
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- Users can insert their own themes
CREATE POLICY "Users can create own themes"
  ON user_custom_themes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own themes
CREATE POLICY "Users can update own themes"
  ON user_custom_themes FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own themes
CREATE POLICY "Users can delete own themes"
  ON user_custom_themes FOR DELETE
  USING (auth.uid() = user_id);
