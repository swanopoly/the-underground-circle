# Desktop Automation — Phase 1 (Claude Code bridge extension)

**Canonical rollout for "launch X app AND type/click/do something in it" from chat.** Companion to `docs/DESKTOP_APP_CAPABILITY_PATHS.md` — that doc names four options (A/B/C/D); this doc implements **Option C**: extend the Claude Code bridge we already ship.

**Last synced:** 2026-04-22

---

## Why Option C, not a new binary

Option B (Tauri/Electron binary) is the "production" path but costs 2–4 weeks and requires signing, notarization, auto-updater, permissions UX. Option C reuses `scripts/claude-bridge.js` — already running on `localhost:7778`, already trusted, already in the Claude Code user's startup. Adding ~300 lines of HTTP handlers + a token-auth gate turns it into a real desktop automation surface today.

When to graduate to Option B: after we see 3+ real users using Phase 1 heavily AND we need cross-machine support OR a circle admin wants to ship the bridge to non-technical teammates.

---

## Security posture — token-gated local endpoints

**Problem.** The existing bridge has `Access-Control-Allow-Origin: *` and no auth because it serves read-only session metadata. Desktop automation endpoints flip the risk profile — any website the user visits could `fetch('http://localhost:7778/desktop/launch', { method:'POST', body: '{"appName":"Terminal"}' })` and get unattended OS-level control.

**Policy.**
1. **Separate token.** Bridge generates a random 32-byte hex token on first startup, writes to `~/.uc-desktop-token` with mode `0600`. Never logged, never echoed, never transmitted in response bodies.
2. **Header-gated.** Every `POST /desktop/*` and `GET /desktop/run*` request must carry `X-UC-Desktop-Token: <token>`. Missing or wrong → `401`. The read-only `GET /desktop/health` is unauthenticated so the UI can detect bridge presence without pairing.
3. **Pairing flow.** UC web app hits `GET /desktop/pair` (which still requires local origin) → bridge returns the token + a prompt the user dismisses in Terminal ("UC is asking to pair — press Enter to allow"). Token gets stored in UC via `localSecrets.ts` (AES-GCM, IndexedDB). First-run only; cached after.
4. **Origin allowlist.** Desktop endpoints check `req.headers.origin` against `['http://localhost:*', 'http://127.0.0.1:*', 'https://app.chrisswanson.xyz']`. Anything else → `403` even with a valid token.
5. **Per-tool HITL gate.** Agents calling desktop tools (Phase 1b) route through `chatApprovalGate` by default. A new auto-approve category `desktop_action` lets the user opt specific apps into `auto` via the HITL banner's "remember this" checkbox (existing CA-8 / Phase CA-6 pattern).
6. **No autonomous clicks in Phase 1.** Launch + type + key-combo only. Mouse clicks, screenshot, and accessibility-tree inspection wait for Phase 1b where the HITL UX is proven.

---

## Phase 1a — plumbing (SHIPPED THIS TURN)

**Bridge endpoints** (Mac-only, all via `osascript`):
- `GET  /desktop/health` — unauthenticated, returns `{ ok:true, platform:'darwin', tools:['launch','type','keys','running_apps'] }`.
- `GET  /desktop/running-apps` — token-gated. Returns `{ apps: [{name, bundleId?, frontmost}] }` via `osascript -e 'tell application "System Events" to get name of every process'`.
- `POST /desktop/launch { appName }` — token-gated. `exec('open -a ' + shQuote(appName))`.
- `POST /desktop/type { text }` — token-gated. Uses `osascript -e 'tell application "System Events" to keystroke "…"'`. `text` is escaped.
- `POST /desktop/keys { combo }` — token-gated. Translates `"Cmd+T"` → AppleScript `key code 17 using command down`. Supports the common ten modifiers + letters / numbers / function keys.

**Client library** (`src/lib/desktopBridge.ts`):
- `isDesktopBridgeAvailable()` — probes `/desktop/health`, returns `boolean`.
- `pairDesktopBridge()` — one-time handshake; stores token in IndexedDB via `localSecrets.ts`.
- `launchApp(name)` / `focusApp(name)` / `typeText(text)` / `pressKeys(combo)` / `listRunningApps()`.
- All return `{ ok:boolean, error?:string, data?:T }` — matches the rest of our lib posture.
- Typed errors (`'not_paired' | 'bridge_offline' | 'app_not_found' | 'permission_denied' | 'unknown'`).

**Smoke tests** (`scripts/desktop-bridge-smoketest.ts`):
- Pure parsing: `parseKeyCombo('Cmd+Shift+T')` → AppleScript stanza.
- Pure escape: `escapeAppleScriptString('he said "hi"')` → properly backslash-escaped.
- Error typology.

**Non-goals for 1a:**
- Screenshot / vision.
- Windows / Linux.
- Accessibility-tree inspection.
- Auto-pairing UI in Settings.
- Agent-tool integration.

---

## Phase 1b — agent-tool wiring (SHIPPED 2026-04-22)

1. **Agent tools shipped** — `src/lib/agentTools/desktopActions.ts` registers five tools with the shared registry:
   - `desktop_launch_app({ appName })` — `open -a` via bridge
   - `desktop_type_text({ text })` — `keystroke "<escaped>"`, ≤ 4 000 chars
   - `desktop_press_keys({ combo })` — `Cmd+T`, `Cmd+Shift+N`, `Return`, `Escape`, etc.
   - `desktop_focus_app({ appName })` — `tell application ... to activate`
   - `desktop_list_running_apps()` — background-only=false process list
   - All five call the live-probe `isDesktopBridgeAvailable()` before firing, and surface structured error-codes (`bridge_offline` / `not_paired` / `permission_denied` / `app_not_found` / `platform_unsupported` / etc.) with actionable hints to the model.
   - Registered via `src/lib/agentTools/index.ts` side-effect import.

2. **HITL category shipped** — `desktop_action` added to `AutoApproveCategory` in `chatAutoApproveSettings.ts` with default `'ask'`. `planCategory()` classifies plans with `route === 'open_app'` / `'desktop'` or `commandText` starting with `/desktop ` into this category. Label `'Desktop apps (launch / type / keys)'` ships in `AUTO_APPROVE_CATEGORY_LABELS`. Users can tick "Remember" on the HITL banner to promote per-category to `'auto'`.

3. **`computerAppAdapter.ts` precedence shipped**: bridge-first resolution. When `run_computer_task` resolves to a known app AND the bridge is reachable, we launch via `bridgeLaunchApp(displayName)` and return `{ kind: 'desktop_bridge_launch', capability: 'desktop_action' }`. If the bridge isn't available or launch fails, we fall through to the existing MCP / URL-scheme / keyboard-hint chain from Phase 1a.

4. **End-to-end flow for "open Zoom and start a new meeting" is now:**
   - Agent plans: `desktop_launch_app({ appName: 'Zoom' })` → first call hits HITL banner → user approves (optionally ticks "Remember for Desktop apps").
   - Agent plans: `desktop_press_keys({ combo: 'Cmd+N' })` → hits HITL again (same category) → approve.
   - Second run after user opts into auto-approve: no gate, pure tool call, instant.

---

## Phase 1c — screenshots + wait_for_app (SHIPPED 2026-04-23)

- **Bridge endpoints shipped.**
  - `GET /desktop/screenshot` — full-screen PNG via `screencapture -T0 -x`, returned as `{ ok, mimeType:'image/png', sizeBytes, base64 }`. Fails cleanly with a "Screen Recording permission required" hint when the Mac blocks it.
  - `POST /desktop/wait_for_app { appName, timeoutMs? }` — polls `System Events` every 250ms; default 5 s, max 30 s. Returns `{ ok, appName, elapsedMs }` on ready, or `ok:false, error:'timeout', waitedMs` on deadline.
  - `/desktop/health` advertises the new tools so the status chip reflects availability.

- **Client library** (`src/lib/desktopBridge.ts`): `takeScreenshot()` returns `{ base64, mimeType, sizeBytes, dataUrl }` ready for `<Image>` / Anthropic vision input. `waitForApp(name, timeoutMs?)` with structured error codes.

- **Agent tools** registered on both surfaces (local + OpenSwan runtime):
  - `desktop.screenshot` / `desktop_screenshot`
  - `desktop.wait_for_app` / `desktop_wait_for_app`
  - Reachable via `main_chat`, `room_chat`, `task_run` surfaces.

- **Auto-chain hardened.** The `runAutoChain` helper in `computerAppAdapter.ts` replaced its `sleep(1200)` race with `waitForApp` — Terminal auto-chain now waits up to 5 s for the app to appear, Zoom up to 8 s. No more keystrokes landing in the wrong app when the user's Mac is under load.

- **Smoke tests extended**: `scripts/desktop-bridge-smoketest.ts` locks down modifier / named-key counts + app-name validator for common wait-for-app targets. All 13 smoke suites green.

- **Out of scope for 1c:** screen-region capture, accessibility-tree dump, mouse click at (x,y), click-by-button-label. Those land in Phase 1d (requires cliclick or equivalent for reliable coord-click; AppleScript "click at" is unreliable on recent macOS).

## Phase 1d — open_url, open_path, click_at, screen_size (SHIPPED 2026-04-23)

Four new bridge endpoints + client helpers + agent tools that cover the most common "do the obvious thing on this Mac" requests without always routing through app launch + keypresses.

- **`POST /desktop/open_url { url }`** — validates scheme (http/https/file/mailto only), rejects javascript:/data:/ftp:/control chars, length-caps at 2048, shells `open <url>`. Client: `openUrl(url)`. Agent tool: `desktop.open_url`.

- **`POST /desktop/open_path { path }`** — validates against shell metacharacters (`` ` $ ; | & > < \n ``) + control chars, length-caps at 1024, shells `open <path>`. Surfaces `path_not_found` as a typed errorCode. Client: `openPath(path)`. Agent tool: `desktop.open_path`. Covers "open ~/Downloads", "open my README.md", "reveal the .app in Finder", etc.

- **`POST /desktop/click_at { x, y }`** — prefers `cliclick` when installed (reliable), falls back to AppleScript `System Events click at {x, y}` (best-effort, often silent-fails on macOS 13+). Coords validated integer 0..20000. `/desktop/health` now exposes `optional.cliclick: true|false` so clients can decide whether to attempt. Client: `clickAt(x, y)`. Agent tool: `desktop.click_at`. Installing `cliclick` (`brew install cliclick`) upgrades reliability.

- **`GET /desktop/screen_size`** — returns `{ width, height }` from `Finder` bounds. Fast (< 100 ms). Client: `getScreenSize()`. Agent tool: `desktop.screen_size`. Call it before `desktop.click_at` to bound coords.

- **Policy refined.** `desktop.screen_size`, `desktop.screenshot`, `desktop.wait_for_app`, and `desktop.list_running_apps` are `approvalMode: 'auto'` (read-only observers). All write paths (`launch / focus / type / keys / click / open_url / open_path`) stay `approvalMode: 'ask'` under the `desktop_action` category.

- **Validators live in `src/lib/desktopBridgeProtocol.ts`** + mirrored server-side in `claude-bridge.js` (can't share imports across JS/TS boundary). Smoke test locks: 5 URL-accept cases · 7 URL-reject cases · 6 path-accept cases · 9 path-reject cases · 7 coord cases.

## Phase 1e — click by button label + a11y tree (LATER)

Needed for:
- Autonomous UI navigation ("find the 'New Meeting' button and click it").
- Agent vision verification that an action took effect.
- Form fill where field IDs vary per app.

Plumbing:
- `/desktop/screenshot` → base64 PNG via `screencapture -T0 -x`.
- `/desktop/ui-tree { appName }` → AppleScript dump of the frontmost app's UI-element tree.
- Client wrappers + agent tools.

This is the point where Option B (dedicated Tauri binary) becomes worth considering — screen-recording on Mac needs Accessibility + Screen Recording permissions, which are ugly prompts for a `node` binary vs a signed app.

---

## Conflicts with existing plans

1. **`PHASE_CA-8_AGENT_RUNTIME_DELTA_PLAN.md` non-goal "`execute_code`".** Desktop automation IS power-user surface area but is narrower — the agent calls typed tools, not arbitrary Python. `execute_code` stays deferred; `desktop_*` tools are OK because the catalog is bounded and HITL-gated.
2. **Memory / approval category proliferation.** New `desktop_action` joins `memory_read/write`, `skill_run/write`, `automation_create/run`, `browser_click`, `external_publish`. Cap at ~10 categories — if we add much more we need a "category family" abstraction.
3. **Claude Code bridge mandate.** The bridge already reads `~/.claude/projects` — adding desktop-control responsibility means the bridge is now a trust boundary, not just a session viewer. Document this. If users don't want desktop automation, don't pair; the bridge keeps working for its original purpose.

---

## Definition of done — Phase 1a

- [x] Bridge has `/desktop/health`, `/desktop/running-apps`, `/desktop/launch`, `/desktop/type`, `/desktop/keys` with token auth.
- [x] `~/.uc-desktop-token` generated + persisted at 0600.
- [x] `src/lib/desktopBridge.ts` exposes typed client API.
- [x] Smoke tests green for pure key-combo parser + AppleScript escape + error typology.
- [x] Plan doc references from `AGENTS_ROADMAP.md`.
- [ ] Phase 1b: agent tool wiring (next turn).
- [ ] Phase 1c: screenshot + a11y tree (later, evaluate Tauri then).
