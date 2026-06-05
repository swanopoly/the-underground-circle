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

import { buildBlockedVerificationResult } from '../src/lib/openswanVerificationResult';
import type { OpenSwanVerificationCheck } from '../src/lib/openswanTaskPlanner';

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

console.log('All OpenSwan verification runtime smoke cases passed.');
