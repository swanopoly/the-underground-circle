import assert from 'node:assert/strict';
import {
  buildImplicitBusinessModelProfiles,
  coerceBusinessModelProfiles,
  planBusinessModelForComputerTask,
} from '../src/lib/businessModelProfiles';
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
}]);
assert.equal(explicitProfiles.length, 1);

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
