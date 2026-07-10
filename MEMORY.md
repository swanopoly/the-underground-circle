# MEMORY.md - The Underground Circle

> Persistent project memory for agents.
> Last reviewed: 2026-07-10

`docs/AGENTS_ROADMAP.md` is the authority when this memory conflicts with a
plan, ownership table, or SQL status.

## Product Identity

- App: The Underground Circle.
- Live URL: `https://app.chrisswanson.xyz`.
- Repo: `github.com/swanopoly/the-underground-circle`.
- Local repo path varies by machine and worktree; use the current working
  directory rather than a hardcoded path.
- Core wedge: shared AI-agent accountability for small dev teams. BlackSwan
  watches repo/team activity, routes work through agents, and turns runs into
  visible proof, memory, and follow-up.

## Current Stack

- Expo 54, React Native 0.81.5, React 19, TypeScript.
- Supabase Auth, Postgres, Realtime, Edge Functions.
- Netlify web deploy.
- Browserbase-backed Computer Use plus local desktop bridge tools.
- Provider marketplace and BYOK routing through `llm-proxy`, `swanbot-ai`,
  circle integrations, and per-user keys.

## Runtime Memory

- Chat and agent runtime are centered on BlackSwan/OpenSwan.
- `src/lib/chatAutomationPlanner.ts` classifies chat into execution plans.
- `src/lib/runChatAutomationPlan.ts` executes normalized chat plans.
- `src/lib/openswanToolRuntime.ts` owns the runtime tool catalog.
- `src/lib/agentExecutionCore.ts` owns the typed model/tool loop.
- `src/lib/serviceProfileSouls.ts` resolves profile/model choices using
  route intent, complexity, and connected providers.
- `src/lib/crossProviderRouter.ts`, `src/lib/universalInvoke.ts`, and
  `src/lib/billingPriority.ts` own cross-provider fallback and billing
  preference logic.
- `src/lib/blackswanRouting.ts` owns BlackSwan-v5 routing metadata and the
  rule that tool-heavy BlackSwan requests use a Sonnet tool executor while
  BlackSwan remains grounding context.

## Provider Memory

Connected provider names appear in several forms. Normalize carefully:

| Canonical | Legacy/alias |
|---|---|
| `huggingface` | `hugging_face`, `huggingface_endpoint` |
| `zai` | `z_ai` |
| `google_ai` | Google AI Studio / Gemini direct |
| `openrouter` | `openrouter/auto`, provider-prefixed OR model IDs |

Current marketplace/BYOK set includes Anthropic, OpenAI, OpenRouter, Hugging
Face, Groq, Google AI, Mistral AI, Cohere, Perplexity, Together AI, Fireworks
AI, DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search,
and browser/computer providers such as Browserbase and Stagehand.

When adding a provider, keep these in sync:

- `src/lib/llmProviders.ts`
- `src/lib/circleIntegrations.ts`
- `src/lib/serviceProfileSouls.ts`
- `src/lib/crossProviderRouter.ts`
- `src/lib/billingPriority.ts`
- `src/lib/swanbot.ts`
- `supabase/functions/llm-proxy/index.ts`
- `supabase/functions/swanbot-ai/index.ts`
- relevant DB provider checks or migrations

## Computer Use Memory

- Browser tasks can enter through chat automation or the Computer Use console.
- Browserbase native computer use runs in
  `supabase/functions/computer-use-agent/index.ts`.
- The native Anthropic computer-use edge loop should use a Sonnet-capable
  model. Non-Sonnet selections fall back to the default Sonnet computer-use
  model.
- Local desktop awareness intent lives in
  `src/lib/localComputerAwarenessIntent.ts`.
- Local desktop actions need explicit risk classification and approval when
  they can mutate local state or trigger external side effects.

## Schema Gotchas

| Table/path | Gotcha |
|---|---|
| `profiles` | No `email` column. Use auth data for email. |
| `circle_office_agents` | No `model` column. Owner FK is `owner_id`. |
| `user_xp` | Primary key is `id` (FK to `profiles.id`). `user_id` is a mirror column added later (`20260310_fix_xp_system.sql`), not the PK. |
| `room_messages` | `message_type` is constrained to known message kinds. |
| `circle_members` RLS | Avoid recursive policy reads; use security-definer helpers where available. |
| `circle_integrations` | Provider CHECK must include any new marketplace provider. |

## Critical Guarantees

- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Frontend code uses the shared Supabase singleton from `src/lib/supabase.ts`.
- New auth reads should use `src/lib/authSession.ts` helpers or attach
  `.catch(...)` to direct Supabase auth calls.
- Memory writes and skill writes must follow the roadmap HITL rules.
- Secret values never go into prompts. Marketplace integration context is
  sanitized; only connection status, safe metadata, and secret key names may be
  shown.

## Validation Baseline

- `npm run typecheck` is expected to pass.
- Use focused smoke tests from `package.json` for runtime changes.
- Do not preserve old "known safe TypeScript errors" guidance.

## SQL Memory

- `supabase/migrations/` contains append-only local migration files.
- `docs/RUN_THIS_SQL.sql` is the consolidated idempotent helper for agent
  runtime SQL that agents may be asked to paste into Supabase SQL Editor.
- `docs/AGENTS_ROADMAP.md` section 5 owns the applied/pending status. Do not
  infer production state from the presence of a local migration file.
