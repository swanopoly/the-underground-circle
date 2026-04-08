# Agent Memory UX and Compaction Implementation Plan

Date: 2026-04-08
Type: Claude-ready implementation plan
Status: Build plan

## Goal

Implement the next memory-facing product layer in Underground Circle:

- memory source chips in chat
- `remember this` / `forget this` actions
- checkpoint compaction instead of unload-only saving
- workspace memory review in Rooms and Office

This plan assumes the current memory audit findings remain true:

- privacy needs tightening
- startup memory and archival memory need separation
- memory retrieval needs better filtering and ranking

## Research basis

This plan is grounded in current primary-source memory patterns:

- Anthropic memory and subagents
- LangGraph short-term vs long-term memory
- Letta memory blocks and archival memory
- OpenAI conversation state and explicit compaction

Key cross-source pattern:

- keep durable startup memory small
- compact long-running state deliberately
- make memory review visible to the user

## Product behavior to ship

### 1. Memory source chips in chat

When the agent answer used memory, the chat should render small chips like:

- `Room Instruction`
- `User Preference`
- `Circle Policy`
- `Previous Session`
- `Project Decision`
- `Archived Finding`

Each chip should open a lightweight inspector with:

- memory title
- scope
- kind
- why it was loaded
- source run/session if known
- created/updated time
- actions if permitted

### 2. Remember this / forget this actions

The chat needs fast user control over memory quality.

Add:

- `Remember this`
  - on user messages
  - on assistant messages
  - on artifacts

- `Forget this`
  - on memory source chips
  - on memory entries in inspector

- `Don’t remember things like this automatically`
  - later phase, policy-level feedback

### 3. Checkpoint compaction

Replace unload-based memory persistence with checkpoint events.

Trigger checkpoint compaction on:

- every 6 to 10 user/assistant turns
- after tool-heavy run segments
- after plan changes
- when run pauses
- when run completes
- when run fails

Each checkpoint should:

- create/update session summary
- preserve active plan
- preserve open questions
- preserve decisions made so far
- preserve important artifacts/links
- summarize stale tool chatter

### 4. Workspace memory review

Rooms and Office should expose memory review as a first-class management surface.

Rooms should show:

- Room Instructions
- Project Decisions
- Findings
- Archived References
- Candidate Memories

Office should show:

- memory health summary
- stale candidate queue
- contradiction/review queue
- promotion events
- top memory volume by scope

## Exact implementation map

### A. Chat memory source chips

#### UI changes

Primary file:

- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)

Supporting new module:

- `src/lib/memoryPresentation.ts`

Add to message model:

- `memorySources?: MemorySourceRef[]`

Suggested type:

```ts
export interface MemorySourceRef {
  id: string;
  title: string;
  scope: 'org' | 'circle' | 'room' | 'user' | 'session';
  kind: 'fact' | 'instruction' | 'preference' | 'decision' | 'finding' | 'policy' | 'context';
  reason: 'startup' | 'retrieval' | 'session_resume' | 'manual_pin';
}
```

Suggested UX:

- source chips render below assistant reply
- click/tap opens a small memory inspector modal
- chips should stay compact and monochrome with scope color accents

#### Backend/runtime changes

Primary files:

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)
- [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts)

Add:

- `buildStartupMemoryBundle(...)`
- `retrieveRelevantArchivalMemory(...)`
- return both:
  - prompt-ready text
  - source refs for UI

### B. Remember this / forget this actions

#### New service

Add:

- `src/lib/memoryActions.ts`

Functions:

- `rememberFromMessage(...)`
- `rememberFromArtifact(...)`
- `forgetMemory(...)`
- `snoozeMemory(...)`
- `promoteMemory(...)`

#### Data flow

`Remember this`:

1. user presses action
2. open small scope picker
3. default inferred title/content shown
4. save as `candidate` or `active` depending on memory kind
5. attach source link to message/run/artifact

`Forget this`:

1. user presses action on a chip or memory entry
2. soft-deactivate memory
3. append memory evaluation event with reason `user_forget`

### C. Checkpoint compaction

#### New modules

Add:

- `src/lib/memoryCheckpoint.ts`
- `src/lib/memoryCompaction.ts`

Core responsibilities:

- decide when a checkpoint should happen
- summarize stale transcript segments
- update session memory entry
- log compaction event

#### Event model

Add new step kind if needed:

- `context_edit`
- `memory_checkpoint`

Suggested table addition:

- `run_context_snapshots`

Suggested columns:

- `run_id`
- `checkpoint_index`
- `summary`
- `open_questions`
- `active_plan`
- `artifacts_snapshot`
- `source_message_count`
- `compacted_message_count`
- `created_at`

#### Runtime trigger points

Hook from:

- chat send/receive path
- run completion path
- approval wait path
- task run lifecycle

Important:

Do not depend on `beforeunload` for the primary save path anymore.

### D. Workspace memory review in Rooms

Primary target:

- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

Recommended split:

- `src/screens/circles/tabs/rooms/RoomMemoryPanel.tsx`
- `src/screens/circles/tabs/rooms/RoomMemoryReviewList.tsx`

Views:

- Instructions
- Decisions
- Findings
- Candidates
- Archived

Per-row actions:

- promote
- edit
- deactivate
- mark stale
- attach to room instructions

### E. Workspace memory review in Office

Primary target:

- [OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)

Recommended split:

- `src/screens/circles/tabs/office/MemoryHealthPanel.tsx`

Views:

- memory volume by scope
- candidate queue
- stale/retracted memories
- contradiction flags
- recent promotions

## Recommended schema additions

Build on `memory_entries`.

Add:

- `status text`
  - `candidate`, `active`, `stale`, `retracted`

- `importance numeric`

- `confidence numeric`

- `retrieval_mode text`
  - `startup`, `on_demand`, `manual_only`

- `last_accessed_at timestamptz`

- `access_count integer`

- `supersedes_memory_id uuid`

Add new tables:

- `memory_sources`
- `memory_evaluations`
- `run_context_snapshots`

## Suggested in-app phrasing

Use clear product language:

- `Memory Sources`
- `Remember this`
- `Forget this`
- `Pinned to project memory`
- `Session summary updated`
- `Candidate memory`
- `Needs review`

Avoid exposing low-level terms like:

- vector store
- embedding hit
- memory compaction item

unless in advanced/debug views.

## Rollout order

### PR1

- implement memory source refs in runtime
- render chips in chat
- add inspector modal

### PR2

- add `Remember this` and `Forget this`
- add `memory_sources` and `memory_evaluations`

### PR3

- add checkpoint compaction service
- stop relying on unload for primary session save

### PR4

- add Room memory review panel

### PR5

- add Office memory health/review panel

## Acceptance criteria

### Chat

- assistant replies can show memory source chips
- chips open a readable inspector
- users can remember/forget from the UI

### Compaction

- session summaries update during long runs without requiring page close
- long-running sessions preserve plan/decisions/open questions
- transcript noise is reduced over time

### Rooms and Office

- Room memory can be reviewed and promoted
- Office can review candidate/stale/problematic memories

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic Claude Code subagents docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- LangGraph memory docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- Letta memory blocks docs: https://docs.letta.com/guides/agents/memory-blocks
- Letta archival memory docs: https://docs.letta.com/guides/core-concepts/memory/archival-memory/
- OpenAI conversation state docs: https://platform.openai.com/docs/guides/conversation-state
