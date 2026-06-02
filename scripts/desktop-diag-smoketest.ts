/**
 * desktop-diag-smoketest — covers the renderer shape + the
 * pass/fail/skip icon mapping for `/desktop diag` output. The probe
 * itself (`runDesktopBridgeDiag`) hits the real bridge, so we can't
 * test it offline — but the renderer is pure and worth pinning.
 *
 * Run: npm run smoke:desktop-diag
 */

import { readFileSync } from 'node:fs';
import {
  buildDesktopBridgeRecoveryPayload,
  buildDesktopBridgeRecoveryOptions,
  renderDesktopBridgeRecoveryMessage,
} from '../src/lib/desktopBridgeRecovery';
import {
  buildDesktopBrowserReadiness,
  buildDesktopBridgeBackgroundStartCommand,
  isDesktopBridgeRecoverySelection,
  renderDesktopBridgeConnectedMessage,
} from '../src/lib/desktopBridgeAutoConnect';

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

  // ─── Bridge pairing security — keep hostile origins out of token pairing ───
  {
    const bridgeSource = readFileSync('scripts/claude-bridge.js', 'utf8');
    const dynamicCorsIndex = bridgeSource.indexOf('const CORS = buildCorsHeaders(req)');
    const originBlockIndex = bridgeSource.indexOf('if (!isBridgeOriginAllowed(req))');
    const desktopPairIndex = bridgeSource.indexOf("url === '/desktop/pair'");
    assert(dynamicCorsIndex >= 0, 'security: Claude bridge uses request-scoped CORS headers');
    assert(originBlockIndex >= 0 && desktopPairIndex >= 0 && originBlockIndex < desktopPairIndex, 'security: origin allowlist runs before /desktop/pair token response');
    assert(bridgeSource.includes("'Access-Control-Allow-Origin': origin"), 'security: CORS response mirrors only allowed origins');
    assert(bridgeSource.includes("Origin blocked by bridge allowlist"), 'security: hostile origins get explicit 403');
  }

  // ─── Local bridge CORS header contract ─────────────────────────
  {
    const bridgeFiles = [
      'scripts/claude-bridge.js',
      'scripts/codex-bridge.js',
      'scripts/cursor-bridge.js',
      'scripts/gemini-bridge.js',
    ];
    for (const file of bridgeFiles) {
      const source = readFileSync(file, 'utf8');
      assert(source.includes('X-UC-Desktop-Token'), `cors: ${file} allows desktop token header`);
      assert(source.includes('X-UC-File-Session-Token'), `cors: ${file} allows local file session token header`);
      assert(source.includes('Access-Control-Allow-Private-Network'), `cors: ${file} allows private-network preflight`);
    }
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

  // ─── Recovery payloads — used by the DESKTOP chip and Pair action ───────
  {
    const msg = renderDesktopBridgeRecoveryMessage('unreachable');
    const options = buildDesktopBridgeRecoveryOptions('unreachable');
    const payload = buildDesktopBridgeRecoveryPayload('pair_failed', 'token missing');
    assert(msg.includes('npm run bridge'), 'recovery: offline message includes npm run bridge');
    assert(options.some((option) => option.id === 'repair_or_restart_bridge' && option.recommended), 'recovery: offline options recommend bridge repair');
    assert(options.some((option) => option.id === 'let_connected_agent_repair'), 'recovery: offline options include connected-agent diagnosis');
    assert(payload.content.includes('pairing failed'), 'recovery: pair failure message is explicit');
    assert(payload.recoveryOptions.some((option) => option.id === 'repair_or_restart_bridge'), 'recovery: pair failure carries repair option');
    assert(payload.touched.includes('desktop_bridge:pair_failed'), 'recovery: pair failure touched metadata is tagged');
    const startCommand = buildDesktopBridgeBackgroundStartCommand();
    assert(startCommand.includes('npm run bridge'), 'auto-connect: background starter uses npm run bridge');
    assert(!/\bclaude\b/i.test(startCommand), 'auto-connect: background starter does not invoke Claude billing paths');
    assert(isDesktopBridgeRecoverySelection({
      optionId: 'repair_or_restart_bridge',
      label: 'Start or repair the bridge',
      detail: 'retry',
      actor: 'user',
      recommended: true,
      source: 'recovery_policy',
      context: { sourceSurface: 'desktop_bridge_status_chip' },
    }), 'auto-connect: desktop chip repair selections are handled locally');
    assert(isDesktopBridgeRecoverySelection({
      optionId: 'repair_or_restart_bridge',
      label: 'Start or repair the bridge',
      detail: 'retry',
      actor: 'user',
      recommended: true,
      source: 'recovery_policy',
      context: { sourceSurface: 'desktop_bridge_recovery_card' },
    }), 'auto-connect: desktop bridge recovery cards are handled locally');
    assert(!isDesktopBridgeRecoverySelection({
      optionId: 'repair_or_restart_bridge',
      label: 'Start or repair the bridge',
      detail: 'retry',
      actor: 'user',
      recommended: true,
      source: 'recovery_policy',
      context: { sourceSurface: 'browser_task' },
    }), 'auto-connect: unrelated bridge repair selections still use general recovery');
    const readiness = buildDesktopBrowserReadiness(
      { ok: true, platform: 'darwin', supported: true, tools: ['launch', 'browser_tabs', 'a11y_tree'] },
      {
        ok: true,
        playwright: '1.59.0',
        chromeChannel: 'not_started',
        profileDir: '/tmp/uc-browser-profile',
        contextOpen: false,
        currentUrl: null,
        currentTitle: null,
      },
    );
    const connected = renderDesktopBridgeConnectedMessage('paired', false, readiness);
    assert(readiness.desktop.toolCount === 3, 'readiness: desktop tool count is compact');
    assert(readiness.browser.ready && !readiness.browser.contextOpen, 'readiness: browser available before first page opens');
    assert(connected.includes('Desktop: ready (3 tools).'), 'readiness: connected message shows desktop readiness');
    assert(connected.includes('Browser: ready; opens on first browser task.'), 'readiness: connected message shows browser readiness');
  }

  if (failures > 0) {
    console.error(`\n${failures} desktop-diag smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll desktop-diag smoke cases passed.');
}

main();
