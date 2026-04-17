# The Underground Circle — App Stack Reference

> Single source of truth on *how this app is built*. Point any Web Developer
> SOUL here so they can navigate the codebase before writing code.
> Last updated: 2026-04-15

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React Native + Expo 54 (Web / iOS / Android) |
| Language | TypeScript strict |
| React | 19 + RN 0.81.5 |
| Backend | Supabase — Auth, Postgres, Realtime, Edge Functions (Deno) |
| AI | OpenSwan (Claude via `swanbot-ai` edge fn), HuggingFace via `hf-proxy`, z.ai GLM-5, MiniMax — all routed through `src/lib/swanbot.ts` and `llm-proxy` |
| Crypto | ethers.js + @solana/web3.js |
| Web deploy | Netlify |
| Mobile deploy | Expo EAS |
| Dev orchestration | `scripts/start-dev.js` launches Expo + Claude-code bridge (7778) + OpenSwan proxy (18790) |

## Critical "do-not-revert" patterns

1. **`src/lib/animationPatch.ts`** must be the FIRST import in `App.tsx`.
   Web has no native animation driver — the patch turns `Animated.loop`
   into a no-op and forces `useNativeDriver: false` globally. Reverting
   this causes "Maximum update depth exceeded" loops.
2. **Supabase no-op web lock** in `supabase.ts` — without it, GoTrueClient
   uses `navigator.locks`, hits `AbortError`, and breaks `getUser()` /
   `getSession()`. Circles silently fail to load.
3. **Supabase HMR singleton** — `supabase.ts` stores the client on
   `globalThis.__supabaseClient` to prevent duplicate clients on hot reload.
4. **Every `auth.getUser()` / `getSession()` must have `.catch()`** —
   unhandled rejections cascade and kill unrelated components.
5. **`circle_members` has recursive RLS** (`circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())`).
   Never do a SELECT on `circle_members` from inside another table's RLS
   policy — use the `SECURITY DEFINER` helper `user_is_circle_member(uuid)`
   instead.
6. **Web iframe sandbox in ChatBuildStudio** uses `allow-scripts allow-same-origin`.
   Don't loosen without auditing for cross-user UGC.

## Core primitives (what has been built)

| Primitive | Table / file | Purpose |
|---|---|---|
| **Circle chat threads** | `circle_chat_threads` + `circle_chat_thread_members` + `messages.thread_id` | One default circle-wide thread per circle; users spawn `private` threads; auto-promoted to `shared` when first non-owner invited. See migrations `20260414_circle_chat_threads*.sql`. |
| **Scheduled actions** | `scheduled_actions` table + `scheduled-action-runner` edge fn + pg_cron tick | Unified queue for WP / Bluesky / Gmail / X / LinkedIn / Slack / webhook / reminder. See `docs/SCHEDULED_ACTIONS_ARCHITECTURE.md`. |
| **Agent office** | `circle_office_agents` + `agent_activity` + `agent_approvals` + `agent_controls` | Pixel-art agent hub with HITL controls, activity log, kill switches. |
| **SOULs / Spirits** | `src/lib/soulTemplates.ts` + `src/lib/agentSpirits.ts` + `src/lib/agentSoulMemory.ts` | 11 SOULs (identity/voice) + 27 Spirits (methodology/posture). Skills layer planned in `docs/SOULS_SPIRITS_SKILLS_ROADMAP.md`. |
| **Missions** | `circle_missions` + `mission_tasks` + `mission_agents` + `proof_of_work` | Feed-tab accountability loop with templates, streaks, per-task XP. |
| **Live Builder** | `ChatBuildStudio.tsx` + `codingWorkbench.ts` | Side-pane code + iframe preview for `/build-page`. Roadmap in `docs/CHAT_LIVE_BUILDER_ROADMAP.md`. |
| **Auto-connect** | `agentAutoConnect.ts` + `claude-bridge.js` (7778) + `openswan-proxy.js` (18790) | Detects local bridges, subscribes to sessions, publishes to Office. |
| **LLM proxy** | `supabase/functions/llm-proxy/index.ts` | OpenAI-compatible router with anthropic / openai / zai (GLM-5) / minimax / groq / openrouter / huggingface / github-models providers. |

## Repo layout

```
src/
  screens/
    auth/               Login / SignUp / Landing
    circles/
      tabs/             Chat · Rooms · Office · Feed · Backpack · …
      CircleDetailScreen.tsx  (tab order defined here)
    profile/            Hero aura + badge stats
    agents/             Live agents dashboard (AgentsScreenLive.tsx)
    integrations/       Per-user connectors (GitHub, WP, Slack, …)
  components/
    chat/               ChatBuildStudio · ChatArtifacts · ChatTranscript
    PendingActionsOutbox.tsx
    agent/              MemoryViewer
  lib/
    supabase.ts         Platform-aware client singleton
    swanbot.ts          Main chat routing (tier 1 BlackSwan → tier 1.5 llm-proxy → tier 2 Claude → tier 3 Gemini)
    scheduledActions.ts CRUD + usePendingActions hook
    circleChatThreads.ts
    skills.ts           (planned)
    officeAgents.ts     Status derivation, DB clamp
    officeRoster.ts     Display ordering (OpenSwan first, local sessions next)
    hfProxy.ts          Typed HF client
    wordpressChatCommands.ts + siteAutomation.ts
    missions.ts, proofOfWork.ts, missionStreaks.ts
    gamification.ts, badges.ts, agentMemory.ts
  services/
    hitlService.ts      useAgentApprovals · useAgentControl · upsertAgentControl
    agentActivityLogger.ts
    projectRooms.ts, rewardService.ts, sharedMemory.ts
supabase/
  functions/            Edge functions (Deno)
    swanbot-ai, hf-proxy, llm-proxy, scheduled-action-runner,
    automation-executor, stripe-webhook, github-oauth, …
  migrations/           Append-only; run manually in SQL Editor
scripts/
  claude-bridge.js      HTTP bridge to ~/.claude/projects (port 7778)
  openswan-proxy.js     CORS + WebSocket proxy (port 18790)
  start-dev.js          Supervisor for all three dev services
  blackswan-llm/        Qwen fine-tune pipelines (v4 mini, v5 full)
docs/                   Architecture references (this folder)
```

## Routing / auth flow

- Auth state persisted in `localStorage` (web) / `AsyncStorage` (native)
- Nav state persisted to `localStorage.uc_nav_state_v1` — refresh preserves the tab
- Tab order in `src/screens/circles/CircleDetailScreen.tsx` — Chat · Rooms · Office · Feed · Backpack · Marketplace · Challenges · Members · Analytics · Profile
- Default chat agent display name is "OpenSwan"; internal id is `default::blackswan` — never rename the id

## Chat message flow

1. User types in ChatTab composer
2. `swanbot.ts getSwanBotResponse()` routes:
   - **Tier 1** — local BlackSwan LLM (Ollama) if available
   - **Tier 1.5** — `pickProviderForModel()` sends to `llm-proxy` if user picked GLM-5, MiniMax, or any non-Claude model in the picker
   - **Tier 2** — `swanbot-ai` edge fn (Claude Haiku default) with full circle context
   - **Tier 3** — Gemini fallback
3. Response written to `messages` table with the active `thread_id`
4. Realtime channel pushes to other clients in the same thread
5. If artifacts present, `ChatArtifacts` renders per-message; `ChatBuildStudio` pulls the latest `webpage` / `code` artifact for the side pane

## Building a new connector

Follow the `scheduled_actions` pattern:

1. Pick a kind (e.g. `notion_append`) — add to DB `CHECK` + union in `src/lib/scheduledActions.ts`
2. Add payload interface + executor function in `scheduled-action-runner/index.ts`; register in `EXECUTORS`
3. Deploy: `npx supabase functions deploy scheduled-action-runner`
4. Add a chat slash command (e.g. `/notion append`) in `huggingFaceChatCommands.ts` or `chatSlashCommands.ts`
5. Optional: per-user credentials via `user_api_keys` table + `get_user_api_key` RPC
6. Optional: UI surface in `IntegrationsTab.tsx` and the Chat Quick Actions palette

## Building a new edge function

Pattern from `scheduled-action-runner`:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url!, serviceKey!);

  // your logic
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

Deploy:

```bash
npx supabase functions deploy <name>
```

Secrets go via Supabase Vault or `npx supabase secrets set KEY=value`.

## Coding conventions

- Every significant section `<View>` gets a `nativeID="section-…"` for reference
- Business logic hooks at the top of components; callbacks middle; render labelled sections with `{/* ── SECTION: name ── */}`; styles at the bottom
- **No emojis in new UI** — use `<FlatIcon name="…" />` instead (see `src/components/FlatIcon.tsx`)
- Comments explain **why** not what; skip comments on obvious code
- Section-headers with box drawing (`─`) liberally in long files
- Idempotent SQL — migrations use `create table if not exists`, `drop policy if exists`, etc

## Known gotchas

1. **`profiles` join** → `profiles(display_name, username)`, NOT `profiles(email)` — `profiles` has no email column
2. **`user_xp`** PK is `user_id`, not `id`
3. **`circle_office_agents`** — no `model` column; owner FK is `owner_id` not `owner_user_id`; `status` CHECK allows `idle / building / offline` only (active is clamped via `clampToDbStatus`)
4. **`room_messages.message_type`** CHECK: `chat | agent_output | edit_event | system | playground`
5. **RN Web animation** — `Animated.loop` is a no-op; use CSS keyframes for infinite rotations
6. **RN Web pointer events** — use `useEffect` + `el.addEventListener('pointerdown')`, not the `onPointerDown` React prop
7. **`circle_members` recursive RLS** — see the `user_is_circle_member()` helper
8. **Agent appearances** keyed by `agent.name` (NOT `agent.id` — id format `${connId}::${sessionKey}` changes on reconnect)

## When adding a new feature

A 5-step checklist:

1. Is there a primitive that already solves this? (scheduled_actions, threads, agent_approvals, etc)
2. If DB: append-only migration + RLS + indexes; note in `docs/`
3. If edge function: copy the pattern above, deploy, set secrets
4. Client lib (`src/lib/<feature>.ts`) with types + hook; UI component separate
5. Update `docs/UC_APP_STACK_REFERENCE.md` with the new primitive

## Related docs

- `CLAUDE.md` (repo root) — project context for AI agents
- `docs/NEXT_LEVEL_PLAN.md` — feature roadmap
- `docs/OFFICE_ROADMAP.md` — Office tab spec
- `docs/CHAT_LIVE_BUILDER_ROADMAP.md` — Live Builder phases
- `docs/SOULS_SPIRITS_SKILLS_ROADMAP.md` — Agent composition roadmap
- `docs/SCHEDULED_ACTIONS_ARCHITECTURE.md` — Queue architecture
