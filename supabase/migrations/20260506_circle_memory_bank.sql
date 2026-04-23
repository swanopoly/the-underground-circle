-- circle_memory bank — Phase CA-5 (Cline-inspired "memory bank" pattern).
--
-- Today `circle_memory` stores one free-form doc per circle
-- (`circle_id` is UNIQUE). We split that into three named docs:
--
--   brief          — stable "what is this circle" summary
--   active_context — what the crew is working on right now
--   progress       — what has shipped / what remains
--
-- Rationale: Cline's memory-bank workflow splits context by topic so
-- the model reads only the doc relevant to the question (lower token
-- burn, less irrelevant noise). Three docs is a deliberate minimum —
-- Cline uses six; we add only what the product actually needs.
--
-- Change plan, idempotent:
--   1. Add `doc_kind text` column, default 'brief', to `circle_memory`
--      + `circle_memory_history`.
--   2. Drop the old UNIQUE constraint on `circle_memory.circle_id`.
--   3. Add composite UNIQUE `(circle_id, doc_kind)` so each doc_kind
--      has exactly one row per circle.
--   4. Backfill any NULL doc_kind rows (defensive — `NOT NULL DEFAULT`
--      covers new inserts).

-- ─── circle_memory ────────────────────────────────────────────────────────
alter table circle_memory
  add column if not exists doc_kind text not null default 'brief';

update circle_memory set doc_kind = 'brief' where doc_kind is null;

-- Drop the old (circle_id)-only unique constraint. Name depends on how
-- postgres auto-generated it; `circle_memory_circle_id_key` is the default.
alter table circle_memory drop constraint if exists circle_memory_circle_id_key;

-- Composite unique so the app can hit `(circle_id, doc_kind)` directly.
-- Wrapped in DO block so re-runs are idempotent even if the constraint
-- already exists under a different auto-generated name.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'circle_memory_circle_doc_kind_key'
      and conrelid = 'circle_memory'::regclass
  ) then
    alter table circle_memory
      add constraint circle_memory_circle_doc_kind_key
      unique (circle_id, doc_kind);
  end if;
end $$;

-- Allowed-value guard so a typo like 'briefly' never creates a ghost doc.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'circle_memory_doc_kind_check'
      and conrelid = 'circle_memory'::regclass
  ) then
    alter table circle_memory
      add constraint circle_memory_doc_kind_check
      check (doc_kind in ('brief', 'active_context', 'progress'));
  end if;
end $$;

-- ─── circle_memory_history ────────────────────────────────────────────────
alter table circle_memory_history
  add column if not exists doc_kind text not null default 'brief';

update circle_memory_history set doc_kind = 'brief' where doc_kind is null;

-- ─── Indexes for the hot read path ────────────────────────────────────────
-- `(circle_id, doc_kind)` is already covered by the unique constraint
-- on circle_memory. Just add a convenience index on the history table
-- since queries filter by (circle_id, doc_kind, version DESC).
create index if not exists idx_circle_memory_history_circle_doc_version
  on circle_memory_history (circle_id, doc_kind, version desc);

notify pgrst, 'reload schema';
