/**
 * agent-receipt-smoketest — protects the product's SIGNATURE accountability
 * primitive (docs/APP_BRANDING_DESIGN_REVIEW.md §4: "The Receipt"). Verifies
 * the pure assembler + presentation model in src/lib/agentReceipt.ts:
 *   - buildAgentReceipt from synthetic bot-message shapes:
 *       * computer task w/ approval + proof -> full receipt
 *       * plain chat reply -> null (never surfaces on casual chat)
 *       * failed task -> verdict 'failed' + retry offered
 *       * bounded proof list (<= 6, strings clamped)
 *       * risk-tier derivation for each tier (read/reversible/external/irreversible)
 *       * degenerate / partial / junk inputs never throw
 *   - shouldRenderReceipt gating
 *   - describeRiskTier / describeVerdict / describeApproval mapping
 *   - no secret refs leak into proof
 *
 * Run: npm run smoke:agent-receipt
 */

import {
  buildAgentReceipt,
  shouldRenderReceipt,
  describeRiskTier,
  describeVerdict,
  describeApproval,
  type AgentReceipt,
} from '../src/lib/agentReceipt';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) {
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

function noThrow(label: string, fn: () => void) {
  try {
    fn();
    console.log(`pass: no throw - ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: threw - ${label}: ${String(error)}`);
  }
}

// ─── 1. Plain chat reply -> null ─────────────────────────────────────────────
assert(buildAgentReceipt({ content: 'Sure, here is a poem about ducks.' }) === null, 'plain chat reply -> null');
assert(buildAgentReceipt({ content: '' }) === null, 'empty content -> null');
assert(buildAgentReceipt({}) === null, 'empty input -> null');
// A completed verdict with NO action/proof/approval is still casual chat.
assert(
  buildAgentReceipt({ content: 'done', outcomeSignal: { verdict: 'completed' } }) === null,
  'completed verdict alone (no action/proof) -> null',
);
// A bare read-only handoff with a completed verdict and no proof should not
// surface (shouldRenderReceipt gates it out even though buildAgentReceipt
// returns a receipt because there is an action signal).
{
  const readOnly = buildAgentReceipt({
    computerHandoff: { surface: 'browser' } as any,
    outcomeSignal: { verdict: 'completed' },
  });
  assert(readOnly !== null, 'read-only handoff -> receipt built (has action signal)');
  assert(readOnly!.riskTier === 'read', 'read-only handoff -> read tier');
  assert(shouldRenderReceipt(readOnly) === false, 'read-only handoff, no proof/approval -> not rendered');
}

// ─── 2. Full computer receipt (approval + proof + verdict) ───────────────────
const fullReceipt = buildAgentReceipt({
  computerHandoff: {
    surface: 'browser',
    taskLabel: 'Book a table at Nopa for 4 at 7pm',
    approvalSummary: 'You approved the booking',
    evidenceContract: { approvalBefore: ['submit, publish, send, pay, purchase, delete'] },
  } as any,
  artifacts: [{ kind: 'image', title: 'Booking confirmation', url: 'https://example.com/conf.png' }],
  computerFindings: { items: [{ title: 'Nopa — 7:00pm', url: 'https://opentable.example/nopa', price: '$$', rating: '4.6' }] },
  browserPlans: [{ planId: 'p1', task: 'Complete OpenTable booking', status: 'completed', backendLiveUrl: 'https://sess.example/live', requiresApproval: true }],
  outcomeSignal: { verdict: 'completed' },
  canRetry: true,
});
assert(fullReceipt !== null, 'full computer task -> receipt');
assert(fullReceipt!.action === 'Book a table at Nopa for 4 at 7pm', 'action from taskLabel');
assert(fullReceipt!.riskTier === 'irreversible', 'critical approval reason -> irreversible tier');
assert(fullReceipt!.approval.state === 'approved', 'approvalSummary -> approved state');
assert(fullReceipt!.verdict === 'completed', 'outcomeSignal verdict passthrough');
assert(fullReceipt!.proof.length === 3, 'proof from artifact + finding + browser session', `got ${fullReceipt!.proof.length}`);
assert(fullReceipt!.proof[0].kind === 'screenshot', 'image artifact -> screenshot proof');
assert(fullReceipt!.proof[1].kind === 'receipt', 'finding -> receipt proof');
assert(fullReceipt!.proof[1].label.includes('$$') && fullReceipt!.proof[1].label.includes('4.6'), 'finding label carries price + rating');
assert(fullReceipt!.proof[2].kind === 'link' && fullReceipt!.proof[2].ref === 'https://sess.example/live', 'completed browser plan -> live link proof');
assert(shouldRenderReceipt(fullReceipt) === true, 'full receipt renders');

// ─── 3. Failed task -> verdict failed + retry ────────────────────────────────
const failedReceipt = buildAgentReceipt({
  content: 'I could not complete the download.',
  computerHandoff: { surface: 'desktop', taskLabel: 'Export the InDesign file', blockers: ['Missing fonts'], blockerCount: 1 } as any,
  recoveryOptions: [{ actor: 'user', recommended: true }],
  outcomeSignal: { verdict: 'failed' },
  canRetry: true,
});
assert(failedReceipt !== null, 'failed task -> receipt');
assert(failedReceipt!.verdict === 'failed', 'failed verdict');
assert(failedReceipt!.canRetry === true, 'failed task offers retry');
assert(failedReceipt!.approval.state === 'awaiting', 'user recovery option -> awaiting approval');
assert(shouldRenderReceipt(failedReceipt) === true, 'failed receipt renders (verdict is actionable)');
// A failed verdict with a retry affordance renders even with zero proof.
{
  const bareFailed = buildAgentReceipt({ outcomeSignal: { verdict: 'failed' }, canRetry: true });
  assert(bareFailed !== null && bareFailed.verdict === 'failed', 'bare failed verdict -> receipt (worth showing)');
  assert(shouldRenderReceipt(bareFailed) === true, 'bare failed verdict renders');
}
// A blocked verdict alone is worth a receipt (the turn did not land).
{
  const blocked = buildAgentReceipt({ outcomeSignal: { verdict: 'blocked' } });
  assert(blocked !== null && blocked.verdict === 'blocked', 'blocked verdict alone -> receipt');
  assert(shouldRenderReceipt(blocked) === true, 'blocked verdict renders');
}

// ─── 4. Bounded proof list (<= 6, clamped) ───────────────────────────────────
const manyArtifacts = Array.from({ length: 20 }, (_, i) => ({ kind: 'summary', title: `Artifact number ${i}` }));
const boundedReceipt = buildAgentReceipt({
  computerHandoff: { surface: 'computer', taskLabel: 'Batch job' } as any,
  artifacts: manyArtifacts,
  computerFindings: { items: Array.from({ length: 20 }, (_, i) => ({ title: `Finding ${i}` })) },
});
assert(boundedReceipt !== null, 'many-artifact task -> receipt');
assert(boundedReceipt!.proof.length <= 6, 'proof list capped at 6', `got ${boundedReceipt!.proof.length}`);
{
  const longTitle = 'x'.repeat(500);
  const clampReceipt = buildAgentReceipt({
    computerHandoff: { surface: 'computer' } as any,
    artifacts: [{ kind: 'summary', title: longTitle }],
  });
  assert(clampReceipt!.proof[0].label.length <= 81, 'proof label clamped', `got ${clampReceipt!.proof[0].label.length}`);
  const longAction = buildAgentReceipt({ computerHandoff: { surface: 'computer', taskLabel: 'y'.repeat(500) } as any });
  assert(longAction!.action.length <= 161, 'action clamped', `got ${longAction!.action.length}`);
}

// ─── 5. Risk-tier derivation for each tier ───────────────────────────────────
function riskFor(approvalBefore: string[] | undefined, extra: Record<string, unknown> = {}): AgentReceipt['riskTier'] {
  const r = buildAgentReceipt({
    computerHandoff: { surface: 'browser', evidenceContract: approvalBefore ? { approvalBefore } : undefined } as any,
    ...extra,
  });
  return r ? r.riskTier : null;
}
assert(riskFor(['pay for the order']) === 'irreversible', 'pay -> irreversible');
assert(riskFor(['delete the record']) === 'irreversible', 'delete -> irreversible');
assert(riskFor(['send email to the client']) === 'irreversible', 'send email -> irreversible');
assert(riskFor(['submit the form']) === 'external', 'submit -> external');
assert(riskFor(['save the document', 'export the package']) === 'external', 'save/export -> external');
assert(riskFor(['credential use']) === 'external', 'credential -> external');
assert(riskFor(['document mutation']) === 'reversible', 'document mutation -> reversible');
assert(riskFor(['edit the note']) === 'reversible', 'edit -> reversible');
assert(riskFor(['read the page']) === 'read', 'read-only reason -> read');
assert(riskFor([]) === 'read', 'handoff, empty contract -> read (browser handoff floor)');
assert(riskFor(undefined) === 'read', 'handoff, no contract -> read');
// most-severe wins across a mixed list
assert(riskFor(['edit the note', 'delete everything', 'read']) === 'irreversible', 'most-severe reason wins');
// browser plan needing approval (no contract) -> external floor
assert(
  buildAgentReceipt({ browserPlans: [{ planId: 'p', task: 't', status: 'planned', requiresApproval: true }] })!.riskTier === 'external',
  'browser plan requiresApproval (no contract) -> external',
);
// no handoff, no approving plan -> null risk tier
assert(
  buildAgentReceipt({ artifacts: [{ kind: 'summary', title: 'note' }] })!.riskTier === null,
  'artifact-only receipt -> null risk tier',
);

// ─── 6. Approval state derivation ────────────────────────────────────────────
{
  const awaiting = buildAgentReceipt({
    computerHandoff: { surface: 'browser', appRouteDecision: { status: 'needs_approval', missingApprovals: ['confirm the purchase'] } } as any,
  });
  assert(awaiting!.approval.state === 'awaiting', 'missingApprovals -> awaiting');
}
{
  const reused = buildAgentReceipt({
    computerHandoff: { surface: 'browser', standingGrant: { scopeKey: 'browser:example.com' } } as any,
  });
  assert(reused!.approval.state === 'reused', 'standing grant -> reused');
  assert(reused!.approval.approverLabel === 'browser:example.com', 'reused carries scope key');
}
{
  const notReq = buildAgentReceipt({ computerHandoff: { surface: 'browser' } as any, artifacts: [{ kind: 'summary', title: 'x' }] });
  assert(notReq!.approval.state === 'not_required', 'plain handoff -> not_required approval');
}

// ─── 7. Secret refs never leak into proof ────────────────────────────────────
{
  const secret = buildAgentReceipt({
    computerHandoff: { surface: 'browser' } as any,
    artifacts: [
      { kind: 'webpage', title: 'link with token', url: 'https://x.example/cb?api_key=SEKRET123' },
      { kind: 'webpage', title: 'clean link', url: 'https://x.example/ok' },
    ],
  });
  assert(secret!.proof[0].ref === undefined, 'ref containing api_key is stripped');
  assert(secret!.proof[1].ref === 'https://x.example/ok', 'clean ref preserved');
}

// ─── 8. shouldRenderReceipt gating ───────────────────────────────────────────
assert(shouldRenderReceipt(null) === false, 'null receipt -> not rendered');
assert(shouldRenderReceipt(undefined) === false, 'undefined receipt -> not rendered');
assert(
  shouldRenderReceipt({ action: 'x', riskTier: 'read', approval: { state: 'not_required' }, proof: [], verdict: 'completed', canUndo: false, canRetry: false }) === false,
  'hollow read/completed/no-proof receipt -> not rendered',
);
assert(
  shouldRenderReceipt({ action: 'x', riskTier: 'read', approval: { state: 'not_required' }, proof: [{ kind: 'file', label: 'f' }], verdict: 'completed', canUndo: false, canRetry: false }) === true,
  'receipt with proof -> rendered',
);
assert(
  shouldRenderReceipt({ action: 'x', riskTier: 'external', approval: { state: 'not_required' }, proof: [], verdict: 'unknown', canUndo: false, canRetry: false }) === true,
  'non-read risk tier -> rendered',
);
assert(
  shouldRenderReceipt({ action: 'x', riskTier: 'read', approval: { state: 'not_required' }, proof: [], verdict: 'unknown', canUndo: false, canRetry: true }) === true,
  'retry affordance -> rendered',
);

// ─── 9. describeRiskTier / describeVerdict / describeApproval mapping ─────────
assert(describeRiskTier('read').tone === 'green' && describeRiskTier('read').icon === '✅', 'read -> green/✅');
assert(describeRiskTier('reversible').tone === 'blue' && describeRiskTier('reversible').icon === '🔄', 'reversible -> blue/🔄');
assert(describeRiskTier('external').tone === 'amber' && describeRiskTier('external').icon === '⚠️', 'external -> amber/⚠️');
assert(describeRiskTier('irreversible').tone === 'red' && describeRiskTier('irreversible').icon === '🔴', 'irreversible -> red/🔴');
assert(describeRiskTier(null).tone === 'green', 'null tier -> safe green default');
assert(describeRiskTier('bogus' as any).tone === 'green', 'junk tier -> safe green default');

assert(describeVerdict('completed').tone === 'green' && describeVerdict('completed').label === 'Verified', 'completed -> Verified/green');
assert(describeVerdict('partial').tone === 'blue', 'partial -> blue');
assert(describeVerdict('blocked').tone === 'amber', 'blocked -> amber');
assert(describeVerdict('failed').tone === 'red' && describeVerdict('failed').label === 'Failed', 'failed -> Failed/red');
assert(describeVerdict(null).label === 'Done', 'null verdict -> Done');
assert(describeVerdict('bogus' as any).label === 'Done', 'junk verdict -> Done');

assert(describeApproval({ state: 'approved', approverLabel: 'You' }).label === 'Approved by You', 'approved label');
assert(describeApproval({ state: 'awaiting', approverLabel: 'You' }).tone === 'amber', 'awaiting -> amber');
assert(describeApproval({ state: 'reused', approverLabel: 'scope:x' }).label === 'Standing grant: scope:x', 'reused label');
assert(describeApproval({ state: 'expired' }).tone === 'red', 'expired -> red');
assert(describeApproval({ state: 'not_required' }).label === 'No approval needed', 'not_required label');
assert(describeApproval(null).tone === 'neutral', 'null approval -> neutral');

// ─── 10. Degenerate / partial / junk inputs never throw ──────────────────────
noThrow('null input', () => buildAgentReceipt(null));
noThrow('undefined input', () => buildAgentReceipt(undefined));
noThrow('non-object input', () => buildAgentReceipt(42 as any));
noThrow('array artifacts junk', () => buildAgentReceipt({ artifacts: [null, undefined, 'x', 5, {}, { kind: 5, title: {} }] as any }));
noThrow('junk findings', () => buildAgentReceipt({ computerFindings: { items: [null, 1, { title: 5 }] } as any }));
noThrow('junk browser plans', () => buildAgentReceipt({ browserPlans: [null, {}, { status: 7 }] as any }));
noThrow('junk handoff', () => buildAgentReceipt({ computerHandoff: { evidenceContract: { approvalBefore: 'not-an-array' } } as any }));
noThrow('junk recovery options', () => buildAgentReceipt({ recoveryOptions: [null, 'x', { actor: 5 }] as any }));
noThrow('junk outcome signal', () => buildAgentReceipt({ outcomeSignal: { verdict: {} } as any }));
noThrow('shouldRenderReceipt junk', () => shouldRenderReceipt({} as any));
noThrow('describe helpers junk', () => {
  describeRiskTier(undefined);
  describeVerdict(undefined);
  describeApproval(undefined);
});
// A junk handoff with an unparseable contract still yields a coherent receipt.
{
  const junkHandoff = buildAgentReceipt({ computerHandoff: { surface: 'browser', evidenceContract: { approvalBefore: 'nope' } } as any });
  assert(junkHandoff !== null && junkHandoff.riskTier === 'read', 'junk contract approvalBefore -> read tier (no throw, safe floor)');
}

// ─── Integration action receipts (W1 tail): toolEvents → proof ──────────────
{
  const withIntegration = buildAgentReceipt({
    content: 'Created the Linear issue and posted it to Slack.',
    toolEvents: [
      { tool: 'custom_api.request', status: 'completed', result: '✅ Created Linear resource: https://linear.app/acme/issue/ENG-12\n\nPOST /issues on Linear -> HTTP 201' },
      { tool: 'messaging.notify', status: 'completed', result: '✅ Posted to Slack (HTTP 200). Posted a summary to Slack.' },
    ],
    outcomeSignal: { verdict: 'completed' },
  });
  assert(withIntegration !== null, 'integration toolEvents -> receipt');
  assert(withIntegration!.proof.length === 2, 'both integration events become proof', `got ${withIntegration!.proof.length}`);
  assert(withIntegration!.proof.some((p) => p.ref === 'https://linear.app/acme/issue/ENG-12'), 'created-resource URL is a proof ref');
  assert(withIntegration!.proof[0].label.includes('Created Linear resource'), 'proof label comes from the ✅ line');
}
// A FAILED write or a plain read event does NOT fabricate proof.
{
  const failedEvent = buildAgentReceipt({
    content: 'Tried to create the issue.',
    toolEvents: [
      { tool: 'custom_api.request', status: 'failed', result: '⚠️ GitHub rejected the POST — HTTP 422 (check the path/body).' },
      { tool: 'custom_api.read', status: 'completed', result: 'GET /issues -> HTTP 200\nResponse preview: [...]' },
    ],
  });
  assert(failedEvent === null || failedEvent.proof.length === 0, 'failed / read events do not fabricate proof');
}
// Secret safety: a secret-shaped query param is scrubbed from the proof ref.
{
  const secretUrl = buildAgentReceipt({
    content: 'done',
    toolEvents: [{ tool: 'custom_api.request', status: 'completed', result: '✅ Created X resource: https://x.com/r/1?token=leakme123&page=2' }],
  });
  assert(secretUrl !== null && secretUrl.proof.some((p) => !!p.ref && !p.ref.includes('leakme123')), 'secret query param scrubbed from proof ref');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('\nAll agent-receipt smoke assertions passed.');
