# Browser Action Architecture Audit

Date: 2026-04-17

## Goal

Turn `Use Browser` from a prompt-driven novelty action into a durable browser execution substrate for chat, OpenSwan, tasks, and future agent workflows.

## Current Direction

The platform should treat browser execution as a typed workflow:

1. User asks for browser help in chat.
2. The app derives a structured browser intent.
3. Planning turns that intent into an executable action list.
4. Approval UI explains domains, risk, login likelihood, and side effects.
5. Execution records actions, screenshots, session links, and final outcome.
6. Results return to chat and run artifacts.

## Why This Shape

Official guidance from current browser-agent stacks is consistent:

- OpenAI computer use recommends a sandboxed environment, explicit allow/block lists, and human oversight when safety checks fire.
- Anthropic computer use frames the feature as screenshot-driven mouse and keyboard control, with beta caution around autonomy.
- Browserbase Stagehand positions the product around mixed-granularity browser agents and structured extraction, not only one-shot prompts.
- Playwright reliability comes from actionability checks and auto-waiting, so browser plans should prefer stable navigation and guarded actions.

## Long-Term Architecture

### 1. Intent Layer

Every browser request should resolve into a typed intent object with:

- objective
- mode: `read_only`, `extract`, `workflow`, `transactional`
- risk: `low`, `medium`, `high`
- requires login
- side effects
- allowed domains
- start URLs
- completion criteria
- expected output
- recommended permission posture

This keeps chat command parsing separate from actual browser execution.

### 2. Planning Layer

The planner should consume the intent object rather than raw text alone.

Short term:
- prompt planner with typed intent metadata
- keep browser actions narrow and executable

Medium term:
- add explicit extraction and assertion outcomes
- attach completion criteria to each plan
- attach preflight validation for domains, credentials, and missing inputs

### 3. Approval Layer

Approval should be driven by intent risk, not by a flat action list.

The approval UI should always show:

- domain scope
- risk level
- login likelihood
- whether the task can submit or mutate data
- recommended permission level
- what counts as completion

### 4. Execution Layer

The executor should remain backend-agnostic:

- local Playwright bridge for local and development workflows
- Browserbase Stagehand for hosted browser sessions

But both backends should emit the same first-class execution record:

- plan metadata
- session metadata
- action results
- screenshots
- live replay URL if available
- final status

### 5. Chat Command Routing

Natural-language chat requests should route like this:

- direct model answer when the task is answerable without live browsing
- browser planning when the user explicitly asks to use the browser or when a future command registry maps the request to browser execution
- OpenSwan runtime only when the user selected an OpenSwan mode or a future command explicitly requests it

This prevents normal chat from silently escalating into browser automation.

## Recommended Next Build Order

1. Introduce a unified chat command registry that can resolve browser-capable intents.
2. Add a browser task artifact type for extracted results, not only screenshots and session links.
3. Add domain allowlist enforcement during execution, not just in planning text.
4. Add login and submission checkpoints that require explicit human confirmation.
5. Add extraction and assertion action types once the runtime is ready to consume them.
6. Persist browser decision records on runs: intent, risk, permission, backend, domains, outcome.

## Reference Docs

- OpenAI computer use: https://platform.openai.com/docs/guides/tools-computer-use
- Anthropic computer use: https://docs.anthropic.com/en/docs/build-with-claude/computer-use
- Browserbase Stagehand: https://docs.browserbase.com/introduction/stagehand
- Playwright actionability and auto-waiting: https://playwright.dev/docs/actionability
