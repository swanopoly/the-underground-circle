# Agent Memory UI and Compaction

Date: 2026-04-08
Type: Dated research report
Scope: product patterns for memory visibility, user control, and context compaction

## Why this matters

Agent memory quality is not only a backend problem. It is also a UX problem.

If users cannot see:

- what memory was used
- what got remembered
- how to correct bad memory

then memory becomes opaque and trust drops.

## Best UX patterns

### 1. Memory source chips

Good agent products should show compact source indicators when memory influences an answer.

Examples:

- previous session
- project instruction
- user preference
- archived finding

This makes memory visible without overwhelming the main conversation.

### 2. Explicit remember and forget actions

Users should be able to:

- promote something into memory
- remove something from memory
- correct bad memory

This is better than fully hidden auto-memory.

### 3. Checkpoint compaction

Long sessions should not depend on browser unload or giant raw history dumps.

The best pattern is checkpoint compaction:

- preserve plan
- preserve decisions
- preserve unresolved questions
- preserve artifact references
- summarize noisy traces

### 4. Workspace memory review

Project/workspace surfaces should expose memory review so durable knowledge can be curated at the workspace level, not only at the chat bubble level.

## Product implication for Underground Circle

Underground Circle should add:

- memory source chips in chat
- remember and forget actions
- checkpoint compaction during long runs
- Room and Office memory review panels

## Sources

- Anthropic Claude Code memory docs: https://docs.anthropic.com/en/docs/claude-code/memory
- Letta memory blocks docs: https://docs.letta.com/guides/agents/memory-blocks
- LangGraph memory docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- OpenAI conversation state docs: https://platform.openai.com/docs/guides/conversation-state
