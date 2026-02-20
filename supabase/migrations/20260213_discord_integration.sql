-- Discord integration: link Discord servers to circles
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_guild_id TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_bot_token TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS discord_connected_at TIMESTAMPTZ;

-- Cache Discord channels for fast reference
CREATE TABLE IF NOT EXISTS discord_channels (
  id TEXT PRIMARY KEY, -- Discord channel snowflake
  circle_id UUID REFERENCES circles(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER DEFAULT 0, -- 0=text, 2=voice, 4=category, etc
  parent_id TEXT,
  position INTEGER DEFAULT 0,
  topic TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_channels_circle ON discord_channels(circle_id);

-- RLS
ALTER TABLE discord_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Circle members can view discord channels" ON discord_channels;
CREATE POLICY "Circle members can view discord channels" ON discord_channels FOR SELECT USING (
  circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
);
