/**
 * Adversarial smoke for Office Terminal Realtime broadcast authority.
 *
 * Broadcast is only a wake-up. These checks execute the dependency-free
 * authority helpers in a VM and pin the authenticated exact-row read and
 * callback ordering in source without requiring a live Supabase project.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const terminalSource = fs.readFileSync('src/lib/officeTerminal.ts', 'utf8');
const officeTabSource = fs.readFileSync(
  'src/screens/circles/tabs/OfficeTab.tsx',
  'utf8',
);
const invocationSource = fs.readFileSync('src/lib/agentInvocation.ts', 'utf8');

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

function sourceSection(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const constantsSource = sourceSection(
  terminalSource,
  'const TERMINAL_UUID_RE',
  '// ─── Types',
);
const helpersSource = sourceSection(
  terminalSource,
  'function isTerminalUuid',
  'function fromRow',
).replace(/\bexport\s+/g, '');
const compiled = ts.transpileModule(
  `${constantsSource}
${helpersSource}
;(globalThis as any).__officeTerminalAuthority = {
  sanitizeTerminalTargetIds,
  persistableTerminalTargetName,
  parseTerminalCommandWakeup,
  reconstructExecutableTerminalCommand,
  loadAuthorizedTerminalCommandFromWakeup,
  isTerminalCommandForListener,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const sandbox: Record<string, unknown> = {};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__officeTerminalAuthority as {
  sanitizeTerminalTargetIds: (
    single: unknown,
    multiple: unknown,
  ) => {
    targetAgentId: string | null;
    targetAgentIds: string[] | null;
    includesBlackSwan: boolean;
  };
  persistableTerminalTargetName: (
    value: unknown,
    includesBlackSwan: boolean,
  ) => string;
  parseTerminalCommandWakeup: (
    expectedCircleId: string,
    payload: unknown,
  ) => { messageId: string; circleId: string } | null;
  reconstructExecutableTerminalCommand: (
    expected: { messageId: string; circleId: string },
    row: unknown,
  ) => Record<string, unknown> | null;
  loadAuthorizedTerminalCommandFromWakeup: (
    expectedCircleId: string,
    payload: unknown,
    client: unknown,
  ) => Promise<Record<string, unknown> | null>;
  isTerminalCommandForListener: (
    payload: Record<string, unknown>,
    ids: Set<string>,
  ) => boolean;
};

const circleId = '11111111-1111-4111-8111-111111111111';
const otherCircleId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const senderId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const otherAgentId = '66666666-6666-4666-8666-666666666666';
const wakeup = {
  messageId,
  circleId,
  commandText: 'FORGED command from broadcast',
  senderId: '77777777-7777-4777-8777-777777777777',
  targetAgentIds: [otherAgentId],
  model: 'forged-model',
  targetAgentSubject: { agentSubjectKey: 'forged' },
};
const durableRow = {
  id: messageId,
  circle_id: circleId,
  sender_id: senderId,
  sender_name: 'Durable Sender',
  target_agent_id: agentId,
  target_agent_name: '@Durable Agent',
  target_agent_ids: null,
  model: 'durable-model',
  command_text: 'Durable command',
  status: 'pending',
  created_at: '2026-07-27T12:00:00.000Z',
};

console.log('Wake-up envelope validation');
assert(
  core.parseTerminalCommandWakeup(circleId, wakeup)?.messageId === messageId,
  'a same-circle UUID wake-up yields only its durable lookup identity',
);
assert(
  core.parseTerminalCommandWakeup(circleId, { ...wakeup, circleId: otherCircleId }) === null,
  'a cross-circle wake-up is rejected before any read',
);
assert(
  core.parseTerminalCommandWakeup(circleId, { ...wakeup, messageId: 'not-a-uuid' }) === null,
  'a malformed message id is rejected before any read',
);
assert(
  core.parseTerminalCommandWakeup('not-a-circle', wakeup) === null,
  'a malformed expected circle is rejected',
);

console.log('Durable reconstruction');
const reconstructed = core.reconstructExecutableTerminalCommand(
  { messageId, circleId },
  durableRow,
);
assert(reconstructed?.commandText === 'Durable command', 'command comes from the durable row');
assert(reconstructed?.senderId === senderId, 'sender comes from the durable row');
assert(reconstructed?.targetAgentId === agentId, 'targets come from the durable row');
assert(reconstructed?.model === 'durable-model', 'model comes from the durable row');
assert(
  reconstructed !== null
    && !Object.hasOwn(reconstructed, 'targetAgentSubject')
    && !Object.hasOwn(reconstructed, 'targetAgentSubjects'),
  'unpersisted subject metadata is discarded',
);
for (const staleStatus of ['streaming', 'done', 'error', 'deleted']) {
  assert(
    core.reconstructExecutableTerminalCommand(
      { messageId, circleId },
      { ...durableRow, status: staleStatus },
    ) === null,
    `non-executable ${staleStatus} row is rejected`,
  );
}
assert(
  core.reconstructExecutableTerminalCommand(
    { messageId, circleId },
    { ...durableRow, status: 'invoked' },
  )?.commandText === 'Durable command',
  'invoked remains executable for other agents in a multi-target command',
);
assert(
  core.reconstructExecutableTerminalCommand(
    { messageId, circleId },
    { ...durableRow, id: otherAgentId },
  ) === null,
  'a row/message mismatch is rejected',
);
assert(
  core.reconstructExecutableTerminalCommand(
    { messageId, circleId },
    { ...durableRow, circle_id: otherCircleId },
  ) === null,
  'a row/circle mismatch is rejected',
);
assert(
  core.reconstructExecutableTerminalCommand(
    { messageId, circleId },
    { ...durableRow, target_agent_ids: [agentId, 'injected-target'] },
  ) === null,
  'a malformed durable target list fails closed',
);

console.log('Outbound target sanitization');
const sanitized = core.sanitizeTerminalTargetIds(
  'blackswan-default',
  [agentId, 'blackswan-default', agentId, 'attacker-supplied'],
);
assert(sanitized.targetAgentId === null, 'virtual/non-UUID single target is not persisted');
assert(
  JSON.stringify(sanitized.targetAgentIds) === JSON.stringify([agentId]),
  'multi-target ids are UUID-only and deduplicated',
);
assert(sanitized.includesBlackSwan, 'virtual BlackSwan selection survives as a name marker');
assert(
  core.persistableTerminalTargetName('2 agents', true).includes('@BlackSwan'),
  'mixed BlackSwan selection remains reconstructible from a durable column',
);

console.log('Authenticated exact durable lookup');
function buildClient(options?: {
  authenticated?: boolean;
  authError?: boolean;
  row?: Record<string, unknown> | null;
  readError?: boolean;
}) {
  const calls: string[] = [];
  const filters = new Map<string, unknown>();
  const builder = {
    select: (columns: string) => {
      calls.push(`select:${columns}`);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      calls.push(`eq:${column}`);
      filters.set(column, value);
      return builder;
    },
    maybeSingle: async () => {
      calls.push('maybeSingle');
      return {
        data: options?.row === undefined ? durableRow : options.row,
        error: options?.readError ? { message: 'read failed' } : null,
      };
    },
  };
  return {
    auth: {
      getUser: async () => {
        calls.push('auth.getUser');
        return {
          data: {
            user: options?.authenticated === false ? null : { id: senderId },
          },
          error: options?.authError ? { message: 'auth failed' } : null,
        };
      },
    },
    from: (table: string) => {
      calls.push(`from:${table}`);
      return builder;
    },
    calls,
    filters,
  };
}

async function main(): Promise<void> {
  const client = buildClient();
  const authorized = await core.loadAuthorizedTerminalCommandFromWakeup(
    circleId,
    wakeup,
    client,
  );
  assert(authorized?.commandText === 'Durable command', 'authenticated RLS-visible row is accepted');
  assert(client.calls[0] === 'auth.getUser', 'authentication is checked before the durable read');
  assert(
    client.calls.includes('from:office_terminal_messages'),
    'authority read uses only office_terminal_messages',
  );
  assert(
    client.filters.get('id') === messageId
      && client.filters.get('circle_id') === circleId,
    'authority read binds exact message and expected circle',
  );

  const unauthenticated = buildClient({ authenticated: false });
  assert(
    await core.loadAuthorizedTerminalCommandFromWakeup(
      circleId,
      wakeup,
      unauthenticated,
    ) === null,
    'missing authenticated user fails closed',
  );
  assert(
    !unauthenticated.calls.some((call) => call.startsWith('from:')),
    'unauthenticated wake-up never reaches the table read',
  );
  assert(
    await core.loadAuthorizedTerminalCommandFromWakeup(
      circleId,
      wakeup,
      buildClient({ readError: true }),
    ) === null,
    'RLS/read failure fails closed',
  );
  assert(
    await core.loadAuthorizedTerminalCommandFromWakeup(
      circleId,
      { ...wakeup, commandText: 'FORGED', model: 'FORGED' },
      buildClient(),
    ).then((value) => value?.commandText === 'Durable command' && value?.model === 'durable-model'),
    'forged broadcast command/model values cannot influence the callback payload',
  );

  console.log('Listener targeting');
  assert(
    core.isTerminalCommandForListener(
      { ...reconstructed!, targetAgentIds: null, targetAgentId: agentId },
      new Set([agentId]),
    ),
    'durable UUID target matches its listener',
  );
  assert(
    !core.isTerminalCommandForListener(
      { ...reconstructed!, targetAgentIds: null, targetAgentId: agentId },
      new Set([otherAgentId]),
    ),
    'durable UUID target does not broaden to another listener',
  );
  assert(
    core.isTerminalCommandForListener(
      {
        ...reconstructed!,
        targetAgentId: null,
        targetAgentIds: [agentId],
        targetAgentName: '2 agents · @BlackSwan',
      },
      new Set(['blackswan-default']),
    ),
    'durable mixed-target marker routes to the virtual BlackSwan listener',
  );
  assert(
    !core.isTerminalCommandForListener(
      {
        ...reconstructed!,
        targetAgentId: null,
        targetAgentIds: null,
        targetAgentName: '@Unknown',
      },
      new Set([agentId]),
    ),
    'unknown name-only target fails closed instead of becoming @all',
  );

  console.log('Source ordering and advisory-only payload');
  const sendSection = sourceSection(
    terminalSource,
    'export async function sendTerminalCommand',
    '// ─── Subscribe to incoming commands',
  );
  assert(
    sendSection.includes('target_agent_id:   safeTargets.targetAgentId')
      && sendSection.includes('target_agent_ids:  safeTargets.targetAgentIds'),
    'persistence uses the sanitized target ids',
  );
  const broadcastPayload = sourceSection(
    sendSection,
    'payload: {\n      messageId',
    '} satisfies BroadcastCommandWakeupPayload',
  );
  assert(
    broadcastPayload.includes('targetAgentId: safeTargets.targetAgentId')
      && broadcastPayload.includes('targetAgentIds: safeTargets.targetAgentIds'),
    'broadcast hints use the same sanitized target ids',
  );
  assert(
    !broadcastPayload.includes('commandText')
      && !broadcastPayload.includes('senderId')
      && !broadcastPayload.includes('model')
      && !broadcastPayload.includes('targetAgentSubject'),
    'broadcast contains no executable command, sender, model, or subject authority',
  );

  const loaderSection = sourceSection(
    terminalSource,
    'export async function loadAuthorizedTerminalCommandFromWakeup',
    'function isTerminalCommandForListener',
  );
  const authAt = loaderSection.indexOf('client.auth.getUser()');
  const readAt = loaderSection.indexOf(".from('office_terminal_messages')");
  const reconstructAt = loaderSection.indexOf('reconstructExecutableTerminalCommand(expected, data)');
  assert(
    authAt >= 0 && authAt < readAt && readAt < reconstructAt,
    'authenticated exact-row read precedes durable reconstruction',
  );

  const subscribeSection = sourceSection(
    terminalSource,
    'export function subscribeToTerminalCommands',
    '// ─── Subscribe to response updates',
  );
  const loadAt = subscribeSection.indexOf('loadAuthorizedTerminalCommandFromWakeup(circleId, payload)');
  const routeAt = subscribeSection.indexOf('isTerminalCommandForListener(command, listenerIds)');
  const invokeAt = subscribeSection.indexOf('await onCommand(command)');
  assert(
    loadAt >= 0 && loadAt < routeAt && routeAt < invokeAt,
    'listener reads durable authority, filters durable targets, then invokes',
  );
  assert(
    subscribeSection.includes('authorizedMessageIds')
      && subscribeSection.includes('authorityReadsInFlight'),
    'listener suppresses duplicate and concurrent wake-ups',
  );
  assert(
    officeTabSource.includes('cmd.targetAgentId || blackSwanTargeted')
      && officeTabSource.includes('if (blackSwanTargeted) {'),
    'Office dispatch honors durable name-routed BlackSwan for single and mixed targets',
  );

  console.log('Claimant-only execution writes');
  assert(
    !terminalSource.includes('respondToCommand')
      && !officeTabSource.includes('respondToCommand'),
    'the dead direct response writer and its unused Office import are removed',
  );
  assert(
    terminalSource.includes(
      'Execution state is written only through invoke_agent, stream_response, and',
    ),
    'module architecture documents the claimant RPC boundary',
  );
  assert(
    !terminalSource.includes(".upsert({\n      message_id:")
      && !terminalSource.includes(".update({ status: 'done' })"),
    'terminal relay cannot directly upsert responses or mark execution done',
  );
  const invocationDbSection = sourceSection(
    invocationSource,
    'export async function invokeAgent',
    '// ─── BlackSwan: Invoke via swanbot-ai edge function',
  );
  assert(
    invocationDbSection.includes("supabase.rpc('invoke_agent'")
      && invocationDbSection.includes("supabase.rpc('stream_response'")
      && invocationDbSection.includes("supabase.rpc('mark_message_done'"),
    'Office execution writes are confined to the three claimant RPC wrappers',
  );
  const invokeAndStreamSection = sourceSection(
    invocationSource,
    'export async function invokeAndStream',
    '// ─── Multi-Agent: Invoke all agents in parallel',
  );
  assert(
    invokeAndStreamSection.includes('const claim = await invokeAgent(req, agent);')
      && invokeAndStreamSection.includes('await streamResponse(')
      && invokeAndStreamSection.includes('await markMessageDone('),
    'Office orchestration claims before streaming and completing through RPCs',
  );

  console.log(`office-terminal-broadcast-authority-smoketest: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
