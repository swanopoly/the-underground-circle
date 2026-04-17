create table if not exists research_documents (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references circles(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  domain_key text not null default 'general' check (domain_key in (
    'general',
    'cancer_research',
    'medical_imaging',
    'clinical_decision_support',
    'materials_science',
    'renewable_energy',
    'human_flourishing'
  )),
  title text not null,
  summary text,
  content text,
  tags text[] not null default '{}'::text[],
  source_type text not null default 'note' check (source_type in ('paper', 'dataset', 'guideline', 'note', 'report', 'website')),
  source_title text,
  source_url text,
  authors text[] not null default '{}'::text[],
  publication_date date,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed', 'validated')),
  evidence_score numeric(4,2) not null default 0.50,
  visibility text not null default 'circle_shared' check (visibility in ('private', 'circle_shared', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_research_documents_circle
  on research_documents(circle_id, updated_at desc);

create index if not exists idx_research_documents_domain
  on research_documents(domain_key, review_status, evidence_score desc);

create index if not exists idx_research_documents_visibility
  on research_documents(visibility, is_active, updated_at desc);

create index if not exists idx_research_documents_tags
  on research_documents using gin(tags);

create index if not exists idx_research_documents_metadata
  on research_documents using gin(metadata);

alter table research_documents enable row level security;

drop policy if exists research_documents_select on research_documents;
create policy research_documents_select
  on research_documents for select to authenticated
  using (
    (
      visibility = 'public'
      and is_active = true
    )
    or (
      visibility = 'circle_shared'
      and is_active = true
      and circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
    )
    or (
      visibility = 'private'
      and is_active = true
      and created_by = auth.uid()
    )
  );

drop policy if exists research_documents_insert on research_documents;
create policy research_documents_insert
  on research_documents for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      visibility = 'public'
      or circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
      or visibility = 'private'
    )
  );

drop policy if exists research_documents_update on research_documents;
create policy research_documents_update
  on research_documents for update to authenticated
  using (
    created_by = auth.uid()
    or (
      circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
      and visibility in ('circle_shared', 'public')
    )
  )
  with check (
    created_by = auth.uid()
    or (
      circle_id in (
        select circle_id from circle_members where user_id = auth.uid()
      )
      and visibility in ('circle_shared', 'public')
    )
  );

drop policy if exists research_documents_delete on research_documents;
create policy research_documents_delete
  on research_documents for delete to authenticated
  using (
    created_by = auth.uid()
  );

create or replace function update_research_documents_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists trg_research_documents_updated_at on research_documents;
create trigger trg_research_documents_updated_at
  before update on research_documents
  for each row execute function update_research_documents_updated_at();

do $$
begin
  begin
    alter publication supabase_realtime add table research_documents;
  exception when duplicate_object then null;
  end;
end;
$$;

notify pgrst, 'reload schema';
