/**
 * Static contract for app-owned public function search-path hardening.
 *
 * Run: npx tsx scripts/public-function-search-path-security-smoketest.ts
 */

import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260806180000_public_function_search_path_hardening.sql';
const sql = readFileSync(migrationPath, 'utf8');

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`public function search-path smoke failed: ${message}`);
}

const expectedSignatures = [
  'public.add_creator_as_member()',
  'public.agent_plan_mode_touch_updated_at()',
  'public.chat_checkpoints_enforce_immutable()',
  'public.cleanup_old_agent_activity()',
  'public.cleanup_old_office_terminal_messages()',
  'public.consolidate_memories_runner_url()',
  'public.get_memory_citations(uuid)',
  'public.increment_builder_publication_views(text)',
  'public.match_codebase_files(public.vector,text,double precision,integer)',
  'public.match_memories(public.vector,uuid,double precision,integer,text)',
  'public.match_second_brain_notes(public.vector,uuid,double precision,integer)',
  'public.memory_embed_backfill_url()',
  'public.purge_old_claude_api_usage()',
  'public.record_memory_edit(uuid,text,text,text)',
  'public.research_daily_runner_url()',
  'public.scheduled_actions_touch()',
  'public.snapshot_mission_revision()',
  'public.soul_wisdom_runner_url()',
  'public.sweep_offline_agents()',
  'public.sync_org_features()',
  'public.tick_consolidate_memories()',
  'public.tick_memory_embed_backfill()',
  'public.tick_research_daily_runner(text)',
  'public.tick_soul_wisdom()',
  'public.tick_watch_scheduler()',
  'public.touch_agent_identities_updated_at()',
  'public.touch_mission_streaks_updated_at()',
  'public.update_agent_run_budgets_updated_at()',
  'public.update_mission_updated_at()',
  'public.update_parent_goal_progress()',
  'public.update_proof_validation_counts()',
  'public.update_trading_bot_configs_updated_at()',
  'public.update_trading_bot_holdings_updated_at()',
  'public.update_trading_bot_wallets_updated_at()',
  'public.validate_office_layout()',
  'public.watch_scheduler_url()',
] as const;

const configuredSignatures = [...sql.matchAll(/^\s*'(public\.[^']+\([^']*\))',?\s*$/gm)].map(
  (match) => match[1],
);
const configuredSet = new Set(configuredSignatures);

check(expectedSignatures.length === 36, 'reviewed signature inventory remains exactly 36');
check(configuredSignatures.length === 36, 'migration contains exactly 36 exact identities');
check(configuredSet.size === configuredSignatures.length, 'migration contains no duplicate identities');
for (const signature of expectedSignatures) {
  check(configuredSet.has(signature), `migration includes ${signature}`);
}
check(
  configuredSignatures.every((signature) => /^public\.[a-z0-9_]+\([^)]*\)$/.test(signature)),
  'every target is an exact public-schema function identity',
);
check(
  configuredSignatures.every((signature) => !/(?:^|\.)(?:vector_|gin_|gtrgm_|set_limit|show_limit)/i.test(signature)),
  'extension-owned pgvector and pg_trgm routines are excluded',
);

check(sql.includes('BEGIN;') && sql.includes('COMMIT;'), 'migration is atomic');
check(
  sql.includes("pg_catalog.set_config(\n    'search_path',\n    'pg_catalog, public, extensions',\n    true"),
  'migration resolves identities with the fixed trusted path',
);
check(
  sql.includes("pg_catalog.to_regtype('public.vector') IS NULL"),
  'pgvector-dependent app functions tolerate a baseline without the type',
);
check(
  sql.includes('target_function := pg_catalog.to_regprocedure(function_signature);'),
  'every exact identity is resolved with to_regprocedure',
);
check(sql.includes('IF target_function IS NULL THEN'), 'missing historical functions are skipped');
check(
  sql.includes("'ALTER FUNCTION %s SET search_path TO pg_catalog, public, extensions'"),
  'functions receive the exact fixed search path',
);
check(
  (sql.match(/\bALTER\s+FUNCTION\b/gi) ?? []).length === 1,
  'one metadata-only alter template owns all changes',
);

for (const forbidden of [
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
  /\bDROP\s+FUNCTION\b/i,
  /\b(?:GRANT|REVOKE)\b/i,
  /\bALTER\s+FUNCTION\b[^;]*\bOWNER\s+TO\b/i,
  /\bSECURITY\s+(?:DEFINER|INVOKER)\b/i,
]) {
  check(!forbidden.test(sql), `migration avoids ${forbidden.source}`);
}

console.log(`public function search-path smoke passed (${assertions} assertions)`);
