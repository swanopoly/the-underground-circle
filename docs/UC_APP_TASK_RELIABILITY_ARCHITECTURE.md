# Universal Computer Task Kernel

> Long-term architecture for completing user-authorized work in browsers,
> desktop apps, local files, and connected services through one durable OpenSwan
> task loop. This document defines the target and records the honest current
> boundary. Canonical file ownership and rollout status remain in
> [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md); the live app map remains in
> [`UC_APP_STACK_REFERENCE.md`](./UC_APP_STACK_REFERENCE.md).
>
> Last reviewed: 2026-08-06.

## Outcome

The target is not a collection of app-specific chat shortcuts. It is one
**Universal Computer Task Kernel** that can:

1. understand the complete user request;
2. select the best available browser, app-native, accessibility, file, or
   connected-service control surface;
3. obtain only the approval that policy requires;
4. give every task, run, and mutation a stable identity;
5. dispatch each authorized mutation at most once for that identity;
6. verify the requested after-state independently of model prose;
7. survive refresh, reconnect, process death, and cross-surface handoff;
8. stop truthfully when the outcome cannot be known; and
9. yield foreground ownership when the human takes it back.

No architecture can guarantee exactly-once effects for every arbitrary app or
external provider after a crash between external dispatch and receipt
persistence. The enforceable contract is:

- one durable claim per exact action identity;
- at most one handler entry for that identity;
- a provider idempotency key when the provider supports one;
- completion only from correlated, fresh after-state proof; and
- terminal `outcome_unknown` plus verification-only recovery when dispatch may
  have occurred but proof is missing.

Automatic replay is never a substitute for proof.

## Current boundary versus target

| Capability | Current source boundary | Target boundary |
|---|---|---|
| Chat admission | `ChatTab` builds one automation plan and computer route; exact Photoshop and strict named-app lifecycle programs are narrow compiler branches. The lifecycle branch requires the originating Chat request identity before desktop access | Every accepted turn receives one stable root task/request identity before approval or execution |
| Typed execution | `agentExecutionCore.runAgent` is the canonical model/tool loop; required local computer tasks use the typed SwanBot client loop | All provider, compiler, scheduled, and connected-agent attempts attach to the same root task and checkpoint protocol |
| Terminal truth | A value-free action-receipt summary now travels from typed SwanBot tool results to `agentRuntime`. `computerTaskOutcome` also contains a runtime-owned, single-use V1 outer-acceptance issuer core for the closed-world Photoshop-dimensions and named-app-frontmost predicates. That core is exercised directly by focused tests but is not wired into Chat, SwanBot, generic task execution, or durable persistence; the ordinary summarizer therefore still emits `taskCompletionVerified:false` and generic tasks remain inconclusive | Every execution path compiles its admitted request into a supported acceptance contract, projects trusted action/final-proof evidence into the issuer, and durably carries the resulting request-bound receipt |
| Mutation authority | §26 `agent_action_calls` protects selected browser/native canaries, `desktop.open_path`, and selected automation/external writes | Every mutating catalog tool declares and uses an explicit action-ledger, provider-idempotency, proposal-only, or unsupported authority |
| Exact Photoshop | The originating Chat message/submission and exact program are fingerprinted before root creation; the matching authenticated root/action is reused across approval/capability re-entry. A feature-off universal-root canary now uses the canonical root run id directly, projects exactly one create mutation when Photoshop is already running and frontmost, advances root plus §26 through combined RPCs, and verifies exact target/document evidence without creating the former child wrapper run. It never launches, focuses, raises, or touches the browser. Claimed refresh recovery reuses/rotates the exact pre-dispatch claim without replay; an early persisted-root fence blocks generic fallback. Final foreground is telemetry only after document proof. All three exact-true rollout flags remain off, so the established path remains active | P0: bridge-verifiable trusted root/action/args/target/revision attestation and durable claimed-action STOP/cancel. P1: a durable receipt for later `outcome_unknown` reconciliation. Production §34 application and a real live canary/contention/recovery pass also precede expansion beyond frontmost single-create |
| Named-app lifecycle | A strict `open`/`launch`/`focus` request is bound to its originating Chat request, an authenticated persisted root, and one §26 activation action. The idempotency key is request-bound so refresh-time app-name canonicalization cannot mint a second activation; exact program drift still fails closed. `open_app` chooses mutually exclusive branches from one fresh observation: launch and bounded wait when stopped, or focus when already running in the background, never both. Explicit focus never launches. A duplicate refresh/retry reuses terminal action state and cannot activate the app again | Extend the same root/action contract to every reversible lifecycle surface and prove concurrent-client, bridge-restart, and human-foreground-override behavior live |
| Manual verification | A source-verified recovery capability is issued only to the original requester for the current task, exact bridge process, and exact target. It permits allowlisted non-activating reads, rechecks task/bridge scope after every await and before persistence, and never marks the task complete | Durable cross-surface verification authority and proof attachment use the same root/action identity after refresh or device handoff |
| Task persistence | `agent_runs` persists execution; `computerTaskState` is a best-effort device-local UI cache keyed once per thread | `agent_runs` is the server-authoritative task ledger; Chat, Office, Feed, Runs, and Monitor render the same root task and actions |
| Resume | SwanBot v2 uses claim-bound continuation CAS; OpenSwan also has transcript checkpoint guidance | Authenticated resume discovery, task leases, monotonic checkpoints, and action-state-derived replay decisions work after refresh or on another surface |
| Universal app reach | App-native and semantic canaries exist, with guarded generic native input and capability buildout. Local `browser.wait_for` and `browser.scroll` require the complete opaque process/context/page/URL identity copied from one fresh DOM snapshot and recheck that exact live page before and after the bounded operation. Scroll dispatches one bounded wheel gesture and completes only from privacy-local requested-axis movement proof | A declared adapter contract covers app-native/API, browser DOM/CDP, accessibility/menu, and separately approved coordinate fallback |
| Production proof | §26 is applied/catalog-verified; its real two-worker contention race is unproven. §34 and its combined root/action RPCs passed disposable PostgreSQL 14 syntax/catalog plus positive/rollback/fault paths but remain unapplied. §§27-29 remain pending unless the SQL checklist says otherwise | Fault-injection, concurrent-worker, two-client, browser, native-app, and provider canaries pass before a tool family becomes default |

“Source-hardened” means source and focused contracts support the claim. It does
not mean the edge was deployed, a migration was applied, a native app was
changed live, or a concurrency race was proven.

## Canonical pipeline

```text
user turn
  -> admission + stable root task claim
  -> planner/router + immutable context pack
  -> policy classification + exact approval authority
  -> executor selection
       -> compiler-owned exact program
       -> typed OpenSwan/SwanBot loop
       -> hosted browser runtime
       -> scheduled/connected-agent worker
  -> per-action durable claim
  -> observe and bind exact target
  -> one bounded target activation when the admitted action requires focus
  -> mark dispatched immediately before one handler entry
  -> control surface
  -> fresh independent after-state proof
  -> finish verified | failed-before-dispatch | outcome_unknown
  -> request-bound task acceptance verification
  -> durable checkpoint + terminal task projection
  -> Chat / Office / Feed / Runs / Monitor reconciliation
```

The planner is not authority. An approval is not proof. A bridge acknowledgement
is not completion. Realtime is not state. Model prose is not a receipt. Initial
requested focus is a bounded action; a later human foreground change is an
interrupt, not permission for the runtime to keep reclaiming focus.

## Canonical ownership

| Concern | Canonical owner |
|---|---|
| Chat transcript, admission, task card | `src/screens/circles/tabs/ChatTab.tsx` |
| Plan and route | `src/lib/chatAutomationPlanner.ts`, `src/lib/chatComputerRequestRouter.ts` |
| Shared dispatch envelope | `src/lib/runChatAutomationPlan.ts`, `src/lib/chatAgentContextPack.ts` |
| Task/run persistence | `src/lib/agentRuntime.ts`, `src/lib/agentRunSystem.ts`, `src/lib/agentRunPersistence.ts` |
| Provider-agnostic loop | `src/lib/agentExecutionCore.ts` |
| OpenSwan session | `src/lib/openswanSessionRuntime.ts` |
| SwanBot routing and typed client loop | `src/lib/swanbot.ts`, `src/lib/swanbotV2BatchRuntime.ts` |
| Tool catalog, policy, approval chokepoint, dispatch | `src/lib/openswanToolRuntime.ts` |
| Exact action ledger | `src/lib/agentActionCalls.ts`, `supabase/migrations/20260726_agent_action_calls.sql`, `docs/RUN_THIS_SQL.sql` §26 |
| Universal root and atomic root/action gateway | `src/lib/computerTaskRoot.ts`, `src/lib/computerTaskRootStore.ts`, `supabase/migrations/20260806_universal_computer_task_roots.sql`, `docs/RUN_THIS_SQL.sql` §34, `scripts/computer-task-root-action-gateway-smoketest.ts` |
| Chat-plan approval | `src/lib/chatApprovalGate.ts` |
| Provider tool-call approval | `src/lib/openswanToolApprovals.ts` |
| Computer outcome and proof | `src/lib/computerTaskOutcome.ts`, `src/lib/computerTaskEvidenceContract.ts`, `src/lib/computerTaskEvidenceRecovery.ts` |
| Exact deterministic programs | `src/lib/computerTaskRuntime.ts`, `src/lib/computerSequenceProgramCore.ts`, `scripts/photoshop-root-action-canary-smoketest.ts` |
| Device-local task projection | `src/lib/computerTaskState.ts`, `src/lib/computerTaskStateModel.ts` |
| Browser runtime | `src/lib/computerUseAgent.ts`, `src/lib/useComputerUseTask.ts`, `supabase/functions/computer-use-agent/index.ts` |
| Missing-capability buildout | `src/lib/computerCapabilityRegistry.ts`, `src/lib/computerCapabilityExpansion.ts`, existing connected-agent buildout path |

Extend these owners. Do not add another router, tool registry, approval table,
or task engine for universal computer work.

## Identity model

The kernel needs three identities with different lifetimes:

### Root task identity

One UUID is created when Chat or another surface accepts the user's turn. It is
stable across approval waits, refresh, provider attempts, capability buildout,
and safe recovery. The root `agent_runs.id` should become this identity, or be
atomically bound to it through an immutable `request_id`.

The binding includes authenticated user, circle, thread, normalized request
fingerprint, and creation source. A collision with different immutable fields
fails closed.

The v2 Chat writer now enforces this thread boundary in source. A fresh request
can carry only the active thread from authenticated client context; the edge
authorizes that exact user/circle/thread before model or tool work, persists the
thread identity inside the encrypted continuation snapshot, and restores it on
resume. `messages.create` refuses a missing thread or a model-supplied mismatch
and writes `thread_id` only from the pre-authorized context. This closes the
source seam that could produce `messages?select=id` HTTP 400 failures or route a
service-role write to the wrong/default thread. It remains source proof until
the current edge is deployed and exercised against live §31 thread authority.

### Run/attempt identity

Provider attempts, compiler attempts, subagents, and resumptions are run rows
linked through `parent_run_id` and an explicit root identity. Retrying a failed
provider may create a child attempt; it must not create a second root task or
forget prior mutation states.

### Action identity

Every mutation receives one immutable identity before dispatch:

```text
root run + attempt run + call source + call id + action index
+ tool + exact args fingerprint + authorization-contract fingerprint
+ idempotency key
```

Provider-issued `toolUseId` values remain authoritative for model calls.
Compiler-owned calls use an explicit compiler namespace rather than pretending
the model issued them. Raw paths, selectors, text, credentials, and content do
not enter the durable identity row.

## Structured terminal receipt seam

The first kernel slice closes the string-only **action-evidence transport** gap
for typed SwanBot computer tasks. It does not by itself prove that the user's
whole request was accepted as complete.

`src/lib/computerTaskOutcome.ts` owns
`ComputerTaskTurnEvidenceSummary`. `swanbotV2BatchRuntime` and SwanBot edge
continuations reduce runtime-owned `tool_call_result` evidence into this
bounded, value-free summary. `getSwanBotTurnResult` carries the summary while
`getSwanBotResponse` remains the string compatibility wrapper for ordinary
chat. `agentRuntime` passes the summary into
`deriveAgentTaskTerminalOutcome` and retains it as `taskTurnEvidence`.

The generic turn summarizer always sets `taskCompletionVerified: false`. A fully
correlated action set is recorded as `mutationIntegrity: 'verified'` with
`reasonCode: 'actions_verified_task_proof_missing'`, while the task status stays
`inconclusive`. `structuredAgentTaskStatusFromTurnEvidence` may propagate
runtime failure/cancellation, but it cannot promote completion unless a
runtime-issued outer-acceptance result supplies both the completed status and
the explicit task-acceptance bit.

An action-evidence summary can report that its mutation set is internally
verified only when:

- the loop reached a clean terminal boundary;
- every tool result succeeded;
- at least one mutation-dispatch receipt exists;
- every dispatched mutation has a verification receipt with the same action id;
- its before epoch matches the dispatch epoch;
- it has a fresh after epoch and at least one evidence item; and
- it reports `canComplete: true` with no blocker or outcome-unknown result.

An earlier proof cannot cover a later mutation. A bridge acknowledgement,
model assertion, malformed receipt, mismatched action, failed final read,
continuation cap, early stop, or prose-only response remains inconclusive.
Cancellation and runtime failure keep their structured terminal meaning.

That summary is **action-level evidence**, not task-level acceptance proof. A
successful click, field update, document creation, or even a set of verified
mutations does not prove that the complete user request, ordering, requested
output, and final acceptance predicate were satisfied. Generic computer runs
remain task-level `inconclusive` until the separate runtime-owned acceptance
core is integrated into their execution path and issues a matching receipt.

That V1 core now exists in `computerTaskOutcome.ts`. It can:

- compile an immutable contract from one SHA-256 root-request fingerprint, an
  exact ordered action manifest, and a closed-world predicate set;
- independently enforce the mutation classification of its small supported tool
  registry instead of trusting a caller-supplied flag;
- issue only the next ordered action as an opaque, WeakSet-branded, single-use
  claim whose issuance and sealing are synchronously reserved across awaits;
- bind each trusted action envelope to that exact claim plus the root, contract,
  action id, tool, and exact tool-argument fingerprint;
- evaluate only `photoshop.active_document_dimensions_exact` and
  `desktop.named_app_frontmost` from typed app observations;
- require final predicate evidence to be fresh, unexpired, unique, and later
  than every planned action and mutation verification; and
- reserve and consume one in-process contract/action/evidence set so concurrent
  calls cannot claim or seal the same action twice or mint duplicate receipts
  from the same objects.

Its output is an immutable, value-free `ComputerTaskAcceptanceReceiptV1` bound
to the root, acceptance contract, exact ordered action/evidence digests, typed
predicate ids, and final evidence time. Only the runtime-issued in-process
receipt object can upgrade its exact matching evidence summary; a caller-shaped
binding, plain/JSON-cloned action claim, cross-contract or out-of-order claim,
unknown tool/predicate, reordered or reused evidence, stale proof, or
fingerprint mismatch fails closed.

The outer task acceptance receipt must bind at least:

- the stable root task/request identity;
- the immutable acceptance-contract fingerprint derived from the admitted
  request and plan;
- the complete ordered action-id set or its digest;
- fresh final observation/proof identities collected after the last mutation;
- the verifier and accepted terminal predicate; and
- the acceptance timestamp and schema version.

The model cannot author or upgrade this receipt. An action summary may support
the verifier, but it cannot substitute for the outer receipt. The issuer core
is not yet called by Chat, SwanBot, `agentRuntime`, deterministic lifecycle or
Photoshop execution, recovery, or persistence, and its in-process brands are not
durable across reload/process restart. Therefore generic typed computer turns
remain inconclusive even when all currently visible mutation receipts
correlate. Compiler-owned exact programs may continue to use their existing
closed-world typed result only for the narrowly compiled request. The exact
Photoshop canary fingerprints the
originating Chat message/submission plus the exact program, persists and reuses
that request-bound root/action across approval or capability re-entry, and uses
§26 for dispatch. Missing, legacy, or mismatched request identity fails before
root creation and before desktop access. A separately submitted user message is
intentionally a distinct request/root; source does not coalesce independently
admitted submissions or prove live contention.

`agentRunPersistence` allows only bounded receipt identity/status fields and
rejects uncorrelated or incoherent verified receipt pairs. The summary contains
counts and a reason code, not tool arguments or user values.

Current limitation: action-evidence transport is wired, while outer-acceptance
issuance is only a pure in-process core plus focused tests. No production caller
yet assembles its contract, branded action evidence, and final predicate
evidence or persists/rehydrates its receipt. It also does not give uncovered
mutations durable one-shot identity. Tools without the complete action receipt
pair remain unverified, and generic tasks without a runtime-issued outer receipt
remain inconclusive.

## Action state machine and recovery

The existing §26 state machine is the mutation authority:

```text
claimed -> dispatched -> verified
                    \-> outcome_unknown
claimed -> failed                 # only before dispatch
```

Rules:

- Claim only after target observation and required approval are current.
- Atomically mark `dispatched` immediately before the one mutating handler
  entry.
- A competing worker that loses start never enters the handler.
- A post-start exception can finish only `outcome_unknown`, never `failed`.
- `verified` duplicate calls return prior proof and do not dispatch again.
- `dispatched` and `outcome_unknown` permit read-only verification only.
- An expired, still-undispatched `claimed` row may be reclaimed.
- A known pre-dispatch failure needs a fresh observation and new action
  identity if recovery is still appropriate.

The feature-off §34 extension supplies the atomic universal-root/§26 boundary
for a root action. `claim_computer_task_root_action_v1`,
`start_computer_task_root_action_v1`, and
`settle_computer_task_root_action_v1` lock the exact root before its action
row, derive the complete §26 identity from the locked root/action (including
the canonical root `runId`), and advance both ledgers in one transaction. One
root mutation action maps to one §26 row. Settlement may also complete or fail
the root in that transaction. A narrow exact-proof path may reconcile matching
root and §26 `outcome_unknown` state to `verified`; the generic §26 finish RPC
remains unchanged and immutable after `outcome_unknown`.

Refresh recovery for an exact current `claimed` root does not replay its
planned-to-claimed transition: it returns the still-live token without a root
revision bump or rotates an expired token server-side. The owning attempt,
acceptance, dispatch binding, and foreground lease must remain executable.
Claim/start/settle use a fresh database clock after the root lock; start rejects
expired claims or leases and settle reports an exact token mismatch. Root
transition RPCs reject STOP or human override while an action is
`claimed`/`dispatched`/`outcome_unknown`, preventing root-only terminalization.
That rejection is intentionally fail-closed, but it is not yet a durable STOP
workflow: no atomic operation settles a claimed §26 row as failed while
cancelling the root, and no durable stop intent survives a lost local signal.

`computerTaskRootStore` exposes that boundary only for its runtime-issued
database binding. Memory bindings and structural/JSON clones fail closed. A
mutating handler receives a one-shot in-process authority only from the exact
`started` response, and consuming that authority twice fails. This brand is an
in-process dispatch guard, not trusted server admission or signed proof. The
sole Photoshop call wrapper recomputes the tool arguments and consumes the
authority against the exact database binding, action, tool, args, foreground
target, and root revision immediately before bridge entry. The bridge still
does not independently receive or validate a trusted attestation.

For providers with idempotency support, send the kernel idempotency key and
persist only a safe receipt/digest. Provider idempotency supplements the §26
claim; it does not replace target observation or proof.

## Policy category matrix

The action category determines approval, mutation authority, proof, and replay.
Tool names alone must not silently weaken policy.

| Category | Examples | Approval | Authority | Completion proof | Replay posture |
|---|---|---|---|---|---|
| Observation | screen/status/DOM/a11y/file stat/read/search | None unless the data itself is protected | Authenticated scoped read | Fresh read receipt | Bounded retry allowed |
| Reversible lifecycle | launch/focus/raise exact app, open non-sensitive view | Direct request or authenticated exact tool call | Target-bound lifecycle contract; ledger when side-effect ambiguity matters | Exact process/window/frontmost after-state | Retry only when fresh state proves the effect absent |
| Bounded local draft | one unsaved blank document within declared limits | Direct request may be sufficient for a closed-world compiler program | §26 action claim before mutation | App-native document identity and exact dimensions/state | No replay after dispatch without verification |
| Local content mutation | type, click, set value, edit file, create/rename/copy | Exact plan/tool approval according to risk | §26 action ledger | Correlated same-target after-state or file digest/stat | Verify before any new action |
| External reversible write | update connected record, create draft | Exact one-use approval unless standing policy explicitly covers it | §26 plus provider idempotency where available | Provider read-after-write and stable object id | Provider-aware; ambiguity remains unknown |
| Communication/publish | send, post, publish, invite, submit | Explicit exact approval | §26 plus provider idempotency | Sent/published object identity and status | Never automatic after ambiguous dispatch |
| Credential/auth/payment | credential fill, login, purchase, transfer | Explicit user confirmation at the final sensitive boundary | Dedicated vault/origin/amount binding plus ledger | Independent authenticated/provider receipt | No automatic replay |
| Destructive | delete, overwrite, trash, flatten, irreversible transform | Explicit destructive approval | Exact ledger and target/version binding | Fresh absence/version proof or provider receipt | No automatic replay |
| Coordinate fallback | raw click/drag/scroll on observed target | Separate fallback approval when a mutation is possible | Sealed app/window/bounds/coordinates and §26 | Fresh screenshot/a11y/app proof attributable to the call | Unknown on ambiguous movement; never guess |
| Capability buildout | create or repair an adapter/skill | Approval for the build proposal, not implicit authority for the user's original mutation | Existing connected-agent buildout run | Source diff, checks, capability re-audit | Original task resumes only through a fresh normal action claim |

Circle policy may make a category stricter. It may not bypass identity,
target binding, dispatch marking, or proof.

## Universal mutation gateway

Every catalog entry with `mutatesState: true` must declare one of:

```text
action_ledger | provider_idempotency | proposal_only | unsupported
```

It must also declare:

- risk and approval category;
- observe-before contract;
- exact target/actionability binding;
- proof verifier;
- outcome-unknown policy;
- redaction boundary; and
- allowed recovery operations.

A catalog coverage smoke must fail when a mutating tool has no declared
authority. The runtime chokepoint should apply the shared envelope centrally;
per-tool handlers supply preparation, one dispatch closure, and proof parsing.
They must not reimplement claim/start/finish logic independently.

Current durable coverage is deliberately partial. Selected sealed browser and
native mutations, `desktop.open_path`, and selected automation/external writes
use §26. App-native Adobe/CAD writes and several browser/file/workspace/provider
mutations still need migration. Compiler-owned Photoshop creation is the narrow
request-bound §26 canary: the same admitted submission retains identity across
approval/capability re-entry, while a new explicit submission is a new request.
Missing identity fails before root creation or desktop access. Unknown coverage
fails closed before any universal/default claim.

## Browser execution track

Browser work uses two related but distinct runtimes:

- local typed browser tools through the canonical OpenSwan runtime; and
- hosted Browserbase/Anthropic Computer Use through `computer-use-agent`.

Both must converge on the kernel contract:

1. bind browser process/context/page/frame and URL origin;
2. take a fresh DOM/screenshot/actionability observation;
3. apply exact-call approval and policy;
4. claim/start one action before click/type/key/upload/credential/submit;
5. use semantic DOM/CDP first;
6. verify with a fresh DOM/provider/screenshot predicate; and
7. seal ambiguous post-dispatch outcomes without automatic replay.

The local source now enforces the exact-page part of this contract for
`browser.wait_for` and `browser.scroll`. Both accept only the complete opaque
browser-process, context, page, and process-HMAC URL identity from one fresh
`browser.dom_snapshot`; the bridge retains the concrete page reference and
rechecks the active page, process, context, page id, and opaque URL before and
after the bounded operation. Tab changes, close, navigation, same-URL reload
(whose page id rotates), SPA URL drift, and bridge restart fail closed. Element
waits use one exact ARIA role/accessibility-name pair directly—CSS-looking names
cannot fall through to selector parsing. Scroll accepts only semantic direction
plus `small`/`medium`/`large` and dispatches exactly one bounded wheel gesture.
The bridge keeps the before/after viewport position privacy-local and may take
up to three read-only settle samples after that single gesture; it never scrolls
again while verifying. Success requires `movementVerified:true` on the requested
axis. No movement, including an already-reached viewport boundary, returns
`browser_scroll_verification_failed`; recovery is a fresh DOM snapshot or
screenshot before deciding whether another bounded action is safe, never blind
replay. The returned receipt contains opaque identities, time/evidence id,
`urlMatchesExpected:true`, semantic direction/amount, and the movement
attestation—not raw URL, title, element name, page text, coordinates, deltas, or
viewport geometry. This is source and focused-smoke coverage; the current
edge/client bundle and live browser behavior still require deployment and a real
canary.

Browser mutation logs and model history must not retain typed values,
credentials, uploads, or raw receipts. Hosted cloud runs remain a separate
deployment and live-validation boundary even when their task projection shares
the root ledger.

`browser.fill_credential_field` now has one schema/runtime contract across the
app and v2 edge: `credentialField` plus exactly one non-empty saved-login
source, either circle-vault `credentialId` or 1Password `item`. Neither, both,
blank sources, extra properties, and OTP-like fields fail before approval or
browser dispatch; the runtime repeats the XOR check at handler entry. The
parity smoke runs through the existing v2 edge-fill release gate.

## Native-app execution track

Control surfaces are ordered:

1. app-native DOM/API/UXP/Apple Event/plugin surface;
2. document/object model or app scripting bridge;
3. accessibility tree and semantic controls;
4. menus and keyboard shortcuts;
5. bounded screenshot/coordinate input under a separate fallback contract;
6. connected-agent capability buildout when no safe surface exists.

Every mutation binds the exact app, PID/process identity, window or document,
observation epoch, and target fingerprint. A focus check performed in one
process cannot authorize input later in another process without revalidation.
Coordinates must remain inside sealed live bounds.

### Foreground ownership and human interruption

Foreground focus is leased only for the bounded action that needs it. When the
admitted request requires a target app to become frontmost, the runtime may
activate that exact app once at the action boundary and must prove the resulting
process/window identity. It must not run a timer, observation loop, retry loop,
approval poll, or Chat progress renderer that repeatedly raises the target or
the OpenSwan browser.

After that activation epoch, a foreground change that was not caused by the
currently dispatched action is a human override. The target coordinator records
a `user_foreground_override` interrupt against the root/action checkpoint and:

- pauses before any undispatched mutation and requires explicit resume;
- never focuses the target again merely to keep the task moving;
- preserves `dispatched` or `outcome_unknown` as verification-only when an
  effect may already have occurred; and
- allows read-only background verification only when it does not steal focus or
  synthesize input.

Initial focus explicitly requested by the user is therefore distinct from a
later human decision to work in Terminal, another app, or another browser tab.
STOP and human foreground override both outrank automation continuity.

`computerForegroundOwnership.ts` now implements this as a pure, runtime-
branded, in-process one-action lease core. It binds an exact native app/PID/
window or browser process/context/page/opaque-URL target, reserves one activation
before handler entry, requires exact post-activation proof, and makes STOP,
expiry, failed activation proof, or human override irreversible and
verification-only. It contains no focus, launch, timer, or polling side effect.
Production wiring and durable compare-and-set persistence remain pending; the
core alone does not change live focus behavior. The generic app navigator's
recovery contract now enforces the same immediate product rule: after its one
request-authorized activation, changed foreground state pauses the workflow in
verification-only mode and requires an explicit resume instead of instructing
the agent to refocus or relaunch. That source guidance closes the previous
model-planning retry loop, but exact runtime lease wiring is still required.

The strict named-app lifecycle compiler is the current bounded source canary.
It persists/reuses an authenticated root and claims one request-bound §26
activation action before entering the native adapter. For `open_or_launch`, the
immutable manifest contains two mutually exclusive conditional branches:
launch plus bounded wait only when the initial observation says stopped, or
focus only when it says already running in the background. The adapter receives
one `open_app` semantic primitive and cannot perform launch followed by focus in
the same request. Explicit `focus` blocks when the app is stopped. A terminal
ledger row makes a refresh/retry observation-only; the same originating request
cannot activate again. Because the idempotency key excludes refresh-sensitive
app canonicalization, a post-launch spelling/case change resolves the prior
owner and then fails closed on exact program drift instead of issuing a second
activation. This behavior has source/focused-smoke coverage, not a live
multi-client contention, bridge-restart, or foreground-override proof.

The separate compiler-generated exact Photoshop drill was run once against a
freshly restarted local bridge on 2026-08-06. It dispatched one create, proved
`Untitled-4` at 600x600 with `Adobe Photoshop 2026` frontmost, recorded zero
browser invocations, and five subsequent OS foreground samples remained in
Photoshop. That is useful bridge/app proof for the closed-world Photoshop
program. It is not a canonical Chat lifecycle, duplicate-refresh, competing
client, human-override, browser wait/scroll, hosted-edge, or production-site
canary.

App-native proof is preferred: document status, object/layer inventory,
selection/value state, export receipt, or file digest. Accessibility movement
alone is not attribution; dynamic apps can change with no agent action.

## Capability buildout track

Missing capability is not a reason to bounce the user through repeated retry
cards. The kernel should:

1. record the exact missing observe/mutate/verify capability;
2. select the existing connected-agent buildout owner;
3. create a bounded proposal with source references and tests;
4. obtain approval for that proposal;
5. run the build as a child of the root task;
6. re-audit the capability; and
7. resume the original task through a fresh action claim.

The buildout approval authorizes code/capability work only. It never authorizes
the original app mutation. Capability retries must preserve root identity and
must not replay any prior dispatched action.

## Durable task ledger and cross-surface resume

`agent_runs` should remain the task backbone; do not create an independent task
store for computer automation. A future migration/RPC layer should provide:

- immutable request/root/thread binding;
- `root_run_id` for attempts and subagents;
- state version and compare-and-set transitions;
- execution epoch plus bounded lease owner/expiry;
- replay policy and mutation state;
- monotonic checkpoint/event sequence; and
- authenticated discovery of resumable work.

The existing Kanban `task_id` must not be overloaded for Chat task identity.
Non-atomic metadata merges and `max(step_index)+1` event allocation are not
sufficient as orchestration authority.

Resume decisions derive from durable action state:

| Last durable action state | Allowed resume |
|---|---|
| No action claim | Re-observe and continue planning |
| Expired `claimed`, never dispatched | Reclaim after policy and freshness checks |
| `dispatched` | Verification only |
| `verified` | Reuse prior result and continue after that action |
| `outcome_unknown` | Verification/manual review only |
| Pre-dispatch `failed` | Re-observe and issue a new action identity if safe |

`computerTaskState` remains a local render cache. On load, Chat and Office must
reconcile it against authoritative run/action rows. Realtime only wakes that
read. It does not carry authority.

## Phased implementation plan

### Phase 0 — contract and inventory

- [x] Keep this document, the roadmap, stack reference, and `CLAUDE.md`
  aligned for the 2026-08-06 source checkpoint.
- [x] Add the closed-world mutation authority/proof/replay manifest and coverage
  smoke. The current catalog classifies all 215 tools: 89 read-only, 20
  action-ledger, 3 proposal-only, and 103 explicitly unsupported mutations.
- [x] Define stable root/run/action identity types without a new parallel
  execution engine.

### Phase 1 — terminal receipt seam

- Carry `ComputerTaskTurnEvidenceSummary` through typed SwanBot returns.
- Preserve the ordinary string API as a compatibility wrapper.
- Treat correlated action receipts as necessary evidence, never as whole-task
  acceptance.
- Persist only the bounded value-free summary and approved receipt fields.

Current claim: source implementation and focused contract coverage. No new
deployment, database, or live app claim follows from this phase alone.

### Phase 2 — stable root identity, task acceptance, and compiler canaries

- [x] Persist or reuse the authenticated request-bound root before desktop
  access for each exact Photoshop submission.
- [x] Bind compiler-owned Photoshop creation to §26 with a compiler call source,
  then permit only read-only proof after dispatch ambiguity.
- [x] Prove source-level same-root duplicate/no-reentry and post-start
  outcome-unknown behavior.
- [x] Bind the originating Chat message/submission fingerprint into the exact
  program, root, and action; preserve it across approval/capability re-entry and
  fail closed before root creation/desktop access when it is missing or drifts.
- [x] Preserve the admitted-submission identity and exact approval correlation
  across a full Chat-tab refresh. Hydration, bounded polling, and Realtime all
  requery the exact authenticated row; event payloads never authorize dispatch.
  The normal approval gate re-fingerprints and wins one-shot consume before the
  correlation clears and the handler may dispatch.
- [x] Bind strict named-app lifecycle work to its originating request, a
  persisted authenticated root, and one §26 activation action. Keep launch and
  focus mutually exclusive, reuse terminal action state across refresh/retry,
  and make refresh-sensitive app-name canonicalization fail closed instead of
  minting a second activation.
- [x] Implement the pure runtime-owned V1 outer-acceptance core: immutable
  root/action/predicate contracts, ordered opaque single-use action claims,
  branded value-free action and predicate evidence, fresh final-proof ordering,
  concurrent claim/seal/issuance reservation, and one matching
  receipt-to-summary upgrade. Plain or JSON-cloned claims, copied binding
  strings, cross-contract/out-of-order/reused claims, and concurrent double
  sealing fail closed. Initial predicates are exact active Photoshop dimensions
  and exact named-app frontmost state.
- [x] Implement the pure universal V1 root coordinator and strict store. Chat
  admits and revalidates it before planner, bridge, file, approval, or provider
  work. The compatibility binding remains memory-local; the durable binding is
  runtime-branded, RPC-backed, revision-CAS, and feature-flagged off until §34
  is applied and live-proven. Every locally applied transition self-rehydrates;
  the durable store also rehydrates and exact-byte-compares the returned RPC
  snapshot before issuing a new runtime binding.
- [x] Add one immutable per-action dispatch binding to the pure coordinator and
  §34 source contract. It records the acceptance-owning attempt kind as source,
  exact call/policy/verifier/replay fingerprints, authorization category, and
  mutation authority. One bind resumes a waiting root; bind, foreground lease,
  claim, and dispatch require that owning attempt active, the owning attempt
  cannot generic-finish, and `proposal_only`/`unsupported` never claim.
- [x] Make imported snapshots enforce the ordered action frontier: a verified
  prefix, at most one non-planned frontier action, and an all-planned suffix.
  Nonterminal acceptance keeps its owner active; active leases match one exact
  mutable foreground action and legal root/action state. In verification-only
  mode, an `outcome_unknown` action has only the proof-backed `verified`
  successor, and an explicit lease release remains legal so recovery cannot
  retain app focus.
- [x] Add the feature-off pure `projectPhotoshopNewDocumentMutations` slice.
  It strictly revalidates the canonical five-step Photoshop program, then maps
  fresh state to exactly one mutation branch: stopped launch -> create,
  background focus -> create, or frontmost create. Status steps remain
  document-baseline/final-proof predicates only; fresh `desktop.observe_app`
  receipts own exact Photoshop identity, positive PID, same-PID continuity,
  and frontmost truth. Creation proof requires a `created:true` receipt with
  exact document name/count, a count increase from the fresh baseline, final
  active name matching the receipt, exact dimensions, and same-PID frontmost
  proof. The projection and every mutation are immutable
  `projectionOnly:true` data and invent no fingerprint.
  `requiredMutationAuthority:'action_ledger'` declares a future requirement,
  not authority already held. Launch/focus/create stay `unsupported` in the
  canonical runtime manifest until their §26 gateways migrate. Proxy input is
  deliberately out of scope; any future external boundary must provide a
  sanitized plain clone. The adapter then emits a deeply immutable, value-free
  requirement artifact—not a root acceptance draft or bound dispatch—with
  `projectionOnly:true`, `readyForRootBinding:false`, and per-action
  `readyForDispatchBinding:false`. It recomputes the canonical program
  fingerprint, collision-checks every request/program/predicate/action/binding
  fingerprint, and sets each canonical `toolArgsFingerprint` to the real
  gateway SHA of normalized handler arguments alone. Trusted authorization and
  proof receipts remain explicitly required for every action, including a
  direct user request, pending trusted gateway attestation. The artifact
  retains no raw app name, width, height, or receipt values, is structurally
  incompatible with the strict root-acceptance and dispatch-binding field
  sets, and holds no authority. Its focused smoke has 150 assertions.
- [x] Carry the durable root's seven-field inert correlation pointer through
  browser plan cards, local sessions, cloud request construction, and saved
  Chat plan/session metadata. Unknown keys, accessors, malformed fingerprints,
  and authority-bearing copies are discarded; the pointer cannot dispatch.
- [ ] Prove cross-process restart and competing-client paths preserve that same
  admitted-submission identity. A new explicit user submission intentionally
  receives a distinct request/root rather than being text-deduplicated.
- [ ] Extend that stable identity beyond the current Chat/browser projections
  into Office, Feed, Runs, Monitor, capability retries, and every child run.
- [ ] Wire the outer-acceptance core into the admitted Chat/compiler/typed-loop
  task families, project real trusted action/final-predicate evidence into it,
  and persist/rehydrate the value-free receipt across process boundaries.
- [x] Wire a feature-off frontmost-only Photoshop root/action canary. It accepts
  only Photoshop already running and frontmost, projects exactly one create
  mutation, uses root A's canonical run id without a child wrapper B, creates
  one §26 row for that root action, and never launches, focuses, raises, or
  touches the browser. The fresh target binds exact app, positive PID,
  CGWindow id, and window bounds; the bridge rechecks that guard immediately
  before JSX execution. Completion requires the app-native baseline, the
  correlated create receipt, and final status to agree on positive document
  identity, one-count growth, and exact dimensions. A final foreground sample
  is telemetry only, is excluded from the proof digest, never refocuses the
  app, and cannot downgrade exact app-native proof. Ambiguity after start is
  verification-only and never replays. All three exact-true rollout flags
  remain off, and no live Photoshop mutation, production SQL application, or
  deployment was part of this source slice.
- [x] Add root-row-first combined transactional RPCs that advance root and §26
  together through claim, start, settlement, and optional same-transaction
  completion/failure. Identity is derived from the locked root/action,
  including canonical root `runId`. The exact reconciliation path advances a
  matching root and §26 `outcome_unknown` to proof-backed `verified` together;
  generic `finish_agent_action_call` remains unchanged and immutable after
  `outcome_unknown`.
- [x] Make the TypeScript root/action gateway database-binding-only and issue a
  one-shot handler authority only from an exact `started` response. Memory
  bindings, plain clones, duplicate/prior dispositions, and authority reuse
  fail closed.
- [x] Realize the projected requirement fingerprints in the runtime acceptance
  and dispatch bindings. Refresh recovery reuses the executable owning attempt,
  exact acceptance/dispatch identity, and live claim token without a root
  revision bump, or rotates an expired claim token server-side. A stale or
  changed same-action foreground target releases and freshly rebinds its lease
  after exact observation; a lease owned by another action still fails closed.
- [x] Fence every persisted non-admitted root before clarification or generic
  fallback, including a waiting root with zero attempts. TypeScript and SQL
  reject STOP or human-foreground-override transitions that would strand a
  claimed action; claim/start/settle use fresh post-lock clocks and exact token
  checks.
- [x] Bind the one-shot in-process authority to the exact database binding,
  action, tool, normalized-args fingerprint, foreground target, and root
  revision. The sole Photoshop call wrapper recomputes args and consumes that
  authority immediately before bridge entry; clone, drift, and reuse fail.
- [ ] **P0:** Add bridge-verifiable trusted root/action/args/target/revision
  attestation. The local wrapper closes the in-process binding gap but the
  bridge does not independently receive or validate that authority.
- [ ] **P0:** Add a durable STOP intent or one transaction that fails the claimed §26
  action and cancels the root. Today unsafe root-only STOP is correctly
  rejected after claim, but a lost local abort signal has no durable requested-
  stop state.
- [ ] **P1:** Persist enough trusted bridge correlation to drive the existing narrow
  `outcome_unknown -> verified` reconciliation after refresh. Current recovery
  is read-only/manual-verification text and never replays, but it cannot attach
  later exact proof to both ledgers.
- [x] Mirror the source canonical serializer in PostgreSQL and recompute the
  request/root/attempt/action/idempotency/acceptance/per-action
  acceptance-binding SHA-256 chains. Source and disposable PostgreSQL 14
  canonical vectors match. Task, tool-argument, authorization, policy,
  verifier, and replay fingerprints intentionally remain caller-supplied
  privacy-safe leaf digests.
- [ ] Add trusted server admission or signed attestation for those leaf digests
  before they can participate in runtime authority. A structurally and
  cryptographically self-consistent root remains inert without that boundary.
- [ ] Pass live two-worker contention and crash-after-start fault injection.

Do not widen the exact-program family before durable same-submission identity
propagation and live contention pass.

### Phase 3 — universal mutation gateway

- Migrate all browser, native, file, app-native, workspace, and external writes.
- Add provider idempotency keys and receipt digests where supported.
- Block unclassified mutations and direct bypasses.
- [x] First add an exhaustive per-tool `mutationAuthority` manifest
  (`action_ledger`, `provider_idempotency`, `proposal_only`, `unsupported`, or
  `not_applicable`) and fail before approval when an enforced mutation is
  unclassified.
- [x] Keep generic §26 claim/start/finish parsing in `agentActionCalls.ts` and
  add the database-bound combined root/§26 gateway in
  `computerTaskRootStore.ts`. The generic ledger contract is unchanged; the
  combined gateway is scoped to an exact durable root action.
- [x] Migrate `browser.open_url` as the first uncovered reversible canary, with a
  paired lifecycle observation/capability for both warm and cold browser
  contexts. Cold start may create one context and perform one navigation only
  after rechecking that no context existed; navigation proof must explicitly
  model page-identity rotation instead of weakening same-target verification.

### Phase 4 — durable coordinator and approvals

- [x] Add the inert V1 Chat plan-to-tool manifest source contract: at most 32
  ordered actions, exact root/request/tool+args/current-policy digests, no raw
  args or policy values in persistence, immutable entries, and a monotonic
  `final_confirmation` suffix beginning at the first hard floor or unknown
  classification. Build/validation proves only canonical integrity; it never
  issues dispatch authority.
- [x] Add the source migration and authenticated store for request-bound root
  admission/read plus server revision-CAS transitions, bounded attempts,
  foreground leases, monotonic checkpoints, STOP/override latches, and inert
  refresh pointers. §34 is not applied and durable mode remains off, so this is
  not yet production resume authority.
- [x] Extend the source root/§34 transition contract with the one-time action
  dispatch binding and active-owning-attempt gates. The binding carries
  attempt-kind source, exact call/policy/verifier/replay fingerprints,
  authorization category, and mutation authority; it resumes waiting roots,
  while proposal-only/unsupported bindings remain permanently non-claimable.
- [x] Wire one compiler-attempt ownership claim at the trusted exact Photoshop
  and strict named-app lifecycle boundaries after authority/preflight/request
  validation and before child-run creation. A losing claim blocks before child
  creation or desktop activation; a child-creation failure best-effort closes
  the attempt. Those legacy gates alone infer no post-dispatch completion; the
  separate feature-off frontmost canary below owns its exact root settlement.
- [x] Recompute all non-leaf request/root/attempt/action/idempotency/acceptance
  and per-action acceptance-binding identities in PostgreSQL using the same
  canonical JSON and SHA-256 chain as the source coordinator.
- [ ] Add trusted server admission or signed attestation for caller-supplied
  task/tool-argument/authorization/policy/verifier/replay leaf digests. The root
  is coordination state and remains non-authorizing without this boundary.
- [x] Wire one feature-off root-bound runtime action/completion canary for the
  already-frontmost Photoshop single-create branch. It uses the canonical root
  run id, no child wrapper, and the combined root/§26 gateway. This is source
  wiring only. Exact in-process handler authority is value-bound and consumed
  inside the sole bridge-call wrapper, but bridge-verifiable attestation and
  live proof remain pending.
- [x] Implement the root-first combined root/§26 RPC boundary for that canary.
  Preserve generic §26's immutable `outcome_unknown`; only the exact proof- and
  target-bound reconciliation path advances both ledgers atomically.
- [ ] Add authenticated resume discovery and competing-client behavior after
  §34 is applied, then extend attempt/action projection beyond those two
  compiler-owned families.
- [ ] Add durable STOP/override intent with an atomic claimed-action
  cancellation race, plus durable bridge correlation for read-only
  `outcome_unknown` verification/reconciliation after refresh.
- Link Chat-plan and tool-call approval authority through root/run/action
  identity while retaining the two existing tables for compatibility.
- Remove dependence on process-memory approval continuity after refresh.
- Add a new post-§26 acceptance migration for immutable root/request/manifest
  digests, ordered action bindings, value-free final receipts, versioned CAS,
  authenticated rehydration, and concurrent single-use finalization. A database
  row or JSON copy is inert until an authenticated store validates and rebrands
  it in the current runtime.

### Phase 5 — browser and native breadth

- Complete browser navigation/upload/credential/submit proof paths.
- Expand app-native adapters and semantic native workflows.
- Gate coordinate fallback separately and require attributable proof.
- Route missing surfaces into capability buildout rather than generic retries.

### Phase 6 — cross-surface product

- Render one root task in Chat, Office, Feed, Runs, and Monitor.
- Provide the same Stop, Approve, Verify, and Recovery operations everywhere.
- Preserve immutable task/action history while suppressing stale affordances.

### Phase 7 — production fault-injection and default rollout

- Test two clients/workers, refresh, offline/reconnect, bridge restart,
  approval races, STOP races, response loss, and process death at every action
  boundary.
- Test human foreground override immediately before and after activation,
  dispatch, and verification. The target may be raised once when requested; it
  must not reclaim focus after the user switches away.
- Canary one tool family at a time with telemetry and rollback gates.
- Change defaults only after current production cohorts satisfy readiness.

## Migration and deployment gates

- §26 is applied and catalog-verified on the target project as of 2026-08-05.
  Real two-worker contention and crash-boundary behavior remain unproven.
- The named-app request/root/action lifecycle and exact-page wait/scroll guards
  are current source plus focused-smoke claims. No refreshed duplicate,
  multi-client lifecycle race, human foreground override, or live wait/scroll
  canary has yet proved the updated local/hosted deployment. The one direct
  post-restart Photoshop drill above proves only its closed-world local
  compiler/bridge/app path.
- The V1 outer-acceptance issuer is an in-process source core only. Production
  integration, durable receipt persistence/rehydration, additional task-family
  predicates, and live acceptance proof remain pending.
- The V1 Chat plan-to-tool manifest is also source-only and non-authorizing.
  Runtime wiring must re-read the current catalog policy, validate the exact
  root/request/action sequence, and atomically consume separately issued
  authority immediately before each handler. A self-consistent or forged
  unkeyed manifest must never dispatch anything.
- Model-side `credentials.get`, `approvals.resolve`, and saved-credential fill
  are withheld from selectable model catalogs and disabled at outer/inner
  dispatch boundaries. Saved-credential filling remains unavailable
  until it can bind and recheck one exact browser process, context, page,
  opaque URL, and field fingerprint at handler entry; current source fetches
  no secret and fills nothing. These are intentional safety stops, not
  completed credential automation.
- Default-edge review is canonical-policy-aware: auto/read calls do not prompt
  merely because a review callback exists, runtime-owned ask calls do not get
  a duplicate surface prompt, and missing policy fails closed. The device-
  local typed loop and legacy v1 per-step review still need the same UX-policy
  convergence audit before a universal default rollout.
- Chat no longer requests a broad `~/Desktop` write grant at component mount.
  Local file authority is demanded only after the compiled task declares
  `file_read` or `file_write`, is scoped to the inferred task roots, and uses
  the exact task as the grant reason. Uploaded attachment staging retains its
  separate task-time manifest path.
- §27 scheduled-action guards remain pending until the SQL checklist records
  application and live proof.
- §28 database approval/Office guards remain pending until applied and
  behaviorally verified.
- §29 continuation privacy remains pending until applied and its encryption,
  key rotation, expiry, scrub, and competing-claim behavior are live-proven.
- §32 readiness is applied/live-verified for its catalog/deployment contract;
  it does not prove arbitrary provider, browser, or native-app completion.
- §34 universal roots and the atomic root/§26 extension are source/disposable-
  Postgres validated but pending and not applied to production. The exact
  migration and consolidated tail are **129,820 bytes**, SHA-256
  `45251c1ffd2ea002a227bfdcfcbd0875dbab47127e590031f3b4bf827651e30a`.
  PostgreSQL 14 syntax/catalog checks plus positive, rollback, and injected-
  fault paths passed; the source/tail mirror is exact and disposable resources
  were cleaned. The three combined RPCs lock root then action, derive §26
  identity from the root action and canonical root run id, and atomically
  perform claim, start, settle, optional complete/fail, or the narrow exact-
  proof `outcome_unknown -> verified` reconciliation. Generic §26 is unchanged.
  The gateway accepts only a runtime-issued database binding, supports exact
  claimed-root recovery without replaying planned-to-claimed, uses fresh post-
  lock clocks/token checks, and issues one one-shot handler authority only from
  exact `started`. Root transitions reject STOP/human override while an action
  is claimed so they cannot strand the action. The feature-off runtime canary
  uses realized requirement/dispatch fingerprints, one §26 row for its one
  frontmost Photoshop create action, no child wrapper run, and an early
  persisted-root fallback fence. Final foreground is non-authoritative
  telemetry after app-native proof. All three rollout flags—
  `EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1`,
  `EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1`, and
  `EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1`—remain off. P0 rollout blockers
  are bridge-verifiable trusted root/action/args/target/revision attestation and
  durable STOP intent/atomic claimed-action cancellation. P1 is a durable
  receipt for later `outcome_unknown` reconciliation. Production migration/live
  Photoshop canary, contention/recovery, target-catalog verification, and fault
  proof remain required.
- New task-ledger columns/RPCs require a new migration and consolidated SQL
  section, RLS/security-definer review, source byte-identity smoke, disposable
  Postgres tests, target catalog verification, and two-client behavior tests.
- Edge/client result-shape changes deploy together or remain backward
  compatible. Old continuation snapshots never gain new authority implicitly.

## Required verification

Focused gates for the current terminal seam:

```bash
npm run smoke:computer-task-truthful-outcome
npm run smoke:computer-task-root-runtime-gate
npm run smoke:computer-task-root-action-gateway
npm run smoke:photoshop-root-action-canary
npm run smoke:computer-use-root-pointer
npm run smoke:chat-computer-task-root-continuity
npm run smoke:agent-run-persistence-receipt
npm run smoke:swanbot-v2-terminal-integrity
npm run smoke:computer-task-runtime-context
npm run smoke:browser-wait-scroll-reachability
npm run smoke:chat-file-permission-demand
npm run smoke:chat-plan-tool-manifest
npm run smoke:swanbot-v2-approvals
npm run smoke:browser-credential-schema-parity
npm run typecheck:app
```

`smoke:computer-task-truthful-outcome` directly exercises the V1 acceptance
compiler/evaluator/issuer and its forgery, freshness, ordering, concurrent
issuance, and single-use failures. It does not prove that a production task
caller invokes that core. The lifecycle and browser smokes likewise prove
source contracts, not deployed UI/edge/bridge behavior. The browser smoke pins
one wheel dispatch, privacy-local before/after viewport sampling, at most three
read-only settle reads, requested-axis `movementVerified:true`, redacted receipts,
and verification-failure recovery without blind replay.

The root/action gateway and Photoshop canary smokes pin source ordering,
identity/value-bound authority, refresh recovery, STOP/override refusal,
target-guard placement, and no-replay branches. They are not bridge-verifiable
attestation or behavioral crash-cut proof; the gateway fixture's core action
path also sets `requiresForegroundLease:false`.

Kernel gates as phases land:

- stable request/run/action collision tests;
- action-evidence versus task-acceptance separation tests;
- outer acceptance receipt request/contract/action/proof binding tests;
- mutation-catalog authority coverage;
- exact Photoshop single-create and duplicate/no-replay drills;
- exact Photoshop origin-message identity reuse across approval, capability,
  refresh, and restart paths, with distinct explicit submissions kept distinct;
- §26 two-worker claim/start contention;
- kill after claim, start, bridge return, proof, and finish acknowledgement;
- approval resolve/consume and refresh races;
- continuation discovery and competing-client claims;
- Chat/Office authoritative reconciliation;
- foreground-override tests proving Terminal/another app remains frontmost and
  the task pauses instead of repeatedly raising its target or Chat browser;
- local browser, hosted browser, native app, file, and external-provider
  canaries; and
- `npm run check:swanbot-chat:release`, build, and diff checks. Pull requests
  and manual dispatches run these through
  `.github/workflows/openswan-release.yml`, whose lane guard uses an exact
  merge-base `--base-ref` so clean CI evaluates the committed change set rather
  than an empty worktree. The hosted workflow must pass before this counts as
  release evidence.

Source smokes are not substitutes for migration application, deployed Edge
parity, real GUI proof, or concurrent database behavior.

## Extension rules

- Extend the canonical owners; do not create a seventh router or second tool
  catalog.
- Observe before mutation and invalidate observations after mutation.
- Approval and dispatch authority are separate objects.
- Keep exact values transient; persist digests and bounded receipts only.
- Treat app, document, window, tab, frame, file, and object identity as part of
  actionability.
- Never infer completion from response wording.
- Never promote action-level mutation verification into whole-task acceptance;
  require the outer request-bound completion receipt.
- Never convert `outcome_unknown` into a generic retry.
- Build a missing capability through the existing proposal path, then re-enter
  the normal kernel; do not let buildout bypass policy.
- Update this plan, the roadmap, stack reference, and `CLAUDE.md` together when
  ownership or the current/target boundary changes.
