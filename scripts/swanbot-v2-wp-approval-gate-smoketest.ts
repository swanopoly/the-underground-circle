/**
 * swanbot-v2-wp-approval-gate-smoketest
 *
 * Offline guard for SwanBot v2 client-only WordPress mutation safety. This
 * intentionally checks the real source wiring so a future refactor cannot
 * accidentally let wp.* writes bypass the exact tool+args approval row.
 *
 * Run: npm run smoke:swanbot-v2-wp-approval-gate
 */

import { readFileSync } from 'node:fs';

import {
  buildOpenSwanToolApprovalKey,
  resolveOpenSwanRuntimeApprovalDecision,
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
    /executeClientToolCalls\(pendingCalls,\s*\{\s*circleId,\s*userId,\s*runId:\s*response\.continuationRunId,\s*\}\)/s.test(swanbotSource),
    'continuation passes run-scoped approval context into client tools',
  );
  assert(
    /dispatchOneClientTool\(bridge,\s*call,\s*context\)/.test(swanbotSource),
    'client tool loop forwards approval context into dispatcher',
  );
  assert(
    /context\?:\s*\{\s*circleId:\s*string;\s*userId:\s*string;\s*runId:\s*string\s*\}/s.test(swanbotSource),
    'dispatcher context includes circleId userId and runId',
  );
}

function assertSwanBotWpGateWiring(): void {
  assert(swanbotSource.includes('SWANBOT_CLIENT_WP_MUTATION_TOOLS'), 'mutating WordPress tool set exists');
  for (const tool of MUTATING_WP_TOOLS) {
    assert(swanbotSource.includes(`'${tool}'`), `${tool} is in source`);
    assert(
      swanbotSource.includes(`case '${tool}':`) && swanbotSource.includes(`withSwanBotClientWordPressApproval(call.name, input, context`),
      `${tool} is routed through the approval wrapper`,
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
  assert(swanbotSource.includes("key === 'approvalId'"), 'approval key ignores caller-supplied approvalId');
  assert(swanbotSource.includes("key === 'toolApprovalKey'"), 'approval key ignores caller-supplied toolApprovalKey');
  assert(swanbotSource.includes(".from('agent_run_approvals')"), 'approval resolver queries agent_run_approvals');
  assert(swanbotSource.includes(".eq('run_id', context.runId)"), 'approval lookup is scoped to continuation run id');
  assert(swanbotSource.includes(".eq('circle_id', context.circleId)"), 'approval lookup is scoped to circle id');
  assert(swanbotSource.includes('buildOpenSwanToolApprovalKey(input.tool, args)'), 'missing approvals create exact tool+args key');
  assert(swanbotSource.includes('resolveOpenSwanRuntimeApprovalDecision'), 'approval decisions reuse OpenSwan exact matcher');
  assert(swanbotSource.includes('requestRunApproval'), 'missing approvals create a pending run approval');
  assert(swanbotSource.includes('I did not touch WordPress'), 'blocked messages are customer-safe and explicit');
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

function assertApprovalDecisionMatrix(): void {
  const args = {
    siteUrl: 'https://dealer.example',
    onePasswordItem: 'Dealer Inspire WP',
    postId: 14030,
    postType: 'di_slide',
    title: 'Promaster June Offer',
  };
  const exactKey = buildOpenSwanToolApprovalKey('wp.update_post', args);
  const wrongArgsKey = buildOpenSwanToolApprovalKey('wp.update_post', { ...args, postId: 14031 });
  const callerInjectedKey = buildOpenSwanToolApprovalKey('wp.update_post', { ...args, toolApprovalKey: exactKey });

  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'approved_exact', status: 'approved', payload: { toolApprovalKey: exactKey } }],
    }).kind === 'pass',
    'exact approved approval key passes',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'auto_exact', status: 'auto_approved', payload: { toolApprovalKey: exactKey } }],
    }).kind === 'pass',
    'exact auto-approved approval key passes',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'pending_exact', status: 'pending', payload: { toolApprovalKey: exactKey } }],
    }).kind === 'defer',
    'exact pending approval key defers',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'rejected_exact', status: 'rejected', payload: { toolApprovalKey: exactKey } }],
    }).kind === 'block',
    'exact rejected approval key blocks',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'wrong_args', status: 'approved', payload: { toolApprovalKey: wrongArgsKey } }],
    }).kind === 'new',
    'approved key for different post id does not pass',
  );
  assert(
    resolveOpenSwanRuntimeApprovalDecision({
      tool: 'wp.update_post',
      args,
      rows: [{ id: 'generic', status: 'approved', payload: { tool: 'wp.update_post', label: 'Approve WordPress update' } }],
    }).kind === 'new',
    'generic approval payload does not pass',
  );
  assert(
    callerInjectedKey !== exactKey,
    'caller-supplied toolApprovalKey would alter the approval digest unless stripped by SwanBot',
  );
}

assertSwanBotContinuationContext();
assertSwanBotWpGateWiring();
assertEdgeToolContracts();
assertSharedValidationWiring();
assertApprovalDecisionMatrix();

if (failures > 0) {
  console.error(`\n${failures} SwanBot WordPress approval-gate smoke failure(s)`);
  process.exit(1);
}

console.log('\nSwanBot WordPress approval-gate smoke OK');
