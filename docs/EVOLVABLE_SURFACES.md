# Evolvable Surfaces

> What an automated prompt/flow optimizer (DSPy/GEPA or equivalent) is
> allowed to change, and what stays out of bounds.
>
> **Authored:** 2026-04-23 · **Cross-linked from:**
> [`PHASE_CA-8_HERMES_DELTA_PLAN.md`](./PHASE_CA-8_HERMES_DELTA_PLAN.md),
> [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md).

## TL;DR

The optimizer may edit **text** (prompt fragments, skill bodies, tool
descriptions). It may **not** edit **logic** (TypeScript, Swift, SQL).
Regenerate → re-score against `docs/evals/golden.jsonl` → merge only
if every pinned check still passes.

The gate that unlocks optimization at all: **≥50 curated skills + ≥1K
persisted runs**, per `HERMES_INTEGRATION_PLAN.md` Phase 5. Until we
clear that, `docs/evals/golden.jsonl` is a regression canary you run
by hand (or once CA-8g's runner lands, nightly in CI).

## In bounds — optimizer may rewrite

| Surface | Files / tables | Why it's safe |
|---|---|---|
| Agent system prompt fragments (frozen + volatile blocks) | `supabase/functions/swanbot-v2-ai/index.ts` `buildFrozenBlock`, `MODE_CONTRACT` map | Pure text. Failure mode is a quality regression caught by golden evals. |
| Tool descriptions (the `description` field on `TOOLS: ToolDef[]`) | Same file, per-tool `description` strings | The model's decision to call or skip a tool is entirely driven by description. Good targets for rewriting. |
| Skill bodies (SKILL.md content) | `circle_skills.content` + sub-files under `circle_skill_files` | Users author these; optimizer can propose + file `agent_approvals` rows, humans merge. |
| Automation prompt templates | `src/lib/missionTemplates.ts`, `src/lib/computerUseTemplates.ts` | Same as above — pure template text. |
| Capability profile prompts | `src/lib/taskCapabilityProfiles.ts` (the `prompt` field per profile) | Profile-level system additions the runtime injects per surface. |
| Intent classifier verb lists | `hasFollowUpIntent` verbs, `computerTaskPlanner` `explicitAppName` arrays | Heuristic data, not logic. |
| Known-app aliases | `src/lib/knownAppShortcuts.ts` `aliases` arrays | Pure lookup data; logic is frozen. |

## Out of bounds — humans only

| Surface | Files | Why it's fenced |
|---|---|---|
| All `.ts` / `.tsx` module logic | `src/`, `supabase/functions/` non-prompt code | Type safety, security boundaries, tool contracts — optimizer can't reason about these. |
| Swift AX helper | `scripts/bin/uc-ax-helper.swift` | Permissions-scoped binary; signed + trusted. |
| Bridge / browser-bridge scripts | `scripts/claude-bridge.js`, `scripts/browser-bridge.js` | Network-accessible code; any mutation risks auth bypass. |
| Supabase migrations | `supabase/migrations/**.sql` | Schema changes require explicit human review + deploy. |
| RLS policies | Inside migrations | Security critical. |
| Tool schemas (`input_schema`) | `TOOLS: ToolDef[]` entries | Breaking the schema breaks type contracts the model relies on. |
| Capability profile routing logic | `chatAutomationPlanner`, `computerTaskRuntime` | Decisions about which profile to load are not prompt problems. |
| Approval gate categories | `chatApprovalGate` | Governance — users gave explicit consent to specific categories. |
| Build pipeline + CI | `package.json` scripts, `.github/**` | Infra. |

## Process

1. **Collect traces.** `scripts/export-traces.ts` dumps `agent_runs`
   + `agent_run_events` for a date range into
   `docs/traces/<yyyy-mm-dd>.jsonl`. Each line is one run with its
   prompt, tool calls, final response, usage, success/fail.
2. **Score baseline.** Run the current prompts/skills against the
   golden set to get a baseline pass-rate. Record in git.
3. **Propose edits.** Optimizer (DSPy/GEPA/whatever) rewrites
   in-bounds surfaces only. Every proposal is a PR or an
   `agent_approvals` row — no direct writes.
4. **Re-score.** Run golden evals against the proposed version.
   Accept only when every pinned check still passes AND at least
   one trace-based metric improves (e.g. lower tokens per task,
   fewer iterations to `end_turn`).
5. **Roll out.** Apply via the existing approval queue. Keep the
   previous version pinned in `circle_skills.meta.previous` so
   rollback is one UPDATE.

## Current optimizer status

**Not running.** `docs/evals/golden.jsonl` has 8 seed cases; the
runner (`scripts/run-evals.ts`) is deferred to CA-8g follow-up.
Keeping the eval format + this doc checked in now so: (a) regression
tests have a target shape, (b) when we cross the `≥50 skills + ≥1K
runs` gate we can flip on the optimizer without re-designing scope.

## Safety backstops

- **Type checking.** Every PR must `npx tsc --noEmit` clean. The
  optimizer can't silently break types because it doesn't touch `.ts`
  files.
- **Golden evals.** Every PR that touches prompt fragments or skill
  bodies runs `npx tsx scripts/run-evals.ts` (once shipped). Failure
  blocks merge.
- **Rollback ledger.** `circle_skills` versioning — every write keeps
  prior body accessible so a bad optimizer proposal is a one-click
  revert.
- **Cost cap.** `circles.settings.automation_max_cost_usd` daily cap
  enforced by the existing `claude_api_usage` 24h rolling sum.
  Runaway optimizer = cap triggers, no surprise bill.
