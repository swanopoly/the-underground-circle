/**
 * Source-contract coverage for Prompt Manager scope, lifecycle, and receipts.
 *
 * React Native and Supabase make the surface expensive to import in Node, so
 * these checks pin the production wiring without adding a test-only data path.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync('src/lib/promptManager.ts', 'utf8');
const panel = readFileSync(
  'src/screens/circles/tabs/office/PromptManagerPanel.tsx',
  'utf8',
);

assert.match(
  manager,
  /safeGetSession\(\)[\s\S]*?session\.user\.id !== userId[\s\S]*?accessToken: session\.access_token/,
  'reads must capture and verify the expected user before using a bearer',
);
assert.match(
  manager,
  /safeGetUserForAccessToken\([\s\S]*?session\.access_token[\s\S]*?verifiedUser\?\.id !== userId/,
  'captured prompt authority must server-verify the bearer identity',
);
assert.match(
  manager,
  /getSupabaseClientForAccessToken\(authority\.accessToken\)/,
  'scoped Prompt Manager reads and writes must use a client pinned to the captured bearer',
);

const listStart = manager.indexOf('export async function loadPrompts');
const createStart = manager.indexOf('export async function createPrompt', listStart);
assert.notEqual(listStart, -1, 'the prompt list loader must exist');
assert.notEqual(createStart, -1, 'the prompt create mutation must follow the list loader');
const listSource = manager.slice(listStart, createStart);
assert.match(listSource, /\.eq\('owner_id', authority\.userId\)[\s\S]*?\.is\('circle_id', null\)/, 'personal prompts must be owner scoped');
assert.match(listSource, /\.eq\('owner_id', authority\.userId\)[\s\S]*?\.eq\('circle_id', authority\.circleId\)/, 'owned circle prompts must use the exact circle');
assert.match(listSource, /\.eq\('circle_id', authority\.circleId\)[\s\S]*?\.eq\('is_shared', true\)[\s\S]*?\.neq\('owner_id', authority\.userId\)/, 'shared prompts must use the exact circle');
assert.match(listSource, /if \(personalResult\.error\) throw/, 'personal-list errors must be exposed');
assert.match(listSource, /if \(circleOwnedResult\.error\) throw/, 'circle-list errors must be exposed');
assert.match(listSource, /if \(sharedResult\.error\) throw/, 'shared-list errors must be exposed');
assert.match(listSource, /rows\.some\(row => !promptIsReadableInScope\(row, authority\)\)/, 'mismatched list rows must fail closed');

const detailStart = manager.indexOf('export async function loadPromptDetail');
const labelsStart = manager.indexOf('// ─── Labels', detailStart);
const detailSource = manager.slice(detailStart, labelsStart);
assert.match(detailSource, /loadPromptScopeRow\(client, authority, promptId, false\)/, 'detail reads must validate the selected prompt against user and circle');
assert.match(detailSource, /Promise\.all\(\[[\s\S]*?loadVersionsWithAuthority[\s\S]*?loadLabelsWithAuthority/, 'versions and labels must share one captured authority');
assert.match(manager, /if \(error\) throw promptReadError\('Prompt versions', error\)/, 'version read errors must not become an empty history');
assert.match(manager, /if \(error\) throw promptReadError\('Prompt labels', error\)/, 'label read errors must not become an empty label list');

assert.match(
  manager,
  /function cacheKey\(userId: string,[\s\S]*?return `\$\{userId\}::\$\{circleId \|\| 'personal'\}/,
  'compiled-prompt cache entries must be partitioned by user and circle',
);
assert.match(manager, /if \(personalResult\.error\) throw promptReadError\('Personal prompt'/, 'single-prompt errors must be exposed');
assert.match(manager, /if \(labelError\) throw promptReadError\('Prompt label'/, 'single-label errors must be exposed');
assert.match(manager, /if \(versionError\) throw promptReadError\('Prompt version'/, 'single-version errors must be exposed');

assert.match(manager, /const generationRef = useRef\(0\)/, 'hooks must maintain a lifecycle generation');
assert.match(manager, /const generation = \+\+generationRef\.current/g, 'every refresh must retire the prior generation');
assert.match(manager, /if \(generation !== generationRef\.current\) return false;/g, 'late success and failure continuations must be fenced');
assert.match(manager, /return \(\) => \{ generationRef\.current \+= 1; \}/g, 'unmount and scope changes must retire in-flight reads');
assert.match(manager, /const visible = state\.scopeKey === scopeKey[\s\S]*?prompts: \[\], loading: true/, 'list data from another scope must be synchronously masked');
assert.match(manager, /const visible = state\.scopeKey === scopeKey[\s\S]*?versions: \[\],[\s\S]*?labels: \[\]/, 'detail data from another prompt scope must be synchronously masked');

assert.match(panel, /<ScopedPromptManagerPanel key=\{scopeKey\}/, 'user or circle changes must synchronously remount editor and modal state');
assert.match(panel, /usePrompts\(circleId, userId\)/, 'the list hook must receive the exact UI scope');
assert.match(panel, /usePromptDetail\(prompt\.id, circleId, userId\)/, 'the detail hook must include user, circle, and prompt identity');
assert.match(panel, /loadError && prompts\.length === 0 \? null/, 'a list failure must not render a false empty state');
assert.match(panel, /detailError && versions\.length === 0 && labels\.length === 0 \? null/, 'a detail failure must not render false empty versions or labels');

for (const mutation of ['updatePrompt', 'deletePrompt', 'removeLabel'] as const) {
  const start = manager.indexOf(`export async function ${mutation}`);
  assert.notEqual(start, -1, `${mutation} must exist`);
  const next = manager.indexOf('\nexport async function ', start + 1);
  const source = manager.slice(start, next === -1 ? undefined : next);
  assert.match(source, /loadPromptScopeRow\(client, authority, (?:id|promptId), true\)/, `${mutation} must preflight owned prompt scope`);
  assert.match(source, /\.select\(/, `${mutation} must request an affected-row receipt`);
  assert.match(source, /\.maybeSingle\(\)/, `${mutation} must distinguish zero affected rows`);
  assert.match(source, /data\?\./, `${mutation} must verify returned receipt fields`);
}

assert.match(panel, /const p = await createPrompt[\s\S]*?if \(!p\) throw/, 'create receipts must be checked');
assert.match(panel, /const deleted = await deletePrompt[\s\S]*?if \(!deleted\) throw/, 'delete receipts must be checked');
assert.match(panel, /const ver = await createVersion[\s\S]*?if \(!ver\) throw/, 'version receipts must be checked');
assert.match(panel, /const label = await setLabel[\s\S]*?if \(!label\)/, 'label receipts must be checked');
assert.match(panel, /const removed = await removeLabel[\s\S]*?if \(!removed\) throw/, 'remove-label receipts must be checked');
assert.match(panel, /createPrompt\([\s\S]*?\}, scope\)/, 'create mutations must receive the exact UI scope');
assert.match(panel, /deletePrompt\(p\.id, scope\)/, 'delete mutations must receive the exact UI scope');
assert.match(panel, /createVersion\(prompt\.id, content, config, scope\)/, 'version mutations must receive the exact UI scope');
assert.match(panel, /removeLabel\(prompt\.id, label, scope\)/, 'label removals must receive the exact UI scope');
assert.match(panel, /catch \(createError\)[\s\S]*?Your draft is still here/, 'create fields must survive a failed receipt');
assert.match(panel, /catch \(saveError\)[\s\S]*?Your draft is still here/, 'editor fields must survive a failed version save');
assert.match(panel, /catch \(labelError\)[\s\S]*?Your entries are still here/, 'label modal fields must survive a failed receipt');

console.log('Prompt Manager authority smoke passed');
