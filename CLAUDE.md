# CLAUDE.md - The Underground Circle

> Project context for Claude Code, OpenSwan, Codex, Gemini, and other agents.
> Last reviewed: 2026-05-11

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
| Chat computer/app request routing | `src/lib/chatComputerRequestRouter.ts` |
| Chat computer/app user notices | `src/lib/chatComputerRequestUx.ts` |
| Computer task evidence contract | `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Chat execution | `src/lib/runChatAutomationPlan.ts` |
| BlackSwan response path | `src/lib/swanbot.ts`, `src/lib/swanbotClientToolDispatcher.ts`, `supabase/functions/swanbot-ai/index.ts` |
| v2 SwanBot tool loop | `supabase/functions/swanbot-v2-ai/index.ts`, `supabase/functions/_shared/swanbot-continuation.ts` |
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
| WordPress/Dealer Inspire admin automation | `src/lib/wpAdmin.ts`, `src/lib/computerAppTaskStrategy.ts`, `src/lib/chatComputerRequestRouter.ts`, `src/lib/userTaskPipelines.ts`, `src/lib/wordpressAdminSourceIntelligence.ts` |
| Design creative AI | `src/lib/designAppCreativeAi.ts` |
| Design execution pipeline | `src/lib/designAppExecutionPipeline.ts` |
| Photoshop ExtendScript adapters | `src/lib/photoshopExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Local CAD execution | `src/lib/cadCodeExecutor.ts`, `src/lib/cadFileInspector.ts`, `desktop.cad_compile` |
| A11y action verification diff | `src/lib/a11yTreeDiff.ts` |
| Illustrator ExtendScript adapters | `src/lib/illustratorExtendScriptAdapters.ts` (LOCKSTEP: `scripts/claude-bridge.js`) |
| Per-app automation profiles | `docs/apps/*.md` + `src/lib/appAutomationDocsIndex.ts` (status lockstep smoke) |
| App reachability (live ladder) | `src/lib/appReachability.ts`, `src/lib/appReachabilityProbe.ts`, tool `desktop.app_reachability`, `/apps` command |
| App screen observe/next-step | `src/lib/appScreenNextStep.ts`, tool `desktop.observe_app` (one-round-trip observe + Δ diff + suggestion) |
| Marketplace prompt context | `src/lib/marketplaceIntegrationContext.ts` |
| External/generic agent connect (bridges, MCP, custom dispatch) | `docs/AGENT_CONNECT.md` (ground-truth overview), `src/lib/chatAgentTargets.ts`, `src/lib/customAgentBridgeDispatcher.ts`, `src/lib/bridgeTaskDispatcher.ts`, `scripts/mcp-agent-connect.js` |
| Codebase index/search + @mentions + conventions (coding-agent P4) | `src/lib/codebaseIndexRuntime.ts`, `src/lib/projectConventions.ts`, pure cores `codebaseIndexCore/codebaseSymbolCore/codebaseMentionsCore` |
| Live TODO + tool-result summarization + run-and-fix gate (coding-agent P6) | `src/lib/agentTodoCore.ts` + `agentTodoStore.ts`, `src/lib/toolResultSummaryCore.ts` (in `agentExecutionCore.ts`), `src/lib/runAndFixGateCore.ts` (in `openswanSessionRuntime.ts`) |
| Google Workspace tools (Gmail/Docs/Sheets/Drive/Calendar) | `src/lib/googleWorkspaceOps.ts` (pure contracts), `src/lib/googleWorkspaceRuntime.ts` (token+fetch), `gmail.*`/`gdocs.*`/`gsheets.*`/`gdrive.*`/`gcal.*` in `openswanToolRuntime.ts`; OAuth Phase A: `supabase/functions/google-oauth/index.ts` + `src/lib/googleCreds.ts` |
| Cross-dashboard awareness (what's connected: marketplace/vault/Google/keys) | `src/lib/connectedResourcesDigest.ts` (pure, secret-safe) + `src/lib/connectedResourcesRuntime.ts` → `connected_resources` prompt section in `swanbot.ts` |
| Vault credential → browser login | `browser.fill_credential_field` (`credentialId` = circle vault via `vaultAgentAccess`, or `item` = 1Password) in `openswanToolRuntime.ts`; remote `fill_saved_login` in `supabase/functions/computer-use-agent/index.ts`; login-wall recovery pointer in `src/lib/computerTaskEvidenceRecovery.ts` |

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
- Tool-heavy BlackSwan requests use a reliable tool executor model —
  `BLACKSWAN_TOOL_EXECUTOR_MODEL_ID` in `src/lib/blackswanRouting.ts`
  (currently `claude-haiku-4-5`) — while BlackSwan remains app-grounding
  context.
- Training/auto-update: weekly launchd job on the dev Mac (Sunday 03:00,
  `scripts/blackswan-llm/launchd/`), full cycle in
  `scripts/blackswan-llm/train_cycle_v5.sh` — see
  `scripts/blackswan-llm/CONTINUOUS_TRAINING.md`.
- `buildBlackSwanGroundingBlock` injects app-state rules and safe memory
  references without exposing secrets.
- BlackSwan-v5 reliably garbles on the full Claude-shaped production system
  prompt. `supabase/functions/swanbot-ai/index.ts` sends BlackSwan text
  models a separate, shortened `buildBlackSwanSystemPrompt` (short persona +
  a few hand-picked facts, no tool catalog/personality/knowledge sections)
  instead; every call site gates this behind `isBlackSwanTextModel`. Output
  that still slips through garbled (leaked `<think>` tags, repetition loops,
  foreign-script salad, raw reasoning preambles) is caught by
  `looksLikeGarbledBlackSwanOutput`/`stripBlackSwanReasoningText` in the same
  file and replaced with an honest fallback message — a mitigation for a
  known training-distribution gap, not a full fix.
- `scripts/blackswan-llm/training_data_generated/` holds hand-curated,
  production-shaped training examples (checked into git, unlike the
  gitignored `training_data/`) loaded by `prepare_dataset_v4.py`.

OpenSwan remains the in-app shared agent/runtime brand. The internal default
agent id `default::blackswan` should not be renamed without a migration plan.

## Computer Use

For the end-to-end app/browser/desktop task pipeline (route -> contract -> loop
-> resume -> verify), the nine tool-loop reliability layers, cross-surface
parity, and the rules for extending it, see
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`.

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

Before executing a chat request that asks to operate another app, browser,
local file, CAD tool, Adobe design file, or unfamiliar desktop program,
`src/lib/chatComputerRequestRouter.ts` builds the hidden best path: computer
preview, selected pipeline, app/browser strategy, surface order, approvals,
fallback pipelines, recommended tools, and proof requirements. Keep this route
quiet in chat; show the user only approval, proof, or actionable blockers.
The route also carries the typed app automation decision from
`src/lib/appAutomationControlSurfaces.ts`, so app/browser tasks can stop for
fresh observation, approval, user action, or connected-agent buildout before
mutating another surface.
Use `src/lib/chatComputerRequestUx.ts` for that visible/hidden notice decision
so app/browser/desktop routes share the same user-friendly wording and actions.
Live computer handoff metadata and persisted chat rows should carry that notice
and the compact route-decision summary through
`src/lib/chatComputerHandoffContext.ts` instead of inventing new copy.
`src/lib/computerTaskEvidenceContract.ts` owns observe-before, actionability,
approval, proof-after, fail-closed, retry-evidence, and source-reference
requirements for those routes. `src/lib/computerTaskEvidenceRecovery.ts` owns
failure-time contract diagnosis so chat recovery can choose fresh-evidence
retry, user unblock, connected-agent adapter repair, or stop/report. It also
emits required evidence tools plus readiness state so retries can fail closed
when observations are missing or stale. Pass the compact app route decision into
that recovery path so route-level missing confirmations, approvals,
user-action blockers, and connected-agent buildout decisions shape the recovery
options instead of being lost after preflight.

Photoshop/InDesign creative-AI work uses `src/lib/designAppCreativeAi.ts` for
text-to-image, generative fill/remove, generative expand, creative variants, and
InDesign data-merge variant planning. It also turns those capabilities into
reusable recipes such as Photoshop generated background packs, variant contact
sheets, localized cleanup, canvas expansion, InDesign frame placement, placed
image expansion, and data-merge campaign variants. It requires prompt/data
approval, target-layer/frame/selection evidence, generated-output receipts,
proof verification, and connected-agent adapter buildout when the exact Firefly
or app bridge tool is missing.

Photoshop/InDesign task execution order lives in
`src/lib/designAppExecutionPipeline.ts`. That file combines automation plans,
operation runbooks, creative-AI recipes, and adapter-gap contracts into the
shared resolve -> observe -> approve -> mutate -> export/package -> verify ->
recover pipeline used by SwanBot/OpenSwan prompts, chat handoff metadata,
persisted chat rows, and connected-agent buildout prompts.

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
- `user_xp` primary key is `user_id`.
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
