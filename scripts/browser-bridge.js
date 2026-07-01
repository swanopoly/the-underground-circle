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

// Multi-tab: we track every page the context opens (including popups the
// site spawns) so tabs_list / tab_switch / tab_close can address them by a
// stable 0-based index. `page` always points at the ACTIVE tab so the
// legacy single-page commands keep working unchanged.
function trackContextPages(ctx) {
  // New pages (target=_blank clicks, window.open, OAuth popups) become the
  // active page — that mirrors what a human sees when a popup steals focus,
  // and it's what the model most likely wants to act on next.
  ctx.on('page', (newPage) => {
    page = newPage;
    // If the popup closes, fall back to the last remaining page so `page`
    // never dangles on a closed target.
    newPage.on('close', () => {
      if (page === newPage) {
        const remaining = ctx.pages();
        page = remaining[remaining.length - 1] || null;
      }
    });
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
  if (context) return { ok: true, context, page };
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
      try { resolve({ body: JSON.parse(buf) }); }
      catch { resolve({ err: 'body must be JSON' }); }
    });
    req.on('error', (err) => resolve({ err: err.message }));
  });
}

async function handleHealth(_req, res, CORS) {
  const status = {
    ok: true,
    playwright: require('playwright/package.json').version,
    chromeChannel: context ? 'running' : 'not_started',
    profileDir: PROFILE_DIR,
    contextOpen: !!context,
    currentUrl: null,
    currentTitle: null,
  };
  if (page) {
    try {
      status.currentUrl = page.url();
      status.currentTitle = await page.title();
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
    const waitUntil = ['load', 'domcontentloaded', 'networkidle'].includes(body.waitUntil) ? body.waitUntil : 'load';
    const timeout = Math.max(1000, Math.min(60000, Number(body.timeoutMs) || 30000));
    const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
      await launched.page.goto(url, { waitUntil, timeout });
      return { url: launched.page.url(), title: await launched.page.title() };
    });
    if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...dialogRun.result, handledDialogs: dialogRun.handledDialogs }));
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

  function implicitRole(el) {
    var tag = (el.tagName || '').toLowerCase();
    var type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    if (el.hasAttribute && el.hasAttribute('role')) return el.getAttribute('role').toLowerCase();
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
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return 'generic';
  }

  function accName(el) {
    if (!el || !el.getAttribute) return '';
    var label = el.getAttribute('aria-label');
    if (label) return label.trim();
    var labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      var ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || '').trim();
    }
    if (el.tagName === 'INPUT' && el.id) {
      var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) return (lbl.textContent || '').trim();
    }
    if (el.tagName === 'IMG') return el.getAttribute('alt') || '';
    if (el.getAttribute('title')) return el.getAttribute('title');
    var text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 160);
  }

  function isVisible(el) {
    if (!el.getBoundingClientRect) return true;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
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
    var name = accName(el);
    var value = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el.value || '') : '';

    var kids = [];
    var i = 0;
    var children = el.children || [];
    for (var c = 0; c < children.length; c += 1) {
      // No early break: past the budget visit() degrades to counting
      // so totalNodes stays honest.
      var sub = visit(children[c], pathId + '.' + kids.length);
      if (sub) kids.push(sub);
    }

    var addressable = !!name || !!value;
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
    if (name) result.name = name;
    if (value) result.value = value;
    if (el.hasAttribute && el.hasAttribute('aria-checked')) result.checked = el.getAttribute('aria-checked') === 'true';
    if (el.hasAttribute && el.hasAttribute('aria-pressed')) result.pressed = el.getAttribute('aria-pressed') === 'true';
    if (el.hasAttribute && el.hasAttribute('aria-expanded')) result.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.hasAttribute && el.disabled) result.disabled = true;
    if (kids.length) result.children = kids;
    return result;
  }

  var root = visit(document.body || document.documentElement, '0');
  return {
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

async function handleDomSnapshot(req, res, CORS, parsedUrl) {
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  const maxNodes = Math.max(20, Math.min(400, Number(parsedUrl.searchParams.get('max_nodes')) || 150));
  const interestingOnly = parsedUrl.searchParams.get('interesting') !== 'false';
  try {
    const result = await launched.page.evaluate(`${PAGE_WALKER}({ maxNodes: ${maxNodes}, interestingOnly: ${interestingOnly} })`);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      url: launched.page.url(),
      title: await launched.page.title(),
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
    const source = await launched.page.content();
    const sourceLength = source.length;
    const truncated = sourceLength > maxChars;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      url: launched.page.url(),
      title: await launched.page.title(),
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
    const state = await inspectPageVerification(launched.page);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ...state }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'verification state failed' }));
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

async function handleClickRole(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || '').trim();
  if (!role) { writeBrowserFailure(res, CORS, 'role required', undefined, 'invalid_input', 400); return; }
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
        await locator.click({ timeout });
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    } catch (firstErr) {
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
        await fb.click({ timeout });
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, role, name: body.name || null, frameSelector: body.frameSelector || null }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'click failed');
  }
}

async function handleFill(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'textbox').trim();
  const text = typeof body.text === 'string' ? body.text : '';
  if (text.length > 4000) { writeBrowserFailure(res, CORS, 'text too long (max 4000)', undefined, 'invalid_input', 400); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [role, body.name, body.selector, body.text]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    let locator = resolveLocator(launched.page, role, body);
    const ambiguity = await detectAmbiguousLocator(locator, body);
    if (ambiguity) { writeAmbiguousLocator(res, CORS, body, ambiguity); return; }
    if (typeof body.nth === 'number') locator = locator.nth(body.nth);
    try {
      const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await locator.fill(text, { timeout });
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    } catch (firstErr) {
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
      const fallback = locatorRoot(launched.page, body).getByRole(role, opts);
      const fb = typeof body.nth === 'number' ? fallback.nth(body.nth) : fallback;
      const dialogRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await fb.fill(text, { timeout });
        return null;
      });
      if (!dialogRun.ok) { writeBrowserDialogBlocked(res, CORS, dialogRun.blockedDecision); return; }
    }
    if (body.submit) {
      const submitRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await launched.page.keyboard.press('Enter');
        return null;
      });
      if (!submitRun.ok) { writeBrowserDialogBlocked(res, CORS, submitRun.blockedDecision); return; }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, chars: text.length, submitted: !!body.submit, frameSelector: body.frameSelector || null }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'fill failed');
  }
}

async function handleSelect(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'combobox').trim();
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  if (!value) { writeBrowserFailure(res, CORS, 'value required', undefined, 'invalid_input', 400); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const gate = await guardHumanVerification(launched.page, [role, body.name, body.selector, body.value]);
    if (gate) { writeHumanVerificationPause(res, CORS, gate); return; }
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    let locator = resolveLocator(launched.page, role, body);
    const ambiguity = await detectAmbiguousLocator(locator, body);
    if (ambiguity) { writeAmbiguousLocator(res, CORS, body, ambiguity); return; }
    if (typeof body.nth === 'number') locator = locator.nth(body.nth);
    try {
      const valueRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
        await locator.selectOption(value, { timeout });
        return null;
      });
      if (!valueRun.ok) { writeBrowserDialogBlocked(res, CORS, valueRun.blockedDecision); return; }
    } catch (valueErr) {
      try {
        const labelRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
          await locator.selectOption({ label: value }, { timeout });
          return null;
        });
        if (!labelRun.ok) { writeBrowserDialogBlocked(res, CORS, labelRun.blockedDecision); return; }
      } catch (labelErr) {
        const openRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
          await locator.click({ timeout });
          return null;
        });
        if (!openRun.ok) { writeBrowserDialogBlocked(res, CORS, openRun.blockedDecision); return; }
        const optionRun = await runWithBrowserDialogHandling(launched.page, body, async () => {
          await launched.page.getByRole('option', { name: value }).click({ timeout });
          return null;
        });
        if (!optionRun.ok) { writeBrowserDialogBlocked(res, CORS, optionRun.blockedDecision); return; }
      }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, value }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'select failed');
  }
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
    const buf = await launched.page.screenshot({ fullPage: !!body.fullPage, type: 'png' });
    const base64 = buf.toString('base64');
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, mimeType: 'image/png', sizeBytes: buf.length, base64 }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'screenshot failed');
  }
}

// ─── Lane-A primitives: multi-tab, downloads, waits, wheel scroll ─────────
//
// These mirror the pure shapes in src/lib/browserPrimitives.ts. That TS
// module can't be `require`d from this plain-JS bridge, so the normalizers
// are duplicated here — keep the two in sync (tab-list dedupe, download
// proof, wait spec, scroll clamp).

const MAX_TRACKED_TABS = 50;
const SCROLL_DELTA_MAX = 5_000;

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
      tabs.push({ index: i, url, title, active: pg === active });
    }
    // Fail-closed to exactly one active tab even if none matched (e.g. the
    // active page was just closed): default the last one.
    if (tabs.length > 0 && !tabs.some((t) => t.active)) tabs[tabs.length - 1].active = true;
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, tabs, count: tabs.length }));
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
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, index: idx, url, title, active: true }));
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

// wait_for — explicit, bounded waits so the model can synchronize on
// dynamic content instead of polling screenshots. Supports {selector}
// (waitForSelector with state), {state} (waitForLoadState), or a plain
// {timeoutMs} delay. Mirrors parseWaitForSpec in browserPrimitives.ts.
async function handleWaitFor(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  const clampTimeout = (value, fallback, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(max, Math.round(n)));
  };
  const LOAD_STATES = ['load', 'domcontentloaded', 'networkidle'];
  const SELECTOR_STATES = ['attached', 'detached', 'visible', 'hidden'];
  try {
    const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
    if (selector) {
      const rawState = String(body.state || '').toLowerCase();
      const state = SELECTOR_STATES.includes(rawState) ? rawState : 'visible';
      const timeout = clampTimeout(body.timeoutMs, 15000, 60000);
      await launched.page.waitForSelector(selector, { state, timeout });
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ok: true, mode: 'selector', selector, state, timeoutMs: timeout, awaited: `selector ${selector} (${state})` }));
      return;
    }
    const rawState = String(body.state || '').toLowerCase();
    if (LOAD_STATES.includes(rawState)) {
      const timeout = clampTimeout(body.timeoutMs, 15000, 60000);
      await launched.page.waitForLoadState(rawState, { timeout });
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ok: true, mode: 'state', state: rawState, timeoutMs: timeout, awaited: `page state ${rawState}` }));
      return;
    }
    // Plain bounded delay (fail-closed default). Capped lower than the
    // selector/state budget — a bare sleep should not hold for a minute.
    const hasTimeout = body.timeoutMs != null && Number.isFinite(Number(body.timeoutMs));
    const timeout = clampTimeout(hasTimeout ? body.timeoutMs : 1000, 1000, 30000);
    await launched.page.waitForTimeout(timeout);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, mode: 'timeout', timeoutMs: timeout, awaited: `${timeout}ms delay` }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'wait failed');
  }
}

// scroll — real mouse-wheel scroll (page.mouse.wheel) so infinite-scroll
// and lazy-loaded content actually advances. Deltas clamped to sane
// bounds; a bare call nudges the page down. Mirrors normalizeScrollDelta.
async function handleScroll(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { writeBrowserFailure(res, CORS, launched.error, undefined, 'browser_bridge_offline', 503); return; }
  try {
    const clampAxis = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(-SCROLL_DELTA_MAX, Math.min(SCROLL_DELTA_MAX, Math.round(n)));
    };
    const hasDx = body.dx != null && Number.isFinite(Number(body.dx));
    const hasDy = body.dy != null && Number.isFinite(Number(body.dy));
    const dx = hasDx ? clampAxis(body.dx) : 0;
    let dy = hasDy ? clampAxis(body.dy) : 0;
    if (!hasDx && !hasDy) dy = 600; // bare scroll → downward nudge
    await launched.page.mouse.wheel(dx, dy);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, dx, dy }));
  } catch (e) {
    writeBrowserFailure(res, CORS, e, 'scroll failed');
  }
}

async function handleClose(_req, res, CORS) {
  if (context) {
    try { await context.close(); } catch {}
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
  handleClickRole,
  handleFill,
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
};
