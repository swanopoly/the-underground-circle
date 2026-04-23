# Computer Use — Bringing "Personal Computer" Capabilities to the App

_Drafted 2026-04-20 after reading the current infrastructure and [Perplexity's Personal Computer blog post](https://www.perplexity.ai/hub/blog/personal-computer-is-here)._

## The goal

Let the user say, in natural language, things like:
- *"Research the top AI agent startups this year and summarize what's interesting"*
- *"Book me a flight to Tokyo next Friday, non-stop, under $800"*
- *"Find the top-rated espresso machines under $500 and save the list"*
- *"Log into my WordPress, write a post about today's product launch, schedule it for 9am tomorrow"*

…and have the agent autonomously browse, extract, fill forms, and report back to chat with screenshots + structured output.

## What already exists (good foundation)

From the audit:
- **Permission dialog** (`ComputerUsePermissionDialog.tsx`) — 3-level trust model (ask-every-action / ask-new-domains / trust-for-task) with intent-aware warnings
- **Planning layer** (`browserTaskIntent.ts`) — extracts mode / risk / required-login / allowed-domains / success criteria from natural language
- **Execution panel** (`ComputerUsePanel.tsx`) — live progress UI with screenshots, per-action status, approve/reject, pause/resume
- **Session drawer** (`BrowserSessionDrawer.tsx`) — history of past runs + link to live Browserbase session
- **Entry points** — `__COMPUTER_USE__` quick action, `/browser plan|open|extract` slash commands, natural-language intent detection
- **Two backend shells** — Playwright Bridge (`:7778`) and Browserbase Stagehand

## What's broken or missing (from audit)

1. **Native Anthropic `computer_use` tool is NOT implemented** — zero references to `computer_20250124` or any computer-use tool in edge functions or LLM callers. The app is doing everything by hand with regex + Playwright primitives.

2. **`scripts/stagehand-runner.mjs` doesn't exist** — `callStagehandRunner` at `computerUse.ts:570` shells out to a file that isn't there. Browserbase path silently fails.

3. **Playwright bridge's `/mcp` endpoint doesn't support browser tools** — every navigation / click / fill call returns 400. `/exec` is locked to 403 for security. Only screencapture works by luck.

4. **No autonomous multi-step execution** — every action requires per-step approval. No way to say "just go do it, report when done."

5. **No result synthesis back to chat** — results live in a drawer; chat never sees what the agent did or found.

6. **No persistence between invocations** — each `executePlan` starts a fresh browser. No remembered auth, no resumed tasks.

7. **No credential handling** — transactional tasks that require login fail at the login page.

## Design

### Phase 1 — Anthropic Computer Use agent (biggest leap)

New edge function: `supabase/functions/computer-use-agent/index.ts`

- Uses **Claude Opus 4.7 with the `computer_use` tool** in an agentic loop.
- Server runs the loop: user message → Claude proposes actions → we execute via Browserbase Stagehand → send screenshot back to Claude → repeat until `stop_reason: 'end_turn'`.
- Streams **SSE events** to the client:
  - `event: action` — Claude proposed a tool call (navigate, click, type, screenshot)
  - `event: screenshot` — after action, updated view
  - `event: reasoning` — Claude's intermediate thoughts
  - `event: result` — final synthesized answer + any artifacts
  - `event: error` — something failed
- Token / cost tracking to `claude_api_usage` table.
- Enforces safety: max iterations (20), max tokens budget (200K), timeout (5 min).

### Phase 2 — Browserbase Stagehand runner

Implement `scripts/stagehand-runner.mjs` so the Stagehand path actually works. Takes a base64-encoded JSON payload on stdin, executes the action on a Browserbase session, returns JSON with screenshot + currentUrl.

### Phase 3 — Chat integration

1. Natural-language browser intent — already detected via `detectConversationalIntent` and `analyzeBrowserTask`. Route these to the new edge function instead of the broken Playwright path.
2. Live progress in chat bubble — streaming events update an inline ComputerUsePanel card.
3. **Result synthesis back to chat** — when `event: result` fires, post a chat message with:
   - Concise summary
   - Key data extracted (prices, links, snippets)
   - Final screenshot thumbnail
   - "Open full session" link to Browserbase

### Phase 4 — Credential vault (deferred)

Per-circle credential storage for transactional tasks. Out of scope for v1 — user does manual auth during execution, or we trust pre-authenticated cookies in the Browserbase session.

### Phase 5 — Session persistence (deferred)

Named sessions that survive across calls. Out of scope for v1.

## Scope for this session

Ship Phase 1 (edge function) + Phase 2 (Stagehand runner) + enough of Phase 3 to route chat into the new flow and post results back. Phases 4-5 are follow-ups.

## Non-goals

- Not writing the Browserbase auth wizard UI (exists already; user points to integrations tab).
- Not building our own Playwright orchestrator when Browserbase already does this well at cloud scale.
- Not persisting browser sessions across days — session-scoped only for v1.
