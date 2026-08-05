# Chat UX & Integration Upgrade Plan

> Created: 2026-07-01
> Inputs: internal chat usability review (15 friction points), cross-system
> integration seam audit (8 seams / 10 ranked gaps), and external research on
> proven 2025–2026 agentic chat UX patterns (Claude Code, ChatGPT agent,
> Devin, Manus, Copilot mission control, LangChain Agent Inbox).
> Companion docs: `docs/AI_FIRST_COMPUTER_INTEGRATION_PLAN.md` (runtime),
> `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md` (CA phases),
> `docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md` (evidence contract).

## North Star

Chat is the command center: **intent, steering, and approvals** live in chat;
**fleet view, grants, and memory** live in Office; **proof and accountability**
live in Feed. All three render the same canonical run objects
(`agent_runs` / `agent_run_events`). The user should never have to wonder:

1. Is it working, stuck, or waiting on me?
2. What exactly is it about to do, and can I say no / edit / cancel?
3. What did it produce, and how do I follow up on it?

## Diagnosis (what converged across all three inputs)

### A. Blocked/waiting states are invisible (top cluster)
- Approvals expire silently after 15 min (`chatApprovalGate.ts` timeout);
  no expiry notice, no countdown, no re-ask path.
- Existing approvals are silently reused via idempotency-key dedupe; the
  user never learns a prior approval covered the new request.
- Pending clarifications (`ask_clarification`) and mid-task computer
  questions live only in in-memory stores; a reload strands the task with
  no visible "waiting on your answer" state.
- Recovery options render inline on the failed message and scroll away;
  there is no cancel affordance on blocked plans.

### B. Outcomes speak runtime, not user
- Errors surface as jargon (`ETIMEDOUT`, "bridge unreachable", generic
  "execution failed") with no next action.
- Provider failures (missing key, quota) are indistinguishable from agent
  failures; no "connect X in Marketplace" pointer.
- Model substitution (Sonnet pin for computer use) is shown tersely with no
  explanation, eroding trust.

### C. Results and attribution stay buried
- Computer findings (WI-4) persist in metadata but render only in
  RunHistoryDrawer; "book option 2" (WI-5) has no inline surface.
- `memoryRefs`, skills used, and plan decisions are carried in
  `persistedChatMetadata` but never displayed.
- Chat-created missions/tasks give no completion/proof feedback in the
  originating thread ("open the Missions tab").

### D. Cross-surface seams
- Office agent activity, room handoff, thread lineage, and standing grants
  are all invisible from chat.

## External patterns adopted (proven elsewhere)

| Pattern | Source products | Where it lands here |
|---|---|---|
| Agent inbox / "Needs you" queue | LangChain Agent Inbox, GitHub agents panel | `chatAttentionQueue.ts` → ChatTab strip, later Office queue |
| Approval card w/ accept–edit–respond–cancel + visible payload | Claude Code, ChatGPT agent, Agent Inbox | `chatApprovalGate` + HitlApprovalBanner |
| Scoped, expiring "always allow" grants w/ reviewable list | Claude Code permissions (incl. its failure modes) | `computerTaskGrants` + Office grants list |
| Enumerated persisted findings for follow-ups | ChatGPT tasks, session-resume research | `persistedChatMetadata.computerFindings` inline card |
| Live step ledger (curated, not log dump) | Manus, ChatGPT agent, Copilot sessions | executionStream metadata → inline step strip |
| Error → next-action receipts | Cursor/Copilot proof receipts, tool-receipt research | `chatUserFacingOutcomes.ts` |
| Mid-run steering at tool boundary | GitHub mission control, Devin | `computerTaskRuntime` steering observation |
| Visible/editable memory attribution | ChatGPT/Claude memory UX | memoryRefs disclosure line |

## Phases

Rules for every phase: logic lives in pure lib modules (import-type-only so
tsx smoke scripts load them), ChatTab gets thin wiring only, payloads stay
bounded, `npm run typecheck` and the narrow smoke script must pass, and
approval-floor semantics (pay/delete/login/grant) are never weakened.

### Phase 1 — "Needs You" attention system (COMPLETE 2026-07-01)

Fixes diagnosis A. New owner module + gate transparency + thin ChatTab wire.

- **1a. `src/lib/chatAttentionQueue.ts`** (new owner, pure):
  - `ChatAttentionItem` kinds: `approval_pending`, `approval_expiring`,
    `approval_expired`, `clarification_waiting`, `task_question_waiting`,
    `recovery_available`, `provider_blocked`.
  - `buildChatAttentionState(inputs, opts)` aggregates pending approvals
    (with `expiresAt`), the clarification resume store snapshot, pending
    computer-task questions, unresolved recovery options, and provider
    blockers into one ranked list + status line ("Needs you: 1 approval
    (expires in 4m) · 1 question").
  - Per-item primary/secondary actions (approve / answer / retry / cancel /
    open marketplace) as typed descriptors — UI renders, module decides.
  - Injectable `now` (no Date.now in module) so smoke tests are deterministic.
- **1b. `chatApprovalGate.ts` transparency**:
  - Deferred results carry `expiresAt` (requested_at + timeout) so UI can
    show countdown and expiry can be announced instead of silent.
  - Passing due to an existing approved row returns a `reused` notice
    ("Using approval `abc123` you granted for …") instead of silence.
  - Refiling after expiry says the previous approval expired.
  - Gate result stays contract-compatible with `runChatAutomationPlan`
    (additive fields only).
- **1c. ChatTab wiring** (thin): compute attention state from
  `pendingHitlApprovals` + clarification resume store + computer task state;
  render a compact strip above the composer next to `HitlApprovalBanner`,
  including on reload (resurrects waiting states).
- **Validation**: `scripts/chat-attention-queue-smoketest.ts` +
  `npm run smoke:chat-attention-queue`; existing planner/approval smokes.

### Phase 2 — Plain-language outcomes (COMPLETE 2026-07-01)

Fixes diagnosis B.

- **2a. `src/lib/chatUserFacingOutcomes.ts`** (new owner, pure): map
  failure taxonomy (`agentFailureTaxonomy`), bridge states, provider errors,
  and dispatch outcome statuses to `{summary, nextAction, actionTarget}`.
  Provider-missing errors point at Marketplace with the provider named.
- **2b.** Apply in ChatTab outcome rendering and
  `useComputerUseTask` error sanitization (replace strip-jargon with
  translate-to-action). Model-substitution explanation rendered from
  `modelResolution` metadata in one friendly sentence.
- **2c.** Checkpoint restore feedback (success/drift-refusal toast) via
  `chatCheckpoints` result surfaced through the same outcome formatter.

### Phase 3 — Inline results, findings, attribution (COMPLETE 2026-07-01)

Fixes diagnosis C.

- **3a.** Inline findings card: render `PersistedComputerFindings` (already
  bounded, stable ordering) in the message body with numbered options and a
  follow-up hint; router resolves "option 2" against persisted IDs
  deterministically (extend `chatComputerRequestRouter` follow-up path).
- **3b.** Attribution line under bot replies from `memoryRefs` /
  skills-used metadata ("Used memory: pricing rules · Skill: wp-publish"),
  linking to the editable entry; one-tap "remember this" that routes through
  the existing HITL memory-write gate.
- **3c.** Feed feedback loop: mission/task creation from chat stamps the
  thread; completion/proof events append a compact receipt to the
  originating thread (proof-of-work receipt pattern: action → evidence →
  verification status).

### Phase 4 — Cross-surface continuity (COMPLETE 2026-07-01)

Fixes diagnosis D. Sequenced last because 1–3 create the shared primitives.

- **4a.** Circle-wide "Needs you" queue in Office consuming the same
  `chatAttentionQueue` items across runs (any authorized member can unblock;
  unblock attributed in Feed).
- **4b.** Thread lineage indicator in the thread header (parent → fork →
  compression chain from `chatThreadLineage`) + "continue from here".
- **4c.** Room handoff: "continue in room X" suggestion when a conversation
  spans multiple files; hands thread context to room chat.
- **4d.** Grants hygiene: standing grants list (scope, expiry, revoke) and
  periodic prune prompts on top of `computerTaskGrants`.
- **4e.** Mid-run steering: chat message to a live computer task is injected
  at the next loop boundary as a steering observation (with explicit "stop
  instead" alternative).

## Non-goals

- No weakening of the always-confirm floor or evidence contract.
- No new copy invented outside the UX owners (`chatComputerRequestUx`,
  `chatComputerHandoffContext` stay canonical for computer-task wording).
- No unbounded metadata growth on persisted rows.

## Status log

- 2026-07-01: Plan created.
- 2026-07-01: Phase 1a shipped — `src/lib/chatAttentionQueue.ts` +
  `scripts/chat-attention-queue-smoketest.ts` (`npm run
  smoke:chat-attention-queue`).
- 2026-07-01: Phase 1b shipped — `chatApprovalGate` now: (1) returns a
  reuse notice + covering approval id when an existing approval passes the
  gate (dispatcher surfaces it as `data.approvalNotice` / outcome
  `approvalId`); (2) carries `expiresAt` on pending/filed deferrals
  (`data.approvalExpiresAt`); (3) treats past-timeout pending rows as
  expired — flips the stale row best-effort and refiles with an explicit
  "your earlier approval expired" message (previously a stale row deferred
  forever; nothing sweeps `agent_approvals` to `expired`).
- 2026-07-01: Phase 1c shipped — `src/components/ChatAttentionStrip.tsx`
  rendered above `HitlApprovalBanner` in ChatTab. Strip shows the
  `chatAttentionQueue` status line + rows for expired approvals ("Ask
  again" re-dispatches the original command), parked clarifications
  (dismissable), and live computer-task questions ("Stop task" cancels).
  Live pending approvals stay in `HitlApprovalBanner` (which has the
  approve/reject buttons); the status line still counts them.
  Follow-ups deferred: approvalNotice on *completed* outcome messages
  (handlers post their own success text), recovery-option + provider
  blocker inputs into the strip, on-reload resurrection of clarifications
  (store is in-memory per session).
- 2026-07-01 (later): **Phase 1 complete** — all three deferred follow-ups
  shipped:
  - Completed outcomes now post the gate's approval-reuse notice as its own
    compact line (`postDispatcherStopOutcome`), and a completed run clears
    any provider blocker.
  - The attention strip now takes recovery options from the latest bot
    message (recovery is offered exactly while the failure is the freshest
    state; item ids keyed by message id via `recoveryRefId` so dismissing
    one failure never hides the next) and provider blockers classified by
    the Phase 2a translator. "Choose recovery" sends the recommended
    option's label as a normal reply; "Open Marketplace" reuses
    `handleSidebarMarketplace`.
  - Parked clarifications persist to localStorage
    (`uc_pending_clarifications::<circleId>`, ≤5 entries, same 15-minute
    freshness window as the resume path) and rehydrate on mount, so
    "Waiting on you: …" survives a reload.
- 2026-07-01 (later): **Phase 2 shipped**:
  - 2a — `src/lib/chatUserFacingOutcomes.ts` (pure, on top of
    `agentFailureTaxonomy.classifyAgentFailure`): failure → {plain summary,
    one next action, action target, provider}. Null contract: unclassified
    failures return null so callers keep their copy — the translator can
    only improve wording. Provider display names are presentation-only
    (routing stays in `llmProviders`). Smoke:
    `npm run smoke:chat-user-facing-outcomes`.
  - 2b — applied at three seams: failed/blocked dispatcher outcomes lead
    with the translation + keep the raw message as a `Details:` line;
    computer-use error display (`useComputerUseTask` sanitize now delegates
    to `translateComputerUseErrorMessage`; raw text still lands in
    `rawErrorMessage`); model-substitution notice reworded to say WHY
    ("Screen loop needs computer-use, so it runs on <pin>; your pick (<id>)
    still plans and verifies") — stays under the 160-char bounded-payload
    assertion; copy owner remains `chatComputerHandoffContext`.
  - 2c — checkpoint restore is now visible in chat: memory-bank writes
    return `checkpointId`, ChatTab renders a live `ToolCallCheckpointStrip`
    (Restore/Compare) above the composer for the latest write, restores
    post a confirmation message, and drift refusals render as "this was
    edited again after the checkpoint" instead of a raw hash error. Strip's
    checkpoint lookup widened from newest-row-only to a 25-row window.
  Remaining Phase 2 note: deep-linking the translator's `actionTarget`
  (bridge/vault/approvals) to in-app surfaces beyond Marketplace is folded
  into Phase 4a (Office queue) where those surfaces get canonical homes.
- 2026-07-01 (later): **Phase 3 shipped**:
  - 3a — `src/components/ChatComputerFindingsCard.tsx` renders WI-4 findings
    inline as numbered options (title, price/rating/host, notes); tapping an
    option fires the same "Book option N" text the WI-5 seam already
    resolves. The card supersedes the bare "Book option N" quick-reply chips
    on findings messages.
  - 3b — `src/components/ChatMemoryAttributionRow.tsx` under bot replies:
    "🧠 Used memory: <titles>" (from `memoriesUsed`/`memoryRefs` metadata
    that was persisted but never rendered) opening the memory viewer, plus a
    one-tap "＋ Remember" that routes through the existing `/remember` path
    (shown on substantive replies ≥120 chars).
  - 3c — proof receipt loop, new owner `src/lib/chatProofReceipts.ts`
    (pure; smoke `npm run smoke:chat-proof-receipts`): chat-created missions
    (`/mission quickcreate` + default create) stamp their origin thread into
    a `manual` proof_of_work row (`detail.origin`, no schema change);
    `dispatchTaskToAgent` resolves that stamp regardless of which surface
    dispatches, stamps the completion proof with the same origin, and posts
    a compact receipt ("✅ Task completed: … — <agent> ran it … Proof of
    work is logged in the Feed.") back to the originating thread via
    `persistChatMessage`. Modal-created missions (Feed) carry no stamp —
    loop stays off for them by design.
- 2026-07-01 (later): **Phase 4a + 4b shipped**:
  - 4a — OfficeTab renders the same `ChatAttentionStrip` above
    `HitlApprovalBanner`: circle-wide "Needs you" summary (counts +
    soonest-expiry countdown) plus expired-approval rows the live banner
    cannot show. Pending approvals keep approve/reject in the banner;
    "Ask again" in Office explains re-asking happens from Chat.
  - 4b — `CircleChatThread` now surfaces `parent_thread_id` /
    `lineage_root_id` (DB had them since the lineage migration; the
    interface dropped them), and `ChatThreadHeader` shows a
    "↳ CONTINUES EARLIER THREAD · OPEN" chip that jumps to the parent via
    the new `onOpenThread` prop (wired to ChatTab's `handleSelectThread`).
  Remaining Phase 4: 4c room handoff, 4d grants hygiene list, 4e mid-run
  steering at the tool boundary.
- 2026-07-01 (later): **Phase 4 complete (4c/4d/4e shipped)**:
  - 4c — room handoff, new owner `src/lib/chatRoomHandoff.ts` (pure; smoke
    `npm run smoke:chat-room-handoff`). Conservative detector (≥3 distinct
    files in the trailing 20 messages + user build-intent language) drives a
    dismissible per-thread chip in ChatTab; accepting creates the room
    (`rooms/roomRepository.createRoom`), seeds it with a bounded context
    message (thread, current goal, files in play) via `sendAgentMessage`,
    and jumps there through `primeRoomWorkspaceLaunch` + the ROOMS tab
    switch. Never automatic.
  - 4d — `src/components/StandingGrantsPanel.tsx` in Office (under the
    approval banner): lists active sticky "always allow" scopes from
    `computerGrantGateStore` with categories, expiry countdown (reuses
    `formatChatAttentionDuration`), use count, one-tap revoke, and a prune
    nudge at ≥10 active grants. Floor reminder in the footer.
  - 4e — mid-run steering, new owner `src/lib/computerUseSteering.ts`
    (pure; smoke `npm run smoke:computer-use-steering`). Channel: steering
    notes ride `computer_use_confirmations` as pre-resolved rows
    (`question='__steering__'`, no schema change). Clients have no INSERT
    policy there, so `sendComputerUseSteeringNote`
    (`computerUseConfirmations.ts`) calls the edge function's new `steer`
    action, which verifies circle membership via the caller's own RLS read
    of the run, then inserts with the service role (409 when the run is not
    running). The edge loop drains unconsumed notes once per iteration and
    appends them AFTER tool_result blocks in the same user turn, framed as
    guidance-only ("NOT an approval … still goes through ask_user"), and
    emits `steering_applied`. Marker/bound/framing are duplicated in the
    edge file in lockstep with the client owner. UI:
    `ComputerTaskSteeringBar` renders while a task is running and not
    paused on a question — steer input + explicit STOP.
    **Deploy note:** the edge change requires
    `npx supabase functions deploy computer-use-agent`; until deployed,
    steering returns a visible error and the running loop simply finds no
    notes (fail-visible, never fail-silent).

### Phase 5 — Follow-ons (COMPLETE 2026-07-01)

The three follow-on ideas from the Phase 4 close-out, built after
`computer-use-agent` was deployed (steering is live end-to-end):

- **5a — steering visibility**: `computerUseAgent.ts` handles the
  `steering_applied` SSE event (`onSteeringApplied`); `useComputerUseTask`
  appends "🧭 Steering applied: <note>" to the reasoning stream the live
  card already renders, so users see exactly when their note landed.
- **5b — run-backed circle queue**: `chatAttentionQueue` gained a
  `blockedRuns` input + `run_blocked` kind (+ `open_run` action) — runs in
  `waiting_approval`/`paused` become items with how long they've been
  blocked ("Run waiting on a decision: … — blocked 45m"), counted in the
  status line ("N runs blocked"). OfficeTab polls `getActiveRuns` every 60s
  and feeds the strip; other statuses are ignored so callers can pass the
  loader output unfiltered.
- **5c — repeat-run diffing (monitoring-with-memory)**: new pure owner
  `src/lib/computerRunDiff.ts` (smoke `npm run smoke:computer-run-diff`).
  Task matching normalizes in lockstep with the edge replay matcher; find
  identity is URL-keyed (host+path, tracking params stripped) with title
  fallback; diff classifies added/removed/price-changed. On completion,
  ChatTab looks up the previous `done` run of the same normalized task and
  leads the completion message with the change-first block — "**Since the
  last run (2h ago): 2 new · 1 price change.**" or an explicit "**No
  changes since the last run.**" First runs are unaffected. NOTE: there is
  no in-app scheduler yet (automation-executor does not run computer
  tasks); when one lands, it reuses this module unchanged — that scheduler
  is the natural next initiative.
- **5d — inline step ledger**: verified already built —
  `RunExecutionCard` renders `executionStream`/tool events per message in
  ChatTab (and RoomsTab); no change needed.

### Phase 6 — Recurring watches + queue actions (COMPLETE 2026-07-01)

Built with six parallel subagents on disjoint files; orchestrator did the
shared-file integration (ChatTab/OfficeTab/package.json).

- **6a — recurring computer-task watches** ("watch this, tell me when it
  changes" — the scheduler `computerRunDiff` was built for):
  - `src/lib/computerTaskScheduleModel.ts` (pure: cadence math, due check,
    read-only validation, copy; smoke
    `npm run smoke:computer-task-schedule-model`).
  - `supabase/migrations/20260701_computer_use_schedules.sql` —
    `computer_use_schedules` + member RLS. **PENDING APPLICATION** (roadmap
    SQL checklist owns status); until applied, every layer fails soft and
    `/watch` surfaces the DB error visibly.
  - `src/lib/computerTaskSchedules.ts` — fail-soft CRUD (cap
    `MAX_ACTIVE_WATCHES=10`, re-activation re-seeds `next_run_at`).
  - `src/lib/watchChatCommands.ts` — `/watch [hourly|daily|weekly] <task>`
    (`--always` opts out of changes-only), `/watch list|stop|help`; watch
    tasks are floor-checked at create (pay/delete/login/grant rejected —
    watches are read-only monitoring). Smoke
    `npm run smoke:watch-chat-commands`.
  - `src/lib/computerTaskScheduleRunner.ts` — client-side due-runner hook
    mounted in ChatTab: while the app is open, at most one due watch runs
    headless (creds via `resolveComputerUseCreds`; no confirmation handler
    on purpose — `ask_user` times out server-side), diffs against
    `last_findings`, advances `next_run_at` even on failure (hot-loop
    guard), and posts to the originating thread ONLY on change/error (or
    always, per `notify_on`). Known limitation stated in the panel footer:
    watches run while the app is open — a server-side scheduler is the
    future upgrade and reuses the same model/CRUD.
  - `src/components/ComputerTaskSchedulesPanel.tsx` in Office: list,
    next-check countdown, last diff line, pause/resume/delete.
- **6b — open_run deep-link**: blocked-run attention items in Office now
  open `RunHistoryDrawer` (same inspector chat uses: steps, artifacts,
  inline approvals) instead of an alert.
- **6c — edit-and-resend approvals** (research pattern: accept/EDIT/deny):
  `HitlApprovalBanner` gained optional `onEditAndResend`; for approvals
  carrying `payload.plan.commandText` it REJECTS the stale proposal first
  (edited args must file a fresh approval — exact tool+args fingerprinting
  stays intact) and ChatTab prefills the composer with the command. The
  banner also migrated its direct `supabase.auth.getUser()` to
  `safeGetUserId` per the touch-the-file rule.

### Phase 7 — Server-side scheduler + OpenSwan steering (COMPLETE 2026-07-01)

Built with six subagents across two waves (2 discovery, 4 builders on
disjoint files); orchestrator integrated the shared files.

- **7a — server-side watch scheduler** (removes the app-open limitation):
  - `supabase/functions/watch-scheduler/index.ts` — cron-invoked
    (service-role Bearer only, via `isServiceRoleRequest`). Per tick:
    loads due watches across all circles (LIMIT 2, sequential), CAS-claims
    each (same conditional-UPDATE semantics as the client's
    `claimComputerTaskScheduleRun` — first claimant wins, so client runner
    and server scheduler can coexist), resolves Browserbase creds
    server-side (`circle_integrations` + `circle_integration_secrets`,
    base64 decode in lockstep with `circleIntegrations.ts`), invokes
    `computer-use-agent` and consumes its SSE to completion (6-min abort
    cap), diffs + re-stamps the schedule row, and posts the watch update to
    `messages` (with `thread_id`) under the same notify policy as the
    client runner. Diff/copy formatters duplicated with LOCKSTEP comments
    naming `computerRunDiff.ts` / `computerTaskScheduleModel.ts`.
  - `computer-use-agent` gained a scheduled path: service-role callers may
    pass `scheduledBy` (the schedule's `created_by`) instead of a user JWT;
    that user's Anthropic key is resolved via `resolveUserModelApiKey`.
    End users never hold the service key.
  - Client runner + CRUD gained the CAS claim (`claimComputerTaskScheduleRun`;
    runner sequences claim → run → mark, and a claim loss skips silently).
  - `supabase/migrations/20260702_watch_scheduler_cron.sql` — pg_cron tick
    every 15 min via `net.http_post` + vault secret
    `watch_scheduler_service_key` (mirrors `20260414_scheduled_actions_cron.sql`).
- **7b — OpenSwan typed-loop mid-run steering**:
  - `src/lib/openswanSteering.ts` — in-memory, thread-scoped steering bus
    (register/push/drain/unregister, queue cap 5); reuses
    `computerUseSteering`'s normalize + guidance-only framing so wording
    can't drift. Smoke `npm run smoke:openswan-steering-bus`.
  - `agentExecutionCore` gained `steering?: { drain }` + a
    `steering_applied` event: notes inject as user messages at the
    iteration boundary (after `iteration_complete`, before
    `onRoundComplete` — the proven `appendUserNote` shape). Approval gates
    untouched. Smoke `npm run smoke:agent-core-steering` (+ existing
    `smoke:agent-core` still green).
  - `openswanSessionRuntime` registers the thread scope around the typed
    loop and passes the bus drain; ChatTab renders the same steering bar
    for OpenSwan turns (`botTyping && runStatus==='running'` + active
    scope; hidden while a computer task owns the bar; no Stop — turns have
    no cancel handle surfaced yet, noted as future work).

### Phase 13 — Review + create anything + human-parity map (2026-07-02)

- **`/review`** (`src/lib/reviewChatCommand.ts`; smoke 16 blocks): reviews a
  PR from a URL / `#123` / `latest` (+ optional focus) — or just PASTE a
  bare PR link. Composes what already existed but was never seamed:
  `github.ts` diff/files fetchers (token resolution reused verbatim from
  githubChatCommands), the code-reviewer soul's pass order
  (correctness→security→design→style) + 🔴/🟡/💭 severity contract, the
  critique_pr playbook anti-patterns, diff clamped at 45k and wrapped in
  the untrusted-content fence. Read-only by design (no GitHub writes → no
  approval gate); `--comment` posting is a future opt-in behind approval.
- **`/create` (alias `/make`)** (`src/lib/createChatCommand.ts`; smoke 160
  cases): one novice entry that classifies the brief (11 intent classes,
  precedence-ordered) and RE-DISPATCHES through the existing pipelines —
  `/build-page`, `/imagine`, `/task new`, `/watch`, WordPress intent,
  coding lane, design pipeline, automation wizard — so every approval gate
  applies unchanged. Spreadsheets ship pragmatically (CSV code-artifact →
  downloadable file); presentations answer HONESTLY with alternatives
  instead of pretending. Bare `/create` shows the menu; every hop posts a
  one-line routing note.
- **`docs/HUMAN_PARITY_CAPABILITY_MAP.md`** — the "can chat do anything a
  person can on a computer?" matrix: 11 creation lanes working, 3 real
  gaps with build order (table artifact kind, Google Docs tools,
  HTML-deck presentations), review/analysis matrix, and the
  non-negotiables every lane carries.
- Registry + palette entries for both; persona batteries 8–9 added;
  `smoke:all` green end-to-end with both suites registered.

## Initiative status

All fourteen phases are implemented as of 2026-07-06.

**Outstanding operational steps (in order):**
1. Apply `supabase/migrations/20260701_computer_use_schedules.sql`
   (activates watches end-to-end).
2. Redeploy the agent function (it changed again for the scheduled path):
   `npx supabase functions deploy computer-use-agent`.
3. Deploy the scheduler: `npx supabase functions deploy watch-scheduler`.
4. Create the vault secret (service-role key) named
   `watch_scheduler_service_key` (exact `vault.create_secret` line is
   commented in the cron migration), then apply
   `supabase/migrations/20260702_watch_scheduler_cron.sql`.
Until steps 3–4 land, watches still run client-side while the app is open
(claim semantics make the eventual coexistence safe).

Future work noted, not started: surfacing a cancel handle for OpenSwan
turns (Stop button on the steering bar), and rendering `steering_applied`
events from persisted run event streams in the run inspector.

### Phase 8 — BlackSwan-aware Auto routing (COMPLETE 2026-07-02)

Review finding: three documented BlackSwan collaboration pieces were
**unwired dead code** — `buildBlackSwanGroundingBlock` (never called),
`resolveOpenSwanToolLoopModel` (never called), and BlackSwan absent from
`modelCapabilities` (it worked only via the accidental unknown-default).
Auto also excluded BlackSwan entirely. Shipped:

- **Auto lane** (`resolveModelForSoul` — the single resolution authority
  all paths share): when the `blackswan` marketplace integration is
  connected, Auto routes `status` / `memory` / `casual` / `social` intents
  to `huggingface_endpoint/cswan801/BlackSwan-v5` — exactly the lanes its
  training data covers (app conversations, missions, check-ins, streaks,
  XP, proof-of-work, social voice). Light `question` turns route there too
  when the caller flags app-domain text via the new high-precision
  `looksLikeAppGroundedMessage` detector (blackswanRouting owner; ChatTab
  passes the hint from the draft). Heavy questions, coding, research,
  architect, browser, and design lanes never see BlackSwan. **Opus stays
  explicit-pick only** (standing no-surprise-spend decision). ChatTab's
  existing action-request guard (strips 'blackswan' from the provider set)
  remains the first defense.
- **Collaboration contract wired** (was documented, never live):
  - OpenSwan typed loop: `resolveOpenSwanToolLoopModel` now swaps a
    BlackSwan pick for the tool executor (`claude-haiku-4-5`) on tool
    turns, and `buildBlackSwanGroundingBlock` rides the volatile context
    message (same slot as the circle snapshot — R15/O7 cache discipline
    keeps the frozen system prompt untouched).
  - swanbot main-chat seam (flag-ON collaboration block): the grounding
    contract now pushes into prompt extras whenever the plan's grounding/
    primary model is a BlackSwan id.
- **Deliberate capability registration**: `cswan801/blackswan-v5` (one
  normalized key covers all three id forms) — tools/vision/computer-use
  false, `streaming: false` (llm-proxy buffers HF). The capabilities smoke
  updated from "unknown stays fail-closed" to "registered deliberately".
- **Failover chains** declared for BOTH hosted ids (endpoint + public) →
  Haiku → Sonnet. Honest note: `getModelFailoverChain` has no runtime
  consumer — and wiring silent failover would contradict the standing
  "fail-closed marketplace errors, never silent Anthropic fallback"
  invariant. A hosted-BlackSwan outage therefore fails VISIBLY, and the
  Phase-2 translator already renders it as "provider failed — switch
  model in the picker". Revisit only if the endpoint proves flaky.
- Smoke: `npm run smoke:blackswan-auto-routing` (lanes, guards, explicit
  picks, detector precision, executor swap, grounding emission,
  capability row); `model-capabilities` smoke updated deliberately.

**P8 addendum (2026-07-02) — one BlackSwan only.** Per user directive, the
ONLY BlackSwan anywhere is `cswan801/BlackSwan-v5` served from the
circle's dedicated HF Inference Endpoint (the `blackswan` integration —
its `model_id` metadata defaults to exactly that repo, so the Auto lane's
`huggingface_endpoint/cswan801/BlackSwan-v5` IS the linked model):
- The legacy **local Ollama `blackswan` weight is retired from the model
  catalog** (`llmProviders.ts` ollama list) — no longer selectable.
- **Stale persisted local picks normalize to the v5 endpoint id** at both
  resolution authorities (`resolveModelForSoul` and ChatTab's
  `resolveSendModel`) — the one sanctioned exception to
  explicit-picks-pass-verbatim, strictly same-family (local BlackSwan →
  hosted BlackSwan-v5), never cross-vendor.
- Lower layers (hostedBlackSwanInvocation channel classifier,
  isLocalOllamaBlackSwan guards) still RECOGNIZE legacy ids defensively —
  they route them away; they just can't be chosen or resolved to anymore.
- Smoke pins all of it: catalog removal implicitly (model-catalog),
  normalization + the endpoint id string explicitly
  (blackswan-auto-routing "only cswan801/BlackSwan-v5 is ever used").

### Phase 9 — Composer pattern for BlackSwan (2026-07-02)

Deep research (102-agent adversarially-verified run over cursor.com
primary sources + the Composer 2 technical report) mapped Cursor's
Composer deployment onto BlackSwan/SwanBot/OpenSwan. Canonical doc:
**`docs/BLACKSWAN_COMPOSER_PATTERN.md`** (verified findings, the mapping
table, and the v6/v7 training roadmap). Shipped this pass:
- **Planner split for automation** (Cursor Plan-Mode analog, inverted for
  our domain): on Auto with the BlackSwan integration connected, browser/
  app-task planning (`describeComputerUsePlan`) runs on the app-trained
  BlackSwan via `resolveComputerTaskPlannerModel` (blackswanRouting owner);
  runtime + the Sonnet-pinned screen loop unchanged; explicit picks plan
  with the pick. Smoke cases in `smoke:blackswan-auto-routing`.
- **Training flywheel pipe** (Cursor's train-in-the-production-harness
  move, phase 1): `scripts/blackswan-llm/export_tool_traces.py` exports
  `agent_runs`/`agent_run_events` tool trajectories (tool, input, ok,
  duration, error, final; failed runs kept as negatives; PII-scrubbed,
  bounded) → SFT data so BlackSwan v6 can learn the OpenSwan tool
  vocabulary — the precondition for ever relaxing the executor swap.
- Roadmap deliberately deferred: `/best-of-n` race-and-judge over
  worktrees, trace-trained memory embeddings, and the v6 SFT / v7
  shadow-harness RL runs themselves (documented with reward-design cues
  in the pattern doc).

### Phase 10 — Composer roadmap completed (2026-07-02)

Four parallel builders finished everything Phase 9 deferred (details in
docs/BLACKSWAN_COMPOSER_PATTERN.md "Roadmap completion"): v6 SFT pipeline
wired end-to-end (export → score with Cursor's concave length penalty →
ShareGPT convert with parallel-call turns → registered at 2x in
prepare_dataset_v4), `/bestof` race-and-judge live in chat
(src/lib/bestOfNRace.ts; smoke:best-of-n-race), embedding-pairs exporter
(4 sources; documents the retrieveForTurn runId gap), and
docs/BLACKSWAN_V7_RL_PLAN.md (shadow harness on the REAL tool dispatcher,
floor mocked; RFT-first ladder; per-family executor-swap gates; 8192-pin
training constraint).

### Phase 11 — Beyond Cursor on user-friendliness (2026-07-02)

Three gaps where Cursor/Composer 2.5 is weaker, closed:
- **Discoverability**: `/watch` and `/bestof` registered in the single
  command registry (chatCommandRegistry.ts) that feeds the slash palette,
  the /help card, and the legacy help text — with hijack-safe routeIds
  (traced through the dispatcher blocks so the registry entries can't get
  consumed before the ChatTab intercepts).
- **Auto-model transparency** (Cursor shows the id; we show WHY):
  `explainAutoModelChoice` in serviceProfileSouls mirrors the Auto ladder
  branch-for-branch with ≤60-char human reasons ("app question →
  app-trained BlackSwan", "complex build → strongest coder"); a 20-combo
  anti-drift matrix in smoke:blackswan-auto-routing fails if the explainer
  ever disagrees with the real router. ChatThreadHeader renders
  `Auto → <model> · <reason>` live as the user types.
### Phase 12 — Full verification pass (2026-07-02)

Reviewed + tested the whole chat system; fixed everything found. Highlights:
- **Seam review (6 confirmed bugs fixed)**: bestOfN metadata now actually
  persists (chatAgentService param was missing — the hydration path was
  dead); `/bestof` token-boundary guard (typos no longer swallowed);
  clarification dismissal no longer blinds future clarifications (ids
  keyed by askedAt) and dismissals filter INSIDE the attention builder so
  the status line never counts invisible rows; the model-picker preview
  passes the same `appGroundedHint` as send (picker/send drift closed);
  expired-but-unswept approvals no longer show live APPROVE in the banner
  (both tabs filter by `resolveApprovalExpiresAt`); `/bestof` parse
  returns RAW tokens so `auto` gets real BYOK bias at race time. Nits:
  `/memory-bank` case-insensitive; Restore strip clears on thread switch.
- **Three pre-existing reds fixed at ROOT** (verified at HEAD first):
  (1) failure-recovery misclassification — guardrail wording ("human
  verification … requires user action") inside the recovery advisory text
  SELF-TRIGGERED the taxonomy, turning a 429 into
  human_verification_required; advisory text is now sentinel-wrapped
  (`RECOVERY_ADVISORY_BEGIN/END`) and stripped before classification while
  staying in the recovery prompt. (2) a11y fence smoke greped stale source
  bytes after the runtime hardened its regex — now convention-based.
  (3) design-task-card smoke asserted pre-`save`-floor policy — updated to
  assert the card SHOWS for approval-gated saves, with quiet suppression
  covered synthetically.
- **Privacy policy aligned**: the dispatcher's thrown-transport message now
  matches the desktop-runtime-wiring E-gate (visible generic line;
  diagnostics in warnings + data.rawError); the agent-runtime smoke's
  opposite expectation updated to the policy.
- **`smoke:all` runs the WHOLE suite green for the first time** — it
  previously died at script 7 of ~150; 13 new suites registered into it.
- **Novice persona testing** (`smoke:novice-persona`, permanent): drives
  planner/routing/registry/watch/bestof/attention/errors/handoff with
  realistic newcomer messages. Found + fixed a real bug: *"Is it safe to
  let an AI use my browser?"* was planned as browser automation by THREE
  different heuristic lanes — now a single top-of-planner
  `isAutomationMetaQuestion` guard (high-precision interrogatives; "can
  you open amazon…" untouched) answers capability/safety questions as
  plain conversation.

- **Interactive best-of-N** (Cursor makes you read diffs to adopt):
  `summarizeBestOfNRace` → bounded `bestOfN` metadata field
  (persistedChatMetadata, threaded through every byte-cap tier like
  computerFindings) → `BestOfNResultCard` with per-candidate score/note/
  expandable text, one-tap ADOPT (posts that answer), and RACE AGAIN
  (pre-fills the same command). Wired into the /bestof handler + message
  render + hydration reader.

### Phase 14 — Human-parity capability build-out (COMPLETE 2026-07-06)

Closed all six build-order gaps in `docs/HUMAN_PARITY_CAPABILITY_MAP.md`
(see that doc for the updated matrices; it is the canonical record):

- **Table artifact kind** (`src/lib/tableArtifact.ts`, smoke
  `smoke:table-artifact`): RFC-4180-ish `parseCsvText` (render clamp
  200×30 with true `sourceRowCount/ColCount`), round-trip-safe
  `tableToCsv`, `looksLikeCsvArtifact`. `swanbot.ts` artifact union gained
  `'table'`; BOTH parse gates auto-upgrade csv code artifacts;
  `ChatArtifacts.tsx` renders the grid + Download CSV; the
  swanbot-v2-workspace mirror allowlist is in lockstep.
- **Google Docs creation** (`src/lib/googleDocsCreate.ts`, smoke
  `smoke:google-docs-create`; tool `docs.create_document` in
  openswanToolRuntime, publish-approval-gated): Drive v3 multipart
  HTML→Doc with a pure markdown→HTML converter, 60k bound, typed
  not_connected/missing_scope/api_error errors, token never in error
  strings. **Durability**: `google-oauth` edge fn gained `?action=token`
  (refresh-and-return via stored refresh_token, which never reaches the
  client; invalid_grant → reconnect_required) and
  `googleCreds.fetchGoogleWorkspaceAccessToken()` +
  googleDocsCreate's default resolver fall back to it on expiry.
  *Ops: `npx supabase functions deploy google-oauth`.*
- **Presentations**: `/create` presentation lane now re-dispatches to
  `/build-page` with a deck-template brief (one full-viewport
  `<section class="slide">` per slide, arrow-key + click nav, slide
  counter, print-one-slide-per-page stylesheet → Print = PDF export).
  Note stays honest: `.pptx` not supported.
- **Image-failure visibility**: `routeByCapability` returns
  `fallbackNotice` naming the attempted backends (or "no backend
  configured" → Marketplace pointer) when ALL image backends fail; ChatTab
  shows it before the normal text fallback. Still `handled:false` — the
  tiered path recovers; no key material ever included (smoke-asserted).
- **`/review --comment`** (opt-in write): files a `chat.review_comment`
  approval (owner/repo/number/body ≤8k + attribution footer, 1h expiry);
  `agentApprovalsWorker.applyApprovedReviewCommentAction` posts via
  `createPullRequestComment` only after human approval. Review smoke now
  23 blocks.
- **PR-link chip**: a GitHub PR URL mid-sentence gets a localOnly notice
  with a one-tap `/review <canonical-url>` quickReply chip; the message
  itself still flows through the normal lanes (solo links auto-review as
  before).

Validation: typecheck clean; `smoke:table-artifact` +
`smoke:google-docs-create` registered in package.json and appended to
`smoke:all`; create-command smoke now 162 cases; persona battery 8 updated
to the deck-builder expectation.
