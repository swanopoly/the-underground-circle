/**
 * browser-primitives-smoketest — exercises the pure Lane-A browser-primitive
 * helpers (tab-list normalize, download proof, wait_for parse, scroll clamp).
 * Offline: no Chrome, no Playwright, no bridge. The live multi-tab / download /
 * wait / wheel paths are verified manually against http://localhost:7778/browser/*.
 *
 * Run: npx tsx scripts/browser-primitives-smoketest.ts
 */

import {
  normalizeTabList,
  clampTabIndex,
  buildDownloadProof,
  formatByteSize,
  toSafePathTail,
  parseWaitForSpec,
  describeWaitForSpec,
  normalizeScrollDelta,
  MAX_TRACKED_TABS,
  SCROLL_DELTA_MAX,
  WAIT_FOR_MAX_TIMEOUT_MS,
  WAIT_FOR_MAX_DELAY_MS,
} from '../src/lib/browserPrimitives';

// ─── Runner ─────────────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── normalizeTabList ──────────────────────────────────────────────
  {
    const r = normalizeTabList([
      { url: 'https://a.example/', title: 'A', active: false },
      { url: 'https://b.example/', title: 'B', active: true },
      { url: 'https://c.example/', title: 'C', active: false },
    ]);
    assert(r.tabs.length === 3, 'tabs: keeps all three');
    assert(r.tabs.every((t, i) => t.index === i), 'tabs: indices re-derived from position');
    assert(r.activeIndex === 1 && r.tabs[1].active === true, 'tabs: honors single active flag');
    assert(r.tabs[0].active === false && r.tabs[2].active === false, 'tabs: only one active');
  }

  // zero active → first becomes active (fail-closed to a foreground)
  {
    const r = normalizeTabList([
      { url: 'https://a/', title: 'A', active: false },
      { url: 'https://b/', title: 'B', active: false },
    ]);
    assert(r.activeIndex === 0 && r.tabs[0].active === true, 'tabs: zero active defaults to first');
    assert(r.tabs[1].active === false, 'tabs: second stays inactive when defaulting');
  }

  // duplicate active → first claim wins, rest dropped
  {
    const r = normalizeTabList([
      { url: 'https://a/', title: 'A', active: true },
      { url: 'https://b/', title: 'B', active: true },
      { url: 'https://c/', title: 'C', active: true },
    ]);
    assert(r.activeIndex === 0, 'tabs: duplicate active → first claim wins');
    assert(r.tabs.filter((t) => t.active).length === 1, 'tabs: exactly one active after dedupe');
  }

  // empty + garbage
  {
    const empty = normalizeTabList([]);
    assert(empty.tabs.length === 0 && empty.activeIndex === -1, 'tabs: empty list → activeIndex -1');
    const garbage = normalizeTabList('not-an-array' as unknown);
    assert(garbage.tabs.length === 0 && garbage.activeIndex === -1, 'tabs: non-array → empty');
    const nullish = normalizeTabList(null);
    assert(nullish.tabs.length === 0, 'tabs: null → empty');
  }

  // coercion + bounds
  {
    const r = normalizeTabList([
      { url: 12345, title: { junk: true }, active: 'yes' }, // active only true when === true
      { url: 'https://ok/', title: 'ok', active: true },
    ]);
    assert(typeof r.tabs[0].url === 'string' && typeof r.tabs[0].title === 'string', 'tabs: url/title coerced to strings');
    assert(r.activeIndex === 1, 'tabs: non-boolean active ignored; real active wins');
  }
  {
    const many = Array.from({ length: MAX_TRACKED_TABS + 20 }, (_, i) => ({ url: `https://x/${i}`, title: `T${i}`, active: false }));
    const r = normalizeTabList(many);
    assert(r.tabs.length === MAX_TRACKED_TABS, 'tabs: bounded to MAX_TRACKED_TABS');
  }
  {
    const longUrl = 'https://x/' + 'a'.repeat(2000);
    const r = normalizeTabList([{ url: longUrl, title: 'b'.repeat(2000), active: true }]);
    assert(r.tabs[0].url.length <= 400, 'tabs: url slice bounded');
    assert(r.tabs[0].title.length <= 200, 'tabs: title slice bounded');
  }

  // ─── clampTabIndex ─────────────────────────────────────────────────
  {
    assert(clampTabIndex(1, 3).ok === true, 'clampTab: in-range ok');
    const r = clampTabIndex(1, 3);
    assert(r.ok && r.index === 1, 'clampTab: returns index');
    assert(clampTabIndex(3, 3).ok === false, 'clampTab: out of range fails');
    assert(clampTabIndex(-1, 3).ok === false, 'clampTab: negative fails');
    assert(clampTabIndex(1.5, 3).ok === false, 'clampTab: non-integer fails');
    assert(clampTabIndex('x', 3).ok === false, 'clampTab: garbage fails');
    assert(clampTabIndex(0, 0).ok === false, 'clampTab: no tabs fails closed');
  }

  // ─── formatByteSize ────────────────────────────────────────────────
  {
    assert(formatByteSize(0) === '0 B', 'size: zero');
    assert(formatByteSize(512) === '512 B', 'size: bytes');
    assert(formatByteSize(1024) === '1 KB', 'size: 1 KB');
    assert(formatByteSize(1536) === '1.5 KB', 'size: 1.5 KB one decimal');
    assert(formatByteSize(1024 * 1024) === '1 MB', 'size: 1 MB');
    assert(formatByteSize(Math.round(1.4 * 1024 * 1024)) === '1.4 MB', 'size: 1.4 MB');
    assert(formatByteSize(37 * 1024 * 1024) === '37 MB', 'size: whole MB above 10');
    assert(formatByteSize(-5) === '0 B', 'size: negative fails closed to 0 B');
    assert(formatByteSize('nope') === '0 B', 'size: garbage → 0 B');
  }

  // ─── toSafePathTail ────────────────────────────────────────────────
  {
    const tail = toSafePathTail('/Users/chris/Library/Application Support/UC/downloads/invoice.pdf');
    assert(tail === '.../downloads/invoice.pdf', 'pathTail: keeps dir+file, drops home prefix', tail);
    assert(!tail.includes('/Users/chris'), 'pathTail: does not leak home path');
    assert(toSafePathTail('invoice.pdf') === 'invoice.pdf', 'pathTail: bare file passes through');
    assert(toSafePathTail('a/b') === 'a/b', 'pathTail: two-segment passes through (no ellipsis)');
    assert(toSafePathTail('') === '', 'pathTail: empty → empty');
    assert(toSafePathTail(null) === '', 'pathTail: null → empty');
  }

  // ─── buildDownloadProof ────────────────────────────────────────────
  {
    const proof = buildDownloadProof({
      path: '/Users/chris/Library/Application Support/UC/downloads/report.csv',
      sizeBytes: 1_474_560,
      basename: 'report.csv',
      suggestedFilename: 'report.csv',
    });
    assert(proof.basename === 'report.csv', 'proof: basename');
    assert(proof.sizeBytes === 1_474_560, 'proof: sizeBytes preserved');
    assert(proof.humanSize === '1.4 MB', 'proof: human size', proof.humanSize);
    assert(proof.pathTail === '.../downloads/report.csv', 'proof: safe path tail', proof.pathTail);
    assert(!proof.summary.includes('/Users/chris'), 'proof: summary does not leak home path');
    assert(proof.summary.includes('report.csv') && proof.summary.includes('1.4 MB'), 'proof: summary carries basename + size');
    assert(!('suggestedFilename' in proof), 'proof: suggestedFilename omitted when same as basename');
  }
  {
    // basename derived from path when omitted; suggested differs → kept.
    const proof = buildDownloadProof({
      path: '/Users/chris/Downloads/scoped-a1b2.pdf',
      sizeBytes: 2048,
      suggestedFilename: 'Original Invoice.pdf',
    });
    assert(proof.basename === 'scoped-a1b2.pdf', 'proof: basename derived from path tail', proof.basename);
    assert(proof.suggestedFilename === 'Original Invoice.pdf', 'proof: differing suggestedFilename retained');
    assert(proof.humanSize === '2 KB', 'proof: 2 KB');
  }
  {
    // fail-closed: missing/garbage size → 0, missing everything → "download".
    const proof = buildDownloadProof({ path: null, sizeBytes: undefined, basename: null });
    assert(proof.sizeBytes === 0, 'proof: missing size → 0');
    assert(proof.humanSize === '0 B', 'proof: missing size → 0 B');
    assert(proof.basename === 'download', 'proof: missing basename → "download" fallback');
    assert(proof.pathTail === '', 'proof: missing path → empty tail');
    const garbageSize = buildDownloadProof({ path: '/x/y.zip', sizeBytes: -99 as unknown as number, basename: 'y.zip' });
    assert(garbageSize.sizeBytes === 0, 'proof: negative size → 0');
  }

  // ─── parseWaitForSpec ──────────────────────────────────────────────
  {
    const s = parseWaitForSpec({ selector: '#results', state: 'hidden', timeoutMs: 8000 });
    assert(s.mode === 'selector', 'wait: selector mode');
    assert(s.selector === '#results', 'wait: selector value');
    assert(s.selectorState === 'hidden', 'wait: selector state honored');
    assert(s.timeoutMs === 8000, 'wait: timeout honored');
  }
  {
    const s = parseWaitForSpec({ selector: '.loaded' });
    assert(s.mode === 'selector' && s.selectorState === 'visible', 'wait: selector defaults to visible');
    assert(s.timeoutMs === 15000, 'wait: selector default timeout 15s');
  }
  {
    // bad selector state coerces to visible.
    const s = parseWaitForSpec({ selector: '.x', state: 'BOGUS' });
    assert(s.selectorState === 'visible', 'wait: garbage selector state → visible');
  }
  {
    const s = parseWaitForSpec({ state: 'networkidle' });
    assert(s.mode === 'state' && s.state === 'networkidle', 'wait: load-state mode');
  }
  {
    const s = parseWaitForSpec({ state: 'domcontentloaded', timeoutMs: 3000 });
    assert(s.mode === 'state' && s.state === 'domcontentloaded' && s.timeoutMs === 3000, 'wait: state + timeout');
  }
  {
    const s = parseWaitForSpec({ timeoutMs: 2500 });
    assert(s.mode === 'timeout' && s.timeoutMs === 2500, 'wait: plain delay mode');
  }
  {
    // garbage → fail-closed short default delay.
    const s = parseWaitForSpec('nonsense' as unknown);
    assert(s.mode === 'timeout', 'wait: garbage → timeout mode');
    assert(s.timeoutMs === 1000, 'wait: garbage → 1s default delay', String(s.timeoutMs));
    const empty = parseWaitForSpec({});
    assert(empty.mode === 'timeout' && empty.timeoutMs === 1000, 'wait: empty → 1s default');
    const nul = parseWaitForSpec(null);
    assert(nul.mode === 'timeout', 'wait: null → timeout mode');
  }
  {
    // clamps: selector/state cap at 60s, plain delay caps at 30s.
    const big = parseWaitForSpec({ selector: '.x', timeoutMs: 999999 });
    assert(big.timeoutMs === WAIT_FOR_MAX_TIMEOUT_MS, 'wait: selector timeout clamped to 60s', String(big.timeoutMs));
    const bigDelay = parseWaitForSpec({ timeoutMs: 999999 });
    assert(bigDelay.timeoutMs === WAIT_FOR_MAX_DELAY_MS, 'wait: plain delay clamped to 30s', String(bigDelay.timeoutMs));
    const neg = parseWaitForSpec({ state: 'load', timeoutMs: -1000 });
    assert(neg.timeoutMs === 0, 'wait: negative timeout clamped to 0');
  }
  {
    // describe strings.
    assert(describeWaitForSpec(parseWaitForSpec({ selector: '#x' })).includes('#x'), 'wait: describe names selector');
    assert(describeWaitForSpec(parseWaitForSpec({ state: 'load' })).includes('load'), 'wait: describe names state');
    assert(/waited \d+ms/.test(describeWaitForSpec(parseWaitForSpec({ timeoutMs: 500 }))), 'wait: describe names delay');
  }

  // ─── normalizeScrollDelta ──────────────────────────────────────────
  {
    const s = normalizeScrollDelta({ dx: 0, dy: 400 });
    assert(s.dx === 0 && s.dy === 400, 'scroll: honors dy');
    const up = normalizeScrollDelta({ dy: -300 });
    assert(up.dy === -300 && up.dx === 0, 'scroll: negative dy (scroll up), dx defaults 0');
  }
  {
    // bare scroll → downward nudge.
    const bare = normalizeScrollDelta({});
    assert(bare.dy === 600 && bare.dx === 0, 'scroll: bare → downward nudge', JSON.stringify(bare));
    const nul = normalizeScrollDelta(null);
    assert(nul.dy === 600, 'scroll: null → downward nudge');
  }
  {
    // clamps.
    const clamped = normalizeScrollDelta({ dx: 999999, dy: -999999 });
    assert(clamped.dx === SCROLL_DELTA_MAX && clamped.dy === -SCROLL_DELTA_MAX, 'scroll: clamped to ±MAX', JSON.stringify(clamped));
    // garbage axis → 0 on that axis only.
    const g = normalizeScrollDelta({ dx: 'nope', dy: 200 });
    assert(g.dx === 0 && g.dy === 200, 'scroll: garbage dx → 0, dy kept');
    // rounds floats.
    const f = normalizeScrollDelta({ dx: 12.7, dy: 33.2 });
    assert(f.dx === 13 && f.dy === 33, 'scroll: floats rounded');
  }

  // ─── Bridge/client parity ──────────────────────────────────────────
  //
  // browser-bridge.js (plain CommonJS) can't import the TS pure helper, so
  // it mirrors buildDownloadProof as _buildBridgeDownloadProof. Assert the
  // two produce the same proof shape so the surfaces never drift. Skipped
  // gracefully if Playwright isn't installed (the bridge module require
  // would throw).
  {
    let bridge: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      bridge = require('./browser-bridge.js');
    } catch {
      console.log('skip: browser-bridge.js not requirable (Playwright absent) — parity check skipped');
    }
    if (bridge && typeof bridge._buildBridgeDownloadProof === 'function') {
      // The bridge saves with a Date.now() prefix, so its on-disk basename
      // legitimately carries the timestamp. In the real flow the client
      // rebuilds proof from the bridge's RETURNED basename — so feed the
      // pure helper the bridge basename (derived from path), not the raw
      // suggested name. Both must then agree on every field.
      const filePath = '/Users/someone/Library/Application Support/UC/downloads/1720000000000-invoice.pdf';
      const sizeBytes = 1_474_560;
      const bridgeProof = bridge._buildBridgeDownloadProof({ filePath, sizeBytes, suggestedFilename: 'invoice.pdf' });
      const pureProof = buildDownloadProof({ path: filePath, sizeBytes, basename: bridgeProof.basename, suggestedFilename: 'invoice.pdf' });
      assert(bridgeProof.basename === pureProof.basename, 'parity: basename matches', `${bridgeProof.basename} vs ${pureProof.basename}`);
      assert(bridgeProof.basename === '1720000000000-invoice.pdf', 'parity: bridge basename keeps timestamped on-disk name', bridgeProof.basename);
      assert(bridgeProof.suggestedFilename === 'invoice.pdf', 'parity: bridge keeps original suggested filename');
      assert(bridgeProof.humanSize === pureProof.humanSize, 'parity: human size matches', `${bridgeProof.humanSize} vs ${pureProof.humanSize}`);
      assert(bridgeProof.sizeBytes === pureProof.sizeBytes, 'parity: sizeBytes matches');
      assert(bridgeProof.pathTail === pureProof.pathTail, 'parity: safe path tail matches', `${bridgeProof.pathTail} vs ${pureProof.pathTail}`);
      assert(!bridgeProof.summary.includes('/Users/someone'), 'parity: bridge summary does not leak home path');
      assert(typeof bridge._DOWNLOADS_DIR === 'string' && bridge._DOWNLOADS_DIR.includes('downloads'), 'parity: bridge exposes scoped downloads dir');
      // Every new handler must be exported so the parent can wire routes.
      for (const fn of ['handleTabsList', 'handleTabSwitch', 'handleTabClose', 'handleDownload', 'handleWaitFor', 'handleScroll']) {
        assert(typeof bridge[fn] === 'function', `parity: bridge exports ${fn}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} browser-primitives smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll browser-primitives smoke cases passed.');
}

main();
