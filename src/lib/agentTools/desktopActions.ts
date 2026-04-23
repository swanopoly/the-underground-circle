/**
 * agentTools/desktopActions — agent tool wrappers for the Claude Code
 * bridge's desktop-automation endpoints (Phase 1b of
 * `docs/DESKTOP_AUTOMATION_PHASE_1_PLAN.md`).
 *
 * Five tools exposed to the model:
 *
 *   desktop_launch_app       — `open -a "<appName>"`
 *   desktop_focus_app        — `tell application "<appName>" to activate`
 *   desktop_type_text        — `keystroke "<escaped>"`
 *   desktop_press_keys       — `key code N using {modifiers}` for combos
 *   desktop_list_running_apps — background-only=false process list
 *
 * Every tool call runs through the existing `chatApprovalGate` under
 * the `desktop_action` auto-approve category (default `ask`). Users
 * can opt "remember this" per-circle to promote to `auto` via the
 * HITL banner UI (shipped in CA-6).
 *
 * Execution layer = `src/lib/desktopBridge.ts` which handles token
 * auth + HTTP transport. This file is just the MODEL-facing tool
 * definitions + thin passthrough.
 */

import {
  isDesktopBridgeAvailable,
  launchApp,
  focusApp,
  typeText,
  pressKeys,
  listRunningApps,
  waitForApp,
  takeScreenshot,
  type DesktopBridgeError,
} from '../desktopBridge';
import { registerTool } from './registry';

// ─── Shared helpers ────────────────────────────────────────────────────────

/** Default failure shape — adds a uniform hint so the model knows when
 *  the bridge is simply unreachable vs. a legit failure inside the
 *  action. */
function mapError(error: string | undefined, code?: DesktopBridgeError): string {
  const base = error || 'desktop bridge call failed';
  switch (code) {
    case 'bridge_offline':
      return `${base}. Claude Code bridge not reachable at localhost:7778. Start the bridge: \`node scripts/claude-bridge.js\`.`;
    case 'not_paired':
      return `${base}. Desktop bridge not paired. Run pairing once from the UC web app.`;
    case 'platform_unsupported':
      return `${base}. Desktop automation is macOS-only in Phase 1a.`;
    case 'app_not_found':
      return `${base}. That app isn't installed or the name doesn't match the .app bundle.`;
    case 'permission_denied':
      return (
        `${base}. macOS Accessibility permission is required for keystrokes and key combos. ` +
        `Open System Settings → Privacy & Security → Accessibility and enable it for whichever shell is ` +
        `running the bridge (Terminal.app or iTerm). After granting, ask me to retry the same action — ` +
        `no re-pairing needed.`
      );
    case 'invalid_input':
      return `${base}. Check the tool's argument schema.`;
    default:
      return base;
  }
}

async function requireBridgeAvailable() {
  const ok = await isDesktopBridgeAvailable();
  if (!ok) {
    return {
      ok: false as const,
      error:
        'Desktop automation is not available — Claude Code bridge is offline or on an unsupported platform. ' +
        "Start the bridge (`node scripts/claude-bridge.js`) and ensure you're on macOS.",
    };
  }
  return null;
}

// ─── desktop_launch_app ────────────────────────────────────────────────────

interface LaunchInput { appName: string; }

function isLaunchInput(value: unknown): value is LaunchInput {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as any).appName === 'string' && (value as any).appName.length > 0;
}

registerTool({
  name: 'desktop_launch_app',
  description:
    "Opens a native desktop application by name on the user's Mac via the " +
    "Claude Code bridge. Requires the bridge running locally and a paired " +
    "desktop token. Example appNames: \"Zoom\", \"Slack\", \"Visual Studio Code\", " +
    "\"Notion\". Use desktop_list_running_apps to see what's already open. " +
    "Each call hits the HITL approval banner unless the user has auto- " +
    "approved the `desktop_action` category.",
  input_schema: {
    type: 'object',
    properties: {
      appName: {
        type: 'string',
        description:
          "Exact .app name as shown in /Applications (case-insensitive). " +
          "Letters, numbers, space, `.`, `-`, `_`, `(`, `)` only.",
      },
    },
    required: ['appName'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isLaunchInput(input)) return { ok: false, error: 'desktop_launch_app: expected { appName }.' };
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await launchApp(input.appName);
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { appName: r.data?.appName || input.appName } };
  },
});

// ─── desktop_focus_app ─────────────────────────────────────────────────────

registerTool({
  name: 'desktop_focus_app',
  description:
    "Brings an already-running app to the foreground. If the app isn't " +
    "running, prefer desktop_launch_app instead (launch will also focus).",
  input_schema: {
    type: 'object',
    properties: { appName: { type: 'string', description: 'App name to focus.' } },
    required: ['appName'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isLaunchInput(input)) return { ok: false, error: 'desktop_focus_app: expected { appName }.' };
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await focusApp(input.appName);
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { appName: r.data?.appName || input.appName } };
  },
});

// ─── desktop_type_text ─────────────────────────────────────────────────────

interface TypeInput { text: string; }

function isTypeInput(value: unknown): value is TypeInput {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as any).text === 'string';
}

registerTool({
  name: 'desktop_type_text',
  description:
    "Types text into whatever app currently has focus, via System Events " +
    "keystroke. Use desktop_focus_app first to target a specific app. " +
    "Max 4000 chars per call. Newlines in `text` are typed as \\n (Return " +
    "character); prefer desktop_press_keys with combo=\"Return\" for " +
    "explicit submits.",
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to type. Max 4000 chars per call.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isTypeInput(input)) return { ok: false, error: 'desktop_type_text: expected { text }.' };
    if (input.text.length === 0) return { ok: false, error: 'desktop_type_text: text is empty.' };
    if (input.text.length > 4000) return { ok: false, error: 'desktop_type_text: text exceeds 4000-char cap per call.' };
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await typeText(input.text);
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { chars: r.data?.chars ?? input.text.length } };
  },
});

// ─── desktop_press_keys ────────────────────────────────────────────────────

interface KeysInput { combo: string; }

function isKeysInput(value: unknown): value is KeysInput {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as any).combo === 'string' && (value as any).combo.length > 0;
}

registerTool({
  name: 'desktop_press_keys',
  description:
    "Presses a key combination like `Cmd+T`, `Cmd+Shift+N`, `Return`, " +
    "`Escape`. Modifiers: Cmd, Shift, Opt/Alt, Ctrl, Fn. Terminal keys: " +
    "any single letter / digit, or named keys Return / Tab / Space / " +
    "Delete / Escape / Left / Right / Up / Down / F1-F12. Chain multiple " +
    "calls in sequence for multi-step flows (e.g. `Cmd+N` then `Cmd+S`).",
  input_schema: {
    type: 'object',
    properties: {
      combo: {
        type: 'string',
        description: 'Key combo string. Examples: "Cmd+T", "Cmd+Shift+N", "Return", "Escape".',
      },
    },
    required: ['combo'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isKeysInput(input)) return { ok: false, error: 'desktop_press_keys: expected { combo }.' };
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await pressKeys(input.combo);
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { combo: r.data?.combo || input.combo } };
  },
});

// ─── desktop_list_running_apps ─────────────────────────────────────────────

registerTool({
  name: 'desktop_list_running_apps',
  description:
    "Lists foreground (non-background) apps currently running on the user's " +
    "Mac. Useful to decide between desktop_launch_app and desktop_focus_app. " +
    "Read-only — returns app names only, no window contents.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await listRunningApps();
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { apps: r.data || [] } };
  },
});

// ─── Phase 1c: screenshot + wait_for_app ───────────────────────────────────

interface WaitForAppInput { appName: string; timeoutMs?: number; }
function isWaitForAppInput(v: unknown): v is WaitForAppInput {
  if (!v || typeof v !== 'object') return false;
  const x = v as any;
  return typeof x.appName === 'string' && x.appName.length > 0 &&
    (x.timeoutMs === undefined || typeof x.timeoutMs === 'number');
}

registerTool({
  name: 'desktop_wait_for_app',
  description:
    "Polls the running-app list every 250ms until `appName` appears, or " +
    "the timeout expires. Use after desktop_launch_app to ensure keystrokes " +
    "land in the newly-launched app instead of whichever app was frontmost " +
    "when launch fired. Default timeout 5000ms; max 30000ms.",
  input_schema: {
    type: 'object',
    properties: {
      appName: { type: 'string', description: 'App name to wait for.' },
      timeoutMs: { type: 'number', description: 'Max wait. 500..30000; default 5000.' },
    },
    required: ['appName'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isWaitForAppInput(input)) return { ok: false, error: 'desktop_wait_for_app: expected { appName, timeoutMs? }.' };
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await waitForApp(input.appName, input.timeoutMs);
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return { ok: true, data: { appName: r.data?.appName || input.appName, elapsedMs: r.data?.elapsedMs ?? 0 } };
  },
});

registerTool({
  name: 'desktop_screenshot',
  description:
    "Captures a full-screen PNG via macOS `screencapture`. Returns base64 " +
    "+ byte size. Use after a desktop action to verify it took effect " +
    "(e.g. confirm Zoom is showing the New Meeting dialog, confirm a " +
    "form field is focused). First call may prompt for macOS Screen " +
    "Recording permission — grant it to whichever Terminal is running " +
    "the bridge.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    const offline = await requireBridgeAvailable();
    if (offline) return offline;
    const r = await takeScreenshot();
    if (!r.ok) return { ok: false, error: mapError(r.error, r.errorCode) };
    return {
      ok: true,
      data: {
        sizeBytes: r.data?.sizeBytes ?? 0,
        mimeType: r.data?.mimeType || 'image/png',
        // Omit the raw base64 from the default response — it's huge.
        // Callers that need the image bytes call takeScreenshot() directly.
        base64Preview: (r.data?.base64 || '').slice(0, 64) + '…',
        dataUrl: r.data?.dataUrl,
      },
    };
  },
});
