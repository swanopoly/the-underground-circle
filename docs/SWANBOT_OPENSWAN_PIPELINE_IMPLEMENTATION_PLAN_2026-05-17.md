# SwanBot + OpenSwan Pipeline Implementation Plan

Date: 2026-05-17

## Goal

Make chat behave like a task operating system: the user describes what they want, SwanBot classifies the scenario, OpenSwan picks the safest execution path, tools run with approvals and receipts, every step is saved, and the system learns from outcomes without leaking secrets or burning API cost.

This plan supersedes scattered pipeline notes when they conflict with current implementation. Existing docs still provide useful background:

- `docs/SWANBOT_PIPELINE_RESEARCH_2026-05-15.md`
- `docs/OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`
- `docs/OPENSWAN_CHAT_ARCHITECTURE_PLAN.md`
- `docs/UNIVERSAL_CONTROL_RESEARCH_2026-04-23.md`
- `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`

## Operating Model

Every chat request should flow through this sequence:

1. Intake: normalize message, selected model, active circle, user settings, connected integrations, vault grants, bridge health, and prior thread state.
2. Scenario routing: classify the request into a concrete task pipeline with confidence, risk, execution surface, approval triggers, model budget, and persistence targets.
3. Plan: build a runbook with allowed tools, forbidden actions, required evidence, and stop conditions.
4. Execute: prefer direct integration APIs and app-native scripting/DOM APIs first, then browser semantic automation, then desktop accessibility automation, then vision/coordinate computer-use as a last resort.
5. Gate: pause for credentials, CAPTCHA/MFA, publish/send/payment/delete/destructive actions, uncertain selectors, or cost overruns.
6. Verify: capture receipts, screenshots/log refs, DOM/a11y snapshots, test results, or final confirmation text.
7. Persist: save user-visible messages, tool events, run ledger entries, costs, memories, approvals, artifacts, and failure reasons.
8. Learn: update scenario evals, prompt hints, memory graph, and routing scores from real outcomes.

## Phase 1: Scenario Router Hardening

Status: Started. `userTaskPipelines` now includes dedicated routes for website platform admin work and bridge troubleshooting.

Build:

- Expand `src/lib/userTaskPipelines.ts` into the canonical scenario taxonomy.
- Add a `scenarioPolicy` object per pipeline:
  - `allowedSurfaces`
  - `blockedActions`
  - `approvalTriggers`
  - `credentialPolicy`
  - `modelBudget`
  - `completionProof`
  - `failureClasses`
- Keep `src/lib/chatAutomationPlanner.ts` as the entry router for ChatTab.
- Keep `src/lib/openswanTaskPlanner.ts` as the OpenSwan runbook/tool planner.
- Add regression cases for every new scenario in `scripts/user-task-pipelines-smoketest.ts` and `scripts/chat-planner-smoketest.ts`.

Priority scenarios:

- Local browser tabs and desktop awareness.
- Bridge diagnostics and recovery.
- Website admin platforms: WordPress, Shopify, Webflow, Wix, Squarespace, WooCommerce, BigCommerce, Framer.
- Vault-backed login automation.
- Form submission and data entry.
- Human verification pause/resume.
- Desktop app control through accessibility tree and screenshots.
- Creative layout app automation: InDesign marketing banners, production layouts, layered text frames, links/assets, proofs, preflight, and package handoff.
- Photoshop/Figma/Canva style creative app work.
- Terminal agent orchestration for Codex, Claude Code, Cursor, Gemini CLI, and other terminal agents.
- Office dashboard agent management.
- Cost and API usage audits.
- Second brain and memory graph updates.
- Business workflows: CRM, sales, support, finance, analytics, HR, marketing, procurement, travel, compliance, IT ops.

Acceptance criteria:

- A representative prompt for each scenario resolves to the correct primary pipeline.
- Multi-surface prompts include supporting pipelines.
- High-risk scenarios require approval.
- Local desktop requests do not fall through to Browserbase or generic model refusal.
- Layered InDesign banner prompts resolve to `creative_layout_design`, produce a `creative_layout_control` strategy, and include app-native InDesign status/text-inventory tools before any screenshot or coordinate tool.

## Phase 2: Run Ledger v2

Build a durable run ledger that records every chat, SwanBot, OpenSwan, browser, desktop, and terminal-agent action.

Database:

- Extend `agent_runs` for high-level run summary.
- Add `agent_run_steps` for ordered execution steps.
- Add `agent_run_tool_events` for raw tool calls, sanitized inputs, outputs, status, latency, and token/cost estimates.
- Add `agent_run_artifacts` for screenshots, logs, generated files, browser recordings, trace refs, and report outputs.
- Add `agent_run_failures` for normalized failure classes.
- Add `agent_run_budgets` for per-run model, tool, and spend limits.

Core event shape:

```ts
type AgentRunLedgerEvent = {
  runId: string;
  circleId: string;
  userId: string;
  sessionId: string;
  messageId?: string;
  scenarioId: string;
  actor: 'user' | 'swanbot' | 'openswan' | 'tool' | 'terminal_agent' | 'human';
  eventType: 'planned' | 'tool_started' | 'tool_finished' | 'approval_requested' | 'approval_resolved' | 'blocked' | 'verified' | 'completed' | 'failed';
  toolName?: string;
  risk: 'safe' | 'review' | 'external_side_effect' | 'destructive';
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  artifactRefs?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};
```

App changes:

- Create `src/lib/agentRunLedger.ts`.
- Wire ledger writes into `chatAutomationPlanner`, `openswanSessionRuntime`, `openswanToolRuntime`, `computerTaskExecution`, browser bridge calls, desktop bridge calls, and terminal agent launcher.
- Surface ledger entries in Chat run cards and Office dashboard.

Acceptance criteria:

- Refreshing chat never loses OpenSwan/SwanBot/model/tool messages.
- Every run has a final status.
- Failed runs explain the exact blocker.
- Office dashboard can show active, paused, blocked, completed, and failed runs.

## Phase 3: Execution Surface Router

Replace one-shot "use browser/computer" behavior with a strict layered executor.

Execution order:

1. First-party integration/API.
2. App-native scripting/DOM/API surfaces for local applications, such as InDesign document/layer/text/link/export tools.
3. Browser semantic automation through Playwright locators and DOM/ARIA snapshots.
4. Stagehand `observe`, `act`, and `extract` for ambiguous dynamic websites.
5. Local desktop accessibility tree, menu, and app/window APIs.
6. Vision/coordinate computer-use only when semantic automation fails.
7. Human takeover for CAPTCHA, MFA, payment, publishing, destructive changes, or unclear UI.

Build:

- Add `src/lib/executionSurfaceRouter.ts`.
- Add per-surface readiness checks:
  - marketplace integration connected
  - user API key present
  - vault grant available
  - browser bridge healthy
  - desktop bridge healthy
  - app-native script/DOM bridge tools available for the target app
  - accessibility permission available
  - screenshot permission available
  - CUA provider/model supports requested tool type
- Add a `surfacePlan` to `OpenSwanTaskPlan`.
- Add a fallback ladder with stop reasons.

Acceptance criteria:

- Shopify/Webflow/Wix/Squarespace tasks choose browser automation unless a first-party integration exists.
- Chrome tab requests choose local desktop bridge only.
- InDesign `.indd`/`.idml`/package prompts choose app-native document status and text/link/layer inventory before accessibility, screenshots, or coordinates.
- CAPTCHA/MFA never gets clicked by the agent; it requests human verification.
- Computer-use model calls only happen after cheaper semantic surfaces fail or are unavailable.

## Phase 4: Prompt Builder + Context Contract

Current prompt assembly should become component based so SwanBot and OpenSwan share one contract.

Build:

- Create `src/lib/agentPromptBuilder/`.
- Components:
  - `agent_role`
  - `scenario_policy`
  - `tool_contract`
  - `surface_readiness`
  - `vault_policy`
  - `memory_context`
  - `run_ledger_context`
  - `approval_policy`
  - `cost_budget`
  - `completion_proof`
  - `failure_recovery`
- Add model/provider variants for low-cost routing, coding, browser tasks, desktop tasks, vision tasks, and high-stakes review.
- Include selected pipeline prompt block from `buildUserTaskPipelinePromptBlock`.
- Include exact tool availability and forbidden actions.

Acceptance criteria:

- Upstream model identity leaks are minimized. Answers should say what The Underground Circle can do, not "I am a Google model" or similar.
- Prompt blocks are deterministic and snapshot-testable.
- Same scenario produces the same runbook regardless of selected model unless the user explicitly overrides it.

## Phase 5: Memory + Digital Brain Feedback Loop

Make memory useful for execution, not just recall.

Build:

- Normalize memories into scopes:
  - user preferences
  - circle knowledge
  - app architecture
  - agent/session learnings
  - task outcomes
  - credentials metadata without secrets
  - failure/recovery patterns
- Add `memoryUsePolicy` to each scenario.
- Save terminal-agent and OpenSwan learnings to the connected user account and circle.
- Update digital brain clusters when durable knowledge is created.
- Add memory retrieval caps and summarization to prevent bloated prompts.

Acceptance criteria:

- A failed bridge/tool run creates a reusable recovery memory.
- User preferences affect future routing.
- Personal user memory does not leak to other users.
- Circle memory only appears where the user has circle access.

## Phase 6: Approval, Human Takeover, And Safety

Build the approval layer as a first-class runtime state, not a UI afterthought.

Approval types:

- Credential use.
- CAPTCHA/MFA/human verification.
- Publish/send/submit/payment/purchase.
- Delete/destructive actions.
- Local file write.
- Terminal command execution.
- External account changes.
- Cost over budget.
- Uncertain selector or ambiguous UI target.

Build:

- Add approval state to run ledger.
- Add resumable approval checkpoints to Chat and Office.
- Add "take over browser/desktop now" state for human verification.
- Add domain and action allowlists to vault grants.
- Add "remember this approval policy" for low-risk repeated actions.

Acceptance criteria:

- User can pause/resume/cancel any active OpenSwan run.
- User can approve one step, all safe steps, or reject.
- Agent cannot continue after a rejected high-risk action.

## Phase 7: Cost Governor

Stop accidental daily API spend by enforcing budgets at runtime.

Build:

- Add per-user and per-circle budgets.
- Add per-run model budget in scenario policies.
- Add provider routing:
  - cheap classifier for routing
  - cheap summarizer for memory compression
  - stronger model for planning only when required
  - vision/computer-use model only after semantic tools fail
- Add prompt caching for static instructions and long context where provider supports it.
- Add duplicate-run and loop detection.
- Add daily spend summaries in Office dashboard.

Acceptance criteria:

- Non-owner users must use their own marketplace/API keys unless explicitly enabled for testing.
- Anthropic/OpenAI calls are tagged with source, scenario, run ID, and user ID.
- Recurring jobs cannot call paid models unless explicitly enabled and budgeted.
- If a run hits budget, it pauses with a concise explanation.

## Phase 8: Observability + Evals

Build evals from real user prompts and run them after each pipeline change.

Eval packs:

- `evals/chat-scenarios.jsonl`
- `evals/browser-admin.jsonl`
- `evals/desktop-awareness.jsonl`
- `evals/desktop-app-control.jsonl`
- `evals/vault-login.jsonl`
- `evals/terminal-agents.jsonl`
- `evals/cost-control.jsonl`
- `evals/failure-recovery.jsonl`

Metrics:

- correct scenario route
- correct tool selection
- approval gate correctness
- cost estimate vs actual
- completion proof present
- no secret leakage
- no model identity leakage
- persisted after refresh
- failure class present when blocked
- user-visible answer quality

Build:

- Add `scripts/agent-pipeline-evals.ts`.
- Export run ledger traces for replay.
- Add Office dashboard eval summary.
- Add "promote scenario hint" action for repeated failures.

Acceptance criteria:

- New scenarios cannot ship without a smoke or eval case.
- Real failures can be replayed without hitting paid APIs.
- Office dashboard shows trend lines for success, blockers, cost, and tool failures.

## Phase 9: UI Integration

Chat:

- Show the selected scenario and current run step in the run card.
- Show active surface: integration, browser, desktop, terminal, model-only, or human takeover.
- Show cost and step budget before expensive runs.
- Show approval banners inline.
- Show completion proof and artifacts.

OpenSwan Control Panel:

- Move readiness, bridge health, vault grants, approvals, and current run state into accordions.
- Add "Fix blocked run" that maps failure class to recovery action.
- Add bridge health diagnostics for browser tabs, desktop apps, accessibility, screenshot, CORS, token, and endpoint mismatch.

Office:

- Show active agents, terminal sessions, run ledgers, budgets, memory sync, and scenario success rates.
- Allow terminal agent defaults, provider/model selection, working directory, concurrency, memory behavior, and budget limits.

Backpack/Digital Brain:

- Show scenario clusters, memory flow, run outcomes, and durable learnings.
- Distinguish personal user memory from circle knowledge.

## Implementation Order

1. Finish scenario policy objects in `userTaskPipelines`.
2. Add `agentRunLedger.ts` with no DB writes first, then wire local in-memory smoke tests.
3. Add Supabase migration for run ledger tables.
4. Wire ChatTab and OpenSwan runtime persistence to the ledger.
5. Add execution surface router and readiness checks.
6. Add failure taxonomy and blocked-run recovery actions.
7. Refactor prompt builder into composable components.
8. Add memory feedback loop.
9. Add cost governor.
10. Add eval runner and Office dashboard metrics.
11. Harden UI/UX and run full smoke/typecheck.

## Immediate Next Sprint

Sprint target: make route -> runbook -> tool policy -> receipt deterministic.

Deliverables:

- `src/lib/scenarioPolicies.ts`
- `src/lib/executionSurfaceRouter.ts`
- `src/lib/agentRunLedger.ts`
- `src/lib/agentFailureTaxonomy.ts`
- `scripts/agent-pipeline-evals.ts`
- Supabase migration for run ledger tables.
- Chat run card shows scenario, surface, approval state, cost, and proof.
- Office dashboard can list active/blocked/completed OpenSwan/SwanBot runs.

Smoke tests:

- `npm run smoke:user-task-pipelines`
- `npm run smoke:chat-planner`
- `npm run smoke:openswan-task-planner`
- `npm run smoke:computer-task-runtime`
- `npm run smoke:desktop-runtime-wiring`
- `npm run smoke:persisted-chat-metadata`
- `npm run smoke:approval-payload`
- `npm run typecheck:app`

## Non-Negotiables

- No raw secrets in model prompts, chat messages, ledger rows, logs, or screenshots.
- No paid model call without user/circle/source/run attribution.
- No CAPTCHA/MFA bypass behavior.
- No publish/send/pay/delete without explicit approval.
- No local desktop mutation without bridge permission and visible user intent.
- No generic "I cannot" answer until the app has checked the correct local or remote surface.
- No scenario is considered complete without proof or a precise blocker.
