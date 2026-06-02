/**
 * browserBridge — client for the local Playwright-backed /browser/*
 * endpoints. Mirrors the shape of `desktopBridge.ts` so agents see a
 * unified surface: probe with `isBrowserBridgeAvailable`, then
 * `openUrl`, `domSnapshot`, `clickRole`, `fillField`, `pressKey`,
 * `screenshot`, `closeBrowser`.
 *
 * Why a separate module: browser automation talks DOM/ARIA instead of
 * AX, has a different lifetime (persistent context + page), and uses
 * CSS/role-based selectors rather than dotted AX paths. Sharing the
 * same `callBridge` / token / error codes keeps the auth + CORS story
 * consistent.
 *
 * Context scope: the bridge launches **one** persistent Chromium
 * context backed by `~/Library/Application Support/UC/ChromeProfile`.
 * That's deliberately separate from the user's real Chrome profile so
 * we never corrupt their primary browsing session — the user logs in
 * once to sites they want UC to automate, and those logins persist
 * inside the UC profile forever.
 */
import type { DesktopResult } from './desktopBridgeProtocol';
import { getBridgeUrl } from './bridgeEnvironment';
import { describeBrowserBridgeFailure, type BrowserBridgeFailure } from './browserBridgeFailure';
import { ensureDesktopBridgePaired } from './desktopBridge';
import type { AutomationVerificationGate } from './desktopAutomationSafety';

const BRIDGE_PORT = 7778;
const TOKEN_KEY = 'uc_desktop_bridge_token_v1';

function getBrowserBridgeBaseUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function normalizeRequiredEvidence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const evidence = value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  return evidence.length > 0 ? evidence : undefined;
}

function parseBridgeErrorBody(text: string): { error?: string; errorCode?: string; recoveryHint?: string; requiredEvidence?: string[] } {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return {
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        errorCode: typeof parsed.errorCode === 'string' ? parsed.errorCode : undefined,
        recoveryHint: typeof parsed.recoveryHint === 'string' ? parsed.recoveryHint : undefined,
        requiredEvidence: normalizeRequiredEvidence((parsed as { requiredEvidence?: unknown }).requiredEvidence),
      };
    }
  } catch {}
  return { error: text };
}

function browserFailureResult<T>(
  failure: BrowserBridgeFailure,
  override?: { recoveryHint?: string; requiredEvidence?: string[] },
): DesktopResult<T> {
  return {
    ok: false,
    error: failure.message,
    errorCode: failure.errorCode,
    recoveryHint: override?.recoveryHint || failure.recoveryHint,
    requiredEvidence: override?.requiredEvidence || failure.requiredEvidence,
  };
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface BrowserHealth {
  ok: boolean;
  playwright: string;            // "1.59.1"
  chromeChannel: string;         // "chrome" | "chromium"
  profileDir: string;
  contextOpen: boolean;
  currentUrl: string | null;
  currentTitle: string | null;
}

/**
 * A single node from the DOM accessibility snapshot. Shape mirrors
 * Playwright's accessibility.snapshot() so we can pass it through
 * with minimal re-shaping on the bridge side.
 */
export interface BrowserA11yNode {
  id: string;                    // dotted path from root, like AX tree
  role: string;                  // ARIA role
  name?: string;                 // accessible name
  value?: string;
  level?: number;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  disabled?: boolean;
  focused?: boolean;
  expanded?: boolean;
  selected?: boolean;
  children?: BrowserA11yNode[];
}

export interface DomSnapshotResult {
  url: string;
  title: string;
  nodeCount: number;
  tree: BrowserA11yNode;
}

export interface BrowserVerificationState {
  url: string;
  title: string;
  verificationDetected: boolean;
  gate: AutomationVerificationGate | null;
  selectorMatches: string[];
  matchedTerms: string[];
  pauseInstruction?: string;
}

// ─── Calls ──────────────────────────────────────────────────────────────

async function callBrowser<T = unknown>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<DesktopResult<T>> {
  const base = getBrowserBridgeBaseUrl();
  if (!base) {
    return browserFailureResult(describeBrowserBridgeFailure('Browser bridge unavailable in this environment.', 'bridge_offline'));
  }
  let token = readToken();
  if (!token) {
    const paired = await ensureDesktopBridgePaired();
    if (!paired.ok) {
      return browserFailureResult(describeBrowserBridgeFailure(
        paired.error || 'Desktop bridge not paired. Pair first via `/desktop diag`.',
        paired.errorCode || 'not_paired',
      ));
    }
    token = paired.data?.token || null;
  }
  if (!token) {
    return browserFailureResult(describeBrowserBridgeFailure('Desktop bridge not paired. Pair first via `/desktop diag`.', 'not_paired'));
  }
  try {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-UC-Desktop-Token': token,
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const parsed = parseBridgeErrorBody(text);
      if (res.status === 401) {
        const failure = describeBrowserBridgeFailure(parsed.error || 'Token rejected.', parsed.errorCode || 'token_rejected');
        return browserFailureResult(failure, parsed);
      }
      if (res.status === 503) {
        const failure = describeBrowserBridgeFailure(parsed.error || 'Browser not started', parsed.errorCode || 'browser_bridge_offline');
        return browserFailureResult(failure, parsed);
      }
      const failure = describeBrowserBridgeFailure(parsed.error || `HTTP ${res.status}`, parsed.errorCode);
      return browserFailureResult(failure, parsed);
    }
    const json = await res.json();
    if (!json?.ok) {
      const failure = describeBrowserBridgeFailure(json?.error || 'bridge returned ok:false', json?.errorCode);
      return browserFailureResult(failure, {
        recoveryHint: typeof json?.recoveryHint === 'string' ? json.recoveryHint : undefined,
        requiredEvidence: normalizeRequiredEvidence(json?.requiredEvidence),
      });
    }
    return { ok: true, data: json as T };
  } catch (err: any) {
    const failure = describeBrowserBridgeFailure(err?.message || 'bridge unreachable', 'bridge_offline');
    return browserFailureResult(failure);
  }
}

export async function isBrowserBridgeAvailable(): Promise<boolean> {
  const base = getBrowserBridgeBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/browser/health`, { cache: 'no-store' });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return !!json?.ok;
  } catch { return false; }
}

export async function getBrowserHealth(): Promise<BrowserHealth | null> {
  const base = getBrowserBridgeBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/browser/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as BrowserHealth;
  } catch { return null; }
}

/**
 * Navigate the persistent browser context to `url`. Opens the context
 * on first call. Returns the final URL (after redirects) and title.
 */
export async function openUrl(url: string, opts?: { timeoutMs?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; taskContext?: string }): Promise<DesktopResult<{ url: string; title: string }>> {
  if (!/^https?:\/\//i.test(url)) {
    return browserFailureResult(describeBrowserBridgeFailure('url must start with http(s)://', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/open_url', { url, ...opts });
}

/**
 * Returns the current page's accessibility tree (via Playwright's
 * `accessibility.snapshot()`), pruned to addressable nodes + flattened
 * with dotted-path IDs matching the a11y-tree convention.
 */
export async function domSnapshot(opts?: { maxNodes?: number; interestingOnly?: boolean }): Promise<DesktopResult<DomSnapshotResult>> {
  const params = new URLSearchParams();
  if (typeof opts?.maxNodes === 'number') params.set('max_nodes', String(opts.maxNodes));
  if (opts?.interestingOnly === false) params.set('interesting', 'false');
  const qs = params.toString();
  return callBrowser('GET', `/browser/dom_snapshot${qs ? `?${qs}` : ''}`);
}

/**
 * Checks the current browser page for CAPTCHA, anti-bot, Cloudflare,
 * MFA, or other human verification gates. This is intentionally
 * read-only: callers should pause and ask the user to complete the gate
 * manually when `verificationDetected` is true.
 */
export async function verificationState(): Promise<DesktopResult<BrowserVerificationState>> {
  return callBrowser('GET', '/browser/verification_state');
}

/**
 * Click an element by ARIA role + accessible name — Playwright's
 * canonical `getByRole(role, { name })` path. Prefer this over
 * raw CSS selectors because it survives design changes. When the
 * page has no useful accessible name, pass `selector` instead and
 * the bridge routes through `page.locator(selector)`.
 */
export async function clickRole(args: {
  role: string;
  name?: string;
  /** Explicit CSS selector — alternative to (role + name). The
   *  bridge also auto-detects when `name` is a CSS selector and
   *  routes to locator(), so passing a selector via either field
   *  works. Explicit `selector` is preferred. */
  selector?: string;
  exact?: boolean;
  nth?: number;
  timeoutMs?: number;
  taskContext?: string;
}): Promise<DesktopResult<{ role: string; name?: string }>> {
  const role = String(args.role || '').trim();
  if (!role) return browserFailureResult(describeBrowserBridgeFailure('role required', 'invalid_input'));
  return callBrowser('POST', '/browser/click_role', args);
}

/**
 * Fill a form field by role + name (same selector discipline as
 * clickRole). `text` is typed; use `pressKey('Enter')` for submit
 * separately unless `submit: true` is set.
 */
export async function fillField(args: {
  role: string;
  name?: string;
  /** Explicit CSS selector — alternative to (role + name). See
   *  clickRole for the full story. */
  selector?: string;
  text: string;
  submit?: boolean;
  exact?: boolean;
  timeoutMs?: number;
  taskContext?: string;
}): Promise<DesktopResult<{ chars: number }>> {
  if (typeof args.text !== 'string') {
    return browserFailureResult(describeBrowserBridgeFailure('text required', 'invalid_input'));
  }
  if (args.text.length > 4000) {
    return browserFailureResult(describeBrowserBridgeFailure('text too long (max 4000)', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/fill', args);
}

/** Select an option in a native select/combobox field. */
export async function selectOption(args: {
  role?: string;
  name?: string;
  selector?: string;
  value: string;
  exact?: boolean;
  timeoutMs?: number;
  taskContext?: string;
}): Promise<DesktopResult<{ value: string }>> {
  if (typeof args.value !== 'string' || !args.value.trim()) {
    return browserFailureResult(describeBrowserBridgeFailure('value required', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/select', { role: args.role || 'combobox', ...args });
}

/** Upload a local file into a browser file input or file chooser. */
export async function uploadFile(args: {
  filePath: string;
  name?: string;
  selector?: string;
  buttonRole?: string;
  buttonName?: string;
  buttonSelector?: string;
  exact?: boolean;
  timeoutMs?: number;
  taskContext?: string;
}): Promise<DesktopResult<{ filePath: string; fileName: string; sizeBytes: number; method: string }>> {
  const filePath = String(args.filePath || '').trim();
  if (!filePath) return browserFailureResult(describeBrowserBridgeFailure('filePath required', 'invalid_input'));
  if (filePath.length > 1024 || /[\x00-\x1f]/.test(filePath)) {
    return browserFailureResult(describeBrowserBridgeFailure('invalid filePath', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/upload_file', { ...args, filePath });
}

/** Press a single key or combo via Playwright's keyboard.press. */
export async function pressKey(combo: string, opts?: { taskContext?: string }): Promise<DesktopResult<{ combo: string }>> {
  if (typeof combo !== 'string' || !combo.trim()) {
    return browserFailureResult(describeBrowserBridgeFailure('combo required', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/press', { combo, taskContext: opts?.taskContext });
}

/** Full-page screenshot as base64 PNG. */
export async function screenshot(opts?: { fullPage?: boolean }): Promise<DesktopResult<{ base64: string; mimeType: string; sizeBytes: number }>> {
  return callBrowser('POST', '/browser/screenshot', opts || {});
}

/** Close the browser context (not usually needed — it persists across requests). */
export async function closeBrowser(): Promise<DesktopResult<{ closed: boolean }>> {
  return callBrowser('POST', '/browser/close');
}

/**
 * Flatten a DOM a11y tree the same way we flatten the desktop AX tree:
 * one indented line per node so the model sees semantic structure.
 */
export function renderBrowserTree(node: BrowserA11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  const parts = [`${indent}[${node.id}]`, node.role];
  if (node.name) parts.push(`"${node.name.replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.name) parts.push(`= "${String(node.value).replace(/"/g, '\\"').slice(0, 80)}"`);
  const flags: string[] = [];
  if (node.checked === true) flags.push('checked');
  if (node.pressed === true) flags.push('pressed');
  if (node.disabled) flags.push('disabled');
  if (node.selected) flags.push('selected');
  if (node.expanded === false) flags.push('collapsed');
  if (flags.length) parts.push(`(${flags.join(',')})`);
  out.push(parts.join(' '));
  for (const child of node.children || []) {
    renderBrowserTree(child, depth + 1, out);
  }
  return out;
}
