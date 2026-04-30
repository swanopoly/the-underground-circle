# Agent Dispatch — Design

> **Goal:** Let users assign tasks to specific agent sessions by name —
> "assign npm test to whistling-taco" — and have it execute on the right
> agent's runtime (Claude Code, Codex, Cursor, Gemini, OpenSwan, BYO,
> or any future bridge that implements the protocol).
>
> Status: planning · Date: 2026-04-30

---

## 1. Why this, why now

UC already auto-discovers agent sessions via the bridges (claude-code,
codex, gemini-cli, cursor) plus DB-tracked agents (`circle_office_agents`)
plus connections (OpenSwan, BYO webhooks). What's missing is a single
verb — *assign this to that* — that traverses every source uniformly,
resolves the target, and dispatches by capability.

The 2026-04-29 bridge protocol spec set the stage with `capabilities`
declarations on `/health`. This design adds three new dispatch
capability tokens and a resolver/dispatcher pair that operates against
them, so adding a future agent (Aider, Cline, MCP-as-bridge) is a
matter of implementing the protocol rather than patching dispatch
logic.

---

## 2. Capability tokens (extensions to the protocol)

| Token              | Means the bridge implements                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `dispatch:spawn`   | `POST /spawn` — start a NEW session with a given task. Claude Code does this today. |
| `dispatch:send`    | `POST /send` — send a message to an EXISTING session. Gemini bridge has this. |
| `dispatch:queue`   | `POST /update` or `POST /register` — queue a task for a user-run agent that can't be programmatically driven (Codex, Cursor — agent owners drive their CLI; we just push state). |

Bridges declare which apply via `capabilities` on `/health`. Dispatcher
picks one by user intent + what's available, falling back gracefully:

- "assign X to <name>" with no qualifier → prefer spawn → send → queue
- "send X to <name>" → prefer send → spawn (new session)
- "queue X for <name>" → only queue

---

## 3. Session resolver

Pure function: given a name string, returns a list of matching session
references across every source UC knows about.

```ts
interface SessionRef {
  bridge: BridgeName | 'circle_office' | 'openswan' | 'byo' | 'blackswan';
  sessionId: string;        // e.g. "abc-123" or "blackswan:default"
  sessionName: string;      // friendly: "whistling-taco" / agent display name
  projectDir?: string;      // when known
  status?: AgentStatus;
  capabilities: BridgeCapability[]; // inherited from bridge or inferred
}

function resolveSessions(query: string): Promise<SessionRef[]>
```

Matching rules (in order):

1. **Exact session name match** — `whistling-taco` matches the Claude
   Code session named exactly that.
2. **Slug fuzzy match** — `taco` matches `whistling-taco` (substring).
3. **Friendly name match** — `claude` matches the most-recently-active
   Claude Code session; `codex` matches latest Codex session.
4. **Display name match** — matches `circle_office_agents.name` or
   connection name.

If multiple matches, returns all and the dispatcher's caller decides
how to disambiguate (UI lists them, user picks). Zero matches returns
an empty array with no error — caller renders "no agent matches".

Sources walked in parallel:

- All bridges (`probeBridges` + `/sessions` per healthy bridge with `sessions` capability)
- `circle_office_agents` (DB)
- `connections` (DB) for OpenSwan + BYO
- Hardcoded "blackswan" / "swan" / "swanbot" → BlackSwan default agent

---

## 4. Dispatcher

```ts
interface DispatchInput {
  session: SessionRef;
  task: string;
  preferredVerb?: 'spawn' | 'send' | 'queue' | 'auto';
  /** When provided, the resolved log file / session id is appended for
   *  the UI to poll. */
  onProgress?: (status: DispatchStatus) => void;
}

interface DispatchResult {
  ok: boolean;
  kind: 'spawn' | 'send' | 'queue' | 'rejected';
  sessionId?: string;     // bridge's id for the spawned session
  pid?: number;           // for spawned processes
  logFile?: string;       // for spawned processes (Claude Code)
  message: string;        // human-readable outcome
  pollUrl?: string;       // /spawn/status URL when applicable
  error?: string;
}
```

Dispatch order:

| Bridge                           | spawn?           | send?       | queue?           | Notes                                   |
| -------------------------------- | ---------------- | ----------- | ---------------- | --------------------------------------- |
| claude-code                      | ✓ /spawn         | —           | —                | Already implemented (claude-bridge.js). |
| codex                            | (future)         | —           | ✓ /update         | Read-mostly today; queue marks task on session row. |
| cursor                           | —                | —           | ✓ /update         | Same.                                   |
| gemini-cli                       | —                | ✓ /send      | —                | Single-shot per session.                |
| openswan                         | ✓ create session | ✓ sessions_send | —             | `sendAgentTask` already exists.        |
| byo (webhook connection)         | —                | ✓ POST endpoint | —             | Existing pattern.                       |
| blackswan (in-app)               | —                | ✓ chat-stream  | —              | Same path as `@blackswan` mention.     |

When the user asks for `spawn` but the bridge only supports `queue`,
the dispatcher returns `kind: 'queue'` with a clear message ("agent is
read-only; task queued for you to run") rather than failing silently.

---

## 5. Intent parsing

Three entry points, all converging on `dispatchToSession`:

### 5a. Slash command

```
/assign <name> <task>
/delegate <name> <task>
/spawn <name> <task>      → forces preferredVerb = 'spawn'
/send <name> <task>       → forces preferredVerb = 'send'
/queue <name> <task>      → forces preferredVerb = 'queue'
```

### 5b. Natural language

Match in `agentDispatchIntent.ts`:

- `^(assign|delegate|hand[ -]?off|send|give)\s+(.+?)\s+to\s+@?(\S+)\s*[:.]?\s*(.+)?$`
- `^@(\S+)\s+(handle|do|run|execute|please)\s+(.+)$`
- `^(.+?)\s*[—-]\s*@?(\S+)$`   (e.g. "run npm test — claude")

Parser returns the same shape as the slash form so downstream code
doesn't care which entry point was used.

### 5c. Reply-chain

If the user replies to any message and types `@<agent> handle this`,
use the replied-to message's content as the task body.

---

## 6. UI

`AgentDispatchCard` (new component):

```
┌─────────────────────────────────────────────────────────┐
│ → Dispatched to claude-code · whistling-taco            │
│   Task:  run npm test in the underground circle         │
│   Mode:  spawn                                          │
│   Status: RUNNING  PID 47291                            │
│   Log:   /tmp/claude-spawn-1234-0.log                   │
│   [↗ stream log]   [cancel]   [reply to chat]           │
└─────────────────────────────────────────────────────────┘
```

Local-only (not persisted to Supabase) — task content + paths may be
machine-specific.

For spawn dispatches, polls `/spawn/status` (claude-bridge already
supports this) at 2-second intervals. For send dispatches that target
LLM-backed agents, surfaces the agent's reply as a follow-up bot
message in chat.

---

## 7. Phased rollout

### Phase 1 — Resolver + dispatcher core (no UI yet) (~1h)

- `src/lib/agentDispatch.ts` — `resolveSessions`, `dispatchToSession`
- Initial dispatch implementations:
  - claude-code: spawn (POST /spawn)
  - openswan: send (sendAgentTask)
  - blackswan: send (chat-stream)
- Bridge capabilities updated with new tokens
- Smoketest covering the resolver pure logic

### Phase 2 — Slash + NL intent parser (~30m)

- `src/lib/agentDispatchIntent.ts` parser (RN-free for smoketests)
- Wire `/assign`, `/delegate`, `/spawn`, `/send`, `/queue` into
  `chatCommandRegistry`
- ChatTab intercepts intent before LLM path
- Smoketest covering the parser

### Phase 3 — AgentDispatchCard UI (~45m)

- Renders dispatch status under the user's message
- Polls /spawn/status for spawn dispatches
- "↗ stream log" / "cancel" / "reply to chat" buttons

### Phase 4 — Cursor / Codex / Gemini support (~45m)

- Extend the bridges with the new endpoints (codex /spawn, gemini /send
  already exists, cursor /update accepts task field)
- Dispatcher routes accordingly
- Bridge capabilities updated

### Phase 5 — BYO webhook + future-bridge protocol (~30m)

- `dispatchToSession` walks the connection's webhook URL
- Bridge protocol spec updated with the dispatch:* capability tokens
  and a "How to add a new agentic bridge" checklist

Total: ~3.5–4h to ship all five phases.

---

## 8. Future-state additions

- **MCP server as bridge** — write a tiny MCP-to-bridge shim that
  implements the protocol, so any MCP server (filesystem, github,
  whatever) becomes dispatchable.
- **Cross-machine** — when the user has a remote agent running on
  another host, route through the openswan-proxy for tunneled access.
- **Confirmation gate** — for high-impact dispatches (sudo, deploy,
  destructive shell), require an in-chat APPROVE button before the
  dispatch fires (reuses the existing HITL approval banner pattern).
- **Rate limiting / budget** — per-agent spend caps before allowing
  spawn (kill switch already exists; just gate /spawn through it).
