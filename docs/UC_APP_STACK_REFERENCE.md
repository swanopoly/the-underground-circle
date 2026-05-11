# The Underground Circle - App Stack Reference

> Current app map for agents before writing code.
> Last reviewed: 2026-05-09

`AGENTS.md` and `docs/AGENTS_ROADMAP.md` own agent workflow and runtime
ownership. This file maps the app.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| AI/runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| Provider routing | `llm-proxy`, `swanbot-ai`, provider marketplace, BYOK keys |
| Local services | app 8081, OpenSwan proxy 18790, Claude bridge 7778 |

## Do-Not-Break Patterns

1. `src/lib/animationPatch.ts` must be the first import in `App.tsx`.
2. Use the frontend Supabase singleton in `src/lib/supabase.ts`.
3. Prefer `src/lib/authSession.ts` helpers for auth reads. Direct Supabase auth
   calls must be caught.
4. Do not put secret values into prompts, persisted chat messages, logs, or
   activity entries.
5. React Native Web pointer behavior is uneven; use DOM listeners when local
   patterns already do.
6. Office placement stays on the 16px grid.

## Main Surfaces

| Surface | Role |
|---|---|
| Chat | Agent conversation, model picker, automation routing, computer tasks, artifacts, thread persistence |
| Office | Live agent dashboard, local bridge visibility, activity feed, controls, approvals |
| Feed | Goals, plans, missions, tasks, proof of work, team operating loop |
| Rooms | Project rooms, file surfaces, room chat, services, playground, task execution |
| Marketplace | Provider keys, integrations, model catalog, browser/computer providers |
| Computer Use | Browserbase sessions, local bridge tools, guarded desktop/browser actions |

## Core Runtime Files

| Concern | File(s) |
|---|---|
| Chat classification | `src/lib/chatAutomationPlanner.ts` |
| Chat plan execution | `src/lib/runChatAutomationPlan.ts` |
| SwanBot client path | `src/lib/swanbot.ts` |
| SwanBot edge path | `supabase/functions/swanbot-ai/index.ts` |
| SwanBot v2 typed loop | `supabase/functions/swanbot-v2-ai/index.ts` |
| Typed agent loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan session runtime | `src/lib/openswanSessionRuntime.ts` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider model resolution | `src/lib/serviceProfileSouls.ts` |
| Cross-provider routing | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime | `src/lib/computerTaskRuntime.ts` |
| Browser computer use | `src/lib/computerUse.ts`, `supabase/functions/computer-use-agent/index.ts` |
| Local desktop awareness | `src/lib/localComputerAwarenessIntent.ts` |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |

## Repo Layout

```text
src/
  screens/
    auth/
    circles/
      tabs/                 Chat, Rooms, Office, Feed, Marketplace, etc.
    profile/
    agents/
  components/
    chat/
    agent/
    computer-use/
    marketplace/
    openswan/
  lib/
    supabase.ts
    authSession.ts
    swanbot.ts
    agentExecutionCore.ts
    openswanSessionRuntime.ts
    openswanToolRuntime.ts
    chatAutomationPlanner.ts
    runChatAutomationPlan.ts
    serviceProfileSouls.ts
    crossProviderRouter.ts
    universalInvoke.ts
    computerUse.ts
    computerTaskRuntime.ts
supabase/
  functions/
    swanbot-ai/
    swanbot-v2-ai/
    llm-proxy/
    computer-use-agent/
    automation-executor/
    heartbeat-agent/
  migrations/
scripts/
  claude-bridge.js
  browser-bridge.js
  codex-bridge.js
  gemini-bridge.js
  mcp-agent-connect.js
docs/
```

## Chat Flow

1. User sends through `ChatTab`.
2. `chatAutomationPlanner` classifies the message and execution kind.
3. Stable plan kinds go through `runChatAutomationPlan`.
4. Plain agent/model turns route through SwanBot/OpenSwan runtime paths.
5. Provider choice is resolved by selected model, connected providers,
   `serviceProfileSouls`, and cross-provider routing helpers.
6. Bot output is persisted to the active chat thread with compact metadata for
   source, routing, usage, artifacts, memory refs, browser plans, and runtime
   events.

## Provider And Marketplace Flow

- `src/lib/llmProviders.ts` defines provider types, default model lists, key
  CRUD, and `invokeLLMProxy`.
- `src/lib/circleIntegrations.ts` owns circle-level integrations.
- `supabase/functions/llm-proxy/index.ts` calls OpenAI-compatible providers and
  Anthropic branches with user-stored keys.
- `supabase/functions/swanbot-ai/index.ts` can relay marketplace-prefixed
  models with tools.
- `src/lib/billingPriority.ts` controls provider preference modes:
  `prefer_direct`, `prefer_openrouter`, and `cheapest`.

Keep provider enums, model prefixes, UI cards, edge support, and DB provider
constraints aligned.

## Computer Use Flow

- Chat/browser tasks plan through `src/lib/computerUse.ts`.
- Native browser execution uses `supabase/functions/computer-use-agent/index.ts`
  and Browserbase.
- Local app/browser/file awareness uses bridge tools and
  `src/lib/localComputerAwarenessIntent.ts`.
- Native Anthropic computer use in the edge function must use a Sonnet-capable
  model; unsupported selections fall back to the default Sonnet computer-use
  model.

## Schema Gotchas

| Item | Gotcha |
|---|---|
| `profiles` | No `email` column. Use auth user data for email. |
| `circle_office_agents` | No `model` column. Owner FK is `owner_id`. |
| `user_xp` | Primary key is `user_id`. |
| `room_messages.message_type` | Must match the DB check constraint. |
| `circle_integrations.provider` | CHECK constraint must include any new provider. |
| `circle_members` RLS | Avoid recursive policy reads; use security-definer helpers where available. |

## SQL

- Local migrations are append-only in `supabase/migrations/`.
- Consolidated idempotent agent SQL is in `docs/RUN_THIS_SQL.sql`.
- Roadmap section 5 owns applied/pending status.
- Use `NOTIFY pgrst, 'reload schema';` after schema changes when relevant.

## Validation

```bash
npm run typecheck
npm run build
```

Use focused smoke scripts from `package.json` for runtime changes.
