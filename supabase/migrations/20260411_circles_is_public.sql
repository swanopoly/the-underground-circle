-- Add is_public flag to circles for discovery
-- Public circles appear in /discover and can be joined without invite code

ALTER TABLE circles ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;

-- Index for discovery queries
CREATE INDEX IF NOT EXISTS idx_circles_public ON circles(is_public) WHERE is_public = true;

-- Allow anyone to read public circles (for discovery page)
CREATE POLICY "public_circles_read" ON circles FOR SELECT
  USING (
    is_public = true
    OR id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
