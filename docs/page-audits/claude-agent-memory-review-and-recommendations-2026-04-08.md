# Claude Agent Memory Review and Recommendations

Date: 2026-04-08
Type: Code review + research-backed recommendations
Status: Review document

## Findings

### 1. User memory metadata is only applied to the first newly-saved memory

Severity: High

In [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts#L192), the follow-up update that sets `importance` and `retrieval_mode` only runs when `saved === 0`. In practice that means only the first inserted memory in a batch gets those fields updated correctly.

Why this matters:

- later memories in the same extraction batch lose ranking metadata
- startup vs on-demand retrieval becomes inconsistent
- memory ranking quality degrades immediately

Recommendation:

- have `saveMemory(...)` accept the metadata directly
- remove the fragile second query by title
- return the inserted row id and update deterministically only if needed

### 2. The user memory review path does not actually pass the active user id into retrieval

Severity: High

In [agentMemory.ts](/Users/cswanson/the-underground-circle/src/lib/agentMemory.ts#L238), `getUserMemories()` calls `loadMemories({ circleId, limit: 200 })` without forwarding `userId`.

Why this matters:

- the memory review UI can miss the active user’s private memories
- the UI and runtime can disagree about what memory exists

Recommendation:

- pass `userId` through to `loadMemories`
- split review queries into:
  - shared workspace memories
  - owner-only private memories

### 3. Last-session context retrieval still has weak user/session binding

Severity: Medium

In [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts#L192), `getLastSessionContext(circleId)` loads:

- `session` memories by circle only
- durable `circle` + `user` memories without an explicit `userId`

Why this matters:

- session summaries are not tied to a specific session id
- session recall is effectively recency-based within the whole circle
- user memory participation in this path is inconsistent

Recommendation:

- change this to `getLastSessionContext({ circleId, userId, sessionId, roomId })`
- load:
  - the active session summary if present
  - otherwise the most relevant prior session for that user/workspace
- keep user-private durable memory out of this function unless userId is explicit

### 4. Session memory creation is append-only and will accumulate noisy summaries

Severity: Medium

In [swanbot.ts](/Users/cswanson/the-underground-circle/src/lib/swanbot.ts#L164), each call to `saveSessionToMemory` inserts a new `session` memory row instead of updating a current session snapshot.

Why this matters:

- duplicate session summaries pile up quickly
- prompt recall becomes more recency-heavy and less meaningful
- review panels will fill with low-value near-duplicates

Recommendation:

- move session checkpointing to a dedicated `run_context_snapshots` table
- promote only the current compact session summary into `memory_entries` when needed

### 5. Memory ranking is still mostly heuristics layered on top of recency

Severity: Medium

In [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts#L458), `buildMemoryContext` sorts by `importance` if present, otherwise kind-priority heuristics, then injects a bounded text block.

Why this matters:

- this is better than raw recency, but it is still not semantic retrieval
- long-lived workspaces will eventually load the wrong durable memory

Recommendation:

- keep `buildMemoryContext` only for startup memory
- move archival retrieval into a separate semantic retrieval path

## Recommendations

### A. Make `saveMemory` metadata-aware

Update `saveMemory(...)` so it can accept:

- `importance`
- `confidence`
- `retrievalMode`
- `visibility`
- `status`

This removes the brittle second-write behavior.

### B. Split memory APIs into explicit lanes

Add separate APIs for:

- `loadStartupMemories(...)`
- `loadPrivateUserMemories(...)`
- `retrieveRelevantArchivalMemories(...)`
- `loadRoomMemoryReview(...)`

### C. Treat session summaries as snapshots, not durable rows by default

Use:

- snapshot table for checkpoints
- durable memory only for promoted findings/decisions/instructions

### D. Add deterministic source linking

Every saved memory should keep clear source lineage:

- message
- run
- step
- artifact
- manual action

### E. Keep the best product pattern

The strongest pattern remains:

- visible memory sources
- explicit remember/forget actions
- checkpoint compaction
- workspace review
- semantic archival retrieval

## Suggested next changes for Claude

### PR1

- fix `getUserMemories()` to pass `userId`
- fix metadata write bug in `autoExtractAndSave()`
- refactor `saveMemory()` to accept retrieval metadata directly

### PR2

- add `run_context_snapshots`
- stop treating every session summary as a durable memory row

### PR3

- add semantic archival retrieval
- keep `buildMemoryContext()` as startup-memory only

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- LangGraph memory docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- Letta archival memory docs: https://docs.letta.com/guides/core-concepts/memory/archival-memory/
- Supabase semantic search docs: https://supabase.com/docs/guides/ai/semantic-search
