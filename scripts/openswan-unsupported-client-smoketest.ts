/**
 * Focused client/diagnostic smoke for proxy-normalized OpenSwan tool misses.
 *
 * Run: npm run smoke:openswan-unsupported-client
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  diagnoseConnection,
  isExactOpenSwanToolUnavailablePayload,
} from '../src/lib/connectionDiagnostics';

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`pass: ${message}`);
}

const exactUnsupported = {
  ok: false,
  error: { type: 'not_found', message: 'Tool not available: sessions_list' },
};

check(
  isExactOpenSwanToolUnavailablePayload(exactUnsupported, 'sessions_list'),
  'client recognizes the exact proxy-normalized session capability miss',
);
check(
  !isExactOpenSwanToolUnavailablePayload(exactUnsupported, 'cron'),
  'client binds the capability miss to the requested tool',
);
check(
  !isExactOpenSwanToolUnavailablePayload({ ok: false, error: { type: 'not_found', message: 'Route not found' } }, 'sessions_list'),
  'client does not reinterpret a route miss as an optional-tool result',
);

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(exactUnsupported), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const unsupported = await diagnoseConnection('http://127.0.0.1:18790', 'unused-test-token');
    check(!unsupported.ok, 'diagnostics reject a normalized unsupported sessions_list response');
    check(unsupported.errorCode === 'proxy_incompatible', 'diagnostics classify normalized baseline-tool miss as proxy incompatible');

    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: { details: { sessions: [{ sessionKey: 'one' }, { sessionKey: 'two' }] } },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const healthy = await diagnoseConnection('http://127.0.0.1:18790', 'unused-test-token');
    check(healthy.ok && healthy.sessionCount === 2, 'diagnostics retain successful structured session counting');

    globalThis.fetch = async () => new Response('<h1>missing route</h1>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    });
    const missingRoute = await diagnoseConnection('http://127.0.0.1:18790', 'unused-test-token');
    check(!missingRoute.ok && missingRoute.errorCode === 'proxy_incompatible', 'genuine HTTP 404 remains a proxy compatibility failure');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const service = readFileSync(resolve('src/lib/openswanService.ts'), 'utf8');
  const structuredCheck = service.indexOf('if (isExactOpenSwanToolUnavailablePayload(payload, tool))');
  check(structuredCheck >= 0, 'OpenSwan service recognizes a normalized unsupported payload');
  check(
    service.indexOf('markToolUnsupported(endpointKey, tool);', structuredCheck) > structuredCheck
      && service.indexOf("if (tool === 'sessions_list') markToolRpcEndpointUnsupported(endpointKey);", structuredCheck) > structuredCheck,
    'service caches both optional-tool and baseline-endpoint unsupported results',
  );
  check(
    service.indexOf("error: { type: 'unsupported', message: `Tool not supported: ${tool}` }", structuredCheck) > structuredCheck,
    'service returns its stable unsupported error instead of promoting HTTP 200 to success',
  );

  console.log(`\nOpenSwan unsupported client smoke: ${assertions} assertions passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
