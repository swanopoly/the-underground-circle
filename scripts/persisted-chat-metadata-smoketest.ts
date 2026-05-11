/**
 * persisted-chat-metadata-smoketest - protects saved chat rows from
 * oversized bot metadata payloads. Browser/computer plans can be large;
 * persisted messages must stay below the DB content check while keeping
 * valid metadata JSON.
 *
 * Run: npm run smoke:persisted-chat-metadata
 */

import {
  BOT_META_MARKER,
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  stripPersistedChatBotPrefix,
} from '../src/lib/persistedChatMetadata';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

const hugePlan = {
  planId: 'plan_1',
  task: 'Inspect a very large browser workflow '.repeat(80),
  backend: 'browserbase_stagehand',
  backendLabel: 'Browserbase Stagehand',
  backendDetails: 'Remote Browserbase session',
  requiresApproval: true,
  status: 'planned',
  actions: Array.from({ length: 60 }, (_, index) => ({
    id: `action_${index}`,
    type: 'click',
    target: `#selector-${index}-${'x'.repeat(500)}`,
    value: 'value '.repeat(120),
    description: `Detailed action ${index} ${'details '.repeat(160)}`,
    requiresApproval: index % 2 === 0,
  })),
};

const message = formatPersistedChatBotMessage(
  'OpenSwan',
  'Long assistant response. '.repeat(600),
  {
    browserPlans: [hugePlan as any],
    executionStream: Array.from({ length: 40 }, (_, index) => ({
      id: `step_${index}`,
      step: `step ${index}`,
      status: 'completed',
      body: 'large execution body '.repeat(200),
    })) as any,
  },
);

assert(message.length <= 9000, 'formatted bot message stays under DB content cap', `length ${message.length}`);
assert(message.trim().length > 0, 'formatted bot message is never empty');
assert(message.includes(BOT_META_MARKER) || message.includes('[truncated for saved chat]'), 'large metadata is compacted or safely dropped');
assert(stripPersistedChatBotPrefix(message).trim().length > 0, 'visible saved message content remains readable');

if (message.includes(BOT_META_MARKER)) {
  const metadata = readPersistedChatBotMetadata(message);
  assert(!!metadata, 'metadata JSON remains parseable after compaction');
  assert((metadata?.browserPlans?.[0]?.actions?.length || 0) <= 10, 'browser plan actions are compacted');
}

if (failures > 0) {
  console.error(`\n${failures} persisted-chat metadata smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll persisted-chat metadata smoke cases passed.');
