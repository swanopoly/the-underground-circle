/**
 * Adversarial smoke for automation-executor model-authored mutations.
 *
 * The Deno entrypoint cannot be imported by Node because it registers a
 * server and uses URL imports. This smoke executes its dependency-free policy
 * helpers in a VM, then pins the database/dispatch ordering in source.
 *
 * Run:
 *   npx tsx scripts/automation-executor-mutation-guard-smoketest.ts
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(
  'supabase/functions/automation-executor/index.ts',
  'utf8',
);

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const helperSource = section(
  'type AutomationMutationAuthorization = {',
  'function parseRoomFileActions(aiText: string)',
);
const objectHelper = section(
  'function isPlainObject(value: unknown)',
  'function boundedString(value: unknown',
);
const requestPolicyHelpers = section(
  'const MAX_RETRIES = 2;',
  '// Global kill switch',
);
const webhookPolicyHelpers = section(
  'type ApprovedAutomationWebhook = {',
  'async function routeOutput(',
);
const compiled = ts.transpileModule(
  `${objectHelper}
${helperSource}
${requestPolicyHelpers}
${webhookPolicyHelpers}
;(globalThis as any).__automationMutationGuard = {
  redactAutomationText,
  resolveCircleRoomId,
  validateExactMutationApprovalRecord,
  sanitizeExternalEventPayload,
  canManuallyRunAutomation,
  readBoundedAutomationRequest,
  getApprovedAutomationWebhookUrl,
  getApprovedTelegramFallback,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const sandbox: Record<string, unknown> = {
  crypto: webcrypto,
  errResponse: (status: number, code: string, message: string) => new Response(
    JSON.stringify({ code, message }),
    { status },
  ),
  Headers,
  ReadableStream,
  Request,
  Response,
  TextDecoder,
  TextEncoder,
  URL,
};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__automationMutationGuard as {
  redactAutomationText: (value: unknown, maxLength?: number) => string;
  resolveCircleRoomId: (
    client: unknown,
    circleId: string,
    roomReference: string,
  ) => Promise<string | null>;
  validateExactMutationApprovalRecord: (
    approval: unknown,
    identity: Record<string, unknown>,
    now?: number,
  ) => string | null;
  sanitizeExternalEventPayload: (value: unknown) => unknown;
  canManuallyRunAutomation: (
    userId: string,
    circleRole: string | null,
    automationCreatorId: unknown,
  ) => boolean;
  readBoundedAutomationRequest: (
    request: Request,
  ) => Promise<{ body: Record<string, unknown> } | { response: Response }>;
  getApprovedAutomationWebhookUrl: (
    value: unknown,
  ) => { kind: string; url: string } | null;
  getApprovedTelegramFallback: (
    token: unknown,
    chatId: unknown,
  ) => { url: string; chatId: string } | null;
};

async function main() {
const circleA = '11111111-1111-4111-8111-111111111111';
const circleB = '22222222-2222-4222-8222-222222222222';
const roomB = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const automationId = '55555555-5555-4555-8555-555555555555';
const approvalId = '66666666-6666-4666-8666-666666666666';
const fingerprint = `args-v2:sha256:${'a'.repeat(64)}`;
const contractFingerprint = `args-v2:sha256:${'b'.repeat(64)}`;

console.log('Manual-run authority and external event bounds');
{
  const automationCreator = '77777777-7777-4777-8777-777777777777';
  const otherMember = '88888888-8888-4888-8888-888888888888';
  assert(
    core.canManuallyRunAutomation(automationCreator, 'member', automationCreator),
    'the automation creator may run their own automation',
  );
  assert(
    core.canManuallyRunAutomation(otherMember, 'creator', automationCreator),
    'the reviewed circle creator role may run another creator automation',
  );
  assert(
    !core.canManuallyRunAutomation(otherMember, 'member', automationCreator),
    'an ordinary circle member cannot run another creator automation',
  );
  assert(
    !core.canManuallyRunAutomation(otherMember, 'admin', automationCreator),
    'an unreviewed future role receives no implicit automation authority',
  );

  const attackPayload = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  attackPayload.title = 'x'.repeat(5000);
  attackPayload.items = new Array(130).fill('item');
  attackPayload.deep = { a: { b: { c: { d: { e: { f: { g: 'escape' } } } } } } };
  const sanitized = core.sanitizeExternalEventPayload(attackPayload) as Record<string, any>;
  assert(sanitized.title.length <= 4001, 'individual event strings are bounded');
  assert(sanitized.items.length === 100, 'event arrays are capped');
  assert(!Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), 'prototype keys are removed');
  assert(
    JSON.stringify(sanitized).includes('[truncated]'),
    'deep event content is replaced by an explicit truncation marker',
  );

  const smallRequest = new Request('https://example.test/automation', {
    method: 'POST',
    body: JSON.stringify({ automationId, circleId: circleA, triggerSource: 'manual' }),
  });
  const smallRead = await core.readBoundedAutomationRequest(smallRequest);
  assert('body' in smallRead && smallRead.body.triggerSource === 'manual', 'small UTF-8 JSON is parsed');

  const oversizedRequest = {
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512_001));
        controller.close();
      },
    }),
  } as Request;
  const oversizedRead = await core.readBoundedAutomationRequest(oversizedRequest);
  assert(
    'response' in oversizedRead && oversizedRead.response.status === 413,
    'chunked automation bodies are stopped at the actual byte cap',
  );
}

console.log('Exact hosted webhook destinations');
{
  const telegramToken = `123456789:${'A'.repeat(35)}`;
  const credentialedSlackUrl = `https://${['user', 'pass'].join(':')}@hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx`;
  const allowed = [
    [`https://api.telegram.org/bot${telegramToken}/sendMessage?chat_id=-100123`, 'telegram'],
    ['https://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx', 'slack'],
    [`https://discord.com/api/webhooks/1234567890/${'a'.repeat(30)}?wait=true`, 'discord'],
  ] as const;
  for (const [url, kind] of allowed) {
    assert(core.getApprovedAutomationWebhookUrl(url)?.kind === kind, `${kind} exact webhook is accepted`);
  }
  for (const url of [
    'http://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx',
    'https://hooks.slack.com.evil.example/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx',
    credentialedSlackUrl,
    'https://hooks.slack.com:444/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx',
    'https://hooks.slack.com/services/T12345678/B12345678/abcdefghijklmnopqrstuvwx#secret',
    'https://127.0.0.1/internal',
    `https://api.telegram.org/bot${telegramToken}/getUpdates`,
    `https://api.telegram.org/bot${telegramToken}/sendMessage`,
    `https://api.telegram.org/bot${telegramToken}/sendMessage?redirect=https://evil.example`,
    `https://discord.com/api/webhooks/1234567890/${'a'.repeat(30)}/extra`,
  ]) {
    assert(core.getApprovedAutomationWebhookUrl(url) === null, `webhook SSRF shape is rejected: ${url}`);
  }
  assert(
    core.getApprovedTelegramFallback(telegramToken, '-100123')?.chatId === '-100123',
    'circle Telegram fallback validates both bot token and chat identity',
  );
  assert(
    core.getApprovedTelegramFallback('bad-token', '-100123') === null
      && core.getApprovedTelegramFallback(telegramToken, 'https://evil.example') === null,
    'invalid Telegram fallback settings fail closed',
  );
}

function roomClient() {
  const filters = new Map<string, unknown>();
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    ilike: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    maybeSingle: async () => {
      const ownsRoom = filters.get('circle_id') === circleB
        && filters.get('id') === roomB;
      return { data: ownsRoom ? { id: roomB } : null, error: null };
    },
  };
  return {
    from: (table: string) => {
      assert(table === 'circle_rooms', 'room resolver only queries circle_rooms');
      return builder;
    },
    filters,
  };
}

console.log('Cross-circle UUID resolution');
{
  const wrongCircle = roomClient();
  assert(
    await core.resolveCircleRoomId(wrongCircle, circleA, roomB) === null,
    'a valid UUID from another circle resolves to no target',
  );
  assert(
    wrongCircle.filters.get('circle_id') === circleA
      && wrongCircle.filters.get('id') === roomB,
    'UUID resolution binds circle ownership and target id in one query',
  );
  const ownCircle = roomClient();
  assert(
    await core.resolveCircleRoomId(ownCircle, circleB, roomB) === roomB,
    'an active room resolves only inside its owning circle',
  );
}

console.log('Exact, fresh, single-use authority');
{
  const now = Date.parse('2026-07-27T12:00:00.000Z');
  const identity = {
    userId: '77777777-7777-4777-8777-777777777777',
    circleId: circleA,
    runId,
    automationId,
    tool: 'automation.room_file_action',
    toolUseId: 'automation-file-1',
    actionId: 'room-file-1',
    toolArgsFingerprint: fingerprint,
    contractFingerprint,
    idempotencyKey: `automation:${automationId}:${runId}:room-file-1`,
  };
  const exactApproval = {
    id: approvalId,
    run_id: runId,
    circle_id: circleA,
    approval_kind: 'file_write',
    status: 'approved',
    resolved_by: identity.userId,
    requested_at: '2026-07-27T11:58:00.000Z',
    resolved_at: '2026-07-27T11:59:00.000Z',
    timeout_seconds: 300,
    payload: {
      authorizationVersion: 1,
      automationId,
      runId,
      actionId: identity.actionId,
      tool: identity.tool,
      toolArgsFingerprint: fingerprint,
      contractFingerprint,
      redacted: true,
    },
  };
  assert(
    core.validateExactMutationApprovalRecord(exactApproval, identity, now) === null,
    'fresh approval passes only for its exact automation/run/action/fingerprints',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      { ...exactApproval, circle_id: circleB },
      identity,
      now,
    ) === 'authority_not_live',
    'cross-circle approval is rejected',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        requested_at: '2026-07-27T11:39:00.000Z',
        resolved_at: '2026-07-27T11:40:00.000Z',
      },
      identity,
      now,
    ) === 'authority_expired',
    'stale approval is rejected',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        payload: {
          ...exactApproval.payload,
          consumedByActionId: identity.actionId,
        },
      },
      identity,
      now,
    ) === 'authority_identity_mismatch',
    'already-consumed approval cannot be reused',
  );
  assert(
    core.validateExactMutationApprovalRecord(
      {
        ...exactApproval,
        payload: { ...exactApproval.payload, actionId: 'room-file-2' },
      },
      identity,
      now,
    ) === 'authority_identity_mismatch',
    'generic or differently bound approval is rejected',
  );
}

console.log('Redaction behavior');
{
  const redacted = core.redactAutomationText(
    `[FILE_ACTIONS][{"action":"create","room":"secret-room","file":"/Users/alice/private.txt","content":"sk-secretvalue"}][/FILE_ACTIONS]
password=hunter2
safe summary`,
    1000,
  );
  assert(!redacted.includes('private.txt'), 'file path is removed from persisted text');
  assert(!redacted.includes('secretvalue'), 'file content/secret is removed from persisted text');
  assert(!redacted.includes('hunter2'), 'credential value is removed from persisted text');
  assert(redacted.includes('[FILE_MUTATION_REDACTED]'), 'mutation block has an explicit redaction marker');
}

console.log('Dispatch and retry source contract');
{
  const execute = section(
    'async function executeRoomFileActions(',
    '// ─── Output routing',
  );
  const approvalAt = execute.indexOf('consumeExactMutationApproval(execution, identity)');
  const claimAt = execute.indexOf('"claim_agent_action_call"');
  const startAt = execute.indexOf('"start_agent_action_call"');
  const markAt = execute.indexOf('execution.markDispatched()');
  const firstWriteAt = execute.indexOf('.update({ is_deleted: true', markAt);
  const finishAt = execute.indexOf('"finish_agent_action_call"');
  assert(
    approvalAt >= 0
      && approvalAt < claimAt
      && claimAt < startAt
      && startAt < markAt
      && markAt < firstWriteAt
      && firstWriteAt < finishAt,
    'exact authority -> fresh claim -> dispatched -> one write -> finish ordering is pinned',
  );
  assert(
    execute.includes('claim.disposition !== "claimed"')
      && execute.includes('claim.attemptCount !== 1'),
    'competing or reclaimed durable claim never dispatches',
  );
  assert(
    execute.includes('const finalState = verified ? "verified" : "outcome_unknown"')
      && execute.includes('outcome_unknown:file_mutation'),
    'ambiguous post-dispatch evidence seals outcome_unknown',
  );
  assert(
    !execute.includes('.from("room_messages")')
      && !execute.includes('results.push(`✓')
      && !execute.includes('err.message'),
    'mutation execution emits no raw path/content/error side channel or second message write',
  );

  const catchBlock = section(
    '} catch (execErr: any) {',
    'throw execErr;',
  );
  assert(
    catchBlock.includes('&& !externalMutationMayHaveDispatched')
      && catchBlock.includes('&& !mutationBlockedNoRetry')
      && catchBlock.includes('&& !requestedRunId'),
    'whole-automation retry is disabled after dispatch, safety blocks, and exact runs',
  );
  assert(
    source.includes('.is("payload->>consumedByActionId", null)')
      && source.includes('.eq("payload->>toolArgsFingerprint", identity.toolArgsFingerprint)'),
    'approval consumption uses an exact conditional single-use update',
  );
  assert(
    source.includes('.eq("circle_id", circleId)')
      && source.includes('.eq("user_id", authedUser.id)')
      && source.includes('.in("status", ["planning", "running", "waiting_approval"])'),
    'caller-supplied run authority is authenticated and circle-bound',
  );
  assert(
    source.includes('Model output is never authorization')
      && !source.includes('You have FULL ACCESS to create, update, and delete files'),
    'the model prompt cannot imply its own mutation authority',
  );
}

console.log('Request, billing, and service-run source contract');
{
  const handlerStart = source.indexOf('Deno.serve(async (req: Request) => {');
  assert(handlerStart >= 0, 'automation request handler is present');
  const handler = source.slice(handlerStart);
  const authAt = handler.indexOf('const authedUser = isServiceCaller ? null : await getAuthenticatedUser(req);');
  const boundedReadAt = handler.indexOf('await readBoundedAutomationRequest(req)');
  assert(authAt >= 0 && boundedReadAt > authAt, 'authorization precedes bounded JSON parsing');
  assert(
    handler.includes('.select("circle_id,role")')
      && handler.includes('canManuallyRunAutomation(authedUser.id, callerCircleRole, automation.created_by)'),
    'manual execution is bound to reviewed circle role and automation ownership',
  );
  assert(
    handler.includes('const keyOwnerId = authedUser?.id || automation.created_by || null;')
      && handler.includes('userId: keyOwnerId'),
    'manual BYOK resolution and usage attribution prefer the authenticated caller',
  );
  assert(
    handler.includes('triggerSource === "manual"')
      && handler.includes('&& requestedRunId')
      && handler.includes('&& mutationAuthorizations.length > 0')
      && handler.includes('} else if (!interactiveMutationEligible) {'),
    'only an exact authorized interactive run is mutation-eligible',
  );
  assert(
    handler.includes('wrapUntrusted(JSON.stringify(eventPayload)')
      && handler.includes('wrapUntrusted(githubEventsContext')
      && handler.includes('This run is mutation-ineligible.'),
    'event and GitHub content is fenced and non-interactive prompts deny mutation authority',
  );

  const routing = section('async function routeOutput(', '// ─── Build detailed report task');
  assert(
    routing.includes('getApprovedAutomationWebhookUrl(webhookUrl)')
      && routing.includes('fetch(approvedWebhook.url')
      && routing.includes('redirect: "manual"')
      && !routing.includes('fetch(webhookUrl')
      && !routing.includes('webhookUrl.includes'),
    'webhook dispatch uses only validated exact destinations with redirects disabled',
  );
}

console.log(`automation executor mutation guard smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
