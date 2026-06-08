# App-Task Reliability Architecture

> How a user's "do something in another app / the browser / my files" request
> flows from chat to a *verified* result. Single source of truth for the
> route → contract → loop → resume → verify pipeline. For Claude, OpenSwan,
> Codex, Gemini, and any agent extending this system.
> Last reviewed: 2026-06-08.

## Why this exists

App/browser/desktop tasks are the failure-prone end of the product: the model
must operate a surface it can't see perfectly, recover from missed clicks, and
prove it actually did the thing. This pipeline makes that reliable without a
human babysitting each step. Every stage below is a **pure, smoke-tested module**
wired into the live runtime — so the logic is verifiable in plain Node even
though the runtime itself pulls react-native/supabase.

## The pipeline at a glance

```
user message
   │
   ▼
[1] ROUTE      classify surface + build the hidden best-path route
   │           computerTaskPlanner → chatComputerRequestRouter
   ▼
[2] CONTRACT   attach observe/approve/proof requirements to the prompt
   │           computerTaskEvidenceContract (carried on the route)
   ▼
[3] LOOP       execute tools with 9 reinforcing reliability layers
   │           swanbot.executeToolUseLoop (desktop + browser)
   ▼
[4] RESUME     if cut off at the step cap, the next turn auto-continues
   │           toolLoopResume ← openswanSessionRuntime
   ▼
[5] VERIFY     post-execution proof of code work, concurrent + fail-closed
               openswanVerificationRuntime
```

The hardened **loop (3)** applies to *every* turn. The **contract (2)** only
attaches when the **route (1)** classifies the request as a computer task — so
routing recall directly controls how much task-specific guidance the loop gets.

---

## [1] Route — `computerTaskPlanner.ts` + `chatComputerRequestRouter.ts`

`buildChatComputerRequestRoute(message)` returns a `ChatComputerRequestRoute`
(or `null` for plain chat). It classifies the surface (`desktop_app | browser |
local_file | hybrid | agent_buildout`), picks a pipeline + app/browser strategy,
computes risk/approval, a surface order, recommended tools, and the evidence
contract. `buildChatComputerRequestRoutePromptBlock(message)` renders it into the
prompt; it is one block in the `prompt` array that becomes the `userMessage` of
`executeToolUseLoop` (see `openswanSessionRuntime.ts`).

**Classification is the reliability chokepoint.** `explicitComputerSurfaceRequested`
gates the route; the surface signals come from `planComputerTaskPreview`
(`computerTaskPlanner.ts`). Recall gaps = tasks that silently run as plain chat
and lose the contract.

Signals (any one routes):
- `operativeKnownAppReference` — operative prefix (in/with/using/open/use/…) +
  a **curated, word-boundary, multi-word** app name. Catches "in PowerPoint",
  "using DaVinci Resolve", "with GIMP" with no "app" suffix or whitelisted verb.
- `explicitAppName && appControlVerb` — a named app + an action verb.
- browser matchers — a nav verb + a website noun, *or a nav verb + a known-web-TLD
  domain* ("go to example.com"), scrape/from-domain, form-fill.
- file matchers — file/folder/path/extension cues.
- design pipeline / browserbase workflow / unfamiliar-app control.

**Precision rules (do not regress these):**
- App-name lists used behind a verb-free path must be **word-boundary anchored**;
  ambiguous common-word names (`word`, `mail`, `notes`, `pages`, `logic`,
  `terminal`) are omitted or vendor-qualified (`microsoft word`). Otherwise
  "save your words" / "in the mail" / "use logic" false-route.
- Domain patterns use a **curated web-TLD list** (not `\.[a-z]{2,}`) so file
  extensions and `node.js` don't match.
- `isPlainBuildDiscoveryRequest` suppresses "build me a page" chit-chat; its
  rescue-verb set must include browser-op verbs (book/reserve/navigate/…) chosen
  to **not substring-collide** with build nouns ("booking page", "navigation
  menu" must stay suppressed).

Smokes: `chat-computer-request-router` (recall + precision cases),
`chat-planner`, `computer-task-complexity`.

## [2] Contract — `computerTaskEvidenceContract.ts`

`buildComputerTaskEvidenceContract(route)` produces a `ComputerTaskEvidenceContract`:
`observeBefore`, `actionabilityChecks`, `approvalBefore`, `mutationGuardrails`,
`proofAfter`, `failClosedRules`, `freshEvidenceRequired`, `sourceRefs`. The route
builder sets `route.evidenceContract`, and
`formatComputerTaskEvidenceContractPromptBlock` folds it into the route prompt
block — so the contract's observe/approve/proof requirements reach the loop's
prompt. `computerTaskEvidenceRecovery.ts` owns failure-time diagnosis (fresh-evidence
retry / user-unblock / adapter repair / stop-report).

The contract is **guidance** (strings in the prompt). Stage [3] layer (9) is its
**executable** counterpart at the loop level.

Smokes: `computer-task-evidence-contract`, `computer-task-evidence-recovery`.

## [3] Loop — `swanbot.ts:executeToolUseLoop` (nine reinforcing layers)

The model emits `tool_use` blocks; the loop dispatches them client-side and feeds
results back until a final answer or the step cap. Each layer is a pure helper;
none is route-dependent (the loop is always hardened). Most augment `tool_result`
content or the round's feedback.

| # | Layer | Module | What it does |
|---|---|---|---|
| 1 | Observe→act→verify gate | `appActionVerificationGate` | mutating app action → reminder to re-observe/verify (not assume the click worked) |
| 2 | Progress + resume checkpoint | `toolLoopProgress` | at the step cap, emit ✓/✗ progress + a machine-readable `ToolLoopCheckpoint` (no silent truncation) |
| 3 | Parallel read-only rounds | `toolBatchParallelism` | dispatch an all-read-only/auto round concurrently; any mutation/approval keeps it sequential (ordering preserved) |
| 4 | Transient edge retry | `edgeInvokeRetry` | bounded retry of the per-round edge invoke on 5xx/429/network/empty; deterministic errors fail fast; the invoke is idempotent |
| 5 | Fail-safe finalization | `swanbot.ts` | cap hit on a pure tool_use round → one no-tools finalization call to summarize from gathered context |
| 6 | Stuck-loop guard + named ladder | `toolLoopStuckBreaker` + `appSurfaceLadder` | a repeated identical *failing* call → nudge naming the concrete next surface (desktop: semantic→menu→shortcut→coordinate; browser: keyboard + DOM re-read) |
| 7 | Step-budget nudge | `toolLoopBudget` | in the final rounds, "converge now, ~N steps left" so the model finishes before truncation |
| 8 | Deterministic auto re-observe | `deterministicReobserve` | a failed UI action auto-captures fresh ground truth (desktop `read_a11y_tree` / browser `dom_snapshot`) embedded in the result — read-only, non-review mode |
| 9 | Completion proof-check | `proofCoverage` | a turn that mutated an app but captured no proof can't declare "done" — one bounded round to capture proof, then it terminates regardless |

Layers 8–9 **do not auto-execute the next action surface**: that surface needs
input the loop can't synthesize (menu path / coordinates / shortcut), so the
model chooses it with the observation in hand + layer 6's hint.

Smokes: `app-action-verification-gate`, `tool-loop-progress`,
`tool-batch-parallelism`, `edge-invoke-retry`, `tool-loop-stuck-breaker`,
`tool-loop-budget`, `app-surface-ladder`, `deterministic-reobserve`,
`proof-coverage`.

## [4] Resume — `toolLoopResume.ts` (in `runOpenSwanSessionTurn`)

When a turn hits the cap, layer (2)'s checkpoint is persisted to the transcript.
On the next turn, `findPendingResumeCheckpoint(transcript.events)` returns it iff
the *immediately-preceding* turn ended at the cap (turns delimited by the
once-per-turn `assistant_response` event, so a task finished by a later clean turn
is never re-resumed). `buildResumeContextBlock` appends a compact resume block
(completed steps, last observation, failed step to retry, hint) to the system
prompt, and defers to the user's new message if they moved on. Produce→persist→
**consume** is now closed.

Smoke: `tool-loop-resume`.

## [5] Verify — `openswanVerificationRuntime.ts` + `openswanVerificationResult.ts`

`executeOpenSwanVerificationPlan` runs the task plan's code checks
(typecheck/tests/lint) **concurrently** (independent read-only commands → wait is
max not sum; results stay in plan order) and **fail-closed**: a dispatch that
throws becomes a `blocked` result (`buildBlockedVerificationResult`) instead of
rejecting the whole batch. Non-code checks (review/preview) are correctly
`manual` — they're judgment, not commands. Computer-task proof lives in the
evidence contract (stage 2/loop-layer 9), not here.

Smoke: `openswan-verification-runtime`.

---

## Cross-surface parity (desktop + browser)

| Concern | Desktop | Browser |
|---|---|---|
| Re-observe read (layer 8) | `read_a11y_tree` | `dom_snapshot` |
| Surface ladder (layer 6) | semantic → menu → shortcut → coordinate | keyboard nav + DOM re-read (no coordinate click exists) |
| Proof tools (layer 9) | a11y read / inventory / document status / export / `file_stat` | `dom_snapshot` / `verification_state` / `screenshot` |
| Mutation/observation classifiers | `isAppMutatingTool` / `isObservationTool` (shared, cover both surfaces) |

## Invariants & extension rules

- **Pure logic in dependency-light modules.** New loop/route logic goes in a
  module with only `import type` heavy deps, so it's smoke-testable in plain Node
  (tsx/esbuild can't load react-native). The heavy runtime imports *that*. See
  `openswanVerificationResult` (split from the runtime for exactly this).
- **Reuse the shared classifiers** — `isAppMutatingTool`, `isObservationTool`,
  `isFailedStatus` — so "mutating" / "observation" / "failure" mean one thing.
- **Augment `tool_result` content, don't reorder dispatch.** Layers 1/6/8/9 add
  guidance to results; they never change observe→act→verify ordering.
- **Precision before recall in routing.** A missed app task still gets the
  hardened loop + grounding; a false-positive routes plain chat into computer
  mode (worse). New app/verb/domain matchers must be word-boundary + curated, and
  proven against precision controls in the router smoke.
- **Every new helper ships with a `smoke:<name>` script** and is verified with
  `npm run typecheck:app` + the full smoke sweep.

## Validated non-gaps (deliberately NOT built)

- **v2 edge-loop hardening** — desktop/browser tools are `clientOnly` and run
  client-side through the hardened v1 path (`executeClientToolCalls`); the v2 edge
  loop only runs server-only tools. Low value, high complexity.
- **Auto-execute the next action surface** — the next surface's input can't be
  synthesized; guessing it is more failure-prone. The loop guarantees the
  *observation*; the model picks the action.
- **Fully typed per-task completion predicates** ("a11y value == X") — overlaps
  the evidence contract; the contract states these as guidance and the model
  verifies them, which proof-coverage (layer 9) enforces structurally.
- **Context compaction / read dedup in the loop** — breaks prompt caching /
  observe-act-verify respectively.

## Smokes index (run the narrow one for what you touch)

```
# route + contract
smoke:chat-computer-request-router  smoke:chat-planner
smoke:computer-task-complexity      smoke:computer-task-evidence-contract
smoke:computer-task-evidence-recovery
# loop (9 layers)
smoke:app-action-verification-gate  smoke:tool-loop-progress
smoke:tool-batch-parallelism        smoke:edge-invoke-retry
smoke:tool-loop-stuck-breaker       smoke:tool-loop-budget
smoke:app-surface-ladder            smoke:deterministic-reobserve
smoke:proof-coverage
# resume + verify
smoke:tool-loop-resume              smoke:openswan-verification-runtime
```

See `docs/UC_OPENCLAW_REVIEW_AND_APP_TASK_IMPROVEMENTS.md` for the dated build
log and the OpenClaw comparison that motivated this work.
