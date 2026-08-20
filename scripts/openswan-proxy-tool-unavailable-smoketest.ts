/**
 * Focused contract smoke for the browser proxy's OpenSwan capability miss.
 *
 * Run: npm run smoke:openswan-proxy-tool-unavailable
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const {
  OPENSWAN_TOOL_UNAVAILABLE_MAX_BYTES,
  isExactOpenSwanToolUnavailableResponse,
} = require('./desktop-bridge-security.js') as {
  OPENSWAN_TOOL_UNAVAILABLE_MAX_BYTES: number;
  isExactOpenSwanToolUnavailableResponse: (input: {
    requestMethod?: string;
    requestUrl?: string;
    statusCode?: number;
    contentType?: string;
    body?: Buffer;
  }) => boolean;
};

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`pass: ${message}`);
}

const exactBody = Buffer.from(JSON.stringify({
  ok: false,
  error: { type: 'not_found', message: 'Tool not available: cron' },
}));

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    requestMethod: 'POST',
    requestUrl: '/tools/invoke',
    statusCode: 404,
    contentType: 'application/json; charset=utf-8',
    body: exactBody,
    ...overrides,
  };
}

check(OPENSWAN_TOOL_UNAVAILABLE_MAX_BYTES === 8 * 1024, 'candidate buffering is capped at exactly 8 KiB');
check(isExactOpenSwanToolUnavailableResponse(candidate()), 'exact OpenSwan tool miss is normalized');
check(isExactOpenSwanToolUnavailableResponse(candidate({
  contentType: 'Application/JSON',
  body: Buffer.from('{"error":{"message":"Tool not available: agents_list","type":"not_found"},"ok":false}'),
})), 'field order and JSON content-type casing do not change the exact contract');
check(!isExactOpenSwanToolUnavailableResponse(candidate({
  body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: sessions_send"}}'),
})), 'sessions_send keeps HTTP 404 so direct delivery callers cannot report a false success');
check(!isExactOpenSwanToolUnavailableResponse(candidate({
  body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: sessions_list"}}'),
})), 'baseline sessions_list keeps HTTP 404 for fail-closed connection diagnostics');
check(!isExactOpenSwanToolUnavailableResponse(candidate({
  body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: memory_search"}}'),
})), 'unverified optional tools are not normalized by the proxy');

for (const [label, overrides] of [
  ['different method', { requestMethod: 'GET' }],
  ['route-level slash', { requestUrl: '/tools/invoke/' }],
  ['route-level query', { requestUrl: '/tools/invoke?probe=1' }],
  ['different status', { statusCode: 405 }],
  ['HTML response', { contentType: 'text/html' }],
  ['problem JSON response', { contentType: 'application/problem+json' }],
  ['empty response', { body: Buffer.alloc(0) }],
  ['oversized response', { body: Buffer.alloc(OPENSWAN_TOOL_UNAVAILABLE_MAX_BYTES + 1, 0x20) }],
  ['malformed JSON', { body: Buffer.from('{') }],
  ['array response', { body: Buffer.from('[]') }],
  ['successful envelope', { body: Buffer.from('{"ok":true,"error":{"type":"not_found","message":"Tool not available: cron"}}') }],
  ['wrong error type', { body: Buffer.from('{"ok":false,"error":{"type":"invalid_request","message":"Tool not available: cron"}}') }],
  ['route-not-found prose', { body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Route not found"}}') }],
  ['extra top-level field', { body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: cron"},"route":"missing"}') }],
  ['extra error field', { body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: cron","detail":"x"}}') }],
  ['control-character tool', { body: Buffer.from('{"ok":false,"error":{"type":"not_found","message":"Tool not available: cron\\nroute"}}') }],
] as const) {
  check(!isExactOpenSwanToolUnavailableResponse(candidate(overrides)), `${label} keeps its original HTTP status`);
}

const proxy = readFileSync(resolve('openswan-proxy.js'), 'utf8');
check(
  proxy.includes('isExactOpenSwanToolUnavailableResponse')
    && proxy.includes("req.url === '/tools/invoke'")
    && proxy.includes('bufferedBytes + chunk.length > OPENSWAN_TOOL_UNAVAILABLE_MAX_BYTES')
    && proxy.includes('applicationLevelUnsupported ? 200'),
  'proxy wires exact-path, bounded-body normalization to HTTP 200',
);
check(
  proxy.includes('mutation-capable')
    && proxy.includes('direct HTTP-status callers'),
  'proxy documents the fail-closed boundary for direct tool callers',
);
check(
  proxy.includes('beginOriginalForward();')
    && proxy.includes('proxyRes.statusCode || 404')
    && proxy.includes("/^application\\/json"),
  'proxy preserves original status for oversized and non-JSON candidates',
);

console.log(`\nOpenSwan proxy tool-unavailable smoke: ${assertions} assertions passed.`);
