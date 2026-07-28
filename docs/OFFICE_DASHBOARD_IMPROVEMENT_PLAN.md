# Office Dashboard & Connected Agents — Review + Improvement Plan

> 2026-07-11 (P38). Two-agent review of the Office surface (UI inventory +
> connected-agents data layer), synthesized into a ranked plan. Items built in
> P38 are marked. Owners: `src/screens/circles/tabs/OfficeTab.tsx` (~6.7k lines),
> pure libs `officeRoster.ts` / `officeAgents.ts` / `officeOpsBoard.ts` /
> `officeBridgeReadiness.ts` (all smoked), realtime layers
> `circleOffice.ts` / `agentHeartbeat.ts` / `agentPresence.ts`.

## What the review found (condensed, verified)

**UI inventory.** Office renders: attention strip + HITL approval banner +
standing grants + schedules + run-history drawer (top); computer-task card,
budget alerts, bridges section; workspace (floor tabs/edit/canvas);
mobile = ops cards (Building Now + Tokens) → circle panel → agent cards →
activity feed; desktop = isometric floor + lazy Whiteboard/Server-Rack
overlays + quick chip bar; runtime terminal section; AgentPanel detail rail;
10+ lazy modals.

**Data layer.** Roster = pure `buildOfficeRoster` (sessions + circle rows +
connections + identities; provider-mains, pinned OpenSwan/HuggingSwan). Status
= session-activity decay (active <15s → building <3m → idle <1h → offline) or
30s heartbeat for published rows, plus presence overrides. Ops board = pure
builders over `agent_runs` via `listCircleLiveRuns` (15s poll + realtime).
Bridge readiness snapshot exists (`officeBridgeReadiness.ts`) but is consumed
ONLY inside the desktop Whiteboard overlay.

**Verified gaps.**
1. Run→agent linkage is name-matching only (`delegated_to`/title/surface label
   → `opsRunNodesByAgent` keyed by lowercased agent name). No `agent_id` on
   `agent_runs` (schema).
2. No per-agent accountability: an agent card shows cost + live tools, but NOT
   "what did it last do and did it work" (last outcome, 24h completed/failed).
3. Dead-bridge staleness: when an execution bridge dies, session-derived
   status decays through building/idle for up to an hour — an agent can read
   "Active/Building" with no working bridge behind it. Connection state exists
   at the choke point (`buildOfficeRoster` receives `connections`) but is not
   reconciled into status.
4. ~~Desktop/mobile asymmetry for the ops cards~~ — WITHDRAWN on verification:
   the desktop main view already renders the ops row beneath the floor
   (`opsBoardRow`); the review agent's claim was wrong.
5. Dead code: `OfficeActionPanel` imported but never rendered; `OfficeChat.tsx`
   unused in the current flow.
6. Misc hardcodes: publish-modal provider list duplicated from PROVIDER_META,
   fixed thresholds/intervals, monochrome terminal palette.
7. No per-agent health metrics (error rate/latency) and no per-agent cost
   attribution at the DB level (per-run only).
8. Synthetic pinned agents (OpenSwan/HuggingSwan) read idle even mid-task
   unless explicitly status-bumped.

## Ranked plan

| # | Improvement | Anchor | Effort | Risk |
|---|---|---|---|---|
| ~~O1~~ | **Per-agent accountability rollup** ✅ SHIPPED (P38) — pure `buildOfficeAgentAccountabilityIndex(runs,{nowMs})` in `officeOpsBoard.ts` (reuses the board's agent-name seam): last finished outcome ("✅/❌ <title> · 2h ago") + 24h completed/failed counts + 24h cost per agent; rendered on mobile agent cards (`OfficeAgentAccountabilityLine`) and as ✓/✗ counts on desktop quick chips. Ops fetch widened to a 24h finished window (builder self-filters its 10-min recent list, so the building board is unchanged) | Gap 2; accountability is priority #1 | S-M | low |
| ~~O2~~ | **Bridge-aware status reconcile** ✅ SHIPPED (P38) — pure `reconcileAgentStatusWithConnection` in `officeAgents.ts`, applied inside `buildOfficeRoster` (the choke point already holding `connections`): an active/building agent whose own connection is disconnected/errored and whose lastActive is stale (>60s) demotes to offline with a visible `statusNote` ("bridge offline — status stale"); fresh activity keeps status but still notes "bridge disconnected". Fail-visible: only demotes + annotates, never upgrades or hides | Gap 3 | S | low |
| ~~O3~~ | **Desktop ops parity** — CORRECTED during build: the review's "mobile-only" claim was wrong; the desktop main view already renders the ops row beneath the floor (OfficeTab `opsBoardRow`). No change needed | Gap 4 (withdrawn) | — | — |
| ~~O4~~ | **Dead-code sweep (safe slice)** ✅ SHIPPED (P38) — removed the unrendered `OfficeActionPanel` import from OfficeTab. (`OfficeChat.tsx` left in place — exported component, may be re-wired.) | Gap 5 | S | none |
| ~~O5~~ | **Bridge readiness out of the overlay** ✅ SHIPPED (P39) — extracted the Whiteboard's inline probe→snapshot composition into the single owner `src/lib/officeBridgeReadinessProbe.ts` (mirrors appReachabilityProbe; never throws — failures fold into the snapshot, fail-visible); Whiteboard refactored to call it; new `OfficeBridgeReadinessStrip` renders warn/danger states on the MAIN Office view (both form factors, next to the connect panel — happy state stays the panel's "✓ Connected" chip, muted/unavailable runtimes stay silent); OfficeTab polls it every 60s | Gap 3 adjacent | S-M | low |
| ~~O6~~ | **`agent_id` on `agent_runs`** ✅ BUILT (2026-07-24) — **SQL pending, see below** | Gap 1/7 | M | med |
| ~~O7~~ | **Publish-modal provider list from PROVIDER_META** ✅ SHIPPED (P39) — icon/label now derive from PROVIDER_META (drift was already real: 🦞 vs 🐾, 🖱️ vs 🎯); the curated agent-type ORDER stays local and 'generic-agent' keeps the friendlier "Other" label | Gap 6 | S | low |
| ~~O8~~ | **Synthetic-agent live status** ✅ SHIPPED — `deriveSyntheticAgentStatusFromRuns` + `applySyntheticAgentStatusUpgrade` in `officeOpsBoard.ts` (upgrade-only ladder, the mirror image of O2's demote-only reconcile); wired in OfficeTab `displayAgents` and at parity in `AgentsScreenLive.tsx` | Gap 8 | M | med |

Deliberately deferred: per-agent latency/error-rate metrics (needs O6 first),
config-izing every interval (low value), terminal theming (cosmetic).

## Floor / pixel-agent wave (2026-07-24)

The prior waves fixed the Office's **data** layer. This one is about the
**desktop isometric floor** — the surface that had all the liveliness and none
of the accountability, and whose sprite component (`PixelAgent.tsx`, 3.8k lines)
had accumulated real defects behind the animation.

| # | Item | Anchor | Effort | Risk |
|---|---|---|---|---|
| ~~O9~~ | **Desk accountability plaque** ✅ SHIPPED — the floor showed status/XP/bob but never whether the work landed: a sprite could read "Active" and stack XP while its last three runs failed and its bridge was dead. New pure `buildOfficeDeskAccountabilityPlaque(entry, statusNote)` in `officeOpsBoard.ts` (reuses O1's accountability index + O2's status note) renders a bounded ✓n ✗n plaque under the name tag, tinted by a severity-ordered tone (**danger > warn > good > neutral** — a real failure outranks "we can't trust this status", and the note is never hidden, only out-ranked for colour). Full outcome line stays in the tooltip/detail rail | Gap 2 on the desktop floor | S-M | low |
| ~~O10~~ | **Memo comparator was dropping the fields its own effects read** ✅ SHIPPED — `PixelAgent`'s `memo` comparator omitted `agent.costToday` and `agent.activity`, so two complete features were dead: the cost floats (`-$0.003`, `$0.10 SPENT`, `$1 MILESTONE!`) and 🔥 cost-spike mood never fired, and the build-activity floats (`SCANNING…`, `OPTIMIZING…`) only landed when an unrelated compared field changed in the same tick. Added `costToday`/`activity`/`color` + the plaque fields | correctness | S | low |
| ~~O11~~ | **Dead idle animation restored, motion-tiered** ✅ SHIPPED — `bobAnim`/`breatheAnim`/`swayAnim`/`lookAnim` were declared and wired into the render tree (drop-shadow scale, ambient particles, body `scaleX`, head offset) but **no loop ever started them**, so every sprite sat frozen at its rest value. One driver effect now runs all four, tiered by crowd (offline → parked · 7+ → breathe · 4-6 → +bob · 1-3 → +sway/look) and faster while working, so a busy floor reads busy | polish | S | low |
| ~~O12~~ | **Animation loops gated on what the agent actually renders** ✅ SHIPPED — the 4 aura loops ran for *every* agent even when `aura === 'none'`, and the 5 recursive pet timer chains ran even when `pet === 'none'` (the default appearance is both). Now gated on `hasAura`/`hasPet`. Also fixed the pet + limb-fidget effects' `[]` deps, which pinned crowd-derived amplitudes to first mount — a floor that filled up kept animating at 1-agent intensity forever | perf | S | low |

| ~~O13~~ | **Per-agent build XP** ✅ SHIPPED — the floor passed the **circle user's** lifetime points to every sprite (`xp={userXp}`), so all 16 desks rendered an identical bar under a per-agent name tag, while each sprite floated its own `+N BUILD XP` numbers that filled nothing: two currencies stacked on each other. New pure `buildOfficeAgentXp(turns, tokens)` in `officeOpsBoard.ts` is the cumulative form of PixelAgent's per-event `getBuildXpGain` (the two are in lockstep by test), with a growing level curve, a level-99 ceiling, and bar invariants that hold across the whole curve. `XPBar` now fills over the current level (`L4 69%`) and reserves the rainbow MAX for the real ceiling; the redundant per-source `BUILD XP` floats are suppressed under per-agent XP so one event produces one float that matches the bar | honesty | S-M | low |
| ~~O14~~ | **Office realtime made reconnect-safe** ✅ SHIPPED — the reconnect core existed (`resilientSubscriptionCore` / `subscribeWithReconnect` / `useResilientSubscription`) but **no Office channel used it**: after any blip or laptop sleep the roster, terminal, memory panel, analytics and GitHub wall went stale FOREVER, silently. All nine Office channels migrated, with `onCatchUp` wired wherever a real refetch exists. Two additions to the shared wrapper were required: `channelConfig` passthrough (the terminal command channel needs `broadcast: { self: true }` re-applied on every reconnect) and `getChannel()` (the terminal's send path shared that channel; a cached reference would send into a channel reconnect had replaced). Also migrated a bare `supabase.auth.getUser()` to `safeGetUser` while in `Whiteboard.tsx` | gaps-doc #1 | M | low-med |
| ~~O15~~ | **OfficeTab decomposition: 7,028 → 5,761 lines (−18%)** ✅ SHIPPED — stylesheets → `office/officeTabStyles.ts` (909 lines, verbatim, zero behaviour risk — the same move the OpenSwan console wave made); `CircleOfficePanel` + `OfficeConnectBridgesSection` + `BridgeUnavailableBanner` → `office/CircleOfficePanel.tsx` (self-contained, no prop threading); and the run↔agent attribution helpers → the new **pure** `src/lib/officeRunLookup.ts` with 37 smoke cases (`npm run smoke:office-run-lookup`) | structure | M | low |

### O6 — built, SQL pending

`agent_runs.agent_id` (**text**, not a uuid FK: the roster mixes published
`circle_office_agents` rows with session-derived local-bridge agents that have
no DB row, and text carries the canonical runtime subject key for both).
`AgentRun.agent_id?: string` and `deriveRunSubjectIdentity` already assumed
these semantics — this promotes it to a real, indexed column.

- Migration `supabase/migrations/20260724_agent_runs_agent_id.sql`, mirrored as
  `docs/RUN_THIS_SQL.sql` **§25**, roadmap SQL checklist row 25 → **Pending**.
- Writer: `createRun` derives the value at ONE chokepoint from the subject key
  every writer already stamps into run metadata, so all six call sites start
  persisting durable attribution with no call-site change.
- **Fail-soft**: if the column is missing, the insert is retried without it and
  logs a §25 pointer — runs are never lost, attribution just stays on the
  pre-O6 name-matching fallback. Safe to apply before or after a deploy.
- Deliberately conservative: the helper reads *exactly* the four subject-key
  sources `deriveRunSubjectIdentity` reads and ignores `metadata.agentId`
  (other writers use that field for connection/session ids; persisting one
  would make the column itself a false attribution the reader would trust).
  Unresolvable → null → unchanged fallback.

**Follow-up:** the helper's canonical home is `agentRuntimeSubject.ts`, but that
file is **root-owned and unwritable** (75 files under `src`/`scripts`/`docs`
are). It is private in `agentRunSystem.ts` for now — and therefore not
smoke-testable, since that module imports supabase. After a `chown`, move it to
`agentRuntimeSubject.ts` and cover it.

Validation: `smoke:office-ops-board` 161 passing (16 plaque + 19 XP cases added),
new `smoke:office-run-lookup` 37 passing, `smoke:office-roster-grouping` /
`-validation` / `-bridge-readiness` / `smoke:resilient-subscription` green,
`npm run typecheck` clean.

## P38 validation

- Extended smokes: `office-ops-board` (accountability index: outcome lines,
  24h window, name keying, cost rollup, bounds/degenerates) and
  `office-roster-grouping` (reconcile: demote-when-stale+disconnected,
  keep-when-fresh, never-upgrade, note text, no-connection passthrough).
- `npm run typecheck` clean; full `smoke:all` green (exit 0) after wiring.
