-- Add attachments column to task_comments for rich content (images, code, files)
ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS attachments jsonb;
