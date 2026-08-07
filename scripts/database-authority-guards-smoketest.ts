/**
 * Source-level regression smoke for the database authority boundary.
 *
 * Run:
 *   npx tsx scripts/database-authority-guards-smoketest.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migrationName = '20260726_database_authority_guards.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const chatApprovalRepairMigrationName =
  '20260806_chat_v2_approval_auto_approve_category.sql';
const chatApprovalRepairMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  chatApprovalRepairMigrationName,
);
const computerTaskRootMigrationName = '20260806_universal_computer_task_roots.sql';
const computerTaskRootMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  computerTaskRootMigrationName,
);
const continuationPrivacyMigrationName = '20260726_swanbot_continuation_privacy.sql';
const continuationPrivacyMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  continuationPrivacyMigrationName,
);
const consolidatedPath = path.join(root, 'docs', 'RUN_THIS_SQL.sql');
const invocationPath = path.join(root, 'src', 'lib', 'agentInvocation.ts');
const chatApprovalGatePath = path.join(root, 'src', 'lib', 'chatApprovalGate.ts');
const chatAutoApproveSettingsPath = path.join(
  root,
  'src',
  'lib',
  'chatAutoApproveSettings.ts',
);
const actionCallsMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260726_agent_action_calls.sql',
);

const migration = fs.readFileSync(migrationPath, 'utf8');
const chatApprovalRepairMigration = fs.readFileSync(
  chatApprovalRepairMigrationPath,
  'utf8',
);
const computerTaskRootMigration = fs.readFileSync(
  computerTaskRootMigrationPath,
  'utf8',
);
const continuationPrivacyMigration = fs.readFileSync(
  continuationPrivacyMigrationPath,
  'utf8',
);
const consolidated = fs.readFileSync(consolidatedPath, 'utf8');
const invocation = fs.readFileSync(invocationPath, 'utf8');
const chatApprovalGate = fs.readFileSync(chatApprovalGatePath, 'utf8');
const chatAutoApproveSettings = fs.readFileSync(chatAutoApproveSettingsPath, 'utf8');
const actionCallsMigration = fs.readFileSync(actionCallsMigrationPath, 'utf8');

const expectedChatAutoApproveCategories = [
  'memory_read',
  'memory_write',
  'skill_run',
  'skill_write',
  'automation_create',
  'automation_run',
  'browser_click',
  'external_publish',
  'desktop_action',
] as const;

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`database-authority-guards smoke failed: ${message}`);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function has(source: string, needle: string, message: string): void {
  check(source.includes(needle), message);
}

function lacks(source: string, needle: string, message: string): void {
  check(!source.includes(needle), message);
}

function assertBalancedSqlDelimiters(source: string, message: string): void {
  const stack: string[] = [];
  let inString = false;
  let inLineComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (!inString && char === '-' && next === '-') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === "'") {
      if (inString && next === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '(' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char === ')' || char === ']') {
      const expected = char === ')' ? '(' : '[';
      check(stack.pop() === expected, `${message}: unexpected ${char} at offset ${index}`);
    }
  }
  check(!inString, `${message}: unterminated SQL string`);
  check(stack.length === 0, `${message}: unclosed SQL delimiter`);
}

const invokeSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.invoke_agent(',
  '-- ─── Claimant-bound response state',
);
const streamSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.stream_response(',
  'DROP FUNCTION IF EXISTS public.mark_message_done(uuid);',
);
const completionSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.mark_message_done(',
  '-- ─── Schema-v2 payload validators',
);
const chatValidatorSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.is_valid_chat_v2_approval_payload(',
  'CREATE OR REPLACE FUNCTION public.is_valid_tool_v2_approval_payload(',
);
const repairedChatValidatorSql = section(
  chatApprovalRepairMigration,
  'CREATE OR REPLACE FUNCTION public.is_valid_chat_v2_approval_payload(',
  'REVOKE ALL ON FUNCTION public.is_valid_chat_v2_approval_payload(jsonb)',
);
const chatGuardSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.guard_chat_v2_approval()',
  '-- ─── OpenSwan/SwanBot schema-v2 approval state machine',
);
const toolGuardSql = section(
  migration,
  'CREATE OR REPLACE FUNCTION public.guard_tool_v2_run_approval()',
  'COMMENT ON COLUMN public.office_terminal_responses.agent_subject_key',
);
const invokeAndStreamSource = section(
  invocation,
  'export async function invokeAndStream(',
  '// ─── Multi-Agent: Invoke all agents in parallel',
);
const claimSource = section(
  invocation,
  'export async function invokeAgent(',
  '// ─── DB: Stream response updates',
);
const continuationTimestampSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.parse_swanbot_continuation_timestamp(',
  '-- Validate only the public, value-free checkpoint envelope.',
);
const continuationEnvelopeSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.is_valid_swanbot_continuation_envelope(',
  'CREATE OR REPLACE FUNCTION public.sweep_unsafe_swanbot_continuations()',
);
const continuationSweeperSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.sweep_unsafe_swanbot_continuations()',
  'REVOKE ALL ON FUNCTION public.parse_swanbot_continuation_timestamp(text)',
);
const continuationSweepSummarySql = section(
  continuationSweeperSql,
  'tool_calls = CASE',
  'completed_at = v_swept_at',
);
const continuationSweepOutcomeMetadataSql = section(
  continuationSweeperSql,
  'metadata = (',
  'FROM candidates AS candidate',
);
const continuationOneTimeScrubSql = section(
  continuationPrivacyMigration,
  '-- One-time privacy scrub for every checkpoint on a terminal/non-active row.',
  '-- pg_cron is optional in local/self-hosted environments.',
);
const continuationRunPredicateSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.is_protected_swanbot_v2_continuation_run(',
  'CREATE OR REPLACE FUNCTION public.guard_swanbot_v2_continuation_run()',
);
const continuationRunGuardSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.guard_swanbot_v2_continuation_run()',
  '-- pg_cron is optional in local/self-hosted environments.',
);
const continuationRunGuardFunctionSql = section(
  continuationPrivacyMigration,
  'CREATE OR REPLACE FUNCTION public.guard_swanbot_v2_continuation_run()',
  'DROP TRIGGER IF EXISTS trg_guard_swanbot_v2_continuation_run',
);
const continuationCronSql = section(
  continuationPrivacyMigration,
  'DO $cron$',
  'COMMENT ON FUNCTION public.sweep_unsafe_swanbot_continuations()',
);
const computerTaskRootValidatorSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_snapshot_v1(',
  'REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_snapshot_v1(jsonb)',
);
const computerTaskRootNestedValidatorSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_nested_v1(',
  'REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_nested_v1(jsonb)',
);
const computerTaskRootAdmissionSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.admit_computer_task_root_v1(',
  'CREATE OR REPLACE FUNCTION public.read_computer_task_root_v1(',
);
const computerTaskRootReadSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.read_computer_task_root_v1(',
  'DROP FUNCTION IF EXISTS public.transition_computer_task_root_v1(',
);
const computerTaskRootTransitionSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.transition_computer_task_root_v1(',
  'REVOKE ALL ON FUNCTION public.admit_computer_task_root_v1(',
);
const computerTaskRootActionClaimSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.claim_computer_task_root_action_v1(',
  'CREATE OR REPLACE FUNCTION public.start_computer_task_root_action_v1(',
);
const computerTaskRootActionStartSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.start_computer_task_root_action_v1(',
  'CREATE OR REPLACE FUNCTION public.settle_computer_task_root_action_v1(',
);
const computerTaskRootActionSettleSql = section(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.settle_computer_task_root_action_v1(',
  'REVOKE ALL ON FUNCTION public.admit_computer_task_root_v1(',
);
assertBalancedSqlDelimiters(
  continuationRunGuardFunctionSql,
  'continuation trigger SQL delimiters are balanced',
);
assertBalancedSqlDelimiters(
  computerTaskRootMigration,
  'computer task root migration SQL delimiters are balanced',
);

// Consolidated SQL is an executable copy, not a hand-maintained approximation.
has(consolidated, '--   §21 Messages content length cap', 'contents restores section 21');
has(consolidated, '--   §22 Training-safe agent tool-trace views', 'contents restores section 22');
has(consolidated, '--   §23 agent_run_events RLS policy', 'contents restores section 23');
has(consolidated, '--   §24 codebase_files + match_codebase_files', 'contents restores section 24');
has(consolidated, '--   §25 agent_runs.agent_id durable linkage', 'contents restores section 25');
has(consolidated, '--   §26 Durable agent action calls', 'contents restores section 26');
has(consolidated, '--   §27 Scheduled-action mutation guard', 'contents keeps section 27');
has(consolidated, '--   §28 Database authority guards', 'contents adds section 28');
has(consolidated, '--   §29 SwanBot continuation privacy sweeper', 'contents adds section 29');
has(consolidated, '--   §33 Chat v2 approval auto-approve category repair', 'contents adds section 33');
has(consolidated, '--   §34 Universal computer-task roots', 'contents adds section 34');
const consolidatedMarker = `-- Source: ${migrationName}\n\n`;
const consolidatedMarkerIndex = consolidated.indexOf(consolidatedMarker);
check(consolidatedMarkerIndex >= 0, 'consolidated SQL has the authority migration source marker');
const continuationSectionHeader =
  '-- ═════════════════════════════════════════════════════════════════════════════\n'
  + '-- §29. SwanBot continuation privacy sweeper (2026-07-26)';
const continuationSectionIndex = consolidated.indexOf(
  continuationSectionHeader,
  consolidatedMarkerIndex + consolidatedMarker.length,
);
check(continuationSectionIndex > consolidatedMarkerIndex, 'section 29 follows the complete section 28 source');
check(
  consolidated.slice(
    consolidatedMarkerIndex + consolidatedMarker.length,
    continuationSectionIndex,
  ) === migration,
  'section 28 is byte-identical to the complete source migration',
);
const continuationConsolidatedMarker =
  `-- Source: ${continuationPrivacyMigrationName}\n\n`;
const continuationConsolidatedMarkerIndex = consolidated.indexOf(
  continuationConsolidatedMarker,
  continuationSectionIndex,
);
check(
  continuationConsolidatedMarkerIndex >= 0,
  'consolidated SQL has the continuation privacy migration source marker',
);
// Slice to the START OF THE NEXT SECTION, not to end-of-file. Comparing to EOF
// asserts "§29 is the last thing in the file", which is not the property this
// test cares about and breaks the moment any later section is appended —
// exactly what happened when §30 landed.
const continuationBodyStart =
  continuationConsolidatedMarkerIndex + continuationConsolidatedMarker.length;
const nextSectionBannerIndex = consolidated.indexOf(
  '\n-- ═',
  continuationBodyStart,
);
// `nextSectionBannerIndex` points at the '\n' that starts the blank-line
// separator before the next banner; the migration's own trailing newline is the
// character before it, so slice UP TO that index (not past it).
const continuationBody = nextSectionBannerIndex >= 0
  ? consolidated.slice(continuationBodyStart, nextSectionBannerIndex)
  : consolidated.slice(continuationBodyStart);
check(
  continuationBody === continuationPrivacyMigration,
  'section 29 is byte-identical to the complete continuation privacy migration',
);
check(
  consolidated.split(actionCallsMigration).length === 2,
  'section 26 remains one byte-identical copy of its source migration',
);
check(
  consolidated.split(chatApprovalRepairMigration).length === 2,
  'section 33 is one byte-identical copy of the Chat approval repair migration',
);
has(
  consolidated,
  `-- Source: ${computerTaskRootMigrationName}`,
  'consolidated SQL has the universal computer-task root migration source marker',
);
check(
  consolidated.split(computerTaskRootMigration).length === 2,
  'section 34 is one byte-identical copy of the universal computer-task root migration',
);
check(
  repairedChatValidatorSql === chatValidatorSql,
  'fresh-install and forward-repair Chat validators are byte-identical',
);

// Office claims bind a durable message, circle, command, target, and claimant.
has(migration, 'ADD COLUMN IF NOT EXISTS agent_subject_key text', 'responses gain synthetic-safe subject identity');
has(migration, 'ADD COLUMN IF NOT EXISTS claimant_user_id uuid', 'responses record the winning claimant');
has(migration, 'ALTER COLUMN agent_id DROP NOT NULL', 'BlackSwan does not forge a UUID foreign key');
has(migration, 'UNIQUE INDEX IF NOT EXISTS idx_terminal_response_message_subject', 'message and subject are idempotent');
has(invokeSql, 'v_uid uuid := auth.uid()', 'claim reads authenticated identity');
has(invokeSql, 'SET search_path = pg_catalog, public', 'claim has a fixed search path');
has(invokeSql, 'FOR UPDATE', 'claim locks the canonical message');
has(invokeSql, 'message_row.id = p_message_id', 'claim binds exact message');
has(invokeSql, 'message_row.circle_id = p_circle_id', 'claim binds exact circle');
has(invokeSql, 'v_message.command_text IS DISTINCT FROM p_expected_command_text', 'claim rejects command substitution');
has(invokeSql, "v_message.status NOT IN ('pending', 'invoked')", 'claim rejects terminal messages');
has(invokeSql, 'FROM public.circle_members AS membership', 'claim verifies current membership');
has(invokeSql, 'agent_row.owner_id = v_uid', 'durable target must belong to claimant');
has(invokeSql, 'v_message.sender_id IS DISTINCT FROM v_uid', 'synthetic BlackSwan is sender-claimed');
has(invokeSql, 'office_invocation_agent_out_of_scope', 'claim rejects untargeted agents');
has(invokeSql, 'v_agent.is_published = true', '@all claim requires a published agent');
has(invokeSql, "v_agent.status <> 'offline'", '@all claim excludes offline agents');
has(invokeSql, "v_subject_key := 'blackswan'", 'BlackSwan uses a synthetic subject');
has(invokeSql, 'v_message.target_agent_id IS NULL', 'BlackSwan rejects a conflicting direct UUID target');
has(invokeSql, 'ON CONFLICT (message_id, agent_subject_key) DO NOTHING', 'claim is atomic and idempotent');
has(invokeSql, "v_disposition := 'duplicate'", 'duplicate claims are explicit');
has(invokeSql, 'canonical_command_text', 'claim returns canonical command');
has(invokeSql, 'canonical_target_agent_ids', 'claim returns canonical target scope');
has(invokeSql, 'canonical_sender_id', 'claim returns canonical sender');
has(invokeSql, 'REVOKE ALL ON FUNCTION public.invoke_agent', 'claim removes public and anonymous access');
has(invokeSql, 'TO authenticated', 'claim grants only authenticated callers');

// Response writes are claimant-bound, bounded, and compare-and-set.
has(streamSql, 'RETURNS boolean', 'stream reports an authoritative result');
has(streamSql, 'SET search_path = pg_catalog, public', 'stream has a fixed search path');
has(streamSql, 'p_status IS NULL', 'stream rejects a null status explicitly');
has(streamSql, "p_status NOT IN ('streaming', 'done', 'error')", 'stream status is allowlisted');
has(streamSql, 'length(p_text) > 1000000', 'stream response text is bounded');
has(streamSql, 'p_tokens > 1000000000', 'stream token totals are bounded');
has(streamSql, 'p_latency_ms > 86400000', 'stream latency is bounded');
has(streamSql, 'v_response.claimant_user_id IS DISTINCT FROM v_uid', 'stream requires claimant ownership');
has(streamSql, "v_response.status NOT IN ('pending', 'streaming')", 'stream rejects terminal replay');
has(streamSql, 'membership.circle_id = v_response.circle_id', 'stream rechecks current membership');
has(streamSql, 'response_row.status = v_response.status', 'stream uses status CAS');
has(streamSql, 'office_response_state_conflict', 'stream names CAS conflicts stably');
has(streamSql, 'REVOKE ALL ON FUNCTION public.stream_response', 'stream removes public and anonymous access');

has(completionSql, "message_row.status = 'invoked'", 'completion starts from invoked only');
has(completionSql, 'response_row.claimant_user_id = v_uid', 'completion requires a terminal owned response');
has(completionSql, "response_row.status IN ('pending', 'streaming')", 'completion waits for live claims');
has(completionSql, 'unnest(', 'completion verifies every explicit target');
has(completionSql, "'office-agent:' || expected_target.agent_id::text", 'completion checks exact UUID subjects');
has(completionSql, "response_row.agent_subject_key = 'blackswan'", 'completion checks synthetic BlackSwan');
has(completionSql, "expected_agent.status <> 'offline'", '@all completion checks the dispatched live roster');
has(completionSql, "AND message_row.status = 'invoked'", 'completion update uses status CAS');
has(completionSql, 'RETURN FOUND', 'completion exposes CAS outcome');
has(
  migration,
  'REVOKE INSERT, UPDATE ON TABLE public.office_terminal_responses',
  'direct response writes cannot bypass claims',
);
has(
  migration,
  'REVOKE UPDATE ON TABLE public.office_terminal_messages',
  'direct message status writes cannot bypass completion CAS',
);

// Client execution consumes only the canonical winning claim.
has(claimSource, 'p_expected_command_text: req.command', 'client supplies expected durable command');
has(claimSource, "row?.claim_disposition !== 'claimed'", 'client suppresses duplicate execution');
has(claimSource, 'command !== req.command', 'client verifies canonical command');
has(claimSource, 'canonicalScopeMatches', 'client verifies canonical target scope');
has(claimSource, "blackSwan ? 'blackswan' : `office-agent:${durableAgentId}`", 'client verifies canonical subject');
has(claimSource, 'rawTargetAgentIds !== null && targetAgentIds?.length !== rawTargetAgentIds.length', 'client rejects malformed target arrays');
const claimIndex = invokeAndStreamSource.indexOf('const claim = await invokeAgent(req, agent);');
const taskIndex = invokeAndStreamSource.indexOf('const taskId = await createAgentTask(');
const providerIndex = invokeAndStreamSource.indexOf('result = await invokeBlackSwan(');
check(claimIndex >= 0 && claimIndex < taskIndex, 'durable claim precedes task side effects');
check(claimIndex < providerIndex, 'durable claim precedes provider execution');
has(invokeAndStreamSource, 'const canonicalReq: InvocationRequest = {', 'execution rebuilds a canonical request');
has(invokeAndStreamSource, 'command: claim.command', 'execution uses the durable command');
has(invokeAndStreamSource, 'senderId: claim.senderId', 'execution uses the durable sender');
has(invokeAndStreamSource, 'model: claim.model', 'execution uses the durable model');
has(invokeAndStreamSource, 'agentSubjectMetadata: undefined', 'unpersisted subject metadata is discarded');
has(invokeAndStreamSource, 'targetAgentSubjects: null', 'unpersisted target subjects are discarded');
has(invokeAndStreamSource, 'promptName: undefined', 'unpersisted prompt selectors are discarded');
lacks(
  invokeAndStreamSource.slice(claimIndex),
  'req.command',
  'post-claim execution never returns to the advisory command',
);
lacks(invocation, '← "${req.command}"', 'logs never include raw Office commands');
lacks(invocation, 'Agent error: ${result.error}', 'logs never include raw provider errors');
lacks(invocation, 'Exception: ${err.message}', 'logs never include raw exception messages');
has(invocation, "console.error('[agentInvocation] provider_error')", 'provider failure uses a stable log code');
has(invocation, 'OFFICE_PROVIDER_FAILURE', 'provider failures use stable persisted copy');
has(invocation, 'OFFICE_RUNTIME_FAILURE', 'runtime failures use stable persisted copy');
has(invocation, 'pendingAgentTasks.set(responseId, taskId)', 'parallel tracking keys by response');
has(invokeAndStreamSource, 'if (!updated)', 'completion fails closed when response persistence fails');

// Chat v2 approval rows are exact-intent immutable state machines.
has(migration, 'is_valid_chat_v2_approval_payload', 'chat payload has a database validator');
has(migration, "SELECT COALESCE((", 'validators reject SQL NULL as invalid');
has(migration, "'approvalIntentFingerprint'", 'chat intent fingerprint is required');
has(migration, "'redacted'", 'chat payload carries bounded redaction metadata');
has(
  chatApprovalGate,
  'autoApproveCategory: category ?? null',
  'the app always includes a bounded category or JSON null in Chat v2 approval payloads',
);
const chatAutoApproveType = section(
  chatAutoApproveSettings,
  'export type AutoApproveCategory =',
  'export type AutoApproveSettings',
);
const appAutoApproveCategories = Array.from(
  chatAutoApproveType.matchAll(/\|\s*'([a-z_]+)'/g),
  (match) => match[1],
);
check(
  JSON.stringify(appAutoApproveCategories) === JSON.stringify(expectedChatAutoApproveCategories),
  'the pinned nine-category smoke taxonomy matches the app AutoApproveCategory union',
);
const chatAutoApproveCategoryClause = section(
  chatValidatorSql,
  "AND (\n      NOT (p_payload ? 'autoApproveCategory')",
  '\n    AND NOT EXISTS',
);
has(
  chatAutoApproveCategoryClause,
  "NOT (p_payload ? 'autoApproveCategory')",
  'legacy Chat v2 payloads may omit the additive category key',
);
has(
  chatAutoApproveCategoryClause,
  "p_payload->'autoApproveCategory' = 'null'::jsonb",
  'the validator accepts the app JSON-null category shape',
);
has(
  chatAutoApproveCategoryClause,
  "jsonb_typeof(p_payload->'autoApproveCategory') = 'string'",
  'non-null categories must be JSON strings',
);
const sqlCategoryMatch = chatAutoApproveCategoryClause.match(
  /p_payload->>'autoApproveCategory' IN \(([\s\S]*?)\n        \)/,
);
check(sqlCategoryMatch !== null, 'the category validator uses an exact SQL IN allowlist');
const sqlAutoApproveCategories = Array.from(
  sqlCategoryMatch[1].matchAll(/'([a-z_]+)'/g),
  (match) => match[1],
);
check(
  JSON.stringify(sqlAutoApproveCategories) === JSON.stringify(expectedChatAutoApproveCategories),
  'the SQL validator accepts exactly the nine app categories and rejects unknown strings',
);
lacks(
  chatAutoApproveCategoryClause,
  '~',
  'the Chat category branch has no permissive string-pattern fallback',
);
has(
  chatValidatorSql,
  "'threadId',\n        'autoApproveCategory',\n        'redacted'",
  'the strict Chat payload-key allowlist includes only the additive category key',
);
has(
  chatValidatorSql,
  'WHERE payload_key <> ALL (ARRAY[',
  'unknown Chat payload keys remain rejected',
);
has(
  chatApprovalRepairMigration,
  'FROM PUBLIC, anon, authenticated;',
  'the forward repair does not expose the validator to app roles',
);
has(
  chatApprovalRepairMigration,
  "NOTIFY pgrst, 'reload schema';",
  'the forward repair refreshes the PostgREST schema cache',
);
has(chatGuardSql, "OLD.action_type LIKE 'chat.%'", 'chat guard scopes existing protected rows');
has(chatGuardSql, "NEW.action_type LIKE 'chat.%'", 'chat guard scopes new protected rows');
has(chatGuardSql, 'chat_v2_approval_schema_conversion_forbidden', 'chat guard denies legacy conversion');
has(chatGuardSql, 'chat_v2_approval_payload_invalid', 'chat guard denies malformed payloads');
has(chatGuardSql, "NEW.payload->>'userId' <> v_uid::text", 'chat creation is requester-owned');
has(chatGuardSql, 'membership.user_id = v_uid', 'chat transitions require current membership');
has(chatGuardSql, 'chat_v2_approval_binding_immutable', 'chat binding fields are immutable');
has(chatGuardSql, "OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')", 'chat resolution is narrow');
has(chatGuardSql, 'NEW.resolved_by := v_uid', 'chat resolver is server-stamped');
has(chatGuardSql, "NEW.status = 'expired'", 'chat supports requester-owned expiry');
has(chatGuardSql, "OLD.payload->>'userId' <> v_uid::text", 'chat expiry and consume require requester');
has(chatGuardSql, 'OLD.applied_at IS NULL', 'chat consume is one shot');
has(chatGuardSql, 'NEW.applied_at := clock_timestamp()', 'chat consume timestamp is server-stamped');
has(chatGuardSql, 'chat_v2_approval_delete_forbidden', 'chat protected rows cannot be deleted');
has(migration, 'trg_guard_chat_v2_approval_insert', 'chat inserts are guarded');
has(migration, 'trg_guard_chat_v2_approval_update', 'chat updates are guarded');
has(migration, 'trg_guard_chat_v2_approval_delete', 'chat deletes are guarded');

// OpenSwan/SwanBot v2 tool approvals have the same authority semantics.
has(migration, 'is_valid_tool_v2_approval_payload', 'tool payload has a database validator');
has(migration, "'^approval-v2:sha256:[0-9a-f]{64}$'", 'tool approval digest is exact SHA-256');
has(migration, "'^authority-v2:sha256:[0-9a-f]{64}$'", 'dispatch binding is exact SHA-256');
has(migration, "NOT (p_payload ? 'dispatchBindingDigest')", 'fresh approval cannot forge consumption');
has(toolGuardSql, 'tool_v2_approval_schema_conversion_forbidden', 'tool guard denies legacy conversion');
has(toolGuardSql, 'NEW.requested_by IS DISTINCT FROM v_uid::text', 'tool creation is requester-owned');
has(toolGuardSql, 'membership.user_id = v_uid', 'tool transitions require current membership');
has(toolGuardSql, 'run_row.circle_id = NEW.circle_id', 'tool approval is bound to its run circle');
has(toolGuardSql, 'run_row.user_id = v_uid', 'tool creation is bound to requester run ownership');
has(toolGuardSql, "NEW.payload->>'approvalMode' <> 'ask'", 'pending tool approvals require ask mode');
has(toolGuardSql, 'tool_v2_approval_binding_immutable', 'tool binding fields are immutable');
has(toolGuardSql, "OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected')", 'tool resolution is narrow');
has(toolGuardSql, 'NEW.resolved_by := v_uid', 'tool resolver is server-stamped');
has(toolGuardSql, "OLD.requested_by <> v_uid::text", 'tool expiry and consume require requester');
has(toolGuardSql, "NOT (OLD.payload ? 'dispatchBindingDigest')", 'tool consume is one shot');
has(toolGuardSql, 'is_valid_tool_v2_approval_payload(OLD.payload, false)', 'tool source payload is validated');
has(toolGuardSql, 'is_valid_tool_v2_approval_payload(NEW.payload, true)', 'tool consumed payload is validated');
has(toolGuardSql, "NEW.payload - ARRAY[", 'consume permits only dispatch receipt fields');
has(toolGuardSql, "interval '5 minutes'", 'consume timestamp rejects stale client claims');
has(toolGuardSql, "interval '30 seconds'", 'consume timestamp rejects future client claims');
has(toolGuardSql, 'tool_v2_approval_delete_forbidden', 'tool protected rows cannot be deleted');
has(migration, 'trg_guard_tool_v2_run_approval_insert', 'tool inserts are guarded');
has(migration, 'trg_guard_tool_v2_run_approval_update', 'tool updates are guarded');
has(migration, 'trg_guard_tool_v2_run_approval_delete', 'tool deletes are guarded');
lacks(toolGuardSql, "auth.role() = 'service_role'", 'protected v2 approvals have no service-role bypass');

// Stable, least-privilege function contracts.
check(
  (migration.match(/SET search_path = pg_catalog, public/g) || []).length >= 7,
  'every new authority function has a fixed search path',
);
has(migration, 'FROM PUBLIC, anon, authenticated', 'internal validators and guards are non-callable');
has(migration, "NOTIFY pgrst, 'reload schema';", 'PostgREST schema is refreshed after apply');
lacks(migration, 'GRANT EXECUTE ON FUNCTION public.guard_', 'trigger guards are never directly granted');

// SwanBot continuation checkpoints are sealed, bounded, expiring, and
// database-swept without ever turning public envelope metadata into replay.
has(
  continuationTimestampSql,
  'RETURNS timestamptz',
  'continuation timestamp parser returns an authoritative timestamp or null',
);
has(
  continuationTimestampSql,
  "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'",
  'continuation timestamp parser requires canonical Date.toISOString form',
);
has(
  continuationTimestampSql,
  'EXCEPTION WHEN OTHERS THEN',
  'malformed continuation timestamps fail closed without aborting the sweep',
);
has(
  continuationEnvelopeSql,
  "p_envelope->'encrypted' IS DISTINCT FROM 'true'::jsonb",
  'public checkpoint must explicitly declare a sealed snapshot',
);
has(
  continuationEnvelopeSql,
  "p_envelope->>'storageSchemaVersion' <> '1'",
  'public checkpoint storage schema is exact',
);
has(
  continuationEnvelopeSql,
  "p_envelope->>'continuationVersion' <> '2'",
  'continuation resume protocol version is exact',
);
has(
  continuationEnvelopeSql,
  "envelope_key.key = ANY(ARRAY[",
  'unknown public-envelope fields are rejected to prevent plaintext hitchhiking',
);
has(
  continuationEnvelopeSql,
  "v_resume_state NOT IN ('pending', 'dispatch_claimed', 'results_claimed')",
  'only the three active continuation states are accepted',
);
has(
  continuationEnvelopeSql,
  "p_envelope ?| ARRAY[",
  'claim fields are forbidden before their exact state',
);
has(
  continuationEnvelopeSql,
  "p_envelope ?& ARRAY['dispatchClaimId', 'dispatchClaimedAt']",
  'claimed states require exact dispatch authority fields',
);
has(
  continuationEnvelopeSql,
  "jsonb_array_length(p_envelope->'pendingTools') <> v_pending_count",
  'public pending-tool count must match its bounded projection',
);
has(
  continuationEnvelopeSql,
  "count(DISTINCT pending_tool.value->>'id')",
  'duplicate pending tool identities invalidate the envelope',
);
has(
  continuationEnvelopeSql,
  "v_expires_at IS DISTINCT FROM v_paused_at + interval '10 minutes'",
  'canonical expiry cannot be extended beyond the runtime ten-minute lease',
);
has(
  continuationEnvelopeSql,
  "v_snapshot->>'algorithm' <> 'AES-256-GCM'",
  'sealed snapshot algorithm is exact',
);
has(
  continuationEnvelopeSql,
  "v_snapshot->>'kdf' <> 'SHA-256'",
  'sealed snapshot KDF is exact',
);
has(
  continuationEnvelopeSql,
  "translate(encode(v_iv, 'base64'), E'\\n\\r\\t ', '')",
  'snapshot IV must be canonical base64 with exact decoded length',
);
has(
  continuationEnvelopeSql,
  "translate(encode(v_ciphertext, 'base64'), E'\\n\\r\\t ', '')",
  'snapshot ciphertext must be canonical bounded base64',
);

has(continuationSweeperSql, 'SECURITY DEFINER', 'continuation sweeper owns its database transition');
has(
  continuationSweeperSql,
  'SET search_path = pg_catalog, public',
  'continuation sweeper has a fixed search path',
);
has(
  continuationSweeperSql,
  "run_row.status = 'running'",
  'continuation sweeper only terminalizes active runs',
);
has(
  continuationSweeperSql,
  "'client_pending',\n        'client_dispatching',\n        'client_resuming'",
  'all three active continuation stop reasons are swept',
);
has(
  continuationSweeperSql,
  "THEN 'continuation_checkpoint_legacy_or_unsealed'",
  'legacy or plaintext checkpoints get a stable reason code',
);
has(
  continuationSweeperSql,
  "THEN 'continuation_checkpoint_malformed'",
  'malformed sealed envelopes get a stable reason code',
);
has(
  continuationSweeperSql,
  "THEN 'continuation_checkpoint_expired'",
  'past canonical expiry gets a stable reason code',
);
has(
  continuationSweeperSql,
  "ELSE 'continuation_checkpoint_state_mismatch'",
  'run/envelope state mismatch fails closed',
);
has(
  continuationSweeperSql,
  "SET status = 'failed',\n        final_stop_reason = 'error'",
  'unsafe active continuations become failed/error terminal rows',
);
has(
  continuationSweeperSql,
  "- ARRAY['continuation', 'continuationResumeOutcome']::text[]",
  'checkpoint removal and stable outcome replacement share one update',
);
has(
  continuationSweeperSql,
  "THEN 'failed_before_dispatch'\n              ELSE 'outcome_unknown'",
  'pre-dispatch expiry stays distinct from possibly dispatched ambiguity',
);
has(
  continuationSweeperSql,
  "'replayAllowed', false",
  'database-swept continuations explicitly forbid replay',
);
has(
  continuationSweepSummarySql,
  "WHEN jsonb_typeof(run_row.tool_calls) = 'array'\n            THEN run_row.tool_calls\n          ELSE '[]'::jsonb",
  'sweep preserves only array-shaped tool summaries and repairs every other shape to an empty array',
);
has(
  continuationSweepSummarySql,
  'iteration_count = GREATEST(\n          COALESCE(run_row.iteration_count, 1),\n          1\n        )',
  'sweep repairs missing or non-positive iteration counts to at least one',
);
for (const tokenColumn of ['input_tokens', 'output_tokens', 'cached_tokens']) {
  has(
    continuationSweepSummarySql,
    `${tokenColumn} = GREATEST(\n          COALESCE(run_row.${tokenColumn}, 0::bigint),\n          0::bigint\n        )`,
    `sweep repairs ${tokenColumn} with nonnegative bigint-safe operations`,
  );
}
check(
  (continuationSweeperSql.match(/SET status = 'failed'/g) || []).length === 1,
  'the sole sweeper terminalization carries the normalized summary assignment',
);
lacks(
  continuationSweepSummarySql,
  'abs(',
  'summary repair avoids minimum-integer overflow through abs',
);
lacks(
  continuationSweepSummarySql,
  '::numeric',
  'summary repair stays in integer column types without lossy numeric round trips',
);
for (const privateSummaryValue of [
  'run_row.tool_calls',
  'run_row.iteration_count',
  'run_row.input_tokens',
  'run_row.output_tokens',
  'run_row.cached_tokens',
]) {
  lacks(
    continuationSweepOutcomeMetadataSql,
    privateSummaryValue,
    `sweep outcome metadata does not copy ${privateSummaryValue} values`,
  );
}
has(
  continuationSweeperSql,
  "run_row.final_stop_reason = candidate.final_stop_reason",
  'sweep uses stop-reason compare-and-set',
);
has(
  continuationSweeperSql,
  "IS NOT DISTINCT FROM candidate.continuation",
  'sweep uses exact continuation compare-and-set',
);
lacks(
  continuationSweeperSql,
  "'continuationIdentity'",
  'stable sweep outcome stores no continuation identity',
);
lacks(
  continuationSweeperSql,
  "'dispatchClaimId'",
  'stable sweep outcome stores no dispatch claim',
);
lacks(
  continuationSweeperSql,
  "'snapshot'",
  'stable sweep outcome stores no sealed or plaintext snapshot',
);
lacks(
  continuationSweeperSql,
  "'pendingTools'",
  'stable sweep outcome stores no tool identities',
);

has(
  continuationPrivacyMigration,
  'SELECT public.sweep_unsafe_swanbot_continuations();',
  'migration immediately closes unsafe active continuations',
);
has(
  continuationOneTimeScrubSql,
  "run_row.metadata ? 'continuation'",
  'one-time migration pass finds historical checkpoints',
);
has(
  continuationOneTimeScrubSql,
  "'status', 'checkpoint_scrubbed'",
  'terminal checkpoint scrub records only a stable marker',
);
has(
  continuationOneTimeScrubSql,
  "THEN 'continuation_checkpoint_terminal_scrub'",
  'one-time scrub removes valid ciphertext after a run becomes terminal',
);
has(
  continuationOneTimeScrubSql,
  "AND NOT (\n    run_row.status = 'running'",
  'one-time scrub removes every checkpoint outside an active continuation state',
);
lacks(
  continuationOneTimeScrubSql,
  "AND NOT public.is_valid_swanbot_continuation_envelope(",
  'terminal ciphertext retention is not conditioned on envelope validity',
);
has(
  continuationRunPredicateSql,
  "p_metadata ? 'continuation'",
  'any row carrying a continuation is protected even if its version label is stripped',
);
has(
  continuationRunPredicateSql,
  "p_metadata->>'version' = 'swanbot-v2-ai'",
  'active SwanBot v2 execution states are protected before a checkpoint is present',
);
has(
  continuationRunPredicateSql,
  "'client_pending',\n        'client_dispatching',\n        'client_resuming'",
  'all three active continuation execution states are protected',
);
has(
  continuationRunGuardSql,
  "COALESCE(auth.role(), '') = 'service_role'",
  'the service-role edge writer retains continuation state-machine authority',
);
has(
  continuationRunGuardSql,
  "current_user IN ('postgres', 'supabase_admin')",
  'migration and security-definer sweeper database owners retain maintenance authority',
);
const trustedContinuationWriterIndex = continuationRunGuardFunctionSql.indexOf(
  'IF v_trusted_writer THEN',
);
const continuationPredicateIndex = continuationRunGuardFunctionSql.indexOf(
  "OLD.metadata ? 'continuation'",
);
const trustedContinuationReturnIndex = continuationRunGuardFunctionSql.indexOf(
  'IF TG_OP = \'DELETE\' THEN\n      RETURN OLD;\n    END IF;\n    RETURN NEW;',
  trustedContinuationWriterIndex,
);
check(
  trustedContinuationWriterIndex >= 0
    && continuationPredicateIndex > trustedContinuationWriterIndex
    && trustedContinuationReturnIndex > trustedContinuationWriterIndex
    && trustedContinuationReturnIndex < continuationPredicateIndex,
  'service-role and database-owner maintenance bypass returns before client protection checks',
);
has(
  continuationRunGuardFunctionSql,
  "OLD.metadata ? 'continuation'",
  'old-row protected state is evaluated inside the trigger without an external permission boundary',
);
has(
  continuationRunGuardFunctionSql,
  "NEW.metadata ? 'continuation'",
  'new-row protected state is evaluated inside the trigger without an external permission boundary',
);
lacks(
  continuationRunGuardFunctionSql,
  'public.is_protected_swanbot_v2_continuation_run(',
  'security-invoker trigger never calls the private non-executable predicate helper',
);
has(
  continuationRunGuardSql,
  'REVOKE ALL ON FUNCTION public.is_protected_swanbot_v2_continuation_run(',
  'the standalone predicate helper remains private after its logic is safely inlined',
);
has(
  continuationRunGuardFunctionSql,
  "IF TG_OP = 'INSERT' AND v_new_protected THEN",
  'ordinary authenticated inserts pass unless the inserted row is protected',
);
has(
  continuationRunGuardFunctionSql,
  "IF TG_OP = 'DELETE' AND v_old_protected THEN",
  'ordinary authenticated deletes pass unless the deleted row is protected',
);
has(
  continuationRunGuardFunctionSql,
  "AND (v_old_protected OR v_new_protected)\n    AND NEW IS DISTINCT FROM OLD",
  'ordinary authenticated updates pass unless either row image is protected',
);
has(
  continuationRunGuardFunctionSql,
  "IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;\n  RETURN NEW;",
  'unprotected rows retain the normal INSERT UPDATE DELETE trigger return path',
);
has(
  continuationRunGuardFunctionSql,
  "AND OLD.status = 'running'\n    AND NEW.status = 'cancelled'",
  'protected continuation STOP is one-way from running to cancelled',
);
has(
  continuationRunGuardFunctionSql,
  'AND auth.uid() = OLD.user_id',
  'only the exact owning user may STOP or annotate a protected continuation run',
);
has(
  continuationRunGuardFunctionSql,
  "- ARRAY['status', 'completed_at', 'updated_at']::text[]",
  'STOP changes only status and the two existing terminal timestamps',
);
const stopAllowIndex = continuationRunGuardFunctionSql.indexOf(
  "AND OLD.status = 'running'\n    AND NEW.status = 'cancelled'",
);
const provenanceAllowIndex = continuationRunGuardFunctionSql.indexOf(
  "AND OLD.status = 'cancelled'\n    AND NEW.status = 'cancelled'",
);
const protectedRewriteRejectIndex = continuationRunGuardFunctionSql.indexOf(
  "RAISE EXCEPTION 'swanbot_v2_continuation_rewrite_forbidden'",
);
check(
  stopAllowIndex >= 0
    && provenanceAllowIndex > stopAllowIndex
    && protectedRewriteRejectIndex > provenanceAllowIndex,
  'only the two narrow owner-cancel paths return before the generic protected rewrite rejection',
);
has(
  continuationRunGuardFunctionSql,
  "- ARRAY['metadata', 'updated_at']::text[]",
  'cancel provenance merge cannot modify another row column',
);
has(
  continuationRunGuardFunctionSql,
  "- ARRAY['cancelled_by', 'cancelled_at', 'cancelled_from']::text[]",
  'cancel provenance merge leaves continuation and all non-provenance metadata exact',
);
lacks(
  continuationRunGuardFunctionSql,
  'NEW.metadata :=',
  'trigger never rewrites or strips the sealed continuation while handling owner STOP',
);
has(
  continuationRunGuardFunctionSql,
  "AND NEW.metadata->>'cancelled_by' = 'user'",
  'cancel provenance actor is the bounded user enum',
);
has(
  continuationRunGuardFunctionSql,
  "length(NEW.metadata->>'cancelled_at') = 24",
  'cancel provenance timestamp has the exact millisecond UTC ISO length',
);
has(
  continuationRunGuardFunctionSql,
  "'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'",
  'cancel provenance timestamp must round-trip as canonical UTC ISO',
);
has(
  continuationRunGuardFunctionSql,
  "AND NEW.metadata->>'cancelled_from' = 'recent_runs_panel'",
  'cancel provenance source is optional and limited to the only current source',
);
has(
  continuationRunGuardFunctionSql,
  "AND (OLD.metadata ? 'cancelled_by') IS NOT TRUE\n"
    + "    AND (OLD.metadata ? 'cancelled_at') IS NOT TRUE\n"
    + "    AND (OLD.metadata ? 'cancelled_from') IS NOT TRUE",
  'cancel provenance is write-once and cannot be edited after the protected STOP',
);
has(
  continuationRunGuardFunctionSql,
  "RAISE EXCEPTION 'swanbot_v2_continuation_cancel_provenance_forbidden'",
  'malformed or non-canonical cancel metadata is rejected without opening a metadata escape hatch',
);
has(
  continuationRunGuardSql,
  "RAISE EXCEPTION 'swanbot_v2_continuation_clone_forbidden'",
  'authenticated clients cannot clone a sealed checkpoint into another row',
);
has(
  continuationRunGuardSql,
  "RAISE EXCEPTION 'swanbot_v2_continuation_rewrite_forbidden'",
  'authenticated clients cannot rewrite protected continuation execution state',
);
has(
  continuationRunGuardSql,
  "RAISE EXCEPTION 'swanbot_v2_continuation_delete_forbidden'",
  'authenticated clients cannot erase a protected continuation audit row',
);
has(
  continuationRunGuardSql,
  'AND NEW IS DISTINCT FROM OLD',
  'the full protected row is immutable so future execution columns cannot open a rewrite gap',
);
has(
  continuationRunGuardSql,
  'BEFORE INSERT OR UPDATE OR DELETE ON public.agent_runs',
  'one guard covers clone, rewrite, and audit deletion paths',
);
has(
  continuationRunGuardSql,
  'FROM PUBLIC, anon, authenticated;',
  'continuation authority helpers are not directly client-callable',
);
lacks(
  continuationPrivacyMigration,
  'REVOKE SELECT ON TABLE public.agent_runs',
  'continuation hardening preserves existing authorized run reads',
);
has(
  continuationPrivacyMigration,
  'REVOKE ALL ON FUNCTION public.sweep_unsafe_swanbot_continuations()\n  FROM PUBLIC, anon, authenticated;',
  'sweeper is not callable by public, anonymous, or authenticated clients',
);
has(
  continuationPrivacyMigration,
  'GRANT EXECUTE ON FUNCTION public.sweep_unsafe_swanbot_continuations()\n  TO service_role;',
  'only service_role receives explicit sweeper execution',
);
has(
  continuationCronSql,
  "'sweep-unsafe-swanbot-continuations'",
  'cron job has a stable idempotency name',
);
has(
  continuationCronSql,
  "'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'",
  'rerunning section 29 removes any existing named cron job',
);
has(
  continuationCronSql,
  "'*/3 * * * *'",
  'privacy sweeper runs every three minutes',
);
has(
  continuationCronSql,
  "RAISE NOTICE 'pg_cron unavailable; run sweep_unsafe_swanbot_continuations() manually'",
  'missing or inaccessible pg_cron degrades to a stable notice',
);
lacks(
  continuationPrivacyMigration,
  'CREATE TABLE',
  'continuation privacy migration reuses agent_runs instead of adding a table',
);
lacks(
  continuationPrivacyMigration,
  'CREATE EXTENSION IF NOT EXISTS pg_cron',
  'missing pg_cron cannot abort the privacy migration',
);
has(
  continuationPrivacyMigration,
  "NOTIFY pgrst, 'reload schema';",
  'continuation privacy functions refresh the PostgREST schema',
);

// Universal computer-task roots are request-bound coordination records, not
// executable authority. Database admission/read/transition must preserve that
// distinction even when the client refreshes, races, or sends hostile JSON.
has(
  computerTaskRootMigration,
  'CREATE TABLE IF NOT EXISTS public.computer_task_roots',
  'universal computer tasks have one durable root table',
);
has(
  computerTaskRootMigration,
  'UNIQUE (user_id, circle_id, request_identity_fingerprint)',
  'one authenticated Chat request has one root identity',
);
has(
  computerTaskRootMigration,
  'ALTER TABLE public.computer_task_roots ENABLE ROW LEVEL SECURITY',
  'root rows enable RLS',
);
has(
  computerTaskRootMigration,
  'CREATE POLICY computer_task_roots_select_exact_actor',
  'root reads use an exact-actor policy',
);
has(
  computerTaskRootMigration,
  'REVOKE ALL ON TABLE public.computer_task_roots FROM PUBLIC, anon, authenticated;',
  'clients cannot write root rows directly',
);
has(
  computerTaskRootMigration,
  'GRANT SELECT ON TABLE public.computer_task_roots TO authenticated;',
  'authenticated actors retain only RLS-filtered table reads',
);
has(
  computerTaskRootValidatorSql,
  'octet_length(p_snapshot::text) BETWEEN 64 AND 256000',
  'root snapshots have an exact database size ceiling',
);
has(
  computerTaskRootMigration,
  "to_regprocedure('extensions.digest(bytea,text)') IS NULL",
  'the root migration fails explicitly when schema-qualified pgcrypto is unavailable',
);
has(
  computerTaskRootValidatorSql,
  "jsonb_array_length(p_snapshot->'attempts') <= 64",
  'root attempts are bounded',
);
has(
  computerTaskRootValidatorSql,
  "jsonb_array_length(p_snapshot->'checkpoints') <= 256",
  'root checkpoints are bounded',
);
has(
  computerTaskRootValidatorSql,
  "jsonb_array_length(p_snapshot#>'{acceptance,actions}') BETWEEN 1 AND 128",
  'request acceptance actions are bounded',
);
has(
  computerTaskRootValidatorSql,
  "WHERE snapshot_key <> ALL (ARRAY[",
  'unknown root snapshot keys are rejected',
);
has(
  computerTaskRootValidatorSql,
  "WHERE request_key <> ALL (ARRAY[",
  'unknown authenticated-request keys are rejected',
);
has(
  computerTaskRootValidatorSql,
  "WHERE action.value->>'state' <> 'verified'",
  'completed roots require every acceptance action to be verified',
);
has(
  computerTaskRootValidatorSql,
  "action.value->>'state' IN ('dispatched', 'outcome_unknown')",
  'ambiguous dispatched actions force verification-only state',
);
has(
  computerTaskRootValidatorSql,
  "p_snapshot->>'state' = 'verification_only'\n        AND p_snapshot->>'replayPolicy' = 'verification_only'",
  'nonterminal dispatched work requires both verification-only state and replay policy',
);
lacks(
  computerTaskRootMigration,
  'normalizedTask',
  'database roots never persist raw normalized task text',
);
const computerTaskRootFunctionDefinitions = Array.from(
  computerTaskRootMigration.matchAll(
    /CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\([\s\S]*?\n\$function\$;/g,
  ),
  (match) => ({ name: match[1], sql: match[0] }),
);
const computerTaskRootSecurityDefinerNames = computerTaskRootFunctionDefinitions
  .filter((definition) => definition.sql.includes('\nSECURITY DEFINER\n'))
  .map((definition) => definition.name);
const expectedComputerTaskRootSecurityDefinerNames = [
  'is_computer_task_root_run_v1',
  'admit_computer_task_root_v1',
  'read_computer_task_root_v1',
  'transition_computer_task_root_v1',
  'claim_computer_task_root_action_v1',
  'start_computer_task_root_action_v1',
  'settle_computer_task_root_action_v1',
];
check(
  JSON.stringify(computerTaskRootSecurityDefinerNames)
    === JSON.stringify(expectedComputerTaskRootSecurityDefinerNames),
  'only the seven named root ownership, lifecycle, and action gateway functions run as security definers',
);
const computerTaskRootFixedSearchPathNames = computerTaskRootFunctionDefinitions
  .filter((definition) => definition.sql.includes('\nSET search_path = pg_catalog, public\n'))
  .map((definition) => definition.name);
const expectedComputerTaskRootFixedSearchPathNames = [
  'is_computer_task_root_run_v1',
  'is_valid_computer_task_root_timestamp_v1',
  'computer_task_root_canonical_json_v1',
  'computer_task_root_fingerprint_v1',
  'is_valid_computer_task_root_nested_v1',
  'is_valid_computer_task_root_snapshot_v1',
  'admit_computer_task_root_v1',
  'read_computer_task_root_v1',
  'transition_computer_task_root_v1',
  '_computer_task_root_action_error_v1',
  '_computer_task_root_action_identity_matches_v1',
  '_computer_task_root_action_payload_v1',
  'claim_computer_task_root_action_v1',
  'start_computer_task_root_action_v1',
  'settle_computer_task_root_action_v1',
];
check(
  JSON.stringify(computerTaskRootFixedSearchPathNames)
    === JSON.stringify(expectedComputerTaskRootFixedSearchPathNames),
  'every named root identity helper, validator, lifecycle RPC, and action gateway has a fixed search path',
);
for (const functionName of expectedComputerTaskRootSecurityDefinerNames) {
  const definition = computerTaskRootFunctionDefinitions.find(
    (candidate) => candidate.name === functionName,
  );
  check(definition !== undefined, `${functionName} has a parsed SQL definition`);
  has(definition.sql, 'SECURITY DEFINER', `${functionName} owns its privileged database transition`);
  has(
    definition.sql,
    'SET search_path = pg_catalog, public',
    `${functionName} pins its privileged search path`,
  );
}
has(
  computerTaskRootMigration,
  'CREATE OR REPLACE FUNCTION public.computer_task_root_canonical_json_v1(',
  'database root identity uses a dedicated canonical JSON serializer',
);
has(
  computerTaskRootMigration,
  'extensions.digest(',
  'database root identity uses schema-qualified SHA-256',
);
has(
  computerTaskRootValidatorSql,
  "'namespace', 'computer_task_request_identity'",
  'request identity fingerprints are recomputed from the bounded request',
);
has(
  computerTaskRootValidatorSql,
  "'namespace', 'computer_task_root'",
  'root fingerprints are recomputed from request and task digests',
);
has(
  computerTaskRootMigration,
  'REFERENCES public.circle_chat_threads(id)\n  ON DELETE RESTRICT;',
  'immutable thread scope cannot be nulled underneath a root',
);
has(
  computerTaskRootMigration,
  'CREATE POLICY agent_runs_computer_task_root_update_guard',
  'root-owned wrapper runs reject direct authenticated updates',
);
has(
  computerTaskRootMigration,
  'CREATE POLICY agent_runs_computer_task_root_delete_guard',
  'root-owned wrapper runs reject direct authenticated deletes',
);
has(
  computerTaskRootNestedValidatorSql,
  "(SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 14",
  'acceptance actions require their exact V1 key set',
);
has(
  computerTaskRootNestedValidatorSql,
  "'proofFingerprint', 'dispatchBinding', 'updatedAt'",
  'every acceptance action carries the required dispatch-binding slot',
);
has(
  computerTaskRootNestedValidatorSql,
  "FROM jsonb_object_keys(v_dispatch_binding)\n          ) <> 9",
  'bound dispatch authority requires the exact V1 object shape',
);
has(
  computerTaskRootNestedValidatorSql,
  "'compiler', 'provider', 'deterministic', 'connected_agent',",
  'dispatch binding sources are closed-world',
);
has(
  computerTaskRootNestedValidatorSql,
  "owner.value->>'kind' = v_dispatch_binding->>'source'",
  'dispatch binding source must match its acceptance-owning attempt kind',
);
has(
  computerTaskRootNestedValidatorSql,
  "'read_only', 'direct_request', 'plan_approval',",
  'dispatch authorization categories are closed-world',
);
has(
  computerTaskRootNestedValidatorSql,
  "'read_only', 'action_ledger', 'provider_idempotency',",
  'dispatch mutation authorities are closed-world',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'callIdentityFingerprint'",
  'dispatch call identity is digest-bound',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'policyBindingFingerprint'",
  'dispatch policy is digest-bound',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'verifierBindingFingerprint'",
  'dispatch verifier is digest-bound',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'replayBindingFingerprint'",
  'dispatch replay policy is digest-bound',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'boundAt' > v_entry->>'updatedAt'",
  'dispatch bindings cannot postdate their owning action revision',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'authorizationCategory' = 'read_only'",
  'mutating actions reject read-only authorization bindings',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'mutationAuthority' <> 'read_only'",
  'nonmutating actions require read-only mutation authority',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_action_state <> 'planned'\n        AND (\n          v_dispatch_binding = 'null'::jsonb",
  'every claimed-or-later action requires its immutable dispatch binding',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_dispatch_binding->>'authorizationCategory' IN (\n            'proposal_only', 'unsupported'",
  'audit-only authorization bindings cannot appear on claimed-or-later actions',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_action_frontier_seen := true",
  'strict hydration enforces one ordered action frontier after a verified prefix',
);
has(
  computerTaskRootNestedValidatorSql,
  "owner.value->>'attemptId' = v_acceptance_attempt_id\n        AND owner.value->>'state' = 'active'",
  'nonterminal acceptance requires its owning attempt to remain active',
);
has(
  computerTaskRootNestedValidatorSql,
  "(action.value->>'requiresForegroundLease')::boolean",
  'active lease hydration requires an action that declares foreground ownership',
);
has(
  computerTaskRootNestedValidatorSql,
  "action.value->>'state' = 'dispatched'\n              AND p_snapshot->>'state' = 'verification_only'",
  'active dispatched leases can exist only in verification-only state',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_entry->>'actionId' = ANY(v_action_ids)",
  'acceptance action identities are unique',
);
has(
  computerTaskRootNestedValidatorSql,
  "'namespace', 'computer_task_attempt'",
  'attempt IDs are recomputed from the exact root, index, kind, and parent',
);
has(
  computerTaskRootNestedValidatorSql,
  "'namespace', 'computer_task_child_action'",
  'action IDs are recomputed from their exact manifest identity',
);
has(
  computerTaskRootNestedValidatorSql,
  "'namespace', 'computer_task_action_idempotency'",
  'action idempotency keys are recomputed by PostgreSQL',
);
has(
  computerTaskRootNestedValidatorSql,
  "'namespace', 'computer_task_acceptance'",
  'acceptance fingerprints are recomputed from predicates and ordered manifests',
);
has(
  computerTaskRootNestedValidatorSql,
  "'namespace', 'computer_task_action_acceptance_binding'",
  'per-action acceptance bindings are recomputed by PostgreSQL',
);
has(
  computerTaskRootNestedValidatorSql,
  "v_action_state = 'verified'",
  'verified actions require a structured proof fingerprint',
);
has(
  computerTaskRootNestedValidatorSql,
  "(v_latch - ARRAY['kind', 'latchedAt', 'revision']) <> '{}'::jsonb",
  'interrupt latches require the exact V1 shape',
);

has(computerTaskRootAdmissionSql, 'v_actor uuid := auth.uid()', 'root admission binds the current actor');
has(computerTaskRootAdmissionSql, 'member.user_id = v_actor', 'root admission rechecks circle membership');
has(computerTaskRootAdmissionSql, 'thread.created_by = v_actor', 'root admission validates private thread ownership');
has(computerTaskRootAdmissionSql, 'thread_member.user_id = v_actor', 'root admission validates explicit thread membership');
has(computerTaskRootAdmissionSql, 'pg_advisory_xact_lock(hashtextextended(', 'competing admissions serialize before wrapper creation');
has(computerTaskRootAdmissionSql, 'FOR UPDATE', 'duplicate admission locks the canonical root');
has(computerTaskRootAdmissionSql, "'disposition', 'duplicate'", 'exact duplicate admission is explicit');
check(
  computerTaskRootAdmissionSql.indexOf('IF FOUND THEN')
    < computerTaskRootAdmissionSql.indexOf('Only a genuinely new admission pays'),
  'exact duplicate admission returns before snapshot derivation and client clock freshness checks',
);
has(computerTaskRootAdmissionSql, "'code', 'identity_conflict'", 'request drift fails with stable identity conflict');
has(computerTaskRootAdmissionSql, "'taskCompletionVerified', false", 'wrapper runs never self-certify task completion');
has(computerTaskRootAdmissionSql, "'rootCoordinationOnly', true", 'wrapper runs are marked coordination-only');

has(computerTaskRootReadSql, 'v_actor uuid := auth.uid()', 'root refresh reauthenticates the actor');
has(computerTaskRootReadSql, 'member.user_id = v_actor', 'root refresh rechecks circle membership');
has(computerTaskRootReadSql, 'thread_member.user_id = v_actor', 'root refresh rechecks private-thread access');
has(computerTaskRootReadSql, "'disposition', 'read'", 'root refresh returns an explicit inert read projection');

has(computerTaskRootTransitionSql, 'p_transition_type text', 'transition RPC receives an explicit transition kind');
has(computerTaskRootTransitionSql, "p_transition_type NOT IN (", 'transition kinds are closed-world');
has(computerTaskRootTransitionSql, 'FOR UPDATE', 'root transitions lock the canonical row');
has(computerTaskRootTransitionSql, 'v_root.revision <> p_expected_revision', 'root transition enforces revision CAS');
check(
  computerTaskRootTransitionSql.indexOf('FOR UPDATE')
    < computerTaskRootTransitionSql.indexOf('IF NOT public.is_valid_computer_task_root_snapshot_v1'),
  'transition snapshot hashing occurs only after exact actor/root lookup and revision CAS',
);
has(computerTaskRootTransitionSql, 'v_next_revision <> v_root.revision + 1', 'root revision advances exactly once');
has(computerTaskRootTransitionSql, "p_root_snapshot->'request' IS DISTINCT FROM v_root.root_snapshot->'request'", 'authenticated request scope is immutable');
has(computerTaskRootTransitionSql, 'OR CASE p_transition_type', 'every transition has an exact top-level delta mask');
has(
  computerTaskRootTransitionSql,
  "'bind_action_dispatch',",
  'action dispatch binding has an explicit transition kind',
);
has(
  computerTaskRootTransitionSql,
  "WHEN 'bind_action_dispatch' THEN",
  'action dispatch binding owns an exact top-level delta mask',
);
has(
  computerTaskRootTransitionSql,
  "'revision', 'state', 'updatedAt', 'acceptance'",
  'dispatch binding atomically resumes a waiting root into running state',
);
has(computerTaskRootTransitionSql, "OR ((p_root_snapshot->'checkpoints')", 'checkpoint prefix comparison parenthesizes the JSONB operand');
has(computerTaskRootTransitionSql, "OR ((p_root_snapshot->'attempts')", 'attempt prefix comparison parenthesizes the JSONB operand');
has(computerTaskRootTransitionSql, "OR ((p_root_snapshot->'acceptance') -", 'acceptance delta comparison parenthesizes the JSONB operand');
has(computerTaskRootTransitionSql, "OR ((p_root_snapshot->'foregroundLease') -", 'lease delta comparison parenthesizes the JSONB operand');
check(
  (
    computerTaskRootTransitionSql.match(
      /NULLIF\(\s*v_root\.root_snapshot->'foregroundLease',\s*'null'::jsonb\s*\)/g,
    ) || []
  ).length === 3,
  'every foreground-lease jsonb_set base is safe when the lease is JSON null',
);
has(
  computerTaskRootTransitionSql,
  "p_root_snapshot#>>'{foregroundLease,status}'\n                IS DISTINCT FROM 'active'",
  'foreground-required dispatch rejects a missing lease status instead of accepting SQL NULL',
);
has(
  computerTaskRootTransitionSql,
  "p_root_snapshot#>>'{foregroundLease,actionId}'\n                IS DISTINCT FROM",
  'foreground-required dispatch rejects a missing or mismatched lease action',
);
has(
  computerTaskRootTransitionSql,
  "p_root_snapshot#>>'{foregroundLease,expiresAt}' IS NULL",
  'foreground-required dispatch rejects a missing lease expiry before timestamp comparison',
);
has(computerTaskRootTransitionSql, "WHEN 'completed' THEN 'paused'", 'root completion cannot promote the wrapper run to completed');
has(computerTaskRootTransitionSql, "'taskCompletionVerified', false", 'every root transition preserves unverified wrapper status');
has(computerTaskRootTransitionSql, "p_transition_type = 'record_action_state'", 'typed action-state updates own ambiguity recovery');
has(
  computerTaskRootTransitionSql,
  "p_transition_type = 'bind_action_dispatch'",
  'typed dispatch binding owns its one-time action update',
);
has(
  computerTaskRootTransitionSql,
  "OR action.value->'dispatchBinding' <> 'null'::jsonb",
  'acceptance starts every action with an unbound dispatch slot',
);
has(
  computerTaskRootTransitionSql,
  "prior.value->'dispatchBinding' <> 'null'::jsonb",
  'dispatch bindings cannot be rebound',
);
has(
  computerTaskRootTransitionSql,
  "next.value - ARRAY['dispatchBinding', 'updatedAt']",
  'dispatch binding changes only its binding and timestamp',
);
has(
  computerTaskRootTransitionSql,
  "next.value#>>'{dispatchBinding,boundAt}' <>\n                p_root_snapshot->>'updatedAt'",
  'dispatch binding timestamp equals the root transition timestamp',
);
has(
  computerTaskRootTransitionSql,
  "prior.value->>'attemptId' =\n                v_root.root_snapshot#>>'{acceptance,attemptId}'",
  'an acceptance-owning attempt cannot finish through the generic attempt transition',
);
has(
  computerTaskRootTransitionSql,
  "next.value#>>'{dispatchBinding,authorizationCategory}'\n                    IN ('proposal_only', 'unsupported')",
  'proposal-only and unsupported dispatch categories never claim',
);
has(
  computerTaskRootTransitionSql,
  "NOT IN ('action_ledger', 'provider_idempotency')",
  'mutating claims require a durable mutation authority',
);
has(
  computerTaskRootTransitionSql,
  "next.value#>>'{dispatchBinding,mutationAuthority}'\n                      <> 'read_only'",
  'nonmutating claims require read-only authority',
);
check(
  (
    computerTaskRootTransitionSql.match(
      /owner\.value->>'attemptId' = (?:next|action)\.value->>'attemptId'[\s\S]{0,120}owner\.value->>'state' = 'active'/g,
    ) || []
  ).length === 2,
  'claim or dispatch and foreground lease acquisition both require the action-owning attempt to remain active',
);
has(
  computerTaskRootTransitionSql,
  "(other.value->>'index')::integer <\n                  (action.value->>'index')::integer",
  'foreground lease acquisition cannot skip an earlier unverified action',
);
has(
  computerTaskRootTransitionSql,
  "other.value->>'actionId' <> action.value->>'actionId'\n                AND other.value->>'state' IN ('claimed', 'dispatched')",
  'foreground lease acquisition cannot overlap another claimed or dispatched action',
);
has(computerTaskRootTransitionSql, "v_next_state NOT IN ('running', 'verification_only')", 'action transitions cannot skip into terminal completion');
has(computerTaskRootTransitionSql, "next.value->>'state' = 'claimed'", 'action claiming enforces manifest order');
has(
  computerTaskRootTransitionSql,
  "prior.value->>'state' = 'outcome_unknown'\n                  AND next.value->>'state' = 'verified'",
  'outcome-unknown work may reconcile only to proof-bearing verified state',
);
has(computerTaskRootTransitionSql, "next.value->>'updatedAt' <> p_root_snapshot->>'updatedAt'", 'the changed action owns the transition timestamp');
has(computerTaskRootTransitionSql, "p_root_snapshot#>>'{interruptLatch,revision}'", 'STOP and foreground override bind the next revision');
has(
  computerTaskRootTransitionSql,
  "'append_checkpoint', 'record_action_state',\n        'release_foreground_lease', 'stop_requested',\n        'human_foreground_override'",
  'verification-only work may release focus, accept proof, or latch an interrupt without replay',
);
has(computerTaskRootTransitionSql, "v_root.state IN ('completed', 'failed', 'cancelled')", 'terminal roots cannot reactivate');

const computerTaskRootActionGatewayDefinitions = [
  ['claim_computer_task_root_action_v1', computerTaskRootActionClaimSql],
  ['start_computer_task_root_action_v1', computerTaskRootActionStartSql],
  ['settle_computer_task_root_action_v1', computerTaskRootActionSettleSql],
] as const;
for (const [functionName, definition] of computerTaskRootActionGatewayDefinitions) {
  has(definition, 'v_actor uuid := auth.uid()', `${functionName} binds the current actor`);
  has(definition, 'root.user_id = v_actor', `${functionName} binds the exact root owner`);
  has(definition, 'member.user_id = v_actor', `${functionName} rechecks circle membership`);
  has(definition, 'thread.created_by = v_actor', `${functionName} rechecks private-thread ownership`);
  has(definition, 'thread_member.user_id = v_actor', `${functionName} rechecks private-thread membership`);
  has(
    definition,
    'public._computer_task_root_action_identity_matches_v1(',
    `${functionName} revalidates the ledger identity derived from the locked root`,
  );
  lacks(definition, "auth.role() = 'service_role'", `${functionName} has no service-role bypass`);

  const rootLookupIndex = definition.indexOf('FROM public.computer_task_roots AS root');
  const rootLockIndex = definition.indexOf('\n  FOR UPDATE;', rootLookupIndex);
  const actionLedgerLookupIndex = definition.indexOf(
    'FROM public.agent_action_calls AS action_call',
    rootLockIndex,
  );
  const actionLedgerLockIndex = definition.indexOf('\n  FOR UPDATE;', actionLedgerLookupIndex);
  check(rootLookupIndex >= 0, `${functionName} looks up the exact root row`);
  check(rootLockIndex > rootLookupIndex, `${functionName} locks the root row`);
  check(
    actionLedgerLookupIndex > rootLockIndex,
    `${functionName} reaches the action ledger only after locking the root`,
  );
  check(
    actionLedgerLockIndex > actionLedgerLookupIndex,
    `${functionName} locks the exact action ledger row under the root lock`,
  );
}

const computerTaskRootActionGatewaySignatures = [
  'public.claim_computer_task_root_action_v1(\n  uuid, integer, text, jsonb, jsonb, integer\n)',
  'public.start_computer_task_root_action_v1(\n  uuid, integer, text, uuid, jsonb\n)',
  'public.settle_computer_task_root_action_v1(\n  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb\n)',
] as const;
for (const signature of computerTaskRootActionGatewaySignatures) {
  has(
    computerTaskRootMigration,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`,
    `${signature} removes public and anonymous execution`,
  );
  has(
    computerTaskRootMigration,
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    `${signature} grants only the authenticated app boundary`,
  );
}

const privateComputerTaskRootActionHelpers = [
  {
    name: 'public._computer_task_root_action_error_v1',
    revoke:
      'REVOKE ALL ON FUNCTION public._computer_task_root_action_error_v1(text, text)\n'
      + '  FROM PUBLIC, anon, authenticated;',
  },
  {
    name: 'public._computer_task_root_action_identity_matches_v1',
    revoke:
      'REVOKE ALL ON FUNCTION public._computer_task_root_action_identity_matches_v1(\n'
      + '  public.computer_task_roots, jsonb, public.agent_action_calls\n'
      + ') FROM PUBLIC, anon, authenticated;',
  },
  {
    name: 'public._computer_task_root_action_payload_v1',
    revoke:
      'REVOKE ALL ON FUNCTION public._computer_task_root_action_payload_v1(\n'
      + '  jsonb, public.agent_action_calls, text, boolean\n'
      + ') FROM PUBLIC, anon, authenticated;',
  },
] as const;
for (const helper of privateComputerTaskRootActionHelpers) {
  has(
    computerTaskRootMigration,
    helper.revoke,
    `${helper.name} remains private to the privileged gateway`,
  );
  lacks(
    computerTaskRootMigration,
    `GRANT EXECUTE ON FUNCTION ${helper.name}`,
    `${helper.name} is never granted directly`,
  );
}

has(
  computerTaskRootMigration,
  'DROP FUNCTION IF EXISTS public.transition_computer_task_root_v1(\n  uuid, integer, jsonb\n);',
  'the obsolete transition signature is removed',
);
has(
  computerTaskRootMigration,
  'GRANT EXECUTE ON FUNCTION public.transition_computer_task_root_v1(\n  uuid, integer, text, jsonb\n) TO authenticated;',
  'only the exact four-argument transition RPC is granted',
);
has(
  computerTaskRootMigration,
  'REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_snapshot_v1(jsonb)\n  FROM PUBLIC, anon, authenticated;',
  'snapshot validation remains a private helper',
);
has(
  computerTaskRootMigration,
  "NOTIFY pgrst, 'reload schema';",
  'root RPCs refresh the PostgREST schema',
);

console.log(`database-authority-guards smoke: ${assertions} assertions passed`);
