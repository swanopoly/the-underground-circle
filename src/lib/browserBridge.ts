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
import { sanitizeUntrustedForModel } from './untrustedContent';
import type { AutomationVerificationGate } from './desktopAutomationSafety';
import {
  buildWordPressAdminSourceTaskHints,
  extractWordPressAdminSourceIntelligence,
  type WordPressAdminSourceIntelligence,
} from './wordpressAdminSourceIntelligence';

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

function normalizeAmbiguousCandidates(value: unknown): AmbiguousLocatorCandidate[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const candidates = value
    .filter((item) => item && typeof item === 'object')
    .slice(0, 5)
    .map((item: any) => {
      const candidate: AmbiguousLocatorCandidate = { role: String(item.role || 'unknown').slice(0, 60) };
      if (typeof item.name === 'string' && item.name) candidate.name = item.name.slice(0, 120);
      if (typeof item.snippet === 'string' && item.snippet) candidate.snippet = item.snippet.slice(0, 120);
      return candidate;
    });
  return candidates.length > 0 ? candidates : undefined;
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
  /** Total nodes the walk would have visited with unlimited budget.
   *  Present on bridges that report it; equals nodeCount otherwise. */
  totalNodes?: number;
  /** True when the snapshot hit the node budget and dropped part of
   *  the page. Callers must surface this so the model narrows scope
   *  instead of concluding an element does not exist. */
  truncated?: boolean;
  tree: BrowserA11yNode;
}

export interface BrowserPageSourceResult {
  url: string;
  title: string;
  sourceLength: number;
  truncated: boolean;
  maxChars: number;
  source: string;
}

export interface BrowserWordPressAdminSourceIntelligenceResult {
  url: string;
  title: string;
  sourceLength: number;
  sourceTruncated: boolean;
  intelligence: WordPressAdminSourceIntelligence;
  taskHints: string[];
}

/** One candidate from an ambiguous-locator error (≤5 are returned). */
export interface AmbiguousLocatorCandidate {
  role: string;
  name?: string;
  snippet?: string;
}

/**
 * Browser action results can carry structured disambiguation /
 * verification payloads on failure, on top of the shared
 * `DesktopResult` shape:
 *  - errorCode 'ambiguous_locator' → `matches` + `candidates`
 *  - errorCode 'verification_gate' → `verificationGate`
 */
export type BrowserActionResult<T> = DesktopResult<T> & {
  matches?: number;
  candidates?: AmbiguousLocatorCandidate[];
  verificationGate?: { kind: string; label?: string; hint: string };
};

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
      // Structured ambiguity errors carry machine-readable candidates;
      // preserve them verbatim instead of flattening through the
      // generic failure classifier (which would re-bucket the code).
      if (json?.errorCode === 'ambiguous_locator') {
        return {
          ok: false,
          error: typeof json.error === 'string' ? json.error : 'ambiguous locator',
          errorCode: 'ambiguous_locator',
          recoveryHint: typeof json.recoveryHint === 'string' ? json.recoveryHint : undefined,
          requiredEvidence: normalizeRequiredEvidence(json.requiredEvidence),
          matches: Number.isFinite(Number(json.matches)) ? Number(json.matches) : undefined,
          candidates: normalizeAmbiguousCandidates(json.candidates),
        } as BrowserActionResult<T>;
      }
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

async function pageSource(opts?: { maxChars?: number }): Promise<DesktopResult<BrowserPageSourceResult>> {
  const params = new URLSearchParams();
  if (typeof opts?.maxChars === 'number') params.set('max_chars', String(opts.maxChars));
  const qs = params.toString();
  return callBrowser('GET', `/browser/page_source${qs ? `?${qs}` : ''}`);
}

export async function readWordPressAdminSourceIntelligence(opts?: {
  maxChars?: number;
  maxMenuItems?: number;
  maxRows?: number;
}): Promise<DesktopResult<BrowserWordPressAdminSourceIntelligenceResult>> {
  const source = await pageSource({ maxChars: opts?.maxChars });
  if (!source.ok || !source.data) {
    return {
      ok: false,
      error: source.error || 'Browser page source failed',
      errorCode: source.errorCode,
      recoveryHint: source.recoveryHint,
      requiredEvidence: source.requiredEvidence,
    };
  }
  const intelligence = extractWordPressAdminSourceIntelligence(source.data.source, {
    maxMenuItems: opts?.maxMenuItems,
    maxRows: opts?.maxRows,
  });
  return {
    ok: true,
    data: {
      url: source.data.url,
      title: source.data.title,
      sourceLength: source.data.sourceLength,
      sourceTruncated: source.data.truncated,
      intelligence,
      taskHints: buildWordPressAdminSourceTaskHints(intelligence),
    },
  };
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

const VERIFICATION_GATE_HINT =
  'pause and ask the user to complete it — do not attempt to bypass';

/**
 * Cheap auto-check that runs before every mutating browser action
 * (click/fill/select/upload). If the current page shows a human
 * verification gate (CAPTCHA / MFA / bot check / login challenge),
 * the mutation is refused with a structured `verification_gate`
 * error so the model pauses and hands the gate to the user — same
 * fail-to-the-human rule as the D5 takeover pattern; bypassing is
 * never attempted. Pass `skipVerificationCheck: true` for the rare
 * legitimate case (e.g. the user just confirmed they completed the
 * gate and the leftover challenge markup is inert).
 *
 * Fail-open on check errors: if `verificationState()` itself fails,
 * the action proceeds — the bridge server still runs its own
 * verification guard before mutating, so this never weakens safety.
 */
async function preMutationVerificationGate<T>(skipVerificationCheck?: boolean): Promise<BrowserActionResult<T> | null> {
  if (skipVerificationCheck === true) return null;
  let state: DesktopResult<BrowserVerificationState>;
  try {
    state = await verificationState();
  } catch {
    return null;
  }
  if (!state.ok || !state.data?.verificationDetected) return null;
  const gate = state.data.gate;
  const kind = String(gate?.kind || 'verification');
  const label = String(gate?.label || 'Human verification');
  return {
    ok: false,
    error: `verification_gate: ${label} detected on ${state.data.url || 'the current page'} — ${VERIFICATION_GATE_HINT}.`,
    errorCode: 'verification_gate',
    recoveryHint: `${label} (${kind}) is blocking this page: ${VERIFICATION_GATE_HINT}. Re-check verificationState after the user confirms it is done.`,
    requiredEvidence: ['browser.verification_state', 'user.complete_browser_verification'],
    verificationGate: { kind, label, hint: VERIFICATION_GATE_HINT },
  };
}

/**
 * Click an element by ARIA role + accessible name — Playwright's
 * canonical `getByRole(role, { name })` path. Prefer this over
 * raw CSS selectors because it survives design changes. When the
 * page has no useful accessible name, pass `selector` instead and
 * the bridge routes through `page.locator(selector)`.
 *
 * If the locator matches more than one element and no `nth` is
 * given, the bridge refuses to act and returns errorCode
 * `ambiguous_locator` with `matches` + up to 5 `candidates` —
 * retry with the right 0-based `nth` (or a tighter selector).
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
  /** 0-based index to disambiguate when the locator matches
   *  multiple elements. Without it, multi-match returns
   *  `ambiguous_locator` instead of clicking the first match. */
  nth?: number;
  timeoutMs?: number;
  taskContext?: string;
  /** Skip the pre-mutation verification-gate check. Only for the
   *  rare legit case — never to bypass a live gate. */
  skipVerificationCheck?: boolean;
}): Promise<BrowserActionResult<{ role: string; name?: string }>> {
  const role = String(args.role || '').trim();
  if (!role) return browserFailureResult(describeBrowserBridgeFailure('role required', 'invalid_input'));
  const gate = await preMutationVerificationGate<{ role: string; name?: string }>(args.skipVerificationCheck);
  if (gate) return gate;
  const { skipVerificationCheck: _skip, ...body } = args;
  return callBrowser('POST', '/browser/click_role', body);
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
  /** 0-based disambiguator for multi-match locators — see clickRole. */
  nth?: number;
  timeoutMs?: number;
  taskContext?: string;
  /** Skip the pre-mutation verification-gate check. See clickRole. */
  skipVerificationCheck?: boolean;
}): Promise<BrowserActionResult<{ chars: number }>> {
  if (typeof args.text !== 'string') {
    return browserFailureResult(describeBrowserBridgeFailure('text required', 'invalid_input'));
  }
  if (args.text.length > 4000) {
    return browserFailureResult(describeBrowserBridgeFailure('text too long (max 4000)', 'invalid_input'));
  }
  const gate = await preMutationVerificationGate<{ chars: number }>(args.skipVerificationCheck);
  if (gate) return gate;
  const { skipVerificationCheck: _skip, ...body } = args;
  return callBrowser('POST', '/browser/fill', body);
}

/** Select an option in a native select/combobox field. */
export async function selectOption(args: {
  role?: string;
  name?: string;
  selector?: string;
  value: string;
  exact?: boolean;
  /** 0-based disambiguator for multi-match locators — see clickRole. */
  nth?: number;
  timeoutMs?: number;
  taskContext?: string;
  /** Skip the pre-mutation verification-gate check. See clickRole. */
  skipVerificationCheck?: boolean;
}): Promise<BrowserActionResult<{ value: string }>> {
  if (typeof args.value !== 'string' || !args.value.trim()) {
    return browserFailureResult(describeBrowserBridgeFailure('value required', 'invalid_input'));
  }
  const gate = await preMutationVerificationGate<{ value: string }>(args.skipVerificationCheck);
  if (gate) return gate;
  const { skipVerificationCheck: _skip, ...body } = args;
  return callBrowser('POST', '/browser/select', { role: args.role || 'combobox', ...body });
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
  /** Skip the pre-mutation verification-gate check. See clickRole. */
  skipVerificationCheck?: boolean;
}): Promise<BrowserActionResult<{ filePath: string; fileName: string; sizeBytes: number; method: string }>> {
  const filePath = String(args.filePath || '').trim();
  if (!filePath) return browserFailureResult(describeBrowserBridgeFailure('filePath required', 'invalid_input'));
  if (filePath.length > 1024 || /[\x00-\x1f]/.test(filePath)) {
    return browserFailureResult(describeBrowserBridgeFailure('invalid filePath', 'invalid_input'));
  }
  const gate = await preMutationVerificationGate<{ filePath: string; fileName: string; sizeBytes: number; method: string }>(args.skipVerificationCheck);
  if (gate) return gate;
  const { skipVerificationCheck: _skip, ...body } = args;
  return callBrowser('POST', '/browser/upload_file', { ...body, filePath });
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
 * Builds the explicit truncation trailer for a DOM snapshot, or null
 * when the snapshot is complete. Formatters must append this line so
 * the model knows the page continues beyond the budget — without it,
 * a missing element in the rendered tree reads as "does not exist"
 * instead of "narrow the scope or raise maxNodes".
 */
export function describeDomSnapshotTruncation(
  result: Pick<DomSnapshotResult, 'nodeCount' | 'totalNodes' | 'truncated'>,
): string | null {
  if (!result.truncated) return null;
  const total = typeof result.totalNodes === 'number' && result.totalNodes > result.nodeCount
    ? String(result.totalNodes)
    : 'more';
  return `[tree truncated: showing ${result.nodeCount} of ${total} nodes — refine with a selector or increase maxNodes]`;
}

/**
 * Render a full DOM snapshot: flattened tree plus the explicit
 * truncation trailer when the node budget was hit. Prefer this over
 * calling renderBrowserTree directly so truncation never gets lost.
 */
export function renderDomSnapshot(result: DomSnapshotResult): string {
  const lines = renderBrowserTree(result.tree);
  const trailer = describeDomSnapshotTruncation(result);
  if (trailer) lines.push(trailer);
  return lines.join('\n');
}

/**
 * Flatten a DOM a11y tree the same way we flatten the desktop AX tree:
 * one indented line per node so the model sees semantic structure.
 */
export function renderBrowserTree(node: BrowserA11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  const parts = [`${indent}[${node.id}]`, node.role];
  // QW2: `name`/`value` are page-derived UNTRUSTED text — sanitize the
  // MODEL-VISIBLE render (strip invisible Tag-char smuggling, defang
  // auto-loading markdown image/link syntax). The raw `node` is untouched;
  // structural fields (id/role/flags) are ours, not page content.
  if (node.name) parts.push(`"${sanitizeUntrustedForModel(node.name).replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.name) parts.push(`= "${sanitizeUntrustedForModel(String(node.value)).replace(/"/g, '\\"').slice(0, 80)}"`);
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
