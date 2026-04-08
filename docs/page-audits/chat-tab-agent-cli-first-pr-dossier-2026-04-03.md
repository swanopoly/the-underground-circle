# ChatTab Agent CLI First PR Dossier

Date: 2026-04-03
Primary surface: `src/screens/circles/tabs/ChatTab.tsx`
Audience: Claude or another implementation agent
Depends on:

- `docs/page-audits/chat-tab-agent-cli-deep-audit-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-implementation-spec-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-expansion-master-roadmap-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-external-patterns-addendum-2026-04-03.md`

## Why This File Exists

The prior docs answer:

- what is wrong with the current ChatTab
- what the target product should become
- how that target should expand across the app

This file answers a narrower question:

- what should the first implementation PR actually contain

The goal of PR1 is not to ship the full agent operating system.

The goal of PR1 is to establish the new backbone:

- sessions
- transcript entries
- runs
- run steps
- approvals
- artifacts
- command-oriented UI shell

Without breaking the rest of the app.

## Non-Negotiable Product Constraint

Do not try to convert the entire app in one pull request.

PR1 should:

- create the new agent-chat primitives
- route `ChatTab` onto those primitives
- keep legacy circle messaging available only as fallback or legacy mode
- avoid rewriting Office, Feed, Rooms, or GitHub in the same change

PR1 should not:

- solve full multi-agent orchestration
- solve full workflow automation
- solve all room/file/task integrations
- solve background scheduling beyond basic status persistence
- remove the legacy `messages` table

## Current State Snapshot

The existing `ChatTab` is still built as a social group chat.

Current anchors in the code:

- state bag for many unrelated concerns: `src/screens/circles/tabs/ChatTab.tsx`
- loads and subscribes to legacy `messages`: `src/screens/circles/tabs/ChatTab.tsx`
- inserts directly into `messages`: `src/screens/circles/tabs/ChatTab.tsx`
- hardcoded AI trigger on `@agent` and prompt cards: `src/screens/circles/tabs/ChatTab.tsx`
- social/games empty state and destructive “nuke” action: `src/screens/circles/tabs/ChatTab.tsx`
- composer placeholder still says “Message your circle”: `src/screens/circles/tabs/ChatTab.tsx`

The existing app already has more agent-native patterns elsewhere:

- `office_terminal_messages` in `supabase/migrations/20260226_office_terminal.sql`
- terminal model targeting in `supabase/migrations/20260312_terminal_model_and_multi_target.sql`
- invocation pipeline in `src/lib/agentInvocation.ts`
- command parsing in `src/lib/advancedChatCommands.ts`

That means PR1 should not invent a parallel universe. It should converge existing agent work into a cleaner session/run model.

## PR1 Scope

PR1 should deliver these user-visible outcomes:

1. A user can create a named chat session inside a circle.
2. A user can resume a prior session from a left rail.
3. A prompt is stored as a session entry, not only as a generic circle message.
4. An agent response is represented as a run with machine-readable status.
5. A run can expose step updates, artifacts, and approval requests in the UI even if those are initially sparse.
6. The composer behaves like an agent console, not like social chat.
7. The old prompt-card/games-heavy empty state is removed from the default path.
8. The shell clearly shows current session, mode, target, model, and run state.
9. The composer supports visible command suggestions and active-run follow-up behavior.

PR1 does not need:

- collaborative session sharing controls
- subagent fanout
- diff viewers for real code output
- room/file attachment execution
- a complete mobile redesign beyond basic stacked navigation
- full session branching UI
- workflow/package marketplace mechanics

## Exact PR1 Deliverables

### 1. New Supabase schema

Add one new migration, do not rewrite old migrations.

Suggested filename:

- `supabase/migrations/20260403_chat_agent_cli_pr1.sql`

Create these tables:

- `chat_sessions`
- `chat_entries`
- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`
- `chat_run_approvals`

### 2. New chat-specific client library

Add a focused library that owns all session/run persistence:

- `src/lib/chatSessions.ts`

This should own:

- loading sessions
- creating sessions
- appending entries
- creating runs
- updating run status
- appending steps
- appending artifacts
- resolving approvals
- realtime subscriptions

Do not scatter new DB code directly across many UI components.

### 3. ChatTab shell split

Break the monolith enough to make iteration possible.

Create:

- `src/screens/circles/tabs/chat/ChatTabShell.tsx`
- `src/screens/circles/tabs/chat/ChatSidebar.tsx`
- `src/screens/circles/tabs/chat/ChatSessionHeader.tsx`
- `src/screens/circles/tabs/chat/ChatStatusBar.tsx`
- `src/screens/circles/tabs/chat/ChatTranscript.tsx`
- `src/screens/circles/tabs/chat/ChatComposer.tsx`
- `src/screens/circles/tabs/chat/RunInspector.tsx`
- `src/screens/circles/tabs/chat/EmptySessionState.tsx`
- `src/screens/circles/tabs/chat/chatTypes.ts`

Keep `src/screens/circles/tabs/ChatTab.tsx` as a thin entrypoint that renders the new shell.

### 4. Minimal execution bridge

PR1 should support one execution path:

- `BlackSwan`

Optionally support a second execution path if already cheap to wire:

- office agent through `src/lib/agentInvocation.ts`

Do not block PR1 on generalized provider support.

### 5. Legacy coexistence

Do not delete old social-chat capabilities in PR1.

Instead:

- stop making them the default UI
- leave old `messages` table untouched
- if needed, expose a small “Legacy chat” affordance later

## PR1 Interaction Upgrades

These are the highest-value interaction ideas that should be pulled into PR1 instead of being treated as vague future polish.

### Command-first composer

PR1 should visibly support:

- `/` commands
- `@` references
- multi-line input
- explicit mode switching

PR1 should not expose arbitrary shell execution.

For this app, `!` should mean:

- explicit agent action intent

not:

- unrestricted terminal command passthrough

### Active-run composer behavior

When a run is active, the composer should not become ambiguous.

PR1 should expose:

- `Steer run`
- `Queue next`

If full queue orchestration is not ready, the initial implementation can persist queued intent in entry metadata and render it in the transcript.

### Status bar

PR1 should include a lightweight persistent status/footer bar showing:

- session title
- mode
- target
- model
- run status
- pending approvals count

Token or cost values can be added later, but the UI slot should exist now.

### Command suggestion system

PR1 should surface suggestions for at least:

- `/new`
- `/resume`
- `/plan`
- `/review`
- `/share`
- `/compact`

If `/share` and `/compact` are not implemented yet, they can appear as disabled or next-up suggestions rather than disappearing.

## Exact Migration Draft

The SQL below is a proposed starting point for Claude to implement and adjust to local schema realities.

```sql
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  status text not null default 'active'
    check (status in ('active', 'running', 'paused', 'completed', 'failed', 'archived')),
  mode text not null default 'talk'
    check (mode in ('talk', 'plan', 'execute', 'review')),
  target_kind text not null default 'blackswan'
    check (target_kind in ('blackswan', 'office-agent', 'shared-agent')),
  target_agent_id uuid references circle_office_agents(id) on delete set null,
  model text,
  is_pinned boolean not null default false,
  last_entry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  role text not null
    check (role in ('user', 'assistant', 'system')),
  entry_type text not null default 'message'
    check (entry_type in ('message', 'summary', 'notice', 'run-link', 'approval-link')),
  content text not null default '',
  reply_to_entry_id uuid references chat_entries(id) on delete set null,
  parent_entry_id uuid references chat_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  triggering_entry_id uuid references chat_entries(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  target_kind text not null
    check (target_kind in ('blackswan', 'office-agent', 'shared-agent')),
  target_agent_id uuid references circle_office_agents(id) on delete set null,
  target_label text not null,
  mode text not null
    check (mode in ('talk', 'plan', 'execute', 'review')),
  model text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  summary text,
  error_text text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chat_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  step_kind text not null
    check (step_kind in ('thought', 'tool', 'output', 'status', 'approval', 'error')),
  title text not null,
  body text,
  status text not null default 'completed'
    check (status in ('pending', 'running', 'completed', 'failed')),
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  artifact_kind text not null
    check (artifact_kind in ('text', 'link', 'file', 'diff', 'summary')),
  title text not null,
  content text,
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_run_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references chat_runs(id) on delete cascade,
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  approval_kind text not null
    check (approval_kind in ('execute', 'external-write', 'message-send', 'sensitive-access')),
  title text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists chat_session_context_sources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  circle_id uuid not null references circles(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('tasks', 'goals', 'room', 'github', 'members', 'files', 'activity', 'custom')),
  source_ref text,
  is_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_circle_last_entry
  on chat_sessions (circle_id, last_entry_at desc);

create index if not exists idx_chat_entries_session_created
  on chat_entries (session_id, created_at asc);

create index if not exists idx_chat_runs_session_created
  on chat_runs (session_id, created_at desc);

create index if not exists idx_chat_run_steps_run_sort
  on chat_run_steps (run_id, sort_order asc, created_at asc);

create index if not exists idx_chat_run_artifacts_run_created
  on chat_run_artifacts (run_id, created_at asc);

create index if not exists idx_chat_run_approvals_run_created
  on chat_run_approvals (run_id, created_at asc);

create index if not exists idx_chat_session_context_sources_session_created
  on chat_session_context_sources (session_id, created_at asc);
```

### RLS draft

Apply the same membership rule shape already used by `messages` and `office_terminal_messages`.

Minimum policy set:

- circle members can select all six tables
- circle members can insert `chat_sessions` where `created_by = auth.uid()`
- circle members can insert `chat_entries` where `author_user_id = auth.uid()` or `author_user_id is null` for system-created entries via trusted server paths
- circle members can insert `chat_runs` where `created_by = auth.uid()`
- updates on `chat_runs`, `chat_run_steps`, `chat_run_artifacts`, and `chat_run_approvals` should initially be restricted to service-role or trusted RPCs if possible

If PR1 cannot safely express all updates via RLS alone, prefer:

- `security definer` RPCs for run mutations

over:

- broad client-side update policies

### Realtime

Enable realtime for:

- `chat_sessions`
- `chat_entries`
- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`
- `chat_run_approvals`
- `chat_session_context_sources`

## Recommended Type Shapes

Put these in:

- `src/screens/circles/tabs/chat/chatTypes.ts`

Suggested core types:

```ts
export type ChatMode = 'talk' | 'plan' | 'execute' | 'review';

export type ChatTargetKind = 'blackswan' | 'office-agent' | 'shared-agent';

export type ChatSessionStatus =
  | 'active'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'archived';

export type ChatRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ChatSessionRecord {
  id: string;
  circleId: string;
  title: string;
  mode: ChatMode;
  status: ChatSessionStatus;
  targetKind: ChatTargetKind;
  targetAgentId: string | null;
  model: string | null;
  isPinned: boolean;
  lastEntryAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatEntryRecord {
  id: string;
  sessionId: string;
  circleId: string;
  role: 'user' | 'assistant' | 'system';
  entryType: 'message' | 'summary' | 'notice' | 'run-link' | 'approval-link';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatRunRecord {
  id: string;
  sessionId: string;
  circleId: string;
  status: ChatRunStatus;
  targetKind: ChatTargetKind;
  targetAgentId: string | null;
  targetLabel: string;
  mode: ChatMode;
  model: string | null;
  summary: string | null;
  errorText: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## File Tree For PR1

This is the exact target file tree I would hand to Claude for the first implementation pass.

```text
src/
  lib/
    chatSessions.ts
  screens/
    circles/
      tabs/
        ChatTab.tsx
        chat/
          ChatTabShell.tsx
          ChatSidebar.tsx
          ChatSessionHeader.tsx
          ChatStatusBar.tsx
          ChatTranscript.tsx
          ChatComposer.tsx
          RunInspector.tsx
          EmptySessionState.tsx
          chatTypes.ts
supabase/
  migrations/
    20260403_chat_agent_cli_pr1.sql
docs/
  page-audits/
    chat-tab-agent-cli-first-pr-dossier-2026-04-03.md
```

## Ownership By File

Claude can use this as explicit implementation ownership.

`src/screens/circles/tabs/ChatTab.tsx`

- reduce to a thin wrapper
- route props into `ChatTabShell`
- no business logic beyond compatibility glue

`src/lib/chatSessions.ts`

- all DB IO
- all session/run mutation helpers
- all chat-specific subscription helpers
- no JSX

`src/screens/circles/tabs/chat/ChatSidebar.tsx`

- session list
- new session action
- session selection
- session status badges

`src/screens/circles/tabs/chat/ChatSessionHeader.tsx`

- title
- mode
- target
- model
- session metadata

`src/screens/circles/tabs/chat/ChatStatusBar.tsx`

- persistent footer/status strip
- run state
- approvals count
- context source count
- model and target echo

`src/screens/circles/tabs/chat/ChatTranscript.tsx`

- transcript rendering
- run cards in timeline
- approval cards in timeline
- artifact summaries in timeline

`src/screens/circles/tabs/chat/ChatComposer.tsx`

- command-style composer
- mode picker
- target picker
- model picker
- command suggestions
- `Steer run` vs `Queue next` behavior when active
- enter-to-send semantics
- command parsing handoff

`src/screens/circles/tabs/chat/RunInspector.tsx`

- right pane details
- tabs for details, artifacts, approvals
- selected run drill-in

`src/screens/circles/tabs/chat/EmptySessionState.tsx`

- new empty state
- starter prompts aligned to agent work

## UI Acceptance Criteria

The PR is not done unless all of these are true.

### Session rail

- left rail exists on desktop web
- rail shows at least recent sessions ordered by `last_entry_at desc`
- user can create a new session
- user can switch sessions without full-page remount bugs
- active session is visually distinct

### Header

- header shows session title
- header shows current mode
- header shows current target
- header shows current model or “Auto”
- header exposes a lightweight details toggle or status chip

### Status bar

- persistent status/footer bar exists on desktop
- bar shows session, mode, target, model, and run state
- bar can surface pending approvals count
- bar has a reserved slot for context or token/cost state

### Transcript

- transcript renders user prompts and assistant/system entries separately
- transcript can display run status cards inline
- loading state is tied to run status, not only a generic typing indicator
- empty transcript does not mention games, dares, or social prompts

### Composer

- placeholder no longer says “Message your circle”
- composer supports mode selection
- composer supports target selection
- composer supports `/` command detection
- composer shows visible command suggestions while typing `/`
- when a run is active, composer exposes `Steer run` and `Queue next`
- web enter sends and shift-enter inserts newline
- composer remains usable on narrow screens

### Run inspector

- selecting a run updates a right-side inspector on desktop
- if no run is selected, the inspector shows session-level details
- if approvals exist, they render in a dedicated area
- if artifacts exist, they render in a dedicated area

## Data Acceptance Criteria

- creating a session inserts into `chat_sessions`
- sending a prompt inserts into `chat_entries`
- sending a prompt creates a `chat_runs` row for execution modes
- run status transitions are persisted, not only local state
- session `last_entry_at` is updated when a new entry is created
- enabled context sources are persisted per session
- realtime updates move across browser tabs for the same circle
- no destructive migration touches `messages`

## Execution Acceptance Criteria

For PR1, one complete run loop is enough.

Required loop:

1. user creates or opens a session
2. user sends prompt in `Talk` or `Plan`
3. app writes user entry
4. app creates run row
5. app marks run `running`
6. app calls BlackSwan path
7. app writes assistant entry
8. app marks run `completed` or `failed`

Stretch loop for `Execute`:

1. user sends prompt in `Execute`
2. run enters `waiting_approval` if execution intent is detected
3. approval row is created
4. user approves
5. run resumes and completes

If approvals are too large for PR1, ship the schema and basic UI placeholders now and wire actual resolution in PR2.

## Exact Reuse Guidance

Claude should reuse these existing pieces instead of rebuilding them conceptually.

Reuse from `src/lib/swanbot.ts`:

- BlackSwan request path
- current model handoff concept

Do not reuse:

- in-memory conversation history as the source of truth

Reuse from `src/lib/agentInvocation.ts`:

- run/invocation mental model
- provider-specific bridge structure if office-agent execution is added in PR1

Do not reuse:

- Office terminal table assumptions as the ChatTab primary storage

Reuse from `src/lib/advancedChatCommands.ts`:

- command registry direction
- string command normalization patterns

Do not reuse:

- giant imperative branch logic directly inside the new composer component

## Suggested Implementation Order

This order minimizes churn and keeps the PR reviewable.

1. Add the Supabase migration.
2. Add `chatTypes.ts`.
3. Add `src/lib/chatSessions.ts` with CRUD helpers and subscriptions.
4. Create `ChatTabShell.tsx` and keep it rendering only a basic layout at first.
5. Create `ChatSidebar.tsx`, `ChatSessionHeader.tsx`, and `ChatStatusBar.tsx`.
6. Create `ChatTranscript.tsx` and `ChatComposer.tsx`.
7. Replace `ChatTab.tsx` internals with the new shell.
8. Wire the BlackSwan run loop.
9. Add `RunInspector.tsx`.
10. Add approval, artifact, and context-source placeholders.
11. Verify web desktop, web narrow, and at least one mobile-sized layout.

## What To Delete From The Default Path

PR1 should remove these from the default ChatTab experience:

- games-first quick prompt grid
- challenge-first marketing copy
- social tips as the main onboarding
- destructive nuke button in the primary empty state
- AI access being hidden behind `@Agent`

These can survive temporarily in legacy code, but not in the new default shell.

## Open Questions Claude Can Resolve During Implementation

These are reasonable implementation decisions, not blockers.

- whether `Talk` mode creates a run row for every assistant response or only agent-backed responses
- whether session titles are user-entered only or auto-derived from first prompt
- whether `model` should live on session, run, or both
- whether `shared-agent` needs to exist in PR1 or can be deferred

Recommended answers for PR1:

- create a run row for every agent-backed response
- auto-derive title from the first user prompt, allow rename later
- keep model on both session default and run actual
- defer special shared-agent behavior beyond label support

## Testing Checklist

Claude should verify at least this:

- create session
- switch session
- send prompt
- receive response
- refresh page and restore session history
- open second tab and confirm realtime sync
- failure path when agent call errors
- no regression to old `messages` chat when opening other tabs

If TypeScript is run, use:

```bash
npx tsc --noEmit --skipLibCheck
```

## Definition Of Done For PR1

PR1 is done when ChatTab feels like:

- a session-based agent console

and no longer feels like:

- a social chat room with an optional AI mention

The threshold is product-shape, not perfection.

If the underlying run system is present, the shell is command-first, and future approvals/artifacts can layer in without another rewrite, then PR1 succeeded.
