# Agentic Computer/App Automation Guide

**Last researched:** 2026-05-29
**Implementation sync:** 2026-08-05

This guide is the standard for agents building or reviewing browser, desktop,
local-file, and native-app automation in The Underground Circle. Use it when a
chat request should operate another app, a browser, an uploaded file, a desktop
bridge, Adobe Creative Cloud, CAD/engineering software, or an unfamiliar local
tool.

Read it with:

- `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md` for task routing.
- `docs/CODING_AGENT_BEST_PRACTICES.md` for code quality, security, testing,
  and handoff.
- `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` for boundary parsing and typed
  runtime results.
- `docs/DESIGN_AGENT_BEST_PRACTICES.md` for approvals, recovery, proof, and
  quiet user-facing automation UI.
- `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md` for bridge/MCP/OpenSwan tool
  schemas, structured results, redaction, recovery contracts, and evals.
- `docs/UC_STYLE_GUIDE.md` for local visual tokens.

## Core Standard

Computer and app automation is not a free-form click bot. A good automation
path is:

- Classified by surface before action: browser, desktop, file, app API, cloud
  API, or hybrid.
- Grounded in observed state before it mutates anything.
- Routed through the most deterministic control surface available.
- Approval-gated for writes, exports, billing, credentials, private files, and
  destructive actions.
- Verified with before/after evidence and typed receipts.
- Recoverable through structured options when it fails.
- Quiet in chat unless the user needs to approve, unblock, choose, or inspect
  proof.

## Research Basis

Current primary guidance supports this direction:

- Anthropic recommends the simplest useful agentic architecture first, then
  adding autonomy only when it improves outcomes. It also calls out ground truth
  from the environment, checkpoints, stopping conditions, and careful
  agent-computer interfaces.
- Anthropic's tool-design guidance treats tools as contracts for
  non-deterministic agents. It emphasizes real evaluations, clear tool
  boundaries, namespacing, meaningful context, and token-efficient responses.
- MCP tool guidance makes tool exposure visible, keeps a human able to deny
  invocations, validates structured outputs, and requires servers to validate
  inputs, enforce access control, rate-limit, and sanitize outputs.
- NIST AI RMF frames this as risk management: map the context, measure risk,
  manage mitigations, and keep governance visible.
- OWASP LLM and Agentic guidance highlights prompt injection, goal hijacking,
  tool misuse, identity/privilege abuse, data disclosure, supply-chain risk, and
  cascading failures as first-order risks for autonomous tool-using systems.
- Playwright, Chrome DevTools Protocol, Apple UI scripting, and Microsoft UI
  Automation all point toward semantic state, locators, actionability checks,
  and structured control surfaces before coordinate-level fallback.
- Adobe InDesign and Photoshop UXP documentation confirms that Adobe tasks
  should prefer script/plugin APIs for document and layer operations before
  accessibility or pointer fallback.

## Surface Ladder

Pick the highest reliable surface that can complete the user request:

| Surface | Use First When | Requirements | Fallback |
|---|---|---|---|
| Product API or file format adapter | The app exposes a stable API, SDK, script runtime, or parseable file format | Official docs, typed adapter, dry-run or preview when possible | Native app script bridge |
| Native app scripting/plugin API | Adobe, CAD, IDE, office, or design tool exposes scripts/plugins/macros | App installed, version known, document open or upload approved | Accessibility tree/menu automation |
| Browser automation | The task is on a website or web app | Playwright/Browserbase/bridge route, semantic locators, actionability checks | CDP inspection or guarded visual fallback |
| Desktop accessibility automation | App lacks an API but exposes UI elements | Observed app/window/tree, target confidence, user approval for writes | Coordinate/pointer fallback |
| Coordinate/pointer fallback | No semantic surface exists and the task is low risk or approved | Screenshot, target bounds, retry limit, stop condition | Ask user or build adapter |
| Connected-agent adapter buildout | No safe path exists yet | Bounded implementation scope, official source refs, smoke proof | Stop with recovery options |

Never start with coordinates when a semantic API, script command, locator, or
accessibility element exists.

## Typed Route Decision Helper

`src/lib/appAutomationControlSurfaces.ts` is the pure helper for converting the
research ladder into a machine-checkable route decision.

Use `buildAppAutomationRouteDecision(task, options)` before a desktop, browser,
Adobe, CAD, or unfamiliar-app action mutates anything. It returns:

- `status`: `ready_to_execute`, `needs_observation`, `needs_approval`,
  `needs_user_action`, or `needs_connected_agent_buildout`.
- `chosenSurface`: the highest available deterministic control surface.
- `skippedSurfaces`: stronger surfaces that were unavailable or blocked.
- `missingConfirmations`: install/version/document/window/locator/permission
  checks that still need fresh evidence.
- `missingApprovals`: writes, exports, uploads, scripts, destructive edits, or
  coordinate fallbacks that need approval first.
- `score`, `sourceRefs`, `verification`, `failSafeRules`, and `nextSteps`.

Use `formatAppAutomationRouteDecisionPromptBlock(decision)` when handing the
decision to OpenSwan, SwanBot, Codex, Claude Code, Cursor Composer, or a custom
agent. The prompt block keeps the user-facing chat quiet while preserving the
chosen surface, blockers, official refs, proof requirements, and bounded next
step for the runtime.

`chatComputerRequestRouter` includes the decision in the hidden chat computer
route prompt. `computerAppPreflight` includes the same decision before computer
task dispatch, and turns `needs_observation`, `needs_approval`,
`needs_user_action`, and `needs_connected_agent_buildout` into preflight
warnings or blockers. `chatComputerHandoffContext` and
`persistedChatMetadata` keep a compact route-decision summary so recovery and
refresh paths can act on the same status without parsing prompt text.
`computerTaskEvidenceRecovery` consumes the same decision after a blocked or
failed run: missing confirmations become fresh-evidence requirements, missing
approvals become approval boundaries, user-action blockers stop retries, and
connected-agent buildout decisions become bounded adapter-repair options.

If the status is not `ready_to_execute`, do not take the action. Re-observe,
request approval, ask the user to unblock the app/permission, or request a
connected-agent buildout according to the returned `nextSteps`.

### Generic Semantic Workflow

`src/lib/genericAppNavigator.ts` owns unfamiliar-app decomposition through
`buildGenericAppSemanticWorkflow(task)`. Preserve the user's exact request as
`originalRequest`; classify only a normalized copy. The schema emits at most
ten ordered checkpoints, reserves the last checkpoint for verification, and
names goals, observation requirements, allowed semantic surfaces, mutation
class, approval class, expected postcondition, and a buildout/stop rule.

This workflow is semantic by construction. Its allowed surfaces are existing
adapters, lifecycle controls, app-native APIs/scripts, documented file
adapters, embedded DOM/CDP, accessibility, semantic menus, and verified
shortcuts. It never emits coordinates, guessed selectors, guessed menu paths,
or pointer targets. Coordinate fallback remains a separate, higher-risk route
that needs fresh visual target evidence and exact approval; it cannot inherit
authority from the semantic workflow.

Use one bounded workflow review for named, reversible, non-secret field,
menu, and toggle checkpoints so the user is not prompted once per control.
That review is planning authority, not a raw bridge pass: each dispatched
mutation still needs its canonical exact-call receipt and same-target proof.
Persistent file writes, external sends/submissions, destructive actions,
credentials, permission grants, payments, and ambiguous choices keep their
own exact approval or user-choice floor.

## Runtime Rules

### 1. Classify Before Acting

Every request should produce a typed route before execution:

- `surface`: browser, desktop, file, app_api, cloud_api, accessibility, hybrid,
  or unknown.
- `appFamily`: Adobe, CAD, browser, office, code editor, terminal, website,
  generic native app, or custom.
- `risk`: read-only, write, export, destructive, billing, credential, privacy,
  or unknown.
- `requiresApproval`: true for persistent writes, exports, destructive work,
  credential access, billing risk, private files, unfamiliar apps, and
  low-confidence targets. A current direct user command may authorize one
  compiler-owned, bounded, reversible unsaved scratch artifact only when its
  closed-world tool program has no source-file, save, export, overwrite,
  delete, external, credential, or generic-UI action.
- `evidencePlan`: before state, action receipts, after state, output files, and
  user-visible proof.

### 2. Observe State Before Action

Automation code must observe the current surface before mutating it:

- Browser: URL, title, visible controls, role/label locators, selected frame,
  network/auth blockers, and current error banners.
- Desktop: app name, active window, accessibility tree or screenshot, blocking
  modals, permissions, file-open state, and target confidence.
- File/app: file type, parser confidence, app compatibility, backup/export
  target, and whether the app is already open.

If observation fails, the next result should be a blocker with recovery options,
not a blind retry.

Browser DOM observation must minimize data before it leaves the local bridge.
Never return any editable control value. Do not let hidden, inert, script,
style, template, or noscript descendants reappear through an ancestor label;
canonicalize bounded roles and keep only controlled field kind/state/length
when that structure helps grounding. Bind tree/title to one coherent
entry/capture/exit process/context/page/exact-URL observation. Expose only an
HTTP(S) origin to the model and use a process-scoped opaque HMAC URL identity
for exact read-only drift checks. Raw/forged URL identities and non-HTTP
snapshots fail closed. That evidence is not approval or mutation target
authority, and it must rotate across bridge restart or document navigation.

For generic native input, an observation is authority only for one exact
frontmost app process and surface. Require `appName` from the live
`desktop.window_state` or `desktop.observe_app` result; never infer it from the
task text. Bind exact normalized arguments plus app/PID/surface into approval,
then collect another fresh observation at one-shot handler entry before the
durable dispatch claim. Keep the approval digest stable across those two
observations only when exact args, PID, and surface remain unchanged. Any PID,
surface, argument, TTL, cloned-guard, or replay drift must stop before mutation.
Coordinate and mouse actions additionally require both fresh screen bounds and
a visible window belonging to the exact target app; screen bounds alone are
never target authority.

`desktop.set_element_value` is the dedicated sealed non-secret field lane. It
requires an authenticated persisted run plus exact provider tool-call identity,
then binds the fresh frontmost app, positive PID, accessibility generation,
dotted path, role, label, exact current-value hash/length, and requested-value
hash/length into a short-lived one-shot target. The raw value and dotted path
remain transient. A genuine exact-call approval receipt is required before one
AX set-value dispatch, and completion requires a newer observation of the same
field with the exact requested hash and length. Secure, credential, payment,
permission, destructive, modal, ambiguous, stale, and coordinate-fallback
targets fail closed.

Read/observe actions require no mutation approval. Exact
`desktop.launch_app`/`desktop.focus_app` also avoid a redundant approval only
when they run through an authenticated persisted call with an exact provider
tool-use identity and fresh bounded before/after proof. Launch must prove the
exact app is running; focus must prove it is running and frontmost. A bridge
acknowledgement is never completion, and this policy does not authorize a
browser target inside a desktop-app-only execution profile.

If any mutation may have reached its handler but independent after-state is
missing, record `outcome_unknown`, disable automatic replay, and permit only
fresh read-only verification before proposing a new action.

### 3. Use Deterministic Control Surfaces

Prefer control surfaces in this order:

1. Official app API, SDK, script, plugin, or documented file format.
2. Existing repo adapter or runbook for the app family.
3. Browser semantic locators, CDP state, or Browserbase tools.
4. Desktop accessibility tree and menu commands.
5. Screenshot-guided pointer actions with a small retry cap.
6. Connected-agent buildout of a missing adapter.

For Photoshop and InDesign, prefer Adobe UXP/script APIs for layer, document,
export, and text-frame changes. Use UI automation only when the API cannot
reach the feature or when the user explicitly asks for interactive app control.

An execution profile is a hard surface ceiling. A desktop-app-only run must not
advertise or dispatch browser tools, URL opening, generic tool discovery, or a
desktop launch/focus/window-raise call whose app argument names a browser. Use a
browser or hybrid profile only when the router deliberately selected that
surface. Enforce this both while building the catalog and immediately before
dispatch so injected or stale tool calls cannot cross the boundary.

Do not use `launchctl submit` for a one-shot foreground or accessibility proof.
macOS treats a submitted short-lived command as an inferred keepalive job, so a
test that activates an app can relaunch indefinitely after the test finishes.
Run bounded proof commands in the current process, or use an explicitly managed
job with keepalive disabled and an unconditional exact-label `bootout` cleanup.
Before handing off a live GUI test, verify that no task-scoped launch job remains.

### 4. Approval Gates

Approval gates are required for:

- Writing or overwriting local files.
- Changing existing native app documents, layers, canvases, CAD models, or
  browser data. Exception: one compiler-owned new unsaved blank scratch
  document may use the current direct request when the dimensions are within
  the program's conservative resource bound and before/after app-native proof
  is mandatory.
- Exports, uploads, downloads, publishing, sending messages, or submitting
  forms.
- Credential access, OAuth scopes, API keys, private paths, or billing.
- Installing tools, running shell commands, or launching connected agents that
  may make changes.
- Any fallback from semantic automation to coordinate or visual actions.

Pure reads and observations do not need mutation approval. Exact app
launch/focus is the narrow reversible lifecycle exception described above.
Named non-secret reversible field/menu/toggle work may share one bounded
workflow review, but the dispatch runtime must still issue and consume its
exact-call receipt. Persistent, external, destructive, credential, payment,
permission, private-file, and ambiguous actions may never inherit either
exception.

The approval payload should say what will change, which app/file/site is in
scope, what proof will be captured, and how the user can stop or inspect.

### 5. Evidence Contract

Every completed app automation task should return:

- `before`: enough state to prove the target was identified correctly.
- `actions`: compact, typed receipts for tool calls or app commands.
- `after`: screenshot, export, document metadata, diff, parsed file summary, or
  visible state confirming the requested change.
- `output`: saved/exported file paths only when safe to show, plus redacted
  metadata for chat.
- `warnings`: anything the agent could not verify.

Never claim completion from a tool call alone. Completion requires observed
after-state or a clear "manual verification required" result.
`outcome_unknown` means the effect may have landed: do not replay it, do not
offer a normal retry, and do not convert later model prose into completion.

### 6. Fail Safe With Recovery Options

Failures should be typed and actionable:

- Pass the app route decision into evidence recovery so the failure options are
  based on the same `ready_to_execute` / `needs_observation` /
  `needs_approval` / `needs_user_action` /
  `needs_connected_agent_buildout` state used during preflight.
- If a legacy or indirect computer-use failure did not pass an explicit
  evidence contract, `chatFailureRecovery` should infer the chat computer route
  from the task text plus execution/source context and use that route's evidence
  contract before falling back to generic recovery.
- `retry_with_fresh_evidence`: re-observe the browser/app/file and retry within
  the same approval scope.
- `repair_or_start_bridge`: start, reconnect, or diagnose the local bridge.
- `request_user_unblock`: ask for MFA, permissions, app install, file access, or
  manual focus only when required.
- `switch_surface`: move from browser to desktop, app API to accessibility, or
  cloud API to local app when safer.
- `connected_agent_buildout`: ask Codex, Claude Code, Cursor Composer,
  OpenCode, or a configured custom agent to build the missing adapter under a
  bounded scope.
- `stop_show_details`: stop without retry and keep details available.

Do not loop endlessly. Each option needs a retry cap, actor, safety mode, and
stop condition.

### 7. Connected-Agent Buildout

When the chat lacks a pipeline for an unfamiliar app, it may ask a connected
agent to build one. The handoff must include:

- The user task and target app/file.
- The chosen control-surface hypothesis.
- Official source references that must be checked.
- Allowed files/modules to edit.
- Required smoke or fixture proof.
- A retry plan that is not marked ready until evidence exists.
- A stop condition for missing docs, app absence, unavailable credentials, or
  unsafe permissions.

The connected agent should build a narrow adapter, smoke it, then return a
structured result. Chat can retry only when the result includes source refs,
verification, and a safe execution plan.

### 8. User Experience Rules

Chat should show only what the user needs:

- Show compact route, app/file, approval, blocker, recovery, and proof summaries.
- Hide stack traces, raw prompts, local paths, and run metadata behind details.
- Keep successful low-risk routing quiet unless proof is useful.
- Make recovery options selectable so the user does not rewrite failure
  context.
- Keep technical proof available for audit without turning the main chat into a
  debug console.

### 9. Security And Privacy

- Treat app state, screenshots, uploaded files, OCR text, browser DOM, provider
  output, and bridge responses as untrusted.
- Sanitize tool outputs before they reach prompts, logs, receipts, or chat.
- Redact secrets, private paths, personal data, tokens, and credential-bearing
  headers.
- Use least privilege grants by app, site, file scope, command, and time window.
- Fail closed for untrusted MCP/tool annotations, unexpected tool lists,
  malformed outputs, and route mismatches.
- For generic native input, bind each adjacent mutation to a fresh transient
  frontmost app/PID/CGWindowID/bounds guard. Revalidate inside the native input
  process, keep pointer coordinates inside that window, require exact release
  and scroll coordinates, and never persist or expose the raw guard.
- Keep a human approval path for high-impact or destructive tool invocations.

## Verification Matrix

| Change Type | Expected Verification |
|---|---|
| Standards/wiki only | `npm run smoke:agent-standards-wiki`, `npm run typecheck:app`, `git diff --check` |
| Chat computer routing | `npm run smoke:chat-computer-request-router`, `npm run typecheck:app`, `git diff --check` |
| App control surfaces | `npm run smoke:app-automation-control-surfaces`, app-family smoke, `npm run typecheck:app` |
| Evidence contracts | `npm run smoke:computer-task-evidence-contract`, relevant route smoke, `npm run typecheck:app` |
| Desktop bridge or recovery | Desktop/bridge smoke, negative-path recovery smoke, `npm run typecheck:app` |
| New app adapter | Fixture or dry-run smoke, official source refs, approval-path smoke, typecheck, `git diff --check` |
| Generic unfamiliar-app workflow | `npm run smoke:generic-app-navigator`, `npm run smoke:universal-app-task-eval`, `npm run smoke:computer-app-execution-surface-guard`, router/runtime smoke, `npm run typecheck:app` |
| Native semantic field value | `npm run smoke:native-semantic-value-runtime`, `npm run smoke:computer-app-grounding`, approval/runtime smoke, `npm run typecheck:app` |

The generic workflow and native semantic-value entries above are source and
contract validation. The universal corpus currently covers 160 requests and
7,417 assertions, including native app, local file, browser, persistent,
external, credential, and destructive boundaries. It does not prove a live
arbitrary-app GUI run, deployed
edge parity, database contention, or universal completion across every app.

## Sources To Recheck

- Anthropic, Building effective agents:
  https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, Writing effective tools for agents:
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Model Context Protocol tools specification:
  https://modelcontextprotocol.io/docs/concepts/tools
- NIST AI Risk Management Framework:
  https://www.nist.gov/itl/ai-risk-management-framework
- OWASP Top 10 for LLM Applications 2025:
  https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- OWASP Top 10 for Agentic Applications 2026:
  https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- Playwright locators:
  https://playwright.dev/docs/locators
- Playwright actionability and auto-waiting:
  https://playwright.dev/docs/actionability
- Chrome DevTools Protocol:
  https://chromedevtools.github.io/devtools-protocol/
- Apple UI scripting guide:
  https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html
- Microsoft UI Automation Specification:
  https://learn.microsoft.com/en-us/windows/win32/winauto/ui-automation-specification
- Adobe InDesign UXP scripts:
  https://developer.adobe.com/indesign/uxp/scripts/
- Adobe Photoshop UXP documentation:
  https://developer.adobe.com/photoshop/uxp/2022/
