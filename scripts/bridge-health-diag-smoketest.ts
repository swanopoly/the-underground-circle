/**
 * bridge-health-diag-smoketest — coverage for the pure parser in
 * `bridgeHealthDiag.ts`. Real fetch path is exercised by
 * `npm run check:bridges`; this smoke proves the parser correctly
 * classifies the response shape we observe in production from each
 * of the 5 bridge implementations.
 *
 * Run: npm run smoke:bridge-health-diag
 */
import {
  BRIDGE_CATALOG,
  parseBridgeHealth,
  probeBridges,
  summarizeBridgeProbes,
  type BridgeCatalogEntry,
} from '../src/lib/bridgeHealthDiag';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function entry(name: string): BridgeCatalogEntry {
  const found = BRIDGE_CATALOG.find((e) => e.name === name);
  if (!found) throw new Error(`catalog missing entry: ${name}`);
  return found;
}

async function main() {
  // ─── Catalog sanity ────────────────────────────────────────────
  assert(BRIDGE_CATALOG.length === 5, 'catalog: 5 bridges registered');
  const ports = BRIDGE_CATALOG.map((e) => e.port);
  assert(new Set(ports).size === 5, 'catalog: every port unique');
  assert(BRIDGE_CATALOG.every((e) => e.healthUrl.startsWith('http://localhost:')), 'catalog: every URL is localhost');

  // ─── Claude Code parser ────────────────────────────────────────
  {
    const cc = entry('claude-code');
    const ok = parseBridgeHealth(cc, { ok: true, version: '1.0.0', sessions: 3 });
    assert(ok.status === 'healthy', 'claude: ok=true,sessions=3 → healthy');
    assert(ok.sessionCount === 3, 'claude: sessionCount preserved');
    assert(ok.detail.includes('3 sessions'), 'claude: detail mentions 3 sessions');

    const single = parseBridgeHealth(cc, { ok: true, sessions: 1 });
    assert(single.detail.includes('1 session'), 'claude: pluralization (1 session, not "1 sessions")');
    assert(!single.detail.includes('1 sessions'), 'claude: no double "s" on singular');

    const zero = parseBridgeHealth(cc, { ok: true, sessions: 0 });
    assert(zero.status === 'healthy', 'claude: zero sessions still healthy (bridge up)');
    assert(zero.sessionCount === 0, 'claude: zero count preserved');
  }

  // ─── Gemini CLI parser (auth missing path) ─────────────────────
  {
    const gem = entry('gemini-cli');
    const noAuth = parseBridgeHealth(gem, {
      ok: true,
      agent: 'gemini-cli',
      sessions: 0,
      auth: 'none',
      email: '',
    });
    assert(noAuth.status === 'degraded', 'gemini: auth=none → degraded (not offline)');
    assert(noAuth.authMissing === true, 'gemini: authMissing flag set');
    assert(!!noAuth.hint && noAuth.hint.includes('gemini auth login'), 'gemini: hint suggests gemini auth login');

    const authed = parseBridgeHealth(gem, {
      ok: true,
      sessions: 2,
      auth: 'oauth',
      email: 'me@example.com',
    });
    assert(authed.status === 'healthy', 'gemini: auth=oauth → healthy');
    assert(authed.detail.includes('me@example.com'), 'gemini: email surfaced in detail');
    assert(authed.detail.includes('2 sessions'), 'gemini: session count surfaced');
  }

  // ─── Gemini missing email is treated as auth missing ──────────
  {
    const gem = entry('gemini-cli');
    const noEmail = parseBridgeHealth(gem, { ok: true, sessions: 0, auth: 'oauth' });
    assert(noEmail.status === 'degraded', 'gemini: auth=oauth but no email → still degraded');
    assert(noEmail.authMissing === true, 'gemini: authMissing when no email');
  }

  // ─── Codex parser ──────────────────────────────────────────────
  {
    const cdx = entry('codex');
    const r = parseBridgeHealth(cdx, { ok: true, bridge: 'codex', version: '1.0.0' });
    assert(r.status === 'healthy', 'codex: ok=true → healthy');
    assert(r.sessionCount === undefined, 'codex: no sessions field → sessionCount undefined');
  }

  // ─── Cursor parser ─────────────────────────────────────────────
  {
    const cur = entry('cursor');
    const r = parseBridgeHealth(cur, { ok: true, bridge: 'cursor', sessions: 0 });
    assert(r.status === 'healthy', 'cursor: ok=true → healthy');
    assert(r.sessionCount === 0, 'cursor: zero sessions preserved');
  }

  // ─── OpenSwan proxy parser ─────────────────────────────────────
  {
    const px = entry('openswan-proxy');
    const r = parseBridgeHealth(px, { ok: true, status: 'live' });
    assert(r.status === 'healthy', 'proxy: ok=true → healthy');
    assert(r.sessionCount === undefined, 'proxy: no session concept');
    assert(r.detail.includes('CORS'), 'proxy: detail describes role');

    const broken = parseBridgeHealth(px, { ok: false });
    assert(broken.status === 'offline', 'proxy: ok=false → offline');
    assert(!!broken.hint && broken.hint.includes('openswan-proxy.js'), 'proxy: hint suggests restart');
  }

  // ─── Malformed responses → offline w/ hint ─────────────────────
  {
    const cc = entry('claude-code');
    const cases: Array<[string, unknown]> = [
      ['null body', null],
      ['undefined', undefined],
      ['plain string', 'oops'],
      ['ok=false', { ok: false }],
      ['empty object', {}],
      ['number', 42],
    ];
    for (const [label, raw] of cases) {
      const r = parseBridgeHealth(cc, raw);
      assert(r.status === 'offline', `claude: ${label} → offline`);
      assert(!!r.hint, `claude: ${label} produces hint`);
    }
  }

  // ─── probeBridges with mocked fetch ────────────────────────────
  // Smoke the orchestration path without touching real ports.
  {
    const fakeFetch: any = async (url: string) => {
      // Emulate each bridge by URL.
      if (url.includes(':7778')) return jsonResp({ ok: true, sessions: 4 });
      if (url.includes(':7779')) return jsonResp({ ok: true, bridge: 'codex' });
      if (url.includes(':7780')) return jsonResp({ ok: true, sessions: 0, auth: 'none', email: '' });
      if (url.includes(':7781')) throw new Error('ECONNREFUSED'); // simulate offline
      if (url.includes(':18790')) return jsonResp({ ok: true, status: 'live' });
      throw new Error(`unexpected url: ${url}`);
    };
    const results = await probeBridges({ fetchImpl: fakeFetch, timeoutMs: 1000 });
    assert(results.length === 5, 'probe: 5 results returned');

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    assert(byName['claude-code'].status === 'healthy', 'probe: claude-code healthy');
    assert(byName['claude-code'].sessionCount === 4, 'probe: claude-code 4 sessions');
    assert(byName['codex'].status === 'healthy', 'probe: codex healthy');
    assert(byName['gemini-cli'].status === 'degraded', 'probe: gemini-cli degraded (auth missing)');
    assert(byName['cursor'].status === 'offline', 'probe: cursor offline (ECONNREFUSED)');
    assert(byName['cursor'].detail.includes('connection failed'), 'probe: cursor detail mentions connection failed');
    assert(byName['openswan-proxy'].status === 'healthy', 'probe: proxy healthy');

    // Summary contains an icon for each + hints for the broken ones.
    const summary = summarizeBridgeProbes(results);
    assert(summary.includes('Cursor'), 'summary: includes Cursor');
    assert(summary.includes('Restart with:'), 'summary: surfaces restart hint for offline');
    assert(summary.includes('1 offline'), 'summary: counts include 1 offline');
    assert(summary.includes('1 degraded'), 'summary: counts include 1 degraded');
    assert(summary.includes('3 healthy'), 'summary: counts include 3 healthy');
  }

  // ─── HTTP non-2xx → offline ────────────────────────────────────
  {
    const fakeFetch: any = async () => ({
      ok: false,
      status: 500,
      json: async () => null,
    });
    const results = await probeBridges({ fetchImpl: fakeFetch, timeoutMs: 1000 });
    assert(results.every((r) => r.status === 'offline'), 'probe: 500 status → all offline');
    assert(results[0].detail.includes('HTTP 500'), 'probe: detail mentions HTTP 500');
  }

  // ─── Timeout path ──────────────────────────────────────────────
  {
    const fakeFetch: any = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    const results = await probeBridges({ fetchImpl: fakeFetch, timeoutMs: 50 });
    assert(results.every((r) => r.status === 'offline'), 'probe: all timed-out → offline');
    assert(results[0].detail.includes('timed out'), 'probe: timeout detail mentions "timed out"');
  }

  if (failures > 0) {
    console.error(`\n${failures} bridge-health-diag smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll bridge-health-diag smoke cases passed.');
}

function jsonResp(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as any;
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
