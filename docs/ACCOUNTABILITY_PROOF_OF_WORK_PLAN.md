# Accountability & Proof-of-Work Plan

> Where completed agent runs / tasks do NOT produce team-visible proof, and which
> already-built cores fill each gap.
> Owner surface: Feed (proof-of-work + activity). Priority: **#1 (accountability)**.
> Author: deep-research pass, 2026-07-16. Status: analysis + wiring plan (no code changed).

## TL;DR

The app has a fully-styled proof-of-work Feed lane, a proof card summarizer, a
task↔PR extractor, and a `proof_of_work` writer for agent runs — but **the write
path is never connected**. Completed OpenSwan runs write rich telemetry to
`agent_runs` / `agent_run_events`, and the Feed reads a *different* set of tables
(`agent_activity`, `automation_runs`, `task_runs`, `proof_of_work`). The bridge
that would turn a finished run into a team-visible proof card is built and
smoke-tested but **unwired**:

| Built core | Smoke | Callers | Fills gap |
|---|---|---|---|
| `openswanRunProofCore.buildRunProof` (`src/lib/openswanRunProofCore.ts:498`) | `smoke:openswan-run-proof` (756 pass) | **0** | 1, 2, 4 |
| `taskPRLinkageCore.extractGitReferences` (`src/lib/taskPRLinkageCore.ts:313`) | `smoke:task-pr-linkage-core` (96 pass) | **0** | 3 |
| `proofOfWork.recordAgentRunProof` (`src/lib/proofOfWork.ts:159`) | — | **0** | 1, 4 |

The Feed's proof lane is *already* styled for the missing entries: pow_type
`agent_run` has a color and icon in `ActivityFeedPanel.tsx:333/337`, and
`PowType` includes `'agent_run'` (`src/lib/missions.ts:13`). Nothing ever writes
that row.

---

## How proof flows today (write side vs. read side)

### Write side — what a completed run persists

**Chat / Office OpenSwan run** (`runOpenSwanSessionTurn`, surface `main_chat` /
`room_chat`), `src/lib/openswanSessionRuntime.ts`:
- Live telemetry → `agent_run_events`: `route_decision`, `tool_call_start`,
  `tool_call_result`, `final_response` (`:901-971`).
- A proof-of-work *summary* → a single `verification_receipt` event
  (`:1034-1056`, via `verificationReceiptCore`) — files edited, checks passed,
  committed.
- Finalize → `agent_runs` status `completed` + usage/cost + metadata blob
  (`:2114-2242`, via `updateRunStatus` / `mergeRunMetadata`).
- **Never writes** `proof_of_work`, `agent_activity` (proof card), or `task_runs`.
- `agentRunPersistence.finalize` (`src/lib/agentRunPersistence.ts:241-276`) does
  the same for the typed-core path: `agent_runs` totals + status only.

**Feed task OpenSwan run** (`runAgentOnTask`, surface `feed_task`),
`src/hooks/useKanbanData.ts`:
- `task_runs` row (`:1514`, `:1684-1716`) with `output_payload` = `{ deliverable,
  verification_results, tool_events, openswan_run_id }`, plus `summary`,
  `artifact_refs`, tokens/duration/cost. **This is the one path that reaches the
  Feed**, via `task_runs`.
- `task_run_steps` / `task_run_artifacts` / `task_run_check_results` +
  a task comment.
- **Does not** extract PR/commit refs from `output_payload.tool_events`, and
  **does not** write a `proof_of_work` row for the run.
- `moveTask` → `done` writes a `proof_of_work` row **only if the task has a
  `mission_id`**, and only pow_type `'manual'` (`:1116-1134`). An agent
  completing a task via `runAgentOnTask` writes no proof-of-work at all.

### Read side — what the team Feed shows

`ActivityFeedPanel.tsx` (`src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx`),
rendered as the Feed's mobile "Activity" tab and desktop activity strip, reads
four tables (`:91-159`):
- `agent_activity` (60) — message/tool activity, written by the edge functions
  (`swanbot-v2-ai` writes `message_out` / `tool_call` / `task_completed`,
  `supabase/functions/swanbot-v2-ai/index.ts:3133-3170`).
- `automation_runs` (failed/completed, 10).
- `task_runs` (completed/failed, 12) + `agent_runs.metadata` joined via
  `openswan_run_id` → `RunMetadataSummary` (`:218-253`).
- `proof_of_work` (20), rendered `:330-358` with per-type color/icon.

It does **not** read `agent_runs` or `agent_run_events`. `agent_run_events` is
read in exactly one place — to reconstruct a desktop action trace
(`src/lib/agentRunSystem.ts:662-669`) — and `verification_receipt` has **zero
readers** anywhere in the repo.

`ActiveRunsWidget` (`FeedTab.tsx:381-423`) reads only non-terminal runs
(`getActiveRuns`) and returns `null` when empty — a completed run vanishes from
it. `RunMetadataSummary` (`src/lib/runMetadataSummary.ts:71-109`) surfaces mode /
browser / skills / observed-eval, but **no proof card, no files-touched, no
verified badge, no PR link**.

---

## The gaps

### GAP 1 — Completed runs write no `proof_of_work` row; the Feed's proof lane never shows agent work
- **Where:** chat finalize `openswanSessionRuntime.ts:2114` (`updateRunStatus(run.id,'completed',…)`) and feed-task finalize `useKanbanData.ts:1684`. Neither calls `recordAgentRunProof` / `addProofOfWork`.
- **Symptom:** the unified proof feed shows GitHub commits/PRs (from the webhook) and manual check-ins, but never a single agent run — even though the UI is styled for pow_type `agent_run` (`ActivityFeedPanel.tsx:333/337`) and `PowType` allows it (`missions.ts:13`).
- **Fill:** `buildRunProof({ toolsUsed, filesTouched, verification, stopReason, durationMs, outputSummary })` → `recordAgentRunProof(...)` (or `addProofOfWork({ pow_type:'agent_run', … })`). All inputs are already in scope at both finalize sites (`toolEvents`, `verificationResults`, `structured.response`, usage).

### GAP 2 — The proof summary that IS produced is dead telemetry
- **Where:** `openswanSessionRuntime.ts:1042` inserts a `verification_receipt` into `agent_run_events`.
- **Symptom:** nothing reads `verification_receipt` (0 readers); `agent_run_events` is consumed only for desktop-trace replay (`agentRunSystem.ts:662`). The "what was done / what was verified" summary never reaches a team surface.
- **Fill:** promote it out of the private event log. The richer `openswanRunProofCore.buildRunProof` card supersedes the one-line receipt for Feed display; persist it as the GAP-1 `proof_of_work` row (and/or an `agent_activity` `task_completed` row so it rides the existing realtime Feed subscription).

### GAP 3 — No task↔PR/commit linkage; PRs an agent opens are invisible on the task
- **Where:** `useKanbanData.ts:1684-1716` stores raw `output_payload.tool_events[].summary` (git.run output) but extracts nothing; the `task_runs` Feed card (`ActivityFeedPanel.tsx:218-253`) shows summary/model/duration/tokens, no PR.
- **Symptom:** when an agent opens a PR / pushes commits via `git.run`, the canonical GitHub URL is buried in tool text — the Feed can't show "Linked PR #123 (owner/repo)". Separately, `github-webhook` writes an independent `proof_of_work` `pr` row on open/merge (`supabase/functions/github-webhook/index.ts:808`) with `detail.url` but **no `task_id` / `run_id`**, so "agent X's task produced PR #123, which merged" is never assembled.
- **Fill:** `extractGitReferences({ deliverable, toolEvents, attachments })` at the `runAgentOnTask` completion site → persist canonical refs onto the task_run (`output_payload.git_references` + a `link` `task_run_artifact`) and into the proof detail; `formatGitReferenceLabel` renders the chip. Storing the canonical URL + `task_id` also gives the merge webhook a key to settle against (the exact "later merge webhook can settle it" contract in `taskPRLinkageCore.ts:5-8`).

### GAP 4 — Completed Chat/Office runs leave no Feed trace at all
- **Where:** `ActiveRunsWidget` shows active runs only (`FeedTab.tsx:399`); a Chat OpenSwan run writes none of the proof-bearing tables the Feed reads.
- **Symptom:** a teammate sees a Chat agent run only while it is live; once it completes it disappears from the Feed unless it was a `feed_task`. "What did the agents actually accomplish" is unanswerable from the Feed for the #1 agent surface (Chat).
- **Fill:** GAP-1's `recordAgentRunProof` at the chat finalize site gives every completed run a durable `proof_of_work` row in the Feed's proof lane. (Optional secondary: a "recent completed runs" read of `agent_runs` in the Feed.)

---

## Recommended wiring (ranked)

> Constraint: `openswanSessionRuntime.ts`, `ChatTab.tsx`, `swanbot.ts`,
> `chat-stream/index.ts`, `package.json` are live-session hot files. The plan
> isolates new logic in a **new publisher module** so the touch into any hot file
> is a single call the owner can drop in; the feed-task path (`useKanbanData.ts`)
> is non-hot and can be wired directly first.

1. **Add `src/lib/openswanRunProofPublisher.ts`** (new, dependency-light) that
   composes `buildRunProof` + `recordAgentRunProof`/`addProofOfWork` into one
   fire-and-forget, non-fatal `recordOpenSwanRunProof({ circleId, agentName,
   runId, toolEvents, verificationResults, stopReason, durationMs, summary,
   missionId?, taskId? })`. Follow the telemetry discipline in
   `agentRunPersistence.ts` (never throw, never block the run) and the
   RLS-write-blocked fallback in `agentActivityLogger.ts:40-63`.

2. **Wire it into the feed-task finalize first** (`useKanbanData.runAgentOnTask`,
   `~:1716`, non-hot). Covers GAP 1/2/4 for `feed_task` runs and needs no
   hot-file edit. Every completed task run now emits an `agent_run` proof row.

3. **Wire `extractGitReferences` into the same feed-task completion site**
   (`useKanbanData.ts:1684-1716`). Persist `output_payload.git_references` + a
   `link` `task_run_artifact`, and pass the canonical PR/commit refs into the
   proof detail (GAP 3). Render `formatGitReferenceLabel` on the `task_runs` and
   proof cards in `ActivityFeedPanel.tsx`.

4. **Hand the chat/office finalize wire to the session-runtime owner**: a single
   `recordOpenSwanRunProof(...)` call at `openswanSessionRuntime.ts:2114`
   (completed branch) closes GAP 4 for Chat/Office. Keep it behind the same
   non-fatal guard so it can never break a live turn.

5. **Add the PR settlement join** so `github-webhook` (`:808`) can match a merge
   event to the agent-side proof by canonical URL (+ carry `task_id`/`run_id`
   into proof detail on both sides). Lower priority; depends on #3.

6. **Correct the roadmap.** `docs/AGENTS_ROADMAP.md:126` lists
   `recordAgentRunProof` as "Shipped 2026-04-10 / Consumed by MissionsTab" — it
   has **zero callers** (`MissionsTab` calls `addProofOfWork` directly). Update
   status/ownership once wired.

## Validation
- Existing green cores: `npm run smoke:openswan-run-proof` (756),
  `npm run smoke:task-pr-linkage-core` (96), `npm run smoke:verification-receipt-core`.
- After wiring, add a smoke for the new publisher (pure compose of the two cores)
  and keep `npm run smoke:feed-loop-in` / `npm run smoke:mission-task-completion` green.
- Manual: run a Chat coding turn and a Feed task that opens a PR; confirm one
  `proof_of_work` `agent_run` row + a linked PR chip appear in the Feed's
  Activity lane in realtime.

## Non-goals / guardrails
- Secret safety is already handled by the cores: `buildRunProof` redacts
  secret-looking tokens and reduces paths to basenames; `extractGitReferences`
  hard-scopes to `github.com` and rebuilds canonical URLs. Do not bypass them by
  writing raw tool text into `proof_of_work.detail`.
- Keep every proof write fire-and-forget and RLS-safe; a telemetry failure must
  never fail a user-visible run (matches `agentRunPersistence` / `logActivity`).
- Bound payloads (the cores already cap output) to respect the compact-row rule
  for chat/feed persistence.
