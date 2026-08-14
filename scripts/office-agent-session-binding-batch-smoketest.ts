/**
 * Source contract for bounded Office binding hydration.
 *
 * The runtime module depends on the React Native Supabase client, so this
 * focused smoke pins the I/O shape and Office retention boundary without
 * opening a network connection.
 *
 * Run: npx tsx scripts/office-agent-session-binding-batch-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bindingSource = readFileSync(resolve('src/lib/officeAgentSessionBinding.ts'), 'utf8');
const officeSource = readFileSync(resolve('src/screens/circles/tabs/OfficeTab.tsx'), 'utf8');

const batchStart = bindingSource.indexOf('export async function readOfficeAgentSessionBindingsBatch');
const exactStart = bindingSource.indexOf('export async function readOfficeAgentSessionBinding(', batchStart);
assert.ok(batchStart >= 0 && exactStart > batchStart, 'batch reader is exported before the preserved exact reader');
const batch = bindingSource.slice(batchStart, exactStart);
const failureStart = bindingSource.indexOf('function bindingReadFailure');
assert.ok(failureStart >= 0 && failureStart < batchStart, 'batch reader has a shared structured failure classifier');
const failureClassifier = bindingSource.slice(failureStart, batchStart);

assert.match(batch, /BATCH_READ_LIMIT/, 'batch input is bounded');
assert.match(batch, /new Set\(officeAgentIds\)/, 'batch ids are deduplicated');
assert.match(batch, /uniqueIds\.some\(\(officeAgentId\) => !isUuid\(officeAgentId\)\)/, 'every requested id is an exact UUID');
assert.match(batch, /\.from\('office_agent_session_bindings'\)/, 'batch uses the canonical owner-RLS table');
assert.match(batch, /\.in\('office_agent_id', requestedOfficeAgentIds\)/, 'one IN query replaces per-agent fanout');
assert.match(failureClassifier, /'transient_transport'/, 'transport failure is structured');
assert.match(batch, /reason: 'invalid_response'/, 'malformed or duplicate rows fail closed');

const effectStart = officeSource.indexOf('void readOfficeAgentSessionBindingsBatch(ownUuidAgentIds)');
const effectEnd = officeSource.indexOf('// Publish the user\'s first connection', effectStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart, 'Office owns one bounded binding hydration effect');
const effect = officeSource.slice(effectStart, effectEnd);

assert.doesNotMatch(effect, /Promise\.all\(/, 'Office no longer fans out one read per agent');
assert.match(effect, /result\.reason === 'transient_transport'/, 'Office distinguishes transient transport loss');
assert.match(effect, /setOfficeAgentSessionBindings\(\(current\)/, 'transient loss retains last-known state');
assert.match(effect, /stillOwned\.has\(agentId\)/, 'retained state is narrowed to agents still owned');
assert.match(effect, /setOfficeAgentSessionBindings\(new Map\(\)\)/, 'non-transient failures remain fail-closed');

const exact = bindingSource.slice(exactStart);
assert.match(exact, /\.eq\('office_agent_id', officeAgentId\)[\s\S]{0,80}\.maybeSingle\(\)/, 'execution authority keeps one exact fresh read');

console.log('office agent session binding batch smoke passed (15 assertions)');
