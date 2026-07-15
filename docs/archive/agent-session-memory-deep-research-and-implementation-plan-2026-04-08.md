# Agent Session Memory Deep Research and Implementation Plan

Date: 2026-04-08
Type: Deep research + code audit + Claude-ready implementation plan
Status: Planning document

## Executive summary

The Underground Circle already has serious memory infrastructure, but it is fragmented and not yet safe or deliberate enough to be called a best-in-class agent memory system.

Right now the app has at least five memory-like systems:

1. chat transcript history in [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)
2. user behavior profile in [userChatProfile.ts](/Users/cswanson/the-underground-circle/src/lib/userChatProfile.ts)
3. old shared circle document memory in [sharedMemory.ts](/Users/cswanson/the-underground-circle/src/services/sharedMemory.ts)
4. bonded-agent memory in [agentBonding.ts](/Users/cswanson/the-underground-circle/src/lib/agentBonding.ts)
5. new unified scoped memory in [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts) and [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts)

The best next move is not adding another memory feature. It is consolidating these into one managed memory architecture with:

- short-term thread memory
- durable scoped memory
- semantic archival retrieval
- explicit promotion rules
- context compaction
- memory privacy rules
- evaluator checks before promotion

## Research summary

### Anthropic / Claude memory patterns

Anthropic’s Claude Code memory system splits persistent knowledge into:

- explicit human-authored instructions via `CLAUDE.md`
- automatic memory generated from corrections and patterns

Key official patterns:

- every session starts fresh, so memory must be deliberately reloaded
- memory is context, not hard enforcement
- auto memory should stay concise and indexed
- only the startup index should load automatically; details should load on demand
- subagents can maintain separate memory and context windows

Relevant source findings:

- Claude Code says each session begins with a fresh context window and uses both written instructions and auto memory to carry knowledge across sessions. [Anthropic memory docs](https://docs.anthropic.com/en/docs/claude-code/memory)
- auto memory is loaded only from the startup entrypoint, capped to the first 200 lines or 25KB, while detailed notes are read on demand. [Anthropic memory docs](https://docs.anthropic.com/en/docs/claude-code/memory)
- subagents run in separate context windows with their own prompts, tools, and permissions. [Anthropic subagents docs](https://docs.anthropic.com/en/docs/claude-code/sub-agents)

Important implication:

Underground Circle should stop stuffing raw memory lists into prompts and instead adopt:

- startup memory index
- on-demand retrieval
- separate memory for delegated specialists

### Anthropic multi-agent research memory patterns

Anthropic’s multi-agent research system explicitly stores the lead agent’s plan to memory so it survives context truncation.

Important implication:

The app should preserve:

- plan memory
- decision memory
- open-question memory

These are more important than preserving every message.

### LangGraph memory patterns

LangGraph separates:

- short-term memory as thread persistence
- long-term memory as cross-session storage

It also explicitly recommends:

- trimming messages
- deleting stale messages
- summarizing messages
- using semantic search for long-term memory

Important implication:

Underground Circle should separate:

- thread state
- durable memory store
- compaction/summarization pipeline

instead of treating them as the same thing.

### Letta memory patterns

Letta makes a clean distinction between:

- always-visible memory blocks
- scratchpad / working memory
- archival memory queried on demand
- conversation search for raw history

Important implication:

Underground Circle should distinguish between:

- instructions that should always be visible
- session scratch state
- archival knowledge
- transcript search

The app currently blurs these together too often.

## What the app currently does

### 1. Conversation history

In [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts):

- conversation history is stored in an in-memory `Map`
- it is mirrored to `localStorage`
- it is capped at `30` items
- bond-linked sessions also mirror conversation rows into `agent_conversation_history`

This is thread memory, not durable semantic memory.

### 2. Session summarization on unload

In [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L622) and [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts#L136):

- the app attempts to save a session summary on `beforeunload`
- it writes a `session` scoped memory entry
- it then tries to auto-extract durable memories from recent messages

This is a good idea, but the implementation is fragile.

### 3. Unified scoped memory

In [20260408_unified_agent_runs.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260408_unified_agent_runs.sql#L189):

- the app has `memory_entries`
- scopes are `org`, `circle`, `room`, `user`, `session`
- kinds are `fact`, `instruction`, `preference`, `decision`, `finding`, `policy`, `context`
- there is a `promoted_from` relationship

This is the right direction structurally.

### 4. Prompt-time memory injection

In [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts#L473):

- prompt assembly loads:
  - user profile context
  - built memory context
  - last session context

This means memory is already affecting the agent, but the selection logic is too naive.

### 5. Auto-extraction

In [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts):

- extraction is LLM-based
- it uses Gemini Flash directly from the client path
- extracted memories are deduped by rough title/content heuristics
- preferences/instructions save to `user` scope
- everything else saves to `circle` scope

This is a useful prototype, not a production-grade memory pipeline.

### 6. Older parallel memory systems still exist

The repo still has:

- `circle_memory` and `circle_memory_history` for old shared-memory docs
- `agent_memory` for bonded agent SOUL memory
- `automation_memory_notes` for automation-specific notes

These systems are not fully reconciled with `memory_entries`.

## Highest-priority audit findings

### 1. User-scoped memory is too broadly readable

Severity: High

In [20260408_unified_agent_runs.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260408_unified_agent_runs.sql#L224), the `memory_entries` policy allows access when:

- the row’s `circle_id` belongs to a circle the user is in
- or `user_id = auth.uid()`

That means `user`-scope memory attached to a circle is readable by other circle members unless additional filtering exists at the application layer.

That is not a safe privacy model for:

- private user preferences
- personal working style
- personal constraints
- personal notes promoted from sessions

### 2. `loadMemories` does not filter by `userId`

Severity: High

In [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts#L380), `loadMemories` accepts `userId` but does not actually apply a `user_id` filter.

Practical effect:

- calls that appear to request user-specific memory can still load all matching memories for the circle

### 3. `buildMemoryContext` can include unrelated user memories

Severity: High

In [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts#L425), `buildMemoryContext` loads `circle`, `room`, and `user` memories together.

In [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts#L473), it is called with only `circleId`, not `userId`.

Practical effect:

- the agent can receive user-scoped memories from the entire circle, not just the active user

That is both a privacy issue and a relevance issue.

### 4. Memory retrieval is recency-based, not relevance-based

Severity: High

Current loading is mostly:

- latest N rows
- grouped by scope
- injected directly into prompt

There is no:

- semantic retrieval
- importance ranking
- freshness weighting
- task-aware selection
- tool-aware selection

This does not scale.

### 5. Session persistence depends on `beforeunload`

Severity: Medium

In [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx#L622), session saving is triggered on `beforeunload`.

That is unreliable on web for async work. It is easy to lose:

- latest decisions
- latest extracted preferences
- last session summary

### 6. Memory extraction runs client-side and depends on Gemini key availability

Severity: Medium

In [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts), extraction runs in the client and requires `EXPO_PUBLIC_GEMINI_API_KEY`.

Problems:

- unreliable across environments
- harder to govern and audit
- weaker security and observability
- mixed provider logic in the client

### 7. Dedup and contradiction handling are too weak

Severity: Medium

Current duplicate detection in [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts#L133) uses:

- exact or near-exact title match
- content prefix inclusion

This is too brittle for:

- revised preferences
- overwritten decisions
- nuanced contradictions
- merged memory facts

### 8. Too much raw memory is injected directly into prompts

Severity: Medium

`buildMemoryContext` can inject up to `30` memory entries with truncated content into the system prompt.

That creates:

- context bloat
- stale memory collisions
- reduced model adherence
- poor scaling for Rooms and long-running workspaces

### 9. Memory systems are duplicated by domain

Severity: Medium

The repo currently splits memory across:

- `memory_entries`
- `circle_memory`
- `agent_memory`
- `automation_memory_notes`
- transcript history
- user behavior profile

This creates:

- unclear source of truth
- inconsistent UX
- migration risk
- harder evals and debugging

### 10. No evaluator sits between extraction and promotion

Severity: Medium

The app can auto-save extracted memory without a quality gate.

That means it can store:

- low-value facts
- wrong inferences
- temporary decisions
- prompt-noise disguised as memory

## What the best architecture should be

The best design for Underground Circle is a four-part memory model:

### A. Instruction memory

Always-visible durable guidance.

Examples:

- circle rules
- room/project instructions
- user preferences
- policy constraints
- coding standards
- design standards

This is the analogue of:

- `CLAUDE.md`
- project instructions
- memory blocks

### B. Session memory

Thread/run-level working memory.

Examples:

- current goal
- current plan
- working assumptions
- open questions
- current blockers
- active delegated tasks

This is not permanent knowledge.

### C. Archival memory

Semantically retrievable long-term memory.

Examples:

- resolved decisions
- repeated preferences
- project learnings
- prior research findings
- stable reference knowledge

This should be searchable on demand, not fully injected at startup.

### D. Transcript/history

Raw message history and run logs.

Examples:

- full chat logs
- step logs
- approval history
- tool traces

This is for audit and recall, not direct prompt loading.

## Recommended target memory hierarchy

Underground Circle should use:

1. `org` memory
   - organization-level rules and standards

2. `circle` memory
   - shared group knowledge, norms, and stable facts

3. `room` memory
   - project-specific instructions, decisions, and references

4. `user` memory
   - private preferences and working style

5. `session` memory
   - active working state for a thread/run

Important rule:

Only `session` and selected `instruction` memories should load automatically into the prompt. Archival memory should be retrieved by relevance.

## Recommended retrieval model

### Startup memory

Load at run start:

- top circle instructions
- top room instructions
- top user preferences
- most recent session summary for the same session/workspace
- active plan / open-questions snapshot

This should be small and bounded.

### On-demand retrieval

For specific tasks, run semantic retrieval against archival memory:

- query = goal + current step + room context + current user context
- retrieve top K
- merge with freshness and importance

### Compaction

When runs get long:

- summarize stale tool traces
- preserve plan and decisions
- preserve unresolved questions
- preserve artifact references
- drop low-value chatter

## Recommended schema model

Use `memory_entries` as the primary memory table, but extend it.

Add:

- `visibility` text
  - `private`, `circle_shared`, `room_shared`, `public_org`

- `importance` numeric
  - 0.0 to 1.0

- `confidence` numeric
  - how certain the system is this is correct

- `retrieval_mode` text
  - `startup`, `on_demand`, `never_auto`

- `embedding` or linked embedding table

- `last_accessed_at`

- `access_count`

- `supersedes_memory_id`

- `status`
  - `candidate`, `active`, `stale`, `retracted`

- `evaluation_state`
  - `pending`, `approved`, `rejected`, `human_review`

### New supporting tables

- `memory_sources`
  - link a memory to messages, runs, artifacts, or approvals

- `memory_evaluations`
  - quality and contradiction checks

- `memory_access_log`
  - audit what memory was loaded into what run

- `memory_embeddings`
  - if embeddings are stored separately

- `memory_promotions`
  - explicit movement from session → room/circle/user

## Recommended privacy model

### Hard rule

`user` memory should not be readable by all circle members.

Recommended policy model:

- `org`, `circle`, `room`
  - shared based on membership and role

- `user`
  - only owner by default
  - optionally shared via explicit publish/promote action

- `session`
  - only participants/owner unless attached to shared run

### Why this matters

Without this, the app risks leaking:

- personal work habits
- private constraints
- personal corrections
- inferred preferences

## Recommended extraction model

Move memory extraction out of the client and into a controlled service path.

### New extraction pipeline

1. session/run ends or hits checkpoint
2. transcript is compacted
3. candidate memories are extracted
4. contradiction check runs
5. evaluator scores candidates
6. high-confidence candidates are saved as `candidate`
7. auto-approve only safe categories
8. promote important memories to room/circle/user as appropriate

### Categories that can usually auto-save

- repeated user preference
- stable project decision
- explicit instruction from user

### Categories that should usually require review or stronger eval

- inferred personal facts
- sensitive business facts
- policy changes
- controversial or uncertain decisions

## Recommended ranking formula

When selecting memories for a run:

`score = (semantic_relevance * 0.45) + (importance * 0.2) + (recency_decay * 0.15) + (scope_priority * 0.1) + (access_frequency * 0.1)`

Scope priority default:

- room instruction > user preference > circle decision > circle fact > old session context

## Recommended product behavior by surface

### Main Chat

Should show:

- active memory chips
- “remember this” action
- “forget this” action
- visible source of loaded memory
- visible session summary on resume

Should not dump all memory automatically.

### Rooms

Should own:

- project instructions
- project decisions
- project references
- project glossary
- project memory review queue

Rooms are the right home for project memory.

### Feed tasks

Should use:

- task-specific session memory
- project memory from linked room
- acceptance-check findings promoted to memory when useful

### Office

Should expose:

- memory health
- extraction queue
- stale memory review
- contradiction alerts
- memory volume by scope

## Exact audit recommendations for this repo

### 1. Make `memory_entries` the source of truth

Deprecate or adapt:

- `circle_memory`
- `agent_memory`
- `automation_memory_notes`

They can remain as compatibility layers temporarily, but the app should stop growing them separately.

### 2. Fix privacy first

Claude should first fix:

- RLS for `user` scope
- query filtering for `userId`
- prompt builder to only include the active user’s private memory

### 3. Stop loading user memory without explicit user binding

`buildMemoryContext(circleId)` is too broad.

It should become something like:

- `buildStartupMemoryContext({ circleId, roomId, userId, sessionId, goal, surface })`

### 4. Add semantic retrieval

Current `ilike` search in [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts#L230) is not enough.

Add embeddings-based retrieval for:

- archival memory
- room references
- prior decisions
- research notes

### 5. Add checkpointed session compaction

Do not wait for page unload.

Checkpoint:

- every N turns
- after tool-heavy steps
- when token budget grows
- when a run pauses/completes

### 6. Add memory evaluation

Before promotion:

- check contradiction
- check duplication
- check sensitivity
- check likely durability

### 7. Keep transcript and memory separate

Do not confuse:

- what was said
- what should be remembered

## PR plan for Claude

### PR1: Safety and correctness

- fix `memory_entries` RLS for `user` scope privacy
- fix `loadMemories` to actually apply `userId`
- fix `buildMemoryContext` to require explicit bindings
- stop broad user-memory injection into prompts

### PR2: Memory API split

Create:

- `memoryService.ts`
- `memoryRetrieval.ts`
- `memoryExtraction.ts`
- `memoryEvaluation.ts`
- `memoryPolicy.ts`

Move logic out of `swanbot.ts`.

### PR3: Startup vs archival retrieval

Implement:

- startup memory bundle
- semantic archival retrieval
- retrieval audit log
- bounded token budget for memory injection

### PR4: Checkpoint compaction

Implement:

- per-run session checkpoints
- session summary refresh
- open-questions memory
- decision memory
- artifact-linked compaction

### PR5: Product surfaces

Add UI for:

- memory inspector
- memory source chips
- memory review queue
- remember/forget actions
- room memory panel

## Suggested module ownership

- [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts)
  - keep shared run primitives
  - remove heavy memory assembly logic over time

- [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts)
  - stop owning memory orchestration directly
  - consume a memory bundle service instead

- [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts)
  - evolve into extraction/evaluation helpers
  - move provider calls server-side

- [sharedMemory.ts](/Users/cswanson/the-underground-circle/src/services/sharedMemory.ts)
  - migrate to compatibility wrapper or retire

- [agentBonding.ts](/Users/cswanson/the-underground-circle/src/lib/agentBonding.ts)
  - keep bond/personality memory separate from general workspace memory, but map it into the same retrieval framework later

## Final recommendation

The best memory system for Underground Circle is not a single giant prompt context.

It is:

- small startup instruction memory
- strong session working memory
- semantic archival memory
- explicit promotion and privacy rules
- checkpointed compaction
- evaluator-gated durable memory

That is the closest path to a managed-agent-quality memory system.

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic Claude Code subagents docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic multi-agent research system: https://www.anthropic.com/engineering/built-multi-agent-research-system
- LangGraph memory docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- Letta archival memory docs: https://docs.letta.com/guides/core-concepts/memory/archival-memory/
