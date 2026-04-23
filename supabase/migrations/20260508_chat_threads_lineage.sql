-- CA-8j: chat-thread lineage columns.
--
-- When a long chat thread gets compressed (memory-bank summary swap)
-- or forked (user clones a thread, or a branch is spun off from a
-- particular message), we lose the parent-pointer today. That means
-- the Run Ledger can't trace a long-running task across the threads
-- it lived in — every compression / fork looks like a brand-new
-- conversation.
--
-- Fix: `parent_thread_id` tracks the immediate ancestor;
-- `lineage_root_id` is denormalized so "all threads descended from
-- thread X" is a single indexed lookup instead of a recursive CTE
-- every time the ledger renders.
--
-- Backwards-compatible. Both columns default to null. Existing threads
-- are their own lineage root (implicitly — callers that don't set
-- lineage_root_id fall back to the thread's own id in application
-- code; we don't backfill at rest to keep the migration cheap).

alter table if exists circle_chat_threads
  add column if not exists parent_thread_id uuid
    references circle_chat_threads(id) on delete set null;

alter table if exists circle_chat_threads
  add column if not exists lineage_root_id uuid;

-- Index for "give me every thread in this lineage, newest first".
-- WHERE lineage_root_id IS NOT NULL keeps it small — root threads
-- are the common case and don't need the index row.
create index if not exists idx_cct_lineage_root
  on circle_chat_threads (lineage_root_id, last_message_at desc)
  where lineage_root_id is not null;

-- Index for walking parent pointers cheaply.
create index if not exists idx_cct_parent_thread
  on circle_chat_threads (parent_thread_id)
  where parent_thread_id is not null;

-- Self-referential guard: a thread can't be its own parent. Cheap
-- check that stops the obvious foot-gun (agent accidentally setting
-- parent_thread_id = id during a compression retry loop).
alter table if exists circle_chat_threads
  drop constraint if exists cct_parent_not_self;
alter table if exists circle_chat_threads
  add constraint cct_parent_not_self
  check (parent_thread_id is null or parent_thread_id <> id);
