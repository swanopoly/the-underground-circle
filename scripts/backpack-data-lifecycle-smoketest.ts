/**
 * Pure lifecycle and source-contract coverage for Backpack data reads.
 *
 * The hook itself depends on React and Supabase, so the executable checks
 * exercise its generation fence directly and verify the security/error-state
 * wiring without creating a second test-only data implementation.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackpackLoadFence } from '../src/lib/backpackLoadFence';

const fence = createBackpackLoadFence();

const firstCircleLoad = fence.begin('circle-alpha');
assert.equal(fence.isCurrent(firstCircleLoad), true, 'the newest load should be current');

const refreshedCircleLoad = fence.begin('circle-alpha');
assert.equal(
  fence.isCurrent(firstCircleLoad),
  false,
  'a refresh must retire the prior generation for the same circle',
);
assert.equal(fence.isCurrent(refreshedCircleLoad), true, 'the refresh generation should be current');

const secondCircleLoad = fence.begin('circle-beta');
assert.equal(
  fence.isCurrent(refreshedCircleLoad),
  false,
  'changing circles must fence a late continuation from the previous circle',
);
assert.equal(fence.isCurrent(secondCircleLoad), true, 'the new circle load should be current');
assert.ok(
  secondCircleLoad.generation > refreshedCircleLoad.generation,
  'generations must increase monotonically across circle changes',
);

fence.retire();
assert.equal(
  fence.isCurrent(secondCircleLoad),
  false,
  'unmount cleanup must retire the last in-flight load',
);

const loadAfterRetire = fence.begin('circle-beta');
assert.equal(fence.isCurrent(loadAfterRetire), true, 'the fence should support a clean load after retirement');
assert.ok(
  loadAfterRetire.generation > secondCircleLoad.generation,
  'retirement must advance the generation before a later load begins',
);
assert.equal(
  fence.isCurrent({ ...loadAfterRetire, circleId: 'circle-alpha' }),
  false,
  'matching generations from a different circle must never be accepted',
);

const hookSource = readFileSync('src/hooks/useBackpackData.ts', 'utf8');

assert.match(
  hookSource,
  /const ticket = loadFenceRef\.current\.begin\(normalizedCircleId\)/,
  'every Backpack read must start with a circle-bound generation ticket',
);
assert.match(
  hookSource,
  /if \(!loadFenceRef\.current\.isCurrent\(ticket\) \|\| loadingUserIdRef\.current !== user\.id\) return;\s*setSnapshot\(/,
  'a snapshot must only commit from the current generation and authenticated user',
);
assert.match(
  hookSource,
  /return \(\) => \{\s*loadFenceRef\.current\.retire\(\);\s*\}/,
  'effect cleanup must retire in-flight reads',
);
assert.match(
  hookSource,
  /if \(scopeChanged\) \{\s*hasSnapshotRef\.current = false;\s*snapshotUserIdRef\.current = '';\s*setSnapshot\(EMPTY_SNAPSHOT\);\s*\}/,
  'a circle change must clear the prior circle snapshot before rendering',
);
assert.match(
  hookSource,
  /const snapshotIsVisible = snapshot\.scopeCircleId === normalizedCircleId;[\s\S]*?const visibleSnapshot = snapshotIsVisible \? snapshot : EMPTY_SNAPSHOT;/,
  'rendering must synchronously mask a snapshot from another circle',
);
assert.match(
  hookSource,
  /supabase\.auth\.onAuthStateChange[\s\S]*?loadFenceRef\.current\.retire\(\)[\s\S]*?setSnapshot\(EMPTY_SNAPSHOT\)/,
  'an authenticated user change must retire reads and clear the previous private snapshot',
);

const catchStart = hookSource.indexOf('} catch (err) {');
const finallyStart = hookSource.indexOf('} finally {', catchStart);
assert.notEqual(catchStart, -1, 'the Backpack loader must have an explicit failure path');
assert.notEqual(finallyStart, -1, 'the Backpack loader must have an explicit completion path');
const catchSource = hookSource.slice(catchStart, finallyStart);
assert.match(
  catchSource,
  /loadFenceRef\.current\.isCurrent\(ticket\)[\s\S]*?setError\(backpackLoadErrorMessage\(err\)\)/,
  'only the current load may publish an error',
);
assert.doesNotMatch(
  catchSource,
  /setSnapshot\(/,
  'a failed refresh must retain the previous successful snapshot',
);
assert.match(
  hookSource,
  /setRefreshing\(hasCurrentSnapshot\)/,
  'a refresh over an existing snapshot must be identified separately from first load',
);
assert.match(
  hookSource,
  /error: visibleError,\s*\n\s*agentCount:/,
  'the hook must expose its failure state to the Backpack UI',
);

assert.match(
  hookSource,
  /loadSessionTags\(\{ userId: user\.id, circleId: normalizedCircleId \}\)/,
  'session tags must be loaded for the exact user and circle',
);
assert.match(
  hookSource,
  /const exactScope = \{ userId: user\.id, accessToken: session\.access_token \};[\s\S]*?loadCircleOfficeAgents\(normalizedCircleId, exactScope\)/,
  'circle agents must be loaded with the authenticated exact scope',
);
assert.match(
  hookSource,
  /historyStart\.setDate\(historyStart\.getDate\(\) - 89\);[\s\S]*?historyStart: historyStartIso/,
  'the shared response query must cover ninety local calendar days for the Cost dashboard',
);
assert.match(
  hookSource,
  /\.select\(TERMINAL_RESPONSE_SELECT, \{ count: 'exact' \}\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.range\(offset, offset \+ TERMINAL_RESPONSE_PAGE_SIZE - 1\)[\s\S]*?offset \+= page\.length;[\s\S]*?if \(offset === expectedCount\) break;/,
  'usage and trace history must page deterministically past the PostgREST row cap',
);
assert.doesNotMatch(
  hookSource,
  /loadTerminalResponseHistory[\s\S]{0,1800}?\.eq\('status', 'done'\)/,
  'trace and token history must retain failed or in-progress rows that may still carry usage',
);
assert.doesNotMatch(
  hookSource,
  /\bloadConnections\b|\bAgentConnection\b|\bconnections:/,
  'Backpack analytics must not hydrate local bridge connection secrets',
);
assert.match(
  hookSource,
  /const displayAgents = visibleSnapshot\.enrichedAgents;/,
  'empty or failed reads must remain empty instead of showing a fallback agent as live data',
);
assert.doesNotMatch(
  hookSource,
  /enrichedAgents\.length\s*>\s*0\s*\?[^:]+:\s*\[DEFAULT_AGENT\]/,
  'the display list must not substitute a default agent after a failed read',
);
assert.match(
  hookSource,
  /const bsOffice: OfficeAgent \| null = bsAgent \|\| bsAllResponses\.length > 0 \? \{[\s\S]*?enrichedAgents: bsOffice \? \[bsOffice, \.\.\.officeAgents\] : officeAgents/,
  'BlackSwan must only be represented when an agent row or response receipt actually exists',
);

console.log('Backpack data lifecycle smoke passed');
