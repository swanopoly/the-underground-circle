import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260821120000_tenant_isolation_convergence.sql',
);
const consolidatedPath = path.join(root, 'docs/RUN_THIS_SQL.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const consolidated = fs.readFileSync(consolidatedPath, 'utf8');

let assertions = 0;
function check(value: unknown, label: string): asserts value {
  assertions += 1;
  if (!value) throw new Error(`tenant isolation SQL smoke failed: ${label}`);
}

function has(fragment: string, label: string) {
  check(sql.includes(fragment), label);
}

check((sql.match(/\bBEGIN;/g) || []).length === 1, 'one atomic BEGIN');
check((sql.match(/\bCOMMIT;/g) || []).length === 1, 'one atomic COMMIT');
check(sql.indexOf('BEGIN;') < sql.indexOf('COMMIT;'), 'transaction ordering');

has('current_user_is_exact_circle_member_v1', 'fixed exact Circle helper');
has('SET search_path = pg_catalog, public', 'fixed helper search paths');
has('circles_exact_member_select_v1', 'departed creator raw Circle read removed');
has('USING (public.current_user_is_exact_circle_member_v1(id));', 'Circle SELECT is membership-only');
for (const secretColumn of ['api_key', 'discord_bot_token', 'discord_webhook_url']) {
  has(`'public.circles.${secretColumn}'`, `Circle ${secretColumn} is preflighted`);
}
has('REVOKE SELECT ON TABLE public.circles FROM authenticated;', 'authenticated raw Circle star reads are removed');
has('DO $revoke_circle_column_selects$', 'all historical Circle column SELECT grants are removed');
has('CREATE OR REPLACE FUNCTION public.get_circle_capability_secrets_v1(', 'creator-bound Circle secret RPC exists');
has('AND circle.created_by = auth.uid()', 'Circle secret RPC is exact creator-bound');
has('AND public.current_user_is_exact_circle_member_v1(circle.id)', 'departed Circle creator cannot read secrets');
has('AS circle_member_secret_columns_denied', 'readiness receipt proves Circle secret columns denied');
has('AS circle_creator_secret_rpc_present', 'readiness receipt proves Circle secret RPC present');
const circleSafeGrantStart = sql.indexOf('GRANT SELECT (\n  id,\n  name,\n  description,');
const circleSafeGrantEnd = sql.indexOf(') ON TABLE public.circles TO authenticated;', circleSafeGrantStart);
check(circleSafeGrantStart >= 0 && circleSafeGrantEnd > circleSafeGrantStart, 'bounded Circle member column grant exists');
const circleSafeGrant = sql.slice(circleSafeGrantStart, circleSafeGrantEnd);
for (const secretColumn of ['api_key', 'discord_bot_token', 'discord_webhook_url']) {
  check(!circleSafeGrant.includes(secretColumn), `bounded Circle member grant excludes ${secretColumn}`);
}
has('NULL::text AS circle_image_url', 'public discovery redacts private image URL');
has('exact_current_circle_member_guard_v1', 'catalog-wide restrictive Circle guard');
has('AS RESTRICTIVE', 'restrictive policy semantics are used');
has('current_user_is_exact_room_member_v1', 'nested Room membership helper');
has('current_user_is_exact_task_member_v1', 'nested task membership helper');
has('current_user_is_exact_mission_member_v1', 'nested mission membership helper');
has('circle_integration_secrets_exact_member_guard_v1', 'nested integration-secret guard');
has("IF secret_relkind IN ('r', 'p') THEN", 'legacy integration-secret tables receive RLS');
has("ELSIF secret_relkind = 'v' THEN", '§40 integration-secret view is handled explicitly');
has('FROM PUBLIC, anon, authenticated, service_role;', 'integration-secret view grants are reset before service-only access');
has('GRANT SELECT ON TABLE public.circle_integration_secrets TO service_role;', 'integration-secret compatibility view remains service-readable');
has("'public.circle_github_connections'", 'GitHub connection table is preflighted');
has("'public.circle_github_connections.webhook_secret'", 'GitHub webhook secret column is preflighted');
has('DO $revoke_github_connection_column_selects$', 'all historical GitHub connection column SELECT grants are removed');
has('REVOKE SELECT ON TABLE public.circle_github_connections\n  FROM PUBLIC, anon, authenticated;', 'browser raw GitHub connection star reads are removed');
has('GRANT ALL ON TABLE public.circle_github_connections TO service_role;', 'webhook service retains verification authority');
has('AS github_webhook_secret_browser_denied', 'readiness receipt proves GitHub webhook secret denial');
const githubSafeGrantStart = sql.indexOf('GRANT SELECT (\n  id,\n  circle_id,\n  connected_by,');
const githubSafeGrantEnd = sql.indexOf(') ON TABLE public.circle_github_connections TO authenticated;', githubSafeGrantStart);
check(githubSafeGrantStart >= 0 && githubSafeGrantEnd > githubSafeGrantStart, 'bounded GitHub connection member grant exists');
check(!sql.slice(githubSafeGrantStart, githubSafeGrantEnd).includes('webhook_secret'), 'bounded GitHub connection grant excludes webhook_secret');
has("'realtime.messages'", 'Realtime authorization table is preflighted');
has("to_regprocedure('realtime.topic()')", 'Realtime topic helper is preflighted');
has("'office-terminal-cmd-%'", 'Office terminal command topics are protected');
has("'office-terminal-resp-%'", 'Office terminal response topics are protected');
has("'circle-presence-%'", 'Circle presence topics are protected');
has('office_realtime_exact_select_v1', 'exact member Realtime SELECT policy');
has('office_realtime_exact_insert_v1', 'exact member Realtime INSERT policy');
has('office_realtime_prefix_select_guard_v1', 'Realtime SELECT prefix restrictive guard');
has('office_realtime_prefix_insert_guard_v1', 'Realtime INSERT prefix restrictive guard');
has('NOT public.office_realtime_topic_is_protected_v1(realtime.topic())', 'unrelated private Realtime topics remain policy-independent');
has('AS office_realtime_authorization_present', 'readiness receipt covers Office Realtime authorization');
has('disable Realtime "Allow public access"', 'Realtime project-level public access disablement is an explicit prerequisite');
has('SQL\n-- policies cannot change or prove that project-level switch', 'SQL does not claim to mutate the Realtime project setting');
has('Hosted Supabase owns storage.objects through supabase_storage_admin', 'migration respects hosted Storage table ownership');
check(!sql.includes('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'), 'migration does not ALTER the platform-owned Storage table');
has('Hosted Supabase owns realtime.messages through supabase_realtime_admin', 'migration respects hosted Realtime table ownership');
check(!sql.includes('ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;'), 'migration does not ALTER the platform-owned Realtime table');
has('direct_messages_exact_participant_select_guard_v1', 'direct-message participant guard');
has('profiles_self_select_v1', 'raw profiles are self-only');
has('profiles_self_update_v1', 'raw profile updates are self-only');
has('users_share_current_circle_v1', 'safe profile peer scope is exact shared Circle');
has('WITH (security_barrier = true)', 'safe_profiles is a bounded default-definer view');
has("ALTER VIEW public.safe_profiles SET (security_invoker = false)", 'PG15 safe_profiles clears the historical invoker mode');
has('CASE WHEN profile.id = auth.uid() THEN profile.wallet_address ELSE NULL END', 'peer wallet address is redacted');
has('CASE WHEN profile.id = auth.uid() THEN profile.wallet_chain ELSE NULL END', 'peer wallet chain is redacted');
has('REVOKE ALL ON TABLE public.safe_profiles FROM PUBLIC, anon;', 'safe profile view is authenticated-only');
has('featured_trades_owner_select_v1', 'featured trades are owner-only');
has('featured_trade_executions_owner_select_v1', 'trade executions are owner-only');
has('spirit_learnings_owner_select_v1', 'Spirit trade learnings are owner-only');
check(!sql.includes('featured_trades_select_authenticated'), 'authenticated-wide featured trade policy is absent');
has('user_points_current_circle_select_v1', 'points peer reads require a current shared Circle');
has('user_badges_current_circle_select_v1', 'badge peer reads require a current shared Circle');
has('user_xp_current_circle_select_v1', 'XP peer reads require a current shared Circle');
has('USING (public.users_share_current_circle_v1(user_id));', 'XP peer scope uses canonical user_id');
has('user_points_self_update_v1', 'points writes remain self-bound');
has('user_badges_self_update_v1', 'badge writes remain self-bound');
has('user_xp_self_update_v1', 'XP writes remain self-bound');
has('WITH CHECK (user_id = auth.uid());', 'XP writes use canonical user_id');
has('DROP POLICY %I ON public.research_agent_runs', 'all historical research-run policies are removed');
has('REVOKE ALL ON TABLE public.research_agent_runs\n  FROM PUBLIC, anon, authenticated;', 'research-run audit is hidden from browsers');
has('GRANT ALL ON TABLE public.research_agent_runs TO service_role;', 'research-run audit remains service-operable');
check(!sql.includes('research_agent_runs_select'), 'authenticated-wide research-run policy is absent');
has('AS raw_profiles_force_rls', 'readiness receipt covers raw profiles');
has('AS safe_profiles_projection_present', 'readiness receipt covers safe profiles');
has('AS personal_trading_force_rls', 'readiness receipt covers personal trading');
has('AS peer_gamification_force_rls', 'readiness receipt covers peer gamification');
has('AS research_runs_force_rls', 'readiness receipt covers research audit');

for (const table of ['integrations', 'user_site_credentials', 'agent_connect_tokens']) {
  has(`'${table}'`, `${table} is in the personal credential convergence set`);
}
has("'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY'", 'credential convergence forces RLS dynamically');
has('user_api_keys_exact_owner_guard_v1', 'API key owner restrictive guard');
has('service_only_authenticated_deny_guard_v1', 'OAuth tables deny browser rows');
has('agent_connect_tokens_owner_select_v1', 'connect tokens owner read');
has('agent_connect_tokens_owner_insert_v1', 'connect tokens owner/member create');
has('GRANT SELECT, INSERT, DELETE ON TABLE public.agent_connect_tokens TO authenticated;', 'connect token client cannot update scope');
has('Legacy plaintext one-time connect token', 'plaintext token debt is explicit');

has('ADD COLUMN IF NOT EXISTS chat_thread_id uuid;', 'canonical plan/checkpoint UUID columns');
has('agent_plans_chat_thread_circle_fk_v1', 'plan exact Circle/thread FK');
has('agent_plan_thread_scope_is_ambiguous', 'ambiguous UUID-looking plans fail closed');
has("WHEN pg_catalog.btrim(COALESCE(p_legacy_thread_id, '')) = '' THEN true", 'legacy null plan remains Circle-wide');
has('agent_plan_child_scope_visible_v1', 'plan children inherit exact thread scope');
has('chat_checkpoints_chat_thread_circle_fk_v1', 'checkpoint exact Circle/thread FK');
has('chat_thread_id IS NOT NULL\n  AND public.message_thread_visible_to_current_user', 'checkpoint null lineage fails closed');
has('NEW.chat_thread_id IS DISTINCT FROM OLD.chat_thread_id', 'checkpoint scope is immutable');

has('computer_use_schedules_owner_scope_select_v1', 'watch rows owner-only');
has('guard_computer_schedule_claim_scope_v1', 'watch claim rechecks captured authority');
has('computer_schedule_claim_authority_revoked', 'watch claim revocation is terminal');
has('scheduled_actions_owner_scope_select_v1', 'raw scheduled-action payload owner-only');
has('guard_scheduled_action_dispatch_scope_v1', 'dispatch rechecks captured owner membership');
has('scheduled_action_dispatch_authority_revoked', 'dispatch revocation is terminal');

has('guard_connection_target_binding_v1', 'Slack/Teams commit-time target guard');
has('connection_targets_authorized_for_user_v1', 'every connection target is authorized');
has('circle.org_id = p_org_id', 'combined org/Circle connection proves same org');
has('slack_connections_exact_target_guard_v1', 'Slack restrictive target RLS');
has('teams_connections_exact_target_guard_v1', 'Teams restrictive target RLS');

has('reports_creator_exact_scope_select_v1', 'report rows creator-only/exact-scope');
has('report_circle_scope_authorized_v1', 'report Circle-set membership helper');
has("status = 'pending'", 'pending report bootstrap is explicit');
has('GRANT SELECT, INSERT, DELETE ON TABLE public.reports TO authenticated;', 'browser cannot update reports');

for (const bucket of ['task-images', 'room-files', 'circle-images', 'reports']) {
  check(
    new RegExp(`'${bucket}'[\\s\\S]{0,160}false`).test(sql),
    `${bucket} is converged private`,
  );
}
has("<task UUID>/<single filename>", 'task image path contract documented');
has("rooms/<circle_rooms UUID>/<single filename>", 'room file path contract documented');
has("circles/<Circle UUID>/icon.<safe image extension>", 'Circle image path contract documented');
has('tenant_task_images_member_select_v1', 'task image exact member read');
has('tenant_room_files_member_select_v1', 'room file exact member read');
has('tenant_circle_images_member_select_v1', 'Circle image exact member read');
has('tenant_private_storage_authenticated_update_guard_v1', 'private bucket UPDATE guard');
has("WHEN 'reports' THEN false", 'authenticated report object reads/writes denied');
has('tenant_private_storage_anon_select_guard_v1', 'anonymous private-object read denied');
has('tenant_private_storage_anon_insert_guard_v1', 'anonymous private-object insert denied');
has('tenant_private_storage_anon_update_guard_v1', 'anonymous private-object update denied');
has('tenant_private_storage_anon_delete_guard_v1', 'anonymous private-object delete denied');

has('room_secrets_created_by_required_v1', 'new Room secrets require an owner');
has('UNIQUE (room_id, created_by, key)', 'Room secret key is owner-partitioned');
has('room_secrets_owner_scope_select_v1', 'Room secrets owner-only read');
has('room_secrets_owner_scope_insert_v1', 'Room secrets owner-only insert');
has('room_secrets_owner_scope_update_v1', 'Room secrets owner-only update');
has('room_secrets_owner_scope_delete_v1', 'Room secrets owner-only delete');
has('CREATE OR REPLACE FUNCTION public.get_user_circles(', 'legacy Circle fallback RPC is replaced');
has('user_uuid IS DISTINCT FROM auth.uid()', 'legacy Circle RPC argument is self-bound');
const legacyCircleRpcStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.get_user_circles(');
const legacyCircleRpcEnd = sql.indexOf('REVOKE ALL ON FUNCTION public.get_user_circles(uuid)', legacyCircleRpcStart);
check(legacyCircleRpcStart >= 0 && legacyCircleRpcEnd > legacyCircleRpcStart, 'legacy Circle RPC section is bounded');
const legacyCircleRpc = sql.slice(legacyCircleRpcStart, legacyCircleRpcEnd);
has('Preserve the deployed bounded TABLE wire shape', 'legacy Circle RPC retains its deployed projection contract');
check(legacyCircleRpc.includes('RETURNS TABLE ('), 'legacy Circle RPC returns the bounded table projection');
for (const secretColumn of ['api_key', 'discord_bot_token', 'discord_webhook_url']) {
  check(!legacyCircleRpc.includes(secretColumn), `legacy Circle RPC omits ${secretColumn}`);
}
has('REVOKE ALL ON FUNCTION public.get_user_circles(uuid) FROM PUBLIC, anon;', 'legacy Circle RPC rejects public/anon');

const startMarker = '-- BEGIN SECTION 50: Tenant isolation convergence\n';
const endMarker = '\n-- END SECTION 50: Tenant isolation convergence';
const start = consolidated.indexOf(startMarker);
const end = consolidated.indexOf(endMarker, start + startMarker.length);
check(start >= 0, 'RUN_THIS_SQL §50 start marker');
check(end > start, 'RUN_THIS_SQL §50 end marker');
const mirrored = consolidated.slice(start + startMarker.length, end).trim();
check(mirrored === sql.trim(), 'RUN_THIS_SQL §50 is byte-identical to migration');

console.log(`tenant isolation SQL security smoke: ${assertions} assertions passed`);
