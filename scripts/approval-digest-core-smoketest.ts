// Smoke test for src/lib/approvalDigestCore.ts — pure, tsx-loadable.
// Run: npx tsx scripts/approval-digest-core-smoketest.ts
//
// Covers: risk classification (high/medium/low), reversibility notes + risk
// interaction, amount display, secret redaction (FAKE placeholder tokens only),
// control-char + U+2028/U+2029 separator stripping, maxLines + maxLen clamps,
// and a minimal-input card. NEVER-THROW is exercised via malformed inputs.

import {
  buildApprovalDigest,
  classifyRisk,
  reversibilityNote,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_LEN,
  type ApprovalDigestInput,
} from '../src/lib/approvalDigestCore';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// FAKE, obviously-invalid placeholder secrets — never real credentials.
const FAKE_GITHUB = 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_SK = 'sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.AAAAAAAAAAAAAAAAAAAA';
const FAKE_HEX = 'deadbeefdeadbeefdeadbeefdeadbeef1234'; // ≥20 hex-ish chars

// ── Risk classification: HIGH action types ──────────────────────────────────────
for (const action of ['pay', 'delete', 'grant', 'login', 'purchase']) {
  const d = buildApprovalDigest({ actionType: action, target: 'thing' });
  assert(d.risk === 'high', `actionType "${action}" should be high risk (got ${d.risk})`);
}
// Case-insensitive action normalization.
assert(classifyRisk({ actionType: 'DELETE', target: 'x' }) === 'high', 'uppercase DELETE should be high risk');
assert(classifyRisk({ actionType: '  Pay  ', target: 'x' }) === 'high', 'padded "Pay" should be high risk');

// ── Risk classification: MEDIUM action types ────────────────────────────────────
for (const action of ['external_send', 'publish', 'send', 'post']) {
  const d = buildApprovalDigest({ actionType: action, target: 'thing' });
  assert(d.risk === 'medium', `actionType "${action}" should be medium risk (got ${d.risk})`);
}

// ── Risk classification: LOW (plain read / unknown / other) ─────────────────────
for (const action of ['read', 'list', 'observe', 'search', 'weird_custom_action']) {
  const d = buildApprovalDigest({ actionType: action, target: 'thing' });
  assert(d.risk === 'low', `actionType "${action}" should be low risk (got ${d.risk})`);
}

// ── reversible === false forces high + note ─────────────────────────────────────
{
  const d = buildApprovalDigest({ actionType: 'read', target: 'file.txt', reversible: false });
  assert(d.risk === 'high', 'reversible:false should force high risk even for a read');
  assert(d.reversibleNote === '⚠️ Not reversible', `reversibleNote should warn (got "${d.reversibleNote}")`);
  assert(d.lines.includes('⚠️ Not reversible'), 'not-reversible note should appear in lines');
}
// reversible === true → note + does NOT escalate a low action.
{
  const d = buildApprovalDigest({ actionType: 'read', target: 'file.txt', reversible: true });
  assert(d.risk === 'low', 'reversible:true should not escalate a plain read');
  assert(d.reversibleNote === 'Reversible', `reversibleNote should be "Reversible" (got "${d.reversibleNote}")`);
}
// reversible undefined → unknown note.
{
  const d = buildApprovalDigest({ actionType: 'read', target: 'file.txt' });
  assert(d.reversibleNote === 'Reversibility unknown', `undefined reversible → unknown (got "${d.reversibleNote}")`);
  assert(reversibilityNote(undefined) === 'Reversibility unknown', 'reversibilityNote(undefined) note');
}

// ── amount present → high + shown line ──────────────────────────────────────────
{
  const d = buildApprovalDigest({ actionType: 'subscribe', target: 'Pro plan', amount: { value: 49.99, currency: 'USD' } });
  assert(d.risk === 'high', 'an amount present should force high risk');
  assert(d.lines.some((l) => l === 'Amount: 49.99 USD'), `amount line "Amount: 49.99 USD" expected (lines: ${JSON.stringify(d.lines)})`);
}
// Whole-number amount drops trailing zeros; lowercase currency normalized.
{
  const d = buildApprovalDigest({ actionType: 'subscribe', target: 'plan', amount: { value: 50, currency: 'usd' } });
  assert(d.lines.some((l) => l === 'Amount: 50 USD'), `whole amount should read "Amount: 50 USD" (lines: ${JSON.stringify(d.lines)})`);
}
// Amount without a valid currency code still shows the value.
{
  const d = buildApprovalDigest({ actionType: 'x', target: 't', amount: { value: 12.5, currency: '???' } });
  assert(d.lines.some((l) => l === 'Amount: 12.5'), `bad currency → value-only line (lines: ${JSON.stringify(d.lines)})`);
}

// ── cost line ────────────────────────────────────────────────────────────────────
{
  const d = buildApprovalDigest({ actionType: 'run', target: 'job', costUsd: 2.1 });
  assert(d.lines.some((l) => l === 'Est. cost: $2.1'), `cost line "Est. cost: $2.1" expected (lines: ${JSON.stringify(d.lines)})`);
}

// ── Secret redaction (target + intent + scope) ──────────────────────────────────
{
  const d = buildApprovalDigest({
    actionType: 'login',
    target: `endpoint with ${FAKE_GITHUB}`,
    humanReadableIntent: `use key ${FAKE_SK} to authenticate`,
    scope: [`bearer ${FAKE_HEX}`, `jwt ${FAKE_JWT}`],
  });
  const all = d.text + '\n' + d.title + '\n' + d.lines.join('\n');
  assert(!all.includes(FAKE_GITHUB), 'fake ghp_ token must be masked out of the card');
  assert(!all.includes(FAKE_SK), 'fake sk-ant- token must be masked out of the card');
  assert(!all.includes(FAKE_JWT), 'fake JWT must be masked out of the card');
  assert(!all.includes(FAKE_HEX), 'fake long hex token must be masked out of the card');
  assert(all.includes('[REDACTED]'), 'redaction marker should appear when secrets are present');
}
// Redaction in the title specifically.
{
  const d = buildApprovalDigest({ actionType: 'grant', target: FAKE_GITHUB });
  assert(!d.title.includes(FAKE_GITHUB), 'title must not leak a token target');
  assert(d.title.includes('[REDACTED]'), 'title should carry the redaction marker');
}

// ── Control-char + separator stripping ──────────────────────────────────────────
{
  // Build strings with a control char and U+2028/U+2029 WITHOUT pasting literals.
  const sep2028 = String.fromCharCode(0x2028);
  const sep2029 = String.fromCharCode(0x2029);
  const nul = String.fromCharCode(0x00);
  const bell = String.fromCharCode(0x07);
  const d = buildApprovalDigest({
    actionType: 'post',
    target: `a${nul}b${bell}c`,
    humanReadableIntent: `line1${sep2028}line2${sep2029}line3`,
  });
  const all = d.text + d.title + d.lines.join('|');
  assert(!all.includes(sep2028), 'U+2028 must be stripped from output');
  assert(!all.includes(sep2029), 'U+2029 must be stripped from output');
  assert(!all.includes(nul), 'NUL control char must be stripped from output');
  assert(!all.includes(bell), 'BEL control char must be stripped from output');
  // Text should not contain any raw control chars at all (newlines between lines are fine).
  assert(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(d.text), 'no stray control chars should remain in text');
}

// ── maxLines clamp ───────────────────────────────────────────────────────────────
{
  const d = buildApprovalDigest(
    {
      actionType: 'pay',
      target: 't',
      humanReadableIntent: 'do the thing',
      scope: ['a', 'b', 'c'],
      amount: { value: 5, currency: 'USD' },
      costUsd: 1,
    },
    { maxLines: 2 },
  );
  assert(d.lines.length === 2, `maxLines:2 should clamp to 2 lines (got ${d.lines.length})`);
}
// Default maxLines cap holds for a rich input.
{
  const d = buildApprovalDigest({
    actionType: 'pay',
    target: 't',
    humanReadableIntent: 'intent',
    scope: Array.from({ length: 20 }, (_, i) => `scope-${i}`),
    amount: { value: 5, currency: 'USD' },
    costUsd: 1,
    reversible: false,
  });
  assert(d.lines.length <= DEFAULT_MAX_LINES, `lines should respect DEFAULT_MAX_LINES (${DEFAULT_MAX_LINES}), got ${d.lines.length}`);
}

// ── maxLen clamp (text) ──────────────────────────────────────────────────────────
{
  // Natural-language words (spaces break the long-token run so it isn't redacted).
  const longIntent = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const d = buildApprovalDigest({ actionType: 'run', target: 'job', humanReadableIntent: longIntent }, { maxLen: 80 });
  assert(d.text.length <= 80, `text should be clamped to maxLen:80 (got ${d.text.length})`);
  assert(d.text.endsWith('…'), `over-length text should end with an ellipsis marker (text: ${JSON.stringify(d.text)})`);
}
// Default maxLen holds.
{
  const d = buildApprovalDigest({
    actionType: 'publish',
    target: 'y'.repeat(1000),
    humanReadableIntent: 'z'.repeat(1000),
  });
  assert(d.text.length <= DEFAULT_MAX_LEN, `text should respect DEFAULT_MAX_LEN (${DEFAULT_MAX_LEN}), got ${d.text.length}`);
}

// ── Minimal input → valid small card ────────────────────────────────────────────
{
  const d = buildApprovalDigest({ actionType: 'delete', target: 'old_records' });
  assert(typeof d.title === 'string' && d.title.length > 0, 'minimal input should still yield a title');
  assert(d.title === 'Delete: old_records', `minimal title should read "Delete: old_records" (got "${d.title}")`);
  assert(Array.isArray(d.lines) && d.lines.length >= 1, 'minimal card should still have at least the reversibility line');
  assert(d.lines[d.lines.length - 1] === 'Reversibility unknown', 'minimal card ends with reversibility line');
  assert(d.risk === 'high', 'delete is inherently high risk');
  assert(typeof d.text === 'string' && d.text.includes(d.title), 'text should contain the title');
}

// ── Never-throw on malformed / empty inputs ─────────────────────────────────────
{
  // @ts-expect-error intentionally malformed
  const d1 = buildApprovalDigest(undefined);
  assert(!!d1 && typeof d1.text === 'string', 'undefined input must not throw and returns a card');
  assert(d1.risk === 'low', 'empty input defaults to low risk');
  // @ts-expect-error intentionally malformed
  const d2 = buildApprovalDigest({ actionType: 123, target: null, scope: 'not-an-array', amount: { value: NaN, currency: 5 } });
  assert(!!d2 && typeof d2.text === 'string', 'garbage-typed input must not throw');
  assert(d2.risk === 'low', 'NaN amount + junk types → low risk (amount ignored)');
  assert(!d2.lines.some((l) => l.startsWith('Amount:')), 'NaN amount should not produce an Amount line');
}

// ── Line inclusion: empty/absent fields omitted ─────────────────────────────────
{
  const d = buildApprovalDigest({ actionType: 'read', target: 't', humanReadableIntent: '   ', scope: ['', '  '] });
  assert(!d.lines.some((l) => l.startsWith('Scope:')), 'all-empty scope should not produce a Scope line');
  // Only the reversibility line should remain.
  assert(d.lines.length === 1 && d.lines[0] === 'Reversibility unknown', `blank fields → only reversibility line (got ${JSON.stringify(d.lines)})`);
}

// ── Report ───────────────────────────────────────────────────────────────────────
console.log(`approval-digest-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
