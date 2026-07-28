/**
 * Adversarial source + behavior smoke for the Chat automation HITL gate.
 *
 * This deliberately avoids a live Supabase dependency. It proves the pure
 * full-intent fingerprint behavior and keeps the durable CAS/redaction
 * invariants visible at the source boundary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  buildComputerAppToolArgsFingerprintAsync,
} from '../src/lib/computerAppGrounding';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

async function main(): Promise<void> {
  const basePlan: any = {
    source: 'natural_language',
    intent: {
      kind: 'natural_command',
      commandText: `send ${'a'.repeat(260)}`,
    },
    execution: {
      kind: 'chat_command',
      routeId: 'mail.send',
      commandText: `send ${'a'.repeat(260)}`,
      params: { recipient: 'person@example.invalid', body: 'alpha' },
    },
    approval: { required: true, reason: 'external side effect' },
    risk: 'high',
    confidence: 0.99,
    notes: ['exact recipient and body required'],
  };
  const baseContext: any = {
    circleId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    threadId: '33333333-3333-4333-8333-333333333333',
  };

  const fingerprint = (plan: any, context: any) => buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 2,
    circleId: context.circleId,
    userId: context.userId,
    threadId: context.threadId ?? null,
    roomId: context.roomId ?? null,
    source: plan.source,
    intent: plan.intent,
    execution: plan.execution,
    approval: plan.approval,
    risk: plan.risk,
    confidence: plan.confidence,
    notes: plan.notes,
  });

  const first = await fingerprint(basePlan, baseContext);
  assert(/^args-v2:sha256:[0-9a-f]{64}$/.test(first), 'fingerprint is cryptographic SHA-256');

  const afterOldTruncationBoundary = structuredClone(basePlan);
  afterOldTruncationBoundary.execution.commandText =
    `${afterOldTruncationBoundary.execution.commandText.slice(0, 220)}DIFFERENT`;
  const second = await fingerprint(afterOldTruncationBoundary, baseContext);
  assert(second !== first, 'characters beyond the former 200-character boundary change authority');

  const changedArgs = structuredClone(basePlan);
  changedArgs.execution.params.body = 'beta';
  assert(
    await fingerprint(changedArgs, baseContext) !== first,
    'mutation argument changes invalidate approval authority',
  );

  const changedScope = { ...baseContext, threadId: '44444444-4444-4444-8444-444444444444' };
  assert(
    await fingerprint(basePlan, changedScope) !== first,
    'thread scope changes invalidate approval authority',
  );

  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/chatApprovalGate.ts'),
    'utf8',
  );
  assert(
    source.includes('return buildComputerAppToolArgsFingerprintAsync({')
      && source.includes('intent: plan.intent')
      && source.includes('execution: plan.execution')
      && source.includes('notes: plan.notes'),
    'gate fingerprints the complete plan with the canonical SHA-256 helper',
  );
  assert(
    source.includes(".is('applied_at', null)")
      && source.includes(".update({ applied_at: new Date().toISOString() })"),
    'approved row is claimed with a single-use applied_at compare-and-set',
  );
  assert(
    source.includes(".eq('session_key', sessionKey)")
      && source.includes(".eq('resolved_at', top.resolved_at)")
      && source.includes(".eq('resolved_by', top.resolved_by)")
      && source.includes(".eq('timeout_seconds', top.timeout_seconds)")
      && source.includes('.contains(\'payload\', {'),
    'approval lookup and CAS retain the exact session, resolver, timing, and payload binding',
  );
  assert(
    source.includes("!isUuid(String(top.resolved_by || ''))")
      && source.includes('resolvedAt < requestedAt')
      && source.includes('resolvedAt >= expiresAt'),
    'malformed or out-of-window approval resolution fails closed',
  );
  assert(
    source.includes("if (expiresAt === null || expiresAt <= Date.now())"),
    'approved rows are freshness-checked before consumption',
  );
  assert(
    source.includes('if (Date.now() >= expiresAt)'),
    'approval is rechecked after the durable claim and before dispatch',
  );
  assert(
    source.includes('approvalSchemaVersion: 2')
      && source.includes('approvalIntentFingerprint'),
    'lookup and inserted audit payload use the v2 exact-intent binding',
  );
  const insertedApprovalPayload = source.slice(
    source.indexOf(".from('agent_approvals')\n      .insert({"),
    source.indexOf('timeout_seconds: timeoutSeconds'),
  );
  assert(
    !insertedApprovalPayload.includes('commandText:')
      && !insertedApprovalPayload.includes('notes:')
      && !insertedApprovalPayload.includes('approvalReason:'),
    'approval audit payload does not persist raw command, notes, or reason',
  );
  assert(
    source.includes('const description = describeDefault(plan);')
      && !source.includes('opts.describe ? opts.describe(plan, ctx)'),
    'caller-provided raw approval copy cannot enter the durable description',
  );
  assert(
    source.includes('That approval was already consumed by another dispatch. Nothing was replayed.'),
    'a competing consumer fails closed without replay',
  );
  assert(
    !source.includes('${lookupError.message}')
      && !source.includes('${insertError.message}'),
    'database errors stay out of user-visible approval outcomes',
  );

  const dispatcherSource = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/runChatAutomationPlan.ts'),
    'utf8',
  );
  assert(
    !dispatcherSource.includes('data.rawError')
      && !dispatcherSource.includes('rawError:'),
    'transport exceptions are not persisted verbatim',
  );

  console.log(`chat-approval-single-use-smoketest: ${passed} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
