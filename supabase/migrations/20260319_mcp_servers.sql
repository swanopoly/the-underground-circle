-- Migration: MCP Host Integration
-- Create table for storing external MCP servers registered in a circle

create table if not exists public.circle_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  name text not null,
  url text not null, -- Endpoint for HTTP or SSE
  type text not null check (type in ('sse', 'http')),
  status text default 'active',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.circle_mcp_servers enable row level security;

-- Policies (using get_my_circle_ids() to avoid self-referencing RLS)
create policy "Users can view MCP servers in their circles"
  on public.circle_mcp_servers for select
  using (circle_id IN (SELECT get_my_circle_ids()));

create policy "Users can register MCP servers in their circles"
  on public.circle_mcp_servers for insert
  with check (circle_id IN (SELECT get_my_circle_ids()));

create policy "Users can delete MCP servers in their circles"
  on public.circle_mcp_servers for delete
  using (circle_id IN (SELECT get_my_circle_ids()));

-- Indexing
create index if not exists idx_circle_mcp_servers_circle_id on public.circle_mcp_servers(circle_id);
