/** Static source contract for owner-private, atomic Office preferences. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260813220000_office_user_preferences.sql'),
  'utf8',
);

let assertions = 0;
function check(value: unknown, message: string): void {
  assertions += 1;
  if (!value) throw new Error(`Office user preferences SQL smoke failed: ${message}`);
}

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.office_user_preferences',
  'PRIMARY KEY (user_id, circle_id)',
  "preferences jsonb NOT NULL DEFAULT '{}'::jsonb",
  'revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)',
  'updated_at timestamptz NOT NULL DEFAULT clock_timestamp()',
  'ALTER TABLE public.office_user_preferences ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.office_user_preferences FORCE ROW LEVEL SECURITY',
  'CREATE POLICY office_user_preferences_select_own',
  'user_id = auth.uid()',
  'membership.circle_id = office_user_preferences.circle_id',
  'membership.user_id = auth.uid()',
  'REVOKE ALL ON TABLE public.office_user_preferences FROM PUBLIC, anon, authenticated',
  'GRANT SELECT ON TABLE public.office_user_preferences TO authenticated',
  'CREATE OR REPLACE FUNCTION public.read_my_office_preferences_v1(',
  'CREATE OR REPLACE FUNCTION public.patch_my_office_preferences_v1(',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog, public',
  "actor_id uuid := auth.uid()",
  "RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'",
  "RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501'",
  'FOR KEY SHARE',
  "'agentNames'",
  "'appearances'",
  "'whiteboardNotes'",
  "'budgetConfig'",
  "'idleConfig'",
  "'sharedChatOptIn'",
  "'agentFilterMode'",
  "'telegramMetadata'",
  "normalized_key ~ '(password|passwd|secret|token|apikey|accesskey|privatekey|credential|authorization|bearer|cookie|sessionkey|webhook)'",
  'octet_length(p_preferences::text) > 131072',
  'octet_length(p_patch::text) > 131072',
  'octet_length(next_preferences::text) > 131072',
  'FOR UPDATE',
  "patch_entry.value <> 'null'::jsonb",
  'revision = revision + 1',
  'updated_at = clock_timestamp()',
  "'schemaVersion', 1",
  "'accepted', true",
  "'revision', accepted_revision",
  "'updatedAt', accepted_updated_at",
  'REVOKE ALL ON FUNCTION public.read_my_office_preferences_v1(uuid)',
  'REVOKE ALL ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)',
  'GRANT EXECUTE ON FUNCTION public.read_my_office_preferences_v1(uuid)',
  'GRANT EXECUTE ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)',
  "SET LOCAL lock_timeout = '5s'",
  "SET LOCAL statement_timeout = '30s'",
  'DO $legacy_private_office_lock$',
  "LOCK TABLE public.profiles, public.circle_members, public.circle_office_agents IN SHARE MODE",
  'LOCK TABLE public.office_user_legacy_appearances IN SHARE ROW EXCLUSIVE MODE',
  'CREATE TABLE IF NOT EXISTS public.office_user_legacy_appearances',
  'PRIMARY KEY (user_id, circle_id, agent_key)',
  'ALTER TABLE public.office_user_legacy_appearances ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.office_user_legacy_appearances FORCE ROW LEVEL SECURITY',
  'DO $legacy_appearance_archive_policy_reset$',
  'CREATE POLICY office_user_legacy_appearances_select_own',
  'REVOKE ALL ON TABLE public.office_user_legacy_appearances',
  'GRANT SELECT ON TABLE public.office_user_legacy_appearances TO authenticated',
  'office_legacy_appearance_archive_schema_mismatch',
  'office_legacy_appearance_archive_primary_key_mismatch',
  'office_legacy_appearance_archive_receipt_mismatch',
  'office_legacy_active_roster_appearance_capacity_exceeded',
  'office_legacy_preference_membership_ambiguous',
  'office_legacy_preference_reviewed_source_unsafe',
  'office_legacy_preference_source_invalid',
  'office_legacy_appearance_entry_invalid',
  'office_legacy_preference_reviewed_field_invalid',
  'office_legacy_preference_copy_receipt_missing',
  'CREATE TEMP TABLE office_legacy_appearance_expected_v1',
  'INSERT INTO public.office_user_legacy_appearances(',
  'DO $legacy_appearance_archive_receipt$',
  'DO $legacy_active_appearance_capacity$',
  'DO $legacy_private_office_copy$',
  'WITH eligible_profiles AS (',
  'CROSS JOIN LATERAL (',
  'FROM public.circle_members AS exact_membership',
  'appearance_entries AS (',
  'active_appearance_candidates AS (',
  'deduplicated_active_appearances AS (',
  'ranked_active_appearances AS (',
  'normalized_appearance_entries AS (',
  "ELSE '#f5d0a9'",
  "ELSE '#6366f1'",
  "ELSE 'neutral'",
  'idle_behavior_entries AS (',
  "'enabled', CASE",
  "'cooldownMinutes', CASE",
  "'lastRanAt', CASE",
  'normalized_idle_configs AS (',
  "'sharedChatOptIn', source.shared_chat_opt_in",
  "'agentNames', source.agent_names",
  "'appearances', normalized_appearance.appearances",
  "'whiteboardNotes', source.whiteboard_notes",
  "'budgetConfig', source.budget_config",
  "'idleConfig', normalized_idle.idle_config",
  "'agentFilterMode', source.agent_filter_mode",
  'AND NOT source_contains_secret',
  'AND public.validate_office_user_preferences_v1(preferences)',
  'ON CONFLICT (user_id, circle_id) DO NOTHING',
  "- 'telegramConfig'",
  "- 'agentNames'",
  "- 'whiteboardNotes'",
  "- 'budgetConfig'",
  "- 'idleConfig'",
  "- 'agentFilterMode'",
  "- 'appearances'",
  'CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_profile_keys_v1()',
  'BEFORE INSERT OR UPDATE OF office_preferences ON public.profiles',
  'DO $legacy_agent_appearance_scrub$',
  "SET agent_appearance = '{}'::jsonb",
  "WHERE agent_appearance IS DISTINCT FROM '{}'::jsonb",
  'CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_agent_appearance_v1()',
  'BEFORE INSERT OR UPDATE OF agent_appearance ON public.profiles',
  "NOTIFY pgrst, 'reload schema'",
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}

const readStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.read_my_office_preferences_v1(',
);
const patchStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.patch_my_office_preferences_v1(',
);
const grantsStart = migration.indexOf(
  'REVOKE ALL ON FUNCTION public.read_my_office_preferences_v1(uuid)',
);
const readBody = migration.slice(readStart, patchStart);
const patchBody = migration.slice(patchStart, grantsStart);
check(readStart >= 0 && patchStart > readStart && grantsStart > patchStart, 'RPC bodies have exact boundaries');
check(!readBody.includes('p_user_id'), 'read authority has no caller-selected user id');
check(!patchBody.includes('p_user_id'), 'patch authority has no caller-selected user id');
check(
  readBody.includes('FROM public.circle_members AS membership')
    && readBody.includes('FOR KEY SHARE')
    && patchBody.includes('FROM public.circle_members AS membership')
    && patchBody.includes('FOR KEY SHARE'),
  'both RPCs retain exact live membership through transaction completion',
);
check(
  readBody.includes("'preferences', coalesce(stored_preferences, '{}'::jsonb)")
    && readBody.includes("'revision', coalesce(stored_revision, 0)")
    && readBody.includes("'updatedAt', to_jsonb(stored_updated_at)"),
  'read returns one bounded preference/revision/timestamp object',
);
check(!readBody.includes("'userId'") && !readBody.includes("'user_id'"), 'read receipt exposes no owner id');
check(
  patchBody.indexOf('INSERT INTO public.office_user_preferences(user_id, circle_id)')
    < patchBody.indexOf('FOR UPDATE')
    && patchBody.indexOf('FOR UPDATE') < patchBody.indexOf('FOR patch_entry IN'),
  'patch establishes and locks the exact row before merging',
);
check(
  patchBody.includes('next_preferences := next_preferences - patch_entry.key')
    && patchBody.includes('next_preferences := next_preferences || jsonb_build_object'),
  'top-level JSON null removes while non-null replaces exactly one field',
);
const receiptStart = patchBody.lastIndexOf('RETURN jsonb_build_object(');
const receipt = patchBody.slice(receiptStart);
check(receiptStart >= 0, 'patch has one terminal receipt');
check(
  !receipt.includes('next_preferences')
    && !receipt.includes('p_patch')
    && !receipt.includes('preferences'),
  'patch receipt is value-free',
);

const validatorStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.validate_office_user_preferences_v1(',
);
const tableStart = migration.indexOf('CREATE TABLE IF NOT EXISTS public.office_user_preferences');
const validatorBody = migration.slice(validatorStart, tableStart);
check(!validatorBody.includes("'telegramConfig'"), 'legacy Telegram credential object is not allowlisted');
check(
  validatorBody.includes("WHERE telegram_key NOT IN ('chatId', 'botName')")
    && validatorBody.includes("'^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,64})$'")
    && !validatorBody.includes("'botToken'"),
  'Telegram persistence is bounded non-secret metadata only',
);
check(
  validatorBody.includes("entry_count <> 15")
    && validatorBody.includes("'^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'")
    && validatorBody.includes("'crab_helmet'")
    && validatorBody.includes("'galaxy'"),
  'appearance records require the reviewed full shape, colors, and enums',
);
check(
  validatorBody.includes('jsonb_array_length(preference_entry.value) > 8')
    && validatorBody.includes('length(btrim(text_value)) NOT BETWEEN 1 AND 80'),
  'whiteboard count and note length are bounded',
);
check(
  validatorBody.includes(
    "WHERE idle_key NOT IN ('masterEnabled', 'behaviors', 'sharedChatOptIn')",
  )
    && validatorBody.includes("preference_entry.value ? 'sharedChatOptIn'")
    && validatorBody.includes(
      "jsonb_typeof(preference_entry.value -> 'sharedChatOptIn') <> 'boolean'",
    ),
  'idle config permits only the optional boolean shared-chat opt-in extension',
);
const idleRequiredShape = validatorBody.slice(
  validatorBody.indexOf("WHEN 'idleConfig' THEN"),
  validatorBody.indexOf('IF EXISTS (', validatorBody.indexOf("WHEN 'idleConfig' THEN")),
);
check(
  !idleRequiredShape.includes('sharedChatOptIn'),
  'legacy idle configs remain valid without sharedChatOptIn',
);

const scrubStart = migration.indexOf('DO $legacy_telegram_scrub$');
const scrubEnd = migration.indexOf('$legacy_telegram_scrub$;', scrubStart + 4);
const scrubBody = migration.slice(scrubStart, scrubEnd);
check(scrubStart >= 0 && scrubEnd > scrubStart, 'legacy scrub has a bounded idempotent block');
check(!scrubBody.includes('RETURNING') && !scrubBody.includes('SELECT office_preferences'), 'legacy scrub never projects credential values');

const lockStart = migration.indexOf('DO $legacy_private_office_lock$');
const lockEnd = migration.indexOf('$legacy_private_office_lock$;', lockStart + 4);
const lockBody = migration.slice(lockStart, lockEnd);
const copyStart = migration.indexOf('DO $legacy_private_office_copy$');
const copyEnd = migration.indexOf('$legacy_private_office_copy$;', copyStart + 4);
const copyBody = migration.slice(copyStart, copyEnd);
check(copyStart >= 0 && copyEnd > copyStart, 'legacy preservation has a bounded idempotent block');
check(
  lockStart >= 0
    && lockEnd > lockStart
    && lockEnd < copyStart
    && copyEnd < scrubStart,
  'write-stable legacy lock precedes preservation and the separate scrub block',
);
check(
  migration.indexOf("SET LOCAL lock_timeout = '5s'") < lockStart
    && migration.indexOf("SET LOCAL statement_timeout = '30s'") < lockStart
    && lockBody.includes("pg_catalog.to_regclass('public.profiles')")
    && lockBody.includes("pg_catalog.to_regclass('public.circle_members')")
    && lockBody.includes("pg_catalog.to_regclass('public.circle_office_agents')")
    && lockBody.includes(
      "EXECUTE 'LOCK TABLE public.profiles, public.circle_members, public.circle_office_agents IN SHARE MODE'",
    )
    && lockBody.includes('LOCK TABLE public.office_user_legacy_appearances IN SHARE ROW EXCLUSIVE MODE'),
  'legacy source, roster, and archive locks are existence-guarded and fail on bounded local timeouts',
);
check(
  copyBody.includes('FROM public.circle_members AS exact_membership')
    && copyBody.includes(') = 1'),
  'legacy preservation requires exactly one current circle membership',
);
check(
  copyBody.includes("'agentNames', source.agent_names")
    && copyBody.includes("'appearances', normalized_appearance.appearances")
    && copyBody.includes("'whiteboardNotes', source.whiteboard_notes")
    && copyBody.includes("'budgetConfig', source.budget_config")
    && copyBody.includes("'idleConfig', normalized_idle.idle_config")
    && copyBody.includes("'agentFilterMode', source.agent_filter_mode"),
  'legacy preservation projects only the reviewed private preference fields',
);
check(
  !copyBody.includes("office_preferences -> 'telegramConfig'")
    && !copyBody.includes("office_preferences ->> 'telegramConfig'"),
  'legacy Telegram credentials never enter the preservation projection',
);
const archiveTableStart = migration.indexOf(
  'CREATE TABLE IF NOT EXISTS public.office_user_legacy_appearances',
);
const archiveTableEnd = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.read_my_office_preferences_v1(',
  archiveTableStart,
);
const archiveTableBody = migration.slice(archiveTableStart, archiveTableEnd);
check(
  archiveTableStart >= 0
    && archiveTableEnd > archiveTableStart
    && archiveTableBody.includes('agent_key text COLLATE "C" NOT NULL')
    && archiveTableBody.includes('appearance jsonb NOT NULL')
    && archiveTableBody.includes('IF active_column_count <> 5')
    && archiveTableBody.includes("ARRAY['user_id', 'circle_id', 'agent_key']::text[]")
    && archiveTableBody.includes("('appearance'::text, 'jsonb'::text)")
    && archiveTableBody.includes("('archived_at'::text, 'timestamp with time zone'::text)")
    && archiveTableBody.includes('CHECK (\n      public.validate_office_user_preferences_v1(')
    && archiveTableBody.includes("jsonb_build_object('archived-agent', appearance)"),
  'archive stores only validated complete normalized appearances under a deterministic owner scope',
);
check(
  archiveTableBody.includes('FORCE ROW LEVEL SECURITY')
    && archiveTableBody.includes('DO $legacy_appearance_archive_policy_reset$')
    && archiveTableBody.includes('DROP POLICY %I ON public.office_user_legacy_appearances')
    && archiveTableBody.includes('CREATE POLICY office_user_legacy_appearances_select_own')
    && archiveTableBody.includes('REVOKE ALL ON TABLE public.office_user_legacy_appearances')
    && archiveTableBody.includes('GRANT SELECT ON TABLE public.office_user_legacy_appearances TO authenticated')
    && !archiveTableBody.includes('GRANT INSERT ON TABLE public.office_user_legacy_appearances TO authenticated')
    && !archiveTableBody.includes('GRANT UPDATE ON TABLE public.office_user_legacy_appearances TO authenticated')
    && !archiveTableBody.includes('GRANT DELETE ON TABLE public.office_user_legacy_appearances TO authenticated'),
  'archive resets policy drift and keeps authenticated users to owner/member SELECT with no direct DML',
);
const preflightStart = migration.indexOf('DO $legacy_private_office_preflight$');
const preflightEnd = migration.indexOf('$legacy_private_office_preflight$;', preflightStart + 4);
const preflightBody = migration.slice(preflightStart, preflightEnd);
check(
  preflightStart >= 0
    && preflightEnd > preflightStart
    && preflightBody.includes('office_legacy_preference_membership_ambiguous')
    && preflightBody.includes('office_legacy_preference_reviewed_source_unsafe')
    && preflightBody.includes('office_legacy_preference_source_invalid')
    && preflightBody.includes('office_legacy_appearance_entry_invalid')
    && preflightBody.includes('office_legacy_preference_reviewed_field_invalid')
    && !/RAISE EXCEPTION [^;]*(profile\.id|agent_key|office_preferences|agent_appearance)/.test(preflightBody),
  'ambiguous ownership, secrets, and invalid reviewed sources fail before archive or preference publication with constant errors',
);
const expectedStart = migration.indexOf('CREATE TEMP TABLE office_legacy_appearance_expected_v1');
const expectedEnd = migration.indexOf('DO $legacy_active_appearance_capacity$', expectedStart);
const expectedBody = migration.slice(expectedStart, expectedEnd);
check(
  expectedStart >= 0
    && expectedEnd > expectedStart
    && expectedBody.includes('public.normalize_legacy_office_agent_appearance_v1(')
    && expectedBody.includes('PRIMARY KEY (user_id, circle_id, agent_key)')
    && expectedBody.includes('INSERT INTO public.office_user_legacy_appearances(')
    && expectedBody.includes('ON CONFLICT (user_id, circle_id, agent_key) DO NOTHING')
    && expectedBody.includes('archived.appearance IS DISTINCT FROM expected.appearance')
    && expectedBody.includes('office_legacy_appearance_archive_receipt_mismatch'),
  'every normalized source key is archived once and exact key plus JSON equality is proven before scrub',
);
check(
  copyBody.includes('JOIN public.circle_office_agents AS roster')
    && copyBody.includes('0 AS source_priority')
    && copyBody.includes('1 AS source_priority')
    && copyBody.includes('ORDER BY\n          user_id,\n          circle_id,\n          agent_key COLLATE "C",\n          source_priority')
    && copyBody.includes('ORDER BY source_priority, agent_key COLLATE "C"')
    && copyBody.includes('WHERE active_rank <= 128')
    && migration.includes('office_legacy_active_roster_appearance_capacity_exceeded'),
  'active preference projection deterministically prefers exact roster ids, then agentNames keys, and is bounded at 128',
);
check(
  (copyBody.match(/ELSE false/g) || []).length >= 3
    && copyBody.includes("'enabled', CASE")
    && copyBody.includes("'cooldownMinutes', CASE")
    && copyBody.includes("'lastRanAt', CASE")
    && copyBody.includes('ELSE 1440')
    && copyBody.includes('ELSE NULL')
    && copyBody.includes('octet_length(behavior.value::text) <= 4096'),
  'legacy idle state preserves bounded fields and fills fail-closed nested defaults',
);
const candidateStart = copyBody.indexOf('candidate_documents AS (');
const candidateBody = copyBody.slice(candidateStart);
check(
  candidateStart >= 0
    && candidateBody.includes('jsonb_object_agg(preference.key, preference.value ORDER BY preference.key)')
    && candidateBody.includes("WHERE preference.value <> 'null'::jsonb")
    && !candidateBody.includes('jsonb_strip_nulls'),
  'candidate assembly removes only absent top-level fields and retains nested lastRanAt null defaults',
);
check(
  copyBody.includes("preferences <> '{}'::jsonb")
    && copyBody.includes('source_contains_secret')
    && copyBody.includes('AND NOT source_contains_secret')
    && copyBody.includes('public.validate_office_user_preferences_v1(preferences)'),
  'empty, invalid, and secret-bearing legacy candidates are rejected before insert',
);
const archiveReceiptStart = migration.indexOf('DO $legacy_appearance_archive_receipt$');
const copyReceiptStart = migration.indexOf('DO $legacy_private_office_copy_receipt$');
check(
  expectedStart < archiveReceiptStart
    && archiveReceiptStart < copyStart
    && copyStart < copyReceiptStart
    && copyReceiptStart < scrubStart
    && scrubStart < migration.indexOf('DO $legacy_agent_appearance_scrub$'),
  'archive equality, bounded active projection, and preference receipt all succeed before either legacy source is scrubbed',
);
check(
  copyBody.includes('ON CONFLICT (user_id, circle_id) DO NOTHING')
    && !copyBody.includes('DO UPDATE'),
  'legacy preservation never overwrites a newer private preference row',
);
for (const privateKey of [
  'telegramConfig',
  'agentNames',
  'whiteboardNotes',
  'budgetConfig',
  'idleConfig',
  'agentFilterMode',
  'appearances',
]) {
  check(scrubBody.includes(`- '${privateKey}'`), `legacy scrub removes ${privateKey}`);
}
for (const globalKey of ['autoApprove', 'adaptiveWorkspace', 'costCounterSinceIsoByCircle']) {
  check(!scrubBody.includes(`- '${globalKey}'`), `legacy scrub preserves unrelated ${globalKey}`);
}

const stripStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_profile_keys_v1()',
);
const stripEnd = migration.indexOf(
  'REVOKE ALL ON FUNCTION public.strip_legacy_private_office_profile_keys_v1()',
);
const stripBody = migration.slice(stripStart, stripEnd);
for (const privateKey of [
  'telegramConfig',
  'agentNames',
  'whiteboardNotes',
  'budgetConfig',
  'idleConfig',
  'agentFilterMode',
  'appearances',
]) {
  check(stripBody.includes(`- '${privateKey}'`), `future-write trigger strips ${privateKey}`);
}
check(
  stripBody.includes('NEW.office_preferences := NEW.office_preferences')
    && stripBody.includes('RETURN NEW'),
  'future-write guard transforms the row in place',
);
check(
  migration.includes('DROP TRIGGER IF EXISTS strip_legacy_private_office_profile_keys_v1')
    && migration.includes('CREATE TRIGGER strip_legacy_private_office_profile_keys_v1')
    && migration.includes('BEFORE INSERT OR UPDATE OF office_preferences ON public.profiles'),
  'future-write trigger is reapplication-safe and limited to the profile blob',
);

const appearanceScrubStart = migration.indexOf('DO $legacy_agent_appearance_scrub$');
const appearanceScrubEnd = migration.indexOf(
  '$legacy_agent_appearance_scrub$;',
  appearanceScrubStart + 4,
);
const appearanceScrubBody = migration.slice(appearanceScrubStart, appearanceScrubEnd);
check(
  appearanceScrubStart >= 0 && appearanceScrubEnd > appearanceScrubStart,
  'legacy agent appearance scrub has a bounded idempotent block',
);
check(
  appearanceScrubBody.includes("SET agent_appearance = '{}'::jsonb")
    && appearanceScrubBody.includes("WHERE agent_appearance IS DISTINCT FROM '{}'::jsonb"),
  'legacy agent appearances are erased without touching other profile fields',
);
check(
  !appearanceScrubBody.includes('RETURNING')
    && !appearanceScrubBody.includes('SELECT agent_appearance'),
  'legacy agent appearance scrub never projects private values',
);

const appearanceStripStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_agent_appearance_v1()',
);
const appearanceStripEnd = migration.indexOf(
  'REVOKE ALL ON FUNCTION public.strip_legacy_private_office_agent_appearance_v1()',
);
const appearanceStripBody = migration.slice(appearanceStripStart, appearanceStripEnd);
check(
  appearanceStripBody.includes("NEW.agent_appearance := '{}'::jsonb")
    && appearanceStripBody.includes('RETURN NEW'),
  'future legacy appearance writes normalize only the deprecated field',
);
check(
  migration.includes('DROP TRIGGER IF EXISTS strip_legacy_private_office_agent_appearance_v1')
    && migration.includes('CREATE TRIGGER strip_legacy_private_office_agent_appearance_v1')
    && migration.includes('BEFORE INSERT OR UPDATE OF agent_appearance ON public.profiles'),
  'legacy appearance guard is reapplication-safe and scoped to its column',
);
check(
  migration.includes(
    'REVOKE ALL ON FUNCTION public.strip_legacy_private_office_agent_appearance_v1()',
  ),
  'legacy appearance trigger helper is not caller-executable',
);

check(
  (migration.match(/CREATE OR REPLACE FUNCTION/g) || []).length >= 5
    && migration.includes('CREATE TABLE IF NOT EXISTS')
    && migration.includes('DO $office_user_preferences_policy_reset$')
    && migration.includes("WHERE policy.polrelid = 'public.office_user_preferences'::regclass")
    && migration.includes("'DROP POLICY %I ON public.office_user_preferences'")
    && migration.includes('CREATE POLICY office_user_preferences_select_own')
    && migration.includes('DO $legacy_appearance_archive_policy_reset$')
    && migration.includes("WHERE policy.polrelid = 'public.office_user_legacy_appearances'::regclass")
    && migration.includes("'DROP POLICY %I ON public.office_user_legacy_appearances'")
    && migration.includes('CREATE POLICY office_user_legacy_appearances_select_own')
    && migration.includes('DROP CONSTRAINT IF EXISTS office_user_preferences_document_valid'),
  'migration resets unknown policy inventory and safely reapplies exact owner-only policies',
);

console.log(`Office user preferences SQL smoke passed (${assertions} assertions).`);
