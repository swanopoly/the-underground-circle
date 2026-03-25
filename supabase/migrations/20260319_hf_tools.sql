-- Migration: Hugging Face Tools Integration
-- Create table for storing circle-specific Hugging Face Spaces used as tools

create table if not exists public.circle_hf_tools (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  space_id text not null, -- e.g., 'black-forest-labs/FLUX.1-schnell'
  space_name text not null,
  api_url text, -- optional, if direct API access is available
  input_schema jsonb default '{}'::jsonb,
  output_schema jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.circle_hf_tools enable row level security;

-- Policies (using get_my_circle_ids() to avoid self-referencing RLS)
create policy "Users can view tools in their circles"
  on public.circle_hf_tools for select
  using (circle_id IN (SELECT get_my_circle_ids()));

create policy "Users can add tools to their circles"
  on public.circle_hf_tools for insert
  with check (circle_id IN (SELECT get_my_circle_ids()));

create policy "Users can delete tools in their circles"
  on public.circle_hf_tools for delete
  using (circle_id IN (SELECT get_my_circle_ids()));

-- Unique constraint: one tool per space per circle
create unique index if not exists idx_circle_hf_tools_unique
  on public.circle_hf_tools(circle_id, space_id);

-- Indexing
create index if not exists idx_circle_hf_tools_circle_id on public.circle_hf_tools(circle_id);
