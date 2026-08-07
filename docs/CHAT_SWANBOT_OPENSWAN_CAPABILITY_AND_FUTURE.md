# Chat / SwanBot / OpenSwan — Capability State & Future

> A grounded "state of the build + where it's headed" for the three agent
> surfaces (Chat, SwanBot, OpenSwan) and the shared substrate underneath them.
> Synthesized 2026-07-13 from a read-only sweep of the codebase (571 `src/lib`
> modules, 47 edge functions, ~30 planning docs) plus a frontier scan of the
> mid-2026 agent field.
> Runtime reconciliation updated 2026-08-06 for guarded browser fill/toggle/
> native-select, bounded browser wait/scroll, read-only locator-actionability
> evidence, native activation and narrow semantic-press proof, SwanBot
> continuation receipts, the durable action-call ledger, Chat computer context
> packs, provider-aware app-capability recovery, and bounded dispatch/proof
> persistence.
>
> **Reading rules.** Every capability is tagged **SHIPPED** (live in code, cite
> file/commit), **IN-FLIGHT** (built + smoke-tested but flag-gated / awaiting a
> live signal), or **PLANNED** (designed in a doc, not yet built). Frontier
> claims after the Jan-2026 knowledge cutoff are marked **[UNVERIFIED]**.
> Canonical ownership still lives in `docs/AGENTS_ROADMAP.md`; this file is the
> capability map, not the ownership registry.

---

## 0. The through-line

The product is a **team AI-agent accountability workspace that also drives your
apps and writes your code**. Three surfaces, one substrate:

- **Chat** — the human-facing surface: plan, converse, approve, watch proof.
- **SwanBot** — the response brand: turns a message into a typed tool loop.
- **OpenSwan** — the runtime: the 180+-tool typed agent loop + reliability layers
  + delegation that actually does the work.

Under all three sits a shared substrate — **memory, skills, approvals/HITL, run
persistence, model routing, cross-dashboard resource discovery, and multi-agent
file coordination**. The strategic bet (validated by the frontier scan in §8) is
that the durable moats are **coordination, governance, verified-loop
reliability, and the write/spend approval boundary** — *not* raw model IQ, which
is commoditizing. We build the harness; we let the model vendors race on IQ.

---

## 1. Architecture at a glance

```
          ┌─────────────────────────── CHAT (ChatTab.tsx) ───────────────────────────┐
          │  model picker · streaming · artifacts · threads · checkpoints · commands  │
          │  planner (3 tiers: plain_model / escalate_tools / spawn_agents)           │
          └───────────────┬───────────────────────────────────────────┬──────────────┘
                          │                                           │
              chatAutomationPlanner                        chatComputerRequestRouter
              runChatAutomationPlan                        (route→contract→loop→verify)
                          │                                           │
          ┌───────────────▼───────────── SWANBOT (swanbot.ts) ───────▼──────────────┐
          │  v1 (swanbot-ai, legacy relay+loop, fallback)                            │
          │  v2 (swanbot-v2-ai, TYPED loop, DEFAULT-ON, client-delegated protocol)   │
          └───────────────────────────────┬──────────────────────────────────────────┘
                                          │
          ┌───────────────── OPENSWAN RUNTIME (agentExecutionCore) ──────────────────┐
          │  typed tool loop · 9 reliability layers · 180+ tool catalog              │
          │  delegation gate (depth/concurrency/spend) · mass agent deploy           │
          └───────────────────────────────┬──────────────────────────────────────────┘
                                          │
          ┌──────────────────────────── SUBSTRATE ───────────────────────────────────┐
          │ memory · skills · approvals/HITL · run persistence · model routing        │
          │ BlackSwan flywheel · connected-resource discovery · file coordination     │
          │ Office observability                                                      │
          └───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chat surface

**SHIPPED**

- **3-tier orchestration** — `aiFirstChatPolicy.ts` routes each turn to
  `plain_model` / `escalate_tools` / `spawn_agents`. Default-ON.
- **Planner + intent routing** — `chatAutomationPlanner.ts` (9 intent classes),
  `runChatAutomationPlan.ts`, `conversationalRouter.ts`; classify-once per turn.
- **Unified prompt assembly** — `chatPromptAssembly.ts`: a 31-key canonical
  section registry with complexity-tier adaptive loading and a cache-safe
  volatile-content boundary; all lanes (stream/batch/v2) are config over one seam.
- **Computer/app request routing** — `chatComputerRequestRouter.ts` +
  `chatComputerRequestUx.ts`: the hidden best-path (preview, pipeline, approvals,
  fallbacks, proof) stays quiet; user sees only approval/proof/blockers.
- **Portable computer-task context** — `chatAgentContextPack.ts` builds one
  bounded immutable goal/guardrail/proof contract. The real app/file/hybrid
  handler and both capability-retry paths pass it into `AgentRunRequest`, where
  `agentRuntime` injects the compact prompt and saves a bounded run projection.
- **Provider-aware unfamiliar-app recovery** — durable buildout state retains
  its provider and delayed polling consumes strict dedicated result receipts
  from Codex or Claude Code. Gemini/Cursor remain general delegation targets
  but fail explicitly in this auto-retry lane until their bridges expose the
  equivalent bounded receipt instead of leaving work indefinitely pending.
  Claude's distinct transcript id attaches to its managed id only through one
  anchored, unambiguous UC launcher marker.
- **UX** — streaming bubbles, model picker (Auto tier), 8 artifact kinds
  (text/link/file/diff/image/code/webpage/table), thread lineage
  (`↳ CONTINUES`), checkpoints + restore (`chatCheckpoints.ts`), attention queue
  (Needs-You strip), memory attribution row, inline findings card (option-N
  follow-ups), proof receipts.
- **Commands** — `/plan`, `/review` (PR review w/ severity), `/create`,
  `/watch` (recurring), `/best-of-n` (race + judge), `/integrations`,
  `/build-page`, `/imagine`, `/apps`, `/screen`, `/lanes` (per-lane health),
  `/gh`, `/task`, `/mission`, `/v2`.
- **Integrations** — AI-composed API calls (`integrationActionComposer.ts`),
  preset catalog (GitHub/Linear/Jira/…), health registry, action receipts,
  approval idempotency, messaging.notify.
- **Reliability** — lane terminal telemetry (`/lanes`), unified lane error
  boundary, SSE mid-stream recovery, 50-prompt route golden canaries, provider
  health pre-selection, session-state persistence. Typed run persistence keeps
  dispatched/skipped/legacy-unknown truth and only bounded receipt allowlists.
  Guarded browser fill, safe-preference toggle/native-select, and narrow native
  semantic-press lanes emit mutation-dispatch and app-verification receipts.
  Other mutation families still need the same producer contract.

**IN-FLIGHT** (built, flag-dark, awaiting a live signal)

- **Deferred tool loading** (`anthropicNativeToolSearch.ts`) — native
  `tool_search` + `defer_loading`; payload verified, awaiting a live cache-ratio
  run (est. −85% tokens/100-turn).
- **Context-management passthrough** (`anthropicContextManagement.ts`) —
  `clear_tool_uses` beta; −84% tokens measured, awaiting cost/behavior decision.
- **Execute→verify** (`outcomeVerifier.ts`) — fresh-context grading of a mutation
  against the evidence contract; awaiting accuracy measurement.
- **Terminal-chat cutover** — route the terminal send path through the planner
  (needs a `ChatTab` structural refactor).

**Highest-leverage chat futures:** workspace indexing + `@file` precise context;
Plan Mode as a first-class editable object ("Build from Plan"); per-tool approval
governance (scope × rate × require-review).

---

## 3. SwanBot (v1 → v2 typed loop)

**SHIPPED**

- **v2 is DEFAULT-ON** (since 2026-07-07) — `swanbot-v2-ai/index.ts`: a typed
  `runLoop()` over `ToolDef[]`, prompt caching, `agent_runs`/`agent_run_events`
  telemetry, normalized `final_stop_reason` vocabulary.
- **Client-delegated tool protocol** (M2) — edge emits
  `{ pending, clientToolCalls, continuationRunId, continuationIdentity,
  continuationVersion, continuationNonce }`. Before any local handler enters,
  the client-generated dispatch claim compare-and-sets `pending` /
  `client_pending` to `dispatch_claimed` / `client_dispatching`; only the exact
  echoed claim may execute. Submitting its complete validated results then
  persists them and compare-and-sets to `results_claimed` /
  `client_resuming` before model resume. Only an exact same-claim dispatch retry
  carrying the winning claim is idempotently acknowledged. Competing, mixed-version/state,
  ambiguous, expired, or lost claim-bound paths seal `outcome_unknown` and
  never replay local actions or model resume. Mixed batches run server tools
  first and merge client results in tool-use order. Readiness ignores all three
  active stop-reason rows: `client_pending`, `client_dispatching`, and
  `client_resuming`.
- **Continuation checkpoint privacy (source-shipped 2026-07-26)** — the exact
  resumable transcript/system/tool snapshot is AES-256-GCM sealed under the
  dedicated `SWANBOT_CONTINUATION_ENCRYPTION_SECRET`, with the authenticated
  rotation label supplied by
  `SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION`. Circle-visible
  `agent_runs.metadata.continuation` contains only a bounded
  identity/state/claim envelope, pending `{id,name}` pairs, ten-minute expiry,
  and the versioned IV/ciphertext envelope; raw messages, arguments, results,
  system blocks, and model state are not beside the ciphertext. Public run
  events keep value-free structural argument summaries and fixed redacted
  errors. If the key is unavailable, fresh turns withhold every `clientOnly`
  tool and cannot create dispatchable local work.
- **Edge-side write replay barrier (source-shipped 2026-07-26)** — the v2 edge
  inserts one client-generated per-turn UUID as `agent_runs.id` and transport
  retries reuse it, so a duplicate attempt collides before model/tool work.
  Legacy/no-identity starts have server writers withheld. The edge then latches
  before server-side memory/task/mission/message/room/approval handler entry.
  If a subsequent provider/runtime failure makes completion ambiguous, it
  persists a value-free `server_mutation_outcome_unknown` marker with
  `replayAllowed: false` and requires fresh verification. The client recovers
  that structured non-2xx body and stops before v1 fallback, rather than
  repeating the user turn under a new run/tool-use identity.
- **Default-edge authorization parity** — the ordinary edge-continuation path,
  not only the flag-dark typed client loop, unions constraints parsed from the
  raw user turn with richer upstream constraints and the always-confirm floor.
  It runs that hard policy before the client handler, then invokes the live
  exact-call approval callback when supplied. Policy exceptions and approval
  rejection fail closed; an active approval surface forces sequential
  per-call dispatch so prompts cannot race or be reviewed out of order.
- **84-tool source-executable subset** — 25 server-side (memory/tasks/missions/rooms/
  messages/approvals/rewards/github/fetch) + 59 client-delegated across desktop,
  browser, workspace, WordPress, credentials, and coding-agent families.
  bounded semantic `browser.wait_for` / `browser.scroll`,
  `browser.select_option`, read-only `browser.locator_actionability`, and the
  exact `desktop.click_element` semantic-press schema are included in that same
  84/59 catalog, with edge/OpenSwan schema and dispatcher parity guarded by
  focused smokes. The 84/59 count is derived from current source; it does not
  prove that the deployed edge contains the same bytes. Locator actionability
  is bounded advisory evidence for one
  fresh exact target; it does not authorize or bind a later mutation. The edge-facing
  `browser.fill_field` schema is narrowed to the sealed draft contract:
  textbox/searchbox only, bounded text/context/locator fields, name XOR
  selector at the edge schema, app normalizer/runtime, client request, and
  bridge target/perform layers, bounded timeout, no submit, and no additional
  properties. Both-present and neither-present locator inputs fail before
  observation or dispatch. Every
  currently client-delegated browser/desktop mutation—navigation, fill/
  protected fill, toggle/select, click/key, app activation, text/key/menu/
  script/path, coordinate/pointer, and semantic/value actions—enters the
  canonical OpenSwan runtime before any generic bridge fallback. The raw
  dispatchers still fail closed for the sealed semantic press, so that exact
  lane cannot bypass fresh observation, approval, grounding, durable identity,
  or proof.
- **Reliability** — mid-stream interruption handling (never auto-retry
  mid-stream), transient continuation retry with full-jitter backoff, turn
  dedup (15 s TTL), session circuit breaker (2 consecutive transport failures →
  skip v2 for the session; `/v2 on` resets).
- **v1** (`swanbot-ai`) — legacy relay + hardcoded loop, retained as fallback.

**IN-FLIGHT**

- **M4 telemetry sign-off** — the readiness reader
  (`swanbotOpenSwanReadiness.ts` + report script) needs ≥50 terminal rows in
  each of the v1/v2 cohorts and v2's `end_turn` rate ≥ v1's before declaring M4
  done; rollback is a one-line flip or per-device `/v2 off`.
- **M5 v1 deletion** — after 30 days of M4 without rollback + ops sign-off.

**Futures:** SSE streaming on the v2 edge (v1 relay can stream; v2 returns a
single body); model-callable `approvals.request` + mid-turn resume; unify
subagents onto the same v2 `runLoop`/`ToolDef` contract (kills the separate
subagent circuit + a prompt-builder debt).

---

## 4. OpenSwan runtime + tool catalog

**SHIPPED**

- **Provider-agnostic typed loop** — `agentExecutionCore.ts` (`runAgent`): up to
  `maxIterations` rounds, tools never throw (errors wrap as `{ok:false}`),
  default 4 concurrent tools/round, 13 event kinds (incl. `solver_consultation`
  = one re-plan chance before a hard stop, `iteration_complete` = resumable
  checkpoint).
- **Nine reliability layers** (`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`),
  each smoke-tested: (1) observe→act→verify gate, (2) progress + checkpoint,
  (3) parallel read-only rounds, (4) transient edge retry, (5) fail-safe
  finalization, (6) stuck-loop guard + surface ladder, (7) step-budget nudge,
  (8) deterministic auto re-observe, (9) completion proof-check.
- **Exact per-call identity** — provider tool-use ids are bounded and unique for
  the complete typed run, including resumed history. One malformed or reused id
  blocks the whole requested round before transcript append/dispatch; every
  entered handler receives the exact tool name, id, and iteration with no
  fabricated fallback.
- **Evidence-bearing runtime approval** — run-scoped, consumed cross-run, and
  category-auto passes return a genuine receipt backed by a real
  `agent_run_approvals` row. Category auto records an exact `auto_approved` row
  first. Hidden telemetry replaces the canonical key/args with a digest and
  never places the receipt envelope in model-visible raw or formatted output.
- **180+ typed tool catalog** — the `OpenSwanRuntimeToolName` union in
  `openswanToolRuntime.ts`, spanning ~30 families: desktop automation (largest —
  file ops, mouse/keyboard, a11y tree, screenshot, Adobe/CAD adapters),
  rooms/missions/tasks/goals, vault, WordPress, Google Workspace, GitHub,
  messages, approvals, memory, skills, research, custom-API/integrations,
  coordination, codebase, todo, delegation. Per-tool policy: family, approval
  mode (auto/ask), mutation flag, surface list, and progressive disclosure
  (pinned vs deferred-via-`tools.search`).
- **Always-confirm floor** — every non-read browser/desktop mutation crosses
  the structural floor, not only calls whose names/arguments say
  pay/delete/login/grant. Bland or opaque keypresses and unknown/future
  mutations are gated too; no auto-approve waiver overrides it.
- **Delegation** — `delegationGate.ts` (depth ≤2, ≤3 concurrent/circle, optional
  daily spend cap, summary-only parent view); `multiAgentDispatch.ts`
  (parallel/roundtable/sequential/debate); mass deploy (`agentDeployPolicy.ts`:
  ≤50 agents, ≤$10, >10-agents-or->$10 needs approval, transient contract — no
  office row, only a child `agent_runs` row).

**Futures:** self-healing code agent (todo + codebase search + result
summarization + context compression already exist as pieces); offline
self-evolution once ≥50 skills + ≥1k runs accumulate; expand the sealed browser
fill/toggle/native-select lanes and narrow native semantic press into a
generalized computer gateway through stable a11y/DOM/app target identity and
machine-checked proof instead of pixels.

---

## 5. Coding agent (Claude-Code / Cursor-Composer class)

Plan: `docs/CODING_AGENT_UPGRADE_PLAN.md`. **Four phases are live, P2/P3 have
read-only diagnostic compatibility surfaces plus connected-agent delegation,
and one SQL migration remains pending.**

| Phase | What | Status |
|---|---|---|
| **P1** precise editor | `fileEditCore.ts` → `desktop.edit_file`, now lease+CAS-guarded | **SHIPPED + WIRED** |
| **P2** shell/diagnostics | `shellCommandPolicy.ts`; compatibility tool `local.run_shell` | **SECURITY-CONSTRAINED 2026-07-24** — local route is fixed read-only diagnostics only; full shell/build/test delegates to a connected coding agent |
| **P3** git | `gitCommandPolicy.ts`; compatibility tool `git.run` | **SECURITY-CONSTRAINED 2026-07-24** — local route is fixed read-only git diagnostics only; mutations delegate to a connected coding agent |
| **P4** codebase index / search / @mentions / conventions | `codebaseIndex*`, `codebaseSymbol*`, `codebaseMentions*`, `projectConventions.ts`; tools `codebase.index`/`codebase.search`; prompt sections wired | **SHIPPED + WIRED** — but `codebase_files` table (RUN_THIS_SQL §24) **PENDING PROD APPLY** |
| **P5** plan/execute model split | `codingModelSplitPolicy.ts` (strong planner → fast executor, fail-closed), `modelCapabilities.ts` coding tiers; auto best-of-N | **SHIPPED + WIRED** (`uc_coding_plan_split` default-ON) |
| **P6** loop upgrades | `agentTodoCore.ts` + `todo.write`; `toolResultSummaryCore.ts` (>20k head+tail+error); `runAndFixGateCore.ts` (≤2 nudges/run) | **SHIPPED + WIRED** |

**Critical path to full parity:** (1) apply P4 SQL §24; (2) keep the local
diagnostic endpoint narrow; (3) route build/test and repository mutation through
structured connected-agent runs with approvals, exact workspace scope, and
file coordination. The browser-facing bridge must never regain arbitrary shell
authority.

---

## 6. App automation ("pull the app up and do it for you")

Plans: `docs/AGENT_APP_AUTOMATION_IMPLEMENTATION_PLAN.md`,
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`.

**SHIPPED CAPABILITY SURFACES (source/live status called out per bullet):**

- **Photoshop + InDesign ExtendScript adapters** — real shipping tools via
  AppleScript `do javascript`, approval-gated, never auto-save, screenshot-verified.
- **Local CAD** — `cadCodeExecutor.ts` (OpenSCAD/FreeCAD/Blender) is LIVE.
- **Route→Contract→Loop→Verify pipeline** — fully operational on every computer
  task: `chatComputerRequestRouter` → `computerTaskEvidenceContract` →
  9-layer loop → `toolLoopResume` → `openswanVerificationRuntime`.
- **Desktop bridge substrate** — file ops, app launch/focus/reachability, a11y
  tree, screenshot, clipboard, AppleScript (`scripts/claude-bridge.js` +
  `desktopBridge.ts`).
- **Browser computer-use (source-hardened 2026-07-26; updated edge not yet
  re-deployed)** — the hosted `computer-use-agent` Browserbase/native Sonnet
  lane now validates a bounded schema-v1 execution policy before
  provider/session work. Authenticated Chat/queue starts require an interactive
  envelope; scheduled watch/service starts are forced observation-only, while
  authenticated legacy callers without a policy receive HTTP 400. All three
  root Chat starts—automatic browser launch, booking-session continuation, and
  manual approved launch—preserve router-derived user constraints plus
  opaque-target, credential, and external-side-effect confirmation floors.
  Single-task and queue hooks acquire synchronous start reservations before
  module/credential awaits and invalidate pending reservations on cancel/clear.
  Every left/right/double click, type, key, and saved-login call requires
  durable exact-call live confirmation because its coordinate/focus target is
  opaque, including when a pre-run grant exists. Approved calls require a
  fresh pre/post screenshots around one-attempt dispatch. Unknown native
  actions fail closed; an ambiguous attempted
  mutation returns `mutation_outcome_unknown` and is never auto-replayed.
  Secret-bearing actions are redacted or suppressed across SSE,
  progress/action traces, model history, replay, stuck-solver inputs, usage
  metadata, and errors.
  The separate legacy `computerUse.ts` planner/recording lane remains
  observation-only for local replay and hands every mutation to typed OpenSwan.
- **Root Chat app/attachment boundary (source-hardened 2026-07-26)** —
  `computerTaskRuntime` no longer calls `executeComputerAppTask`,
  `bridgeOpenPath`, or `bridgeWaitForApp` before authenticated
  `executeAgentRun`; only read-only live observation may run first. App/hybrid
  work reaches the typed agent loop. This removes the pre-agent app-adapter and
  attachment-open bypasses. Uploaded desktop files remain staged and produce a
  value-free, non-executable `desktop.open_path` handoff without raw path,
  identity, approval, receipt, or proof. Exact staged context stays in the
  authenticated task prompt and is redacted from result, capability-buildout,
  and action-trace telemetry.
- **Exact approval + unattended-dispatch authority (source-hardened
  2026-07-26)** — Chat binds the complete normalized plan plus
  user/circle/thread/room with SHA-256 and atomically consumes
  `agent_approvals.applied_at` before one transport dispatch. OpenSwan binds
  exact canonical arguments plus authenticated persisted-run/provider-call
  identity and atomically consumes one schema-v2 dispatch binding. SwanBot
  WordPress writes and the generic risk floor share the same digest-safe,
  one-use authority. Approval audit/model payloads retain only bounded labels
  and safe digests. Durable OpenSwan/subagent tool-call telemetry retains only
  bounded field/type/shape summaries; exact arguments remain in-memory for
  approval, dispatch, and proof. `event-bound-core` is required by readiness
  and both release gates.

  Legacy direct local-file, image-conversion, and diagnostic launch helpers
  return value-free, non-executable handoffs. Executable
  `desktop.open_path` requires a fresh exact stat plus path digests, exact
  identity/approval, a §26 claim/start, one bridge attempt, and fresh exact
  frontmost-app proof. Service/scheduled automation invocation stays
  read-only; manual automation writes and outbound custom API/messaging writes
  use exact approval plus the action ledger. Every scheduled external action
  gets fresh per-occurrence approval, one claim/dispatch, and no retry;
  post-dispatch ambiguity persists `outcome_unknown`, and Pending Actions shows
  a redacted verify-first roadblock without retry.

  Office Realtime messages are advisory wakeups. After client auth/shape
  checks, §28 `invoke_agent` locks the exact durable
  message/circle/expected-command row, verifies membership plus target
  ownership/scope, and returns canonical executable fields. Its
  message/agent-subject claim is idempotent (including synthetic `blackswan`);
  stream/completion writes are claimant-bound, membership/live-state checked,
  bounded, CAS-protected, and require multi-target coverage. Section 28 also
  validates and freezes protected schema-v2 Chat/OpenSwan approval payloads,
  server-stamps pending resolution, and restricts expiry/one-use consume to the
  requester without touching unrelated legacy/scheduled rows. These contracts
  and their ten focused guards are source/focused-smoke evidence only. §26 is
  applied and catalog-verified, but live contention/crash behavior remains
  unverified; §27/§28 are unapplied. Updated edges, live DB/cron/Realtime races,
  external provider execution, and GUI behavior also remain unverified.
- **Exact Photoshop and manual verification hardening (source-verified
  2026-08-06)** — each exact Photoshop request binds the originating Chat
  message/submission fingerprint and executable program into one authenticated
  root plus compiler-scoped §26 claim/start/finish lifecycle. Approval and
  capability re-entry preserve that identity; missing, legacy, or mismatched
  identity fails before root creation and desktop access. Same-request duplicate
  dispatch is blocked, while a new explicit submission intentionally gets a new
  request/root; live contention proof remains pending. Manual verification is
  requester-, task-, bridge-instance-, and target-bound, allowlisted and
  observation-only, rechecks scope after every
  await and before persistence, and never marks the task complete. Photoshop
  status inspects the active document without activating another document.
  These are source/focused-smoke claims, not live recovery or cross-device proof.
- **Human foreground ownership (planned kernel invariant)** — an explicitly
  requested lifecycle action may foreground its exact target once. A later user
  switch to Terminal, another app, or another browser tab interrupts the task;
  observation, approval, progress, and retry loops must pause/fail closed rather
  than repeatedly raising the target or Chat browser.
- **Sealed browser/native mutation canaries (source-verified)** — typed
  OpenSwan `browser.fill_field` normalizes one exact non-secret draft, observes
  opaque bridge-process/context/live-document/URL identity, and asks read-only
  `POST /browser/fill_target` to resolve exactly one field before approval. The
  edge schema, app normalizer/sealed runtime, browser client request builders,
  and bridge target/perform endpoints each require `name` XOR `selector`; both
  or neither fail before observation/dispatch. The
  bridge issues a short-lived single-use `targetId` backed by that ElementHandle
  plus an HMAC privacy-safe v2 `targetFingerprint` over inspected semantics and
  keyed document/node/frame structure. The id is dispatch-only. Durable
  approval stores SHA-256 bindings for exact normalized intent and exact URL
  plus bounded safe origin/length and opaque identity metadata; raw draft text,
  URL path/query/fragment, locator, and task context remain transient. App and
  bridge classifiers reject obvious secret-bearing values without reflecting
  them. The sealed dispatcher recomputes SHA-256 over deep-frozen exact handler
  args and revokes the observation epoch before entry. The handler consumes the
  id once and rechecks direct
  attributes, associated labels, `aria-labelledby`/`aria-describedby`, and
  containing-form context for credential/recovery/seed/private-key/payment/CVV
  signals plus target-fingerprint drift. It reads the same handle first and
  skips `fill()` when the approved draft is already present, avoiding duplicate
  input/change handlers after an outcome-unknown attempt. Completion uses one
  renderer capture of value, semantics, document, node, and frame state
  bracketed by stable browser identity checks, and returns only
  fingerprint/equality/length plus mutation/no-op proof without echoing the id
  or value. It does not submit.
  `browser.set_toggle` applies the same one-shot capability and verification
  pattern to one exact checkbox/switch/radio with an explicit desired boolean,
  and only for a positive allowlist of clearly local presentation or
  accessibility preferences. Consequential and unknown settings fail closed.
  Generic click inspects its exact resolved ElementHandle and refuses native or
  ARIA checkbox/switch/radio semantics—including labels and descendants—so
  selector or role spoofing cannot bypass that boundary.
  `browser.select_option` extends the same sealed, one-shot pattern to one exact
  option on one native single-value HTML `<select>`. It binds the inspected
  document/control/option fingerprint, permits only bounded local presentation
  or accessibility preferences, and verifies the same control without
  submitting or navigating. Custom ARIA comboboxes, multi-selects, unknown
  settings, and account/security/privacy/payment/publishing controls fail
  closed.
  The older Computer Use planner/executor cannot supply authenticated typed-loop
  identity, a persisted run, provider tool-use id/iteration, durable dispatch
  ownership, or the exact OpenSwan approval required by that lane. All six
  legacy Computer Use mutation kinds—`navigate`, `click`, `fill`, `select`,
  `press_key`, and `scroll`—therefore become visible, value-stripped,
  structured non-executable typed OpenSwan handoffs during planning,
  saved-plan hydration, direct
  execution, and plan-card serialization. The lane returns before screenshot,
  Stagehand, MCP, or bridge mutation I/O and must resume as a fresh typed call,
  never a legacy/raw retry. `/replay` preflights the entire saved plan, runs
  zero steps when any browser/desktop mutation is present, and permits only the
  reviewed observation-only allowlist.
  Native `desktop.launch_app` and `desktop.focus_app` now share an
  observe-before/after activation helper across OpenSwan and SwanBot. It binds
  an exact resolved name or explicit alias plus positive process id, proves
  running/frontmost postconditions, accepts verified no-ops, and never
  auto-replays an unknown outcome. This is activation proof, not sealed general
  native UI control.
  `/desktop diag` is an authenticated read-only health/pairing/running-app
  probe. `/desktop diag <app>` still performs no launch, focus, open, click, or
  type mutation; it returns a value-free non-executable `desktop.launch_app`
  typed-runtime handoff requiring fresh run/provider-call identity, exact
  approval, dispatch receipt, and post-launch focus proof.
  The narrow `desktop.click_element` semantic-press canary accepts only
  `{ action?: 'press', appName, pid, path, expectedRole, expectedLabel }` from a
  fresh accessibility-tree observation. The adapter re-observes the exact
  frontmost app, caller PID, path, role, label, and accessibility generation;
  seals a one-shot target; and asks for approval with bounded fingerprints
  instead of the raw path/label/capability. Only button/menu-item-like,
  low-consequence presentation/help/settings targets are eligible. Text/state/
  value controls, modals, unknown semantics, and destructive, payment, auth,
  permission, send, or publish targets fail closed. Completion requires the
  exact target to disappear or change semantic fingerprint; unrelated tree
  churn is outcome-unknown and is never auto-replayed.
  OpenSwan authorizes that exact observation through `computerAppGrounding`,
  then `dispatchDurableComputerAppMutation` claims and marks the
  `agent_action_calls` identity started before the bridge can perform once. It
  finishes verified or outcome-unknown, and duplicate identities do not
  execute. SwanBot routes `desktop.click_element` through this same sealed
  OpenSwan gateway before its generic client dispatcher. The raw OpenSwan
  dispatcher and raw SwanBot bridge dispatcher explicitly refuse the tool, so
  callers cannot bypass observation, approval, grounding, or the durable
  wrapper.
  The same gateway-first rule now covers every browser/desktop mutation in the
  current SwanBot client-delegated catalog. Reads such as snapshots and
  accessibility trees may use their bounded read dispatchers; mutations do not
  fall through to raw bridge handlers.
  SwanBot v2 continuation transports only bounded, allowlisted dispatch and
  verification receipts beside tool content, re-sanitizes and correlates them
  to the saved tool call, persists value-free result events/run summaries with
  fixed failure copy, and removes the hidden receipt metadata before model
  replay. The exact resume transcript/system/tool state is not raw
  circle-visible JSON: it is held only in the authenticated AES-256-GCM
  ciphertext snapshot inside the bounded public continuation envelope. Resume persistence
  is two-phase: exact identity/version/nonce plus `dispatchClaimId` first moves
  `client_pending` to `client_dispatching` before local execution; only the
  exact edge acknowledgement releases handlers. Exact results then move
  `client_dispatching` to `client_resuming` before the model loop. Only an
  exact same-claim dispatch retry is idempotent, and only the internal result
  claim may publish the next pending round or terminal result. Competing/mixed
  claims, unconfirmed writes, lease expiry, loop failure, or final-transition
  ambiguity close `outcome_unknown` with `replayAllowed:false`; neither local
  execution nor model resume is reopened. Once applied, §29 additionally
  strips active malformed/expired/state-mismatched snapshots on a three-minute
  sweep and scrubs legacy plaintext plus terminal checkpoints.
  Source/unit/action/gateway smokes and typecheck pass. The latest edge,
  dedicated continuation env, §29 scrub/cron behavior,
  `agent_action_calls` migration/RPCs, and native behavior still require
  production deployment/live-database verification. A live GUI browser/native
  run and live-database concurrency races—two workers resuming one
  continuation, the sweeper racing an active claim, and two workers claiming
  one action identity—remain pending.

**IN-FLIGHT (pure generators, doc-verified, gated on a live install run):**

- **14 pure script generators** (all smoke-tested, all `verifiedInvocation:false`
  with `// VERIFY` markers): a generalized headless runner (`appScriptRunner.ts`,
  6 engines — MATLAB/KiCad/AutoCAD/Maya/GIMP/After-Effects), Adobe cloud imaging
  (Firefly), and per-app generators for Fusion 360 / Revit / SolidWorks /
  DaVinci / Acrobat / Premiere / Rhino.
- **Gate to LIVE:** each needs a bridge runner (fixed binary path, `execFile`
  argv, output-stat proof) + tool registration + one real install run to flip
  `verifiedInvocation:true`. **Doc-verified ≠ install-verified** — this
  distinction is deliberate and enforced.

**ROI order:** Adobe cloud (no local app needed) → generalized headless runner
(unlocks 6 apps at once) → AutoCAD → Substrate-B connected-agent hosts (Fusion/
Revit/SolidWorks, which have no headless mode) → Adobe video → Office/Acrobat.
The marginal cost of app N+1 is one generator + one live test.

---

## 7. Model routing + BlackSwan flywheel

**SHIPPED**

- **Provider routing** — `llmProviders.ts` (16 providers), `serviceProfileSouls.ts`
  (intent×complexity ladder), `crossProviderRouter.ts`/`universalInvoke.ts`
  (health-aware fallback), `billingPriority.ts` (cheapest / prefer-openrouter /
  prefer-direct), `modelCapabilities.ts` (tool-use/vision/computer-use/coding
  tiers).
- **Collaboration semantics** — `modelCollaborationPolicy.ts`: a pure resolver
  mapping a selected model → {primary, grounding, tool-executor, pattern}.
  BlackSwan grounds app context while `claude-haiku-4-5`
  (`BLACKSWAN_TOOL_EXECUTOR_MODEL_ID`) reliably drives tool turns.
- **BlackSwan-v5** — `cswan801/BlackSwan-v5` (Qwen3.5-4B LoRA) on a dedicated HF
  endpoint; auto-router owns status/memory/casual/light-app-grounded turns;
  `shouldEscalateBlackSwanToFrontier` escalates hard turns; fail-visible failover
  chain (v5 → haiku → sonnet) with a user notice on cold-start.
- **Plan/execute split** — LIVE in computer-use (BlackSwan plans, Sonnet drives
  the screen loop) and newly extended to coding (P5).
- **Best-of-N race** (`bestOfNRace.ts`) — `/bestof` races 2–4 models + judges;
  text-only, no side effects.

**IN-FLIGHT / trajectory**

- **v6 SFT** — the weekly launchd flywheel is fully wired (export → tool-trace
  export → score with Cursor's concave length penalty → convert → MLX train →
  eval-gate → fuse+upload). **Honest gap:** the tool-trace telemetry was only
  fixed recently, so meaningful trace volume is still accumulating.
- **v7 RL** (`docs/BLACKSWAN_V7_RL_PLAN.md`) — spec complete: shadow staging,
  RLVR-style verifiable rewards, per-tool-family executor-swap relaxation behind
  Gates A→B→C. The goal is explicitly **"make the 4B model reliably fast on the
  app's own work,"** not "replace Sonnet." Approval floors / evidence contracts /
  fail-closed gates never relax.

This mirrors the frontier's Composer/SWE-1.5 thesis (§8.3): a small fast
app-native executor RL-trained on the harness's own tool traces, a frontier
model planning. The moat is **RL-on-your-harness + verifiable checks**, not weights.

---

## 8. The substrate

**SHIPPED**

- **Memory** — `agentMemory.ts` (capture + SOUL routing), `memoryEmbeddings.ts`
  (OpenAI `text-embedding-3-small`, `match_memories` RPC), turn-time retrieval
  wired into the prompt, `memory_access_log`. Four-pillar loop (capture → route
  → embed → retrieve → inject) is end-to-end live. **Gap:** the live-builder path
  doesn't capture yet.
- **Skills** — `skillLibrary.ts` (+ write path): agentskills.io SKILL.md format,
  metadata-table injection (cache-hot), approval-gated writes, health tracking,
  body-fencing for untrusted content.
- **Approvals/HITL** — `chatApprovalGate.ts` + `computerGrantGate.ts`: sticky
  structural floor for every non-read browser/desktop mutation (with
  pay/delete/login/grant as known examples), dedup/idempotency, fail-closed on
  missing rows;
  `runApprovalsService.ts` per-run approvals with realtime banner. OpenSwan's
  ask gate now preserves genuine run/cross-run/category-auto approval row
  receipts and exposes only issued digest-safe hidden telemetry.
- **Run persistence** — `agent_runs` + `agent_run_events` + token/cost rollups;
  surfaces, status flow, step kinds, ~20 artifact kinds. Tool events distinguish
  dispatched/skipped/legacy-unknown and persist only bounded primitive receipt
  allowlists; guarded browser fill, safe-preference toggle/native-select, and
  narrow native semantic press emit mutation-dispatch/app-verification receipts
  into that seam. The semantic-press route additionally uses the source-built
  `agent_action_calls` claim/start/finish ledger to bind one exact authorized
  action across workers and prevent duplicate execution.
- **Cross-dashboard discovery** — `connectedResourcesDigest.ts`/`…Runtime.ts`:
  the agent starts each turn aware of connected integrations, vault creds (names
  only), Google Workspace, and BYOK providers, with a secret-value guard.
- **Multi-agent file coordination** (task #117) — `agentFileLeaseCore.ts` (pure
  CAS + lease state machine) + `agentFileCoordination.ts` (runtime) +
  `scripts/agent-coordination.ts` (CLI for external agents) +
  `coordination.file_status` tool. `desktop.edit_file` routes through
  `guardedApplyEdits` (claim → hash → apply → CAS re-verify → write → release);
  refuses on `held_by_other` or `conflict`. Two independent guarantees: universal
  content-hash CAS + advisory leases. See
  `docs/MULTI_AGENT_FILE_COORDINATION.md`.
- **Office observability** — per-agent accountability index (last outcome, 24 h
  counts, 24 h cost), bridge-aware status reconciliation, readiness strip.

**IN-FLIGHT** — SOUL wisdom distillation (table + cron migrated, edge fn pending);
memory consolidation/decay (stub + design); memory trust UI ("why did you say
this?", pin/forget); Office `agent_id` on `agent_runs` (durable run→agent link,
currently name-matched).

---

## 9. Where the frontier is (mid-2026) and how we're positioned

*Primary-sourced backbone; anything post-Jan-2026 is **[UNVERIFIED]**, directional
only.*

1. **Coding agents** moved to fleets of parallel background agents on
   git-worktrees, running a read→edit→run→observe→fix loop with checkpoints/undo
   (Cursor 2.0 multi-agent, Claude Code 2.0 checkpoints/subagents/hooks, Devin
   2.0 parallel + wiki, Codex cloud, GitHub Agent HQ / Mission Control). *The
   pattern to emulate:* orchestrator-worker + closed-loop self-healing — but
   Anthropic's own guidance is that **most coding work should NOT be
   multi-agented** (too interdependent); parallelism is for read-heavy fan-out.
   **We have the primitives:** `isolation:"worktree"`, leases + CAS, run-and-fix
   gate, evidence contract.
2. **Computer-use** benchmarks crossed human baseline and are saturating, so the
   constraint shifted to **latency, step-efficiency, and untrusted-content
   safety**. Winning pattern: **hybrid fallthrough (API → a11y tree → vision) +
   observe-before-act + fresh-observation-on-retry + tiered HITL** (HITL takeover
   is the single largest measured reliability jump). *This is exactly our
   evidence-contract architecture.* Bet: compete on the approval/observation loop
   being fast and cheap, not on OSWorld score.
3. **Small-fast-executor + frontier-planner** is real and independently
   confirmed — Cursor Composer (MoE, RL-in-harness, ~250 tok/s) and Cognition
   SWE-1.5 (RL on the Cascade harness, ~950 tok/s) both shipped it. Training
   science: RLVR (verifiable rewards from tests/execution, GRPO/DPO, no learned
   reward model); naive single-turn RLVR degrades in multi-step agent settings.
   *This is our BlackSwan thesis.* The moat is RL-on-your-harness + a tight tool
   set + verifiable checks at inference — not pretraining.
4. **Coordination + governance** is where the field converged: MCP (agent→tool,
   now Linux Foundation) + A2A (agent→agent), control-plane products (GitHub
   Agent HQ, the "Agent Management Platform" category), non-human identity
   (Okta ID-JAG delegation chains), agentic payments (AP2 signed mandates), and a
   security spine — the **Lethal Trifecta** (private data + untrusted content +
   external comms = guaranteed exfiltration) and Meta's **Rule of Two** (a
   session should hold at most 2 of 3 without human approval).

**Positioning.** The single-vendor chatbots (Claude, ChatGPT, Gemini) are
single-user and conversation-scoped. The two structurally defensible frontiers
they leave open are exactly ours:

- **A team accountability/control plane** — visible, attributable, reversible
  agent work.
- **The write/spend approval boundary on connected apps** — the highest-liability,
  least-solved seam in the whole field.

Two adoptions to make us standards-native and future-proof: **(a) MCP as the
default integration fabric** (there is an `mcp-tool-bridge` smoke already —
lean in), and **(b) architect every unattended session around the Rule of Two**,
with our sticky floor as the enforcement point.

---

## 10. The future — what the app will be able to do

**Near (this quarter, mostly unblocking already-built work):**

- Full Claude-Code-class coding in chat: apply P4 SQL §24 and complete the
  structured connected-agent delegation path for build/test/mutating git while
  keeping the browser-facing `execFile` endpoint diagnostic-only.
- Live app automation for the first headless engines (MATLAB/AutoCAD/GIMP) +
  Adobe cloud imaging → "generate a hero image and drop it into an InDesign
  template and export," with proof + approvals.
- v2 SwanBot streaming + M4 telemetry sign-off → v2 becomes the sole chat lane.
- Memory God-Plan 3–5 (SOUL wisdom, consolidation, trust UI).

**Mid (1–2 quarters):**

- Plan Mode as a first-class editable object with "Build from Plan," workspace
  indexing + `@file` precise context, per-tool approval governance.
- Multi-file live builder (React runtime preview, error overlay, edit+iterate).
- BlackSwan v6 SFT shipping on real trace volume; v7 RL through Gate A.
- Safe coordinated multi-agent work: one agent delegates to another with a
  temporary TTL vault grant; worktree isolation for heavy parallel builds.

**Long (the north star):**

- Chat "pulls up" *any* app (desktop/browser/CAD/creative) and does the task
  end-to-end, proving each step, with the frontier planning and BlackSwan (or a
  user-trained domain model) executing fast.
- A team's circle *accumulates* intelligence — shared memory + skills + SOUL
  wisdom — so agents (this app's, Claude Code, Cursor, Codex) join a circle and
  inherit its context instead of starting cold.
- Offline agent self-improvement (DSPy/GEPA-style) once benchmarks + post-hoc
  scoring have enough runs: agents optimize their own prompts and skill selection
  against regression benchmarks.
- Standards-native interop (MCP + A2A) so the workspace is the control plane over
  a fleet of heterogeneous agents acting in real accounts — visible, attributable,
  reversible, and governed by the Rule of Two.

---

## 11. Honest gaps & risks

- **Doc-verified ≠ install-verified** — the 14 app generators are correct on
  paper; none is LIVE until a real binary run flips its gate.
- **SQL not yet applied** — `codebase_files` (§24) blocks codebase indexing until
  run in prod. A local migration file is not proof prod has it.
- **Connected coding convergence pending** — the local `execFile` endpoint is
  intentionally diagnostic-only; full shell/build/test/git mutation must run
  through structured paired coding agents. App automation still needs
  additional per-engine runners.
- **Cloud Computer Use is source-proven, not live-integration-proven** — the
  required v1 policy, forced scheduled observation-only floor, exact live
  mutation confirmation, fresh screenshot brackets, one-attempt dispatch,
  redaction, outcome-unknown/no-replay, and start reservations are pinned by
  `computer-use-cloud-policy`. Root Chat constraint propagation and removal of
  the app/attachment pre-agent bypasses are pinned by
  `chat-computer-request-router` and `computer-task-runtime-context`. The
  cloud-policy and runtime-context guards run exactly once in all Chat/SwanBot
  daily and release gates, `smoke:all`, and canonical readiness. Exact
  approval, direct-handoff, open-path, automation, scheduled-action, Office
  broadcast, and database-authority guards share that exactly-once contract.
  The updated edge has not been
  deployed/re-verified, and no live Browserbase plus Supabase confirmation-row
  integration or native-app GUI run was performed. Authenticated legacy cloud
  callers without the policy now receive HTTP 400.
- **Computer mutation gateway remains narrow** — non-secret, non-submit
  `browser.fill_field`, positive-allowlist `browser.set_toggle`, native
  single-select `browser.select_option`, and low-consequence native
  `desktop.click_element` semantic press are sealed in the source runtime.
  All current SwanBot client-delegated browser/desktop mutations enter the
  OpenSwan runtime first, but that routing parity does not make every local
  typed mutation a sealed canary: submit, general clicks/keys/upload/
  navigation/close, text or state-bearing native controls, modal/destructive/
  payment/auth/permission actions, and generalized desktop/native-app mutation
  still need the same target/ledger/proof contract. The hosted cloud edge now
  exact-confirms opaque native clicks/typing/keys, but its one-call screenshot
  boundary is separate from the local semantic target/ledger contract.
  Semantic press is intercepted before SwanBot's
  generic desktop dispatcher; both raw OpenSwan and raw SwanBot bridge paths
  fail closed. Its exact observation is grounded and wrapped by the durable
  `agent_action_calls` claim/start/finish contract before a one-time bridge
  perform. The separately vault/origin-gated credential lane remains
  compatible. Native launch/focus has exact-name/alias plus PID before/after
  proof but is not the general native mutation gateway. Target expiry/replay,
  detachment, fingerprint drift, and ambiguous after-state fail closed or return
  outcome-unknown and require a fresh observation; they are not auto-replayed.
  Current proof is focused source/unit/typecheck verification, not live browser
  or native GUI execution.
- **Durable action ledger contention is not production-proven yet** — the
  `agent_action_calls` source, SQL migration/RPCs, runtime wrapper, focused
  smokes, and live catalog presence are verified. Exercising authenticated run
  ownership/RLS and claim/start/finish under faults, then racing two workers
  against one idempotency identity, remain release checks.
- **Authority consolidation is source-proven, not deployment-proven** — the
  exact Chat/OpenSwan/SwanBot approval claims, value-free direct handoffs,
  `desktop.open_path` ledger, automation/scheduled no-replay guards,
  `outcome_unknown` UI, Office durable-row wakeup, and external edge ledger
  bindings are pinned by focused smokes and readiness. Section 26 is applied and
  catalog-verified but not contention-proven; sections 27 and 28 are not
  applied. Changed edges are not deployed/re-verified; and live RLS,
  Realtime, cron, provider, concurrent-worker, and GUI behavior was not tested.
  Local Docker/Supabase was unavailable for §28 execution.
- **Continuation protocol/privacy is source-proven, not
  deployment/live-race-proven** — source and focused smokes pin the
  AES-256-GCM exact-state snapshot, dedicated secret plus authenticated
  rotation version, bounded circle-visible envelope, missing-key
  `clientOnly` withholding, value-free event inputs/fixed errors,
  `client_pending → client_dispatching` before any local execution,
  `client_dispatching → client_resuming` before model resume, exact same-claim
  dispatch retry, exact result-claim next/terminal updates, all-three-active-
  state readiness exclusion, and closed outcome-unknown handling. The latest
  `swanbot-v2-ai` still must be deployed with the dedicated env configured and
  rotation-tested. §29 is not applied, so historical legacy plaintext rows can
  still remain; its one-time legacy/terminal scrub, malformed/expired/state-
  mismatch sweep, and three-minute pg_cron job (or manual fallback) have no
  live proof. Live dispatch/result/sweeper races plus post-commit/network and
  lease-expiry failure injection must prove one consumer, no resurrection,
  and no automatic replay.
- **Telemetry maturity** — M4 sign-off and BlackSwan v6/v7 both wait on
  accumulating production data (trace telemetry was only recently wired).
- **Live-builder memory gap** — build completions don't write memory yet.
- **Office run→agent link is name-matched** — needs a durable `agent_id`.
- **Security invariants that never relax:** the always-confirm floor for every
  non-read browser/desktop mutation, including bland/unknown calls; no raw
  secrets in prompts/logs/metadata; untrusted retrieved content stays fenced;
  no silent provider/model switching; Rule-of-Two for unattended sessions.

---

## 12. Verification posture

The original §§2–8 sweep is grounded in repo files, commits, and smoke tests as
of commit `b26b7f3` on `wip/full-working-tree`, 2026-07-13. Runtime
reconciliation through 2026-07-26 is source- and focused-smoke-verified for the
sealed native-select, semantic-press schema/routing, raw-bypass closure,
grounding, durable action wrapper, default-edge constraint/approval enforcement,
gateway-first browser/desktop mutation routing, sealed fill schema, structured
all-mutation Computer Use handoffs, read-only locator-actionability advisory
evidence, whole-plan replay preflight, two-phase
continuation ownership, AES-256-GCM continuation state, bounded public
envelopes/value-free events, missing-key local-tool withholding, read-only
diagnostic launch handoff, cloud v1 policy
and exact-confirmation ordering, all-three root Chat policy propagation,
start reservations, staged attachment handoff, pre-agent app/attachment bypass
closure, and edge/OpenSwan parity. `computer-use-mutation-handoff` is the
focused legacy-lane guard; `computer-use-cloud-policy` and
`computer-task-runtime-context` guard the second-wave boundary; and the
guarded-action ledger smoke contains 103 assertions. The exact approval,
direct-handoff, open-path, automation, schedule, Office broadcast, and
database-authority focused guards are mandatory once in all Chat/SwanBot
daily/release gates, `smoke:all`, and readiness. The locator-actionability guard
is mandatory in those same gates but never authorizes or binds a later
mutation. This is not evidence of
the latest edge deployments, production continuation-key configuration or
rotation, live Browserbase/Supabase confirmation integration, live
`agent_action_calls` or scheduled-action migrations/RPCs, applied §29 legacy
scrubbing/sweeping, live GUI execution, live Realtime/RLS/cron behavior, live database
concurrency/failure-injection behavior, or production telemetry. Tool-catalog
size is stated as "180+"
because the `OpenSwanRuntimeToolName` union is a composed multi-type union
  (counting method yields 170–191); **84 total = 25 server-side + 59
client-delegated** is the concrete source-derived `swanbot-v2-ai` executable
subset. §9 frontier claims are primary-sourced for the pre-cutoff backbone
(launch dates, benchmark methodology, protocol history, RLVR science, the
trifecta/Rule-of-Two spine) and **[UNVERIFIED]** for anything after Jan 2026
(2026 leaderboard numbers, Composer 2 internals, next-gen model names). Treat
post-cutoff items as directional.
