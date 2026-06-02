/**
 * desktopBridgeProtocol — pure shape + parser helpers for the
 * desktop-automation endpoints on the Claude Code bridge
 * (`scripts/claude-bridge.js`, Phase 1a). No fetch / no Supabase /
 * no react-native so smoke tests import this in Node.
 *
 * Mirrors the bridge's key-combo parser so clients can validate
 * before issuing a request.
 */

export type DesktopBridgeError =
  | 'bridge_offline'
  | 'not_paired'
  | 'origin_blocked'
  | 'app_not_found'
  | 'path_not_found'
  | 'permission_denied'
  | 'file_access_not_granted'
  | 'platform_unsupported'
  | 'invalid_input'
  | 'timeout'
  | 'human_verification_required'
  | 'browser_bridge_offline'
  | 'browser_dialog_blocked'
  | 'selector_not_found'
  | 'uncertain_ui_target'
  | 'auth_required'
  | 'token_rejected'
  | 'file_not_found'
  | 'missing_permission'
  | 'network_error'
  | 'server_error'
  | 'path_not_allowed'
  | 'stale_bridge'
  // UC-1: returned when the Swift AX helper binary isn't compiled yet.
  // Callers should either prompt the user to rebuild (npm run bridge)
  // or fall back to vision-grounded tools (screenshot + click_at).
  | 'helper_missing'
  | 'unknown';

export interface DesktopHealth {
  ok: boolean;
  platform: string;
  supported: boolean;
  tools: string[];
}

export interface DesktopResult<T = unknown> {
  ok: boolean;
  error?: string;
  errorCode?: DesktopBridgeError;
  recoveryHint?: string;
  requiredEvidence?: string[];
  data?: T;
}

// ─── Key-combo parser (client-side mirror of the bridge parser) ──────────
//
// Lets callers validate combos BEFORE firing the HTTP request so we
// surface a clear error without burning a round-trip. Must stay in
// sync with `keyComboToAppleScript` in `scripts/claude-bridge.js`.

export const DESKTOP_MODIFIERS = new Set([
  'cmd', 'command', 'meta', 'super',
  'shift',
  'opt', 'option', 'alt',
  'ctrl', 'control',
  'fn',
]);

export const DESKTOP_NAMED_KEYS = new Set([
  'return', 'enter', 'tab', 'space', 'delete', 'escape', 'esc',
  'left', 'right', 'down', 'up',
  'home', 'end', 'pageup', 'pagedown', 'page-up', 'page-down',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]);

export const DESKTOP_PUNCTUATION_KEYS = new Set([
  ',', '.', '-', '=', '`', '[', ']',
]);

export function parseKeyCombo(combo: string): { ok: true; modifiers: string[]; key: string } | { ok: false; error: string } {
  if (!combo || typeof combo !== 'string') return { ok: false, error: 'combo must be a string' };
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'empty combo' };
  if (parts.length > 5) return { ok: false, error: 'too many parts (max 5)' };
  const modifiers: string[] = [];
  let key: string | null = null;
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (DESKTOP_MODIFIERS.has(lower)) { modifiers.push(lower); continue; }
    if (key !== null) return { ok: false, error: 'two terminal keys in combo' };
    key = raw;
  }
  if (!key) return { ok: false, error: 'combo has no terminal key' };
  const lowerKey = key.toLowerCase();
  const isNamed = DESKTOP_NAMED_KEYS.has(lowerKey);
  const isChar = /^[a-zA-Z0-9]$/.test(key);
  const isPunctuation = DESKTOP_PUNCTUATION_KEYS.has(key);
  if (!isNamed && !isChar && !isPunctuation) return { ok: false, error: `unknown key "${key}"` };
  return { ok: true, modifiers, key };
}

// ─── AppleScript string escape (client-side preview) ────────────────────

/** Mirrors the bridge's escape so clients can surface the same-
 *  looking error boundaries without a round-trip. Backslash first,
 *  then quote. */
export function escapeAppleScriptString(raw: string): string {
  return String(raw ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ─── App name validation ────────────────────────────────────────────────

/** Matches the bridge's /^[A-Za-z0-9 .\-_()]+$/ regex so invalid names
 *  are rejected before the HTTP round-trip. */
export function isValidAppName(name: string): boolean {
  return typeof name === 'string' && /^[A-Za-z0-9 .\-_()]+$/.test(name.trim()) && name.trim().length > 0;
}

// ─── Phase 1d: URL / path / coordinate validators ─────────────────────────

export type UrlValidationResult =
  | { ok: true; url: string; scheme: 'http' | 'https' | 'file' | 'mailto' }
  | { ok: false; error: string };

/** URL must be http(s)/file/mailto — no shell-style URLs, no javascript:
 *  / data: / etc. that could leak into the shell or browser. Bridge
 *  wraps the final URL in shell-single-quotes when shelling `open` so
 *  quotes can't escape. */
export function validateDesktopUrl(raw: string): UrlValidationResult {
  if (typeof raw !== 'string') return { ok: false, error: 'url must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'url is empty' };
  if (trimmed.length > 2048) return { ok: false, error: 'url exceeds 2048 chars' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'url does not parse' };
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase() as UrlValidationResult extends { ok: true; scheme: infer S } ? S : never;
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'file' && scheme !== 'mailto') {
    return { ok: false, error: `url scheme "${scheme}:" not allowed — use http, https, file, or mailto` };
  }
  // Reject anything with control chars that could break shell quoting
  // even after single-quote wrapping (defense in depth).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'url contains control characters' };
  return { ok: true, url: trimmed, scheme };
}

export type PathValidationResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Paths passed to `open <path>` on macOS. Reject shell metacharacters
 *  so an injected semicolon / backtick can't escalate. The bridge still
 *  single-quotes on top — belt + suspenders. */
export function validateDesktopPath(raw: string): PathValidationResult {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  // Forbid characters that make shell injection plausible. Single-quote
  // wrapping handles most of this in practice, but rejecting up-front
  // gives the caller a clearer error than a mysterious shell failure.
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains shell metacharacter (` $ ; | & > < newline)' };
  return { ok: true, path: trimmed };
}

/** Click coordinates. Must be finite non-negative integers within a
 *  reasonable screen range — clicks at (-1, 0) or at coordinate
 *  5_000_000_000 are definitely mistakes. Actual screen bounds are
 *  validated server-side via `screen_size`. */
export function validateClickCoords(x: unknown, y: unknown): { ok: true; x: number; y: number } | { ok: false; error: string } {
  const xn = Number(x);
  const yn = Number(y);
  if (!Number.isFinite(xn) || !Number.isFinite(yn)) return { ok: false, error: 'x and y must be finite numbers' };
  if (!Number.isInteger(xn) || !Number.isInteger(yn)) return { ok: false, error: 'x and y must be integers' };
  if (xn < 0 || yn < 0) return { ok: false, error: 'x and y must be non-negative' };
  if (xn > 20_000 || yn > 20_000) return { ok: false, error: 'x and y exceed 20 000 px — unlikely target' };
  return { ok: true, x: xn, y: yn };
}
