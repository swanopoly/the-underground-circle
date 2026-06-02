# AGENTS.md - Start Here

This is the entry point for every contributing agent: Claude Code, Codex,
Cursor, Gemini, OpenSwan bridges, and future runtime agents. Keep this file
short. Detailed context lives in the linked docs.

## Read Order

1. `docs/AGENTS_ROADMAP.md` - canonical agent runtime plan.
2. `docs/UC_APP_STACK_REFERENCE.md` - current app stack and navigation map.
3. `CLAUDE.md` - human-readable project context and current app review.
4. Tool-specific notes only as needed:
   - `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md` to choose the right coding,
     TypeScript, design, or web-page standard for the task.
   - `docs/CODING_AGENT_BEST_PRACTICES.md` for general code quality, security,
     testing, review, and handoff standards.
   - `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` for TypeScript and React Native
     type-safety standards.
   - `docs/DESIGN_AGENT_BEST_PRACTICES.md` for product design, design-system,
     UX writing, and automation UI standards.
   - `docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md` for modern web page, layout,
     accessibility, and responsive design standards.
   - `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md` for browser, desktop,
     local-file, native-app, Adobe/CAD, approval, evidence, and recovery
     automation standards.
   - `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md` for OpenSwan, bridge, MCP,
     connected-agent tool contracts, approval metadata, recovery, redaction,
     and eval standards.
   - `AGENT.md` for Codex-style repo work.
   - `Gemini.md` for Gemini CLI.
   - `MEMORY.md` for persistent gotchas and project memory.

**If you are in an openswan worktree** (path contains `.openswan-worktrees/`): the `AGENT.md`
and `CLAUDE.md` in that worktree are current. The worktree `CLAUDE.md` carries a stale warning
at the top — read it and follow the root `CLAUDE.md` for anything not in the Missions/office
sections.

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
  Together, Fireworks, z.ai, MiniMax, Ollama, and related providers.
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
