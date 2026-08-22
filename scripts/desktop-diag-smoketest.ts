/**
 * desktop-diag-smoketest — covers the production renderer and pure
 * non-executable launch handoff, plus source-pins the live probe to
 * authenticated read-only bridge operations only.
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
import {
  buildDesktopDiagLaunchRuntimeHandoff,
  DESKTOP_DIAG_LAUNCH_REQUIRED_CONTEXT,
  renderDesktopBridgeDiag,
} from '../src/lib/desktopBridgeDiag';

const autoConnectSource = readFileSync(
  new URL('../src/lib/desktopBridgeAutoConnect.ts', import.meta.url),
  'utf8',
);

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  assert(
    autoConnectSource.includes("const { ensureDesktopBridgePaired, isDesktopBridgePaired } = await import('./desktopBridge')")
      && autoConnectSource.includes('const paired = await ensureDesktopBridgePaired();')
      && !autoConnectSource.includes('const paired = await pairDesktopBridge();'),
    'auto-connect: cached pairing is reused instead of forcing a fresh network challenge on every task',
  );

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
        { name: 'Authenticated read-only probe', status: 'pass', detail: 'Listed 3 running apps without changing desktop state.' },
      ],
    });
    assert(r.includes('Desktop bridge: healthy'), 'healthy: header present');
    assert((r.match(/\[OK\]/g) || []).length === 4, 'healthy: all 4 read-only steps OK');
    assert(!r.includes('[FAIL]'), 'healthy: no FAIL rows');
    assert(!r.includes('Start it with'), 'healthy: no offline recovery hint');
  }

  // ─── Degraded branch — CORS fail on authenticated read ────────
  {
    const r = renderDesktopBridgeDiag({
      overall: 'degraded',
      steps: [
        { name: 'Bridge reachable', status: 'pass', detail: 'OK.' },
        { name: 'Bridge health JSON', status: 'pass', detail: 'OK.' },
        { name: 'Paired with bridge', status: 'pass', detail: 'OK.' },
        { name: 'Alias match for "open zoom"', status: 'pass', detail: 'Zoom' },
        {
          name: 'Authenticated read-only probe',
          status: 'fail',
          detail: 'Origin blocked by bridge.',
          hint: 'Bridge CORS missing X-UC-Desktop-Token in Access-Control-Allow-Headers.',
        },
      ],
    });
    assert(r.includes('Desktop bridge: degraded'), 'degraded: header present');
    assert(r.includes('[FAIL] Authenticated read-only probe'), 'degraded: FAIL on read-only auth probe');
    assert(r.includes('Access-Control-Allow-Headers'), 'degraded: CORS hint surfaced');
  }

  // ─── App argument becomes a sealed, non-executable runtime handoff ─────
  {
    const handoff = buildDesktopDiagLaunchRuntimeHandoff('open zoom');
    assert(!!handoff, 'handoff: known app request builds a typed handoff');
    if (handoff) {
      assert(handoff.kind === 'openswan_typed_tool', 'handoff: kind is OpenSwan typed tool');
      assert(handoff.tool === 'desktop.launch_app', 'handoff: exact canonical launch tool named');
      assert(handoff.executable === false, 'handoff: explicitly non-executable');
      assert(
        !handoff.carriesIdentity && !handoff.carriesApproval && !handoff.carriesProof,
        'handoff: does not fabricate sealed identity, approval, or proof',
      );
      assert(
        handoff.target.matchedShortcutId === 'zoom'
          && typeof handoff.target.canonicalAppName === 'string',
        'handoff: known alias resolves only a safe proposed app target',
      );
      for (const required of [
        'authenticated_user_id',
        'persisted_agent_run_id',
        'provider_tool_use_id',
        'exact_openswan_runtime_approval',
        'runtime_mutation_dispatch_receipt',
        'post_launch_focus_proof',
      ]) {
        assert(
          handoff.requiredContext.includes(required as never),
          `handoff: declares required ${required}`,
        );
      }
      assert(
        handoff.requiredContext.length === DESKTOP_DIAG_LAUNCH_REQUIRED_CONTEXT.length,
        'handoff: complete required-context contract is copied',
      );
      const rendered = renderDesktopBridgeDiag({
        overall: 'healthy',
        steps: [
          { name: 'Bridge reachable', status: 'pass', detail: 'OK.' },
          {
            name: 'App launch handoff',
            status: 'skip',
            detail: 'Not executed here. Proposed typed tool: desktop.launch_app.',
          },
        ],
        runtimeHandoff: handoff,
      });
      assert(rendered.includes('OpenSwan runtime handoff (not executed)'), 'handoff: renderer labels it non-executable');
      assert(rendered.includes('`desktop.launch_app`'), 'handoff: renderer names the canonical tool');
      assert(rendered.includes('provider_tool_use_id'), 'handoff: renderer exposes missing sealed context');
    }
    const unknown = buildDesktopDiagLaunchRuntimeHandoff('Obscure Private App');
    assert(
      unknown?.tool === 'desktop.launch_app'
        && unknown.target.canonicalAppName === null
        && unknown.executable === false,
      'handoff: unknown app still returns a non-executable typed handoff without inventing a canonical app',
    );
    assert(
      buildDesktopDiagLaunchRuntimeHandoff(' \n\t ') === null,
      'handoff: blank app argument produces no mutation proposal',
    );
  }

  // ─── Production probe has no reachable launch/focus/open mutation ─────
  {
    const diagSource = readFileSync('src/lib/desktopBridgeDiag.ts', 'utf8');
    assert(diagSource.includes('listRunningApps,'), 'source: imports authenticated read-only running-app probe');
    assert(diagSource.includes('runningAppsResult = await listRunningApps()'), 'source: executes the read-only probe');
    assert(!diagSource.includes('launchApp,'), 'source: launchApp is not imported');
    assert(!diagSource.includes('await launchApp('), 'source: launchApp is never invoked');
    assert(!diagSource.includes('focusApp,'), 'source: focusApp is not imported');
    assert(!diagSource.includes('await focusApp('), 'source: focusApp is never invoked');
    assert(!diagSource.includes('openUrl,'), 'source: openUrl is not imported');
    assert(!diagSource.includes('await openUrl('), 'source: openUrl is never invoked');
    assert(!diagSource.includes('openPath,'), 'source: openPath is not imported');
    assert(!diagSource.includes('await openPath('), 'source: openPath is never invoked');
    assert(
      diagSource.includes("tool: 'desktop.launch_app'")
        && diagSource.includes('executable: false')
        && diagSource.includes('carriesIdentity: false')
        && diagSource.includes('carriesApproval: false')
        && diagSource.includes('carriesProof: false'),
      'source: app launch exists only as a non-executable handoff with no fabricated authority',
    );
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
    assert(bridgeSource.includes("const BRIDGE_BIND_HOST = '127.0.0.1'"), 'security: Claude bridge declares an explicit loopback bind');
    assert(bridgeSource.includes('server.listen(PORT, BRIDGE_BIND_HOST'), 'security: Claude bridge listens on the explicit loopback host');
    assert(bridgeSource.includes('isPairingRequestSourceAllowed(req, PORT, isBridgeOriginAllowed)'), 'security: pairing checks socket source, Host, and Origin');
    assert(bridgeSource.includes('pairing_challenge_required'), 'security: pairing requires a short-lived challenge before token disclosure');
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
      assert(
        source.includes('Access-Control-Allow-Private-Network')
          || (
            source.includes('buildBridgeCorsHeaders')
            && source.includes('res.__ucCors = buildBridgeCorsHeaders(req, isAllowedPairOrigin, CORS_BASE)')
          ),
        `cors: ${file} allows origin-scoped private-network preflight`,
      );
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
