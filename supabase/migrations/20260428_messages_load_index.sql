-- Faster chat load: a composite index on (circle_id, thread_id, created_at)
-- exactly matches the loadThreadMessages query used by ChatTab on every
-- refresh. Without this, Postgres had to use one of two less-specific
-- indexes (idx_messages_circle_created or idx_messages_thread_recent) and
-- filter the other column at runtime. With it, the query is a single
-- index range scan.
--
-- Uses CREATE INDEX CONCURRENTLY-style safety via IF NOT EXISTS; skip
-- CONCURRENTLY to stay inside a transaction.

CREATE INDEX IF NOT EXISTS idx_messages_circle_thread_created
  ON messages (circle_id, thread_id, created_at ASC);

-- Supabase caches planner stats; give it a hint that this index is fresh.
ANALYZE messages;

NOTIFY pgrst, 'reload schema';
