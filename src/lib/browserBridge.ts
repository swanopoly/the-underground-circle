/**
 * browserBridge — client for the local Playwright-backed /browser/*
 * endpoints. Mirrors the shape of `desktopBridge.ts` so agents see a
 * unified surface: probe with `isBrowserBridgeAvailable`, then
 * `openUrl`, `domSnapshot`, `locatorActionability`, `clickRole`, `fillField`, `pressKey`,
 * `waitFor`, `scrollPage`, `screenshot`, `closeBrowser`.
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
import type { DesktopBridgeError, DesktopResult } from './desktopBridgeProtocol';
import { getBridgeUrl } from './bridgeEnvironment';
import { describeBrowserBridgeFailure, type BrowserBridgeFailure } from './browserBridgeFailure';
import { ensureDesktopBridgePaired } from './desktopBridge';
import { sanitizeUntrustedForModel } from './untrustedContent';
import type { AutomationVerificationGate } from './desktopAutomationSafety';
import {
  normalizeTabList,
  buildDownloadProof,
  normalizeBrowserSemanticWait,
  normalizeBrowserSemanticScroll,
  type BrowserTabInfo,
  type NormalizedTabList,
  type DownloadProof,
  type BrowserSemanticWaitCondition,
  type BrowserSemanticWaitInput,
  type BrowserSemanticScrollInput,
  type BrowserScrollDirection,
  type BrowserScrollAmount,
} from './browserPrimitives';
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
  browserProcessId: string;
  browserContextId: string | null;
  pageId: string | null;
  url: string;
  observedAt: string;
  evidenceId: string;
}

/**
 * Opaque bridge-issued identity for one live browser document observation.
 * `pageId` rotates on main-frame navigation/reload, including same-URL reload.
 */
export interface BrowserPageIdentity {
  browserProcessId: string;
  browserContextId: string;
  pageId: string;
  url: string;
  observedAt: string;
  evidenceId: string;
}

/** Exact prior-observation values rechecked at the fill handler entry. */
export interface BrowserPageIdentityExpectation {
  expectedBrowserContextId: string;
  expectedPageId: string;
  expectedUrl: string;
}

export type BrowserLocatorActionabilityArgs = BrowserPageIdentityExpectation & {
  expectedBrowserProcessId: string;
  exact?: true;
} & (
  | { role: string; name: string; selector?: never }
  | { selector: string; role?: never; name?: never }
);

/**
 * Privacy-bounded read-only actionability evidence. The exact URL and locator
 * are intentionally absent: identity is carried by opaque bridge IDs plus a
 * sanitized origin and an exact server-side URL comparison.
 */
export interface BrowserLocatorActionabilityEvidence {
  browserProcessId: string;
  browserContextId: string;
  pageId: string;
  observedAt: string;
  evidenceId: string;
  currentUrlOrigin: string;
  urlMatchesExpected: true;
  locatorKind: 'semantic' | 'selector';
  readOnlyEvidence: true;
  /** This observation does not bind or authorize a later mutation. */
  mutationAuthorization: false;
  matchCount: 1;
  matchCountCapped: false;
  unique: true;
  attached: boolean;
  visible: boolean;
  stable: boolean;
  stableWindowMs: number;
  enabled: boolean;
  editableRelevant: boolean;
  editable: boolean;
  inViewport: boolean;
  receivesEvents: boolean;
  obscured: boolean;
  actionable: boolean;
}

/**
 * Ephemeral, single-use capability for one exact inspected ElementHandle.
 * Persist/approve `targetFingerprint`, never `targetId`; an expired target is
 * re-observed to obtain a new targetId with the same privacy-safe fingerprint.
 */
export interface BrowserGuardedFillTarget extends BrowserPageIdentity {
  targetId: string;
  targetFingerprint: string;
  targetExpiresAt: string;
}

/** Redacted server-side proof from locator.inputValue(). */
export interface BrowserFillProof extends BrowserPageIdentity {
  targetFingerprint: string;
  valueMatches: boolean;
  valueLength: number;
  expectedLength: number;
  mutationPerformed: boolean;
}

export type BrowserGuardedToggleRole = 'checkbox' | 'switch' | 'radio';

/**
 * Ephemeral capability for one exact, inspected state control. The capability
 * is bound to both the observed state and the requested state transition.
 */
export interface BrowserGuardedToggleTarget extends BrowserPageIdentity {
  targetId: string;
  targetFingerprint: string;
  targetExpiresAt: string;
  role: BrowserGuardedToggleRole;
  currentState: boolean;
  desiredState: boolean;
}

/** Redacted after-state proof for the sealed, non-consequential toggle lane. */
export interface BrowserToggleProof extends BrowserPageIdentity {
  targetFingerprint: string;
  role: BrowserGuardedToggleRole;
  previousState: boolean;
  currentState: boolean;
  desiredState: boolean;
  stateMatches: boolean;
  mutationPerformed: boolean;
}

export type BrowserGuardedSelectMatchBy = 'value' | 'label';

/**
 * Ephemeral capability for one visible, enabled native single-value select
 * and one exact enabled option. Raw locator/option text never leaves the
 * observation call.
 */
export interface BrowserGuardedSelectTarget extends BrowserPageIdentity {
  targetId: string;
  targetFingerprint: string;
  optionFingerprint: string;
  targetExpiresAt: string;
  matchBy: BrowserGuardedSelectMatchBy;
  currentOptionFingerprint: string | null;
  selectionMatches: boolean;
}

/** Redacted after-state proof for the sealed native-select lane. */
export interface BrowserSelectProof extends BrowserPageIdentity {
  targetFingerprint: string;
  optionFingerprint: string;
  matchBy: BrowserGuardedSelectMatchBy;
  previousOptionFingerprint: string | null;
  currentOptionFingerprint: string | null;
  selectionMatches: boolean;
  mutationPerformed: boolean;
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
  /** Only non-editable action labels may use `value`; editable values are redacted. */
  value?: string;
  /** Every editable form/contenteditable value is structure-only by default. */
  valueRedacted?: true;
  valueLength?: number;
  sensitiveKind?: 'password' | 'credential' | 'email' | 'telephone' | 'payment' | 'one-time code';
  level?: number;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  disabled?: boolean;
  focused?: boolean;
  expanded?: boolean;
  selected?: boolean;
  children?: BrowserA11yNode[];
}

export interface DomSnapshotResult extends BrowserPageIdentity {
  /** Origin-only display URL. `url` is the exact opaque identity binding. */
  displayUrl: string;
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

export interface BrowserPageSourceResult extends BrowserPageIdentity {
  title: string;
  sourceLength: number;
  truncated: boolean;
  maxChars: number;
  source: string;
}

export interface BrowserWordPressAdminSourceIntelligenceResult extends BrowserPageIdentity {
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

export interface BrowserVerificationState extends BrowserPageIdentity {
  title: string;
  verificationDetected: boolean;
  gate: AutomationVerificationGate | null;
  selectorMatches: string[];
  matchedTerms: string[];
  pauseInstruction?: string;
}

/** Result of listTabs — the normalized, single-active tab list plus the
 *  active index. Titles/urls are already sanitized for model display. */
export interface BrowserTabListResult extends BrowserPageIdentity {
  tabs: BrowserTabInfo[];
  activeIndex: number;
  count: number;
}

/** Result of a downloadFile call: the scoped save path, byte size, and the
 *  compact evidence-contract proof (basename + human size + safe tail). */
export interface BrowserDownloadResult {
  path: string;
  basename: string;
  sizeBytes: number;
  suggestedFilename?: string;
  proof: DownloadProof;
}

/**
 * Privacy-bounded proof that the bridge rechecked one exact observed document
 * after an operation. The raw URL/title remain local; `urlMatchesExpected`
 * attests the opaque expected URL still matched.
 */
export interface BrowserSemanticPageIdentityReceipt {
  browserProcessId: string;
  browserContextId: string;
  pageId: string;
  observedAt: string;
  evidenceId: string;
  urlMatchesExpected: true;
}

/** Privacy-bounded wait receipt with exact page-identity after-proof. */
export interface BrowserWaitForResult extends BrowserSemanticPageIdentityReceipt {
  condition: BrowserSemanticWaitCondition;
  timeoutMs: number;
  completed: true;
}

/** Privacy-bounded semantic scroll receipt — no raw coordinates/page text. */
export interface BrowserScrollResult extends BrowserSemanticPageIdentityReceipt {
  direction: BrowserScrollDirection;
  amount: BrowserScrollAmount;
  movementVerified: true;
  completed: true;
}

function isBoundedOpaqueBrowserId(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length >= 20
    && value.length <= 220
    && /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isBoundedLocatorActionabilityBrowserId(value: unknown): value is string {
  return isBoundedOpaqueBrowserId(value) && value.length <= 180;
}

const LOCATOR_ACTIONABILITY_EVIDENCE_MAX_AGE_MS = 30_000;
const LOCATOR_ACTIONABILITY_EVIDENCE_MAX_FUTURE_SKEW_MS = 5_000;

/**
 * Accept browser-native, non-positional CSS only. Playwright selector engines
 * and positional pseudo-classes can collapse an ambiguous base locator to one
 * match, so they are not valid evidence targets.
 */
export function isNonPositionalBrowserCssSelector(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 1_000
    || value !== value.trim()
    || /[\u0000-\u001f\u007f\\]/.test(value)
    || value.includes('>>')
    || value.includes('/*')
    || value.includes('*/')
    || /^(?:css|xpath|text|id|data-testid|data-test-id|data-test|internal:[a-z-]+)\s*=/i.test(value)
    || /^(?:\/\/|\/|\.\.(?:\/|$))/.test(value)
  ) {
    return false;
  }
  return !/:(?:nth(?:-last)?-(?:child|of-type)|first-(?:child|of-type)|last-(?:child|of-type)|only-(?:child|of-type)|nth-match|right-of|left-of|above|below|near)(?:\s*\(|\b)/i.test(value);
}

function isSanitizedBrowserOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 300 || /[?#@\s]/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.origin !== 'null'
      && parsed.origin === value
    );
  } catch {
    return false;
  }
}

function sanitizedBrowserOriginFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || !parsed.origin
      || parsed.origin === 'null'
    ) return null;
    return parsed.origin.slice(0, 300);
  } catch {
    return null;
  }
}

const BROWSER_URL_IDENTITY_PATTERN = /^uc_browser_url_[a-f0-9]{64}$/;

export function isOpaqueBrowserUrlIdentity(value: unknown): value is string {
  return typeof value === 'string' && BROWSER_URL_IDENTITY_PATTERN.test(value);
}

function extractBrowserSemanticPageIdentityReceipt(
  value: unknown,
  expected: {
    expectedBrowserProcessId: string;
    expectedBrowserContextId: string;
    expectedPageId: string;
  },
): BrowserSemanticPageIdentityReceipt | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const candidate = value as Record<string, unknown>;
    const observedAt = candidate.observedAt;
    const observedMs = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
    if (
      candidate.browserProcessId !== expected.expectedBrowserProcessId
      || candidate.browserContextId !== expected.expectedBrowserContextId
      || candidate.pageId !== expected.expectedPageId
      || !isBoundedOpaqueBrowserId(candidate.browserProcessId)
      || !isBoundedOpaqueBrowserId(candidate.browserContextId)
      || !isBoundedOpaqueBrowserId(candidate.pageId)
      || !isBoundedOpaqueBrowserId(candidate.evidenceId)
      || typeof observedAt !== 'string'
      || observedAt.length < 10
      || observedAt.length > 64
      || !Number.isFinite(observedMs)
      || candidate.urlMatchesExpected !== true
    ) {
      return null;
    }
    return {
      browserProcessId: candidate.browserProcessId,
      browserContextId: candidate.browserContextId,
      pageId: candidate.pageId,
      observedAt,
      evidenceId: candidate.evidenceId,
      urlMatchesExpected: true,
    };
  } catch {
    return null;
  }
}

function splitBrowserTextUrlTrailingPunctuation(value: string): {
  candidate: string;
  trailing: string;
} {
  const match = value.match(/[),.;!?]+$/);
  const trailing = match ? match[0] : '';
  return {
    candidate: trailing ? value.slice(0, -trailing.length) : value,
    trailing,
  };
}

function sanitizeAbsoluteBrowserTextUrl(value: string): string {
  const { candidate, trailing } = splitBrowserTextUrlTrailingPunctuation(value);
  return `${sanitizedBrowserOriginFromUrl(candidate) || '[redacted URL]'}${trailing}`;
}

function sanitizeProtocolRelativeBrowserTextUrl(value: string): string {
  const { candidate, trailing } = splitBrowserTextUrlTrailingPunctuation(value);
  try {
    const parsed = new URL(`https:${candidate}`);
    if (!parsed.host) return `[redacted URL]${trailing}`;
    return `//${parsed.host.slice(0, 260)}${trailing}`;
  } catch {
    return `[redacted URL]${trailing}`;
  }
}

/**
 * Defense-in-depth for page-derived snapshot labels. URLs are reduced to
 * origin and credential-like assignments are value-stripped, while ordinary
 * visible text remains available for grounding.
 */
export function sanitizeBrowserSnapshotModelText(value: unknown, maxLength: number): string {
  let text = sanitizeUntrustedForModel(String(value || ''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(
    /\b(?:mailto|tel|data|blob|javascript|file):[^\s<>"']+/gi,
    '[redacted URL]',
  );
  text = text.replace(
    /\b(?:https?|ftp):\/\/[^\s<>"']+/gi,
    sanitizeAbsoluteBrowserTextUrl,
  );
  text = text.replace(
    /(^|[\s([{"'=])\/\/[^\s<>"']+/gi,
    (match, prefix: string) => (
      `${prefix}${sanitizeProtocolRelativeBrowserTextUrl(match.slice(prefix.length))}`
    ),
  );
  text = text.replace(
    /(^|[\s([{"'=])(?:\.\.?\/|\/(?!\/))[^\s<>"']+/g,
    '$1[redacted relative URL]',
  );
  text = text.replace(
    /(^|[\s([{"'=])[?#][A-Za-z0-9_.~-]+=[^\s<>"']+/g,
    '$1[redacted URL parameters]',
  );
  // Query/fragment values can also be embedded after unqualified route text
  // (for example `settings?account=...`) or chained with `&`. Redact every
  // value rather than relying on a sensitive-key dictionary.
  text = text.replace(
    /([?#&][A-Za-z0-9_.~%-]{1,100}=)[^&#\s<>"']+/g,
    '$1[redacted]',
  );
  text = text.replace(
    /\b(password|passwd|passcode|token|secret|api[_\s-]?key|access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|private[_\s-]?key|auth(?:orization)?|bearer|otp|email|card|cvv|cvc|payment|session(?:[_\s-]?id)?|sid|nonce|signature|sig|credential|cookie|ssn|social[_\s-]?security)\s*[:=]\s*[^\s|,;]+/gi,
    '$1=[redacted]',
  );
  return text.slice(0, Math.max(0, maxLength));
}

function parseBoundedBrowserIdentity(value: unknown): BrowserPageIdentity | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const candidate = value as Record<string, unknown>;
    const browserProcessId = candidate.browserProcessId;
    const browserContextId = candidate.browserContextId;
    const pageId = candidate.pageId;
    const url = candidate.url;
    const observedAt = candidate.observedAt;
    const evidenceId = candidate.evidenceId;
    if (
      !isBoundedOpaqueBrowserId(browserProcessId)
      || !isBoundedOpaqueBrowserId(browserContextId)
      || !isBoundedOpaqueBrowserId(pageId)
      || !isBoundedOpaqueBrowserId(evidenceId)
      || typeof url !== 'string'
      || url.length < 1
      || url.length > 4096
      || typeof observedAt !== 'string'
      || observedAt.length < 10
      || observedAt.length > 64
      || !Number.isFinite(Date.parse(observedAt))
    ) {
      return null;
    }
    return {
      browserProcessId,
      browserContextId,
      pageId,
      url,
      observedAt,
      evidenceId,
    };
  } catch {
    return null;
  }
}

/** Parse an observation result (or its `.data`) into the bounded identity. */
export function extractBrowserPageIdentity(value: unknown): BrowserPageIdentity | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    return parseBoundedBrowserIdentity(
      record.data && typeof record.data === 'object' ? record.data : record,
    );
  } catch {
    return null;
  }
}

/** Allowlist and cross-check the read-only actionability response. */
export function extractBrowserLocatorActionabilityEvidence(
  value: unknown,
): BrowserLocatorActionabilityEvidence | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const {
      browserProcessId,
      browserContextId,
      pageId,
      evidenceId,
      observedAt,
      currentUrlOrigin,
      locatorKind,
      stableWindowMs,
    } = candidate;
    const observedMs = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
    const nowMs = Date.now();
    const booleanFields = [
      'attached',
      'visible',
      'stable',
      'enabled',
      'editableRelevant',
      'editable',
      'inViewport',
      'receivesEvents',
      'obscured',
      'actionable',
    ] as const;
    if (
      !isBoundedLocatorActionabilityBrowserId(browserProcessId)
      || !isBoundedLocatorActionabilityBrowserId(browserContextId)
      || !isBoundedLocatorActionabilityBrowserId(pageId)
      || !isBoundedLocatorActionabilityBrowserId(evidenceId)
      || typeof observedAt !== 'string'
      || observedAt.length < 10
      || observedAt.length > 64
      || !Number.isFinite(observedMs)
      || observedMs < nowMs - LOCATOR_ACTIONABILITY_EVIDENCE_MAX_AGE_MS
      || observedMs > nowMs + LOCATOR_ACTIONABILITY_EVIDENCE_MAX_FUTURE_SKEW_MS
      || !isSanitizedBrowserOrigin(currentUrlOrigin)
      || (locatorKind !== 'semantic' && locatorKind !== 'selector')
      || candidate.urlMatchesExpected !== true
      || candidate.readOnlyEvidence !== true
      || candidate.mutationAuthorization !== false
      || candidate.matchCount !== 1
      || candidate.matchCountCapped !== false
      || candidate.unique !== true
      || !Number.isSafeInteger(stableWindowMs)
      || (stableWindowMs as number) < 25
      || (stableWindowMs as number) > 500
      || booleanFields.some((field) => typeof candidate[field] !== 'boolean')
      || (candidate.receivesEvents === true && candidate.obscured === true)
      || (candidate.receivesEvents === true && candidate.inViewport !== true)
      || (candidate.obscured === true && candidate.inViewport !== true)
    ) {
      return null;
    }
    const actionable = candidate.attached === true
      && candidate.visible === true
      && candidate.stable === true
      && candidate.enabled === true
      && candidate.inViewport === true
      && candidate.receivesEvents === true
      && (candidate.editableRelevant !== true || candidate.editable === true);
    if (candidate.actionable !== actionable) return null;
    return {
      browserProcessId,
      browserContextId,
      pageId,
      observedAt,
      evidenceId,
      currentUrlOrigin,
      urlMatchesExpected: true,
      locatorKind,
      readOnlyEvidence: true,
      mutationAuthorization: false,
      matchCount: 1,
      matchCountCapped: false,
      unique: true,
      attached: candidate.attached as boolean,
      visible: candidate.visible as boolean,
      stable: candidate.stable as boolean,
      stableWindowMs: stableWindowMs as number,
      enabled: candidate.enabled as boolean,
      editableRelevant: candidate.editableRelevant as boolean,
      editable: candidate.editable as boolean,
      inViewport: candidate.inViewport as boolean,
      receivesEvents: candidate.receivesEvents as boolean,
      obscured: candidate.obscured as boolean,
      actionable,
    };
  } catch {
    return null;
  }
}

/** Parse a bridge target-observation response (or its `.data`) fail closed. */
export function extractBrowserGuardedFillTarget(value: unknown): BrowserGuardedFillTarget | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const targetId = candidate.targetId;
    const targetFingerprint = candidate.targetFingerprint;
    const targetExpiresAt = candidate.targetExpiresAt;
    const observedMs = identity ? Date.parse(identity.observedAt) : NaN;
    const expiresMs = typeof targetExpiresAt === 'string' ? Date.parse(targetExpiresAt) : NaN;
    if (
      !identity
      || !isBoundedOpaqueBrowserId(targetId)
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || typeof targetExpiresAt !== 'string'
      || targetExpiresAt.length > 64
      || !Number.isFinite(expiresMs)
      || expiresMs <= observedMs
      || expiresMs - observedMs > 300_000
    ) {
      return null;
    }
    return {
      ...identity,
      targetId,
      targetFingerprint,
      targetExpiresAt,
    };
  } catch {
    return null;
  }
}

function parseGuardedToggleRole(value: unknown): BrowserGuardedToggleRole | null {
  return value === 'checkbox' || value === 'switch' || value === 'radio'
    ? value
    : null;
}

/** Parse one exact toggle capability without admitting locator or page text. */
export function extractBrowserGuardedToggleTarget(value: unknown): BrowserGuardedToggleTarget | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const role = parseGuardedToggleRole(candidate.role);
    const targetId = candidate.targetId;
    const targetFingerprint = candidate.targetFingerprint;
    const targetExpiresAt = candidate.targetExpiresAt;
    const observedMs = identity ? Date.parse(identity.observedAt) : NaN;
    const expiresMs = typeof targetExpiresAt === 'string' ? Date.parse(targetExpiresAt) : NaN;
    if (
      !identity
      || !role
      || !isBoundedOpaqueBrowserId(targetId)
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || typeof targetExpiresAt !== 'string'
      || targetExpiresAt.length > 64
      || !Number.isFinite(expiresMs)
      || expiresMs <= observedMs
      || expiresMs - observedMs > 300_000
      || typeof candidate.currentState !== 'boolean'
      || typeof candidate.desiredState !== 'boolean'
      || (role === 'radio' && candidate.desiredState !== true)
    ) {
      return null;
    }
    return {
      ...identity,
      targetId,
      targetFingerprint,
      targetExpiresAt,
      role,
      currentState: candidate.currentState,
      desiredState: candidate.desiredState,
    };
  } catch {
    return null;
  }
}

/**
 * Extract only bounded toggle proof. Names, selectors, capability ids, task
 * context, and arbitrary page content are intentionally discarded.
 */
export function extractBrowserToggleProofMetadata(value: unknown): BrowserToggleProof | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const role = parseGuardedToggleRole(candidate.role);
    const targetFingerprint = candidate.targetFingerprint;
    const previousState = candidate.previousState;
    const currentState = candidate.currentState;
    const desiredState = candidate.desiredState;
    const stateMatches = candidate.stateMatches;
    const mutationPerformed = candidate.mutationPerformed;
    if (
      !identity
      || !role
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || typeof previousState !== 'boolean'
      || typeof currentState !== 'boolean'
      || typeof desiredState !== 'boolean'
      || typeof stateMatches !== 'boolean'
      || typeof mutationPerformed !== 'boolean'
      || stateMatches !== (currentState === desiredState)
      || (mutationPerformed && (previousState === desiredState || currentState !== desiredState))
      || (!mutationPerformed && previousState !== currentState)
      || (role === 'radio' && desiredState !== true)
    ) {
      return null;
    }
    return {
      ...identity,
      targetFingerprint,
      role,
      previousState,
      currentState,
      desiredState,
      stateMatches,
      mutationPerformed,
    };
  } catch {
    return null;
  }
}

function parseGuardedSelectMatchBy(value: unknown): BrowserGuardedSelectMatchBy | null {
  return value === 'value' || value === 'label' ? value : null;
}

/** Parse one exact native-select capability without admitting page text. */
export function extractBrowserGuardedSelectTarget(
  value: unknown,
): BrowserGuardedSelectTarget | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const targetId = candidate.targetId;
    const targetFingerprint = candidate.targetFingerprint;
    const optionFingerprint = candidate.optionFingerprint;
    const currentOptionFingerprint = candidate.currentOptionFingerprint;
    const targetExpiresAt = candidate.targetExpiresAt;
    const matchBy = parseGuardedSelectMatchBy(candidate.matchBy);
    const observedMs = identity ? Date.parse(identity.observedAt) : NaN;
    const expiresMs = typeof targetExpiresAt === 'string' ? Date.parse(targetExpiresAt) : NaN;
    if (
      !identity
      || !isBoundedOpaqueBrowserId(targetId)
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || !isBoundedOpaqueBrowserId(optionFingerprint)
      || (
        currentOptionFingerprint !== null
        && !isBoundedOpaqueBrowserId(currentOptionFingerprint)
      )
      || !matchBy
      || typeof candidate.selectionMatches !== 'boolean'
      || candidate.selectionMatches !== (currentOptionFingerprint === optionFingerprint)
      || typeof targetExpiresAt !== 'string'
      || targetExpiresAt.length > 64
      || !Number.isFinite(expiresMs)
      || expiresMs <= observedMs
      || expiresMs - observedMs > 300_000
    ) {
      return null;
    }
    return {
      ...identity,
      targetId,
      targetFingerprint,
      optionFingerprint,
      targetExpiresAt,
      matchBy,
      currentOptionFingerprint,
      selectionMatches: candidate.selectionMatches,
    };
  } catch {
    return null;
  }
}

/**
 * Extract only bounded select proof. Raw values, labels, locators, capability
 * ids, task context, and arbitrary page content are intentionally discarded.
 */
export function extractBrowserSelectProofMetadata(value: unknown): BrowserSelectProof | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const targetFingerprint = candidate.targetFingerprint;
    const optionFingerprint = candidate.optionFingerprint;
    const previousOptionFingerprint = candidate.previousOptionFingerprint;
    const currentOptionFingerprint = candidate.currentOptionFingerprint;
    const matchBy = parseGuardedSelectMatchBy(candidate.matchBy);
    const selectionMatches = candidate.selectionMatches;
    const mutationPerformed = candidate.mutationPerformed;
    if (
      !identity
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || !isBoundedOpaqueBrowserId(optionFingerprint)
      || (
        previousOptionFingerprint !== null
        && !isBoundedOpaqueBrowserId(previousOptionFingerprint)
      )
      || (
        currentOptionFingerprint !== null
        && !isBoundedOpaqueBrowserId(currentOptionFingerprint)
      )
      || !matchBy
      || typeof selectionMatches !== 'boolean'
      || typeof mutationPerformed !== 'boolean'
      || selectionMatches !== (currentOptionFingerprint === optionFingerprint)
      || (mutationPerformed && previousOptionFingerprint === optionFingerprint)
      || (
        !mutationPerformed
        && (
          previousOptionFingerprint !== currentOptionFingerprint
          || previousOptionFingerprint !== optionFingerprint
        )
      )
    ) {
      return null;
    }
    return {
      ...identity,
      targetFingerprint,
      optionFingerprint,
      matchBy,
      previousOptionFingerprint,
      currentOptionFingerprint,
      selectionMatches,
      mutationPerformed,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the only fill proof fields that may enter runtime metadata. The
 * filled/observed value, locator, task context, and arbitrary bridge payload
 * fields are deliberately excluded.
 */
export function extractBrowserFillProofMetadata(value: unknown): BrowserFillProof | null {
  if (!value || typeof value !== 'object') return null;
  try {
    const record = value as Record<string, unknown>;
    const candidate = (
      record.data && typeof record.data === 'object'
        ? record.data
        : record
    ) as Record<string, unknown>;
    const identity = parseBoundedBrowserIdentity(candidate);
    const targetFingerprint = candidate.targetFingerprint;
    const valueLength = candidate.valueLength;
    const expectedLength = candidate.expectedLength;
    if (
      !identity
      || !isBoundedOpaqueBrowserId(targetFingerprint)
      || typeof candidate.valueMatches !== 'boolean'
      || typeof candidate.mutationPerformed !== 'boolean'
      || typeof valueLength !== 'number'
      || !Number.isSafeInteger(valueLength)
      || valueLength < 0
      || valueLength > 1_000_000
      || typeof expectedLength !== 'number'
      || !Number.isSafeInteger(expectedLength)
      || expectedLength < 0
      || expectedLength > 4000
      || (candidate.valueMatches === true && valueLength !== expectedLength)
    ) {
      return null;
    }
    return {
      ...identity,
      targetFingerprint,
      valueMatches: candidate.valueMatches,
      valueLength,
      expectedLength,
      mutationPerformed: candidate.mutationPerformed,
    };
  } catch {
    return null;
  }
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
export async function openUrl(
  url: string,
  opts?: { timeoutMs?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; taskContext?: string },
): Promise<DesktopResult<BrowserPageIdentity & { title: string }>> {
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
  const raw = await callBrowser<DomSnapshotResult>('GET', `/browser/dom_snapshot${qs ? `?${qs}` : ''}`);
  if (!raw.ok || !raw.data) return raw;
  const identity = extractBrowserPageIdentity(raw.data);
  const expectedUrl = identity?.url;
  if (!identity || !isOpaqueBrowserUrlIdentity(expectedUrl)) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser snapshot identity was not privacy-safe', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  const displayUrl = sanitizedBrowserOriginFromUrl(
    (raw.data as DomSnapshotResult & { displayUrl?: unknown }).displayUrl,
  );
  if (!displayUrl) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser snapshot display URL was invalid', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  return {
    ok: true,
    data: {
      ...identity,
      displayUrl,
      title: sanitizeBrowserSnapshotModelText(raw.data.title, 2_000),
      nodeCount: Number.isFinite(raw.data.nodeCount)
        ? Math.max(0, Math.floor(raw.data.nodeCount))
        : 0,
      totalNodes: Number.isFinite(raw.data.totalNodes)
        ? Math.max(0, Math.floor(raw.data.totalNodes as number))
        : undefined,
      truncated: raw.data.truncated === true,
      tree: raw.data.tree,
    },
  };
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
      browserProcessId: source.data.browserProcessId,
      browserContextId: source.data.browserContextId,
      pageId: source.data.pageId,
      url: source.data.url,
      observedAt: source.data.observedAt,
      evidenceId: source.data.evidenceId,
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

type LocatorActionabilitySafeFailure = {
  errorCode: DesktopBridgeError;
  error: string;
  recoveryHint: string;
  requiredEvidence: string[];
};

const LOCATOR_ACTIONABILITY_SAFE_FAILURES: Partial<
  Record<DesktopBridgeError, LocatorActionabilitySafeFailure>
> = {
  invalid_input: {
    errorCode: 'invalid_input',
    error: 'Locator actionability input was rejected.',
    recoveryHint: 'Take a fresh browser observation and retry with one exact, non-positional target and its complete identity.',
    requiredEvidence: ['browser.dom_snapshot'],
  },
  browser_identity_required: {
    errorCode: 'browser_identity_required',
    error: 'Complete browser identity evidence is required.',
    recoveryHint: 'Take a fresh browser observation and pass its exact process, context, page, and URL identity.',
    requiredEvidence: ['browser.dom_snapshot'],
  },
  browser_identity_mismatch: {
    errorCode: 'browser_identity_mismatch',
    error: 'The active browser page changed before actionability could be verified.',
    recoveryHint: 'Stop and take a fresh browser observation before choosing the target again.',
    requiredEvidence: ['browser.dom_snapshot'],
  },
  human_verification_required: {
    errorCode: 'human_verification_required',
    error: 'Human verification blocks browser target inspection.',
    recoveryHint: 'Ask the user to complete the verification gate, then take a fresh browser observation.',
    requiredEvidence: ['browser.verification_state', 'user.complete_browser_verification'],
  },
  selector_not_found: {
    errorCode: 'selector_not_found',
    error: 'The exact locator did not resolve to a live element.',
    recoveryHint: 'Take a fresh browser observation and choose a locator that resolves exactly once.',
    requiredEvidence: ['browser.dom_snapshot'],
  },
  ambiguous_locator: {
    errorCode: 'ambiguous_locator',
    error: 'The locator resolved to more than one element.',
    recoveryHint: 'Take a fresh browser observation and use a more specific non-positional target.',
    requiredEvidence: ['browser.dom_snapshot', 'user.confirm_target'],
  },
  browser_bridge_offline: {
    errorCode: 'browser_bridge_offline',
    error: 'The local browser bridge is unavailable.',
    recoveryHint: 'Start or repair the browser bridge, then take a fresh browser observation.',
    requiredEvidence: ['browser.health'],
  },
  bridge_offline: {
    errorCode: 'browser_bridge_offline',
    error: 'The local browser bridge is unavailable.',
    recoveryHint: 'Start or repair the browser bridge, then take a fresh browser observation.',
    requiredEvidence: ['browser.health'],
  },
  not_paired: {
    errorCode: 'not_paired',
    error: 'The local browser bridge is not paired.',
    recoveryHint: 'Pair the desktop bridge, then take a fresh browser observation.',
    requiredEvidence: ['desktop.bridge_pairing', 'browser.health'],
  },
  token_rejected: {
    errorCode: 'token_rejected',
    error: 'The local browser bridge rejected its pairing token.',
    recoveryHint: 'Re-pair the desktop bridge, then take a fresh browser observation.',
    requiredEvidence: ['desktop.bridge_pairing', 'browser.health'],
  },
};

function safeLocatorActionabilityFailure(
  result?: Pick<DesktopResult<unknown>, 'errorCode'>,
): BrowserActionResult<BrowserLocatorActionabilityEvidence> {
  const requestedCode = result?.errorCode;
  const failure = requestedCode
    && Object.prototype.hasOwnProperty.call(LOCATOR_ACTIONABILITY_SAFE_FAILURES, requestedCode)
    ? LOCATOR_ACTIONABILITY_SAFE_FAILURES[requestedCode]
    : undefined;
  const safe = failure || {
    errorCode: 'uncertain_ui_target' as const,
    error: 'Bounded actionability evidence could not be verified.',
    recoveryHint: 'Take a fresh browser observation and retry. Do not treat this result as mutation authorization.',
    requiredEvidence: ['browser.dom_snapshot'],
  };
  return {
    ok: false,
    error: safe.error,
    errorCode: safe.errorCode,
    recoveryHint: safe.recoveryHint,
    requiredEvidence: [...safe.requiredEvidence],
  };
}

/**
 * Inspect one exact locator without mutation. The server performs the human
 * verification scan and exact identity checks in the same handler so this
 * observation is coherent. It is not a capability or authorization for a
 * later mutation; callers must re-observe after DOM changes and use the
 * mutation path's own approval/proof gates.
 */
export async function locatorActionability(
  args: BrowserLocatorActionabilityArgs,
): Promise<BrowserActionResult<BrowserLocatorActionabilityEvidence>> {
  const role = 'role' in args ? args.role : undefined;
  const name = 'name' in args ? args.name : undefined;
  const selector = 'selector' in args ? args.selector : undefined;
  const opaqueExpectedUrl = isOpaqueBrowserUrlIdentity(args.expectedUrl);
  const boundedTrimmed = (value: unknown, maxLength: number): value is string => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
  );
  const semanticTarget = boundedTrimmed(role, 100)
    && boundedTrimmed(name, 500)
    && selector === undefined;
  const selectorTarget = isNonPositionalBrowserCssSelector(selector)
    && role === undefined
    && name === undefined;
  if (
    (!semanticTarget && !selectorTarget)
    || (args.exact !== undefined && args.exact !== true)
    || !isBoundedLocatorActionabilityBrowserId(args.expectedBrowserProcessId)
    || !isBoundedLocatorActionabilityBrowserId(args.expectedBrowserContextId)
    || !isBoundedLocatorActionabilityBrowserId(args.expectedPageId)
    || !opaqueExpectedUrl
    || !isValidBrowserIdentityExpectation(args)
  ) {
    return {
      ok: false,
      error: 'Locator actionability requires exactly one bounded role/name pair or selector and a complete browser identity.',
      errorCode: 'invalid_input',
      recoveryHint: 'Take a fresh browser observation and retry with one exact locator and its complete identity.',
      requiredEvidence: ['browser.dom_snapshot'],
    };
  }
  const raw = await callBrowser<BrowserLocatorActionabilityEvidence>(
    'POST',
    '/browser/locator_actionability',
    {
      ...(semanticTarget ? { role, name, exact: true } : { selector }),
      expectedBrowserProcessId: args.expectedBrowserProcessId,
      expectedBrowserContextId: args.expectedBrowserContextId,
      expectedPageId: args.expectedPageId,
      expectedUrl: args.expectedUrl,
    },
  ) as BrowserActionResult<BrowserLocatorActionabilityEvidence>;
  if (!raw.ok) return safeLocatorActionabilityFailure(raw);
  if (!raw.data) return safeLocatorActionabilityFailure();
  const evidence = extractBrowserLocatorActionabilityEvidence(raw.data);
  if (!evidence) {
    return safeLocatorActionabilityFailure();
  }
  if (
    evidence.browserProcessId !== args.expectedBrowserProcessId
    || evidence.browserContextId !== args.expectedBrowserContextId
    || evidence.pageId !== args.expectedPageId
    || evidence.locatorKind !== (semanticTarget ? 'semantic' : 'selector')
  ) {
    return safeLocatorActionabilityFailure({
      errorCode: 'browser_identity_mismatch',
    });
  }
  return { ok: true, data: evidence };
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
  /** CSS selector for an iframe to scope this click INSIDE. When set,
   *  the bridge resolves the target via page.frameLocator(frameSelector)
   *  so role/name/selector are looked up within that frame — needed for
   *  embedded editors, payment iframes, and cross-origin widgets whose
   *  controls are invisible to a top-frame locator. */
  frameSelector?: string;
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
 * clickRole). This is the compatibility lane used by legacy SwanBot and the
 * separately vault/origin-gated credential tool. It intentionally retains the
 * historical optional-submit and `{ chars }` result shape.
 */
export async function fillField(args: {
  role: string;
  name?: string;
  /** Explicit CSS selector — alternative to (role + name). See
   *  clickRole for the full story. */
  selector?: string;
  /** CSS selector for an iframe to scope this fill INSIDE — see
   *  clickRole. Needed for form fields inside embedded/cross-origin
   *  frames. */
  frameSelector?: string;
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

export interface BrowserGuardedFillTargetArgs extends BrowserPageIdentityExpectation {
  role: string;
  name?: string;
  selector?: string;
  frameSelector?: string;
  exact?: boolean;
  timeoutMs?: number;
  taskContext?: string;
  /** Explicit safety signal; true is always refused by this canary. */
  credentialSemantics?: boolean;
  skipVerificationCheck?: boolean;
}

export interface BrowserGuardedNonSecretFillArgs extends BrowserPageIdentityExpectation {
  targetId: string;
  targetFingerprint: string;
  text: string;
  timeoutMs?: number;
  taskContext?: string;
  /** Explicit safety signal; true is always refused by this canary. */
  credentialSemantics?: boolean;
  skipVerificationCheck?: boolean;
  /** Runtime-private final-entry fence; never serialized to the bridge. */
  shouldContinue?: () => boolean;
}

export interface BrowserGuardedToggleTargetArgs extends BrowserPageIdentityExpectation {
  expectedBrowserProcessId: string;
  role: BrowserGuardedToggleRole;
  name?: string;
  selector?: string;
  frameSelector?: string;
  desiredState: boolean;
  submit?: false;
  exact?: true;
  timeoutMs?: number;
  taskContext?: string;
  credentialSemantics?: boolean;
  skipVerificationCheck?: boolean;
}

export interface BrowserGuardedToggleMutationArgs extends BrowserPageIdentityExpectation {
  expectedBrowserProcessId: string;
  targetId: string;
  targetFingerprint: string;
  desiredState: boolean;
  submit?: false;
  timeoutMs?: number;
  taskContext?: string;
  credentialSemantics?: boolean;
  skipVerificationCheck?: boolean;
  /** Runtime-private final-entry fence; never serialized to the bridge. */
  shouldContinue?: () => boolean;
}

export interface BrowserGuardedSelectTargetArgs extends BrowserPageIdentityExpectation {
  expectedBrowserProcessId: string;
  role?: 'combobox';
  name?: string;
  selector?: string;
  matchBy: BrowserGuardedSelectMatchBy;
  value: string;
  submit?: false;
  exact?: true;
  timeoutMs?: number;
  taskContext?: string;
  credentialSemantics?: false;
  skipVerificationCheck?: boolean;
}

export interface BrowserGuardedSelectMutationArgs extends BrowserPageIdentityExpectation {
  expectedBrowserProcessId: string;
  targetId: string;
  targetFingerprint: string;
  optionFingerprint: string;
  matchBy: BrowserGuardedSelectMatchBy;
  submit?: false;
  timeoutMs?: number;
  taskContext?: string;
  credentialSemantics?: false;
  skipVerificationCheck?: boolean;
  /** Runtime-private final-entry fence; never serialized to the bridge. */
  shouldContinue?: () => boolean;
}

function hasCredentialFillSignals(args: {
  credentialSemantics?: boolean;
  role?: string;
  name?: string;
  selector?: string;
  frameSelector?: string;
  taskContext?: string;
}): boolean {
  const signals = [
    args.role,
    args.name,
    args.selector,
    args.frameSelector,
    args.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return (
    args.credentialSemantics === true
    || /\b(password|passwd|passcode|credential|secret|api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|authenticator|one[\s_-]?time|otp|mfa|2fa|pin|log[\s_-]?in|sign[\s_-]?in|user[\s_-]?name|email|e-mail|recovery[\s_-]?phrase|seed[\s_-]?phrase|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|security[\s_-]?code|social[\s_-]?security|ssn|routing[\s_-]?number|bank[\s_-]?account)\b/.test(signals)
    || /type\s*=\s*["']?password\b/.test(signals)
  );
}

function isValidBrowserIdentityExpectation(args: BrowserPageIdentityExpectation): boolean {
  return (
    isBoundedOpaqueBrowserId(args.expectedBrowserContextId)
    && isBoundedOpaqueBrowserId(args.expectedPageId)
    && typeof args.expectedUrl === 'string'
    && args.expectedUrl.length >= 1
    && args.expectedUrl.length <= 4096
  );
}

function hasUnsafeToggleSignals(args: {
  name?: string;
  selector?: string;
  frameSelector?: string;
  taskContext?: string;
}): boolean {
  const signals = [
    args.name,
    args.selector,
    args.frameSelector,
    args.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return /\b(api[\s_-]?key|approve|authorize|book|buy|captcha|checkout|close[\s_-]?account|confirm[\s_-]?(?:order|payment|purchase|transfer)|credential|cvv|cvc|delete|deploy|destroy|hcaptcha|log[\s_-]?(?:in|out)|login|mfa|one[\s_-]?time|otp|passcode|password|pay|payment|private[\s_-]?key|publish|purchase|recaptcha|recovery[\s_-]?phrase|release|remove[\s_-]?(?:account|user)|security[\s_-]?code|seed[\s_-]?phrase|send|sign[\s_-]?(?:in|out)|social[\s_-]?security|ssn|submit|transfer|turnstile|two[\s_-]?factor|2fa|unsubscribe|withdraw)\b/.test(signals);
}

const GUARDED_SELECT_PROTECTED_RE = /\b(?:accept[\s_-]?(?:terms|conditions)|account|agree|analytics|api[\s_-]?key|approval|approve|authenticator|authorize|auto[\s_-]?renew(?:al)?|backup|bank[\s_-]?account|billing|book|buy|camera|cancel[\s_-]?(?:account|subscription)|captcha|card[\s_-]?number|checkout|clipboard|close[\s_-]?(?:account|profile)|cloud[\s_-]?(?:backup|sync)|consent|contacts?|credential|credit[\s_-]?card|cvc|cvv|delete|deploy|destroy|diagnostics?|discoverable|download|e-?mail|erase|extension|files?|grant[\s_-]?(?:access|permission)|hcaptcha|human[\s_-]?verification|install|location|log[\s_-]?(?:in|out)|marketing|merge|microphone|mfa|network|newsletter|notifications?|one[\s_-]?time|order|otp|passcode|password|pay(?:ment)?|permission|photos?|plugins?|private[\s_-]?key|privacy|profile|public|publish|purchase|recaptcha|recovery[\s_-]?(?:code|phrase)|release|remote[\s_-]?(?:access|control|desktop|login)|remove[\s_-]?(?:account|access|content|data|file|history|item|profile|record|user)|renew(?:al)?|reserve|screen[\s_-]?recording|security|seed[\s_-]?phrase|send|share|sharing|sign[\s_-]?(?:in|out)|sms|social[\s_-]?security|ssn|submit|subscribe|subscription|sync|telemetry|terms[\s_-]?(?:and|&)[\s_-]?conditions|tracking|transfer|turnstile|two[\s_-]?factor|2fa|uninstall|unsubscribe|update|upload|usage[\s_-]?data|visibility|vpn|wi-?fi|wipe|withdraw)\b/i;
const GUARDED_SELECT_SAFE_PREFERENCE_RE = /\b(?:appearance|accessibility|captions?|color[\s_-]?scheme|compact[\s_-]?(?:layout|mode|spacing|view)|comfortable[\s_-]?(?:layout|mode|spacing|view)|contrast[\s_-]?mode|dark[\s_-]?mode|dense[\s_-]?(?:layout|mode|spacing|view)|dyslexi[ac][\s_-]?font|focus[\s_-]?indicator|font[\s_-]?(?:family|size)|high[\s_-]?contrast|keyboard[\s_-]?navigation|large[\s_-]?text|light[\s_-]?mode|line[\s_-]?numbers?|minimap|presentation|reader[\s_-]?mode|reduce[\s_-]?(?:animations?|motion|transparency)|reduced[\s_-]?(?:animations?|motion|transparency)|screen[\s_-]?reader|sidebar|subtitles?|text[\s_-]?size|theme|tooltips?|visual[\s_-]?(?:appearance|layout|mode|preference|theme)|word[\s_-]?wrap|zoom)\b/i;

function hasUnsafeSelectSignals(args: {
  name?: string;
  selector?: string;
  value?: string;
  taskContext?: string;
}): boolean {
  const signals = [
    args.name,
    args.selector,
    args.value,
    args.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .slice(0, 4_000);
  return GUARDED_SELECT_PROTECTED_RE.test(signals)
    || !GUARDED_SELECT_SAFE_PREFERENCE_RE.test(signals);
}

/**
 * Resolve and inspect exactly one non-consequential state control. This call is
 * read-only and returns a short-lived capability bound to the requested state.
 */
export async function observeGuardedBrowserToggleTarget(
  args: BrowserGuardedToggleTargetArgs,
): Promise<BrowserActionResult<BrowserGuardedToggleTarget>> {
  const role = parseGuardedToggleRole(args.role);
  const locatorCount = Number(Boolean(args.name)) + Number(Boolean(args.selector));
  if (
    !role
    || typeof args.desiredState !== 'boolean'
    || (role === 'radio' && args.desiredState !== true)
    || locatorCount !== 1
    || (args.exact !== undefined && args.exact !== true)
    || (args as { submit?: unknown }).submit === true
    || args.credentialSemantics === true
    || !isBoundedOpaqueBrowserId(args.expectedBrowserProcessId)
    || !isValidBrowserIdentityExpectation(args)
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('exact toggle role, locator, desired state, and prior browser identity required', 'invalid_input'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  if (hasUnsafeToggleSignals(args)) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser toggle canary refuses consequential, credential, payment, or verification semantics', 'invalid_input'),
      {
        recoveryHint: 'Use a dedicated approval-gated action for consequential controls, or pause for human verification.',
        requiredEvidence: ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'],
      },
    );
  }
  const gate = await preMutationVerificationGate<BrowserGuardedToggleTarget>(args.skipVerificationCheck);
  if (gate) return gate;
  const raw = await callBrowser<BrowserGuardedToggleTarget>('POST', '/browser/toggle_target', {
    role,
    name: args.name,
    selector: args.selector,
    frameSelector: args.frameSelector,
    desiredState: args.desiredState,
    submit: false,
    exact: true,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext,
    credentialSemantics: false,
    expectedBrowserProcessId: args.expectedBrowserProcessId,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const target = extractBrowserGuardedToggleTarget(raw.data);
  if (
    !target
    || target.browserProcessId !== args.expectedBrowserProcessId
    || target.browserContextId !== args.expectedBrowserContextId
    || target.pageId !== args.expectedPageId
    || target.url !== args.expectedUrl
    || target.role !== role
    || target.desiredState !== args.desiredState
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser toggle capability did not match the expected observation and intent', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot', 'browser.toggle_target'] },
    );
  }
  return { ok: true, data: target };
}

/**
 * Consume one toggle capability, set its explicit desired state at most once,
 * and return redacted before/after proof for that exact element.
 */
export async function setGuardedBrowserToggleState(
  args: BrowserGuardedToggleMutationArgs,
): Promise<BrowserActionResult<BrowserToggleProof>> {
  if (
    typeof args.desiredState !== 'boolean'
    || (args as { submit?: unknown }).submit === true
    || args.credentialSemantics === true
    || !isBoundedOpaqueBrowserId(args.expectedBrowserProcessId)
    || !isValidBrowserIdentityExpectation(args)
    || !isBoundedOpaqueBrowserId(args.targetId)
    || !isBoundedOpaqueBrowserId(args.targetFingerprint)
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('valid toggle capability, desired state, fingerprint, and prior browser identity required', 'stale_bridge'),
      {
        recoveryHint: 'Observe the exact toggle again, then retry once with its new capability and approved fingerprint.',
        requiredEvidence: ['browser.dom_snapshot', 'browser.toggle_target'],
      },
    );
  }
  const gate = await preMutationVerificationGate<BrowserToggleProof>(args.skipVerificationCheck);
  if (gate) return gate;
  if (args.shouldContinue && args.shouldContinue() !== true) {
    return browserFailureResult(describeBrowserBridgeFailure('browser toggle stopped before bridge mutation', 'approval_required'));
  }
  const raw = await callBrowser<BrowserToggleProof>('POST', '/browser/set_toggle', {
    toggleMode: 'guarded_non_consequential',
    targetId: args.targetId,
    targetFingerprint: args.targetFingerprint,
    desiredState: args.desiredState,
    submit: false,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext,
    credentialSemantics: false,
    expectedBrowserProcessId: args.expectedBrowserProcessId,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const proof = extractBrowserToggleProofMetadata(raw.data);
  if (
    !proof
    || proof.targetFingerprint !== args.targetFingerprint
    || proof.browserProcessId !== args.expectedBrowserProcessId
    || proof.browserContextId !== args.expectedBrowserContextId
    || proof.pageId !== args.expectedPageId
    || proof.url !== args.expectedUrl
    || proof.desiredState !== args.desiredState
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('guarded toggle proof did not match the approved target, desired state, and observation', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot', 'browser.toggle_target'] },
    );
  }
  return { ok: true, data: proof };
}

/**
 * Resolve exactly one native single-value select and exactly one enabled
 * option without mutating either. The bridge returns only keyed fingerprints
 * and a short-lived exact-handle capability.
 */
export async function observeGuardedBrowserSelectTarget(
  args: BrowserGuardedSelectTargetArgs,
): Promise<BrowserActionResult<BrowserGuardedSelectTarget>> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const selector = typeof args.selector === 'string' ? args.selector.trim() : '';
  const value = typeof args.value === 'string' ? args.value : '';
  const locatorCount = Number(Boolean(name)) + Number(Boolean(selector));
  if (
    (args.role !== undefined && args.role !== 'combobox')
    || locatorCount !== 1
    || name.length > 500
    || selector.length > 1_000
    || !parseGuardedSelectMatchBy(args.matchBy)
    || !value
    || value !== value.trim()
    || value.length > 240
    || (args.exact !== undefined && args.exact !== true)
    || (args.submit !== undefined && args.submit !== false)
    || (args.credentialSemantics !== undefined && args.credentialSemantics !== false)
    || !isBoundedOpaqueBrowserId(args.expectedBrowserProcessId)
    || !isValidBrowserIdentityExpectation(args)
    || (
      args.timeoutMs !== undefined
      && (
        typeof args.timeoutMs !== 'number'
        || !Number.isFinite(args.timeoutMs)
        || args.timeoutMs < 500
        || args.timeoutMs > 30_000
      )
    )
    || (
      args.taskContext !== undefined
      && (
        typeof args.taskContext !== 'string'
        || !args.taskContext.trim()
        || args.taskContext.trim().length > 1_000
      )
    )
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'one exact native combobox locator, explicit value-or-label match, non-submit semantics, and prior browser identity are required',
        'invalid_input',
      ),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  if (hasUnsafeSelectSignals({ name, selector, value, taskContext: args.taskContext })) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'browser select canary is limited to clearly local presentation or accessibility preferences',
        'browser_select_canary_blocked',
      ),
      {
        recoveryHint: 'Use a dedicated reviewed action for protected or unknown settings.',
        requiredEvidence: ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'],
      },
    );
  }
  const gate = await preMutationVerificationGate<BrowserGuardedSelectTarget>(
    args.skipVerificationCheck,
  );
  if (gate) return gate;
  const raw = await callBrowser<BrowserGuardedSelectTarget>('POST', '/browser/select', {
    selectMode: 'observe_guarded_native',
    role: 'combobox',
    ...(name ? { name } : {}),
    ...(selector ? { selector } : {}),
    matchBy: args.matchBy,
    value,
    submit: false,
    exact: true,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext?.trim(),
    credentialSemantics: false,
    expectedBrowserProcessId: args.expectedBrowserProcessId,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const target = extractBrowserGuardedSelectTarget(raw.data);
  if (
    !target
    || target.browserProcessId !== args.expectedBrowserProcessId
    || target.browserContextId !== args.expectedBrowserContextId
    || target.pageId !== args.expectedPageId
    || target.url !== args.expectedUrl
    || target.matchBy !== args.matchBy
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'browser select capability did not match the expected observation and intent',
        'stale_bridge',
      ),
      { requiredEvidence: ['browser.dom_snapshot', 'browser.select_target'] },
    );
  }
  return { ok: true, data: target };
}

/**
 * Consume one exact native-select capability at most once and return a
 * redacted, coherent before/after option-fingerprint proof.
 */
export async function setGuardedBrowserSelectOption(
  args: BrowserGuardedSelectMutationArgs,
): Promise<BrowserActionResult<BrowserSelectProof>> {
  if (
    !parseGuardedSelectMatchBy(args.matchBy)
    || (args.submit !== undefined && args.submit !== false)
    || (args.credentialSemantics !== undefined && args.credentialSemantics !== false)
    || !isBoundedOpaqueBrowserId(args.expectedBrowserProcessId)
    || !isValidBrowserIdentityExpectation(args)
    || !isBoundedOpaqueBrowserId(args.targetId)
    || !isBoundedOpaqueBrowserId(args.targetFingerprint)
    || !isBoundedOpaqueBrowserId(args.optionFingerprint)
    || (
      args.timeoutMs !== undefined
      && (
        typeof args.timeoutMs !== 'number'
        || !Number.isFinite(args.timeoutMs)
        || args.timeoutMs < 500
        || args.timeoutMs > 30_000
      )
    )
    || (
      args.taskContext !== undefined
      && (
        typeof args.taskContext !== 'string'
        || !args.taskContext.trim()
        || args.taskContext.trim().length > 1_000
      )
    )
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'valid select target, option fingerprints, explicit match mode, non-submit semantics, and prior browser identity are required',
        'stale_bridge',
      ),
      {
        recoveryHint: 'Observe the exact native select and option again, then retry once with the new one-shot capability.',
        requiredEvidence: ['browser.dom_snapshot', 'browser.select_target'],
      },
    );
  }
  const gate = await preMutationVerificationGate<BrowserSelectProof>(
    args.skipVerificationCheck,
  );
  if (gate) return gate;
  if (args.shouldContinue && args.shouldContinue() !== true) {
    return browserFailureResult(describeBrowserBridgeFailure('browser option selection stopped before bridge mutation', 'approval_required'));
  }
  const raw = await callBrowser<BrowserSelectProof>('POST', '/browser/select', {
    selectMode: 'guarded_native_single',
    targetId: args.targetId,
    targetFingerprint: args.targetFingerprint,
    optionFingerprint: args.optionFingerprint,
    matchBy: args.matchBy,
    submit: false,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext?.trim(),
    credentialSemantics: false,
    expectedBrowserProcessId: args.expectedBrowserProcessId,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const proof = extractBrowserSelectProofMetadata(raw.data);
  if (
    !proof
    || proof.targetFingerprint !== args.targetFingerprint
    || proof.optionFingerprint !== args.optionFingerprint
    || proof.matchBy !== args.matchBy
    || proof.browserProcessId !== args.expectedBrowserProcessId
    || proof.browserContextId !== args.expectedBrowserContextId
    || proof.pageId !== args.expectedPageId
    || proof.url !== args.expectedUrl
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'guarded select proof did not match the approved target, option, match mode, and observation',
        'stale_bridge',
      ),
      { requiredEvidence: ['browser.dom_snapshot', 'browser.select_target'] },
    );
  }
  return { ok: true, data: proof };
}

/**
 * Resolve and inspect one exact non-credential field without mutating it.
 * The bridge returns an ephemeral, single-use targetId plus the stable,
 * privacy-safe targetFingerprint that approval/durable state may bind.
 *
 * No text/value field exists in this contract.
 */
export async function observeGuardedNonSecretFillTarget(
  args: BrowserGuardedFillTargetArgs,
): Promise<BrowserActionResult<BrowserGuardedFillTarget>> {
  const role = String(args.role || '').trim();
  if (
    !role
    || role.length > 80
    || ['combobox', 'listbox', 'option'].includes(role.toLowerCase())
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure(
        'a non-selection field role is required (max 80 chars)',
        'invalid_input',
      ),
    );
  }
  if (!isValidBrowserIdentityExpectation(args)) {
    return browserFailureResult(
      describeBrowserBridgeFailure('prior browser context, page, and URL identity required', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  if (hasCredentialFillSignals(args)) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser fill canary refuses credential semantics', 'invalid_input'),
      {
        recoveryHint: 'Use the dedicated approval- and origin-gated credential fill path.',
        requiredEvidence: ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'],
      },
    );
  }
  const gate = await preMutationVerificationGate<BrowserGuardedFillTarget>(args.skipVerificationCheck);
  if (gate) return gate;
  const raw = await callBrowser<BrowserGuardedFillTarget>('POST', '/browser/fill_target', {
    role,
    name: args.name,
    selector: args.selector,
    frameSelector: args.frameSelector,
    exact: args.exact === true,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext,
    credentialSemantics: args.credentialSemantics === true,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const target = extractBrowserGuardedFillTarget(raw.data);
  if (
    !target
    || target.browserContextId !== args.expectedBrowserContextId
    || target.pageId !== args.expectedPageId
    || target.url !== args.expectedUrl
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser target capability response did not match the expected observation', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  return { ok: true, data: target };
}

/**
 * Sealed canary for a non-secret, non-submit browser field draft.
 *
 * `targetId` is the short-lived single-use ElementHandle capability from
 * observeGuardedNonSecretFillTarget. `targetFingerprint` is stable for the
 * inspected target/current document and is the value approvals may persist.
 * The bridge consumes the capability, fills that same handle, and verifies it
 * with inputValue(). Proof echoes the fingerprint but never targetId or value.
 */
export async function fillGuardedNonSecretField(
  args: BrowserGuardedNonSecretFillArgs,
): Promise<BrowserActionResult<BrowserFillProof>> {
  if (typeof args.text !== 'string') {
    return browserFailureResult(describeBrowserBridgeFailure('text required', 'invalid_input'));
  }
  if (args.text.length > 4000) {
    return browserFailureResult(describeBrowserBridgeFailure('text too long (max 4000)', 'invalid_input'));
  }
  if ((args as { submit?: unknown }).submit === true) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser fill canary refuses submit semantics', 'invalid_input'),
      {
        recoveryHint: 'Use the dedicated approval-gated submit action after reviewing the drafted field.',
        requiredEvidence: ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'],
      },
    );
  }
  if (hasCredentialFillSignals(args)) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser fill canary refuses credential semantics', 'invalid_input'),
      {
        recoveryHint: 'Use the dedicated approval- and origin-gated credential fill path.',
        requiredEvidence: ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'],
      },
    );
  }

  const gate = await preMutationVerificationGate<BrowserFillProof>(args.skipVerificationCheck);
  if (gate) return gate;

  if (args.shouldContinue && args.shouldContinue() !== true) {
    return browserFailureResult(describeBrowserBridgeFailure('browser fill stopped before bridge mutation', 'approval_required'));
  }

  if (
    !isValidBrowserIdentityExpectation(args)
    || !isBoundedOpaqueBrowserId(args.targetId)
    || !isBoundedOpaqueBrowserId(args.targetFingerprint)
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('valid target capability, fingerprint, and prior browser identity required', 'stale_bridge'),
      {
        recoveryHint: 'Observe the exact field again, then retry once with its new target capability and approved fingerprint.',
        requiredEvidence: ['browser.dom_snapshot', 'browser.fill_target'],
      },
    );
  }

  const raw = await callBrowser<BrowserFillProof>('POST', '/browser/fill', {
    fillMode: 'guarded_non_secret',
    targetId: args.targetId,
    targetFingerprint: args.targetFingerprint,
    text: args.text,
    submit: false,
    timeoutMs: args.timeoutMs,
    taskContext: args.taskContext,
    credentialSemantics: args.credentialSemantics === true,
    expectedBrowserContextId: args.expectedBrowserContextId,
    expectedPageId: args.expectedPageId,
    expectedUrl: args.expectedUrl,
  });
  if (!raw.ok || !raw.data) return raw;
  const proof = extractBrowserFillProofMetadata(raw.data);
  if (
    !proof
    || proof.targetFingerprint !== args.targetFingerprint
    || proof.browserContextId !== args.expectedBrowserContextId
    || proof.pageId !== args.expectedPageId
    || proof.url !== args.expectedUrl
  ) {
    return browserFailureResult(
      describeBrowserBridgeFailure('guarded fill proof did not match the approved target fingerprint and observation', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot', 'browser.fill_target'] },
    );
  }
  return { ok: true, data: proof };
}

/**
 * Legacy unsealed select entry point. Kept for source compatibility only;
 * callers must migrate to observeGuardedBrowserSelectTarget followed by
 * setGuardedBrowserSelectOption.
 */
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
  return browserFailureResult(
    describeBrowserBridgeFailure(
      'unsealed browser selection is disabled; observe one exact native select and option before mutation',
      'browser_select_canary_blocked',
    ),
    {
      recoveryHint: 'Use the guarded native-select observe and mutation APIs with a fresh DOM identity.',
      requiredEvidence: ['browser.dom_snapshot', 'browser.select_target'],
    },
  );
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

/** Full-page screenshot as base64 PNG plus the exact page observation identity. */
export async function screenshot(
  opts?: { fullPage?: boolean },
): Promise<DesktopResult<BrowserPageIdentity & { base64: string; mimeType: string; sizeBytes: number }>> {
  return callBrowser('POST', '/browser/screenshot', opts || {});
}

/**
 * List every open tab in the persistent context with a stable 0-based
 * index, marking the active one. Popups the site spawns (OAuth windows,
 * `target=_blank` clicks, `window.open`) are tracked too. The raw bridge
 * list is passed through `normalizeTabList` (bounds count, coerces types,
 * guarantees exactly one active tab) and titles/urls are sanitized as
 * untrusted page text before the model sees them.
 */
export async function listTabs(): Promise<DesktopResult<BrowserTabListResult>> {
  const raw = await callBrowser<BrowserPageIdentity & { tabs?: unknown }>('GET', '/browser/tabs_list');
  if (!raw.ok || !raw.data) return raw as DesktopResult<BrowserTabListResult>;
  const identity = extractBrowserPageIdentity(raw.data);
  if (!identity) {
    return browserFailureResult(
      describeBrowserBridgeFailure('browser tab observation identity missing', 'stale_bridge'),
      { requiredEvidence: ['browser.dom_snapshot'] },
    );
  }
  const normalized: NormalizedTabList = normalizeTabList(raw.data.tabs);
  const tabs = normalized.tabs.map((tab) => ({
    ...tab,
    // Page-derived title/url is UNTRUSTED — sanitize the model-visible text.
    url: sanitizeUntrustedForModel(tab.url),
    title: sanitizeUntrustedForModel(tab.title),
  }));
  return {
    ok: true,
    data: {
      ...identity,
      tabs,
      activeIndex: normalized.activeIndex,
      count: tabs.length,
    },
  };
}

/**
 * Bring a tab to the foreground by 0-based index and make it the active
 * page for subsequent single-page actions (click/fill/screenshot). Use
 * `listTabs` first to pick the index.
 */
export async function switchTab(
  index: number,
): Promise<DesktopResult<BrowserPageIdentity & { index: number; title: string; active: boolean }>> {
  if (!Number.isInteger(index) || index < 0) {
    return browserFailureResult(describeBrowserBridgeFailure('tab index must be a non-negative integer', 'invalid_input'));
  }
  const r = await callBrowser<BrowserPageIdentity & { index: number; title: string; active: boolean }>('POST', '/browser/tab_switch', { index });
  if (r.ok && r.data) {
    return { ok: true, data: { ...r.data, url: sanitizeUntrustedForModel(r.data.url), title: sanitizeUntrustedForModel(r.data.title) } };
  }
  return r;
}

/**
 * Close a tab by 0-based index. The bridge refuses to close the last
 * remaining tab (the context needs one live page). After closing, the
 * active page falls back to the last remaining tab.
 */
export async function closeTab(index: number): Promise<DesktopResult<{ closed: number; remaining: number }>> {
  if (!Number.isInteger(index) || index < 0) {
    return browserFailureResult(describeBrowserBridgeFailure('tab index must be a non-negative integer', 'invalid_input'));
  }
  return callBrowser('POST', '/browser/tab_close', { index });
}

/**
 * Explicit, bounded semantic wait so the model can synchronize on dynamic
 * content instead of polling screenshots. Element conditions use one exact
 * ARIA role + accessible name; page conditions use a named lifecycle state.
 * Raw selectors and unknown fields fail closed locally before dispatch.
 */
export async function waitFor(args: BrowserSemanticWaitInput): Promise<DesktopResult<BrowserWaitForResult>> {
  const normalized = normalizeBrowserSemanticWait(args);
  if (!normalized.ok) {
    return browserFailureResult(describeBrowserBridgeFailure(normalized.error, 'invalid_input'));
  }
  const spec = normalized.value;
  const request = spec.mode === 'element'
    ? {
        expectedBrowserProcessId: spec.expectedBrowserProcessId,
        expectedBrowserContextId: spec.expectedBrowserContextId,
        expectedPageId: spec.expectedPageId,
        expectedUrl: spec.expectedUrl,
        condition: spec.condition,
        role: spec.role,
        name: spec.name,
        exact: true,
        timeoutMs: spec.timeoutMs,
      }
    : {
        expectedBrowserProcessId: spec.expectedBrowserProcessId,
        expectedBrowserContextId: spec.expectedBrowserContextId,
        expectedPageId: spec.expectedPageId,
        expectedUrl: spec.expectedUrl,
        condition: spec.condition,
        timeoutMs: spec.timeoutMs,
      };
  const response = await callBrowser<BrowserWaitForResult>('POST', '/browser/wait_for', request);
  if (!response.ok || !response.data) return response;
  const data = response.data as unknown as Record<string, unknown>;
  const identityReceipt = extractBrowserSemanticPageIdentityReceipt(data, spec);
  if (
    !identityReceipt
    || data.condition !== spec.condition
    || data.timeoutMs !== spec.timeoutMs
    || data.completed !== true
  ) {
    return browserFailureResult(describeBrowserBridgeFailure(
      'Browser wait returned an invalid privacy-bounded receipt.',
      'stale_bridge',
    ));
  }
  return {
    ok: true,
    data: {
      ...identityReceipt,
      condition: spec.condition,
      timeoutMs: spec.timeoutMs,
      completed: true,
    },
  };
}

/**
 * One semantic, bounded browser-page scroll. The model supplies direction and
 * a coarse amount; raw dx/dy coordinates are never accepted or returned.
 */
export async function scrollPage(args: BrowserSemanticScrollInput): Promise<DesktopResult<BrowserScrollResult>> {
  const normalized = normalizeBrowserSemanticScroll(args);
  if (!normalized.ok) {
    return browserFailureResult(describeBrowserBridgeFailure(normalized.error, 'invalid_input'));
  }
  const spec = normalized.value;
  const response = await callBrowser<BrowserScrollResult>('POST', '/browser/scroll', {
    expectedBrowserProcessId: spec.expectedBrowserProcessId,
    expectedBrowserContextId: spec.expectedBrowserContextId,
    expectedPageId: spec.expectedPageId,
    expectedUrl: spec.expectedUrl,
    direction: spec.direction,
    amount: spec.amount,
  });
  if (!response.ok || !response.data) return response;
  const data = response.data as unknown as Record<string, unknown>;
  const identityReceipt = extractBrowserSemanticPageIdentityReceipt(data, spec);
  if (
    !identityReceipt
    || data.direction !== spec.direction
    || data.amount !== spec.amount
    || data.movementVerified !== true
    || data.completed !== true
  ) {
    return browserFailureResult(describeBrowserBridgeFailure(
      'Browser scroll returned an invalid privacy-bounded receipt.',
      'stale_bridge',
    ));
  }
  return {
    ok: true,
    data: {
      ...identityReceipt,
      direction: spec.direction,
      amount: spec.amount,
      movementVerified: true,
      completed: true,
    },
  };
}

/** @deprecated Use scrollPage; retained as a semantic-signature compatibility alias. */
export const scrollWheel = scrollPage;

/**
 * Trigger a download and save it to a scoped downloads dir under the UC
 * app-support area, returning a REAL on-disk file path + byte size. This
 * is the backend-aware proof for "download the invoice/report" tasks — a
 * verifiable file, not just a screenshot — and it feeds the evidence
 * contract's file_stat proof-after requirement.
 *
 * Pass a click target (role/name/selector) to fire the download link; omit
 * it when a prior `openUrl` to a direct file URL already started the
 * download. The returned `proof.summary` never leaks the full home path.
 */
export async function downloadFile(args?: {
  role?: string;
  name?: string;
  selector?: string;
  exact?: boolean;
  nth?: number;
  timeoutMs?: number;
  taskContext?: string;
  /** Skip the pre-mutation verification-gate check. See clickRole. */
  skipVerificationCheck?: boolean;
}): Promise<BrowserActionResult<BrowserDownloadResult>> {
  const gate = await preMutationVerificationGate<BrowserDownloadResult>(args?.skipVerificationCheck);
  if (gate) return gate;
  const { skipVerificationCheck: _skip, ...body } = args || {};
  const r = await callBrowser<{ path?: string; basename?: string; sizeBytes?: number; suggestedFilename?: string }>('POST', '/browser/download', body);
  if (!r.ok || !r.data) return r as BrowserActionResult<BrowserDownloadResult>;
  // Rebuild the proof client-side through the shared pure helper so the
  // home-path-safe tail + human size are consistent even against an older
  // bridge; sanitize the model-visible basename (suggested filenames are
  // page/site-controlled, hence untrusted).
  const proof = buildDownloadProof({
    path: r.data.path,
    sizeBytes: r.data.sizeBytes,
    basename: sanitizeUntrustedForModel(r.data.basename),
    suggestedFilename: sanitizeUntrustedForModel(r.data.suggestedFilename),
  });
  return {
    ok: true,
    data: {
      path: r.data.path || '',
      basename: proof.basename,
      sizeBytes: proof.sizeBytes,
      suggestedFilename: proof.suggestedFilename,
      proof,
    },
  };
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
  const controlledSensitiveName = node.sensitiveKind
    ? `${node.sensitiveKind === 'one-time code'
      ? 'One-time code'
      : node.sensitiveKind.charAt(0).toUpperCase() + node.sensitiveKind.slice(1)} field`
    : '';
  const displayName = node.valueRedacted === true && controlledSensitiveName
    ? controlledSensitiveName
    : node.name;
  if (displayName) parts.push(`"${sanitizeBrowserSnapshotModelText(displayName, 120).replace(/"/g, '\\"')}"`);
  if (node.valueRedacted !== true && node.value && node.value !== displayName) {
    parts.push(`= "${sanitizeBrowserSnapshotModelText(String(node.value), 80).replace(/"/g, '\\"')}"`);
  }
  if (node.valueRedacted === true) {
    const valueLength = Number.isSafeInteger(node.valueLength)
      ? Math.max(0, Math.min(1_000_000, Number(node.valueLength)))
      : 0;
    parts.push(`[value redacted; length=${valueLength}]`);
  }
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
