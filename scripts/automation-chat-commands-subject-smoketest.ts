/**
 * automation-chat-commands-subject-smoketest
 *
 * Exercises the real `/automation` command formatter path while stubbing the
 * automation service. This pins subject display for list eventConfig and runs
 * inputContext without needing Supabase or React Native at runtime.
 *
 * Run: npm run smoke:automation-chat-commands-subject
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const automations = [
  {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Weekly report',
    enabled: true,
    triggerType: 'schedule',
    eventConfig: {
      agentSubjectMetadata: {
        agentDisplayName: 'OpenSwan',
        agentSubjectKey: 'default::blackswan',
      },
    },
    lastRunAt: null,
    lastError: null,
  },
  {
    id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    name: 'Paused scout check',
    enabled: false,
    triggerType: 'event',
    eventConfig: {
      targetAgentSubject: {
        targetAgentName: 'Scout Agent',
        targetAgentSubjectKey: 'office::scout',
      },
    },
    lastRunAt: null,
    lastError: null,
  },
];

const runs = [
  {
    id: 'run-1',
    automationId: automations[0].id,
    circleId: 'circle-smoke',
    status: 'completed',
    triggerSource: 'manual',
    triggeredBy: 'user-smoke',
    inputContext: {
      agentSubjectMetadata: {
        agentDisplayName: 'Researcher',
        agentSubjectKey: 'office::researcher',
      },
    },
    promptUsed: null,
    outputText: null,
    outputTarget: 'chat',
    startedAt: new Date(Date.now() - 120000).toISOString(),
    completedAt: new Date(Date.now() - 90000).toISOString(),
    durationMs: 1234,
    tokenCount: 0,
    modelUsed: null,
    errorMessage: null,
    estimatedCost: 0,
  },
];

const automationServiceStub = {
  async loadAutomations(circleId: string) {
    if (circleId !== 'circle-smoke') throw new Error(`unexpected circleId: ${circleId}`);
    return automations;
  },

  async loadRuns(automationId: string, limit: number) {
    if (automationId !== automations[0].id) throw new Error(`unexpected automationId: ${automationId}`);
    if (limit !== 10) throw new Error(`unexpected limit: ${limit}`);
    return runs;
  },

  async loadDashboardStats() {
    return { successfulLast7d: 1, failedLast7d: 0 };
  },

  async triggerAutomation() {
    return { runId: 'run-triggered' };
  },

  async testAutomation() {
    return { runId: 'run-tested' };
  },

  async toggleAutomation() {
    return {};
  },
};

function loadCommandModule(): typeof import('../src/lib/automationChatCommands') {
  const Module = require('node:module') as { _load: (...args: unknown[]) => unknown };
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request: unknown, parent: unknown, isMain: unknown) {
    const parentFile = typeof (parent as { filename?: unknown } | null)?.filename === 'string'
      ? String((parent as { filename: string }).filename)
      : '';
    if (
      request === '../services/automationService' &&
      parentFile.includes('/src/lib/automationChatCommands')
    ) {
      return automationServiceStub;
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    return require('../src/lib/automationChatCommands') as typeof import('../src/lib/automationChatCommands');
  } finally {
    Module._load = originalLoad;
  }
}

async function main() {
  const { executeAutomationCommand } = loadCommandModule();
  const ctx = { circleId: 'circle-smoke', userId: 'user-smoke' };

  const ignored = await executeAutomationCommand('/not-automation list', ctx);
  assert.equal(ignored, null, 'non-automation slash command falls through');

  const list = await executeAutomationCommand('/automation list', ctx);
  assert.equal(list?.success, true, '/automation list succeeds');
  assert.match(list?.message || '', /\*\*Circle automations\*\*/, 'list renders automation heading');
  assert.match(
    list?.message || '',
    /Weekly report.*subject OpenSwan \(`default::blackswan`\)/s,
    'list output displays eventConfig agentSubjectMetadata',
  );
  assert.match(
    list?.message || '',
    /Paused scout check.*subject Scout Agent \(`office::scout`\)/s,
    'list output displays nested targetAgentSubject metadata',
  );

  const history = await executeAutomationCommand('/automation runs Weekly', ctx);
  assert.equal(history?.success, true, '/automation runs succeeds');
  assert.match(history?.message || '', /\*\*Weekly report\*\*.*latest 1 runs/s, 'runs renders target automation heading');
  assert.match(
    history?.message || '',
    /COMPLETED .*subject Researcher \(`office::researcher`\)/s,
    'runs output displays inputContext agentSubjectMetadata',
  );
  assert.doesNotMatch(history?.message || '', /\[object Object\]/, 'runs output does not leak raw subject objects');

  console.log('\nautomation-chat-commands-subject smoke OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
