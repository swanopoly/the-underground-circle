# ChatTab Agent CLI Implementation Spec

Source surface: `src/screens/circles/tabs/ChatTab.tsx`
Date: 2026-04-03
Audience: Claude or another implementation agent
Depends on: `docs/page-audits/chat-tab-agent-cli-deep-audit-2026-04-03.md`

## Objective

Replace the current social-chat-first `ChatTab` with an agent-CLI/operator-console surface inspired by OpenCode and OpenAI Codex, while preserving Circle context and collaborative workflows.

This spec is implementation-oriented:

- target UX structure
- data model changes
- realtime model
- component/file split
- migration path
- phased build checklist

## Product Decision

The page should become:

- an agent operations console with collaborative context

It should not remain:

- a generic social group chat with an optional AI mention

Practical consequence:

- the current “games / challenges / crypto / polls / social prompt grid” flow must no longer be the primary interaction path
- chat history becomes session and run history
- agent execution becomes first-class and inspectable

## UX Spec

### Desktop layout

Use a 3-pane workbench layout.

#### Left rail

Purpose:

- session navigation
- agent/workspace targeting
- quick session actions

Sections:

- `Sessions`
  - recent sessions
  - pinned sessions
  - active/running sessions
- `Targets`
  - `@BlackSwan`
  - personal agents
  - shared circle agents
- `Views`
  - `Transcript`
  - `Runs`
  - `Approvals`
  - `Artifacts`

Session list item fields:

- title
- mode
- status
- last updated
- attached target(s)

#### Center pane

Purpose:

- primary transcript and task timeline

Sections:

- session header
  - title
  - target agent(s)
  - model
  - mode
  - details toggle
- transcript/timeline
  - user prompts
  - assistant updates
  - run cards
  - approval cards
  - summaries
- sticky composer

Timeline event types:

- user prompt
- assistant reply
- run started
- step update
- approval requested
- approval resolved
- artifact produced
- run finished
- run failed

#### Right pane

Purpose:

- drill into the selected run or selected message

Tabs:

- `Details`
- `Artifacts`
- `Diff`
- `Logs`
- `Approvals`

Behavior:

- if no run is selected, show session-level details
- if a run is selected, show run-specific details

### Mobile layout

Do not try to reproduce the whole desktop layout at once.

Use stacked panels:

- top segmented control: `Session | Transcript | Details`
- sticky compact composer at bottom
- details open as a full-height sheet

### Composer behavior

The composer is the main product.

Required controls:

- mode selector
- target selector
- model selector
- details toggle
- optional context attachments

Modes:

- `Talk`
- `Plan`
- `Execute`
- `Review`

Input grammar:

- `/` command palette
- `@` entity references
- `!` execution intent

Examples:

- `/help`
- `/models`
- `/sessions`
- `@task onboarding polish`
- `@room backend`
- `@member chris`
- `!search auth flow`
- `!plan add GitHub repo summary to this circle`

### Empty state

Replace the current social empty state.

Target copy:

- “Run agent tasks against your circle context.”
- “Select a target, choose a mode, and start a session.”

Suggested starter actions:

- `Review current open tasks`
- `Plan this week’s priorities`
- `Summarize the latest circle activity`
- `Prepare a release checklist`

## Command System

Build a real command registry instead of hardcoded `if` branches.

### Required commands

- `/help`
- `/models`
- `/agents`
- `/sessions`
- `/new`
- `/resume`
- `/share`
- `/details`
- `/compact`
- `/plan`
- `/review`
- `/attach`

### Optional Circle-specific commands

- `/tasks`
- `/checkins`
- `/digest`
- `/members`
- `/goals`

### Command registry shape

Suggested TS type:

```ts
type ChatCommand = {
  id: string;
  title: string;
  aliases?: string[];
  description: string;
  mode?: 'talk' | 'plan' | 'execute' | 'review';
  runType?: 'message' | 'run';
  handler: (ctx: CommandContext) => Promise<CommandResult>;
};
```

## Data Model

The current `messages` table is not enough.

### Keep existing tables

Keep using:

- `messages`
- `check_ins`
- `tasks`
- `proposals`
- `pinned_messages`

But reduce `messages` to social/light conversation only over time.

### Add new tables

#### `chat_sessions`

Purpose:

- one logical conversation/workstream

Suggested columns:

- `id uuid primary key`
- `circle_id uuid not null`
- `created_by uuid not null`
- `title text not null`
- `mode text not null default 'talk'`
- `selected_model text null`
- `selected_agent_ids uuid[] null`
- `selected_agent_names text[] null`
- `status text not null default 'active'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz null`

#### `chat_entries`

Purpose:

- session transcript entries that are not full runs

Suggested columns:

- `id uuid primary key`
- `session_id uuid not null references chat_sessions(id) on delete cascade`
- `circle_id uuid not null`
- `author_type text not null`
  - `user | assistant | system`
- `author_id uuid null`
- `author_name text null`
- `content text not null`
- `entry_type text not null default 'message'`
  - `message | summary | note | command_echo`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

#### `chat_runs`

Purpose:

- one agent task execution

Suggested columns:

- `id uuid primary key`
- `session_id uuid not null references chat_sessions(id) on delete cascade`
- `circle_id uuid not null`
- `created_by uuid not null`
- `mode text not null`
  - `talk | plan | execute | review`
- `prompt text not null`
- `target_agent_ids uuid[] null`
- `target_agent_names text[] null`
- `model text null`
- `status text not null default 'queued'`
  - `queued | running | waiting_approval | done | error | cancelled`
- `summary text null`
- `error_message text null`
- `started_at timestamptz null`
- `finished_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

#### `chat_run_steps`

Purpose:

- detailed progress log

Suggested columns:

- `id uuid primary key`
- `run_id uuid not null references chat_runs(id) on delete cascade`
- `circle_id uuid not null`
- `step_type text not null`
  - `thinking | read | search | tool | write | command | diff | test | summary | approval`
- `status text not null default 'running'`
  - `running | done | error | waiting`
- `title text not null`
- `body text null`
- `metadata jsonb not null default '{}'::jsonb`
- `position int not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

#### `chat_run_artifacts`

Purpose:

- files, diffs, logs, outputs, links

Suggested columns:

- `id uuid primary key`
- `run_id uuid not null references chat_runs(id) on delete cascade`
- `circle_id uuid not null`
- `artifact_type text not null`
  - `diff | file_ref | log | test_result | export | link | image`
- `title text not null`
- `content text null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

#### `chat_run_approvals`

Purpose:

- permission requests and decisions

Suggested columns:

- `id uuid primary key`
- `run_id uuid not null references chat_runs(id) on delete cascade`
- `circle_id uuid not null`
- `approval_type text not null`
  - `tool | command | network | write | destructive`
- `title text not null`
- `body text null`
- `scope jsonb not null default '{}'::jsonb`
- `status text not null default 'pending'`
  - `pending | approved | denied | expired`
- `requested_by uuid null`
- `resolved_by uuid null`
- `resolved_at timestamptz null`
- `created_at timestamptz not null default now()`

## Realtime Model

The current page subscribes to `messages` only. That is insufficient.

Add realtime subscriptions for:

- `chat_entries`
- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`
- `chat_run_approvals`

Recommended rule:

- one session page subscribes only to the current session’s rows
- left rail subscribes to lightweight `chat_sessions` list updates

## Permissions Model

### Base policy states

Use explicit states:

- `allow`
- `ask`
- `deny`

### Permission categories

- read session/circle context
- read files/docs/room content
- run external web fetch
- write tasks/check-ins/notes
- send governance mutations
- send wallet actions
- run bridge / terminal / shell actions
- destructive operations

### Initial product behavior

For the first release:

- reading circle context: `allow`
- creating runs and planning: `allow`
- task/check-in creation: `ask`
- governance mutation: `ask`
- wallet send: `ask`
- destructive deletes: `ask`
- any future shell/file tool actions: `ask`

## Backend Execution Strategy

### Near-term

Use existing `getSwanBotResponse` / `swanbot-ai` stack for `Talk` and `Plan`.

Current code:

- `src/lib/swanbot.ts`

### Mid-term

Route `Execute` and `Review` through a run orchestrator instead of plain `getAIResponse`.

Suggested new server-side or shared orchestration module:

- `src/lib/chatRunDispatcher.ts`

Responsibilities:

- create run row
- create initial step rows
- choose agent/model
- invoke provider
- stream updates into `chat_run_steps`
- write final summary/artifacts

## Frontend File Split

The current `ChatTab.tsx` is 3180 lines and should be broken apart.

### New file structure

```text
src/screens/circles/tabs/chat/
  ChatTabShell.tsx
  ChatSidebar.tsx
  ChatHeader.tsx
  ChatTranscript.tsx
  ChatComposer.tsx
  CommandPalette.tsx
  SessionList.tsx
  RunCard.tsx
  RunStepList.tsx
  RunDetailsPanel.tsx
  ApprovalCard.tsx
  ArtifactPanel.tsx
  ContextReferencePicker.tsx
  chatCommands.ts
  chatTypes.ts
  chatUtils.ts

src/hooks/
  useChatSessions.ts
  useChatSession.ts
  useChatRuns.ts
  useChatComposer.ts
  useChatApprovals.ts
```

### Existing file after refactor

Keep `src/screens/circles/tabs/ChatTab.tsx` as:

- a thin wrapper that imports `ChatTabShell`

## UI Wireframe Spec

### Header

Left:

- session title
- status chip

Center:

- mode selector
- target selector
- model selector

Right:

- details toggle
- share
- new session

### Transcript cards

#### User prompt card

- avatar/icon
- prompt text
- timestamp
- optional attached context refs

#### Assistant message card

- short answer or summary
- model badge
- timestamp

#### Run card

- status chip
- target agent(s)
- mode
- model
- condensed prompt
- expandable step list
- footer with actions:
  - `Open details`
  - `Retry`
  - `Summarize`

#### Approval card

- icon by approval type
- title
- scope summary
- `Approve`
- `Deny`

## Session UX Rules

- creating a command that changes task context should create a new session by default
- lightweight follow-ups stay in the same session
- sessions can be renamed
- sessions can be archived
- sessions can be shared/exported

## Migration Strategy

### Phase A

- do not remove old social chat yet
- add a new `CLI` mode in ChatTab behind a feature flag or segmented control

Suggested temporary modes:

- `Social`
- `CLI`

### Phase B

- move `Social` into a simplified social transcript
- move all agent behavior into the new CLI mode

### Phase C

- once CLI is stable, decide whether to:
  - keep both
  - split into separate tabs
  - make CLI the default

## Phased Build Checklist

### Phase 1: foundation

- Create `chatTypes.ts`.
- Create `chatCommands.ts`.
- Create command registry and parser.
- Split `ChatTab.tsx` into `ChatTabShell.tsx`, `ChatTranscript.tsx`, `ChatComposer.tsx`.
- Replace current quick-prompt hero with a simple CLI empty state.

### Phase 2: session model

- Add `chat_sessions` migration.
- Add `chat_entries` migration.
- Build `useChatSessions`.
- Build left rail session list.
- Support create/new/rename/archive session.

### Phase 3: run model

- Add `chat_runs`, `chat_run_steps`, `chat_run_artifacts`, `chat_run_approvals` migrations.
- Build `useChatRuns`.
- Render run cards in transcript.
- Add right-side details panel.

### Phase 4: execution routing

- Create `chatRunDispatcher.ts`.
- Route `Talk` and `Plan` through dispatcher with run creation.
- Keep provider call simple at first, but persist run steps.
- Add loading/progress step events instead of one `botTyping` boolean.

### Phase 5: approvals

- Add approval card UI.
- Add `approve` / `deny` actions.
- Gate mutations and destructive actions behind approval rows.

### Phase 6: entity references

- Add `@task`, `@room`, `@member`, `@file`, `@doc` reference picker.
- Resolve selected references into structured session context.

### Phase 7: polish

- Add share/export session.
- Add keyboard shortcuts.
- Add details toggles and compact mode.
- Add session summaries / compact command.

## Implementation Notes for Claude

### Reuse where possible

- Keep `src/lib/swanbot.ts` for initial answer generation.
- Keep governance APIs in `src/lib/governance.ts`, but call them through explicit commands or approved runs.
- Keep `storage` helper from `src/lib/storage.ts` for temporary local UI state only.

### Avoid carrying forward

- do not copy over the large quick prompt catalog
- do not make games/challenges/crypto primary actions in the CLI mode
- do not keep one giant `sendMessage()` with inline command branching
- do not keep the single `messages` table as the execution record

### Success criteria

The first good version should let a user:

1. open or create a session
2. choose mode, target, and model
3. issue a command from one composer
4. see a structured run appear
5. watch progress steps update
6. inspect details/artifacts
7. approve or deny risky actions
8. continue the session later

If those are not true, it still isn’t an agent CLI.
