-- Phase 3: Store gateway URL per agent for cross-machine invocation

alter table circle_office_agents
  add column if not exists gateway_url text,
  add column if not exists is_public   boolean not null default false;

comment on column circle_office_agents.gateway_url is
  'http://localhost:18790 for local-only agents, public URL (Cloudflare/ngrok) for cross-machine';
comment on column circle_office_agents.is_public is
  'true = reachable cross-machine via gateway_url; false = local only, status-visible but not invocable';
