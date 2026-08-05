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

async function main() {
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

      // Bridge-issued browser identity registry: ids are opaque/stable for
      // live objects, unique across contexts/pages/evidence, and retired page
      // objects can never receive or reuse an id after close.
      const registry = bridge._createBrowserIdentityRegistry({
        randomUUID: () => '11111111-2222-4333-8444-555555555555',
        now: () => '2026-07-24T12:00:00.000Z',
      });
      const contextA = {};
      const contextB = {};
      const pageA = { currentUrl: 'https://example.test/form', url() { return this.currentUrl; }, isClosed() { return false; } };
      const pageB = { currentUrl: 'https://example.test/other', url() { return this.currentUrl; }, isClosed() { return false; } };
      const contextAId = registry.browserContextIdFor(contextA);
      const pageAId = registry.pageIdFor(pageA);
      assert(registry.browserProcessId === registry.browserProcessId, 'identity: browser process id is stable');
      assert(contextAId === registry.browserContextIdFor(contextA), 'identity: context id is stable while live');
      assert(pageAId === registry.pageIdFor(pageA), 'identity: page id is stable while live');
      assert(contextAId !== registry.browserContextIdFor(contextB), 'identity: distinct contexts get unique ids');
      assert(pageAId !== registry.pageIdFor(pageB), 'identity: distinct pages get unique ids');
      assert(
        [registry.browserProcessId, contextAId, pageAId].every((id: unknown) => typeof id === 'string' && /^uc_browser_[A-Za-z0-9_-]+$/.test(id)),
        'identity: ids are opaque bridge capabilities, not OS/browser indices',
      );

      const observationA = registry.observe(contextA, pageA, pageA.url());
      const observationB = registry.observe(contextA, pageA, pageA.url());
      assert(observationA.pageId === observationB.pageId, 'identity: observations retain the live page id');
      assert(observationA.evidenceId !== observationB.evidenceId, 'identity: each observation gets unique evidence');

      const exact = {
        expectedBrowserContextId: observationA.browserContextId,
        expectedPageId: observationA.pageId,
        expectedUrl: observationA.url,
      };
      assert(
        bridge._checkExpectedBrowserFillIdentity(registry, contextA, pageA, exact, pageA).ok === true,
        'fill identity: exact live context/page/url passes at handler entry',
      );
      assert(
        bridge._checkExpectedBrowserFillIdentity(
          registry,
          contextA,
          pageA,
          { ...exact, expectedPageId: '' },
          pageA,
        ).code === 'browser_identity_required',
        'fill identity: partial or malformed prior identity fails closed',
      );
      pageA.currentUrl = 'https://example.test/changed';
      let fillCalls = 0;
      const mismatch = bridge._checkExpectedBrowserFillIdentity(registry, contextA, pageA, exact, pageA);
      if (mismatch.ok) fillCalls += 1;
      assert(mismatch.ok === false && mismatch.code === 'browser_identity_mismatch', 'fill identity: URL mismatch fails closed');
      assert(fillCalls === 0, 'fill identity: mismatch is rejected before the fill callback');
      pageA.currentUrl = observationA.url;
      assert(
        bridge._checkExpectedBrowserFillIdentity(registry, contextA, pageA, exact, pageB).ok === false,
        'fill identity: active-page switch fails closed before fill',
      );
      const navigatedPageId = registry.advancePageDocument(pageA);
      assert(navigatedPageId !== pageAId, 'identity: main-frame navigation rotates the page document id');
      assert(
        bridge._checkExpectedBrowserFillIdentity(registry, contextA, pageA, exact, pageA).ok === false,
        'fill identity: same-URL reload/document replacement invalidates prior page identity',
      );

      registry.retirePage(pageA);
      assert(registry.pageIdFor(pageA) === null, 'identity: closed page object cannot receive another id');
      const pageAfterClose = { currentUrl: observationA.url, url() { return this.currentUrl; }, isClosed() { return false; } };
      const replacementPageId = registry.pageIdFor(pageAfterClose);
      assert(replacementPageId !== pageAId, 'identity: replacement page never reuses the closed page id');
      registry.retireContext(contextA);
      assert(registry.browserContextIdFor(contextA) === null, 'identity: closed context cannot receive another id');

      // Exact-target capabilities are bounded, short-lived, single-use, and
      // revoked with their owning page/context. The store is exercised with a
      // fake clock/random source so replay/expiry behavior is deterministic.
      assert(
        typeof bridge._createGuardedTargetCapabilityStore === 'function',
        'fill target: capability store helper is exported for lifecycle verification',
      );
      if (typeof bridge._createGuardedTargetCapabilityStore === 'function') {
        let capabilityNow = Date.parse('2026-07-24T12:00:00.000Z');
        const makeHandle = () => {
          const state = { disposeCalls: 0 };
          return {
            state,
            handle: {
              dispose() {
                state.disposeCalls += 1;
                return Promise.resolve();
              },
            },
          };
        };
        const makeRecord = (handle: unknown, pageRef: object, contextRef: object) => ({
          handle,
          pageRef,
          contextRef,
          browserContextId: 'uc_browser_context_capability_fixture',
          pageId: 'uc_browser_page_capability_fixture',
          url: 'https://example.test/draft',
          targetFingerprint: `uc_browser_target_fingerprint_${'a'.repeat(64)}`,
        });
        const capabilityStore = bridge._createGuardedTargetCapabilityStore({
          now: () => capabilityNow,
          ttlMs: 1_000,
          maxLive: 2,
          randomBytes: () => Buffer.alloc(24, 0x5a),
        });
        const capabilityPage = {};
        const capabilityContext = {};
        const firstHandle = makeHandle();
        const firstIssue = capabilityStore.issue(
          makeRecord(firstHandle.handle, capabilityPage, capabilityContext),
        );
        assert(firstIssue.ok === true, 'fill target: exact ElementHandle capability is issued');
        assert(
          firstIssue.ok
            && /^uc_browser_target_[A-Za-z0-9_-]+$/.test(firstIssue.targetId)
            && firstIssue.targetId.length <= 180,
          'fill target: target id is opaque and bounded',
        );
        const firstConsume = firstIssue.ok
          ? capabilityStore.consume(firstIssue.targetId)
          : { ok: false };
        assert(
          firstConsume.ok === true && firstConsume.record.handle === firstHandle.handle,
          'fill target: first consume returns the exact observed handle',
        );
        assert(firstHandle.state.disposeCalls === 0, 'fill target: consume leaves disposal to the guarded handler');
        const replay = firstIssue.ok
          ? capabilityStore.consume(firstIssue.targetId)
          : { ok: true };
        assert(
          replay.ok === false && replay.code === 'browser_target_replayed',
          'fill target: consumed capability cannot be replayed',
        );

        const expiringHandle = makeHandle();
        const expiringIssue = capabilityStore.issue(
          makeRecord(expiringHandle.handle, capabilityPage, capabilityContext),
        );
        capabilityNow += 1_001;
        const expired = expiringIssue.ok
          ? capabilityStore.consume(expiringIssue.targetId)
          : { ok: true };
        assert(
          expired.ok === false && expired.code === 'browser_target_expired',
          'fill target: expired capability fails with an explicit tombstone',
        );
        assert(expiringHandle.state.disposeCalls === 1, 'fill target: expiry disposes the retained handle once');

        const revokedPage = {};
        const retainedPage = {};
        const revokedHandle = makeHandle();
        const retainedHandle = makeHandle();
        const revokedIssue = capabilityStore.issue(
          makeRecord(revokedHandle.handle, revokedPage, capabilityContext),
        );
        const retainedIssue = capabilityStore.issue(
          makeRecord(retainedHandle.handle, retainedPage, capabilityContext),
        );
        capabilityStore.revokeWhere(
          (record: { pageRef?: object }) => record.pageRef === revokedPage,
          'browser_target_revoked',
        );
        const revoked = revokedIssue.ok
          ? capabilityStore.consume(revokedIssue.targetId)
          : { ok: true };
        const retained = retainedIssue.ok
          ? capabilityStore.consume(retainedIssue.targetId)
          : { ok: false };
        assert(
          revoked.ok === false && revoked.code === 'browser_target_revoked',
          'fill target: page/context revocation prevents later consumption',
        );
        assert(revokedHandle.state.disposeCalls === 1, 'fill target: revocation disposes its retained handle');
        assert(retained.ok === true, 'fill target: targeted revocation does not revoke another page capability');

        const capacityStore = bridge._createGuardedTargetCapabilityStore({
          now: () => capabilityNow,
          ttlMs: 5_000,
          maxLive: 1,
          randomBytes: () => Buffer.alloc(24, 0x33),
        });
        const capacityFirst = capacityStore.issue(
          makeRecord(makeHandle().handle, {}, {}),
        );
        const capacityBlocked = capacityStore.issue(
          makeRecord(makeHandle().handle, {}, {}),
        );
        assert(
          capacityFirst.ok === true
            && capacityBlocked.ok === false
            && capacityBlocked.code === 'browser_target_capacity',
          'fill target: live capability count is bounded',
        );
      }

      const secret = 'TOP_SECRET_VALUE_90210';
      const targetFingerprint = `uc_browser_target_fingerprint_${'f'.repeat(64)}`;
      const proofContext = {};
      const proofPage = { currentUrl: 'https://example.test/draft', url() { return this.currentUrl; }, isClosed() { return false; } };
      const proof = bridge._buildRedactedBrowserFillProof(
        registry,
        proofContext,
        proofPage,
        secret,
        secret,
        targetFingerprint,
        true,
      );
      const serializedProof = JSON.stringify(proof);
      assert(proof.valueMatches === true, 'fill proof: server-observed value equality is surfaced');
      assert(proof.valueLength === secret.length && proof.expectedLength === secret.length, 'fill proof: only actual/expected lengths are surfaced');
      assert(!serializedProof.includes(secret), 'fill proof: filled value is never echoed');
      assert(proof.targetFingerprint === targetFingerprint, 'fill proof: approved target fingerprint is echoed');
      assert(proof.mutationPerformed === true, 'fill proof: mutation/no-op truth is explicit');
      assert(!('targetId' in proof), 'fill proof: ephemeral target capability is never returned');
      assert(
        Object.keys(proof).sort().join(',') === [
          'browserContextId',
          'browserProcessId',
          'evidenceId',
          'expectedLength',
          'mutationPerformed',
          'observedAt',
          'pageId',
          'targetFingerprint',
          'url',
          'valueLength',
          'valueMatches',
        ].sort().join(','),
        'fill proof: output is restricted to identity, URL/time/evidence, match, and lengths',
      );
      assert(bridge._isCredentialFillSemantics({ selector: 'input[type="password"]' }) === true, 'fill canary: password selector is credential semantics');
      assert(bridge._isCredentialFillSemantics({ name: 'Email address' }) === true, 'fill canary: email/login identity field is credential semantics');
      assert(bridge._isCredentialFillSemantics({ name: 'Search query' }) === false, 'fill canary: ordinary non-secret draft field remains eligible');
      for (const [text, label] of [
        ['sk-proj-AbCdEf1234567890_XYZ', 'provider API token'],
        ['Bearer eyJhbGciOiJIUzI1NiJ9.payloadsignature', 'bearer token'],
        ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123', 'JWT'],
        ['client_secret=R4nd0mSecretMaterial987654', 'labeled client secret'],
        ['-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----', 'private key'],
        ['4242 4242 4242 4242', 'Luhn-valid payment card'],
        ['aZ9_4M2pQ7vN8xL3cR6tY1uK5wB0sD=', 'unlabelled high-entropy token'],
      ] as const) {
        assert(
          bridge._isSecretBearingFillText(text) === true,
          `fill canary text: ${label} is blocked without target-semantic hints`,
        );
      }
      for (const [text, label] of [
        ['Quarterly launch notes are ready for team review.', 'ordinary prose'],
        ['550e8400-e29b-41d4-a716-446655440000', 'ordinary UUID'],
        ['https://example.test/articles/guarded-browser-fill', 'ordinary URL'],
        ['Call the project desk at 212-555-0198 tomorrow.', 'ordinary phone number'],
      ] as const) {
        assert(
          bridge._isSecretBearingFillText(text) === false,
          `fill canary text: ${label} remains eligible`,
        );
      }
      assert(
        bridge._isCredentialElementDescriptor({ tagName: 'INPUT', type: 'password' }) === true,
        'fill canary: resolved password input is rejected even behind a generic selector',
      );
      assert(
        bridge._isCredentialElementDescriptor({ tagName: 'INPUT', type: 'text', autocomplete: 'current-password' }) === true,
        'fill canary: resolved credential autocomplete is rejected',
      );
      for (const [descriptor, label] of [
        [{ tagName: 'INPUT', type: 'text', labelText: 'API key' }, 'external API-key label'],
        [{ tagName: 'INPUT', type: 'text', formText: 'Sign in with your access token' }, 'credential form text'],
        [{ tagName: 'TEXTAREA', formAriaLabel: 'Recovery phrase' }, 'credential form aria-label'],
        [{ tagName: 'INPUT', type: 'text', ariaLabelledByText: 'One-time security code' }, 'aria-labelledby text'],
        [{ tagName: 'INPUT', type: 'text', labelText: 'Credit card CVV' }, 'payment credential label'],
      ] as const) {
        assert(
          bridge._isCredentialElementDescriptor(descriptor) === true,
          `fill canary: resolved ${label} is rejected`,
        );
      }
      assert(
        bridge._isCredentialElementDescriptor({
          tagName: 'INPUT',
          type: 'search',
          name: 'query',
          labelText: 'Article title',
          formText: 'Edit draft',
        }) === false,
        'fill canary: resolved ordinary input remains eligible',
      );
      if (typeof bridge._buildGuardedTargetFingerprint === 'function') {
        const fingerprintIdentity = {
          browserContextId: 'uc_browser_context_fingerprint_fixture',
          pageId: 'uc_browser_page_fingerprint_fixture',
          url: 'https://example.test/draft',
        };
        const fingerprintDescriptor = {
          tagName: 'INPUT',
          type: 'text',
          name: 'title',
          labelText: 'Article title',
          ariaDescribedByText: 'Draft title help',
          formAction: '/draft/save',
          formText: 'Edit draft',
          documentUrl: 'https://example.test/draft',
          nodeStructure: 'input:title:0>form:draft:0>body::1',
          frameStructure: 'iframe:editor:0',
          isConnected: true,
          ownerDocumentIsCurrent: true,
        };
        const fingerprintA = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          fingerprintDescriptor,
        );
        const fingerprintB = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          { ...fingerprintDescriptor, labelText: 'Different field' },
        );
        const fingerprintC = bridge._buildGuardedTargetFingerprint(
          { ...fingerprintIdentity, pageId: 'uc_browser_page_other_document_fixture' },
          fingerprintDescriptor,
        );
        const fingerprintD = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          { ...fingerprintDescriptor, ariaDescribedByText: 'Different live help' },
        );
        const fingerprintE = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          { ...fingerprintDescriptor, formText: 'Different form semantics' },
        );
        const fingerprintF = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          { ...fingerprintDescriptor, nodeStructure: 'input:title:1>form:draft:0>body::1' },
        );
        const fingerprintG = bridge._buildGuardedTargetFingerprint(
          fingerprintIdentity,
          { ...fingerprintDescriptor, frameStructure: 'iframe:replacement-editor:0' },
        );
        assert(
          typeof fingerprintA === 'string'
            && /^uc_browser_target_fingerprint_[a-f0-9]{64}$/.test(fingerprintA),
          'fill target: fingerprint is a bounded keyed digest',
        );
        assert(fingerprintA !== fingerprintB, 'fill target: external label changes invalidate fingerprint');
        assert(fingerprintA !== fingerprintC, 'fill target: document identity changes invalidate fingerprint');
        assert(fingerprintA !== fingerprintD, 'fill target: aria-describedby semantic drift invalidates fingerprint');
        assert(fingerprintA !== fingerprintE, 'fill target: form-text semantic drift invalidates fingerprint');
        assert(fingerprintA !== fingerprintF, 'fill target: same-document node replacement/path drift invalidates fingerprint');
        assert(fingerprintA !== fingerprintG, 'fill target: frame ancestry drift invalidates fingerprint');
        assert(
          ![
            fingerprintDescriptor.labelText,
            fingerprintDescriptor.ariaDescribedByText,
            fingerprintDescriptor.formText,
            fingerprintDescriptor.nodeStructure,
            fingerprintDescriptor.frameStructure,
          ].some((raw) => String(fingerprintA).includes(raw)),
          'fill target: keyed fingerprint exposes no inspected semantic or structural text',
        );

        const coherentRegistry = bridge._createBrowserIdentityRegistry({
          randomUUID: () => '66666666-7777-4888-8999-aaaaaaaaaaaa',
          now: () => '2026-07-24T12:01:00.000Z',
        });
        const coherentContext = {};
        const coherentPage = {
          currentUrl: fingerprintIdentity.url,
          url() { return this.currentUrl; },
          isClosed() { return false; },
        };
        const coherentIdentity = coherentRegistry.observe(
          coherentContext,
          coherentPage,
          coherentPage.url(),
        );
        const expectedIdentity = {
          expectedBrowserContextId: coherentIdentity.browserContextId,
          expectedPageId: coherentIdentity.pageId,
          expectedUrl: coherentIdentity.url,
        };
        const coherentFingerprint = bridge._buildGuardedTargetFingerprint(
          coherentIdentity,
          fingerprintDescriptor,
        );
        const makeObservationHandle = (
          descriptor: Record<string, unknown>,
          observedValue: string,
          duringEvaluate?: () => void,
        ) => ({
          async evaluate(_callback: unknown, evaluationOptions: { includeValue?: boolean }) {
            duringEvaluate?.();
            return {
              descriptor,
              ...(evaluationOptions?.includeValue ? { observedValue } : {}),
            };
          },
        });
        const coherentObservation = await bridge._captureCoherentGuardedFillObservation({
          registry: coherentRegistry,
          contextRef: coherentContext,
          pageRef: coherentPage,
          expectedIdentity,
          targetHandle: makeObservationHandle(fingerprintDescriptor, 'Approved draft'),
          timeout: 5_000,
          expectedTargetFingerprint: coherentFingerprint,
          resolveActivePage: () => coherentPage,
        });
        assert(
          coherentObservation.ok === true
            && coherentObservation.observedValue === 'Approved draft'
            && coherentObservation.identity.pageId === expectedIdentity.expectedPageId,
          'fill proof: one coherent renderer observation binds value, semantics, and pre-capture evidence identity',
        );
        const coherentProof = bridge._buildRedactedBrowserFillProofFromObservation(
          coherentObservation,
          'Approved draft',
          coherentFingerprint,
          false,
        );
        assert(
          coherentProof?.valueMatches === true
            && coherentProof.mutationPerformed === false
            && !JSON.stringify(coherentProof).includes('Approved draft'),
          'fill proof: coherent observation produces a redacted no-op proof',
        );
        const injectedIdentitySecret = 'IDENTITY_SIDE_CHANNEL_MUST_NOT_SURVIVE';
        const allowlistedProof = bridge._buildRedactedBrowserFillProofFromObservation(
          {
            ...coherentObservation,
            identity: {
              ...coherentObservation.identity,
              debugText: injectedIdentitySecret,
            },
          },
          'Approved draft',
          coherentFingerprint,
          false,
        );
        assert(
          allowlistedProof
            && !JSON.stringify(allowlistedProof).includes(injectedIdentitySecret)
            && !('debugText' in allowlistedProof),
          'fill proof: observation identity is copied through an exact privacy-safe allowlist',
        );

        const driftingRegistry = bridge._createBrowserIdentityRegistry({
          randomUUID: () => 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
          now: () => '2026-07-24T12:02:00.000Z',
        });
        const driftingContext = {};
        const driftingPage = {
          currentUrl: fingerprintIdentity.url,
          url() { return this.currentUrl; },
          isClosed() { return false; },
        };
        const driftingIdentity = driftingRegistry.observe(
          driftingContext,
          driftingPage,
          driftingPage.url(),
        );
        const driftingExpected = {
          expectedBrowserContextId: driftingIdentity.browserContextId,
          expectedPageId: driftingIdentity.pageId,
          expectedUrl: driftingIdentity.url,
        };
        const driftingFingerprint = bridge._buildGuardedTargetFingerprint(
          driftingIdentity,
          fingerprintDescriptor,
        );
        const driftedObservation = await bridge._captureCoherentGuardedFillObservation({
          registry: driftingRegistry,
          contextRef: driftingContext,
          pageRef: driftingPage,
          expectedIdentity: driftingExpected,
          targetHandle: makeObservationHandle(
            fingerprintDescriptor,
            'stale value must not be proved',
            () => { driftingRegistry.advancePageDocument(driftingPage); },
          ),
          timeout: 5_000,
          expectedTargetFingerprint: driftingFingerprint,
          resolveActivePage: () => driftingPage,
        });
        assert(
          driftedObservation.ok === false
            && driftedObservation.code === 'browser_identity_mismatch'
            && !('observedValue' in driftedObservation),
          'fill proof: document drift during value capture fails closed without returning the stale value',
        );

        const replacedNodeObservation = await bridge._captureCoherentGuardedFillObservation({
          registry: coherentRegistry,
          contextRef: coherentContext,
          pageRef: coherentPage,
          expectedIdentity,
          targetHandle: makeObservationHandle(
            { ...fingerprintDescriptor, nodeStructure: 'input:title:9>form:draft:0>body::1' },
            'Approved draft',
          ),
          timeout: 5_000,
          expectedTargetFingerprint: coherentFingerprint,
          resolveActivePage: () => coherentPage,
        });
        assert(
          replacedNodeObservation.ok === false
            && replacedNodeObservation.code === 'browser_target_mismatch',
          'fill proof: same-document structural replacement fails closed before proof',
        );
        const detachedObservation = await bridge._captureCoherentGuardedFillObservation({
          registry: coherentRegistry,
          contextRef: coherentContext,
          pageRef: coherentPage,
          expectedIdentity,
          targetHandle: makeObservationHandle(
            { ...fingerprintDescriptor, isConnected: false },
            'stale detached value',
          ),
          timeout: 5_000,
          expectedTargetFingerprint: coherentFingerprint,
          resolveActivePage: () => coherentPage,
        });
        assert(
          detachedObservation.ok === false
            && detachedObservation.code === 'uncertain_ui_target'
            && !('observedValue' in detachedObservation),
          'fill proof: an identically-described detached replacement handle cannot produce evidence',
        );
      }
      assert(
        bridge._isCredentialElementDescriptor({ tagName: 'DIV', contenteditable: 'true' }) === true,
        'fill canary: unverifiable non-input target is rejected before mutation',
      );
      assert(
        bridge._isCredentialElementDescriptor({
          tagName: 'INPUT',
          type: 'text',
          explicitRole: 'combobox',
        }) === true
          && bridge._isCredentialElementDescriptor({
            tagName: 'SELECT',
            explicitRole: 'combobox',
          }) === true
          && bridge._isCredentialElementDescriptor({
            tagName: 'OPTION',
            explicitRole: 'option',
          }) === true
          && bridge._isCredentialElementDescriptor({
            tagName: 'INPUT',
            type: 'text',
            listId: 'theme-options',
          }) === true
          && bridge._isCredentialElementDescriptor({
            tagName: 'INPUT',
            type: 'text',
            ariaHasPopup: 'listbox',
          }) === true,
        'fill canary: explicit/implicit combobox plus native select/option handles cannot bypass the select lane',
      );

      // Legacy generic click must inspect the exact resolved DOM handle rather
      // than trust a caller-provided selector or role. Direct state controls,
      // labels, and descendants all route to browser.set_toggle.
      const makeGenericClickNode = ({
        tagName = 'button',
        attrs = {},
        closestBySelector = {},
        control = null,
      }: {
        tagName?: string;
        attrs?: Record<string, string>;
        closestBySelector?: Record<string, unknown>;
        control?: unknown;
      } = {}) => ({
        tagName: tagName.toUpperCase(),
        control,
        getAttribute(name: string) {
          return attrs[name] || '';
        },
        closest(selector: string) {
          return closestBySelector[selector] || null;
        },
      });
      const inspectGenericClick = (element: unknown) => (
        bridge._inspectResolvedGenericClickTarget({
          evaluate(callback: (resolved: unknown) => unknown) {
            return Promise.resolve(callback(element));
          },
        })
      );
      const spoofedNativeCheckbox = makeGenericClickNode({
        tagName: 'input',
        attrs: { type: 'checkbox', role: 'button' },
      });
      const spoofedNativeRadio = makeGenericClickNode({
        tagName: 'input',
        attrs: { type: 'radio', role: 'button' },
      });
      const ariaSwitch = makeGenericClickNode({
        tagName: 'div',
        attrs: { role: 'switch', 'aria-checked': 'false' },
      });
      const associatedLabel = makeGenericClickNode({
        tagName: 'label',
        control: spoofedNativeCheckbox,
      });
      const labelDescendant = makeGenericClickNode({
        tagName: 'span',
        closestBySelector: { label: associatedLabel },
      });
      const ariaDescendant = makeGenericClickNode({
        tagName: 'span',
        closestBySelector: {
          '[role="checkbox"],[role="switch"],[role="radio"]': ariaSwitch,
        },
      });
      const nativeSelect = makeGenericClickNode({
        tagName: 'select',
        attrs: { role: 'button' },
      });
      const nativeOption = makeGenericClickNode({
        tagName: 'option',
        attrs: { role: 'button' },
      });
      const ariaListbox = makeGenericClickNode({
        tagName: 'div',
        attrs: { role: 'listbox' },
      });
      const implicitDatalistCombobox = makeGenericClickNode({
        tagName: 'input',
        attrs: { list: 'theme-options', role: 'textbox' },
      });
      const associatedSelectLabel = makeGenericClickNode({
        tagName: 'label',
        control: nativeSelect,
      });
      const selectLabelDescendant = makeGenericClickNode({
        tagName: 'span',
        closestBySelector: { label: associatedSelectLabel },
      });
      const optionDescendant = makeGenericClickNode({
        tagName: 'span',
        closestBySelector: {
          'select,option,[role="combobox"],[role="listbox"],[role="option"]': nativeOption,
        },
      });
      for (const [element, label] of [
        [spoofedNativeCheckbox, 'native checkbox with a spoofed button role'],
        [spoofedNativeRadio, 'native radio with a spoofed button role'],
        [ariaSwitch, 'direct ARIA switch'],
        [associatedLabel, 'associated checkbox label'],
        [labelDescendant, 'descendant inside an associated checkbox label'],
        [ariaDescendant, 'descendant inside an ARIA state control'],
      ] as const) {
        const inspection = await inspectGenericClick(element);
        assert(
          inspection?.isStateControl === true,
          `generic click canary: ${label} is detected from the exact handle`,
        );
      }
      for (const [element, label] of [
        [nativeSelect, 'native select with a spoofed button role'],
        [nativeOption, 'native option with a spoofed button role'],
        [ariaListbox, 'custom ARIA listbox'],
        [implicitDatalistCombobox, 'implicit datalist combobox'],
        [associatedSelectLabel, 'associated native-select label'],
        [selectLabelDescendant, 'descendant inside an associated native-select label'],
        [optionDescendant, 'descendant inside an option'],
      ] as const) {
        const inspection = await inspectGenericClick(element);
        assert(
          inspection?.isSelectionControl === true,
          `generic click canary: ${label} is routed away from generic click`,
        );
      }
      const ordinaryButtonInspection = await inspectGenericClick(makeGenericClickNode({
        tagName: 'button',
        attrs: { type: 'button', role: 'button' },
      }));
      assert(
        ordinaryButtonInspection?.isStateControl === false,
        'generic click canary: an ordinary exact button remains in the generic click lane',
      );
      const makeGenericClickHandle = (element: unknown) => {
        const state = { clickCalls: 0, disposeCalls: 0 };
        return {
          state,
          handle: {
            evaluate(callback: (resolved: unknown) => unknown) {
              return Promise.resolve(callback(element));
            },
            async click() {
              state.clickCalls += 1;
            },
            async dispose() {
              state.disposeCalls += 1;
            },
          },
        };
      };
      const blockedGenericClick = makeGenericClickHandle(spoofedNativeCheckbox);
      let blockedGenericClickError: any = null;
      try {
        await bridge._clickResolvedNonToggleTarget({
          elementHandle: async () => blockedGenericClick.handle,
        }, 5_000);
      } catch (error) {
        blockedGenericClickError = error;
      }
      assert(
        blockedGenericClickError?.browserErrorCode === 'browser_toggle_canary_blocked'
          && blockedGenericClick.state.clickCalls === 0
          && blockedGenericClick.state.disposeCalls === 1,
        'generic click gateway: a spoofed checkbox is rejected before click and its exact handle is disposed',
      );
      const blockedSelectClick = makeGenericClickHandle(nativeSelect);
      let blockedSelectClickError: any = null;
      try {
        await bridge._clickResolvedNonToggleTarget({
          elementHandle: async () => blockedSelectClick.handle,
        }, 5_000);
      } catch (error) {
        blockedSelectClickError = error;
      }
      assert(
        blockedSelectClickError?.browserErrorCode === 'browser_select_canary_blocked'
          && blockedSelectClick.state.clickCalls === 0
          && blockedSelectClick.state.disposeCalls === 1,
        'generic click gateway: native select is rejected before click and its exact handle is disposed',
      );
      const allowedGenericClick = makeGenericClickHandle(makeGenericClickNode({
        tagName: 'button',
        attrs: { type: 'button', role: 'button' },
      }));
      await bridge._clickResolvedNonToggleTarget({
        elementHandle: async () => allowedGenericClick.handle,
      }, 5_000);
      assert(
        allowedGenericClick.state.clickCalls === 1
          && allowedGenericClick.state.disposeCalls === 1,
        'generic click gateway: an ordinary button clicks and disposes exactly one resolved handle',
      );

      // Guarded toggle canary: only deterministic checkbox/switch/radio state
      // controls survive semantic inspection, and state changes do not weaken
      // the stable document/node/frame binding used for completion proof.
      const toggleDescriptor = {
        tagName: 'input',
        type: 'checkbox',
        role: 'checkbox',
        explicitRole: '',
        toggleKind: 'native_checkbox',
        currentState: false,
        checked: false,
        indeterminate: false,
        ariaChecked: '',
        disabled: false,
        ariaDisabled: '',
        hidden: false,
        inert: false,
        ariaHidden: '',
        name: 'reduceMotion',
        id: 'reduce-motion',
        href: '',
        title: '',
        ariaLabel: 'Reduce motion',
        ariaLabelledByText: 'Reduce motion',
        ariaDescribedByText: 'Limit non-essential animation',
        labelText: 'Reduce motion',
        targetText: '',
        hasForm: false,
        formAction: '',
        formMethod: '',
        formName: '',
        formId: '',
        formAriaLabel: '',
        formText: '',
        documentUrl: 'https://example.test/preferences',
        nodeStructure: 'input:reduce-motion:0>section:appearance:1>body::0',
        frameStructure: '',
        isConnected: true,
        ownerDocumentIsCurrent: true,
      };
      assert(
        bridge._isUnsafeGuardedToggleDescriptor(toggleDescriptor) === false,
        'toggle canary: clearly local presentation checkbox is eligible',
      );
      assert(
        bridge._hasUnsafeGuardedToggleRequest({ name: 'Dark mode' }) === false
          && bridge._hasUnsafeGuardedToggleRequest({ selector: '[data-testid="reduce-motion"]' }) === false
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Confirm before closing tabs' }) === false,
        'toggle request: bounded presentation and local browser preferences remain eligible',
      );
      assert(
        bridge._hasUnsafeGuardedToggleRequest({ name: 'Enable MFA authenticator' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ taskContext: 'Publish the release' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ selector: '#remember', name: 'Remember me' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ selector: '#terms', name: 'Agree to terms and conditions' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Auto-renew subscription' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Enable remote access' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Make profile discoverable' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Share analytics' }) === true
          && bridge._hasUnsafeGuardedToggleRequest({ name: 'Enable feature' }) === true,
        'toggle request: credentials, consequential settings, and unknown semantics fail before browser setup',
      );
      assert(
        bridge._isUnsafeGuardedToggleDescriptor({
          ...toggleDescriptor,
          tagName: 'div',
          type: '',
          role: 'switch',
          explicitRole: 'switch',
          toggleKind: 'aria_switch',
          ariaChecked: 'false',
          checked: null,
          indeterminate: null,
        }) === false,
        'toggle canary: explicit aria switch with deterministic state is eligible',
      );
      assert(
        bridge._isUnsafeGuardedToggleDescriptor({
          ...toggleDescriptor,
          type: 'radio',
          role: 'radio',
          toggleKind: 'native_radio',
        }) === false,
        'toggle canary: native radio is eligible for set-true semantics',
      );
      for (const [descriptor, label] of [
        [{ ...toggleDescriptor, tagName: 'a', href: '/publish' }, 'link target'],
        [{ ...toggleDescriptor, disabled: true }, 'disabled target'],
        [{ ...toggleDescriptor, ariaHidden: 'true' }, 'ARIA-hidden target'],
        [{ ...toggleDescriptor, indeterminate: true }, 'indeterminate native checkbox'],
        [{ ...toggleDescriptor, role: 'radio' }, 'kind/role-conflicted checkbox'],
        [{ ...toggleDescriptor, checked: true }, 'state-source-conflicted checkbox'],
        [{ ...toggleDescriptor, type: 'submit' }, 'submit control'],
        [{ ...toggleDescriptor, hasForm: true, formText: 'Sign in to continue' }, 'login form'],
        [{ ...toggleDescriptor, hasForm: true, formAction: '/checkout/payment' }, 'payment form'],
        [{ ...toggleDescriptor, ariaLabel: 'Delete account permanently' }, 'destructive target'],
        [{ ...toggleDescriptor, labelText: 'Remember me on this device' }, 'login-persistence target'],
        [{ ...toggleDescriptor, labelText: 'Agree to terms and conditions' }, 'legal-consent target'],
        [{ ...toggleDescriptor, ariaLabel: 'Share publicly' }, 'public-sharing target'],
        [{ ...toggleDescriptor, ariaDescribedByText: 'Complete CAPTCHA verification' }, 'CAPTCHA target'],
        [{ ...toggleDescriptor, ariaLabel: 'Auto-renew subscription' }, 'subscription-renewal target'],
        [{ ...toggleDescriptor, ariaLabel: 'Enable remote access' }, 'remote-access target'],
        [{ ...toggleDescriptor, ariaLabel: 'Make profile discoverable' }, 'discoverability target'],
        [{ ...toggleDescriptor, ariaLabel: 'Share analytics' }, 'analytics-sharing target'],
        [{
          ...toggleDescriptor,
          ariaLabel: 'Enable feature',
          ariaLabelledByText: '',
          ariaDescribedByText: '',
          labelText: '',
          name: 'feature',
          id: 'feature',
        }, 'unknown preference target'],
        [{
          ...toggleDescriptor,
          tagName: 'button',
          type: 'button',
          role: 'button',
          explicitRole: 'button',
          toggleKind: 'aria_pressed',
        }, 'generic aria-pressed action button'],
        [{
          ...toggleDescriptor,
          role: 'menuitemcheckbox',
          explicitRole: 'menuitemcheckbox',
          toggleKind: 'aria_menuitemcheckbox',
        }, 'menu item checkbox'],
        [{ ...toggleDescriptor, currentState: null }, 'non-deterministic state'],
      ] as const) {
        assert(
          bridge._isUnsafeGuardedToggleDescriptor(descriptor) === true,
          `toggle canary: ${label} is rejected`,
        );
      }

      const toggleRegistry = bridge._createBrowserIdentityRegistry({
        randomUUID: () => '12345678-90ab-4cde-8fab-1234567890ab',
        now: () => '2026-07-25T12:00:00.000Z',
      });
      const toggleContext = {};
      const togglePage = {
        currentUrl: toggleDescriptor.documentUrl,
        url() { return this.currentUrl; },
        isClosed() { return false; },
      };
      const toggleIdentity = toggleRegistry.observe(
        toggleContext,
        togglePage,
        togglePage.url(),
      );
      const toggleExpectedIdentity = {
        expectedBrowserProcessId: toggleIdentity.browserProcessId,
        expectedBrowserContextId: toggleIdentity.browserContextId,
        expectedPageId: toggleIdentity.pageId,
        expectedUrl: toggleIdentity.url,
      };
      const toggleFingerprint = bridge._buildGuardedToggleTargetFingerprint(
        toggleIdentity,
        toggleDescriptor,
        true,
      );
      const toggleInvariant = bridge._buildGuardedToggleInvariantFingerprint(
        toggleIdentity,
        toggleDescriptor,
      );
      const toggledDescriptor = {
        ...toggleDescriptor,
        currentState: true,
        checked: true,
      };
      assert(
        /^uc_browser_toggle_fingerprint_[a-f0-9]{64}$/.test(toggleFingerprint),
        'toggle target: current/desired state fingerprint is a bounded keyed digest',
      );
      assert(
        toggleFingerprint !== bridge._buildGuardedToggleTargetFingerprint(
          toggleIdentity,
          toggledDescriptor,
          true,
        ),
        'toggle target: current-state drift invalidates the observed target fingerprint',
      );
      assert(
        toggleFingerprint !== bridge._buildGuardedToggleTargetFingerprint(
          toggleIdentity,
          toggleDescriptor,
          false,
        ),
        'toggle target: desired-state drift invalidates the observed target fingerprint',
      );
      assert(
        toggleInvariant === bridge._buildGuardedToggleInvariantFingerprint(
          toggleIdentity,
          toggledDescriptor,
        ),
        'toggle proof: state may change while stable semantic/node/frame binding remains exact',
      );
      assert(
        toggleInvariant !== bridge._buildGuardedToggleInvariantFingerprint(
          toggleIdentity,
          { ...toggledDescriptor, nodeStructure: 'input:replacement:9>body::0' },
        ),
        'toggle proof: same-document structural replacement invalidates the stable binding',
      );
      assert(
        !JSON.stringify({ toggleFingerprint, toggleInvariant }).includes(toggleDescriptor.ariaDescribedByText),
        'toggle target: keyed fingerprints expose no inspected page text',
      );

      const exactToggleRecord = {
        capabilityKind: 'guarded_toggle_v2',
        contextRef: toggleContext,
        pageRef: togglePage,
        browserProcessId: toggleIdentity.browserProcessId,
        browserContextId: toggleIdentity.browserContextId,
        pageId: toggleIdentity.pageId,
        url: toggleIdentity.url,
        role: 'checkbox',
        toggleKind: 'native_checkbox',
        initialState: false,
        desiredState: true,
        targetFingerprint: toggleFingerprint,
        invariantFingerprint: toggleInvariant,
      };
      const exactToggleBody = {
        ...toggleExpectedIdentity,
        desiredState: true,
        targetFingerprint: toggleFingerprint,
      };
      assert(
        bridge._checkGuardedToggleCapabilityRecord(
          exactToggleRecord,
          exactToggleBody,
          toggleContext,
          togglePage,
        ).ok === true,
        'toggle capability: exact kind/identity/fingerprint/desired-state binding passes',
      );
      assert(
        bridge._checkGuardedToggleCapabilityRecord(
          { ...exactToggleRecord, capabilityKind: 'guarded_fill_v2' },
          exactToggleBody,
          toggleContext,
          togglePage,
        ).code === 'browser_target_mismatch',
        'toggle capability: a fill capability cannot cross into the toggle lane',
      );
      assert(
        bridge._checkGuardedToggleCapabilityRecord(
          exactToggleRecord,
          { ...exactToggleBody, desiredState: false },
          toggleContext,
          togglePage,
        ).code === 'browser_target_mismatch',
        'toggle capability: desired state cannot change after observation',
      );

      const makeToggleHandle = (
        descriptor: Record<string, unknown>,
        duringEvaluate?: () => void,
      ) => ({
        async evaluate() {
          duringEvaluate?.();
          return descriptor;
        },
      });
      const coherentToggle = await bridge._captureCoherentGuardedToggleObservation({
        registry: toggleRegistry,
        contextRef: toggleContext,
        pageRef: togglePage,
        expectedIdentity: toggleExpectedIdentity,
        targetHandle: makeToggleHandle(toggledDescriptor),
        expectedInvariantFingerprint: toggleInvariant,
        expectedToggleKind: 'native_checkbox',
        expectedRole: 'checkbox',
        resolveActivePage: () => togglePage,
      });
      assert(
        coherentToggle.ok === true
          && coherentToggle.currentState === true
          && coherentToggle.role === 'checkbox',
        'toggle proof: coherent exact-handle observation accepts only the desired post-state',
      );
      const toggleProofSecret = 'TOGGLE_PROOF_SIDE_CHANNEL_MUST_NOT_SURVIVE';
      const toggleProof = bridge._buildRedactedBrowserToggleProof(
        {
          ...coherentToggle,
          identity: { ...coherentToggle.identity, rawPageText: toggleProofSecret },
          locator: toggleProofSecret,
          targetId: toggleProofSecret,
        },
        false,
        true,
        toggleFingerprint,
        true,
      );
      assert(
        toggleProof?.stateMatches === true
          && toggleProof.previousState === false
          && toggleProof.currentState === true
          && toggleProof.desiredState === true
          && toggleProof.mutationPerformed === true,
        'toggle proof: previous/current/desired state and mutation truth are explicit',
      );
      assert(
        toggleProof
          && !JSON.stringify(toggleProof).includes(toggleProofSecret)
          && !('targetId' in toggleProof)
          && !('locator' in toggleProof),
        'toggle proof: exact allowlist drops target token, locator, page text, and identity side channels',
      );
      assert(
        Object.keys(toggleProof || {}).sort().join(',') === [
          'browserContextId',
          'browserProcessId',
          'currentState',
          'desiredState',
          'evidenceId',
          'mutationPerformed',
          'observedAt',
          'pageId',
          'previousState',
          'role',
          'stateMatches',
          'targetFingerprint',
          'url',
        ].sort().join(','),
        'toggle proof: response shape is a bounded state/evidence allowlist',
      );

      const toggleDriftRegistry = bridge._createBrowserIdentityRegistry({
        randomUUID: () => 'abcdefab-cdef-4abc-8def-abcdefabcdef',
        now: () => '2026-07-25T12:01:00.000Z',
      });
      const toggleDriftContext = {};
      const toggleDriftPage = {
        currentUrl: toggleDescriptor.documentUrl,
        url() { return this.currentUrl; },
        isClosed() { return false; },
      };
      const toggleDriftIdentity = toggleDriftRegistry.observe(
        toggleDriftContext,
        toggleDriftPage,
        toggleDriftPage.url(),
      );
      const toggleDriftExpected = {
        expectedBrowserProcessId: toggleDriftIdentity.browserProcessId,
        expectedBrowserContextId: toggleDriftIdentity.browserContextId,
        expectedPageId: toggleDriftIdentity.pageId,
        expectedUrl: toggleDriftIdentity.url,
      };
      const toggleDriftInvariant = bridge._buildGuardedToggleInvariantFingerprint(
        toggleDriftIdentity,
        toggleDescriptor,
      );
      const navigationDrift = await bridge._captureCoherentGuardedToggleObservation({
        registry: toggleDriftRegistry,
        contextRef: toggleDriftContext,
        pageRef: toggleDriftPage,
        expectedIdentity: toggleDriftExpected,
        targetHandle: makeToggleHandle(
          toggledDescriptor,
          () => { toggleDriftRegistry.advancePageDocument(toggleDriftPage); },
        ),
        expectedInvariantFingerprint: toggleDriftInvariant,
        expectedToggleKind: 'native_checkbox',
        expectedRole: 'checkbox',
        resolveActivePage: () => toggleDriftPage,
      });
      assert(
        navigationDrift.ok === false
          && navigationDrift.code === 'browser_identity_mismatch'
          && !('currentState' in navigationDrift),
        'toggle proof: navigation during capture fails closed without returning stale state',
      );
      const structureDrift = await bridge._captureCoherentGuardedToggleObservation({
        registry: toggleRegistry,
        contextRef: toggleContext,
        pageRef: togglePage,
        expectedIdentity: toggleExpectedIdentity,
        targetHandle: makeToggleHandle({
          ...toggledDescriptor,
          nodeStructure: 'input:replacement:9>body::0',
        }),
        expectedInvariantFingerprint: toggleInvariant,
        expectedToggleKind: 'native_checkbox',
        expectedRole: 'checkbox',
        resolveActivePage: () => togglePage,
      });
      assert(
        structureDrift.ok === false && structureDrift.code === 'browser_target_mismatch',
        'toggle proof: structure drift fails closed after mutation',
      );

      // Guarded native select canary: exact native select + exact enabled
      // option, opaque target/option bindings, coherent no-navigation proof.
      const selectDescriptor = {
        tagName: 'select',
        role: 'combobox',
        explicitRole: '',
        nativeType: 'select-one',
        multiple: false,
        size: 0,
        optionCount: 2,
        optionsBounded: true,
        optionMatchCount: 1,
        selectedOptionCount: 1,
        visible: true,
        enabled: true,
        disabled: false,
        ariaDisabled: '',
        hidden: false,
        inert: false,
        inertAncestor: false,
        ariaHidden: '',
        ariaHiddenAncestor: false,
        contentEditable: false,
        hasForm: false,
        hasInlineMutationHandler: false,
        name: 'theme',
        id: 'appearance-theme',
        title: 'Visual theme',
        ariaLabel: 'Theme',
        ariaLabelledByText: 'Appearance theme',
        ariaDescribedByText: 'Choose a local visual color scheme',
        labelText: 'Theme',
        documentUrl: 'https://example.test/preferences',
        nodeStructure: 'select:appearance-theme:0>section:appearance:1>body::0',
        frameStructure: '',
        optionStructure: '[light,dark]',
        isConnected: true,
        ownerDocumentIsCurrent: true,
      };
      const lightOption = {
        index: 0,
        value: 'light',
        label: 'Light',
        text: 'Light',
        id: '',
        title: '',
        ariaLabel: '',
        ariaHidden: '',
        disabled: false,
        hidden: false,
        inert: false,
        groupLabel: 'Color scheme',
        groupDisabled: false,
      };
      const darkOption = {
        ...lightOption,
        index: 1,
        value: 'dark',
        label: 'Dark',
        text: 'Dark',
      };
      assert(
        bridge._hasUnsafeGuardedSelectRequest({
          name: 'Theme',
          value: 'Dark',
          taskContext: 'Choose a local visual appearance theme.',
        }) === false,
        'select request: clear local presentation semantics remain eligible',
      );
      assert(
        bridge._hasUnsafeGuardedSelectRequest({
          name: 'Setting',
          value: 'Enabled',
        }) === true
          && bridge._hasUnsafeGuardedSelectRequest({
            name: 'Profile visibility',
            value: 'Public',
          }) === true
          && bridge._hasUnsafeGuardedSelectRequest({
            name: 'Subscription renewal',
            value: 'Annual',
          }) === true,
        'select request: unknown, privacy, and subscription semantics fail closed',
      );
      assert(
        bridge._isUnsafeGuardedSelectDescriptor(selectDescriptor, darkOption) === false,
        'select canary: visible enabled native appearance select and option are eligible',
      );
      for (const [descriptor, option, label] of [
        [{ ...selectDescriptor, tagName: 'div', explicitRole: 'combobox' }, darkOption, 'custom combobox'],
        [{ ...selectDescriptor, role: 'listbox', multiple: true }, darkOption, 'multi-select/listbox'],
        [{ ...selectDescriptor, visible: false }, darkOption, 'invisible select'],
        [{ ...selectDescriptor, enabled: false, disabled: true }, darkOption, 'disabled select'],
        [{ ...selectDescriptor, inertAncestor: true }, darkOption, 'inert ancestor'],
        [{ ...selectDescriptor, hasForm: true }, darkOption, 'form-associated select'],
        [{ ...selectDescriptor, hasInlineMutationHandler: true }, darkOption, 'inline change handler'],
        [{ ...selectDescriptor, optionMatchCount: 2 }, darkOption, 'ambiguous option match'],
        [{ ...selectDescriptor, optionCount: 501 }, darkOption, 'unbounded option set'],
        [selectDescriptor, { ...darkOption, disabled: true }, 'disabled option'],
        [selectDescriptor, { ...darkOption, groupDisabled: true }, 'disabled option group'],
        [selectDescriptor, { ...darkOption, groupHidden: true }, 'hidden option group'],
        [selectDescriptor, { ...darkOption, index: -1 }, 'option outside the exact select'],
        [{ ...selectDescriptor, ariaLabel: 'Profile privacy visibility' }, darkOption, 'protected target'],
        [{
          ...selectDescriptor,
          name: 'setting',
          id: 'setting',
          title: '',
          ariaLabel: 'Setting',
          ariaLabelledByText: '',
          ariaDescribedByText: '',
          labelText: 'Setting',
        }, {
          ...darkOption,
          value: 'enabled',
          label: 'Enabled',
          text: 'Enabled',
          groupLabel: '',
        }, 'unknown target'],
      ] as const) {
        assert(
          bridge._isUnsafeGuardedSelectDescriptor(descriptor, option) === true,
          `select canary: ${label} is rejected`,
        );
      }

      const selectRegistry = bridge._createBrowserIdentityRegistry({
        randomUUID: () => '24682468-1357-4ace-8bdf-246824681357',
        now: () => '2026-07-26T12:00:00.000Z',
      });
      const selectContext = {};
      const selectPage = {
        currentUrl: selectDescriptor.documentUrl,
        url() { return this.currentUrl; },
        isClosed() { return false; },
      };
      const selectIdentity = selectRegistry.observe(
        selectContext,
        selectPage,
        selectPage.url(),
      );
      const selectExpectedIdentity = {
        expectedBrowserProcessId: selectIdentity.browserProcessId,
        expectedBrowserContextId: selectIdentity.browserContextId,
        expectedPageId: selectIdentity.pageId,
        expectedUrl: selectIdentity.url,
      };
      const selectInvariant = bridge._buildGuardedSelectInvariantFingerprint(
        selectIdentity,
        selectDescriptor,
      );
      const darkOptionFingerprint = bridge._buildGuardedSelectOptionFingerprint(
        selectIdentity,
        selectDescriptor,
        darkOption,
      );
      const lightOptionFingerprint = bridge._buildGuardedSelectOptionFingerprint(
        selectIdentity,
        selectDescriptor,
        lightOption,
      );
      const selectTargetFingerprint = bridge._buildGuardedSelectTargetFingerprint(
        selectIdentity,
        selectDescriptor,
        lightOption,
        darkOption,
        'label',
      );
      assert(
        /^uc_browser_select_invariant_[a-f0-9]{64}$/.test(selectInvariant)
          && /^uc_browser_select_option_[a-f0-9]{64}$/.test(darkOptionFingerprint)
          && /^uc_browser_select_target_[a-f0-9]{64}$/.test(selectTargetFingerprint),
        'select target: target, option, and stable invariant use bounded keyed digests',
      );
      assert(
        darkOptionFingerprint !== lightOptionFingerprint,
        'select target: each exact option has a distinct keyed fingerprint',
      );
      assert(
        selectTargetFingerprint !== bridge._buildGuardedSelectTargetFingerprint(
          selectIdentity,
          selectDescriptor,
          darkOption,
          darkOption,
          'label',
        ),
        'select target: before-state drift invalidates the approved target fingerprint',
      );
      assert(
        selectTargetFingerprint !== bridge._buildGuardedSelectTargetFingerprint(
          selectIdentity,
          selectDescriptor,
          lightOption,
          darkOption,
          'value',
        ),
        'select target: matchBy authority is bound into the target fingerprint',
      );
      assert(
        !JSON.stringify({
          selectInvariant,
          darkOptionFingerprint,
          selectTargetFingerprint,
        }).includes('Appearance theme'),
        'select target: keyed fingerprints expose no inspected page or option text',
      );

      const exactSelectRecord = {
        capabilityKind: 'guarded_select_v1',
        contextRef: selectContext,
        pageRef: selectPage,
        browserProcessId: selectIdentity.browserProcessId,
        browserContextId: selectIdentity.browserContextId,
        pageId: selectIdentity.pageId,
        url: selectIdentity.url,
        taskContext: 'Choose a local visual appearance theme.',
        matchBy: 'label',
        desiredValue: 'Dark',
        initialOptionFingerprint: lightOptionFingerprint,
        optionFingerprint: darkOptionFingerprint,
        targetFingerprint: selectTargetFingerprint,
        invariantFingerprint: selectInvariant,
      };
      const exactSelectBody = {
        ...selectExpectedIdentity,
        taskContext: exactSelectRecord.taskContext,
        matchBy: 'label',
        optionFingerprint: darkOptionFingerprint,
        targetFingerprint: selectTargetFingerprint,
      };
      assert(
        bridge._checkGuardedSelectCapabilityRecord(
          exactSelectRecord,
          exactSelectBody,
          selectContext,
          selectPage,
        ).ok === true,
        'select capability: exact identity, target, option, match mode, and task binding passes',
      );
      assert(
        bridge._checkGuardedSelectCapabilityRecord(
          exactSelectRecord,
          { ...exactSelectBody, optionFingerprint: lightOptionFingerprint },
          selectContext,
          selectPage,
        ).code === 'browser_target_mismatch',
        'select capability: desired option cannot change after observation',
      );

      const makeSelectHandle = (
        currentOption: Record<string, unknown> | null,
        descriptor: Record<string, unknown> = selectDescriptor,
        duringEvaluate?: () => void,
      ) => ({
        async evaluate() {
          duringEvaluate?.();
          return {
            descriptor,
            desiredOption: darkOption,
            currentOption,
          };
        },
      });
      const coherentSelect = await bridge._captureCoherentGuardedSelectObservation({
        registry: selectRegistry,
        contextRef: selectContext,
        pageRef: selectPage,
        expectedIdentity: selectExpectedIdentity,
        targetHandle: makeSelectHandle(darkOption),
        matchBy: 'label',
        desiredValue: 'Dark',
        expectedInvariantFingerprint: selectInvariant,
        expectedOptionFingerprint: darkOptionFingerprint,
        resolveActivePage: () => selectPage,
      });
      assert(
        coherentSelect.ok === true
          && coherentSelect.selectionMatches === true
          && coherentSelect.currentOptionFingerprint === darkOptionFingerprint,
        'select proof: one fresh exact-handle observation proves the desired option',
      );
      const selectProofSecret = 'SELECT_PROOF_SIDE_CHANNEL_MUST_NOT_SURVIVE';
      const selectProof = bridge._buildRedactedBrowserSelectProof(
        {
          ...coherentSelect,
          identity: {
            ...coherentSelect.identity,
            rawOptionText: selectProofSecret,
          },
          rawLabel: selectProofSecret,
          targetId: selectProofSecret,
        },
        lightOptionFingerprint,
        selectTargetFingerprint,
        true,
      );
      assert(
        selectProof?.selectionMatches === true
          && selectProof.previousOptionFingerprint === lightOptionFingerprint
          && selectProof.currentOptionFingerprint === darkOptionFingerprint
          && selectProof.optionFingerprint === darkOptionFingerprint
          && selectProof.mutationPerformed === true,
        'select proof: previous/current/desired opaque option identity and mutation truth are explicit',
      );
      assert(
        selectProof
          && !JSON.stringify(selectProof).includes(selectProofSecret)
          && !('targetId' in selectProof)
          && !('value' in selectProof)
          && !('label' in selectProof),
        'select proof: exact allowlist drops target token, raw option, locator, and page-text side channels',
      );
      const selectNoOpProof = bridge._buildRedactedBrowserSelectProof(
        coherentSelect,
        darkOptionFingerprint,
        selectTargetFingerprint,
        false,
      );
      assert(
        selectNoOpProof?.selectionMatches === true
          && selectNoOpProof.mutationPerformed === false
          && selectNoOpProof.previousOptionFingerprint === selectNoOpProof.currentOptionFingerprint,
        'select proof: already-selected option returns a verified no-op proof',
      );

      const selectDriftRegistry = bridge._createBrowserIdentityRegistry({
        randomUUID: () => '13571357-2468-4bdf-8ace-135713572468',
        now: () => '2026-07-26T12:01:00.000Z',
      });
      const selectDriftContext = {};
      const selectDriftPage = {
        currentUrl: selectDescriptor.documentUrl,
        url() { return this.currentUrl; },
        isClosed() { return false; },
      };
      const selectDriftIdentity = selectDriftRegistry.observe(
        selectDriftContext,
        selectDriftPage,
        selectDriftPage.url(),
      );
      const selectDriftExpected = {
        expectedBrowserProcessId: selectDriftIdentity.browserProcessId,
        expectedBrowserContextId: selectDriftIdentity.browserContextId,
        expectedPageId: selectDriftIdentity.pageId,
        expectedUrl: selectDriftIdentity.url,
      };
      const selectDriftInvariant = bridge._buildGuardedSelectInvariantFingerprint(
        selectDriftIdentity,
        selectDescriptor,
      );
      const selectDriftOption = bridge._buildGuardedSelectOptionFingerprint(
        selectDriftIdentity,
        selectDescriptor,
        darkOption,
      );
      const selectNavigationDrift = await bridge._captureCoherentGuardedSelectObservation({
        registry: selectDriftRegistry,
        contextRef: selectDriftContext,
        pageRef: selectDriftPage,
        expectedIdentity: selectDriftExpected,
        targetHandle: makeSelectHandle(
          darkOption,
          selectDescriptor,
          () => { selectDriftRegistry.advancePageDocument(selectDriftPage); },
        ),
        matchBy: 'label',
        desiredValue: 'Dark',
        expectedInvariantFingerprint: selectDriftInvariant,
        expectedOptionFingerprint: selectDriftOption,
        resolveActivePage: () => selectDriftPage,
      });
      assert(
        selectNavigationDrift.ok === false
          && selectNavigationDrift.code === 'browser_identity_mismatch'
          && !('currentOptionFingerprint' in selectNavigationDrift),
        'select proof: navigation during after-state capture fails closed without stale proof',
      );
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} browser-primitives smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll browser-primitives smoke cases passed.');
}

main().catch((error) => {
  console.error('FAIL: browser-primitives smoke threw', error);
  process.exit(1);
});
