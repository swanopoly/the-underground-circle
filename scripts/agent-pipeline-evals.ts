/**
 * agent-pipeline-evals - deterministic evals for the SwanBot/OpenSwan
 * scenario policy, execution surface, failure taxonomy, and run-ledger slice.
 *
 * Run: npm run smoke:agent-pipeline-evals
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildOpenSwanTaskPlan } from '../src/lib/openswanTaskPlanner';
import { classifyAgentFailure } from '../src/lib/agentFailureTaxonomy';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function assertChatPlan(input: string, expected: {
  pipelineId: string;
  surface: string;
  status?: string;
  approval?: boolean;
  maxUsdAtMost?: number;
}) {
  const plan = buildChatAutomationPlan({ message: input });
  assert(plan.pipeline?.id === expected.pipelineId, `${input} routes to ${expected.pipelineId}`, `got ${plan.pipeline?.id || 'none'}`);
  assert(plan.surfacePlan?.primarySurface === expected.surface, `${input} primary surface ${expected.surface}`, `got ${plan.surfacePlan?.primarySurface || 'none'}`);
  if (expected.status) {
    assert(plan.surfacePlan?.status === expected.status, `${input} surface status ${expected.status}`, `got ${plan.surfacePlan?.status || 'none'}`);
  }
  if (expected.approval !== undefined) {
    assert(plan.approval.required === expected.approval, `${input} approval=${expected.approval}`, `got ${String(plan.approval.required)}`);
  }
  if (expected.maxUsdAtMost !== undefined) {
    const actual = plan.ledgerPreview?.budget.maxUsd ?? Number.POSITIVE_INFINITY;
    assert(actual <= expected.maxUsdAtMost, `${input} budget <= ${expected.maxUsdAtMost}`, `got ${actual}`);
  }
  assert(Boolean(plan.ledgerPreview?.events.length), `${input} creates ledger preview`);
}

function assertOpenSwanPlan(input: string, expected: {
  pipelineId: string;
  surface: string;
  failureClass?: string;
  ledgerStatus?: string;
}) {
  const plan = buildOpenSwanTaskPlan(input, 'support');
  assert(plan.pipeline?.id === expected.pipelineId, `${input} OpenSwan pipeline ${expected.pipelineId}`, `got ${plan.pipeline?.id || 'none'}`);
  assert(plan.surfacePlan?.primarySurface === expected.surface, `${input} OpenSwan surface ${expected.surface}`, `got ${plan.surfacePlan?.primarySurface || 'none'}`);
  if (expected.failureClass) {
    assert(plan.failureAssessment?.failureClass === expected.failureClass, `${input} failure ${expected.failureClass}`, `got ${plan.failureAssessment?.failureClass || 'none'}`);
  }
  if (expected.ledgerStatus) {
    assert(plan.ledgerPreview?.status === expected.ledgerStatus, `${input} ledger ${expected.ledgerStatus}`, `got ${plan.ledgerPreview?.status || 'none'}`);
  }
  assert(Boolean(plan.scenarioPolicy?.completionProof.length), `${input} has completion proof policy`);
}

assertChatPlan('Tell me all the tabs I have open in Chrome right now', {
  pipelineId: 'desktop_awareness',
  surface: 'desktop_bridge',
  status: 'needs_readiness_check',
  approval: false,
  maxUsdAtMost: 0.03,
});

assertChatPlan('Log into Shopify and update this product page after I approve', {
  pipelineId: 'website_platform_admin',
  surface: 'integration_api',
  status: 'needs_readiness_check',
  approval: true,
  maxUsdAtMost: 0.6,
});

assertChatPlan('Use my saved credentials to log into Shopify and update a product page', {
  pipelineId: 'website_platform_admin',
  surface: 'integration_api',
  status: 'needs_readiness_check',
  approval: true,
  maxUsdAtMost: 0.6,
});

assertChatPlan('Why am I getting extra Anthropic API charges every day?', {
  pipelineId: 'performance_cost',
  surface: 'integration_api',
  status: 'needs_readiness_check',
  approval: false,
  maxUsdAtMost: 0.12,
});

assertOpenSwanPlan('The desktop/browser_tabs endpoint returns 404 in the local bridge', {
  pipelineId: 'bridge_troubleshooting',
  surface: 'desktop_bridge',
  failureClass: 'bridge_endpoint_missing',
  ledgerStatus: 'blocked',
});

assertOpenSwanPlan('The website is showing a Cloudflare human verification screen', {
  pipelineId: 'human_verification',
  surface: 'human_takeover',
  failureClass: 'human_verification_required',
  ledgerStatus: 'paused',
});

assert(classifyAgentFailure('Anthropic 400: claude-opus does not support tool types: computer_20250124').failureClass === 'model_tool_unsupported', 'unsupported computer-use model is classified');
assert(classifyAgentFailure('Add your own Google AI API key in Office > Customize > API Keys').failureClass === 'missing_user_key', 'missing user model key is classified');
assert(classifyAgentFailure('Access to fetch blocked by CORS policy Request header field x-uc-desktop-token').failureClass === 'cors_preflight_blocked', 'desktop token CORS is classified');
assert(classifyAgentFailure('duplicate key value violates unique constraint idx_memory_session_dedup').failureClass === 'duplicate_event', 'duplicate DB event is classified');

if (failures > 0) {
  console.error(`\n${failures} agent pipeline eval failure(s)`);
  process.exit(1);
}

console.log('\nAll agent pipeline evals passed.');
