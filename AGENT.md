# AGENT.md - The Underground Circle

> Repo guidance for Codex-style agents working in this project.
> Last updated: 2026-03-27

---

## Read This First

Before making changes, read these in order:

1. `CLAUDE.md` - master project context, architecture, current priorities
2. `MEMORY.md` - persistent gotchas, migrations, known issues
3. `Gemini.md` - condensed engineering guarantees
4. `docs/OFFICE_ROADMAP.md` - Office product direction
5. `docs/OFFICE_TAB_SPEC.md` - original Office design intent
6. `docs/PLAN_STATUS_AUDIT.md` - current audit of which plan docs are still canonical
7. `docs/REAL_DATA_AUDIT.md` - real-data assumptions for Office features
8. `LAUNCH_AUDIT.md` - launch blockers, security gaps, UX debt
9. `docs/agent-role-research.md` - prompt/persona research for agent roles

---

## Strategic Focus

The current core product is not "everything in the app." The main wedge is:

- GitHub integration
- BlackSwan as the shared accountability agent
- Small dev teams tracking real shipping activity

Important implication:

- The Office dashboard is a flagship experience, but it should reinforce the shared-agent / team-ops story.
- The Feed dashboard should become the operational layer for goals, plans, tasks, and agent execution.
- Wallet, games, and novelty features are lower priority unless they directly support retention or team accountability.

---

## Project Snapshot

- Stack: Expo 54, React Native 0.81.5, React 19, TypeScript
- Backend: Supabase Auth + Postgres + Realtime + Edge Functions
- Agent inputs: OpenSwan, Claude Code bridge, custom/published circle agents
- Web deploy: Netlify
- Local source of truth: WSL path `/home/swan/the-underground-circle`

This repo is web-first. Mobile support exists, but many architectural choices are driven by React Native Web behavior.

---

## Critical Guarantees

Do not break these:

- `src/lib/animationPatch.ts` must stay the first import in `App.tsx`.
- `supabase.auth.getUser()` and `getSession()` calls must always have `.catch(...)`.
- Use the shared Supabase singleton in `src/lib/supabase.ts`.
- On RN Web, use native DOM pointer listeners when React pointer props are unreliable.
- Office furniture and placement stay on the 16px grid.
- Agent appearances are keyed by stable identity, not volatile session wiring.
- `circle_office_agents` has no `model` column.
- `profiles` has no `email` column.
- `user_xp` primary key is `user_id`, not `id`.

---

## Commands

Core local commands:

```bash
npm run web
npm run start
npm run build
npm run proxy
npm run generate-sprites
```

Expected local endpoints:

- App dev server: `http://localhost:8081`
- OpenSwan proxy: `http://localhost:18790`
- Claude Code bridge: `http://localhost:7778`

When changing TypeScript-heavy code, run:

```bash
npx tsc --noEmit --skipLibCheck
```

---

## Dashboard Notes

### Office Dashboard

Primary file:

- `src/screens/circles/tabs/OfficeTab.tsx`

Supporting surfaces:

- `src/screens/circles/tabs/office/OfficeFloor.tsx`
- `src/components/OfficeTerminal.tsx`
- `src/components/OfficeActionPanel.tsx`
- `src/components/AgentActivityFeed.tsx`
- `src/lib/officeAgents.ts`
- `src/lib/circleOffice.ts`
- `src/lib/agentAutoConnect.ts`

Current reality:

- `OfficeTab.tsx` is a very large orchestration component that mixes data loading, persistence, subscriptions, rendering, interactions, and game/furniture logic.
- The office merges live sessions, auto-detected agents, and DB-backed circle agents.
- Layout, themes, whiteboard notes, telegram config, and appearances are dual-persisted locally plus to Supabase.

Preferred implementation direction:

- Pull data/subscription logic into focused hooks.
- Keep rendering components mostly pure.
- Centralize agent identity resolution and live-agent merging into shared utilities.
- Treat Office as a control surface, not a dumping ground for unrelated experiments.

### Feed Dashboard

Primary file:

- `src/screens/circles/tabs/FeedTab.tsx`

Supporting surfaces:

- `src/hooks/useKanbanData.ts`
- `src/hooks/useGoals.ts`
- `src/hooks/usePlans.ts`
- `src/screens/circles/tabs/kanban/AgentTopBar.tsx`
- `src/screens/circles/tabs/kanban/OrchestraPanel.tsx`
- `src/screens/circles/tabs/kanban/GoalsPanel.tsx`
- `src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx`
- `src/screens/circles/tabs/kanban/KanbanBoard.tsx`

Current role:

- Feed is the team operating dashboard.
- It combines goals, plans, activity, live agents, and task execution.
- It should evolve toward a clear `plan -> assign -> run -> review` workflow.

Preferred implementation direction:

- Use one shared agent-resolution pipeline across Feed and Office.
- Route task execution through the real agent invocation layer, not a parallel path.
- Keep search/filter semantics consistent across board, agent tasks, and activity views.
- Add pagination / virtualization before task volume grows further.

---

## Data and Persistence

Important persistent stores:

- Local storage / AsyncStorage for Office layout, appearances, session tags, budget config, telegram config
- Supabase `profiles.office_layout`
- Supabase `profiles.agent_appearance`
- Supabase `profiles.office_preferences`
- Supabase `circle_office_agents`
- Supabase `agent_activity`
- Supabase `tasks`, `goals`, `circle_plans`

Important caveat:

- Several profile columns and Office-related migrations are documented as not guaranteed to exist in every environment. Code should degrade safely when these columns are missing.

---

## Known Open Risks

From repo docs plus current code review:

- Office still carries launch-risk around connection clarity, error handling, and token storage.
- Feed and Office do not fully share the same agent execution path yet.
- Hardcoded list limits still exist in task/member/activity flows.
- The Office and Feed tabs both contain orchestration logic that should move into shared hooks/services.

---

## Working Rules

- Prefer WSL-native file access and paths when possible.
- Avoid adding new dependencies unless there is a strong reason.
- Keep UI sharp-edged and consistent with the pixel design rules in `CLAUDE.md`.
- When touching Office or Feed, verify desktop and mobile behavior separately.
- If a change depends on missing Supabase schema, guard it instead of assuming it exists.
- If you change architectural behavior, update `CLAUDE.md`, `MEMORY.md`, and this file when appropriate.

---

## Immediate Product Lens

When choosing what to improve next, bias toward:

1. clearer team accountability loops
2. real agent observability and execution
3. lower-friction onboarding into Office / Feed
4. fewer duplicated code paths between dashboards
5. reliability before feature sprawl

If a feature does not strengthen one of those, question it before building.
