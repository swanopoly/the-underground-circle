-- Custom Souls: user-created agent personality templates
-- Users can duplicate built-in templates and customize them, or create from scratch

CREATE TABLE IF NOT EXISTS custom_souls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT '✨',
  category TEXT DEFAULT 'personality' CHECK (category IN ('role', 'specialty', 'personality')),
  tags TEXT[] DEFAULT '{}',
  description TEXT DEFAULT '',
  soul_text TEXT NOT NULL,
  based_on TEXT, -- original template ID if duplicated
  is_shared BOOLEAN DEFAULT false, -- share with circle members
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_custom_souls_user ON custom_souls(user_id);
CREATE INDEX idx_custom_souls_circle ON custom_souls(circle_id);

-- RLS
ALTER TABLE custom_souls ENABLE ROW LEVEL SECURITY;

-- Users can read their own souls + shared souls in their circles
CREATE POLICY "Users can read own souls"
  ON custom_souls FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read shared souls in their circles"
  ON custom_souls FOR SELECT
  USING (
    is_shared = true
    AND circle_id IN (SELECT get_my_circle_ids())
  );

-- Users can insert their own
CREATE POLICY "Users can create souls"
  ON custom_souls FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own
CREATE POLICY "Users can update own souls"
  ON custom_souls FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own
CREATE POLICY "Users can delete own souls"
  ON custom_souls FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_custom_souls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER custom_souls_updated_at
  BEFORE UPDATE ON custom_souls
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_souls_updated_at();

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
