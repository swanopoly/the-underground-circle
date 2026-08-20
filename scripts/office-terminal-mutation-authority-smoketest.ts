/**
 * Adversarial coverage for exact Office Terminal mutations.
 *
 * Proves sender/circle/bearer-bound deletion, immutable delete receipts,
 * generation retirement, DB-atomic response cascading, and capture/fencing of
 * every non-local command builtin (especially the image-generation mutation).
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const libSource = fs.readFileSync('src/lib/officeTerminal.ts', 'utf8');
const componentSource = fs.readFileSync('src/components/OfficeTerminal.tsx', 'utf8');
const responseSchemaSource = fs.readFileSync(
  'supabase/migrations/20260226_phase3_agent_invocation.sql',
  'utf8',
);

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

const uuidConstant = sourceSection(
  libSource,
  'const TERMINAL_UUID_RE',
  'const EXECUTABLE_TERMINAL_MESSAGE_STATUSES',
);
const authorityHelpers = sourceSection(
  libSource,
  'function isTerminalUuid',
  'export function buildTerminalCommandTargetReceipt',
);
const deleteReceiptGate = sourceSection(
  libSource,
  '/** Final synchronous gate before a verified durable delete changes local UI. */',
  '/**\n * Convert presentation/runtime connection data',
);
const rowHelper = sourceSection(
  libSource,
  'function asTerminalRow',
  'function sanitizeTerminalTargetIds',
);
const exactDelete = sourceSection(
  libSource,
  'export async function deleteTerminalMessageExact',
  'export async function deleteTerminalMessage(',
);

const compiled = ts.transpileModule(
  `${uuidConstant}
${authorityHelpers}
${deleteReceiptGate}
${rowHelper}
const terminalHistoryCache = new Map();
const terminalResponsesCache = new Map();
${exactDelete}
;(globalThis as any).__terminalMutation = {
  normalizeTerminalExactAuthority,
  createTerminalAuthorityOperationFence,
  isTerminalMessageDeleteReceiptCurrent,
  deleteTerminalMessageExact,
};`.replace(/\bexport\s+/g, ''),
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const sandbox: Record<string, unknown> = {
  AbortController,
  clearInterval,
  console,
  setInterval,
};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__terminalMutation as any;

const circleId = '11111111-1111-4111-8111-111111111111';
const userA = '22222222-2222-4222-8222-222222222222';
const userB = '33333333-3333-4333-8333-333333333333';
const messageId = '44444444-4444-4444-8444-444444444444';
const authorityA = Object.freeze({
  userId: userA,
  circleId,
  accessToken: 'jwt-account-a',
  generation: 11,
});

function makeDeleteClient(options: {
  verifiedUserId?: string;
  returnedRow?: Record<string, unknown> | null;
  retireAtDelete?: () => void;
} = {}) {
  const observed = {
    authToken: '',
    tables: [] as string[],
    filters: [] as Array<[string, unknown]>,
    authorization: '',
    deleteCount: 0,
    abortSignal: null as AbortSignal | null,
  };
  const builder: any = {
    delete() { observed.deleteCount += 1; return builder; },
    eq(column: string, value: unknown) { observed.filters.push([column, value]); return builder; },
    select() { return builder; },
    setHeader(name: string, value: string) {
      if (name === 'Authorization') observed.authorization = value;
      return builder;
    },
    abortSignal(signal: AbortSignal) { observed.abortSignal = signal; return builder; },
    async maybeSingle() {
      options.retireAtDelete?.();
      return {
        data: options.returnedRow === undefined
          ? { id: messageId, circle_id: circleId, sender_id: userA }
          : options.returnedRow,
        error: null,
      };
    },
  };
  return {
    observed,
    client: {
      auth: {
        async getUser(token: string) {
          observed.authToken = token;
          return { data: { user: { id: options.verifiedUserId || userA } }, error: null };
        },
      },
      from(table: string) { observed.tables.push(table); return builder; },
    },
  };
}

async function main(): Promise<void> {
  console.log('Exact sender-owned atomic delete');
  {
    const { client, observed } = makeDeleteClient();
    const result = await core.deleteTerminalMessageExact(messageId, authorityA, () => true, client);
    assert(result.receipt?.messageId === messageId, 'verified parent delete returns exact receipt');
    assert(Object.isFrozen(result.receipt), 'delete receipt is immutable');
    assert(observed.authToken === authorityA.accessToken, 'captured bearer verifies the subject');
    assert(observed.authorization === `Bearer ${authorityA.accessToken}`, 'delete binds explicit Authorization');
    assert(observed.tables.join(',') === 'office_terminal_messages', 'exact delete mutates only the parent table');
    assert(observed.deleteCount === 1, 'exact delete performs one database mutation');
    assert(
      JSON.stringify(observed.filters) === JSON.stringify([
        ['id', messageId],
        ['circle_id', circleId],
        ['sender_id', userA],
      ]),
      'delete filters exact message, circle, and sender',
    );
    assert(observed.abortSignal instanceof AbortSignal, 'delete request carries an authority abort signal');
    assert(
      core.isTerminalMessageDeleteReceiptCurrent({
        receipt: result.receipt,
        expectedAuthority: authorityA,
        expectedMessageId: messageId,
        isCurrent: () => true,
      }),
      'matching current receipt authorizes the local removal',
    );
    assert(
      !core.isTerminalMessageDeleteReceiptCurrent({
        receipt: result.receipt,
        expectedAuthority: { ...authorityA, generation: 12 },
        expectedMessageId: messageId,
        isCurrent: () => true,
      }),
      'a new generation retires the delete receipt',
    );
  }

  console.log('Delete rejection and retirement');
  {
    const { client, observed } = makeDeleteClient({ verifiedUserId: userB });
    const result = await core.deleteTerminalMessageExact(messageId, authorityA, () => true, client);
    assert(!result.receipt, 'bearer subject mismatch returns no delete receipt');
    assert(observed.deleteCount === 0, 'bearer subject mismatch performs no delete');
  }
  {
    let current = true;
    const { client } = makeDeleteClient({ retireAtDelete: () => { current = false; } });
    const result = await core.deleteTerminalMessageExact(messageId, authorityA, () => current, client);
    assert(!result.receipt, 'retirement during delete withholds the local mutation receipt');
  }
  {
    const { client } = makeDeleteClient({
      returnedRow: { id: messageId, circle_id: circleId, sender_id: userB },
    });
    const result = await core.deleteTerminalMessageExact(messageId, authorityA, () => true, client);
    assert(!result.receipt, 'a mismatched returned sender withholds the receipt');
  }
  {
    let current = true;
    const fence = core.createTerminalAuthorityOperationFence(authorityA, () => current, 10);
    assert(fence && !fence.signal.aborted, 'current authority starts an abort-aware operation fence');
    current = false;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(fence.signal.aborted, 'generation retirement aborts an in-flight abort-aware request');
    fence.stop();
  }

  console.log('Database cascade contract');
  assert(
    /message_id\s+uuid\s+not null references office_terminal_messages\(id\) on delete cascade/i
      .test(responseSchemaSource),
    'response rows cascade atomically from the parent message delete',
  );
  assert(
    !exactDelete.includes(".from('office_terminal_responses')"),
    'exact client code never performs a fallible child-first delete',
  );

  console.log('Component mutation and builtin fencing');
  const deleteHandler = sourceSection(
    componentSource,
    '// ── Delete a message ───────────────────────────────────────────────────────',
    '// ── Handle /help builtin',
  );
  const exactDeleteBranch = sourceSection(
    deleteHandler,
    'if (exactTerminalAuthorityRequired) {',
    '// Compatibility mounts retain the legacy mutable-session delete path.',
  );
  assert(
    exactDeleteBranch.includes('message.senderId !== capturedAuthority.userId'),
    'component refuses deletion of another sender message',
  );
  assert(
    exactDeleteBranch.indexOf('await deleteTerminalMessageExact(')
      < exactDeleteBranch.lastIndexOf('removeVerifiedMessage();'),
    'durable row stays visible until the verified exact delete returns',
  );
  assert(
    exactDeleteBranch.includes('isTerminalMessageDeleteReceiptCurrent({'),
    'component gates local removal on the exact immutable receipt',
  );
  assert(
    /onDelete=\{!readOnly\s*&&\s*\(item\.id\.startsWith\('local-'\)\s*\|\|\s*item\.senderId\s*===\s*userId\)\s*\?\s*handleDelete\s*:\s*undefined\}/
      .test(componentSource),
    'delete affordance is shown only for writable local rows or the current sender',
  );

  const sendHandler = sourceSection(
    componentSource,
    '// ── Send command ───────────────────────────────────────────────────────────',
    '// ── Command history navigation',
  );
  const captureAt = sendHandler.indexOf(
    'const capturedAuthority = isPureLocalBuiltin ? null : terminalAuthorityRef.current;',
  );
  assert(captureAt >= 0, 'handleSend captures exact authority once at entry');
  for (const marker of [
    "await getAllModels()",
    "await executeDeviceCommand('devices list')",
    "await supabase.functions.invoke('image-generate'",
    'await sendTerminalCommandExact(',
  ]) {
    assert(captureAt < sendHandler.indexOf(marker), `authority capture precedes ${marker}`);
  }
  const imagineBranch = sourceSection(
    sendHandler,
    "if (cmd.startsWith('/imagine ')) {",
    '// Agent commands require both a local dispatcher',
  );
  assert(
    imagineBranch.includes('Authorization: `Bearer ${capturedAuthority.accessToken}`'),
    'image generation binds the captured bearer explicitly',
  );
  assert(
    imagineBranch.includes('signal: operationFence?.signal'),
    'image generation receives the authority abort signal',
  );
  assert(
    imagineBranch.indexOf('if (operationFence && !operationFence.isCurrent()) return;')
      < imagineBranch.indexOf('setMessages(prev => [...prev, imgMsg]);'),
    'late image results are fenced before entering UI state',
  );
  assert(
    sendHandler.includes('const isPureLocalBuiltin = cmd === \'/help\' || cmd === \'/agents\' || cmd === \'/spawn\';'),
    'only presentation-only builtins bypass exact authority',
  );

  console.log(`office-terminal-mutation-authority smoke passed (${assertions} assertions)`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
