/**
 * chat-outcome-signals-smoketest — protects the flywheel signal that becomes
 * BlackSwan training data (Cursor-Tab precedent). Verifies:
 *   - the deterministic verdict truth table (every branch)
 *   - reaction -> signal mapping (thumbs only; everything else null)
 *   - payload bounding + enum validation + no-PII (only enums + short ids)
 *   - the flywheel accept-rate / verdict-mix summary
 *   - degenerate / junk inputs never throw
 *   - the persisted metadata field round-trips and honors tier behavior
 *     (kept at minimal, dropped at tiny)
 *
 * Run: npm run smoke:chat-outcome-signals
 */

import {
  CHAT_OUTCOME_VERDICTS,
  CHAT_USER_SIGNALS,
  buildOutcomeSignalPayload,
  deriveOutcomeVerdict,
  mapReactionToSignal,
  readOutcomeSignalPayload,
  summarizeOutcomeForFlywheel,
  type ChatOutcomeSignalInput,
} from '../src/lib/chatOutcomeSignals';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  readPersistedOutcomeSignal,
} from '../src/lib/persistedChatMetadata';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

// ─── 1. deriveOutcomeVerdict truth table (all branches) ─────────────────────
const F: ChatOutcomeSignalInput = {
  hadError: false,
  hadRecoveryOptions: false,
  approvalPending: false,
  producedArtifact: false,
  producedText: false,
};

// error dominates everything (with and without recovery / other signals)
assert(deriveOutcomeVerdict({ ...F, hadError: true }) === 'failed', 'error alone -> failed');
assert(
  deriveOutcomeVerdict({ ...F, hadError: true, hadRecoveryOptions: true }) === 'failed',
  'error + recovery options -> failed',
);
assert(
  deriveOutcomeVerdict({ ...F, hadError: true, producedText: true, producedArtifact: true, approvalPending: true }) === 'failed',
  'error beats artifact/text/approval -> failed',
);

// approval gate (no error) -> blocked, even when text/artifact/recovery present
assert(deriveOutcomeVerdict({ ...F, approvalPending: true }) === 'blocked', 'approval pending -> blocked');
assert(
  deriveOutcomeVerdict({ ...F, approvalPending: true, producedText: true }) === 'blocked',
  'approval pending beats produced text -> blocked',
);
assert(
  deriveOutcomeVerdict({ ...F, approvalPending: true, hadRecoveryOptions: true, producedArtifact: true }) === 'blocked',
  'approval pending beats recovery + artifact -> blocked',
);

// recovery options, no error, no approval -> partial (beats produced output)
assert(deriveOutcomeVerdict({ ...F, hadRecoveryOptions: true }) === 'partial', 'recovery options (no error) -> partial');
assert(
  deriveOutcomeVerdict({ ...F, hadRecoveryOptions: true, producedText: true, producedArtifact: true }) === 'partial',
  'recovery options beat produced output -> partial',
);

// clean output -> completed
assert(deriveOutcomeVerdict({ ...F, producedArtifact: true }) === 'completed', 'artifact, no error -> completed');
assert(deriveOutcomeVerdict({ ...F, producedText: true }) === 'completed', 'text, no error -> completed');
assert(
  deriveOutcomeVerdict({ ...F, producedArtifact: true, producedText: true }) === 'completed',
  'artifact + text -> completed',
);

// nothing at all -> unknown
assert(deriveOutcomeVerdict(F) === 'unknown', 'silent/empty reply -> unknown');

// degenerate: junk / missing input never throws, coerces to unknown
assert(deriveOutcomeVerdict({} as any) === 'unknown', 'empty object input -> unknown (no throw)');
assert(deriveOutcomeVerdict(undefined as any) === 'unknown', 'undefined input -> unknown (no throw)');
assert(deriveOutcomeVerdict(null as any) === 'unknown', 'null input -> unknown (no throw)');
assert(
  deriveOutcomeVerdict({ hadError: 'yes', producedText: 1 } as any) === 'unknown',
  'non-boolean truthy junk is NOT treated as true (strict === true)',
);
assert(
  deriveOutcomeVerdict({ hadError: 1, hadRecoveryOptions: 'x' } as any) === 'unknown',
  'non-boolean fields ignored -> unknown',
);

// exhaustive: every boolean combination returns a defined verdict
{
  let allDefined = true;
  for (let mask = 0; mask < 32; mask += 1) {
    const v = deriveOutcomeVerdict({
      hadError: (mask & 1) !== 0,
      hadRecoveryOptions: (mask & 2) !== 0,
      approvalPending: (mask & 4) !== 0,
      producedArtifact: (mask & 8) !== 0,
      producedText: (mask & 16) !== 0,
    });
    if (!(CHAT_OUTCOME_VERDICTS as readonly string[]).includes(v)) allDefined = false;
  }
  assert(allDefined, 'all 32 boolean combinations yield a valid verdict');
}

// ─── 2. mapReactionToSignal ─────────────────────────────────────────────────
assert(mapReactionToSignal('👍') === 'accept', 'thumbs up -> accept');
assert(mapReactionToSignal('👎') === 'reject', 'thumbs down -> reject');
assert(mapReactionToSignal('❤️') === null, 'heart -> null (decorative)');
assert(mapReactionToSignal('🎉') === null, 'party -> null (decorative)');
assert(mapReactionToSignal('🚀') === null, 'rocket -> null (decorative)');
assert(mapReactionToSignal('') === null, 'empty string -> null');
assert(mapReactionToSignal(undefined) === null, 'undefined emoji -> null (no throw)');
assert(mapReactionToSignal(null) === null, 'null emoji -> null (no throw)');
assert(mapReactionToSignal(42 as any) === null, 'non-string emoji -> null (no throw)');
assert(mapReactionToSignal({} as any) === null, 'object emoji -> null (no throw)');
// mapped signals must be valid user signals
assert(
  (CHAT_USER_SIGNALS as readonly string[]).includes(mapReactionToSignal('👍') as string),
  'mapped accept is a valid user signal',
);

// ─── 3. buildOutcomeSignalPayload: bounding + enum validation + no-PII ──────
{
  const p = buildOutcomeSignalPayload({ verdict: 'completed', signal: 'accept', lane: 'stream', model: 'claude-sonnet-4-6' });
  assert(p.verdict === 'completed' && p.signal === 'accept', 'valid verdict + signal preserved');
  assert(p.lane === 'stream' && p.model === 'claude-sonnet-4-6', 'lane + model preserved');
}
{
  const p = buildOutcomeSignalPayload({ verdict: 'not-a-verdict', signal: 'not-a-signal' } as any);
  assert(p.verdict === 'unknown', 'invalid verdict collapses to unknown');
  assert(p.signal === undefined, 'invalid signal is dropped');
}
{
  // lane/model clamped to bounded ids
  const p = buildOutcomeSignalPayload({ verdict: 'partial', lane: 'x'.repeat(200), model: 'm'.repeat(300) });
  assert((p.lane?.length || 0) <= 48, 'lane clamped to <= 48 chars', `len ${p.lane?.length}`);
  assert((p.model?.length || 0) <= 80, 'model clamped to <= 80 chars', `len ${p.model?.length}`);
}
{
  // no free-text / PII leakage: only the four known keys survive, and only
  // enums + clamped ids — an attacker-supplied prose/email field is dropped.
  const p = buildOutcomeSignalPayload({
    verdict: 'completed',
    signal: 'accept',
    lane: 'stream',
    model: 'gpt',
    note: 'user@example.com asked about their SSN 123-45-6789',
    userEmail: 'leak@example.com',
  } as any);
  const keys = Object.keys(p).sort();
  assert(JSON.stringify(keys) === JSON.stringify(['lane', 'model', 'signal', 'verdict']), 'only enum/id keys survive (no free-text)', keys.join(','));
  const serialized = JSON.stringify(p);
  assert(!serialized.includes('@example.com'), 'no email leaks into payload');
  assert(!serialized.includes('123-45-6789'), 'no SSN-like free text leaks into payload');
}
{
  // junk / degenerate inputs never throw
  assert(buildOutcomeSignalPayload({} as any).verdict === 'unknown', 'empty input -> unknown verdict (no throw)');
  assert(buildOutcomeSignalPayload(undefined as any).verdict === 'unknown', 'undefined input -> unknown (no throw)');
  assert(buildOutcomeSignalPayload(null as any).verdict === 'unknown', 'null input -> unknown (no throw)');
  const empties = buildOutcomeSignalPayload({ verdict: 'blocked', lane: '   ', model: '' });
  assert(empties.lane === undefined && empties.model === undefined, 'whitespace/empty ids dropped');
}

// ─── 4. readOutcomeSignalPayload (untrusted round-trip) ─────────────────────
assert(readOutcomeSignalPayload(null) === null, 'reader tolerates null');
assert(readOutcomeSignalPayload('junk') === null, 'reader tolerates non-object');
assert(readOutcomeSignalPayload([]) === null, 'reader tolerates array');
assert(readOutcomeSignalPayload({}) === null, 'reader returns null for empty object (no usable signal)');
assert(readOutcomeSignalPayload({ verdict: 'nope' }) === null, 'reader returns null when only an invalid verdict is present');
assert(readOutcomeSignalPayload({ signal: 'accept' })?.signal === 'accept', 'reader keeps a lone valid signal');
assert(readOutcomeSignalPayload({ verdict: 'failed' })?.verdict === 'failed', 'reader keeps a lone valid verdict');

// ─── 5. summarizeOutcomeForFlywheel ─────────────────────────────────────────
{
  const summary = summarizeOutcomeForFlywheel([
    { verdict: 'completed', signal: 'accept' },
    { verdict: 'completed', signal: 'accept' },
    { verdict: 'completed', signal: 'accept' },
    { verdict: 'failed', signal: 'reject' },
    { verdict: 'partial', signal: 'edit_resend' }, // reaction, not accept/reject
    { verdict: 'blocked' }, // no reaction
    { verdict: 'unknown' },
  ]);
  assert(summary.total === 7, 'summary counts every record', `total ${summary.total}`);
  assert(summary.accepts === 3 && summary.rejects === 1, 'summary counts accepts/rejects');
  assert(summary.reacted === 5, 'summary counts every reacted row (incl. edit_resend)', `reacted ${summary.reacted}`);
  assert(summary.acceptRate === 0.75, 'accept rate = accepts/(accepts+rejects) = 0.75', `rate ${summary.acceptRate}`);
  assert(summary.verdictMix.completed === 3, 'verdict mix counts completed');
  assert(summary.verdictMix.blocked === 1 && summary.verdictMix.unknown === 1, 'verdict mix counts blocked/unknown');
  assert(typeof summary.line === 'string' && summary.line.includes('accept-rate 75%'), 'summary line reports accept-rate', summary.line);
  assert(summary.line.includes('3 completed'), 'summary line reports verdict mix', summary.line);
}
{
  // no reactions yet -> 0 accept rate, no divide-by-zero
  const summary = summarizeOutcomeForFlywheel([{ verdict: 'completed' }, { verdict: 'unknown' }]);
  assert(summary.acceptRate === 0, 'zero reactions -> 0 accept rate (no NaN)', `rate ${summary.acceptRate}`);
  assert(summary.line.includes('accept-rate 0%'), 'line shows 0% with no reactions');
}
{
  // degenerate inputs never throw and produce a coherent zeroed summary
  const empty = summarizeOutcomeForFlywheel([]);
  assert(empty.total === 0 && empty.acceptRate === 0, 'empty batch -> zeroed summary');
  assert(summarizeOutcomeForFlywheel(null).total === 0, 'null batch -> zeroed summary (no throw)');
  assert(summarizeOutcomeForFlywheel(undefined).total === 0, 'undefined batch -> zeroed summary (no throw)');
  const junky = summarizeOutcomeForFlywheel([null, 'x', 42, { verdict: 'bad', signal: 'bad' }] as any);
  assert(junky.total === 1, 'junk rows skipped; only object rows counted', `total ${junky.total}`);
  assert(junky.verdictMix.unknown === 1, 'invalid verdict on a real row counts as unknown');
  assert(junky.accepts === 0 && junky.rejects === 0, 'invalid signal on a real row is not counted');
}

// ─── 6. persisted-metadata field: round-trip + tier behavior ────────────────
{
  const message = formatPersistedChatBotMessage('OpenSwan', 'Task done.', {
    outcomeSignal: { verdict: 'completed', signal: 'accept', lane: 'stream', model: 'claude-sonnet-4-6' },
  });
  assert(message.length <= 9000, 'outcome-signal message stays under DB content cap');
  const meta = readPersistedChatBotMetadata(message);
  assert(meta?.outcomeSignal?.verdict === 'completed', 'persisted verdict round-trips');
  assert(meta?.outcomeSignal?.signal === 'accept', 'persisted signal round-trips');
  const viaReader = readPersistedOutcomeSignal(meta as any);
  assert(viaReader?.model === 'claude-sonnet-4-6', 'readPersistedOutcomeSignal returns the model id');
}
{
  // invalid enums in the metadata builder collapse defensively
  const message = formatPersistedChatBotMessage('OpenSwan', 'x', {
    outcomeSignal: { verdict: 'garbage', signal: 'garbage', lane: 'y'.repeat(300) } as any,
  });
  const sig = readPersistedOutcomeSignal(readPersistedChatBotMetadata(message) as any);
  assert(sig?.verdict === 'unknown', 'invalid persisted verdict collapses to unknown');
  assert(sig?.signal === undefined, 'invalid persisted signal dropped');
  assert((sig?.lane?.length || 0) <= 48, 'persisted lane re-clamped on the way out');
}
{
  // Tier behavior: a huge browser plan forces compaction. The outcome signal
  // must SURVIVE the minimal tier (it is durable telemetry).
  const hugePlan = {
    planId: 'plan_1',
    task: 'Inspect a very large browser workflow '.repeat(80),
    backend: 'browserbase_stagehand',
    backendLabel: 'Browserbase Stagehand',
    requiresApproval: true,
    status: 'planned',
    actions: Array.from({ length: 60 }, (_, i) => ({
      id: `a_${i}`,
      type: 'click',
      target: `#sel-${i}-${'x'.repeat(500)}`,
      description: `Action ${i} ${'details '.repeat(160)}`,
      requiresApproval: i % 2 === 0,
    })),
  };
  const message = formatPersistedChatBotMessage('OpenSwan', 'Big plan reply. '.repeat(20), {
    browserPlans: [hugePlan as any],
    outcomeSignal: { verdict: 'partial', signal: 'steer', model: 'claude-sonnet-4-6' },
  });
  assert(message.length <= 9000, 'outcome signal + huge plan message stays under cap');
  const sig = readPersistedOutcomeSignal(readPersistedChatBotMetadata(message) as any);
  assert(sig?.verdict === 'partial', 'outcome signal survives byte-cap compaction (minimal tier)');
  assert(sig?.signal === 'steer', 'outcome user signal survives compaction (minimal tier)');
}
{
  // Empty / no-op signal is not persisted (no noise on the row).
  const message = formatPersistedChatBotMessage('OpenSwan', 'plain reply', {
    outcomeSignal: {} as any,
  });
  const sig = readPersistedOutcomeSignal(readPersistedChatBotMetadata(message) as any);
  assert(sig === null, 'empty outcome signal is not persisted');
}

if (failures > 0) {
  console.error(`\n${failures} chat-outcome-signals smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll chat-outcome-signals smoke cases passed.');
