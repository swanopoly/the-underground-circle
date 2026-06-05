# OpenClaw Review & SwanBot/OpenSwan App-Task Improvements

> Research + competitive analysis. Produced 2026-06-04 to answer: "review
> OpenClaw extensively and make SwanBot/OpenSwan better at app tasks and
> automations." Findings are evidence-anchored against the current codebase so
> we build the *real* gaps, not redundant scaffolding.

## 1. What OpenClaw is

OpenClaw (by Peter Steinberger; formerly **Clawdbot** / **Moltbot**, launched
late 2025, one of the fastest-growing OSS repos in GitHub history by Jan 2026)
is a **complete, self-hostable autonomous-agent runtime** — not a library. It
connects an LLM to the OS, files, messaging apps, and the web, and **does the
task** rather than describing it. Core architecture relevant to us:

- **Skills system (`SKILL.md`)** — capabilities are plugins: a directory with a
  `SKILL.md` (YAML frontmatter `name`/`description`/`tags` + markdown body) that
  tells the LLM *what the skill does and when to call it*. A public marketplace
  ("ClawHub") hosts thousands (Gmail, Calendar, Playwright browser automation,
  deployment, monitoring…). Progressive disclosure: metadata first, body on demand.
- **Heartbeat scheduler** — wakes the agent on an interval so it runs unprompted.
- **Multi-agent architecture** — spin up specialized agents (research, support,
  data-entry) each with **isolated memory + distinct tool access**.
- **Built-in browser tool** — controls a local Chromium by default, or a remote
  CDP profile; part of a single workflow ("browse → extract → write to a sheet →
  message Slack → schedule a follow-up").
- **Multi-channel gateway** — driven from WhatsApp/Telegram/Discord (20+ channels).
- Permissive MIT license; you own data/models but also own security/uptime/cost.

## 2. UC already matches most of OpenClaw's architecture

A feature-by-feature pass shows The Underground Circle is **not behind** OpenClaw
on architecture — in several areas it is more disciplined (approval gates,
evidence contracts, untrusted-content fencing). What it lacks is **runtime
enforcement** of reliable multi-step execution, not missing subsystems.

| OpenClaw capability | UC equivalent (status) |
|---|---|
| Skills (`SKILL.md`) + marketplace + progressive disclosure | `skillLibrary.ts` (agentskills.io `SKILL.md`, `circle_skills`), `viewLibrarySkill` tool, marketplace groups. **Matched.** Relevance-ranked injection already exists: `openswanSkills.ts:formatLibrarySkillsBlock` ranks by tag/name/description overlap + success-rate, top 20. |
| Heartbeat / unprompted runs | Cron + autonomous AI with the `AUTONOMOUS_AI_PAUSED` kill switch. **Matched.** |
| Multi-agent, isolated memory + distinct tools | Connected/terminal agents (Codex/Claude Code/Gemini/Cursor), subagent delegation, git-worktree isolation, per-agent memory. **Matched.** |
| Built-in browser (local Chromium / remote CDP) | Browser bridge + Browserbase + Stagehand; `browser.*` semantic tools (role/label locators), CDP/Playwright research refs. **Matched.** |
| Plug-in tool use | ~80-tool catalog (`openswanToolRuntime.ts`) across desktop/browser/files/rooms/tasks/approvals + `agent.build_app_capability`. **Matched.** |
| App control on any app | `genericAppNavigator` (observe→find→act→verify), `appAdapterGapContract` (universal find-ladder + research-first buildout), `computerAppGrounding` per-surface runbooks. **Matched / arguably ahead.** |
| Multi-channel messaging gateway | UC is chat-app-centric, not a WhatsApp/Telegram gateway. **Not matched — out of scope** (different product shape). |

**Conclusion:** the high-leverage work for "better at app tasks" is **not** new
subsystems — it's making the *observe→act→verify* discipline that the grounding
already describes actually **binding inside the tool loop**, plus tightening
the multi-step reliability weak spots below.

## 3. SwanBot/OpenSwan app-task weak spots (anchored)

Mapped from the current loop. The top two are the OpenClaw "actually does things
reliably" gap: guidance exists, enforcement doesn't.

1. **Observe-after-mutate was advised, not enforced.** `swanbot.ts:executeToolUseLoop`
   (~2665) fed tool results straight back; nothing made the model re-observe
   after a click/type, so multi-step app tasks assume success and drift.
   → **FIXED 2026-06-04** (see §4).
2. **One-time observe-before-act block, not per-step.** `computerTaskRuntime.ts`
   injects the observe block once at task start; long sequences lose ground truth.
   (Partly mitigated by §4's per-mutation gate; full fix is loop-level.)
3. **Iteration cap truncates multi-step tasks without resumable checkpoint.**
   `swanbot-v2-ai/index.ts` `MAX_ITERATIONS=5`; `executeToolUseLoop` `MAX_TOOL_ROUNDS`;
   OpenSwan per-mode round budget (execute 5 / build 4 / …). On exhaustion it
   returns `incomplete:true` with an actionable "tell me to continue" message,
   but does **not** emit a structured progress checkpoint (steps done / next /
   observations) for clean auto-resume.
4. **Tool-error retry is model-discretion, not a deterministic ladder.**
   `dispatchToolDetailed` wraps failures as error results; the model decides
   whether/how to retry. (§4 now nudges the surface ladder on failure.)
5. **Completion detection relies on model judgment.** No structured success
   predicate per task; `computerAppGrounding` has generic verificationSignals.
   (§4 now nudges "stop + report proof when the completion signal is observed.")
6. **Capability buildout round-trips serially** (`computerTaskRuntime.ts`) rather
   than degrading to UI-fallback while the adapter builds.
7. **Browser DOM snapshot caps node count** — deep SPAs spill to screenshot+coords.
8. **No intra-step tool parallelism** — independent reads serialize. **ADDRESSED
   2026-06-05:** `executeToolUseLoop` now pre-dispatches a round concurrently when
   it's entirely read-only/auto with no approval gate (`canParallelizeToolBatch`
   over each tool's `getToolParallelPolicy`), preserving result order. Any
   mutation / side effect / approval / gate keeps the round sequential so
   observe→act→verify ordering is never reordered. Latency win for gather/research
   rounds. Smoke: `tool-batch-parallelism`.

## 4. Shipped this round — observe→act→VERIFY enforcement gate

`src/lib/appActionVerificationGate.ts` (new) + wired into **both client tool
loops**: `swanbot.ts:executeToolUseLoop` (v1) and `executeClientToolCalls` (the
v2 client-delegated path — where desktop/browser tools actually run, since they
are `clientOnly` and the edge loop returns them pending for the client to
execute). Every **state-mutating** app/desktop/browser
tool result (`click_element`, `set_element_value`, `menu_click`, `type_text`,
`press_keys`, `click_at`, mouse ops, `launch_app`, `open_url`, `click_role`,
`fill_field`, `fill_credential_field`, `press_key`) now gets an `[observe-act-verify]`
reminder appended to the tool_result the model is already reading:

- **success →** re-observe (`read_a11y_tree`/`screenshot` or `dom_snapshot`),
  confirm the expected change actually happened (do not assume success), and
  stop + report proof when the completion signal is observed.
- **failure →** re-observe, then climb the surface ladder (semantic → menu →
  shortcut → one bounded coordinate step); never repeat the same failed action;
  after two failed fresh observations, stop/report or request a buildout.

Read/observation tools (`read_a11y_tree`, `screenshot`, `window_state`,
`dom_snapshot`, `file_stat`…) and non-app tools (`research.*`, `tasks.*`…) pass
through unchanged; blocked/skipped statuses get no nudge. Pure + smoke-tested
(`smoke:app-action-verification-gate`); typecheck 0; swanbot/openswan/computer
suites green. **Why this and not a new grounding block:** `computerAppGrounding`
already *advises* re-observation — prompt advice is skippable; a reminder on the
tool_result is not. This converts advice → in-loop nudge without changing control
flow (additive, low-risk).

**Operationalized as a skill (2026-06-04):** `skills/app-task-automation/SKILL.md`
(new canonical-skills home, OpenClaw's pillar applied) packages this whole
pipeline as a reusable `SKILL.md` the agent fetches via `viewLibrarySkill` —
observe→find→act→verify, the universal find-ladder, research-when-unfamiliar,
connected-agent buildout on capability gaps, and proof-based completion +
step-cap checkpoint. A small canonical-skills library now sits in `skills/` (`app-task-automation`,
`browser-form-submission`, `design-app-export`, `file-organization` — covering
the desktop/any-app, browser, design, and local-file surfaces), each
exercising a different surface of the pipeline and all validated by
`smoke:canonical-skills` (parsed with the real `parseSkillFrontmatter`; required
sections, real tool references, per-skill probes, no path/secret leaks).
Seedable into a circle's `circle_skills` via `skillLibraryWrite.ts`.

**Tool-loop hardening summary (2026-06-05):** `executeToolUseLoop` now carries eight
reinforcing layers, all `src/lib` + smoke-verified: (1) observe→act→verify gate on
mutating actions; (2) progress summary + machine-readable resume checkpoint on the
step cap; (3) **parallel dispatch of all-read-only rounds** (`toolBatchParallelism`);
(4) **bounded transient retry of the per-round edge invoke** (`edgeInvokeRetry`) —
the call is idempotent (tools run client-side after), so a cold-start/network blip
retries instead of aborting a multi-step task; deterministic 4xx/clean errors fail
fast, and the abort path is now flagged `incomplete` (resumable) rather than a
dead-end; (5) **fail-safe finalization at the step cap** — when the cap is hit on a
pure tool_use round, the final round's results were pushed to history but never
consumed by any turn, so the model never got to answer. The loop now makes one
no-tools finalization call to summarize from everything gathered (incl. that last
round) instead of a generic "I hit my limit" — any error falls back to the limit
note; (6) **stuck-loop guard** (`toolLoopStuckBreaker`) — a just-failed call whose
(name+input) signature repeats a prior failure this turn gets a tool_result reminder
that forbids the identical retry and lists the productive moves (re-observe / escalate
the ladder / change inputs / stop), so the model can't burn rounds on a deterministic
failure; the key-order-normalized signature means a changed input (a real fix) is not
flagged and a first-time failure still gets one legitimate retry; (7) **proactive
step-budget nudge** (`toolLoopBudget`) — in the final rounds the last tool_result
carries a "converge now, ~N steps left" reminder so the model finishes + answers
before truncation rather than relying only on (5)'s after-the-fact summary;
(8) **deterministic auto re-observe** (`deterministicReobserve`) — when a UI action
fails in non-review mode, the loop auto-captures fresh ground truth
(`desktop.read_a11y_tree`) and embeds a bounded summary in the failed action's
tool_result, so the retry is grounded in current state without spending a model
round to request the read. Read-only + best-effort (a missing bridge / failed read
adds nothing). Auto-*executing* the next action surface is intentionally not done —
the next surface needs input the loop can't synthesize (menu path / coordinates /
shortcut), so the model chooses it, now with the observation in hand plus (6)'s
named-ladder hint. Smokes: `tool-batch-parallelism`, `edge-invoke-retry`,
`tool-loop-progress`, `tool-loop-stuck-breaker`, `tool-loop-budget`,
`app-surface-ladder`, `deterministic-reobserve`.

**Verification-runtime hardening (2026-06-05):** `executeOpenSwanVerificationPlan`
(post-execution proof of code work) now runs its checks concurrently — independent
read-only typecheck/tests/lint, so the wait is max(check) not sum(check) and results
stay in plan order — and each check is **fail-closed**: a dispatch that throws
(edge/network/relay/empty) becomes a `blocked` result instead of rejecting the whole
batch and discarding the sibling checks that already passed. The pure result core
(result type, check→tool mapping, summary, blocked-result builder) was extracted to
`openswanVerificationResult` (no heavy deps) so it's smoke-testable in plain Node;
the runtime re-exports it so consumers are unchanged. Smoke: `openswan-verification-runtime`.

## 5. Recommended next (with the user's go-ahead — these touch the backend loop)

- ~~Mirror the verify gate into the v2 edge loop~~ — **revised after investigation
  (2026-06-04):** desktop/browser tools are `clientOnly`, so the v2 edge loop only
  runs server-only tools and the app-task execution happens client-side in
  `executeClientToolCalls` — which is **now gated**. Mirroring into the edge
  function (`swanbot-v2-ai/index.ts`) is low-value for app tasks (and that file is
  not covered by `npm run typecheck`/smoke), so it's skipped unless server-only
  tools grow. Both live model-loop app-task paths (v1 + v2 client) are gated.
- **Structured resume checkpoint on cap** (weak spot #3): **SHIPPED 2026-06-04.**
  `executeToolUseLoop` now (a) appends a human `summarizeToolLoopProgress` block
  (✓/✗ + reason — no silent truncation) and (b) returns a machine-readable
  `checkpoint: ToolLoopCheckpoint` (`src/lib/toolLoopProgress.ts`):
  `{schemaVersion, stepCount, maxRounds, completedSteps[], lastObservation
  (ground truth), lastFailure (to retry), resumeHint}`. `openswanSessionRuntime`
  persists it to the run transcript's "Tool-step limit reached" event (`data.checkpoint`),
  so a continuation turn / the UI can resume from the last observation + retry
  the failed step instead of re-deriving. Smoke: `tool-loop-progress`. **Auto-consume
  SHIPPED 2026-06-05** (`toolLoopResume`): `runOpenSwanSessionTurn` scans the
  transcript for a checkpoint left by the *immediately-preceding* turn
  (`findPendingResumeCheckpoint`, delimited by the once-per-turn `assistant_response`
  event, so a task already finished by a later clean turn is never re-resumed) and,
  when present, appends a compact resume block to the system prompt
  (`buildResumeContextBlock` — completed-step count, last confirmed observation,
  failed step to retry, resume hint). It defers to the user's new message if they've
  moved on. Smoke: `tool-loop-resume`.
- **Deterministic retry-with-fallback executor** (weak spot #4): **ADDRESSED
  2026-06-05** via deterministic auto re-observe (`deterministicReobserve`, layer
  (8) above). On a failed UI action in non-review mode, the loop auto-captures
  fresh ground truth (`desktop.read_a11y_tree`) and embeds a bounded summary in
  the failed action's tool_result, so the retry is grounded in current state
  without a model round-trip for the read. Auto-*executing* the next action
  surface itself is intentionally not done — that surface needs input the loop
  can't synthesize (menu path / coordinates / shortcut), so the model chooses it,
  now with the observation in hand plus the §4 named-ladder stuck-breaker. The
  surface mapping (`appSurfaceLadder`) is the reusable core if a future safe,
  input-aware auto-executor is ever warranted.
- **Completion predicate** (weak spot #5): derive a verifiable success signal per
  task (file_stat exists / a11y value == X / count delta) the loop checks before
  declaring done — turning "model thinks it's done" into "the predicate holds."

## Sources

- [What Is OpenClaw? — Milvus](https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md)
- [What is OpenClaw? (2026) — emergent.sh](https://emergent.sh/learn/what-is-openclaw)
- [What Is OpenClaw? — MindStudio](https://www.mindstudio.ai/blog/what-is-openclaw-ai-agent)
- [What is OpenClaw? — DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-openclaw)
- [The Complete OpenClaw Guide (production) — Context Studios](https://www.contextstudios.ai/blog/the-complete-openclaw-guide-how-we-run-an-ai-agent-in-production-2026)
- [OpenClaw — Browser Use docs](https://docs.browser-use.com/cloud/tutorials/integrations/openclaw)
- [OpenClaw vs Claude Code (2026) — Eigent](https://www.eigent.ai/blog/openclaw-vs-claude-code)
