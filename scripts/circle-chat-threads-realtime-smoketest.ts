// Source-contract smoke for the Chat thread sidebar's Realtime lifecycle.
// Run: npx tsx scripts/circle-chat-threads-realtime-smoketest.ts
//
// This stays intentionally focused on wiring that is easy to regress during UI
// work: resilient reconnect, the initial fetch-to-subscribe race closer,
// reconnect/silent-stale catch-up, coalesced snapshots, and teardown safety.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sourcePath = path.resolve(process.cwd(), 'src/lib/circleChatThreads.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const hookStart = source.indexOf('export function useThreads');
const hookEnd = source.indexOf('// ─── Sidebar helpers', hookStart);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

assert(hookStart >= 0 && hookEnd > hookStart, 'useThreads source section is discoverable');
const hook = hookStart >= 0 && hookEnd > hookStart ? source.slice(hookStart, hookEnd) : '';

assert(
  /import\s*\{\s*subscribeWithReconnect\s*\}\s*from\s*['"]\.\/subscribeWithReconnect['"]/.test(source),
  'thread list imports the shared resilient subscription primitive',
);
assert(
  /subscribeWithReconnect\s*\(\s*\{/.test(hook)
    && /onCatchUp\s*:/.test(hook)
    && /onStateChange\s*:/.test(hook),
  'thread list reconnects and exposes both catch-up paths',
);
assert(
  /state\s*!==\s*['"]subscribed['"]\s*\|\|\s*completedFirstSubscribeCatchUp/.test(hook)
    && /refreshThreads\s*\(\s*['"]first subscribe['"]\s*\)/.test(hook),
  'first subscription closes the initial fetch-to-subscribe race exactly once',
);
assert(
  /onCatchUp\s*:\s*\(\)\s*=>\s*\{\s*void\s+refreshThreads\s*\(\s*['"]reconnect or silent staleness['"]\s*\)/.test(hook),
  'reconnect and silent staleness refetch the durable thread snapshot',
);
assert(
  /refreshInFlight/.test(hook)
    && /refreshQueued/.test(hook)
    && /do\s*\{[\s\S]*?while\s*\(refreshQueued\s*&&\s*!cancelled\)/.test(hook),
  'overlapping snapshots are serialized and coalesced',
);
assert(
  /refreshThreads\s*\(\s*['"]initial['"]\s*\)[\s\S]*?\.finally\s*\(\(\)\s*=>\s*\{\s*if\s*\(!cancelled\)\s*setLoading\(false\)/.test(hook),
  'only the initial snapshot completes the existing loading lifecycle',
);
assert(
  /cancelled\s*=\s*true[\s\S]*?refreshQueued\s*=\s*false[\s\S]*?subscription\.unsubscribe\s*\(\s*\)/.test(hook),
  'cleanup cancels state writes, drops queued work, and unsubscribes',
);
assert(
  !/supabase\s*\.\s*channel\s*\(/.test(hook)
    && !/supabase\.removeChannel\s*\(/.test(hook)
    && !/\.subscribe\s*\(\s*\)/.test(hook),
  'useThreads no longer owns a bare Supabase channel lifecycle',
);
assert(
  /heartbeatMs\s*:\s*120_000/.test(hook),
  'quiet thread lists use a bounded two-minute silent-staleness window',
);
assert(
  /event:\s*['"]INSERT['"]/.test(hook)
    && /event:\s*['"]UPDATE['"]/.test(hook)
    && !/event:\s*['"]\*['"]/.test(hook)
    && !/event:\s*['"]DELETE['"]/.test(hook),
  'thread Realtime uses filterable INSERT/UPDATE events and leaves hard-delete repair to bounded snapshots',
);

if (failed > 0) {
  console.error(`\n${failed} circle-chat thread Realtime smoke assertion(s) failed; ${passed} passed.`);
  process.exit(1);
}

console.log(`All circle-chat thread Realtime smoke assertions passed (${passed} passed).`);
