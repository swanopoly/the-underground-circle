/**
 * swanbot-v2-dispatcher-parity-smoketest — guard (G1) that every v2
 * client-delegated tool has a handler. Reads three real files, parses the
 * clientOnly tool-name set from the v2 edge TOOLS array, and the handled-tool
 * set from the desktop dispatcher (desktop.*) + swanbot.ts inline
 * (browser/workspace/verification/credentials/wp), then asserts set-equality.
 * Edits NONE of them (the dispatcher and swanbot.ts handler are root-owned).
 *
 * Run: npm run smoke:swanbot-v2-dispatcher-parity
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseV2ClientOnlyToolNames,
  parseDesktopDispatcherToolNames,
  parseInlineClientToolNames,
} from '../src/lib/swanbotV2DispatcherParity';
import { SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS } from '../src/lib/swanbotOpenSwanReadiness';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

const root = process.cwd();
const v2Source = readFileSync(join(root, 'supabase/functions/swanbot-v2-ai/index.ts'), 'utf8');
const dispatcherSource = readFileSync(join(root, 'src/lib/swanbotClientToolDispatcher.ts'), 'utf8');
const swanbotSource = readFileSync(join(root, 'src/lib/swanbot.ts'), 'utf8');

const v2ClientOnly = new Set(parseV2ClientOnlyToolNames(v2Source));
const desktop = parseDesktopDispatcherToolNames(dispatcherSource);
const inline = parseInlineClientToolNames(swanbotSource);
const handled = new Set([...desktop, ...inline]);

console.log(`info: desktop dispatcher cases = ${desktop.length}, inline swanbot cases = ${inline.length}, v2 clientOnly = ${v2ClientOnly.size}`);

// (a) set-equality, with a symmetric diff naming any orphan
const missingHandler = [...v2ClientOnly].filter((n) => !handled.has(n));
const orphanHandler = [...handled].filter((n) => !v2ClientOnly.has(n));
for (const requiredTool of [
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.open_path',
  'desktop.convert_image',
]) {
  assert(v2ClientOnly.has(requiredTool), `${requiredTool}: exposed as v2 clientOnly tool`);
  assert(handled.has(requiredTool), `${requiredTool}: handled by client dispatcher`);
}
assert(
  missingHandler.length === 0,
  'every v2 clientOnly tool has a dispatcher/inline handler',
  missingHandler.length ? `MISSING HANDLER (silent-null regression): ${missingHandler.join(', ')}` : undefined,
);
assert(
  orphanHandler.length === 0,
  'no handler exists for a tool absent from the v2 clientOnly set',
  orphanHandler.length ? `ORPHAN HANDLER: ${orphanHandler.join(', ')}` : undefined,
);

// (b) counts agree with the pinned readiness constant
assert(
  v2ClientOnly.size === SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  `v2 clientOnly count (${v2ClientOnly.size}) === pinned constant (${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS})`,
);
assert(
  handled.size === SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  `handled tool union (${handled.size}) === pinned constant (${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS})`,
);
assert(
  desktop.length + inline.length === handled.size,
  'desktop + inline handler sets are disjoint (no double-count)',
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nswanbot-v2-dispatcher-parity-smoketest: all assertions passed.');
