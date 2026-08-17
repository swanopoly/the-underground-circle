/** Static and byte-exact SQL contract for circle-global idle-behavior claims. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20260817120000_circle_idle_behavior_claims.sql'),
  'utf8',
);
const officePreferencesMigration = readFileSync(
  resolve(root, 'supabase/migrations/20260813220000_office_user_preferences.sql'),
  'utf8',
);
const consolidated = readFileSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

const behaviorIds = [
  'streak_guardian',
  'stale_task_detector',
  'circle_pulse_monitor',
  'knowledge_curator',
  'memory_digest',
  'morning_briefing',
  'weekly_retro',
  'goal_pace_tracker',
  'codebase_scanner',
  'dependency_health',
  'cost_efficiency_report',
] as const;

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

for (const marker of [
  'CREATE TABLE IF NOT EXISTS public.circle_idle_behavior_claims',
  'PRIMARY KEY (circle_id, behavior_id)',
  'ALTER TABLE public.circle_idle_behavior_claims ENABLE ROW LEVEL SECURITY',
  'ALTER TABLE public.circle_idle_behavior_claims FORCE ROW LEVEL SECURITY',
  'REVOKE ALL ON TABLE public.circle_idle_behavior_claims',
  'FROM PUBLIC, anon, authenticated, service_role',
  'CREATE OR REPLACE FUNCTION public.claim_idle_behavior_run_v1(\n  p_circle_id uuid,\n  p_behavior_id text,\n  p_cooldown_minutes integer\n)',
  'RETURNS jsonb',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog, public',
  'v_actor_id uuid := auth.uid()',
  "RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'",
  'FROM public.circle_members AS membership',
  'membership.circle_id = p_circle_id',
  'membership.user_id = v_actor_id',
  'FOR KEY SHARE',
  "RAISE EXCEPTION 'circle_membership_required' USING ERRCODE = '42501'",
  'p_cooldown_minutes NOT BETWEEN 1 AND 10080',
  'greatest(p_cooldown_minutes, 1440)',
  'v_server_now := clock_timestamp()',
  'INSERT INTO public.circle_idle_behavior_claims AS current_claim',
  'ON CONFLICT (circle_id, behavior_id) DO UPDATE',
  'WHERE current_claim.next_eligible_at <= EXCLUDED.claimed_at',
  'RETURNING current_claim.claimed_at, current_claim.next_eligible_at',
  'GET DIAGNOSTICS v_affected_rows = ROW_COUNT',
  'SELECT claim.claimed_at, claim.next_eligible_at',
  "'schemaVersion', 1",
  "'claimed', v_claimed",
  "'behaviorId', p_behavior_id",
  "'effectiveCooldownMinutes', v_effective_cooldown_minutes",
  "'claimedAt', to_jsonb(v_claimed_at)",
  "'nextEligibleAt', to_jsonb(v_next_eligible_at)",
  'REVOKE ALL ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)',
  'GRANT EXECUTE ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)\n  TO authenticated',
]) {
  check(migration.includes(marker), `migration pins ${marker}`);
}
assertions += 1;
assert.equal(
  (migration.match(/RAISE EXCEPTION 'idle_behavior_cooldown_out_of_bounds'/gu) || []).length,
  1,
  'cooldown validation raises its exact error once',
);

const tableAllowlistStart = migration.indexOf('    behavior_id IN (');
const tableAllowlistEnd = migration.indexOf('\n    )\n  );', tableAllowlistStart);
const functionAllowlistStart = migration.indexOf('p_behavior_id NOT IN (');
const functionAllowlistEnd = migration.indexOf('\n  ) THEN', functionAllowlistStart);
check(
  tableAllowlistStart >= 0
    && tableAllowlistEnd > tableAllowlistStart
    && functionAllowlistStart >= 0
    && functionAllowlistEnd > functionAllowlistStart,
  'table and RPC allowlists have bounded source regions',
);
const quotedIds = (text: string): string[] =>
  Array.from(text.matchAll(/'([a-z][a-z0-9_]*)'/gu), (match) => match[1]);
assertions += 2;
assert.deepEqual(
  quotedIds(migration.slice(tableAllowlistStart, tableAllowlistEnd)),
  behaviorIds,
  'table constraint exactly matches the idle behavior catalog',
);
assert.deepEqual(
  quotedIds(migration.slice(functionAllowlistStart, functionAllowlistEnd)),
  behaviorIds,
  'RPC input allowlist exactly matches the idle behavior catalog',
);

const sharedChatFloorIds = [
  'streak_guardian',
  'circle_pulse_monitor',
  'morning_briefing',
  'weekly_retro',
  'goal_pace_tracker',
] as const;
const sharedFloorStart = migration.indexOf('WHEN p_behavior_id IN (');
const sharedFloorEnd = migration.indexOf('\n    )\n      THEN greatest', sharedFloorStart);
check(
  sharedFloorStart >= 0 && sharedFloorEnd > sharedFloorStart,
  'shared-Chat cooldown floor has a bounded source region',
);
assertions += 1;
assert.deepEqual(
  quotedIds(migration.slice(sharedFloorStart, sharedFloorEnd)),
  sharedChatFloorIds,
  'all and only shared-Chat behavior ids receive the 1,440-minute server floor',
);

const validatorStartMarker =
  'CREATE OR REPLACE FUNCTION public.validate_office_user_preferences_v1(';
const validatorEndMarker =
  'REVOKE ALL ON FUNCTION public.validate_office_user_preferences_v1(jsonb)\n'
  + '  FROM PUBLIC, anon, authenticated, service_role;\n';
function extractValidatorContract(sql: string, label: string): string {
  const start = sql.indexOf(validatorStartMarker);
  const revokeStart = sql.indexOf(validatorEndMarker, start);
  check(start >= 0 && revokeStart > start, `${label} has the full validator and revoke contract`);
  return sql.slice(start, revokeStart + validatorEndMarker.length);
}
const canonicalValidatorContract = extractValidatorContract(
  officePreferencesMigration,
  '§45 migration',
);
const forwardValidatorContract = extractValidatorContract(migration, '§46 migration');
assertions += 1;
assert.equal(
  forwardValidatorContract,
  canonicalValidatorContract,
  '§46 forward repair is byte-identical to the current §45 validator contract',
);
check(
  migration.indexOf(validatorStartMarker)
    < migration.indexOf('CREATE TABLE IF NOT EXISTS public.circle_idle_behavior_claims'),
  'preference validator repair runs before claim-table setup',
);
check(
  forwardValidatorContract.includes(
    "WHERE idle_key NOT IN ('masterEnabled', 'behaviors', 'sharedChatOptIn')",
  )
    && forwardValidatorContract.includes(
      "jsonb_typeof(preference_entry.value -> 'sharedChatOptIn') <> 'boolean'",
    ),
  'forward validator accepts only the optional boolean sharedChatOptIn field',
);
check(
  !forwardValidatorContract.includes('FROM public.office_user_preferences')
    && !forwardValidatorContract.includes('UPDATE public.office_user_preferences')
    && !forwardValidatorContract.includes('INSERT INTO public.office_user_preferences'),
  'forward validator repair does not require the §45 table to exist',
);

const functionStart = migration.indexOf(
  'CREATE OR REPLACE FUNCTION public.claim_idle_behavior_run_v1(',
);
const functionEnd = migration.indexOf(
  'REVOKE ALL ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)',
);
const functionBody = migration.slice(functionStart, functionEnd);
const membershipStart = functionBody.indexOf('FROM public.circle_members AS membership');
const serverClockStart = functionBody.indexOf('v_server_now := clock_timestamp()');
const upsertStart = functionBody.indexOf(
  'INSERT INTO public.circle_idle_behavior_claims AS current_claim',
);
const conflictStart = functionBody.indexOf(
  'ON CONFLICT (circle_id, behavior_id) DO UPDATE',
  upsertStart,
);
const conditionalUpdateStart = functionBody.indexOf(
  'WHERE current_claim.next_eligible_at <= EXCLUDED.claimed_at',
  conflictStart,
);
const deniedReadStart = functionBody.indexOf(
  'FROM public.circle_idle_behavior_claims AS claim',
  conditionalUpdateStart,
);
const receiptStart = functionBody.lastIndexOf('RETURN jsonb_build_object(');
check(
  functionStart >= 0
    && functionEnd > functionStart
    && membershipStart >= 0
    && serverClockStart > membershipStart
    && upsertStart > serverClockStart
    && conflictStart > upsertStart
    && conditionalUpdateStart > conflictStart
    && deniedReadStart > conditionalUpdateStart
    && receiptStart > deniedReadStart,
  'membership, server clock, atomic reservation, denied receipt read, and receipt stay ordered',
);
check(
  !functionBody.slice(0, upsertStart).includes('FROM public.circle_idle_behavior_claims'),
  'eligibility is never decided by a race-prone read before the UPSERT',
);
check(
  functionBody.includes(
    'v_server_now + make_interval(mins => v_effective_cooldown_minutes)',
  )
    && !functionBody.includes('p_claimed_at')
    && !functionBody.includes('p_next_eligible_at'),
  'reservation timestamps and expiry derive only from the server clock',
);
check(
  functionBody.includes('v_claimed := v_affected_rows = 1')
    && functionBody.indexOf('v_claimed := v_affected_rows = 1') > conditionalUpdateStart,
  'claimed=true is derived from the conditional write result',
);
const deniedClaimStart = functionBody.indexOf('IF NOT v_claimed THEN');
const deniedClaimEnd = functionBody.indexOf('\n  END IF;\n\n  RETURN', deniedClaimStart);
const deniedClaimBody = functionBody.slice(deniedClaimStart, deniedClaimEnd);
check(
  deniedClaimBody.includes(
    'ceil(extract(epoch FROM (v_next_eligible_at - v_claimed_at)) / 60)::integer',
  )
    && deniedClaimBody.includes('greatest(\n      1,')
    && deniedClaimBody.includes('least(\n        10080,'),
  'denied receipts derive bounded integer cooldown minutes from the stored reservation',
);
check(
  deniedClaimBody.indexOf('SELECT claim.claimed_at, claim.next_eligible_at')
    < deniedClaimBody.indexOf('v_effective_cooldown_minutes := greatest('),
  'denied receipt cooldown is derived only after loading stored timestamps',
);

const receiptEnd = functionBody.indexOf('\n  );', receiptStart);
const receiptKeys = Array.from(
  functionBody.slice(receiptStart, receiptEnd).matchAll(/\n\s+'([^']+)',/gu),
  (match) => match[1],
);
assertions += 1;
assert.deepEqual(
  receiptKeys,
  [
    'schemaVersion',
    'claimed',
    'behaviorId',
    'effectiveCooldownMinutes',
    'claimedAt',
    'nextEligibleAt',
  ],
  'RPC receipt exposes exactly the confirmed runtime keys',
);

check(
  migration.includes("next_eligible_at <= claimed_at + interval '7 days'")
    && migration.includes('next_eligible_at > claimed_at'),
  'stored cooldown windows are positive and bounded to the catalog maximum',
);
check(
  !/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[\s\S]*?ON TABLE public\.circle_idle_behavior_claims[\s\S]*?TO authenticated/iu.test(
    migration,
  ),
  'authenticated has no direct table access',
);
check(!migration.includes('CREATE POLICY'), 'claim rows expose no direct RLS policy');
check(
  (migration.match(/GRANT EXECUTE ON FUNCTION public\.claim_idle_behavior_run_v1/gu) || [])
    .length === 1
    && !/GRANT EXECUTE[\s\S]*?claim_idle_behavior_run_v1[\s\S]*?TO (?:PUBLIC|anon|service_role)/iu.test(
      migration,
    ),
  'authenticated is the RPC sole grantee',
);
check(
  migration.includes('DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_behavior_id_valid')
    && migration.includes('DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_window_valid')
    && migration.includes('CREATE OR REPLACE FUNCTION'),
  'migration is safe to reapply',
);

const header = '-- BEGIN SECTION 46: Circle-global idle-behavior claims';
const source = '-- Source: supabase/migrations/20260817120000_circle_idle_behavior_claims.sql';
const footer = '-- END SECTION 46: Circle-global idle-behavior claims';
const prefix = `${header}\n${source}\n`;
const sectionStart = consolidated.indexOf(prefix);
const sectionEnd = consolidated.indexOf(footer, sectionStart + prefix.length);
check(sectionStart >= 0 && sectionEnd > sectionStart, '§46 has exact BEGIN, Source, and END boundaries');
const consolidatedSectionBody = consolidated.slice(sectionStart + prefix.length, sectionEnd);
assertions += 1;
assert.equal(
  consolidatedSectionBody,
  migration,
  '§46 executable body is byte-exact with the canonical migration',
);
assertions += 1;
assert.equal(
  (consolidatedSectionBody.match(
    /RAISE EXCEPTION 'idle_behavior_cooldown_out_of_bounds'/gu,
  ) || []).length,
  1,
  'consolidated §46 raises the cooldown error exactly once',
);
for (const marker of [header, source, footer]) {
  assertions += 1;
  assert.equal(
    consolidated.indexOf(marker, consolidated.indexOf(marker) + marker.length),
    -1,
    `${marker} appears exactly once`,
  );
}
check(
  /^\s*$/u.test(consolidated.slice(sectionEnd + footer.length)),
  '§46 is the closed executable tail of consolidated SQL',
);
check(
  consolidated.includes('--   §46 Circle-global idle-behavior claims'),
  'consolidated contents index records §46',
);

const scriptName = 'smoke:circle-idle-behavior-claims-sql';
const behaviorScriptName = 'smoke:circle-idle-behavior-claims-sql-behavior';
assertions += 1;
assert.equal(
  packageJson.scripts?.[scriptName],
  'npx tsx scripts/circle-idle-behavior-claims-sql-smoketest.ts',
  `package exposes ${scriptName}`,
);
check(
  (packageJson.scripts?.['check:office-addons'] || '').includes(`npm run ${scriptName}`),
  `check:office-addons includes ${scriptName}`,
);
assertions += 1;
assert.equal(
  packageJson.scripts?.[behaviorScriptName],
  'sh scripts/circle-idle-behavior-claims-sql-behavior-smoketest.sh',
  `package exposes ${behaviorScriptName}`,
);
check(
  !(packageJson.scripts?.['check:office-addons'] || '').includes(
    `npm run ${behaviorScriptName}`,
  ),
  `check:office-addons excludes local-PostgreSQL ${behaviorScriptName}`,
);

console.log(`Circle idle-behavior claims SQL smoke passed (${assertions} assertions).`);
