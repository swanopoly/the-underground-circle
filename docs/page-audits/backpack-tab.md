# BackpackTab Audit

Source: `src/screens/circles/tabs/BackpackTab.tsx`
Last audited: 2026-08-17
Status: Source and focused smoke coverage hardened; live external mutations remain outside this audit.

## Product shell

- One typed registry owns exactly 14 destinations: Knowledge, Cost, Command,
  Farm, Performance, Analytics, Canvas, LLM Bench, Model Lab, Projects,
  Prompts, Traces, Devices, and Trading. The visual layout and focused router
  consume that registry so an orphaned or duplicate pocket fails the smoke.
- The overview is a code-native, semantic 2.5D Backpack. Static shell depth,
  gussets, raised pockets, fabric shading, hardware, straps, and contact shadows
  provide dimension without Three.js, Spline, SVG, a WebGL runtime, or
  continuous motion. Because the depth does not animate, reduced-motion users
  do not need a separate animation fallback.
- Every pocket is a real `Pressable` with a name, description, visible status,
  accessibility value, focus treatment, and stable test ID. Opening a
  compartment focuses its Back control; returning restores focus to the exact
  pocket or summary metric that opened it.
- Responsiveness follows the measured Backpack container rather than only the
  browser window. The compact layout moves side pockets into the bag, and the
  sub-420px layout wraps the remaining pockets so the object does not require
  horizontal scrolling. Hover and press feedback do not move pocket geometry.
- All 16 panel components behind the 14 destinations are lazy-loaded inside one
  shared `Suspense` and compartment error boundary. Knowledge is a normal,
  scrollable focused destination; it is no longer eagerly mounted in the
  overview. Projects intentionally composes Shared Memory, Project Rooms, and
  Session Tags in one focused workspace.

## Data, scope, and authority

- Backpack commits one atomic snapshot behind a circle-aware generation fence.
  Refresh, circle change, auth-account change, and unmount retire older reads.
  Cross-circle data is synchronously hidden; a same-scope refresh failure keeps
  the last successful snapshot and labels it stale instead of replacing it
  with zeroes or fallback agents.
- Session tags and agent reads use the exact authenticated user and circle.
  Terminal response history is ordered and fully paged in 1,000-row batches for
  the fixed 90-day window, then deduplicated before totals are derived. Local
  bridge connection secrets are not hydrated into analytics data.
- Costs are explicitly token-derived estimates, not provider billing receipts.
  Backpack reads the signed-in member's canonical per-circle Office preferences
  for budget alerts and shows a visible warning if those preferences cannot be
  loaded. It does not treat a dashboard alert as execution authority.
- Exact Office command dispatch separately re-reads that same canonical budget
  preference under the captured user/circle bearer authority. A configured
  hard limit is checked as a fail-closed pre-dispatch gate over a fixed,
  count-verified, paginated usage snapshot; unavailable settings, incomplete
  usage, retired authority, or a crossed limit prevents dispatch.
- The Backpack Command Center mounts recorded history only. Its command input,
  target/model controls, automations, local shell, training, agent creation,
  and deletion controls are absent. The `Open Office` action is the only route
  to the canonical exact-authority dispatcher, so hardware commands such as
  G-code cannot be issued through the Backpack terminal.
- First-load failure, stale-refresh, budget-preference failure, and lazy-panel
  failure have distinct truthful states and named retry or recovery actions.
  Empty agent health remains unknown rather than being reported as 100%.

## Dashboard review

- **Knowledge System:** Personal and circle modes have separate user/circle
  generation fences. Personal notes and memories remain private to the signed-in
  user; circle search and graph reads accept only `circle_shared` sources.
  Sharing a note is explicit and does not automatically promote it into agent
  memory. Circle agent briefs re-read and revalidate source visibility before
  save, and late searches or mutations cannot commit into a changed scope.
- **Cost, Farm, Performance, Model Lab, and LLM Bench:** Cost uses estimated
  authority; Farm and Performance call their derived telemetry directional;
  Model Lab is a disclosed sample/reference workspace; and LLM Bench separates
  curated comparison scores from live Hugging Face metadata. None claims an
  evaluation, training, deployment, SLA, or provider-billing receipt that does
  not exist.
- **Analytics:** The seven-day response and message reads check errors, page all
  rows in 500-row batches, chunk large profile/message-ID filters, and commit as
  one circle/member generation-fenced snapshot. Same-scope stale data can stay
  visible with an error; cross-scope data cannot. Realtime response/message
  events schedule a bounded refresh, and the UI states that the agent filter
  does not alter circle-wide seven-day metrics.
- **Projects and Shared Memory:** Project room list, agent, and activity reads
  are scope/generation fenced with visible retry states. Room status and delete
  mutations require an affected-row receipt before success is shown; create and
  refresh failures remain visible. Shared Memory captures auth for writes,
  verifies structured outcomes, detects saved-base conflicts, preserves the
  local draft, and offers an explicit load-latest recovery path.
- **Prompts:** Lists, versions, labels, and compiled prompts use exact
  bearer-bound user/circle reads with scope generations and a user-partitioned
  cache. Create, version, label, rollback, and delete paths verify mutation
  receipts, retain drafts or modal values on failure, and expose retry instead
  of presenting an optimistic success as committed.
- **Canvas:** Only the signed-in member's own agent token is draggable. Position
  persistence validates the affected row; failed saves return the token to its
  last authoritative position and expose a visible error. Late drag completions
  are generation fenced.
- **Traces:** Response, message, and profile reads check errors and are
  generation fenced. Pending, streaming, done, and error remain distinct, and
  retry does not disguise a failed load as an empty trace list. Trace cost is
  labeled as an estimate.
- **Devices:** Inventory and bridge actions inspect typed `{ ok }` receipts.
  G-code requires one exact serial port or exactly one bound network service,
  separates review from execution, displays the exact target and command, and
  requires a second named hardware confirmation. A busy fence prevents duplicate
  sends. The authenticated bridge recovery path points to port 7778.
- **Trading:** Portfolio, Positions, and History are visible routed panels.
  Mounting, focusing, or leaving the dashboard open does not schedule or poll
  autopilot. Exactly one autopilot invocation exists behind the explicit Bot
  `Run Now` action and is labeled `bot_tab_manual`; independently authorized
  server automation remains a separate authority. Initialization is atomic,
  error-visible, exact-auth checked, and generation fenced by user and circle.
  Pending/position badges, history, positions, and stop checks are user/circle
  scoped; old-scope data is synchronously hidden, reads have Retry/refresh/busy
  states, and an in-flight stop check aborts if scope changes.

## Verification

- `npm run smoke:backpack-dashboard` checks the exact 14-item inventory and
  route map, lazy boundary, Knowledge route and scrolling, Office read-only
  handoff, responsive semantic 2.5D construction, static depth, truthful status
  labels, budget/cost boundary, Device target confirmation, dashboard
  provenance notices, read recovery, mutation receipt contracts, and Trading
  route restoration.
- `npm run smoke:backpack-data-lifecycle` executes refresh, circle-change, and
  retire behavior against the pure load fence, then checks exact scope, stale
  snapshot, visible error, full 90-day pagination, and the secret boundary.
- `npm run smoke:second-brain` covers Knowledge graph, capture, review,
  visibility-aware search, promotion, brief, and database-map behavior. Focused
  Prompt, terminal-authority, memory-write, Device-approval, and mutation
  reliability smokes cover their respective authority boundaries.
- App typecheck and scoped `git diff --check` are required after all concurrent
  Backpack dashboard repairs land; a source smoke is not a substitute for a
  mounted authenticated review.

## Verification boundaries and remaining limitations

- These smokes are pure or source-level. They do not mount React Native, click
  all 14 pockets, validate a screen reader, or prove Supabase policies and
  external services in every deployment. Final release QA requires an
  owner-authenticated Circle because Backpack is an owner-only surface; verify
  desktop and compact layouts, keyboard focus return, scrolling, and each route
  from that session.
- No printer, serial device, 3D printer, USB device, provider billing account,
  model-training service, deployment target, or blockchain wallet was mutated
  by this audit. Receipt and confirmation code proves the application boundary,
  not the physical, provider, or chain after-state.
- Model Lab sample workflows and LLM Bench curated scores remain reference-only
  until backed by dated execution receipts. Cost remains estimated until
  provider billing data is connected.
- The legacy experimental WebGL/3D Backpack files are not part of the active
  hub and were not revived or treated as production-ready.
