-- ─── Room Files: multi-file support per Room ─────────────────────────────
-- Each room now holds a full file tree, not just one content field.
-- Existing circle_rooms.content is preserved for backward compat.

CREATE TABLE IF NOT EXISTS room_files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  name         text        NOT NULL,                          -- filename e.g. "auth.ts"
  folder       text        NOT NULL DEFAULT '/',              -- virtual folder e.g. "/src/components"
  file_type    text        NOT NULL DEFAULT 'typescript',     -- matches FileType enum
  content      text        NOT NULL DEFAULT '',
  storage_url  text,                                          -- for binary files in Supabase Storage
  mime_type    text,
  size_bytes   bigint      NOT NULL DEFAULT 0,
  tags         text[]      NOT NULL DEFAULT '{}',
  created_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  is_deleted   boolean     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_room_files_room_id  ON room_files(room_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_room_files_folder   ON room_files(room_id, folder) WHERE NOT is_deleted;

ALTER TABLE room_files ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_files' AND policyname='room_files_select') THEN
    CREATE POLICY room_files_select ON room_files FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_files.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_files' AND policyname='room_files_insert') THEN
    CREATE POLICY room_files_insert ON room_files FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_files.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_files' AND policyname='room_files_update') THEN
    CREATE POLICY room_files_update ON room_files FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_files.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE room_files;

-- ─── Room Secrets: encrypted KV store per Room ───────────────────────────
CREATE TABLE IF NOT EXISTS room_secrets (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  key       text        NOT NULL,
  value     text        NOT NULL,  -- store encrypted on client, base64 here
  created_by uuid       REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(room_id, key)
);

ALTER TABLE room_secrets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_secrets' AND policyname='room_secrets_own') THEN
    CREATE POLICY room_secrets_own ON room_secrets FOR ALL USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_secrets.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- ─── Room usage tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_usage (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  agent_name text,
  user_id    uuid        REFERENCES auth.users(id),
  event_type text        NOT NULL,   -- 'file_read' | 'file_write' | 'message' | 'agent_task'
  tokens     int         DEFAULT 0,
  cost_usd   numeric(10,6) DEFAULT 0,
  metadata   jsonb       DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_usage_room_id ON room_usage(room_id);
ALTER TABLE room_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_usage' AND policyname='room_usage_select') THEN
    CREATE POLICY room_usage_select ON room_usage FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_usage.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_usage' AND policyname='room_usage_insert') THEN
    CREATE POLICY room_usage_insert ON room_usage FOR INSERT WITH CHECK (true);
  END IF;
END $$;
