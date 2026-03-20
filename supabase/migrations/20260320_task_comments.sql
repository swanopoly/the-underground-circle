-- Create task_comments table for kanban task discussions
CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id text,
  content text NOT NULL DEFAULT '',
  attachments jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by task
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(task_id, created_at);

-- RLS
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- Members of the circle that owns the task can read comments
CREATE POLICY "Circle members can read task comments" ON task_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN circle_members cm ON cm.circle_id = t.circle_id
      WHERE t.id = task_comments.task_id
        AND cm.user_id = auth.uid()
    )
  );

-- Authenticated users can insert comments on tasks in their circles
CREATE POLICY "Circle members can insert task comments" ON task_comments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM tasks t
      JOIN circle_members cm ON cm.circle_id = t.circle_id
      WHERE t.id = task_comments.task_id
        AND cm.user_id = auth.uid()
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;
