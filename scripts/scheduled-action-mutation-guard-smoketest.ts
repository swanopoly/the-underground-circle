import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), 'utf8');

const client = read('src/lib/scheduledActions.ts');
const runner = read('supabase/functions/scheduled-action-runner/index.ts');
const worker = read('src/lib/agentApprovalsWorker.ts');
const outbox = read('src/components/PendingActionsOutbox.tsx');
const migration = read(
  'supabase/migrations/20260726_scheduled_action_mutation_guard.sql',
).trim();
const consolidated = read('docs/RUN_THIS_SQL.sql');

let checks = 0;
const ok = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks += 1;
};
const has = (source: string, value: string, message: string) =>
  ok(source.includes(value), message);
const lacks = (source: string, value: string, message: string) =>
  ok(!source.includes(value), message);

// Caller defaults and even explicit unsafe overrides fail closed.
has(client, 'requires_approval: true,', 'scheduleAction must always require approval');
has(client, 'max_retries: 0,', 'scheduleAction must always disable mutation retries');
lacks(
  client,
  'requires_approval: input.requiresApproval',
  'explicit requiresApproval=false must not reach storage',
);
lacks(
  client,
  'max_retries: input.maxRetries',
  'explicit retry budgets must not reach storage',
);

// Legacy rows cannot bypass the runner gate.
has(
  runner,
  'const gate = await handleApprovalGate(supabase, action);',
  'every due action must enter the approval gate',
);
lacks(
  runner,
  'if (action.requires_approval)',
  'legacy requires_approval=false must not skip approval',
);
has(
  runner,
  'requires_approval: true,\n        max_retries: 0,',
  'claim must normalize legacy unsafe policy',
);

// Approval rows use the real schema and contain only bounded metadata.
for (const field of [
  'circle_id: action.circle_id',
  'session_key: binding.sessionKey',
  "agent_name: 'Scheduler'",
  'action_type: binding.actionType',
  'description: binding.description',
  'payload: binding.payload',
  "status: 'pending'",
  'timeout_seconds: APPROVAL_TTL_SECONDS',
]) {
  has(runner, field, `approval insert must set ${field}`);
}
lacks(runner, 'action_detail:', 'runner must not use the nonexistent action_detail column');
for (const field of [
  'actionId: action.id',
  'userId: action.user_id',
  'circleId: action.circle_id',
  'actionKind: action.kind',
  'payloadFingerprint',
  'occurrenceFingerprint',
]) {
  has(runner, field, `approval binding must include ${field}`);
}
has(runner, "'SHA-256'", 'payload and occurrence bindings must be cryptographic');
has(
  runner,
  'JSON.stringify(canonicalize(action.payload || {}))',
  'approval must bind the canonical payload fingerprint',
);
lacks(
  runner.slice(
    runner.indexOf('.insert({\n        circle_id: action.circle_id'),
    runner.indexOf('// A concurrent runner can win'),
  ),
  'action.payload',
  'approval row must never persist the raw scheduled payload',
);

// Exact, fresh, explicit, single-use authority.
for (const condition of [
  ".eq('session_key', binding.sessionKey)",
  ".eq('action_type', binding.actionType)",
  ".eq('description', binding.description)",
  ".eq('status', 'approved')",
  ".eq('resolved_by', action.user_id)",
  ".eq('requested_at', approval.requested_at)",
  ".eq('resolved_at', approval.resolved_at)",
  ".eq('timeout_seconds', APPROVAL_TTL_SECONDS)",
  ".is('applied_at', null)",
]) {
  has(runner, condition, `approval CAS must include ${condition}`);
}
has(runner, 'approval.status !== \'approved\'', 'auto approvals must not authorize mutations');
has(runner, 'resolvedAt >= expiresAt', 'approval resolution must occur before expiry');
has(runner, 'Date.now() >= expiresAt', 'approval must be rechecked after the CAS round-trip');
has(runner, 'approval.applied_at', 'reused approval rows must be rejected');
has(runner, "code: 'approval_consumed'", 'reused approval must have a fixed failure code');

// One durable claim winner and one irreversible dispatch attempt.
for (const value of [
  'const claimToken = crypto.randomUUID();',
  ".eq('status', 'pending')",
  ".eq('claim_token', claimToken)",
  ".is('dispatched_at', null)",
  '.update({ dispatched_at: dispatchTime })',
]) {
  has(runner, value, `claim/dispatch state machine must contain ${value}`);
}
ok(
  runner.indexOf('.update({ dispatched_at: dispatchTime })')
    < runner.indexOf('() => executor(sealedAction, supabase)'),
  'dispatch boundary must be persisted before executor entry',
);
ok(
  (runner.match(/\(\) => executor\(sealedAction, supabase\)/g) || []).length === 1,
  'runner must contain exactly one executor attempt',
);
lacks(runner, 'scheduleRetry(', 'runner must never auto-retry mutations');
lacks(runner, "status: 'pending',\n    scheduled_for:", 'runner must never requeue after dispatch');

// Timeout or any post-boundary error is sealed as outcome_unknown.
has(
  runner,
  "() => finish({ ok: false, error: 'dispatch_timeout', retryable: false })",
  'timeout must resolve to a sealed execution failure',
);
has(runner, 'await markOutcomeUnknown(', 'post-dispatch failures must be ambiguous');
has(runner, "status: 'outcome_unknown'", 'ambiguity must be persistent');
has(runner, "error: 'dispatch_outcome_unknown'", 'ambiguity error must be fixed and redacted');
has(runner, 'replay_allowed: false', 'ambiguous mutations must forbid replay');
has(
  runner,
  ".not('dispatched_at', 'is', null)",
  'terminal post-dispatch writes must require the dispatch boundary',
);

// Manual retry is pre-dispatch-only and burns old authority.
for (const value of [
  "current.status !== 'failed' || current.dispatched_at",
  ".eq('status', 'failed')",
  ".is('dispatched_at', null)",
  'approval_id: null',
  'claim_token: null',
  'requires_approval: true',
  'max_retries: 0',
]) {
  has(client, value, `manual retry guard must contain ${value}`);
}

// Ambiguous dispatched actions remain visible, explain the verification
// roadblock, and never expose a retry button or raw provider error.
has(
  client,
  "statuses: ['pending', 'running', 'failed', 'outcome_unknown']",
  'outbox query must include sealed outcome-unknown actions',
);
has(outbox, "a.status === 'outcome_unknown'", 'outbox must bucket outcome-unknown actions');
has(outbox, 'VERIFY — OUTCOME UNKNOWN', 'outbox must label ambiguity explicitly');
has(
  outbox,
  'Verify the destination before creating a new action; automatic replay is disabled.',
  'outbox must provide a safe exact recovery instruction',
);
has(
  outbox,
  "const canRetry = action.status === 'failed';",
  'outcome-unknown actions must not expose retry',
);
lacks(outbox, '{action.error}', 'outbox must not render raw or legacy provider errors');
has(outbox, "console.warn('[Outbox] cancel_failed')", 'outbox cancel logs only a stable code');
has(outbox, "console.warn('[Outbox] retry_failed')", 'outbox retry logs only a stable code');
lacks(outbox, "console.warn('[Outbox] cancel', err)", 'outbox must not log raw cancel errors');
lacks(outbox, "console.warn('[Outbox] retry', err)", 'outbox must not log raw retry errors');
has(client, "console.warn('[scheduledActions] list_failed')", 'scheduled list logs only a stable code');

// Recurrences are distinct rows with fresh approval and no inherited budget.
const clientRecurrence = client.slice(
  client.indexOf('export async function createNextRecurrence'),
  client.indexOf('// ─── Read'),
);
const edgeRecurrence = runner.slice(
  runner.indexOf('async function createNextOccurrence'),
  runner.indexOf('// ─── Request handler'),
);
for (const source of [clientRecurrence, edgeRecurrence]) {
  has(source, 'requires_approval: true', 'each recurrence must require fresh approval');
  has(source, 'approval_id: null', 'each recurrence must start without authority');
  has(source, 'max_retries: 0', 'each recurrence must have no retry budget');
  has(source, 'parent_action_id: action.id', 'each recurrence must bind its parent occurrence');
}

// Persistence is allowlist-only: no provider bodies, URLs, content, addresses,
// credentials, headers, paths, typed values, or raw errors leave the executor.
has(runner, 'sanitizeExecutionReceipt(result.data)', 'successful results must be sanitized');
const receiptSanitizer = runner.slice(
  runner.indexOf('function sanitizeExecutionReceipt'),
  runner.indexOf('function canonicalize'),
);
for (const forbidden of [
  'body_preview',
  'url',
  'permalink',
  'delivered_to',
  'subject',
  'text',
  'content',
  'headers',
  'address',
  'path',
  'error',
]) {
  lacks(receiptSanitizer, `'${forbidden}'`, `receipt sanitizer must not allow ${forbidden}`);
}
has(runner, "console.error('[scheduled-action-runner] due_action_lookup_failed')", 'DB logs must be coded');
has(runner, "error: 'runner_internal_error'", 'handler errors must be redacted');
lacks(runner, 'error: message', 'raw handler errors must never be returned');

// The generic approval worker must not pre-consume either runtime-owned lane.
const runtimeDeferral = worker.slice(
  worker.indexOf('if (isRuntimeOwnedAgentApprovalActionType(actionType))'),
  worker.indexOf('// ── Idempotency guard'),
);
has(
  worker,
  "normalized.startsWith('scheduled_action.')",
  'generic worker must defer scheduled actions',
);
has(
  worker,
  "normalized.startsWith('chat.') && normalized !== REVIEW_COMMENT_ACTION_TYPE",
  'generic worker must defer chat transport approvals',
);
has(
  runtimeDeferral,
  'if (isRuntimeOwnedAgentApprovalActionType(actionType))',
  'generic worker checks runtime ownership before dispatch',
);
lacks(runtimeDeferral, 'applied_at', 'runtime deferral must not stamp applied_at');
lacks(runtimeDeferral, '.update(', 'runtime deferral must not mutate the approval row');
ok(
  worker.indexOf('if (isRuntimeOwnedAgentApprovalActionType(actionType))') < worker.indexOf("if (actionType.startsWith('skill.'))"),
  'runtime deferral must happen before generic dispatch',
);

// The additive SQL is present byte-for-byte in the consolidated script.
has(migration, 'ADD COLUMN IF NOT EXISTS dispatched_at timestamptz', 'SQL needs a dispatch boundary');
has(migration, "'outcome_unknown'", 'SQL needs a terminal ambiguity state');
has(migration, 'ALTER COLUMN requires_approval SET DEFAULT true', 'SQL must fail closed by default');
has(migration, 'ALTER COLUMN max_retries SET DEFAULT 0', 'SQL must disable retries by default');
has(
  migration,
  "OLD.payload->>'userId' <> auth.uid()::text",
  'database must bind scheduled approval resolution to the authenticated owner',
);
has(
  migration,
  "OR NEW.action_type LIKE 'scheduled_action.%'",
  'database must block attempts to mutate a generic approval into a scheduled approval',
);
has(
  migration,
  "OLD.dispatched_at IS NOT NULL",
  'database must seal dispatched rows against direct client writes',
);
has(
  migration,
  "OLD.status = 'failed' AND NEW.status = 'pending'",
  'database must allow only its exact guarded manual retry transition',
);
has(
  migration,
  "NEW.approval_id IS NOT NULL",
  'database retry guard must require old authority to be cleared',
);
ok(
  consolidated.includes(migration),
  'RUN_THIS_SQL must contain the migration body byte-for-byte',
);

console.log(`scheduled-action-mutation-guard smoketest passed (${checks} checks)`);
