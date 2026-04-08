# Main Chat + Rooms Chat Tooling Deep Audit

Date: 2026-04-04
Repo: `the-underground-circle`
Scope:

- main Circle chat
- Rooms dashboard chat
- tool boundaries
- code audit
- functionality audit
- research-driven feature recommendations

## Executive summary

The app currently has two different chat products pretending to be one system:

1. `ChatTab.tsx` is a legacy all-in-one social chat with wallet, governance, Discord, GitHub, Rooms, and ad hoc agent assignment mixed into one surface.
2. `chat/ChatTabShell.tsx` is a newer session/run-based assistant shell with sessions, runs, approvals, artifacts, and context-source tables, but it is still only partially wired.
3. `RoomsTab.tsx` contains a third chat model: a room-scoped operations console for files, agents, GitHub, and workspace tasks.

That split creates three problems:

- users get inconsistent tool behavior depending on where they type
- the codebase duplicates orchestration logic in multiple places
- destructive capabilities are available in the wrong places without enough approval or scope control

The strongest product direction is:

- keep `Main Chat` as the general circle conversation + assistant surface
- keep `Rooms Chat` as the room-scoped operations surface
- share the same underlying run, approval, command, model, and artifact infrastructure
- do not expose room mutation tools globally from main chat by default

## Current architecture

### Main chat: legacy default

Primary file:

- `src/screens/circles/tabs/ChatTab.tsx`

Important detail:

- this file still comments that the agent CLI shell exists but is "not yet default" at [ChatTab.tsx:298](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L298)

Current behavior:

- social/group chat
- quick prompts
- wallet send flow
- Discord context
- governance polls/proposals/pins/search
- GitHub slash commands
- Rooms slash commands
- ad hoc agent assignment and task dispatch
- direct AI response via `getAIResponse(...)`

This is function-rich, but overloaded.

### Main chat: new shell

Primary files:

- `src/screens/circles/tabs/chat/ChatTabShell.tsx`
- `src/screens/circles/tabs/chat/ChatComposer.tsx`
- `src/lib/chatSessions.ts`
- `supabase/migrations/20260403_chat_agent_cli_pr1.sql`

Current behavior:

- structured chat sessions
- structured runs
- run steps
- artifacts
- approvals
- model selector
- mode selector

But current execution is still thin:

- every run targets `BlackSwan` in [ChatTabShell.tsx:226-235](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L226)
- the response path still just calls `getSwanBotResponse(...)` in [ChatTabShell.tsx:265-271](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L265)
- there is no real tool-router yet
- there is no visible context-source picker
- there is no actual execution policy binding to approvals

### Rooms chat

Primary file:

- `src/screens/circles/tabs/RoomsTab.tsx`

Supporting files:

- `src/lib/roomChatCommands.ts`
- `src/lib/githubChatCommands.ts`

Current behavior:

- room messages with realtime feed
- `/room` commands for room and file operations
- `/gh` commands for repo operations
- natural-language code review/audit/refactor/debug/research prompts
- file-context injection
- agent assignment to files/tasks
- bridge dispatch with AI fallback

This is already an operations console, not just a chat box.

## Code audit findings

### Finding 1. The main chat architecture is split across two competing implementations

Severity: high

The repo currently contains both:

- legacy `ChatTab.tsx`
- new `chat/ChatTabShell.tsx`

Evidence:

- legacy default export still exists in [ChatTab.tsx:302](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L302)
- comment explicitly says the newer shell is not the default in [ChatTab.tsx:298](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L298)

Impact:

- product confusion
- duplicated tool logic
- duplicated model selection and send handling
- hard-to-predict future regressions

Recommendation:

- make a single authoritative `Main Chat` shell
- migrate useful legacy capabilities into the new session/run infrastructure
- stop extending both implementations in parallel

### Finding 2. The new main chat shell has run/approval tables, but the actual tool execution layer is mostly missing

Severity: high

The new shell has:

- `chat_sessions`
- `chat_runs`
- `chat_run_steps`
- `chat_run_artifacts`
- `chat_run_approvals`
- `chat_session_context_sources`

Evidence:

- schema in `supabase/migrations/20260403_chat_agent_cli_pr1.sql`
- UI consumption in [ChatTabShell.tsx:132-147](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L132)

But runtime behavior remains shallow:

- run target hardcoded to `blackswan` in [ChatTabShell.tsx:226-235](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L226)
- completion comes from one plain `getSwanBotResponse(...)` call in [ChatTabShell.tsx:265-271](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L265)
- `contextSourceCount` is still passed as `0` in [ChatTabShell.tsx:390-393](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx#L390)

Impact:

- the shell visually promises agent CLI behavior without actually having tool routing
- approvals exist structurally but not as an enforced safety boundary
- run inspector risks becoming cosmetic telemetry

Recommendation:

- route all tool executions through a shared command executor
- require tool steps to emit `chat_run_steps`
- require approval-worthy actions to emit `chat_run_approvals`
- stop calling the shell "execute/review/plan" if the modes only change labels

### Finding 3. `Steer run` and `Queue next` are currently the same action

Severity: medium-high

In the new main chat composer, both buttons call `onSend(text.trim(), mode)` and clear the input.

Evidence:

- [ChatComposer.tsx:196-215](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatComposer.tsx#L196)

Impact:

- misleading UI
- fake concurrency semantics
- user trust erosion

Recommendation:

- `Steer run` should append an interrupting instruction to the active run
- `Queue next` should create a queued run or pending entry linked after the current run
- until implemented, one of these buttons should be removed

### Finding 4. Rooms chat exposes destructive room file operations without approval or diff preview

Severity: high

`roomChatCommands.ts` directly supports:

- create file
- edit file
- delete file

Evidence:

- direct inserts in [roomChatCommands.ts:110-118](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L110)
- direct updates in [roomChatCommands.ts:120-127](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L120)
- direct deletes in [roomChatCommands.ts:129-135](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L129)

And the help text advertises destructive operations openly in [roomChatCommands.ts:167-183](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L167)

Impact:

- no confirm step for deletion
- no preview of file diff before write
- no audit-friendly approval event
- easy accidental destruction from chat text

Recommendation:

- room writes must move behind an approval step
- `delete` should become soft-delete only
- edit/create should first produce a proposed patch or draft artifact
- a room-scoped reviewer should approve before commit

### Finding 5. Main chat can call room commands without room context, which can target the wrong room

Severity: high

Legacy main chat forwards `/room` commands globally:

- [ChatTab.tsx:967-983](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L967)

`executeRoomCommand(...)` resolves no-room cases by falling back to the most recently updated room:

- [roomChatCommands.ts:71-79](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L71)
- [roomChatCommands.ts:199-209](/Users/cswanson/the-underground-circle/src/lib/roomChatCommands.ts#L199)

Impact:

- a global circle chat message can mutate the wrong room
- room tooling leaks into a surface without room-local affordances
- the wrong mental model is encouraged

Recommendation:

- remove direct room mutation commands from main chat
- from main chat, allow only:
  - room discovery
  - room summaries
  - “open in room”
  - create draft task for a room

### Finding 6. Rooms chat can assign cross-circle agents

Severity: high

Rooms chat loads all non-offline `circle_office_agents`, then merely sorts same-circle agents first.

Evidence:

- cross-circle query in [RoomsTab.tsx:2003-2020](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2003)

Impact:

- cross-circle leakage of agent identity and status
- task dispatch to agents outside the current circle boundary
- unclear ownership and permission model

Recommendation:

- default to same-circle agents only
- cross-circle delegation should be explicit, opt-in, and approval-gated

### Finding 7. Rooms natural-language review mode eagerly injects all files into prompts

Severity: medium-high

For review/security/perf/refactor/architecture requests, Rooms chat loads every room file and injects truncated content into the prompt.

Evidence:

- [RoomsTab.tsx:2111-2147](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2111)

Impact:

- prompt bloat and cost spikes
- privacy leakage across files the user may not have intended to include
- degraded output quality once rooms grow

Recommendation:

- replace “all files” with:
  - selected files
  - active file
  - repo manifest
  - explicit include chips
- add token-aware context budgeting

### Finding 8. Rooms agent assignment falls back to generic AI in ways that can misrepresent actual execution

Severity: medium-high

When bridge dispatch fails, the room task falls back to `getAIResponse(...)`, even for tasks that users may interpret as real agent execution.

Evidence:

- [RoomsTab.tsx:2270-2299](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2270)
- [RoomsTab.tsx:2300-2311](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2300)

Impact:

- user may think a live connected agent actually ran a task when it did not
- execution provenance becomes ambiguous

Recommendation:

- visually distinguish:
  - real bridge execution
  - AI simulation fallback
  - draft suggestion only
- do not mark fallback output as equivalent to actual agent execution

### Finding 9. Main chat legacy surface has too many unrelated tools in one composer

Severity: medium

Legacy main chat currently mixes:

- wallet
- Discord
- governance
- GitHub
- Rooms
- quick actions
- agent assignment
- social chat

Evidence:

- imports and quick prompts in [ChatTab.tsx:17-34](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L17)
- quick prompt matrix in [ChatTab.tsx:46-146](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L46)

Impact:

- low discoverability despite high feature count
- trust boundary confusion
- hard-to-maintain composer logic

Recommendation:

- reduce main chat tool surface to a small visible set
- move advanced capability into:
  - slash commands
  - sheets/drawers
  - a `Tools` rail
  - room handoffs

### Finding 10. The main chat and Rooms chat duplicate command-routing logic instead of sharing one registry

Severity: medium

Both chats separately intercept `/room`, `/gh`, and ad hoc AI behavior.

Evidence:

- legacy main chat in [ChatTab.tsx:967-1052](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L967)
- Rooms chat in [RoomsTab.tsx:2046-2181](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2046)

Impact:

- inconsistent UX
- duplicated bugs
- hard to add approvals and telemetry uniformly

Recommendation:

- create one shared tool registry and command executor
- vary only the allowed tool set by surface and scope

## Functionality audit

## Main chat should be

- the circle’s shared conversation surface
- the place for social coordination, summaries, planning, and lightweight assistant help
- the place to launch richer work into Rooms, GitHub, Office, governance, or wallet flows

## Main chat should not be

- a direct room file mutation console
- a raw GitHub write surface by default
- a secrets/config surface
- a place where destructive actions happen without context

## Rooms chat should be

- a room-local workbench
- the place for file-aware AI
- the place for task assignment to room-relevant agents
- the place for patch proposals, workspace actions, and project-specific workflows

## Rooms chat should not be

- a generic social chat clone
- a cross-circle agent browser
- a silent destructive action surface

## What should be connected

These should share infrastructure between main chat and Rooms chat:

- model selector logic
- session/run/event schema
- run inspector pattern
- artifacts
- approval system
- slash command parsing framework
- tool registry
- usage analytics
- prompt/context budgeting
- shared identity for agents and providers

## What should stay separate

These should remain room-scoped or surface-scoped:

- room file read/write/delete
- room task dispatch
- room APIs/secrets/services panels
- room-specific file context and active tab context
- room-local workflow shortcuts

Main chat should only reach these through:

- preview
- summary
- explicit “open in room”
- draft handoff

## Recommended target tool model

### Shared core

Create one shared `chat tool runtime` with:

- `tool_id`
- `surface` allowlist: `main_chat`, `room_chat`, `office_terminal`
- `scope` requirements: `circle`, `room`, `repo`, `wallet`
- `risk_level`: `safe`, `review`, `approval_required`, `blocked`
- `execution_kind`: `read`, `draft_write`, `committed_write`, `message`, `external`

### Main chat default tools

Recommended visible defaults:

- model selector
- new session
- summarize circle
- ask about tasks/goals
- open room
- open GitHub
- create poll/proposal

Recommended slash-only but allowed:

- `/gh status`
- `/gh tree`
- `/room list`
- `/room files <room>`

Recommended blocked by default in main chat:

- `/room create`
- `/room edit`
- `/room delete`
- GitHub file writes
- secrets access

### Rooms chat default tools

Recommended visible defaults:

- attach current file
- choose files
- assign agent
- review code
- debug
- refactor draft
- propose patch
- open GitHub repo context

Recommended behind approval:

- write file
- delete file
- commit to GitHub
- trigger deployment
- external webhook sends

## Research-driven features to add

### 1. Workflow tabs and featured room actions

Useful reference:

- Slack Workflows tab and featured workflows:
  - https://slack.com/help/articles/32393999092883-Manage-the-Workflows-tab-in-channels-and-DMs

Why it matters:

- Slack’s pattern is useful because it distinguishes normal conversation from repeatable workflows, and even allows a workflow to temporarily replace the message field.

Recommended adaptation:

- each room gets a `Workflows` strip or tab
- featured actions can temporarily replace the default composer with:
  - `Review current file`
  - `Prepare patch`
  - `Run release checklist`
  - `Assign bugfix`

### 2. Real permission and approval controls

Useful reference:

- OpenCode permissions:
  - https://opencode.ai/docs/permissions/

Relevant pattern:

- explicit `allow` / `ask` / `deny`
- approval on sensitive actions
- reusable approval patterns

Recommended adaptation:

- tool permissions should be surface-aware and agent-aware
- room file mutation and external writes should default to `ask`
- safe reads can default to `allow`

### 3. Custom command packs

Useful reference:

- OpenCode commands:
  - https://opencode.ai/docs/commands/

Relevant pattern:

- commands are reusable, descriptive, and parameterized

Recommended adaptation:

- add room command packs:
  - `/review-current-file`
  - `/draft-release-notes`
  - `/security-scan-room`
  - `/handoff-to-room`
- add circle command packs in main chat:
  - `/circle-summary`
  - `/team-status`
  - `/open-active-room`

### 4. Multi-agent supervision instead of single opaque assistant replies

Useful reference:

- OpenAI Codex app:
  - https://openai.com/index/introducing-the-codex-app/

Relevant patterns:

- project threads
- isolated runs
- reviewable changes
- approvals
- agent collaboration over long-running tasks

Recommended adaptation:

- Rooms chat should become the room-level supervision surface
- main chat should become the circle-level coordination surface
- both should show provenance:
  - which agent
  - which model
  - which tool
  - which scope
  - whether output was draft, approved, or executed

### 5. Patch-first editing in Rooms

Recommended feature:

- when user asks to edit files in Rooms, produce a patch artifact first
- show a side-by-side diff
- then allow:
  - `Apply`
  - `Revise`
  - `Send to agent`

This is the single biggest UX upgrade for room safety.

### 6. Context picker chips

Recommended feature:

- add explicit context chips in both chat surfaces

Main chat chips:

- tasks
- goals
- members
- pinned messages
- recent activity

Rooms chat chips:

- current file
- selected files
- recent room messages
- linked repo
- services/logs

### 7. Tool provenance badges

Every AI response that used tools should show:

- model
- tools used
- file count attached
- approval status
- execution path:
  - `bridge`
  - `AI fallback`
  - `draft only`

### 8. Room handoff from main chat

Recommended feature:

- from main chat, user can click `Send to Room`
- creates a room task or draft brief
- does not immediately mutate room files

This keeps main chat powerful without making it dangerous.

### 9. Artifact pinning

Recommended feature:

- allow room outputs to be pinned as:
  - decision
  - draft
  - patch
  - checklist
  - handoff

This helps Rooms behave like collaborative workspaces, not transient chats.

### 10. Review queues

Recommended feature:

- add a review queue for:
  - pending file writes
  - pending GitHub changes
  - pending external sends

This should sit above both main chat and Rooms.

## Claude-ready implementation direction

### Phase 1

- choose one main chat implementation
- keep `ChatTabShell` as the future base
- stop adding new tools to legacy `ChatTab`

### Phase 2

- build shared tool registry
- tag tools by surface + scope + risk
- move `/room` and `/gh` through shared executor

### Phase 3

- remove destructive room commands from main chat
- make main chat launch room drafts instead

### Phase 4

- add Rooms patch-preview flow
- approval before write/delete
- explicit execution provenance

### Phase 5

- add workflow tabs, featured room actions, and review queues

## Bottom line

The right architecture is not “merge the chats.”

The right architecture is:

- one shared execution core
- one shared approval model
- one shared run/artifact system
- two distinct surfaces

`Main Chat` should coordinate people and work.

`Rooms Chat` should operate on room-local artifacts and tasks.

The repo already has most of the pieces for this, but they are split across:

- a legacy monolith
- a partial session shell
- a room operations console

The next implementation pass should unify the engine, not flatten the surfaces.
