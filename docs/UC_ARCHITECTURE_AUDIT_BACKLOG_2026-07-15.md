# UC Architecture + Accountability-Loop Audit — Verified Backlog (2026-07-15)

9-subsystem audit (27 agents), 14 confirmed. Aligned with CLAUDE.md priorities (#1 GitHub/team accountability, #2 OpenSwan shared agent layer, #3 routing/memory/approvals/observability). 10 cores BUILT (2,387 assertions). WIRED so far: provider-backoff, continuation-budget (client+edge), event-bound. READY: skill-induction, task-pr-linkage, run-cost-rollup, command-frecency, circle-memory-digest, approval-audit, lane-telemetry.

## [0] skills-library · expansion · v8 · medium · safe **[BUILDING]**
**Skill induction — auto-suggest a new SKILL.md from repeated SUCCESSFUL agent runs (skillInductionCore), filed through the existing HITL create path**
- Impact: The shared capability layer (product priority #2) grows itself from what the team actually does well: when a successful multi-tool procedure recurs, a review chip proposes capturing it as a SKILL.md (When-to-use / Procedure / Pitfalls / Verification) — a human approves before any
- Evidence: The library grows only manually today: the agent explicitly calls skills.manage create (src/lib/openswanToolRuntime.ts:7229) or a user clicks 'save as recipe' in the computer-use console (src/components/computer-use/ComputerUseConsole.tsx:5
- Wire: Run the core over recent runs (Office/console surface or a light periodic check) and on a strong candidate file a pending skill.create proposal through the EXISTING src/lib/skillLi

## [1] feed-task-execution · expansion · v7 · medium · hot-file-small **[BUILDING]**
**Task→PR/commit linkage: capture real GitHub proof-of-work on the task run**
- Impact: A completed feed task shows its actual GitHub proof — 'Linked PR #123 (owner/repo)' — instead of just prose, directly serving priority #1 (GitHub/team accountability). It closes the loop end-to-end: agent works → PR opened → the existing proofOfWork webhook path can correlate the
- Evidence: grep for any task↔PR link (pr_number/pull_request/linkedPr across useKanbanData.ts + missions.ts) is empty — no connection exists. proofOfWork.ts:49 (githubPRToProof) already converts webhook PRs into proof_of_work rows, but nothing ties a 
- Wire: In the completion block of useKanbanData.runAgentOnTask (right after the attachment→artifact loop, useKanbanData.ts:1768-1772), call the core on {deliverable, openSwanPayload.toolE

## [2] run-observability · expansion · v7 · medium · hot-file-small **[BUILDING]**
**Per-circle run-cost attribution: light up the dead estimated_cost column + run-axis rollup core**
- Impact: Cost dashboards per circle stop reading $0. Adds a failed-run wasted-spend metric — dollars burned on runs that produced nothing (status failed / hit max iterations) — a direct team-accountability signal (priority #1). Enables cost by surface (chat vs room vs feed vs office_termi
- Evidence: agent_runs.estimated_cost (migration 20260408_unified_agent_runs.sql:40, DEFAULT 0) is read by the ops board in three LIVE surfaces — per-run costUsd (officeOpsBoard.ts:354,384), liveBurn.costInFlightUsd (:503), and per-agent costUsd24h in 
- Wire: Add `estimated_cost: estimateCostWithCache(opts.model, tokenTotals.cached, tokenTotals.input, tokenTotals.output)` to the finalize update (agentRunPersistence.ts:247) and mirror in

## [3] chat-commands · expansion · v7 · medium · hot-file-small **[BUILDING]**
**Per-user frecency: surface each user's frequent + recent commands in the palette**
- Impact: The 103-command wall collapses to YOUR ~6 most-used on bare `/`: a returning user reaches the daily accountability commands (/gh status, /mission status, /vault list, /summary) in one keystroke. Directly strengthens the accountability loop, since the repeat-use commands are exact
- Evidence: On a bare `/`, getMatchingChatCommands returns all 103 commands sorted only by `a.command.localeCompare(b.command)` (chatCommandRegistry.ts:292), and the palette header shows the raw count '{commands.length} total' (ChatSlashCommandPalette.
- Wire: Two small points: (1) record once at the single send chokepoint ChatTab.tsx:6784 (right after `if (!content) return;`) — when content.startsWith('/'), resolve the leading 1-2 token

## [4] v1-v2-consolidation · optimization · v7 · medium · hot-file-small **[BUILDING]**
**Unify the v2 continuation budget into one pure core — fix the raw-error leak + 6-vs-5 off-by-one, and safely deepen the ceiling for coding tasks**
- Impact: Claude-Code-class coding/desktop tasks (the #1 coding-agent initiative) hit the cap fast — read→edit→test→fix→re-test is already 5 client round-trips — and are cut off showing a raw internal string with NO Continue button instead of the resumable stop. Unifying the cap and gating
- Evidence: Client `MAX_CONTINUATIONS = 6` (swanbot.ts:1031) vs server `continuationCount > MAX_ITERATIONS` where MAX_ITERATIONS=5 (swanbot-v2-ai:2677, also dual-used as the per-invoke turn bound at 2626). Over-cap returns a raw prose terminal `"Too ma
- Wire: Edge swanbot-v2-ai/index.ts:2676-2684: replace the `continuationCount > MAX_ITERATIONS` check with `nextContinuationDecision(...)`, and on stop return a STRUCTURED terminal (e.g. `

## [5] memory-bank · optimization · v7 · small · hot-file-small **[BUILDING]**
**Fix multi-doc shared-memory retrieval: pure circleMemoryDigestCore + rewire the 3 (+1) single-row readers**
- Impact: Restores team-curated shared memory to every agent turn for any circle using more than one memory-bank doc — today those teams get ZERO of their brief/active_context/progress into the prompt (silent data loss on priority-#1 team accountability), and single-doc teams get an arbitr
- Evidence: Migration 20260506_circle_memory_bank.sql:18,26,46-47 dropped the per-circle UNIQUE and made circle_memory hold up to 3 rows (circle_id, doc_kind: brief/active_context/progress). Yet openswanMemoryStores.ts:99-103, agentRunSystem.ts:1059-10
- Wire: Replace the three `.single()` blocks with `getAllMemoryDocs(circleId)` (sharedMemory.ts:64, already exported) → `formatCircleMemoryDigest(docs, budget)`: openswanMemoryStores.ts:98

## [6] approvals-hitl · optimization · v6 · medium · hot-file-small
**Honor the shared per-category auto-approve policy on the run/tool-loop path (consolidate the two systems' policy layer)**
- Impact: Users who explicitly opted a category into auto-approve stop getting re-asked by the tool loop; the chat surface and the run surface finally agree on one policy, killing a confusing 'I already allowed this' round-trip. Every silent auto-run also leaves an `auto_approved` audit ro
- Evidence: `createHitlApprovalGate` consults `resolveAutoApproveDecision` and passes/blocks a plan on category `auto`/`never` (src/lib/chatApprovalGate.ts:108-133). But `maybeRequestToolApproval` (src/lib/openswanToolRuntime.ts:5580-5703) files an `ag
- Wire: In `maybeRequestToolApproval` (src/lib/openswanToolRuntime.ts) after the reuse `decision.kind==='pass'` check (line 5643) and before `requestRunApproval` (line 5668): compute categ

## [7] approvals-hitl · expansion · v6 · medium · hot-file-small **[BUILDING]**
**Unified approval audit trail — one secret-safe ledger of every approval decision across both tables**
- Impact: Teams get a scannable 'Approvals ledger' — manual approve/reject with approver + latency, policy-blocked (`never`) attempts, expired/stale cards, and silent `auto_approved` runs — so accountability for privileged/external actions is visible instead of scattered across two banners
- Evidence: Approvals persist in two tables — `agent_run_approvals` (src/lib/agentRunSystem.ts:443; src/services/runApprovalsService.ts) and `agent_approvals` (src/services/hitlService.ts:28-52) — but no consolidated reader answers 'who approved/reject
- Wire: Thin `getApprovalAuditTrail(circleId,{limit})` reader in src/services/runApprovalsService.ts that pulls resolved+pending rows from BOTH tables and runs the pure core. Render a comp

## [8] v1-v2-consolidation · expansion · v6 · small · hot-file-small **[BUILDING]**
**Unified SwanBot lane telemetry — make the silent v2→v1 fallback visible and give ops the data to retire v1 (M5)**
- Impact: Accountability/observability (priorities #1 & #3): today v2 can degrade and fall back to v1 on every turn with nobody seeing it, and the decision to delete v1 (migration phase M5) is blind. This lights up the EXISTING `/lanes` report and Office lane-health strip with real v2 heal
- Evidence: `callSwanBotAI` returns `SwanBotEdgeCallResult = { response, error? }` (swanbot.ts:2255) — no served-lane field — so the v1/v2 choice made at swanbot.ts:2317-2356 (incl. the silent `"v2 returned null (transport) — falling back to v1"` at 23
- Wire: One `recordChatLaneTerminalNow(...)` (fed by the classifier) at each callSwanBotAI return point: v2 success (swanbot.ts:2350), v2 body_error (2353), v1 served after fallthrough (24

## [9] computer-use-deep · optimization · v6 · small · hot-file-small
**Wire the route's durable-artifact proof requirements into the loop proof-coverage gate (light up a fully-built, currently-dark tier)**
- Impact: On any task that promised a saved/exported file ('open Photoshop and export this as a PNG to my Desktop', 'convert logo.psd to jpg'), the model can perform the mutating action, take one desktop.screenshot, and declare 'Done — exported to your Desktop' without ever confirming the 
- Evidence: proofCoverage.ts already implements the whole durable tier — targetsDurableArtifact (L69-78), the needsDurableProof field (L96, L133-149) and the durable branch of proofCoverageNudge (L169-177) — all gated on opts.proofRequirements. But bot
- Wire: swanbot.ts:4366 — compute proofRequirements once per turn (lazily, inside the existing !proofNudged done-branch so it costs one route build per turn at most) and pass assessProofCo

## [10] feed-task-execution · optimization · v5 · small · hot-file-small
**Auto-resolve execution acceptance-checks from run evidence (unblock the always-stuck completion gate)**
- Impact: Feed tasks that genuinely finished (tests green, screenshot captured) stop getting silently kicked back to in_progress; browser_qa/QA tasks can auto-complete, XP and the success-pattern memory that feeds future runs actually fire, and a real test/verification FAILURE now shows as
- Evidence: taskExecutionRuntime.ts:952 handles ONLY check_kind==='artifact_present'; the :962 comment states 'human_review and other kinds stay pending — require manual resolution', yet the only other writer of task_run_check_results is the read-only 
- Wire: Rewrite evaluateTaskRunChecks (taskExecutionRuntime.ts:917) to call the core: keep the existing checks+artifact-kind loads, add the run's verifications, and — to avoid the fire-and

## [11] run-observability · optimization · v5 · small · hot-file-small **[BUILDING]**
**Bound agent_run_events payloads + the tool_calls aggregate (pure event-bound core)**
- Impact: Lower telemetry write + storage cost and bounded row growth on the busiest observability table; eliminates an oversized-row INSERT-failure mode that today silently drops run events (making replay/introspection incomplete); caps run-row size on 100-tool runs. Improves the reliabil
- Evidence: writeEvent() fires one un-awaited INSERT per event into agent_run_events, the highest-frequency telemetry table (agentRunPersistence.ts:119-131). tool_call_start persists `input: event.input` raw and unbounded (:181-188) — inputs for local.
- Wire: One call to boundEventPayload(kind, payload) inside writeEvent() before the insert (agentRunPersistence.ts:~122) and boundToolCallsAggregate(toolCalls, 40) in finalize() before the

## [12] provider-marketplace · optimization · v5 · small · safe **[BUILDING]**
**Consecutive-failure backoff for the provider cooldown window (stop retrying durably-dead providers head-of-line every turn)**
- Impact: Every affected turn currently eats one (or more) failing head-of-line round-trips (latency + a surfaced-then-recovered error) against a provider that has been dead for minutes. Backoff parks a provider with N consecutive health-failures at the back for 30s·2^(N-1) (capped ~8–10 m
- Evidence: isProviderCoolingDown uses a flat window: `const windowMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS` (providerHealthRegistry.ts:195, DEFAULT_COOLDOWN_MS=30_000 at :82). One transient blip and ten straight rate_limit/overload failures are tr
- Wire: Entirely internal to src/lib/providerHealthRegistry.ts (isProviderCoolingDown at :185 + new MAX_BACKOFF_MULTIPLIER near :82) — zero call-site changes: excludeCoolingProviders → res

## [13] memory-bank · expansion · v5 · medium · safe
**Cross-member memory provenance/attribution UX — pure memoryProvenanceCore + thin member-name lookup**
- Impact: For a team-accountability workspace this closes the 'who told the agent this, and when' gap: members see who last edited each shared doc ('— last edited by Alex · v4 · 2d ago') in /memory-bank views, and the agent receives a secret-safe attribution line so it can weigh and cite t
- Evidence: circle_memory already carries last_edited_by / last_edited_at / version (sharedMemory.ts:31-39) and circle_memory_history the full edited_by/edited_at/version/doc_kind chain (sharedMemory.ts:41-49, written on every update at sharedMemory.ts
- Wire: Resolve last_edited_by → display_name via the proven profiles-map pattern (circleChatThreads.ts:104-109) in sharedMemory.ts (or a thin runtime beside getAllMemoryDocs); append the 
