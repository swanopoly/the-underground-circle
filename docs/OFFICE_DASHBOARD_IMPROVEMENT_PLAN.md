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
| O6 | **`agent_id` on `agent_runs`** (schema) — durable run→agent linkage so accountability/cost stop depending on name matching; needs migration + writer changes across run-creation sites + roadmap SQL checklist entry | Gap 1/7 | M | med |
| ~~O7~~ | **Publish-modal provider list from PROVIDER_META** ✅ SHIPPED (P39) — icon/label now derive from PROVIDER_META (drift was already real: 🦞 vs 🐾, 🖱️ vs 🎯); the curated agent-type ORDER stays local and 'generic-agent' keeps the friendlier "Other" label | Gap 6 | S | low |
| O8 | **Synthetic-agent live status** — drive OpenSwan/HuggingSwan status from live runs (they already appear in the ops board) instead of defaulting idle | Gap 8 | M | med |

Deliberately deferred: per-agent latency/error-rate metrics (needs O6 first),
config-izing every interval (low value), terminal theming (cosmetic).

## P38 validation

- Extended smokes: `office-ops-board` (accountability index: outcome lines,
  24h window, name keying, cost rollup, bounds/degenerates) and
  `office-roster-grouping` (reconcile: demote-when-stale+disconnected,
  keep-when-fresh, never-upgrade, note text, no-connection passthrough).
- `npm run typecheck` clean; full `smoke:all` green (exit 0) after wiring.
