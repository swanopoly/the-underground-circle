# MEMORY.md — The Underground Circle

> Persistent project memory for AI agents. Decisions, lessons, context, gotchas.
> Updated: 2026-02-28

---

## Project Identity

- **App:** The Underground Circle
- **Mission:** Human accountability layer for the AI-agent era. Small crews (5–8) watch each other's AI agents build in real time. Mixed circles — devs, creators, operators, researchers.
- **Owner:** Swan (Chris Swanson) — family man, fullstack dev, building real income
- **Live:** https://app.chrisswanson.xyz
- **Repo:** github.com/swanopoly/the-underground-circle
- **Local path:** /home/swan/the-underground-circle
- **Windows source:** C:\Users\chris\OneDrive\Desktop\Swan\Projects\the-underground-circle (slow — always use WSL native fs)

---

## Stack Decisions

- **Expo 54 + React Native 0.81.5 + React 19** — targeting web first, mobile later
- **Supabase** for everything backend (Auth, Postgres, Realtime, Edge Functions)
- **TypeScript** throughout
- **Netlify** for web deploy
- **No custom relay needed for presence** — Supabase Realtime handles fan-out natively

---

## Environment Facts

- Supabase project: `rjkniqiqdtroeholxacg.supabase.co`
- CORS proxy runs on port 18790 (`scripts/openclaw-proxy.js`) — HTTP + WebSocket support
- Dev server: localhost:8081
- Nav state persisted to localStorage key `uc_nav_state_v1`
- SwanBot activity circle "THE END": `fcccaa73-2d48-4a90-8c19-c556b19f89dc`
- Swan's SOL wallet: `6bEnGK9g638PXeGUKLxNGRXikSxk54G4eX6zXrm7QrzT`

---

## Schema Gotchas (burn these into memory)

| Table | Gotcha |
|---|---|
| `circle_office_agents` | NO `model` column. Owner FK is `owner_id` NOT `owner_user_id` |
| `user_xp` | Primary key is `user_id`, NOT `id` |
| `profiles` | No `email` column — use `auth.users` for email. Join on `display_name, username` |
| `room_messages` | `message_type` CHECK constraint: must be `chat\|agent_output\|edit_event\|system\|playground` |
| `circle_office_agents` status | Values: `idle \| building \| offline` only |

---

## Migrations Run in Supabase

| Migration | Status |
|---|---|
| 20260225_circle_office.sql | ✅ run |
| 20260225_office_cron_sweeper.sql | ⚠️ NOT RUN — pg_cron sweeper |
| 20260226_hitl.sql | ✅ run |
| 20260226_rewards.sql | ✅ run |
| 20260226_office_terminal.sql | ✅ run |
| 20260227_room_files.sql | ✅ run |
| 20260227_room_messages.sql | ✅ run |
| 20260227_atomic_xp.sql | ✅ run |

### ⚠️ pg_cron sweeper — still needs to be run in Supabase SQL Editor:
```sql
create extension if not exists pg_cron;
create or replace function sweep_offline_agents() returns void language plpgsql security definer as $$
begin
  update circle_office_agents set status = 'offline', updated_at = now()
  where status in ('idle', 'building') and last_active_at is not null
  and last_active_at < now() - interval '3 minutes' and is_published = true;
end; $$;
select cron.schedule('sweep-offline-agents', '*/2 * * * *', 'select sweep_offline_agents()');
create index if not exists idx_circle_office_agents_last_active on circle_office_agents (last_active_at) where is_published = true;
grant execute on function sweep_offline_agents() to postgres;
```

---

## Architecture Decisions

### Agent Presence (Two-Layer)
- **Layer 1:** Supabase Realtime Presence — ephemeral, channel `circle:{circleId}`, 25s keepalive
- **Layer 2:** Postgres `circle_office_agents` — durable, 30s DB heartbeat
- Connection state machine: 🟡 Connecting → 🟢 Live → 🟡 Reconnecting → ⚫ Offline
- Reconnect: exponential backoff, start 1s, ×2, +jitter, cap 5 min
- Three layers total: client heartbeat + Realtime presence + pg_cron server sweeper

### CORS Proxy
- `openclaw-proxy.js` on port 18790 — supports HTTP + WebSocket upgrades
- Old proxy was HTTP-only; rewrote with `ws.Server` to fix Realtime failures
- All Realtime connections in dev route through here

### Solana RPC
- Use `solana-rpc.publicnode.com` (CORS-friendly)
- `api.mainnet-beta.solana.com` and `rpc.ankr.com` return 403 in browser — do NOT use
- Phantom injects `window.ethereum` — always check `!eth.isPhantom` before treating as MetaMask
- Disconnect sequence: `phantom.disconnect()` + `wallet_revokePermissions` → then clear Supabase

### Model Cost Pricing (officeAgents.ts MODEL_PRICING)
- Longest-key match, strips `anthropic/`/`google/` prefixes
- Opus 4.6: $20/$100 per M tokens +25% buffer = $25/$125
- XP per turn: Opus=10, Sonnet=5, Haiku=2

### Office Terminal
- 3 Supabase channels per circle (command broadcast, response broadcast, DB realtime)
- Positions stored as 0.0–1.0 floats (% canvas size — universal across screen sizes)
- `getOrCreateCommandChannel` has 5s timeout

### BYOA Endpoints
- Webhook: `https://app.chrisswanson.xyz/api/webhook/{circleId}`
- MCP: `https://app.chrisswanson.xyz/mcp/{circleId}`

---

## Features Shipped (chronological)

### 2026-02-25
- circle_office_agents table + Shared Office System
- agentHeartbeat.ts + agentPresence.ts (two-layer presence)
- StepAwayCard — "Step Away & Hand Off" ritual in ChatTab
- 4 new circle types: Builder 🚀, Creator ✍️, Operator 💼, Researcher 🔬
- Universal check-in language (works for devs AND non-devs)
- CircleOfficePanel (mobile full cards + desktop compact strip)
- War Room tab removed — energy consolidated in Office tab
- PixelOfficeCanvas, OfficeAnalyticsPanel, OfficeTerminal
- office_terminal_messages table + 11 analytics columns on agents
- ManualPublishModal + publish flow decoupled from gateway connection
- Cost tracking fix: MODEL_PRICING lookup table replaces single estimateCost fn

### 2026-02-26
- Agent Activity Feed (agent_activity table + AgentActivityFeed.tsx + hook script)
- Whiteboard consolidated: 9 modes → 4 (Overview, Activity, Ops, Agent Log)
- Project Rooms v1 (project_rooms, project_room_agents, project_room_activity tables)
- Wallet overhaul: Solana RPC fix, Phantom detection fix, disconnect fix, CoinGecko fallback
- Nav state persistence fix (uc_nav_state_v1)
- HITL Kill Switches (HitlApprovalBanner, AgentKillSwitch, agent_approvals, agent_controls)
- BYOA Panel (webhook + MCP + 6 provider cards)
- Agent Templates (6 templates, deploy logs to agent_activity)
- Shared Memory (SharedMemoryPanel, sharedMemory.ts, circle_memory table)
- Halo Reward System (14 ranks Recruit→Demon, badges, confetti, dance animation)
- Agent card real data (uptimeHours, turns, tokens, cache hit %, session key shown)
- Agent connection fix: removed localhost skip bug (was silently failing in production)
- Floor filter fix + auto-assign to currentFloor
- Hooks order fix (useAgentControl moved before early return)
- Thought bubble overhaul: data-driven (XP, cost, cache %, model tier), weighted random pool
- 23 furniture items (10→23) across 4 categories

### 2026-02-27
- RoomsTab.tsx full rebuild (~3100 lines)
  - Multi-file tree, tabs, upload/drag-drop, download
  - CanvasViewer — Miro-style sticky notes (drag, color picker, debounced save 600ms)
  - PlaygroundPanel — Langfuse-style prompt A/B (variants, model selector, variable interpolation)
  - ChatPanel — agent selector, file context, task dispatch
  - SessionsPanel — logs/traces/metrics from room_usage (realtime)
  - ServicesPanel + TasksPanel — persist to Supabase
- room-task-executor edge function (written, NOT yet deployed)
- 3 migrations: room_files, room_messages, atomic_xp ✅
- award_xp RPC + sync_points_to_xp trigger
- Whiteboard: 3 new modes added (coding_agents 🤖, audit 📜, circle_log 🏛️)

---

## Pending / Blocked

| Item | Notes |
|---|---|
| pg_cron sweeper SQL | SQL above — paste into Supabase SQL Editor |
| room-task-executor deploy | `npx supabase login` then deploy edge function |
| award_points RPC 400 | Possibly needs points_transactions table confirmed |
| circle_office_agents upsert 400 | AgentPanel bug, unrelated to Rooms |
| step_away_sessions table | Not yet created — needed to track open handoffs |

---

## Known Pre-existing Issues (safe to ignore)

- Solana RPC 403s in console — using publicnode workaround
- TS errors in: `ProfileScreen.tsx`, `OfficeChat.tsx`, `PhotonProofCheck.tsx`, `CostDashboard.tsx`, `circleOffice.ts` (circle_image_url null)

---

## TypeScript Patterns & Pitfalls

```tsx
// ✅ correct profile join
.select('*, profiles(display_name, username)')

// ❌ wrong — no email column on profiles
.select('*, profiles(email)')

// ✅ correct user_xp upsert
.upsert({ user_id: uid, xp: 0 }, { onConflict: 'user_id' })

// ❌ wrong — id is not the PK
.upsert({ id: uid, xp: 0 })

// ✅ ArrowScrollView
<ArrowScrollView style={outerStyle} scrollStyle={innerStyle}>

// ✅ CSS in RN — no shorthand
backgroundImage, outlineWidth + outlineStyle (not outline)
```

---

## Git State

- Branch: main
- Remote: git@github.com:swanopoly/the-underground-circle.git
- Last commit: 48c2373 "fix: animation CSS classes, room-task-executor edge function"

---

## Roadmap (Not Yet Built)

- `step_away_sessions` Supabase table
- Agent Budget Social Contract — weekly spend shared with circle
- Weekly Direction Session — AI-summarized, human-confirmed Friday ritual
- "Is This Still The Right Thing?" 90-min circuit breaker
- Circle matching by agent stack + MRR stage
- Session timeline view — visual agent session history for circle
- Phase 3: Cross-machine tool invocation via Supabase Broadcast relay
- @all multi-agent terminal responses (one row per responding agent)
- Cowork task visibility — share recurring Cowork tasks to circle
