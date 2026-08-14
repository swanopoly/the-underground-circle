# Office Dashboard & Connected Agents — Review + Improvement Plan

> 2026-07-11 (P38). Two-agent review of the Office surface (UI inventory +
> connected-agents data layer), synthesized into a ranked plan. Items built in
> P38 are marked. Owners: `src/screens/circles/tabs/OfficeTab.tsx` (~6.7k lines),
> pure libs `officeRoster.ts` / `officeAgents.ts` / `officeOpsBoard.ts` /
> `officeBridgeReadiness.ts` (all smoked), realtime layers
> `circleOffice.ts` / `agentHeartbeat.ts` / `agentPresence.ts`.
>
> **2026-08-12 addendum:** the addon/editor wave below is the current contract
> for placeable furniture and integrations. `docs/AGENTS_ROADMAP.md` remains
> canonical when this historical plan conflicts with current ownership.

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

## Addon catalog and reversible editor wave (2026-08-12)

Research against Gather's object/mapmaker patterns, Miro's template and
keyboard-navigation guidance, and WCAG 2.2's dragging-alternative and target-
size guidance pointed to the same product gap: Office did not need more loose
objects as much as it needed one discoverable, truthful, reversible system for
the objects it already had.

Primary references used for this wave:

- Gather [Objects overview](https://support.gather.town/articles/5874848981-objects-overview),
  [Mapmaker overview](https://support.gather.town/articles/9657827678-mapmaker-overview),
  and [advanced object options](https://support.gather.town/articles/5176614968-advanced-object-options)
- Miro [templates](https://help.miro.com/hc/en-us/articles/360017572134-Templates),
  [frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames), and
  [keyboard navigation](https://help.miro.com/hc/en-us/articles/11997028019858-Keyboard-navigation-while-working-on-boards)
- W3C WCAG 2.2 guidance for
  [dragging alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html),
  [minimum target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum),
  and [reduced motion](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)

| # | Item | Outcome | Evidence boundary |
|---|---|---|---|
| ~~O16~~ | **Exhaustive addon contract** | ✅ SHIPPED — `OFFICE_ADDON_TYPES` is the single 81-type list, `FurnitureType` derives from it, and each catalog entry owns kind, provenance, default truth state, primary action, interaction, configuration, readiness, motion, audio, tags, dimensions, category, and honest copy. Registry lookup replaces scattered interaction assumptions. | Source + `smoke:office-addon-registry`; no visual claim |
| ~~O17~~ | **Truthful connected-widget state** | ✅ SHIPPED — placed items may read Local, Demo data, Setup needed, Live, Update needed, or Unavailable. A saved URL/channel is local setup rather than proof of a provider session; only an actual successful provider/OAuth read may timestamp live state, and missing/old evidence ages to stale. Service setup no longer fabricates Spotify playback, Discord presence/counts, Twitch viewers, video-call participants, Figma connectivity, calendar/email payloads, or other live state. | Source/focused smoke; live providers and OAuth unverified |
| ~~O18~~ | **Catalog discovery** | ✅ SHIPPED — editor search spans name, description, tags, and primary action; category and Ready/Setup/Demo/Local state filters operate on actual placed-item runtime evidence. The visible catalog consumes the same pure query for bounded favorite/recent ordering without creating another catalog owner. | Core query smoke; responsive UI not visually exercised |
| ~~O19~~ | **Room kits** | ✅ SHIPPED — Agent Ops, Focus Lab, Launch Room, Review Room, and Social Lounge append deterministic, collision-safe, grid-snapped, bounds-clamped items using canonical catalog sizes and the existing floor capacity. | Core kit smoke; no live drag/layout review |
| ~~O20~~ | **Reversible editing** | ✅ SHIPPED — detached per-floor history defaults to 30 and hard-caps at 60 entries. Placement, duplicate, move, atomic resize, 90-degree rotate, layer order, reset size, kits, and confirmed deletion use one commit seam with undo/redo. Identical snapshots are ignored; layout undo preserves current connected/game fields, and a bounded per-floor item-state cache preserves configuration when an added item is undone and redone. Hydration and all edit paths share one center-rotation-aware floor constraint; web pointer gestures capture and filter the initiating pointer, while cancel, capture loss, blur, and unmount restore previews without committing and remove listeners. Edit mode hides the terminal dock that previously covered lower handles, and the authenticated system-Chrome canary hit-tests then performs real mouse move/resize with exact snapped commit plus undo/redo. | Core history + geometry/serialization/UI-wiring smokes and authenticated localhost trusted-pointer canary; native pointer QA remains pending |
| ~~O21~~ | **Mobile and non-drag accessibility** | ✅ SHIPPED — compact edit mode uses bounded collapsible Catalog/Kits/Items trays, preserves a meaningful floor region, and exposes every placed object through a 44px semantic selector; web items have semantic focus/labels, Enter/Space activation, one-grid arrow nudge, five-grid Shift+Arrow nudge, Delete/Backspace removal, accessibility actions, explicit selection, larger resize controls, and nested control isolation. Bridge and agent-panel controls add explicit expanded/disabled/busy/live-region semantics and 44px targets. Destructive item, floor, and clear-all actions require an explicit path and confirmation where scoped. | Source/typecheck/UI-wiring plus authenticated 390×844 selector/nudge/resize/floor-visibility/no-overflow canary; screen-reader and native QA pending |
| ~~O22~~ | **Dormant utility hardening** | ✅ HARDENED, NOT MOUNTED — `StatusPicker` exposes save/loading/error state and accessibility. `WorldClockBar` formats IANA zones with DST-safe refresh, invalid-zone fallback, and accessible labels. The main Office intentionally still omits the personal presence/timer strip and does not render the team clock bar; the placed `world_clock` object is the visible time surface. | Component source only; no visible rendering claim |
| ~~O23~~ | **Saved-layout and instance safety** | ✅ SHIPPED — local/server layouts pass one allowlisted sanitizer before render: unknown addons and malformed rows are dropped, both stored and rotated visual geometry are floor-bounded, IDs/current-floor identity are repaired, and unsafe media fields are removed. Duplicate Scrabble, Poker, and Phone items update only the opened instance; Phone reports its real provider and preserves zero unread. Farm crops, timestamps, water, gold, harvests, upgrades, fertilizer uses, and crop history persist through the same allowlisted layout path. Failed OAuth revocation remains visibly connected with explicit recovery copy. | Validation + UI-wiring smokes; authenticated provider/browser proof pending |
| ~~O24~~ | **Motion and hook stability** | ✅ SHIPPED — ambient Office animation loops stop when reduced motion is requested, and the Music Visualizer owns its animation values through one stable hook instead of calling hooks inside a loop. | Source/typecheck; OS-level reduced-motion visual QA pending |
| ~~O25~~ | **Catalog personalization** | ✅ SHIPPED — Favorites, Recent, and Needs Attention are visible catalog scopes. Favorites and the newest 20 recent types use a versioned, bounded, user-and-circle-scoped local preference record that drops malformed, unknown, oversized, or unsupported-version data. Same-scope actions made during asynchronous hydration merge instead of being overwritten. Favorite controls do not trigger placement; successful item selection/placement and kit application update recency. | Core + UI-wiring + authenticated same-browser reload; not §37 server or cross-device preference persistence |
| ~~O26~~ | **Floor lifecycle, status, and editor accessibility** | ✅ SHIPPED — Office caps creation at 10 floors, opens a new floor in edit mode, supports a sanitized 80-character inline rename, and keeps floor deletion and clear-all behind confirmations. Floor chips expose selected state plus item/agent counts; save failures become labelled retry actions and operation status uses a polite live region. While editing, nested widget controls leave pointer and accessibility traversal so the furniture wrapper owns selection, position, size, rotation, keyboard, and accessibility actions. | Source/typecheck/UI-wiring plus authenticated headless add/rename/delete and compact touch placement; screen-reader, free-form drag, and native QA pending |
| ~~O27~~ | **Collision-aware room-kit planning** | ✅ SHIPPED — `planOfficeRoomKit` builds a detached preview, tries the requested snapped origin, then performs a deterministic bounded row-major scan using canonical catalog dimensions, rotation-aware collision rectangles, internal-kit and existing-item checks, floor bounds, capacity, and fresh IDs. It distinguishes malformed input, capacity, no-free-region, and scan-limit failures; Office shows the bounded failure and commits a success once through undoable history. `OfficeTab` supplies the canonical 16px grid and 900×970 bounds from `officeFloorLayout.ts`. | Focused core smoke plus authenticated headless six-item Focus Lab application; free-form drag/layout QA pending |
| ~~O28~~ | **Isolated authenticated Office canary** | ✅ PASSED 2026-08-13 — `npm run e2e:office-authenticated-local` preflighted cleanup authority, created one disposable signed-in user/circle, and used ephemeral headless system Chrome rather than the persistent browser bridge. Its successful receipt verified desktop favorite/recent placement, exact trusted-mouse move/resize plus undo/redo, 90-degree rotation/duplicate geometry, coherent scoped-local and authenticated-server version-plus-payload convergence, reload reconstruction, floor add/rename/delete, the exact six-type Focus Lab kit, edit-mode nested-focus isolation, compact semantic selection/nudge/resize with a 533px visible floor and no horizontal overflow, reduced-motion matching, zero page/server errors, and zero-record cleanup. | Proves the linked authenticated localhost flow only—not deployment, native rendering, screen-reader traversal, providers/OAuth, negative RLS, or cross-device §37 persistence |
| ~~O29~~ | **Exact persistence and stale-continuation isolation** | ✅ SHIPPED — one versioned user-and-circle cache envelope serializes writes and verifies exact readback before server dispatch; strict RPC receipt parsing and local hydration reject malformed, mismatched, unsafe, and poisoned far-future versions. Async confirmations, image processing, retries, and preset load/save/apply/delete bind to the initiating scope and layout generation. Preset reads are filtered to the requested circle, apply/delete reject stale circle rows, and delete binds both `id` and `circle_id` plus verifies the returned row. The pending SQL hardening repairs old poisoned revisions before making the save RPC the sole layout mutation surface; it rejects unsafe/far-future versions, locks parent/child acknowledgement tables across legacy cleanup and FK validation, removes invalid legacy dismissals, enforces a durable run/circle FK, server-stamps acknowledgement expiry, and reads active acknowledgements against the server clock. A bounded compatibility write renews expired dismissals on the historical schema until that trigger lands. | Executable cache/receipt/SQL-contract plus disposable PostgreSQL 14 fresh/upgrade/behavior coverage and authenticated local/server convergence; authority/receipt follow-up is source-ready but not applied |
| ~~O30~~ | **Durable agent-roster ownership** | ✅ SHIPPED — floors declare automatic or manual assignment ownership. Automatic floors receive only live agents not already claimed by a manual floor and reconcile idempotently; applying a complete preset marks its captured roster manual so later bridge refreshes cannot overwrite it. Legacy floors normalize to automatic mode. | Executable reconciliation and preset-application regression; live multi-agent preset apply/reload remains pending |
| ~~O31~~ | **Truthful addon actions and unobstructed controls** | ✅ SHIPPED — agent sprites and placed items share the floor stacking context, so interactive objects sit above decorative sprites; edit-only layout removes the terminal/bridge obstruction boundary. Unconfigured Spotify, Discord, Twitch, Video Call, and Figma objects open setup instead of a vendor homepage or no-op, and malformed/non-HTTPS input fails visibly without replacing saved configuration. Button Panel and Launch Pad stage an editable command and accept only a currently connected exact agent target; opening or closing review writes no terminal command, and only explicit Send may dispatch. | Source/typecheck/UI-wiring plus authenticated localhost setup/exact-target/zero-pre-Send-dispatch canary; real provider/OAuth execution remains pending |

Validation command: `npm run check:office-addons`. It combines the addon
registry, experience, UI-wiring, dashboard-state, and structural validation
smokes plus app typecheck. This is deliberately not evidence of
live responsive web/native layout, screen-reader traversal, pointer/touch drag,
real provider/OAuth data, cross-device §37 persistence, or a mounted
`StatusPicker`/`WorldClockBar`. The separate guarded authenticated Office
canary passed on 2026-08-13 with desktop, compact-viewport, durable-save, and
verified-cleanup receipts; it remains localhost browser evidence, not deployed,
native, assistive-technology, provider, negative-RLS, or cross-device proof.
