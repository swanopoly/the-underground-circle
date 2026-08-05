# Agentic Computer/App Automation Research Note

Date: 2026-05-29
Status: time-sensitive research note plus implementation standard pointer
Canonical agent doc: `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md`
App wiki article id: `agentic-computer-app-automation-for-agents`

## Summary

The strongest direction for Underground Circle chat-to-computer work is a
semantic, evidence-first automation ladder:

1. Classify the requested surface and risk before any action.
2. Observe the current browser, app, file, or desktop state before mutation.
3. Prefer official APIs, scripting/plugin surfaces, file adapters, semantic
   browser locators, and accessibility trees before visual coordinate fallback.
4. Require approval for writes, exports, credentials, destructive actions,
   billing risk, private files, unfamiliar apps, and semantic-to-coordinate
   fallback.
5. Return typed receipts, before/after proof, warnings, and recovery options.
6. Let connected code agents build missing adapters only under a bounded scope
   with source refs and smoke proof.

## Product Direction

The chat should decide whether a user request is normal conversation or a
computer/app task. When it is a computer/app task, it should choose the safest
available route from the app's existing pipelines. For an unfamiliar app, the
fallback is not blind clicking. The fallback is a bounded "build the adapter"
handoff to Codex, Claude Code, Cursor Composer, OpenCode, or a configured custom
agent with official source references and verification requirements.

This directly supports requests like:

- "Open this InDesign file and change the banner copy."
- "Update this Photoshop layer and export a PNG."
- "Check this AutoCAD drawing and adjust the title block."
- "Use this web app to submit the report."
- "This bridge failed; find a recovery path and give me options."

## Research Findings

- Anthropic's agent guidance favors simple, composable workflows first, then
  agents when flexible model-driven decisions are needed. It also emphasizes
  environmental ground truth, checkpoints, stopping conditions, and careful
  agent-computer interfaces.
- Anthropic's tool guidance says agents need tools designed for agent use, not
  thin API wrappers. The most useful tools have clear boundaries, meaningful
  context, namespacing, token-efficient responses, and evaluations grounded in
  real tasks.
- MCP tools are model-controlled, but the spec recommends human ability to deny
  invocations, visible tool exposure/invocation UI, structured outputs, input
  validation, access controls, rate limits, and sanitized outputs.
- NIST AI RMF gives the governance shape: map the context, measure risk, manage
  mitigations, and keep risk treatment visible.
- OWASP LLM and Agentic guidance makes prompt injection, goal hijacking, tool
  misuse, identity/privilege abuse, supply-chain issues, data exposure, and
  cascading failures core design concerns for autonomous systems.
- Playwright's locator and actionability guidance supports role/label/text
  locators, auto-waiting, retrying assertions, and avoiding brittle CSS/XPath
  chains where user-facing selectors exist.
- Microsoft UI Automation and Apple UI scripting both support the idea that
  desktop tasks should use semantic UI trees and control patterns before
  low-level pointer actions.
- Adobe InDesign and Photoshop should prefer UXP/script/plugin APIs for
  document, layer, export, and text-frame work before falling back to desktop UI
  automation.

## Implementation Standard

The canonical standard is now `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md`.
Agents should use it whenever work touches browser automation, desktop bridge
behavior, local-file automation, native app adapters, Adobe/CAD workflows,
computer-task recovery, or connected-agent adapter buildout.

The typed registry entry is `computer_app_automation` in
`src/lib/agentDevelopmentStandards.ts`. It should route prompts that mention
browser automation, desktop app control, Photoshop, InDesign, AutoCAD, CAD,
uploaded files, bridge recovery, or app adapter buildout to this guide.

The concrete route helper is `src/lib/appAutomationControlSurfaces.ts`.
`buildAppAutomationControlSurfacePlan(task)` builds the official-source ladder.
`buildAppAutomationRouteDecision(task, options)` gates the next action as
`ready_to_execute`, `needs_observation`, `needs_approval`,
`needs_user_action`, or `needs_connected_agent_buildout`. Agents should pass
`formatAppAutomationRouteDecisionPromptBlock(decision)` into connected-agent
handoffs so the retry path preserves the chosen surface, skipped stronger
surfaces, missing evidence, approval blockers, source refs, and verification
requirements.
`src/lib/computerTaskEvidenceRecovery.ts` now accepts that same route decision
when a browser/desktop/app run fails. `needs_observation` becomes required
fresh evidence, `needs_approval` becomes an approval-boundary recovery,
`needs_user_action` blocks retry until the user clears the blocker, and
`needs_connected_agent_buildout` routes to bounded connected-agent adapter
repair with focused-smoke proof before retry.

## Source List

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
- Playwright actionability:
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
