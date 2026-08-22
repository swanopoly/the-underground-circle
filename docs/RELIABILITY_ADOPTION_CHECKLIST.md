# Reliability Cores — Adoption Checklist

> Precise call-site checklist for wiring the five committed reliability cores into
> Chat / Office / Feed. Companion to `docs/CHAT_OFFICE_FEED_NEXT_GAPS.md` (the
> analysis) — this doc is the **adopt-the-helper** map.
> Author: adoption-audit subagent · Date: 2026-07-16 · Scope: **analysis only, no
> code edited.** Every row is grounded in a verified `file:line`.

## The five cores (all committed and pure; adoption status noted below)

The original 2026-07-16 audit found zero runtime callers. As of 2026-08-07,
`entityHandleCore` is partially adopted for Chat run → Office focus; rows 16 and
26 below supersede the original unadopted finding. This does not imply that the
other entity kinds or reliability cores are fully adopted.

| Core file | Gap | Key exports (what a call site invokes) |
|---|---|---|
| `src/lib/resilientSubscriptionCore.ts` | #1 silent-staleness / reconnect | `planReconnect({state,consecutiveFailures,nowMs,lastAttemptMs})`, `assessSubscriptionHealth({state,lastEventMs,nowMs,heartbeatMs})`, `describeHealth(health)`, `normalizeSubscriptionState(raw)` |
| `src/lib/runFreshnessCore.ts` | #2 3-way live-run freshness | `classifyRunFreshness({status,updatedAtMs,nowMs})→{freshness,label,ageMs}`, `runEmptyStateModel({hasRuns,loading,error})→{kind,message}`, `freshnessRank(freshness)` |
| `src/lib/transportFailoverBadgeCore.ts` | #3 invisible failover | `buildFailoverBadge(servedBy)→badge\|null` (render), `failoverMetadataPatch(servedBy)→{failover?}` (persist), `readFailoverBadgeFromMetadata(metadata)→badge\|null` (Feed/Office read) |
| `src/lib/entityHandleCore.ts` | #4 nav dead-ends — **PARTIAL** (run → Office current 2026-08-07) | `encodeEntityHandle({kind,id,surface?})→string` (dispatch), `decodeEntityHandle(str)→handle\|null` (listener), `targetSurfaceForEntity(kind)` |
| `src/lib/connectionStatusCore.ts` | #5 no app-wide stale signal | `aggregateConnectionStatus(subs[])→{status,degradedChannels,summary}`, `connectionBannerModel(status)→banner\|null`, `connectionStatusLabel(status)` |

## SAFE vs HOT — the rule used here

**HOT** = the wiring point is a protected file this builder must not edit:
`swanbot.ts`, `ChatTab.tsx`, `chatPromptAssembly.ts`, `openswan*`
(incl. `OpenSwanConsole.tsx`, `openswanSessionRuntime.ts`), `chat-stream`,
`useKanbanData.ts`, `package.json`. **Everything else is SAFE.**

> Note: `docs/CHAT_OFFICE_FEED_NEXT_GAPS.md` Finding 1 originally called
> `useKanbanData.ts:733` a SAFE adopt-first site; **this checklist marks it HOT**
> because the task's protected list explicitly excludes `useKanbanData`. Its
> reconnect adoption is owner-flagged.

## Prerequisite (blocks all of `resilientSubscription`)

The pure core exists; the **thin runtime wrapper does not**. Before any
`.subscribe()` site can adopt, build one SAFE new helper (its own file, e.g.
`src/lib/useResilientSubscription.ts` or `src/lib/resilientSubscriptionRuntime.ts`):
`subscribeWithReconnect(makeChannel, { onStatus, onCatchUp })` that (a) tracks
`consecutiveFailures` + `lastAttemptMs`, (b) on `CHANNEL_ERROR|TIMED_OUT|CLOSED`
calls `planReconnect(...)` and `setTimeout`s the re-subscribe, (c) on
`SUBSCRIBED` fires `onCatchUp()` (re-run the initial query so a reconnect
repaints missed rows), (d) exposes a `SubscriptionHealth` for the
`connectionStatus` aggregator. Smoke-pin the pure policy (`smoke:*`) per house rule.

---

## Table A — Ranked primary adoption seams (SAFE first)

Ranked by user-facing value within SAFE (runFreshness → resilient priority panels
→ connectionStatus → entityHandle → failover-persist), then all HOT rows last.

| # | Site (file:line) | Core | SAFE/HOT | Exact change |
|---|---|---|---|---|
| 1 | `src/screens/circles/tabs/FeedTab.tsx:399` | runFreshness | **SAFE** | Replace `if (runs.length === 0) return null` with `runEmptyStateModel({ hasRuns: runs.length, loading, error })` → render its `kind`/`message` (real "No active runs" affordance, never `null`). |
| 2 | `src/screens/circles/tabs/FeedTab.tsx:408-412` | runFreshness | **SAFE** | Replace the hardcoded `statusColors[run.status]` dot + `run.status.toUpperCase()` label with `classifyRunFreshness({ status: run.status, updatedAtMs: Date.parse(run.updated_at), nowMs: Date.now() })` → `.freshness` (dot color) + `.label` (e.g. `Live`, `Idle · 10m`). |
| 3 | `src/screens/circles/tabs/FeedTab.tsx:390-397` | runFreshness | **SAFE** | Sort the `getActiveRuns` result by `freshnessRank(classifyRunFreshness(...).freshness)` before render so Feed emphasis order matches Office. |
| 4 | `src/screens/circles/tabs/OfficeTab.tsx:317-326` | runFreshness | **SAFE** | The 60s blocked-runs poll filters `status === 'waiting_approval' \|\| 'paused'`; classify each run through `classifyRunFreshness` so Office's blocked strip paints the SAME freshness bucket/label as Feed from the one `agent_runs` row. |
| 5 | `src/screens/circles/tabs/OfficeTab.tsx:479-481` | runFreshness | **SAFE** | `subscribeToCircleRuns` callback → run each row through `classifyRunFreshness`/`freshnessRank` for the roster render (single source of freshness truth across the 15s reload + realtime paths). |
| 6 | `src/lib/agentRunSystem.ts:1179` (`subscribeToCircleRuns`, channel `circle-runs:${circleId}`) | resilientSubscription | **SAFE** | Route the `.subscribe()` through `subscribeWithReconnect`; on `SUBSCRIBED` re-run `getActiveRuns(circleId)` (catch-up refetch) so Office's live-run list self-heals after a socket drop. |
| 7 | `src/screens/circles/tabs/kanban/TaskChecksPanel.tsx:118` | resilientSubscription | **SAFE** | Wrap subscribe with `subscribeWithReconnect` + 30s poll floor + catch-up refetch on `SUBSCRIBED` (today: `subscribe:1, CHANNEL_ERROR:0, setInterval:0` — a check that finishes after the socket drops shows "running" forever). |
| 8 | `src/screens/circles/tabs/kanban/TaskRunTimeline.tsx:119` | resilientSubscription | **SAFE** | Same wrap + poll floor + `SUBSCRIBED` refetch (no reconnect/poll today). |
| 9 | `src/screens/circles/tabs/kanban/TaskArtifactsPanel.tsx:131` | resilientSubscription | **SAFE** | Same wrap + poll floor + `SUBSCRIBED` refetch. |
| 10 | `src/screens/circles/tabs/kanban/TaskApprovalsPanel.tsx:109` | resilientSubscription | **SAFE** | Same wrap + poll floor + `SUBSCRIBED` refetch. |
| 11 | `src/screens/circles/tabs/kanban/TaskDetailModal.tsx:482` | resilientSubscription | **SAFE** | Same wrap + poll floor + `SUBSCRIBED` refetch. |
| 12 | `src/screens/circles/tabs/FeedTab.tsx:227` | resilientSubscription | **SAFE** | HuggingSwan feed activity currently `.subscribe((status, err) => console.error(...))` only. Feed status into `subscribeWithReconnect`; on `CHANNEL_ERROR|TIMED_OUT` reconnect via `planReconnect`; refetch on `SUBSCRIBED`. |
| 13 | `src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx:179` | resilientSubscription | **SAFE** | Already has the 30s `pollRef` floor (the model). Migrate onto `subscribeWithReconnect` so it also actively reconnects instead of leaning on the poll alone. |
| 14 | Feed header (new strip) — `src/screens/circles/tabs/FeedTab.tsx` | connectionStatus | **SAFE** | Add the "live / reconnecting / stale" strip: `aggregateConnectionStatus(healths)` → `connectionBannerModel(status)` / `connectionStatusLabel(status)`, fed by the per-channel `SubscriptionHealth`s from #6–#13. |
| 15 | `src/screens/circles/tabs/OfficeTab.tsx:927,4086,5583-5588` | connectionStatus | **SAFE** | Existing presence-only `circleConnectionStatus` + `CONNECTION_STATUS_UI`. Feed presence health into `aggregateConnectionStatus` so the Office indicator reflects ALL live channels, not just circle-presence; copy already matches (`Reconnecting…`/`Offline`). |
| 16 | `src/screens/circles/CircleDetailScreen.tsx` (`captureCrossSurfaceFocus`, web listener, native route effect) | entityHandle | **SAFE — PARTIAL 2026-08-07** | **Adopted for run → Office only:** decode the bounded focus before activating lazy Office; accept only `target === 'OFFICE'`, `kind === 'run'`, and `surface === 'office'`; forward the exact id plus a monotonic request sequence. **Remaining:** add explicit owners/consumers for thread, task, mission, agent, room, and message focus rather than treating a valid future handle as already adopted. |
| 17 | `src/screens/circles/tabs/FeedTab.tsx:281` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({ kind:'run'\|'thread', id })` to the `uc:switch-tab` detail (today `{ tab:'CHAT' }` only) so "ask the agent" lands on the specific thread/run. |
| 18 | `src/screens/circles/tabs/OfficeTab.tsx:4222` | entityHandle | **SAFE** | Add `focus` handle to the `{ tab:'CHAT' }` dispatch (e.g. `encodeEntityHandle({kind:'agent'\|'run', id})`). |
| 19 | `src/screens/circles/tabs/MissionsTab.tsx:389` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({kind:'mission', id})` to the `{ tab: action.value }` dispatch. |
| 20 | `src/screens/circles/tabs/ProfileTab.tsx:22` | entityHandle | **SAFE** | Add optional `focus` handle to the `{ tab:'CHAT' }` dispatch. |
| 21 | `src/lib/missionChatCommands.ts:176` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({kind:'mission', id})` to the `{ tab:'FEED' }` dispatch. |
| 22 | `src/lib/chatAgentService.ts:132-165` (`persistMainChatBotMessageWithRetry` → `formatPersistedChatBotMessage`) | transportFailoverBadge | **SAFE** | It already forwards `routing`. Derive `servedBy = normalizeStructuredResponse(structured).servedBy` (chatLaneOutcome.ts:309) and spread `failoverMetadataPatch(servedBy)` into the persisted metadata so Feed/Office run cards can later call `readFailoverBadgeFromMetadata`. |
| 23 | `src/lib/persistedChatMetadata.ts` (`formatPersistedChatBotMessage`, `PersistedChatBotMetadata` type ~113) | transportFailoverBadge | **SAFE** | Accept + emit the bounded `failover` field (namespaced object from `failoverMetadataPatch`); add a `readFailoverBadgeFromMetadata` pass-through for run-card consumers. |
| 24 | `src/screens/circles/tabs/ChatTab.tsx:10082` (assistant-bubble `updateBotMessage` on the OpenSwan v2 success path) + message-bubble render | transportFailoverBadge | **HOT** | Render `buildFailoverBadge(servedBy)` as a compact turn chip (mirror the BlackSwan notice) when non-null. `servedBy` via `normalizeStructuredResponse(structured)`; `structured.routing.routing_fallback` is already read at :10042. |
| 25 | `src/screens/circles/tabs/ChatTab.tsx:10133` (`persistMainChatBotMessageWithRetry` call) | transportFailoverBadge | **HOT** | Pass the failover-patched metadata through (pairs with #22 — if #22 does the derive inside the SAFE helper, this call site is untouched). |
| 26 | `src/screens/circles/tabs/ChatTab.tsx` (`goTab`, follow-up/reference handlers) | entityHandle | **HOT — PARTIAL 2026-08-07** | **Adopted for run → Office:** one typed helper encodes the same optional handle into web `uc:switch-tab` and native route params; `open_run`, approval, retry fallback, and run-reference actions retain the id. Repeated native requests carry a sequence. **Remaining:** wire non-run Chat destinations only when their target surface has an exact validated consumer. |
| 27 | Chat header (strip placement) — `src/screens/circles/tabs/ChatTab.tsx` | connectionStatus | **HOT** | Place the shared connection strip (built SAFE in #14) in the Chat header — final placement is owner-flagged per Finding 5. |
| 28 | `src/hooks/useKanbanData.ts:738` (channel `kanban-tasks`) | resilientSubscription | **HOT** | Wrap with `subscribeWithReconnect` + catch-up refetch on `SUBSCRIBED`. Owner-flagged (task-protected `useKanbanData`). |
| 29 | `src/components/openswan/OpenSwanConsole.tsx:939` | resilientSubscription | **HOT** | Wrap with `subscribeWithReconnect` + catch-up refetch. Owner-flagged (`openswan*`). |
| 30 | `src/screens/circles/tabs/ChatTab.tsx:4817, 5240, 11505` | resilientSubscription | **HOT** | Wrap each bare `.subscribe()` with `subscribeWithReconnect` + catch-up refetch. Owner-flagged (`ChatTab.tsx`). |

---

## Table B — Full realtime `.subscribe()` inventory (resilientSubscription rollout)

Every genuine Supabase Realtime channel site in `src` (cross-checked against
`.channel(`). Each adopts the identical pattern: **route through
`subscribeWithReconnect` + catch-up refetch on `SUBSCRIBED`** (add a 30s poll
floor for any panel a user stares at during a run). SAFE first, then HOT.
Excludes 3 string-literal examples in `RoomsTab.tsx:5557,5560,5561` (docs panel,
not code) and doc-comment matches inside the core files.

**Gold-standard SOURCE (do not "adopt" — this is what the core was lifted FROM):**
`src/lib/agentPresence.ts:145` — already implements SUBSCRIBED→live / error→reconnect + backoff.

### SAFE sites

| Site (file:line) | Notes |
|---|---|
| `src/lib/agentRunSystem.ts:1124` (`subscribeToRun`) | run detail live |
| `src/lib/agentRunSystem.ts:1133` (`subscribeToRunSteps`) | run steps live |
| `src/lib/agentRunSystem.ts:1142` (`subscribeToApprovals`) | approvals live |
| `src/lib/agentRunSystem.ts:1179` (`subscribeToCircleRuns`) | **priority** — see Table A #6 |
| `src/screens/circles/tabs/kanban/TaskChecksPanel.tsx:118` | **priority** — Table A #7 |
| `src/screens/circles/tabs/kanban/TaskRunTimeline.tsx:119` | **priority** — Table A #8 |
| `src/screens/circles/tabs/kanban/TaskArtifactsPanel.tsx:131` | **priority** — Table A #9 |
| `src/screens/circles/tabs/kanban/TaskApprovalsPanel.tsx:109` | **priority** — Table A #10 |
| `src/screens/circles/tabs/kanban/TaskDetailModal.tsx:482` | **priority** — Table A #11 |
| `src/screens/circles/tabs/FeedTab.tsx:227` | **priority** — Table A #12 (has status/err cb, no reconnect) |
| `src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx:179` | has 30s poll floor (the model) — Table A #13 |
| `src/hooks/useOptimizedQuery.ts:123` | generic `${tableName}_changes` realtime hook — wrap once, every consumer benefits |
| `src/hooks/useGoals.ts:63` | goals board |
| `src/hooks/usePlans.ts:71` | plans (has status/err cb, logs only, no reconnect) |
| `src/hooks/useBackpackData.ts:304` | backpack/inventory |
| `src/hooks/useOrg.ts:103` | org data |
| `src/lib/chatSessions.ts:626, 651, 676` | chat session lists (non-ChatTab lib) |
| `src/lib/circleChatThreads.ts:244` | circle chat threads |
| `src/lib/circleOffice.ts:450` | circle office roster |
| `src/lib/missions.ts:353, 367, 381` | missions/goals/tasks realtime |
| `src/lib/momentumAlerts.ts:71` | momentum alerts |
| `src/lib/officeTerminal.ts:205, 283, 418, 626` | office terminal streams (`:626` has status cb) |
| `src/lib/scheduledActions.ts:343` | scheduled actions |
| `src/services/agentActivityLogger.ts:102` | agent activity log |
| `src/services/automationService.ts:459, 517, 555` | automation triggers |
| `src/services/hitlService.ts:161, 194` | HITL approvals |
| `src/services/projectRooms.ts:229, 252, 270` | project rooms |
| `src/services/rewardService.ts:135` | rewards |
| `src/services/runApprovalsService.ts:130` | run approvals |
| `src/services/sharedMemory.ts:162` | shared memory bank |
| `src/screens/circles/tabs/rooms/roomRepository.ts:491, 510, 529` | room files/messages/services |
| `src/screens/circles/tabs/RoomsTab.tsx:753, 1330, 2292, 2311, 2349, 3637, 6531, 6909` | rooms surface channels |
| `src/screens/circles/tabs/WarRoomTab.tsx:303` | war room |
| `src/screens/circles/tabs/GitHubTab.tsx:93` | GitHub tab |
| `src/screens/circles/tabs/office/AgentMemoryPanel.tsx:123` | agent memory panel |
| `src/screens/circles/tabs/office/Whiteboard.tsx:117` | office whiteboard |
| `src/screens/circles/tabs/chat/RunTraceCard.tsx:107` | run trace card |
| `src/screens/checkin/CheckInScreen.tsx:273` | check-in |
| `src/screens/friends/DMScreen.tsx:47` | DMs |
| `src/components/AgentTaskRunner.tsx:82` | agent task runner |
| `src/components/FloatingChat.tsx:246` | floating chat |
| `src/components/office/GitHubWallFeed.tsx:205` | GitHub wall feed |
| `src/components/OfficeAnalyticsPanel.tsx:214` | office analytics |
| `src/components/OfficeTerminal.tsx:1406` | office terminal component |
| `src/components/rpg/XPEventFeed.tsx:239` | XP event feed |
| `src/components/TraceViewer.tsx:125` | trace viewer |

### HOT sites (owner-flagged — do not edit here)

| Site (file:line) | Protected by |
|---|---|
| `src/hooks/useKanbanData.ts:738` | `useKanbanData` (task-protected) |
| `src/components/openswan/OpenSwanConsole.tsx:939` | `openswan*` |
| `src/screens/circles/tabs/ChatTab.tsx:4817` | `ChatTab.tsx` |
| `src/screens/circles/tabs/ChatTab.tsx:5240` | `ChatTab.tsx` |
| `src/screens/circles/tabs/ChatTab.tsx:11505` | `ChatTab.tsx` |

---

## Suggested sequencing (matches next-gaps doc)

0. **Build the SAFE runtime wrapper** (`subscribeWithReconnect`) — unblocks all
   of `resilientSubscription`. Smoke-pin the pure policy.
1. **runFreshness** (Table A #1–#5) — highest accountability win, all SAFE, no
   wrapper dependency; fixes Feed's `null`-vanish immediately.
2. **resilientSubscription priority panels** (#6–#13) — the no-poll-fallback
   sites that show "running forever".
3. **connectionStatus strip** (#14–#15) — falls out of #6–#13 for near-free.
4. **entityHandle** (#16–#21 and #26) — run → Office is partially adopted in
   #16/#26; continue with #17–#21 and other entity kinds only alongside an exact
   target-surface consumer.
5. **transportFailoverBadge persist** (#22–#23) — SAFE; render chip (#24) is HOT.
6. **HOT rows** (#24–#30) — hand to the owner of each protected file.

## Validation

- Per-core smoke scripts follow the house rule (dependency-light, `import type`
  only). The five pure cores (`resilientSubscriptionCore`, `runFreshnessCore`,
  `connectionStatusCore`, `entityHandleCore`, `transportFailoverBadgeCore`) must
  retain a `smoke:*` entry — **`package.json` registration is HOT** (owner-only).
- The run → Office adoption is pinned by
  `scripts/cross-surface-run-focus-wiring-smoketest.ts` across the codec, Chat
  web/native payloads, pre-lazy-mount capture, exact Office drawer, and repeated
  same-run request. That is source wiring coverage, not a live GUI claim.
- Keep every realtime adoption **fail-visible**: a dropped channel must render
  `reconnecting`/`stale`, never a frozen board that still looks live.

## Related Chat handoff truth boundary (outside the five-core checklist)

As of 2026-08-07, selected, assigned, multi-agent, and dedicated-session Chat
dispatches use a bounded `accepted | drafted | failed | unknown` receipt.
Accepted, drafted, and unknown transcript rows carry `delegatedTo` plus nonterminal
`outcomeVerdict: unknown`; direct terminal sends and managed task launches enter
the same receipt boundary. Only `accepted` creates one canonical, queued
`main_chat` `agent_runs` row with canonical subject metadata, bounded external
provider/session correlation, and `completionVerified: false`. It deliberately
does not set the runtime-heartbeat flag. `drafted`, `failed`, and `unknown`
create no run. `unknown` preserves any exact external lineage and prevents an
uncertain OpenSwan attempt from automatically falling through. A bridge/session
id never substitutes for a run UUID. A
`circle_chat_threads.id` may be stored as bounded metadata but must never enter
the unrelated legacy `agent_runs.chat_session_id` column.

The accepted receipt persists with the Chat row and carries the real run UUID
when the ledger write succeeds. Chat no longer immediately resets an accepted
roster agent to `idle`; provider/session polling owns presence, while Office and
canonical run telemetry own task visibility. A ledger-write failure remains a
truthful accepted receipt without a run link. The receipt and Chat wiring smokes
(`scripts/connected-agent-handoff-receipt-smoketest.ts` and
`scripts/connected-agent-chat-handoff-wiring-smoketest.ts`) cover this
nonterminal boundary, but durable typed provider started/final results,
terminal reconciliation, and live bridge E2E remain pending. Do not count this
as provider-owned run-lifecycle completion or a deployment claim.

The adjacent Chat target/transport checks are adopted as of 2026-08-07. Picker
rows preserve immutable ids and duplicate names fail closed. A published
OpenSwan Office row may touch the local runtime only for the authenticated
owner and only through its exact private binding; non-owner rows never borrow
the local runtime. Dedicated published-agent spawn requires the same exact
binding. Foreign terminal-provider rows cannot launch a local bridge. Stale
target ids become unavailable, and terminal or multi-agent name ties dispatch
nothing; production-shaped immutable ids remain exact through multi-agent
planning and can disambiguate duplicate display names. Published custom rows require an exact connection id or explicit exact
gateway; custom gateway credentials require explicit owner authority and an
enabled exact normalized-endpoint match. `isOwn`, owner id, and current user id
must all be nonempty and agree before an alleged-own row may use a local token
or make its dispatch attempt. Terminal/custom send and launch
results carry `transportAccepted: true | false | null`; HTTP success, structured
acceptance, and exact selected-session echo are required. Ambiguous POST outcomes
stop without session replacement, endpoint/provider fan-out, or draft fallback.
Claude, Codex, and Gemini terminal servers require one case-sensitive exact
session id before input and reject aliases, prefixes, case folds, and duplicate
ids. Cursor exact-session send is intentionally unsupported until GUI focus can
be bound to one verified Composer conversation. Single-session launch
acceptance requires one receipt-safe exact returned session id. The receipt
retains it as external lineage, a selected DB agent keeps its DB subject, and
missing/unsafe/multiple lineage remains unknown with no replay or accepted run.
Office run attribution is exact-first; display names are legacy-only fallback.
Sequential Chat chains stop before dependent agents when upstream work is not a
usable synchronous draft. Keep `smoke:connected-agent-chat-handoff` green; it
now includes the ownership, credential-isolation, immutable-target,
sequential-pause, and 110-assertion no-replay suites.

Office-terminal and Feed/Kanban Claude Code launches must retain the same
distinction. A `/spawn` acknowledgement with one exact provider handle is
`accepted`, never completed; Office keeps the response/tracking task open and
records one queued `office_terminal` run. Timeout, transport loss, inconsistent
success, or malformed lineage is `outcome_unknown` and must not replay. Feed
keeps accepted task runs `running` and unknown dispatches `blocked`, with no
`completed_at`, completion proof, memory, or XP. A collaborative parent pauses
at the first accepted/unknown child and never dispatches the dependent agent
with acknowledgement prose. Feed owns one task-bearing attempt and must not
pre-send through `wakeAndAssignTask`; its Agent Tasks, Active Runs, history, and
activity rows render accepted/unknown explicitly.
Each accepted direct Feed attempt appends one best-effort queued `feed_task`
run linked to the exact task and task-run attempt. Persist its local UUID on the
task run and use only that UUID for Activity Feed or Task Detail to focus Office.
Ledger failure must preserve acceptance without replay; unknown and failed
attempts must create no accepted row.

OpenSwan Office/Feed sends require one exact `connectionId::sessionKey`, call
the canonical structured `sendSessionMessage` adapter, and never fall back to
`agent:main:main` or infer completion from assistant history. Stamp
`externalDispatchKind: sessions_send` and keep connection, session,
provider-run, and canonical run identities separate.

The published Office agent itself now has a source-wired, explicit
owner-private binding rather than an inferred runtime identity. In the
displayed OpenSwan session's Agent Gateway panel, the current owner can bind,
move, or clear one of their published OpenSwan Office agents against that exact
owner-owned `agents_bots` UUID and case-sensitive session key. Pending §36 adds
the no-backfill `office_agent_session_bindings` table, owner-only reads,
server-authorized set/clear RPCs, and `invoke_agent_v2`. The v2 RPC composes the
canonical claim once and returns a versioned bound/missing snapshot; it never
stores the provider session or gateway token on the public Office row.

Before Office or Feed sends, the pure resolver requires the exact Office UUID,
one and only one current local connection with `remoteId === agentBotId`, exact
`provider = openswan`, enabled/connected state, a non-placeholder hydrated
device-local token, and one and only one case-sensitive session-key match on
that same connection. It returns the exact local `connectionId::sessionKey` and
ephemeral config. There is no name, provider-wide, first-connection,
first-session, or main-session fallback; missing, stale, duplicate, offline, or
tokenless evidence maps to the fixed pre-dispatch binding error. The token
remains device-local and the durable binding does not make it available
cross-device. Session rows must be accompanied by the fingerprint captured in
the same poll generation (local id, private bot UUID, normalized endpoint);
duplicate ids, late/stale callbacks, and same-id connection replacement fail
closed before bind or send.

This binding slice has pure, source-wiring, and disposable PostgreSQL 14
coverage only. The disposable database applied §36 twice, retained one read
policy, produced a bound claim, denied direct writes, and cleared a stale
binding after the published agent provider changed. §36 is pending/not applied;
no live authenticated binding UI, external provider dispatch, production
migration, or deployment is claimed.
Typed provider final-result reconciliation remains pending. Apply pending §35
before depending on an Office `streaming` handoff remaining adoptable past the
legacy two-minute sweeper. Keep
`scripts/office-agent-accepted-handoff-smoketest.ts` registered in
`package.json` and green, together with
`scripts/office-agent-session-binding-core-smoketest.ts` and
`scripts/office-agent-session-binding-wiring-smoketest.ts`. The separate
`scripts/office-agent-session-connection-fingerprint-smoketest.ts` pins the
same-local-id replacement boundary: loaded session evidence is invalidated if
the private bot UUID or normalized endpoint changes before a bind or send.
`scripts/office-session-snapshot-fingerprint-smoketest.ts` pins the shared,
Office, and Feed snapshot/poller provenance wiring and is included in
`smoke:office-agent-session-binding`.
