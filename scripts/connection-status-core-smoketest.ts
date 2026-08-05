/**
 * connection-status-core-smoketest — guards the PURE app-wide connection-health
 * aggregator (src/lib/connectionStatusCore.ts, Finding 5 of
 * docs/CHAT_OFFICE_FEED_NEXT_GAPS.md). Covers:
 *
 *   - aggregateConnectionStatus roll-up: all healthy → online; all down →
 *     offline; nothing healthy + reconnecting → reconnecting; mixed → degraded;
 *     empty/non-array → online.
 *   - state vocab: per-channel ConnectionStatus (live|reconnecting|connecting|
 *     offline) AND raw Supabase statuses (SUBSCRIBED|CHANNEL_ERROR|TIMED_OUT|
 *     CLOSED).
 *   - degradedIfAnyStale flag + staleThresholdMs override.
 *   - degradedChannels naming + bounded summary preview ("+N more").
 *   - bounds: MAX_CHANNELS scan cap, DEGRADED_LIST_CAP, name/summary clipping.
 *   - connectionBannerModel: null when online; warn 'Reconnecting…' / degraded;
 *     danger offline; accepts a result object; case-insensitive.
 *   - connectionStatusLabel.
 *   - hostile no-throw: null / undefined / scalars / cyclic / throwing getters.
 *
 * Imports the REAL module (pure, zero runtime imports).
 *
 * Run: npx tsx scripts/connection-status-core-smoketest.ts
 */

import {
  aggregateConnectionStatus,
  connectionBannerModel,
  connectionStatusLabel,
  isAppConnectionStatus,
  APP_CONNECTION_STATUSES,
  DEFAULT_STALE_THRESHOLD_MS,
  MAX_CHANNELS,
  DEGRADED_LIST_CAP,
  RECONNECTING_BANNER_TEXT,
  DEGRADED_BANNER_TEXT,
  OFFLINE_BANNER_TEXT,
  type AppConnectionStatus,
} from '../src/lib/connectionStatusCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) constants / export sanity ────────────────────────────────────────
  assertEq(DEFAULT_STALE_THRESHOLD_MS, 60_000, '(1) default stale threshold 60s');
  assertEq(MAX_CHANNELS, 1000, '(1) MAX_CHANNELS bounded at 1000');
  assertEq(DEGRADED_LIST_CAP, 50, '(1) DEGRADED_LIST_CAP is 50');
  assertEq(APP_CONNECTION_STATUSES.length, 4, '(1) four app statuses');
  for (const s of APP_CONNECTION_STATUSES) assert(isAppConnectionStatus(s), `(1) ${s} is a valid status`);
  assertEq(RECONNECTING_BANNER_TEXT, 'Reconnecting…', '(1) reconnecting copy pinned');
  assertEq(DEGRADED_BANNER_TEXT, 'Some live data may be stale', '(1) degraded copy pinned');
  assertEq(OFFLINE_BANNER_TEXT, "You're offline — data may be stale", '(1) offline copy pinned');

  // ─── (2) empty / non-array → online, no banner, "No live connections" ─────
  for (const empty of [[], null, undefined, 42, 'x', {}, true] as unknown[]) {
    const r = aggregateConnectionStatus(empty);
    assertEq(r.status, 'online', `(2) empty-ish ${JSON.stringify(empty)} → online`);
    assertEq(r.degradedChannels.length, 0, '(2) no degraded channels');
    assertEq(r.summary, 'No live connections', '(2) empty summary');
    assertEq(connectionBannerModel(r), null, '(2) online → no banner');
  }
  // an array of only garbage entries is still "empty" (all skipped)
  {
    const r = aggregateConnectionStatus([null, 1, 'x', true, undefined, NaN]);
    assertEq(r.status, 'online', '(2) all-garbage array → online');
    assertEq(r.summary, 'No live connections', '(2) all-garbage summary');
  }

  // ─── (3) all healthy → online (vocab + raw Supabase SUBSCRIBED) ───────────
  {
    const r = aggregateConnectionStatus([
      { name: 'a', state: 'live' },
      { name: 'b', state: 'SUBSCRIBED' },
      { name: 'c', state: 'connected' },
      { name: 'd', state: 'JOINED' },
    ]);
    assertEq(r.status, 'online', '(3) all healthy → online');
    assertEq(r.degradedChannels.length, 0, '(3) online lists no degraded channels');
    assertEq(r.summary, 'All 4 live connections healthy', '(3) online summary');
    assertEq(connectionBannerModel(r.status), null, '(3) online → no banner');
  }
  // singular plural: exactly one healthy channel
  {
    const r = aggregateConnectionStatus([{ name: 'solo', state: 'live' }]);
    assertEq(r.status, 'online', '(3) single healthy → online');
    assertEq(r.summary, 'All 1 live connection healthy', '(3) singular "connection"');
  }

  // ─── (4) all down → offline (offline + raw Supabase error statuses) ───────
  {
    const r = aggregateConnectionStatus([
      { name: 'a', state: 'offline' },
      { name: 'b', state: 'CHANNEL_ERROR' },
      { name: 'c', state: 'TIMED_OUT' },
      { name: 'd', state: 'CLOSED' },
    ]);
    assertEq(r.status, 'offline', '(4) all down → offline');
    assertEq(r.degradedChannels.length, 4, '(4) every down channel is listed');
    assertEq(r.summary, 'All 4 live connections offline — data may be stale', '(4) offline summary');
    const b = connectionBannerModel(r.status);
    assert(b !== null, '(4) offline shows a banner');
    assertEq(b?.show, true, '(4) offline banner shows');
    assertEq(b?.tone, 'danger', '(4) offline banner is danger');
    assertEq(b?.text, OFFLINE_BANNER_TEXT, '(4) offline banner text');
  }

  // ─── (5) nothing healthy + reconnecting → reconnecting ────────────────────
  {
    const r = aggregateConnectionStatus([
      { name: 'a', state: 'reconnecting' },
      { name: 'b', state: 'connecting' },
    ]);
    assertEq(r.status, 'reconnecting', '(5) all reconnecting → reconnecting');
    assertEq(r.summary, 'Reconnecting 2 of 2 live connections…', '(5) reconnecting summary');
    assertEq(r.degradedChannels.join(','), 'a,b', '(5) reconnecting channels listed');
    const b = connectionBannerModel(r.status);
    assertEq(b?.tone, 'warn', '(5) reconnecting banner is warn');
    assertEq(b?.text, RECONNECTING_BANNER_TEXT, '(5) reconnecting banner text');
  }
  // reconnecting + down but NOT all down, nothing healthy → still reconnecting (hopeful)
  {
    const r = aggregateConnectionStatus([{ state: 'reconnecting' }, { state: 'offline' }]);
    assertEq(r.status, 'reconnecting', '(5) reconnecting beats partial-down when nothing healthy');
    assertEq(r.degradedChannels.join(','), 'channel-0,channel-1', '(5) missing names fall back to channel-<i>');
  }

  // ─── (6) mixed healthy + trouble → degraded (+ named summary) ─────────────
  {
    const r = aggregateConnectionStatus([
      { name: 'chat', state: 'live' },
      { name: 'runs', state: 'reconnecting' },
      { name: 'kanban', state: 'offline' },
    ]);
    assertEq(r.status, 'degraded', '(6) some healthy + some trouble → degraded');
    assertEq(r.degradedChannels.join(','), 'runs,kanban', '(6) only non-healthy channels listed, in order');
    assertEq(r.summary, '2 of 3 live connections degraded: runs, kanban', '(6) degraded summary names channels');
    const b = connectionBannerModel(r);
    assertEq(b?.tone, 'warn', '(6) degraded banner is warn');
    assertEq(b?.text, DEGRADED_BANNER_TEXT, '(6) degraded banner text');
  }
  // summary "+N more" when > 5 troubled channels
  {
    const subs = [{ name: 'ok', state: 'live' }];
    for (let i = 0; i < 8; i++) subs.push({ name: `d${i}`, state: 'offline' });
    const r = aggregateConnectionStatus(subs);
    assertEq(r.status, 'degraded', '(6) 1 healthy + 8 down → degraded');
    assert(r.summary.startsWith('8 of 9 live connections degraded: d0, d1, d2, d3, d4'), '(6) previews first 5 names', r.summary);
    assert(r.summary.includes('+3 more'), '(6) summary appends "+3 more"', r.summary);
  }

  // ─── (7) staleness + degradedIfAnyStale flag ──────────────────────────────
  const staleSub = { name: 'feed', state: 'live', staleMs: 120_000 };
  // flag OFF (default): a live-but-stale socket is still healthy → online
  {
    const r = aggregateConnectionStatus([staleSub]);
    assertEq(r.status, 'online', '(7) stale live channel is healthy when flag off');
    assertEq(connectionBannerModel(r.status), null, '(7) flag off → no banner');
  }
  // flag ON: stale beyond threshold → degraded + warn banner (the headline case)
  {
    const r = aggregateConnectionStatus([staleSub], { degradedIfAnyStale: true });
    assertEq(r.status, 'degraded', '(7) stale live channel degrades with flag on');
    assertEq(r.degradedChannels.join(','), 'feed', '(7) stale channel named');
    assertEq(r.summary, '1 of 1 live connection degraded: feed', '(7) stale degraded summary (singular)');
    const b = connectionBannerModel(r);
    assertEq(b?.show, true, '(7) stale → banner shows');
    assertEq(b?.tone, 'warn', '(7) stale banner is warn');
  }
  // flag ON but staleMs BELOW threshold → still healthy
  {
    const r = aggregateConnectionStatus([{ name: 'feed', state: 'live', staleMs: 5_000 }], { degradedIfAnyStale: true });
    assertEq(r.status, 'online', '(7) fresh-enough channel stays online even with flag on');
  }
  // custom threshold override makes a modestly-old channel count as stale
  {
    const r = aggregateConnectionStatus(
      [{ name: 'feed', state: 'live', staleMs: 5_000 }],
      { degradedIfAnyStale: true, staleThresholdMs: 1_000 },
    );
    assertEq(r.status, 'degraded', '(7) tighter threshold flips a 5s channel to degraded');
  }
  // stale-only (nothing reconnecting) must be degraded, NOT reconnecting
  {
    const r = aggregateConnectionStatus(
      [{ name: 'a', state: 'live', staleMs: 99_999 }, { name: 'b', state: 'ok', staleMs: 99_999 }],
      { degradedIfAnyStale: true },
    );
    assertEq(r.status, 'degraded', '(7) all-stale (no reconnecting) → degraded not reconnecting');
  }

  // ─── (8) precedence / boundaries ──────────────────────────────────────────
  // all down beats any healthy=0 interpretation
  assertEq(aggregateConnectionStatus([{ state: 'offline' }, { state: 'CLOSED' }]).status, 'offline', '(8) every channel down → offline');
  // nothing healthy, reconnecting + down (not all down) → reconnecting
  assertEq(
    aggregateConnectionStatus([{ state: 'reconnecting' }, { state: 'offline' }, { state: 'offline' }]).status,
    'reconnecting',
    '(8) reconnecting present, not all down → reconnecting',
  );
  // unknown / unrecognized states are treated as a live socket (neutral, no alarm)
  {
    const r = aggregateConnectionStatus([{ state: 'weird' }, { state: '???' }, { state: '' }]);
    assertEq(r.status, 'online', '(8) unknown states → online (no false alarm)');
    assertEq(r.degradedChannels.length, 0, '(8) unknown states are not degraded');
  }
  // one healthy among reconnecting → degraded (has fresh data, but partial)
  assertEq(
    aggregateConnectionStatus([{ state: 'live' }, { state: 'reconnecting' }]).status,
    'degraded',
    '(8) one healthy + one reconnecting → degraded',
  );

  // ─── (9) bounds: scan cap, list cap, clipping ─────────────────────────────
  {
    // 5000 down channels — only MAX_CHANNELS scanned, list capped, still offline
    const big = Array.from({ length: 5000 }, (_, i) => ({ name: `x${i}`, state: 'offline' }));
    const r = aggregateConnectionStatus(big);
    assertEq(r.status, 'offline', '(9) huge all-down array → offline');
    assertEq(r.degradedChannels.length, DEGRADED_LIST_CAP, '(9) degradedChannels capped at DEGRADED_LIST_CAP');
    assert(r.summary.length <= 240, '(9) summary stays bounded', `len=${r.summary.length}`);
    assert(r.summary.startsWith('All 1000 live connections offline'), '(9) only MAX_CHANNELS counted', r.summary);
  }
  {
    // 100 reconnecting channels → reconnecting, list still capped
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}`, state: 'reconnecting' }));
    const r = aggregateConnectionStatus(many);
    assertEq(r.status, 'reconnecting', '(9) 100 reconnecting → reconnecting');
    assertEq(r.degradedChannels.length, DEGRADED_LIST_CAP, '(9) reconnecting list capped');
  }
  {
    // long channel name is clipped to <= 80 chars
    const longName = 'z'.repeat(300);
    const r = aggregateConnectionStatus([{ name: longName, state: 'offline' }]);
    assert(r.degradedChannels[0].length <= 80, '(9) channel name clipped to <= 80', `len=${r.degradedChannels[0].length}`);
  }

  // ─── (10) connectionBannerModel across statuses + coercion ────────────────
  assertEq(connectionBannerModel('online'), null, '(10) online → null');
  assertEq(connectionBannerModel('reconnecting')?.tone, 'warn', '(10) reconnecting → warn');
  assertEq(connectionBannerModel('reconnecting')?.text, RECONNECTING_BANNER_TEXT, '(10) reconnecting text');
  assertEq(connectionBannerModel('degraded')?.tone, 'warn', '(10) degraded → warn');
  assertEq(connectionBannerModel('degraded')?.text, DEGRADED_BANNER_TEXT, '(10) degraded text');
  assertEq(connectionBannerModel('offline')?.tone, 'danger', '(10) offline → danger');
  assertEq(connectionBannerModel('offline')?.text, OFFLINE_BANNER_TEXT, '(10) offline text');
  // case / whitespace insensitive
  assertEq(connectionBannerModel('  OFFLINE ')?.tone, 'danger', '(10) case/space-insensitive offline');
  assertEq(connectionBannerModel('ReConnecting')?.tone, 'warn', '(10) mixed-case reconnecting');
  // accepts a whole AggregateConnectionResult object via its .status
  assertEq(connectionBannerModel(aggregateConnectionStatus([{ state: 'offline' }]))?.tone, 'danger', '(10) reads .status off a result object');
  // unrecognized / bad → null
  for (const bad of ['bogus', '', null, undefined, 42, {}, { status: 'nope' }, []] as unknown[]) {
    assertEq(connectionBannerModel(bad), null, `(10) unrecognized ${JSON.stringify(bad)} → null`);
  }

  // ─── (11) connectionStatusLabel ───────────────────────────────────────────
  assertEq(connectionStatusLabel('online'), 'Live', '(11) online label');
  assertEq(connectionStatusLabel('reconnecting'), 'Reconnecting…', '(11) reconnecting label');
  assertEq(connectionStatusLabel('degraded'), 'Degraded', '(11) degraded label');
  assertEq(connectionStatusLabel('offline'), 'Offline', '(11) offline label');
  assertEq(connectionStatusLabel({ status: 'offline' }), 'Offline', '(11) label reads .status object');
  assertEq(connectionStatusLabel('garbage'), 'Live', '(11) unknown label → Live (no alarm)');
  assertEq(connectionStatusLabel(undefined), 'Live', '(11) undefined label → Live');

  // ─── (12) isAppConnectionStatus guard ─────────────────────────────────────
  assert(isAppConnectionStatus('online') && isAppConnectionStatus('offline'), '(12) valid statuses pass');
  assert(!isAppConnectionStatus('Online') && !isAppConnectionStatus('live') && !isAppConnectionStatus(null), '(12) invalid statuses rejected');

  // ─── (13) hostile inputs never throw ──────────────────────────────────────
  try {
    // cyclic entry
    const cyc: Record<string, unknown> = { name: 'cyc', state: 'live' };
    cyc.self = cyc;
    assertEq(aggregateConnectionStatus([cyc]).status, 'online', '(13) cyclic entry → online, no throw');

    // throwing getters on state / name / staleMs
    const throwState = { name: 'ts', get state() { throw new Error('boom'); } };
    assertEq(aggregateConnectionStatus([throwState]).status, 'online', '(13) throwing state getter → neutral healthy');
    const throwName = { state: 'offline', get name() { throw new Error('boom'); } };
    {
      const r = aggregateConnectionStatus([throwName]);
      assertEq(r.status, 'offline', '(13) throwing name getter still classifies state');
      assertEq(r.degradedChannels[0], 'channel-0', '(13) throwing name falls back to channel-<i>');
    }
    const throwStale = { name: 's', state: 'live', get staleMs() { throw new Error('boom'); } };
    assertEq(aggregateConnectionStatus([throwStale], { degradedIfAnyStale: true }).status, 'online', '(13) throwing staleMs getter → healthy');

    // throwing opts getter → defaults, no throw
    const throwOpts = { get degradedIfAnyStale() { throw new Error('boom'); } };
    assertEq(aggregateConnectionStatus([{ state: 'live', staleMs: 999_999 }], throwOpts as never).status, 'online', '(13) throwing opts getter → defaults');

    // scalar / weird top-level inputs
    for (const junk of [null, undefined, 0, 1, 'x', true, NaN, Symbol('s'), () => 0, {}] as unknown[]) {
      const r = aggregateConnectionStatus(junk);
      assert(isAppConnectionStatus(r.status), `(13) junk aggregate still returns a valid status: ${String(junk)}`);
      assert(Array.isArray(r.degradedChannels), '(13) junk aggregate returns an array');
      assert(typeof r.summary === 'string', '(13) junk aggregate returns a string summary');
    }

    // banner + label against hostile input
    const throwStatusObj = { get status() { throw new Error('boom'); } };
    assertEq(connectionBannerModel(throwStatusObj), null, '(13) throwing .status getter → null banner');
    assertEq(connectionStatusLabel(throwStatusObj), 'Live', '(13) throwing .status getter → Live label');
    for (const junk of [null, undefined, 0, NaN, Symbol('s'), () => 0, [], {}] as unknown[]) {
      assertEq(connectionBannerModel(junk), null, `(13) junk banner → null: ${String(junk)}`);
      assert(typeof connectionStatusLabel(junk) === 'string', `(13) junk label → string: ${String(junk)}`);
      assert(typeof isAppConnectionStatus(junk) === 'boolean', '(13) junk guard → boolean');
    }
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (13) hostile input threw: ${(e as Error)?.message}`);
  }

  // ─── (14) determinism ─────────────────────────────────────────────────────
  {
    const subs = [{ name: 'a', state: 'reconnecting' }, { name: 'b', state: 'live' }, { name: 'c', state: 'offline' }];
    const r1 = aggregateConnectionStatus(subs);
    const r2 = aggregateConnectionStatus(subs);
    assertEq(JSON.stringify(r1), JSON.stringify(r2), '(14) same input → identical output');
    assert(APP_CONNECTION_STATUSES.includes(r1.status as AppConnectionStatus), '(14) status is a known member');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll connection-status-core smoke cases passed (${passes} passed).`);
}

main();
