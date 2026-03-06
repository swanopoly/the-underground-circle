-- ─── automation_memory_notes ────────────────────────────────────────────────
-- Memory notes attached to automations. Content is injected into the AI prompt
-- as additional context when the automation runs.

create table if not exists public.automation_memory_notes (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references public.circle_automations(id) on delete cascade,
  circle_id       uuid not null references public.circles(id) on delete cascade,
  title           text not null,
  content         text not null default '',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Index for fast lookups by automation
create index if not exists idx_memory_notes_automation
  on public.automation_memory_notes(automation_id);

-- Index for circle-level queries
create index if not exists idx_memory_notes_circle
  on public.automation_memory_notes(circle_id);

-- Updated_at trigger
create or replace function public.set_memory_notes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_memory_notes_updated_at on public.automation_memory_notes;
create trigger trg_memory_notes_updated_at
  before update on public.automation_memory_notes
  for each row execute function public.set_memory_notes_updated_at();

-- RLS
alter table public.automation_memory_notes enable row level security;

-- Circle members can read notes for their circles
create policy "circle members can read memory notes"
  on public.automation_memory_notes for select
  using (
    exists (
      select 1 from public.circle_members cm
      where cm.circle_id = automation_memory_notes.circle_id
        and cm.user_id = auth.uid()
    )
  );

-- Circle members can insert/update/delete notes
create policy "circle members can manage memory notes"
  on public.automation_memory_notes for all
  using (
    exists (
      select 1 from public.circle_members cm
      where cm.circle_id = automation_memory_notes.circle_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.circle_members cm
      where cm.circle_id = automation_memory_notes.circle_id
        and cm.user_id = auth.uid()
    )
  );

-- Service role bypass
create policy "service role bypass memory notes"
  on public.automation_memory_notes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
