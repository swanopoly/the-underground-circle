import assert from 'node:assert/strict';
import {
  buildImplicitBusinessModelProfiles,
  coerceBusinessModelProfiles,
  planBusinessModelForComputerTask,
} from '../src/lib/businessModelProfileCore';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';
import { resolveProviderRoutes } from '../src/lib/crossProviderRouter';

const providerKeys = [{
  id: 'key-1',
  provider: 'openai_compatible' as const,
  label: 'company-agent',
  endpoint: 'https://models.example.com/v1',
  isActive: true,
  createdAt: '',
  updatedAt: '',
}];

const implicitProfiles = buildImplicitBusinessModelProfiles(providerKeys);
assert.equal(implicitProfiles.length, 1);
assert.equal(implicitProfiles[0].provider, 'openai_compatible');
assert.equal(implicitProfiles[0].modelId, 'company-agent');
assert(implicitProfiles[0].allowedSurfaces.includes('browser'));

const explicitProfiles = coerceBusinessModelProfiles([{
  id: 'finance-browser',
  label: 'Finance Browser Agent',
  provider: 'openai_compatible',
  modelId: 'finance-agent',
  priority: 1,
  allowedSurfaces: ['browser', 'automation'],
  capabilities: { toolUse: true, browserPlanning: true, structuredOutput: true },
  governance: { allowCredentialUse: false, allowExternalSideEffects: false },
}, {
  label: 'Legacy HF Alias',
  provider: 'hugging_face',
  modelId: 'meta-llama/Llama-3.3-70B-Instruct',
  allowedSurfaces: ['chat', 'invalid-surface'],
  governance: { requireApprovalFor: ['browser', 'bad-surface'], maxAutonomousRisk: 'bad-risk' },
}, {
  label: 'Invalid Provider',
  provider: 'not-a-provider',
  modelId: 'nope',
}]);
assert.equal(explicitProfiles.length, 2);
assert.equal(explicitProfiles[1].provider, 'huggingface');
assert.deepEqual(explicitProfiles[1].allowedSurfaces, ['chat']);
assert.deepEqual(explicitProfiles[1].governance?.requireApprovalFor, ['browser']);
assert.equal(explicitProfiles[1].governance?.maxAutonomousRisk, 'medium');

const preview = planComputerTaskPreview('Log in to our CRM and update the renewal date');
assert.equal(preview.kind, 'browser_task');

const plan = planBusinessModelForComputerTask({
  task: 'Log in to our CRM and update the renewal date',
  preview,
  profiles: [...explicitProfiles, ...implicitProfiles],
  providerKeys,
});
assert.equal(plan.routeProvider, 'openai_compatible');
assert.equal(plan.routeModel, 'finance-agent');
assert.equal(plan.canUseCredentials, false);
assert.equal(plan.canCreateExternalSideEffects, false);
assert.equal(plan.approvalRequired, true);
assert(plan.notes.some((note) => /vault|credentials/i.test(note)));

const routes = resolveProviderRoutes('business-default', {
  available: new Set(['openai_compatible']),
  prefer: ['openai_compatible', 'openrouter'],
});
assert.equal(routes[0]?.provider, 'openai_compatible');
assert.equal(routes[0]?.modelId, 'business-default');

console.log('All business-model-routing smoke cases passed.');
