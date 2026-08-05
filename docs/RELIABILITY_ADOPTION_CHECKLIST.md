# Reliability Cores — Adoption Checklist

> Precise call-site checklist for wiring the five committed reliability cores into
> Chat / Office / Feed. Companion to `docs/CHAT_OFFICE_FEED_NEXT_GAPS.md` (the
> analysis) — this doc is the **adopt-the-helper** map.
> Author: adoption-audit subagent · Date: 2026-07-16 · Scope: **analysis only, no
> code edited.** Every row is grounded in a verified `file:line`.

## The five cores (all committed, all PURE, all currently UNADOPTED)

Repo-wide grep confirms **zero runtime callers** of any core export today — the
brains exist, nothing wires them yet.

| Core file | Gap | Key exports (what a call site invokes) |
|---|---|---|
| `src/lib/resilientSubscriptionCore.ts` | #1 silent-staleness / reconnect | `planReconnect({state,consecutiveFailures,nowMs,lastAttemptMs})`, `assessSubscriptionHealth({state,lastEventMs,nowMs,heartbeatMs})`, `describeHealth(health)`, `normalizeSubscriptionState(raw)` |
| `src/lib/runFreshnessCore.ts` | #2 3-way live-run freshness | `classifyRunFreshness({status,updatedAtMs,nowMs})→{freshness,label,ageMs}`, `runEmptyStateModel({hasRuns,loading,error})→{kind,message}`, `freshnessRank(freshness)` |
| `src/lib/transportFailoverBadgeCore.ts` | #3 invisible failover | `buildFailoverBadge(servedBy)→badge\|null` (render), `failoverMetadataPatch(servedBy)→{failover?}` (persist), `readFailoverBadgeFromMetadata(metadata)→badge\|null` (Feed/Office read) |
| `src/lib/entityHandleCore.ts` | #4 nav dead-ends | `encodeEntityHandle({kind,id,surface?})→string` (dispatch), `decodeEntityHandle(str)→handle\|null` (listener), `targetSurfaceForEntity(kind)` |
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
| 16 | `src/screens/circles/CircleDetailScreen.tsx:226-238` (`onSwitchTab`, `normalizeTabKey:229`) | entityHandle | **SAFE** | In the `uc:switch-tab` listener, read `e.detail.focus`; if `decodeEntityHandle(focus)` is non-null, `normalizeTabKey(handle.surface)` and open the matching run/thread/task drawer the surface already has (Office `open_run`, Chat thread select). |
| 17 | `src/screens/circles/tabs/FeedTab.tsx:281` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({ kind:'run'\|'thread', id })` to the `uc:switch-tab` detail (today `{ tab:'CHAT' }` only) so "ask the agent" lands on the specific thread/run. |
| 18 | `src/screens/circles/tabs/OfficeTab.tsx:4222` | entityHandle | **SAFE** | Add `focus` handle to the `{ tab:'CHAT' }` dispatch (e.g. `encodeEntityHandle({kind:'agent'\|'run', id})`). |
| 19 | `src/screens/circles/tabs/MissionsTab.tsx:389` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({kind:'mission', id})` to the `{ tab: action.value }` dispatch. |
| 20 | `src/screens/circles/tabs/ProfileTab.tsx:22` | entityHandle | **SAFE** | Add optional `focus` handle to the `{ tab:'CHAT' }` dispatch. |
| 21 | `src/lib/missionChatCommands.ts:176` | entityHandle | **SAFE** | Add `focus: encodeEntityHandle({kind:'mission', id})` to the `{ tab:'FEED' }` dispatch. |
| 22 | `src/lib/chatAgentService.ts:132-165` (`persistMainChatBotMessageWithRetry` → `formatPersistedChatBotMessage`) | transportFailoverBadge | **SAFE** | It already forwards `routing`. Derive `servedBy = normalizeStructuredResponse(structured).servedBy` (chatLaneOutcome.ts:309) and spread `failoverMetadataPatch(servedBy)` into the persisted metadata so Feed/Office run cards can later call `readFailoverBadgeFromMetadata`. |
| 23 | `src/lib/persistedChatMetadata.ts` (`formatPersistedChatBotMessage`, `PersistedChatBotMetadata` type ~113) | transportFailoverBadge | **SAFE** | Accept + emit the bounded `failover` field (namespaced object from `failoverMetadataPatch`); add a `readFailoverBadgeFromMetadata` pass-through for run-card consumers. |
| 24 | `src/screens/circles/tabs/ChatTab.tsx:10082` (assistant-bubble `updateBotMessage` on the OpenSwan v2 success path) + message-bubble render | transportFailoverBadge | **HOT** | Render `buildFailoverBadge(servedBy)` as a compact turn chip (mirror the BlackSwan notice) when non-null. `servedBy` via `normalizeStructuredResponse(structured)`; `structured.routing.routing_fallback` is already read at :10042. |
| 25 | `src/screens/circles/tabs/ChatTab.tsx:10133` (`persistMainChatBotMessageWithRetry` call) | transportFailoverBadge | **HOT** | Pass the failover-patched metadata through (pairs with #22 — if #22 does the derive inside the SAFE helper, this call site is untouched). |
| 26 | `src/screens/circles/tabs/ChatTab.tsx:4232` and `:11882` | entityHandle | **HOT** | The two Chat-owned `uc:switch-tab` dispatches — add optional `focus` handle. |
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
4. **entityHandle** (#16–#21) — SAFE nav; listener first (#16) then dispatchers.
5. **transportFailoverBadge persist** (#22–#23) — SAFE; render chip (#24) is HOT.
6. **HOT rows** (#24–#30) — hand to the owner of each protected file.

## Validation

- Per-core smoke scripts follow the house rule (dependency-light, `import type`
  only). The four pure cores (`resilientSubscriptionCore`, `runFreshnessCore`,
  `connectionStatusCore`, `entityHandleCore`, `transportFailoverBadgeCore`) each
  need a `smoke:*` entry — **`package.json` registration is HOT** (owner-only).
- Keep every realtime adoption **fail-visible**: a dropped channel must render
  `reconnecting`/`stale`, never a frozen board that still looks live.
</content>
</invoke>
