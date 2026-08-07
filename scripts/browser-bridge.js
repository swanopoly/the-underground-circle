/**
 * browser-bridge — Playwright-backed persistent Chrome context for
 * the UC desktop bridge. Plugged into claude-bridge.js under the
 * `/browser/*` endpoint family.
 *
 * Why persistent: `launchPersistentContext` reuses a real Chrome
 * profile across calls, so sites stay logged in, cookies persist,
 * passkeys work, and routine login friction drops. CAPTCHA/2FA/bot
 * verification still pauses for a human to complete manually.
 *
 * Profile location: ~/Library/Application Support/UC/ChromeProfile
 *   — intentionally OUR profile, not the user's real Chrome profile.
 *     That way we never risk corrupting the user's primary session
 *     during dev; the user logs into the sites they want UC to
 *     automate ONCE in this profile and those logins persist.
 *
 * Channel: tries system `chrome` (the Google Chrome the user already
 * has installed) first, falls back to Playwright's bundled Chromium
 * only if Chrome's missing. Using system Chrome keeps extensions +
 * passkeys working; falling back to Chromium keeps the bridge useful
 * on headless/CI machines.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { chromium } = require('playwright');

const PROFILE_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'UC',
  'ChromeProfile',
);

// Scoped downloads land here — OUR area, not the user's real Downloads
// folder — so download proof is a real on-disk file we control and can
// stat, without touching the user's personal downloads.
const DOWNLOADS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'UC',
  'downloads',
);

let context = null;   // BrowserContext
let page = null;      // Page (the ACTIVE re-used page — existing commands
                      // operate on this one)
let launchError = null;
let launchPromise = null;

/**
 * Browser identities are capabilities issued by this bridge process, not
 * browser indices or OS process ids. The process nonce changes on every
 * bridge restart, and the monotonic suffix prevents reuse even if a test
 * random source is deterministic. A page id stays stable for the current
 * live document, rotates on main-frame navigation/reload (including same-URL
 * reload), and can never be reused after the Page is retired.
 */
function createBrowserIdentityRegistry(options = {}) {
  const randomUUID = typeof options.randomUUID === 'function'
    ? options.randomUUID
    : () => crypto.randomUUID();
  const now = typeof options.now === 'function'
    ? options.now
    : () => new Date().toISOString();
  const processNonce = String(randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || crypto.randomBytes(16).toString('hex');
  let sequence = 0;
  const contextIds = new WeakMap();
  const pageIds = new WeakMap();
  const retiredContexts = new WeakSet();
  const retiredPages = new WeakSet();

  const issue = (kind) => `uc_browser_${kind}_${processNonce}_${(++sequence).toString(36)}`;
  const browserProcessId = issue('process');

  function browserContextIdFor(ctx) {
    if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function') || retiredContexts.has(ctx)) return null;
    let id = contextIds.get(ctx);
    if (!id) {
      id = issue('context');
      contextIds.set(ctx, id);
    }
    return id;
  }

  function pageIdFor(pageRef) {
    if (!pageRef || (typeof pageRef !== 'object' && typeof pageRef !== 'function') || retiredPages.has(pageRef)) return null;
    let id = pageIds.get(pageRef);
    if (!id) {
      id = issue('page');
      pageIds.set(pageRef, id);
    }
    return id;
  }

  function advancePageDocument(pageRef) {
    if (!pageRef || (typeof pageRef !== 'object' && typeof pageRef !== 'function') || retiredPages.has(pageRef)) return null;
    const id = issue('page');
    pageIds.set(pageRef, id);
    return id;
  }

  function retirePage(pageRef) {
    if (!pageRef || (typeof pageRef !== 'object' && typeof pageRef !== 'function')) return;
    retiredPages.add(pageRef);
    pageIds.delete(pageRef);
  }

  function retireContext(ctx) {
    if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) return;
    retiredContexts.add(ctx);
    contextIds.delete(ctx);
  }

  function observe(ctx, pageRef, url) {
    const browserContextId = browserContextIdFor(ctx);
    const pageId = pageIdFor(pageRef);
    if (!browserContextId || !pageId) return null;
    return {
      browserProcessId,
      browserContextId,
      pageId,
      url: String(url || ''),
      observedAt: now(),
      evidenceId: issue('evidence'),
    };
  }

  function observeProcess(url = '') {
    return {
      browserProcessId,
      browserContextId: null,
      pageId: null,
      url: String(url || ''),
      observedAt: now(),
      evidenceId: issue('evidence'),
    };
  }

  return {
    browserProcessId,
    browserContextIdFor,
    pageIdFor,
    advancePageDocument,
    retireContext,
    retirePage,
    observe,
    observeProcess,
  };
}

const browserIdentities = createBrowserIdentityRegistry();
const GUARDED_TARGET_TTL_MS = 120_000;
const GUARDED_TARGET_MAX_LIVE = 128;
const guardedTargetFingerprintKey = crypto.randomBytes(32);
const BROWSER_URL_IDENTITY_PREFIX = 'uc_browser_url_';

/**
 * Keep the exact live URL inside the trusted bridge while still giving the
 * model a stable value it can hand back to the read-only actionability check.
 * The per-process HMAC rotates with the bridge, cannot reveal userinfo/query/
 * fragment values, and changes for every exact URL change (including an SPA
 * query/hash transition that may not rotate the Playwright Page object).
 */
function createBrowserUrlIdentityCodec(options = {}) {
  const suppliedKey = options.key;
  const key = Buffer.isBuffer(suppliedKey)
    ? Buffer.from(suppliedKey)
    : suppliedKey instanceof Uint8Array
      ? Buffer.from(suppliedKey)
      : crypto.randomBytes(32);
  if (key.length < 32) {
    throw new Error('browser URL identity key must contain at least 32 bytes');
  }

  function build(rawUrl) {
    return `${BROWSER_URL_IDENTITY_PREFIX}${crypto
      .createHmac('sha256', key)
      .update('browser-url-identity-v1\0')
      .update(String(rawUrl || ''))
      .digest('hex')}`;
  }

  function matches(expectedUrl, currentUrl) {
    if (!isBrowserUrlIdentity(expectedUrl)) return false;
    const actual = build(currentUrl);
    try {
      return crypto.timingSafeEqual(Buffer.from(expectedUrl), Buffer.from(actual));
    } catch {
      return false;
    }
  }

  return { build, matches };
}

function isBrowserUrlIdentity(value) {
  return (
    typeof value === 'string'
    && new RegExp(`^${BROWSER_URL_IDENTITY_PREFIX}[a-f0-9]{64}$`).test(value)
  );
}

const browserUrlIdentityCodec = createBrowserUrlIdentityCodec({
  key: guardedTargetFingerprintKey,
});

function buildBrowserUrlIdentity(rawUrl) {
  return browserUrlIdentityCodec.build(rawUrl);
}

function browserOpaqueUrlIdentityMatches(expectedUrl, currentUrl) {
  return browserUrlIdentityCodec.matches(expectedUrl, currentUrl);
}

/**
 * Existing mutation compatibility paths may still hold a pre-HMAC exact URL.
 * New DOM/actionability paths separately require `isBrowserUrlIdentity`.
 */
function browserExpectedUrlMatches(expectedUrl, currentUrl) {
  if (!isBrowserUrlIdentity(expectedUrl)) return expectedUrl === currentUrl;
  return browserOpaqueUrlIdentityMatches(expectedUrl, currentUrl);
}

function createGuardedTargetCapabilityStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Math.max(1_000, Math.min(300_000, Number(options.ttlMs) || GUARDED_TARGET_TTL_MS));
  const maxLive = Math.max(1, Math.min(512, Number(options.maxLive) || GUARDED_TARGET_MAX_LIVE));
  const maxTombstones = maxLive * 4;
  const randomBytes = typeof options.randomBytes === 'function' ? options.randomBytes : crypto.randomBytes;
  const live = new Map();
  const tombstones = new Map();
  let sequence = 0;

  function setTombstone(targetId, code, deleteAtMs) {
    tombstones.delete(targetId);
    tombstones.set(targetId, { code, deleteAtMs });
    while (tombstones.size > maxTombstones) {
      const oldest = tombstones.keys().next().value;
      if (!oldest) break;
      tombstones.delete(oldest);
    }
  }

  function cleanup(at = now()) {
    for (const [targetId, record] of live.entries()) {
      if (record.expiresAtMs > at) continue;
      live.delete(targetId);
      setTombstone(targetId, 'browser_target_expired', at + ttlMs);
      if (record.expiryTimer) clearTimeout(record.expiryTimer);
      try {
        const pending = record.handle && record.handle.dispose && record.handle.dispose();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch {}
    }
    for (const [targetId, tombstone] of tombstones.entries()) {
      if (tombstone.deleteAtMs <= at) tombstones.delete(targetId);
    }
  }

  function issue(record) {
    const at = now();
    cleanup(at);
    if (live.size >= maxLive) return { ok: false, code: 'browser_target_capacity' };
    let targetId = '';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const nonce = Buffer.from(randomBytes(24)).toString('base64url');
      const candidate = `uc_browser_target_${nonce}_${(++sequence).toString(36)}`;
      if (!live.has(candidate) && !tombstones.has(candidate)) {
        targetId = candidate;
        break;
      }
    }
    if (!targetId) return { ok: false, code: 'browser_target_capacity' };
    const expiresAtMs = at + ttlMs;
    const expiryTimer = setTimeout(() => cleanup(now()), ttlMs + 5);
    if (typeof expiryTimer.unref === 'function') expiryTimer.unref();
    live.set(targetId, { ...record, targetId, expiresAtMs, expiryTimer });
    return {
      ok: true,
      targetId,
      targetExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  function consume(targetId) {
    const at = now();
    cleanup(at);
    const id = typeof targetId === 'string' ? targetId : '';
    const tombstone = tombstones.get(id);
    if (tombstone) return { ok: false, code: tombstone.code };
    const record = live.get(id);
    if (!record) return { ok: false, code: 'browser_target_unknown' };
    live.delete(id);
    if (record.expiryTimer) clearTimeout(record.expiryTimer);
    setTombstone(id, 'browser_target_replayed', Math.max(record.expiresAtMs, at + ttlMs));
    return { ok: true, record };
  }

  function revokeWhere(predicate, code = 'browser_target_revoked') {
    const at = now();
    cleanup(at);
    for (const [targetId, record] of live.entries()) {
      if (!predicate(record)) continue;
      live.delete(targetId);
      if (record.expiryTimer) clearTimeout(record.expiryTimer);
      setTombstone(targetId, code, at + ttlMs);
      try {
        const pending = record.handle && record.handle.dispose && record.handle.dispose();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch {}
    }
  }

  return {
    issue,
    consume,
    cleanup,
    revokeWhere,
    liveSize: () => live.size,
  };
}

const guardedTargetCapabilities = createGuardedTargetCapabilityStore();

// Multi-tab: we track every page the context opens (including popups the
// site spawns) so tabs_list / tab_switch / tab_close can address them by a
// stable 0-based index. `page` always points at the ACTIVE tab so the
// legacy single-page commands keep working unchanged.
function trackContextPages(ctx) {
  browserIdentities.browserContextIdFor(ctx);
  const trackedPages = new WeakSet();

  const trackPage = (newPage) => {
    if (!newPage || trackedPages.has(newPage)) return;
    trackedPages.add(newPage);
    browserIdentities.pageIdFor(newPage);
    newPage.on('framenavigated', (frame) => {
      try {
        if (frame === newPage.mainFrame()) {
          guardedTargetCapabilities.revokeWhere(
            (record) => record.pageRef === newPage,
            'browser_target_revoked',
          );
          browserIdentities.advancePageDocument(newPage);
        }
      } catch {}
    });
    newPage.on('close', () => {
      guardedTargetCapabilities.revokeWhere((record) => record.pageRef === newPage);
      browserIdentities.retirePage(newPage);
      if (page === newPage) {
        const remaining = ctx.pages();
        page = remaining[remaining.length - 1] || null;
      }
    });
  };

  for (const existingPage of ctx.pages()) trackPage(existingPage);

  // New pages (target=_blank clicks, window.open, OAuth popups) become the
  // active page — that mirrors what a human sees when a popup steals focus,
  // and it's what the model most likely wants to act on next.
  ctx.on('page', (newPage) => {
    trackPage(newPage);
    page = newPage;
  });

  ctx.on('close', () => {
    guardedTargetCapabilities.revokeWhere((record) => record.contextRef === ctx);
    for (const existingPage of ctx.pages()) browserIdentities.retirePage(existingPage);
    browserIdentities.retireContext(ctx);
    if (context === ctx) {
      context = null;
      page = null;
    }
  });
}

// Resolve the active page, healing a stale reference (closed/detached) by
// falling back to the last live page in the context.
function activePage(ctx) {
  if (page && !page.isClosed()) return page;
  const pages = ctx.pages();
  page = pages[pages.length - 1] || null;
  return page;
}

function pageUrl(pageRef) {
  try { return String(pageRef && pageRef.url ? pageRef.url() : ''); } catch { return ''; }
}

function observeBrowserPage(ctx, pageRef) {
  return browserIdentities.observe(ctx, pageRef, pageUrl(pageRef));
}

function isBoundedIdentity(value) {
  return typeof value === 'string' && value.length >= 20 && value.length <= 180 && /^[A-Za-z0-9_-]+$/.test(value);
}

const GUARDED_TARGET_OBSERVE_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'frameSelector',
  'exact',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

const GUARDED_TARGET_FILL_FIELDS = new Set([
  'fillMode',
  'targetId',
  'targetFingerprint',
  'text',
  'submit',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

function hasExactlyOneGuardedFillLocator(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasSelector = Object.prototype.hasOwnProperty.call(body, 'selector');
  if (hasName && (
    typeof body.name !== 'string'
    || !body.name.trim()
    || body.name !== body.name.trim()
    || body.name.length > 500
  )) return false;
  if (hasSelector && (
    typeof body.selector !== 'string'
    || !body.selector.trim()
    || body.selector !== body.selector.trim()
    || body.selector.length > 1_000
  )) return false;
  return Number(hasName) + Number(hasSelector) === 1;
}

function hasGuardedFillLocatorOverride(body) {
  return Boolean(
    body
    && typeof body === 'object'
    && (
      Object.prototype.hasOwnProperty.call(body, 'name')
      || Object.prototype.hasOwnProperty.call(body, 'selector')
    )
  );
}

const GUARDED_TOGGLE_OBSERVE_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'frameSelector',
  'exact',
  'timeoutMs',
  'taskContext',
  'desiredState',
  'submit',
  'credentialSemantics',
  'expectedBrowserProcessId',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

const GUARDED_TOGGLE_MUTATION_FIELDS = new Set([
  'toggleMode',
  'targetId',
  'targetFingerprint',
  'desiredState',
  'submit',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
  'expectedBrowserProcessId',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

const GUARDED_SELECT_OBSERVE_FIELDS = new Set([
  'selectMode',
  'role',
  'name',
  'selector',
  'matchBy',
  'value',
  'submit',
  'exact',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
  'expectedBrowserProcessId',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

const GUARDED_SELECT_MUTATION_FIELDS = new Set([
  'selectMode',
  'targetId',
  'targetFingerprint',
  'optionFingerprint',
  'matchBy',
  'submit',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
  'expectedBrowserProcessId',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

const LOCATOR_ACTIONABILITY_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'exact',
  'expectedBrowserProcessId',
  'expectedBrowserContextId',
  'expectedPageId',
  'expectedUrl',
]);

function hasOnlyAllowedBodyFields(body, allowedFields) {
  return !!body
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).every((field) => allowedFields.has(field));
}

/**
 * This evidence path accepts browser-native CSS only. Playwright selector
 * engines (`xpath=`, `text=`, `>> nth=0`) and positional CSS pseudo-classes
 * can collapse an ambiguous base target to one match, defeating the exact-one
 * contract. Backslash escapes are rejected so a positional pseudo cannot be
 * smuggled through an escaped identifier.
 */
function isNonPositionalNativeCssSelector(value) {
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

function hasExactlyOneLocatorActionabilityTarget(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'role');
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasSelector = Object.prototype.hasOwnProperty.call(body, 'selector');
  const boundedTrimmedString = (value, maxLength) => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value === value.trim()
  );
  if (hasSelector) {
    return !hasRole
      && !hasName
      && boundedTrimmedString(body.selector, 1_000)
      && isNonPositionalNativeCssSelector(body.selector);
  }
  return hasRole
    && hasName
    && boundedTrimmedString(body.role, 100)
    && boundedTrimmedString(body.name, 500);
}

/**
 * Exact handler-entry identity gate for the non-submit, non-credential fill
 * canary. This is deliberately independent of model/runtime metadata: the
 * bridge compares its own live object identities and URL immediately before
 * the Playwright mutation.
 */
function checkExpectedBrowserFillIdentity(registry, ctx, pageRef, body, activePageRef) {
  const expectedBrowserContextId = body && body.expectedBrowserContextId;
  const expectedPageId = body && body.expectedPageId;
  const expectedUrl = body && body.expectedUrl;
  if (
    !isBoundedIdentity(expectedBrowserContextId)
    || !isBoundedIdentity(expectedPageId)
    || typeof expectedUrl !== 'string'
    || expectedUrl.length < 1
    || expectedUrl.length > 4096
  ) {
    return { ok: false, code: 'browser_identity_required' };
  }
  const browserContextId = registry.browserContextIdFor(ctx);
  const pageId = registry.pageIdFor(pageRef);
  const currentUrl = pageUrl(pageRef);
  const pageIsLive = !!pageRef && (!pageRef.isClosed || pageRef.isClosed() === false);
  if (
    !pageIsLive
    || activePageRef !== pageRef
    || browserContextId !== expectedBrowserContextId
    || pageId !== expectedPageId
    || !browserExpectedUrlMatches(expectedUrl, currentUrl)
  ) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  return { ok: true };
}

function checkExpectedBrowserToggleIdentity(registry, ctx, pageRef, body, activePageRef) {
  if (!isBoundedIdentity(body && body.expectedBrowserProcessId)) {
    return { ok: false, code: 'browser_identity_required' };
  }
  if (registry.browserProcessId !== body.expectedBrowserProcessId) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  return checkExpectedBrowserFillIdentity(registry, ctx, pageRef, body, activePageRef);
}

/**
 * Strict opaque-URL variant used by semantic wait/scroll. Compatibility
 * mutation handlers may still accept an older exact raw URL, but these newer
 * primitives can only be targeted with the HMAC identity from dom_snapshot.
 */
function checkExpectedBrowserSemanticPageIdentity(registry, ctx, pageRef, body, activePageRef) {
  if (!isBrowserUrlIdentity(body && body.expectedUrl)) {
    return { ok: false, code: 'browser_identity_required' };
  }
  return checkExpectedBrowserToggleIdentity(registry, ctx, pageRef, body, activePageRef);
}

function captureBrowserSemanticPageIdentityReceipt(registry, ctx, pageRef, body, activePageRef) {
  const check = checkExpectedBrowserSemanticPageIdentity(
    registry,
    ctx,
    pageRef,
    body,
    activePageRef,
  );
  if (!check.ok) return check;
  const identity = registry.observe(ctx, pageRef, pageUrl(pageRef));
  if (
    !isCoherentBrowserPageIdentity(identity)
    || identity.browserProcessId !== body.expectedBrowserProcessId
    || identity.browserContextId !== body.expectedBrowserContextId
    || identity.pageId !== body.expectedPageId
    || !browserOpaqueUrlIdentityMatches(body.expectedUrl, identity.url)
  ) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  return {
    ok: true,
    receipt: {
      browserProcessId: identity.browserProcessId,
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      observedAt: identity.observedAt,
      evidenceId: identity.evidenceId,
      urlMatchesExpected: true,
    },
  };
}

function isCredentialFillSemantics(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.credentialSemantics === true || body.secret === true || body.isCredential === true) return true;
  const signals = [
    body.role,
    body.name,
    body.selector,
    body.label,
    body.placeholder,
    body.testId,
    body.title,
    body.frameSelector,
    body.autocomplete,
    body.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return /\b(password|passwd|passcode|credential|secret|api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|authenticator|one[\s_-]?time|otp|mfa|2fa|pin|log[\s_-]?in|sign[\s_-]?in|user[\s_-]?name|email|e-mail|recovery[\s_-]?phrase|seed[\s_-]?phrase|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|security[\s_-]?code|social[\s_-]?security|ssn|routing[\s_-]?number|bank[\s_-]?account)\b/.test(signals)
    || /type\s*=\s*["']?password\b/.test(signals)
    || /autocomplete\s*=\s*["']?(?:current-password|new-password|one-time-code|username)\b/.test(signals);
}

function isLuhnValidDigitSequence(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

/**
 * Guarded fill is deliberately a non-secret canary. Target semantics alone
 * are insufficient because a generic draft field can still be given a token,
 * card number, private key, or other credential material. This classifier
 * returns one bit only; callers never log, interpolate, persist, or return the
 * inspected text.
 */
function isSecretBearingFillText(value) {
  if (typeof value !== 'string') return true;
  const text = value.trim();
  if (!text) return false;
  if (
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i.test(text)
    || /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/=-]{8,}\b/i.test(text)
    || /\botpauth:\/\/[^\s]+/i.test(text)
    || /\b(?:https?|mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^/\s:@]+:[^@\s/]+@/i.test(text)
    || /\b(?:password|passwd|passcode|api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|client[\s_-]?secret|otp|mfa|2fa|pin|recovery[\s_-]?phrase|seed[\s_-]?phrase|cvv|cvc|security[\s_-]?code)\s*(?::|=|\bis\b)\s*["']?\S{4,}/i.test(text)
    || /\b(?:sk-(?:proj-)?|rk_live_|sk_live_|pk_live_|gh[pousr]_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza|ya29\.)[A-Za-z0-9._~+\/=-]{8,}\b/.test(text)
    || /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(text)
    || /[?&#](?:access_token|api_key|client_secret|password|private_key|token)=[^&#\s]{4,}/i.test(text)
    || /\b\d{3}-\d{2}-\d{4}\b/.test(text)
  ) {
    return true;
  }
  const possibleCards = text.match(/(?:\d[ -]?){13,19}/g) || [];
  if (possibleCards.some(isLuhnValidDigitSequence)) return true;

  // Catch otherwise-unlabelled high-entropy opaque tokens while leaving
  // ordinary prose, identifiers, UUIDs, and URLs eligible for the canary.
  const opaqueTokens = text.match(/[A-Za-z0-9_+\/=.-]{28,}/g) || [];
  return opaqueTokens.some((token) => {
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(token)) return false;
    if (/^(?:https?:|www\.)/i.test(token)) return false;
    const classes = [
      /[a-z]/.test(token),
      /[A-Z]/.test(token),
      /\d/.test(token),
      /[_+\/=.-]/.test(token),
    ].filter(Boolean).length;
    const uniqueRatio = new Set(token).size / token.length;
    return classes >= 3 && uniqueRatio >= 0.35;
  });
}

function isCredentialElementDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return true;
  const tagName = String(descriptor.tagName || '').trim().toLowerCase();
  const type = String(descriptor.type || '').trim().toLowerCase();
  const explicitRole = String(descriptor.explicitRole || '').trim().toLowerCase();
  const listId = String(descriptor.listId || '').trim();
  const ariaHasPopup = String(descriptor.ariaHasPopup || '').trim().toLowerCase();
  const ariaAutocomplete = String(descriptor.ariaAutocomplete || '').trim().toLowerCase();
  const autocomplete = String(descriptor.autocomplete || '').trim().toLowerCase();
  const signals = [
    descriptor.autocomplete,
    descriptor.listId,
    descriptor.ariaHasPopup,
    descriptor.ariaAutocomplete,
    descriptor.name,
    descriptor.id,
    descriptor.ariaLabel,
    descriptor.placeholder,
    descriptor.inputMode,
    descriptor.labelText,
    descriptor.ariaLabelledByText,
    descriptor.ariaDescribedByText,
    descriptor.formAction,
    descriptor.formAutocomplete,
    descriptor.formAriaLabel,
    descriptor.formText,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  if (tagName !== 'input' && tagName !== 'textarea') return true;
  if (explicitRole === 'combobox' || explicitRole === 'listbox' || explicitRole === 'option') return true;
  if (listId || ariaHasPopup === 'listbox' || ariaAutocomplete === 'list' || ariaAutocomplete === 'both') return true;
  if (type === 'password' || type === 'email') return true;
  if (/\b(?:current-password|new-password|one-time-code|username|email)\b/.test(autocomplete)) return true;
  return /\b(password|passwd|passcode|credential|secret|api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|authenticator|one[\s_-]?time|otp|mfa|2fa|pin|log[\s_-]?in|sign[\s_-]?in|user[\s_-]?name|email|e-mail|recovery[\s_-]?phrase|seed[\s_-]?phrase|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|security[\s_-]?code|social[\s_-]?security|ssn|routing[\s_-]?number|bank[\s_-]?account)\b/.test(signals);
}

async function inspectResolvedFillTarget(locator, options = {}) {
  const captured = await locator.evaluate((element, evaluationOptions) => {
    const compactText = (value, maxLength = 500) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    const referencedText = (attribute) => {
      const ids = String(element && element.getAttribute && element.getAttribute(attribute) || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 20);
      const ownerDocument = element && element.ownerDocument;
      return ids
        .map((id) => ownerDocument && ownerDocument.getElementById
          ? ownerDocument.getElementById(id)
          : null)
        .map((node) => String(node && node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 500);
    };
    const structuralSegment = (node) => {
      if (!node || !node.getAttribute) return 'unavailable';
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children || []) : [];
      const siblingIndex = siblings.indexOf(node);
      const sameTagIndex = siblings
        .slice(0, Math.max(0, siblingIndex))
        .filter((sibling) => sibling && sibling.tagName === node.tagName)
        .length;
      return [
        compactText(node.tagName, 40).toLowerCase(),
        compactText(node.getAttribute('id'), 120),
        compactText(node.getAttribute('name'), 120),
        compactText(node.getAttribute('role'), 80),
        compactText(node.getAttribute('data-testid'), 120),
        String(siblingIndex),
        String(sameTagIndex),
        String((node.children && node.children.length) || 0),
      ].join(':');
    };
    const nodePath = [];
    let cursor = element;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      nodePath.push(structuralSegment(cursor));
      if (cursor.parentElement) {
        cursor = cursor.parentElement;
        continue;
      }
      const root = cursor.getRootNode && cursor.getRootNode();
      if (root && root.host) {
        nodePath.push('#shadow-root');
        cursor = root.host;
        continue;
      }
      break;
    }
    const framePath = [];
    try {
      let frameWindow = element && element.ownerDocument && element.ownerDocument.defaultView;
      for (let depth = 0; frameWindow && depth < 12; depth += 1) {
        const frameElement = frameWindow.frameElement;
        if (!frameElement) break;
        framePath.push(structuralSegment(frameElement));
        frameWindow = frameElement.ownerDocument && frameElement.ownerDocument.defaultView;
      }
    } catch {
      framePath.push('cross-origin-frame-boundary');
    }
    const ownerDocument = element && element.ownerDocument;
    const descriptor = {
      tagName: String(element && element.tagName || ''),
      type: String(element && element.getAttribute && element.getAttribute('type') || ''),
      explicitRole: String(element && element.getAttribute && element.getAttribute('role') || ''),
      listId: String(element && element.getAttribute && element.getAttribute('list') || ''),
      ariaHasPopup: String(element && element.getAttribute && element.getAttribute('aria-haspopup') || ''),
      ariaAutocomplete: String(element && element.getAttribute && element.getAttribute('aria-autocomplete') || ''),
      autocomplete: String(element && element.getAttribute && element.getAttribute('autocomplete') || ''),
      inputMode: String(element && element.getAttribute && element.getAttribute('inputmode') || ''),
      name: String(element && element.getAttribute && element.getAttribute('name') || ''),
      id: String(element && element.getAttribute && element.getAttribute('id') || ''),
      ariaLabel: String(element && element.getAttribute && element.getAttribute('aria-label') || ''),
      ariaLabelledByText: referencedText('aria-labelledby'),
      ariaDescribedByText: referencedText('aria-describedby'),
      placeholder: String(element && element.getAttribute && element.getAttribute('placeholder') || ''),
      labelText: Array.from((element && element.labels) || [])
        .map((label) => String(label && label.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .slice(0, 500),
      formAction: String(element && element.form && element.form.getAttribute('action') || '').slice(0, 500),
      formAutocomplete: String(element && element.form && element.form.getAttribute('autocomplete') || '').slice(0, 120),
      formAriaLabel: String(element && element.form && element.form.getAttribute('aria-label') || '').slice(0, 240),
      formText: String(element && element.form && element.form.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500),
      documentUrl: compactText(
        ownerDocument && ownerDocument.location && ownerDocument.location.href,
        4096,
      ),
      nodeStructure: nodePath.join('>').slice(0, 8_000),
      frameStructure: framePath.join('>').slice(0, 4_000),
      isConnected: element && element.isConnected === true,
      ownerDocumentIsCurrent: !!ownerDocument
        && !!ownerDocument.defaultView
        && ownerDocument.defaultView.document === ownerDocument,
    };
    let observedValue;
    if (evaluationOptions && evaluationOptions.includeValue === true) {
      if (!element || (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA')) {
        throw new Error('guarded fill target is not value-readable');
      }
      observedValue = String(element.value);
    }
    return {
      descriptor,
      ...(evaluationOptions && evaluationOptions.includeValue === true ? { observedValue } : {}),
    };
  }, { includeValue: options.includeValue === true });
  const descriptor = captured && captured.descriptor;
  return {
    allowed: !isCredentialElementDescriptor(descriptor),
    descriptor,
    ...(options.includeValue === true ? { observedValue: captured.observedValue } : {}),
  };
}

function buildGuardedTargetFingerprint(identity, descriptor) {
  if (!identity || !descriptor) return null;
  const semanticDescriptor = {};
  for (const key of [
    'tagName',
    'type',
    'explicitRole',
    'listId',
    'ariaHasPopup',
    'ariaAutocomplete',
    'autocomplete',
    'inputMode',
    'name',
    'id',
    'ariaLabel',
    'placeholder',
    'labelText',
    'ariaLabelledByText',
    'ariaDescribedByText',
    'formAction',
    'formAutocomplete',
    'formAriaLabel',
    'formText',
  ]) {
    semanticDescriptor[key] = String(descriptor[key] || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  const structuralDigest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-target-structure-v1\0')
    .update(JSON.stringify({
      documentUrl: String(descriptor.documentUrl || '').slice(0, 4096),
      nodeStructure: String(descriptor.nodeStructure || '').slice(0, 8_000),
      frameStructure: String(descriptor.frameStructure || '').slice(0, 4_000),
      isConnected: descriptor.isConnected === true,
      ownerDocumentIsCurrent: descriptor.ownerDocumentIsCurrent === true,
    }))
    .digest('hex');
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-target-fingerprint-v2\0')
    .update(JSON.stringify({
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      semanticDescriptor,
      structuralDigest,
    }))
    .digest('hex');
  return `uc_browser_target_fingerprint_${digest}`;
}

function isCoherentBrowserPageIdentity(identity) {
  return !!identity
    && isBoundedIdentity(identity.browserProcessId)
    && isBoundedIdentity(identity.browserContextId)
    && isBoundedIdentity(identity.pageId)
    && typeof identity.url === 'string'
    && identity.url.length >= 1
    && identity.url.length <= 4096
    && typeof identity.observedAt === 'string'
    && Number.isFinite(Date.parse(identity.observedAt))
    && isBoundedIdentity(identity.evidenceId);
}

function buildRedactedBrowserFillProofFromObservation(
  observation,
  expectedValue,
  targetFingerprint,
  mutationPerformed,
) {
  if (!observation || !isCoherentBrowserPageIdentity(observation.identity)) return null;
  const actual = typeof observation.observedValue === 'string' ? observation.observedValue : '';
  const expected = typeof expectedValue === 'string' ? expectedValue : '';
  const identity = observation.identity;
  return {
    browserProcessId: identity.browserProcessId,
    browserContextId: identity.browserContextId,
    pageId: identity.pageId,
    url: identity.url,
    observedAt: identity.observedAt,
    evidenceId: identity.evidenceId,
    valueMatches: actual === expected,
    valueLength: actual.length,
    expectedLength: expected.length,
    mutationPerformed: mutationPerformed === true,
    ...(isBoundedIdentity(targetFingerprint) ? { targetFingerprint } : {}),
  };
}

function buildRedactedBrowserFillProof(
  registry,
  ctx,
  pageRef,
  actualValue,
  expectedValue,
  targetFingerprint,
  mutationPerformed,
) {
  const identity = registry.observe(ctx, pageRef, pageUrl(pageRef));
  return buildRedactedBrowserFillProofFromObservation(
    { identity, observedValue: actualValue },
    expectedValue,
    targetFingerprint,
    mutationPerformed,
  );
}

/**
 * Capture final value, semantics, document URL, frame path, and node path in
 * one renderer evaluation. A bridge identity is minted before that capture,
 * then revalidated afterward without issuing a later evidence id. This keeps
 * the returned value and evidence in one stable observation envelope and
 * fails closed if navigation, active-page selection, target semantics, or the
 * exact keyed target fingerprint drift during the capture.
 */
async function captureCoherentGuardedFillObservation(options) {
  const {
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    targetHandle,
    timeout,
    expectedTargetFingerprint,
    resolveActivePage,
  } = options || {};
  const activeBefore = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const entryCheck = checkExpectedBrowserFillIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeBefore,
  );
  if (!entryCheck.ok) return entryCheck;
  const identity = registry.observe(contextRef, pageRef, pageUrl(pageRef));
  if (!isCoherentBrowserPageIdentity(identity)) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  let state;
  try {
    state = await inspectResolvedFillTarget(targetHandle, { includeValue: true, timeout });
  } catch {
    return { ok: false, code: 'uncertain_ui_target' };
  }
  const activeAfter = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const exitCheck = checkExpectedBrowserFillIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeAfter,
  );
  if (!exitCheck.ok) return exitCheck;
  if (
    !state
    || !state.allowed
    || typeof state.observedValue !== 'string'
    || !state.descriptor
    || state.descriptor.isConnected !== true
    || state.descriptor.ownerDocumentIsCurrent !== true
  ) {
    return { ok: false, code: state && !state.allowed ? 'browser_fill_canary_blocked' : 'uncertain_ui_target' };
  }
  if (state.descriptor.documentUrl !== identity.url) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  const targetFingerprint = buildGuardedTargetFingerprint(identity, state.descriptor);
  if (!isBoundedIdentity(expectedTargetFingerprint) || targetFingerprint !== expectedTargetFingerprint) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  return {
    ok: true,
    identity,
    observedValue: state.observedValue,
    targetFingerprint,
  };
}

const GUARDED_TOGGLE_CONSEQUENTIAL_RE = /\b(?:accept[\s_-]?(?:terms|conditions)|account|agree|analytics|approval|approve|authorize|auto[\s_-]?renew(?:al)?|backup|billing|bluetooth|book|buy|camera|cancel[\s_-]?(?:account|subscription)|card[\s_-]?number|checkout|clipboard|close[\s_-]?(?:account|profile)|cloud[\s_-]?(?:backup|sync)|consent|contacts?|crash[\s_-]?reports?|credit[\s_-]?card|delete|deploy|destroy|diagnostics?|discoverable|download|e-?mail|erase|extension|files?|grant[\s_-]?(?:access|permission)|install|location|log[\s_-]?(?:in|out)|login|marketing|merge|microphone|network|newsletter|notifications?|order|pay|payment|permission|personaliz(?:e|ed|ation)|photos?|plugins?|privacy|profile|public|publish|purchase|release|remote[\s_-]?(?:access|control|desktop|login)|remove[\s_-]?(?:account|access|content|data|file|history|item|profile|record|user)|renew(?:al)?|reserve|screen[\s_-]?recording|security|send|share|sharing|sign[\s_-]?(?:in|out)|sms|submit|subscribe|subscription|sync|telemetry|terms[\s_-]?(?:and|&)[\s_-]?conditions|tracking|transfer|uninstall|unsubscribe|update|upload|usage[\s_-]?data|visibility|vpn|wi-?fi|wipe|withdraw)\b/i;
const GUARDED_TOGGLE_CREDENTIAL_RE = /\b(?:api[\s_-]?key|authenticator|captcha|credential|cvv|cvc|hcaptcha|human[\s_-]?verification|keep[\s_-]?me[\s_-]?signed[\s_-]?in|mfa|one[\s_-]?time|otp|passcode|password|private[\s_-]?key|recaptcha|recovery[\s_-]?phrase|remember[\s_-]?me|security[\s_-]?code|seed[\s_-]?phrase|social[\s_-]?security|ssn|stay[\s_-]?signed[\s_-]?in|trusted[\s_-]?device|turnstile|two[\s_-]?factor|2fa)\b/i;
const GUARDED_TOGGLE_SAFE_PREFERENCE_RE = /\b(?:appearance|accessibility|bookmarks?[\s_-]?bar|captions?|color[\s_-]?scheme|compact[\s_-]?(?:layout|mode|spacing|view)|comfortable[\s_-]?(?:layout|mode|spacing|view)|contrast[\s_-]?mode|dark[\s_-]?mode|dense[\s_-]?(?:layout|mode|spacing|view)|dyslexi[ac][\s_-]?font|focus[\s_-]?indicator|font[\s_-]?(?:family|size)|high[\s_-]?contrast|keyboard[\s_-]?navigation|large[\s_-]?text|light[\s_-]?mode|line[\s_-]?numbers?|minimap|open[\s_-]?links?[\s_-]?in[\s_-]?new[\s_-]?tabs?|presentation|reader[\s_-]?mode|reduce[\s_-]?(?:animations?|motion|transparency)|reduced[\s_-]?(?:animations?|motion|transparency)|remove[\s_-]?animations?|screen[\s_-]?reader|sidebar|subtitles?|text[\s_-]?size|theme|tooltips?|visual[\s_-]?(?:appearance|layout|mode|preference|theme)|word[\s_-]?wrap|zoom|confirm[\s_-]?before[\s_-]?closing[\s_-]?tabs?)\b/i;

function guardedToggleSignalsAreSafePreference(signals) {
  const value = String(signals || '').slice(0, 4_000);
  if (
    GUARDED_TOGGLE_CREDENTIAL_RE.test(value)
    || GUARDED_TOGGLE_CONSEQUENTIAL_RE.test(value)
  ) {
    return false;
  }
  return GUARDED_TOGGLE_SAFE_PREFERENCE_RE.test(value);
}

function hasUnsafeGuardedToggleRequest(body) {
  if (!body || typeof body !== 'object') return true;
  const signals = [
    body.name,
    body.selector,
    body.frameSelector,
    body.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return !guardedToggleSignalsAreSafePreference(signals);
}

function isUnsafeGuardedToggleDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return true;
  const tagName = String(descriptor.tagName || '').trim().toLowerCase();
  const type = String(descriptor.type || '').trim().toLowerCase();
  const role = String(descriptor.role || '').trim().toLowerCase();
  const toggleKind = String(descriptor.toggleKind || '').trim();
  const kindMatchesRole = (
    (toggleKind === 'native_checkbox' && (role === 'checkbox' || role === 'switch'))
    || (toggleKind === 'native_radio' && role === 'radio')
    || (toggleKind === 'aria_checkbox' && role === 'checkbox')
    || (toggleKind === 'aria_switch' && role === 'switch')
    || (toggleKind === 'aria_radio' && role === 'radio')
  );
  const stateSourceIsConsistent = toggleKind.startsWith('native_')
    ? descriptor.indeterminate !== true
      && typeof descriptor.checked === 'boolean'
      && descriptor.checked === descriptor.currentState
    : String(descriptor.ariaChecked || '').trim().toLowerCase()
      === (descriptor.currentState === true ? 'true' : 'false');
  if (
    typeof descriptor.currentState !== 'boolean'
    || !['native_checkbox', 'native_radio', 'aria_checkbox', 'aria_switch', 'aria_radio'].includes(toggleKind)
    || !kindMatchesRole
    || !stateSourceIsConsistent
    || descriptor.isConnected !== true
    || descriptor.ownerDocumentIsCurrent !== true
    || descriptor.disabled === true
    || String(descriptor.ariaDisabled || '').trim().toLowerCase() === 'true'
    || descriptor.hidden === true
    || descriptor.inert === true
    || String(descriptor.ariaHidden || '').trim().toLowerCase() === 'true'
    || tagName === 'a'
    || role === 'link'
    || String(descriptor.href || '').trim()
    || ['submit', 'reset', 'image'].includes(type)
    || (tagName === 'button' && descriptor.hasForm === true && (!type || type === 'submit'))
  ) {
    return true;
  }
  const semanticSignals = [
    descriptor.role,
    descriptor.name,
    descriptor.id,
    descriptor.ariaLabel,
    descriptor.ariaLabelledByText,
    descriptor.ariaDescribedByText,
    descriptor.title,
    descriptor.labelText,
    descriptor.targetText,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  const formSignals = [
    descriptor.formAction,
    descriptor.formMethod,
    descriptor.formName,
    descriptor.formId,
    descriptor.formAriaLabel,
    descriptor.formText,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  const combinedSignals = `${semanticSignals} ${formSignals}`;
  return GUARDED_TOGGLE_CREDENTIAL_RE.test(combinedSignals)
    || GUARDED_TOGGLE_CONSEQUENTIAL_RE.test(combinedSignals)
    || !guardedToggleSignalsAreSafePreference(semanticSignals);
}

async function inspectResolvedToggleTarget(handle) {
  const captured = await handle.evaluate((element) => {
    const compactText = (value, maxLength = 500) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    const referencedText = (attribute) => {
      const ids = String(element && element.getAttribute && element.getAttribute(attribute) || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 20);
      const ownerDocument = element && element.ownerDocument;
      return ids
        .map((id) => ownerDocument && ownerDocument.getElementById
          ? ownerDocument.getElementById(id)
          : null)
        .map((node) => compactText(node && node.textContent, 500))
        .filter(Boolean)
        .join(' ')
        .slice(0, 500);
    };
    const structuralSegment = (node) => {
      if (!node || !node.getAttribute) return 'unavailable';
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children || []) : [];
      const siblingIndex = siblings.indexOf(node);
      const sameTagIndex = siblings
        .slice(0, Math.max(0, siblingIndex))
        .filter((sibling) => sibling && sibling.tagName === node.tagName)
        .length;
      return [
        compactText(node.tagName, 40).toLowerCase(),
        compactText(node.getAttribute('id'), 120),
        compactText(node.getAttribute('name'), 120),
        compactText(node.getAttribute('role'), 80),
        compactText(node.getAttribute('data-testid'), 120),
        String(siblingIndex),
        String(sameTagIndex),
        String((node.children && node.children.length) || 0),
      ].join(':');
    };
    const nodePath = [];
    let cursor = element;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      nodePath.push(structuralSegment(cursor));
      if (cursor.parentElement) {
        cursor = cursor.parentElement;
        continue;
      }
      const root = cursor.getRootNode && cursor.getRootNode();
      if (root && root.host) {
        nodePath.push('#shadow-root');
        cursor = root.host;
        continue;
      }
      break;
    }
    const framePath = [];
    try {
      let frameWindow = element && element.ownerDocument && element.ownerDocument.defaultView;
      for (let depth = 0; frameWindow && depth < 12; depth += 1) {
        const frameElement = frameWindow.frameElement;
        if (!frameElement) break;
        framePath.push(structuralSegment(frameElement));
        frameWindow = frameElement.ownerDocument && frameElement.ownerDocument.defaultView;
      }
    } catch {
      framePath.push('cross-origin-frame-boundary');
    }
    const tagName = compactText(element && element.tagName, 40).toLowerCase();
    const type = compactText(element && element.getAttribute && element.getAttribute('type'), 80).toLowerCase();
    const role = compactText(element && element.getAttribute && element.getAttribute('role'), 80).toLowerCase();
    const ariaChecked = compactText(element && element.getAttribute && element.getAttribute('aria-checked'), 20).toLowerCase();
    let toggleKind = '';
    let currentState = null;
    let normalizedRole = '';
    if (tagName === 'input' && type === 'checkbox' && element.indeterminate !== true) {
      toggleKind = 'native_checkbox';
      normalizedRole = role === 'switch' ? 'switch' : 'checkbox';
      currentState = element.checked === true;
    } else if (tagName === 'input' && type === 'radio') {
      toggleKind = 'native_radio';
      normalizedRole = 'radio';
      currentState = element.checked === true;
    } else if (
      !(tagName === 'input' && (type === 'checkbox' || type === 'radio'))
      &&
      (role === 'checkbox' || role === 'switch' || role === 'radio')
      && (ariaChecked === 'true' || ariaChecked === 'false')
    ) {
      toggleKind = `aria_${role}`;
      normalizedRole = role;
      currentState = ariaChecked === 'true';
    }
    const ownerDocument = element && element.ownerDocument;
    const form = element && (
      element.form
      || (element.closest && element.closest('form'))
    );
    const descriptor = {
      tagName,
      type,
      role: normalizedRole,
      explicitRole: role,
      toggleKind,
      currentState,
      checked: tagName === 'input' && (type === 'checkbox' || type === 'radio')
        ? element.checked === true
        : null,
      indeterminate: tagName === 'input' && type === 'checkbox' ? element.indeterminate === true : null,
      ariaChecked,
      disabled: element && element.disabled === true,
      ariaDisabled: compactText(element && element.getAttribute && element.getAttribute('aria-disabled'), 20),
      hidden: element && element.hidden === true,
      inert: element && element.inert === true,
      ariaHidden: compactText(element && element.getAttribute && element.getAttribute('aria-hidden'), 20),
      name: compactText(element && element.getAttribute && element.getAttribute('name'), 240),
      id: compactText(element && element.getAttribute && element.getAttribute('id'), 240),
      href: compactText(element && element.getAttribute && element.getAttribute('href'), 500),
      title: compactText(element && element.getAttribute && element.getAttribute('title'), 240),
      ariaLabel: compactText(element && element.getAttribute && element.getAttribute('aria-label'), 240),
      ariaLabelledByText: referencedText('aria-labelledby'),
      ariaDescribedByText: referencedText('aria-describedby'),
      labelText: Array.from((element && element.labels) || [])
        .map((label) => compactText(label && label.textContent, 500))
        .filter(Boolean)
        .join(' ')
        .slice(0, 500),
      targetText: compactText(element && element.textContent, 500),
      hasForm: !!form,
      formAction: compactText(form && form.getAttribute('action'), 500),
      formMethod: compactText(form && form.getAttribute('method'), 40),
      formName: compactText(form && form.getAttribute('name'), 120),
      formId: compactText(form && form.getAttribute('id'), 120),
      formAriaLabel: compactText(form && form.getAttribute('aria-label'), 240),
      formText: compactText(form && form.textContent, 800),
      documentUrl: compactText(
        ownerDocument && ownerDocument.location && ownerDocument.location.href,
        4096,
      ),
      nodeStructure: nodePath.join('>').slice(0, 8_000),
      frameStructure: framePath.join('>').slice(0, 4_000),
      isConnected: element && element.isConnected === true,
      ownerDocumentIsCurrent: !!ownerDocument
        && !!ownerDocument.defaultView
        && ownerDocument.defaultView.document === ownerDocument,
    };
    return descriptor;
  });
  return {
    allowed: !isUnsafeGuardedToggleDescriptor(captured),
    descriptor: captured,
    currentState: captured && captured.currentState,
    toggleKind: captured && captured.toggleKind,
  };
}

const GUARDED_TOGGLE_STABLE_SEMANTIC_FIELDS = [
  'tagName',
  'type',
  'role',
  'explicitRole',
  'toggleKind',
  'disabled',
  'ariaDisabled',
  'hidden',
  'inert',
  'ariaHidden',
  'name',
  'id',
  'href',
  'title',
  'ariaLabel',
  'ariaLabelledByText',
  'ariaDescribedByText',
  'labelText',
  'targetText',
  'hasForm',
  'formAction',
  'formMethod',
  'formName',
  'formId',
  'formAriaLabel',
  'formText',
];

function boundedGuardedToggleDescriptor(descriptor, includeState) {
  const bounded = {};
  for (const key of GUARDED_TOGGLE_STABLE_SEMANTIC_FIELDS) {
    const value = descriptor && descriptor[key];
    bounded[key] = typeof value === 'boolean'
      ? value
      : String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  }
  if (includeState) {
    bounded.currentState = descriptor && typeof descriptor.currentState === 'boolean'
      ? descriptor.currentState
      : null;
    bounded.checked = descriptor && typeof descriptor.checked === 'boolean' ? descriptor.checked : null;
    bounded.indeterminate = descriptor && typeof descriptor.indeterminate === 'boolean'
      ? descriptor.indeterminate
      : null;
    bounded.ariaChecked = String(descriptor && descriptor.ariaChecked || '').slice(0, 20);
  }
  return bounded;
}

function guardedToggleStructuralDigest(descriptor) {
  return crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-toggle-structure-v2\0')
    .update(JSON.stringify({
      documentUrl: String(descriptor && descriptor.documentUrl || '').slice(0, 4096),
      nodeStructure: String(descriptor && descriptor.nodeStructure || '').slice(0, 8_000),
      frameStructure: String(descriptor && descriptor.frameStructure || '').slice(0, 4_000),
      isConnected: descriptor && descriptor.isConnected === true,
      ownerDocumentIsCurrent: descriptor && descriptor.ownerDocumentIsCurrent === true,
    }))
    .digest('hex');
}

function buildGuardedToggleInvariantFingerprint(identity, descriptor) {
  if (!identity || !descriptor) return null;
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-toggle-invariant-v2\0')
    .update(JSON.stringify({
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      semantics: boundedGuardedToggleDescriptor(descriptor, false),
      structuralDigest: guardedToggleStructuralDigest(descriptor),
    }))
    .digest('hex');
  return `uc_browser_toggle_invariant_${digest}`;
}

function buildGuardedToggleTargetFingerprint(identity, descriptor, desiredState) {
  if (!identity || !descriptor || typeof desiredState !== 'boolean') return null;
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-toggle-fingerprint-v2\0')
    .update(JSON.stringify({
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      desiredState,
      semanticsAndCurrentState: boundedGuardedToggleDescriptor(descriptor, true),
      structuralDigest: guardedToggleStructuralDigest(descriptor),
    }))
    .digest('hex');
  return `uc_browser_toggle_fingerprint_${digest}`;
}

function checkGuardedToggleCapabilityRecord(record, body, contextRef, pageRef) {
  if (
    !record
    || record.capabilityKind !== 'guarded_toggle_v2'
    || record.contextRef !== contextRef
    || record.pageRef !== pageRef
    || record.targetFingerprint !== (body && body.targetFingerprint)
    || record.browserProcessId !== (body && body.expectedBrowserProcessId)
    || record.browserContextId !== (body && body.expectedBrowserContextId)
    || record.pageId !== (body && body.expectedPageId)
    || record.url !== (body && body.expectedUrl)
    || record.desiredState !== (body && body.desiredState)
    || typeof record.initialState !== 'boolean'
    || !isBoundedIdentity(record.invariantFingerprint)
    || !['native_checkbox', 'native_radio', 'aria_checkbox', 'aria_switch', 'aria_radio']
      .includes(String(record.toggleKind || ''))
    || !['checkbox', 'switch', 'radio'].includes(String(record.role || ''))
  ) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  return { ok: true };
}

async function captureCoherentGuardedToggleObservation(options) {
  const {
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    targetHandle,
    expectedInvariantFingerprint,
    expectedToggleKind,
    expectedRole,
    resolveActivePage,
  } = options || {};
  const activeBefore = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const entryCheck = checkExpectedBrowserToggleIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeBefore,
  );
  if (!entryCheck.ok) return entryCheck;
  const identity = registry.observe(contextRef, pageRef, pageUrl(pageRef));
  if (!isCoherentBrowserPageIdentity(identity)) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  let state;
  try {
    state = await inspectResolvedToggleTarget(targetHandle);
  } catch {
    return { ok: false, code: 'uncertain_ui_target' };
  }
  const activeAfter = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const exitCheck = checkExpectedBrowserToggleIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeAfter,
  );
  if (!exitCheck.ok) return exitCheck;
  if (
    !state
    || !state.allowed
    || typeof state.currentState !== 'boolean'
    || state.toggleKind !== expectedToggleKind
    || state.descriptor.role !== expectedRole
  ) {
    return {
      ok: false,
      code: state && !state.allowed ? 'browser_toggle_canary_blocked' : 'uncertain_ui_target',
    };
  }
  if (state.descriptor.documentUrl !== identity.url) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  const invariantFingerprint = buildGuardedToggleInvariantFingerprint(identity, state.descriptor);
  if (
    !isBoundedIdentity(expectedInvariantFingerprint)
    || invariantFingerprint !== expectedInvariantFingerprint
  ) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  return {
    ok: true,
    identity,
    currentState: state.currentState,
    toggleKind: state.toggleKind,
    role: state.descriptor.role,
  };
}

function buildRedactedBrowserToggleProof(
  observation,
  previousState,
  desiredState,
  targetFingerprint,
  mutationPerformed,
) {
  if (
    !observation
    || !isCoherentBrowserPageIdentity(observation.identity)
    || typeof previousState !== 'boolean'
    || typeof observation.currentState !== 'boolean'
    || typeof desiredState !== 'boolean'
    || !isBoundedIdentity(targetFingerprint)
    || !['checkbox', 'switch', 'radio'].includes(String(observation.role || ''))
  ) {
    return null;
  }
  const identity = observation.identity;
  return {
    browserProcessId: identity.browserProcessId,
    browserContextId: identity.browserContextId,
    pageId: identity.pageId,
    url: identity.url,
    observedAt: identity.observedAt,
    evidenceId: identity.evidenceId,
    role: observation.role,
    previousState,
    currentState: observation.currentState,
    desiredState,
    stateMatches: observation.currentState === desiredState,
    mutationPerformed: mutationPerformed === true,
    targetFingerprint,
  };
}

const GUARDED_SELECT_MAX_OPTIONS = 500;
const GUARDED_SELECT_MATCH_BY = new Set(['value', 'label']);

function guardedSelectSignalsAreSafePreference(signals) {
  return guardedToggleSignalsAreSafePreference(signals);
}

function hasUnsafeGuardedSelectRequest(body) {
  if (!body || typeof body !== 'object') return true;
  const signals = [
    body.name,
    body.selector,
    body.value,
    body.taskContext,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return !guardedSelectSignalsAreSafePreference(signals);
}

function isUnsafeGuardedSelectDescriptor(descriptor, desiredOption) {
  if (!descriptor || typeof descriptor !== 'object' || !desiredOption) return true;
  const tagName = String(descriptor.tagName || '').trim().toLowerCase();
  const role = String(descriptor.role || '').trim().toLowerCase();
  const explicitRole = String(descriptor.explicitRole || '').trim().toLowerCase();
  if (
    tagName !== 'select'
    || role !== 'combobox'
    || (explicitRole && explicitRole !== 'combobox')
    || String(descriptor.nativeType || '').trim().toLowerCase() !== 'select-one'
    || descriptor.multiple === true
    || Number(descriptor.size) > 1
    || !Number.isSafeInteger(descriptor.optionCount)
    || descriptor.optionCount < 1
    || descriptor.optionCount > GUARDED_SELECT_MAX_OPTIONS
    || descriptor.optionsBounded !== true
    || descriptor.optionMatchCount !== 1
    || !Number.isSafeInteger(descriptor.selectedOptionCount)
    || descriptor.selectedOptionCount < 0
    || descriptor.selectedOptionCount > 1
    || descriptor.visible !== true
    || descriptor.enabled !== true
    || descriptor.disabled === true
    || String(descriptor.ariaDisabled || '').trim().toLowerCase() === 'true'
    || descriptor.hidden === true
    || descriptor.inert === true
    || descriptor.inertAncestor === true
    || descriptor.ariaHiddenAncestor === true
    || String(descriptor.ariaHidden || '').trim().toLowerCase() === 'true'
    || descriptor.hasForm === true
    || descriptor.hasInlineMutationHandler === true
    || descriptor.contentEditable === true
    || descriptor.isConnected !== true
    || descriptor.ownerDocumentIsCurrent !== true
    || !Number.isSafeInteger(desiredOption.index)
    || desiredOption.index < 0
    || desiredOption.index >= descriptor.optionCount
    || desiredOption.disabled === true
    || desiredOption.groupDisabled === true
    || desiredOption.hidden === true
    || desiredOption.inert === true
    || desiredOption.groupHidden === true
    || desiredOption.groupInert === true
    || String(desiredOption.groupAriaHidden || '').trim().toLowerCase() === 'true'
    || String(desiredOption.ariaHidden || '').trim().toLowerCase() === 'true'
  ) {
    return true;
  }
  const semanticSignals = [
    descriptor.name,
    descriptor.id,
    descriptor.title,
    descriptor.ariaLabel,
    descriptor.ariaLabelledByText,
    descriptor.ariaDescribedByText,
    descriptor.labelText,
    desiredOption.value,
    desiredOption.label,
    desiredOption.text,
    desiredOption.groupLabel,
  ]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return !guardedSelectSignalsAreSafePreference(semanticSignals);
}

async function inspectResolvedSelectTarget(handle, intent) {
  const captured = await handle.evaluate((element, evaluationIntent) => {
    const compactText = (value, maxLength = 500) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
    const referencedText = (attribute) => {
      const ids = String(element && element.getAttribute && element.getAttribute(attribute) || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 20);
      const ownerDocument = element && element.ownerDocument;
      return ids
        .map((id) => ownerDocument && ownerDocument.getElementById
          ? ownerDocument.getElementById(id)
          : null)
        .map((node) => compactText(node && node.textContent, 500))
        .filter(Boolean)
        .join(' ')
        .slice(0, 500);
    };
    const structuralSegment = (node) => {
      if (!node || !node.getAttribute) return 'unavailable';
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children || []) : [];
      const siblingIndex = siblings.indexOf(node);
      const sameTagIndex = siblings
        .slice(0, Math.max(0, siblingIndex))
        .filter((sibling) => sibling && sibling.tagName === node.tagName)
        .length;
      return [
        compactText(node.tagName, 40).toLowerCase(),
        compactText(node.getAttribute('id'), 120),
        compactText(node.getAttribute('name'), 120),
        compactText(node.getAttribute('role'), 80),
        compactText(node.getAttribute('data-testid'), 120),
        String(siblingIndex),
        String(sameTagIndex),
        String((node.children && node.children.length) || 0),
      ].join(':');
    };
    const nodePath = [];
    let cursor = element;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      nodePath.push(structuralSegment(cursor));
      if (cursor.parentElement) {
        cursor = cursor.parentElement;
        continue;
      }
      const root = cursor.getRootNode && cursor.getRootNode();
      if (root && root.host) {
        nodePath.push('#shadow-root');
        cursor = root.host;
        continue;
      }
      break;
    }
    const framePath = [];
    try {
      let frameWindow = element && element.ownerDocument && element.ownerDocument.defaultView;
      for (let depth = 0; frameWindow && depth < 12; depth += 1) {
        const frameElement = frameWindow.frameElement;
        if (!frameElement) break;
        framePath.push(structuralSegment(frameElement));
        frameWindow = frameElement.ownerDocument && frameElement.ownerDocument.defaultView;
      }
    } catch {
      framePath.push('cross-origin-frame-boundary');
    }
    const ownerDocument = element && element.ownerDocument;
    const ownerWindow = ownerDocument && ownerDocument.defaultView;
    const tagName = compactText(element && element.tagName, 40).toLowerCase();
    const explicitRole = compactText(
      element && element.getAttribute && element.getAttribute('role'),
      80,
    ).toLowerCase();
    const allOptions = tagName === 'select' ? Array.from(element.options || []) : [];
    const optionDescriptor = (option) => {
      if (!option) return null;
      const parent = option.parentElement;
      const group = parent && String(parent.tagName || '').toLowerCase() === 'optgroup'
        ? parent
        : null;
      return {
        index: allOptions.indexOf(option),
        value: String(option.value == null ? '' : option.value).slice(0, 240),
        label: String(option.label == null ? '' : option.label).slice(0, 240),
        text: compactText(option.textContent, 500),
        id: compactText(option.getAttribute && option.getAttribute('id'), 120),
        title: compactText(option.getAttribute && option.getAttribute('title'), 240),
        ariaLabel: compactText(option.getAttribute && option.getAttribute('aria-label'), 240),
        ariaHidden: compactText(option.getAttribute && option.getAttribute('aria-hidden'), 20),
        disabled: option.disabled === true,
        hidden: option.hidden === true,
        inert: option.inert === true,
        groupLabel: compactText(group && group.getAttribute('label'), 240),
        groupDisabled: group && group.disabled === true,
        groupHidden: group && group.hidden === true,
        groupInert: group && group.inert === true,
        groupAriaHidden: compactText(group && group.getAttribute('aria-hidden'), 20),
      };
    };
    const matchBy = evaluationIntent && evaluationIntent.matchBy;
    const desiredValue = evaluationIntent && evaluationIntent.value;
    const exactMatches = allOptions.filter((option) => (
      matchBy === 'value'
        ? String(option.value == null ? '' : option.value) === desiredValue
        : String(option.label == null ? '' : option.label) === desiredValue
    ));
    const desiredOptionNode = exactMatches.length === 1 ? exactMatches[0] : null;
    const selectedOptions = tagName === 'select'
      ? Array.from(element.selectedOptions || []).filter((option) => allOptions.includes(option))
      : [];
    let visible = false;
    try {
      const rect = element && element.getBoundingClientRect && element.getBoundingClientRect();
      const style = ownerWindow && ownerWindow.getComputedStyle
        ? ownerWindow.getComputedStyle(element)
        : null;
      visible = !!rect
        && rect.width > 0
        && rect.height > 0
        && (!style || (
          style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.visibility !== 'collapse'
          && Number(style.opacity || '1') > 0.01
        ));
    } catch {
      visible = false;
    }
    const optionsBounded = allOptions.length <= 500 && allOptions.every((option) => (
      String(option.value == null ? '' : option.value).length <= 240
      && String(option.label == null ? '' : option.label).length <= 240
      && String(option.textContent || '').length <= 1_000
    ));
    const optionStructure = allOptions
      .slice(0, 500)
      .map((option) => optionDescriptor(option))
      .map((option) => option && ({
        ...option,
        disabled: option.disabled === true,
        groupDisabled: option.groupDisabled === true,
        groupHidden: option.groupHidden === true,
        groupInert: option.groupInert === true,
        hidden: option.hidden === true,
        inert: option.inert === true,
      }));
    const descriptor = {
      tagName,
      role: tagName === 'select' && element.multiple !== true && Number(element.size || 0) <= 1
        ? 'combobox'
        : explicitRole,
      explicitRole,
      nativeType: compactText(element && element.type, 40).toLowerCase(),
      multiple: element && element.multiple === true,
      size: Number(element && element.size || 0),
      optionCount: allOptions.length,
      optionsBounded,
      optionMatchCount: exactMatches.length,
      selectedOptionCount: selectedOptions.length,
      visible,
      enabled: !!element
        && element.disabled !== true
        && (!element.matches || element.matches(':disabled') !== true),
      disabled: element && element.disabled === true,
      ariaDisabled: compactText(element && element.getAttribute && element.getAttribute('aria-disabled'), 20),
      hidden: element && element.hidden === true,
      inert: element && element.inert === true,
      inertAncestor: !!(element && element.closest && element.closest('[inert]')),
      ariaHidden: compactText(element && element.getAttribute && element.getAttribute('aria-hidden'), 20),
      ariaHiddenAncestor: !!(element && element.closest && element.closest('[aria-hidden="true"]')),
      contentEditable: element && element.isContentEditable === true,
      hasForm: !!(element && (
        element.form
        || (element.closest && element.closest('form'))
        || (element.getAttribute && element.getAttribute('form'))
      )),
      hasInlineMutationHandler: !!(element && element.hasAttribute && [
        'onchange',
        'oninput',
        'onclick',
        'onblur',
        'onkeydown',
        'onkeyup',
      ].some((attribute) => element.hasAttribute(attribute))),
      name: compactText(element && element.getAttribute && element.getAttribute('name'), 240),
      id: compactText(element && element.getAttribute && element.getAttribute('id'), 240),
      title: compactText(element && element.getAttribute && element.getAttribute('title'), 240),
      ariaLabel: compactText(element && element.getAttribute && element.getAttribute('aria-label'), 240),
      ariaLabelledByText: referencedText('aria-labelledby'),
      ariaDescribedByText: referencedText('aria-describedby'),
      labelText: Array.from((element && element.labels) || [])
        .map((label) => compactText(label && label.textContent, 500))
        .filter(Boolean)
        .join(' ')
        .slice(0, 500),
      documentUrl: compactText(
        ownerDocument && ownerDocument.location && ownerDocument.location.href,
        4096,
      ),
      nodeStructure: nodePath.join('>').slice(0, 8_000),
      frameStructure: framePath.join('>').slice(0, 4_000),
      optionStructure: JSON.stringify(optionStructure).slice(0, 100_000),
      isConnected: element && element.isConnected === true,
      ownerDocumentIsCurrent: !!ownerDocument
        && !!ownerDocument.defaultView
        && ownerDocument.defaultView.document === ownerDocument,
    };
    return {
      descriptor,
      desiredOption: optionDescriptor(desiredOptionNode),
      currentOption: selectedOptions.length === 1 ? optionDescriptor(selectedOptions[0]) : null,
    };
  }, {
    matchBy: intent && intent.matchBy,
    value: intent && intent.value,
  });
  const descriptor = captured && captured.descriptor;
  const desiredOption = captured && captured.desiredOption;
  return {
    allowed: !isUnsafeGuardedSelectDescriptor(descriptor, desiredOption),
    descriptor,
    desiredOption,
    currentOption: captured && captured.currentOption,
  };
}

const GUARDED_SELECT_STABLE_TARGET_FIELDS = [
  'tagName',
  'role',
  'explicitRole',
  'nativeType',
  'multiple',
  'size',
  'optionCount',
  'optionsBounded',
  'visible',
  'enabled',
  'disabled',
  'ariaDisabled',
  'hidden',
  'inert',
  'inertAncestor',
  'ariaHidden',
  'ariaHiddenAncestor',
  'contentEditable',
  'hasForm',
  'hasInlineMutationHandler',
  'name',
  'id',
  'title',
  'ariaLabel',
  'ariaLabelledByText',
  'ariaDescribedByText',
  'labelText',
];

function boundedGuardedSelectDescriptor(descriptor) {
  const bounded = {};
  for (const key of GUARDED_SELECT_STABLE_TARGET_FIELDS) {
    const value = descriptor && descriptor[key];
    bounded[key] = typeof value === 'boolean' || typeof value === 'number'
      ? value
      : String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  }
  return bounded;
}

function boundedGuardedSelectOption(option) {
  if (!option || typeof option !== 'object') return null;
  return {
    index: Number.isSafeInteger(option.index) ? option.index : -1,
    value: String(option.value || '').slice(0, 240),
    label: String(option.label || '').slice(0, 240),
    text: String(option.text || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    id: String(option.id || '').slice(0, 120),
    title: String(option.title || '').slice(0, 240),
    ariaLabel: String(option.ariaLabel || '').slice(0, 240),
    ariaHidden: String(option.ariaHidden || '').slice(0, 20),
    disabled: option.disabled === true,
    hidden: option.hidden === true,
    inert: option.inert === true,
    groupLabel: String(option.groupLabel || '').slice(0, 240),
    groupDisabled: option.groupDisabled === true,
    groupHidden: option.groupHidden === true,
    groupInert: option.groupInert === true,
    groupAriaHidden: String(option.groupAriaHidden || '').slice(0, 20),
  };
}

function guardedSelectStructuralDigest(descriptor) {
  return crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-select-structure-v1\0')
    .update(JSON.stringify({
      documentUrl: String(descriptor && descriptor.documentUrl || '').slice(0, 4096),
      nodeStructure: String(descriptor && descriptor.nodeStructure || '').slice(0, 8_000),
      frameStructure: String(descriptor && descriptor.frameStructure || '').slice(0, 4_000),
      optionStructure: String(descriptor && descriptor.optionStructure || '').slice(0, 100_000),
      isConnected: descriptor && descriptor.isConnected === true,
      ownerDocumentIsCurrent: descriptor && descriptor.ownerDocumentIsCurrent === true,
    }))
    .digest('hex');
}

function buildGuardedSelectInvariantFingerprint(identity, descriptor) {
  if (!identity || !descriptor) return null;
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-select-invariant-v1\0')
    .update(JSON.stringify({
      browserProcessId: identity.browserProcessId,
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      semantics: boundedGuardedSelectDescriptor(descriptor),
      structuralDigest: guardedSelectStructuralDigest(descriptor),
    }))
    .digest('hex');
  return `uc_browser_select_invariant_${digest}`;
}

function buildGuardedSelectOptionFingerprint(identity, descriptor, option) {
  const invariantFingerprint = buildGuardedSelectInvariantFingerprint(identity, descriptor);
  const boundedOption = boundedGuardedSelectOption(option);
  if (!isBoundedIdentity(invariantFingerprint) || !boundedOption || boundedOption.index < 0) return null;
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-select-option-v1\0')
    .update(JSON.stringify({
      invariantFingerprint,
      option: boundedOption,
    }))
    .digest('hex');
  return `uc_browser_select_option_${digest}`;
}

function buildGuardedSelectTargetFingerprint(
  identity,
  descriptor,
  currentOption,
  desiredOption,
  matchBy,
) {
  const invariantFingerprint = buildGuardedSelectInvariantFingerprint(identity, descriptor);
  const optionFingerprint = buildGuardedSelectOptionFingerprint(identity, descriptor, desiredOption);
  const currentOptionFingerprint = currentOption
    ? buildGuardedSelectOptionFingerprint(identity, descriptor, currentOption)
    : null;
  if (
    !isBoundedIdentity(invariantFingerprint)
    || !isBoundedIdentity(optionFingerprint)
    || (currentOption && !isBoundedIdentity(currentOptionFingerprint))
    || !GUARDED_SELECT_MATCH_BY.has(matchBy)
  ) {
    return null;
  }
  const digest = crypto
    .createHmac('sha256', guardedTargetFingerprintKey)
    .update('guarded-select-target-v1\0')
    .update(JSON.stringify({
      invariantFingerprint,
      currentOptionFingerprint,
      optionFingerprint,
      matchBy,
    }))
    .digest('hex');
  return `uc_browser_select_target_${digest}`;
}

function checkGuardedSelectCapabilityRecord(record, body, contextRef, pageRef) {
  if (
    !record
    || record.capabilityKind !== 'guarded_select_v1'
    || record.contextRef !== contextRef
    || record.pageRef !== pageRef
    || record.targetFingerprint !== (body && body.targetFingerprint)
    || record.optionFingerprint !== (body && body.optionFingerprint)
    || record.matchBy !== (body && body.matchBy)
    || record.browserProcessId !== (body && body.expectedBrowserProcessId)
    || record.browserContextId !== (body && body.expectedBrowserContextId)
    || record.pageId !== (body && body.expectedPageId)
    || record.url !== (body && body.expectedUrl)
    || record.taskContext !== String(body && body.taskContext || '')
    || !isBoundedIdentity(record.invariantFingerprint)
    || (
      !isBoundedIdentity(record.initialOptionFingerprint)
      && record.initialOptionFingerprint !== null
    )
    || !GUARDED_SELECT_MATCH_BY.has(record.matchBy)
    || typeof record.desiredValue !== 'string'
    || !record.desiredValue
    || record.desiredValue.length > 240
  ) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  return { ok: true };
}

async function captureCoherentGuardedSelectObservation(options) {
  const {
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    targetHandle,
    matchBy,
    desiredValue,
    expectedInvariantFingerprint,
    expectedOptionFingerprint,
    resolveActivePage,
  } = options || {};
  const activeBefore = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const entryCheck = checkExpectedBrowserToggleIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeBefore,
  );
  if (!entryCheck.ok) return entryCheck;
  const identity = registry.observe(contextRef, pageRef, pageUrl(pageRef));
  if (!isCoherentBrowserPageIdentity(identity)) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  let state;
  try {
    state = await inspectResolvedSelectTarget(targetHandle, { matchBy, value: desiredValue });
  } catch {
    return { ok: false, code: 'uncertain_ui_target' };
  }
  const activeAfter = typeof resolveActivePage === 'function' ? resolveActivePage() : pageRef;
  const exitCheck = checkExpectedBrowserToggleIdentity(
    registry,
    contextRef,
    pageRef,
    expectedIdentity,
    activeAfter,
  );
  if (!exitCheck.ok) return exitCheck;
  if (!state || !state.allowed || !state.descriptor || !state.desiredOption) {
    return {
      ok: false,
      code: state && !state.allowed ? 'browser_select_canary_blocked' : 'uncertain_ui_target',
    };
  }
  if (state.descriptor.documentUrl !== identity.url) {
    return { ok: false, code: 'browser_identity_mismatch' };
  }
  const invariantFingerprint = buildGuardedSelectInvariantFingerprint(identity, state.descriptor);
  const optionFingerprint = buildGuardedSelectOptionFingerprint(
    identity,
    state.descriptor,
    state.desiredOption,
  );
  if (
    !isBoundedIdentity(expectedInvariantFingerprint)
    || invariantFingerprint !== expectedInvariantFingerprint
    || !isBoundedIdentity(expectedOptionFingerprint)
    || optionFingerprint !== expectedOptionFingerprint
  ) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  const currentOptionFingerprint = state.currentOption
    ? buildGuardedSelectOptionFingerprint(identity, state.descriptor, state.currentOption)
    : null;
  if (state.currentOption && !isBoundedIdentity(currentOptionFingerprint)) {
    return { ok: false, code: 'browser_target_mismatch' };
  }
  return {
    ok: true,
    identity,
    matchBy,
    optionFingerprint,
    currentOptionFingerprint,
    selectionMatches: currentOptionFingerprint === optionFingerprint,
  };
}

function buildRedactedBrowserSelectProof(
  observation,
  previousOptionFingerprint,
  targetFingerprint,
  mutationPerformed,
) {
  if (
    !observation
    || !isCoherentBrowserPageIdentity(observation.identity)
    || !isBoundedIdentity(targetFingerprint)
    || !isBoundedIdentity(observation.optionFingerprint)
    || (
      previousOptionFingerprint !== null
      && !isBoundedIdentity(previousOptionFingerprint)
    )
    || (
      observation.currentOptionFingerprint !== null
      && !isBoundedIdentity(observation.currentOptionFingerprint)
    )
    || !GUARDED_SELECT_MATCH_BY.has(observation.matchBy)
    || observation.selectionMatches
      !== (observation.currentOptionFingerprint === observation.optionFingerprint)
    || (
      mutationPerformed !== true
      && previousOptionFingerprint !== observation.currentOptionFingerprint
    )
    || (
      mutationPerformed === true
      && previousOptionFingerprint === observation.optionFingerprint
    )
    || (
      mutationPerformed !== true
      && previousOptionFingerprint !== observation.optionFingerprint
    )
  ) {
    return null;
  }
  const identity = observation.identity;
  return {
    browserProcessId: identity.browserProcessId,
    browserContextId: identity.browserContextId,
    pageId: identity.pageId,
    url: identity.url,
    observedAt: identity.observedAt,
    evidenceId: identity.evidenceId,
    targetFingerprint,
    optionFingerprint: observation.optionFingerprint,
    matchBy: observation.matchBy,
    previousOptionFingerprint,
    currentOptionFingerprint: observation.currentOptionFingerprint,
    selectionMatches: observation.selectionMatches,
    mutationPerformed: mutationPerformed === true,
  };
}

function classifyBrowserFailure(error, explicitCode) {
  const code = String(explicitCode || '').trim().toLowerCase();
  if (code && code !== 'unknown') return code;
  const text = String((error && error.message) || error || '').toLowerCase();
  if (!text) return code || 'unknown';
  if (/\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|cloudflare security check)\b/.test(text)) return 'human_verification_required';
  if (/\b(browser dialog|browser popup|native dialog|javascript dialog|beforeunload|alert|confirm|prompt)\b.*\b(blocked|needs a decision|manual|unsafe|not accepted|dismissed)\b/.test(text)) return 'browser_dialog_blocked';
  if (/\b(token rejected|unauthorized|401)\b/.test(text)) return 'token_rejected';
  if (/\b(not paired|pair first|desktop bridge not paired)\b/.test(text)) return 'not_paired';
  if (/\b(browser bridge|browser session|chrome launch|chromium fallback|playwright|context)\b.*\b(unavailable|offline|not running|failed|missing|closed|disconnected)\b/.test(text)) return 'browser_bridge_offline';
  if (/\b(waiting for selector|waiting for locator)\b/.test(text)) return 'selector_not_found';
  if (/\b(timeout|timed out|timeouterror)\b/.test(text)) {
    return /\b(locator|selector|getbyrole|element)\b/.test(text) ? 'selector_not_found' : 'timeout';
  }
  if (/\bstrict mode violation|resolved to \d+ elements|more than one element|ambiguous|not visible|not enabled|not editable|intercepts pointer events|outside|detached from dom|hidden\b/.test(text)) return 'uncertain_ui_target';
  if (/\b(login required|sign in required|authentication required|auth required|session expired)\b/.test(text)) return 'auth_required';
  if (/\b(file not found|no such file|enoent)\b/.test(text)) return 'file_not_found';
  if (/\b(path must stay under|not allowed|outside allowed)\b/.test(text)) return 'path_not_allowed';
  if (/\b(permission denied|eacces|operation not permitted|accessibility permission|screen recording)\b/.test(text)) return 'permission_denied';
  if (/\b(net::|network error|failed to fetch|econnreset|etimedout|connection refused)\b/.test(text)) return 'network_error';
  if (/\b(500|internal server error)\b/.test(text)) return 'server_error';
  return code || 'unknown';
}

function browserRecoveryHint(errorCode) {
  switch (errorCode) {
    case 'human_verification_required':
      return 'Pause automation and ask the user to complete the verification challenge in the UC browser profile.';
    case 'not_paired':
    case 'token_rejected':
      return 'Re-pair the local desktop bridge, then retry the browser action with a fresh page check.';
    case 'bridge_offline':
    case 'browser_bridge_offline':
      return 'Reconnect the local bridge/browser session, then collect fresh browser health before retrying.';
    case 'browser_dialog_blocked':
      return 'Read the browser popup text/buttons, use the guarded modal advisor, and retry only if it selects a safe acknowledgement or requested-output overwrite.';
    case 'selector_not_found':
      return 'Collect a fresh DOM snapshot, prefer role/name locators, and retry the failed action once.';
    case 'uncertain_ui_target':
      return 'Refresh DOM/screenshot evidence and ask for confirmation if more than one target still matches.';
    case 'auth_required':
      return 'Ask the user to sign in inside the UC browser profile before retrying.';
    case 'file_not_found':
      return 'Ask for or search the exact local file path before retrying the upload.';
    case 'path_not_allowed':
      return 'Use a file under the user home folder or request a scoped file grant.';
    case 'missing_permission':
    case 'permission_denied':
      return 'Ask the user to grant the missing local browser/desktop permission, then retry readiness.';
    case 'network_error':
    case 'server_error':
    case 'timeout':
      return errorCode === 'timeout'
        ? 'Collect current URL, title, screenshot or DOM state, then retry the timed browser step once with a bounded wait.'
        : 'Retry once after fresh page state and stop if the same failure repeats.';
    case 'invalid_input':
      return 'Fix the browser action arguments before sending another request.';
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
      return 'Collect a fresh browser DOM snapshot and retry once with its exact context, page, and URL identity.';
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
      return 'Observe the exact field again and retry only with the new single-use browser target capability.';
    case 'browser_target_capacity':
      return 'Wait for stale browser target observations to expire, then observe the exact field once and retry.';
    case 'browser_fill_canary_blocked':
      return 'Use the dedicated approval-gated submit or credential path; this canary only fills non-secret fields without submission.';
    case 'browser_fill_verification_failed':
      return 'Collect a fresh DOM snapshot and inspect the field before deciding whether one bounded retry is safe.';
    case 'browser_toggle_canary_blocked':
      return 'Use only a non-consequential checkbox, switch, or radio state target; consequential actions require a dedicated approval-gated tool.';
    case 'browser_toggle_verification_failed':
      return 'Observe the exact toggle state again and retry only if the fresh state still makes one bounded mutation safe.';
    case 'browser_select_canary_blocked':
      return 'Use only one visible enabled native single-value select for a clearly local presentation or accessibility preference.';
    case 'browser_select_verification_failed':
      return 'Observe the exact native select and option again before deciding whether one bounded retry is safe.';
    default:
      return 'Capture fresh browser health, DOM state, and the raw error before retrying.';
  }
}

function browserRequiredEvidence(errorCode) {
  switch (errorCode) {
    case 'human_verification_required':
      return ['browser.verification_state', 'user.complete_browser_verification'];
    case 'not_paired':
    case 'token_rejected':
      return ['desktop.bridge_pairing', 'browser.health'];
    case 'bridge_offline':
    case 'browser_bridge_offline':
      return ['desktop.bridge_health', 'browser.health'];
    case 'browser_dialog_blocked':
      return ['browser.dialog_observation', 'browser.dom_snapshot', 'browser.screenshot'];
    case 'selector_not_found':
      return ['browser.dom_snapshot', 'browser.screenshot'];
    case 'uncertain_ui_target':
      return ['browser.dom_snapshot', 'browser.screenshot', 'user.confirm_target'];
    case 'auth_required':
      return ['browser.screenshot', 'user.sign_in_browser_profile'];
    case 'file_not_found':
      return ['desktop.file_search', 'desktop.file_stat'];
    case 'path_not_allowed':
      return ['desktop.file_grant', 'desktop.file_stat'];
    case 'missing_permission':
    case 'permission_denied':
      return ['desktop.permission_check', 'browser.health'];
    case 'timeout':
      return ['browser.health', 'browser.dom_snapshot', 'browser.screenshot'];
    case 'network_error':
    case 'server_error':
      return ['browser.health', 'browser.screenshot'];
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
    case 'browser_fill_verification_failed':
    case 'browser_toggle_verification_failed':
    case 'browser_select_verification_failed':
      return ['browser.dom_snapshot'];
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
    case 'browser_target_capacity':
      return ['browser.dom_snapshot', 'browser.fill_target', 'browser.toggle_target', 'browser.select_target'];
    case 'browser_fill_canary_blocked':
      return ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'];
    case 'browser_toggle_canary_blocked':
    case 'browser_select_canary_blocked':
      return ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'];
    default:
      return ['browser.health', 'browser.dom_snapshot'];
  }
}

function writeBrowserFailure(res, CORS, error, fallback, explicitCode, statusCode = 200) {
  const raw = String((error && error.message) || error || fallback || 'browser action failed').trim();
  const errorCode = classifyBrowserFailure(raw, explicitCode);
  const requiredEvidence = browserRequiredEvidence(errorCode);
  res.writeHead(statusCode, CORS);
  res.end(JSON.stringify({
    ok: false,
    error: raw,
    errorCode,
    recoveryHint: browserRecoveryHint(errorCode),
    requiredEvidence,
  }));
}

function ensureProfileDir() {
  try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch {}
}

/**
 * Lazy-launch the persistent Chrome context. Multiple concurrent
 * callers share the same launch promise so we never spawn two Chrome
 * processes racing for the same user-data-dir (Chrome will lock it).
 */
async function ensureContext() {
  if (context) {
    const livePage = activePage(context);
    if (livePage) return { ok: true, context, page: livePage };
  }
  if (launchError) return { ok: false, error: launchError };
  if (launchPromise) return launchPromise;

  launchPromise = (async () => {
    ensureProfileDir();
    // Try system Google Chrome first via channel; fall back to bundled
    // Chromium for users without Chrome installed (no real cost — we
    // download Chromium lazily via `npx playwright install chromium`
    // if needed). We catch `BrowserTypeError: chrome not installed`
    // and retry without the channel.
    try {
      const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome',
        headless: false,
        viewport: null,          // use the real window size Chrome chose
        acceptDownloads: true,
        // Close the context cleanly when the bridge exits so the lock
        // file doesn't linger.
        handleSIGINT: false,     // we handle shutdown ourselves
        handleSIGTERM: false,
        handleSIGHUP: false,
      });
      trackContextPages(ctx);
      const pg = ctx.pages()[0] || await ctx.newPage();
      browserIdentities.pageIdFor(pg);
      context = ctx;
      page = pg;
      return { ok: true, context: ctx, page: pg };
    } catch (err) {
      const msg = (err && err.message) || String(err);
      // Fall back to bundled Chromium on "chrome not found" / channel errors
      if (/chrome|channel|not installed|executable/i.test(msg)) {
        try {
          const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
            headless: false,
            viewport: null,
            acceptDownloads: true,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
          });
          trackContextPages(ctx);
          const pg = ctx.pages()[0] || await ctx.newPage();
          browserIdentities.pageIdFor(pg);
          context = ctx;
          page = pg;
          return { ok: true, context: ctx, page: pg };
        } catch (fallbackErr) {
          launchError = `Chrome launch failed and Chromium fallback failed: ${(fallbackErr && fallbackErr.message) || String(fallbackErr)}. Run \`npx playwright install chromium\` if you don't have Chrome installed.`;
          return { ok: false, error: launchError };
        }
      }
      launchError = msg;
      return { ok: false, error: msg };
    } finally {
      launchPromise = null;
    }
  })();

  return launchPromise;
}

// ─── A11y snapshot + pruning ────────────────────────────────────────────

const NOISE_ROLES = new Set([
  'none', 'presentation', 'generic', 'Section', 'WebArea', 'LayoutTable',
  'LayoutTableCell', 'LayoutTableRow', 'group',
]);

const INTERESTING_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'searchbox', 'listbox', 'option',
  'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'switch', 'slider', 'spinbutton', 'tab', 'heading', 'treeitem',
]);

function prune(node, pathId = '0', out = { count: 0 }, maxNodes = 150, interestingOnly = true) {
  if (out.count >= maxNodes) return null;
  out.count += 1;
  const role = node.role || 'generic';
  const name = node.name || '';
  const value = node.value || '';
  const isAddressable = !!name || !!value;
  const isInteresting = INTERESTING_ROLES.has(role);

  const kids = [];
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = 0; i < children.length; i += 1) {
    if (out.count >= maxNodes) break;
    const sub = prune(children[i], `${pathId}.${kids.length}`, out, maxNodes, interestingOnly);
    if (sub) kids.push(sub);
  }

  if (interestingOnly && !isInteresting && !isAddressable) {
    if (kids.length === 1) return kids[0];
    if (kids.length === 0) return null;
  }

  const result = { id: pathId, role };
  if (name) result.name = name;
  if (value) result.value = value;
  if (typeof node.checked !== 'undefined') result.checked = node.checked;
  if (typeof node.pressed !== 'undefined') result.pressed = node.pressed;
  if (node.disabled) result.disabled = true;
  if (node.focused) result.focused = true;
  if (typeof node.expanded !== 'undefined') result.expanded = node.expanded;
  if (node.selected) result.selected = true;
  if (kids.length) result.children = kids;
  return result;
}

// ─── HTTP handlers ──────────────────────────────────────────────────────

function readJsonBody(req, limit = 16384) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > limit) { req.destroy(); resolve({ err: 'body too large' }); }
    });
    req.on('end', () => {
      if (!buf) return resolve({ body: {} });
      try {
        const body = JSON.parse(buf);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          resolve({ err: 'body must be a JSON object' });
          return;
        }
        resolve({ body });
      }
      catch { resolve({ err: 'body must be JSON' }); }
    });
    req.on('error', (err) => resolve({ err: err.message }));
  });
}

async function handleHealth(_req, res, CORS) {
  const livePage = context ? activePage(context) : null;
  const processObservation = browserIdentities.observeProcess('');
  const status = {
    ok: true,
    playwright: require('playwright/package.json').version,
    chromeChannel: context ? 'running' : 'not_started',
    profileDir: PROFILE_DIR,
    contextOpen: !!context,
    currentUrl: null,
    currentTitle: null,
    ...processObservation,
  };
  if (context && livePage) {
    try {
      const identity = observeBrowserPage(context, livePage);
      status.currentUrl = livePage.url();
      status.currentTitle = await livePage.title();
      if (identity) Object.assign(status, identity);
    } catch {}
  }
  res.writeHead(200, CORS);
  res.end(JSON.stringify(status));
}

async function handleOpenUrl(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    writeBrowserFailure(res, CORS, 'url must start with http(s)://', undefined, 'invalid_input', 400);
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const pageRef = launched.page;
    const waitUntil = ['load', 'domcontentloaded', 'networkidle'].includes(body.waitUntil) ? body.waitUntil : 'load';
    const timeout = Math.max(1000, Math.min(60000, Number(body.timeoutMs) || 30000));
    const dialogRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
      await pageRef.goto(url, { waitUntil, timeout });
      return { url: pageRef.url(), title: await pageRef.title() };
    });
    if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) { writeBrowserFailure(res, CORS, 'browser page identity unavailable', undefined, 'browser_identity_mismatch'); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...dialogRun.result, ...identity, handledDialogs: dialogRun.handledDialogs }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'navigation failed');
  }
}

/**
 * Walk the DOM in-page via page.evaluate — builds our own compact
 * ARIA tree. We do this instead of Playwright's accessibility.snapshot
 * (removed in 1.45) or ariaSnapshot (YAML output, hard to re-parse).
 *
 * The function serialises to the page, runs inside the page's JS
 * context, and returns a plain object via structured clone. Only
 * addressable or structurally interesting nodes land in the output.
 */
const PAGE_WALKER = `(function walk(opts) {
  var INTERESTING = new Set([
    'button','link','textbox','combobox','searchbox','listbox','option',
    'checkbox','radio','menuitem','menuitemcheckbox','menuitemradio',
    'switch','slider','spinbutton','tab','heading','treeitem'
  ]);
  var NOISE = new Set(['generic','presentation','none','group']);
  var CONCRETE_ROLES = new Set([
    'alert','alertdialog','application','article','banner','blockquote','button',
    'caption','cell','checkbox','code','columnheader','combobox','complementary',
    'contentinfo','definition','deletion','dialog','directory','document',
    'emphasis','feed','figure','form','generic','grid','gridcell','group',
    'heading','img','insertion','link','list','listbox','listitem','log','main',
    'marquee','math','menu','menubar','menuitem','menuitemcheckbox',
    'menuitemradio','meter','navigation','none','note','option','paragraph',
    'presentation','progressbar','radio','radiogroup','region','row','rowgroup',
    'rowheader','scrollbar','search','searchbox','separator','slider',
    'spinbutton','status','strong','subscript','suggestion','superscript',
    'switch','tab','table','tablist','tabpanel','term','textbox','time','timer',
    'toolbar','tooltip','tree','treegrid','treeitem'
  ]);
  var NAME_FROM_CONTENT_ROLES = new Set([
    'button','cell','columnheader','heading','link','listitem','menuitem',
    'menuitemcheckbox','menuitemradio','option','rowheader','tab','term',
    'tooltip','treeitem'
  ]);
  var EXCLUDED_TEXT_TAGS = new Set([
    'script','style','template','noscript','head','meta','link'
  ]);
  var NON_EDITABLE_INPUT_TYPES = new Set([
    'button','submit','reset','image','checkbox','radio','hidden'
  ]);

  function boundedText(value, maxLength) {
    return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, maxLength);
  }

  function canonicalExplicitRole(el) {
    if (!el || !el.getAttribute) return '';
    var raw = boundedText(el.getAttribute('role'), 500).toLowerCase();
    if (!raw) return '';
    var tokens = raw.split(/\\s+/);
    for (var index = 0; index < tokens.length; index += 1) {
      if (CONCRETE_ROLES.has(tokens[index])) return tokens[index];
    }
    return '';
  }

  function implicitRole(el) {
    var tag = boundedText(el && el.tagName, 40).toLowerCase();
    var type = boundedText(el && el.getAttribute && el.getAttribute('type'), 40).toLowerCase();
    var explicitRole = canonicalExplicitRole(el);
    if (explicitRole) return explicitRole;
    if (tag === 'a' && el.getAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      if (['button','submit','reset','image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'option') return 'option';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    if (tag === 'aside') return 'complementary';
    if (tag === 'header') return 'banner';
    if (tag === 'footer') return 'contentinfo';
    if (tag === 'form') return 'form';
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (tag === 'p') return 'paragraph';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return 'generic';
  }

  function isEditableValueSurface(el) {
    if (!el || !el.getAttribute) return false;
    var tag = boundedText(el.tagName, 40).toLowerCase();
    var contentEditable = el.isContentEditable === true
      || boundedText(el.getAttribute('contenteditable'), 20).toLowerCase() === 'true';
    if (contentEditable || tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    var type = boundedText(el.getAttribute('type') || 'text', 40).toLowerCase();
    return !NON_EDITABLE_INPUT_TYPES.has(type);
  }

  function readEditableValue(el) {
    if (!isEditableValueSurface(el)) return '';
    if (el.isContentEditable === true) return String(el.textContent || '');
    return String(el.value || '');
  }

  function actionInputValue(el) {
    if (!el || !el.getAttribute || boundedText(el.tagName, 40).toLowerCase() !== 'input') return '';
    var type = boundedText(el.getAttribute('type'), 40).toLowerCase();
    return ['button','submit','reset','image'].includes(type)
      ? boundedText(el.value, 160)
      : '';
  }

  function associatedLabelSignal(el) {
    if (!el || !el.getAttribute) return '';
    var pieces = [];
    var labels = el.labels || [];
    for (var labelIndex = 0; labelIndex < labels.length && labelIndex < 8; labelIndex += 1) {
      pieces.push(boundedText(labels[labelIndex] && labels[labelIndex].textContent, 240));
    }
    var labelledBy = boundedText(el.getAttribute('aria-labelledby'), 500);
    if (labelledBy && document.getElementById) {
      var ids = labelledBy.split(/\\s+/).slice(0, 12);
      for (var idIndex = 0; idIndex < ids.length; idIndex += 1) {
        var ref = document.getElementById(ids[idIndex]);
        if (ref) pieces.push(boundedText(ref.textContent, 240));
      }
    }
    if (el.id && document.querySelector && typeof CSS !== 'undefined' && CSS.escape) {
      try {
        var fallback = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (fallback) pieces.push(boundedText(fallback.textContent, 240));
      } catch {}
    }
    return boundedText(pieces.join(' '), 800);
  }

  function sensitiveFormKind(el) {
    if (!isEditableValueSurface(el)) return '';
    var type = boundedText(el.getAttribute('type'), 80).toLowerCase();
    var autocomplete = boundedText(el.getAttribute('autocomplete'), 160).toLowerCase();
    var signals = [
      type,
      autocomplete,
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('inputmode') || '',
      associatedLabelSignal(el),
    ].map(function normalizeSignal(value) {
      return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    }).join(' ').toLowerCase();
    if (type === 'password' || /(?:^|[\\s_-])(?:current-password|new-password|password|passwd|passcode)(?:$|[\\s_-])/.test(signals)) return 'password';
    if (
      /(?:^|[\\s_-])(?:one-time-code|one[\\s_-]?time|otp|totp|mfa|2fa|verification[\\s_-]?code|authenticator|passcode|pin)(?:$|[\\s_-])/.test(signals)
    ) return 'one-time code';
    if (
      /(?:^|[\\s_-])(?:cc(?:[\\s_-]?(?:name|number|exp|exp-month|exp-year|csc|type|given-name|additional-name|family-name))?|credit[\\s_-]?card|card[\\s_-]?(?:number|holder|expiry|expiration)|cvv|cvc|security[\\s_-]?code|payment|billing[\\s_-]?account)(?:$|[\\s_-])/.test(signals)
    ) return 'payment';
    if (type === 'email' || /(?:^|[\\s_-])(?:email|e-mail)(?:$|[\\s_-])/.test(signals)) return 'email';
    if (type === 'tel' || /(?:^|[\\s_-])(?:tel|telephone|phone|mobile)(?:$|[\\s_-])/.test(signals)) return 'telephone';
    if (
      /(?:^|[\\s_-])(?:credential|username|user[\\s_-]?name|login|sign[\\s_-]?in|token|secret|api[\\s_-]?key|access[\\s_-]?key|private[\\s_-]?key|auth|webauthn|fido|security[\\s_-]?key)(?:$|[\\s_-])/.test(signals)
    ) return 'credential';
    return '';
  }

  function controlledSensitiveName(kind, role) {
    var suffix = role === 'combobox' ? ' selector' : ' field';
    if (kind === 'one-time code') return 'One-time code' + suffix;
    return kind.charAt(0).toUpperCase() + kind.slice(1) + suffix;
  }

  function controlledEditableName(role) {
    if (role === 'searchbox') return 'Search field';
    if (role === 'combobox') return 'Selection field';
    if (role === 'spinbutton') return 'Number field';
    return 'Text field';
  }

  function isHiddenForGrounding(el) {
    if (!el || !el.getAttribute) return false;
    var tag = boundedText(el.tagName, 40).toLowerCase();
    if (EXCLUDED_TEXT_TAGS.has(tag)) return true;
    if (
      el.hidden === true
      || el.inert === true
      || boundedText(el.getAttribute('aria-hidden'), 20).toLowerCase() === 'true'
      || el.hasAttribute && el.hasAttribute('hidden')
      || el.hasAttribute && el.hasAttribute('inert')
    ) return true;
    try {
      var style = window.getComputedStyle(el);
      if (
        style
        && (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || style.opacity === '0'
        )
      ) return true;
    } catch {}
    return false;
  }

  function isVisible(el) {
    if (!el || isHiddenForGrounding(el)) return false;
    if (!el.getBoundingClientRect) return true;
    try {
      var rect = el.getBoundingClientRect();
      return !(rect.width === 0 && rect.height === 0);
    } catch {
      return false;
    }
  }

  function safeVisibleText(root, recurse) {
    if (!root || isHiddenForGrounding(root) || isEditableValueSurface(root)) return '';
    var pieces = [];
    var length = 0;
    function collect(node, isRoot) {
      if (!node || length >= 500) return;
      if (node.nodeType === 3) {
        var value = boundedText(node.nodeValue, 500 - length);
        if (value) {
          pieces.push(value);
          length += value.length;
        }
        return;
      }
      if (!isRoot && (isHiddenForGrounding(node) || isEditableValueSurface(node))) return;
      var children = node.childNodes || node.children || [];
      if (!children.length) {
        var leafText = boundedText(node.textContent, 500 - length);
        if (leafText) {
          pieces.push(leafText);
          length += leafText.length;
        }
        return;
      }
      for (var index = 0; index < children.length && length < 500; index += 1) {
        var child = children[index];
        if (child && child.nodeType === 3) collect(child, false);
        else if (recurse) collect(child, false);
      }
    }
    collect(root, true);
    return boundedText(pieces.join(' '), 160);
  }

  function fieldSafeAccessibleLabel(el, role, candidate) {
    var bounded = boundedText(candidate, 160);
    if (!bounded || !isEditableValueSurface(el)) return bounded;
    var currentValue = boundedText(readEditableValue(el), 500);
    if (currentValue && bounded.includes(currentValue)) return controlledEditableName(role);
    return bounded;
  }

  function accName(el, sensitiveKind, role) {
    if (sensitiveKind) return controlledSensitiveName(sensitiveKind, role);
    if (!el || !el.getAttribute) return '';
    var label = el.getAttribute('aria-label');
    if (label) return fieldSafeAccessibleLabel(el, role, label);
    var labelledBy = boundedText(el.getAttribute('aria-labelledby'), 500);
    if (labelledBy && document.getElementById) {
      var labelPieces = [];
      var ids = labelledBy.split(/\\s+/).slice(0, 12);
      for (var index = 0; index < ids.length; index += 1) {
        var ref = document.getElementById(ids[index]);
        if (ref) labelPieces.push(safeVisibleText(ref, true));
      }
      var referencedLabel = fieldSafeAccessibleLabel(el, role, labelPieces.join(' '));
      if (referencedLabel) return referencedLabel;
    }
    var labels = el.labels || [];
    var associated = [];
    for (var labelIndex = 0; labelIndex < labels.length && labelIndex < 8; labelIndex += 1) {
      associated.push(safeVisibleText(labels[labelIndex], true));
    }
    if (associated.length) {
      var associatedName = fieldSafeAccessibleLabel(el, role, associated.join(' '));
      if (associatedName) return associatedName;
    }
    if (el.tagName === 'INPUT' && el.id && document.querySelector && typeof CSS !== 'undefined' && CSS.escape) {
      try {
        var fallbackLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (fallbackLabel) {
          var fallbackName = fieldSafeAccessibleLabel(el, role, safeVisibleText(fallbackLabel, true));
          if (fallbackName) return fallbackName;
        }
      } catch {}
    }
    if (el.tagName === 'IMG') return boundedText(el.getAttribute('alt'), 160);
    if (el.getAttribute('title')) return fieldSafeAccessibleLabel(el, role, el.getAttribute('title'));
    return safeVisibleText(el, NAME_FROM_CONTENT_ROLES.has(role));
  }

  var maxNodes = opts.maxNodes || 150;
  var interestingOnly = opts.interestingOnly !== false;
  // n = nodes that consumed walk budget (capped at maxNodes);
  // total = nodes the walk WOULD have visited with unlimited budget,
  // so the caller can report "showing N of M" instead of silently
  // dropping the rest of the page.
  var counter = { n: 0, total: 0 };

  // Count-only traversal for the subtree beyond the budget. Mirrors
  // visit()'s reachability rules (invisible subtrees stay unvisited)
  // without building nodes.
  function countRemaining(el) {
    counter.total += 1;
    if (!isVisible(el)) return;
    var children = el.children || [];
    for (var c = 0; c < children.length; c += 1) countRemaining(children[c]);
  }

  function visit(el, pathId) {
    if (counter.n >= maxNodes) { countRemaining(el); return null; }
    counter.n += 1;
    counter.total += 1;

    if (!isVisible(el)) return null;
    var role = implicitRole(el);
    var editableValue = isEditableValueSurface(el);
    var sensitiveKind = editableValue ? sensitiveFormKind(el) : '';
    var name = accName(el, sensitiveKind, role);
    var rawEditableValue = editableValue ? readEditableValue(el) : '';
    var actionValue = actionInputValue(el);

    var kids = [];
    var children = el.children || [];
    for (var c = 0; c < children.length; c += 1) {
      // No early break: past the budget visit() degrades to counting
      // so totalNodes stays honest.
      var sub = visit(children[c], pathId + '.' + kids.length);
      if (sub) kids.push(sub);
    }

    var addressable = !!name || !!actionValue || editableValue;
    var interesting = INTERESTING.has(role);
    if (interestingOnly && !interesting && !addressable) {
      if (kids.length === 1) return kids[0];
      if (kids.length === 0) return null;
      if (NOISE.has(role) && !name) {
        // Collapse noise with multiple kids: hoist them.
        return { id: pathId, role: role, children: kids };
      }
    }

    var result = { id: pathId, role: role };
    if (name) result.name = boundedText(name, 160);
    if (actionValue) result.value = actionValue;
    if (editableValue) {
      result.valueRedacted = true;
      result.valueLength = Math.min(1000000, String(rawEditableValue || '').length);
      if (sensitiveKind) result.sensitiveKind = sensitiveKind;
    }
    if (el.hasAttribute && el.hasAttribute('aria-checked')) result.checked = el.getAttribute('aria-checked') === 'true';
    if (el.hasAttribute && el.hasAttribute('aria-pressed')) result.pressed = el.getAttribute('aria-pressed') === 'true';
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) result.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.hasAttribute && el.disabled) result.disabled = true;
    if (kids.length) result.children = kids;
    return result;
  }

  var root = visit(document.body || document.documentElement, '0');
  return {
    documentUrl: String(document.location && document.location.href || ''),
    title: String(document.title || ''),
    tree: root || { id: '0', role: 'document' },
    nodeCount: counter.n,
    totalNodes: counter.total,
    truncated: counter.total > counter.n,
  };
})`;

const HUMAN_VERIFICATION_PAUSE_MESSAGE =
  'Human verification detected. Pause automation and ask the user to complete the verification manually, then continue only after the user confirms it is done.';

const VERIFICATION_DETECTORS = [
  {
    kind: 'captcha',
    label: 'CAPTCHA / human verification',
    reason: 'The page or target appears to contain CAPTCHA or "not a robot" verification.',
    patterns: [
      /\bcaptcha\b/i,
      /\brecaptcha\b/i,
      /\bhcaptcha\b/i,
      /\bturnstile\b/i,
      /\bi\s*(?:am|'m|m)\s+not\s+a\s+robot\b/i,
      /\bnot\s+a\s+robot\b/i,
      /\bverify\s+(?:you(?:'re| are)|that\s+you\s+are)\s+(?:human|not\s+a\s+robot)\b/i,
      /\bhuman\s+verification\b/i,
    ],
  },
  {
    kind: 'bot_check',
    label: 'Bot verification / security check',
    reason: 'The page or target appears to be an anti-bot or security challenge.',
    patterns: [
      /\bbot\s+(?:check|verification|challenge|protection)\b/i,
      /\banti[-\s]?bot\b/i,
      /\bcloudflare\b[\s\S]{0,80}\b(?:challenge|security|verify|checking)\b/i,
      /\bchecking\s+(?:your\s+)?browser\b/i,
      /\bsecurity\s+check\b/i,
      /\bverify\s+(?:you(?:'re| are)|that\s+you\s+are)\s+human\b/i,
      /\bprove\s+(?:you(?:'re| are)|that\s+you\s+are)\s+human\b/i,
    ],
  },
  {
    kind: 'mfa',
    label: 'MFA / one-time verification code',
    reason: 'The page or target appears to require a human-controlled security code or authenticator step.',
    patterns: [
      /\b(?:two[-\s]?factor|2fa|mfa|multi[-\s]?factor)\b/i,
      /\b(?:one[-\s]?time|single[-\s]?use)\s+(?:password|passcode|code)\b/i,
      /\b(?:otp|totp)\b/i,
      /\bauthenticator\s+(?:app|code)\b/i,
      /\bverification\s+code\b/i,
      /\bsecurity\s+code\b/i,
    ],
  },
  {
    kind: 'login_challenge',
    label: 'Login challenge',
    reason: 'The page or target appears to need a human login challenge or identity confirmation.',
    patterns: [
      /\bconfirm\s+(?:your\s+)?identity\b/i,
      /\bidentity\s+verification\b/i,
      /\btrusted\s+device\b/i,
      /\bapprove\s+(?:this\s+)?(?:login|sign[-\s]?in)\b/i,
      /\bdevice\s+verification\b/i,
    ],
  },
  {
    kind: 'passkey',
    label: 'Passkey / WebAuthn / biometric verification',
    reason: 'The page or target appears to require a passkey, hardware security key, or device biometric that only the human can complete.',
    patterns: [
      /\bpasskey(?:s)?\b/i,
      /\bwebauthn\b/i,
      /\bsecurity\s+key\b/i,
      /\bwindows\s+hello\b/i,
      /\b(?:face|touch)\s*id\b/i,
      /\bfingerprint\b/i,
      /\bnavigator\.credentials\b/i,
      /\binsert\s+your\s+security\s+key\b/i,
    ],
  },
  {
    kind: 'push_2fa',
    label: 'Push / device approval',
    reason: 'The page or target appears to require a human to approve a push notification or device prompt.',
    patterns: [
      /\btap\s+yes\s+on\s+your\s+phone\b/i,
      /\bapprove\s+the\s+notification\b/i,
      /\bcheck\s+your\s+phone\b/i,
      /\bwe\s+sent\s+a\s+notification\s+to\s+your\s+device\b/i,
      /\bopen\s+your\s+authenticator\s+app\s+and\s+approve\b/i,
    ],
  },
];

function detectVerificationGate(signals) {
  const text = (Array.isArray(signals) ? signals : [signals])
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 50000);
  if (!text) return null;
  for (const detector of VERIFICATION_DETECTORS) {
    const matchedTerms = detector.patterns
      .map((pattern) => {
        const match = text.match(pattern);
        return match ? match[0] : null;
      })
      .filter(Boolean);
    if (matchedTerms.length === 0) continue;
    return {
      detected: true,
      kind: detector.kind,
      label: detector.label,
      reason: detector.reason,
      matchedTerms: Array.from(new Set(matchedTerms.map((term) => String(term).slice(0, 120)))),
      requiresHumanPause: true,
      canAutomate: false,
      pauseInstruction: HUMAN_VERIFICATION_PAUSE_MESSAGE,
    };
  }
  return null;
}

async function inspectPageVerification(pageRef) {
  const snapshot = await pageRef.evaluate(() => {
    const selectors = [
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="turnstile"]',
      'iframe[title*="captcha" i]',
      'iframe[title*="verification" i]',
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      '[data-sitekey]',
      '[data-cf-turnstile-response]',
      '.cf-turnstile',
      '.g-recaptcha',
      '.h-captcha',
    ];
    const selectorMatches = [];
    for (const selector of selectors) {
      try {
        if (document.querySelector(selector)) selectorMatches.push(selector);
      } catch {}
    }
    const controlTexts = Array.from(document.querySelectorAll('iframe, button, input, label, [role="button"], [role="checkbox"], [aria-label], [title]'))
      .slice(0, 300)
      .map((el) => [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('name'),
        el.getAttribute('id'),
        el.getAttribute('class'),
        el.getAttribute('src'),
        el.textContent,
      ].filter(Boolean).join(' '))
      .filter(Boolean);
    const text = ((document.body && document.body.innerText) || document.documentElement.innerText || '').slice(0, 20000);
    return { text, selectorMatches, controlTexts };
  });
  const gate = detectVerificationGate([
    snapshot.text,
    ...(snapshot.selectorMatches || []),
    ...(snapshot.controlTexts || []),
  ]);
  return {
    url: pageRef.url(),
    title: await pageRef.title().catch(() => ''),
    verificationDetected: !!gate,
    gate,
    selectorMatches: snapshot.selectorMatches || [],
    matchedTerms: gate ? gate.matchedTerms : [],
    pauseInstruction: gate ? gate.pauseInstruction : undefined,
  };
}

async function guardHumanVerification(pageRef, targetSignals) {
  const targetGate = detectVerificationGate(targetSignals);
  if (targetGate) return targetGate;
  const state = await inspectPageVerification(pageRef);
  return state.gate || null;
}

function writeHumanVerificationPause(res, CORS, gate) {
  res.writeHead(200, CORS);
  res.end(JSON.stringify({
    ok: false,
    error: `${gate.label}: ${gate.pauseInstruction}`,
    errorCode: 'human_verification_required',
    requiresHumanVerification: true,
    gate,
  }));
}

function cleanDialogText(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function browserDialogButtons(type) {
  switch (type) {
    case 'alert':
      return [{ id: 'accept', label: 'OK' }];
    case 'beforeunload':
      return [
        { id: 'dismiss', label: 'Stay on page' },
        { id: 'accept', label: 'Leave page' },
      ];
    case 'confirm':
    case 'prompt':
    default:
      return [
        { id: 'accept', label: 'OK' },
        { id: 'dismiss', label: 'Cancel' },
      ];
  }
}

function browserDialogFilename(text) {
  const quoted = text.match(/[“"]([^“”"]+\.[A-Za-z0-9]{2,8})[”"]/);
  if (quoted && quoted[1]) return cleanDialogText(quoted[1], 200);
  const bare = text.match(/\b([A-Za-z0-9][^\\/:*?"<>|\n\r]{0,120}\.(?:png|jpe?g|pdf|psd|indd|ai|svg|webp|tiff?|zip|csv|xlsx?|docx?))\b/i);
  return bare && bare[1] ? cleanDialogText(bare[1], 200) : null;
}

function browserDialogTaskMentionsFilename(task, filename) {
  if (!filename) return false;
  const lowerTask = cleanDialogText(task, 2000).toLowerCase();
  const lowerFilename = cleanDialogText(filename, 200).toLowerCase();
  if (lowerTask.includes(lowerFilename)) return true;
  const extMatch = lowerFilename.match(/\.([a-z0-9]{2,8})$/);
  const extension = extMatch ? extMatch[1] : '';
  const basename = lowerFilename.replace(/\.[a-z0-9]{2,8}$/i, '').trim();
  if (!basename || !extension) return false;
  const formatMentioned = extension === 'jpg' || extension === 'jpeg'
    ? /\b(?:jpg|jpeg)\b/.test(lowerTask)
    : new RegExp(`\\b${extension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lowerTask);
  return lowerTask.includes(basename) && formatMentioned;
}

function classifyBrowserDialogRisk(observation) {
  const text = cleanDialogText(`${observation.dialogType} ${observation.message} ${observation.defaultValue || ''}`, 2000).toLowerCase();
  if (/\b(password|passcode|sign in|login|log in|mfa|2fa|two-factor|verification code|captcha|recovery phrase|seed phrase|authenticator|confirm identity)\b/.test(text)) return 'credential_or_identity';
  if (/\b(payment|purchase|buy|subscribe|billing|credit card|charge|checkout|place order)\b/.test(text)) return 'payment_or_purchase';
  if (/\b(send|publish|post|share publicly|email now|submit order)\b/.test(text)) return 'external_send_or_publish';
  if (/\b(delete|erase|trash|remove permanently|discard changes|close without saving|leave page|unsaved changes|not be saved|revert|reset)\b/.test(text)) return 'destructive';
  if (/\balready exists\b/.test(text) && /\b(replace|overwrite)\b/.test(text)) return 'replace_requested_output';
  if (observation.dialogType === 'prompt') return 'prompt_input';
  if (observation.dialogType === 'alert' && /\b(ok|continue|close|done|warning|alert|profile|missing|modified|unavailable|cannot|could not|complete|saved)\b/.test(text)) return 'safe_acknowledgement';
  return 'unknown';
}

function buildBrowserDialogObservation(dialog, pageRef) {
  let url = null;
  try { url = pageRef.url(); } catch {}
  return {
    dialogType: typeof dialog.type === 'function' ? dialog.type() : 'unknown',
    message: cleanDialogText(typeof dialog.message === 'function' ? dialog.message() : ''),
    defaultValue: cleanDialogText(typeof dialog.defaultValue === 'function' ? dialog.defaultValue() : '', 300),
    url,
    title: null,
    buttons: browserDialogButtons(typeof dialog.type === 'function' ? dialog.type() : 'unknown'),
  };
}

function decideBrowserDialogAction(observation, taskContext) {
  const risk = classifyBrowserDialogRisk(observation);
  if (
    risk === 'credential_or_identity'
    || risk === 'payment_or_purchase'
    || risk === 'external_send_or_publish'
    || risk === 'destructive'
    || risk === 'prompt_input'
  ) {
    return {
      action: 'dismiss_dialog',
      risk,
      confidence: 0.96,
      reason: `Blocked ${risk.replace(/_/g, ' ')} browser popup from automatic acceptance.`,
      blocking: true,
    };
  }
  if (risk === 'replace_requested_output') {
    const filename = browserDialogFilename(observation.message);
    if (browserDialogTaskMentionsFilename(taskContext, filename)) {
      return {
        action: 'accept_dialog',
        risk,
        confidence: 0.94,
        reason: `The browser popup is asking to replace requested output file ${filename}.`,
        blocking: false,
      };
    }
    return {
      action: 'dismiss_dialog',
      risk,
      confidence: 0.85,
      reason: 'The popup is an overwrite request, but the requested output filename was not confirmed in the task.',
      blocking: true,
    };
  }
  if (risk === 'safe_acknowledgement' && observation.dialogType === 'alert') {
    return {
      action: 'accept_dialog',
      risk,
      confidence: 0.84,
      reason: 'The browser popup is a non-destructive acknowledgement.',
      blocking: false,
    };
  }
  return {
    action: 'dismiss_dialog',
    risk,
    confidence: 0.5,
    reason: 'No safe automatic browser popup action matched the task, so the bridge dismissed it and stopped.',
    blocking: true,
  };
}

async function runWithBrowserDialogHandling(pageRef, body, actionFn) {
  const taskContext = cleanDialogText([body.taskContext, body.task, body.description].filter(Boolean).join('\n'), 3000);
  const handledDialogs = [];
  let blockedDecision = null;
  const handler = async (dialog) => {
    const observation = buildBrowserDialogObservation(dialog, pageRef);
    const decision = decideBrowserDialogAction(observation, taskContext);
    const record = { observation, decision };
    handledDialogs.push(record);
    try {
      if (decision.action === 'accept_dialog') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    } catch (err) {
      blockedDecision = blockedDecision || {
        observation,
        decision: {
          ...decision,
          blocking: true,
          reason: `${decision.reason} Dialog handling failed: ${(err && err.message) || String(err)}`,
        },
      };
      return;
    }
    if (decision.blocking) blockedDecision = blockedDecision || record;
  };
  pageRef.on('dialog', handler);
  try {
    let result = null;
    try {
      result = await actionFn();
    } catch (err) {
      if (blockedDecision) {
        return { ok: false, blockedDecision, handledDialogs };
      }
      throw err;
    }
    if (blockedDecision) {
      return { ok: false, blockedDecision, handledDialogs };
    }
    return { ok: true, result, handledDialogs };
  } finally {
    pageRef.off('dialog', handler);
  }
}

function writeBrowserDialogBlocked(res, CORS, blockedDecision) {
  const observation = blockedDecision && blockedDecision.observation ? blockedDecision.observation : {};
  const decision = blockedDecision && blockedDecision.decision ? blockedDecision.decision : {};
  const message = cleanDialogText(observation.message || 'Browser popup needs a decision.', 500);
  writeBrowserFailure(
    res,
    CORS,
    `Browser dialog blocked: ${message}. Decision: ${decision.reason || 'No safe automatic action.'}`,
    undefined,
    'browser_dialog_blocked',
  );
}

/**
 * Bind one DOM tree, title, and exact renderer URL to the same live browser
 * process/context/page observation. The exact URL never leaves this helper.
 */
async function captureCoherentBrowserDomSnapshot(options = {}) {
  const {
    registry,
    contextRef,
    pageRef,
    resolveActivePage,
    evaluateSnapshot,
  } = options;
  if (
    !registry
    || !contextRef
    || !pageRef
    || typeof evaluateSnapshot !== 'function'
  ) {
    return {
      ok: false,
      code: 'browser_identity_mismatch',
      error: 'Browser DOM snapshot identity was unavailable.',
    };
  }

  let activeBefore = null;
  try {
    activeBefore = typeof resolveActivePage === 'function'
      ? resolveActivePage()
      : pageRef;
  } catch {}
  const pageIsLive = !pageRef.isClosed || pageRef.isClosed() === false;
  const entryContextId = registry.browserContextIdFor(contextRef);
  const entryPageId = registry.pageIdFor(pageRef);
  const entryExactUrl = pageUrl(pageRef);
  const displayUrl = safeHttpBrowserOrigin(entryExactUrl);
  if (
    !pageIsLive
    || activeBefore !== pageRef
    || !isBoundedIdentity(registry.browserProcessId)
    || !isBoundedIdentity(entryContextId)
    || !isBoundedIdentity(entryPageId)
    || !displayUrl
  ) {
    return {
      ok: false,
      code: 'browser_identity_mismatch',
      error: 'Browser DOM snapshot requires one live HTTP(S) page.',
    };
  }

  let snapshot;
  try {
    snapshot = await evaluateSnapshot();
  } catch {
    return {
      ok: false,
      code: 'uncertain_ui_target',
      error: 'Browser DOM snapshot capture failed.',
    };
  }
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || typeof snapshot.documentUrl !== 'string'
    || snapshot.documentUrl !== entryExactUrl
    || typeof snapshot.title !== 'string'
    || !snapshot.tree
    || typeof snapshot.tree !== 'object'
  ) {
    return {
      ok: false,
      code: 'browser_identity_mismatch',
      error: 'Browser page changed during DOM snapshot capture.',
    };
  }

  let activeAfter = null;
  try {
    activeAfter = typeof resolveActivePage === 'function'
      ? resolveActivePage()
      : pageRef;
  } catch {}
  const exitContextId = registry.browserContextIdFor(contextRef);
  const exitPageId = registry.pageIdFor(pageRef);
  const exitExactUrl = pageUrl(pageRef);
  if (
    activeAfter !== pageRef
    || exitContextId !== entryContextId
    || exitPageId !== entryPageId
    || exitExactUrl !== entryExactUrl
  ) {
    return {
      ok: false,
      code: 'browser_identity_mismatch',
      error: 'Browser page changed during DOM snapshot capture.',
    };
  }

  const identity = registry.observe(contextRef, pageRef, exitExactUrl);
  if (
    !identity
    || identity.browserProcessId !== registry.browserProcessId
    || identity.browserContextId !== entryContextId
    || identity.pageId !== entryPageId
    || identity.url !== entryExactUrl
  ) {
    return {
      ok: false,
      code: 'browser_identity_mismatch',
      error: 'Browser page changed during DOM snapshot capture.',
    };
  }

  return {
    ok: true,
    identity,
    displayUrl,
    snapshot,
  };
}

async function handleDomSnapshot(req, res, CORS, parsedUrl) {
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  const maxNodes = Math.max(20, Math.min(400, Number(parsedUrl.searchParams.get('max_nodes')) || 150));
  const interestingOnly = parsedUrl.searchParams.get('interesting') !== 'false';
  try {
    const pageRef = launched.page;
    const capture = await captureCoherentBrowserDomSnapshot({
      registry: browserIdentities,
      contextRef: launched.context,
      pageRef,
      resolveActivePage: () => activePage(launched.context),
      evaluateSnapshot: () => pageRef.evaluate(
        `${PAGE_WALKER}({ maxNodes: ${maxNodes}, interestingOnly: ${interestingOnly} })`,
      ),
    });
    if (!capture.ok) {
      writeBrowserFailure(
        res,
        CORS,
        capture.error,
        undefined,
        capture.code || 'browser_identity_mismatch',
      );
      return;
    }
    const { identity, displayUrl, snapshot: result } = capture;
    const exactUrl = identity.url;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...identity,
      // `url` remains the model-to-actionability identity slot, but its value
      // is now opaque. `displayUrl` is deliberately origin-only.
      url: buildBrowserUrlIdentity(exactUrl),
      displayUrl,
      title: sanitizeBrowserSnapshotText(result.title, 2_000),
      nodeCount: result.nodeCount,
      totalNodes: typeof result.totalNodes === 'number' ? result.totalNodes : result.nodeCount,
      truncated: !!result.truncated,
      tree: result.tree,
    }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'snapshot failed' }));
  }
}

async function handlePageSource(req, res, CORS, parsedUrl) {
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  const maxChars = Math.max(10_000, Math.min(300_000, Number(parsedUrl.searchParams.get('max_chars')) || 180_000));
  try {
    const pageRef = launched.page;
    const source = await pageRef.content();
    const sourceLength = source.length;
    const truncated = sourceLength > maxChars;
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) { writeBrowserFailure(res, CORS, 'browser page identity unavailable', undefined, 'browser_identity_mismatch'); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...identity,
      title: await pageRef.title(),
      sourceLength,
      truncated,
      maxChars,
      source: truncated ? source.slice(0, maxChars) : source,
    }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'page source failed' }));
  }
}

async function handleVerificationState(_req, res, CORS) {
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const pageRef = launched.page;
    const state = await inspectPageVerification(pageRef);
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) { writeBrowserFailure(res, CORS, 'browser page identity unavailable', undefined, 'browser_identity_mismatch'); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...state, ...identity }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'verification state failed' }));
  }
}

const LOCATOR_ACTIONABILITY_STABILITY_WINDOW_MS = 75;
const LOCATOR_ACTIONABILITY_MATCH_LIMIT = 1_000;

function boundedLocatorMatchCount(value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  return {
    matchCount: Math.min(count, LOCATOR_ACTIONABILITY_MATCH_LIMIT),
    matchCountCapped: count > LOCATOR_ACTIONABILITY_MATCH_LIMIT,
    unique: count === 1,
  };
}

function locatorBoxesAreStable(before, after, tolerance = 0.5) {
  if (!before || !after) return false;
  const values = ['x', 'y', 'width', 'height'];
  return values.every((key) => (
    Number.isFinite(before[key])
    && Number.isFinite(after[key])
    && Math.abs(before[key] - after[key]) <= tolerance
  ));
}

function safeBrowserOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.origin && parsed.origin !== 'null') return parsed.origin.slice(0, 300);
    return `${parsed.protocol || 'unknown:'}`.slice(0, 40);
  } catch {
    return 'unknown:';
  }
}

function safeHttpBrowserOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
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

function splitBrowserTextUrlTrailingPunctuation(rawValue) {
  const value = String(rawValue || '');
  const match = value.match(/[),.;!?]+$/);
  const trailing = match ? match[0] : '';
  return {
    candidate: trailing ? value.slice(0, -trailing.length) : value,
    trailing,
  };
}

function sanitizeAbsoluteBrowserTextUrl(rawValue) {
  const { candidate, trailing } = splitBrowserTextUrlTrailingPunctuation(rawValue);
  const origin = safeHttpBrowserOrigin(candidate);
  return `${origin || '[redacted URL]'}${trailing}`;
}

function sanitizeProtocolRelativeBrowserTextUrl(rawValue) {
  const { candidate, trailing } = splitBrowserTextUrlTrailingPunctuation(rawValue);
  try {
    const parsed = new URL(`https:${candidate}`);
    if (!parsed.host) return `[redacted URL]${trailing}`;
    return `//${parsed.host.slice(0, 260)}${trailing}`;
  } catch {
    return `[redacted URL]${trailing}`;
  }
}

function sanitizeBrowserSnapshotText(rawText, maxLength) {
  let text = String(rawText || '')
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
    (match, prefix) => `${prefix}${sanitizeProtocolRelativeBrowserTextUrl(match.slice(prefix.length))}`,
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
  return text.slice(0, maxLength);
}

function writeLocatorActionabilityFailure(res, CORS, errorCode, details) {
  const failures = {
    invalid_input: {
      error: 'Locator actionability requires exactly one role/name pair or one selector plus the complete expected browser identity.',
      recoveryHint: 'Take a fresh browser observation and retry with one exact locator and its process, context, page, and URL identity.',
      requiredEvidence: ['browser.dom_snapshot'],
    },
    browser_identity_required: {
      error: 'Complete browser identity evidence is required.',
      recoveryHint: 'Take a fresh browser observation and pass its exact process, context, page, and URL identity.',
      requiredEvidence: ['browser.dom_snapshot'],
    },
    browser_identity_mismatch: {
      error: 'The active browser page changed before actionability could be verified.',
      recoveryHint: 'Stop and take a fresh browser observation before choosing the target again.',
      requiredEvidence: ['browser.dom_snapshot'],
    },
    human_verification_required: {
      error: 'Human verification blocks browser target inspection.',
      recoveryHint: 'Ask the user to complete the verification gate, then take a fresh browser observation.',
      requiredEvidence: ['browser.verification_state', 'user.complete_browser_verification'],
    },
    selector_not_found: {
      error: 'The exact locator did not resolve to a live element.',
      recoveryHint: 'Take a fresh browser observation and choose a locator that resolves exactly once.',
      requiredEvidence: ['browser.dom_snapshot'],
    },
    ambiguous_locator: {
      error: 'The locator resolved to more than one element.',
      recoveryHint: 'Take a fresh browser observation and use a more specific semantic name or selector. Positional disambiguation is not accepted.',
      requiredEvidence: ['browser.dom_snapshot', 'user.confirm_target'],
    },
    uncertain_ui_target: {
      error: 'Bounded actionability evidence could not be verified.',
      recoveryHint: 'Take a fresh browser observation and retry. Do not mutate the target without verified evidence.',
      requiredEvidence: ['browser.dom_snapshot'],
    },
    browser_bridge_offline: {
      error: 'The local browser bridge is unavailable.',
      recoveryHint: 'Start or repair the browser bridge, then take a fresh browser observation.',
      requiredEvidence: ['browser.health'],
    },
  };
  const failure = failures[errorCode] || failures.uncertain_ui_target;
  res.writeHead(errorCode === 'browser_bridge_offline' ? 503 : 200, CORS);
  res.end(JSON.stringify({
    ok: false,
    error: failure.error,
    errorCode,
    recoveryHint: failure.recoveryHint,
    requiredEvidence: failure.requiredEvidence,
    ...(details || {}),
  }));
}

async function inspectLocatorActionability(locator, pageRef) {
  const countBefore = await locator.count();
  if (countBefore !== 1) return boundedLocatorMatchCount(countBefore);

  let handleBefore = null;
  let handleMiddle = null;
  let handleAfter = null;
  try {
    handleBefore = await locator.elementHandle();
    if (!handleBefore) return boundedLocatorMatchCount(0);
    const structuralSnapshot = async (handle) => handle.evaluate((element) => {
      const tagName = String(element.tagName || '').toLowerCase().slice(0, 40);
      const type = String(element.getAttribute && element.getAttribute('type') || '').toLowerCase().slice(0, 40);
      const role = String(element.getAttribute && element.getAttribute('role') || '').toLowerCase().slice(0, 40);
      const rect = element.getBoundingClientRect();
      const viewportWidth = Math.max(0, element.ownerDocument.defaultView?.innerWidth || 0);
      const viewportHeight = Math.max(0, element.ownerDocument.defaultView?.innerHeight || 0);
      const inViewport = rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < viewportWidth
        && rect.top < viewportHeight;
      const centerX = Math.min(Math.max(rect.left + (rect.width / 2), 0), Math.max(0, viewportWidth - 1));
      const centerY = Math.min(Math.max(rect.top + (rect.height / 2), 0), Math.max(0, viewportHeight - 1));
      const hit = inViewport ? element.ownerDocument.elementFromPoint(centerX, centerY) : null;
      const receivesEvents = !!hit && (hit === element || element.contains(hit));
      const nonEditableInputTypes = new Set([
        'button', 'checkbox', 'color', 'file', 'hidden', 'image',
        'radio', 'range', 'reset', 'submit',
      ]);
      const editableRelevant = !!element.isContentEditable
        || tagName === 'textarea'
        || tagName === 'select'
        || (tagName === 'input' && !nonEditableInputTypes.has(type))
        || ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role);
      return {
        attached: element.isConnected === true,
        editableRelevant,
        inViewport,
        receivesEvents,
        obscured: inViewport && !!hit && !receivesEvents,
      };
    });

    const [structureBefore, boxBefore, visibleBefore] = await Promise.all([
      structuralSnapshot(handleBefore),
      handleBefore.boundingBox().catch(() => null),
      handleBefore.isVisible().catch(() => false),
    ]);
    const firstSampleDelayMs = Math.floor(LOCATOR_ACTIONABILITY_STABILITY_WINDOW_MS / 2);
    await pageRef.waitForTimeout(firstSampleDelayMs);

    const countMiddle = await locator.count();
    if (countMiddle !== 1) return boundedLocatorMatchCount(countMiddle);
    handleMiddle = await locator.elementHandle();
    if (!handleMiddle) return boundedLocatorMatchCount(0);
    const [sameBeforeMiddle, structureMiddle, boxMiddle, visibleMiddle] = await Promise.all([
      handleBefore.evaluate((element, candidate) => element === candidate, handleMiddle).catch(() => false),
      structuralSnapshot(handleMiddle),
      handleMiddle.boundingBox().catch(() => null),
      handleMiddle.isVisible().catch(() => false),
    ]);
    await pageRef.waitForTimeout(LOCATOR_ACTIONABILITY_STABILITY_WINDOW_MS - firstSampleDelayMs);

    const countAfter = await locator.count();
    if (countAfter !== 1) return boundedLocatorMatchCount(countAfter);
    handleAfter = await locator.elementHandle();
    if (!handleAfter) return boundedLocatorMatchCount(0);
    const [sameMiddleAfter, structureAfter, boxAfter, visibleAfter, enabled, editable] = await Promise.all([
      handleMiddle.evaluate((element, candidate) => element === candidate, handleAfter).catch(() => false),
      structuralSnapshot(handleAfter),
      handleAfter.boundingBox().catch(() => null),
      handleAfter.isVisible().catch(() => false),
      handleAfter.isEnabled().catch(() => false),
      handleAfter.isEditable().catch(() => false),
    ]);
    const attached = sameBeforeMiddle
      && sameMiddleAfter
      && structureBefore.attached
      && structureMiddle.attached
      && structureAfter.attached;
    const visible = visibleBefore && visibleMiddle && visibleAfter;
    // Three observations reduce endpoint-return false positives. This is
    // intentionally reported as bounded sampled stability, not a mutation
    // capability or a guarantee about a later DOM state.
    const stable = attached
      && locatorBoxesAreStable(boxBefore, boxMiddle)
      && locatorBoxesAreStable(boxMiddle, boxAfter);
    const actionable = attached
      && visible
      && stable
      && enabled
      && structureAfter.inViewport
      && structureAfter.receivesEvents
      && (!structureAfter.editableRelevant || editable);
    return {
      matchCount: 1,
      matchCountCapped: false,
      unique: true,
      attached,
      visible,
      stable,
      stableWindowMs: LOCATOR_ACTIONABILITY_STABILITY_WINDOW_MS,
      enabled,
      editableRelevant: structureAfter.editableRelevant,
      editable,
      inViewport: structureAfter.inViewport,
      receivesEvents: structureAfter.receivesEvents,
      obscured: structureAfter.obscured,
      actionable,
    };
  } finally {
    const disposed = new Set();
    for (const handle of [handleAfter, handleMiddle, handleBefore]) {
      if (!handle || disposed.has(handle)) continue;
      disposed.add(handle);
      try { await handle.dispose(); } catch {}
    }
  }
}

/**
 * Produce bounded, read-only Playwright actionability evidence. This handler
 * never clicks, fills, focuses, scrolls, submits, or returns DOM/page text.
 */
async function handleLocatorActionability(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (
    err
    || !hasOnlyAllowedBodyFields(body, LOCATOR_ACTIONABILITY_FIELDS)
    || !hasExactlyOneLocatorActionabilityTarget(body)
    || (Object.prototype.hasOwnProperty.call(body, 'exact') && body.exact !== true)
    || !isBoundedIdentity(body && body.expectedBrowserProcessId)
    || !isBoundedIdentity(body && body.expectedBrowserContextId)
    || !isBoundedIdentity(body && body.expectedPageId)
    || typeof (body && body.expectedUrl) !== 'string'
    || body.expectedUrl.length < 1
    || body.expectedUrl.length > 4_096
    || !isBrowserUrlIdentity(body.expectedUrl)
  ) {
    writeLocatorActionabilityFailure(res, CORS, 'invalid_input');
    return;
  }
  // A read-only evidence request never launches Chrome or creates a page. A
  // complete prior identity presupposes an already-live context; if it is
  // absent or belongs to another bridge process, fail before any UI change.
  if (browserIdentities.browserProcessId !== body.expectedBrowserProcessId) {
    writeLocatorActionabilityFailure(res, CORS, 'browser_identity_mismatch');
    return;
  }
  const contextRef = context;
  let pageRef = null;
  try {
    pageRef = contextRef ? activePage(contextRef) : null;
  } catch {}
  if (!contextRef || !pageRef) {
    writeLocatorActionabilityFailure(res, CORS, 'browser_identity_mismatch');
    return;
  }
  const launched = { context: contextRef, page: pageRef };
  const checkIdentity = () => checkExpectedBrowserToggleIdentity(
    browserIdentities,
    launched.context,
    pageRef,
    body,
    activePage(launched.context),
  );
  const entryIdentity = checkIdentity();
  if (!entryIdentity.ok) {
    writeLocatorActionabilityFailure(res, CORS, entryIdentity.code);
    return;
  }
  try {
    const verificationGate = await guardHumanVerification(pageRef, [
      body.role,
      body.name,
      body.selector,
    ]);
    if (verificationGate) {
      writeLocatorActionabilityFailure(res, CORS, 'human_verification_required', {
        requiresHumanVerification: true,
      });
      return;
    }
    const postGateIdentity = checkIdentity();
    if (!postGateIdentity.ok) {
      writeLocatorActionabilityFailure(res, CORS, postGateIdentity.code);
      return;
    }
    const locatorKind = typeof body.selector === 'string' ? 'selector' : 'semantic';
    if (locatorKind === 'selector') {
      const isNativeCss = await pageRef.evaluate((selector) => {
        try {
          document.querySelectorAll(selector);
          return true;
        } catch {
          return false;
        }
      }, body.selector);
      if (isNativeCss !== true) {
        writeLocatorActionabilityFailure(res, CORS, 'invalid_input');
        return;
      }
    }
    const locator = locatorKind === 'selector'
      ? pageRef.locator(`css=${body.selector}`)
      : pageRef.getByRole(body.role, { name: body.name, exact: true });
    const evidence = await inspectLocatorActionability(locator, pageRef);
    if (evidence.matchCount === 0) {
      writeLocatorActionabilityFailure(res, CORS, 'selector_not_found', evidence);
      return;
    }
    if (evidence.matchCount !== 1 || evidence.matchCountCapped) {
      writeLocatorActionabilityFailure(res, CORS, 'ambiguous_locator', {
        ...evidence,
        matches: evidence.matchCount,
      });
      return;
    }
    const exitIdentity = checkIdentity();
    if (!exitIdentity.ok) {
      writeLocatorActionabilityFailure(res, CORS, exitIdentity.code);
      return;
    }
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) {
      writeLocatorActionabilityFailure(res, CORS, 'browser_identity_mismatch');
      return;
    }
    const {
      url: currentUrl,
      browserProcessId,
      browserContextId,
      pageId,
      observedAt,
      evidenceId,
    } = identity;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      browserProcessId,
      browserContextId,
      pageId,
      observedAt,
      evidenceId,
      currentUrlOrigin: safeBrowserOrigin(currentUrl),
      urlMatchesExpected: browserExpectedUrlMatches(body.expectedUrl, currentUrl),
      locatorKind,
      readOnlyEvidence: true,
      mutationAuthorization: false,
      ...evidence,
    }));
  } catch {
    writeLocatorActionabilityFailure(res, CORS, 'uncertain_ui_target');
  }
}

// ── Locator resolver ────────────────────────────────────────────────────────
//
// Plays nice with three planner output shapes seen in the wild:
//
//   1. {role, name}             — canonical accessible-name path
//   2. {role, selector}         — explicit CSS selector
//   3. {role, name: "input[name='email']"}  — model jammed a CSS
//      selector into the `name` slot. Common failure mode: the
//      planner sees `name="email"` in DOM and emits it as the
//      accessibility name. We detect that pattern and route to
//      page.locator() instead of getByRole(name=...).
//
// Also implements a semantic-name fallback: when the bad-shape `name`
// happens to be input[name="x"] or similar, we extract `x` as a
// candidate accessible name and try BOTH paths so the user gets one
// success rather than two timeouts.

function looksLikeCssSelector(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  return (
    /^[#.]/.test(t)                                      // .class or #id
    || /\[[\w-]+\s*([~|^$*]?=|\])/.test(t)               // [attr=...] anywhere
    || /:nth-(?:child|of-type|last-child)/.test(t)       // :nth-...
    || /^[a-z][\w-]*\s*[>+~]/.test(t)                    // tag combinator
    || /^[a-z][\w-]*\s*\[/.test(t)                       // tag[attr...
    || /^[a-z][\w-]*\s*\.[\w-]/.test(t)                  // tag.class
  );
}

// Extract a semantic name guess from common attribute-selector shapes.
// "input[name='email']"  → "email"
// "input[type='submit']" → null  (type isn't a label)
// "[aria-label='Sign in']" → "Sign in"
// "[placeholder='Email address']" → "Email address"
function extractSemanticName(selector) {
  const m1 = selector.match(/\[(name|aria-label|placeholder|title)\s*=\s*['"]?([^'"\]]+)['"]?\]/i);
  if (m1) return m1[2];
  return null;
}

// ── Ambiguous-locator guard ─────────────────────────────────────────────
//
// Playwright's `.click()`/`.fill()` act on the FIRST match when a
// locator resolves to multiple elements (unless strict mode trips),
// which silently clicks the wrong thing on pages with repeated
// labels ("Edit", "Delete", "Add to cart"...). Before acting we
// resolve the match count: >1 match with no explicit `nth`
// disambiguator returns a structured `ambiguous_locator` error with
// up to 5 candidate descriptions so the model can pick one and retry
// with `nth`. Single match (or count unavailable) keeps the old
// behavior. Count 0 also falls through so the normal timeout path
// still produces `selector_not_found`.
const AMBIGUOUS_CANDIDATE_LIMIT = 5;

async function detectAmbiguousLocator(locator, body) {
  if (typeof body.nth === 'number') return null; // explicit disambiguator
  let count = 0;
  try { count = await locator.count(); } catch { return null; }
  if (count <= 1) return null;
  const candidates = [];
  const limit = Math.min(count, AMBIGUOUS_CANDIDATE_LIMIT);
  for (let i = 0; i < limit; i += 1) {
    try {
      const info = await locator.nth(i).evaluate((el) => {
        const text = (el.innerText || el.value || el.textContent || '')
          .replace(/\s+/g, ' ').trim().slice(0, 80);
        return {
          role: (el.getAttribute && el.getAttribute('role')) || (el.tagName || '').toLowerCase() || 'unknown',
          name: (el.getAttribute && (
            el.getAttribute('aria-label')
            || el.getAttribute('name')
            || el.getAttribute('title')
            || el.getAttribute('placeholder')
          )) || null,
          snippet: text,
        };
      });
      const candidate = { role: info.role };
      if (info.name) candidate.name = String(info.name).slice(0, 120);
      if (info.snippet) candidate.snippet = info.snippet;
      candidates.push(candidate);
    } catch {
      candidates.push({ role: 'unknown', snippet: `(could not inspect match ${i})` });
    }
  }
  return { matches: count, candidates };
}

function writeAmbiguousLocator(res, CORS, body, ambiguity) {
  const target = body.selector || body.name || body.role || 'locator';
  res.writeHead(200, CORS);
  res.end(JSON.stringify({
    ok: false,
    error: `ambiguous locator: ${ambiguity.matches} elements match "${String(target).slice(0, 160)}". Pass nth (0-based) or a more specific selector to disambiguate.`,
    errorCode: 'ambiguous_locator',
    matches: ambiguity.matches,
    candidates: ambiguity.candidates,
    recoveryHint: 'Pick the intended element from `candidates` and retry the same action with the matching `nth` index (0-based), or use a more specific selector.',
    requiredEvidence: ['browser.dom_snapshot', 'user.confirm_target'],
  }));
}

// Resolve the locator ROOT: normally the page, but when `frameSelector`
// is present we scope every lookup inside that iframe via
// page.frameLocator(). FrameLocator exposes the same getByRole/getByLabel/
// getByPlaceholder/getByAltText/getByTitle/getByTestId/locator surface as
// Page, so resolveLocator below works against either root unchanged.
// Backward-compatible: no frameSelector → the page itself is the root.
function locatorRoot(page, body) {
  const frameSelector = body && typeof body.frameSelector === 'string' ? body.frameSelector.trim() : '';
  return frameSelector ? page.frameLocator(frameSelector) : page;
}

// Build a Playwright Locator from any of the three input shapes.
// Returns the locator without trying a fill/click yet — caller handles
// the action so timeout/submit logic stays at the call site.
function resolveLocator(page, role, body) {
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
  const exact = body.exact === true;
  // Scope into an iframe when frameSelector is set (else `root === page`).
  const root = locatorRoot(page, body);
  // 1. Explicit selector — highest precedence.
  if (body.selector && typeof body.selector === 'string') {
    return root.locator(body.selector);
  }
  // 2. `name` that's actually a CSS selector.
  if (body.name && looksLikeCssSelector(body.name)) {
    return root.locator(body.name);
  }
  // 3. Semantic-locator ladder (additive optional fields). Strict order, each
  //    only used when the field is a non-empty string. These are resilient to
  //    DOM churn and preferred over a raw CSS guess but still below an explicit
  //    selector. `exact` is forwarded where the getBy* API supports it
  //    (getByTestId has no exact option). NOTE: there is intentionally no
  //    `text` rung — body.text is the fill VALUE, not a locator hint.
  if (isStr(body.testId)) return root.getByTestId(String(body.testId).trim());
  if (isStr(body.label)) return root.getByLabel(String(body.label), exact ? { exact: true } : undefined);
  if (isStr(body.placeholder)) return root.getByPlaceholder(String(body.placeholder), exact ? { exact: true } : undefined);
  if (isStr(body.altText)) return root.getByAltText(String(body.altText), exact ? { exact: true } : undefined);
  if (isStr(body.title)) return root.getByTitle(String(body.title), exact ? { exact: true } : undefined);
  // 4. Canonical role + accessible name (default).
  const opts = {};
  if (body.name) opts.name = String(body.name);
  if (exact) opts.exact = true;
  return root.getByRole(role, opts);
}

/**
 * Inspect the exact ElementHandle selected for a legacy generic click. This
 * deliberately ignores the caller's claimed role/selector semantics: native
 * state/selection controls, their labels, and their descendants must use the
 * corresponding observed, approval-gated state-setting lane.
 */
async function inspectResolvedGenericClickTarget(handle) {
  return handle.evaluate((element) => {
    const compactLower = (value, maxLength = 80) => String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, maxLength);
    const stateControl = (node) => {
      if (!node || !node.getAttribute) return null;
      const tagName = compactLower(node.tagName, 40);
      const type = compactLower(node.getAttribute('type'), 40);
      const role = compactLower(node.getAttribute('role'), 40);
      if (tagName === 'input' && (type === 'checkbox' || type === 'radio')) {
        return {
          kind: type === 'checkbox' ? 'native_checkbox' : 'native_radio',
          tagName,
          type,
          role,
        };
      }
      if (role === 'checkbox' || role === 'switch' || role === 'radio') {
        return {
          kind: `aria_${role}`,
          tagName,
          type,
          role,
        };
      }
      return null;
    };
    const selectionControl = (node) => {
      if (!node || !node.getAttribute) return null;
      const tagName = compactLower(node.tagName, 40);
      const role = compactLower(node.getAttribute('role'), 40);
      const listId = compactLower(node.getAttribute('list'), 120);
      const ariaHasPopup = compactLower(node.getAttribute('aria-haspopup'), 40);
      const ariaAutocomplete = compactLower(node.getAttribute('aria-autocomplete'), 40);
      if (tagName === 'select' || tagName === 'option') {
        return {
          kind: `native_${tagName}`,
          tagName,
          role,
        };
      }
      if (role === 'combobox' || role === 'listbox' || role === 'option') {
        return {
          kind: `aria_${role}`,
          tagName,
          role,
        };
      }
      if (
        listId
        || ariaHasPopup === 'listbox'
        || ariaAutocomplete === 'list'
        || ariaAutocomplete === 'both'
      ) {
        return {
          kind: 'implicit_combobox',
          tagName,
          role,
        };
      }
      return null;
    };

    const direct = stateControl(element);
    if (direct) {
      return {
        isStateControl: true,
        isSelectionControl: false,
        relationship: 'direct',
        ...direct,
      };
    }
    const directSelection = selectionControl(element);
    if (directSelection) {
      return {
        isStateControl: false,
        isSelectionControl: true,
        relationship: 'direct',
        ...directSelection,
      };
    }

    const label = compactLower(element && element.tagName, 40) === 'label'
      ? element
      : element && typeof element.closest === 'function'
        ? element.closest('label')
        : null;
    const associated = stateControl(label && label.control);
    if (associated) {
      return {
        isStateControl: true,
        isSelectionControl: false,
        relationship: 'associated_label',
        ...associated,
      };
    }
    const associatedSelection = selectionControl(label && label.control);
    if (associatedSelection) {
      return {
        isStateControl: false,
        isSelectionControl: true,
        relationship: 'associated_label',
        ...associatedSelection,
      };
    }

    const stateAncestor = element && typeof element.closest === 'function'
      ? element.closest('[role="checkbox"],[role="switch"],[role="radio"]')
      : null;
    const ancestor = stateControl(stateAncestor);
    if (ancestor) {
      return {
        isStateControl: true,
        isSelectionControl: false,
        relationship: 'state_control_ancestor',
        ...ancestor,
      };
    }
    const selectionAncestor = element && typeof element.closest === 'function'
      ? element.closest('select,option,[role="combobox"],[role="listbox"],[role="option"]')
      : null;
    const selectionAncestorInspection = selectionControl(selectionAncestor);
    if (selectionAncestorInspection) {
      return {
        isStateControl: false,
        isSelectionControl: true,
        relationship: 'selection_control_ancestor',
        ...selectionAncestorInspection,
      };
    }

    return {
      isStateControl: false,
      isSelectionControl: false,
      relationship: 'none',
      kind: 'non_state_control',
      tagName: compactLower(element && element.tagName, 40),
      type: compactLower(element && element.getAttribute && element.getAttribute('type'), 40),
      role: compactLower(element && element.getAttribute && element.getAttribute('role'), 40),
    };
  });
}

async function clickResolvedNonToggleTarget(locator, timeout) {
  let targetHandle = null;
  try {
    targetHandle = await locator.elementHandle({ timeout });
    if (!targetHandle) {
      const missingError = new Error('generic browser click could not resolve one exact target');
      missingError.browserErrorCode = 'uncertain_ui_target';
      throw missingError;
    }
    let inspection;
    try {
      inspection = await inspectResolvedGenericClickTarget(targetHandle);
    } catch {
      const inspectionError = new Error('generic browser click could not safely inspect the exact resolved target');
      inspectionError.browserErrorCode = 'uncertain_ui_target';
      throw inspectionError;
    }
    if (
      !inspection
      || typeof inspection.isStateControl !== 'boolean'
      || typeof inspection.isSelectionControl !== 'boolean'
    ) {
      const uncertainError = new Error('generic browser click received an unverifiable exact target');
      uncertainError.browserErrorCode = 'uncertain_ui_target';
      throw uncertainError;
    }
    if (inspection.isStateControl) {
      const toggleError = new Error(
        'generic browser click cannot activate checkbox, switch, or radio state controls; use browser.set_toggle with fresh observation and approval',
      );
      toggleError.browserErrorCode = 'browser_toggle_canary_blocked';
      throw toggleError;
    }
    if (inspection.isSelectionControl) {
      const selectError = new Error(
        'generic browser click cannot activate combobox, listbox, option, or native select controls; use the sealed browser.select_option lane',
      );
      selectError.browserErrorCode = 'browser_select_canary_blocked';
      throw selectError;
    }
    await targetHandle.click({ timeout });
  } finally {
    if (targetHandle) {
      try { await targetHandle.dispose(); } catch {}
    }
  }
}

async function handleClickRole(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || '').trim();
  if (!role) { writeBrowserFailure(res, CORS, 'role required', undefined, 'invalid_input', 400); return; }
  if (['combobox', 'listbox', 'option'].includes(role.toLowerCase())) {
    writeBrowserFailure(
      res,
      CORS,
      'generic browser click cannot mutate selection controls; use the sealed browser.select_option lane',
      undefined,
      'browser_select_canary_blocked',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [role, body.name, body.selector]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    let locator = resolveLocator(launched.page, role, body);
    const ambiguity = await detectAmbiguousLocator(locator, body);
    if (ambiguity) { writeAmbiguousLocator(res, CORS, body, ambiguity); return; }
    if (typeof body.nth === 'number') locator = locator.nth(body.nth);
    try {
      const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await clickResolvedNonToggleTarget(locator, timeout);
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    } catch (firstErr) {
      if (firstErr && firstErr.browserErrorCode) throw firstErr;
      // Fallback: if `name` looked like a selector and direct locator
      // failed, try extracting a semantic name and going through
      // getByRole. Real selectors win; semantic name is a last-resort
      // disambiguator.
      const semantic = body.name && looksLikeCssSelector(body.name)
        ? extractSemanticName(body.name)
        : null;
      if (!semantic) throw firstErr;
      const opts = { name: semantic };
      if (body.exact === true) opts.exact = true;
      const fallback = locatorRoot(launched.page, body).getByRole(role, opts);
      const fb = typeof body.nth === 'number' ? fallback.nth(body.nth) : fallback;
      const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await clickResolvedNonToggleTarget(fb, timeout);
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, role, name: body.name || null, frameSelector: body.frameSelector || null }));
  } catch (e) {
    const safeCode = e && e.browserErrorCode ? e.browserErrorCode : undefined;
    writeBrowserFailure(res, CORS, e, 'click failed', safeCode);
  }
}

/**
 * Resolve and inspect one exact non-secret fill target without mutating it.
 * The returned targetId is a short-lived, single-use capability backed by the
 * same ElementHandle that guarded fill must later consume.
 */
async function handleObserveGuardedFillTarget(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'textbox').trim();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
  if (
    !hasOnlyAllowedBodyFields(body, GUARDED_TARGET_OBSERVE_FIELDS)
    || !hasExactlyOneGuardedFillLocator(body)
    || !/^[a-z][a-z0-9_-]{0,79}$/i.test(role)
    || ['combobox', 'listbox', 'option'].includes(role.toLowerCase())
    || name.length > 500
    || selector.length > 1_000
    || (body.frameSelector != null && (
      typeof body.frameSelector !== 'string'
      || !body.frameSelector.trim()
      || body.frameSelector.trim().length > 1_000
    ))
    || (body.exact != null && typeof body.exact !== 'boolean')
    || (body.timeoutMs != null && (
      typeof body.timeoutMs !== 'number'
      || !Number.isFinite(body.timeoutMs)
    ))
    || (body.taskContext != null && (
      typeof body.taskContext !== 'string'
      || body.taskContext.trim().length > 1_000
    ))
    || body.credentialSemantics !== false
    || body.text != null
    || body.submit != null
    || body.nth != null
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded browser target observation requires one non-selection field locator and accepts no text, submit, or nth argument',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  if (isCredentialFillSemantics(body)) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded browser target refuses credential semantics',
      undefined,
      'browser_fill_canary_blocked',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  let targetHandle = null;
  try {
    const pageRef = launched.page;
    const gate = await guardHumanVerification(pageRef, [role, body.name, body.selector]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const startingIdentityCheck = checkExpectedBrowserFillIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!startingIdentityCheck.ok) {
      writeBrowserFailure(
        res,
        CORS,
        startingIdentityCheck.code === 'browser_identity_required'
          ? 'fresh browser context, page, and URL identity required before target observation'
          : 'browser context, document, active page, or URL changed before target observation',
        undefined,
        startingIdentityCheck.code,
      );
      return;
    }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    let locator = resolveLocator(pageRef, role, body);
    const ambiguity = await detectAmbiguousLocator(locator, body);
    if (ambiguity) { writeAmbiguousLocator(res, CORS, body, ambiguity); return; }
    let matchCount;
    try {
      matchCount = await locator.count();
    } catch {
      writeBrowserFailure(
        res,
        CORS,
        'guarded browser target could not be counted reliably',
        undefined,
        'uncertain_ui_target',
      );
      return;
    }
    if (matchCount !== 1) {
      writeBrowserFailure(
        res,
        CORS,
        matchCount === 0
          ? 'guarded browser target was not found'
          : 'guarded browser target became ambiguous during observation',
        undefined,
        matchCount === 0 ? 'selector_not_found' : 'uncertain_ui_target',
      );
      return;
    }
    targetHandle = await locator.elementHandle({ timeout });
    if (!targetHandle) {
      writeBrowserFailure(res, CORS, 'guarded browser target was not found', undefined, 'uncertain_ui_target');
      return;
    }
    const inspection = await inspectResolvedFillTarget(targetHandle);
    if (!inspection.allowed) {
      writeBrowserFailure(
        res,
        CORS,
        'guarded browser target is a credential, verification, or unverifiable field',
        undefined,
        'browser_fill_canary_blocked',
        400,
      );
      return;
    }
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) {
      writeBrowserFailure(res, CORS, 'browser target identity unavailable', undefined, 'browser_identity_required');
      return;
    }
    const identityCheck = checkExpectedBrowserFillIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!identityCheck.ok) {
      writeBrowserFailure(res, CORS, 'browser target changed during observation', undefined, identityCheck.code);
      return;
    }
    const targetFingerprint = buildGuardedTargetFingerprint(identity, inspection.descriptor);
    if (!targetFingerprint) {
      writeBrowserFailure(res, CORS, 'browser target fingerprint unavailable', undefined, 'uncertain_ui_target');
      return;
    }
    const issued = guardedTargetCapabilities.issue({
      capabilityKind: 'guarded_fill_v2',
      handle: targetHandle,
      contextRef: launched.context,
      pageRef,
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      targetFingerprint,
    });
    if (!issued.ok) {
      writeBrowserFailure(res, CORS, 'browser target capability capacity reached', undefined, issued.code);
      return;
    }
    targetHandle = null; // ownership transferred to the capability store
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...identity,
      targetId: issued.targetId,
      targetFingerprint,
      targetExpiresAt: issued.targetExpiresAt,
    }));
  } catch (error) {
    writeBrowserFailure(res, CORS, error, 'guarded browser target observation failed', 'uncertain_ui_target');
  } finally {
    if (targetHandle) {
      try { await targetHandle.dispose(); } catch {}
    }
  }
}

async function handleObserveGuardedToggleTarget(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
  if (
    !hasOnlyAllowedBodyFields(body, GUARDED_TOGGLE_OBSERVE_FIELDS)
    || !['checkbox', 'switch', 'radio'].includes(role)
    || Number(Boolean(name)) + Number(Boolean(selector)) !== 1
    || name.length > 500
    || selector.length > 1_000
    || (body.frameSelector != null && (
      typeof body.frameSelector !== 'string'
      || !body.frameSelector.trim()
      || body.frameSelector.trim().length > 1_000
    ))
    || body.exact !== true
    || (body.timeoutMs != null && (
      typeof body.timeoutMs !== 'number'
      || !Number.isFinite(body.timeoutMs)
      || body.timeoutMs < 500
      || body.timeoutMs > 30_000
    ))
    || (body.taskContext != null && (
      typeof body.taskContext !== 'string'
      || !body.taskContext.trim()
      || body.taskContext.trim().length > 1_000
    ))
    || typeof body.desiredState !== 'boolean'
    || body.submit !== false
    || body.credentialSemantics !== false
    || !isBoundedIdentity(body.expectedBrowserProcessId)
    || !isBoundedIdentity(body.expectedBrowserContextId)
    || !isBoundedIdentity(body.expectedPageId)
    || typeof body.expectedUrl !== 'string'
    || body.expectedUrl.length < 1
    || body.expectedUrl.length > 4_096
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded toggle observation requires one exact checkbox, switch, or radio target and a desired boolean state',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  if (role === 'radio' && body.desiredState !== true) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded radio state can only be set true',
      undefined,
      'browser_toggle_canary_blocked',
      400,
    );
    return;
  }
  if (hasUnsafeGuardedToggleRequest(body)) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded toggle refuses credential or verification semantics',
      undefined,
      'browser_toggle_canary_blocked',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) {
    writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503);
    return;
  }
  let targetHandle = null;
  try {
    const pageRef = launched.page;
    const gate = await guardHumanVerification(pageRef, [role, body.taskContext]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const startingIdentityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!startingIdentityCheck.ok) {
      writeBrowserFailure(
        res,
        CORS,
        'fresh browser process, context, page, and URL identity required before toggle observation',
        undefined,
        startingIdentityCheck.code,
      );
      return;
    }
    const timeout = Number(body.timeoutMs) || 5_000;
    const locator = resolveLocator(pageRef, role, body);
    let matchCount;
    try {
      matchCount = await locator.count();
    } catch {
      writeBrowserFailure(
        res,
        CORS,
        'guarded toggle target could not be counted reliably',
        undefined,
        'uncertain_ui_target',
      );
      return;
    }
    if (matchCount !== 1) {
      writeBrowserFailure(
        res,
        CORS,
        matchCount === 0
          ? 'guarded toggle target was not found'
          : 'guarded toggle target was ambiguous',
        undefined,
        matchCount === 0 ? 'selector_not_found' : 'uncertain_ui_target',
      );
      return;
    }
    targetHandle = await locator.elementHandle({ timeout });
    if (!targetHandle) {
      writeBrowserFailure(res, CORS, 'guarded toggle target was not found', undefined, 'uncertain_ui_target');
      return;
    }
    const inspection = await inspectResolvedToggleTarget(targetHandle);
    if (
      !inspection.allowed
      || inspection.descriptor.role !== role
      || typeof inspection.currentState !== 'boolean'
    ) {
      writeBrowserFailure(
        res,
        CORS,
        'guarded toggle target is not a safe deterministic checkbox, switch, or radio state control',
        undefined,
        'browser_toggle_canary_blocked',
        400,
      );
      return;
    }
    const identity = observeBrowserPage(launched.context, pageRef);
    const identityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (
      !identity
      || !identityCheck.ok
      || inspection.descriptor.documentUrl !== identity.url
    ) {
      writeBrowserFailure(
        res,
        CORS,
        'browser toggle target changed during observation',
        undefined,
        identityCheck.ok ? 'browser_identity_mismatch' : identityCheck.code,
      );
      return;
    }
    const targetFingerprint = buildGuardedToggleTargetFingerprint(
      identity,
      inspection.descriptor,
      body.desiredState,
    );
    const invariantFingerprint = buildGuardedToggleInvariantFingerprint(
      identity,
      inspection.descriptor,
    );
    if (!isBoundedIdentity(targetFingerprint) || !isBoundedIdentity(invariantFingerprint)) {
      writeBrowserFailure(res, CORS, 'browser toggle fingerprint unavailable', undefined, 'uncertain_ui_target');
      return;
    }
    const issued = guardedTargetCapabilities.issue({
      capabilityKind: 'guarded_toggle_v2',
      handle: targetHandle,
      contextRef: launched.context,
      pageRef,
      browserProcessId: identity.browserProcessId,
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      role,
      toggleKind: inspection.toggleKind,
      initialState: inspection.currentState,
      desiredState: body.desiredState,
      targetFingerprint,
      invariantFingerprint,
    });
    if (!issued.ok) {
      writeBrowserFailure(res, CORS, 'browser toggle capability capacity reached', undefined, issued.code);
      return;
    }
    targetHandle = null; // ownership transferred to the single-use capability store
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...identity,
      targetId: issued.targetId,
      targetFingerprint,
      targetExpiresAt: issued.targetExpiresAt,
      currentState: inspection.currentState,
      desiredState: body.desiredState,
      role,
    }));
  } catch {
    writeBrowserFailure(
      res,
      CORS,
      'guarded browser toggle observation failed',
      'guarded browser toggle observation failed',
      'uncertain_ui_target',
    );
  } finally {
    if (targetHandle) {
      try { await targetHandle.dispose(); } catch {}
    }
  }
}

async function handleSetToggle(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  if (
    !hasOnlyAllowedBodyFields(body, GUARDED_TOGGLE_MUTATION_FIELDS)
    || body.toggleMode !== 'guarded_non_consequential'
    || !isBoundedIdentity(body.targetId)
    || !isBoundedIdentity(body.targetFingerprint)
    || typeof body.desiredState !== 'boolean'
    || body.submit !== false
    || body.credentialSemantics !== false
    || (body.timeoutMs != null && (
      typeof body.timeoutMs !== 'number'
      || !Number.isFinite(body.timeoutMs)
      || body.timeoutMs < 500
      || body.timeoutMs > 30_000
    ))
    || (body.taskContext != null && (
      typeof body.taskContext !== 'string'
      || !body.taskContext.trim()
      || body.taskContext.trim().length > 1_000
    ))
    || !isBoundedIdentity(body.expectedBrowserProcessId)
    || !isBoundedIdentity(body.expectedBrowserContextId)
    || !isBoundedIdentity(body.expectedPageId)
    || typeof body.expectedUrl !== 'string'
    || body.expectedUrl.length < 1
    || body.expectedUrl.length > 4_096
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded toggle mutation requires one observed target capability and exact desired boolean state',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) {
    writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503);
    return;
  }
  const pageRef = launched.page;
  const gate = await guardHumanVerification(pageRef, [body.taskContext]);
  if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
  const timeout = Number(body.timeoutMs) || 5_000;
  const consumed = guardedTargetCapabilities.consume(body.targetId);
  if (!consumed.ok) {
    writeBrowserFailure(
      res,
      CORS,
      `guarded browser toggle target unavailable (${consumed.code})`,
      undefined,
      consumed.code,
      409,
    );
    return;
  }
  const targetRecord = consumed.record;
  const targetHandle = targetRecord.handle;
  try {
    const capabilityCheck = checkGuardedToggleCapabilityRecord(
      targetRecord,
      body,
      launched.context,
      pageRef,
    );
    if (!capabilityCheck.ok) {
      const capabilityError = new Error('guarded toggle capability does not match the approved state target');
      capabilityError.browserErrorCode = capabilityCheck.code;
      throw capabilityError;
    }
    if (targetRecord.role === 'radio' && body.desiredState !== true) {
      const radioError = new Error('guarded radio state can only be set true');
      radioError.browserErrorCode = 'browser_toggle_canary_blocked';
      throw radioError;
    }
    const identityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!identityCheck.ok) {
      const identityError = new Error('browser identity changed before guarded toggle mutation');
      identityError.browserErrorCode = identityCheck.code;
      throw identityError;
    }
    let targetInspection;
    try {
      targetInspection = await inspectResolvedToggleTarget(targetHandle);
    } catch {
      const detachedError = new Error('observed toggle target detached before handler entry');
      detachedError.browserErrorCode = 'uncertain_ui_target';
      throw detachedError;
    }
    if (
      !targetInspection.allowed
      || targetInspection.descriptor.role !== targetRecord.role
      || targetInspection.toggleKind !== targetRecord.toggleKind
    ) {
      const unsafeError = new Error('observed toggle target became unsafe or changed control kind');
      unsafeError.browserErrorCode = 'browser_toggle_canary_blocked';
      throw unsafeError;
    }
    const handlerIdentity = observeBrowserPage(launched.context, pageRef);
    const handlerFingerprint = buildGuardedToggleTargetFingerprint(
      handlerIdentity,
      targetInspection.descriptor,
      body.desiredState,
    );
    const handlerInvariantFingerprint = buildGuardedToggleInvariantFingerprint(
      handlerIdentity,
      targetInspection.descriptor,
    );
    if (
      !handlerIdentity
      || handlerFingerprint !== targetRecord.targetFingerprint
      || handlerInvariantFingerprint !== targetRecord.invariantFingerprint
    ) {
      const driftError = new Error('observed toggle target changed after observation');
      driftError.browserErrorCode = 'browser_target_mismatch';
      throw driftError;
    }
    const previousState = targetInspection.currentState;
    const mutationPerformed = previousState !== body.desiredState;
    if (mutationPerformed) {
      const dialogRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
        try {
          await targetHandle.click({ timeout });
        } catch {
          const clickError = new Error('observed toggle target detached or became non-actionable');
          clickError.browserErrorCode = 'uncertain_ui_target';
          throw clickError;
        }
        return null;
      });
      if (!dialogRun.ok) {
        writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision);
        return;
      }
    }
    const coherentObservation = await captureCoherentGuardedToggleObservation({
      registry: browserIdentities,
      contextRef: launched.context,
      pageRef,
      expectedIdentity: body,
      targetHandle,
      expectedInvariantFingerprint: targetRecord.invariantFingerprint,
      expectedToggleKind: targetRecord.toggleKind,
      expectedRole: targetRecord.role,
      resolveActivePage: () => activePage(launched.context),
    });
    if (!coherentObservation.ok) {
      const observationError = new Error('browser toggle completion observation drifted or became unsafe');
      observationError.browserErrorCode = coherentObservation.code;
      throw observationError;
    }
    const proof = buildRedactedBrowserToggleProof(
      coherentObservation,
      previousState,
      body.desiredState,
      targetRecord.targetFingerprint,
      mutationPerformed,
    );
    if (!proof) {
      writeBrowserFailure(res, CORS, 'browser toggle proof unavailable', undefined, 'browser_identity_mismatch');
      return;
    }
    if (!proof.stateMatches) {
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: false,
        error: 'browser toggle did not reach the desired state',
        errorCode: 'browser_toggle_verification_failed',
        recoveryHint: browserRecoveryHint('browser_toggle_verification_failed'),
        requiredEvidence: browserRequiredEvidence('browser_toggle_verification_failed'),
        ...proof,
      }));
      return;
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...proof }));
  } catch (error) {
    const safeCode = error && error.browserErrorCode
      ? error.browserErrorCode
      : classifyBrowserFailure(error);
    writeBrowserFailure(
      res,
      CORS,
      `guarded browser toggle failed (${safeCode})`,
      'toggle failed',
      safeCode,
    );
  } finally {
    try { await targetHandle.dispose(); } catch {}
  }
}

async function handleFill(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'textbox').trim();
  const text = typeof body.text === 'string' ? body.text : '';
  const guardedNonSecret = body.fillMode === 'guarded_non_secret';
  if (text.length > 4000) { writeBrowserFailure(res, CORS, 'text too long (max 4000)', undefined, 'invalid_input', 400); return; }
  if (
    guardedNonSecret
    && (
      !hasOnlyAllowedBodyFields(body, GUARDED_TARGET_FILL_FIELDS)
      || hasGuardedFillLocatorOverride(body)
      || typeof body.text !== 'string'
      || body.submit !== false
      || body.credentialSemantics !== false
      || (body.timeoutMs != null && (
        typeof body.timeoutMs !== 'number'
        || !Number.isFinite(body.timeoutMs)
      ))
      || (body.taskContext != null && (
        typeof body.taskContext !== 'string'
        || body.taskContext.trim().length > 1_000
      ))
    )
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded browser fill accepts only one explicit target capability, bounded draft text, and non-submit/non-credential semantics',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  if (guardedNonSecret && body.submit === true) {
    writeBrowserFailure(
      res,
      CORS,
      'browser fill canary refuses submit semantics',
      undefined,
      'browser_fill_canary_blocked',
      400,
    );
    return;
  }
  if (guardedNonSecret && isCredentialFillSemantics(body)) {
    writeBrowserFailure(
      res,
      CORS,
      'browser fill canary refuses credential semantics',
      undefined,
      'browser_fill_canary_blocked',
      400,
    );
    return;
  }
  if (guardedNonSecret && isSecretBearingFillText(text)) {
    writeBrowserFailure(
      res,
      CORS,
      'browser fill canary refuses secret-bearing draft text',
      undefined,
      'browser_fill_canary_blocked',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const pageRef = launched.page;
    const gate = await guardHumanVerification(
      pageRef,
      guardedNonSecret
        ? [role, body.taskContext]
        : [role, body.name, body.selector, body.text],
    );
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    if (guardedNonSecret) {
      if (!isBoundedIdentity(body.targetId) || !isBoundedIdentity(body.targetFingerprint)) {
        writeBrowserFailure(
          res,
          CORS,
          'fresh observed browser target capability and fingerprint required',
          undefined,
          'browser_target_required',
          400,
        );
        return;
      }
      const consumed = guardedTargetCapabilities.consume(body.targetId);
      if (!consumed.ok) {
        writeBrowserFailure(
          res,
          CORS,
          `guarded browser target unavailable (${consumed.code})`,
          undefined,
          consumed.code,
          409,
        );
        return;
      }
      const targetRecord = consumed.record;
      const targetHandle = targetRecord.handle;
      try {
        if (
          targetRecord.capabilityKind !== 'guarded_fill_v2'
          || targetRecord.contextRef !== launched.context
          || targetRecord.pageRef !== pageRef
          || targetRecord.targetFingerprint !== body.targetFingerprint
          || targetRecord.browserContextId !== body.expectedBrowserContextId
          || targetRecord.pageId !== body.expectedPageId
          || targetRecord.url !== body.expectedUrl
        ) {
          const mismatchError = new Error('guarded browser target capability does not match the approved target');
          mismatchError.browserErrorCode = 'browser_target_mismatch';
          throw mismatchError;
        }
        const identityCheck = checkExpectedBrowserFillIdentity(
          browserIdentities,
          launched.context,
          pageRef,
          body,
          activePage(launched.context),
        );
        if (!identityCheck.ok) {
          const identityError = new Error('browser context, document, active page, or URL changed before fill');
          identityError.browserErrorCode = identityCheck.code;
          throw identityError;
        }
        let targetInspection;
        try {
          targetInspection = await inspectResolvedFillTarget(targetHandle);
        } catch {
          const detachedInspectionError = new Error('observed browser fill target detached before handler entry');
          detachedInspectionError.browserErrorCode = 'uncertain_ui_target';
          throw detachedInspectionError;
        }
        if (!targetInspection.allowed) {
          const credentialTargetError = new Error('observed browser fill target became credential-like or unverifiable');
          credentialTargetError.browserErrorCode = 'browser_fill_canary_blocked';
          throw credentialTargetError;
        }
        const handlerIdentity = observeBrowserPage(launched.context, pageRef);
        const handlerFingerprint = buildGuardedTargetFingerprint(
          handlerIdentity,
          targetInspection.descriptor,
        );
        if (!handlerIdentity || handlerFingerprint !== targetRecord.targetFingerprint) {
          const changedTargetError = new Error('observed browser fill target changed after approval');
          changedTargetError.browserErrorCode = 'browser_target_mismatch';
          throw changedTargetError;
        }
        // Verify-before-retry: a prior outcome-unknown attempt may already have
        // filled this exact field even if its response was lost. If the current
        // value already equals the approved draft, prove that state without
        // firing input/change handlers a second time.
        let currentValue;
        try {
          currentValue = await targetHandle.inputValue({ timeout });
        } catch {
          const detachedReadError = new Error('observed browser fill target detached before pre-mutation verification');
          detachedReadError.browserErrorCode = 'uncertain_ui_target';
          throw detachedReadError;
        }
        const mutationPerformed = currentValue !== text;
        if (mutationPerformed) {
          const dialogRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
            try {
              await targetHandle.fill(text, { timeout });
            } catch {
              const detachedFillError = new Error('observed browser fill target detached or became non-actionable');
              detachedFillError.browserErrorCode = 'uncertain_ui_target';
              throw detachedFillError;
            }
            return null;
          });
          if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
        }
        const coherentObservation = await captureCoherentGuardedFillObservation({
          registry: browserIdentities,
          contextRef: launched.context,
          pageRef,
          expectedIdentity: body,
          targetHandle,
          timeout,
          expectedTargetFingerprint: targetRecord.targetFingerprint,
          resolveActivePage: () => activePage(launched.context),
        });
        if (!coherentObservation.ok) {
          const observationError = new Error('browser fill completion observation drifted or became unsafe');
          observationError.browserErrorCode = coherentObservation.code;
          throw observationError;
        }
        const proof = buildRedactedBrowserFillProofFromObservation(
          coherentObservation,
          text,
          targetRecord.targetFingerprint,
          mutationPerformed,
        );
        if (!proof) {
          writeBrowserFailure(res, CORS, 'browser fill proof identity unavailable', undefined, 'browser_identity_mismatch');
          return;
        }
        if (!proof.valueMatches) {
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: false,
            error: 'browser field value did not match after fill',
            errorCode: 'browser_fill_verification_failed',
            recoveryHint: browserRecoveryHint('browser_fill_verification_failed'),
            requiredEvidence: browserRequiredEvidence('browser_fill_verification_failed'),
            ...proof,
          }));
          return;
        }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, ...proof }));
        return;
      } finally {
        try { await targetHandle.dispose(); } catch {}
      }
    }

    let locator = resolveLocator(pageRef, role, body);
    const ambiguity = await detectAmbiguousLocator(locator, body);
    if (ambiguity) { writeAmbiguousLocator(res, CORS, body, ambiguity); return; }
    if (typeof body.nth === 'number') locator = locator.nth(body.nth);

    const fillAtExactHandlerEntry = async (targetLocator) => {
      await targetLocator.fill(text, { timeout });
      return targetLocator;
    };

    try {
      const dialogRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
        return fillAtExactHandlerEntry(locator);
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    } catch (firstErr) {
      if (firstErr && firstErr.browserErrorCode) throw firstErr;
      // Same semantic-name fallback as click — when planner stuffed a
      // CSS selector into `name`, direct selector lookup might still
      // fail (e.g. shadow DOM or iframe). Retry with extracted name
      // through getByRole before giving up.
      const semantic = body.name && looksLikeCssSelector(body.name)
        ? extractSemanticName(body.name)
        : null;
      if (!semantic) throw firstErr;
      const opts = { name: semantic };
      if (body.exact === true) opts.exact = true;
      const fallback = locatorRoot(pageRef, body).getByRole(role, opts);
      const fb = typeof body.nth === 'number' ? fallback.nth(body.nth) : fallback;
      const dialogRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
        return fillAtExactHandlerEntry(fb);
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    }

    // Compatibility lane: existing SwanBot and the separately vault/origin-
    // gated credential tool keep their historical fill/optional-submit shape.
    if (body.submit) {
      const submitRun = await runWithBrowserDialogHandling(pageRef, body, async () => {
        await pageRef.keyboard.press('Enter');
        return null;
      });
      if (!submitRun.ok) { writeBrowserDialogBlocked(res, CORS, submitRun.blockedDecision); return; }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, chars: text.length, submitted: !!body.submit, frameSelector: body.frameSelector || null }));
  } catch (e) {
    if (guardedNonSecret) {
      const safeCode = (e && e.browserErrorCode) || classifyBrowserFailure(e);
      writeBrowserFailure(res, CORS, `guarded browser fill failed (${safeCode})`, 'fill failed', safeCode);
      return;
    }
    writeBrowserFailure(res, CORS, e, 'fill failed');
  }
}

async function handleObserveGuardedSelectTarget(body, res, CORS) {
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
  const matchBy = typeof body.matchBy === 'string' ? body.matchBy.trim().toLowerCase() : '';
  const value = typeof body.value === 'string' ? body.value : '';
  if (
    !hasOnlyAllowedBodyFields(body, GUARDED_SELECT_OBSERVE_FIELDS)
    || body.selectMode !== 'observe_guarded_native'
    || role !== 'combobox'
    || Number(Boolean(name)) + Number(Boolean(selector)) !== 1
    || name.length > 500
    || selector.length > 1_000
    || !GUARDED_SELECT_MATCH_BY.has(matchBy)
    || !value
    || value !== value.trim()
    || value.length > 240
    || body.exact !== true
    || body.submit !== false
    || body.credentialSemantics !== false
    || (body.timeoutMs != null && (
      typeof body.timeoutMs !== 'number'
      || !Number.isFinite(body.timeoutMs)
      || body.timeoutMs < 500
      || body.timeoutMs > 30_000
    ))
    || (body.taskContext != null && (
      typeof body.taskContext !== 'string'
      || !body.taskContext.trim()
      || body.taskContext.trim().length > 1_000
    ))
    || !isBoundedIdentity(body.expectedBrowserProcessId)
    || !isBoundedIdentity(body.expectedBrowserContextId)
    || !isBoundedIdentity(body.expectedPageId)
    || typeof body.expectedUrl !== 'string'
    || body.expectedUrl.length < 1
    || body.expectedUrl.length > 4_096
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded select observation requires one exact combobox locator, explicit value-or-label match, non-submit semantics, and fresh browser identity',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  if (hasUnsafeGuardedSelectRequest(body)) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded select is limited to clearly local presentation or accessibility preferences',
      undefined,
      'browser_select_canary_blocked',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) {
    writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503);
    return;
  }
  let targetHandle = null;
  try {
    const pageRef = launched.page;
    const gate = await guardHumanVerification(pageRef, [role, name, selector, value, body.taskContext]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const startingIdentityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!startingIdentityCheck.ok) {
      writeBrowserFailure(
        res,
        CORS,
        'fresh browser process, context, page, and URL identity required before select observation',
        undefined,
        startingIdentityCheck.code,
      );
      return;
    }
    const timeout = Number(body.timeoutMs) || 5_000;
    const locator = resolveLocator(pageRef, role, { ...body, name, selector, exact: true });
    let matchCount;
    try {
      matchCount = await locator.count();
    } catch {
      writeBrowserFailure(
        res,
        CORS,
        'guarded select target could not be counted reliably',
        undefined,
        'uncertain_ui_target',
      );
      return;
    }
    if (matchCount !== 1) {
      writeBrowserFailure(
        res,
        CORS,
        matchCount === 0
          ? 'guarded select target was not found'
          : 'guarded select target was ambiguous',
        undefined,
        matchCount === 0 ? 'selector_not_found' : 'uncertain_ui_target',
      );
      return;
    }
    targetHandle = await locator.elementHandle({ timeout });
    if (!targetHandle) {
      writeBrowserFailure(res, CORS, 'guarded select target was not found', undefined, 'uncertain_ui_target');
      return;
    }
    const inspection = await inspectResolvedSelectTarget(targetHandle, { matchBy, value });
    if (!inspection.allowed || !inspection.desiredOption) {
      writeBrowserFailure(
        res,
        CORS,
        'guarded select target must be one visible enabled native single-value select with one enabled exact option and no form or inline mutation handlers',
        undefined,
        'browser_select_canary_blocked',
        400,
      );
      return;
    }
    const identity = observeBrowserPage(launched.context, pageRef);
    const identityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (
      !identity
      || !identityCheck.ok
      || inspection.descriptor.documentUrl !== identity.url
    ) {
      writeBrowserFailure(
        res,
        CORS,
        'browser select target changed during observation',
        undefined,
        identityCheck.ok ? 'browser_identity_mismatch' : identityCheck.code,
      );
      return;
    }
    const invariantFingerprint = buildGuardedSelectInvariantFingerprint(
      identity,
      inspection.descriptor,
    );
    const optionFingerprint = buildGuardedSelectOptionFingerprint(
      identity,
      inspection.descriptor,
      inspection.desiredOption,
    );
    const currentOptionFingerprint = inspection.currentOption
      ? buildGuardedSelectOptionFingerprint(identity, inspection.descriptor, inspection.currentOption)
      : null;
    const targetFingerprint = buildGuardedSelectTargetFingerprint(
      identity,
      inspection.descriptor,
      inspection.currentOption,
      inspection.desiredOption,
      matchBy,
    );
    if (
      !isBoundedIdentity(invariantFingerprint)
      || !isBoundedIdentity(optionFingerprint)
      || !isBoundedIdentity(targetFingerprint)
      || (inspection.currentOption && !isBoundedIdentity(currentOptionFingerprint))
    ) {
      writeBrowserFailure(res, CORS, 'browser select fingerprint unavailable', undefined, 'uncertain_ui_target');
      return;
    }
    const issued = guardedTargetCapabilities.issue({
      capabilityKind: 'guarded_select_v1',
      handle: targetHandle,
      contextRef: launched.context,
      pageRef,
      browserProcessId: identity.browserProcessId,
      browserContextId: identity.browserContextId,
      pageId: identity.pageId,
      url: identity.url,
      matchBy,
      desiredValue: value,
      taskContext: String(body.taskContext || ''),
      initialOptionFingerprint: currentOptionFingerprint,
      optionFingerprint,
      targetFingerprint,
      invariantFingerprint,
    });
    if (!issued.ok) {
      writeBrowserFailure(res, CORS, 'browser select capability capacity reached', undefined, issued.code);
      return;
    }
    targetHandle = null; // ownership transferred to the single-use capability store
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...identity,
      targetId: issued.targetId,
      targetFingerprint,
      optionFingerprint,
      targetExpiresAt: issued.targetExpiresAt,
      matchBy,
      currentOptionFingerprint,
      selectionMatches: currentOptionFingerprint === optionFingerprint,
    }));
  } catch {
    writeBrowserFailure(
      res,
      CORS,
      'guarded browser select observation failed',
      'guarded browser select observation failed',
      'uncertain_ui_target',
    );
  } finally {
    if (targetHandle) {
      try { await targetHandle.dispose(); } catch {}
    }
  }
}

async function handleGuardedSelectMutation(body, res, CORS) {
  const matchBy = typeof body.matchBy === 'string' ? body.matchBy.trim().toLowerCase() : '';
  if (
    !hasOnlyAllowedBodyFields(body, GUARDED_SELECT_MUTATION_FIELDS)
    || body.selectMode !== 'guarded_native_single'
    || !isBoundedIdentity(body.targetId)
    || !isBoundedIdentity(body.targetFingerprint)
    || !isBoundedIdentity(body.optionFingerprint)
    || !GUARDED_SELECT_MATCH_BY.has(matchBy)
    || body.submit !== false
    || body.credentialSemantics !== false
    || (body.timeoutMs != null && (
      typeof body.timeoutMs !== 'number'
      || !Number.isFinite(body.timeoutMs)
      || body.timeoutMs < 500
      || body.timeoutMs > 30_000
    ))
    || (body.taskContext != null && (
      typeof body.taskContext !== 'string'
      || !body.taskContext.trim()
      || body.taskContext.trim().length > 1_000
    ))
    || !isBoundedIdentity(body.expectedBrowserProcessId)
    || !isBoundedIdentity(body.expectedBrowserContextId)
    || !isBoundedIdentity(body.expectedPageId)
    || typeof body.expectedUrl !== 'string'
    || body.expectedUrl.length < 1
    || body.expectedUrl.length > 4_096
  ) {
    writeBrowserFailure(
      res,
      CORS,
      'guarded select mutation requires one observed target and option capability with exact prior browser identity',
      undefined,
      'invalid_input',
      400,
    );
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) {
    writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503);
    return;
  }
  const pageRef = launched.page;
  const gate = await guardHumanVerification(pageRef, [body.taskContext]);
  if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
  const timeout = Number(body.timeoutMs) || 5_000;
  const consumed = guardedTargetCapabilities.consume(body.targetId);
  if (!consumed.ok) {
    writeBrowserFailure(
      res,
      CORS,
      `guarded browser select target unavailable (${consumed.code})`,
      undefined,
      consumed.code,
      409,
    );
    return;
  }
  const targetRecord = consumed.record;
  const targetHandle = targetRecord.handle;
  try {
    const capabilityCheck = checkGuardedSelectCapabilityRecord(
      targetRecord,
      { ...body, matchBy },
      launched.context,
      pageRef,
    );
    if (!capabilityCheck.ok) {
      const capabilityError = new Error('guarded select capability does not match the approved target and option');
      capabilityError.browserErrorCode = capabilityCheck.code;
      throw capabilityError;
    }
    const identityCheck = checkExpectedBrowserToggleIdentity(
      browserIdentities,
      launched.context,
      pageRef,
      body,
      activePage(launched.context),
    );
    if (!identityCheck.ok) {
      const identityError = new Error('browser identity changed before guarded select mutation');
      identityError.browserErrorCode = identityCheck.code;
      throw identityError;
    }
    let targetInspection;
    try {
      targetInspection = await inspectResolvedSelectTarget(targetHandle, {
        matchBy: targetRecord.matchBy,
        value: targetRecord.desiredValue,
      });
    } catch {
      const detachedError = new Error('observed select target detached before handler entry');
      detachedError.browserErrorCode = 'uncertain_ui_target';
      throw detachedError;
    }
    if (!targetInspection.allowed || !targetInspection.desiredOption) {
      const unsafeError = new Error('observed select target became unsafe or stopped matching one enabled option');
      unsafeError.browserErrorCode = 'browser_select_canary_blocked';
      throw unsafeError;
    }
    const handlerIdentity = observeBrowserPage(launched.context, pageRef);
    const handlerInvariantFingerprint = buildGuardedSelectInvariantFingerprint(
      handlerIdentity,
      targetInspection.descriptor,
    );
    const handlerOptionFingerprint = buildGuardedSelectOptionFingerprint(
      handlerIdentity,
      targetInspection.descriptor,
      targetInspection.desiredOption,
    );
    const previousOptionFingerprint = targetInspection.currentOption
      ? buildGuardedSelectOptionFingerprint(
        handlerIdentity,
        targetInspection.descriptor,
        targetInspection.currentOption,
      )
      : null;
    const handlerTargetFingerprint = buildGuardedSelectTargetFingerprint(
      handlerIdentity,
      targetInspection.descriptor,
      targetInspection.currentOption,
      targetInspection.desiredOption,
      targetRecord.matchBy,
    );
    if (
      !handlerIdentity
      || handlerInvariantFingerprint !== targetRecord.invariantFingerprint
      || handlerOptionFingerprint !== targetRecord.optionFingerprint
      || previousOptionFingerprint !== targetRecord.initialOptionFingerprint
      || handlerTargetFingerprint !== targetRecord.targetFingerprint
    ) {
      const driftError = new Error('observed select target or option changed after observation');
      driftError.browserErrorCode = 'browser_target_mismatch';
      throw driftError;
    }
    const mutationPerformed = previousOptionFingerprint !== targetRecord.optionFingerprint;
    if (mutationPerformed) {
      try {
        const optionSpec = targetRecord.matchBy === 'value'
          ? { value: targetRecord.desiredValue }
          : { label: targetRecord.desiredValue };
        await targetHandle.selectOption(optionSpec, { timeout });
      } catch {
        const selectError = new Error('observed select target detached or became non-actionable');
        selectError.browserErrorCode = 'uncertain_ui_target';
        throw selectError;
      }
    }
    const coherentObservation = await captureCoherentGuardedSelectObservation({
      registry: browserIdentities,
      contextRef: launched.context,
      pageRef,
      expectedIdentity: body,
      targetHandle,
      matchBy: targetRecord.matchBy,
      desiredValue: targetRecord.desiredValue,
      expectedInvariantFingerprint: targetRecord.invariantFingerprint,
      expectedOptionFingerprint: targetRecord.optionFingerprint,
      resolveActivePage: () => activePage(launched.context),
    });
    if (!coherentObservation.ok) {
      const observationError = new Error('browser select completion observation drifted or became unsafe');
      observationError.browserErrorCode = coherentObservation.code;
      throw observationError;
    }
    const proof = buildRedactedBrowserSelectProof(
      coherentObservation,
      previousOptionFingerprint,
      targetRecord.targetFingerprint,
      mutationPerformed,
    );
    if (!proof) {
      writeBrowserFailure(res, CORS, 'browser select proof unavailable', undefined, 'browser_identity_mismatch');
      return;
    }
    if (!proof.selectionMatches) {
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: false,
        error: 'browser select did not reach the approved option',
        errorCode: 'browser_select_verification_failed',
        recoveryHint: browserRecoveryHint('browser_select_verification_failed'),
        requiredEvidence: browserRequiredEvidence('browser_select_verification_failed'),
        ...proof,
      }));
      return;
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...proof }));
  } catch (error) {
    const safeCode = error && error.browserErrorCode
      ? error.browserErrorCode
      : classifyBrowserFailure(error);
    writeBrowserFailure(
      res,
      CORS,
      `guarded browser select failed (${safeCode})`,
      'select failed',
      safeCode,
    );
  } finally {
    try { await targetHandle.dispose(); } catch {}
  }
}

async function handleSelect(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) {
    res.writeHead(400, CORS);
    res.end(JSON.stringify({ ok: false, error: err }));
    return;
  }
  if (body && body.selectMode === 'observe_guarded_native') {
    await handleObserveGuardedSelectTarget(body, res, CORS);
    return;
  }
  if (body && body.selectMode === 'guarded_native_single') {
    await handleGuardedSelectMutation(body, res, CORS);
    return;
  }
  writeBrowserFailure(
    res,
    CORS,
    'browser select is available only through the sealed observe-approve-mutate native-select lane',
    undefined,
    'browser_select_canary_blocked',
    400,
  );
}

function expandUploadPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateBrowserUploadFile(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return { ok: false, error: 'filePath required' };
  if (rawPath.length > 1024 || /[\x00-\x1f]/.test(rawPath)) return { ok: false, error: 'invalid filePath' };
  const filePath = expandUploadPath(rawPath);
  if (!isPathInside(filePath, os.homedir())) return { ok: false, error: 'filePath must stay under the user home folder' };
  let stat = null;
  try { stat = fs.statSync(filePath); } catch {
    return { ok: false, error: `file not found: ${filePath}` };
  }
  if (!stat.isFile()) return { ok: false, error: `filePath is not a file: ${filePath}` };
  if (stat.size > 250 * 1024 * 1024) return { ok: false, error: 'file too large for browser upload endpoint (max 250MB)' };
  return { ok: true, filePath, size: stat.size };
}

async function handleUploadFile(req, res, CORS) {
  const { body, err } = await readJsonBody(req, 16 * 1024);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const validated = validateBrowserUploadFile(body.filePath);
  if (!validated.ok) { writeBrowserFailure(res, CORS, validated.error, undefined, classifyBrowserFailure(validated.error), 400); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [body.name, body.selector, body.buttonName, body.buttonSelector]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 10000));
    let method = '';

    if (body.buttonSelector || body.buttonName || body.buttonRole) {
      const buttonRole = String(body.buttonRole || 'button').trim() || 'button';
      const buttonLocator = resolveLocator(launched.page, buttonRole, {
        selector: body.buttonSelector,
        name: body.buttonName,
        exact: body.exact,
      });
      const chooserPromise = launched.page.waitForEvent('filechooser', { timeout });
      const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await buttonLocator.click({ timeout });
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
      const chooser = await chooserPromise;
      await chooser.setFiles(validated.filePath);
      method = 'filechooser';
    } else {
      const candidates = [];
      if (body.selector || (body.name && looksLikeCssSelector(body.name))) {
        candidates.push(resolveLocator(launched.page, 'textbox', body));
      }
      if (body.name && !looksLikeCssSelector(body.name)) {
        candidates.push(launched.page.getByLabel(String(body.name), { exact: body.exact === true }));
        candidates.push(launched.page.locator(`input[type="file"][name="${String(body.name).replace(/"/g, '\\"')}"]`));
        candidates.push(launched.page.locator(`input[type="file"][aria-label="${String(body.name).replace(/"/g, '\\"')}"]`));
      }
      candidates.push(launched.page.locator('input[type="file"]').first());
      let lastErr = null;
      for (const locator of candidates) {
        try {
          const inputRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
            await locator.setInputFiles(validated.filePath, { timeout });
            return null;
          });
          if (!inputRun.ok) { writeBrowserDialogBlocked(res, CORS, inputRun.blockedDecision); return; }
          method = 'input';
          lastErr = null;
          break;
        } catch (candidateErr) {
          lastErr = candidateErr;
        }
      }
      if (lastErr) throw lastErr;
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      filePath: validated.filePath,
      fileName: path.basename(validated.filePath),
      sizeBytes: validated.size,
      method,
    }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'upload failed');
  }
}

async function handlePress(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const combo = String(body.combo || '').trim();
  if (!combo) { writeBrowserFailure(res, CORS, 'combo required', undefined, 'invalid_input', 400); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [body.combo]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    // Playwright accepts combos like "Control+A", "Shift+Tab", "Enter".
    const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
      await launched.page.keyboard.press(combo);
      return null;
    });
    if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, combo }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'press failed');
  }
}

async function handleScreenshot(req, res, CORS) {
  const { body } = await readJsonBody(req);
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const pageRef = launched.page;
    const buf = await pageRef.screenshot({ fullPage: !!body.fullPage, type: 'png' });
    const base64 = buf.toString('base64');
    const identity = observeBrowserPage(launched.context, pageRef);
    if (!identity) { writeBrowserFailure(res, CORS, 'browser page identity unavailable', undefined, 'browser_identity_mismatch'); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...identity, mimeType: 'image/png', sizeBytes: buf.length, base64 }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'screenshot failed');
  }
}

// ─── Lane-A primitives: multi-tab, downloads, waits, wheel scroll ─────────
//
// These mirror the pure shapes in src/lib/browserPrimitives.ts. That TS
// module can't be `require`d from this plain-JS bridge, so the normalizers
// are duplicated here — keep the two in sync (tab-list dedupe, download
// proof, semantic wait, and semantic scroll normalization).

const MAX_TRACKED_TABS = 50;

const BROWSER_SEMANTIC_WAIT_CONDITIONS = new Set([
  'page_loaded',
  'dom_ready',
  'network_idle',
  'element_visible',
  'element_hidden',
  'delay',
]);
const BROWSER_SEMANTIC_SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const BROWSER_SEMANTIC_SCROLL_AMOUNTS = new Set(['small', 'medium', 'large']);
const BROWSER_SEMANTIC_SCROLL_PIXELS = { small: 300, medium: 600, large: 1200 };

function isPlainBridgePrimitiveObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function bridgePrimitiveHasOnlyFields(value, allowed) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function normalizeBridgeBoundedTimeout(value, fallback, min, max) {
  if (value == null) return { ok: true, value: fallback };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return { ok: false, error: `timeoutMs must be an integer from ${min} to ${max}` };
  }
  return { ok: true, value };
}

function normalizeBridgeSemanticPageIdentity(input) {
  const expectedBrowserProcessId = input && input.expectedBrowserProcessId;
  const expectedBrowserContextId = input && input.expectedBrowserContextId;
  const expectedPageId = input && input.expectedPageId;
  const expectedUrl = input && input.expectedUrl;
  if (
    !isBoundedIdentity(expectedBrowserProcessId)
    || !isBoundedIdentity(expectedBrowserContextId)
    || !isBoundedIdentity(expectedPageId)
    || !isBrowserUrlIdentity(expectedUrl)
  ) {
    return {
      ok: false,
      error: 'a complete opaque browser process, context, page, and URL identity is required',
    };
  }
  return {
    ok: true,
    value: {
      expectedBrowserProcessId,
      expectedBrowserContextId,
      expectedPageId,
      expectedUrl,
    },
  };
}

// Mirrors normalizeBrowserSemanticWait in src/lib/browserPrimitives.ts.
// This is intentionally stricter than the legacy selector/state parser: the
// public route accepts only named lifecycle states or an exact role/name pair.
function normalizeBridgeSemanticWait(input) {
  const allowed = new Set([
    'condition',
    'role',
    'name',
    'exact',
    'timeoutMs',
    'expectedBrowserProcessId',
    'expectedBrowserContextId',
    'expectedPageId',
    'expectedUrl',
  ]);
  if (!isPlainBridgePrimitiveObject(input) || !bridgePrimitiveHasOnlyFields(input, allowed)) {
    return { ok: false, error: 'wait request must contain only semantic wait fields' };
  }
  const identity = normalizeBridgeSemanticPageIdentity(input);
  if (!identity.ok) return identity;
  const condition = typeof input.condition === 'string' ? input.condition.trim().toLowerCase() : '';
  if (!BROWSER_SEMANTIC_WAIT_CONDITIONS.has(condition)) {
    return { ok: false, error: 'condition must be a supported semantic wait condition' };
  }
  if (condition === 'delay') {
    if ('role' in input || 'name' in input || 'exact' in input || input.timeoutMs == null) {
      return { ok: false, error: 'delay waits require only an explicit timeoutMs' };
    }
    const timeout = normalizeBridgeBoundedTimeout(input.timeoutMs, 1000, 0, 30000);
    return timeout.ok
      ? {
          ok: true,
          value: {
            ...identity.value,
            mode: 'delay',
            condition,
            timeoutMs: timeout.value,
          },
        }
      : timeout;
  }
  const elementCondition = condition === 'element_visible' || condition === 'element_hidden';
  if (elementCondition) {
    const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!role || role.length > 100 || !name || name.length > 500) {
      return { ok: false, error: 'element waits require a bounded ARIA role and accessible name' };
    }
    if (input.exact !== undefined && input.exact !== true) {
      return { ok: false, error: 'semantic element waits must use exact matching' };
    }
    const timeout = normalizeBridgeBoundedTimeout(input.timeoutMs, 15000, 100, 60000);
    if (!timeout.ok) return timeout;
    return {
      ok: true,
      value: {
        ...identity.value,
        mode: 'element',
        condition,
        role,
        name,
        exact: true,
        state: condition === 'element_visible' ? 'visible' : 'hidden',
        timeoutMs: timeout.value,
      },
    };
  }
  if ('role' in input || 'name' in input || 'exact' in input) {
    return { ok: false, error: 'page lifecycle waits do not accept an element target' };
  }
  const timeout = normalizeBridgeBoundedTimeout(input.timeoutMs, 15000, 100, 60000);
  if (!timeout.ok) return timeout;
  const stateByCondition = {
    page_loaded: 'load',
    dom_ready: 'domcontentloaded',
    network_idle: 'networkidle',
  };
  return {
    ok: true,
    value: {
      ...identity.value,
      mode: 'state',
      condition,
      state: stateByCondition[condition],
      timeoutMs: timeout.value,
    },
  };
}

// Mirrors normalizeBrowserSemanticScroll in src/lib/browserPrimitives.ts.
function normalizeBridgeSemanticScroll(input) {
  const allowed = new Set([
    'direction',
    'amount',
    'expectedBrowserProcessId',
    'expectedBrowserContextId',
    'expectedPageId',
    'expectedUrl',
  ]);
  if (!isPlainBridgePrimitiveObject(input) || !bridgePrimitiveHasOnlyFields(input, allowed)) {
    return { ok: false, error: 'scroll request must contain only direction, amount, and exact page identity' };
  }
  const identity = normalizeBridgeSemanticPageIdentity(input);
  if (!identity.ok) return identity;
  const direction = typeof input.direction === 'string' ? input.direction.trim().toLowerCase() : '';
  const amount = input.amount == null
    ? 'medium'
    : typeof input.amount === 'string'
      ? input.amount.trim().toLowerCase()
      : '';
  if (!BROWSER_SEMANTIC_SCROLL_DIRECTIONS.has(direction)) {
    return { ok: false, error: 'direction must be up, down, left, or right' };
  }
  if (!BROWSER_SEMANTIC_SCROLL_AMOUNTS.has(amount)) {
    return { ok: false, error: 'amount must be small, medium, or large' };
  }
  const pixels = BROWSER_SEMANTIC_SCROLL_PIXELS[amount];
  return {
    ok: true,
    value: {
      ...identity.value,
      direction,
      amount,
      dx: direction === 'left' ? -pixels : direction === 'right' ? pixels : 0,
      dy: direction === 'up' ? -pixels : direction === 'down' ? pixels : 0,
    },
  };
}

// tabs_list — enumerate every tab in the persistent context with a stable
// 0-based index, marking the active one. Titles/urls are page-derived
// UNTRUSTED text; the client sanitizes before showing them to the model.
async function handleTabsList(_req, res, CORS) {
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const active = activePage(launched.context);
    const pages = launched.context.pages().slice(0, MAX_TRACKED_TABS);
    const tabs = [];
    for (let i = 0; i < pages.length; i += 1) {
      const pg = pages[i];
      let url = '';
      let title = '';
      try { url = pg.url(); } catch {}
      try { title = await pg.title(); } catch {}
      tabs.push({ index: i, url, title, pageId: browserIdentities.pageIdFor(pg), active: pg === active });
    }
    // Fail-closed to exactly one active tab even if none matched (e.g. the
    // active page was just closed): default the last one.
    if (tabs.length > 0 && !tabs.some((t) => t.active)) tabs[tabs.length - 1].active = true;
    const identity = active ? observeBrowserPage(launched.context, active) : null;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...(identity || browserIdentities.observeProcess('')),
      tabs,
      count: tabs.length,
    }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'tabs list failed');
  }
}

// tab_switch — bring a tab to the foreground by index and make it the
// active page for subsequent single-page commands.
async function handleTabSwitch(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const pages = launched.context.pages();
    const idx = Number(body.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
      writeBrowserFailure(res, CORS, `tab index ${body.index} out of range (0..${Math.max(0, pages.length - 1)})`, undefined, 'invalid_input', 400);
      return;
    }
    const target = pages[idx];
    await target.bringToFront();
    page = target;
    let url = '';
    let title = '';
    try { url = target.url(); } catch {}
    try { title = await target.title(); } catch {}
    const identity = observeBrowserPage(launched.context, target);
    if (!identity) { writeBrowserFailure(res, CORS, 'browser page identity unavailable', undefined, 'browser_identity_mismatch'); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, index: idx, url, title, ...identity, active: true }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'tab switch failed');
  }
}

// tab_close — close a tab by index. Refuses to close the last remaining
// tab (the context needs at least one page to stay useful).
async function handleTabClose(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const pages = launched.context.pages();
    const idx = Number(body.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
      writeBrowserFailure(res, CORS, `tab index ${body.index} out of range (0..${Math.max(0, pages.length - 1)})`, undefined, 'invalid_input', 400);
      return;
    }
    if (pages.length <= 1) {
      writeBrowserFailure(res, CORS, 'cannot close the last remaining tab', undefined, 'invalid_input', 400);
      return;
    }
    const target = pages[idx];
    await target.close();
    // Point the active page at the last live tab so later commands work.
    const remaining = launched.context.pages();
    page = remaining[remaining.length - 1] || null;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, closed: idx, remaining: remaining.length }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'tab close failed');
  }
}

function ensureDownloadsDir() {
  try { fs.mkdirSync(DOWNLOADS_DIR, { recursive: true }); } catch {}
}

// Build compact, home-path-safe download proof (mirror of
// buildDownloadProof in browserPrimitives.ts). basename + human size +
// a two-segment path tail — never the full home path.
function buildBridgeDownloadProof({ filePath, sizeBytes, suggestedFilename }) {
  const basename = filePath ? path.basename(filePath) : (suggestedFilename || 'download');
  const size = Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > 0 ? Math.round(Number(sizeBytes)) : 0;
  const humanSize = formatBridgeByteSize(size);
  const parts = String(filePath || '').split(path.sep).filter(Boolean);
  const pathTail = parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : parts.join('/');
  const proof = {
    basename,
    sizeBytes: size,
    humanSize,
    pathTail,
    summary: `Downloaded "${basename}" (${humanSize})${pathTail ? ` → ${pathTail}` : ''}`,
  };
  if (suggestedFilename && suggestedFilename !== basename) proof.suggestedFilename = suggestedFilename;
  return proof;
}

function formatBridgeByteSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// download — arm a download listener, run the caller-provided trigger
// (click by role/name/selector), then save the resulting download to our
// scoped downloads dir. The proof is a REAL on-disk file + byte size — the
// backend-aware evidence for "download the invoice" tasks, not a
// screenshot. Mirrors the upload handler's filechooser structure.
async function handleDownload(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [body.name, body.selector, body.role]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(1000, Math.min(120000, Number(body.timeoutMs) || 30000));
    ensureDownloadsDir();

    // Arm the download listener BEFORE the trigger so we never miss a fast
    // download (same ordering as the filechooser upload flow).
    const downloadPromise = launched.page.waitForEvent('download', { timeout });

    // The trigger is optional: some flows navigate directly to a file URL
    // (which Chrome turns into a download) via a prior open_url. When a
    // click target is given, use the same locator resolution as click_role.
    if (body.selector || body.name || body.role) {
      const role = String(body.role || 'link').trim() || 'link';
      let locator = resolveLocator(launched.page, role, body);
      if (typeof body.nth === 'number') locator = locator.nth(body.nth);
      const clickRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await locator.click({ timeout });
        return null;
      });
      if (!clickRun.ok) { writeBrowserDialogBlocked(res, CORS, clickRun.blockedDecision); return; }
    }

    const download = await downloadPromise;
    const suggested = String(download.suggestedFilename() || 'download').replace(/[\\/]/g, '_').slice(0, 200) || 'download';
    const savePath = path.join(DOWNLOADS_DIR, `${Date.now()}-${suggested}`);
    await download.saveAs(savePath);

    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(savePath).size; } catch {}

    const proof = buildBridgeDownloadProof({ filePath: savePath, sizeBytes, suggestedFilename: suggested });
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      path: savePath,
      basename: proof.basename,
      sizeBytes,
      suggestedFilename: suggested,
      proof,
    }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'download failed');
  }
}

// wait_for — strict semantic synchronization. The public route accepts a
// named lifecycle condition, an exact ARIA role/name element condition, or an
// explicit bounded delay. It never accepts/echoes selectors, URLs, titles, or
// page status. Every request is bound to one existing opaque process/context/
// page/URL identity and fails closed if that identity changes before or during
// the wait. It never launches or adopts a different current tab.
async function handleWaitFor(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const normalized = normalizeBridgeSemanticWait(body);
  if (!normalized.ok) {
    writeBrowserFailure(res, CORS, normalized.error, undefined, 'invalid_input', 400);
    return;
  }
  const spec = normalized.value;
  if (browserIdentities.browserProcessId !== spec.expectedBrowserProcessId) {
    writeBrowserFailure(res, CORS, 'browser process identity changed before wait', undefined, 'browser_identity_mismatch');
    return;
  }
  const contextRef = context;
  let pageRef = null;
  try { pageRef = contextRef ? activePage(contextRef) : null; } catch {}
  if (!contextRef || !pageRef) {
    writeBrowserFailure(res, CORS, 'observed browser page is no longer available', undefined, 'browser_identity_mismatch');
    return;
  }
  const entryIdentity = checkExpectedBrowserSemanticPageIdentity(
    browserIdentities,
    contextRef,
    pageRef,
    spec,
    pageRef,
  );
  if (!entryIdentity.ok) {
    writeBrowserFailure(res, CORS, 'browser page identity changed before wait', undefined, entryIdentity.code);
    return;
  }
  let operationError = null;
  try {
    if (spec.mode === 'element') {
      // This lane is semantic-only. Do not call the compatibility resolver:
      // it deliberately interprets CSS-looking `name` values for older
      // mutation callers, which would turn an accessible name such as
      // "#save" into selector authority. The exact ARIA role/name pair from
      // the normalized request is the only locator contract here.
      const locator = pageRef.getByRole(spec.role, {
        name: spec.name,
        exact: true,
      });
      await locator.waitFor({ state: spec.state, timeout: spec.timeoutMs });
    } else if (spec.mode === 'state') {
      await pageRef.waitForLoadState(spec.state, { timeout: spec.timeoutMs });
    } else {
      await pageRef.waitForTimeout(spec.timeoutMs);
    }
  } catch (e) {
    operationError = e;
  }
  let activeAfter = null;
  try { activeAfter = activePage(contextRef); } catch {}
  const afterProof = captureBrowserSemanticPageIdentityReceipt(
    browserIdentities,
    contextRef,
    pageRef,
    spec,
    activeAfter,
  );
  if (!afterProof.ok) {
    writeBrowserFailure(res, CORS, 'browser page identity changed during wait', undefined, afterProof.code);
    return;
  }
  if (operationError) {
    const errorCode = spec.mode === 'element' ? 'selector_not_found' : 'timeout';
    const safeError = spec.mode === 'element'
      ? 'Browser element wait did not reach the requested condition.'
      : 'Browser page wait did not reach the requested condition.';
    writeBrowserFailure(res, CORS, safeError, undefined, errorCode);
    return;
  }
  try {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...afterProof.receipt,
      condition: spec.condition,
      timeoutMs: spec.timeoutMs,
      completed: true,
    }));
  } catch {
    writeBrowserFailure(res, CORS, 'Browser wait receipt could not be returned.', undefined, 'unknown');
  }
}

// Capture only numeric viewport-scroll state inside the bridge. These values
// are used to verify the requested-axis movement and are never returned to the
// caller, keeping the public receipt privacy-bounded.
function normalizeBrowserViewportScrollPosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = value.x;
  const y = value.y;
  const maxX = value.maxX;
  const maxY = value.maxY;
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
    || x < 0
    || y < 0
    || maxX < 0
    || maxY < 0
    || x > 1_000_000_000
    || y > 1_000_000_000
    || maxX > 1_000_000_000
    || maxY > 1_000_000_000
  ) return null;
  return { x, y, maxX, maxY };
}

async function captureBrowserViewportScrollPosition(pageRef) {
  const value = await pageRef.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const x = Number.isFinite(window.scrollX) ? window.scrollX : Number(root?.scrollLeft || 0);
    const y = Number.isFinite(window.scrollY) ? window.scrollY : Number(root?.scrollTop || 0);
    const scrollWidth = Math.max(
      Number(root?.scrollWidth || 0),
      Number(document.documentElement?.scrollWidth || 0),
      Number(document.body?.scrollWidth || 0),
    );
    const scrollHeight = Math.max(
      Number(root?.scrollHeight || 0),
      Number(document.documentElement?.scrollHeight || 0),
      Number(document.body?.scrollHeight || 0),
    );
    return {
      x,
      y,
      maxX: Math.max(0, scrollWidth - Number(window.innerWidth || 0)),
      maxY: Math.max(0, scrollHeight - Number(window.innerHeight || 0)),
    };
  });
  return normalizeBrowserViewportScrollPosition(value);
}

const BROWSER_SCROLL_VERIFICATION_MAX_SAMPLES = 3;
const BROWSER_SCROLL_VERIFICATION_SETTLE_MS = Object.freeze([40, 80, 160]);

function browserSemanticScrollMovementVerified(direction, before, after) {
  const start = normalizeBrowserViewportScrollPosition(before);
  const finish = normalizeBrowserViewportScrollPosition(after);
  if (!start || !finish) return false;
  const epsilon = 0.5;
  switch (direction) {
    case 'up': return finish.y < start.y - epsilon;
    case 'down': return finish.y > start.y + epsilon;
    case 'left': return finish.x < start.x - epsilon;
    case 'right': return finish.x > start.x + epsilon;
    default: return false;
  }
}

/**
 * Dispatch exactly one bounded gesture, then prove that the requested viewport
 * axis moved. The read-only verification poll tolerates a short smooth-scroll
 * settle without ever replaying the gesture.
 */
async function performVerifiedBrowserSemanticScroll(pageRef, spec, beforeDispatchGuard) {
  let before = null;
  try {
    before = await captureBrowserViewportScrollPosition(pageRef);
  } catch {}
  if (!before) {
    return {
      ok: false,
      error: 'Browser viewport position could not be observed before scroll.',
      errorCode: 'browser_scroll_verification_failed',
    };
  }

  if (typeof beforeDispatchGuard === 'function') {
    let guard = null;
    try { guard = await beforeDispatchGuard(); } catch {}
    if (!guard || guard.ok !== true) {
      return {
        ok: false,
        error: 'Browser page identity changed before scroll dispatch.',
        errorCode: guard?.code || 'browser_identity_mismatch',
      };
    }
  }

  try {
    await pageRef.mouse.wheel(spec.dx, spec.dy);
  } catch {
    return {
      ok: false,
      error: 'Browser scroll gesture could not be dispatched.',
      errorCode: 'unknown',
    };
  }

  // One gesture only. Polling below is observation, never mutation/replay.
  for (const settleMs of BROWSER_SCROLL_VERIFICATION_SETTLE_MS.slice(
    0,
    BROWSER_SCROLL_VERIFICATION_MAX_SAMPLES,
  )) {
    try { await pageRef.waitForTimeout(settleMs); } catch {}
    let after = null;
    try { after = await captureBrowserViewportScrollPosition(pageRef); } catch {}
    if (browserSemanticScrollMovementVerified(spec.direction, before, after)) {
      return { ok: true, movementVerified: true };
    }
  }
  return {
    ok: false,
    error: 'Browser viewport did not move in the requested direction.',
    errorCode: 'browser_scroll_verification_failed',
  };
}

// scroll — one coarse semantic wheel gesture. Direction + amount become a
// bounded internal delta; neither raw coordinates nor page data are returned.
// The gesture is executed only against the exact already-observed document and
// succeeds only when requested-axis viewport movement is observed afterward.
async function handleScroll(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const normalized = normalizeBridgeSemanticScroll(body);
  if (!normalized.ok) {
    writeBrowserFailure(res, CORS, normalized.error, undefined, 'invalid_input', 400);
    return;
  }
  const spec = normalized.value;
  if (browserIdentities.browserProcessId !== spec.expectedBrowserProcessId) {
    writeBrowserFailure(res, CORS, 'browser process identity changed before scroll', undefined, 'browser_identity_mismatch');
    return;
  }
  const contextRef = context;
  let pageRef = null;
  try { pageRef = contextRef ? activePage(contextRef) : null; } catch {}
  if (!contextRef || !pageRef) {
    writeBrowserFailure(res, CORS, 'observed browser page is no longer available', undefined, 'browser_identity_mismatch');
    return;
  }
  const entryIdentity = checkExpectedBrowserSemanticPageIdentity(
    browserIdentities,
    contextRef,
    pageRef,
    spec,
    pageRef,
  );
  if (!entryIdentity.ok) {
    writeBrowserFailure(res, CORS, 'browser page identity changed before scroll', undefined, entryIdentity.code);
    return;
  }
  const scrollProof = await performVerifiedBrowserSemanticScroll(
    pageRef,
    spec,
    () => checkExpectedBrowserSemanticPageIdentity(
      browserIdentities,
      contextRef,
      pageRef,
      spec,
      pageRef,
    ),
  );
  let activeAfter = null;
  try { activeAfter = activePage(contextRef); } catch {}
  const afterProof = captureBrowserSemanticPageIdentityReceipt(
    browserIdentities,
    contextRef,
    pageRef,
    spec,
    activeAfter,
  );
  if (!afterProof.ok) {
    writeBrowserFailure(res, CORS, 'browser page identity changed during scroll', undefined, afterProof.code);
    return;
  }
  if (!scrollProof.ok || scrollProof.movementVerified !== true) {
    writeBrowserFailure(
      res,
      CORS,
      scrollProof.error || 'Browser viewport movement could not be verified.',
      undefined,
      scrollProof.errorCode || 'browser_scroll_verification_failed',
    );
    return;
  }
  try {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      ...afterProof.receipt,
      direction: spec.direction,
      amount: spec.amount,
      movementVerified: true,
      completed: true,
    }));
  } catch {
    writeBrowserFailure(res, CORS, 'Browser scroll receipt could not be returned.', undefined, 'unknown');
  }
}

async function handleClose(_req, res, CORS) {
  if (context) {
    const closingContext = context;
    const closingPages = closingContext.pages();
    guardedTargetCapabilities.revokeWhere((record) => record.contextRef === closingContext);
    try { await closingContext.close(); } catch {}
    for (const closingPage of closingPages) browserIdentities.retirePage(closingPage);
    browserIdentities.retireContext(closingContext);
  }
  context = null;
  page = null;
  launchError = null;
  res.writeHead(200, CORS);
  res.end(JSON.stringify({ ok: true, closed: true }));
}

async function shutdownOnExit() {
  if (context) {
    try { await context.close(); } catch {}
  }
}
process.on('exit', () => { /* can't await here — best-effort */ });
process.on('SIGINT', async () => { await shutdownOnExit(); process.exit(0); });
process.on('SIGTERM', async () => { await shutdownOnExit(); process.exit(0); });

module.exports = {
  handleHealth,
  handleOpenUrl,
  handleDomSnapshot,
  handlePageSource,
  handleVerificationState,
  handleLocatorActionability,
  handleClickRole,
  handleObserveGuardedFillTarget,
  handleFill,
  handleObserveGuardedToggleTarget,
  handleSetToggle,
  handleSelect,
  handleUploadFile,
  handlePress,
  handleScreenshot,
  // Lane-A browser primitives (multi-tab / download / wait / wheel scroll).
  handleTabsList,
  handleTabSwitch,
  handleTabClose,
  handleDownload,
  handleWaitFor,
  handleScroll,
  handleClose,
  // Exposed for the smoke test.
  _prune: prune,
  _PROFILE_DIR: PROFILE_DIR,
  _DOWNLOADS_DIR: DOWNLOADS_DIR,
  _buildBridgeDownloadProof: buildBridgeDownloadProof,
  _normalizeBridgeSemanticWait: normalizeBridgeSemanticWait,
  _normalizeBridgeSemanticScroll: normalizeBridgeSemanticScroll,
  _normalizeBrowserViewportScrollPosition: normalizeBrowserViewportScrollPosition,
  _browserSemanticScrollMovementVerified: browserSemanticScrollMovementVerified,
  _performVerifiedBrowserSemanticScroll: performVerifiedBrowserSemanticScroll,
  _createBrowserIdentityRegistry: createBrowserIdentityRegistry,
  _createGuardedTargetCapabilityStore: createGuardedTargetCapabilityStore,
  _PAGE_WALKER: PAGE_WALKER,
  _createBrowserUrlIdentityCodec: createBrowserUrlIdentityCodec,
  _buildBrowserUrlIdentity: buildBrowserUrlIdentity,
  _browserOpaqueUrlIdentityMatches: browserOpaqueUrlIdentityMatches,
  _browserExpectedUrlMatches: browserExpectedUrlMatches,
  _safeHttpBrowserOrigin: safeHttpBrowserOrigin,
  _sanitizeBrowserSnapshotText: sanitizeBrowserSnapshotText,
  _captureCoherentBrowserDomSnapshot: captureCoherentBrowserDomSnapshot,
  _checkExpectedBrowserFillIdentity: checkExpectedBrowserFillIdentity,
  _checkExpectedBrowserSemanticPageIdentity: checkExpectedBrowserSemanticPageIdentity,
  _captureBrowserSemanticPageIdentityReceipt: captureBrowserSemanticPageIdentityReceipt,
  _hasExactlyOneLocatorActionabilityTarget: hasExactlyOneLocatorActionabilityTarget,
  _isNonPositionalNativeCssSelector: isNonPositionalNativeCssSelector,
  _locatorBoxesAreStable: locatorBoxesAreStable,
  _inspectLocatorActionability: inspectLocatorActionability,
  _isCredentialFillSemantics: isCredentialFillSemantics,
  _hasExactlyOneGuardedFillLocator: hasExactlyOneGuardedFillLocator,
  _hasGuardedFillLocatorOverride: hasGuardedFillLocatorOverride,
  _isSecretBearingFillText: isSecretBearingFillText,
  _isCredentialElementDescriptor: isCredentialElementDescriptor,
  _buildGuardedTargetFingerprint: buildGuardedTargetFingerprint,
  _buildRedactedBrowserFillProof: buildRedactedBrowserFillProof,
  _buildRedactedBrowserFillProofFromObservation: buildRedactedBrowserFillProofFromObservation,
  _captureCoherentGuardedFillObservation: captureCoherentGuardedFillObservation,
  _checkExpectedBrowserToggleIdentity: checkExpectedBrowserToggleIdentity,
  _hasUnsafeGuardedToggleRequest: hasUnsafeGuardedToggleRequest,
  _isUnsafeGuardedToggleDescriptor: isUnsafeGuardedToggleDescriptor,
  _inspectResolvedGenericClickTarget: inspectResolvedGenericClickTarget,
  _clickResolvedNonToggleTarget: clickResolvedNonToggleTarget,
  _inspectResolvedToggleTarget: inspectResolvedToggleTarget,
  _buildGuardedToggleInvariantFingerprint: buildGuardedToggleInvariantFingerprint,
  _buildGuardedToggleTargetFingerprint: buildGuardedToggleTargetFingerprint,
  _checkGuardedToggleCapabilityRecord: checkGuardedToggleCapabilityRecord,
  _captureCoherentGuardedToggleObservation: captureCoherentGuardedToggleObservation,
  _buildRedactedBrowserToggleProof: buildRedactedBrowserToggleProof,
  _hasUnsafeGuardedSelectRequest: hasUnsafeGuardedSelectRequest,
  _isUnsafeGuardedSelectDescriptor: isUnsafeGuardedSelectDescriptor,
  _inspectResolvedSelectTarget: inspectResolvedSelectTarget,
  _buildGuardedSelectInvariantFingerprint: buildGuardedSelectInvariantFingerprint,
  _buildGuardedSelectOptionFingerprint: buildGuardedSelectOptionFingerprint,
  _buildGuardedSelectTargetFingerprint: buildGuardedSelectTargetFingerprint,
  _checkGuardedSelectCapabilityRecord: checkGuardedSelectCapabilityRecord,
  _captureCoherentGuardedSelectObservation: captureCoherentGuardedSelectObservation,
  _buildRedactedBrowserSelectProof: buildRedactedBrowserSelectProof,
};
