# Agent Memory Review Notes

Date: 2026-04-08
Type: Dated research and implementation notes
Scope: practical lessons from reviewing the current memory implementation

## Main lesson

A good memory architecture can still fail in implementation if:

- metadata is not saved consistently
- private memory is not queried correctly
- session summaries are appended forever instead of checkpointed

## Key review points

### 1. Save memory metadata directly

If importance and retrieval mode are applied in a second lookup/update step, memory quality becomes inconsistent. Memory creation should write the ranking metadata in the initial insert path.

### 2. User-bound queries must stay user-bound

A managed memory system only stays private and useful if review and retrieval paths keep the active user binding all the way through.

### 3. Session summaries should be snapshots

Session memory should not be an ever-growing list of near-duplicate summaries. Better systems checkpoint compacted session state and promote only the durable parts into long-term memory.

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- Supabase semantic search docs: https://supabase.com/docs/guides/ai/semantic-search
