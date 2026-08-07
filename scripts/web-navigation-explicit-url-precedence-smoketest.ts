/**
 * Regression coverage for the web startup navigation authority boundary.
 *
 * A saved React Navigation stack may belong to a prior account/circle. It is
 * eligible only at the bare web root. Any explicit URL must be parsed by the
 * linking configuration instead of being replaced by that stale stack.
 *
 * Run: npx tsx scripts/web-navigation-explicit-url-precedence-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const appSource = readFileSync('App.tsx', 'utf8');
const functionSource = appSource.match(
  /export function shouldRestorePersistedNavigationState[\s\S]*?\n}/,
)?.[0];

assert.ok(functionSource, 'App.tsx must expose the pure persisted-navigation policy');

const compiled = ts.transpileModule(functionSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const sandbox: { exports: Record<string, unknown> } = { exports: {} };
vm.runInNewContext(compiled, sandbox, { filename: 'App.navigation-policy.ts' });

const shouldRestore = sandbox.exports.shouldRestorePersistedNavigationState as (
  platform: string,
  webLocation: string | null | undefined,
) => boolean;
assert.equal(typeof shouldRestore, 'function', 'compiled policy must be callable');

assert.equal(shouldRestore('web', '/'), true, 'bare web root may restore the saved stack');
assert.equal(
  shouldRestore('web', '/circle/new-account-circle/chat'),
  false,
  'an explicit circle URL must outrank a stale prior-account stack',
);
assert.equal(
  shouldRestore('web', '/circle/new-account-circle/chat?source=invite'),
  false,
  'an explicit circle URL with query state must outrank persistence',
);
assert.equal(shouldRestore('web', '/profile'), false, 'other explicit app deep links must win');
assert.equal(shouldRestore('web', '/login'), false, 'explicit auth paths must win');
assert.equal(shouldRestore('web', '/?invite=bounded-token'), false, 'root query links are not the bare root');
assert.equal(shouldRestore('web', '/#recovery'), false, 'root hash links are not the bare root');
assert.equal(shouldRestore('web', null), false, 'missing web location fails closed');
assert.equal(shouldRestore('ios', null), true, 'native startup retains saved-stack restoration');
assert.equal(shouldRestore('android', '/circle/example/chat'), true, 'native does not use browser URL authority');

const stalePriorAccountState = { routes: [{ name: 'CircleDetail', params: { circleId: 'old-circle' } }] };
const selectedInitialState = shouldRestore('web', '/circle/new-circle/chat')
  ? stalePriorAccountState
  : undefined;
assert.equal(
  selectedInitialState,
  undefined,
  'a stale prior-account circle stack cannot replace the requested circle URL',
);

assert.match(
  appSource,
  /webNavigationLocation\s*=\s*Platform\.OS === 'web'[\s\S]*?window\.location\.pathname[\s\S]*?window\.location\.search[\s\S]*?window\.location\.hash/,
  'App must include path, query, and hash when deciding whether the URL is bare',
);
assert.match(
  appSource,
  /initialState=\{session\s*&&\s*!passwordRecovery\s*&&\s*restorePersistedNavigation[\s\S]*?\?\s*validNavState[\s\S]*?:\s*undefined}/,
  'NavigationContainer must gate persisted initialState through the URL policy',
);

console.log('PASS web navigation: bare root retains persisted startup navigation');
console.log('PASS web navigation: explicit paths, query links, and hash links outrank persistence');
console.log('PASS web navigation: stale prior-account circle state cannot override the requested circle');
console.log('PASS native navigation: saved-stack startup behavior is preserved');
