/**
 * Adversarial smoke for Office Terminal account-switch dispatch authority.
 *
 * Runs the dependency-injected exact sender and pure receipt helpers in a VM,
 * then pins the component's capture-before-await / retire-on-unmount wiring.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const libSource = fs.readFileSync('src/lib/officeTerminal.ts', 'utf8');
const componentSource = fs.readFileSync('src/components/OfficeTerminal.tsx', 'utf8');

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

const constants = sourceSection(libSource, 'const TERMINAL_UUID_RE', '// ─── Types');
const authorityHelpers = sourceSection(
  libSource,
  'function isTerminalUuid',
  '/**\n * Convert presentation/runtime connection data',
);
const targetHelpers = sourceSection(
  libSource,
  'function asTerminalRow',
  'function parseTerminalCommandWakeup',
);
const exactSender = sourceSection(
  libSource,
  'function terminalTargetIdsMatch',
  '// ─── Subscribe to incoming commands',
);
const compiled = ts.transpileModule(
  `${constants}
${targetHelpers}
${authorityHelpers}
${exactSender}
;(globalThis as any).__terminalExact = {
  normalizeTerminalExactAuthority,
  terminalExactAuthorityMatches,
  buildTerminalCommandTargetReceipt,
  buildTerminalCommandDispatchReceipt,
  isTerminalCommandDispatchReceiptCurrent,
  sendTerminalCommandExact,
};`.replace(/\bexport\s+/g, ''),
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const sandbox: Record<string, unknown> = {};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__terminalExact as any;

async function main(): Promise<void> {
const circleId = '11111111-1111-4111-8111-111111111111';
const userA = '22222222-2222-4222-8222-222222222222';
const userB = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const agentId = '55555555-5555-4555-8555-555555555555';
const authorityA = Object.freeze({
  userId: userA,
  circleId,
  accessToken: 'jwt-account-a',
  generation: 7,
});

console.log('Exact authority + immutable receipt');
const normalized = core.normalizeTerminalExactAuthority(authorityA);
assert(normalized?.userId === userA, 'valid exact authority normalizes');
assert(Object.isFrozen(normalized), 'normalized authority is immutable');
assert(
  core.normalizeTerminalExactAuthority({ ...authorityA, accessToken: '' }) === null,
  'missing bearer fails closed',
);
assert(
  core.normalizeTerminalExactAuthority({ ...authorityA, generation: 0 }) === null,
  'non-positive generation fails closed',
);
const target = core.buildTerminalCommandTargetReceipt({
  targetAgentId: agentId,
  targetAgentIds: [agentId],
  targetAgentName: '@Claude Code',
});
const receipt = core.buildTerminalCommandDispatchReceipt({ messageId, authority: authorityA, target });
assert(Object.isFrozen(target) && Object.isFrozen(target.targetAgentIds), 'target receipt is deeply immutable');
assert(Object.isFrozen(receipt) && Object.isFrozen(receipt.authority), 'dispatch receipt freezes exact authority');
assert(
  core.isTerminalCommandDispatchReceiptCurrent({
    receipt,
    expectedAuthority: authorityA,
    expectedTargetFingerprint: target.fingerprint,
    isCurrent: () => true,
  }),
  'matching current authority and target receipt can dispatch',
);
assert(
  !core.isTerminalCommandDispatchReceiptCurrent({
    receipt,
    expectedAuthority: { ...authorityA, generation: 8 },
    expectedTargetFingerprint: target.fingerprint,
    isCurrent: () => true,
  }),
  'a new authority generation retires the receipt',
);
assert(
  !core.isTerminalCommandDispatchReceiptCurrent({
    receipt,
    expectedAuthority: authorityA,
    expectedTargetFingerprint: `${target.fingerprint}:changed`,
    isCurrent: () => true,
  }),
  'a changed target fingerprint retires the receipt',
);

function makeClient(options: {
  verifiedUserId?: string;
  returnedSenderId?: string;
  retireAtInsert?: () => void;
}) {
  const observed = {
    bearerVerified: '',
    authorizationHeader: '',
    insert: null as Record<string, unknown> | null,
  };
  const builder: any = {
    insert(value: Record<string, unknown>) { observed.insert = value; return builder; },
    select() { return builder; },
    setHeader(name: string, value: string) {
      if (name === 'Authorization') observed.authorizationHeader = value;
      return builder;
    },
    async single() {
      options.retireAtInsert?.();
      return {
        data: {
          id: messageId,
          circle_id: circleId,
          sender_id: options.returnedSenderId || userA,
          target_agent_id: agentId,
          target_agent_name: '@Claude Code',
          target_agent_ids: [agentId],
          status: 'pending',
        },
        error: null,
      };
    },
  };
  return {
    observed,
    client: {
      auth: {
        async getUser(token: string) {
          observed.bearerVerified = token;
          return { data: { user: { id: options.verifiedUserId || userA } }, error: null };
        },
      },
      from() { return builder; },
    },
  };
}

const params = {
  circleId,
  senderId: userA,
  senderName: 'Account A',
  commandText: 'inspect the repo',
  targetAgentId: agentId,
  targetAgentIds: [agentId],
  targetAgentName: '@Claude Code',
  model: null,
};

console.log('Captured-bearer persistence');
{
  let current = true;
  let wakeups = 0;
  const { client, observed } = makeClient({});
  const result = await core.sendTerminalCommandExact(
    params,
    authorityA,
    () => current,
    client,
    async () => ({ async send() { wakeups += 1; return 'ok'; } }),
  );
  assert(result.receipt?.messageId === messageId, 'exact insert returns a dispatch receipt');
  assert(observed.bearerVerified === authorityA.accessToken, 'subject verification uses captured bearer');
  assert(
    observed.authorizationHeader === `Bearer ${authorityA.accessToken}`,
    'insert carries captured Authorization explicitly',
  );
  assert(observed.insert?.sender_id === userA, 'persisted sender is the captured user');
  assert(wakeups === 1, 'still-current exact persistence emits one advisory wake-up');
  current = false;
}

console.log('Account-switch rejection');
{
  const { client } = makeClient({ verifiedUserId: userB });
  let wakeups = 0;
  const result = await core.sendTerminalCommandExact(
    params,
    authorityA,
    () => true,
    client,
    async () => ({ async send() { wakeups += 1; return 'ok'; } }),
  );
  assert(!result.messageId && !result.receipt, 'bearer subject mismatch persists nothing');
  assert(wakeups === 0, 'bearer subject mismatch emits no wake-up');
}
{
  let current = true;
  const { client } = makeClient({ retireAtInsert: () => { current = false; } });
  let wakeups = 0;
  const result = await core.sendTerminalCommandExact(
    params,
    authorityA,
    () => current,
    client,
    async () => ({ async send() { wakeups += 1; return 'ok'; } }),
  );
  assert(result.messageId === messageId && !result.receipt, 'retirement after insert withholds dispatch receipt');
  assert(wakeups === 0, 'retirement after insert emits no wake-up');
}
{
  const { client } = makeClient({ returnedSenderId: userB });
  let wakeups = 0;
  const result = await core.sendTerminalCommandExact(
    params,
    authorityA,
    () => true,
    client,
    async () => ({ async send() { wakeups += 1; return 'ok'; } }),
  );
  assert(result.messageId === messageId && !result.receipt, 'mismatched sender row withholds dispatch receipt');
  assert(wakeups === 0, 'mismatched persistence receipt emits no wake-up');
}

console.log('Component continuation wiring');
const sendSection = sourceSection(
  componentSource,
  '// ── Send command ───────────────────────────────────────────────────────────\n  const handleSend = useCallback(async () =>',
  '// ── Command history navigation',
);
assert(
  sendSection.indexOf('const capturedAuthority = terminalAuthorityRef.current')
    < sendSection.indexOf('await sendTerminalCommandExact'),
  'component captures authority before the persistence await',
);
assert(
  sendSection.includes('isTerminalCommandDispatchReceiptCurrent({'),
  'component revalidates authority and target receipt before dispatch',
);
assert(
  sendSection.indexOf('isTerminalCommandDispatchReceiptCurrent({')
    < sendSection.indexOf('capturedDispatcher(Object.freeze({'),
  'receipt gate runs before the captured callback',
);
assert(
  !sendSection.includes('await sendTerminalCommand({'),
  'agent command path cannot fall back to mutable-auth persistence',
);
assert(
  componentSource.includes('terminalMountedRef.current = false;')
    && componentSource.includes('terminalAuthorityRef.current = null;'),
  'unmount synchronously retires the component authority',
);

console.log(`office-terminal-exact-authority smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
