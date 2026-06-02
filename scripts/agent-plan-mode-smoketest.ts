import assert from 'node:assert/strict';
import {
  buildAgentPlanDraft,
  formatAgentPlanForChat,
  shouldCreateAgentPlanForMessage,
} from '../src/lib/agentPlanMode';

const buildPlan = buildAgentPlanDraft({
  task: 'Plan how to implement Cursor-style Plan Mode, checkpoints, and Office handoff in the app',
  selectedMode: 'plan',
  selectedModel: 'auto',
  circleId: '00000000-0000-0000-0000-000000000000',
  threadId: 'thread-smoke',
  sourceMessageId: 'msg-smoke',
});

assert.equal(shouldCreateAgentPlanForMessage('/plan build the thing', 'act'), true);
assert.equal(shouldCreateAgentPlanForMessage('build the thing', 'plan'), true);
assert.equal(shouldCreateAgentPlanForMessage('build the thing', 'act'), false);
assert.ok(buildPlan.steps.length >= 3, 'plan should include executable steps');
assert.ok(buildPlan.steps.some((step) => step.kind === 'checkpoint'), 'plan should include checkpoint step');
assert.ok(buildPlan.steps.some((step) => step.kind === 'verify'), 'plan should include verification step');
assert.equal(buildPlan.metadata.architecture, 'chat_swanbot_openswan_office');
assert.equal(buildPlan.flow.swanbot.role, 'planner');
assert.ok(buildPlan.flow.openswan.recommendedTools.length > 0, 'OpenSwan tools should feed the plan');

const browserPlan = buildAgentPlanDraft({
  task: 'Log into WordPress, publish the draft, and submit the form',
  selectedMode: 'plan',
});
assert.ok(
  browserPlan.risk === 'review' || browserPlan.risk === 'external_side_effect',
  `browser/external workflow should not be risk safe, got ${browserPlan.risk}`,
);
assert.ok(browserPlan.steps.some((step) => step.requiresApproval), 'risky workflow should require approval');
assert.ok(
  browserPlan.metadata.recommendedTools.some((tool) => tool.startsWith('browser.') || tool.startsWith('vault.') || tool === 'approvals.request'),
  'browser/vault/approval tools should be represented',
);

const localFilePlan = buildAgentPlanDraft({
  task: 'Scan my local computer files and find the PDF about taxes',
  selectedMode: 'plan',
});
assert.ok(
  localFilePlan.metadata.recommendedTools.some((tool) => tool === 'desktop.file_search' || tool === 'desktop.file_read'),
  'local file asks should route through desktop file tools',
);

const formatted = formatAgentPlanForChat(buildPlan, { persisted: true });
assert.match(formatted, /Architecture Flow/);
assert.match(formatted, /Build ready/);
assert.match(formatted, /Recommended Tools/);

console.log('agent-plan-mode smoketest passed');
