// Smoke test for src/lib/approvalIntentProofCore.ts — the injection-resistant
// write/spend approval boundary. Pure + deterministic; run with:
//   npx tsx scripts/approval-intent-proof-core-smoketest.ts
// Prints "approval-intent-proof-core smoke: N passed, M failed" and exits 1 on
// any failure. Every time-sensitive call passes an explicit `now`.

import {
  buildApprovalIntent,
  computeScopeHash,
  isConsequential,
  sanitizeIntentText,
  verifyResolution,
  type ApprovalIntent,
  type ApprovalResolution,
  type ConsequentialActionType,
} from '../src/lib/approvalIntentProofCore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

// Build separator/control chars from escape sequences (never literals in source).
const U2028 = String.fromCharCode(0x2028); // LINE SEPARATOR
const U2029 = String.fromCharCode(0x2029); // PARAGRAPH SEPARATOR
const NL = String.fromCharCode(0x0a); // \n
const CR = String.fromCharCode(0x0d); // \r
const NUL = String.fromCharCode(0x00);

const NOW = 1_700_000_000_000;

// ── computeScopeHash: stability + sensitivity ─────────────────────────────────
const baseFields = { actionType: 'pay', target: 'acct:123', amount: { value: 50, currency: 'USD' } };
const h = computeScopeHash(baseFields);
check('scopeHash is a non-empty string', typeof h === 'string' && h.length > 0);
check('scopeHash is stable across recomputation', h === computeScopeHash(baseFields));
check(
  'scopeHash stable under actionType/target/currency case + whitespace differences',
  h === computeScopeHash({ actionType: '  PAY ', target: 'ACCT:123 ', amount: { value: 50, currency: 'usd' } }),
);
check(
  'scopeHash changes when actionType changes',
  h !== computeScopeHash({ ...baseFields, actionType: 'delete' }),
);
check(
  'scopeHash changes when target changes',
  h !== computeScopeHash({ ...baseFields, target: 'acct:999' }),
);
check(
  'scopeHash changes when amount value changes',
  h !== computeScopeHash({ ...baseFields, amount: { value: 51, currency: 'USD' } }),
);
check(
  'scopeHash changes when amount currency changes',
  h !== computeScopeHash({ ...baseFields, amount: { value: 50, currency: 'EUR' } }),
);
check(
  'scopeHash without amount differs from with amount',
  computeScopeHash({ actionType: 'pay', target: 'acct:123' }) !== h,
);
check(
  'scopeHash resists field-boundary collision (target split)',
  computeScopeHash({ actionType: 'pay', target: 'ab' }) !==
    computeScopeHash({ actionType: 'paya', target: 'b' }),
);
check('computeScopeHash never throws on garbage input', (() => {
  try {
    computeScopeHash({ actionType: undefined as any, target: null as any });
    return true;
  } catch {
    return false;
  }
})());

// ── sanitizeIntentText + buildApprovalIntent: injection resistance ────────────
const dirty = `Pay ${U2028}Bob${U2029} now${NL}${CR}hidden${NUL}line`;
const intent = buildApprovalIntent(
  { actionType: 'pay', target: 'acct:123', humanReadableIntent: dirty, amount: { value: 50, currency: 'USD' } },
  NOW,
);
check('sanitized intent has NO U+2028', !intent.humanReadableIntent.includes(U2028));
check('sanitized intent has NO U+2029', !intent.humanReadableIntent.includes(U2029));
check('sanitized intent has NO newline', !intent.humanReadableIntent.includes(NL));
check('sanitized intent has NO carriage return', !intent.humanReadableIntent.includes(CR));
check('sanitized intent has NO NUL control char', !intent.humanReadableIntent.includes(NUL));
check('sanitized intent preserves readable words', intent.humanReadableIntent.includes('Pay') && intent.humanReadableIntent.includes('Bob'));

// direct sanitizeIntentText checks — scan code points (no literal separators in regex)
const cleaned = sanitizeIntentText(`a${U2028}b${U2029}c`);
const hasForbiddenCodePoint = (str: string): boolean => {
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    // ASCII control (C0 + DEL) or Unicode line/paragraph separators.
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
};
check('sanitizeIntentText strips separators/control chars from output', !hasForbiddenCodePoint(cleaned));
check('sanitizeIntentText preserves the visible letters', cleaned.replace(/\s/g, '') === 'abc');
const longText = 'x'.repeat(5000);
check('sanitizeIntentText clamps to default 500', sanitizeIntentText(longText).length === 500);
check('sanitizeIntentText honors custom maxLen', sanitizeIntentText(longText, 10).length === 10);
check('buildApprovalIntent clamps humanReadableIntent length', buildApprovalIntent({ actionType: 'pay', target: 't', humanReadableIntent: longText }, NOW).humanReadableIntent.length === 500);

// ── buildApprovalIntent: field wiring ─────────────────────────────────────────
check('buildApprovalIntent sets createdAt = now', intent.createdAt === NOW);
check('buildApprovalIntent scopeHash matches computeScopeHash', intent.scopeHash === computeScopeHash({ actionType: 'pay', target: 'acct:123', amount: { value: 50, currency: 'USD' } }));
check('buildApprovalIntent defaults reversible=false', intent.reversible === false);
check('buildApprovalIntent preserves reversible=true when set', buildApprovalIntent({ actionType: 'file_write', target: '/tmp/x', humanReadableIntent: 'write', reversible: true }, NOW).reversible === true);
check('buildApprovalIntent preserves reversible=false explicitly', buildApprovalIntent({ actionType: 'delete', target: '/tmp/x', humanReadableIntent: 'rm', reversible: false }, NOW).reversible === false);
check('buildApprovalIntent trims target', buildApprovalIntent({ actionType: 'pay', target: '  acct:123  ', humanReadableIntent: 'p' }, NOW).target === 'acct:123');
check('buildApprovalIntent preserves amount', intent.amount?.value === 50 && intent.amount?.currency === 'USD');
check('buildApprovalIntent omits amount when not given', buildApprovalIntent({ actionType: 'delete', target: 'x', humanReadableIntent: 'd' }, NOW).amount === undefined);
check('buildApprovalIntent coerces unknown actionType to other', buildApprovalIntent({ actionType: 'nonsense' as any, target: 'x', humanReadableIntent: 'y' }, NOW).actionType === 'other');
check('buildApprovalIntent never throws on garbage', (() => { try { buildApprovalIntent({} as any, NOW); return true; } catch { return false; } })());

// ── verifyResolution: the anti-replay core ────────────────────────────────────
const goodResolution: ApprovalResolution = { scopeHash: intent.scopeHash, decision: 'approve', resolvedAt: NOW + 1000, resolvedBy: 'user:alice' };
check('verifyResolution accepts a matching approve', verifyResolution(intent, goodResolution).valid === true);

const rejectRes: ApprovalResolution = { ...goodResolution, decision: 'reject' };
const rejectVerdict = verifyResolution(intent, rejectRes);
check('verifyResolution rejects a reject decision', rejectVerdict.valid === false);
check('verifyResolution reject reason is "rejected"', rejectVerdict.reason === 'rejected');

// Replay: a resolution built for a DIFFERENT action (different scope hash).
const otherIntent = buildApprovalIntent({ actionType: 'pay', target: 'acct:999', humanReadableIntent: 'pay someone else', amount: { value: 50, currency: 'USD' } }, NOW);
const replayRes: ApprovalResolution = { scopeHash: otherIntent.scopeHash, decision: 'approve', resolvedAt: NOW + 500, resolvedBy: 'user:alice' };
const replayVerdict = verifyResolution(intent, replayRes);
check('verifyResolution rejects a mismatched scopeHash (replay)', replayVerdict.valid === false);
check('verifyResolution replay reason names possible replay', replayVerdict.reason === 'scope mismatch (possible replay)');
check('verifyResolution rejects empty scopeHash on resolution', verifyResolution(intent, { ...goodResolution, scopeHash: '' }).valid === false);

// A different-action approve must NOT authorize this intent even though decision is approve.
check('a valid approval for action A does not authorize action B', verifyResolution(otherIntent, goodResolution).valid === false);

// Freshness / expiry.
check('verifyResolution accepts within maxAgeMs window', verifyResolution(intent, goodResolution, { now: NOW + 5000, maxAgeMs: 10000 }).valid === true);
check('verifyResolution accepts exactly at maxAgeMs boundary', verifyResolution(intent, goodResolution, { now: NOW + 10000, maxAgeMs: 10000 }).valid === true);
const expiredVerdict = verifyResolution(intent, goodResolution, { now: NOW + 20000, maxAgeMs: 10000 });
check('verifyResolution rejects when expired past maxAgeMs', expiredVerdict.valid === false);
check('verifyResolution expired reason is "expired"', expiredVerdict.reason === 'expired');
check('verifyResolution with no maxAgeMs ignores age', verifyResolution(intent, goodResolution, { now: NOW + 10 ** 12 }).valid === true);
check('verifyResolution requires now when maxAgeMs given', verifyResolution(intent, goodResolution, { maxAgeMs: 1000 }).valid === false);

// scope-mismatch is checked before decision: a rejected+mismatched resolution reports replay, not rejected.
check('scope check precedes decision check', verifyResolution(intent, { scopeHash: otherIntent.scopeHash, decision: 'reject', resolvedAt: NOW, resolvedBy: 'u' }).reason === 'scope mismatch (possible replay)');

// Defensive: never throws, handles missing args.
check('verifyResolution handles missing intent', verifyResolution(undefined as any, goodResolution).valid === false);
check('verifyResolution handles missing resolution', verifyResolution(intent, undefined as any).valid === false);
check('verifyResolution never throws on garbage', (() => { try { verifyResolution({} as any, {} as any); return true; } catch { return false; } })());

// ── isConsequential ───────────────────────────────────────────────────────────
const consequentialTypes: ConsequentialActionType[] = ['pay', 'delete', 'login', 'grant', 'external_send', 'publish', 'purchase', 'file_write'];
check('isConsequential true for all real action types', consequentialTypes.every((t) => isConsequential(t) === true));
check("isConsequential false for 'other'", isConsequential('other') === false);

// Sanity: an ApprovalIntent shape holds together end-to-end.
const roundTrip: ApprovalIntent = buildApprovalIntent({ actionType: 'purchase', target: 'sku:42', humanReadableIntent: 'buy widget', amount: { value: 9.99, currency: 'usd' } }, NOW);
check('round-trip intent verifies against its own resolution', verifyResolution(roundTrip, { scopeHash: roundTrip.scopeHash, decision: 'approve', resolvedAt: NOW, resolvedBy: 'u' }).valid === true);

console.log(`approval-intent-proof-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
