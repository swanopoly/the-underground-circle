# Managed Agent Memory Patterns

Date: 2026-04-08
Type: Dated research report
Scope: AI agent memory systems, session continuity, retrieval, compaction, and production patterns

## Why this matters

Agent memory is one of the clearest dividing lines between:

- a chatbot that answers the current turn
- an agent that can stay useful across long tasks, repeated sessions, and delegated work

The highest-value pattern across current systems is not "store everything." It is:

- keep a small always-visible instruction layer
- maintain active session state separately
- move durable learnings into long-term memory
- retrieve archival memory on demand
- compact noisy history aggressively

## The best current memory pattern

### 1. Always-visible instruction memory

This is the layer that should always be present at run start.

Examples:

- project instructions
- room rules
- user preferences
- policy constraints
- style guidance

Anthropic’s Claude Code memory docs follow this pattern through persistent instructions plus auto memory loaded at startup, while Letta describes memory blocks as always-visible structured memory.

### 2. Session working memory

This is the active thread/run state:

- goal
- plan
- current hypotheses
- open questions
- blockers
- delegated subtasks

Anthropic’s multi-agent research writeup shows why this matters: the lead agent explicitly stores the plan so it survives context compaction.

### 3. Archival memory

This is durable memory retrieved by relevance, not dumped into every prompt.

Examples:

- prior project decisions
- repeated user preferences
- prior findings
- stable reference knowledge

LangGraph and Letta both reinforce the value of separating active context from archival memory.

### 4. Transcript and logs

Raw history should remain available for audit and recall, but it should not be treated as startup memory.

## Key production lessons

### Retrieval matters more than raw storage volume

The winning systems do not simply inject the latest 30 records. They select memory based on:

- relevance to current goal
- importance
- freshness
- scope
- role/task fit

### Compaction is not optional

Long runs get worse if tool traces and stale chatter accumulate.

The best pattern is:

- preserve plan
- preserve decisions
- preserve unresolved questions
- preserve artifact links
- summarize or drop low-value traces

### Memory promotion should be explicit

Good systems distinguish:

- temporary session context
- candidate durable memory
- approved durable memory

Everything should not be promoted automatically.

### Subagents need separate memory boundaries

Anthropic’s subagent model is important because it keeps specialized workers from polluting one giant shared context window. The main agent should decide what to pass down and what to pull back up.

## What Underground Circle should do

The app should standardize on four memory layers:

1. instruction memory
2. session working memory
3. archival memory
4. transcript/log memory

The app should also add:

- semantic retrieval for archival memory
- explicit memory promotions
- checkpoint compaction
- evaluator-gated memory saving
- per-subagent memory boundaries

## Best UX patterns to surface in the app

- show which memories were loaded into the current run
- let the user mark something as `remember this`
- let the user mark something as `do not remember this`
- show session summary on resume
- expose project memory in Rooms
- expose memory health and stale memory review in Office

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic Claude Code subagents docs: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic multi-agent research system: https://www.anthropic.com/engineering/built-multi-agent-research-system
- LangGraph memory docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- Letta memory blocks docs: https://docs.letta.com/guides/agents/memory-blocks
- Letta archival memory docs: https://docs.letta.com/guides/core-concepts/memory/archival-memory/
