# Desktop-app capability — "open X app on my computer"

**Problem.** Chat receives `open zoom app on my computer`. Our runtime has no OS-level launch permissions, so the task gets classified as `run_computer_task` → `app_tools` → `missing capability` → a dead-end "I can't do that" message.

**Goal.** Give the user an **actionable path** instead of a dead-end, ship what we can cheaply, document the bigger builds so they can be scheduled.

---

## Option A — OS URL-scheme shortcuts (**SHIPPED 2026-04-22**)

**What it is.** Clickable markdown links like `[Zoom →](zoommtg://)` that the browser hands to the OS URL handler. On Mac + Windows most major desktop apps register a URL scheme; clicking the link fires the registered handler the same way Slack notifications or zoom-meeting invite links do.

**Files.**
- `src/lib/knownAppShortcuts.ts` — pure registry (Zoom, Slack, Discord, Teams, Notion, Linear, Figma, VS Code, Cursor, Spotify, GitHub Desktop, Mail, Calendar, Chrome) with per-platform URL-scheme overrides + keyboard hints.
- `src/lib/computerAppAdapter.ts` — hooked to match known-app intents before returning the "no app tools" error. When a match is found, returns `kind: 'known_app_shortcut'` with `osUrl` / `webUrl` / `keyboardHint` so the chat UI can render a rich card later.
- `scripts/known-app-shortcuts-smoketest.ts` — 41 assertions green (registry sanity, intent matcher, per-platform URL resolution).

**Limitations.**
- User still has to click. This is not unattended app-launching.
- Requires the target app to have registered a URL scheme (Zoom, Slack, Discord, Notion, Linear, Figma, Cursor, VS Code all do; many internal tools don't).
- Can't pass complex commands (e.g. "join meeting 123-456").
- No feedback signal — we never learn if the app actually opened.

**Why ship it first.** Covers ~80 % of casual "open X" asks with 0 infrastructure cost. Zero install, zero permissions, zero edge-function calls.

---

## Option B — Local desktop bridge (the **real** path, deferred)

**What it is.** A native helper app that runs on the user's machine and exposes OS-level tools as an MCP endpoint.

**Build shape.**
- Tauri or Electron binary packaged for Mac + Windows (Linux optional).
- Registers `localhost:18794/mcp` (or similar) as an MCP server.
- Exposes tools:
  - `launch_app(name: string)` — `child_process.exec('open -a "Zoom"')` on Mac; `start "" zoom.exe` on Windows.
  - `list_running_apps()` — `osascript -e 'tell application "System Events" to get name of every process'` or AppleScript `System Events`.
  - `focus_window(title: string)`.
  - `type_text(text: string)` — via Accessibility API or `System Events keystroke`.
  - `click(x, y)` — same surface.
  - `screenshot()` — for verification / agent vision.
- User grants Accessibility + Automation permissions once through system prompts.
- UC detects the bridge via `mcpClient.fetchAllMcpTools` → `computerAppAdapter` automatically uses it instead of falling back to Option A.

**Why deferred.**
- Real investment: binary, signing, notarization, updater, permission UX, security review.
- Risk: Accessibility-API access is the same blast radius as a remote-desktop tool. Needs a proper sandbox story and per-tool HITL approval (all destructive tools should route through our existing `chatApprovalGate`).
- Scope: 2–4 weeks of focused work if we ship Tauri; longer if we include full Accessibility tree traversal.

**When to build.** Only after we have a clear power-user who wants it (> 3 user requests) AND `execute_code`-style operators are explicitly opted-in at the circle level.

---

## Option C — Extend the existing Claude Code bridge (medium term)

**What it is.** We already ship `scripts/claude-bridge.js` running on `localhost:7778`. Add a `POST /apps/launch { name }` endpoint that shells `open -a` / `start`, plus expose it as an MCP tool so `computerAppAdapter` picks it up automatically.

**Build shape.**
- ~40 lines of Node.js in the existing bridge.
- A new `bridgeAppLaunch` tool in our MCP shim.
- Reuses existing `agentInvocation.ts` routing + bridge detection.
- No new binary, no notarization; users who already run the Claude Code bridge just get the capability for free.

**Limitations.**
- Only works when the user has Claude Code installed and the bridge running.
- Narrower scope than Option B — no window focus, no typing, no screenshot.
- Mac/Linux-friendly (`open -a` / `xdg-open`), Windows needs a small fallback.

**When to build.** Probably second — after Option A gets real usage and we want to upgrade the UX for heavy CC users without committing to Option B.

---

## Option D — Anthropic `computer_20250124` tool in desktop mode

**What it is.** Anthropic's computer-use tool ships a `desktop` mode in addition to `browser`. The agent gets mouse + keyboard + screenshot against a user-controlled VNC / remote-desktop surface.

**Build shape.**
- User runs a local VNC server or an explicit desktop-share bridge.
- `computer-use-agent` edge function switches to desktop mode.
- Agent autonomously launches apps, navigates OS UI, takes screenshots, etc.

**Why deferred.** Overkill for "open Zoom". Appropriate for autonomous research tasks that span multiple apps ("check my email, then open Notion, then book a meeting in Calendar"). Worth revisiting when we have a power user who needs that.

---

## Decision — what to ship / when

| Option | Status | Coverage | Effort | Risk |
|---|---|---|---|---|
| **A — URL-scheme shortcuts** | **Shipped 2026-04-22** | ~80 % of "open X" | S (one afternoon) | None — pure markdown link |
| **C — Claude Code bridge extension** | Deferred to "real user wants it" | Adds unattended launch for CC users | M (~40 LOC + tool shim) | Low — already in ecosystem |
| **B — Local desktop bridge** | Deferred indefinitely — 3+ user requests gate | Full OS-level control | L (2–4 wk) | High — permissions, signing, sandbox |
| **D — Anthropic desktop mode** | Research only | Full autonomous desktop | L (integration work) + ongoing compute cost | High — autonomous mouse |

**Rule** (mirrors `PHASE_CA-8_HERMES_DELTA_PLAN.md` non-goals): do not ship B or D without the user explicitly opting into a **per-circle** "desktop automation allowed" setting, and all destructive tools from either path MUST route through `chatApprovalGate` by default (no `alwaysAllow`).

---

## What happened with "open zoom app on my computer" — before vs after

**Before (what the user saw):**
> 🦢 Missing access: `app_tools` — I can't control your desktop or launch local apps from here.
>
> Open Zoom yourself in 2 seconds:
> Mac: `Cmd + Space → type "Zoom" → Enter`

**After (Option A shipped):**
> **Open Zoom** — one of these will work:
>
> 1. Click to launch the native app: [Zoom →](zoommtg://)
> 2. Open in browser: [https://zoom.us](https://zoom.us)
> 3. Keyboard shortcut: `Cmd+Space → "Zoom" → Enter`

The click on link #1 fires the registered OS URL handler — on a Mac with Zoom installed this launches Zoom directly, no agent capability needed.
