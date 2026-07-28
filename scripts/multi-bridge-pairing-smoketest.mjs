/**
 * Socket-level pairing smoke for every agent bridge that exposes the shared
 * desktop bearer token. Starts each bridge only when its port is free, proves
 * challenge-v1 and Host protection, then stops the child process.
 *
 * Run:
 *   node scripts/multi-bridge-pairing-smoketest.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

const BRIDGES = [
  { label: 'Claude', port: 17778, portEnv: 'UC_CLAUDE_BRIDGE_PORT', script: 'scripts/claude-bridge.js', pairPath: '/desktop/pair' },
  { label: 'Codex', port: 17779, portEnv: 'UC_CODEX_BRIDGE_PORT', script: 'scripts/codex-bridge.js' },
  { label: 'Gemini', port: 17780, portEnv: 'UC_GEMINI_BRIDGE_PORT', script: 'scripts/gemini-bridge.js' },
  { label: 'Cursor', port: 17781, portEnv: 'UC_CURSOR_BRIDGE_PORT', script: 'scripts/cursor-bridge.js' },
];
const ALLOWED_ORIGIN = 'https://app.chrisswanson.xyz';
const TUNNEL_HOST = 'tunnel.example';
const TUNNEL_ORIGIN = 'https://tunnel-ui.example';

let failures = 0;
let assertions = 0;

function assert(condition, message) {
  assertions += 1;
  if (condition) {
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function requestJson({ port, path = '/pair', method = 'POST', headers = {}, body = '{}' }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: response.statusCode || 0, json });
      });
    });
    request.on('error', reject);
    request.setTimeout(1_000, () => request.destroy(new Error('request timeout')));
    request.end(body);
  });
}

async function isPortInUse(port) {
  try {
    await requestJson({ port, path: '/health', method: 'GET', body: '' });
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bridge exited with ${child.exitCode}`);
    try {
      const response = await requestJson({ port, path: '/health', method: 'GET', body: '' });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error('bridge health timeout');
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function testBridge(bridge) {
  if (await isPortInUse(bridge.port)) {
    console.log(`skip: ${bridge.label} port ${bridge.port} is already occupied; source contract remains covered by desktop-bridge-security-smoketest.`);
    return;
  }

  const child = spawn(process.execPath, [bridge.script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [bridge.portEnv]: String(bridge.port),
      UC_BRIDGE_ALLOWED_HOSTS: TUNNEL_HOST,
      UC_BRIDGE_ALLOWED_ORIGINS: TUNNEL_ORIGIN,
    },
    stdio: 'ignore',
  });
  try {
    await waitForHealth(bridge.port, child);

    const implicitTunnelOrigin = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Host: TUNNEL_HOST, Origin: ALLOWED_ORIGIN },
    });
    assert(
      implicitTunnelOrigin.status === 403 && implicitTunnelOrigin.json?.code === 'pairing_origin_blocked',
      `${bridge.label}: tunnel Host cannot inherit the built-in production origin`,
    );
    const missingTunnelOrigin = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Host: TUNNEL_HOST },
    });
    assert(
      missingTunnelOrigin.status === 403 && missingTunnelOrigin.json?.code === 'pairing_origin_blocked',
      `${bridge.label}: tunnel Host requires an exact configured origin`,
    );
    const configuredTunnelOrigin = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Host: TUNNEL_HOST, Origin: TUNNEL_ORIGIN },
    });
    assert(
      configuredTunnelOrigin.status === 428 && configuredTunnelOrigin.json?.code === 'pairing_challenge_required',
      `${bridge.label}: tunnel Host accepts its exact configured origin`,
    );

    const first = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert(first.status === 428, `${bridge.label}: first pairing POST returns 428 challenge`);
    assert(first.json?.code === 'pairing_challenge_required', `${bridge.label}: challenge response has stable code`);
    assert(typeof first.json?.challenge === 'string' && /^[a-f0-9]{48}$/i.test(first.json.challenge), `${bridge.label}: challenge is bounded random hex`);
    assert(!first.json?.token, `${bridge.label}: first pairing POST does not disclose bearer token`);

    const challenge = first.json?.challenge || '';
    const exchanged = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ pairingChallenge: challenge }),
    });
    assert(exchanged.status === 200, `${bridge.label}: valid challenge exchange succeeds`);
    assert(typeof exchanged.json?.token === 'string' && exchanged.json.token.length >= 32, `${bridge.label}: valid exchange returns the shared token`);
    const desktopToken = exchanged.json?.token || '';
    const reboundMutation = await requestJson({
      port: bridge.port,
      path: '/sessions',
      method: 'GET',
      headers: {
        Host: `attacker.example:${bridge.port}`,
        Origin: TUNNEL_ORIGIN,
        'X-UC-Desktop-Token': desktopToken,
      },
      body: '',
    });
    assert(
      reboundMutation.status === 403 && reboundMutation.json?.code === 'bridge_host_blocked',
      `${bridge.label}: paired follow-up rejects a DNS-rebinding Host`,
    );

    if (bridge.label === 'Claude') {
      const unauthContext = await requestJson({
        port: bridge.port,
        path: '/context',
        method: 'GET',
        headers: { Origin: ALLOWED_ORIGIN },
        body: '',
      });
      assert(unauthContext.status === 401, 'Claude: sensitive context read requires desktop token');

      const retiredExec = await requestJson({
        port: bridge.port,
        path: '/exec',
        headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
        body: JSON.stringify({ command: 'pwd' }),
      });
      assert(retiredExec.status === 410 && retiredExec.json?.code === 'legacy_shell_exec_retired', 'Claude: legacy shell exec is retired');

      const diagnostics = await requestJson({
        port: bridge.port,
        path: '/diagnostics',
        headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
        body: JSON.stringify({ command: 'pwd' }),
      });
      assert(diagnostics.status === 200 && diagnostics.json?.ok === true, 'Claude: fixed read-only diagnostics remain available');

      const tempRoot = mkdtempSync('/private/tmp/uc-bridge-live-');
      try {
        const exactFile = join(tempRoot, 'allowed.txt');
        const siblingFile = join(tempRoot, 'sibling.txt');
        writeFileSync(exactFile, 'allowed');
        writeFileSync(siblingFile, 'sibling');
        const grant = await requestJson({
          port: bridge.port,
          path: '/desktop/file_grant',
          headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
          body: JSON.stringify({ roots: [exactFile], scope: 'read' }),
        });
        const fileToken = grant.json?.token || '';
        assert(
          grant.status === 200 && grant.json?.roots?.[0] === exactFile,
          'Claude: existing-file grant preserves the exact file target',
        );
        const missingFile = join(tempRoot, 'missing.txt');
        const missingGrant = await requestJson({
          port: bridge.port,
          path: '/desktop/file_grant',
          headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
          body: JSON.stringify({ roots: [missingFile], scope: 'read' }),
        });
        const missingPrint = await requestJson({
          port: bridge.port,
          path: '/devices/print',
          headers: {
            Origin: ALLOWED_ORIGIN,
            'X-UC-Desktop-Token': desktopToken,
            'X-UC-File-Session-Token': missingGrant.json?.token || '',
          },
          body: JSON.stringify({ file: missingFile, printer: 'UC_SECURITY_SMOKE_NO_SUCH_PRINTER' }),
        });
        assert(
          missingGrant.status === 200 && missingPrint.status === 400,
          'Claude: granted nonexistent print file is rejected without crashing the bridge',
        );
        const ungrantedPrint = await requestJson({
          port: bridge.port,
          path: '/devices/print',
          headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
          body: JSON.stringify({ file: exactFile, printer: 'UC_SECURITY_SMOKE_NO_SUCH_PRINTER' }),
        });
        assert(ungrantedPrint.status === 403, 'Claude: file printing refuses a path without an exact read grant');
        const grantedPrint = await requestJson({
          port: bridge.port,
          path: '/devices/print',
          headers: {
            Origin: ALLOWED_ORIGIN,
            'X-UC-Desktop-Token': desktopToken,
            'X-UC-File-Session-Token': fileToken,
          },
          body: JSON.stringify({ file: exactFile, printer: 'UC_SECURITY_SMOKE_NO_SUCH_PRINTER' }),
        });
        assert(grantedPrint.status !== 403, 'Claude: exact read grant passes file-print authorization before the intentionally invalid printer fails');
        const exactRead = await requestJson({
          port: bridge.port,
          path: `/desktop/file_stat?path=${encodeURIComponent(exactFile)}`,
          method: 'GET',
          headers: {
            Origin: ALLOWED_ORIGIN,
            'X-UC-Desktop-Token': desktopToken,
            'X-UC-File-Session-Token': fileToken,
          },
          body: '',
        });
        assert(
          exactRead.status === 200 && exactRead.json?.exists === true,
          'Claude: exact-file grant permits the requested file',
        );
        const siblingRead = await requestJson({
          port: bridge.port,
          path: `/desktop/file_stat?path=${encodeURIComponent(siblingFile)}`,
          method: 'GET',
          headers: {
            Origin: ALLOWED_ORIGIN,
            'X-UC-Desktop-Token': desktopToken,
            'X-UC-File-Session-Token': fileToken,
          },
          body: '',
        });
        assert(siblingRead.status === 403, 'Claude: exact-file grant does not widen to sibling files');

        const grantedDir = join(tempRoot, 'granted');
        const outsideDir = join(tempRoot, 'outside');
        mkdirSync(grantedDir);
        mkdirSync(outsideDir);
        writeFileSync(join(outsideDir, 'secret.txt'), 'secret');
        symlinkSync(outsideDir, join(grantedDir, 'escape'));
        const dirGrant = await requestJson({
          port: bridge.port,
          path: '/desktop/file_grant',
          headers: { Origin: ALLOWED_ORIGIN, 'X-UC-Desktop-Token': desktopToken },
          body: JSON.stringify({ roots: [grantedDir], scope: 'read' }),
        });
        const escapedRead = await requestJson({
          port: bridge.port,
          path: `/desktop/file_stat?path=${encodeURIComponent(join(grantedDir, 'escape', 'secret.txt'))}`,
          method: 'GET',
          headers: {
            Origin: ALLOWED_ORIGIN,
            'X-UC-Desktop-Token': desktopToken,
            'X-UC-File-Session-Token': dirGrant.json?.token || '',
          },
          body: '',
        });
        assert(escapedRead.status === 403, 'Claude: symlink escape from a directory grant is rejected');
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
    if (bridge.label === 'Gemini') {
      const unauthenticatedProfile = await requestJson({
        port: bridge.port,
        path: '/auth',
        method: 'GET',
        headers: { Origin: ALLOWED_ORIGIN },
        body: '',
      });
      assert(unauthenticatedProfile.status === 401, 'Gemini: OAuth profile/email status requires desktop token');
    }

    const replay = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: { Origin: ALLOWED_ORIGIN },
      body: JSON.stringify({ pairingChallenge: challenge }),
    });
    assert(replay.status === 403 && replay.json?.code === 'pairing_challenge_invalid', `${bridge.label}: challenge replay fails closed`);

    const rebound = await requestJson({
      port: bridge.port,
      path: bridge.pairPath || '/pair',
      headers: {
        Host: `attacker.example:${bridge.port}`,
        Origin: TUNNEL_ORIGIN,
      },
    });
    assert(rebound.status === 403 && rebound.json?.code === 'pairing_host_blocked', `${bridge.label}: DNS-rebinding Host is rejected`);
    assert(!rebound.json?.token, `${bridge.label}: blocked Host receives no token`);
  } finally {
    await stopChild(child);
  }
}

for (const bridge of BRIDGES) {
  try {
    await testBridge(bridge);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${bridge.label} socket smoke — ${error?.message || error}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${assertions} multi-bridge pairing assertion(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${assertions} multi-bridge pairing assertions passed.`);
