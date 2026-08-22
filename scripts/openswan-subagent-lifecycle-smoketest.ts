/**
 * Pure smoke coverage for OpenSwan's structured spawn/list lifecycle readers.
 * This script never starts, probes, or messages an OpenSwan gateway.
 *
 * Run: npx tsx scripts/openswan-subagent-lifecycle-smoketest.ts
 */

import {
  classifyOpenSwanSubagentLifecycle,
  findOpenSwanSubagentLifecycleByProviderRunId,
  lookupOpenSwanSubagentLifecycleByProviderRunId,
  OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS,
  parseOpenSwanSessionSendHandle,
  parseOpenSwanSpawnDisposition,
  parseOpenSwanSpawnHandle,
  parseOpenSwanSubagentLifecycleSnapshot,
} from '../src/lib/openswanSubagentLifecycleCore';

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

function activeRecord(
  runId: string,
  sessionKey: string,
  status = 'running',
): Record<string, unknown> {
  return {
    runId,
    sessionKey,
    status,
    pendingDescendants: 0,
    runtimeMs: 2_500,
    startedAt: 1_000,
  };
}

function recentRecord(
  runId: string,
  sessionKey: string,
  status: 'done' | 'failed' | 'timeout' | 'unknown',
): Record<string, unknown> {
  return {
    runId,
    sessionKey,
    status,
    pendingDescendants: 0,
    runtimeMs: 4_000,
    startedAt: 1_000,
    endedAt: 5_000,
  };
}

function listDetails(
  active: unknown[],
  recent: unknown[],
): Record<string, unknown> {
  return {
    status: 'ok',
    action: 'list',
    active,
    recent,
    text: 'human-facing summary that must remain opaque',
  };
}

function main(): void {
  const directSpawn = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: 'openswan-run:42',
    childSessionKey: 'agent:main:subagent:17',
  });
  assert(directSpawn?.providerRunId === 'openswan-run:42', 'spawn reader retains the exact structured provider run id');
  assert(directSpawn?.childSessionKey === 'agent:main:subagent:17', 'spawn reader retains the exact structured child session key');
  assert(Object.isFrozen(directSpawn), 'spawn handle is immutable');

  const rawToolSpawn = parseOpenSwanSpawnHandle({
    content: [{ type: 'text', text: 'accepted' }],
    details: {
      status: 'accepted',
      runId: 'openswan-run:43',
      childSessionKey: 'agent:main:subagent:18',
    },
  });
  assert(rawToolSpawn?.providerRunId === 'openswan-run:43', 'spawn reader accepts raw structured tool details');

  const gatewaySpawn = parseOpenSwanSpawnHandle({
    ok: true,
    result: {
      content: [{ type: 'text', text: 'ignored prose' }],
      details: {
        status: 'accepted',
        runId: 'openswan-run:44',
        childSessionKey: 'agent:main:subagent:19',
      },
    },
  });
  assert(gatewaySpawn?.providerRunId === 'openswan-run:44', 'spawn reader accepts the gateway result.details envelope');
  assert(parseOpenSwanSpawnHandle({ status: 'completed', runId: 'openswan-run:42' }) === null, 'spawn reader admits only accepted structured handles');
  assert(parseOpenSwanSpawnHandle('runId=openswan-run:42') === null, 'spawn reader never parses prose');
  assert(parseOpenSwanSpawnHandle({
    content: [{ type: 'text', text: '{"status":"accepted","runId":"prose-run"}' }],
  }) === null, 'spawn reader never decodes content text as lifecycle data');

  const unsafeSpawn = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: '../../private-run',
    childSessionKey: 'session with spaces',
  });
  assert(
    unsafeSpawn?.providerRunId === null && unsafeSpawn.childSessionKey === null,
    'unsafe structured spawn ids fail closed without erasing acceptance',
  );
  const whitespaceSpawn = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: ' openswan-run:42',
    childSessionKey: 'agent:main:subagent:17 ',
  });
  assert(
    whitespaceSpawn?.providerRunId === null && whitespaceSpawn.childSessionKey === null,
    'spawn ids are preserved exactly rather than trimmed into a different identity',
  );
  const oversizedSpawn = parseOpenSwanSpawnHandle({
    status: 'accepted',
    runId: `run-${'x'.repeat(OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId)}`,
    childSessionKey: `session-${'x'.repeat(OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.childSessionKey)}`,
  });
  assert(
    oversizedSpawn?.providerRunId === null && oversizedSpawn.childSessionKey === null,
    'oversized structured spawn ids fail closed',
  );
  assert(
    parseOpenSwanSpawnHandle(new Proxy({}, { get() { throw new Error('hostile spawn getter'); } })) === null,
    'throwing spawn details fail closed without escaping',
  );

  const opaqueSpawnDetails: Record<string, unknown> = {
    status: 'accepted',
    runId: 'openswan-run:opaque',
    childSessionKey: 'agent:main:subagent:opaque',
  };
  Object.defineProperty(opaqueSpawnDetails, 'text', {
    get() { throw new Error('spawn prose must not be read'); },
  });
  assert(
    parseOpenSwanSpawnHandle(opaqueSpawnDetails)?.providerRunId === 'openswan-run:opaque',
    'spawn reader does not touch throwing prose fields',
  );

  const ambiguousSpawn = parseOpenSwanSpawnDisposition({
    status: 'error',
    runId: 'openswan-run:started-before-error',
    childSessionKey: 'agent:main:subagent:started-before-error',
    error: 'ACP registration failed after start',
  });
  assert(
    ambiguousSpawn?.phase === 'provider_error_unknown_dispatch'
      && ambiguousSpawn.transportAccepted === null,
    'spawn error with exact lineage remains dispatch-unknown',
  );
  assert(
    ambiguousSpawn?.providerRunId === 'openswan-run:started-before-error'
      && ambiguousSpawn.childSessionKey === 'agent:main:subagent:started-before-error',
    'ambiguous spawn preserves exact provider and child-session lineage',
  );
  const malformedErrorSpawn = parseOpenSwanSpawnDisposition({
    status: 'error',
    runId: '../../unsafe-run',
    childSessionKey: 'session with spaces',
  });
  assert(
    malformedErrorSpawn?.phase === 'provider_error_unknown_dispatch'
      && malformedErrorSpawn.transportAccepted === null
      && malformedErrorSpawn.providerRunId === null
      && malformedErrorSpawn.childSessionKey === null,
    'malformed spawn-error lineage erases correlation without strengthening failure evidence',
  );
  assert(
    parseOpenSwanSpawnHandle({
      status: 'error',
      runId: 'openswan-run:started-before-error',
      childSessionKey: 'agent:main:subagent:started-before-error',
    }) === null,
    'ambiguous spawn never becomes an accepted handle',
  );
  const rejectedSpawn = parseOpenSwanSpawnDisposition({ status: 'forbidden' });
  assert(
    rejectedSpawn?.phase === 'pre_dispatch_failed' && rejectedSpawn.transportAccepted === false,
    'explicit spawn access rejection remains pre-dispatch failed',
  );
  const futureSpawn = parseOpenSwanSpawnDisposition({
    status: 'future_state',
    runId: 'openswan-run:future',
    childSessionKey: 'agent:main:subagent:future',
  });
  assert(
    futureSpawn?.phase === 'unrecognized_status' && futureSpawn.transportAccepted === null,
    'unrecognized spawn status preserves bounded lineage without claiming acceptance',
  );

  const acceptedSend = parseOpenSwanSessionSendHandle({
    status: 'accepted',
    runId: 'openswan-send:accepted',
    sessionKey: 'agent:main:managed:accepted',
    delivery: { status: 'pending' },
  });
  assert(
    acceptedSend?.providerStatus === 'accepted'
      && acceptedSend.providerRunId === 'openswan-send:accepted'
      && acceptedSend.sessionKey === 'agent:main:managed:accepted',
    'sessions_send retains exact structured status, run id, and session key separately',
  );
  assert(
    acceptedSend?.phase === 'accepted'
      && acceptedSend.transportAccepted === true
      && acceptedSend.transportEnded === false
      && acceptedSend.terminalResult === null,
    'sessions_send accepted proves dispatch but no response or task result',
  );

  const okSend = parseOpenSwanSessionSendHandle({
    details: {
      status: 'ok',
      runId: 'openswan-send:ok',
      sessionKey: 'agent:main:managed:ok',
      reply: 'human reply must remain opaque',
    },
  });
  assert(
    okSend?.phase === 'turn_ended'
      && okSend.transportAccepted === true
      && okSend.transportEnded === true
      && okSend.terminalResult === 'outcome_unknown'
      && okSend.taskCompletionVerified === false,
    'sessions_send ok proves the provider turn ended but not task completion',
  );

  const timeoutSend = parseOpenSwanSessionSendHandle({
    result: {
      details: {
        status: 'timeout',
        runId: 'openswan-send:timeout',
        sessionKey: 'agent:main:managed:timeout',
        error: 'wait timed out',
      },
    },
  });
  assert(
    timeoutSend?.phase === 'response_timeout'
      && timeoutSend.transportAccepted === true
      && timeoutSend.transportEnded === false
      && timeoutSend.responseTimedOut === true
      && timeoutSend.terminalResult === null,
    'sessions_send timeout preserves accepted dispatch while response remains pending or unknown',
  );

  const errorSend = parseOpenSwanSessionSendHandle({
    status: 'error',
    runId: 'openswan-send:error',
    sessionKey: 'agent:main:managed:error',
    error: 'provider runtime failed',
  });
  assert(
    errorSend?.phase === 'provider_error_unknown_dispatch'
      && errorSend.transportAccepted === null
      && errorSend.transportEnded === null
      && errorSend.terminalResult === 'outcome_unknown',
    'sessions_send error stays ambiguous because start and waited-turn failures share one status',
  );
  const malformedErrorSend = parseOpenSwanSessionSendHandle({
    status: 'error',
    runId: '../../unsafe-run',
    sessionKey: 'session with spaces',
  });
  assert(
    malformedErrorSend?.phase === 'provider_error_unknown_dispatch'
      && malformedErrorSend.transportAccepted === null
      && malformedErrorSend.providerRunId === null
      && malformedErrorSend.sessionKey === null,
    'malformed session-send error lineage erases correlation without becoming pre-dispatch failure',
  );
  const forbiddenSend = parseOpenSwanSessionSendHandle({
    status: 'forbidden',
    runId: 'openswan-send:forbidden',
    sessionKey: 'agent:main:private',
  });
  assert(
    forbiddenSend?.phase === 'pre_dispatch_failed'
      && forbiddenSend.transportAccepted === false
      && forbiddenSend.terminalResult === 'failed',
    'sessions_send access failure remains pre-dispatch',
  );
  const notFoundSend = parseOpenSwanSessionSendHandle({
    status: 'not_found',
    runId: 'openswan-send:not-found',
    sessionKey: 'agent:main:missing',
  });
  assert(notFoundSend?.phase === 'pre_dispatch_failed', 'sessions_send structured not-found status remains pre-dispatch');
  const futureSend = parseOpenSwanSessionSendHandle({
    status: 'completed',
    runId: 'openswan-send:future',
    sessionKey: 'agent:main:future',
  });
  assert(
    futureSend?.providerStatus === 'completed'
      && futureSend.phase === 'unrecognized_status'
      && futureSend.transportAccepted === null
      && futureSend.terminalResult === 'outcome_unknown',
    'unrecognized sessions_send status is retained but never promoted to success',
  );
  assert(parseOpenSwanSessionSendHandle('status=accepted') === null, 'sessions_send reader never parses prose');
  assert(parseOpenSwanSessionSendHandle({
    content: [{ type: 'text', text: '{"status":"accepted","runId":"prose-run"}' }],
  }) === null, 'sessions_send reader never decodes content text');

  const unsafeSend = parseOpenSwanSessionSendHandle({
    status: 'accepted',
    runId: '../../private-run',
    sessionKey: 'session with spaces',
  });
  assert(
    unsafeSend?.transportAccepted === true
      && unsafeSend.providerRunId === null
      && unsafeSend.sessionKey === null,
    'sessions_send accepts only the structured status while unsafe identities fail closed',
  );
  const oversizedSend = parseOpenSwanSessionSendHandle({
    status: 'accepted',
    runId: `run-${'x'.repeat(OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId)}`,
    sessionKey: `session-${'x'.repeat(OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.childSessionKey)}`,
  });
  assert(
    oversizedSend?.providerRunId === null && oversizedSend.sessionKey === null,
    'sessions_send oversized identities fail closed',
  );
  assert(
    parseOpenSwanSessionSendHandle(new Proxy({}, { get() { throw new Error('hostile send getter'); } })) === null,
    'throwing sessions_send details fail closed without escaping',
  );
  const opaqueSendDetails: Record<string, unknown> = {
    status: 'ok',
    runId: 'openswan-send:opaque',
    sessionKey: 'agent:main:managed:opaque',
  };
  Object.defineProperties(opaqueSendDetails, {
    reply: { get() { throw new Error('reply prose must not be read'); } },
    error: { get() { throw new Error('error prose must not be read'); } },
    text: { get() { throw new Error('summary prose must not be read'); } },
  });
  assert(
    parseOpenSwanSessionSendHandle(opaqueSendDetails)?.phase === 'turn_ended',
    'sessions_send reader never touches reply, error, or summary prose',
  );

  const currentDetails = listDetails(
    [activeRecord(
      'openswan-run:active',
      'agent:main:subagent:active',
      'active (waiting on 2 children)',
    )],
    [
      recentRecord('openswan-run:done', 'agent:main:subagent:done', 'done'),
      recentRecord('openswan-run:failed', 'agent:main:subagent:failed', 'failed'),
      recentRecord('openswan-run:timeout', 'agent:main:subagent:timeout', 'timeout'),
      recentRecord('openswan-run:unknown', 'agent:main:subagent:unknown', 'unknown'),
    ],
  );
  const snapshot = parseOpenSwanSubagentLifecycleSnapshot({
    ok: true,
    result: { content: [{ type: 'text', text: 'ignored' }], details: currentDetails },
  });
  assert(snapshot?.active.length === 1 && snapshot.recent.length === 4, 'current details.active and details.recent arrays are parsed');
  assert(snapshot?.active[0]?.runtimeStatus === 'running', 'active bucket membership remains conservatively running');
  assert(snapshot?.active[0]?.providerStatus === 'active (waiting on 2 children)', 'exact bounded provider status is retained without parsing it');
  assert(snapshot?.recent.map((row) => row.runtimeStatus).join(',') === 'done,failed,timeout,unknown', 'current recent runtime statuses are retained');
  assert(snapshot?.recent[0]?.endedAt === 5_000, 'structured terminal timestamp is retained');
  assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot?.active) && Object.isFrozen(snapshot?.active[0]), 'snapshot, buckets, and rows are immutable');

  const directSnapshot = parseOpenSwanSubagentLifecycleSnapshot(currentDetails);
  assert(directSnapshot?.recent.length === 4, 'direct current list details are accepted');
  const rawToolSnapshot = parseOpenSwanSubagentLifecycleSnapshot({ details: currentDetails });
  assert(rawToolSnapshot?.active.length === 1, 'raw tool result details are accepted');

  const activeLookup = lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:active');
  assert(activeLookup.kind === 'found' && activeLookup.record.source === 'active', 'exact provider-run lookup finds an active row');
  const doneLookup = lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:done');
  assert(doneLookup.kind === 'found' && doneLookup.record.source === 'recent', 'exact provider-run lookup finds a recent row');
  assert(lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run').kind === 'not_found', 'provider-run lookup never prefix-matches');
  assert(lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'OpenSwan-run:done').kind === 'not_found', 'provider-run lookup remains case-sensitive');
  assert(lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, ' openswan-run:done').kind === 'invalid_id', 'provider-run lookup rejects whitespace-normalized identity');
  assert(findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:done')?.runtimeStatus === 'done', 'unique-match convenience lookup returns the exact row');

  const duplicateSnapshot = parseOpenSwanSubagentLifecycleSnapshot(listDetails(
    [activeRecord('openswan-run:duplicate', 'agent:main:subagent:first')],
    [recentRecord('openswan-run:duplicate', 'agent:main:subagent:second', 'done')],
  ));
  const duplicateLookup = lookupOpenSwanSubagentLifecycleByProviderRunId(
    duplicateSnapshot,
    'openswan-run:duplicate',
  );
  assert(duplicateLookup.kind === 'ambiguous' && duplicateLookup.matches === 2, 'duplicate provider run ids are explicitly ambiguous');
  assert(findOpenSwanSubagentLifecycleByProviderRunId(duplicateSnapshot, 'openswan-run:duplicate') === null, 'duplicate ambiguity never becomes first- or last-match success');

  const malformedRows = parseOpenSwanSubagentLifecycleSnapshot(listDetails(
    [
      'not an object',
      activeRecord('../../unsafe-run', 'agent:main:subagent:unsafe'),
      activeRecord('openswan-run:valid', 'agent:main:subagent:valid'),
    ],
    [
      { ...recentRecord('openswan-run:no-end', 'agent:main:subagent:no-end', 'done'), endedAt: undefined },
      { ...recentRecord('openswan-run:bad-status', 'agent:main:subagent:bad-status', 'done'), status: 'ok' },
    ],
  ));
  assert(malformedRows?.active.length === 1 && malformedRows.recent.length === 0, 'malformed rows are ignored without weakening valid structured rows');
  assert(malformedRows?.active[0]?.providerRunId === 'openswan-run:valid', 'only bounded exact row identity survives');
  assert(parseOpenSwanSubagentLifecycleSnapshot({ status: 'ok', action: 'list', active: [] }) === null, 'missing current list buckets fail closed');
  assert(parseOpenSwanSubagentLifecycleSnapshot({ status: 'ok', action: 'status', active: [], recent: [] }) === null, 'wrong structured list action fails closed');
  assert(parseOpenSwanSubagentLifecycleSnapshot({ status: 'ok', subagents: [] }) === null, 'legacy/prose-adjacent list shapes are not guessed');
  assert(parseOpenSwanSubagentLifecycleSnapshot('active subagents: none') === null, 'list reader never parses prose');

  const oversizedBucket = Array.from(
    { length: OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.entriesPerBucket + 1 },
    (_, index) => activeRecord(`openswan-run:${index}`, `agent:main:subagent:${index}`),
  );
  assert(
    parseOpenSwanSubagentLifecycleSnapshot(listDetails(oversizedBucket, [])) === null,
    'oversized lifecycle buckets fail closed instead of truncating identity evidence',
  );

  const throwingDetails = new Proxy({}, {
    get(_target, property) {
      if (property === 'status') throw new Error('hostile list details');
      return undefined;
    },
  });
  assert(parseOpenSwanSubagentLifecycleSnapshot(throwingDetails) === null, 'throwing list details fail closed without escaping');
  const throwingBucket = new Proxy(
    [activeRecord('openswan-run:throw', 'agent:main:subagent:throw')],
    { get(target, property, receiver) {
      if (property === '0') throw new Error('hostile lifecycle row');
      return Reflect.get(target, property, receiver);
    } },
  );
  assert(
    parseOpenSwanSubagentLifecycleSnapshot(listDetails(throwingBucket, [])) === null,
    'throwing lifecycle arrays fail closed without escaping',
  );

  const opaqueActive = activeRecord('openswan-run:opaque-list', 'agent:main:subagent:opaque-list');
  Object.defineProperties(opaqueActive, {
    task: { get() { throw new Error('task prose must not be read'); } },
    label: { get() { throw new Error('label prose must not be read'); } },
    line: { get() { throw new Error('line prose must not be read'); } },
  });
  const opaqueDetails = listDetails([opaqueActive], []);
  Object.defineProperty(opaqueDetails, 'text', {
    get() { throw new Error('summary prose must not be read'); },
  });
  assert(
    parseOpenSwanSubagentLifecycleSnapshot(opaqueDetails)?.active[0]?.providerRunId === 'openswan-run:opaque-list',
    'list reader never touches task, label, line, or summary prose',
  );

  const running = classifyOpenSwanSubagentLifecycle(
    findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:active'),
  );
  assert(
    running?.transportEnded === false
      && running.terminalResult === null
      && running.taskCompletionVerified === false,
    'running transport remains non-terminal and task-unverified',
  );
  const done = classifyOpenSwanSubagentLifecycle(
    findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:done'),
  );
  assert(
    done?.transportEnded === true
      && done.terminalResult === 'outcome_unknown'
      && done.reason === 'provider_done_task_unverified'
      && done.taskCompletionVerified === false,
    'provider done proves transport ended but never task completion',
  );
  const failed = classifyOpenSwanSubagentLifecycle(
    findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:failed'),
  );
  assert(
    failed?.transportEnded === true
      && failed.terminalResult === 'failed'
      && failed.reason === 'provider_failed',
    'explicit provider failure becomes an explicit failed result',
  );
  const timeout = classifyOpenSwanSubagentLifecycle(
    findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:timeout'),
  );
  assert(timeout?.terminalResult === 'outcome_unknown' && timeout.reason === 'provider_timeout', 'provider timeout remains inconclusive');
  const unknown = classifyOpenSwanSubagentLifecycle(
    findOpenSwanSubagentLifecycleByProviderRunId(snapshot, 'openswan-run:unknown'),
  );
  assert(unknown?.terminalResult === 'outcome_unknown' && unknown.reason === 'provider_unknown', 'provider unknown remains inconclusive');
  assert(classifyOpenSwanSubagentLifecycle(null) === null, 'missing lookup evidence is not converted into a terminal result');
  assert(
    classifyOpenSwanSubagentLifecycle(new Proxy({} as never, { get() { throw new Error('hostile classification'); } })) === null,
    'throwing lifecycle records fail closed during classification',
  );

  if (failures > 0) {
    console.error(`\n${failures} failure(s) across ${assertions} assertions.`);
    process.exit(1);
  }
  console.log(`\nAll ${assertions} OpenSwan subagent lifecycle assertions passed.`);
}

main();
