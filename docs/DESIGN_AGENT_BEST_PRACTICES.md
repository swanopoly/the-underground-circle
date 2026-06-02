# Design Agent Best Practices

**Last researched:** 2026-05-28

This guide is the broader product and interface design standard for agents. It
complements:

- `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md` for task-based routing across
  coding, TypeScript, design, and web-page standards.
- `docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md` for web page structure,
  responsiveness, accessibility, and performance.
- `docs/UC_STYLE_GUIDE.md` for local UC color, typography, radius, button,
  card, input, and dark-mode tokens.

Use this guide when designing screens, flows, dashboards, chat surfaces,
automation consoles, agent recovery UI, wiki pages, forms, approval cards,
desktop/browser task cards, and developer-facing tools.

## Product Design Standard

Good product design here means:

- The user can tell what state they are in.
- The next useful action is obvious.
- Risk, approvals, blockers, and proof are visible at the right time.
- The UI supports repeated work, not just first-time discovery.
- Visual style serves task clarity.
- Accessibility and responsive behavior are designed from the start.
- The implementation can be maintained with local tokens and reusable patterns.

## Start With The User Job

Before creating UI, write the job in one sentence:

> The user needs to ___ so they can ___.

Then define:

- Primary actor: user, agent, connected agent, bridge, browser, app, provider.
- Primary object: chat message, file, app task, design asset, run, approval,
  wiki article, memory, provider, or automation.
- Primary action: create, review, approve, retry, inspect, edit, export,
  connect, recover, or compare.
- Proof of completion: saved state, receipt, screenshot, file, export, run
  status, or visible UI change.
- Failure path: retry, recover, ask user, switch route, stop, or show details.

## Flow Design

- Put the primary workflow on the first useful screen.
- Use progressive disclosure for details, debug data, and advanced controls.
- Keep low-risk read-only tasks lightweight.
- Escalate high-risk, destructive, billing, credential, or external-app actions
  to stronger approval UI.
- Preserve user context after errors. Do not make them re-enter long prompts or
  form data after a recoverable failure.
- For AI actions, show the user what the agent will do, what it needs, what it
  changed, and what proof exists.

## Design System Rules

- Use semantic tokens and existing components before hard-coded one-off styles.
- Keep states complete: default, hover, pressed, focused, selected, disabled,
  loading, empty, error, success, warning, and permission-required.
- Prefer component variants over duplicated components.
- Keep spacing, radius, typography, and color consistent with
  `docs/UC_STYLE_GUIDE.md`.
- Do not create a new visual language for a single feature unless the product
  asks for a clearly distinct mode, such as a code console.
- If a design-system token is missing, add it intentionally and document why.

## UX Writing

- Use labels that describe outcomes, not implementation.
- Keep button text short and action-oriented.
- For risky actions, name the consequence.
- For errors, explain what happened and what the user can do next.
- Do not fill the UI with instructions for obvious controls.
- Use technical details only where the user is choosing a technical path or has
  opened a details/debug view.

## AI And Automation UX

AI task UI should expose enough structure for trust without flooding the user.

- Show compact route, approval, blocker, and proof summaries.
- Hide raw prompts, local paths, run metadata, and stack traces unless the user
  asks to inspect details.
- Let recovery options be selectable instead of asking the user to rewrite
  failure context.
- Make connected-agent handoffs explicit: actor, scope, retry limit, and stop
  condition.
- Keep task cards stable while agent state changes so the layout does not jump.
- Use receipts and before/after evidence for file, app, browser, and design
  automation.

## Visual QA Checklist

Before handoff, verify:

- The first screen communicates state, purpose, and primary action.
- The screen works at mobile, tablet, desktop, and wide desktop widths.
- Text wraps without overlap at long labels and browser zoom.
- Keyboard focus is visible and ordered.
- Color is not the only state indicator.
- Loading and empty states are useful.
- Error states preserve context and offer recovery.
- Destructive or external actions are separated from routine actions.
- The palette, radius, typography, and cards match the local style guide.

## Design Review Checklist

Flag these issues during review:

- A visually polished screen that hides the actual workflow.
- Inconsistent terminology for the same object or action.
- Missing error, empty, loading, disabled, or permission states.
- Controls that change position when state changes.
- Developer/debug details shown as the default user experience.
- A new component or style that duplicates an existing pattern.
- Ambiguous destructive actions.
- UI that asks the user to infer what the agent did instead of showing proof.
- Designs that cannot be implemented with accessible semantic structure.

## Sources To Recheck

- [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
  for interaction review.
- [Figma components, styles, and shared library best practices](https://www.figma.com/best-practices/components-styles-and-shared-libraries/)
  for reusable component thinking.
- [Figma variables guide](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
  for token and mode workflows.
- [Figma design tokens](https://www.figma.com/resource-library/design-tokens/)
  for design-to-code token structure.
- [Material Design accessibility](https://m3.material.io/foundations/accessible-design/overview)
  for accessible product UI foundations.
- [W3C WAI design tips](https://www.w3.org/WAI/tips/designing/) for accessible
  design basics.
