/**
 * chat-proof-receipts-smoketest — verifies the Feed↔chat receipt loop
 * primitives (Phase 3c of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * origin stamp round-trip, tolerant extraction, and receipt copy shape.
 *
 * Run: npm run smoke:chat-proof-receipts
 */

import {
  buildMissionCreatedProofTitle,
  buildMissionTaskReceiptText,
  buildProofOriginDetail,
  extractProofOriginThreadId,
} from '../src/lib/chatProofReceipts';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Origin stamp round-trip ─────────────────────────────────────────────────
{
  const detail = buildProofOriginDetail('thread-123');
  expect(extractProofOriginThreadId(detail) === 'thread-123', 'stamp → extract round-trips');
  expect(
    extractProofOriginThreadId({ ...detail, otherKeys: true }) === 'thread-123',
    'extraction tolerates extra detail keys',
  );
  pass('origin stamp round-trip');
}

// ── Tolerant extraction (fails closed on foreign shapes) ────────────────────
{
  expect(extractProofOriginThreadId(null) === null, 'null detail → null');
  expect(extractProofOriginThreadId('string') === null, 'non-object detail → null');
  expect(extractProofOriginThreadId({}) === null, 'no origin key → null');
  expect(extractProofOriginThreadId({ origin: 'chat' }) === null, 'non-object origin → null');
  expect(
    extractProofOriginThreadId({ origin: { surface: 'room_chat', threadId: 't' } }) === null,
    'foreign surface → null (only main_chat stamps count)',
  );
  expect(
    extractProofOriginThreadId({ origin: { surface: 'main_chat', threadId: '  ' } }) === null,
    'blank threadId → null',
  );
  pass('extraction fails closed on foreign shapes');
}

// ── Receipt copy ────────────────────────────────────────────────────────────
{
  const receipt = buildMissionTaskReceiptText({
    taskTitle: 'Ship the Q3 landing page',
    missionTitle: 'Website refresh',
    agentName: 'BlackSwan',
    completed: true,
    resultPreview: 'Deployed to Netlify and verified the hero renders.',
  });
  expect(receipt.startsWith('✅ Task completed: **Ship the Q3 landing page**'), 'completed receipt leads with the outcome');
  expect(receipt.includes('BlackSwan ran it'), 'receipt names the actor');
  expect(receipt.includes('mission: Website refresh'), 'receipt names the mission');
  expect(receipt.includes('> Deployed to Netlify'), 'receipt quotes the result preview');
  expect(receipt.includes('Proof of work is logged in the Feed.'), 'receipt points at the proof record');

  const updated = buildMissionTaskReceiptText({
    taskTitle: 'Draft copy',
    missionTitle: 'Website refresh',
    agentName: 'Arya',
    completed: false,
  });
  expect(updated.startsWith('🔄 Task updated:'), 'non-completed receipt says updated');
  expect(!updated.includes('>'), 'no preview → no quote line');

  const longTitle = buildMissionTaskReceiptText({
    taskTitle: 'x'.repeat(300),
    missionTitle: 'y'.repeat(300),
    agentName: 'BlackSwan',
    completed: true,
    resultPreview: 'z'.repeat(500),
  });
  expect(longTitle.length < 500, 'receipt stays bounded for oversized inputs');
  pass('receipt copy shape + bounds');
}

// ── Proof title ─────────────────────────────────────────────────────────────
{
  const title = buildMissionCreatedProofTitle('Website refresh');
  expect(title === 'Mission created from chat: Website refresh', 'creation proof title shape');
  expect(buildMissionCreatedProofTitle('m'.repeat(300)).length <= 120, 'creation proof title bounded');
  pass('creation proof title');
}

if (failures > 0) {
  console.error(`\n${failures} chat proof receipts smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat proof receipts smoke cases passed.');
