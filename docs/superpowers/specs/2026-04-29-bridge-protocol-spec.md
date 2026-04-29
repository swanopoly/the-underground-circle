# Bridge Protocol Specification

> **Goal:** Define the common HTTP shape every UC local bridge should
> implement so clients can talk to any bridge by capability rather than
> by name. Adding a new bridge (Aider, Cline, future tools) becomes a
> matter of implementing this spec, not reinventing it.
>
> Status: draft · Date: 2026-04-29 · Owner: Swan
>
> Live bridges that already implement (most of) this:
>   - `scripts/claude-bridge.js`     — port 7778
>   - `scripts/codex-bridge.js`      — port 7779
>   - `scripts/gemini-bridge.js`     — port 7780
>   - `scripts/cursor-bridge.js`     — port 7781
>   - `openswan-proxy.js`            — port 18790 (proxy, not a tool bridge)

---

## 1. Why this exists

Each existing bridge invented its own response shape. Adding a new
bridge today requires reading three other bridge sources to understand
which fields are conventional. This spec freezes the contract.

It also unblocks:
- A capability-based dispatcher (call `/exec` against whichever bridge is up)
- A consolidated bridge status UI that doesn't special-case each bridge
- Smoke-testable parser logic in `bridgeHealthDiag.parseBridgeHealth`
- Future MCP-server bridges that want to expose CLI tools to UC

---

## 2. Mandatory endpoints

Every bridge MUST implement:

### `GET /health`

**Purpose:** Liveness + capability discovery in one round-trip.

**Response (200):**
```json
{
  "ok": true,
  "bridge": "claude-code" | "codex" | "gemini-cli" | "cursor" | "<custom>",
  "version": "1.0.0",
  "capabilities": ["sessions", "exec", "exec/stream", "secrets"],
  "auth": "ok" | "none" | "expired" | "n/a",
  "sessions": 0,                          // active session count, optional
  "uptime_s": 1234,                       // seconds since process start
  "started_at": "2026-04-29T16:12:08.000Z"
}
```

Existing fields kept for back-compat:
- `bridge`, `version`, `ok` already present everywhere
- `auth` already present on Gemini/Codex; document as standard
- `sessions` already present on Claude/Codex; document as standard

New fields added by this spec:
- `capabilities` — string array (see §3 below)
- `uptime_s` and `started_at` — useful for the status panel and for
  detecting bridges that have been up for unreasonably long without a
  health check (suggests wedge)

**Headers:** Always include CORS:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### `GET /sessions`

**Purpose:** Enumerate active agent sessions.

**Response (200):**
```json
{
  "sessions": [
    {
      "sessionId": "<unique>",
      "projectDir": "/path/to/project",
      "model": "<model name or null>",
      "status": "active" | "idle" | "offline",
      "task": "<short task summary or null>",
      "lastActivity": "ISO-8601",
      "totalInputTokens": 0,
      "totalOutputTokens": 0,
      "messageCount": 0,
      "recentActions": ["string", ...]
    }
  ],
  "lastScan": "ISO-8601",
  "sessionCount": 0
}
```

Bridges that don't have a session model (the proxy) MAY omit this
endpoint; the catalog entry's `sessionsUrl` is optional.

---

## 3. Capability tokens

The `capabilities` array uses the following standard tokens:

| Token         | Means                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `sessions`    | Implements `GET /sessions`                                                                  |
| `exec`        | Implements `POST /exec` (buffered shell exec)                                               |
| `exec/stream` | Implements `POST /exec/stream` (SSE streaming shell exec)                                   |
| `secrets`     | Implements `POST /secrets` (1Password / vault lookup)                                       |
| `spawn`       | Implements `POST /spawn` (start an agent session with a task)                               |
| `browser`     | Implements `/browser/*` (Playwright surface)                                                |
| `register`    | Implements `POST /register` (third-party agents push their state in)                        |
| `update`      | Implements `POST /update` (third-party agents update their state)                           |

A new bridge's capabilities are declared by listing the tokens it
supports. Clients SHOULD filter by capability before calling
endpoints — e.g. only show RUN buttons when the active bridge has
`exec/stream` in its capabilities (with `exec` as fallback).

---

## 4. Optional endpoints

### `POST /exec`

**Purpose:** Run a shell command, return buffered output.

**Request body:**
```json
{ "command": "npm test" }
```

**Response (200):**
```json
{
  "ok": true,
  "stdout": "...",
  "stderr": "...",
  "code": 0
}
```

**Constraints:**
- Origin gate: only allow localhost / `app.chrisswanson.xyz` origins.
- Blocked-pattern filter: reject `rm /…`, `sudo`, `mkfs`, `dd of=…`,
  `curl|sh`, etc. (full list in `scripts/claude-bridge.js`).
- Timeout: 30 s.
- Body cap: 10 KB.
- Output caps: 64 KB stdout, 16 KB stderr (keeps payload reasonable).

### `POST /exec/stream`

**Purpose:** Run a shell command, stream output as Server-Sent Events.

Same security as `/exec`. SSE event format:
```
data: {"type":"stdout","chunk":"..."}\n\n
data: {"type":"stderr","chunk":"..."}\n\n
data: {"type":"done","code":0,"durationMs":1234}\n\n
data: {"type":"error","error":"..."}\n\n
```

Output caps: 256 KB stdout, 64 KB stderr. Client disconnect kills the
child to avoid orphans.

### `POST /secrets`

**Purpose:** Resolve credentials from 1Password / vault.

See `scripts/claude-bridge.js:718+` for the reference implementation.

### `POST /spawn`

**Purpose:** Start a new agent session with an initial task.

See `scripts/claude-bridge.js:782+` for the reference implementation.

### `POST /register` / `POST /update`

**Purpose:** Allow agents that don't write to a known scan path
(e.g. third-party tools, future MCP servers) to push their session
state into the bridge's cache.

See `scripts/codex-bridge.js:255+` for the reference implementation.

---

## 5. Auth field semantics

The `auth` field on `/health` distinguishes four states:

| Value     | Means                                                                       |
| --------- | --------------------------------------------------------------------------- |
| `ok`      | Bridge is up AND can reach its underlying tool's authenticated state        |
| `none`    | Bridge is up but the tool isn't authenticated yet (degraded — fixable)      |
| `expired` | Bridge is up but the tool's auth token is expired (degraded — fixable)      |
| `n/a`     | Bridge has no auth concept (e.g. the proxy or a bridge that just spawns)    |

Clients render `none` and `expired` as warnings with the recovery hint
(`gemini auth login`, etc.) — NOT as errors. The bridge process is up,
the user just needs to do one thing.

---

## 6. Adding a new bridge

Checklist:

1. Pick an unused port in `7778-7799`. Document in this spec.
2. Implement `GET /health` returning the §2 shape, including
   `capabilities` listing what you'll support.
3. Implement `GET /sessions` if you have a session model.
4. Implement whichever optional endpoints match your capability tokens.
5. Add a `BridgeCatalogEntry` to `src/lib/bridgeHealthDiag.ts:BRIDGE_CATALOG`.
6. Update `parseBridgeHealth` in the same file if the parser needs to
   recognize a new auth or session shape (most bridges won't).
7. Update `start-dev.js` so the supervisor knows to keep your bridge
   up alongside the others.
8. Add a `scripts/<your>-bridge-smoketest.ts` and wire to
   `npm run smoke:<your>-bridge`.

A bridge that ONLY implements `/health` + `/sessions` is a valid
read-only bridge. A bridge that adds `/exec` and `/exec/stream`
becomes a full agent bridge that the chat's RUN buttons can target.

---

## 7. Future-state additions (non-blocking)

These are deferred but documented so the protocol has a north star:

- **`/events` SSE stream** — bridge pushes session state changes to
  subscribers so clients don't need to poll.
- **`/capabilities` standalone endpoint** — same array as in `/health`
  but cached separately, for clients that want capability-only checks
  without paying for a full health probe.
- **Per-bridge auth tokens** — startup-generated secrets written to a
  known location (`~/.uc-bridges/<name>.token`) so the localhost-origin
  gate becomes localhost-origin + token rather than just origin.
- **Token rotation** — bridges write a new token every 24 h; clients
  re-read on `401`.
- **Capability versioning** — `exec@1.0`, `exec/stream@1.1` so we can
  evolve schemas without breaking clients that aren't ready.
- **Bridge-to-bridge routing** — the openswan-proxy gains a route table
  that dispatches `/exec` to whichever tool bridge has `exec` and is
  closest to a target session.

---

## 8. Reference implementations

Bridges that match this spec today (post-2026-04-29):

| Bridge        | `/health` | `/sessions` | `/exec` | `/exec/stream` | `/secrets` | `/spawn` |
| ------------- | --------- | ----------- | ------- | -------------- | ---------- | -------- |
| claude-bridge | ✓         | ✓           | ✓       | ✓              | ✓          | ✓        |
| codex-bridge  | ✓         | ✓           | —       | ✓              | —          | —        |
| gemini-bridge | ✓         | ✓           | —       | —              | —          | —        |
| cursor-bridge | ✓         | ✓           | —       | —              | —          | —        |
| openswan-proxy | ✓        | n/a         | —       | —              | —          | —        |

`capabilities` field NOT yet emitted by any bridge — see follow-up:
`docs/superpowers/specs/2026-04-29-bridge-capabilities.md` (next).
