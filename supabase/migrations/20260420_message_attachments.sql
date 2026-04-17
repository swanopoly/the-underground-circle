-- Message Attachments — Phase C1 of the OpenSwan/Chat Architecture Plan.
-- Any file type, multi-file, per-message. Stored in Supabase Storage
-- bucket `chat-attachments`, metadata in this table.

CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid,                -- nullable: attachments can be staged before the message is sent
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  thread_id uuid,                 -- nullable FK to circle_chat_threads(id)
  user_id uuid NOT NULL REFERENCES auth.users(id),
  storage_path text NOT NULL,     -- bucket-relative path
  original_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes int NOT NULL DEFAULT 0,
  extract_text text,              -- text extraction for text/csv/md files (up to 10k chars)
  ocr_text text,                  -- vision OCR result for images/PDFs (filled async)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_thread ON message_attachments(thread_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_user ON message_attachments(user_id);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

-- Read: circle members can see attachments in their circles
DROP POLICY IF EXISTS message_attachments_select ON message_attachments;
CREATE POLICY message_attachments_select ON message_attachments FOR SELECT TO authenticated
USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Insert: user can attach to their own circles
DROP POLICY IF EXISTS message_attachments_insert ON message_attachments;
CREATE POLICY message_attachments_insert ON message_attachments FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);

-- Delete: owner only
DROP POLICY IF EXISTS message_attachments_delete ON message_attachments;
CREATE POLICY message_attachments_delete ON message_attachments FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- Update: owner only (for linking message_id after send, filling ocr_text)
DROP POLICY IF EXISTS message_attachments_update ON message_attachments;
CREATE POLICY message_attachments_update ON message_attachments FOR UPDATE TO authenticated
USING (user_id = auth.uid());

-- Storage bucket (Supabase auto-creates on first upload if policy allows,
-- but we declare intent here for documentation).
-- Run via Dashboard → Storage → New Bucket:
--   Name: chat-attachments
--   Public: OFF
--   File size limit: 50 MB
--   Allowed MIME types: (leave empty = all types)

NOTIFY pgrst, 'reload schema';
