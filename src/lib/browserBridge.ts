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

const BRIDGE_PORT = 7778;
const TOKEN_KEY = 'uc_desktop_bridge_token_v1';

function getBrowserBridgeBaseUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
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

// ─── Calls ──────────────────────────────────────────────────────────────

async function callBrowser<T = unknown>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<DesktopResult<T>> {
  const base = getBrowserBridgeBaseUrl();
  if (!base) {
    return { ok: false, error: 'Browser bridge unavailable in this environment.', errorCode: 'bridge_offline' };
  }
  const token = readToken();
  if (!token) {
    return { ok: false, error: 'Desktop bridge not paired. Pair first via `/desktop diag`.', errorCode: 'not_paired' };
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
      if (res.status === 401) return { ok: false, error: 'Token rejected.', errorCode: 'not_paired' };
      if (res.status === 503) return { ok: false, error: text || 'Browser not started', errorCode: 'unknown' };
      return { ok: false, error: text || `HTTP ${res.status}`, errorCode: 'unknown' };
    }
    const json = await res.json();
    if (!json?.ok) {
      return { ok: false, error: json?.error || 'bridge returned ok:false', errorCode: 'unknown' };
    }
    return { ok: true, data: json as T };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'bridge unreachable', errorCode: 'bridge_offline' };
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
export async function openUrl(url: string, opts?: { timeoutMs?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<DesktopResult<{ url: string; title: string }>> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'url must start with http(s)://', errorCode: 'invalid_input' };
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
}): Promise<DesktopResult<{ role: string; name?: string }>> {
  const role = String(args.role || '').trim();
  if (!role) return { ok: false, error: 'role required', errorCode: 'invalid_input' };
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
}): Promise<DesktopResult<{ chars: number }>> {
  if (typeof args.text !== 'string') {
    return { ok: false, error: 'text required', errorCode: 'invalid_input' };
  }
  if (args.text.length > 4000) {
    return { ok: false, error: 'text too long (max 4000)', errorCode: 'invalid_input' };
  }
  return callBrowser('POST', '/browser/fill', args);
}

/** Press a single key or combo via Playwright's keyboard.press. */
export async function pressKey(combo: string): Promise<DesktopResult<{ combo: string }>> {
  if (typeof combo !== 'string' || !combo.trim()) {
    return { ok: false, error: 'combo required', errorCode: 'invalid_input' };
  }
  return callBrowser('POST', '/browser/press', { combo });
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
