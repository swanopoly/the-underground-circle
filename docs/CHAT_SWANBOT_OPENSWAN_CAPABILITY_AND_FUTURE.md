# Chat / SwanBot / OpenSwan — Capability State & Future

> A grounded "state of the build + where it's headed" for the three agent
> surfaces (Chat, SwanBot, OpenSwan) and the shared substrate underneath them.
> Synthesized 2026-07-13 from a read-only sweep of the codebase (571 `src/lib`
> modules, 47 edge functions, ~30 planning docs) plus a frontier scan of the
> mid-2026 agent field.
>
> **Reading rules.** Every capability is tagged **SHIPPED** (live in code, cite
> file/commit), **IN-FLIGHT** (built + smoke-tested but flag-gated / awaiting a
> live signal), or **PLANNED** (designed in a doc, not yet built). Frontier
> claims after the Jan-2026 knowledge cutoff are marked **[UNVERIFIED]**.
> Canonical ownership still lives in `docs/AGENTS_ROADMAP.md`; this file is the
> capability map, not the ownership registry.

---

## 0. The through-line

The product is a **team AI-agent accountability workspace that also drives your
apps and writes your code**. Three surfaces, one substrate:

- **Chat** — the human-facing surface: plan, converse, approve, watch proof.
- **SwanBot** — the response brand: turns a message into a typed tool loop.
- **OpenSwan** — the runtime: the 180+-tool typed agent loop + reliability layers
  + delegation that actually does the work.

Under all three sits a shared substrate — **memory, skills, approvals/HITL, run
persistence, model routing, cross-dashboard resource discovery, and multi-agent
file coordination**. The strategic bet (validated by the frontier scan in §8) is
that the durable moats are **coordination, governance, verified-loop
reliability, and the write/spend approval boundary** — *not* raw model IQ, which
is commoditizing. We build the harness; we let the model vendors race on IQ.

---

## 1. Architecture at a glance

```
          ┌─────────────────────────── CHAT (ChatTab.tsx) ───────────────────────────┐
          │  model picker · streaming · artifacts · threads · checkpoints · commands  │
          │  planner (3 tiers: plain_model / escalate_tools / spawn_agents)           │
          └───────────────┬───────────────────────────────────────────┬──────────────┘
                          │                                           │
              chatAutomationPlanner                        chatComputerRequestRouter
              runChatAutomationPlan                        (route→contract→loop→verify)
                          │                                           │
          ┌───────────────▼───────────── SWANBOT (swanbot.ts) ───────▼──────────────┐
          │  v1 (swanbot-ai, legacy relay+loop, fallback)                            │
          │  v2 (swanbot-v2-ai, TYPED loop, DEFAULT-ON, client-delegated protocol)   │
          └───────────────────────────────┬──────────────────────────────────────────┘
                                          │
          ┌───────────────── OPENSWAN RUNTIME (agentExecutionCore) ──────────────────┐
          │  typed tool loop · 9 reliability layers · 180+ tool catalog              │
          │  delegation gate (depth/concurrency/spend) · mass agent deploy           │
          └───────────────────────────────┬──────────────────────────────────────────┘
                                          │
          ┌──────────────────────────── SUBSTRATE ───────────────────────────────────┐
          │ memory · skills · approvals/HITL · run persistence · model routing        │
          │ BlackSwan flywheel · connected-resource discovery · file coordination     │
          │ Office observability                                                      │
          └───────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chat surface

**SHIPPED**

- **3-tier orchestration** — `aiFirstChatPolicy.ts` routes each turn to
  `plain_model` / `escalate_tools` / `spawn_agents`. Default-ON.
- **Planner + intent routing** — `chatAutomationPlanner.ts` (9 intent classes),
  `runChatAutomationPlan.ts`, `conversationalRouter.ts`; classify-once per turn.
- **Unified prompt assembly** — `chatPromptAssembly.ts`: a 31-key canonical
  section registry with complexity-tier adaptive loading and a cache-safe
  volatile-content boundary; all lanes (stream/batch/v2) are config over one seam.
- **Computer/app request routing** — `chatComputerRequestRouter.ts` +
  `chatComputerRequestUx.ts`: the hidden best-path (preview, pipeline, approvals,
  fallbacks, proof) stays quiet; user sees only approval/proof/blockers.
- **UX** — streaming bubbles, model picker (Auto tier), 8 artifact kinds
  (text/link/file/diff/image/code/webpage/table), thread lineage
  (`↳ CONTINUES`), checkpoints + restore (`chatCheckpoints.ts`), attention queue
  (Needs-You strip), memory attribution row, inline findings card (option-N
  follow-ups), proof receipts.
- **Commands** — `/plan`, `/review` (PR review w/ severity), `/create`,
  `/watch` (recurring), `/best-of-n` (race + judge), `/integrations`,
  `/build-page`, `/imagine`, `/apps`, `/screen`, `/lanes` (per-lane health),
  `/gh`, `/task`, `/mission`, `/v2`.
- **Integrations** — AI-composed API calls (`integrationActionComposer.ts`),
  preset catalog (GitHub/Linear/Jira/…), health registry, action receipts,
  approval idempotency, messaging.notify.
- **Reliability** — lane terminal telemetry (`/lanes`), unified lane error
  boundary, SSE mid-stream recovery, 50-prompt route golden canaries, provider
  health pre-selection, session-state persistence.

**IN-FLIGHT** (built, flag-dark, awaiting a live signal)

- **Deferred tool loading** (`anthropicNativeToolSearch.ts`) — native
  `tool_search` + `defer_loading`; payload verified, awaiting a live cache-ratio
  run (est. −85% tokens/100-turn).
- **Context-management passthrough** (`anthropicContextManagement.ts`) —
  `clear_tool_uses` beta; −84% tokens measured, awaiting cost/behavior decision.
- **Execute→verify** (`outcomeVerifier.ts`) — fresh-context grading of a mutation
  against the evidence contract; awaiting accuracy measurement.
- **Terminal-chat cutover** — route the terminal send path through the planner
  (needs a `ChatTab` structural refactor).

**Highest-leverage chat futures:** workspace indexing + `@file` precise context;
Plan Mode as a first-class editable object ("Build from Plan"); per-tool approval
governance (scope × rate × require-review).

---

## 3. SwanBot (v1 → v2 typed loop)

**SHIPPED**

- **v2 is DEFAULT-ON** (since 2026-07-07) — `swanbot-v2-ai/index.ts`: a typed
  `runLoop()` over `ToolDef[]`, prompt caching, `agent_runs`/`agent_run_events`
  telemetry, normalized `final_stop_reason` vocabulary.
- **Client-delegated tool protocol** (M2) — edge emits
  `{ pending, clientToolCalls, continuationRunId }`; client executes against the
  bridge; POSTs results; edge resumes from persisted continuation state (stale
  after 10 min, ≤6 rounds/turn, validated for missing/dup/oversized results).
  Mixed batches run server tools first, merge client results in tool-use order.
- **73-tool executable subset** — 25 server-side (memory/tasks/missions/rooms/
  messages/approvals/rewards/github/fetch) + 48 client-delegated (desktop 26,
  browser 8, workspace 6, WordPress 6, credentials/approvals 2). Source-derived
  parity guarded by the `swanbot-v2-dispatcher-parity` smoke (G1).
- **Reliability** — mid-stream interruption handling (never auto-retry
  mid-stream), transient continuation retry with full-jitter backoff, turn
  dedup (15 s TTL), session circuit breaker (2 consecutive transport failures →
  skip v2 for the session; `/v2 on` resets).
- **v1** (`swanbot-ai`) — legacy relay + hardcoded loop, retained as fallback.

**IN-FLIGHT**

- **M4 telemetry sign-off** — the readiness reader
  (`swanbotOpenSwanReadiness.ts` + report script) needs ≥50 terminal rows in
  each of the v1/v2 cohorts and v2's `end_turn` rate ≥ v1's before declaring M4
  done; rollback is a one-line flip or per-device `/v2 off`.
- **M5 v1 deletion** — after 30 days of M4 without rollback + ops sign-off.

**Futures:** SSE streaming on the v2 edge (v1 relay can stream; v2 returns a
single body); model-callable `approvals.request` + mid-turn resume; unify
subagents onto the same v2 `runLoop`/`ToolDef` contract (kills the separate
subagent circuit + a prompt-builder debt).

---

## 4. OpenSwan runtime + tool catalog

**SHIPPED**

- **Provider-agnostic typed loop** — `agentExecutionCore.ts` (`runAgent`): up to
  `maxIterations` rounds, tools never throw (errors wrap as `{ok:false}`),
  default 4 concurrent tools/round, 13 event kinds (incl. `solver_consultation`
  = one re-plan chance before a hard stop, `iteration_complete` = resumable
  checkpoint).
- **Nine reliability layers** (`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`),
  each smoke-tested: (1) observe→act→verify gate, (2) progress + checkpoint,
  (3) parallel read-only rounds, (4) transient edge retry, (5) fail-safe
  finalization, (6) stuck-loop guard + surface ladder, (7) step-budget nudge,
  (8) deterministic auto re-observe, (9) completion proof-check.
- **180+ typed tool catalog** — the `OpenSwanRuntimeToolName` union in
  `openswanToolRuntime.ts`, spanning ~30 families: desktop automation (largest —
  file ops, mouse/keyboard, a11y tree, screenshot, Adobe/CAD adapters),
  rooms/missions/tasks/goals, vault, WordPress, Google Workspace, GitHub,
  messages, approvals, memory, skills, research, custom-API/integrations,
  coordination, codebase, todo, delegation. Per-tool policy: family, approval
  mode (auto/ask), mutation flag, surface list, and progressive disclosure
  (pinned vs deferred-via-`tools.search`).
- **Always-confirm floor** — pay/delete/login/grant hit the floor structurally;
  no auto-approve waiver overrides it.
- **Delegation** — `delegationGate.ts` (depth ≤2, ≤3 concurrent/circle, optional
  daily spend cap, summary-only parent view); `multiAgentDispatch.ts`
  (parallel/roundtable/sequential/debate); mass deploy (`agentDeployPolicy.ts`:
  ≤50 agents, ≤$10, >10-agents-or->$10 needs approval, transient contract — no
  office row, only a child `agent_runs` row).

**Futures:** self-healing code agent (todo + codebase search + result
summarization + context compression already exist as pieces); offline
self-evolution once ≥50 skills + ≥1k runs accumulate; universal computer
automation via a11y/DOM semantic targeting instead of pixels.

---

## 5. Coding agent (Claude-Code / Cursor-Composer class)

Plan: `docs/CODING_AGENT_UPGRADE_PLAN.md`. **4 of 6 phases live; 2 pure-core-ready
awaiting bridge plumbing; 1 SQL migration pending.**

| Phase | What | Status |
|---|---|---|
| **P1** precise editor | `fileEditCore.ts` → `desktop.edit_file`, now lease+CAS-guarded | **SHIPPED + WIRED** |
| **P2** shell | `shellCommandPolicy.ts` (read/mutate/blocked, 99-case smoke) | **PURE CORE DONE** — awaits bridge `execFile` endpoint + `local.run_shell` tool |
| **P3** git | `gitCommandPolicy.ts` (argv-safe, 185-case smoke) | **PURE CORE DONE** — awaits bridge `execFile("git",argv)` + `git.run` tool |
| **P4** codebase index / search / @mentions / conventions | `codebaseIndex*`, `codebaseSymbol*`, `codebaseMentions*`, `projectConventions.ts`; tools `codebase.index`/`codebase.search`; prompt sections wired | **SHIPPED + WIRED** — but `codebase_files` table (RUN_THIS_SQL §24) **PENDING PROD APPLY** |
| **P5** plan/execute model split | `codingModelSplitPolicy.ts` (strong planner → fast executor, fail-closed), `modelCapabilities.ts` coding tiers; auto best-of-N | **SHIPPED + WIRED** (`uc_coding_plan_split` default-ON) |
| **P6** loop upgrades | `agentTodoCore.ts` + `todo.write`; `toolResultSummaryCore.ts` (>20k head+tail+error); `runAndFixGateCore.ts` (≤2 nudges/run) | **SHIPPED + WIRED** |

**Critical path to full parity:** (1) apply P4 SQL §24; (2) bridge `execFile`
endpoint → wire `local.run_shell`; (3) same for `git.run`. Every mutating tool
stays approval-gated with a visible diff; shell/git run as argv vectors (never a
shell string); secrets never enter prompts/logs.

---

## 6. App automation ("pull the app up and do it for you")

Plans: `docs/AGENT_APP_AUTOMATION_IMPLEMENTATION_PLAN.md`,
`docs/UC_APP_TASK_RELIABILITY_ARCHITECTURE.md`.

**SHIPPED & LIVE (executable):**

- **Photoshop + InDesign ExtendScript adapters** — real shipping tools via
  AppleScript `do javascript`, approval-gated, never auto-save, screenshot-verified.
- **Local CAD** — `cadCodeExecutor.ts` (OpenSCAD/FreeCAD/Blender) is LIVE.
- **Route→Contract→Loop→Verify pipeline** — fully operational on every computer
  task: `chatComputerRequestRouter` → `computerTaskEvidenceContract` →
  9-layer loop → `toolLoopResume` → `openswanVerificationRuntime`.
- **Desktop bridge substrate** — file ops, app launch/focus/reachability, a11y
  tree, screenshot, clipboard, AppleScript (`scripts/claude-bridge.js` +
  `desktopBridge.ts`).
- **Browser computer-use** — `computerUse.ts` + `computer-use-agent` edge
  (Browserbase/Stagehand; native Sonnet screenshot loop).

**IN-FLIGHT (pure generators, doc-verified, gated on a live install run):**

- **14 pure script generators** (all smoke-tested, all `verifiedInvocation:false`
  with `// VERIFY` markers): a generalized headless runner (`appScriptRunner.ts`,
  6 engines — MATLAB/KiCad/AutoCAD/Maya/GIMP/After-Effects), Adobe cloud imaging
  (Firefly), and per-app generators for Fusion 360 / Revit / SolidWorks /
  DaVinci / Acrobat / Premiere / Rhino.
- **Gate to LIVE:** each needs a bridge runner (fixed binary path, `execFile`
  argv, output-stat proof) + tool registration + one real install run to flip
  `verifiedInvocation:true`. **Doc-verified ≠ install-verified** — this
  distinction is deliberate and enforced.

**ROI order:** Adobe cloud (no local app needed) → generalized headless runner
(unlocks 6 apps at once) → AutoCAD → Substrate-B connected-agent hosts (Fusion/
Revit/SolidWorks, which have no headless mode) → Adobe video → Office/Acrobat.
The marginal cost of app N+1 is one generator + one live test.

---

## 7. Model routing + BlackSwan flywheel

**SHIPPED**

- **Provider routing** — `llmProviders.ts` (16 providers), `serviceProfileSouls.ts`
  (intent×complexity ladder), `crossProviderRouter.ts`/`universalInvoke.ts`
  (health-aware fallback), `billingPriority.ts` (cheapest / prefer-openrouter /
  prefer-direct), `modelCapabilities.ts` (tool-use/vision/computer-use/coding
  tiers).
- **Collaboration semantics** — `modelCollaborationPolicy.ts`: a pure resolver
  mapping a selected model → {primary, grounding, tool-executor, pattern}.
  BlackSwan grounds app context while `claude-haiku-4-5`
  (`BLACKSWAN_TOOL_EXECUTOR_MODEL_ID`) reliably drives tool turns.
- **BlackSwan-v5** — `cswan801/BlackSwan-v5` (Qwen3.5-4B LoRA) on a dedicated HF
  endpoint; auto-router owns status/memory/casual/light-app-grounded turns;
  `shouldEscalateBlackSwanToFrontier` escalates hard turns; fail-visible failover
  chain (v5 → haiku → sonnet) with a user notice on cold-start.
- **Plan/execute split** — LIVE in computer-use (BlackSwan plans, Sonnet drives
  the screen loop) and newly extended to coding (P5).
- **Best-of-N race** (`bestOfNRace.ts`) — `/bestof` races 2–4 models + judges;
  text-only, no side effects.

**IN-FLIGHT / trajectory**

- **v6 SFT** — the weekly launchd flywheel is fully wired (export → tool-trace
  export → score with Cursor's concave length penalty → convert → MLX train →
  eval-gate → fuse+upload). **Honest gap:** the tool-trace telemetry was only
  fixed recently, so meaningful trace volume is still accumulating.
- **v7 RL** (`docs/BLACKSWAN_V7_RL_PLAN.md`) — spec complete: shadow staging,
  RLVR-style verifiable rewards, per-tool-family executor-swap relaxation behind
  Gates A→B→C. The goal is explicitly **"make the 4B model reliably fast on the
  app's own work,"** not "replace Sonnet." Approval floors / evidence contracts /
  fail-closed gates never relax.

This mirrors the frontier's Composer/SWE-1.5 thesis (§8.3): a small fast
app-native executor RL-trained on the harness's own tool traces, a frontier
model planning. The moat is **RL-on-your-harness + verifiable checks**, not weights.

---

## 8. The substrate

**SHIPPED**

- **Memory** — `agentMemory.ts` (capture + SOUL routing), `memoryEmbeddings.ts`
  (OpenAI `text-embedding-3-small`, `match_memories` RPC), turn-time retrieval
  wired into the prompt, `memory_access_log`. Four-pillar loop (capture → route
  → embed → retrieve → inject) is end-to-end live. **Gap:** the live-builder path
  doesn't capture yet.
- **Skills** — `skillLibrary.ts` (+ write path): agentskills.io SKILL.md format,
  metadata-table injection (cache-hot), approval-gated writes, health tracking,
  body-fencing for untrusted content.
- **Approvals/HITL** — `chatApprovalGate.ts` + `computerGrantGate.ts`: sticky
  pay/delete/login/grant floor, dedup/idempotency, fail-closed on missing rows;
  `runApprovalsService.ts` per-run approvals with realtime banner.
- **Run persistence** — `agent_runs` + `agent_run_events` + token/cost rollups;
  surfaces, status flow, step kinds, ~20 artifact kinds.
- **Cross-dashboard discovery** — `connectedResourcesDigest.ts`/`…Runtime.ts`:
  the agent starts each turn aware of connected integrations, vault creds (names
  only), Google Workspace, and BYOK providers, with a secret-value guard.
- **Multi-agent file coordination** (task #117) — `agentFileLeaseCore.ts` (pure
  CAS + lease state machine) + `agentFileCoordination.ts` (runtime) +
  `scripts/agent-coordination.ts` (CLI for external agents) +
  `coordination.file_status` tool. `desktop.edit_file` routes through
  `guardedApplyEdits` (claim → hash → apply → CAS re-verify → write → release);
  refuses on `held_by_other` or `conflict`. Two independent guarantees: universal
  content-hash CAS + advisory leases. See
  `docs/MULTI_AGENT_FILE_COORDINATION.md`.
- **Office observability** — per-agent accountability index (last outcome, 24 h
  counts, 24 h cost), bridge-aware status reconciliation, readiness strip.

**IN-FLIGHT** — SOUL wisdom distillation (table + cron migrated, edge fn pending);
memory consolidation/decay (stub + design); memory trust UI ("why did you say
this?", pin/forget); Office `agent_id` on `agent_runs` (durable run→agent link,
currently name-matched).

---

## 9. Where the frontier is (mid-2026) and how we're positioned

*Primary-sourced backbone; anything post-Jan-2026 is **[UNVERIFIED]**, directional
only.*

1. **Coding agents** moved to fleets of parallel background agents on
   git-worktrees, running a read→edit→run→observe→fix loop with checkpoints/undo
   (Cursor 2.0 multi-agent, Claude Code 2.0 checkpoints/subagents/hooks, Devin
   2.0 parallel + wiki, Codex cloud, GitHub Agent HQ / Mission Control). *The
   pattern to emulate:* orchestrator-worker + closed-loop self-healing — but
   Anthropic's own guidance is that **most coding work should NOT be
   multi-agented** (too interdependent); parallelism is for read-heavy fan-out.
   **We have the primitives:** `isolation:"worktree"`, leases + CAS, run-and-fix
   gate, evidence contract.
2. **Computer-use** benchmarks crossed human baseline and are saturating, so the
   constraint shifted to **latency, step-efficiency, and untrusted-content
   safety**. Winning pattern: **hybrid fallthrough (API → a11y tree → vision) +
   observe-before-act + fresh-observation-on-retry + tiered HITL** (HITL takeover
   is the single largest measured reliability jump). *This is exactly our
   evidence-contract architecture.* Bet: compete on the approval/observation loop
   being fast and cheap, not on OSWorld score.
3. **Small-fast-executor + frontier-planner** is real and independently
   confirmed — Cursor Composer (MoE, RL-in-harness, ~250 tok/s) and Cognition
   SWE-1.5 (RL on the Cascade harness, ~950 tok/s) both shipped it. Training
   science: RLVR (verifiable rewards from tests/execution, GRPO/DPO, no learned
   reward model); naive single-turn RLVR degrades in multi-step agent settings.
   *This is our BlackSwan thesis.* The moat is RL-on-your-harness + a tight tool
   set + verifiable checks at inference — not pretraining.
4. **Coordination + governance** is where the field converged: MCP (agent→tool,
   now Linux Foundation) + A2A (agent→agent), control-plane products (GitHub
   Agent HQ, the "Agent Management Platform" category), non-human identity
   (Okta ID-JAG delegation chains), agentic payments (AP2 signed mandates), and a
   security spine — the **Lethal Trifecta** (private data + untrusted content +
   external comms = guaranteed exfiltration) and Meta's **Rule of Two** (a
   session should hold at most 2 of 3 without human approval).

**Positioning.** The single-vendor chatbots (Claude, ChatGPT, Gemini) are
single-user and conversation-scoped. The two structurally defensible frontiers
they leave open are exactly ours:

- **A team accountability/control plane** — visible, attributable, reversible
  agent work.
- **The write/spend approval boundary on connected apps** — the highest-liability,
  least-solved seam in the whole field.

Two adoptions to make us standards-native and future-proof: **(a) MCP as the
default integration fabric** (there is an `mcp-tool-bridge` smoke already —
lean in), and **(b) architect every unattended session around the Rule of Two**,
with our sticky floor as the enforcement point.

---

## 10. The future — what the app will be able to do

**Near (this quarter, mostly unblocking already-built work):**

- Full Claude-Code-class coding in chat: apply P4 SQL §24 + wire the shell/git
  `execFile` bridge endpoints → run-and-fix loops on the real repo.
- Live app automation for the first headless engines (MATLAB/AutoCAD/GIMP) +
  Adobe cloud imaging → "generate a hero image and drop it into an InDesign
  template and export," with proof + approvals.
- v2 SwanBot streaming + M4 telemetry sign-off → v2 becomes the sole chat lane.
- Memory God-Plan 3–5 (SOUL wisdom, consolidation, trust UI).

**Mid (1–2 quarters):**

- Plan Mode as a first-class editable object with "Build from Plan," workspace
  indexing + `@file` precise context, per-tool approval governance.
- Multi-file live builder (React runtime preview, error overlay, edit+iterate).
- BlackSwan v6 SFT shipping on real trace volume; v7 RL through Gate A.
- Safe coordinated multi-agent work: one agent delegates to another with a
  temporary TTL vault grant; worktree isolation for heavy parallel builds.

**Long (the north star):**

- Chat "pulls up" *any* app (desktop/browser/CAD/creative) and does the task
  end-to-end, proving each step, with the frontier planning and BlackSwan (or a
  user-trained domain model) executing fast.
- A team's circle *accumulates* intelligence — shared memory + skills + SOUL
  wisdom — so agents (this app's, Claude Code, Cursor, Codex) join a circle and
  inherit its context instead of starting cold.
- Offline agent self-improvement (DSPy/GEPA-style) once benchmarks + post-hoc
  scoring have enough runs: agents optimize their own prompts and skill selection
  against regression benchmarks.
- Standards-native interop (MCP + A2A) so the workspace is the control plane over
  a fleet of heterogeneous agents acting in real accounts — visible, attributable,
  reversible, and governed by the Rule of Two.

---

## 11. Honest gaps & risks

- **Doc-verified ≠ install-verified** — the 14 app generators are correct on
  paper; none is LIVE until a real binary run flips its gate.
- **SQL not yet applied** — `codebase_files` (§24) blocks codebase indexing until
  run in prod. A local migration file is not proof prod has it.
- **Bridge plumbing pending** — shell/git are policy-complete but need the
  `execFile` endpoint; app automation needs per-engine runners.
- **Telemetry maturity** — M4 sign-off and BlackSwan v6/v7 both wait on
  accumulating production data (trace telemetry was only recently wired).
- **Live-builder memory gap** — build completions don't write memory yet.
- **Office run→agent link is name-matched** — needs a durable `agent_id`.
- **Security invariants that never relax:** the pay/delete/login/grant floor;
  no raw secrets in prompts/logs/metadata; untrusted retrieved content stays
  fenced; no silent provider/model switching; Rule-of-Two for unattended sessions.

---

## 12. Verification posture

Everything in §§2–8 is grounded in this repo (files, commits, smoke tests) as of
commit `b26b7f3` on `wip/full-working-tree`, 2026-07-13. Tool-catalog size is
stated as "180+" because the `OpenSwanRuntimeToolName` union is a composed
multi-type union (counting method yields 170–191); the 73-tool figure is the
concrete `swanbot-v2-ai` executable subset. §9 frontier claims are primary-sourced
for the pre-cutoff backbone (launch dates, benchmark methodology, protocol
history, RLVR science, the trifecta/Rule-of-Two spine) and **[UNVERIFIED]** for
anything after Jan 2026 (2026 leaderboard numbers, Composer 2 internals,
next-gen model names). Treat post-cutoff items as directional.
