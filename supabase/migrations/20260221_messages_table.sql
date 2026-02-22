-- Create messages table if it doesn't exist
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reactions JSONB DEFAULT '{}',
  is_bot BOOLEAN DEFAULT FALSE,
  reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast circle message queries
CREATE INDEX IF NOT EXISTS idx_messages_circle_id ON messages(circle_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_circle_created ON messages(circle_id, created_at);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policy: members can read messages in their circles
CREATE POLICY IF NOT EXISTS "Circle members can read messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM circle_members 
      WHERE circle_members.circle_id = messages.circle_id 
      AND circle_members.user_id = auth.uid()
    )
  );

-- Policy: authenticated users can insert messages in their circles
CREATE POLICY IF NOT EXISTS "Circle members can insert messages" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM circle_members 
      WHERE circle_members.circle_id = messages.circle_id 
      AND circle_members.user_id = auth.uid()
    )
  );

-- Policy: users can update their own message reactions
CREATE POLICY IF NOT EXISTS "Users can update message reactions" ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM circle_members 
      WHERE circle_members.circle_id = messages.circle_id 
      AND circle_members.user_id = auth.uid()
    )
  );

-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
