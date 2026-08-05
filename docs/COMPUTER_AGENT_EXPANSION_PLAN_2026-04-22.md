# Computer Agent Expansion Plan

Created: 2026-04-22
Last reviewed: 2026-07-26

Related docs:
- [AGENTS_ROADMAP.md](./AGENTS_ROADMAP.md)
- [COMPUTER_USE_PLAN.md](./COMPUTER_USE_PLAN.md)
- [HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md](./HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md)

## Goal

OpenSwan should be able to help with:

- locating files and content the user has granted access to
- working through browser tasks with approvals and visible progress
- using connected apps and external systems through MCP or circle integrations
- routing a request to the right execution surface instead of treating everything like chat

The right product shape is not "browser agent plus some other stuff later." It is a **computer task runtime** with permissioned capability families:

- files
- apps
- browser
- bridges
- integrations

## Audit

### What exists now

1. Browser/computer execution foundation is real.
   - `supabase/functions/computer-use-agent/index.ts`
   - `src/lib/computerUseAgent.ts`
   - `src/lib/useComputerUseTask.ts`
   - Browserbase-backed computer tasks with SSE, approvals, screenshots, and result synthesis

2. There is already a bridge model for external agents.
   - `src/lib/connectionManager.ts`
   - `src/lib/agentBridgeSupport.ts`
   - Generic remote bridges can be health-checked and OpenSwan bridges can expose richer RPC

3. MCP support exists.
   - `src/lib/mcpClient.ts`
   - circles can register MCP servers and fetch tools from them

4. Circle integrations already expose typed capability flags.
   - `src/lib/circleIntegrations.ts`
   - integrations can already answer "what can this circle do?" for SaaS systems

5. Chat memory search exists, but local file search does not.
   - `src/lib/agentTools/sessionSearch.ts`
   - this is transcript search, not filesystem search

### What is missing

1. No first-class computer capability registry.
   The app has browser execution, MCP tools, integrations, and local bridges, but no canonical layer that describes the available file/app/browser capabilities for a circle.

2. No local filesystem contract.
   The agent cannot yet say, in a structured way, "I can search these folders, read these file types, and write only to these approved locations."

3. No app-access contract.
   MCP servers, local bridges, and integrations are all treated differently, so "what apps can I use?" is not one answerable question.

4. Computer intent is still browser-biased.
   The UI now says `Use Computer`, but the runtime and templates are still mostly shaped around web tasks.

5. No unified approval model across files/apps/browser.
   Browser has stronger approval gates than files or app connectors. The long-term model needs one permission story.

## Product direction

OpenSwan should move to a **computer access profile** per circle/session:

- `browser`
  - browse sites
  - extract information
  - fill forms
  - pause for approvals before risky actions
- `files`
  - locate files by name/content
  - read approved files
  - optionally write only to approved roots
- `apps`
  - use MCP-exposed local/remote app tools
  - use connected SaaS integrations
  - use local agent bridges for richer runtime actions

That profile should be inspectable before execution, attached to runs, and visible in chat/office.

## Phase plan

### Phase 1 — Canonical computer capability audit

Ship a shared capability layer that answers:

- what browser capabilities exist?
- what file capabilities exist?
- what app capabilities exist?
- where do they come from?
- what is still missing?

Files:
- `src/lib/computerCapabilityRegistry.ts`

Outcome:
- one source of truth for current browser/files/apps/bridges/integrations capability status
- reusable by chat, office, setup wizards, and agent planning

Status:
- shipped: `src/lib/computerCapabilityRegistry.ts`
- shipped: `src/lib/computerTaskExecution.ts`
- shipped: initial grant planning in `src/lib/computerTaskGrants.ts`
- shipped: local remembered browser grant storage in `src/lib/computerTaskGrantMemory.ts`
- shipped: durable computer task-state in `src/lib/computerTaskState.ts`
- shipped: `src/lib/computerTaskRuntime.ts`
- shipped: initial chat integration
  - `Use Computer` console routes browser and non-browser tasks through the shared `run_computer_task` transport
  - browser tasks still hand off to the live browser runtime after shared planning/approval
  - normal chat can now classify and route computer-task requests into `run_computer_task`
  - chat and the browser approval dialog now surface the inferred access plan and approval summary
  - browser approvals can now persist remembered browser grant scopes for future tasks
  - `Use Computer` now persists planning / approval / execution / terminal task-state for later Focus Chain style UI
  - the `Use Computer` console now surfaces the current persisted task-state directly

### Phase 2 — Local filesystem access model

Add a real local filesystem contract:

- approved roots
- read/search/write scopes
- file-type allowlists
- per-run audit trail of accessed roots

Preferred path:
- MCP filesystem servers first
- local bridge adapters second

Outcome:
- agent can locate content anywhere it has explicit access
- the product can explain where that access comes from

Status:
- shipped: initial `file_task` adapter in `src/lib/computerFileAdapter.ts`
- current behavior:
  - discovers filesystem MCP tools for the circle
  - attempts a real MCP-backed file search / read / list operation
  - falls back to the shared agent runtime only when no suitable filesystem tool can be executed
- remaining gap:
  - no normalized path grants yet
  - no durable file-scope approval model yet
  - result rendering is still generic MCP payload summarization, not a richer file browser UX

### Phase 3 — App connector model

Unify app access behind one capability shape:

- MCP tools
- circle integrations
- local bridges

Each app/system should declare:

- capability family
- read/write/risky action posture
- approval requirements
- source of authority

Outcome:
- "Use Computer" stops meaning only "use the browser"
- app tasks can route to the best available execution surface

Status:
- shipped: initial `app_task` adapter in `src/lib/computerAppAdapter.ts`
- current behavior:
  - discovers MCP app/desktop tools, integrations, capabilities, and enabled bridges
  - attempts a real MCP-backed app tool call when there is a plausible execution match
  - otherwise returns a concrete connected-surface inventory instead of bluffing execution
- remaining gap:
  - no normalized app-action permission model yet
  - no provider-specific app action adapters yet
  - inventory rendering is still text-first rather than a richer structured app-action UI

### Phase 4 — Computer task planner

Extend chat planning so requests can resolve to:

- `browser_task`
- `file_search_task`
- `file_read_task`
- `app_task`
- `hybrid_computer_task`

Outcome:
- user asks naturally
- planner chooses the correct surface
- approvals and run summaries stay consistent

### Phase 5 — Permission and trust UX

Build a visible access model:

- folders granted
- apps connected
- MCP servers active
- browser permissions and approval posture

Outcome:
- users can understand exactly what the agent can and cannot touch

## Near-term build order

1. Complete the `run_computer_task` migration so browser and non-browser computer work both ride one dispatcher contract
2. Add filesystem-specific capability support
3. Add durable approval / grant scopes for files, apps, MCP, and bridges
4. Expand `Use Computer` from web-only templates into browser/files/apps task families

## Non-goals for this phase

- not pretending the agent can already control arbitrary native desktop apps
- not broadening permissions silently
- not auto-routing file tasks into browser automation just because the browser stack already exists

## Success criteria

1. The app can answer "what can this agent access on this circle right now?" with one structured object.
2. File, app, and browser access are described under one runtime contract.
3. Chat planning can distinguish browser work from file/app work.
4. Every future computer capability expansion has one canonical place to plug into.

## 2026-07-24 whole-runtime review and convergence plan

This section supersedes the older "remaining gap" snapshots above where the
implementation has moved on. The audit followed the complete user-request path
through Chat, OpenSwan/SwanBot, the shared agent loop, app/file/browser
adapters, local bridges, connected coding agents, approvals, proof, persistence,
and recovery.

### Reviewed ownership surfaces

- Request understanding and Chat dispatch:
  `chatComputerRequestRouter.ts`, `chatAutomationPlanner.ts`,
  `runChatAutomationPlan.ts`, `chatTransportHandlers.ts`, and `ChatTab.tsx`.
- Computer execution:
  `computerTaskExecution.ts`, `computerTaskRuntime.ts`,
  `computerAppAdapter.ts`, `computerFileAdapter.ts`, `computerUse.ts`, and the
  app grounding/control-surface modules owned by this roadmap.
- Agent loops:
  `agentExecutionCore.ts`, `openswanSessionRuntime.ts`,
  `swanbot.ts`, `swanbotV2BatchRuntime.ts`, and the v2 client-loop flag.
- Tool and connected-agent execution:
  `openswanToolRuntime.ts`, MCP dispatch, `agentRuntime.ts`,
  `agentInvocation.ts`, `agentSpawner.ts`, the provider detectors, and the
  Claude/Codex/Cursor/Gemini bridges.
- Trust, evidence, and handoff:
  grant/approval policy, bridge pairing, observation epochs, action receipts,
  task outcome state, persisted chat metadata, recovery contracts, and the
  portable connected-agent context pack.

### Canonical target architecture

```text
user request in Chat
  -> one route/plan with goal, target surface, risk, constraints, and proof
  -> immutable redacted context pack
  -> shared typed execution loop
  -> canonical tool catalog chooses app-native/API/MCP/bridge/a11y/vision lane
  -> fresh exact-target observation
  -> runtime-owned policy and exact-call approval
  -> single guarded handler entry
  -> fresh after-state or artifact verification
  -> authoritative completed/partial/blocked outcome
  -> proof, recovery state, and reusable capability memory
```

An "arbitrary app" path does not mean blind unrestricted GUI control. It means
the runtime can discover the app and the safest available control surface,
observe the exact live target, act one bounded step at a time, verify state,
recover through the next control surface, and request a reusable adapter
buildout when deterministic coverage is missing.

### Build slice continued 2026-07-24; local lanes hardened 2026-07-26; cloud/root Chat hardened 2026-07-26

- Added an immutable, bounded Chat agent context pack with best-effort
  secret-pattern redaction and attached it before transport dispatch so
  SwanBot, OpenSwan, and connected-agent handlers can receive one
  goal/guardrail/proof contract.
- Propagated thread identity, plugin/tool scope, cancellation, user constraints,
  and always-confirm floors from Chat computer tasks into the typed SwanBot
  canary and both capability-buildout retry paths.
- The always-confirm floor is structural for every non-read browser/desktop
  mutation, including bland or opaque keypresses and unknown/future tool names;
  a call cannot evade review merely because its name or arguments omit a
  sensitive keyword.
- Connected that pack to the real computer-task execution path instead of only
  mock/transport handlers: app/file/hybrid runs and capability retries pass it
  through `AgentRunRequest`, the bounded `compactPrompt` enters model context,
  and a bounded projection is saved on the run for recovery.
- Made unfamiliar-app capability recovery provider-aware. Durable buildout
  records retain the selected provider; delayed result polling supports strict
  dedicated Codex and Claude Code `APP_CAPABILITY_*` receipts; exact or unique
  sufficiently long session identity is required; and unsupported
  Gemini/Cursor result lanes become explicit `incomplete` blockers rather than
  remaining indefinitely requested. Claude transcripts use their own JSONL
  ids, so the bridge validates the anchored UC launcher marker and merges one
  unambiguous transcript back onto the managed session id before polling; an
  absent or ambiguous claim fails closed. The buildout dispatcher is
  hard-limited to Codex/Claude until the other bridges expose equivalent
  bounded receipts.
- Hardened run evidence persistence so `dispatched: true`, `dispatched: false`,
  and legacy unknown remain distinct. Only bounded primitive allowlists for
  action, mutation-dispatch, app-verification, and verification receipts cross
  the durable boundary. The guarded typed-OpenSwan browser-fill,
  safe-preference-toggle, native-select, and narrow native semantic-press
  canaries now produce mutation-dispatch and app-verification receipts; other
  live mutations still need the same producer contract.
- Hardened the shared typed loop with handler-entry truth and an optional
  post-result safety interlock, currently wired by the typed SwanBot client
  canary. When enabled, a stop condition observed by one tool prevents every
  later handler in that same model turn from entering while still closing the
  transcript with explicit skipped results.
- Made provider tool-use identity a run-wide capability. The core rejects a
  whole requested round before transcript append or dispatch when an id is
  empty, oversized, contains control characters, duplicates another call in
  the round, or reuses an id from resumed history or an earlier round. A fresh
  handler context carries the exact `toolName`, `toolUseId`, and iteration;
  neither the loop nor the OpenSwan bridge fabricates fallback ids.
- Made OpenSwan runtime approval passes evidence-bearing. Run-scoped,
  consumed cross-run, and category-auto passes now return a genuine receipt
  backed by a real `agent_run_approvals.id`; category auto first creates a
  durable exact `auto_approved` row. Missing ids, stale/rejected/pending
  decisions, and lookup/create failures remain fail-closed. Model-visible tool
  output never receives the canonical approval key or args: an issued hidden
  receipt carries only a privacy-safe key digest and compact call identity.
- Added a runtime-sealed computer-app mutation foundation: short-lived
  exact-target observation epochs, WebCrypto SHA-256 argument fingerprints
  bound into runtime-owned risk/approval verdicts, single-use expiring
  authorizations, actual handler-entry receipts, and runtime-issued same-target
  after-state verification. The guarded canaries additionally use the
  `agent_action_calls` claim→start→finish ledger at the exact handler boundary:
  an authenticated, persisted user/circle/run/tool-use/action identity must
  atomically reach `dispatched` before the bridge handler can enter. After that
  entry, the guarded runtime finishes only as `verified` or
  `outcome_unknown`; a pre-handler loser does not rewrite a claim another
  worker may already have started. At handler entry the dispatcher recomputes
  SHA-256 from a deeply frozen canonical argument clone, invalidates the bound
  observation epoch, and passes only the sealed args to the handler.
- Integrated three browser observe→approve→dispatch→verify canaries plus one
  narrow native semantic-press canary at the canonical typed OpenSwan
  dispatcher. `browser.fill_field` accepts only one exact, non-secret,
  non-submit draft. Exactly one locator is independently required at every
  boundary: edge schema, app normalizer/sealed runtime, browser client request
  builders, and bridge target/perform endpoints all enforce `name` XOR
  `selector`; both-present and neither-present inputs stop before observation
  or dispatch. A fresh DOM observation supplies opaque
  bridge-process/context/live-document/URL identity; then read-only
  `POST /browser/fill_target` must resolve exactly one field and issues a
  short-lived, single-use `targetId` backed by the same ElementHandle plus an
  HMAC privacy-safe v2 `targetFingerprint` over inspected semantics plus keyed
  document/node/frame structure. The target id is dispatch-only. Durable
  approval stores SHA-256 bindings for the exact normalized intent and exact
  URL plus bounded safe origin/length and opaque page/fingerprint metadata;
  raw draft text, URL path/query/fragment, locator, and task context remain
  transient. App and bridge classifiers reject obvious secret-bearing values
  without reflecting them. Handler entry consumes the id once and rechecks
  identity/fingerprint plus direct attributes, associated labels,
  `aria-labelledby`/`aria-describedby`, and containing-form context for
  credential/recovery/seed/private-key/payment/CVV signals. It reads the same
  handle before mutation and skips `fill()` when it already equals the approved
  draft, avoiding duplicate input/change handlers after an outcome-unknown
  attempt. Completion uses one renderer capture of value, semantics, document,
  node, and frame state bracketed by stable browser identity checks. It returns
  only fingerprint, equality, bounded lengths, a mutation/no-op flag, and
  identity.
  Navigation/close/restart, expiry/replay,
  detachment, or target drift fail closed. The runtime accepts completion only
  when that redacted proof mints a newer same-target verification receipt.
- Added `browser.set_toggle` as the second sealed browser canary. It accepts
  only an exact checkbox/switch/radio target, an explicit desired boolean, and
  a clearly local presentation or accessibility preference. The bridge keeps a
  one-shot exact ElementHandle, rechecks HMAC-bound identity and semantics,
  skips activation when state already matches, and accepts completion only
  from fresh same-target checked-state proof. Consequential or unknown controls
  fail closed. Generic click inspects its exact resolved element and refuses
  native or ARIA checkbox/switch/radio controls—including labels and
  descendants—so role or selector spoofing cannot bypass this policy.
- Added `browser.select_option` as the third sealed browser canary. It accepts
  only a single-value native `select`, one exact value-or-label match, and
  `submit: false`. Fresh page and exact-target observations bind one combobox,
  one option fingerprint, and the prior selection; custom widgets, multiple
  selects, protected/unknown controls, and generic click/fill selection
  bypasses fail closed. Completion requires exact option proof or a verified
  no-op without exposing the raw option, locator, URL, or one-shot target id.
- Added a narrow native `desktop.click_element` semantic-press canary. The
  public contract requires exact app name, positive PID, accessibility path,
  expected role, and expected label. The adapter freshly observes the full
  accessibility tree, seals a one-shot exact target, revalidates
  app/frontmost/PID/generation/path/role/label after approval, and performs
  exactly one accessibility action. Only bounded safe button/menu-item roles
  and presentation/help/settings/about-style intents are eligible; text/value,
  modal, destructive, payment, auth, permission, send/publish, and unknown
  targets fail closed. Completion requires that exact target to disappear or
  change semantic fingerprint; unrelated tree churn is not proof. Raw OpenSwan
  and SwanBot client dispatchers refuse this tool, so coordinate or legacy
  bridge paths cannot bypass the semantic gate.
- Routed native `desktop.launch_app` and `desktop.focus_app` through one
  observe-first adapter in OpenSwan and the SwanBot client loop. It binds an
  exact resolved app name (or explicit alias) and positive process id, observes
  before and after dispatch, proves running/frontmost postconditions, accepts a
  verified no-op, and never auto-replays an outcome-unknown activation. This is
  activation proof, not a sealed general native UI-mutation contract or
  bundle-identity guarantee.
- Kept `/desktop diag` and `/desktop diag <app>` read-only. They probe bridge
  health, pairing, and running apps only; the optional app argument returns a
  value-free non-executable `desktop.launch_app` typed-runtime handoff instead
  of launching/focusing/opening anything. A fresh authenticated run must still
  obtain exact provider-call identity, approval, dispatch receipt, and
  post-launch focus proof.
- Added a backward-compatible SwanBot continuation receipt side channel.
  Newer clients return only allowlisted, bounded mutation-dispatch and
  app-verification receipt fields beside model-visible content; the edge
  re-sanitizes and correlates them to the authoritative saved tool call, writes
  idempotent result events and bounded run summaries, and strips the hidden
  receipt metadata before model replay.
- Hardened SwanBot continuation ownership into two one-way CAS phases. Exact
  identity/version/nonce plus a client-generated dispatch claim changes
  `pending` / `client_pending` to `dispatch_claimed` /
  `client_dispatching` before any local handler can enter. Exact validated
  results then change that row to `results_claimed` / `client_resuming` before
  model resume. Only an exact same-claim dispatch retry carrying the
  already-winning claim is idempotently acknowledged. Competing,
  mixed-version/state, ambiguous, expired, or lost claim-bound paths close
  `outcome_unknown`; neither local actions nor model resume are automatically
  replayed. Readiness ignores all three active client stop reasons.
- Separated transport success from task completion. App mutations remain
  partial without explicit proof; sequence proof is valid only when successful
  verification is the terminal step. Direct artifact-producing adapters can
  mark completion only from concrete file/state evidence.
- Consolidated all four localhost execution bridges around shared
  source/Host/Origin, pairing, and bearer-token checks. The Claude desktop
  surface additionally owns scoped-file grants and its fixed read-only
  diagnostic-command allowlist. Legacy arbitrary-shell callers were migrated
  or disabled instead of bypassing that boundary.
- Made the legacy `computerUse.ts` planner/recording lane observation-only for
  all six legacy Computer Use mutation kinds: `navigate`, `click`, `fill`,
  `select`, `press_key`, and `scroll` return value-stripped structured
  non-executable typed OpenSwan handoffs before screenshot, Stagehand, MCP, or
  bridge mutation I/O.
  `/replay` preflights the whole saved plan and runs zero steps when any
  browser/desktop mutation is present; only the reviewed observation allowlist
  may replay locally.
- Source-hardened the separate hosted Browserbase Computer Use lane. A bounded
  schema-v1 execution-policy envelope is validated before provider/session
  work. Authenticated Chat/queue starts require an interactive policy;
  scheduled watch/service calls are forced observation-only, while
  authenticated legacy callers without a policy now receive HTTP 400. All
  three root Chat starts—automatic browser launch, booking-session
  continuation, and manual approved launch—preserve derived user constraints
  and the opaque-target/credential/external-side-effect confirmation floors.
- Classified every left/right/double click, type, key, and saved-login call as
  a cloud mutation; unknown native actions fail closed. Because current
  coordinate/focus targets are opaque, each mutation requires durable
  exact-call live confirmation even when a pre-run grant exists. An approved
  call requires a fresh pre-action screenshot, one-attempt dispatch, and a
  fresh post-action screenshot. Missing pre-proof blocks before dispatch;
  attempted-but-unverified work ends `mutation_outcome_unknown` and is never
  automatically replayed. Type/key/credential/question inputs are redacted or
  suppressed across SSE, progress/action traces, model history, replay,
  stuck-solver payloads, usage metadata, and errors.
- Added synchronous single-task and queue start reservations before async
  module/credential work. Pending starts count toward queue capacity, and
  cancellation/clear invalidates reservations so late async completion cannot
  start duplicate or over-capacity work.
- Removed the root Chat `computerTaskRuntime` pre-agent mutation bypasses. It
  no longer calls `executeComputerAppTask`, `bridgeOpenPath`, or
  `bridgeWaitForApp` before authenticated `executeAgentRun`; only read-only
  live observation may run first. App/hybrid work therefore reaches the typed
  agent loop. Uploaded files remain staged behind a value-free,
  non-executable `desktop.open_path` handoff without raw path, identity,
  approval, receipt, or proof. Exact staged context remains in the
  authenticated task prompt and is redacted from result,
  capability-buildout, and action-trace telemetry.
- Hardened exact approval authority across Chat, OpenSwan, and audited SwanBot
  mutations. Chat SHA-binds the complete plan plus user/circle/thread/room and
  consumes one `agent_approvals.applied_at` claim before transport. OpenSwan
  SHA-binds canonical args plus authenticated persisted-run/provider-call
  identity and consumes one schema-v2 dispatch binding. SwanBot WordPress
  writes and its generic risk floor share that same digest-safe, single-use
  machinery. Approval audit/model payloads contain only bounded labels and
  safe digests. Durable OpenSwan/subagent tool-call telemetry contains only
  bounded field/type/shape summaries; exact arguments remain in-memory for
  approval, dispatch, and proof. `event-bound-core` guards this in readiness
  and both release gates.
- Removed legacy direct authority from local-file, image-conversion, and
  diagnostic launch helpers; they emit value-free non-executable typed-tool
  handoffs. The executable `desktop.open_path` lane instead requires fresh
  exact stat/path digests, exact identity and approval, §26 claim/start, one
  bridge attempt, and fresh exact frontmost-app proof. Ambiguity is
  `outcome_unknown` with no replay.
- Hardened unattended mutation lanes. `automation-executor` keeps
  service/scheduled invocations read-only and permits an authenticated manual
  file write only with fresh exact one-use authority plus §26. Every scheduled
  external action needs a fresh approval for that occurrence, one durable
  claim/dispatch, and no retry; a timeout or post-dispatch error persists
  `outcome_unknown`. Pending Actions presents a redacted verify-first
  roadblock without retry. Approval-gated custom API and messaging writes use
  the same exact receipt plus action ledger.
- Made Office broadcasts advisory-only. After client authentication/shape
  checks, §28 `invoke_agent` locks the exact durable
  message/circle/expected-command row, verifies membership and target
  ownership/scope, and returns canonical executable fields. Claims are
  idempotent per message/agent subject (including synthetic `blackswan`);
  response stream/done writes require the same claimant, membership, live
  state, bounded payload, CAS, and multi-target completion coverage. Section
  28 also validates and freezes protected schema-v2 Chat/OpenSwan approval
  bindings, server-stamps pending resolution, and restricts expiry/one-use
  consume to the requester while leaving unrelated legacy/scheduled rows
  outside its triggers.
- Kept the authority consolidation source/focused-smoke-only. Sections 26, 27,
  and 28 are not applied; changed edges are not deployed/re-verified; and no live
  database/cron/Realtime contention, external provider dispatch, or native GUI
  proof was collected. Local Docker/Supabase was unavailable for §28 execution.
- Kept the second-wave claims source-only. The updated `computer-use-agent`
  edge has not been deployed/re-verified, and no live Browserbase session,
  Supabase confirmation-row integration, or native-app GUI run was performed.
  The HTTP 400 compatibility break for authenticated legacy cloud callers
  without the v1 policy is intentional.
- Kept the device-local SwanBot typed client loop explicitly
  opt-in/default-off while this safety and compatibility work is validated.
  The SwanBot v2 edge remains the source-default production path.

### Required convergence slices

1. **One live mutation gateway — four narrow canaries source-verified 2026-07-26**
   - The sealed observe/authorize/dispatch/verify contract is integrated at the
     canonical typed OpenSwan dispatcher for `browser.fill_field`,
     `browser.set_toggle`, `browser.select_option`, and the narrow
     accessibility-backed `desktop.click_element` semantic press.
   - Classify every browser/desktop/app mutation through the same runtime-owned
     policy; observation tools remain read-only.
   - The sealed dispatcher now invalidates its bound epoch before handler
     entry. Migrate every remaining mutator and keep explicit invalidation
     after focus, navigation, modal, or target changes.
   - Keep the browser canaries narrow: non-submit, non-credential draft text; an
     explicit boolean for a clearly local presentation/accessibility
     checkbox/switch/radio; or one exact option on a native single-value
     `select`. Fill requires exactly one `name` XOR `selector` at the edge
     schema, app normalizer/runtime, client request, and bridge target/perform
     layers. The canaries also require bridge-issued process/context/live-
     document/URL identity, a short-lived single-use exact ElementHandle
     capability, durable approval over the privacy-safe target fingerprint
     (never the ephemeral id), a genuine approval receipt, and server-side
     state proof. Direct SwanBot/legacy fill and the separately
     vault/origin-gated credential lane remain compatibility paths; do not
     describe them as sealed by this gateway.
   - Keep native semantic press equally narrow: exact app/PID/accessibility
     generation/path/role/label, a safe semantic classifier, one-shot target,
     revalidation after approval, and exact-target semantic proof. Exclude
     text/value entry, state toggles, modal/consequential controls, coordinates,
     and broad native clicks until they have equivalent contracts.
   - In the local typed/OpenSwan lanes, submit, generic keypress, upload,
     navigation/close, and general desktop/native-app UI mutation remain
     pending. The hosted cloud edge now exact-confirms opaque native
     clicks/typing/keys with screenshot brackets, but that boundary is not the
     local semantic target/ledger proof contract. Native launch/focus has
     exact-name/alias plus PID before/after activation proof, but not
     bundle/path identity or a sealed general native control target.

2. **Durable exact-call action ledger — source-complete 2026-07-26; live migration pending**
   - `src/lib/agentActionCalls.ts`,
     `supabase/migrations/20260726_agent_action_calls.sql`, and
     `docs/RUN_THIS_SQL.sql` §26 now define one authenticated
     claim→start→finish state machine for exact
     user/circle/run/tool-use/action/argument/contract/idempotency identity.
     Direct table writes are revoked; owner read RLS and fixed-search-path
     security-definer RPCs enforce the boundary.
   - A handler can enter only after the exact claim token atomically transitions
     the row to `dispatched`. Verified after-state finishes `verified`; any
     confirmed or ambiguous handler entry without canonical proof finishes
     `outcome_unknown` and is never auto-replayed. The ledger permits `failed`
     only from a still-claimed, never-dispatched row. The guarded runtime leaves
     its pre-handler loser claim reclaimable instead of racing another worker
     with a false failure. Concurrent duplicates cannot overwrite a dispatched
     worker's state.
   - Approval resolution now returns the real approved row id/source, and
     category auto creates an exact durable `auto_approved` audit row before
     dispatch. The browser-canary approval intents bind SHA-256 digests of exact
     normalized args and page URL plus stable opaque target identity, without
     persisting raw draft text, the exact URL, locator, or task context.
   - The 103-assertion ledger smoke plus focused source/runtime-wiring smokes
     verify the ledger and all four integrations. The migration has not been
     applied or exercised
     against a live database in this review, so production cross-process
     suppression remains deployment-pending and must not be advertised as
     live. Missing RPCs fail closed and point operators to migration §26.
   - Preserve `verify_before_retry` versus `never_retry` semantics when handler
     outcome is unknown.
   - Never widen an exact file grant to a parent directory merely because the
     destination does not exist yet.

3. **Structured terminal evidence — four canary receipts 2026-07-26**
   - Carry handler-entry, action receipt, target identity, before/after evidence,
     verification predicate, artifact hashes/stats, and terminal outcome through
     tool results, run events, Chat state, archive, and Office.
   - Run events and run-level tool-call summaries preserve dispatch truth plus
     bounded receipt subsets. The guarded browser fill/toggle/select and native
     semantic-press gateways emit mutation-dispatch and
     computer-app-verification namespaces. SwanBot v2 continuation re-sanitizes
     and persists those hidden client receipts against the exact saved tool
     call without exposing them to the model; every other mutation producer and
     the Chat/Office compact proof-card consumers remain pending.
   - Do not let prose such as "done" complete an app task.
   - Add a compact user-facing proof card while keeping raw paths, screenshots,
     credentials, and large payloads out of persisted chat rows.

4. **Portable connected-agent execution — computer lane partial 2026-07-24**
   - Make SwanBot, OpenSwan, Codex, Claude Code, and Cursor handlers consume the
     same immutable context pack.
   - Chat's real app/file/hybrid execution and capability retry paths now consume
     the pack and persist its bounded run projection. Migrate the remaining
     non-computer SwanBot/OpenSwan/connected-agent entrypoints before calling
     this universal.
   - Permit parallel agents only for read-only or disjoint safe work; serialize
     overlapping files and all side effects.

5. **Bridge and caller convergence — source-complete 2026-07-24**
   - All four execution bridges now share source/Host/Origin checks,
     source-bound one-time challenge pairing, stale-token repair, and bearer
     validation on sensitive routes.
   - The Claude desktop surface now owns exact path grants and the fixed
     read-only git/node exec-file allowlist; shell/environment launchers fail
     closed.
   - Live callers use structured spawn, launch, Stagehand, or diagnostic
     routes, and source smokes reject retired arbitrary `/exec` use. Existing
     default-port bridge processes still need a normal restart to load the new
     source; alternate-port live pairing/route verification is complete.
   - `/desktop diag [app]` is read-only even with an app argument; the app
     target is carried only as a non-executable `desktop.launch_app` typed
     handoff.

6. **Control-surface learning for unfamiliar apps**
   - Discover in order: official app API/automation/plugin/CLI, web DOM/CDP,
     MCP/integration, OS accessibility/menu/keyboard, then bounded vision and
     coordinates.
   - Store only verified recipes with app/version/target prerequisites,
     required grants, approval boundaries, stop conditions, and proof tools.
   - Route missing deterministic capability to
     `agent.build_app_capability`; require focused smokes and a parseable
     ready-to-retry contract before replaying the original task once.
   - Automatic result recovery currently uses Codex and Claude Code because
     those bridges expose dedicated bounded result fields. Add the same strict
     receipt extraction to Gemini/Cursor before admitting them to this lane.

7. **Roadblock and human-boundary handling**
   - Stop on CAPTCHA/human verification, MFA, credential prompts, payments,
     destructive confirmations, ambiguous targets, permissions, licensing,
     unsaved-change dialogs, or stale observations.
   - Surface one exact blocker and smallest safe user action, then resume from
     a fresh observation. Never teach the model to bypass a human or security
     control.

8. **Evaluation and staged rollout**
   - Keep pure contract smokes for routing, policy, transcript closure,
     idempotency, redaction, and outcome truth.
   - Browser fill/toggle/select, native semantic press, and the durable action
     ledger have focused source/unit/action/gateway smokes and app typecheck.
     `computer-use-mutation-handoff` pins all six value-stripped legacy
     mutation handoffs; `chat-recording` pins whole-plan preflight and the
     observation-only replay allowlist; `desktop-diag` pins the read-only
     diagnostic plus typed launch handoff; continuation/readiness smokes pin
     both CAS phases and all three active stop-reason exclusions.
     `computer-use-cloud-policy` pins the required v1/scheduled policy split,
     exact-confirmation/screenshot/one-attempt/redaction/no-replay order, and
     start reservations. `chat-computer-request-router` pins the root Chat
     constraint/floor derivation, while `computer-task-runtime-context` pins
     removal of direct app/attachment pre-agent mutations and the staged
     `desktop.open_path` handoff. The cloud-policy and runtime-context guards,
     plus exact Chat/OpenSwan approval, direct file/image handoff, open-path,
     automation, schedule, Office broadcast, and database-authority guards,
     occur exactly once in all Chat/SwanBot daily and release gates,
     `smoke:all`, and canonical readiness. Add real isolated-browser
     GUI/confirmation integration and an
     actual native-app accessibility run before calling them
     environment-verified.
   - Apply §26 to a test/live Supabase project and exercise concurrent workers,
     crash-after-start, reload/resume, and durable receipt reads before calling
     cross-process suppression production-verified.
   - Apply §27 and exercise scheduler claim races, crash-after-dispatch,
     outcome-unknown presentation, and the exact guarded manual-retry
     transition before calling scheduled mutations production-verified.
   - Apply §28 and exercise Office invoke/response claimant races,
     multi-target completion, protected Chat/OpenSwan approval
     resolution/consume races, and unaffected legacy/scheduled approval rows.
   - Deploy and reverify the updated `swanbot-v2-ai` schema/prompt before
     claiming the select or native semantic route is available from the hosted
     edge loop. The source catalog is aligned, but the latest edge deployment
     remains unverified because this review did not deploy it.
   - Add bridge integration tests on isolated ports and native-app scenarios for
     launch/focus, semantic mutation, modal recovery, artifact proof, uncertain
     outcome, cancellation, and reload/resume. Local app/OpenSwan/Claude
     services were offline during this review, so no live GUI proof was
     collected.
   - Roll the typed client loop from opt-in to cohorts only after duplicate
     side-effect, false-completion, approval-bypass, and stop-condition metrics
     remain at zero.

### Definition of done

The universal computer-agent path is complete only when all of these are true:

1. A natural Chat request reliably selects browser, file, known-app,
   unfamiliar-app, or connected-agent buildout execution.
2. The runtime can identify the exact live target and refuses mutation on
   missing, stale, or changed identity.
3. Every side effect enters through one runtime-owned policy, approval, and
   idempotency boundary.
4. Completion always has fresh structured proof; otherwise the result is
   partial, blocked, waiting for approval, needs input, failed, or cancelled.
5. A missing adapter triggers bounded discovery/buildout and one safe retry,
   not blind coordinate repetition.
6. The user can see what ran, what changed, the proof, the blocker, and the next
   safe action without being exposed to internal secrets or noisy traces.
