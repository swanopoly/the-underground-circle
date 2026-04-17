# CLAUDE.md — The Underground Circle

> Comprehensive project context for AI agents (Claude Code, OpenSwan, Codex, etc.)
> Last updated: 2026-04-11 (Missions system, memory overhaul, discovery, notifications)

### Circle Missions — The Core Accountability Loop
Missions live inside the Feed tab as a center panel sub-tab. See `docs/NEXT_LEVEL_PLAN.md` for the full plan.

**Mission System (built 2026-04-10/11):**
- `supabase/migrations/20260410_circle_missions.sql` — 4 tables: circle_missions, mission_tasks, mission_agents, proof_of_work + RLS ✅ RUN
- `src/lib/missions.ts` — Full CRUD, realtime subscriptions, React hooks, helpers
- `src/lib/missionTemplates.ts` — 8 pre-built templates (Dev Sprint, Bug Hunt, Content Push, etc.)
- `src/lib/missionChatCommands.ts` — /mission, /summary, /help slash commands
- `src/lib/missionAgentDispatch.ts` — Send tasks to BlackSwan for execution
- `src/lib/missionStreaks.ts` — Daily task completion streaks with milestones + bonus XP
- `src/lib/proofOfWork.ts` — Auto-generate feed entries from GitHub events + agent runs
- `src/screens/circles/tabs/MissionsTab.tsx` — Full mission UI inside Feed center panel
- `src/components/MissionCelebration.tsx` — Confetti animation on mission completion
- `src/components/Toast.tsx` — Toast notification system (ToastProvider in App.tsx)
- `src/lib/notifications.ts` — Push notifications via expo-notifications + browser API

**Features:**
- Mission list with status cards, progress rings, filter pills
- Mission detail with task checkboxes, member assignment dropdown, agent Run button, inline editing
- 8 templates with category filters (Dev, Content, Ops, Learning, General)
- /mission status report in chat, /summary full circle report, /help command list
- Task completion → proof-of-work entry + streak update + toast + push notification
- Mission completion → celebration animation + notification
- GitHub webhook auto-creates proof-of-work entries
- BlackSwan system prompt includes active mission context
- 4 mission automation templates (daily digest, overdue nudge, weekly retro, completion celebration)
- Smart default tab (Feed opens when circle has active missions)
- Mission count badge in AppHeader
- Circle list shows active mission count
- Per-tab colors with animated pulsing dots (each tab has unique color)

**Gated Features:**
Only WALLET tab is gated via `GATED_TABS` in CircleDetailScreen. BACKPACK is restored.

**New Screens:**
- `src/screens/auth/LandingPage.tsx` — Marketing landing page for unauthenticated visitors
- `src/screens/circles/DiscoverScreen.tsx` — Browse and join public circles at /discover

**Memory Architecture (overhauled 2026-04-11):**
- Session memories: only 3 most recent get retrieval_mode='startup', rest are 'on_demand'
- Startup bundle capped at 3000 chars, system prompt extras capped at 4000 chars
- circle_memory RLS fixed (was USING(true), now requires circle membership)
- blackswan_memory table dropped (legacy, unused)
- Session cleanup cron: deactivates >30 day old sessions, demotes >14 day startup sessions
- Unique index prevents duplicate session memories from race conditions
- Removed all references to non-existent 'status' column on memory_entries
- saveMemory() return values now checked, silent catch blocks now log warnings
- circles.settings column added for sessionMemoryMode configuration

---

## STRATEGIC FOCUS — READ THIS FIRST

**The app's killer feature: Your team gets a shared AI agent (BlackSwan) that watches your GitHub repo, tracks who's shipping, catches when things break, and keeps everyone honest — no more standups.**

Target: Small dev teams (2-5 people) building side projects together.

### Priority 1: GitHub Integration + AI Agent Loop
This is THE feature. Everything else is secondary until this works end-to-end.

**Current state:**
- `src/lib/github.ts` — GitHub REST API + OAuth integration — WORKS ✅
- `supabase/functions/github-oauth/` — OAuth edge function (authorize + callback) — WORKS ✅
- `supabase/functions/github-webhook/` — Webhook receiver for push/PR/CI events — WORKS ✅
- `circle_github_events` table — stores webhook payloads per circle — WORKS ✅
- `circle_github_connections` table — tracks connected repos + webhook IDs — WORKS ✅
- GitHubTab — OAuth as primary connect method, PAT as fallback — WORKS ✅
- IntegrationsTab — GitHub as first-class platform alongside Slack/Teams/Discord — WORKS ✅
- BlackSwan reads GitHub events — `github_summary` automation posts shipping summaries — WORKS ✅
- Invite link flow — `src/lib/invites.ts` + `/join/:code` URL handling in App.tsx — WORKS ✅
- Onboarding flow — 3-step modal (welcome → GitHub → invite) for new users — WORKS ✅
- BlackSwan nudge inactive members — automation template + executor support — WORKS ✅
- BlackSwan deploy failure alerts — automation template + executor support — WORKS ✅
- RoomsTab has "GitHub" panel for browsing repo files — WORKS ✅
- Automation system with pg_cron + edge function executor — WORKS ✅
- BlackSwan AI edge function with full circle context — WORKS ✅

**What still needs work:**
1. **Run pending migrations** — `20260318_pending_items.sql` (pg_cron sweeper + step_away_sessions) via Supabase SQL Editor
2. **Deploy updated edge functions** — `npx supabase functions deploy automation-executor`
3. **Test end-to-end OAuth flow** — authorize → callback → token stored → repos listed
4. **Test webhook delivery** — push to connected repo → event in circle_github_events → BlackSwan summary

### Priority 2: BlackSwan Proactive Agent ✅ BUILT
- Daily/weekly shipping summaries from real GitHub data ✅
- Nudge members who haven't pushed code ✅ (nudge-inactive-members template)
- Auto-detect deploy failures and alert the team ✅ (deploy-failure-alert template)

### Priority 3: Onboarding ✅ BUILT
- First-run UX that shows value in <60 seconds ✅ (OnboardingFlow component)
- Working invite links ✅ (invites.ts + App.tsx URL handling)

### What is DEPRIORITIZED (don't build new stuff here):
- Games, room customization, furniture — culture layer, not core
- LLM benchmarks, BYO API keys — dev tools
- Wallet/crypto, BlackSwan LLM training — nice-to-have

### Quality Standards
- Always run `npx tsc --noEmit --skipLibCheck` after changes
- Deploy edge functions after fixes: `npx supabase functions deploy <name>`
- SQL changes go through Supabase SQL Editor (migration system is broken)
- Keep CLAUDE.md and memory/MEMORY.md updated every session
- After DB schema changes: `NOTIFY pgrst, 'reload schema'`

---

## Project Overview

**The Underground Circle** is a shared AI agent platform for dev teams. Connect your GitHub repo, and BlackSwan (your circle's AI) watches commits, PRs, and CI — then keeps your team honest about shipping.

It's the **AI-powered project manager nobody asked to be**. Small crews (2-8 people). BlackSwan watches the code. Everyone ships.

- **Live URL:** https://app.chrisswanson.xyz
- **Repo:** github.com/swanopoly/the-underground-circle
- **Owner:** Swan (Chris Swanson)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React Native + Expo 54 (Web, iOS, Android) |
| Language | TypeScript |
| React | React 19 + React Native 0.81.5 |
| Backend | Supabase (Auth, Postgres, Realtime, Edge Functions) |
| AI/Agents | OpenSwan multi-agent + Claude Code + Codex |
| Crypto | ethers.js (Ethereum) + @solana/web3.js (Solana) |
| Web Deploy | Netlify |
| Mobile Deploy | Expo EAS |
| Dev Proxy | openswan-proxy.js (port 18790, WebSocket + auto-auth) |
| BlackSwan Mini | Qwen2.5-7B fine-tune via Unsloth QLoRA → Ollama (v4) |
| BlackSwan LLM | Qwen3.5-27B fine-tune via Unsloth QLoRA → Ollama (v5, planned) |
| Claude Code Bridge | scripts/claude-bridge.js (port 7778) |

---

## Agent Memory

On session start, read `.agent-memory/context.md` if it exists — it contains memories synced from Supabase (decisions, preferences, session context, skills). To refresh: `npm run sync-memories`.

The memory file is auto-generated. Don't edit it directly. To add memories, use the Agent Panel Memory tab in the app, or chat with BlackSwan and it will extract them automatically.

If `.agent-memory/context.md` doesn't exist, run `node scripts/sync-memories.js` to create it. The bridge also serves memories at `http://localhost:7778/memory`.

## Environment

- **Supabase project:** rjkniqiqdtroeholxacg.supabase.co
- **Supabase URL:** https://rjkniqiqdtroeholxacg.supabase.co
- **CORS proxy:** http://localhost:18790 (run: npm run proxy)
- **Dev server:** http://localhost:8081

Required .env:
```
EXPO_PUBLIC_SUPABASE_URL=https://rjkniqiqdtroeholxacg.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
EXPO_PUBLIC_GEMINI_API_KEY=<key>
```

---

## Dev Commands

```bash
npm run web              # Web dev server (localhost:8081)
npm run start            # Expo dev server (all platforms)
npm run build            # Production web build (expo export --platform web)
npm run dev              # start-dev.js — starts Expo + Bridge + Proxy together
npm run proxy            # OpenSwan CORS/WS proxy on port 18790
npm run generate-sprites # Generate pixel art PNGs for office themes

# BlackSwan Mini (v4) — 7B model, runs on any machine with GPU
cd scripts/blackswan-llm
bash run_v4_pipeline.sh  # Full pipeline: download → prepare → SFT → DPO → deploy

# BlackSwan Full (v5) — 27B model, needs 64GB+ unified memory (Mac) or multi-GPU
bash run_v5_pipeline.sh  # Same data, bigger model
bash run_v5_pipeline.sh --small  # 9B fallback if not enough memory
```

---

## Project Structure

```
src/
  screens/
    auth/                    # Login, SignUp
    circles/
      tabs/
        ChatTab.tsx          # Circle chat + StepAwayCard handoff ritual
        OfficeTab.tsx        # AI agent office hub (sub-tabs: office/canvas/analytics/terminal)
        CheckInTab.tsx       # Daily check-ins (universal language, not dev-centric)
        RoomsTab.tsx         # Project Rooms (~3100 lines — full rebuild 2/27)
        ProofTab.tsx         # Proof of Work submissions
        LeaderboardTab.tsx   # XP rankings
      CircleScreen.tsx
      CreateCircleScreen.tsx # 4 circle types: Builder/Creator/Operator/Researcher
    agents/                  # Agent management screens
    wallet/                  # Ethereum + Solana wallet UI
    profile/                 # ProfileScreen.tsx
  components/
    # Office / Agent UI
    PixelOfficeCanvas.tsx    # Miro-style pixel art office, draggable agents
    CircleOfficePanel.tsx    # Shared office panel (mobile cards + desktop strip)
    AgentActivityFeed.tsx    # Live scrolling agent activity feed
    HitlApprovalBanner.tsx   # Floating HITL approve/reject banner (amber, countdown)
    AgentKillSwitch.tsx      # Pause/resume, spend limits, per-action approval toggles
    HaloBadge.tsx            # Hexagon/shield/star/diamond/circle badge shapes + glow
    BadgeCelebration.tsx     # Full-screen confetti (60 particles) + shockwave on rank-up
    RewardsPanel.tsx         # XP stats, current rank, badge grid, tier filter
    StepAwayCard.tsx         # "Step Away & Hand Off" ritual UI
    SharedMemoryPanel.tsx    # Editable shared doc, version history, realtime
    ProjectRoomsPanel.tsx    # Project rooms with agent pills + activity feed
    OfficeAnalyticsPanel.tsx # Realtime analytics, All/My toggle, 6 stat cards
    OfficeTerminal.tsx       # Dark terminal, @all/@agent targeting
    # Inside RoomsTab.tsx (~3100 lines):
    #   CanvasViewer         Miro-style sticky note whiteboard (drag, color, save)
    #   PlaygroundPanel      Langfuse-style prompt A/B editor (variants, model selector)
    #   ChatPanel            Agent selector + file context + task dispatch
    #   SessionsPanel        Logs/traces/metrics (room_usage realtime)
    #   ServicesPanel        Persists to room_services
    #   TasksPanel           Persists to room_tasks
  lib/
    animationPatch.ts        # MUST be first import in App.tsx — disables Animated.loop on web, forces useNativeDriver:false
    supabase.ts              # Platform-aware client (globalThis singleton, no-op lock on web)
    agents.ts                # Agent management
    agentAutoConnect.ts      # Singleton: detects Claude Code bridge + OpenSwan, publishes agents
    agentIdentity.ts         # Persistent custom names/colors by sessionKey
    agentInvocation.ts       # Routes invocations: BlackSwan/CC/BYO/OpenSwan
    connectionManager.ts     # Connection CRUD, auto-discover, provider types
    openswanService.ts       # OpenSwan API: sessions_list, sessions_send, sessions_history
    soulTemplates.ts         # Agent personality editor (SOUL.md-style)
    circleGames.ts           # Circle games and social features
    gamification.ts          # XP, levels, badges, challenges
    badges.ts                # 14 Halo-style ranks: Recruit(10XP) → Demon(1M XP)
    crypto.ts                # Wallet utilities (ETH + SOL)
    agentHeartbeat.ts        # 30s DB heartbeat, auto-publish connections, offline on close
    agentPresence.ts         # Supabase Realtime Presence, 25s keepalive, exponential backoff
    circleOffice.ts          # CRUD for circle_office_agents + full CircleOfficeAgent type
    officeTerminal.ts        # Supabase Broadcast relay (commands + responses)
    officeAgents.ts          # MODEL_PRICING lookup table for cost tracking
    officeConfig.ts          # OfficeTheme, EnvironmentType, OFFICE_THEMES, furniture catalog, AgentAppearance (14 props)
    themeBackgrounds.ts      # Static require() map: EnvironmentType → PNG sprite
  hooks/
    useAuth.ts
    useOptimizedQuery.ts
  navigation/
    AuthNavigator.tsx
    MainNavigator.tsx
  services/
    agentActivityLogger.ts   # logActivity() + useAgentActivity() hook (Realtime)
    hitlService.ts           # requestApproval, resolveApproval, useAgentApprovals, useAgentControl
    projectRooms.ts          # Full CRUD + Realtime hooks for project rooms
    rewardService.ts         # awardPoints, useUserRewards, useAgentPointsTracker
    sharedMemory.ts          # getMemoryDoc, updateMemoryDoc, getMemoryHistory, useMemoryDoc
    customThemes.ts          # Custom theme CRUD + useCustomThemes() hook
  types/                     # TypeScript type definitions
scripts/
  claude-bridge.js           # Claude Code bridge server (port 7778) — scans ~/.claude/projects/
  openswan-activity-hook.js  # Node.js hook — posts to agent_activity table
  openswan-proxy.js          # HTTP + WebSocket CORS proxy (port 18790, auto-injects auth token)
  generate-theme-sprites.js  # Generates pixel art PNGs for office themes (uses @napi-rs/canvas)
  blackswan-llm/             # BlackSwan LLM training pipeline (see "BlackSwan LLM" section below)
    download_datasets_v4.py  # Downloads 8 datasets from HuggingFace (~43K examples)
    prepare_dataset_v4.py    # Merge, quality filter, dedup, train/eval split
    train_v4.py              # SFT training — BlackSwan Mini (Qwen2.5-7B QLoRA)
    train_dpo_v4.py          # DPO alignment — BlackSwan Mini
    run_v4_pipeline.sh       # Mini pipeline orchestrator (Mac + Linux)
    train_v5.py              # SFT training — BlackSwan Full (Qwen3.5-27B QLoRA)
    train_dpo_v5.py          # DPO alignment — BlackSwan Full
    run_v5_pipeline.sh       # Full pipeline orchestrator (needs 64GB+ memory)
    training_data/           # .gitignored — generated by download scripts
    models/                  # .gitignored — training outputs (v4/ for Mini, v5/ for Full)
  screens/circles/tabs/office/
    OfficeFloor.tsx          # ~2500 lines, pixel art floor rendering, drag-to-move furniture
    CustomizePanel.tsx       # ~1200 lines, theme + agent customization (14 properties)
    AgentPanel.tsx           # ~815 lines, agent detail popup + inline customize section
    PixelAgent.tsx           # ~1600 lines, animated pixel art agent with gamified life
assets/
  themes/                    # 12 generated pixel art PNGs (office, ship, castle, station, submarine, mansion, lair, cabin, arctic, cyber, garden, temple)
supabase/
  functions/
    room-task-executor/      # Edge function: picks up pending tasks, marks done, resets agent status
    swanbot-ai/              # BlackSwan AI response edge function
  migrations/
    20260225_circle_office.sql          # circle_office_agents table ✅ run
    20260225_office_cron_sweeper.sql    # pg_cron sweeper ⚠️ NOT YET RUN
    20260226_hitl.sql                   # agent_approvals, agent_controls, circle_memory ✅ run
    20260226_rewards.sql                # user_points, points_transactions, user_badges ✅ run
    20260226_office_terminal.sql        # office_terminal_messages + 11 new agent columns ✅ run
    20260227_room_files.sql             # room_files, room_secrets, room_usage ✅ run
    20260227_room_messages.sql          # room_messages, room_services, room_tasks ✅ run
    20260227_atomic_xp.sql              # award_points RPC, award_xp RPC, sync_points_to_xp trigger ✅ run
    20260228_custom_themes.sql          # user_custom_themes table + RLS ⚠️ NOT YET RUN
    20260301_agent_appearances.sql      # profiles.agent_appearance JSONB column ⚠️ NOT YET RUN
    20260301_office_layout.sql          # profiles.office_layout JSONB column ⚠️ NOT YET RUN
```

---

## Database Schema (Key Tables)

### Circles & Members
- `circles` — circle_id, name, type, api_key, circle_image_url
- `circle_members` — controls RLS visibility
- `circle_memory` — shared circle memory docs

### Agent Office
- `circle_office_agents`
  - Columns: `id, circle_id, owner_id, name, color, tool_icon, status, current_task, is_published, owner_display_name, owner_username, last_active_at`
  - ⚠️ NO `model` column
  - Owner FK is `owner_id` (NOT `owner_user_id`)
  - Status values: `idle | building | offline`
- `agent_activity` — live activity log (circle_id, agent_name, action, detail, ts)
- `agent_approvals` — HITL approval queue
- `agent_controls` — per-agent kill switch config
- `office_terminal_messages` — terminal command history + 11 analytics columns on agents

### Rooms
- `project_rooms` — rooms per circle
- `project_room_agents` — agents joined to rooms
- `project_room_activity` — activity feed per room
- `room_files` — file tree with content
- `room_secrets` — encrypted secrets per room
- `room_usage` — token/cost logs (realtime → SessionsPanel)
- `room_messages` — message_type CHECK: `chat|agent_output|edit_event|system|playground`
- `room_services` — services list per room
- `room_tasks` — task queue (status: pending|running|done)

### XP & Rewards
- `user_xp` — ⚠️ primary key is `user_id` (NOT `id`)
- `user_points` — point balances
- `points_transactions` — ledger
- `user_badges` — earned badges

### Custom Themes
- `user_custom_themes` — id, user_id, circle_id, name, environment_type, colors (jsonb), is_shared
  - RLS: users read own + shared themes in their circles; manage only their own
  - Theme IDs in frontend prefixed with `custom_` (e.g. `custom_{uuid}`)
  - ⚠️ Migration NOT YET RUN — run `20260228_custom_themes.sql` in Supabase SQL Editor

### Profiles
- `profiles` — display_name, username, agent_appearance (JSONB), office_layout (JSONB)
  - `agent_appearance` — `Record<agentName, AgentAppearance>` (14 properties per agent, keyed by agent.name)
  - `office_layout` — `{ floors: OfficeFloor[], currentFloorId: string }` (full floor/furniture state)
  - ⚠️ No `email` column — use `auth.users` for email
  - ⚠️ `agent_appearance` and `office_layout` columns require migrations NOT YET RUN

---

## Coding Conventions

### Section Naming (nativeID)
**Every significant section/container View MUST have a `nativeID` attribute** for identification. This makes it easy to reference specific UI sections when discussing changes.

Format: `nativeID="section-{area}-{purpose}"`

Examples:
```
nativeID="section-agent-controls"          — Agent power controls container
nativeID="section-agent-bridge-status"     — Bridge health indicator
nativeID="section-agent-power-buttons"     — Kill/Resume/Disconnect buttons
nativeID="section-agent-quick-terminal"    — Inline AI chat in AgentPanel
nativeID="section-agent-no-bridge"         — Bridge offline warning
nativeID="section-feed-activity"           — Activity feed in FeedTab
nativeID="section-feed-agent-tasks"        — Agent tasks panel in FeedTab
nativeID="section-feed-ai-tools"           — HuggingSwan activity panel
nativeID="section-office-toolbar"          — Office floor toolbar
nativeID="section-terminal-input"          — Terminal command input
```

When creating new sections, always add `nativeID` so team members can reference it by name instead of line numbers.

### Component Organization
- Business logic hooks at the top of the component
- Callbacks and handlers in the middle
- Render sections clearly labeled with `{/* ── SECTION: name — description ── */}` comments
- Styles at the bottom of the file

---

## Architecture Notes

### Web Platform Stability (Critical — DO NOT REVERT)
1. **`src/lib/animationPatch.ts`** — Imported FIRST in `App.tsx`. Patches `Animated.loop` to return no-op on web (prevents "Maximum update depth exceeded" from infinite re-renders). Also forces `useNativeDriver: false` globally on web since there is no native animation driver.
2. **Supabase no-op lock on web** — `supabase.ts` passes `lock: async (_name, _acquireTimeout, fn) => await fn()` to auth config on web. Without this, GoTrueClient uses `navigator.locks` API which causes `AbortError` that breaks `getUser()`/`getSession()`, preventing circles from loading.
3. **Supabase HMR singleton** — `supabase.ts` stores client on `globalThis.__supabaseClient` to prevent duplicate client on hot module reload (causes "concurrent storage key" warning and undefined behavior).
4. **OfficeTab useEffect guard** — Auto-assign agents useEffect uses `prevAgentCountRef` to only run when agent count changes. Without this guard, `floors` in deps → `saveFloors` → `setFloors` → infinite re-render loop.
5. **PixelAgent breathing direction** — Body uses `scaleX` (NOT `scaleY`) for breathing animation. `scaleY` pushes legs/shoes/belt down on every animation frame.
6. **`.catch()` handlers on auth calls** — All `supabase.auth.getUser()` and `getSession()` calls MUST have `.catch()` to prevent unhandled promise rejections that cascade to crash.

### Auth
- Supabase Auth with session persistence
- Web: `localStorage`, Native: `AsyncStorage`
- Nav state persisted to `localStorage` key `uc_nav_state_v1` (restores on refresh)

### Agent Presence — Two-Layer System

**Layer 1 — Supabase Realtime Presence (ephemeral)**
- Agent joins channel `circle:{circleId}` via `channel.track()`
- 25s keepalive heartbeat; auto-drops on tab close / disconnect
- Other dashboards get `leave` event immediately

**Layer 2 — Postgres circle_office_agents (durable)**
- 30s DB heartbeat via `agentHeartbeat.ts`
- Persists `last_active_at` so "last seen X ago" works when offline

**Connection state machine (shown in Office panel header):**
```
🟡 Connecting → 🟢 Live → 🟡 Reconnecting → ⚫ Offline
```

**Reconnect — exponential backoff:**
- Start 1s, ×2, add jitter (Math.random() × 1000ms), cap 5 minutes

**Server-side sweeper (⚠️ pg_cron SQL — NOT YET RUN — paste into Supabase SQL Editor):**
```sql
create extension if not exists pg_cron;

create or replace function sweep_offline_agents()
returns void language plpgsql security definer as $$
begin
  update circle_office_agents
  set status = 'offline', updated_at = now()
  where status in ('idle', 'building')
    and last_active_at is not null
    and last_active_at < now() - interval '3 minutes'
    and is_published = true;
end;
$$;

select cron.schedule('sweep-offline-agents', '*/2 * * * *', 'select sweep_offline_agents()');

create index if not exists idx_circle_office_agents_last_active
  on circle_office_agents (last_active_at) where is_published = true;

grant execute on function sweep_offline_agents() to postgres;
```

### CORS Proxy
`scripts/openswan-proxy.js` runs on port 18790. Supports HTTP + WebSocket upgrades.
All Realtime connections in dev route through here to avoid CORS issues.

### Solana Wallet
- Primary RPC: `solana-rpc.publicnode.com` (CORS-friendly)
- Avoid `api.mainnet-beta.solana.com` and `rpc.ankr.com` — return HTTP 403 in browser
- Phantom injects `window.ethereum` — check `!eth.isPhantom` before treating as MetaMask
- Disconnect: call `phantom.disconnect()` + `wallet_revokePermissions` before clearing Supabase
- CoinGecko price fetch: 10s timeout + Coinbase API fallback

### Model Cost Tracking (`src/lib/officeAgents.ts`)
Uses `MODEL_PRICING` lookup table — longest-key match, strips `anthropic/`/`google/` prefixes:
- Opus 4.6: $20/$100 per M tokens (input/output), +25% buffer → $25/$125
- XP per turn: Opus=10, Sonnet=5, Haiku=2

### Office Terminal
3 Supabase channels per circle (command broadcast, response broadcast, DB realtime).
Positions stored as 0.0–1.0 floats (% of canvas size — universal across screen sizes).
`getOrCreateCommandChannel` has 5s timeout to prevent hangs.

### Office Theme System
- **12 environment types:** `office | ship | castle | station | submarine | mansion | lair | cabin | arctic | cyber | garden | temple`
- **12 built-in themes** in `OFFICE_THEMES` (officeConfig.ts), each with 13 color properties + environmentType
- **PNG sprite backgrounds:** Pre-generated pixel art PNGs (900x680px, 4px pixel grid) in `assets/themes/`
- **Rendering:** OfficeFloor.tsx uses `<Image>` sprite when available, falls back to View-based rendering for custom themes
- **Custom themes:** Stored in Supabase `user_custom_themes` table (colors as JSONB), IDs prefixed with `custom_`
- **Theme resolution** (OfficeTab.tsx): `OFFICE_THEMES[id] || customThemeLookup[id] || OFFICE_THEMES.underground`
- **Sprite generator:** `scripts/generate-theme-sprites.js` uses `@napi-rs/canvas` (prebuilt binaries, no system deps)
- **Metro bundler:** Requires static `require()` strings for images — solved with `themeBackgrounds.ts` registry

### Agent Customization & Persistence
- **AgentAppearance** has 14 properties: skinTone, hairStyle, hairColor, shirtColor, pantsColor, shoeColor, accessory, hat, expression, backItem, eyeColor, facialHair, pet, aura
- **Appearances keyed by `agent.name`** (NOT `agent.id`) — stable across reconnections
- **Dual persistence:** localStorage (fast) + Supabase `profiles.agent_appearance` JSONB (durable, remote wins)
- **Office layouts:** localStorage + Supabase `profiles.office_layout` JSONB (floors + furniture + currentFloorId)
- **Inline customization:** AgentPanel popup includes collapsible CUSTOMIZE section with live preview
- **Full customization:** CustomizePanel has complete agent editor with 14 categories

### Pixel Agent (PixelAgent.tsx ~1600 lines)
- **PX unit:** `2.5 * scale` — base pixel unit for all measurements
- **Container:** 60x92px, alignItems: 'center'
- **Body proportions:** Head PX*7, body PX*7 wide × PX*5 tall, neck PX*4, legs PX*2.8 each (gap PX*0.7), shoes PX*3 each (gap PX*0.7)
- **Breathing:** `scaleX: breatheAnim` (1 → 1.04) — chest expands sideways, NOT vertically
- **Borders:** 1px solid `#1e1b4b30` on head and body (not sub-pixel PX*0.2)
- **Active glow:** Pulsing colored backlight behind working agents (synced to breathe/glow anims)
- **Shoe details:** Toe cap highlight + 1.5px sole
- **Eye blinking:** Periodic 3-6s blink cycle with occasional double-blinks
- **Typing animation:** Arm wiggle when agent status is active/building (opposite-phase L/R arms)
- **Idle look-around:** Subtle head shift when idle (lookAnim -1.5px to +1.5px)
- **Mood indicator:** Floating emoji bubble (fire/lightning/checkmark/zzz/muscle) reacts to status/cost changes
- **Floating text:** Cost changes (-$0.xxx) and status changes (+BUILD) float up and fade
- **Action particles:** 3 colored dots float above agent when building
- **Press feedback:** Spring squeeze on tap (0.9x scale)
- **Thought bubbles:** Data-driven from agent context (XP, cost, status, idle time)
- **Dance animation:** Triggered on badge earn (5s loop, side-to-side + rotation + scale)

### Furniture Management
- **Drag-to-move:** Pointer events via DOM addEventListener (not React props — RN Web limitation)
- **Scale-aware:** Accounts for office transform scale in drag calculations
- **Grid snapping:** 16px grid for consistent placement
- **Select-then-delete:** First tap selects (blue outline), DELETE button appears, tap to confirm

### BlackSwan AI (Default Agent)
- **Single default agent** throughout the app: "BlackSwan" (id: `default::blackswan`)
- Always at desk position 0 in office, always in `displayAgents`
- Edge function: `supabase/functions/swanbot-ai/index.ts` (name kept for backwards compat)
- Client lib: `src/lib/swanbot.ts` (exports `getSwanBotResponse`)
- Model: `claude-haiku-4-5-20251001` via Anthropic API
- Context: circle info, members, streaks, check-ins, tasks, recent 30 messages
- Personality: confident, dry wit, direct accountability partner
- Triggers: `@blackswan`, `@swanbot`, `@swan`, or quick prompts (all routed to same handler)
- Connected to: circle chat (ChatTab), room chat (RoomsTab), office (OfficeTab)
- Default appearance: `UC_AGENT_APPEARANCE` in officeConfig.ts
- All responses prefixed with 🦢 emoji, persisted as `🦢 **BlackSwan:** {content}`
- Max 1024 tokens output, system prompt built dynamically from full circle context

---

## Features Shipped

### Circle Office (AI Agent Hub)
- PixelOfficeCanvas — drag agents around pixel-art office floor
- Shared Office Panel — all circle members' agents in real time
- Office Analytics — token usage, cost, turns per agent (real data)
- Office Terminal — @all/@agent dispatch via Supabase Broadcast
- 23 furniture items across 4 categories (Work, Lounge, Tech, Decor)
- Drag-to-move furniture with grid snapping + select-then-delete UX
- Floor management — add/remove floors, can't delete last floor
- Agent XP bar — 44px wide, 5px tall, rainbow gradient when full
- 12 themed environments: Office, Ship, Castle, Station, Submarine, Mansion, Lair, Cabin, Arctic, Cyber, Garden, Temple
- 12 PNG sprite backgrounds (generated via `scripts/generate-theme-sprites.js`)
- Custom theme editor: create, edit, delete, share custom color themes with circle
- Theme resolution: built-in → custom (from Supabase) → fallback to underground
- Office layout persistence: localStorage + Supabase `profiles.office_layout`
- Agent customization: 14 properties (skin, hair, eyes, clothes, facial hair, pet, aura, etc.)
- Agent appearance persistence: localStorage + Supabase `profiles.agent_appearance` (keyed by agent.name)
- BlackSwan default agent: always at desk 0, `DEFAULT_AGENT` in officeAgents.ts
- Gamified pixel agents: blinking eyes, typing animation, mood indicators, floating cost text

### Agent Connectivity & Feed Dashboard (2026-03-10)
- Claude Code Bridge auto-detection (port 7778, scans ~/.claude/projects/)
- OpenSwan Gateway auto-detection (port 18789) + CORS proxy with auto-auth injection
- Agent auto-connect singleton service (agentAutoConnect.ts)
- Feed dashboard: live agent merge (DB + Claude Code + OpenSwan sessions)
- Feed dashboard: custom agent names from identity system
- Feed dashboard: real-time online status dots (green for active/building/idle)
- AgentTopBar: provider badges and popover cards for all agent types
- OpenSwan invocation: sessions_send + sessions_history polling pattern
- Dev server supervisor (start-dev.js): manages Expo + Bridge + Proxy with auto-restart

### BlackSwan LLM — Two-Tier Model Strategy (2026-03-10)
**BlackSwan Mini (v4)** — Fast, lightweight, runs anywhere
- Base: Qwen2.5-7B-Instruct, 4-bit QLoRA, LoRA rank 64
- 43K training examples, SFT + DPO, GGUF Q4_K_M (~3-4GB)
- Pipeline: `run_v4_pipeline.sh`

**BlackSwan Full (v5)** — The big boy, maximum quality
- Base: Qwen3.5-27B (dense, Apache 2.0), 4-bit QLoRA, LoRA rank 64
- Same 43K+ dataset, needs 56GB+ VRAM (Apple Silicon 64GB+ or multi-GPU)
- Pipeline: `run_v5_pipeline.sh` (or `--small` for 9B fallback)
- Qwen3.5-27B scores ~79 overall on benchmarks (MMLU 83, HumanEval 71, GSM8K 85)

Both pipelines: download → prepare → SFT → DPO → GGUF → Ollama deploy
Cross-platform: Linux (CUDA) + macOS (Apple Silicon / MPS) via Unsloth

### LLM Benchmark Comparison Panel
- New "LLM Bench" compartment in Backpack tab
- Compares 23 models: frontier (Opus, GPT-4o, Qwen3.5-397B MoE) → mid (Qwen3.5-27B, Llama 70B) → small (Qwen3.5-9B/4B/2B/0.8B, Mistral 7B, Phi-3) → BlackSwan family
- 6 benchmarks: Overall, MMLU, HumanEval, GSM8K, HellaSwag, ARC-C
- Interactive: tap model for detail card, filter by tier, benchmark selector
- BlackSwan Mini/Full show "TRAINING..." until benchmarks are run

### BlackSwan AI (Edge Function)
- Supabase Edge Function at `supabase/functions/swanbot-ai/`
- Uses Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via Anthropic API
- Gathers full circle context: members, streaks, check-ins, tasks, recent chat
- Personality: confident, dry wit, direct, accountability-focused
- Games/social: trivia, hot takes, roast battles, challenges, MVP of the week
- Crypto awareness: wallet status, tipping, bounties

### HITL Kill Switches
- Floating amber approval banner with countdown timer
- Per-agent: pause/resume, spend limits, per-action approval toggles

### BYOA (Bring Your Own Agent)
- Webhook: `https://app.chrisswanson.xyz/api/webhook/{circleId}`
- MCP endpoint: `https://app.chrisswanson.xyz/mcp/{circleId}`
- 6 quick-connect provider cards

### Agent Templates
6 templates: Research, QA, Writer, Monitor, Data, Custom.
Deploy modal logs to `agent_activity` on deploy.

### Shared Memory
Editable shared doc per circle, version history, restore, realtime.

### Halo Reward System
14 ranks: Recruit (10 XP) → Demon (1M XP) — Halo military naming.
Badge shapes: hexagon / shield / star / diamond / circle + tier glow.
Full-screen confetti celebration on rank-up (60 particles + shockwave + badge bounce).
Agents dance (side-to-side + rotation, 5s) on badge earn.

### Step Away & Hand Off
Declare task, goal, return time, tool (Claude Code/Cowork/OpenSwan/Other).
"Back at Keyboard" verdict: shipped / pivoted / rolled-back / still-running.
Posts formatted message to circle chat.

### Project Rooms (full rebuild 2/27, ~3100 lines)
Multi-file tree, tabs, upload/drag-drop, download.
CanvasViewer (Miro sticky notes, drag, color picker, debounced save).
PlaygroundPanel (prompt A/B, variants, model selector, variable interpolation).
ChatPanel (agent selector, file context, task dispatch to room_messages).
SessionsPanel (logs/traces/metrics, realtime from room_usage).
ServicesPanel + TasksPanel (persist to Supabase).

### Agent Activity Feed
Live scrolling feed in Office mobile view.
`scripts/openswan-activity-hook.js` auto-posts on SwanBot task completion.
Circle "THE END" ID: `fcccaa73-2d48-4a90-8c19-c556b19f89dc`

### Circle Types
Builder 🚀 | Creator ✍️ | Operator 💼 | Researcher 🔬

### Whiteboard Modes (in Office tab)
Overview | Activity | Ops | Agent Log
3 additional modes: coding_agents 🤖 | audit 📜 | circle_log 🏛️

---

## BlackSwan LLM — Mac Training Instructions

**This Mac is dual-purpose: training AND app development.** The training pipeline is fully self-contained in `scripts/blackswan-llm/` and doesn't touch app code. Train in one terminal, build the app in another. The primary dev machine is WSL2 but this Mac is a full dev environment too — just `git pull` before starting work and push when done to stay in sync.

### Quick Start
```bash
git clone git@github.com:swanopoly/the-underground-circle.git
cd the-underground-circle/scripts/blackswan-llm

# One-time setup
conda create -n blackswan python=3.12 -y
conda activate blackswan
pip install "unsloth[colab-new]" torch datasets trl transformers

# PHASE 1: Train Mini (~8-12 hours, fully autonomous)
bash run_v4_pipeline.sh

# PHASE 2: Train Full (after Mini is done, ~12-24 hours)
bash run_v5_pipeline.sh
# If <64GB memory, use 9B fallback:
bash run_v5_pipeline.sh --small
```

### Phase 1: BlackSwan Mini (v4) — Train First
6 steps, all automated:
1. **Download datasets** — 8 from HuggingFace (~43K examples)
2. **Prepare dataset** — merge, PII filter, dedup, 95/5 split → ~41K train, ~2K eval
3. **Download DPO data** — 6.3K preference pairs
4. **SFT Training** — Qwen2.5-7B-Instruct, QLoRA rank 64, 1 epoch (~6-10 hours)
5. **DPO Alignment** — preference tuning (~1-2 hours)
6. **Deploy** — GGUF Q4_K_M → `blackswan:v4` in Ollama

### Phase 2: BlackSwan Full (v5) — Train After Mini
5 steps (reuses Mini's downloaded data):
1. **Check datasets** — verifies train_v4.jsonl exists, downloads if needed
2. **Check DPO data** — verifies dpo_train.jsonl exists
3. **SFT Training** — Qwen3.5-27B, QLoRA rank 64, batch 1, lr 5e-5 (~12-24 hours)
4. **DPO Alignment** — preference tuning (~2-4 hours)
5. **Deploy** — GGUF Q4_K_M → `blackswan:v5` in Ollama

### Memory Requirements
| Model | Min Memory | Recommended |
|-------|-----------|-------------|
| Mini (Qwen2.5-7B) | 12GB | 16GB+ |
| Full (Qwen3.5-27B) | 56GB | 64GB+ |
| Full fallback (Qwen3.5-9B) | 22GB | 32GB+ |

### After Training
```bash
# Test Mini
ollama run blackswan:v4 "Write a Python function to merge two sorted arrays"

# Test Full
ollama run blackswan:v5 "Explain the tradeoffs of microservices vs monolith architecture"

# Make Full the default, keep Mini available
ollama cp blackswan:v5 blackswan:latest
ollama cp blackswan:v4 blackswan:mini

# Transfer GGUFs to main dev machine
scp models/v4/gguf_dpo/*.gguf swan@dev-machine:~/the-underground-circle/scripts/blackswan-llm/models/v4/
scp models/v5/gguf_dpo/*.gguf swan@dev-machine:~/the-underground-circle/scripts/blackswan-llm/models/v5/
```

### Troubleshooting
- **OOM during Mini training:** `python train_v4.py --batch 1 --grad-accum 16`
- **OOM during Full training:** Use 9B fallback: `bash run_v5_pipeline.sh --small`
- **Unsloth install fails on Mac:** Try `pip install unsloth` (without `[colab-new]`)
- **Training interrupted:** Checkpoints saved per epoch at `models/v{4,5}/lora/`. Restart DPO from there.
- **Monitor progress:** Loss logged every 25 steps in terminal output

### Key Facts
- Training data is .gitignored — download scripts regenerate it
- Models are .gitignored — only scripts are in the repo
- v5 reuses v4's training data (train_v4.jsonl) — no need to re-download
- Does NOT touch app code — safe to run alongside app development
- Qwen3.5-27B is Apache 2.0 licensed — fully open, commercially usable

---

## Pending / Known Issues

### Critical Path (GitHub Integration) ✅ COMPLETE
| Issue | Priority | Status |
|---|---|---|
| GitHub OAuth edge function | **P0** | ✅ Built — `github-oauth` edge fn + GitHubTab wired |
| GitHub webhook receiver edge fn | **P0** | ✅ Built — `github-webhook` edge fn |
| `circle_github_events` table | **P0** | ✅ Built — stores webhook events per circle |
| BlackSwan GitHub summary automation | **P0** | ✅ Built — `github_summary` in automation-executor |
| BlackSwan nudge inactive members | **P0** | ✅ Built — `nudge_inactive_members` in automation-executor |
| BlackSwan deploy failure alerts | **P0** | ✅ Built — `deploy_failure_alert` in automation-executor |
| GitHub in IntegrationsTab | **P1** | ✅ Built — first-class platform card |
| Invite link flow | **P1** | ✅ Built — `invites.ts` + `/join/:code` + App.tsx |
| Onboarding flow | **P1** | ✅ Built — 3-step modal (welcome → GitHub → invite) |

### Infrastructure (run when convenient)
| Issue | Priority | Status |
|---|---|---|
| pg_cron sweeper + step_away_sessions SQL | Medium | ⚠️ NOT run — `20260318_pending_items.sql` |
| custom_themes migration SQL | Medium | ⚠️ NOT run — `20260228_custom_themes.sql` |
| agent_appearances migration SQL | Medium | ⚠️ NOT run — `20260301_agent_appearances.sql` |
| office_layout migration SQL | Medium | ⚠️ NOT run — `20260301_office_layout.sql` |
| Deploy automation-executor edge fn | Medium | ⚠️ NOT deployed — `npx supabase functions deploy automation-executor` |
| room-task-executor edge function | Medium | ⚠️ NOT deployed — needs `npx supabase login` |
| award_points RPC 400 | Low | May need points_transactions confirmed |
| circle_office_agents upsert 400 | Low | AgentPanel bug |
| Solana RPC 403s | Low | Pre-existing, publicnode workaround in place |

---

## Recent Git History

```
9ca12ec  feat: agent connectivity, Feed dashboard live agents, BlackSwan LLM v4 training pipeline
95eb68b  feat: Feed dashboard enhancements — DigestPanel, stats, search/filters, due dates, shortcuts
27a2fac  feat: HQ Dashboard - Feed tab rewrite with Kanban board, Goals, Activity feed
9af5a21  feat: switch swanbot-ai from OpenAI to Claude + expand CLAUDE.md
08d7566  docs: add CLAUDE.md with project overview and architecture
188d054  feat: fix furniture placement + 8 new office themes
6620440  fix: fully remove Digest tab from nav
a0f5dec  feat: compact header + merge Feed & Digest into one tab
c6e4787  feat: 3D animated loader while agent is thinking
48c2373  fix: animation CSS classes, room-task-executor edge function
5ee6c7d  thought bubbles: data-driven (XP, cost, cache hit %, suggestions)
ba8a778  agent XP bar under name
46a6869  Halo reward system (8 files ~1900 lines)
66241f5  HITL + BYOA + AgentTemplates + SharedMemory (10 files ~1900 lines)
8663e7d  nav state persistence (uc_nav_state_v1)
1d4488c  wallet fixes + project rooms + whiteboard + agent activity feed
0b7adb0  office: remove floor, 23 furniture items, category toolbar
```

---

## TypeScript Gotchas

- `profiles` join → use `profiles(display_name, username)` NOT `profiles(email)`
- `user_xp` → primary key is `user_id`, not `id`
- `circle_office_agents` → no `model` column; owner FK is `owner_id` not `owner_user_id`
- `room_messages` → `message_type` CHECK constraint: `chat|agent_output|edit_event|system|playground`
- ArrowScrollView → `style` applies to outer wrapper, `scrollStyle` to inner ScrollView
- CSS gotchas: `backgroundImage` not `background`; `outlineWidth`/`outlineStyle` not `outline`; use CSS class injection for animation
- Known safe-to-ignore TS errors: `ProfileScreen.tsx`, `OfficeChat.tsx`, `PhotonProofCheck.tsx`, `CostDashboard.tsx`
- Agent appearances → keyed by `agent.name` (NOT `agent.id`) — `agent.id` format is `${connId}::${sessionKey}` which changes on reconnect
- Pointer events on RN Web → use `useEffect` + `el.addEventListener('pointerdown')` (NOT React `onPointerDown` prop — doesn't work on View)
- `Animated.loop` on web → globally disabled via `animationPatch.ts` (returns no-op). All animation loops in the codebase work despite this because non-loop animations (sequence, timing, spring) are unaffected
- `supabase.auth.getUser()` / `getSession()` → ALWAYS add `.catch()` handler. Without it, AbortErrors from auth propagate and crash components

---

## OpenSwan Integration

- SwanBot (main agent) runs in WSL2 on Swan's machine
- CORS proxy at `localhost:18790` — HTTP + WebSocket support, auto-injects auth token from `~/.openswan/openswan.json`
- `SUPABASE_SERVICE_KEY` + `ACTIVITY_CIRCLE_ID` env vars in `~/.bashrc` and systemd service
- Hook script posts to `agent_activity` after every significant task
- Activity visible in Office tab → Activity mode / AgentActivityFeed
- **OpenSwan tools API:** `sessions_list`, `sessions_send`, `sessions_history` via `/tools/invoke` endpoint
- **Invocation is async:** `sessions_send` fires immediately; poll `sessions_history` for assistant response
- **`execute_command` does NOT exist** — never use it

---

## Agent Connectivity System

### Three Agent Sources
1. **Claude Code Bridge** (`scripts/claude-bridge.js`, port 7778) — scans `~/.claude/projects/` JSONL files, serves sessions
2. **OpenSwan Gateway** (port 18789) + **CORS Proxy** (port 18790) — multi-agent orchestration
3. **Supabase DB** (`circle_office_agents` table) — persisted agent records

### Auto-Connect (`src/lib/agentAutoConnect.ts`)
- Singleton service that detects bridge + gateway, publishes agents to DB
- CC sessions stored as `OfficeAgent[]`, OpenSwan sessions as `OpenSwanSession[]` — different shapes
- `subscribeAutoConnect()` for reactive UI updates when agents connect/disconnect
- `setAutoConnectCircleId(id)` to target a specific circle

### Agent Identity (`src/lib/agentIdentity.ts`)
- Persistent custom names/colors by sessionKey in `@agent_identity_store` (AsyncStorage)
- Legacy names in `@office_agent_names`
- Agent.id format: `${connId}::${sessionKey}`, keyed by agent.name for appearances

### Feed Dashboard Live Agents (`src/screens/circles/tabs/FeedTab.tsx`)
- Merges live connected agents with DB agents via useMemo
- Applies custom names from identity system (identity.customName || legacyName || oa.name)
- Shows online status (green dots) for active/building/idle agents
- AgentTopBar shows scrollable pills with popover cards

### Agent Invocation (`src/lib/agentInvocation.ts`)
- Routes: BlackSwan → edge fn, Claude Code → bridge, BYO → llm-proxy, OpenSwan → gateway
- OpenSwan: `sessions_send` + `sessions_history` polling (2s interval, 60s timeout)

### Dev Server (`start-dev.js`)
- Manages 3 services: Claude Code Bridge, CORS Proxy, Expo Dev Server
- Auto-restart with rate limiting (max 10 restarts per minute)
- **Important:** Expo service must use `npx expo start --web` (NOT `npm start` — causes recursive loop)

---

## BlackSwan LLM Training Pipeline

### Overview — Two-Tier Strategy
Custom fine-tuned LLMs for the BlackSwan AI assistant:

| Tier | Model Name | Base | Params | VRAM Needed | Pipeline |
|------|-----------|------|--------|-------------|----------|
| **Mini** | BlackSwan Mini (v4) | Qwen2.5-7B | 7B | 12GB+ | `run_v4_pipeline.sh` |
| **Full** | BlackSwan (v5) | Qwen3.5-27B | 27B | 56GB+ | `run_v5_pipeline.sh` |

**Mini** = fast, lightweight, runs on any machine with a decent GPU or Apple Silicon Mac.
**Full** = the big boy. Needs a Mac with 64GB+ unified memory or multi-GPU Linux.

Both use the same 43K training dataset and QLoRA fine-tuning via Unsloth.

### Files: `scripts/blackswan-llm/`
```
# Shared data pipeline
download_datasets_v4.py  # Download 8 public datasets (~43K examples)
prepare_dataset_v4.py    # Merge, filter, dedup, train/eval split
download_dpo.py          # Download DPO preference data (argilla/dpo-mix-7k)
evaluate.py              # Eval: perplexity + domain test questions

# BlackSwan Mini (v4) — Qwen2.5-7B
train_v4.py              # SFT training (7B QLoRA)
train_dpo_v4.py          # DPO alignment
run_v4_pipeline.sh       # Full Mini pipeline

# BlackSwan Full (v5) — Qwen3.5-27B
train_v5.py              # SFT training (27B QLoRA)
train_dpo_v5.py          # DPO alignment
run_v5_pipeline.sh       # Full pipeline (or --small for 9B fallback)
```

### Training Data (~43K examples, shared by v4 and v5)
| Dataset | Count | Purpose |
|---------|-------|---------|
| CodeAlpaca | 8K | Code instructions |
| Evol-Instruct-Code | 7K | Evolved code (harder problems) |
| OpenHermes 2.5 | 10K | General knowledge + instruction |
| Capybara | 5K | Multi-turn conversation |
| SlimOrca | 5K | Instruction following |
| UltraChat | 3K | Conversation fluency |
| GSM8K | 3K | Math reasoning (chain-of-thought) |
| MathInstruct | 2K | Diverse math problems |
| BlackSwan synthetic | ~1K | Domain-specific (accountability, coding, design) |

### Model Config Comparison
| Config | Mini (v4) | Full (v5) |
|--------|-----------|-----------|
| **Base model** | Qwen2.5-7B-Instruct | Qwen3.5-27B |
| **Quantization** | 4-bit QLoRA | 4-bit QLoRA |
| **LoRA** | r=64, alpha=128 | r=64, alpha=128 |
| **SFT batch** | 2 x 8 grad_accum = 16 | 1 x 16 grad_accum = 16 |
| **SFT LR** | 1e-4 | 5e-5 |
| **DPO** | 6.3K pairs, beta=0.1 | 6.3K pairs, beta=0.1 |
| **GGUF** | Q4_K_M (~3-4GB) | Q4_K_M (~15-16GB) |
| **Ollama tag** | `blackswan:v4` | `blackswan:v5` |

### Training Order (IMPORTANT)
1. **First: Train Mini (v4)** — `bash run_v4_pipeline.sh` (~8-12 hours)
2. **Then: Train Full (v5)** — `bash run_v5_pipeline.sh` (~12-24 hours)
3. Both share the same downloaded datasets (training_data/ directory)
4. v5 reuses v4's training data files (train_v4.jsonl, eval_v4.jsonl)

### Running on Mac (Apple Silicon)
```bash
# One-time setup
conda create -n blackswan python=3.12 -y
conda activate blackswan
pip install "unsloth[colab-new]" torch datasets trl transformers

cd scripts/blackswan-llm

# Step 1: Train Mini first
bash run_v4_pipeline.sh

# Step 2: After Mini is done, train Full
bash run_v5_pipeline.sh
# Or if <64GB memory, use 9B fallback:
bash run_v5_pipeline.sh --small
```

### Running on Linux (CUDA)
```bash
# Same setup, plus:
export CC=/path/to/conda/env/bin/x86_64-conda-linux-gnu-gcc  # needed for Triton
# Mini on any GPU:
bash run_v4_pipeline.sh
# Full — needs multi-GPU or large VRAM:
bash run_v5_pipeline.sh
```

### Deploying to Ollama
```bash
# Mini
ollama create blackswan:v4 -f models/v4/Modelfile
ollama cp blackswan:v4 blackswan:mini

# Full (after v5 training)
ollama create blackswan:v5 -f models/v5/Modelfile
ollama cp blackswan:v5 blackswan:latest   # make full model the default

# Both available:
ollama run blackswan:mini "Quick question"   # fast, lightweight
ollama run blackswan:latest "Deep analysis"  # full power
```

### Qwen3.5 Base Model Details (v5)
- Released Feb 2026 by Alibaba Qwen team, Apache 2.0 license
- Full family: 0.8B, 2B, 4B, 9B, 27B (dense), 35B-A3B (MoE), 122B-A10B (MoE), 397B-A17B (MoE)
- 27B dense chosen for v5: best quality-per-VRAM ratio, fully trainable with QLoRA
- Qwen3.5-9B available as fallback (`--small` flag): only needs ~22GB VRAM
- Unsloth supports all Qwen3.5 sizes for QLoRA fine-tuning

### Previous Versions
- **v3 (current deployed):** Qwen2.5-3B, 12K examples, LoRA r=32, SFT loss 1.12, DPO loss 0.889
- **v2:** 450 examples, loss 0.88/0.76
- **v1:** 181 examples, loss 1.17/0.82

---

## Design System — Black & White Terminal Aesthetic

> **THE DEFINITIVE STYLE GUIDE: `docs/UC_STYLE_GUIDE.md`**
> All new UI MUST follow this guide. It combines the Spawn Agents modal (pure B&W, sharp, monospace) with the Assign Agent panel (agent color tints, status dots). Read the full spec in the doc.

### Core Rules
1. **Black canvas** — Background `#000`. Insets `#0a0a0a`. Surfaces `#111`. No other background colors.
2. **Sharp edges** — `borderRadius: 2` max. NO rounded corners. Exception: status dots + avatars (fully round).
3. **2px borders** — Cards and CTAs use `borderWidth: 2, borderColor: '#fff'`. Inputs use `borderWidth: 1, borderColor: '#333'`.
4. **Monospace everywhere** — `fontFamily: 'monospace'` for ALL text. Labels: `fontWeight: '900', letterSpacing: 1.5-3`. Body: `fontWeight: '700'`.
5. **White CTA** — Primary buttons: `backgroundColor: '#fff', color: '#000'`. Ghost: `backgroundColor: '#000', borderColor: '#333', color: '#888'`.
6. **Color is functional** — White = primary. Grays = secondary. Color ONLY for: status (green/amber/indigo/red), agent identity tints at 10-20% opacity, active selection accent.
7. **Hover mandatory on web** — Every Pressable: `transition: all 0.15s ease` + hover (border brightens, translateY: -1) + press (scale: 0.96).
8. **Text-glyph icons** — `//`, `>_`, `+`, `x`, `ESC`, `#`, `N` inside 2px-bordered boxes. No emojis in structural UI.
9. **White glow** — Modal cards: `boxShadow: '0 0 60px rgba(255,255,255,0.08)'`.

### Design System Files
- `docs/UC_STYLE_GUIDE.md` — The full specification with every token, pattern, and "don't" rule
- `src/lib/pixelDesign.ts` — Shared style objects (`pixelCard`, `pixelButton`, etc.) — update to match new guide

### Inspiration Sources
- **eBoy Pixoramas** — isometric depth, dense detail, sharp pixel grids
- **Undertale / Celeste / Hyper Light Drifter** — neon accents on dark, expressive minimalism
- **Stardew Valley** — warm pixel art with functional UI
- **Kaisermann.me** — CRT/pixel font aesthetic for developer tools
- **WorkOS Launch Week** — "pixelated and playful" product UI diverging from corporate style
- **Y-N10.com** — isometric 3D pixel scene as entire UI

### Where It's Applied
- **BackpackTab** — pixel icon blocks, stepped card borders, monospace headers, isometric shadows
- **RoomsTab** — pixel card styling, sharp borders, text icons replacing emoji
- **OfficeFloor** — already pixel-art (theme sprites, 16px grid)
- **PixelAgent** — already pixel-art (PX unit system, blocky rendering)
- **AutomationsPanel** — dark cards, monospace text (apply pixel borders next)

---

## Roadmap (Not Yet Built)

- `step_away_sessions` table for tracking open handoffs
- Agent Budget Social Contract — weekly spend visible to circle
- Weekly Direction Session — AI-summarized, human-confirmed Friday ritual
- "Is This Still The Right Thing?" 90-min circuit breaker
- Circle matching by agent stack + MRR stage
- Session timeline view — visual agent session history for the circle
- Phase 3: Cross-machine tool invocation (Supabase Broadcast relay)
- @all multi-agent terminal responses (one row per responding agent)
- Cowork task visibility — share recurring tasks to circle
