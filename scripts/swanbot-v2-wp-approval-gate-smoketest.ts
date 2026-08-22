/**
 * swanbot-v2-wp-approval-gate-smoketest
 *
 * Offline guard for SwanBot client-side WordPress and always-confirm
 * approval safety. It pins the canonical v2 digest/audit shape plus the real
 * source wiring around authenticated persisted identity and single-use CAS.
 *
 * Run: npm run smoke:swanbot-v2-wp-approval-gate
 */

import { readFileSync } from 'node:fs';

import {
  buildOpenSwanApprovalAuditPayload,
  buildOpenSwanApprovalAuthorityBindingDigest,
  buildOpenSwanToolApprovalDigest,
  resolveOpenSwanRuntimeApprovalDecision,
  type OpenSwanRuntimeApprovalRow,
} from '../src/lib/openswanToolApprovals';

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string): void {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function extractSwitchCase(source: string, tool: string): string {
  const marker = `case '${tool}':`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const afterStart = source.slice(start + marker.length);
  const nextCase = afterStart.search(/\n\s*(?:case '[^']+'|default):/);
  return nextCase >= 0 ? afterStart.slice(0, nextCase) : afterStart;
}

function extractFunction(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const swanbotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
const openswanRuntimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');

const MUTATING_WP_TOOLS = [
  'wp.upload_media',
  'wp.create_slide',
  'wp.update_post',
  'wp.trash_post',
] as const;

const READ_ONLY_WP_TOOLS = [
  'wp.discover_types',
  'wp.list_posts',
] as const;

function assertSwanBotContinuationContext(): void {
  assert(
    swanbotSource.includes('runId: response.continuationRunId')
      && swanbotSource.includes('iteration: i + 1'),
    'continuation passes persisted run and loop iteration into client tools',
  );
  assert(
    // The dispatcher now receives a copied context so the per-batch call
    // ordinal can be sealed into the runtime receipt. Pin the spread itself:
    // it preserves the approval resume binding, user constraints, iteration,
    // and approval callback while allowing receipt-only fields to be added.
    /dispatchOneClientTool\(\s*bridge,\s*call,\s*context\s*\?\s*\{\s*\.\.\.context,\s*sourceCallOrdinal:\s*sourceCallOrdinalByToolUseId\.get\(call\.id\)\s*\|\|\s*undefined,\s*\}\s*:\s*undefined,/s.test(swanbotSource),
    'client tool loop forwards approval context into dispatcher',
  );
  assert(
    /type SwanBotClientToolApprovalContext = \{[\s\S]*toolUseId: string;[\s\S]*iteration: number;/m.test(swanbotSource),
    'approval context binds exact provider tool-use identity and iteration',
  );
  assert(
    swanbotSource.includes('toolUseId: block.id')
      && swanbotSource.includes('iteration: round + 1'),
    'legacy SwanBot loop passes exact block identity into always-confirm floor',
  );
}

function assertSwanBotWpGateWiring(): void {
  assert(swanbotSource.includes('SWANBOT_CLIENT_WP_MUTATION_TOOLS'), 'mutating WordPress tool set exists');
  for (const tool of MUTATING_WP_TOOLS) {
    assert(swanbotSource.includes(`'${tool}'`), `${tool} is in source`);
    assert(
      swanbotSource.includes(`case '${tool}':`)
        && swanbotSource.includes('withSwanBotClientWordPressApproval(call.name, input, context, call.id'),
      `${tool} is routed through the exact-call approval wrapper`,
    );
  }
  for (const tool of READ_ONLY_WP_TOOLS) {
    const caseBody = extractSwitchCase(swanbotSource, tool);
    assert(swanbotSource.includes(`case '${tool}':`), `${tool} is in source`);
    assert(
      caseBody.includes(`return dispatch${tool === 'wp.discover_types' ? 'WpDiscoverTypes' : 'WpListPosts'}(input);`)
        && !caseBody.includes('withSwanBotClientWordPressApproval'),
      `${tool} remains direct/read-only`,
    );
  }

  assert(
    swanbotSource.includes('SWANBOT_APPROVAL_METADATA_ARG_KEYS')
      && swanbotSource.includes("'dispatchBindingDigest'")
      && swanbotSource.includes("'toolApprovalDigest'"),
    'caller-supplied approval metadata is stripped from exact args',
  );
  assert(
    swanbotSource.includes('buildOpenSwanToolApprovalDigest')
      && swanbotSource.includes('buildOpenSwanApprovalAuditPayload')
      && swanbotSource.includes('resolveOpenSwanRuntimeApprovalDecision'),
    'SwanBot reuses canonical v2 digest, payload, and resolution helpers',
  );
  assert(
    !swanbotSource.includes('toolApprovalKeyVersion: 1'),
    'SwanBot no longer creates legacy v1 approval payloads',
  );
  const requestFunction = extractFunction(
    swanbotSource,
    'requestOrConsumeSwanBotApproval',
    'resolveSwanBotClientToolApproval',
  );
  assert(
    requestFunction.includes('payload,')
      && !/payload:\s*\{[\s\S]*?\bargs\b/.test(requestFunction),
    'approval request persists the canonical safe payload, never raw args',
  );

  const wrapperFunction = extractFunction(
    swanbotSource,
    'withSwanBotClientWordPressApproval',
    'resolveSwanBotFloorApproval',
  );
  assert(
    wrapperFunction.indexOf('resolveSwanBotClientToolApproval') >= 0
      && wrapperFunction.indexOf('resolveSwanBotClientToolApproval') < wrapperFunction.indexOf('await dispatch()'),
    'WordPress approval is atomically resolved before mutation dispatch',
  );
  assert(
    swanbotSource.includes('I did not touch WordPress'),
    'blocked WordPress messages remain customer-safe and explicit',
  );
}

function assertAuthenticatedSingleUseWiring(): void {
  const authFunction = extractFunction(
    swanbotSource,
    'hasAuthenticatedPersistedSwanBotApprovalCall',
    'consumeSwanBotApprovalAuthority',
  );
  assert(
    authFunction.includes('supabase.auth.getUser()')
      && authFunction.includes("from('agent_runs')")
      && authFunction.includes(".eq('user_id', context.userId)")
      && authFunction.includes(".eq('circle_id', context.circleId)"),
    'approval authority requires current auth and persisted user/circle run',
  );

  const consumeFunction = extractFunction(
    swanbotSource,
    'consumeSwanBotApprovalAuthority',
    'findCrossRunApprovedToolPass',
  );
  assert(
    consumeFunction.includes('buildOpenSwanApprovalAuthorityBindingDigest')
      && consumeFunction.includes("source: input.source"),
    'consume receipt cryptographically binds run/call/source authority',
  );
  assert(
    consumeFunction.includes(".eq('requested_by', input.context.userId)")
      && consumeFunction.includes(".eq('payload->>toolApprovalDigest', exactDigest)")
      && consumeFunction.includes(".is('payload->>dispatchBindingDigest', null)")
      && consumeFunction.includes(".gt('requested_at', expiryCutoff)")
      && consumeFunction.includes("select('id')"),
    'approved row is consumed with exact single-use, live-row CAS predicates',
  );
  assert(
    consumeFunction.includes('data.length !== 1'),
    'zero-row and competing multi-row CAS outcomes fail closed',
  );
  assert(
    !consumeFunction.includes('update({ payload: input.args')
      && !consumeFunction.includes('args: input.args'),
    'atomic consume persists no raw tool arguments',
  );

  const crossRunFunction = extractFunction(
    swanbotSource,
    'findCrossRunApprovedToolPass',
    'requestOrConsumeSwanBotApproval',
  );
  assert(
    crossRunFunction.includes(".eq('requested_by', input.context.userId)")
      && crossRunFunction.includes("source: 'cross_run'")
      && crossRunFunction.includes('consumeSwanBotApprovalAuthority'),
    'cross-run retry is current-user scoped and consumes its source grant once',
  );
}

function assertAlwaysConfirmFloorWiring(): void {
  const floorFunction = extractFunction(
    swanbotSource,
    'resolveSwanBotFloorApproval',
    'dispatchWpDiscoverTypes',
  );
  assert(
    floorFunction.includes('requestOrConsumeSwanBotApproval')
      && floorFunction.includes("policyFamily: 'always_confirm_floor'")
      && floorFunction.includes('floorCategory: input.category'),
    'always-confirm floor uses the same v2 exact approval contract',
  );
  assert(
    floorFunction.includes('outcome.kind ===')
      && floorFunction.includes('already used')
      && floorFunction.includes('request a fresh confirmation'),
    'floor blocks replay/malformed authority and asks for fresh state',
  );
}

function assertEdgeToolContracts(): void {
  for (const tool of [...READ_ONLY_WP_TOOLS, ...MUTATING_WP_TOOLS]) {
    assert(edgeSource.includes(`name: "${tool}"`), `${tool} is exposed by SwanBot v2 edge tool list`);
  }
  for (const tool of MUTATING_WP_TOOLS) {
    const toolBlock = edgeSource.match(new RegExp(`name: "${tool.replace('.', '\\.')}"[\\s\\S]*?additionalProperties: false,`))?.[0] || '';
    assert(toolBlock.includes('additionalProperties: false'), `${tool} schema rejects unknown arguments`);
    assert(
      toolBlock.includes('requires an exact approved HITL gate') || toolBlock.includes('Requires approval before'),
      `${tool} schema description advertises approval gate`,
    );
  }
  const trashBlock = edgeSource.match(/name: "wp\.trash_post"[\s\S]*?handler:/)?.[0] || '';
  assert(trashBlock.includes('Never use for permanent delete'), 'trash tool description forbids permanent delete');
  assert(!trashBlock.includes('force:'), 'trash tool schema does not expose force');

  const createSlideBlock = edgeSource.match(/name: "wp\.create_slide"[\s\S]*?handler:/)?.[0] || '';
  assert(createSlideBlock.includes('Defaults to draft'), 'create_slide description stays draft-first');
  assert(createSlideBlock.includes('enum: ["draft", "publish"]'), 'create_slide status enum is draft/publish only');
}

function assertSharedValidationWiring(): void {
  for (const source of [
    ['SwanBot', swanbotSource],
    ['OpenSwan runtime', openswanRuntimeSource],
  ] as const) {
    assert(
      source[1].includes('normalizeWordPressUpdatePostMutation'),
      `${source[0]} uses shared wp.update_post mutation normalizer`,
    );
    assert(
      source[1].includes('normalizeWordPressTrashPostMutation'),
      `${source[0]} uses shared wp.trash_post mutation normalizer`,
    );
  }
}

async function assertApprovalDecisionMatrix(): Promise<void> {
  const args = {
    siteUrl: 'https://dealer.example',
    onePasswordItem: 'Dealer Inspire WP',
    postId: 14030,
    postType: 'di_slide',
    title: 'Promaster June Offer',
    nested: { unchanged: ['a', 'b'], tail: 'exact' },
  };
  const exactDigest = await buildOpenSwanToolApprovalDigest('wp.update_post', args);
  const wrongArgsDigest = await buildOpenSwanToolApprovalDigest(
    'wp.update_post',
    { ...args, nested: { ...args.nested, tail: 'changed' } },
  );
  const basePayload = buildOpenSwanApprovalAuditPayload({
    toolName: 'wp.update_post',
    approvalDigest: exactDigest,
    policyFamily: 'wordpress',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: true,
  });
  const wrongPayload = buildOpenSwanApprovalAuditPayload({
    toolName: 'wp.update_post',
    approvalDigest: wrongArgsDigest,
    policyFamily: 'wordpress',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: true,
  });
  const nowMs = Date.now();
  const baseRow = {
    run_id: '33333333-3333-4333-8333-333333333333',
    circle_id: '22222222-2222-4222-8222-222222222222',
    requested_by: '11111111-1111-4111-8111-111111111111',
    requested_at: new Date(nowMs - 1_000).toISOString(),
    timeout_seconds: 300,
  } satisfies OpenSwanRuntimeApprovalRow;
  const row = (
    id: string,
    status: string,
    payload: Record<string, unknown> | null,
  ): OpenSwanRuntimeApprovalRow => ({ ...baseRow, id, status, payload });

  assert(
    Boolean(exactDigest) && exactDigest !== wrongArgsDigest,
    'SHA-256 approval digest covers long-tail nested argument changes',
  );
  assert(
    Boolean(basePayload)
      && basePayload?.toolApprovalKey === exactDigest
      && !Object.hasOwn(basePayload || {}, 'args')
      && !JSON.stringify(basePayload).includes('Dealer Inspire WP'),
    'v2 audit payload contains only digest-safe structural metadata',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved', basePayload)],
      nowMs,
    }).kind === 'pass',
    'exact live approved v2 row passes intent resolution',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'auto_approved', basePayload)],
      nowMs,
    }).kind === 'pass',
    'exact live auto-approved v2 row passes intent resolution',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pending', basePayload)],
      nowMs,
    }).kind === 'defer',
    'exact pending v2 row defers',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'rejected', basePayload)],
      nowMs,
    }).kind === 'block',
    'exact rejected v2 row blocks',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'approved', wrongPayload)],
      nowMs,
    }).kind === 'new',
    'approved v2 digest for different nested args does not pass',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        'approved',
        { toolApprovalKeyVersion: 1, toolApprovalKey: JSON.stringify(args), args },
      )],
      nowMs,
    }).kind === 'block',
    'legacy raw-args v1 approval fails closed',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [{
        ...row('12121212-1212-4212-8212-121212121212', 'approved', basePayload),
        requested_at: new Date(nowMs - 301_000).toISOString(),
      }],
      nowMs,
    }).kind === 'block',
    'expired approved v2 row fails closed',
  );

  const binding = await buildOpenSwanApprovalAuthorityBindingDigest({
    approvalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    approvalDigest: exactDigest,
    status: 'approved',
    source: 'run_scoped',
    identity: {
      userId: baseRow.requested_by,
      circleId: baseRow.circle_id,
      runId: baseRow.run_id,
      toolName: 'wp.update_post',
      toolUseId: 'toolu_wp_exact_1',
      iteration: 1,
    },
  });
  const consumedPayload = buildOpenSwanApprovalAuditPayload({
    toolName: 'wp.update_post',
    approvalDigest: exactDigest,
    policyFamily: 'wordpress',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: true,
    dispatchBindingDigest: binding,
    dispatchConsumedAt: new Date(nowMs - 100).toISOString(),
  });
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      approvalDigest: exactDigest,
      rows: [row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved', consumedPayload)],
      nowMs,
    }).kind === 'block',
    'already-consumed approval cannot replay',
  );
}

async function main(): Promise<void> {
  assertSwanBotContinuationContext();
  assertSwanBotWpGateWiring();
  assertAuthenticatedSingleUseWiring();
  assertAlwaysConfirmFloorWiring();
  assertEdgeToolContracts();
  assertSharedValidationWiring();
  await assertApprovalDecisionMatrix();

  if (failures > 0) {
    console.error(`\n${failures} SwanBot WordPress approval-gate smoke failure(s)`);
    process.exit(1);
  }
  console.log('\nSwanBot WordPress approval-gate smoke OK');
}

void main();
