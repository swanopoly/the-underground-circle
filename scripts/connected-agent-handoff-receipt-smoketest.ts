/**
 * connected-agent-handoff-receipt-smoketest
 *
 * Pure contract coverage for Chat's connected-agent acknowledgement and
 * accepted-run projection.
 * This test never probes, launches, or messages a local agent bridge.
 *
 * Run: npx tsx scripts/connected-agent-handoff-receipt-smoketest.ts
 */

import {
  buildConnectedAgentAcceptedRunProjection,
  buildConnectedAgentHandoffReceipt,
  CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS,
  projectConnectedAgentHandoffSnapshot,
  readConnectedAgentHandoffReceipt,
  type ConnectedAgentHandoffReceipt,
} from '../src/lib/connectedAgentHandoffCore';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  stripPersistedChatBotPrefix,
} from '../src/lib/persistedChatMetadata';
import { parseOpenSwanSpawnHandle } from '../src/lib/openswanSubagentLifecycleCore';

let assertions = 0;
let failures = 0;

function assert(condition: unknown, message: string, detail?: string): void {
  assertions += 1;
  if (condition) {
    console.log('pass:', message);
    return;
  }
  failures += 1;
  console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`);
}

function main(): void {
  const openSwanHandle = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: 'openswan-run:42',
    childSessionKey: 'openswan-session:17',
  });
  assert(openSwanHandle?.providerRunId === 'openswan-run:42', 'OpenSwan preserves a structured provider run id');
  assert(openSwanHandle?.childSessionKey === 'openswan-session:17', 'OpenSwan preserves a structured child session key');
  assert(parseOpenSwanSpawnHandle({ status: 'completed', runId: 'openswan-run:42' }) === null, 'OpenSwan spawn parser admits only accepted handles');
  assert(parseOpenSwanSpawnHandle('runId=openswan-run:42') === null, 'OpenSwan never infers lifecycle ids from prose');
  const unsafeOpenSwanHandle = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: '../../local-run',
    childSessionKey: 'session with spaces',
  });
  assert(unsafeOpenSwanHandle?.providerRunId === null && unsafeOpenSwanHandle.childSessionKey === null, 'OpenSwan rejects unsafe lifecycle identifiers');
  assert(parseOpenSwanSpawnHandle(new Proxy({}, { get() { throw new Error('hostile getter'); } })) === null, 'OpenSwan spawn parser fails closed on hostile structured details');

  const runId = '11111111-1111-4111-8111-111111111111';
  const accepted = buildConnectedAgentHandoffReceipt({
    status: 'accepted',
    provider: 'Claude Code',
    actor: 'Repo Builder',
    sessionId: 'claude-session:42',
    providerRunId: 'provider-run:84',
    runId,
    message: 'Sent to the managed Claude Code session.',
  });
  assert(accepted.status === 'accepted', 'bridge send remains an accepted handoff');
  assert(accepted.provider === 'claude-code', 'provider is normalized to a bounded token');
  assert(accepted.actor === 'Repo Builder', 'bounded actor attribution is preserved');
  assert(accepted.sessionId === 'claude-session:42', 'safe session id is preserved');
  assert(accepted.providerRunId === 'provider-run:84', 'provider-owned run lineage stays explicitly external');
  assert(accepted.runId === runId, 'an explicit canonical run id is preserved');
  assert(accepted.message === 'Sent to the managed Claude Code session.', 'bounded bridge acknowledgement is preserved');
  assert(accepted.completionVerified === false, 'accepted never claims completion');

  const drafted = buildConnectedAgentHandoffReceipt({
    status: 'drafted',
    provider: 'openrouter',
    actor: 'Research helper',
    message: 'Here is a synchronous advisory draft.',
  });
  assert(drafted.status === 'drafted', 'synchronous AI output is distinguished from bridge acceptance');
  assert(drafted.runId === null && drafted.sessionId === null, 'draft output does not synthesize runtime lineage');
  assert(drafted.completionVerified === false, 'draft output never claims delegated-task completion');

  const failed = buildConnectedAgentHandoffReceipt({
    status: 'failed',
    provider: 'codex',
    actor: 'Codex',
    message: 'The bridge could not accept the task.',
  });
  assert(failed.status === 'failed', 'failure remains distinct from accepted and drafted');
  assert(failed.message.includes('could not accept'), 'bounded failure copy is preserved');
  assert(failed.completionVerified === false, 'failure never claims completion');

  const unknown = buildConnectedAgentHandoffReceipt({
    status: 'unknown',
    provider: 'openswan',
    actor: 'OpenSwan session',
    sessionId: 'agent:main:subagent:uncertain',
    providerRunId: 'openswan-run:uncertain',
    message: 'Dispatch may have started; check the session before retrying.',
  });
  assert(unknown.status === 'unknown', 'uncertain dispatch remains distinct from accepted, drafted, and failed');
  assert(unknown.runId === null, 'uncertain dispatch never creates local run lineage');
  assert(unknown.providerRunId === 'openswan-run:uncertain', 'uncertain dispatch preserves exact external lineage');
  assert(unknown.completionVerified === false, 'uncertain dispatch never claims task completion');
  assert(projectConnectedAgentHandoffSnapshot(unknown)?.status === 'unknown', 'uncertain dispatch survives durable metadata projection');

  const persistedSnapshot = projectConnectedAgentHandoffSnapshot(accepted);
  assert(persistedSnapshot?.status === 'accepted', 'a valid receipt projects to a durable snapshot');
  assert(persistedSnapshot?.runId === runId, 'the snapshot preserves only canonical local run lineage');
  assert(persistedSnapshot?.providerRunId === 'provider-run:84', 'the snapshot keeps provider lineage in its distinct field');
  assert(!('message' in (persistedSnapshot || {})), 'the snapshot does not duplicate visible response prose');
  const rehydrated = readConnectedAgentHandoffReceipt({
    ...persistedSnapshot,
    message: 'Rehydrated from the visible chat row.',
  });
  assert(rehydrated?.status === 'accepted' && rehydrated.runId === runId, 'strict receipt reading rehydrates a persisted snapshot plus visible copy');
  assert(readConnectedAgentHandoffReceipt({ ...persistedSnapshot, completionVerified: true }) === null, 'rehydration rejects a receipt that claims completion');
  assert(readConnectedAgentHandoffReceipt({ ...persistedSnapshot, actor: '' }) === null, 'rehydration rejects missing actor attribution');
  const persistedMessage = formatPersistedChatBotMessage(
    'OpenSwan',
    accepted.message,
    { connectedAgentHandoff: persistedSnapshot, runId },
  );
  const persistedMetadata = readPersistedChatBotMetadata(persistedMessage);
  assert(stripPersistedChatBotPrefix(persistedMessage) === accepted.message, 'visible handoff copy round-trips outside the metadata envelope');
  assert(persistedMetadata?.connectedAgentHandoff?.status === 'accepted', 'persisted Chat metadata rehydrates the handoff status');
  assert(persistedMetadata?.connectedAgentHandoff?.runId === runId, 'persisted Chat metadata rehydrates canonical local run lineage');
  assert(persistedMetadata?.connectedAgentHandoff?.providerRunId === 'provider-run:84', 'persisted Chat metadata rehydrates distinct provider lineage');
  assert(!('message' in (persistedMetadata?.connectedAgentHandoff || {})), 'persisted Chat metadata never duplicates visible response copy');

  const unlinkedAccepted = buildConnectedAgentHandoffReceipt({
    status: 'accepted',
    provider: 'codex',
    actor: 'Codex Builder',
    sessionId: 'codex-session:17',
    providerRunId: 'codex-turn:91',
    message: 'The managed session accepted the task.',
  });
  const projection = buildConnectedAgentAcceptedRunProjection({
    receipt: unlinkedAccepted,
    task: 'Fix the Chat and Office handoff.\nKeep the lifecycle truthful.',
    threadId: 'circle-thread:12',
  });
  assert(projection?.surface === 'main_chat', 'accepted handoff projects to the canonical main_chat surface');
  const officeProjection = buildConnectedAgentAcceptedRunProjection({
    receipt: unlinkedAccepted,
    task: 'Run this from the Office terminal.',
    surface: 'office_terminal',
    externalDispatchKind: 'sessions_send',
    externalConnectionId: 'openswan-connection:1',
  });
  assert(officeProjection?.surface === 'office_terminal', 'Office acceptance keeps its canonical office_terminal surface');
  assert(officeProjection?.metadata.externalDispatchKind === 'sessions_send', 'structured OpenSwan dispatch kind remains bounded run metadata');
  assert(officeProjection?.metadata.externalConnectionId === 'openswan-connection:1', 'exact OpenSwan connection remains distinct run metadata');
  assert(
    buildConnectedAgentAcceptedRunProjection({
      receipt: unlinkedAccepted,
      task: 'Do not accept an invented surface.',
      surface: 'unknown_surface',
    }) === null,
    'an explicit unknown surface fails closed instead of becoming main_chat',
  );
  assert(projection?.mode === 'execute', 'accepted handoff projects to an executable task run');
  assert(projection?.provider === 'codex' && projection.delegatedTo === 'Codex Builder', 'projection preserves provider and actor attribution');
  assert(projection?.goal.startsWith('Fix the Chat and Office handoff.'), 'projection preserves the bounded delegated task');
  assert(projection?.metadata.handoffStatus === 'accepted', 'projected run metadata remains explicitly accepted');
  assert(projection?.metadata.completionVerified === false, 'projected run metadata never claims completion');
  assert(projection?.metadata.externalLifecycle === 'awaiting_typed_result', 'projected run remains awaiting a typed result');
  assert(projection?.metadata.externalSessionId === 'codex-session:17', 'external session id remains metadata');
  assert(projection?.metadata.externalProviderRunId === 'codex-turn:91', 'provider run id remains external metadata');
  assert(projection?.metadata.threadId === 'circle-thread:12', 'circle thread id remains metadata only');
  assert(projection?.metadata.connectedAgentHandoff.runId === null, 'projection never promotes an external id to local run identity');
  assert(!('status' in (projection || {})), 'pure projection leaves queued status to canonical createRun');
  assert(!('chatSessionId' in (projection || {})), 'circle thread id is never projected as legacy chat_session_id');
  assert(!('heartbeat' in (projection?.metadata || {})), 'accepted projection does not fabricate runtime heartbeat activity');
  assert(buildConnectedAgentAcceptedRunProjection({ receipt: drafted, task: 'Draft this.' }) === null, 'drafted handoff creates no run projection');
  assert(buildConnectedAgentAcceptedRunProjection({ receipt: failed, task: 'Retry this.' }) === null, 'failed handoff creates no run projection');
  assert(buildConnectedAgentAcceptedRunProjection({ receipt: unknown, task: 'Check before retrying.' }) === null, 'uncertain handoff creates no run projection');
  assert(buildConnectedAgentAcceptedRunProjection({ receipt: accepted, task: 'Already linked.' }) === null, 'an already-linked receipt creates no duplicate run projection');

  const oversized = buildConnectedAgentHandoffReceipt({
    status: 'accepted',
    provider: `codex-${'x'.repeat(CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.provider)}`,
    actor: 'A'.repeat(CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.actor + 50),
    sessionId: `session-${'s'.repeat(CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.sessionId)}`,
    providerRunId: `provider-${'p'.repeat(CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.providerRunId)}`,
    message: 'M'.repeat(CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.message + 500),
  });
  assert(oversized.provider === null, 'oversized provider fails closed');
  assert(oversized.actor.length <= CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.actor, 'actor is clamped to its public bound');
  assert(oversized.sessionId === null, 'oversized session id fails closed');
  assert(oversized.providerRunId === null, 'oversized provider run id fails closed');
  assert(oversized.message.length <= CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.message, 'message is clamped to its public bound');

  const unsafeIds = buildConnectedAgentHandoffReceipt({
    status: 'accepted',
    provider: '../codex',
    actor: 'Builder\u202e hidden',
    sessionId: '../../private/session',
    runId: 'run_123; DROP TABLE agent_runs',
    message: 'Accepted.',
  });
  assert(unsafeIds.provider === null, 'unsafe provider token is rejected');
  assert(!unsafeIds.actor.includes('\u202e'), 'bidirectional control characters are removed from actor labels');
  assert(unsafeIds.sessionId === null, 'unsafe session id is rejected');
  assert(unsafeIds.runId === null, 'non-canonical run id is rejected');

  const noSyntheticRun = buildConnectedAgentHandoffReceipt({
    status: 'accepted',
    provider: 'codex',
    sessionId: runId,
    message: `Session ${runId} accepted the task.`,
  });
  assert(noSyntheticRun.sessionId === runId, 'UUID-shaped session id may remain session lineage');
  assert(noSyntheticRun.runId === null, 'run id is never inferred from session id or message text');

  const invalidCompletion = buildConnectedAgentHandoffReceipt({
    status: 'completed',
    provider: 'codex',
    completionVerified: true,
    message: 'Done',
  });
  assert(invalidCompletion.status === 'failed', 'unknown completed status fails closed');
  assert(invalidCompletion.completionVerified === false, 'hostile completion input is ignored');

  const hostile = new Proxy(Object.create(null), {
    get() { throw new Error('hostile getter'); },
  });
  let hostileReceipt: ConnectedAgentHandoffReceipt | null = null;
  try {
    hostileReceipt = buildConnectedAgentHandoffReceipt(hostile);
  } catch {
    // Assertion below reports the totality failure without aborting the suite.
  }
  assert(hostileReceipt?.status === 'failed', 'throwing getters produce a fail-closed receipt without throwing');
  assert(hostileReceipt?.provider === null && hostileReceipt?.runId === null, 'hostile input cannot inject provider or run lineage');

  const junk = buildConnectedAgentHandoffReceipt('accepted');
  assert(junk.status === 'failed', 'non-object input fails closed');
  assert(junk.message.length > 0, 'fail-closed receipt always has bounded user-facing copy');

  if (failures > 0) {
    console.error(`\n${failures} failure(s) across ${assertions} assertions.`);
    process.exit(1);
  }
  console.log(`\nAll ${assertions} connected-agent handoff receipt assertions passed.`);
}

main();
