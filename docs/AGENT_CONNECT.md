# Agent Connect — What's Actually Real

This doc is for an external coding agent (Claude Code, Codex, Cursor, or a
generic MCP/HTTP client) that lands on The Underground Circle repo and needs
to know: what this project is, how to connect to it today, and which parts of
the "connect" surface are real versus still aspirational.

Every claim below was verified by reading the current source, not copied from
planning docs. File:line references are called out so you can re-check them
yourself. Where something is planned but not built, it is labeled
**PLANNED — NOT YET IMPLEMENTED**.

## What The Underground Circle is

The Underground Circle is a shared AI-agent accountability workspace for
small dev teams. The core loop is: connect a repo/providers, plan and run
work in Chat/Office/Feed, let agents execute with tools, and make proof,
activity, memory, and follow-up visible to the team. It is built on Expo/React
Native (web + native), Supabase (Auth/Postgres/Realtime/Edge Functions), and a
BlackSwan/OpenSwan agent runtime, with Claude Code/Codex/Cursor bridges and
Browserbase computer use as the automation layer. See the repo's `CLAUDE.md`
("Product" section) for the full framing.

There are, in practice, **three separate connect surfaces** in this repo.
They are not unified yet:

1. **Local desktop bridges** (`scripts/claude-bridge.js`,
   `scripts/codex-bridge.js`, `scripts/cursor-bridge.js`,
   `scripts/gemini-bridge.js`) — HTTP servers on fixed localhost ports that
   let the UC web/native app see and drive locally-running CLI agent
   sessions.
2. **A generic chat-dispatch fallback** for agents that don't have a
   dedicated bridge (`src/lib/customAgentBridgeDispatcher.ts`) — tries a
   fixed list of POST paths against a user-supplied gateway URL.
3. **A cloud presence/heartbeat channel** (`scripts/mcp-agent-connect.js` +
   `supabase/functions/agent-connect/index.ts`) — a stdio MCP server that
   reports "this agent is alive and doing X" to a circle's activity feed.

There is also a separate, narrower "Office custom agent" connect contract
documented in `docs/CUSTOM_AGENT_BRIDGE.md` (`GET /health` minimum, optional
`POST /tools/invoke` OpenSwan-RPC rich contract). That is a fourth, distinct
surface from the three above — see that doc for its details; this doc does
not duplicate it.

## 1. Connecting a local coding agent today (Claude Code, Codex, Cursor, Gemini CLI)

Each of these agents has a dedicated, zero-npm-dependency Node HTTP bridge
script that you run locally, next to your CLI session:

| Agent | Bridge script | Port | Start command |
|---|---|---|---|
| Claude Code | `scripts/claude-bridge.js` | `7778` | `npm run bridge` |
| Codex | `scripts/codex-bridge.js` | `7779` | `npm run bridge:codex` |
| Gemini CLI | `scripts/gemini-bridge.js` | `7780` | `npm run bridge:gemini` |
| Cursor | `scripts/cursor-bridge.js` | `7781` | `npm run bridge:cursor` |

(Ports: `src/lib/bridgeTaskDispatcher.ts:12-19`; start commands:
`package.json` `scripts` block, `bridge`/`bridge:codex`/`bridge:cursor`/
`bridge:gemini` entries.)

Each bridge scans local state (Claude Code's `~/.claude/projects/*.jsonl`
transcripts, Codex/Cursor session logs, etc.) on an interval and exposes it
over plain HTTP. All four expose at least:

- `GET /health` — reachability + capability probe, unauthenticated
  (`scripts/claude-bridge.js:902`, `scripts/codex-bridge.js:636`,
  `scripts/cursor-bridge.js:553`).
- `POST /pair` (Claude Code: `POST /desktop/pair`) — one-time, unauthenticated
  local exchange that returns a shared secret token
  (`scripts/claude-bridge.js:2350-2354`, `scripts/codex-bridge.js:647-654`).
- `GET /sessions` — list of detected/registered agent sessions, token-gated
  on Codex/Cursor.
- `POST /launch` — start a new managed terminal session with a prompt.
- `POST /terminal/send` — send a follow-up message into an existing managed
  session.

**Auth**: all four bridges share one token, generated on first pairing and
persisted at `~/.uc-desktop-token` on the machine running the bridge
(`scripts/codex-bridge.js:48-68`; comment header of
`src/lib/bridgeAuth.ts:1-20` documents the same file for Claude Code's
bridge). The UC app caches it in `localStorage` under
`uc_desktop_bridge_token_v1` after pairing
(`src/lib/bridgeAuth.ts:23-49`) and sends it back as the
`X-UC-Desktop-Token` header on every subsequent authenticated call
(`src/lib/bridgeAuth.ts:105-108`). There is no per-user or per-circle
scoping of this token — it is a single shared local-machine secret. Anyone
with access to the bridge's localhost port (or the token file) can drive it.

**What actually happens when connected**: the UC app polls `GET /sessions`
and `GET /health` to show the agent as online in Office, and can call
`POST /launch` / `POST /terminal/send` to start or message a managed
terminal session running the real CLI (`claude`, `codex`, `cursor-agent`,
etc.) on your machine. For Claude Code specifically, `POST /launch` and
`POST /terminal/send` are hard-gated behind an opt-in billing flag
(`EXPO_PUBLIC_ALLOW_CLAUDE_CODE_BILLING=true` or
`EXPO_PUBLIC_ALLOW_CLAUDE_BRIDGE_BILLING=true`) — without it the bridge
returns a "disabled to prevent Anthropic charges" error instead of running
anything (`src/lib/bridgeTaskDispatcher.ts:26-38`,
`scripts/claude-bridge.js:922-926`).

`src/lib/bridgeEnvironment.ts` governs whether the app even tries to reach
these ports: in a dev/localhost session or a native app build it probes them
by default; on production web (`app.chrisswanson.xyz`) it does **not** probe
localhost ports unless the user explicitly opts in
(`window.localStorage['uc_force_bridges'] = '1'`) or an operator points at a
tunneled/reverse-proxied URL via `EXPO_PUBLIC_BRIDGE_HOST` /
`EXPO_PUBLIC_*_BRIDGE_URL` env vars (`src/lib/bridgeEnvironment.ts:60-132`).

`src/lib/chatAgentTargets.ts` is what turns "a bridge is reachable" into a
selectable chat target: it builds a merged list of connected agents plus
preset placeholders (OpenSwan, Cursor, Claude Code, OpenCode, Codex, Gemini,
Aider, Cline, Windsurf, Copilot, Continue, Amp, and a generic "Custom Agent"
catch-all), each with a `setupHint` string telling the user which bridge
command to run (`src/lib/chatAgentTargets.ts:50-168`). This is a UI/labeling
layer, not a second transport — actual dispatch still goes through
`bridgeTaskDispatcher.ts` (dedicated bridges) or
`customAgentBridgeDispatcher.ts` (generic fallback, below).

## 2. The generic-agent HTTP contract, as it actually exists today

For agents without one of the four dedicated bridges above — OpenCode,
Aider, Cline, Windsurf, Copilot, Continue, Amp, or any other
`generic-agent`-provider connection — chat dispatch goes through
`src/lib/customAgentBridgeDispatcher.ts`. The real contract is:

- A **fixed, ordered list of POST-only paths** is tried against the
  connection's `gatewayUrl`, in this order:
  `/task`, `/tasks`, `/message`, `/chat`, `/run`
  (`src/lib/customAgentBridgeDispatcher.ts:23`).
- Each attempt POSTs the same JSON body — a task/message/prompt string
  triple, plus `originalTask`, `agentName`, `provider`, optional `model`,
  optional `sessionId`, optional `circleId`, and `source:
  "underground-circle-chat"` — with `Content-Type: application/json`,
  `Authorization: Bearer <token>`, `X-UC-Agent-Token`, and
  `X-UC-Desktop-Token` headers if a connection token is present
  (`src/lib/customAgentBridgeDispatcher.ts:105-121`).
- The dispatcher walks the path list until one returns HTTP 200 with a body
  it can interpret as success; on `404`/`405` it tries the next path, on
  `401`/`403` it stops immediately, and it gives up after all five paths
  fail (`src/lib/customAgentBridgeDispatcher.ts:122-155`).
- There is a 20-second timeout per attempt
  (`src/lib/customAgentBridgeDispatcher.ts:127`).

**What this contract does NOT have, today**: no `GET /health` or
`GET /capabilities` discovery call, no `POST /status` polling, no
`POST /cancel`, and no `POST /receipt` — the entire lifecycle is a single
best-effort fire-and-forget POST. The dispatcher either gets a synchronous
"ok" response with a reply string embedded in it, or it fails; there is no
way for a connected agent to report progress, cancellation, or a proof
receipt back through this path after the initial call returns. If a
research or planning doc you're reading describes a 7-endpoint
`/health` → `/capabilities` → `/task` → `/message` → `/status` → `/cancel` →
`/receipt` lifecycle for generic agents, that is the aspirational design,
not what `customAgentBridgeDispatcher.ts` implements — see "What's coming"
below.

## 3. The MCP server(s) that exist today

### `scripts/mcp-agent-connect.js` — stdio MCP server, presence + 3 tools

This is a real, working, zero-dependency **stdio** MCP server
(`initialize` / `tools/list` / `tools/call` JSON-RPC over stdin/stdout,
newline-delimited). Run it as:

```
UC_CONNECT_TOKEN=<token> node scripts/mcp-agent-connect.js
```

It does two things:

1. Sends a heartbeat POST (`session_start`, `heartbeat` every 30s,
   `session_end`) to `supabase/functions/agent-connect/index.ts`
   (`scripts/mcp-agent-connect.js:34-99`), which validates the
   `UC_CONNECT_TOKEN` against the `agent_connect_tokens` table, resolves a
   circle, and upserts presence into `circle_office_agents`
   (`supabase/functions/agent-connect/index.ts:74-263`). This is a
   **write-only presence channel** — one `Deno.serve` handler, POST only
   (a GET returns `405`), no read-back of circle state beyond an optional
   `token_validate` echo.
2. Exposes exactly **3 tools** to the connected MCP client
   (`scripts/mcp-agent-connect.js:103-136`):
   - `uc_report_progress(task, status?)` — reports current work via the same
     heartbeat POST.
   - `uc_get_circle_info()` — returns locally cached info (agent type, cwd,
     heartbeat interval, last-seen circle id, last reported task); it does
     **not** fetch live circle/task state from the server.
   - `uc_post_update(message, type?)` — posts a short message, also via the
     heartbeat POST with a truncated task string.

There are no read tools for tasks, memory, skills, connected apps, agent
sessions, or file leases in this server — only self-reporting.

**Staleness**: this file's logic was last changed 2026-03-23, roughly 17
weeks before this doc was written (verified via
`git log -1 -- scripts/mcp-agent-connect.js`). It is not under active
development.

### `supabase/functions/agent-connect/index.ts` — the heartbeat receiver

Also accepts native Claude Code hook payloads directly (`{ session_id, cwd,
model, hook_event_name, ... }`, as sent by a Claude Code `type: "http"`
hook), mapping hook event names (`SessionStart`, `PreToolUse`, `Stop`, etc.)
to the same presence upsert (`supabase/functions/agent-connect/index.ts:39-140`).
It supports Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Windsurf,
Copilot, Aider, Cline, Continue, and Amp as named `agent_type` values with
per-provider display metadata (`supabase/functions/agent-connect/index.ts:25-37`).
It is a **single POST endpoint** — no `GET /health`, no capability listing,
no task push, and it was last changed alongside the same `2026-06-02`
working-tree snapshot commit as `chatAgentTargets.ts` and
`customAgentBridgeDispatcher.ts` (roughly 7 weeks before this doc), i.e. it
has moved in step with the chat connect surface, not independently.

### `claude-bridge.js`'s own `/mcp` endpoint — a different, narrower MCP server

Separately, `scripts/claude-bridge.js` itself exposes a `POST /mcp`
JSON-RPC-over-HTTP endpoint on port 7778
(`scripts/claude-bridge.js:1821-1850`). Its `tools/list` is **not** about UC
circle/task state — it exposes local-machine device tools: `list_sessions`,
`exec_command`, `list_devices`, `list_printers`, `print_text`,
`list_serial_ports`, `send_serial`, `detect_3d_printer`, `send_gcode`,
`scan_network` (`scripts/claude-bridge.js:1858-1948`). `initialize` and
`tools/list` are open; every other method (including `tools/call`) requires
the same `X-UC-Desktop-Token` used by the rest of the bridge
(`scripts/claude-bridge.js:1847-1855`). This is a real, currently-maintained
endpoint (the file it lives in was last touched 2026-07-13, about a week
before this doc), but it is scoped to local hardware/printer/exec actions,
not circle task orchestration.

## Known failure modes / limitations a connecting agent should expect

- **Bridges require a local desktop process.** None of `claude-bridge.js`,
  `codex-bridge.js`, `cursor-bridge.js`, or `gemini-bridge.js` run anywhere
  but the operator's own machine unless someone tunnels the port. If that
  process isn't running, every bridge call fails closed (connection
  refused), and on production web the app won't even try unless the user has
  opted in (`src/lib/bridgeEnvironment.ts`).
- **No discovery/capabilities endpoint exists for the generic HTTP
  contract.** `customAgentBridgeDispatcher.ts` cannot ask a target "what do
  you support" before sending a task — it just tries five fixed paths and
  gives up.
- **No status/cancel/receipt lifecycle for generic agents.** Once a task
  POST succeeds, UC has no follow-up channel to that agent through this
  contract; any progress reporting has to happen through a different
  surface (the bridge's own `/terminal/send`, or the MCP heartbeat channel).
- **Claude Code bridge task dispatch is billing-gated by default.** Expect
  `POST /launch` and `POST /terminal/send` on port 7778 to fail with an
  explicit "disabled to prevent Anthropic charges" error unless
  `EXPO_PUBLIC_ALLOW_CLAUDE_CODE_BILLING=true` is set on the machine running
  the app.
- **The shared desktop token is not per-user or per-circle.** It's one
  secret per machine, written to `~/.uc-desktop-token` and readable by
  anything with local filesystem or process access.
- **The MCP presence channel is fire-and-forget.** `uc_get_circle_info`
  returns locally cached state, not a live server read; there's no
  server-side task list, memory search, or skill listing exposed over MCP
  today.
- **Two unrelated things are both called "the generic agent contract"** in
  this codebase right now: the chat-dispatch 5-path POST fallback described
  above, and the separate Office `GET /health` + optional `POST
  /tools/invoke` contract in `docs/CUSTOM_AGENT_BRIDGE.md`. Confirm which
  one a given UI surface is asking you to implement.

## What's coming (PLANNED — NOT YET IMPLEMENTED)

The items below describe a documented product direction, not current
behavior. Treat every claim in this section as aspirational until you find
it in the source.

- A 7-endpoint generic-agent HTTP lifecycle contract: `GET /health`,
  `GET /capabilities`, `POST /task`, `POST /message`, `POST /status`,
  `POST /cancel`, `POST /receipt`, with connected agents advertising
  provider/version/transport/capabilities/approval-policy metadata. Today
  only the 5-path POST fallback above exists, with no health/status/cancel/
  receipt calls.
- An "MCP v2" tool set for `mcp-agent-connect.js` (or a successor), including
  read tools like `uc_get_context_pack`, `uc_list_tasks`, `uc_get_task`,
  `uc_search_memory`, `uc_list_skills`, `uc_list_connected_apps`,
  `uc_list_file_leases`, and write/report tools like `uc_claim_task`,
  `uc_report_receipt`, `uc_report_blocker`, `uc_claim_file`,
  `uc_publish_artifact`. Today the server exposes exactly the 3 tools listed
  above.
- Machine-readable discovery docs at the repo/site root (`/llms.txt`,
  `/llms-full.txt`, `/agents.md`, `/mcp`, `/mcp/manifest`,
  `/skills/index.json`) and companion docs
  (`docs/generic-agent-bridge.md`, `docs/custom-api-connector.md`). None of
  these exist in the repo today; this file (`docs/AGENT_CONNECT.md`) is the
  first piece of that plan.
- An "Agent Connect Wizard" UI that detects local agent installs, bridge
  health, and generates MCP/hook/rule config snippets in one flow. Today,
  connecting a bridge is a manual `npm run bridge*` command plus reading the
  `setupHint` text in `src/lib/chatAgentTargets.ts`.

This section summarizes a broader internal product-research doc on agent
ecosystem connectivity; that research doc is the *source of the vision*, not
proof of what's shipped. This file (`docs/AGENT_CONNECT.md`) is the
ground-truth companion — read it first for what's real today.
