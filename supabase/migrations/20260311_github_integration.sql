-- ─────────────────────────────────────────────────────────────────────────────
-- GitHub Integration — Connect repos to circles, receive webhooks
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── circle_github_connections ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS circle_github_connections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  connected_by    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- GitHub identifiers
  owner           text        NOT NULL,   -- GitHub username/org
  repo            text        NOT NULL,   -- Repository name
  full_name       text        NOT NULL,   -- owner/repo
  default_branch  text        DEFAULT 'main',

  -- Webhook
  webhook_id      bigint,                 -- GitHub webhook ID (for cleanup)
  webhook_secret  text        NOT NULL,   -- Secret for HMAC verification

  -- Config
  events_enabled  text[]      DEFAULT ARRAY['push', 'pull_request', 'issues', 'release', 'workflow_run'],
  notify_chat     boolean     NOT NULL DEFAULT true,   -- Post events to circle chat
  notify_activity boolean     NOT NULL DEFAULT true,   -- Post to agent_activity feed

  -- State
  is_active       boolean     NOT NULL DEFAULT true,
  last_event_at   timestamptz,
  event_count     integer     NOT NULL DEFAULT 0,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE(circle_id, owner, repo)
);

CREATE INDEX idx_github_conn_circle ON circle_github_connections(circle_id);
CREATE INDEX idx_github_conn_repo ON circle_github_connections(owner, repo) WHERE is_active = true;

ALTER TABLE circle_github_connections ENABLE ROW LEVEL SECURITY;

-- Circle members can read connections
CREATE POLICY "circle_members_read_github"
  ON circle_github_connections FOR SELECT
  USING (
    circle_id IN (SELECT get_my_circle_ids())
  );

-- Only the person who connected (or circle creator) can manage
CREATE POLICY "connector_manages_github"
  ON circle_github_connections FOR ALL
  USING (connected_by = auth.uid())
  WITH CHECK (connected_by = auth.uid());

CREATE POLICY "circle_creator_manages_github"
  ON circle_github_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM circle_members
      WHERE circle_members.circle_id = circle_github_connections.circle_id
        AND circle_members.user_id = auth.uid()
        AND circle_members.role = 'creator'
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_github_connections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER github_connections_updated_at
  BEFORE UPDATE ON circle_github_connections
  FOR EACH ROW EXECUTE FUNCTION update_github_connections_updated_at();


-- ─── circle_github_events ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS circle_github_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  connection_id   uuid        NOT NULL REFERENCES circle_github_connections(id) ON DELETE CASCADE,

  -- Event metadata
  event_type      text        NOT NULL,   -- push, pull_request, issues, release, workflow_run
  action          text,                   -- opened, closed, merged, completed, etc.
  delivery_id     text,                   -- X-GitHub-Delivery header (idempotency)

  -- Parsed summary (for quick display without re-parsing payload)
  title           text        NOT NULL,   -- Human-readable one-liner
  body            text,                   -- Longer description
  author          text,                   -- GitHub username who triggered
  author_avatar   text,                   -- Avatar URL
  url             text,                   -- Link to PR/commit/issue on GitHub
  ref             text,                   -- Branch name or tag

  -- Stats (for push events)
  commits_count   integer     DEFAULT 0,
  additions       integer     DEFAULT 0,
  deletions       integer     DEFAULT 0,

  -- Full payload (for deep inspection)
  payload         jsonb       DEFAULT '{}',

  -- Whether BlackSwan has processed this event
  processed       boolean     NOT NULL DEFAULT false,
  processed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_github_events_circle ON circle_github_events(circle_id, created_at DESC);
CREATE INDEX idx_github_events_conn ON circle_github_events(connection_id, created_at DESC);
CREATE INDEX idx_github_events_unprocessed ON circle_github_events(circle_id, processed)
  WHERE processed = false;
CREATE UNIQUE INDEX idx_github_events_delivery ON circle_github_events(delivery_id)
  WHERE delivery_id IS NOT NULL;

ALTER TABLE circle_github_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_members_read_github_events"
  ON circle_github_events FOR SELECT
  USING (
    circle_id IN (SELECT get_my_circle_ids())
  );

-- Service role inserts events (edge function)
CREATE POLICY "service_role_manage_github_events"
  ON circle_github_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE circle_github_events;

NOTIFY pgrst, 'reload schema';
