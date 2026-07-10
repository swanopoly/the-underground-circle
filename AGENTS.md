# AGENTS.md - Start Here

> Last reviewed: 2026-07-10

This is the entry point for every contributing agent: Claude Code, Codex,
Cursor, Gemini, OpenSwan bridges, and future runtime agents. Keep this file
short. Detailed context lives in the linked docs.

## Read Order

1. `docs/AGENTS_ROADMAP.md` - canonical agent runtime plan.
2. `docs/UC_APP_STACK_REFERENCE.md` - current app stack and navigation map.
3. `CLAUDE.md` - human-readable project context and current app review.
4. Tool-specific notes only as needed:
   - `AGENT.md` for Codex-style repo work.
   - `Gemini.md` for Gemini CLI.
   - `MEMORY.md` for persistent gotchas and project memory.

**If you are in an openswan worktree** (path contains `.openswan-worktrees/`): you are in an
isolated git branch of the same codebase. Worktrees inherit the repo files as-is, so treat
`docs/AGENTS_ROADMAP.md` as canonical and `CLAUDE.md` as the current app review, exactly as you
would at the repo root. (`.openswan-worktrees/` is gitignored, so worktree-local copies are not
tracked.)

If any doc conflicts with `docs/AGENTS_ROADMAP.md`, the roadmap wins and the
other doc should be fixed in the same change.

## Canonical Ownership

`docs/AGENTS_ROADMAP.md` owns:

- the file ownership table in section 2
- the phase status tracker in section 3
- the execution-loop migration plan in section 4
- the SQL checklist in section 5
- the contributing-agent rules in section 6

Before adding a new file under `src/lib/openswan*.ts`, `src/lib/agent*.ts`,
provider-routing code, chat automation code, or agent-runtime SQL, check the
roadmap ownership table. If a concern already has an owner, extend the owner
instead of creating a parallel path.

## Current Direction

The Underground Circle is a web-first Expo/React Native + Supabase app for
shared AI-agent accountability. The core product loop is:

`connect repo/providers -> work in Chat/Office/Feed -> agents run tasks ->
proof/activity/memory updates -> team sees what shipped`.

The active runtime work is centered on:

- BlackSwan/OpenSwan chat and tool execution.
- Provider marketplace and BYOK routing across Anthropic, OpenAI, OpenRouter,
  Hugging Face, Groq, Google AI, DeepSeek, Mistral, Cohere, Perplexity,
  Together, Fireworks, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave
  Search, and browser/computer providers such as Browserbase and Stagehand.
- Computer Use and local desktop awareness through Browserbase, bridge tools,
  and guarded local actions.
- Memory bank, user memory, SKILL.md library, checkpoints, and run telemetry.

## Update Contract

- Shipped a roadmap item: update `docs/AGENTS_ROADMAP.md` with the date.
- Added a canonical file: add it to the roadmap ownership table.
- Added agent-runtime SQL: update the migration, `docs/RUN_THIS_SQL.sql` if it
  is part of the consolidated agent SQL, and the roadmap SQL checklist.
- Deprecated a path: mark the replacement in the roadmap before removing live
  callers.
- Changed app-wide architecture: update `CLAUDE.md`,
  `docs/UC_APP_STACK_REFERENCE.md`, and the roadmap if ownership changed.
