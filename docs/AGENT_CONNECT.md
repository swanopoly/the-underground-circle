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
anything (`src/lib/bridgeTaskDispatcher.ts:31-44`,
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

### `scripts/mcp-agent-connect.js` — stdio MCP server, presence + 9 tools

This is a real, working, zero-dependency **stdio** MCP server
(`initialize` / `tools/list` / `tools/call` JSON-RPC over stdin/stdout,
newline-delimited). Run it as:

```
UC_CONNECT_TOKEN=<token> node scripts/mcp-agent-connect.js
```

It does two things:

1. Sends a heartbeat POST (`session_start`, `heartbeat` every 30s,
   `session_end`) to `supabase/functions/agent-connect/index.ts`
   (`scripts/mcp-agent-connect.js:59-106`), which validates the
   `UC_CONNECT_TOKEN` against the `agent_connect_tokens` table, resolves a
   circle and checks membership, and upserts presence into
   `circle_office_agents` (`supabase/functions/agent-connect/index.ts:212-335`
   and `:385-410`). The heartbeat path is fire-and-forget — errors are
   silently dropped (`scripts/mcp-agent-connect.js:90`) — but the same POST
   endpoint now also answers `event: "read_op"` reads (next subsection), so
   it is no longer write-only.
2. Exposes **9 tools** to the connected MCP client (`TOOLS` array,
   `scripts/mcp-agent-connect.js:236-323`; handlers `:379-527`).

   The 3 original self-reporting tools:
   - `uc_report_progress(task, status?)` — reports current work via the same
     heartbeat POST (`:346-361`); returns only a local echo of what it sent,
     never server state.
   - `uc_get_circle_info()` — returns locally cached info (agent type, cwd,
     heartbeat interval, last-seen circle id, last reported task); it does
     **not** fetch anything from the server (`:363-380`) —
     `uc_get_circle_live_info` below is the live-read counterpart.
   - `uc_post_update(message, type?)` — posts a short message, also via the
     heartbeat POST with a truncated task string (`:382-400`).

   The 4 read tools added 2026-07-20/21 (committed on this branch — re-derive
   line numbers against your checkout):
   - `uc_list_file_leases()` — **local-disk read, no server call**: walks up
     from `cwd` (max 12 levels) to find `.uc/agent-locks.json`
     (`:183-195`), the same advisory lease registry
     `src/lib/agentFileCoordination.ts` persists
     (`src/lib/agentFileCoordination.ts:34`), and returns up to 20 active
     leases (path, owner label, intent, seconds-to-expiry), pruning expired
     entries client-side (`:197-221`, expiry filter at `:211`). It never
     writes the registry, and never returns owner ids, timestamps, or
     content hashes (output fields at `:214-219`).
   - `uc_list_pending_approvals()` — server read: pending human-approval
     requests (id, kind, title, requester, age) merged from
     `agent_approvals` and `agent_run_approvals` (`:414-421`; server side in
     the next subsection). It never returns the action `payload` or
     `session_key`.
   - `uc_list_skills()` — server read: circle skill-library metadata only —
     name, description, version, tags, usage/success counts (`:423-433`). It
     never returns the skill `content` body.
   - `uc_get_circle_live_info()` — server read: live circle name, member
     count, today's check-in/message counts, and up to 10 recently-active
     agents with their current task (`:435-454`). It returns counts and
     agent presence rows only — no member list, no message contents, no
     tokens.

   The 2 slice-2 tools added 2026-07-21 (committed on this branch — re-derive
   line numbers against your checkout):
   - `uc_list_tasks()` — server read: **open** tasks on the circle's kanban
     board (`tasks`, "open" = status not in `done`/`approved`), returning id,
     title, status, priority, due date, position, `assigned_agent_id`, and
     assignee/creator **display names** (`:489-504`; server side in the next
     subsection). It never returns the task `description`, `focus_chain`,
     `peer_approvals`, plan ids, `image_url`, or the raw `created_by`/
     `assigned_to` UUIDs (owner columns are mapped to a name string).
   - `uc_report_receipt(title, pow_type?, detail?, mission_id?)` — the first
     **write** tool: records ONE append-only `proof_of_work` row via a new
     `event: "write_op"` branch (`:505-522`; server side below). It is
     INSERT-only — it cannot update or delete anything, and cannot write
     memory, skills, or approvals. The client forwards only `title`, `pow_type`,
     `detail`, and `mission_id`; it deliberately never sends `circle_id` or
     `user_id`, which the server forces from the connect token. A missing/empty
     `title` is rejected client-side before any request is sent.

   The 4 server-backed reads plus the write share one transport: `postServerOp`
   (`scripts/mcp-agent-connect.js:118-157`), which POSTs `{ event, op, ... }`
   to the same `agent-connect` edge function with the same
   `Authorization: Bearer <UC_CONNECT_TOKEN>` header and a 10s timeout, and —
   unlike heartbeats — actually reads the response body back. `postReadOp`
   (`:159`) and `postWriteOp` (`:163`) are the thin wrappers that set the
   event. `uc_list_file_leases` is the exception: it never touches the network.

There are still no read tools for memory/context packs, connected apps, or
agent sessions in this server, and the only write/report tool beyond
self-reporting is the append-only `uc_report_receipt` — no task-claim,
file-claim, or artifact-publish tools yet. See "What's coming" below.

**Staleness**: before this branch, this file's last change was 2026-03-23,
but it is under active development again — the 4 read tools were added on
2026-07-20/21 and the 2 slice-2 tools (`uc_list_tasks`, `uc_report_receipt`)
on 2026-07-21, all committed on this branch (see `git log -- scripts/mcp-agent-connect.js`).
Re-derive line numbers against your checkout.

### `supabase/functions/agent-connect/index.ts` — heartbeat receiver + read ops

Also accepts native Claude Code hook payloads directly (`{ session_id, cwd,
model, hook_event_name, ... }`, as sent by a Claude Code `type: "http"`
hook), mapping hook event names (`SessionStart`, `PreToolUse`, `Stop`, etc.)
to the same presence upsert
(`supabase/functions/agent-connect/index.ts:40-50` and `:251-275`).
It supports Claude Code, Codex, Gemini CLI, Cursor, OpenCode, Windsurf,
Copilot, Aider, Cline, Continue, and Amp as named `agent_type` values with
per-provider display metadata (`supabase/functions/agent-connect/index.ts:25-37`).

Since 2026-07-20/21 (committed on this branch) it also serves **read
ops**: a POST with `event: "read_op"` and an `op` field is routed to
`handleReadOp` (`supabase/functions/agent-connect/index.ts:506-508`, handler
at `:92-261`) — reached **only after** the same token-validation
(`:385-396`) and circle-membership (`:493-503`) gates the presence path
uses, and reads early-return so they never upsert presence (`:506-508`).
Four read ops exist — `list_pending_approvals`, `list_skills`,
`circle_live_info`, and `list_tasks` (allowlist at `:63`); unknown ops get a
`400` (`:261`). Every query is manually scoped to the resolved circle id (the
service-role client bypasses RLS, per the comment at `:52-61`), output is
bounded (max 20 rows via `MAX_READ_ROWS` at `:64`, long strings truncated via
`truncField` at `:86-89`), and columns are allowlisted: approval reads never
select the action `payload` or `session_key` (`:98`), skill reads never select
the skill `content` body (`:149`), `list_tasks` never selects the task
`description`/`focus_chain`/`peer_approvals`/plan ids/`image_url` and maps the
`created_by`/`assigned_to` UUIDs to display names (`:215-259`), and no op
returns tokens or credentials.

Since 2026-07-21 (committed on this branch) it also serves one **write
op**: a POST with `event: "write_op"` and `op: "report_receipt"` is routed to
`handleWriteOp` (`:516-518`, handler at `:265-364`) — reached from the **same
early-return point, immediately after the `read_op` branch and therefore after
the identical token-validation (`:385-396`) and circle-membership 403 gate
(`:493-503`)**. It is append-only: a single `proof_of_work` INSERT (`:333-344`)
— never UPDATE/DELETE, and never memory/skills/approvals. `circle_id` and
`user_id` are **server-forced** from the validated token/membership, never read
from the client body; `pow_type` is validated against the table's CHECK set
(`:79`, reject-400 otherwise), `title` is capped at 300 chars and `detail`
(jsonb) at 4 KB, a supplied `mission_id` is dropped unless it belongs to the
caller's circle, and writes are rate-limited to 12/min per user+circle so a
leaked token cannot spam rows. Unknown write ops get a `400` (`:364`). This
preserves the edge-security-audit posture: the write path adds no new trust and
sits behind the exact same gates as every other authenticated op.

**Operational caveat**: these read ops exist in this repo's source but are
**not live until the edge function is redeployed** (`npx supabase functions
deploy agent-connect --no-verify-jwt`, per the file's own header at `:18`) —
this repo tracks edge deploys as separate ops steps, so code-in-repo is not
proof of code-in-production. Worse, against a deployment that predates the
`read_op` branch the three server-backed tools do not hard-fail: the last
*committed* version of this file contains no `read_op` handling (verified
via `git show HEAD` — zero matches), so an old deployment treats the POST as
a generic presence event and returns `{ ok: true }`, which the MCP client
renders as empty results ("No pending approvals...") — silently misleading,
not an error.

It remains a **single POST endpoint** — no `GET /health` (any non-POST gets
a `405`, `supabase/functions/agent-connect/index.ts:203-205`), no capability
listing, no task push. Before this branch its last change was the `2026-06-02`
working-tree snapshot commit shared with `chatAgentTargets.ts` and
`customAgentBridgeDispatcher.ts`; the `read_op` and `write_op` branches above
were added on top of that, committed on this branch.

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
- **The MCP heartbeat channel is fire-and-forget, and its reads are
  partial.** `uc_get_circle_info` returns locally cached state, not a live
  server read (`uc_get_circle_live_info` is the live counterpart); there's
  still no memory search or context-pack read exposed over MCP today (skills,
  pending approvals, live circle info, open tasks, and local file leases now
  are, and `uc_report_receipt` can now write an append-only proof-of-work row
  — section 3), and the server-backed reads and the write silently no-op
  (reads return empty, the write is treated as a presence beat) until the edge
  function is redeployed.
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
- The rest of the "MCP v2" tool set for `mcp-agent-connect.js` (or a
  successor): read tools like `uc_get_context_pack`, `uc_get_task`,
  `uc_search_memory`, `uc_list_connected_apps`, and write/report tools like
  `uc_claim_task`, `uc_report_blocker`, `uc_claim_file`, `uc_publish_artifact`.
  The first four read tools from this plan (`uc_list_file_leases`,
  `uc_list_pending_approvals`, `uc_list_skills`, `uc_get_circle_live_info`)
  landed in-repo on 2026-07-20/21, and slice 2 (`uc_list_tasks` read +
  `uc_report_receipt`, the first append-only write) landed on 2026-07-21 —
  see section 3. Today the server exposes exactly the 9 tools listed there.
  `uc_report_receipt` is the only write tool so far — task-claim, file-claim
  (deferred: it would need to reimplement the on-disk lease format that
  `agentFileLeaseCore.ts` owns), and artifact-publish tools are still unbuilt;
  and the server-backed reads plus the write need an edge redeploy to work
  live.
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
