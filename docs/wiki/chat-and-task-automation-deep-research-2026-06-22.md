# Chat and Task Automation Deep Research

Date: 2026-06-22

Wiki type: dated research report

This note translates current agent, tool-use, browser automation, MCP, guardrail,
and eval guidance into concrete build targets for The Underground Circle chat
and app automation loop.

## Local Architecture Snapshot

The app already has the right foundation for a professional automation loop:

- `src/lib/chatAutomationPlanner.ts` classifies user intent, builds
  `ChatAutomationPlan`, detects clarification needs, risk, approvals, computer
  requests, web tasks, image tasks, user task pipelines, app strategies, and
  recovery plans.
- `src/lib/runChatAutomationPlan.ts` is the central dispatcher contract for
  plan execution, approval gates, observer hooks, and normalized outcomes.
- `src/lib/chatTransportHandlers.ts` is the single handler map for transport
  actions that should eventually replace legacy scattered branches.
- `src/lib/chatComputerRequestRouter.ts` and `src/lib/desktopTaskAiNeed.ts`
  separate deterministic, AI-assisted, and AI-required computer work.
- `src/lib/computerTaskEvidenceContract.ts` already defines a strong evidence
  model for browser, desktop, local-file, hybrid, and agent-buildout automation.
- `src/lib/repeatedFlowDetection.ts` can become the foundation for "save this as
  an automation" after repeated successful flows.

The main product opportunity is not to make chat more magical. It is to make
chat visibly plan, route, act, verify, recover, and learn from repeated work.

## Research Takeaways

### 1. Route workflows before agents

Anthropic draws a practical distinction between workflows, where code follows a
predefined path, and agents, where the model dynamically directs the process and
tool use. That maps directly to our current planner split: deterministic bridge
actions should run as workflows first, and agentic reasoning should enter only
when the task is ambiguous, visual, research-heavy, or missing a deterministic
recipe.

Build implication:

- Keep `desktopTaskAiNeed` as a first-class routing signal in chat.
- Add a visible route preview before automation starts:
  - `workflow`: deterministic, recipe-backed, lowest autonomy.
  - `assisted`: deterministic shell plus AI perception, research, or mapping.
  - `agentic`: dynamic planning with stronger approval and tracing.
- Do not let every chat request become an open-ended agent run.

### 2. Tool quality matters more than tool count

Anthropic's tool guidance emphasizes choosing the right tools, namespacing,
meaningful context, token efficiency, strong descriptions, and evals. OpenAI's
tool and MCP guidance similarly frames tools/connectors as the extension point
for model capability. The practical failure mode for our app is tool sprawl:
many partially overlapping bridge, agent, provider, browser, desktop, and chat
paths that are hard for the model and user to reason about.

Build implication:

- Add a tool contract quality gate for all automation tools:
  - clear namespace, for example `browser.open`, `desktop.observe`,
    `cad.autocad.run_command`, `matlab.execute_script`.
  - examples for complex inputs.
  - compact structured results with `status`, `evidence`, `next_safe_action`,
    and `recovery`.
  - no raw noisy logs unless the user opens the details panel.
- Prefer fewer, higher-level tools that map to user intent over many tiny tools.
- Keep raw bridge/tool details in evidence, not in the primary chat transcript.

### 3. The automation ladder should be observe, plan, act, verify

Playwright recommends user-facing locators and actionability checks instead of
brittle selectors. Stagehand frames browser automation around `observe`, `act`,
`extract`, and `agent`, letting teams decide how much AI to apply. Anthropic's
computer-use guidance warns that high-precision UI work still needs review,
verification, and human oversight for sensitive actions.

Build implication:

- Chat should show an automation preview card before side effects:
  - app or surface being used.
  - intended state change.
  - evidence required before marking done.
  - approval level.
- Browser tasks should prefer:
  1. Playwright locator/actionability path.
  2. Stagehand-style natural language action only when selectors are not enough.
  3. Full browser agent only when dynamic exploration is needed.
- Desktop/native tasks should prefer:
  1. app-native API or scriptable command.
  2. accessibility tree.
  3. screenshot/coordinate fallback with stronger evidence and approval.
- CAD, MATLAB, and SolidWorks style apps should get domain adapters that expose
  professional operations instead of raw clicking whenever possible.

### 4. Approval and guardrails need to wrap tool calls, not just messages

MCP's security model calls out user consent, control, and privacy. OpenAI's
guardrail docs recommend validating or blocking tool calls before and after
execution. OWASP's 2026 agentic guidance focuses on risks where autonomous
systems plan, act, and decide across tools.

Build implication:

- Every plan should carry:
  - `riskLevel`.
  - `sideEffectLevel`.
  - `approvalRequirement`.
  - `dataExposure`.
  - `canUndo`.
  - `proofRequired`.
- Tool calls should be guarded before execution and audited after execution.
- Sensitive cases should always require confirmation:
  - deleting, sending, purchasing, publishing, sharing, installing, running
    terminal commands, changing CAD/engineering files, changing source files, or
    using credentials.
- Chat should explain approvals in one sentence, not a wall of internal policy.

### 5. Evals and traces must become product infrastructure

OpenAI's eval guidance recommends eval-driven development, task-specific evals,
logging everything, and avoiding vibe-based checks. OpenAI tracing records LLM
calls, tool calls, handoffs, guardrails, and custom events. Anthropic also
emphasizes evals for agents that use tools, modify state, and run multi-turn
work.

Build implication:

- Add a chat automation eval pack that covers:
  - multi-intent prompts.
  - typo-heavy prompts.
  - long conversations with stale context.
  - ambiguous app names.
  - missing bridge.
  - missing provider key.
  - side-effect approval.
  - coordinate fallback.
  - duplicate-click prevention.
  - failed verification.
  - user correction mid-run.
  - repeated-flow promotion.
- Add a trace ledger for every automation turn:
  - planner decision.
  - selected route.
  - approval gate.
  - tool calls.
  - evidence produced.
  - verification result.
  - recovery action.
  - final stop reason.

### 6. Long-running tasks need resumable artifacts

Anthropic's long-running agent harness guidance highlights incremental progress
artifacts and explicit done criteria because agents can overreach or declare
done too early. That maps to our checkpoint, ledger, memory, and activity proof
direction.

Build implication:

- Long tasks should create a task workspace with:
  - objective.
  - assumptions.
  - app/file/repo handles.
  - current checkpoint.
  - next action.
  - done criteria.
  - proof checklist.
- Chat should be able to resume from the workspace rather than rereading the
  entire conversation.
- If a task fails, the final chat answer should include the exact retry step and
  the reason it is safe.

## Product Additions To Build

### P0 - Complete the single chat executor cutover

Goal: one planner, one dispatcher, one handler registry, one evidence contract.

Build:

- Finish moving legacy chat branches onto `buildChatAutomationPlan`,
  `dispatchChatAutomationPlan`, and `createChatTransportHandlers`.
- Keep handler fallbacks temporarily, but log every fallback as migration debt.
- Add a smoke that fails when a known route bypasses the dispatcher.

Why it matters:

- The chat UX cannot feel consistent while task creation, provider routing,
  computer use, web tasks, office agents, and generated assets use separate
  execution paths.

### P1 - Add the Chat Plan Card

Goal: show the user what will happen before automation starts.

The card should show:

- Intent: what chat thinks the user asked for.
- Route: workflow, assisted, or agentic.
- Surface: chat, browser, desktop, file, repo, provider, CAD, MATLAB, Office.
- Risk: low, medium, high, destructive.
- Approval: none, confirm, credentials, destructive action.
- Evidence: what proof will mark the task complete.
- Recovery: first retry or diagnostic path if the bridge/app is unavailable.

Files to extend:

- `src/lib/chatAutomationPlanner.ts`
- `src/lib/runChatAutomationPlan.ts`
- `src/lib/chatComputerRequestUx.ts`
- the Chat tab transcript components that render tool/activity cards.

### P2 - Add the Automation Evidence Panel

Goal: make automation feel professional instead of mysterious.

Panel sections:

- Observed state.
- Planned action.
- Tool calls.
- Verification evidence.
- Files or apps touched.
- Recovery notes.
- Approval trail.

This should use `computerTaskEvidenceContract` as the source of truth and hide
raw logs behind an expandable details view.

### P3 - Turn repeated successful chat work into saved automations

Goal: when the user repeats a flow, chat should offer to save it as a reusable
automation.

Build:

- Use `repeatedFlowDetection` to identify candidate flows.
- Add "Save as automation" after successful repeated tasks.
- Store:
  - trigger phrase.
  - required inputs.
  - deterministic steps.
  - approval gates.
  - evidence checklist.
  - allowed apps/tools.
- Let the user edit the automation before saving.

### P4 - Add domain automation adapters for professional apps

Goal: app automation should use professional control surfaces before clicking.

Build domain adapters:

- AutoCAD:
  - command execution.
  - drawing inspection.
  - layer/block/property operations.
  - export proof.
  - Autodesk MCP/assistant integration where available.
- MATLAB:
  - script execution.
  - workspace inspection.
  - plot/export proof.
  - function help/research.
  - AI skill style task recipe support.
- SolidWorks:
  - macro/API execution.
  - model feature inspection.
  - drawing/export proof.
  - simulation or design-check workflows where available.

Shared contract:

- observe first.
- show plan.
- require approval for mutation/export/publish.
- run app-native operation.
- verify with app state and artifact proof.
- fall back to UI automation only when native surfaces are missing.

### P5 - Add the automation eval pack

Goal: protect the user experience as the planner grows.

Start with these eval categories:

- app task routing.
- browser task routing.
- native desktop task routing.
- provider/tool selection.
- side-effect approval.
- missing bridge recovery.
- ambiguous prompt clarification.
- long-running task resume.
- repeated-flow promotion.
- evidence sufficiency.

Each eval should assert:

- selected route.
- selected risk level.
- approval requirement.
- expected handler.
- evidence requirement.
- safe failure message.

### P6 - Add trace-first task telemetry

Goal: every automation failure should be diagnosable.

Record:

- planner version.
- route and AI-need tier.
- model/provider used.
- tool calls and result summaries.
- approvals requested/granted/denied.
- evidence status.
- recovery suggestion.
- user-visible final answer.

Keep sensitive data redacted by default.

## Chat UX Improvements

The best chat experience for automation should feel like working with a senior
operator:

- It asks a clarifying question only when the missing detail changes the action.
- It previews side effects before it acts.
- It explains risk in plain language.
- It shows proof when done.
- It can recover from bridge/app failures with a specific retry path.
- It turns repeated work into reusable automations.
- It separates "I can do this deterministically" from "I need AI judgment".
- It remembers useful task context, but does not silently reuse risky context.

Avoid:

- opaque "working on it" loops with no proof.
- coordinate-first desktop automation.
- raw logs in the main transcript.
- hidden destructive actions.
- generic fallback answers when a bridge, provider, or app is offline.
- calling every app task an agent run.

## Immediate Build Sequence

1. Add a visible `ChatAutomationPlan` preview surface in chat.
2. Finish routing remaining chat action branches through
   `createChatTransportHandlers`.
3. Add a smoke for dispatcher coverage and approval/risk classification.
4. Add an automation evidence panel backed by
   `computerTaskEvidenceContract`.
5. Promote repeated successful flows into saved automations.
6. Add AutoCAD, MATLAB, and SolidWorks domain adapters behind the same
   observe-plan-act-verify contract.
7. Add evals and tracing before expanding more autonomous behavior.

## Source Notes

- Anthropic, "Building effective agents" -
  https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, "Writing effective tools for agents" -
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, "Effective harnesses for long-running agents" -
  https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, "Demystifying evals for AI agents" -
  https://www.anthropic.com/engineering/agent-evals
- Anthropic Docs, "Computer use tool" -
  https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool
- Model Context Protocol Specification -
  https://modelcontextprotocol.io/docs/getting-started/intro
- Playwright Docs, "Best Practices" -
  https://playwright.dev/docs/best-practices
- Stagehand Docs, "Introduction" -
  https://docs.stagehand.dev/
- OWASP, "Agentic AI - Threats and Mitigations" -
  https://owasp.org/www-project-agentic-applications/
- OpenAI Docs, "Tools" -
  https://platform.openai.com/docs/guides/tools
- OpenAI Docs, "MCP/connectors" -
  https://platform.openai.com/docs/guides/tools-remote-mcp
- OpenAI Docs, "Agents SDK" -
  https://openai.github.io/openai-agents-js/guides/agents/
- OpenAI Docs, "Guardrails" -
  https://openai.github.io/openai-agents-js/guides/guardrails/
- OpenAI Docs, "Evals design best practices" -
  https://cookbook.openai.com/articles/evals-design-best-practices
- OpenAI Docs, "Tracing" -
  https://platform.openai.com/docs/guides/tracing
