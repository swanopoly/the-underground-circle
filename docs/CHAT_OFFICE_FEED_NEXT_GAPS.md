# Chat + Office + Feed — Next Integration Gaps (user-facing flow & reliability)

> Deep-research pass on the **cross-surface flow + reliability** layer: cross-surface
> state (chat↔office↔feed), realtime freshness, error/empty states,
> onboarding-to-first-value, and provider/route failover UX.
> Author: research subagent · Date: 2026-07-16 · Scope: **analysis only, no code
> edited.** Every finding is grounded in `file:line` and tagged **CORE BUILT**
> (a reusable module already exists) vs **NEEDS CORE**, plus **SAFE TO WIRE** vs
> **HOT — FLAG** (wiring point is a protected hot file: `swanbot.ts`,
> `ChatTab.tsx`, `chatPromptAssembly.ts`, `openswanSessionRuntime.ts`,
> `openswanToolRuntime.ts`, `openswanMemoryStores.ts`, `chat-stream/index.ts`,
> `OpenSwanConsole.tsx`, `package.json`).
>
> **Status update 2026-08-07.** Finding 4 now has one narrow product-code
> adoption: validated run handles survive Chat web/native navigation and focus
> the existing Office run drawer. Other entity kinds and dispatch surfaces are
> still pending; the original analysis below is retained with current status
> called out explicitly.

## Why this doc exists (and what it deliberately does NOT cover)

The five existing plans cover different axes and are **not duplicated here**:

- `CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md` — loop/edge/approval/catalog
  **consolidation & dead-code removal** (structure, not UX flow).
- `OPENSWAN_HOTPATH_OPTIMIZATION_PLAN.md` — OpenSwan tool-loop **latency/cost**
  (parallel tools, compaction, telemetry off critical path).
- `SWANBOT_RESPONSE_QUALITY_PLAN.md` — **grounding / citations / injection /
  staleness of model answers**.
- `ACCOUNTABILITY_PROOF_OF_WORK_PLAN.md` — **write path** for completed-run proof
  into the Feed's proof lane (`proof_of_work` / task↔PR linkage).
- `CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md` — **god-component decomposition**.
- `OFFICE_DASHBOARD_IMPROVEMENT_PLAN.md` — Office **internal** status/bridge/roster.

**This doc is the missing axis: the live glue between the three surfaces and what
the user sees when it degrades.** The proof-of-work plan fixes what a *completed*
run leaves behind; this plan fixes whether a *live* run stays visible, consistent,
and trustworthy across Chat, Office, and Feed while it runs — and what the user
sees when realtime, providers, or empty data fail.

Verified non-overlap: the only doc mentions of "reconnect" are OAuth-grant
reconnect (`CHAT_UX_INTEGRATION_UPGRADE_PLAN.md:649`) and **local-bridge**
reconnect (`OfficeTab.handleReconnectAll:1427` → `ConnectAllBridgesPanel`). **No
existing plan addresses Supabase Realtime channel-drop / catch-up / cross-surface
live-run freshness / failover visibility.**

---

## Ranked findings

| # | Gap | Surface(s) | Value | Effort | Core status |
|---|---|---|---|---|---|
| 1 | Realtime subscriptions don't reconnect → silent staleness | all 3 | **High** | Med | **CORE BUILT** (trapped in `agentPresence.ts`) — generalize |
| 2 | Same live run shows 3 different freshnesses; vanishes when empty | chat↔office↔feed | **High** | Med | NEEDS small shared core |
| 3 | Provider/transport failover is recorded but invisible in the primary lane | chat | **Med-High** | Low-Med | **CORE BUILT** (`chatLaneOutcome.servedBy`) — needs render seam |
| 4 | Cross-surface deep-links only partially carry entity handles | all 3 | **Med** | Low | **PARTIAL** — Chat run → Office exact drawer landed; other kinds/surfaces pending |
| 5 | No app-wide "realtime disconnected / data may be stale" signal | all 3 | **Med** | Low | **CORE BUILT** (`ConnectionStatus`) — globalize |
| 6 | First-value arc incomplete + fragile panels lack a poll fallback | all 3 | **Low-Med** | Low-Med | **CORE BUILT** partial (`emptyStateSuggestions`) — extend |

---

### 1 — Realtime subscriptions don't reconnect; live surfaces go silently stale · CORE BUILT (generalize) · mostly SAFE

> **Status update 2026-07-24.** The core landed since this doc was written:
> `resilientSubscriptionCore.ts` (pure decisions) + `subscribeWithReconnect.ts`
> (non-React wrapper) + `useResilientSubscription.ts` (hook) + `connectionStatusCore.ts`.
> The remaining work is **adoption**, and the whole **Office surface is now
> migrated**: `circleOffice.subscribeToCircleOffice` (the roster — the highest-value
> one), `OfficeTab` agent plans, all three `officeTerminal` channels, `OfficeTerminal`
> responses, `AgentMemoryPanel`, `OfficeAnalyticsPanel`, `GitHubWallFeed`, and
> `Whiteboard` rewards. Two supporting changes were needed in the shared wrapper:
> `channelConfig` passthrough (re-applied on every reconnect — the terminal command
> channel relies on `broadcast: { self: true }`, and dropping it after the first
> drop would silently stop the sender seeing its own commands) and `getChannel()`
> (the terminal's send path shared that channel, and a cached reference would send
> into a channel that reconnect had already replaced). Where a caller had a real
> refetch it is wired as `onCatchUp`, so rows written while the socket was down are
> backfilled rather than lost; `OfficeAnalyticsPanel` is reconnect-only because its
> handler applies incremental patches over a parent-owned snapshot with nothing
> local to refetch. **Still on raw `.subscribe()`:** Chat, Feed, Rooms, WarRoom,
> GitHub tabs, `useKanbanData`, `useGoals`, `useOrg`, `useBackpackData`, and the
> `services/*` layer (~30 files).

**The single highest-leverage reliability gap.** The app opens **76 realtime
`.subscribe()` channels** across Chat/Office/Feed, but exactly **one file**
handles channel drop. After any network blip, laptop sleep/wake, or Supabase
socket timeout, the dropped channels never re-subscribe and the surface shows
**stale data forever** with no error and no recovery.

**Evidence.**
- Breadth: 76 `.subscribe()` sites; `CHANNEL_ERROR` is handled in **only**
  `src/lib/agentPresence.ts` (repo-wide grep).
- The **gold-standard pattern already exists** but is trapped in presence:
  `agentPresence.ts:47` (`ConnectionStatus = connecting|live|reconnecting|offline`),
  `:66-67` (`reconnectAttempts`/`reconnectTimers` maps), `:145-153`
  (`SUBSCRIBED`→live / `CHANNEL_ERROR|TIMED_OUT`→`reconnecting`→`scheduleReconnect`),
  `:272-297` (exponential backoff 1s→2s→4s…capped 5min). `scheduleReconnect` is a
  **private** function (`agentPresence.ts:274`), exported nowhere.
- The unprotected majority (bare `.subscribe()`, no status, **no poll fallback**):
  - Kanban tasks board — `src/hooks/useKanbanData.ts:733-738`.
  - Live runs — `subscribeToCircleRuns` (`src/lib/agentRunSystem.ts:1151`, bare
    `.subscribe()` at `:1179`).
  - Every task detail sub-panel a user stares at while a task runs —
    `TaskChecksPanel.tsx`, `TaskRunTimeline.tsx`, `TaskArtifactsPanel.tsx`,
    `TaskDetailModal.tsx`, `TaskApprovalsPanel.tsx` (each: `subscribe:1`,
    `CHANNEL_ERROR:0`, `setInterval:0`). A check that finishes after the socket
    drops shows "running" indefinitely.
  - HuggingSwan Feed activity — `FeedTab.tsx:227-229` logs the error and does
    nothing (`console.error`, no state, no refetch).
- Partial mitigation that *should be the floor everywhere*: the Feed proof/activity
  lane pairs its channel with a **30s poll fallback** (`ActivityFeedPanel.tsx:170-185`,
  `pollRef` at `:86`) — so it self-heals within 30s even if realtime dies. Most
  other subscriptions have no such net.

**Fix.** Extract the `agentPresence` reconnect machinery into a shared
**`realtimeChannelCore.ts`** (pure policy: attempt→backoff schedule, status
transitions) + a thin `subscribeWithReconnect(channel, { onStatus })` runtime
helper, then adopt it at the bare-`.subscribe()` sites (all **SAFE** non-hot except
any inside `ChatTab.tsx`/`OpenSwanConsole.tsx`, which are owner-flagged). Minimum
bar for any live list: a **catch-up refetch on `SUBSCRIBED`** (re-run the initial
query when a channel (re)connects) so a reconnect repaints missed rows. The pure
backoff/status policy is smoke-testable (mirrors the `deadline-sla` core style).

---

### 2 — The same live run shows three different freshnesses across surfaces, and disappears when idle · NEEDS small shared core · SAFE

A Chat/Office OpenSwan run writes one `agent_runs` row
(`openswanSessionRuntime.ts` surface `main_chat`/`room_chat`), but each surface
reads it on a **different, independent cadence with no shared store** — so
teammates watching different tabs see contradictory "what's happening right now."

**Evidence.**
- No shared live-run store exists (grep for `useLiveRuns`/`RunsContext`/
  `liveRunStore` is empty). Each surface fetches independently:
  - **Feed** `ActiveRunsWidget` polls `getActiveRuns` **every 10s**
    (`FeedTab.tsx:390`), no realtime, and **returns `null` when empty**
    (`FeedTab.tsx:399`) — so a run that just finished (or a momentary gap)
    vanishes with no "no active runs" affordance.
  - **Office** uses realtime `subscribeToCircleRuns` (`OfficeTab.tsx:479-481`)
    **and** a separate `getActiveRuns` poll (`OfficeTab.tsx:317`) **and** a **60s**
    blocked-runs poll (`OfficeTab.tsx:308-329`, `setInterval … 60_000`).
  - Result: the identical run is realtime-fresh in Office, up-to-10s-stale in Feed,
    and up-to-60s-stale for Office's approval/blocked strip — from **one** DB row.
- This is the accountability surface (product priority #1): "what are the agents
  doing right now" must not depend on which tab you opened.

**Fix.** A single **`useCircleLiveRuns(circleId)`** hook (realtime via the #1
reconnect helper + a poll floor) that owns the `agent_runs` live set once, and a
pure **`liveRunsViewCore.ts`** that derives each surface's slice (active / blocked
/ recent-finished) from that one set. Feed's `ActiveRunsWidget` renders an explicit
empty state instead of `null`. All **SAFE** (`FeedTab.tsx`, `OfficeTab.tsx`,
`agentRunSystem.ts` are non-hot); the hook consolidates the three cadences into one.

---

### 3 — Provider/transport failover is computed and logged, but invisible to the user in the primary lane · CORE BUILT · render seam HOT — FLAG

The app already knows when a turn was served by a fallback provider/transport —
it just doesn't tell the user, except in one narrow path. A silent switch changes
model quality, cost, and latency with no signal, which reads as "the bot got
dumber/slower for no reason."

**Evidence.**
- The signal exists end-to-end: `universalInvoke.ts:59-67`
  (`UniversalInvokeResult.fallbackChain` + `servedBy`), `:97-121`
  (`executeRouteChain` records every failed route + who served it);
  `chatLaneOutcome.ts:25,76,127,265-277` carries `servedBy.fallback` as a
  **first-class "never silent" field**.
- But it's recorded as **telemetry only** — `recordChatLaneOutcomeNow` at
  `ChatTab.tsx:2898, 9964, 10275, 10338` — and **rendered to the user in exactly
  one place**: the web-search fallback note (`ChatTab.tsx:9390`,
  `"…answered from ${fallback.servedBy.label}"`).
- Health/cooldown cores that *drive* failover have **zero UI consumers**:
  `providerHealthRegistry.ts`, `providerErrorAdvanceCore.ts`,
  `providerBackoffCore.ts` (consumed only by other libs).
- The good counter-example to mirror: BlackSwan failover **is** made visible
  (`swanbot.ts:487` `blackswan_failover`, `:3784-3795` "FAIL-VISIBLE failover…
  user notice prepended"). General marketplace/cross-provider failover has no
  equivalent surface.

**Fix.** Promote the already-computed `servedBy.fallback` into a compact,
non-alarming turn chip ("served by <label> — <primary> was unavailable"), the way
BlackSwan already does. The compose is **SAFE** (a pure
`failoverNoticeCore(servedBy, fallbackChain) → string|null` beside
`chatLaneOutcome`); the **render point is `ChatTab.tsx` (HOT — flag)**. Persist it
into assistant metadata (`persistedChatMetadata.ts`, SAFE) so the Feed/Office run
cards can show "served by fallback" too.

---

### 4 — Cross-surface entity focus is partially adopted · run → Office current; other kinds pending

**Status update 2026-08-07.** The canonical core is
`src/lib/entityHandleCore.ts`; do not create the formerly proposed parallel
`surfaceNavIntentCore.ts`. Its first runtime adoption is intentionally narrow:

- Chat passes its existing typed run handle through `encodeEntityHandle` for
  both the web `uc:switch-tab` payload and native route params. `open_run`,
  approval, retry fallback, and resolved run-reference actions therefore carry
  `office:run:<id>` instead of discarding the id.
- `CircleDetailScreen` decodes the untrusted value and accepts focus only when
  the requested tab is `OFFICE` and the decoded kind/surface are exactly
  `run`/`office`. It captures the request before activating lazy Office, so a
  first visit does not lose the focus event.
- `OfficeTab` forwards the exact id into its existing `RunHistoryDrawer`; a
  request sequence remounts the drawer when the same run is clicked twice.
  This path creates no new viewer, runtime, run row, or completion claim.

This does **not** close Finding 4. Thread, task, mission, agent, room, and message
focus remain unadopted, and Feed/Office/Missions/Profile/command dispatchers
still need to pass their validated handles into the appropriate existing
surface owner. Continue by extending `entityHandleCore` and the central
`CircleDetailScreen` focus handoff rather than adding another navigation
contract. The run → Office claim is source/focused-smoke current only; no live
web/native GUI navigation pass has been claimed.

**Adjacent connected-agent truth boundary (2026-08-07).** Selected, assigned,
multi-agent, and dedicated-session Chat dispatches now project one bounded
`accepted | drafted | failed | unknown` receipt. Accepted/drafted/unknown messages retain
`delegatedTo` and force `outcomeVerdict: unknown`; direct terminal sends and
managed task launches use the same receipt boundary. A bridge/session
acknowledgement never becomes a run id. Only `accepted` writes one canonical
`main_chat` `agent_runs` ledger row, leaves it `queued`, attributes it with the
canonical agent subject, and records only bounded external provider/session
correlation with `completionVerified: false`. The row does not opt into runtime
heartbeats because Chat cannot finalize the external provider lifecycle.
`drafted`, `failed`, and `unknown` write no run. `unknown` preserves any exact
external lineage when OpenSwan cannot prove whether the single attempt began
and blocks automatic fallback/replay. The current `circle_chat_threads` id stays
bounded metadata and is never sent to the unrelated legacy
`agent_runs.chat_session_id` foreign key.

The accepted receipt is rebuilt with that real run UUID and persists with the
Chat message, so Office's existing run telemetry and exact run drawer own task
visibility across refresh. Chat no longer immediately flips an accepted roster
agent back to `idle`; provider/session polling owns roster presence. This is a
nonterminal handoff ledger, not lifecycle completion: typed provider
started/final events and live bridge E2E remain pending, an acknowledgement may
never set `running`/`completed`/`failed`, and no deployment claim is made for
this source/focused-smoke slice.

Chat's target and transport boundary is also source-hardened. The assignment
picker preserves an encoded immutable agent id, stale selections become
unavailable, quoted names must resolve uniquely, multi-agent and terminal-name
ties dispatch nothing, and production-shaped immutable ids remain exact through
multi-agent planning so duplicate names can be disambiguated. Only the canonical `default::blackswan` identity may become the
default OpenSwan target. A published OpenSwan Office row never supplies a
session key: an owner row requires matching authenticated owner evidence and
the same private §36 binding resolver for send or dedicated spawn, while
another member's OpenSwan or terminal-provider row performs no local provider
call. Published custom rows require an exact connection id or explicit exact
gateway. Custom gateways cannot inherit a same-provider/name local token;
credentials require `isOwn`, both nonempty matching owner ids, and an enabled
exact normalized endpoint match. Missing alleged-owner evidence stops before
network I/O. Terminal/custom send and launch adapters expose
`transportAccepted: true | false | null`, accept only structured positive
evidence on HTTP success, require the exact selected-session echo, and stop
after one ambiguous task-bearing POST. Claude, Codex, and Gemini servers require
one case-sensitive exact session id before input; aliases, prefixes, case folds,
and duplicates fail before mutation. Cursor exact-session input fails closed
until its GUI bridge can bind one verified Composer conversation. A one-session
launch requires one receipt-safe exact returned session id; Chat stores it as
external lineage, retains a selected DB agent's DB subject, and otherwise uses
the session subject. Missing, unsafe, or multiple lineage stays unknown without
replay or an accepted run. Office run lookup is exact-first and uses names only
for identity-less legacy rows. An exact session is never replaced and one
launch never fans out across providers. Sequential Chat
chains pause on accepted, unknown, failed, or thrown upstream work and keep
downstream agents undispatched instead of forwarding acknowledgement/error
prose. Authenticated multi-member, custom-gateway, and response-loss E2E remain
pending.

**Office/Feed connected-agent launch parity (2026-08-07).** The Office terminal and
direct Feed/Kanban invocation path no longer treats Claude Code `/spawn` as a
provider final. One exact 36-hex spawn handle is required for `accepted`; Office
then writes a queued canonical `office_terminal` ledger and keeps the response
and tracking task nonterminal. A lost, timed-out, inconsistent, or malformed
response is `outcome_unknown`, creates no run, and is not replayed. Feed task
runs stay `running` after acceptance or become `blocked` when dispatch is
unknown; both branches return before completion metrics, proof publication,
memory, or XP. Exact bridge status adoption is still pending, so this closes the
false-completion path without manufacturing a final result. Feed no longer
sends an idle/offline agent the task once as a wake-up and again through the
selected adapter. Sequential collaboration pauses at the first nonterminal
child instead of completing the parent or dispatching dependent agents with
acknowledgement prose.

An accepted direct Feed handoff also writes one best-effort queued `feed_task`
canonical run linked to the exact task and task-run attempt with canonical
agent subject metadata. Ledger unavailability preserves acceptance and never
replays; outcome-unknown and failed attempts create no accepted row. Activity
Feed and Task Detail expose the exact local run as an Office action and never
substitute external connection, session, or provider-run ids.

OpenSwan Office/Feed sends now require one exact `connectionId::sessionKey` and
use the canonical structured `sessions_send` adapter. There is no implicit
main-session fallback or prose-history completion inference. Feed task cards,
Active Runs, history, and activity rows expose accepted/unknown states.

The source-wired route from a published Office agent to that exact session is
now an explicit owner choice. The displayed session's Agent Gateway panel lets
the current owner bind/move/clear one of their published OpenSwan Office agents
to the exact owner-owned `agents_bots` UUID plus case-sensitive session key.
§36 adds the owner-private, no-backfill `office_agent_session_bindings` table,
owner-only reads, server-authorized set/clear RPCs, and `invoke_agent_v2`; the
v2 RPC composes the canonical Office claim once and returns a versioned
bound-or-missing snapshot. Public Office rows never store the provider session
or gateway token, and the token remains in device-local secret storage.

Office and Feed then share one pure fail-closed resolver. It requires the exact
Office UUID, exactly one current local connection whose `remoteId` equals the
claimed bot UUID, exact `provider = openswan`, enabled/connected state, a
hydrated real local token, and exactly one case-sensitive matching session on
that connection. The session rows and a non-secret connection fingerprint are
co-published from the same poll generation; duplicate local ids, stale async
results, and same-id endpoint/private-bot replacement invalidate the snapshot.
Only that resolver may construct `connectionId::sessionKey`; it has no
agent-name, provider, first-connection, first-session, or main-session fallback.
Missing, stale, ambiguous, offline, or tokenless evidence produces the fixed
pre-dispatch binding error. §36 remains pending/not applied, and no live
authenticated binding UI, provider dispatch, cross-device credential
availability, or deployment is claimed. Typed provider final-result
reconciliation after an accepted send also remains pending.

Forward migration §35 preserves an Office parent with a `streaming` handoff
response past the legacy sweeper, but it remains pending/not applied.

---

### 5 — No app-wide "realtime disconnected / data may be stale" signal · CORE BUILT (globalize) · SAFE

Even where realtime silently dies (#1), the user is never told the live data is
stale. The one connection-health indicator in the app is scoped to Office
circle-presence and is about *who's online*, not *is my data live*.

**Evidence.**
- No connectivity primitive is used anywhere: repo-wide grep for
  `navigator.onLine` / `NetInfo` / `isOnline` (as a socket-health signal) is empty.
- The only connection-status UI is Office-local circle presence:
  `OfficeTab.tsx:927` (`circleConnectionStatus`), rendered `:5587-5588`
  (`reconnecting: 'Reconnecting…'`, `offline: 'Offline'`) — driven by
  `agentPresence`'s `ConnectionStatus` (`agentPresence.ts:47`). Chat and Feed have
  nothing; a user cannot tell a frozen board from an idle one.

**Fix.** Once #1 exposes a per-channel status, aggregate it into one lightweight
circle-level "live / reconnecting / stale (Ns ago)" indicator reusable in the
Chat and Feed headers (the `ConnectionStatus` type + copy already exist —
`OfficeTab.tsx:5586-5588`). Pure aggregation core + a small shared strip; all
**SAFE** except final placement inside `ChatTab.tsx` (flag). Pairs with #1.

---

### 6 — First-value arc is incomplete and several fragile panels have no poll fallback · CORE BUILT partial · SAFE

First-run guidance exists but is **per-surface static chips**, not a guided
connect-provider → connect-agent → first-successful-run arc, and it skips the
primary surface's *system* setup. Combined with #1, a first-time user on a flaky
network can hit a frozen, empty board with no path forward.

**Evidence.**
- `emptyStateSuggestions.ts` covers `missions|feed|office|rooms`
  (`:31`, `:93-189`) — but **not `chat`**, and it is deliberately static
  next-action chips, not a stateful onboarding sequence.
- Chat's own first-run *is* handled (hero + `EMPTY_CHAT_STARTERS` +
  "See everything I can do" — `ChatTab.tsx:11809-11836`), and onboarding scaffolding
  exists (`components/OnboardingFlow.tsx`, `onboarding/TutorialController.tsx`,
  `AgentQuickConnect`/`AgentSetupWizard` at `OfficeTab.tsx:4205,4749`) — but nothing
  ties "no provider key yet → connect one → connect/bond an agent → run your first
  task → see it land in the Feed" into one cross-surface thread. Each piece is an
  island.
- Reliability corollary from #1: the panels a first task's owner watches
  (`TaskChecksPanel`/`TaskRunTimeline`/`TaskArtifactsPanel`/`TaskApprovalsPanel`)
  have **neither reconnect nor a poll fallback**, so a first run on a shaky
  connection can look stuck at step one.

**Fix.** (a) Add a `chat`/first-value branch to `emptyStateSuggestions` gated on
"has the circle connected any provider/agent yet?" that points at the real
`AgentQuickConnect`/marketplace flow (**SAFE**, extend the existing pure core).
(b) As part of #1, give those task sub-panels the same 30s poll floor
`ActivityFeedPanel` already has (**SAFE**). This is polish on top of #1–#2, not a
substitute for them.

---

## Cross-cutting recommendation

Findings **1, 2, 5, and the 6b poll floor all reduce to one missing primitive: a
shared, reconnecting realtime layer with a visible status.** The machinery is
already written and battle-tested inside `agentPresence.ts` — it is simply not
reusable. Extract it once (`realtimeChannelCore.ts` policy + a
`subscribeWithReconnect` helper + a `ConnectionStatus` aggregator) and the four
gaps collapse into adopt-the-helper wiring at known, mostly-SAFE call sites.

## Suggested sequencing

1. **#1 core extraction** (`realtimeChannelCore` from `agentPresence`) — the
   foundation; **CORE BUILT**, just trapped. Adopt first at the no-poll-fallback
   sites (`useKanbanData:733`, `subscribeToCircleRuns:1179`, the five task
   sub-panels).
2. **#2 `useCircleLiveRuns`** on top of #1 — the highest user-facing accountability
   win (consistent live-run truth across Feed/Office); fix Feed's empty→`null`.
3. **#3 failover chip** — cheapest trust win; the signal (`servedBy.fallback`) is
   already computed and logged, only the render is missing.
4. **#5 stale/offline indicator** — falls out of #1 for near-free.
5. **#4 nav entity-handle** + **#6 first-value arc** — flow polish once the live
   layer is trustworthy.

## Validation notes

- New pure cores follow the house rule (dependency-light, `import type` only,
  smoke-pinned): `realtimeChannelCore` (backoff/status transitions),
  `liveRunsViewCore` (surface slices), `failoverNoticeCore`,
  `surfaceNavIntentCore` — each gets a `smoke:*` script.
- Keep every realtime adoption fail-visible, never fail-silent: a dropped channel
  must show `reconnecting`/`stale`, never a frozen board that looks live.
- Hot-file flags (owner-only wiring): `ChatTab.tsx` (failover chip #3, nav handler
  #4, stale strip #5), `package.json` (smoke registration). All core, hook, and
  non-`ChatTab` surface wiring lands in SAFE files.
