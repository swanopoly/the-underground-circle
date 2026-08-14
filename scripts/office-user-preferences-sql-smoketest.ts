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

const scrubStart = migration.indexOf('DO $legacy_telegram_scrub$');
const scrubEnd = migration.indexOf('$legacy_telegram_scrub$;', scrubStart + 4);
const scrubBody = migration.slice(scrubStart, scrubEnd);
check(scrubStart >= 0 && scrubEnd > scrubStart, 'legacy scrub has a bounded idempotent block');
check(!scrubBody.includes('RETURNING') && !scrubBody.includes('SELECT office_preferences'), 'legacy scrub never projects credential values');
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
    && migration.includes('DROP POLICY IF EXISTS office_user_preferences_select_own')
    && migration.includes('DROP CONSTRAINT IF EXISTS office_user_preferences_document_valid'),
  'migration is safe to reapply',
);

console.log(`Office user preferences SQL smoke passed (${assertions} assertions).`);
