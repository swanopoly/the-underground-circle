-- ─── Room Messages ────────────────────────────────────────────────────────────
-- Chat, agent tasks, system events, playground runs — all scoped to a Room.

CREATE TABLE IF NOT EXISTS room_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES auth.users(id),
  agent_name   text,
  content      text        NOT NULL DEFAULT '',
  message_type text        NOT NULL DEFAULT 'chat'
                           CHECK (message_type IN ('chat','agent_output','edit_event','system','playground')),
  metadata     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON room_messages(room_id, created_at DESC);

ALTER TABLE room_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_messages' AND policyname='room_messages_select') THEN
    CREATE POLICY room_messages_select ON room_messages FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_messages.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_messages' AND policyname='room_messages_insert') THEN
    CREATE POLICY room_messages_insert ON room_messages FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_messages.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE room_messages;

-- ─── Room Services ─────────────────────────────────────────────────────────────
-- Persistent services deployed to a Room (agents, tools, webhooks, scheduled)

CREATE TABLE IF NOT EXISTS room_services (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  type        text        NOT NULL DEFAULT 'agent'
              CHECK (type IN ('agent','tool','webhook','scheduled')),
  status      text        NOT NULL DEFAULT 'stopped'
              CHECK (status IN ('running','stopped','error','deploying')),
  description text,
  endpoint    text,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_services_room_id ON room_services(room_id);
ALTER TABLE room_services ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_services' AND policyname='room_services_all') THEN
    CREATE POLICY room_services_all ON room_services FOR ALL USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_services.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- ─── Room Tasks ────────────────────────────────────────────────────────────────
-- Scheduled / one-shot agent tasks tied to a Room

CREATE TABLE IF NOT EXISTS room_tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES circle_rooms(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  schedule    text        NOT NULL DEFAULT 'once',
  agent       text        NOT NULL DEFAULT 'Assistant',
  prompt      text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_tasks_room_id ON room_tasks(room_id);
ALTER TABLE room_tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_tasks' AND policyname='room_tasks_all') THEN
    CREATE POLICY room_tasks_all ON room_tasks FOR ALL USING (
      EXISTS (
        SELECT 1 FROM circle_rooms r
        JOIN circle_members m ON m.circle_id = r.circle_id
        WHERE r.id = room_tasks.room_id AND m.user_id = auth.uid()
      )
    );
  END IF;
END $$;
