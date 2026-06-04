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
8. **No intra-step tool parallelism** — independent reads serialize.

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
  the failed step instead of re-deriving. Smoke: `tool-loop-progress`. Remaining
  (optional): have the continuation turn *auto-consume* the checkpoint rather
  than the model re-reading it from the transcript.
- **Deterministic retry-with-fallback executor** (weak spot #4): on a failed
  semantic action, auto-try the next surface (menu/shortcut) once with a fresh
  observation before handing back to the model.
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
