# Desktop Manipulation Plan 2026-05-15

## Research Basis

- Anthropic's computer-use documentation frames desktop control as screenshot capture plus mouse/keyboard control, and recommends an agent loop that observes, acts, and executes tools externally: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/computer-use-tool
- Playwright's best practices emphasize resilient locators and user-visible behavior over brittle implementation details, which maps to DOM/ARIA-first browser control: https://playwright.dev/docs/best-practices
- Apple Accessibility APIs expose app/UI information for assistive technologies and are the right first path for semantic macOS app control before blind coordinates: https://developer.apple.com/documentation/accessibility/accessibility-api
- Microsoft UI Automation control patterns formalize the same concept on Windows: controls expose behaviors like invoke, scroll, selection, and value independently of visual appearance: https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview
- Adobe's InDesign UXP script docs and DOM reference establish the higher-priority path for creative layout apps: script/DOM inspection and mutation before accessibility or coordinates. InDesign exposes Document, Layer, TextFrame, Link, and ExportFormat objects for production-layout work: https://developer.adobe.com/indesign/uxp/scripts/ and https://developer.adobe.com/indesign/dom/api/
- Adobe's Photoshop UXP scripting docs show the same app-native expansion path for image-editing apps: use Photoshop DOM APIs first, then lower-level action descriptors such as batchPlay only when the DOM does not cover the operation: https://developer.adobe.com/photoshop/uxp/scripting/ and https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/

## Execution Model

The chat should never jump straight to clicking or typing. Every desktop/browser task should run:

1. Classify the user request into a user-task pipeline.
2. Select a computer/app strategy.
3. Run preflight against bridge, app, browser, vault, and approval requirements.
4. Build a grounding plan: required observations, freshness, fallback chain, forbidden fallbacks, approval gates, and verification signals.
5. Observe current state through semantic tools first.
6. Act one reversible step at a time.
7. Verify after each step with the same surface that observed the state.
8. Persist result, proof, blockers, approvals, grounding, and reusable workflow notes.

## Strategy Layers

- Browser Semantic Control: DOM/ARIA first, screenshot only for visual proof.
- Credentialed Browser Workflow: vault runbook + origin checks + no raw secret output.
- Approval-Sensitive Browser Workflow: staged bookings, purchases, CRM writes, social posts, finance actions, and campaign launches.
- Desktop Read-Only Awareness: browser tabs, running apps, active window, clipboard, local files.
- Desktop Semantic Control: app focus + accessibility tree + element click/type before coordinates.
- Productivity App Control: Slack/Mail/Calendar/Teams/Notion workflows with focus-before-type and draft-before-send.
- Layered Creative Layout Control: InDesign and production-layout tasks use file/package resolution, document status, layer/text/link inventory, script-backed edits, proof export, and package handoff before UI control.
- Canvas App Vision Control: Photoshop/Figma style workflows with screenshot-before-coordinate actions.
- Document/Data Workbench: file read/OCR/extraction/dry-run before upload or database writes.
- Ops Console Read-First Control: logs/status first, deploy/rollback/restart/scale only after approval.
- Terminal Agent Orchestration: launch, message, monitor, and persist Codex/Claude/Gemini/Cursor sessions.
- Human Verification Pause: CAPTCHA/MFA/OTP/bot checks stop automation and wait for the user.

## Current Build

- `src/lib/computerAppTaskStrategy.ts` maps user-task pipelines into explicit execution strategies.
- `src/lib/computerAppPreflight.ts` maps strategies to required capabilities and fix actions.
- `src/lib/computerAppGrounding.ts` turns strategies into observation freshness rules, fallback chains, forbidden fallbacks, approval gates, verification signals, action readiness checks, observation-ledger checks, runbooks, next-step recommendations, trace summaries, and an action audit.
- `src/lib/designAppAutomation.ts` adds the chat prompt contract for layered InDesign marketing-banner work: document/package resolution, layer/text/link inventory, script-backed text updates, approval gates, verification signals, and bounded recovery.
- `src/lib/computerAppExecutionReceipts.ts` generates required observe/action/verify/approval/recovery receipt templates and audits unsafe runs.
- `src/lib/computerTaskExecution.ts` now includes `computerAppGrounding`, `computerAppGroundingRunbook`, `computerAppGroundingNextStep`, and `computerAppGroundingTrace` on every direct computer-task execution envelope, not just OpenSwan plans.
- `src/lib/computerTaskDispatch.ts` injects the grounding strategy, trace status, next safe tool, observation freshness contract, action discipline, forbidden fallbacks, approval gates, and verification signals directly into the agent dispatch prompt.
- `src/lib/computerTaskState.ts` persists a compact grounding summary for the Use Computer console: strategy, surface, status, badges, blockers, and next safe action.
- `src/lib/computerUse.ts` now attaches grounding/preflight metadata to browser plan summaries and plan cards, and feeds the grounding trace into browser action planning so the browser runtime starts with the correct observe/approval/act discipline.
- `src/components/chat/RunExecutionCard.tsx` renders browser-plan grounding status and next safe action in the run ledger, so users can see why a browser plan is observing, waiting for approval, or blocked.
- `src/lib/openswanTaskPlanner.ts` injects strategy tools into OpenSwan plans.
- OpenSwan run metadata now carries `computerAppGrounding`, `computerAppGroundingRunbook`, `computerAppGroundingNextStep`, and `computerAppGroundingTrace`, so Office can show the expected observation/action/verification sequence, immediate first tool, freshness status, blockers, and persistence targets for desktop/browser work.
- `scripts/computer-app-task-strategy-smoketest.ts` verifies strategy selection and OpenSwan tools.
- `scripts/computer-app-preflight-smoketest.ts` verifies readiness, blockers, warnings, and fix actions.
- `scripts/computer-app-grounding-smoketest.ts` verifies grounding plans, stale observation blocking, coordinate-action blocking, approval-sensitive blocking, and OpenSwan grounding-plan wiring.
- `scripts/design-app-automation-smoketest.ts` verifies the InDesign marketing-banner prompt contract, approval gates, recovery rules, and app-native tool recommendations.
- `scripts/computer-app-execution-receipts-smoketest.ts` verifies blind-action blocking, repeated-failure blocking, receipt prompt output, and OpenSwan receipt-plan wiring.
- `scripts/computer-task-execution-grounding-smoketest.ts` verifies direct chat computer-task execution envelopes carry the grounding contract and dispatch prompt.

## Grounding Contract

Every computer/app run should know:

- `primarySurface`: browser, desktop, vault, terminal, file, code, approval, or system.
- `observationRules`: the exact observations needed before mutation and how fresh they must be.
- `actionDiscipline`: how to act on that surface without guessing.
- `fallbackChain`: the allowed escalation order when a tool or locator fails.
- `approvalGates`: final actions that must be explicitly approved.
- `forbiddenFallbacks`: shortcuts the agent must not take.
- `verificationSignals`: what counts as proof that the task is done.

The grounding audit blocks:

- Mutating actions that do not cite a required observation.
- Actions based on stale observations.
- Coordinate-style desktop/browser control without fresh screenshot/screen-size grounding.
- Approval-sensitive actions such as checkout, booking, sending, publishing, deploy, rollback, restart, secret changes, or destructive actions without approved approval state.
- Any mutation attempted under read-only desktop awareness or read-only file-search strategies.

## Action Readiness Contract

Before a mutating action is allowed to execute, the runtime can call `evaluateComputerAppActionReadiness` with:

- The selected grounding plan.
- The candidate action: surface, tool, description, mutates flag, cited source observations, and approval state.
- The observation ledger: rule id, tool, timestamp, summary, confidence, target, and metadata.

The evaluator returns:

- `ready`: whether the action can run.
- `requiredRuleIds`: observations this action needs.
- `satisfiedRuleIds`: observations that are present and fresh.
- `missingRuleIds` and `staleRuleIds`.
- `nextObservationTools`: exact tools to run before retrying.
- Findings with blocker/warning labels, details, and fixes.

This gives the app a concrete gate for "can this agent click/type/fill/drag/submit/deploy now?" instead of relying on model self-discipline.

## Next-Step Recommender

The grounding layer now includes `recommendComputerAppGroundingNextStep`, which converts the plan, observations, candidate action, action history, and verification state into a concrete runtime decision:

- `observe`: run the next missing or stale observation tool.
- `request_approval`: stage the action and ask the user before side effects.
- `act`: execute one grounded action.
- `verify`: verify the last successful action before continuing.
- `recover`: stop retrying repeated failures and switch to the fallback chain.
- `stop`: report a blocker instead of pretending the task ran.

This is the runtime policy bridge between the planner and actual browser/desktop tools.

## Trace Contract

The grounding layer now includes `buildComputerAppGroundingTrace`, a compact state object for Office, chat, and run ledgers:

- `status`: not_applicable, needs_observation, needs_approval, ready_to_act, needs_verification, recovering, blocked, or complete.
- `observationFreshness`: each rule, latest observation id, age, freshness target, and fresh/stale/missing state.
- `audit`: blocker/warning findings from action readiness and grounding rules.
- `nextStep`: the immediate observe/approval/act/verify/recover/stop recommendation.
- `display`: title, summary, badges, blockers, and next action for UI rendering.
- `persistenceTargets`: run metadata, Office ledger, chat trace, and computer trace artifact.

This trace is what the UI should render for "why the agent did or did not click/type/fill right now."

## Receipt Contract

Every computer/app run should emit receipts with:

- `phase`: observe, act, verify, approval, recover, or stop.
- `surface`: browser, desktop, vault, terminal, file, code, approval, or system.
- `tool/action`: the concrete tool or human-readable action.
- `beforeObservation`: required before any mutating action.
- `result` and `afterObservation`: required after successful actions.
- `verification`: proof that the requested state changed or was captured.
- `status` and `stopReason`: required when blocked, failed, skipped, or stopped.

The receipt audit blocks:

- Blind click/type/drag/submit/deploy actions when the selected strategy allows zero blind actions.
- Repeating the same failed action twice without re-observing or switching to recovery.
- Failed or blocked receipts that do not explain the stop reason.

## Research-Derived Principles

- Use semantic UI state before coordinates. Microsoft UI Automation describes control patterns as behavior-level interfaces independent of visual appearance; that maps directly to using accessibility trees before screenshots or mouse coordinates.
- Use screenshots for visual/canvas workflows and verification, not as the first tool for every task.
- Keep tool execution outside the model and feed observations back into the loop, matching Anthropic's computer-use loop.
- Treat browser locators/DOM state as the stable path for web tasks; Playwright guidance similarly emphasizes resilient locators and web-first assertions.
- For creative layout applications, treat scriptable document object models as the semantic surface. InDesign layers, text frames, links, exports, and package checks should be inspected through app-native tools before a11y/menu actions, and before any coordinate action.
- Stop for CAPTCHA, MFA, OTP, bot checks, payments, sends, publishing, deployment mutations, credential use, and destructive actions.

## Next Build Priorities

- Ship the next InDesign bridge tools: relink/replace placed assets, export proof PDFs/images, package handoff, and preflight issue summaries.
- Persist full strategy/preflight/grounding/receipt audit results into the database run ledger so Office can show why an agent did or did not act across refreshes and devices.
- Add an InDesign layer/object manifest artifact with layer names, locks, visibility, labels, text-frame ids, link ids, before/after copy, and output proof paths.
- Add UI for receipt timelines: before snapshot, action, after snapshot, confidence, and rollback note.
- Add reusable workflow templates from successful strategy traces.
- Add per-app adapters for Mail, Calendar, Slack, Finder, InDesign, Photoshop/Figma, VS Code/Cursor, CAD/engineering apps, and browser profiles.
- Add user-facing permission controls per strategy: read-only, draft-only, approve-every-action, or trusted-run.
