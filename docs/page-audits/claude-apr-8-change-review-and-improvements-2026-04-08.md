# Claude Apr 8 Change Review And Improvements

## Findings

### 1. Memory ownership was still too loose in explicit `forget` flows

Before this pass, chat-driven forget actions could search broadly within a circle and deactivate memories without clearly constraining ownership. That made the UX feel simple, but it was the wrong trust model for private/session memory.

Relevant files:
- `src/lib/memoryService.ts`
- `src/lib/conversationalRouter.ts`
- `src/screens/circles/tabs/ChatTab.tsx`

Change made:
- `forgetFromChat()` now requires `userId`
- only shared circle memories or the current user’s own `user` / `session` memories can be deactivated
- both the blue main chat and conversational router now pass the active user id through

### 2. The memory metadata model was ahead of the shared type layer

Claude’s newer memory work was already writing fields like `visibility`, `importance`, and `retrieval_mode`, but the shared `MemoryEntry` type in the agent runtime layer did not reflect them consistently. That weakens ranking logic, UI behavior, and future review tooling.

Relevant file:
- `src/lib/agentRunSystem.ts`

Change made:
- expanded `MemoryEntry` to include optional metadata already being used elsewhere:
  - `session_id`
  - `source_surface`
  - `visibility`
  - `importance`
  - `retrieval_mode`
  - `status`
  - `access_count`
  - `last_accessed_at`
  - `updated_at`
- updated the runtime mapper so these fields survive round-trips cleanly

### 3. Startup memory and archival memory were still blended too loosely

Claude’s new memory work correctly moved toward startup vs on-demand retrieval, but the effective startup bundle could still include lower-signal content and duplicates. This reduces agent sharpness over long-running usage.

Relevant files:
- `src/lib/memoryService.ts`
- `src/lib/agentRunSystem.ts`

Change made:
- `loadStartupMemory()` now explicitly builds a bounded startup bundle from:
  - startup-ranked durable memories
  - one recent session summary
- `manual_only` memories are excluded from automatic prompt injection
- startup ranking now prefers:
  - `retrieval_mode = startup`
  - higher `importance`
  - more recent entries as a tiebreaker
- prompt memory rendering now deduplicates repeated active memories by scope/title

### 4. Compaction output quality was good enough to exist, but not good enough to trust

Claude added useful compaction primitives, but compaction writes were still under-specified. In practice that means session summaries and open questions could be saved without enough ranking hints, and open-question formatting was slightly malformed.

Relevant file:
- `src/lib/memoryService.ts`

Change made:
- compacted session summary saves now carry:
  - `visibility`
  - `importance`
  - `retrievalMode`
- compacted decisions now save as high-importance startup-visible circle decisions
- open questions now render as proper bullet lists and save with explicit startup metadata

### 5. Archival retrieval was still better than pure recency, but not yet strong enough

Claude already improved retrieval beyond a naive recency dump, but the ranking still needed minor cleanup to better favor durable operational knowledge.

Relevant file:
- `src/lib/memoryService.ts`

Change made:
- retrieval now excludes `manual_only` memories from automatic archival recall
- exact-title matches get an additional boost
- `decision` and `instruction` memories get a small ranking multiplier

## What Improved

This pass makes the current Claude memory stack more internally coherent without forcing a large rewrite:

- safer memory deletion behavior
- better startup prompt quality
- cleaner separation between startup memory and on-demand retrieval
- lower duplicate/noise load in injected memory
- stronger metadata continuity from save to load to ranking

## Remaining Gaps

These are still not solved by the current codebase:

1. Retrieval is still lexical, not semantic. It is stronger than before, but still not the best possible memory recall system.
2. Session compaction still writes into `memory_entries` instead of a dedicated checkpoint snapshot table.
3. Contradiction handling is still mostly overwrite-or-skip, not lineage-aware supersession.
4. The app still lacks a clean user-facing memory source chip model in the main transcript.
5. Memory review exists, but not yet as a first-class workspace governance surface in Rooms and Office.

## Research Notes

The changes above align with the strongest current public memory patterns:

- Anthropic Claude Code memory guidance separates always-loaded project/user memory from other state and explicitly warns that large startup memory hurts adherence.  
  Source: https://code.claude.com/docs/en/memory

- Letta’s memory-block model treats core memory as always-visible and retrieval-free, which is a good conceptual match for startup memory rather than archival recall.  
  Source: https://docs.letta.com/guides/core-concepts/memory/memory-blocks

- LangGraph’s memory model distinguishes checkpointed thread state from longer-term memory, which reinforces the need to move session compaction toward checkpoint snapshots instead of endlessly adding durable rows.  
  Source: https://docs.langchain.com/oss/javascript/langgraph/add-memory

## Recommended Next PR

If Claude keeps iterating on this system, the next best bounded PR is:

1. Add `run_context_snapshots` and move compaction there first.
2. Add memory source chips to main chat so users can see what the agent is relying on.
3. Add semantic retrieval with pgvector or equivalent reranking for archival memory.
4. Add contradiction lineage (`supersedes_memory_id`) instead of raw overwrite behavior.
