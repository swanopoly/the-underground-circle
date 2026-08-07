/**
 * Static security contract for the catalog-wide SECURITY DEFINER lockdown.
 *
 * Run: npx tsx scripts/security-definer-emergency-lockdown-smoketest.ts
 */

import { readFileSync } from 'node:fs';

const migrationPath =
  'supabase/migrations/20260806174500_security_definer_emergency_lockdown.sql';
const migration = readFileSync(migrationPath, 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = migration.indexOf(start);
  const endAt = migration.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `section starts: ${start}`);
  assert(endAt > startAt, `section ends: ${end}`);
  return migration.slice(startAt, endAt);
}

function functionSection(name: string, nextMarker: string): string {
  return section(`CREATE OR REPLACE FUNCTION public.${name}`, nextMarker);
}

console.log('Catalog-wide default deny');
assert(migration.includes('REVOKE CREATE ON SCHEMA public FROM PUBLIC'), 'PUBLIC cannot create search-path objects');
assert(migration.includes('REVOKE CREATE ON SCHEMA public FROM anon'), 'anon cannot create search-path objects');
assert(migration.includes('REVOKE CREATE ON SCHEMA public FROM authenticated'), 'authenticated cannot create search-path objects');
assert(migration.includes('DROP FUNCTION IF EXISTS public.bump_memory_access(uuid, uuid[])'), 'dead privileged memory helper is removed');

const catalogDefault = section(
  '-- Catalog-wide fail closed.',
  '-- Organization feature reads',
);
assert(catalogDefault.includes("namespace.nspname = 'public'"), 'catalog scan is limited to the public API schema');
assert(catalogDefault.includes('procedure.prosecdef IS TRUE'), 'catalog scan covers every SECURITY DEFINER function');
assert(
  catalogDefault.includes('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated'),
  'all browser execution is revoked before allowlisting',
);
assert(catalogDefault.includes('GRANT EXECUTE ON FUNCTION %s TO service_role'), 'trusted server execution is retained');

console.log('Authenticated allowlist');
const allowlistSection = section(
  '-- Audited authenticated RPC/RLS helper allowlist.',
  '-- The legacy and claimant-bound Office writers',
);
const allowlist = new Set(
  [...allowlistSection.matchAll(/'public\.([^']+)'/g)].map((match) => match[1]),
);
assert(allowlist.size === 56, 'authenticated allowlist has the reviewed 56 exact signatures');

const requiredAllowlist = [
  'can_access_check_in(uuid)',
  'can_access_reaction_target(uuid,uuid)',
  'can_list_circle_site_credentials(uuid)',
  'can_manage_circle_site_credentials(uuid)',
  'chat_thread_invitee_is_circle_member(uuid,uuid)',
  'check_org_feature(uuid,text)',
  'claim_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,jsonb,integer)',
  'create_private_chat_thread(uuid,text,text)',
  'create_prompt_version(uuid,text,jsonb,text[])',
  'current_user_created_circle(uuid)',
  'delete_circle_site_credential(uuid)',
  'delete_user_api_key(uuid)',
  'discover_public_circles(text,integer,integer)',
  'finish_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,uuid,text,jsonb)',
  'get_circle_integration_secret_values(uuid)',
  'get_circle_site_credential_secret(uuid,text)',
  'get_claude_usage_by_model(uuid,integer)',
  'get_claude_usage_by_model_lifetime(uuid)',
  'get_claude_usage_daily(uuid,integer)',
  'get_claude_usage_summary(uuid,integer)',
  'get_my_circle_ids()',
  'get_my_mention_unread_count()',
  'get_my_mentions(integer)',
  'get_my_org_ids()',
  'get_user_api_key(uuid,text,text)',
  'get_user_circles_fast(uuid)',
  'increment_agent_analytics(uuid,bigint,integer)',
  'invoke_agent(uuid,uuid,text,uuid)',
  'is_circle_member(uuid)',
  'is_circle_secret_manager(uuid,uuid)',
  'is_org_admin(uuid,uuid)',
  'is_org_member(uuid,uuid)',
  'is_org_owner(uuid,uuid)',
  'join_circle_by_invite_code(text)',
  'join_public_circle(uuid)',
  'list_circle_site_credential_access_log(uuid,uuid,integer)',
  'list_circle_integration_secret_keys(uuid)',
  'list_circle_site_credentials(uuid,text)',
  'list_user_api_keys()',
  'mark_my_mentions_seen()',
  'message_reply_matches_thread(uuid,uuid,uuid)',
  'message_thread_visible_to_current_user(uuid,uuid)',
  'public_circle_join_is_available(uuid)',
  'record_circle_site_credential_test_result(uuid,boolean,text,jsonb)',
  'save_circle_integration_secrets(uuid,jsonb)',
  'search_mention_candidates(uuid,text,integer)',
  'set_message_reaction(uuid,text,boolean)',
  'shares_circle_with_user(uuid)',
  'start_agent_action_call(uuid,uuid,uuid,text,text,text,text,text,text,uuid)',
  'store_circle_site_credential(uuid,text,text,text,text,text,jsonb,text,text,jsonb,timestamptz,timestamptz)',
  'store_user_api_key(text,text,text,text)',
  'sync_agent_token_snapshot(uuid,uuid,text,bigint,bigint,bigint,integer,numeric,text,text)',
  'task_image_path_authorized(text)',
  'update_circle_site_credential_controls(uuid,text,text,text,text,jsonb,jsonb,timestamptz,timestamptz,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)',
  'user_can_see_chat_thread(uuid)',
  'user_is_circle_member(uuid)',
];
for (const signature of requiredAllowlist) {
  assert(allowlist.has(signature), `allowlist includes ${signature}`);
}
assert(requiredAllowlist.length === allowlist.size, 'no unreviewed signature is hidden in the allowlist');
assert(allowlistSection.includes('pg_catalog.to_regprocedure(function_signature)'), 'missing historical functions are handled safely');
assert(allowlistSection.includes('SET search_path = pg_catalog, public, extensions'), 'allowlisted functions receive a fixed search path');
assert(
  allowlistSection.includes('SET search_path = pg_catalog, public, integration_secrets_private, extensions'),
  'integration secret RPCs retain their fixed private-schema search path',
);

const forbiddenAuthenticated = [
  'app_encryption_key()',
  'site_credential_encryption_key()',
  'site_credential_public_json(circle_site_credentials)',
  'circle_site_credential_public_json(circle_site_credentials)',
  'award_points(uuid,integer,text,jsonb)',
  'award_xp(uuid,integer,text,jsonb)',
  'get_relevant_knowledge(uuid,text,integer)',
  'get_user_circles(uuid)',
  'increment_builder_publication_views(text)',
  'invoke_agent(uuid,text,text)',
  'mark_message_done(uuid)',
  'run_due_automations()',
  'stream_response(uuid,text,text,bigint,integer,text,bigint,bigint,bigint,bigint)',
  'tick_memory_maintenance()',
];
for (const signature of forbiddenAuthenticated) {
  assert(!allowlist.has(signature), `${signature} is not unconditionally client executable`);
}

console.log('Rewritten tenant and mutation boundaries');
const orgFeature = functionSection('check_org_feature', '-- These RLS helpers');
assert(orgFeature.includes('caller_id uuid := auth.uid()'), 'org feature lookup derives the caller from JWT');
assert(orgFeature.includes('FROM public.org_members AS membership'), 'org feature lookup verifies membership');
assert(!orgFeature.includes('EXECUTE format'), 'org feature lookup has no caller-selected dynamic SQL');
assert(orgFeature.includes("'analytics_enabled'") && orgFeature.includes("'goal_alignment'"), 'org feature lookup uses an explicit boolean-feature allowlist');

for (const [name, next] of [
  ['is_org_member', 'CREATE OR REPLACE FUNCTION public.is_org_admin'],
  ['is_org_admin', 'CREATE OR REPLACE FUNCTION public.is_org_owner'],
  ['is_org_owner', '-- Usage aggregates previously'],
] as const) {
  const helper = functionSection(name, next);
  assert(helper.includes('target_user_id = auth.uid()'), `${name} binds browser lookups to the current user`);
  assert(helper.includes("auth.role() = 'service_role'"), `${name} reserves cross-user lookup for the trusted service role`);
  assert(helper.includes('SET search_path = pg_catalog, public'), `${name} has a fixed search path`);
}

const secretManager = functionSection('is_circle_secret_manager', '-- Usage aggregates previously');
assert(secretManager.includes('p_user_id uuid DEFAULT auth.uid()'), 'secret-manager helper defaults to the JWT subject');
assert(secretManager.includes('p_user_id = auth.uid()'), 'secret-manager helper rejects authenticated cross-user probes');
assert(secretManager.includes("auth.role() = 'service_role'"), 'secret-manager helper reserves cross-user checks for service role');
assert(secretManager.includes("membership.role IN ('creator', 'owner', 'admin', 'moderator')"), 'secret-manager helper keeps the reviewed privileged circle roles');
assert(secretManager.includes('SET search_path = pg_catalog, public'), 'secret-manager helper has a fixed search path');

for (const [name, next] of [
  ['get_claude_usage_summary', 'CREATE OR REPLACE FUNCTION public.get_claude_usage_by_model'],
  ['get_claude_usage_by_model', 'CREATE OR REPLACE FUNCTION public.get_claude_usage_daily'],
  ['get_claude_usage_daily', 'CREATE OR REPLACE FUNCTION public.get_claude_usage_by_model_lifetime'],
  ['get_claude_usage_by_model_lifetime', '-- Prompt versions are user-driven'],
] as const) {
  const usage = functionSection(name, next);
  assert(usage.includes('p_circle_id IS NOT NULL'), `${name} rejects the former NULL-all-circles path`);
  assert(usage.includes('auth.uid() IS NOT NULL'), `${name} requires an authenticated caller`);
  assert(usage.includes('FROM public.circle_members AS membership'), `${name} proves current circle membership`);
  assert(usage.includes('usage.circle_id = p_circle_id'), `${name} is scoped to the requested circle`);
  assert(usage.includes('SET search_path = pg_catalog, public'), `${name} has a fixed search path`);
}

const promptVersion = functionSection('create_prompt_version', '-- Mention candidate search');
assert(promptVersion.includes('caller_id uuid := auth.uid()'), 'prompt version mutation derives caller identity');
assert(promptVersion.includes('prompt.owner_id = caller_id'), 'prompt version mutation verifies ownership');
assert(promptVersion.includes('FOR UPDATE'), 'prompt version allocation is serialized');
assert(promptVersion.includes('pg_catalog.length(p_content) > 1000000'), 'prompt content is size bounded');
assert(promptVersion.includes('pg_catalog.cardinality') && promptVersion.includes('> 100'), 'prompt variables are count bounded');
assert(!promptVersion.includes('created_by'), 'prompt version insert matches the deployed schema without created_by');
assert(!promptVersion.includes('updated_by'), 'prompt label upsert matches the deployed schema without updated_by');

const mentionSearch = functionSection('search_mention_candidates', '-- This helper participates');
assert(mentionSearch.includes('caller_id uuid := auth.uid()'), 'mention search derives caller identity');
assert(mentionSearch.includes('membership.user_id = caller_id'), 'mention search requires circle membership');
assert(mentionSearch.includes('80') && mentionSearch.includes('20'), 'mention query and result size are bounded');
assert(mentionSearch.includes('pg_catalog.strpos'), 'mention query is literal substring search, not a wildcard program');

const replyHelper = functionSection('message_reply_matches_thread', '-- Compatibility helper');
assert(replyHelper.includes('auth.uid() IS NOT NULL'), 'reply helper requires authentication');
assert(replyHelper.includes('public.message_thread_visible_to_current_user'), 'reply helper proves thread visibility before owner-rights lookup');

const analytics = functionSection('increment_agent_analytics', 'REVOKE ALL ON FUNCTION public.increment_agent_analytics');
assert(analytics.includes('caller_id uuid := auth.uid()'), 'analytics mutation derives caller identity');
assert(analytics.includes('agent.owner_id = caller_id'), 'analytics mutation binds the agent to its owner');
assert(analytics.includes('membership.user_id = caller_id'), 'analytics mutation proves current circle membership');
assert(analytics.includes('p_tokens > 1000000000') && analytics.includes('p_latency_ms > 86400000'), 'analytics numeric mutations are bounded');

console.log('Secret and legacy writer boundaries');
const compatibility = functionSection('circle_site_credential_public_json', '-- Never expose encryption material');
assert(compatibility.includes('SECURITY INVOKER'), 'credential serializer compatibility helper does not elevate its caller');
assert(compatibility.includes('public.site_credential_public_json(credential)'), 'compatibility helper delegates to the hardened serializer');
assert(migration.includes('FROM PUBLIC, anon, authenticated;'), 'compatibility helper is not browser executable');

for (const signature of [
  'site_credential_encryption_key()',
  'run_due_automations()',
  'award_points(uuid, integer, text, jsonb)',
  'award_xp(uuid, integer, text, jsonb)',
]) {
  assert(migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM authenticated`), `${signature} is explicitly server-only`);
  assert(migration.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role`), `${signature} retains trusted server execution`);
}

const officeConditional = section(
  '-- The legacy and claimant-bound Office writers',
  'COMMENT ON FUNCTION public.site_credential_encryption_key',
);
assert(officeConditional.includes("function_result = 'boolean'"), 'Office writer restoration requires the claimant-bound boolean contract');
assert(officeConditional.includes("pg_catalog.strpos(function_source, 'auth.uid()') > 0"), 'Office writer restoration requires JWT binding');
assert(officeConditional.includes("pg_catalog.strpos(function_source, 'claimant_user_id') > 0"), 'Office writer restoration requires claimant ownership');
assert(officeConditional.includes("'public.stream_response("), 'stream writer is conditionally reviewed');
assert(officeConditional.includes("'public.mark_message_done(uuid)'"), 'completion writer is conditionally reviewed');

assert(migration.includes("NOTIFY pgrst, 'reload schema'"), 'PostgREST refreshes the RPC privilege cache');
assert(migration.includes('BEGIN;') && migration.includes('COMMIT;'), 'lockdown is atomic');

console.log(`\nsecurity-definer-emergency-lockdown-smoketest: ${assertions} assertions passed.`);
