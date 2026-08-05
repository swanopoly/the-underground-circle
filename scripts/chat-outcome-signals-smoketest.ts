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
  deriveBrowserPlanChatOutcomeSignal,
  deriveComputerTaskChatOutcomeSignal,
  deriveOutcomeVerdict,
  deriveStopMessageChatOutcomeSignal,
  mapReactionToSignal,
  readOutcomeSignalPayload,
  summarizeOutcomeForFlywheel,
  type ChatOutcomeSignalInput,
} from '../src/lib/chatOutcomeSignals';
import { resolveChatStopMessage } from '../src/lib/chatStopMessageCore';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  readPersistedOutcomeSignal,
} from '../src/lib/persistedChatMetadata';
import {
  normalizePersistedMessageReactions,
  reconcileChatMessageSnapshot,
} from '../src/lib/chatMessageShape';
import type { ChatMessage } from '../src/lib/chatMessageTypes';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
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

const computerOutcomeExpectations = [
  ['completed', 'completed', false, false],
  ['partial', 'partial', false, true],
  ['failed', 'failed', false, true],
  ['waiting_approval', 'blocked', true, false],
  ['blocked', 'blocked', false, false],
  ['needs_input', 'blocked', false, false],
  ['cancelled', 'blocked', false, true],
] as const;
for (const [status, verdict, approvalPending, canRetry] of computerOutcomeExpectations) {
  const signal = deriveComputerTaskChatOutcomeSignal(status);
  assert(
    signal?.verdict === verdict
      && signal.approvalPending === approvalPending
      && signal.canRetry === canRetry,
    `authoritative computer ${status} maps to truthful flywheel/follow-up state`,
  );
}
assert(
  deriveComputerTaskChatOutcomeSignal(null) === null,
  'missing computer status leaves generic outcome inference in control',
);

assert(
  deriveBrowserPlanChatOutcomeSignal([{ status: 'launched' }])?.verdict === 'unknown',
  'a launched browser plan is nonterminal, not a completed artifact',
);
assert(
  deriveBrowserPlanChatOutcomeSignal([{ status: 'planned' }, { status: 'approval_requested' }])?.approvalPending === true,
  'latest browser approval request maps to a blocked approval state',
);
assert(
  deriveBrowserPlanChatOutcomeSignal([{ status: 'launched' }, { status: 'completed' }])?.verdict === 'completed',
  'only a terminal completed browser plan maps to completed',
);
assert(
  deriveBrowserPlanChatOutcomeSignal([{ status: 'failed' }])?.verdict === 'failed',
  'terminal failed browser plan maps to failed',
);
assert(
  deriveBrowserPlanChatOutcomeSignal([{ status: 'launched' }, { nope: true }])?.verdict === 'unknown',
  'browser lifecycle mapper safely ignores malformed trailing entries',
);
assert(
  deriveStopMessageChatOutcomeSignal(
    'Stopped because the latest browser.observe result matched your "captcha" stop condition. I did not continue. Clear the blocker or tell me how you want to proceed.',
  )?.verdict === 'blocked',
  'a typed user stop condition is blocked rather than completed prose',
);
assert(
  deriveStopMessageChatOutcomeSignal(resolveChatStopMessage('v2_continuation_cap').message)?.verdict === 'partial',
  'a continuation cap preserves partial progress instead of becoming completed',
);
assert(
  deriveStopMessageChatOutcomeSignal(resolveChatStopMessage('tool_use_failed').message)?.verdict === 'failed',
  'recognized tool-failure stop copy maps to failed',
);
assert(
  deriveStopMessageChatOutcomeSignal('Here is the finished answer.') === null,
  'ordinary text is not treated as an authoritative stop',
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

{
  const raw = { '🔥': ['user-a', 'user-b'], '🎯': ['user-a'] };
  const normalized = normalizePersistedMessageReactions(raw);
  assert(
    normalized['🔥']?.join(',') === 'user-a,user-b' && normalized['🎯']?.[0] === 'user-a',
    'atomic reaction RPC response validates and preserves its exact user sets',
  );
  raw['🔥'].push('late-mutation');
  assert(
    normalized['🔥']?.length === 2,
    'normalized reaction state is copied away from the transport object',
  );

  const invalidStates: unknown[] = [
    null,
    [],
    { '🔥': 'user-a' },
    { '🔥': ['user-a', 'user-a'] },
    { '🔥': [''] },
    JSON.parse('{"__proto__":["user-a"]}'),
    Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`e${index}`, ['user-a']])),
  ];
  let rejected = 0;
  for (const invalid of invalidStates) {
    try {
      normalizePersistedMessageReactions(invalid);
    } catch {
      rejected += 1;
    }
  }
  assert(rejected === invalidStates.length, 'malformed, duplicate, dangerous, and oversized reaction state fails closed');
}
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

const chatTabSource = fs.readFileSync(
  path.join(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);
const chatServiceSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/chatService.ts'),
  'utf8',
);

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

const reactionServiceSource = sourceSection(
  chatServiceSource,
  'export async function setMessageReaction',
  'export async function loadMessageReactions',
);
const reactionUiSource = sourceSection(
  chatTabSource,
  'const toggleReaction',
  '// ─── Delete Message',
);
assert(
  /supabase\.rpc\(['"]set_message_reaction['"]/.test(reactionServiceSource)
    && /p_message_id: messageId/.test(reactionServiceSource)
    && /p_emoji: emoji/.test(reactionServiceSource)
    && /p_add: add/.test(reactionServiceSource)
    && !/\.update\(\{\s*reactions/.test(reactionServiceSource),
  'reaction persistence calls the caller-only atomic RPC and never replaces the shared JSON blob',
);
assert(
  /reactionMutationQueuesRef/.test(reactionUiSource)
    && /reactionMutationVersionsRef/.test(reactionUiSource)
    && /replaceMountedMessageReactions\(dbId, exactReactions, mutationScope\)/.test(reactionUiSource)
    && /replaceMountedMessageReactions\(dbId, previousReactions, mutationScope\)/.test(reactionUiSource)
    && /await loadMessageReactions\(dbId\)/.test(reactionUiSource),
  'rapid reaction toggles serialize, accept exact server state, and rollback plus reconcile on failure',
);

assert(
  /outcomeSignal: initialOutcomeSignal/.test(chatTabSource),
  'final verdict rides the original full metadata insert instead of a lossy follow-up rewrite',
);
assert(
  /syncPersistedBotMessage\(target\)/.test(chatTabSource),
  'later user signals re-persist the complete structured message snapshot',
);
assert(
  !/readPersistedChatBotMetadata\(target\.content\)/.test(chatTabSource),
  'outcome stamping never treats the visible in-memory body as a metadata envelope',
);
assert(
  /function projectPersistedChatBotMetadata[\s\S]*?assign\('agentPlan', message\.agentPlan\)[\s\S]*?assign\('computerFindings', message\.computerFindings\)[\s\S]*?assign\('bestOfN', message\.bestOfN\)/.test(chatTabSource),
  'the lossless projector preserves structured plan, findings, and race fields',
);
assert(
  /persistedMetadataSnapshot: metadata[\s\S]*?outcomeSignal: metadata\.outcomeSignal/.test(chatTabSource),
  'initial and realtime hydration restore the parsed envelope and outcome signal together',
);
assert(
  /persistedMetadataSnapshot: structuredPersistedMetadata/.test(chatTabSource),
  'typed-batch persistence keeps envelope-only verification proof in the live snapshot',
);

const verificationRetrySource = sourceSection(
  chatTabSource,
  'const handleRetryVerificationCheck',
  'const handlePromoteMemoryRef',
);
assert(
  /syncPersistedBotMessage\s*\(/.test(verificationRetrySource),
  'verification retries durably sync their refreshed tool and verification evidence',
);

const realtimeMessageSource = sourceSection(
  chatTabSource,
  '// ─── Realtime subscription',
  '// With inverted FlatList',
);
assert(
  /event\s*:\s*['"]INSERT['"]/.test(realtimeMessageSource)
    && /event\s*:\s*['"]UPDATE['"]/.test(realtimeMessageSource),
  'message Realtime listens for both inserts and durable metadata updates',
);
const realtimeUpdateStart = realtimeMessageSource.search(/event\s*:\s*['"]UPDATE['"]/);
const realtimeUpdateSource = realtimeUpdateStart >= 0
  ? realtimeMessageSource.slice(realtimeUpdateStart)
  : '';
assert(
  /readPersistedChatBotMetadata\s*\(/.test(realtimeUpdateSource)
    && /hydratePersistedChatBotMetadata\s*\(/.test(realtimeUpdateSource),
  'Realtime UPDATE rehydrates the complete persisted bot metadata envelope',
);
assert(
  /persistedMetadataSnapshot\s*:\s*null/.test(realtimeUpdateSource)
    && /taskPlan\s*:\s*undefined/.test(realtimeUpdateSource)
    && /browserPlans\s*:\s*undefined/.test(realtimeUpdateSource)
    && /recoveryOptions\s*:\s*undefined/.test(realtimeUpdateSource)
    && /chatAutomationPlanPreview\s*:\s*undefined/.test(realtimeUpdateSource)
    && /quickReplies\s*:\s*undefined/.test(realtimeUpdateSource)
    && /crossSurfaceFollowups\s*:\s*undefined/.test(realtimeUpdateSource)
    && /showRunTrace\s*:\s*false/.test(realtimeUpdateSource),
  'metadata-free bot UPDATEs fail closed by clearing stale proof and actionable controls',
);

assert(
  /subscribeWithReconnect\s*\(/.test(realtimeMessageSource)
    && /onCatchUp\s*:/.test(realtimeMessageSource)
    && /onStateChange\s*:/.test(realtimeMessageSource),
  'Chat messages use the shared resilient subscription and catch up after reconnect or silent staleness',
);
assert(
  /state\s*===\s*['"]error['"]/.test(realtimeMessageSource)
    && /state\s*===\s*['"]closed['"]/.test(realtimeMessageSource)
    && /state\s*===\s*['"]reconnecting['"]/.test(realtimeMessageSource)
    && /setInterval\s*\([\s\S]*?15_000/.test(realtimeMessageSource),
  'an unhealthy message channel starts bounded 15-second persistence polling',
);
assert(
  /visibilityState\s*===\s*['"]visible['"]/.test(realtimeMessageSource)
    && /addEventListener\s*\(\s*['"]online['"]/.test(realtimeMessageSource)
    && /refreshThreadSnapshot\s*\(/.test(realtimeMessageSource),
  'returning to Chat or regaining connectivity triggers an immediate persistence reconciliation',
);
assert(
  !/newMsg\.user_id\s*===\s*currentUserId[\s\S]{0,80}?return/.test(realtimeMessageSource),
  'same-account messages from another tab/device are not discarded by user id',
);
assert(
  /if\s*\(!hasSubscribed\)[\s\S]*?hasSubscribed\s*=\s*true[\s\S]*?refreshThreadSnapshot\s*\(/.test(realtimeMessageSource),
  'first subscription closes the initial fetch-to-subscribe race with one catch-up snapshot',
);
assert(
  /!messagesRef\.current\.some\([\s\S]*?existing\.dbId\s*===\s*updatedRow\.id[\s\S]*?refreshThreadSnapshot\s*\(/.test(realtimeUpdateSource),
  'an UPDATE that arrives before its INSERT triggers authoritative upsert catch-up',
);
assert(
  /heartbeatMs\s*:\s*120_000/.test(realtimeMessageSource),
  'quiet healthy chats use a two-minute silent-staleness guard instead of a 30-second snapshot loop',
);
assert(
  /loadThreadMessages\s*\(/.test(realtimeMessageSource)
    && /reconcileChatMessageSnapshot\s*\(/.test(realtimeMessageSource),
  'catch-up uses an authoritative recent snapshot so missed UPDATEs cannot survive by timestamp',
);

const baseMessage = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'message',
  content: 'content',
  isBot: true,
  isUser: false,
  userName: 'OpenSwan',
  timestamp: new Date('2026-08-05T12:00:00.000Z'),
  reactions: {},
  ...overrides,
});

const staleLiveTask = baseMessage({
  id: 'stable-local-key',
  dbId: 'persisted-task',
  content: 'Old ready task',
  taskPlan: { id: 'stale-plan' } as any,
  recoveryOptions: [{ id: 'retry-stale' } as any],
  quickReplies: ['Retry'],
  showRunTrace: true,
});
const durableClosedTask = baseMessage({
  id: 'persisted-task',
  dbId: 'persisted-task',
  content: 'Task is no longer actionable',
  persistedMetadataSnapshot: null,
});
const staleActionReconciled = reconcileChatMessageSnapshot([staleLiveTask], [durableClosedTask]);
assert(
  staleActionReconciled.length === 1
    && staleActionReconciled[0].id === 'stable-local-key'
    && staleActionReconciled[0].dbId === 'persisted-task'
    && staleActionReconciled[0].taskPlan === undefined
    && staleActionReconciled[0].recoveryOptions === undefined
    && staleActionReconciled[0].quickReplies === undefined
    && staleActionReconciled[0].showRunTrace === undefined,
  'authoritative catch-up replaces stale action fields while retaining the mounted React key',
);

const optimisticLocal = baseMessage({
  id: 'optimistic-local-id',
  dbId: undefined,
  isBot: false,
  isUser: true,
  userName: 'Chris',
  content: 'hello from this tab',
});
const persistedOptimistic = baseMessage({
  id: 'database-id',
  dbId: 'database-id',
  isBot: false,
  isUser: true,
  userName: 'Chris',
  content: 'hello from this tab',
  timestamp: new Date('2026-08-05T12:00:01.000Z'),
  persistedMetadataSnapshot: { localMessageId: 'optimistic-local-id' } as any,
});
const optimisticReconciled = reconcileChatMessageSnapshot([optimisticLocal], [persistedOptimistic]);
assert(
  optimisticReconciled.length === 1
    && optimisticReconciled[0].id === 'optimistic-local-id'
    && optimisticReconciled[0].dbId === 'database-id',
  'catch-up attaches database identity without duplicating an optimistic local row',
);

const mountedPending = baseMessage({ id: 'pending-local', content: 'new streamed text', isPending: true });
const storedPending = baseMessage({ id: 'pending-local', content: 'older stored text', isPending: false });
const pendingReconciled = reconcileChatMessageSnapshot([mountedPending], [storedPending]);
assert(
  pendingReconciled.length === 1 && pendingReconciled[0].content === 'new streamed text',
  'a storage-backed pending copy cannot overwrite newer mounted streaming state',
);

const olderLoadedPage = baseMessage({
  id: 'older-page',
  dbId: 'older-page',
  timestamp: new Date('2026-08-01T12:00:00.000Z'),
});
const newestSnapshotRow = baseMessage({
  id: 'newest-row',
  dbId: 'newest-row',
  timestamp: new Date('2026-08-05T13:00:00.000Z'),
});
const pagedReconciled = reconcileChatMessageSnapshot([olderLoadedPage], [newestSnapshotRow]);
assert(
  pagedReconciled.length === 2
    && pagedReconciled[0].dbId === 'older-page'
    && pagedReconciled[1].dbId === 'newest-row',
  'bounded catch-up preserves older loaded pages and appends new persisted rows chronologically',
);

const deletedTailRow = baseMessage({
  id: 'deleted-tail',
  dbId: 'deleted-tail',
  timestamp: new Date('2026-08-05T12:30:00.000Z'),
});
const tailBoundaryRow = baseMessage({
  id: 'tail-boundary',
  dbId: 'tail-boundary',
  timestamp: new Date('2026-08-05T11:30:00.000Z'),
});
const authoritativeTail = reconcileChatMessageSnapshot(
  [olderLoadedPage, tailBoundaryRow, deletedTailRow],
  [tailBoundaryRow],
  {
    authoritativeTail: true,
    completeSnapshot: false,
    readBaselineDbIds: new Set(['older-page', 'tail-boundary', 'deleted-tail']),
  },
);
assert(
  authoritativeTail.some((message) => message.dbId === 'older-page')
    && authoritativeTail.some((message) => message.dbId === 'tail-boundary')
    && !authoritativeTail.some((message) => message.dbId === 'deleted-tail'),
  'authoritative tail catch-up prunes a missed delete inside its window while preserving older loaded pages',
);

const optimisticAfterRead = baseMessage({
  id: 'local-after-read',
  dbId: undefined,
  isBot: false,
  isUser: true,
  timestamp: new Date('2026-08-05T13:01:00.000Z'),
});
const persistedDuringRead = baseMessage({
  id: 'persisted-during-read',
  dbId: 'persisted-during-read',
  timestamp: new Date('2026-08-05T12:59:00.000Z'),
});
const completeEmpty = reconcileChatMessageSnapshot(
  [olderLoadedPage, persistedDuringRead, optimisticAfterRead],
  [],
  {
    authoritativeTail: true,
    completeSnapshot: true,
    readBaselineDbIds: new Set(['older-page']),
  },
);
assert(
  completeEmpty.length === 2
    && completeEmpty.some((message) => message.id === 'local-after-read' && !message.dbId)
    && completeEmpty.some((message) => message.dbId === 'persisted-during-read'),
  'complete empty snapshot removes only baseline durable rows and preserves optimistic and Realtime messages received during the read',
);

assert(
  /mutationReplayBlocked/.test(chatTabSource)
    && /!mutationReplayBlocked\s*&&\s*item\.recoveryOptions/.test(chatTabSource)
    && /readOnly=\{isInactiveDesignTaskMessage\(item\) \|\| mutationReplayBlocked\}/.test(chatTabSource),
  'persisted manual-verification-only computer rows cannot render retry recovery or Run again controls',
);

const typedBatchSnapshotSource = sourceSection(
  chatTabSource,
  'const structuredMessageSnapshot',
  '} catch (batchErr)',
);
assert(
  /modeOutcomeSummary\s*:\s*structured\.modeOutcomeSummary/.test(typedBatchSnapshotSource)
    && /observedEval\s*:\s*structured\.observedEval/.test(typedBatchSnapshotSource),
  'typed-batch snapshots retain emitted mode summaries and observed evaluations',
);

const typedBatchFailureSource = sourceSection(
  chatTabSource,
  '} catch (batchErr)',
  '} catch (err)',
);
const typedBatchPendingFailureSource = sourceSection(
  typedBatchFailureSource,
  'if (pendingMessage) {',
  '} else {',
);
const typedBatchNewFailureSource = sourceSection(
  typedBatchFailureSource,
  '} else {',
  "setRunStatus('idle')",
);
const failedBotFinalizerSource = sourceSection(
  chatTabSource,
  'const finalizeFailedBotMessage',
  'const applyBrowserPlanPatch',
);
assert(
  /finalizeFailedBotMessage\s*\(/.test(typedBatchPendingFailureSource),
  'typed-batch failure routes its existing pending bot row through the durable finalizer',
);
assert(
  /addBotMessage\s*\(/.test(typedBatchNewFailureSource),
  'typed-batch failure without a pending row delegates to durable addBotMessage persistence',
);
assert(
  /syncPersistedBotMessage\s*\(\s*terminalMessage\s*\)/.test(failedBotFinalizerSource)
    && /persistChatTabBotMessageWithRetry\s*\(/.test(failedBotFinalizerSource),
  'failed-bot finalization durably updates an existing row or inserts a missing row',
);
assert(
  /Object\.prototype\.hasOwnProperty\.call\(details,\s*['"]pendingMessage['"]\)/.test(failedBotFinalizerSource)
    && /const base = hasPendingMessageHint\s*\?\s*details\.pendingMessage[\s\S]*?\? messagesRef\.current\.find[\s\S]*?: undefined\s*:\s*fallbackPending/.test(failedBotFinalizerSource),
  'failed-bot finalization distinguishes an omitted pending hint from explicit null',
);

const addBotMessageSource = sourceSection(
  chatTabSource,
  'const addBotMessage',
  'useEffect(() => {',
);
assert(
  /const durability = extra\?\.durability\s*\|\|\s*\(isLegacyEphemeralChatSurface\(extra\?\.source\?\.surface\)\s*\?\s*['"]ephemeral['"]\s*:\s*['"]transcript['"]\)/.test(addBotMessageSource)
    && /durability === ['"]transcript['"] && messageThreadId/.test(addBotMessageSource)
    && /durability === ['"]transcript['"] && currentUserId && messageThreadId/.test(addBotMessageSource)
    && /durability === ['"]transcript['"]\) syncSessionArchiveMessage\(msg\)/.test(addBotMessageSource)
    && /if \(isMountedMessageScope\(\)\)\s*\{\s*setMessages/.test(addBotMessageSource)
    && /animateNewMessage\(msg\.id\)/.test(addBotMessageSource)
    && !/if\s*\(\s*!?extra\?\.localOnly\s*\)/.test(addBotMessageSource),
  'addBotMessage keeps every row visible locally, defaults unknown surfaces to transcript, and lets only explicit or allowlisted ephemeral guidance skip durable sinks independently of localOnly',
);

assert(
  /function transcriptChatMessages\(messages: ChatMessage\[\]\): ChatMessage\[\]\s*\{\s*return messages\.filter\(\(message\) => message\.durability !== ['"]ephemeral['"]\)/.test(chatTabSource)
    && occurrences(chatTabSource, 'transcriptChatMessages(messages)') >= 6,
  'ephemeral notices are excluded from later model and memory histories',
);

assert(
  /mapPersistedRowsToChatMessages[\s\S]*?\.filter\(\(message\) => !isLegacyEphemeralChatSurface\(message\.source\?\.surface\)\)/.test(chatTabSource)
    && /mapPendingBotRecordsToChatMessages[\s\S]*?records\.filter\(\(record\) => !isLegacyEphemeralChatSurface/.test(chatTabSource)
    && occurrences(chatTabSource, 'isLegacyEphemeralChatSurface(botMetadata?.source?.surface)') >= 2
    && /prev\.filter\(\(existing\) => existing\.dbId !== updatedRow\.id\)/.test(chatTabSource),
  'the exact legacy-ephemeral allowlist is shared by initial load, pending recovery, INSERT, and UPDATE removal',
);

assert(
  /Fast Refresh preserves mounted React state/.test(chatTabSource)
    && /message\.durability === ['"]ephemeral['"]\s*\|\|\s*!isLegacyEphemeralChatSurface\(message\.source\?\.surface\)/.test(chatTabSource),
  'an already-open Chat removes legacy persisted routing notices after hot reload without hiding current-session ephemeral guidance',
);

const outerSendFailureSource = sourceSection(
  sourceSection(chatTabSource, '} catch (batchErr)', 'setBotTyping(false)'),
  '} catch (err)',
  'setBotTyping(false)',
);
assert(
  /finalizeFailedBotMessage\s*\(\{\s*pendingMessage,/.test(outerSendFailureSource),
  'outer send failure passes its exact hoisted pending owner to the durable helper',
);
const hoistedPendingMessageIndex = chatTabSource.indexOf('let pendingMessage: ChatMessage | null = null;');
const outerSendFailureIndex = chatTabSource.indexOf('} catch (err)', hoistedPendingMessageIndex);
assert(
  hoistedPendingMessageIndex >= 0 && outerSendFailureIndex > hoistedPendingMessageIndex,
  'outer failure ownership is hoisted outside the inner batch/stream branches',
);

const resetMindSource = sourceSection(
  chatTabSource,
  'onResetMind={async () => {',
  'onLocalBotMessage=',
);
const resetMindMutationIndex = resetMindSource.indexOf('resetAgentMind(');
const resetMindConfirmationPrefix = resetMindMutationIndex >= 0
  ? resetMindSource.slice(0, resetMindMutationIndex)
  : '';
assert(
  resetMindMutationIndex >= 0
    && /(?:window\.)?confirm\s*\(|Alert\.alert\s*\(|confirm[A-Z]\w*\s*\(/.test(resetMindConfirmationPrefix),
  'Reset Mind requires confirmation before clearing session state',
);

const advancedToggleSource = sourceSection(
  chatTabSource,
  'onPress={() => setShowControlAdvanced((v) => !v)}',
  '{showControlAdvanced ? (',
);
assert(
  /accessibilityRole\s*=\s*['"]button['"]/.test(advancedToggleSource)
    && /accessibilityState\s*=\s*\{\{\s*expanded\s*:\s*showControlAdvanced\s*\}\}/.test(advancedToggleSource),
  'advanced-control disclosure exposes button and expanded accessibility semantics',
);

const interactionModeSelectorSource = sourceSection(
  chatTabSource,
  '{CHAT_MODE_CONFIG.map',
  'Cost footer + capability chips',
);
assert(
  /accessibilityRole\s*=\s*['"]button['"]/.test(interactionModeSelectorSource)
    && /accessibilityState\s*=\s*\{\{\s*selected\s*:\s*isActive\s*\}\}/.test(interactionModeSelectorSource),
  'advanced interaction-mode choices expose button and selected accessibility semantics',
);

if (failures > 0) {
  console.error(`\n${failures} chat-outcome-signals smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll chat-outcome-signals smoke cases passed.');
