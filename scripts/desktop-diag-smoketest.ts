/**
 * desktop-diag-smoketest — covers the renderer shape + the
 * pass/fail/skip icon mapping for `/desktop diag` output. The probe
 * itself (`runDesktopBridgeDiag`) hits the real bridge, so we can't
 * test it offline — but the renderer is pure and worth pinning.
 *
 * Run: npm run smoke:desktop-diag
 */

type DiagStep = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  hint?: string;
};

function renderDesktopBridgeDiag(result: { steps: DiagStep[]; overall: 'healthy' | 'degraded' | 'offline' }): string {
  const header = result.overall === 'healthy'
    ? '**Desktop bridge: healthy**'
    : result.overall === 'offline'
      ? '**Desktop bridge: OFFLINE**'
      : '**Desktop bridge: degraded**';
  const lines: string[] = [header, ''];
  for (const step of result.steps) {
    const icon = step.status === 'pass' ? 'OK' : step.status === 'fail' ? 'FAIL' : 'SKIP';
    lines.push(`- **[${icon}] ${step.name}** — ${step.detail}`);
    if (step.hint) lines.push(`  - Try: ${step.hint}`);
  }
  if (result.overall === 'offline') {
    lines.push('', 'Start it with: `node scripts/claude-bridge.js` (or `npm run bridge`), then retry.');
  }
  return lines.join('\n');
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Offline branch — short-circuits after step 1 ─────────────
  {
    const r = renderDesktopBridgeDiag({
      overall: 'offline',
      steps: [{ name: 'Bridge reachable', status: 'fail', detail: 'No response.', hint: 'Run `npm run bridge`.' }],
    });
    assert(r.includes('Desktop bridge: OFFLINE'), 'offline: header present');
    assert(r.includes('[FAIL] Bridge reachable'), 'offline: FAIL icon for bridge');
    assert(r.includes('Try: Run `npm run bridge`'), 'offline: hint rendered');
    assert(r.includes('node scripts/claude-bridge.js'), 'offline: includes recovery hint');
  }

  // ─── Healthy branch — all pass ────────────────────────────────
  {
    const r = renderDesktopBridgeDiag({
      overall: 'healthy',
      steps: [
        { name: 'Bridge reachable', status: 'pass', detail: 'localhost:7778 responding.' },
        { name: 'Bridge health JSON', status: 'pass', detail: 'platform=darwin · supported=true · tools=11' },
        { name: 'Paired with bridge', status: 'pass', detail: 'Token cached.' },
        { name: 'Alias match for "open zoom"', status: 'pass', detail: 'Zoom (id: zoom)' },
        { name: 'Launch round-trip', status: 'pass', detail: 'Opened Zoom successfully.' },
      ],
    });
    assert(r.includes('Desktop bridge: healthy'), 'healthy: header present');
    assert((r.match(/\[OK\]/g) || []).length === 5, 'healthy: all 5 steps OK');
    assert(!r.includes('[FAIL]'), 'healthy: no FAIL rows');
    assert(!r.includes('Start it with'), 'healthy: no offline recovery hint');
  }

  // ─── Degraded branch — CORS fail on launch ────────────────────
  {
    const r = renderDesktopBridgeDiag({
      overall: 'degraded',
      steps: [
        { name: 'Bridge reachable', status: 'pass', detail: 'OK.' },
        { name: 'Bridge health JSON', status: 'pass', detail: 'OK.' },
        { name: 'Paired with bridge', status: 'pass', detail: 'OK.' },
        { name: 'Alias match for "open zoom"', status: 'pass', detail: 'Zoom' },
        {
          name: 'Launch round-trip',
          status: 'fail',
          detail: 'Origin blocked by bridge.',
          hint: 'Bridge CORS missing X-UC-Desktop-Token in Access-Control-Allow-Headers.',
        },
      ],
    });
    assert(r.includes('Desktop bridge: degraded'), 'degraded: header present');
    assert(r.includes('[FAIL] Launch round-trip'), 'degraded: FAIL on launch');
    assert(r.includes('Access-Control-Allow-Headers'), 'degraded: CORS hint surfaced');
  }

  // ─── Skip row — unknown app alias ─────────────────────────────
  {
    const r = renderDesktopBridgeDiag({
      overall: 'healthy',
      steps: [
        { name: 'Bridge reachable', status: 'pass', detail: 'ok' },
        { name: 'Alias match for "open obscure"', status: 'skip', detail: 'Unknown app.' },
      ],
    });
    assert(r.includes('[SKIP] Alias match'), 'skip: SKIP icon rendered');
  }

  if (failures > 0) {
    console.error(`\n${failures} desktop-diag smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll desktop-diag smoke cases passed.');
}

main();
