# AGENTS.md — start here

This file is the entry point every contributing agent (Claude Code, Codex,
Cursor, Gemini, Hermes, future bridges) reads first. It is intentionally
short. Everything load-bearing lives in the docs it links to.

## Canonical plan

**Read this first, every session:** [`docs/AGENTS_ROADMAP.md`](./docs/AGENTS_ROADMAP.md).

That doc owns:
- the file ownership table (`§2`) — who owns which `*.ts` / table
- the phase status tracker (`§3`)
- the in-flight migration plans (`§4`)
- the 10 rules for contributing agents (`§6`)
- the SQL checklist (`§5`)

If `AGENTS_ROADMAP.md` disagrees with any other doc, `AGENTS_ROADMAP.md` wins
and the other doc needs fixing.

## Full project context

- [`CLAUDE.md`](./CLAUDE.md) — project overview, tech stack, schema, known
  gotchas, coding conventions. The 30-minute orientation read.
- [`Gemini.md`](./Gemini.md) — Gemini-specific notes.

## Specialized plan docs (all consistent with the roadmap; read as needed)

- [`docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`](./docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md)
  — Codex's 8-section runtime breakdown. Still authoritative per-section;
  the roadmap just tracks which pieces are shipped / pending.
- [`docs/HERMES_INTEGRATION_PLAN.md`](./docs/HERMES_INTEGRATION_PLAN.md)
  — Claude Code's phased Hermes-adoption plan. Adoption ordering.
- [`docs/HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md`](./docs/HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md)
  — Codex's research into Hermes patterns. Reference.
- [`docs/OPTIMIZATION_PLAN.md`](./docs/OPTIMIZATION_PLAN.md)
  — non-agent optimization work (bundle, pagination, error boundaries).
- [`docs/RUN_THIS_SQL.sql`](./docs/RUN_THIS_SQL.sql)
  — all pending DB changes, idempotent, paste-and-run.

## The contract, in one sentence

Before you add a new file under `src/lib/openswan*.ts`, `src/lib/agent*.ts`,
or a new Supabase migration, check the ownership table in
[`docs/AGENTS_ROADMAP.md`](./docs/AGENTS_ROADMAP.md) §2 and the rules in §6.
If the concern is already owned, extend — don't duplicate.

## When to update the plan

- Shipped a phase item → move it in §3 with today's date.
- Added a new canonical file → add a row to §2.
- Deprecated a file → move it to the deprecated table in §2 with its
  replacement.
- Ran new SQL → update §5.
- Discovered a new architectural concern not covered → add it to §2 with
  "Planned" status and link the discussion in the PR.
