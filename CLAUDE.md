# CLAUDE.md - The Underground Circle

> Project context for Claude Code, OpenSwan, Codex, Gemini, and other agents.
> Last reviewed: 2026-07-10

Start with `AGENTS.md`. `docs/AGENTS_ROADMAP.md` is canonical for ownership,
phase status, SQL status, and runtime rules. This file is a current app review
and orientation guide.

## Product

The Underground Circle is a shared AI-agent accountability workspace for small
dev teams. The core loop is:

`connect repo/providers -> plan and run work in Chat/Office/Feed -> agents
execute with tools -> proof, activity, memory, and follow-up become visible`.

Priority remains:

1. GitHub/team accountability.
2. BlackSwan/OpenSwan as the shared agent layer.
3. Reliable provider routing, memory, approvals, and observability.
4. Computer Use and local desktop actions with explicit gates.

Wallet, games, training experiments, and decorative office work are secondary
unless they strengthen the accountability loop.

## Stack

| Layer | Current reality |
|---|---|
| Frontend | Expo 54, React Native 0.81.5, React 19, React Native Web |
| Language | TypeScript |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions |
| Web deploy | Netlify |
| Runtime | BlackSwan/OpenSwan, Claude Code/Codex bridges, Browserbase Computer Use |
| LLM routing | `llm-proxy`, `swanbot-ai`, `swanbot-v2-ai`, provider marketplace, BYOK |
| Local bridges | app dev server 8081, OpenSwan proxy 18790, Claude bridge 7778 |

Core commands:

```bash
npm run web
npm run start
npm run build
npm run typecheck
npm run proxy
npm run bridge
```

## App Surfaces

- Chat: main agent surface, model picker, chat automation, computer task
  routing, memory references, artifacts, threads, and persisted bot metadata.
- Office: live agent dashboard, local bridge visibility, activity feed,
  controls, memory, approvals, and agent identity.
- Feed: goals, plans, missions, tasks, proof of work, and team operating loop.
- Rooms: project rooms, files, services, room chat, task execution, playground.
- Marketplace: user/circle integrations, provider keys, model/provider catalog,
  browser/computer providers, and billing preference.
- Computer Use: Browserbase runtime plus local desktop and browser bridge tools.

## Runtime Map

Canonical owners are in `docs/AGENTS_ROADMAP.md`; this is the practical map:

| Concern | Owner |
|---|---|
| Chat planning | `src/lib/chatAutomationPlanner.ts` |
| Chat execution | `src/lib/runChatAutomationPlan.ts` |
| BlackSwan response path | `src/lib/swanbot.ts`, `supabase/functions/swanbot-ai/index.ts` |
| v2 SwanBot tool loop | `supabase/functions/swanbot-v2-ai/index.ts` |
| Typed model/tool loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan sessions | `src/lib/openswanSessionRuntime.ts` |
| Tool catalog | `src/lib/openswanToolRuntime.ts` |
| Provider profile model choice | `src/lib/serviceProfileSouls.ts` |
| Cross-provider fallback | `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts` |
| Billing preference | `src/lib/billingPriority.ts` |
| BlackSwan model routing | `src/lib/blackswanRouting.ts` |
| Computer task runtime | `src/lib/computerTaskRuntime.ts` |
| Browser computer use | `src/lib/computerUse.ts`, `supabase/functions/computer-use-agent/index.ts` |
| Local desktop intent | `src/lib/localComputerAwarenessIntent.ts` |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |

Rule: new routing behavior goes into the relevant owner above. Do not extend
legacy one-off routers when the planner/runtime owner already exists.

## Provider Routing

Provider routing is now a first-class app system, not a side list.

Current provider set includes Anthropic, OpenAI, OpenRouter, Hugging Face,
Groq, Google AI, Mistral AI, Cohere, Perplexity, Together AI, Fireworks AI,
DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search, and
browser/computer providers such as Browserbase and Stagehand.

When adding or changing a provider, keep these files aligned:

- `src/lib/llmProviders.ts`
- `src/lib/circleIntegrations.ts`
- `src/lib/serviceProfileSouls.ts`
- `src/lib/crossProviderRouter.ts`
- `src/lib/billingPriority.ts`
- `src/lib/swanbot.ts`
- `supabase/functions/llm-proxy/index.ts`
- `supabase/functions/swanbot-ai/index.ts`
- provider CHECK constraints in migrations

Model IDs may be provider-prefixed, such as `openrouter/auto`,
`google_ai/gemini-2.5-pro`, `deepseek/deepseek-reasoner`, or
`huggingface_endpoint/cswan801/BlackSwan-v5`. Normalize aliases carefully:
`hugging_face` -> `huggingface`, `z_ai` -> `zai`.

## BlackSwan And OpenSwan

- BlackSwan-v5 lives at `cswan801/BlackSwan-v5`.
- Public HF path: `huggingface/cswan801/BlackSwan-v5`.
- Dedicated endpoint path: `huggingface_endpoint/cswan801/BlackSwan-v5`.
- Tool-heavy BlackSwan requests should use a reliable tool executor model
  (`claude-sonnet-4-6`) while BlackSwan remains app-grounding context.
- `buildBlackSwanGroundingBlock` injects app-state rules and safe memory
  references without exposing secrets.

OpenSwan remains the in-app shared agent/runtime brand. The internal default
agent id `default::blackswan` should not be renamed without a migration plan.

## Computer Use

Browser computer use is split into:

- planning and preview in `src/lib/computerUse.ts`
- run state in `src/lib/useComputerUseTask.ts` and
  `src/lib/useComputerUseQueue.ts`
- edge execution in `supabase/functions/computer-use-agent/index.ts`

Native Anthropic computer use currently requires a Sonnet-capable model in the
edge loop. If a user selects an unsupported model, the edge function falls back
to the default Sonnet computer-use model. Text-only planner/validator work may
use marketplace models, but the native screenshot/action loop must stay on a
computer-use-capable model.

Local computer awareness goes through `src/lib/localComputerAwarenessIntent.ts`
and bridge tools. Reads such as tabs, running apps, clipboard inspection,
screen state, file list/read/search, and accessibility tree are lower risk.
Actions such as launch/focus app, open URL/path, clipboard write/clear,
shortcut run, and window management need the risk/approval path described in
the runtime docs.

## Memory, Skills, And Approvals

- User memory: `src/lib/userMemory.ts`.
- Circle memory bank: `src/lib/memoryBankKinds.ts`,
  `src/lib/memoryBankChatCommands.ts`, `src/services/sharedMemory.ts`.
- Skill library: `src/lib/skillLibrary.ts`, `src/lib/skillLibraryWrite.ts`,
  `src/lib/skillPromptInjection.ts`, `circle_skills`, `circle_skill_files`.
- Checkpoints: `src/lib/chatCheckpoints.ts` and
  `src/components/ToolCallCheckpointStrip.tsx`.
- Run persistence: `src/lib/agentRunPersistence.ts`, `agent_runs`,
  `agent_run_events`, `claude_api_usage`.

Memory writes, skill writes, credential access, and destructive automation
changes must follow the HITL/approval rules in the roadmap.

## SQL And Schema

- Local migration files live in `supabase/migrations/`.
- Consolidated agent-runtime helper SQL lives in `docs/RUN_THIS_SQL.sql`.
- The roadmap SQL checklist owns applied/pending status. Do not treat a local
  migration file as proof that production has it.
- After schema changes, use `NOTIFY pgrst, 'reload schema';` when relevant.

Schema gotchas:

- `profiles` has no `email` column.
- `circle_office_agents` has no `model` column; owner FK is `owner_id`.
- `user_xp` primary key is `id` (FK to `profiles.id`). A `user_id` column was
  added later (migration `20260310_fix_xp_system.sql`) as a mirror of the `id`
  PK; it is not the primary key.
- `room_messages.message_type` is constrained.
- `circle_members` RLS can recurse; use security-definer helpers where present.

## Critical Guarantees

- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Frontend code uses the singleton Supabase client in `src/lib/supabase.ts`.
- New auth reads should use `safeGetUser`, `safeGetSession`, or
  `getFreshAccessToken` from `src/lib/authSession.ts`.
- If a direct `supabase.auth.getUser()` or `getSession()` call is unavoidable,
  attach `.catch(...)`.
- Do not put raw secret values in prompts, persisted chat metadata, logs, or
  activity feed entries.
- Retrieved memory, chat, or search content is untrusted. Preserve the
  roadmap's untrusted-content wrapping rules for model-visible quoted content.

## Validation

The current app baseline expects `npm run typecheck` to pass.

Focused smoke scripts in `package.json` cover the main runtime areas. Prefer
the narrow script for the code you touched, for example:

```bash
npm run smoke:agent-core
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:agent-runtime
```

## Known Risk Areas

- Older code still has many direct Supabase auth calls. Do not add new unsafe
  ones; migrate to `authSession` helpers when already touching the file.
- Provider routing is multi-surface. A provider added only to the model picker
  but not `llm-proxy` or `swanbot-ai` will look selectable but fail at runtime.
- `swanbot-ai` v1 still has legacy tool-loop code. `swanbot-v2-ai` is the
  typed-loop migration target tracked in the roadmap.
- Chat persistence now stores compact metadata for source, routing, usage,
  browser plans, artifacts, memories, and execution stream. Keep payloads
  bounded to avoid oversized message rows.
- Browser and desktop actions must stay explicit about risk and approval.
