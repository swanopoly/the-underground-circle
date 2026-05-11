/**
 * browser-bridge — Playwright-backed persistent Chrome context for
 * the UC desktop bridge. Plugged into claude-bridge.js under the
 * `/browser/*` endpoint family.
 *
 * Why persistent: `launchPersistentContext` reuses a real Chrome
 * profile across calls, so sites stay logged in, cookies persist,
 * passkeys work, and we sidestep 80%+ of CAPTCHA/2FA pain without
 * residential proxies.
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

let context = null;   // BrowserContext
let page = null;      // Page (re-used)
let launchError = null;
let launchPromise = null;

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
    res.writeHead(400, CORS);
    res.end(JSON.stringify({ ok: false, error: 'url must start with http(s)://' }));
    return;
  }
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const waitUntil = ['load', 'domcontentloaded', 'networkidle'].includes(body.waitUntil) ? body.waitUntil : 'load';
    const timeout = Math.max(1000, Math.min(60000, Number(body.timeoutMs) || 30000));
    await launched.page.goto(url, { waitUntil, timeout });
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, url: launched.page.url(), title: await launched.page.title() }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'navigation failed' }));
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
  var counter = { n: 0 };

  function visit(el, pathId) {
    if (counter.n >= maxNodes) return null;
    counter.n += 1;

    if (!isVisible(el)) return null;
    var role = implicitRole(el);
    var name = accName(el);
    var value = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? (el.value || '') : '';

    var kids = [];
    var i = 0;
    var children = el.children || [];
    for (var c = 0; c < children.length; c += 1) {
      if (counter.n >= maxNodes) break;
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
  return { tree: root || { id: '0', role: 'document' }, nodeCount: counter.n };
})`;

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
      tree: result.tree,
    }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'snapshot failed' }));
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

// Build a Playwright Locator from any of the three input shapes.
// Returns the locator without trying a fill/click yet — caller handles
// the action so timeout/submit logic stays at the call site.
function resolveLocator(page, role, body) {
  // 1. Explicit selector
  if (body.selector && typeof body.selector === 'string') {
    return page.locator(body.selector);
  }
  // 2. `name` that's actually a CSS selector
  if (body.name && looksLikeCssSelector(body.name)) {
    return page.locator(body.name);
  }
  // 3. Canonical role + accessible name
  const opts = {};
  if (body.name) opts.name = String(body.name);
  if (body.exact === true) opts.exact = true;
  return page.getByRole(role, opts);
}

async function handleClickRole(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || '').trim();
  if (!role) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'role required' })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    let locator = resolveLocator(launched.page, role, body);
    if (typeof body.nth === 'number') locator = locator.nth(body.nth);
    try {
      await locator.click({ timeout });
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
      const fallback = launched.page.getByRole(role, opts);
      const fb = typeof body.nth === 'number' ? fallback.nth(body.nth) : fallback;
      await fb.click({ timeout });
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, role, name: body.name || null }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'click failed' }));
  }
}

async function handleFill(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'textbox').trim();
  const text = typeof body.text === 'string' ? body.text : '';
  if (text.length > 4000) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'text too long (max 4000)' })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    const locator = resolveLocator(launched.page, role, body);
    try {
      await locator.fill(text, { timeout });
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
      await launched.page.getByRole(role, opts).fill(text, { timeout });
    }
    if (body.submit) {
      await launched.page.keyboard.press('Enter');
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, chars: text.length, submitted: !!body.submit }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'fill failed' }));
  }
}

async function handleSelect(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const role = String(body.role || 'combobox').trim();
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  if (!value) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'value required' })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const timeout = Math.max(500, Math.min(30000, Number(body.timeoutMs) || 5000));
    const locator = resolveLocator(launched.page, role, body);
    try {
      await locator.selectOption(value, { timeout });
    } catch (valueErr) {
      try {
        await locator.selectOption({ label: value }, { timeout });
      } catch (labelErr) {
        await locator.click({ timeout });
        await launched.page.getByRole('option', { name: value }).click({ timeout });
      }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, value }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'select failed' }));
  }
}

async function handlePress(req, res, CORS) {
  const { body, err } = await readJsonBody(req);
  if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err })); return; }
  const combo = String(body.combo || '').trim();
  if (!combo) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'combo required' })); return; }
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    // Playwright accepts combos like "Control+A", "Shift+Tab", "Enter".
    await launched.page.keyboard.press(combo);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, combo }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'press failed' }));
  }
}

async function handleScreenshot(req, res, CORS) {
  const { body } = await readJsonBody(req);
  const launched = await ensureContext();
  if (!launched.ok) { res.writeHead(503, CORS); res.end(JSON.stringify({ ok: false, error: launched.error })); return; }
  try {
    const buf = await launched.page.screenshot({ fullPage: !!body.fullPage, type: 'png' });
    const base64 = buf.toString('base64');
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, mimeType: 'image/png', sizeBytes: buf.length, base64 }));
  } catch (e) {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: false, error: (e && e.message) || 'screenshot failed' }));
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
  handleClickRole,
  handleFill,
  handleSelect,
  handlePress,
  handleScreenshot,
  handleClose,
  // Exposed for the smoke test.
  _prune: prune,
  _PROFILE_DIR: PROFILE_DIR,
};
