# AGENT.md - Codex Notes

> Codex-specific repo guidance.
> Last reviewed: 2026-07-10

Start with `AGENTS.md`. Do not use this file as an alternate roadmap.
`docs/AGENTS_ROADMAP.md` is the authority for ownership, phase status, SQL
state, and runtime rules.

## Current App Lens

The Underground Circle is a web-first Expo 54 / React Native 0.81.5 /
React 19 app backed by Supabase. The core wedge is shared AI-agent
accountability for small dev teams:

- GitHub and provider integrations feed team context.
- Chat, Office, Feed, Rooms, and Marketplace are the primary work surfaces.
- BlackSwan/OpenSwan route user work through model selection, tool use,
  memory, approvals, and run telemetry.
- Computer Use covers Browserbase browser runs plus local desktop awareness
  through bridge tools and explicit approval gates.

## Codex Working Rules

- Read `docs/AGENTS_ROADMAP.md` before adding or moving any
  `src/lib/openswan*.ts`, `src/lib/agent*.ts`, chat automation, provider
  routing, computer-use, or agent-runtime SQL code.
- Use existing owners before inventing new paths. The current hot spots are
  `chatAutomationPlanner.ts`, `runChatAutomationPlan.ts`,
  `openswanToolRuntime.ts`, `agentExecutionCore.ts`,
  `serviceProfileSouls.ts`, `crossProviderRouter.ts`, `universalInvoke.ts`,
  `blackswanRouting.ts`, and `computerTaskRuntime.ts`.
- Treat the worktree as shared. Do not revert unrelated user or agent changes.
- Prefer small, focused patches and run the narrowest useful validation.
- For TypeScript-heavy changes, run `npm run typecheck`.
- For runtime changes, run the relevant smoke script from `package.json`.

## Critical Guarantees

- `src/lib/animationPatch.ts` must remain the first import in `App.tsx`.
- Use the shared Supabase singleton from `src/lib/supabase.ts`.
- New auth reads should use `safeGetUser`, `safeGetSession`, `safeGetUserId`,
  or `getFreshAccessToken` from `src/lib/authSession.ts`. If a direct
  `supabase.auth.getUser()` or `getSession()` call remains necessary, attach a
  `.catch(...)` handler.
- Do not add new `profiles.email` reads. `profiles` has `display_name` and
  `username`; use auth data for email.
- `circle_office_agents` has no `model` column. Owner FK is `owner_id`.
- `user_xp` primary key is `id` (FK to `profiles.id`); `user_id` is a mirror
  column added later (`20260310_fix_xp_system.sql`), not the PK.
- `room_messages.message_type` must stay within the DB check constraint.
- Agent memory, user memory, skill, credential, and integration writes need an
  approval or server-side guard where the roadmap requires one.

## Local Commands

```bash
npm run web
npm run start
npm run build
npm run typecheck
npm run proxy
npm run bridge
```

Useful smoke tests:

```bash
npm run smoke:agent-core
npm run smoke:chat-planner
npm run smoke:computer-task-runtime
npm run smoke:cross-provider-router
npm run smoke:bridge-health-diag
npm run smoke:agent-runtime
```

## Current Risk Areas

- Many older files still contain direct Supabase auth calls. Do not add new
  unsafe calls while touching those files; migrate opportunistically when the
  edit is already in scope.
- Provider routing now spans marketplace integrations, per-user keys,
  `llm-proxy`, `swanbot-ai`, `serviceProfileSouls`, and the chat model picker.
  Keep these paths aligned when adding a provider.
- Native Anthropic computer use is Sonnet-only in the edge loop. Non-Sonnet
  selections should fall back to the supported Sonnet computer-use model.
- `docs/RUN_THIS_SQL.sql` is consolidated helper SQL, not proof that a local
  migration has been applied in production. The roadmap SQL checklist owns
  status.
