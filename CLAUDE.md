# CLAUDE.md — The Underground Circle

> Comprehensive project context for AI agents (Claude Code, OpenClaw, Codex, etc.)
> Last updated: 2026-03-10 (v4 — agent connectivity, Feed live agents, BlackSwan LLM v4 pipeline, Mac training support)

---

## Project Overview

**The Underground Circle** is a social accountability app for people using AI agents to build real things. Members form small crews (5–8 people), share their AI agents' work in real time, and hold each other accountable — not just for effort, but for *direction*.

It's the **human accountability layer for the AI-agent era**. Mixed circles (devs + creators + business owners). Everyone watches everyone's AI agents work. Everyone ships.

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
| AI/Agents | OpenClaw multi-agent + Claude Code + Codex |
| Crypto | ethers.js (Ethereum) + @solana/web3.js (Solana) |
| Web Deploy | Netlify |
| Mobile Deploy | Expo EAS |
| Dev Proxy | openclaw-proxy.js (port 18790, WebSocket + auto-auth) |
| BlackSwan LLM | Qwen2.5-7B fine-tune via Unsloth QLoRA → Ollama |
| Claude Code Bridge | scripts/claude-bridge.js (port 7778) |

---

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
npm run proxy            # OpenClaw CORS/WS proxy on port 18790
npm run generate-sprites # Generate pixel art PNGs for office themes

# BlackSwan LLM v4 training (run on machine with GPU)
cd scripts/blackswan-llm
bash run_v4_pipeline.sh  # Full pipeline: download → prepare → SFT → DPO → deploy
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
    agentAutoConnect.ts      # Singleton: detects Claude Code bridge + OpenClaw, publishes agents
    agentIdentity.ts         # Persistent custom names/colors by sessionKey
    agentInvocation.ts       # Routes invocations: BlackSwan/CC/BYO/OpenClaw
    connectionManager.ts     # Connection CRUD, auto-discover, provider types
    openclawService.ts       # OpenClaw API: sessions_list, sessions_send, sessions_history
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
  openclaw-activity-hook.js  # Node.js hook — posts to agent_activity table
  openclaw-proxy.js          # HTTP + WebSocket CORS proxy (port 18790, auto-injects auth token)
  generate-theme-sprites.js  # Generates pixel art PNGs for office themes (uses @napi-rs/canvas)
  blackswan-llm/             # BlackSwan LLM training pipeline (see "BlackSwan LLM" section below)
    download_datasets_v4.py  # Downloads 8 datasets from HuggingFace (~43K examples)
    prepare_dataset_v4.py    # Merge, quality filter, dedup, train/eval split
    train_v4.py              # SFT training (Qwen2.5-7B QLoRA via Unsloth)
    train_dpo_v4.py          # DPO alignment training
    run_v4_pipeline.sh       # Full pipeline orchestrator (Mac + Linux)
    training_data/           # .gitignored — generated by download scripts
    models/                  # .gitignored — training outputs
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
`scripts/openclaw-proxy.js` runs on port 18790. Supports HTTP + WebSocket upgrades.
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
- OpenClaw Gateway auto-detection (port 18789) + CORS proxy with auto-auth injection
- Agent auto-connect singleton service (agentAutoConnect.ts)
- Feed dashboard: live agent merge (DB + Claude Code + OpenClaw sessions)
- Feed dashboard: custom agent names from identity system
- Feed dashboard: real-time online status dots (green for active/building/idle)
- AgentTopBar: provider badges and popover cards for all agent types
- OpenClaw invocation: sessions_send + sessions_history polling pattern
- Dev server supervisor (start-dev.js): manages Expo + Bridge + Proxy with auto-restart

### BlackSwan LLM v4 Training Pipeline (2026-03-10)
- 8 public datasets: CodeAlpaca, Evol-Instruct-Code, OpenHermes 2.5, Capybara, SlimOrca, UltraChat, GSM8K, MathInstruct
- 43K training examples (up from 12K in v3), heavy on coding + reasoning
- Qwen2.5-7B base model (up from 3B), LoRA rank 64 (up from 32)
- Full pipeline: download → prepare → SFT → DPO → GGUF → Ollama deploy
- Cross-platform support: Linux (CUDA) + macOS (Apple Silicon / MPS)
- Scripts at `scripts/blackswan-llm/` — run_v4_pipeline.sh orchestrates everything

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
Declare task, goal, return time, tool (Claude Code/Cowork/OpenClaw/Other).
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
`scripts/openclaw-activity-hook.js` auto-posts on SwanBot task completion.
Circle "THE END" ID: `fcccaa73-2d48-4a90-8c19-c556b19f89dc`

### Circle Types
Builder 🚀 | Creator ✍️ | Operator 💼 | Researcher 🔬

### Whiteboard Modes (in Office tab)
Overview | Activity | Ops | Agent Log
3 additional modes: coding_agents 🤖 | audit 📜 | circle_log 🏛️

---

## BlackSwan LLM v4 — Mac Training Instructions

**THIS MACHINE'S JOB:** Train BlackSwan LLM v4 on Apple Silicon Mac. The main dev machine (WSL2) continues building the app separately.

### Quick Start
```bash
git clone git@github.com:swanopoly/the-underground-circle.git
cd the-underground-circle/scripts/blackswan-llm

# One-time setup
conda create -n blackswan python=3.12 -y
conda activate blackswan
pip install "unsloth[colab-new]" torch datasets trl transformers

# Run full pipeline (~8-12 hours total, fully autonomous)
bash run_v4_pipeline.sh
```

### What the Pipeline Does (6 steps, all automated)
1. **Download datasets** — 8 datasets from HuggingFace (~43K examples total): CodeAlpaca 8K, Evol-Instruct-Code 7K, OpenHermes 2.5 10K, Capybara 5K, SlimOrca 5K, UltraChat 3K, GSM8K 3K, MathInstruct 2K
2. **Prepare dataset** — merge with BlackSwan synthetic data, PII filter, dedup, 95/5 train/eval split → ~41K train, ~2K eval
3. **Download DPO data** — 6.3K preference pairs from argilla/dpo-mix-7k
4. **SFT Training** — Qwen2.5-7B-Instruct, 4-bit QLoRA, LoRA rank 64, 1 epoch, batch 2 (~6-10 hours)
5. **DPO Alignment** — preference tuning on SFT checkpoint (~1-2 hours)
6. **Deploy to Ollama** — exports GGUF Q4_K_M, creates `blackswan:v4` model

### After Training is Done
The GGUF file will be at `models/v4/gguf_dpo/*.gguf` (~3-4GB). To deploy on the main dev machine:
```bash
# Option A: SCP the GGUF back
scp models/v4/gguf_dpo/*.gguf swan@dev-machine:/home/swan/the-underground-circle/scripts/blackswan-llm/models/v4/

# Option B: If Ollama is on this Mac, test locally first
ollama create blackswan:v4 -f models/v4/Modelfile
ollama run blackswan:v4 "Write a Python function to merge two sorted arrays"
```

### If Something Goes Wrong
- **OOM during training:** Reduce batch size: `python train_v4.py --batch 1 --grad-accum 16`
- **OOM with 7B model:** Fall back to 3B: `python train_v4.py --base-model unsloth/Qwen2.5-3B-Instruct-bnb-4bit`
- **Unsloth install fails on Mac:** Try `pip install unsloth` (without the `[colab-new]` extra)
- **Training interrupted:** SFT saves checkpoints per epoch at `models/v4/lora/`. Restart DPO from there.
- **Want to monitor progress:** `tail -f` the terminal output — loss is logged every 25 steps

### Key Facts
- Training data is .gitignored — download scripts regenerate it
- Models are .gitignored — only scripts are in the repo
- This does NOT touch app code — safe to run while the other machine builds
- The 7B model is 2x better than the 3B we had before, and with 4x the data (43K vs 12K), expect a major quality jump

---

## Pending / Known Issues

| Issue | Priority | Status |
|---|---|---|
| pg_cron sweeper SQL | High | ⚠️ NOT run — SQL in Architecture Notes section |
| custom_themes migration SQL | High | ⚠️ NOT run — `20260228_custom_themes.sql` |
| agent_appearances migration SQL | High | ⚠️ NOT run — `20260301_agent_appearances.sql` |
| office_layout migration SQL | High | ⚠️ NOT run — `20260301_office_layout.sql` |
| room-task-executor edge function | High | ⚠️ NOT deployed — needs `npx supabase login` |
| award_points RPC 400 | Medium | May need points_transactions confirmed |
| circle_office_agents upsert 400 | Medium | AgentPanel bug |
| Solana RPC 403s | Low | Pre-existing, publicnode workaround in place |
| step_away_sessions table | Low | Not yet created |

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

## OpenClaw Integration

- SwanBot (main agent) runs in WSL2 on Swan's machine
- CORS proxy at `localhost:18790` — HTTP + WebSocket support, auto-injects auth token from `~/.openclaw/openclaw.json`
- `SUPABASE_SERVICE_KEY` + `ACTIVITY_CIRCLE_ID` env vars in `~/.bashrc` and systemd service
- Hook script posts to `agent_activity` after every significant task
- Activity visible in Office tab → Activity mode / AgentActivityFeed
- **OpenClaw tools API:** `sessions_list`, `sessions_send`, `sessions_history` via `/tools/invoke` endpoint
- **Invocation is async:** `sessions_send` fires immediately; poll `sessions_history` for assistant response
- **`execute_command` does NOT exist** — never use it

---

## Agent Connectivity System

### Three Agent Sources
1. **Claude Code Bridge** (`scripts/claude-bridge.js`, port 7778) — scans `~/.claude/projects/` JSONL files, serves sessions
2. **OpenClaw Gateway** (port 18789) + **CORS Proxy** (port 18790) — multi-agent orchestration
3. **Supabase DB** (`circle_office_agents` table) — persisted agent records

### Auto-Connect (`src/lib/agentAutoConnect.ts`)
- Singleton service that detects bridge + gateway, publishes agents to DB
- CC sessions stored as `OfficeAgent[]`, OpenClaw sessions as `OpenClawSession[]` — different shapes
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
- Routes: BlackSwan → edge fn, Claude Code → bridge, BYO → llm-proxy, OpenClaw → gateway
- OpenClaw: `sessions_send` + `sessions_history` polling (2s interval, 60s timeout)

### Dev Server (`start-dev.js`)
- Manages 3 services: Claude Code Bridge, CORS Proxy, Expo Dev Server
- Auto-restart with rate limiting (max 10 restarts per minute)
- **Important:** Expo service must use `npx expo start --web` (NOT `npm start` — causes recursive loop)

---

## BlackSwan LLM Training Pipeline

### Overview
Custom fine-tuned LLM for the BlackSwan AI assistant. Trained via QLoRA (Unsloth) on Qwen2.5 base models.

### Files: `scripts/blackswan-llm/`
```
download_datasets_v4.py  # Download 8 public datasets (~43K examples)
prepare_dataset_v4.py    # Merge, filter, dedup, train/eval split
train_v4.py              # SFT training (QLoRA via Unsloth)
train_dpo_v4.py          # DPO alignment training
download_dpo.py          # Download DPO preference data (argilla/dpo-mix-7k)
evaluate.py              # Eval: perplexity + domain test questions
run_v4_pipeline.sh       # Full pipeline orchestrator (Mac + Linux)
```

### v4 Training Data (~43K examples)
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

### v4 Model Config
- **Base:** Qwen2.5-7B-Instruct (4-bit QLoRA) — use 3B on machines with <12GB VRAM
- **LoRA:** rank=64, alpha=128, dropout=0, targets=qkvo+gate+up+down
- **SFT:** 1 epoch, batch=2, grad_accum=8, lr=1e-4, NEFTune=5, bf16
- **DPO:** 1 epoch, ~6.3K preference pairs, beta=0.1, max_length=2048
- **Output:** GGUF Q4_K_M for Ollama deployment

### Running on Mac (Apple Silicon)
```bash
# Setup
conda create -n blackswan python=3.12 -y
conda activate blackswan
pip install "unsloth[colab-new]" torch datasets trl transformers

# Run full pipeline
cd scripts/blackswan-llm
bash run_v4_pipeline.sh

# Or step by step:
python download_datasets_v4.py     # ~5 min (downloads from HuggingFace)
python prepare_dataset_v4.py       # ~2 min
python download_dpo.py             # ~1 min
python train_v4.py --epochs 1      # ~6-10 hours (7B model)
python train_dpo_v4.py             # ~1-2 hours
# GGUF auto-exported → create Ollama model from Modelfile
```

### Running on Linux (CUDA)
```bash
# Same setup, plus:
export CC=/path/to/conda/env/bin/x86_64-conda-linux-gnu-gcc  # needed for Triton
# If <12GB VRAM, use 3B model:
python train_v4.py --base-model unsloth/Qwen2.5-3B-Instruct-bnb-4bit --batch 1 --grad-accum 16
```

### Deploying to Ollama
After training, GGUF is exported to `models/v4/gguf/` or `models/v4/gguf_dpo/`.
```bash
ollama create blackswan:v4 -f models/v4/Modelfile
ollama cp blackswan:v4 blackswan:latest  # make v4 the default
```

### Previous Versions
- **v3:** Qwen2.5-3B, 12K examples, LoRA r=32, SFT loss 1.12, DPO loss 0.889
- **v2:** 450 examples, loss 0.88/0.76
- **v1:** 181 examples, loss 1.17/0.82

---

## Design System — Pixel Art Philosophy

> **LESS EMOJIS.** Use pixel-block text icons (`$`, `>_`, `#`, `[]`, `//`, `P`, etc.) inside small colored boxes instead of emoji. Emoji are acceptable ONLY in user-generated content and agent personality (thought bubbles, chat). All structural UI — headers, nav, compartment icons, stat labels, action buttons — must use monospace text glyphs.

### Core Rules
1. **Sharp edges** — `borderRadius: 2` max. NO rounded corners (12px, 10px, 8px) anywhere.
2. **Stepped borders** — `borderWidth: 2` (not 1px hairlines). Heavier, blockier.
3. **Isometric shadow** — `boxShadow: 4px 4px 0px #050508` (web) / `shadowOffset: {4,4}, shadowRadius: 0` (native). NO blur.
4. **Pixel-grid spacing** — All spacing in multiples of 4px (`PX = 4`). Use `GRID.xs` (4), `GRID.sm` (8), `GRID.md` (12), `GRID.lg` (16), `GRID.xl` (24).
5. **Monospace everywhere** — `fontFamily: 'monospace'` for ALL text. Headers use `letterSpacing: 2-3, textTransform: 'uppercase'`.
6. **Dark palette** — Backgrounds: `#050508`, `#0a0a0f`, `#111118`, `#1a1a25`. Borders: `#1a1a2e`, `#2a2a3e`, `#3a3a4e`.
7. **Neon accents** — Functional color only: indigo `#6366f1`, green `#22c55e`, amber `#f59e0b`, cyan `#06b6d4`, pink `#ec4899`.
8. **Icon blocks** — `32x32` or `36x36` boxes with `borderWidth: 2, borderRadius: 2`, dark tinted bg (`color + '18'`), containing monospace text.

### Design System File
`src/lib/pixelDesign.ts` — exports `PIXEL_COLORS`, `PIXEL_ICONS`, `GRID`, `PX`, shared style objects (`pixelCard`, `pixelInset`, `pixelButton`, `pixelHeader`, `pixelLabel`, `pixelBody`, `pixelMuted`), and helpers (`iconBoxStyle`, `accentBorder`).

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
