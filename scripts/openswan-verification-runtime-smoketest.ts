/**
 * openswan-verification-runtime-smoketest
 *
 * Covers the fail-closed guard on the verification runtime: a check whose
 * dispatch throws becomes a 'blocked' result (executed:false, error captured)
 * instead of propagating — so one check's edge/network failure can't reject the
 * whole concurrent batch in executeOpenSwanVerificationPlan and discard the
 * sibling checks that already passed.
 *
 * Run: npm run smoke:openswan-verification-runtime
 */

import assert from 'node:assert/strict';

import { buildBlockedVerificationResult, summarizeVerificationCheck } from '../src/lib/openswanVerificationResult';
import {
  buildOpenSwanExecutionStream,
  getOpenSwanExecutionStatusColor,
  getOpenSwanExecutionStatusLabel,
  sortOpenSwanExecutionContracts,
} from '../src/lib/openswanExecution';
import type { OpenSwanVerificationCheck } from '../src/lib/openswanTaskPlanner';
import type { OpenSwanVerificationResult } from '../src/lib/openswanVerificationResult';

const typecheck: OpenSwanVerificationCheck = {
  id: 'typecheck',
  label: 'Typecheck changed code',
  kind: 'typecheck',
  required: true,
  reason: 'Generated or changed code should compile cleanly.',
};

// A thrown dispatch → fail-closed blocked result.
const blocked = buildBlockedVerificationResult(typecheck, 'edge relay returned 503');
assert.equal(blocked.status, 'blocked', 'status is blocked');
assert.equal(blocked.ok, false, 'blocked is not ok (fail-closed, never a false pass)');
assert.equal(blocked.executed, false, 'did not execute');
assert.equal(blocked.error, 'edge relay returned 503', 'error preserved');
assert.equal(blocked.check.id, 'typecheck', 'carries the originating check');
assert.equal(blocked.execution.status, 'blocked');
assert.equal(blocked.execution.mode, 'blocked', 'execution mode is blocked, not automatic');
assert.equal(blocked.execution.executed, false);
assert.equal(blocked.execution.toolName, 'verification.typecheck', 'maps to the right tool');
assert.equal(blocked.execution.checkId, 'typecheck');
assert(blocked.summary.includes('503'), 'summary surfaces the failure reason');
assert(/blocked/i.test(blocked.summary), 'summary names the blocked state');

// Tool mapping flows through for non-code-but-still-mapped kinds (preview → verification.preview).
const preview: OpenSwanVerificationCheck = {
  id: 'preview',
  label: 'Preview generated UI in sandbox',
  kind: 'preview',
  required: true,
  reason: 'UI work should be validated visually.',
};
const blockedPreview = buildBlockedVerificationResult(preview, 'network timeout');
assert.equal(blockedPreview.execution.toolName, 'verification.preview', 'preview kind maps to preview tool');
assert.equal(blockedPreview.ok, false);

// ─── O5: not_applicable status ───────────────────────────────────────────
// An optional non-automatic check (e.g. the general-plan manual_review with
// required:false) reports not_applicable — never 'planned' forever.

const optionalManual: OpenSwanVerificationCheck = {
  id: 'manual',
  label: 'Manual quality review',
  kind: 'manual_review',
  required: false,
  reason: 'General requests still benefit from a final quality pass.',
};

assert.equal(
  summarizeVerificationCheck(optionalManual, { status: 'not_applicable' }),
  'Manual quality review: not applicable (no automatic verification for this task)',
  'not_applicable summary explains itself',
);
assert.equal(getOpenSwanExecutionStatusLabel('not_applicable'), 'N/A', 'ledger label is N/A');
assert.equal(getOpenSwanExecutionStatusColor('not_applicable'), '#64748b', 'ledger color is muted slate');

// not_applicable sorts after planned (least urgent) and never throws the rank map.
const sorted = sortOpenSwanExecutionContracts([
  { status: 'not_applicable', mode: 'informational', summary: 'n/a check' },
  { status: 'planned', mode: 'informational', summary: 'planned check' },
  { status: 'failed', mode: 'automatic', summary: 'failed check' },
]);
assert.equal(sorted[0].status, 'failed', 'failed sorts first');
assert.equal(sorted[2].status, 'not_applicable', 'not_applicable sorts last');

// not_applicable checks stay OUT of the execution stream (they would dilute
// run-ledger step counts/greenness) while remaining visible in the checks list.
const naResult: OpenSwanVerificationResult = {
  check: optionalManual,
  status: 'not_applicable',
  execution: {
    status: 'not_applicable',
    mode: 'informational',
    summary: 'Manual quality review: not applicable (no automatic verification for this task)',
    checkId: 'manual',
    checkLabel: 'Manual quality review',
    executed: false,
    error: null,
  },
  ok: true,
  executed: false,
  summary: 'Manual quality review: not applicable (no automatic verification for this task)',
};
const stream = buildOpenSwanExecutionStream({
  toolEvents: [{ tool: 'verification.typecheck', status: 'passed', summary: 'Typecheck: passed' }],
  verificationResults: [naResult],
});
assert.equal(stream.length, 1, 'not_applicable execution filtered from the stream');
assert.equal(stream[0].status, 'passed', 'the executed contract survives');
assert.equal(naResult.ok, true, 'not_applicable is ok — it never blocks a run');

console.log('All OpenSwan verification runtime smoke cases passed.');
