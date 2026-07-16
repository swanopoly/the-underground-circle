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
| 4 | Cross-surface deep-links carry no entity handle → "go to chat" dead-ends | all 3 | **Med** | Low | NEEDS tiny payload core |
| 5 | No app-wide "realtime disconnected / data may be stale" signal | all 3 | **Med** | Low | **CORE BUILT** (`ConnectionStatus`) — globalize |
| 6 | First-value arc incomplete + fragile panels lack a poll fallback | all 3 | **Low-Med** | Low-Med | **CORE BUILT** partial (`emptyStateSuggestions`) — extend |

---

### 1 — Realtime subscriptions don't reconnect; live surfaces go silently stale · CORE BUILT (generalize) · mostly SAFE

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

### 4 — Cross-surface navigation carries no entity handle → "go to chat/office" dead-ends at the generic tab · NEEDS tiny core · SAFE

Every cross-surface jump is `uc:switch-tab` with a payload of **only `{ tab }`**,
so the app can move you *to* a surface but never *to the specific thing*. Clicking
"ask the agent" from a Feed/Office empty state, or wanting to jump from a live run
in Feed to the Chat thread that owns it, drops you at a cold generic surface.

**Evidence.**
- Payload is tab-only at every dispatch site: `FeedTab.tsx:281`,
  `OfficeTab.tsx:4222`, `ChatTab.tsx:4320`, `MissionsTab.tsx:389`,
  `missionChatCommands.ts:176`, `ProfileTab.tsx:22`; listener
  `CircleDetailScreen.tsx:226-238`. None carry a `threadId`/`runId`/`taskId`.
- The only deep-links that *do* carry an id are bespoke one-offs, proving the
  appetite but not the pattern: mission `?mission=` URL param
  (`MissionsTab.tsx:996`, honored `:416`) and Office's in-surface `open_run`
  drawer (`OfficeTab.tsx:309-311`). There is no way to go **Feed run → Chat
  thread** or **Office agent → its run history in another tab**.
- `emptyStateSuggestions` explicitly wants this — its `open` actions dispatch
  `uc:switch-tab` (`emptyStateSuggestions.ts:22-24`) but can only name a tab.

**Fix.** Extend the `uc:switch-tab` contract to an optional, validated
`{ tab, focus?: { kind:'thread'|'run'|'task'|'agent', id } }` via a tiny pure
**`surfaceNavIntentCore.ts`** (validate/serialize, mirrors the shape discipline
of `emptyStateSuggestions`), and have each surface's existing listener honor a
`focus` by opening the relevant thread/run drawer it already has
(Office already has `open_run`; Chat has thread selection). Dispatch sites and
`CircleDetailScreen` listener are **SAFE** except the `ChatTab.tsx` handler (flag).

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
