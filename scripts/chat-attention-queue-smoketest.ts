/**
 * chat-attention-queue-smoketest — verifies the "Needs you" attention
 * aggregator (Phase 1a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * approval expiry/urgency tiers, clarification + live-task questions,
 * recovery + provider items, ranking, and the status line.
 *
 * Run: npm run smoke:chat-attention-queue
 */

import {
  buildChatAttentionState,
  formatChatAttentionDuration,
  resolveApprovalExpiresAt,
  type ChatAttentionApprovalInput,
} from '../src/lib/chatAttentionQueue';

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

const NOW = Date.parse('2026-07-01T12:00:00Z');
const MINUTE = 60_000;

function approvalRow(overrides: Partial<ChatAttentionApprovalInput> = {}): ChatAttentionApprovalInput {
  return {
    id: 'aaaa1111-0000-0000-0000-000000000000',
    action_type: 'chat.run_computer_task.browser',
    description: 'Approve chat action run_computer_task: "book the hotel"',
    status: 'pending',
    requested_at: new Date(NOW - 2 * MINUTE).toISOString(),
    timeout_seconds: 15 * 60,
    ...overrides,
  };
}

// ── Empty state ──────────────────────────────────────────────────────────────
{
  const state = buildChatAttentionState({}, { now: NOW });
  expect(state.items.length === 0, 'empty inputs → no items');
  expect(state.statusLine === null, 'empty inputs → no status line');
  expect(!state.hasUrgent, 'empty inputs → not urgent');
  pass('empty state stays silent');
}

// ── Approval tiers: pending / expiring / expired ────────────────────────────
{
  const pending = buildChatAttentionState({ approvals: [approvalRow()] }, { now: NOW });
  expect(pending.items.length === 1, 'pending approval → one item');
  expect(pending.items[0].kind === 'approval_pending', 'fresh approval ranks as pending');
  expect(pending.items[0].urgency === 'soon', 'fresh approval is not urgent');
  expect(pending.items[0].refId === approvalRow().id, 'approval item carries the row id');
  expect(pending.items[0].expiresAt === NOW - 2 * MINUTE + 15 * 60 * 1000, 'approval expiry derived from requested_at + timeout');
  expect(pending.items[0].title.includes('run computer task'), 'action_type humanized in title');
  expect(pending.statusLine !== null && pending.statusLine.startsWith('Needs you:'), 'status line present');
  expect(String(pending.statusLine).includes('1 approval'), 'status line counts approvals');

  const expiring = buildChatAttentionState(
    { approvals: [approvalRow({ requested_at: new Date(NOW - 12 * MINUTE).toISOString() })] },
    { now: NOW },
  );
  expect(expiring.items[0].kind === 'approval_expiring', 'approval inside the 5m window ranks as expiring');
  expect(expiring.items[0].urgency === 'now', 'expiring approval is urgent');
  expect(expiring.hasUrgent, 'expiring approval flips hasUrgent');
  expect(expiring.items[0].title.includes('expires in 3m'), 'expiring title carries countdown');

  const expired = buildChatAttentionState(
    { approvals: [approvalRow({ requested_at: new Date(NOW - 20 * MINUTE).toISOString() })] },
    { now: NOW },
  );
  expect(expired.items[0].kind === 'approval_expired', 'past-timeout pending row surfaces as expired');
  expect(expired.items[0].primaryAction.kind === 'refile_approval', 'expired approval offers Ask again');
  expect(String(expired.statusLine).includes('expired approval'), 'status line names the expiry');

  const ancient = buildChatAttentionState(
    { approvals: [approvalRow({ requested_at: new Date(NOW - 5 * 60 * MINUTE).toISOString() })] },
    { now: NOW },
  );
  expect(ancient.items.length === 0, 'expired approvals age out after the visibility window');

  const resolved = buildChatAttentionState(
    { approvals: [approvalRow({ status: 'approved' })] },
    { now: NOW },
  );
  expect(resolved.items.length === 0, 'non-pending approval rows are ignored');
  pass('approval tiers: pending / expiring / expired / aged-out / resolved');
}

// ── Clarification + live task question ──────────────────────────────────────
{
  const state = buildChatAttentionState(
    {
      pendingClarification: {
        originalMessage: 'create a task',
        pendingIntent: 'create_task',
        missingParams: ['task_title'],
        askedAt: NOW - 3 * MINUTE,
      },
      pendingTaskQuestion: {
        id: 'q-1',
        question: 'Which folder should I save the export to?',
        options: ['Desktop', 'Downloads'],
        timeoutSec: 120,
        askedAt: NOW - MINUTE,
      },
    },
    { now: NOW },
  );
  expect(state.items.length === 2, 'clarification + task question → two items');
  expect(state.items[0].kind === 'task_question_waiting', 'live task question ranks above parked clarification');
  expect(state.items[0].urgency === 'now', 'live task question is urgent');
  expect(state.items[0].detail.includes('Desktop / Downloads'), 'task question carries its options');
  expect(state.items[0].secondaryActions.some((a) => a.kind === 'cancel_task'), 'task question offers Stop task');
  const clarification = state.items[1];
  expect(clarification.kind === 'clarification_waiting', 'clarification item present');
  expect(clarification.title.includes('task title'), 'missing params humanized (underscores stripped)');
  expect(clarification.detail.includes('create a task'), 'clarification detail quotes the parked request');
  expect(clarification.waitingMs === 3 * MINUTE, 'clarification waiting time measured from askedAt');
  expect(String(state.statusLine).includes('2 questions for you'), 'status line groups questions');
  pass('clarification + live task question surface and rank correctly');
}

// ── Recovery + provider blockers ────────────────────────────────────────────
{
  const state = buildChatAttentionState(
    {
      recoveryOptions: [
        { id: 'retry_fresh', label: 'Retry with fresh evidence', detail: '', actor: 'openswan', recommended: false, source: 'evidence_contract' },
        { id: 'user_unblock', label: 'Log in and resume', detail: '', actor: 'user', recommended: true, source: 'evidence_contract' },
      ],
      recoveryContextLabel: 'WordPress publish',
      recoveryRefId: 'msg-42',
      providerBlockers: [{ provider: 'OpenAI', reason: 'API key missing — connect it in Marketplace.' }],
    },
    { now: NOW },
  );
  const recovery = state.items.find((item) => item.kind === 'recovery_available');
  expect(!!recovery, 'recovery options → recovery item');
  expect(recovery!.id === 'recovery:msg-42', 'recovery item id keyed by the failure ref (dismissal never hides the next failure)');
  expect(recovery!.title.includes('WordPress publish'), 'recovery item names the failed task');
  expect(recovery!.detail.includes('Log in and resume'), 'recommended option leads the recovery detail');
  expect(recovery!.refId === 'user_unblock', 'recovery refId points at the recommended option');
  const provider = state.items.find((item) => item.kind === 'provider_blocked');
  expect(!!provider, 'provider blocker → provider item');
  expect(provider!.primaryAction.kind === 'open_marketplace', 'provider item routes to Marketplace');
  expect(String(state.statusLine).includes('recovery choice'), 'status line mentions recovery');
  expect(String(state.statusLine).includes('1 provider to set up'), 'status line mentions provider setup');
  pass('recovery and provider blockers surface with concrete actions');
}

// ── Ranking: urgent first, then soonest expiry, then longest wait ───────────
{
  const state = buildChatAttentionState(
    {
      approvals: [
        approvalRow({ id: 'later', requested_at: new Date(NOW - MINUTE).toISOString() }),
        approvalRow({ id: 'sooner', requested_at: new Date(NOW - 8 * MINUTE).toISOString() }),
      ],
      pendingTaskQuestion: { id: 'q', question: 'Continue?', options: [], timeoutSec: 60, askedAt: NOW },
    },
    { now: NOW },
  );
  expect(state.items[0].kind === 'task_question_waiting', 'urgent question outranks approvals');
  expect(state.items[1].refId === 'sooner', 'soonest-expiring approval ranks first among approvals');
  expect(state.items[2].refId === 'later', 'later-expiring approval ranks after');
  pass('ranking: urgency, then expiry, then wait');
}

// ── Blocked runs (circle-wide queue, §5b) ───────────────────────────────────
{
  const state = buildChatAttentionState(
    {
      blockedRuns: [
        { id: 'run-1', title: 'Publish the pricing page', status: 'waiting_approval', surface: 'main_chat', started_at: new Date(NOW - 45 * MINUTE).toISOString() },
        { id: 'run-2', title: 'Nightly sweep', status: 'paused', created_at: new Date(NOW - 5 * MINUTE).toISOString() },
        { id: 'run-3', title: 'Active build', status: 'running' },
      ],
    },
    { now: NOW },
  );
  const blocked = state.items.filter((item) => item.kind === 'run_blocked');
  expect(blocked.length === 2, 'only waiting_approval/paused runs become items (running ignored)');
  expect(blocked.some((item) => item.id === 'run:run-1'), 'blocked-run item id keyed by run id');
  const waiting = state.items.find((item) => item.id === 'run:run-1');
  expect(waiting!.title.includes('waiting on a decision'), 'waiting_approval wording');
  expect(waiting!.detail.includes('blocked 45m'), 'blocked-run detail carries waiting time');
  expect(waiting!.primaryAction.kind === 'open_run', 'blocked run offers View run');
  const paused = state.items.find((item) => item.id === 'run:run-2');
  expect(paused!.title.startsWith('Run paused:'), 'paused wording');
  expect(String(state.statusLine).includes('2 runs blocked'), 'status line counts blocked runs');
  pass('blocked runs: filtering, wait time, status line');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
{
  expect(formatChatAttentionDuration(20_000) === 'just now', 'sub-minute → just now');
  expect(formatChatAttentionDuration(3 * MINUTE) === '3m', 'minutes format');
  expect(formatChatAttentionDuration(130 * MINUTE) === '2h 10m', 'hours + minutes format');
  expect(formatChatAttentionDuration(120 * MINUTE) === '2h', 'whole hours format');
  expect(resolveApprovalExpiresAt('not-a-date', 900) === null, 'bad requested_at → null expiry');
  expect(resolveApprovalExpiresAt(new Date(NOW).toISOString(), 0) === null, 'zero timeout → null expiry');
  pass('duration + expiry helpers');
}

if (failures > 0) {
  console.error(`\n${failures} chat attention queue smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat attention queue smoke cases passed.');
