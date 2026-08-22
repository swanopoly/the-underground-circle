/**
 * Source-contract smoke for service-role Edge tenant isolation.
 *
 * The Edge entrypoints register Deno servers and cannot be imported by Node.
 * Pin the authority predicates around every confirmed cross-tenant boundary.
 *
 * Run: npx tsx scripts/edge-tenant-isolation-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;
function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

console.log('Service-role entity identity');
const boss = read('supabase/functions/boss-agent/index.ts');
const council = between(
  boss,
  'async function modelCouncil(',
  '// ─── Main Handler',
);
assert(
  /\.from\("tasks"\)[\s\S]*?\.eq\("id", taskId\)[\s\S]*?\.eq\("circle_id", circleId\)/.test(council),
  'model council binds a caller-supplied task id to the authorized Circle',
);
assert(
  /\.from\("goals"\)[\s\S]*?\.eq\("id", task\.goal_id\)[\s\S]*?\.eq\("circle_id", circleId\)/.test(council),
  'model council binds the task goal to the same Circle',
);

const heartbeat = read('supabase/functions/heartbeat-agent/index.ts');
const heartbeatUpdate = between(
  heartbeat,
  'case "update_task":',
  'case "post_activity":',
);
assert(
  /\.eq\("id", task_id\)[\s\S]*?\.eq\("circle_id", circleId\)/.test(heartbeatUpdate),
  'heartbeat model output cannot update a task outside its active Circle',
);

const roomTask = read('supabase/functions/room-task-executor/index.ts');
const roomCompletion = between(
  roomTask,
  '// Also mark original room_messages task entry if it exists',
  'authorizedTaskId = null;',
);
assert(
  (roomCompletion.match(/\.eq\('room_id', roomId\)/g) || []).length === 2,
  'room task completion binds both message read and write to the authorized room',
);

console.log('MCP and Chat private-thread isolation');
const mcp = read('supabase/functions/mcp-server/index.ts');
assert(
  mcp.includes('const callerSupabase = createClient(supabaseUrl, anonKey'),
  'MCP creates a bearer-pinned caller client after membership verification',
);
assert(
  mcp.includes(".eq('visibility', 'circle')")
    && mcp.includes("messagesQuery.in('thread_id', visibleThreadIds)"),
  'Circle-wide MCP messages exclude private/shared threads',
);
assert(
  /const \{ data: tasks \} = await callerSupabase[\s\S]*?\.from\('tasks'\)/.test(mcp),
  'MCP task reads execute under caller RLS',
);
assert(
  /const \{ data: newTask, error: taskErr \} = await callerSupabase[\s\S]*?\.from\('tasks'\)/.test(mcp),
  'MCP task writes execute under caller RLS',
);

const swanbotEdge = read('supabase/functions/swanbot-ai/index.ts');
const messageScope = between(
  swanbotEdge,
  'async function resolveSwanBotV1MessageScope(',
  'const MAX_SWANBOT_REQUEST_BYTES',
);
assert(
  messageScope.includes('.from("circle_chat_threads")')
    && messageScope.includes('? query.eq("id", requestedThreadId)')
    && messageScope.includes(': query.eq("visibility", "circle")'),
  'SwanBot v1 resolves an exact active thread or Circle-visible threads only',
);
const gather = between(
  swanbotEdge,
  'async function gatherCircleContext(',
  'function buildSystemPrompt(',
);
assert(
  /messageSupabase\.from\("messages"\)[\s\S]*?\.eq\("circle_id", circleId\)[\s\S]*?\.in\("thread_id", messageThreadIds\)/.test(gather),
  'SwanBot v1 message context is read through caller RLS and an authorized thread set',
);
const nonRelay = between(
  swanbotEdge,
  '// ─── End relay mode',
  '// Route skills',
);
assert(
  nonRelay.indexOf('resolveSwanBotV1MessageScope(') < nonRelay.indexOf('createSwanBotV1Run('),
  'SwanBot v1 proves thread visibility before creating a run or gathering context',
);

const swanbotClient = read('src/lib/swanbot.ts');
assert(
  (swanbotClient.match(/\{ threadId: (?:clientLoopContext|opts)\??\.threadId \}/g) || []).length >= 3,
  'the client forwards its existing exact thread identity on v1 fallback and relay calls',
);
const hfActivity = between(
  swanbotEdge,
  'async function logHfActivity(',
  '// ── Marketplace integrations:',
);
assert(
  hfActivity.includes('title: `${tool} completed`')
    && hfActivity.includes('body: "Hugging Face tool completed."')
    && !hfActivity.includes('JSON.stringify(result)')
    && !hfActivity.includes('${inputPreview}'),
  'private Chat provider prompts and outputs never enter the Circle-wide activity feed',
);

console.log('Report object and Circle isolation');
const report = read('supabase/functions/generate-report/index.ts');
assert(
  report.includes('report.created_by !== authUserId'),
  'interactive report generation is creator-only',
);
assert(
  /\.from\("circle_members"\)[\s\S]*?\.eq\("user_id", authUserId!\)/.test(report)
    && report.includes('circleIds.some((id) => !authorizedIds.has(id))'),
  'report Circle selection is a subset of the caller direct memberships',
);
assert(
  report.includes('const reportDataClient = callerSupabase || supabase;')
    && report.includes('const { data: analytics } = await reportDataClient')
    && report.includes('const { data: checkIns } = await reportDataClient'),
  'interactive report personal data is re-read through caller RLS',
);
assert(
  report.includes('const { data: goals, error: goalsError } = await reportDataClient')
    && report.includes('.in("circle_id", selectedCircleIds)'),
  'report goal aggregation is pinned to the exact verified Circle set',
);
assert(
  report.includes('`reports/${orgId}/${reportId}/${fileName}.${ext}`'),
  'each report owns a unique storage path and cannot overwrite another report',
);
assert(
  report.includes('const REPORT_SIGNED_URL_TTL_SECONDS = 60 * 60;')
    && report.includes('"Cache-Control": "no-store"'),
  'report bearer links are short-lived and responses are not cached',
);
const reportAuthAt = report.indexOf('report.created_by !== authUserId');
const reportStatusAt = report.indexOf('.update({ status: "generating" })');
assert(
  reportAuthAt >= 0 && reportStatusAt > reportAuthAt,
  'a rejected report request cannot mutate report status',
);

console.log('OAuth connection tenant binding');
const slackOAuth = read('supabase/functions/slack-oauth/index.ts');
const slackAuthority = between(
  slackOAuth,
  'async function authorizeConnectionBinding(',
  '// Resolve the VERIFIED caller',
);
assert(
  slackAuthority.includes('.in("role", ["owner", "admin"])')
    && slackAuthority.includes('.eq("role", "creator")')
    && slackAuthority.includes('orgId && circle.org_id !== orgId'),
  'Slack requires every supplied target role and an exact Circle-to-org pair',
);
const slackInitiateAuthorityAt = slackOAuth.indexOf(
  'const authority = await authorizeConnectionBinding(supabase, userId, orgId, circleId);',
);
const slackStateInsertAt = slackOAuth.indexOf('.from("slack_oauth_states").insert({');
assert(
  slackInitiateAuthorityAt >= 0 && slackInitiateAuthorityAt < slackStateInsertAt,
  'Slack proves the exact binding before reserving OAuth state',
);
const slackCommitAuthorityAt = slackOAuth.indexOf('const commitAuthority = await authorizeConnectionBinding(');
const slackConnectionInsertAt = slackOAuth.indexOf('.from("slack_connections").insert({');
assert(
  slackCommitAuthorityAt >= 0
    && slackConnectionInsertAt > slackCommitAuthorityAt
    && slackOAuth.includes('installed_by: stateRow.user_id'),
  'Slack revalidates the stored binding and attributes its service-role commit',
);

const teamsOAuth = read('supabase/functions/teams-auth/index.ts');
const teamsAuthority = between(
  teamsOAuth,
  'async function isAuthorizedForConnection(',
  'Deno.serve(async (req: Request) => {',
);
assert(
  teamsAuthority.includes('.in("role", ["owner", "admin"])')
    && teamsAuthority.includes('.eq("role", "creator")')
    && teamsAuthority.includes('orgId && circle.org_id !== orgId'),
  'Teams requires every supplied target role and an exact Circle-to-org pair',
);
const teamsInitiateAuthorityAt = teamsOAuth.indexOf(
  'const authority = await isAuthorizedForConnection(supabase, userId, orgId, circleId);',
);
const teamsStateInsertAt = teamsOAuth.indexOf('supabase.from("teams_oauth_states").insert({');
assert(
  teamsInitiateAuthorityAt >= 0 && teamsInitiateAuthorityAt < teamsStateInsertAt,
  'Teams proves the exact binding before reserving OAuth state',
);
const teamsCommitAuthorityAt = teamsOAuth.indexOf('const commitAuthority = await isAuthorizedForConnection(');
const teamsConnectionWriteAt = teamsOAuth.indexOf('.from("teams_connections")');
assert(
  teamsCommitAuthorityAt >= 0 && teamsConnectionWriteAt > teamsCommitAuthorityAt,
  'Teams revalidates the stored binding immediately before its service-role commit',
);
const sharedEdge = read('supabase/functions/_shared/edge.ts');
const outboundConnectionAuthorityAt = sharedEdge.indexOf('export async function userOwnsConnection(');
assert(outboundConnectionAuthorityAt >= 0, 'shared outbound connection authority is present');
const outboundConnectionAuthority = sharedEdge.slice(outboundConnectionAuthorityAt);
assert(
  outboundConnectionAuthority.includes('.from("org_members")')
    && outboundConnectionAuthority.includes('.from("circle_members")')
    && outboundConnectionAuthority.includes('.from("circles")')
    && outboundConnectionAuthority.includes('orgId && circle.org_id !== orgId')
    && !outboundConnectionAuthority.includes('if (data) return true'),
  'outbound Slack and Teams use requires every stored target and rejects mismatched legacy pairs',
);

console.log('Autonomous dispatch revocation');
const featuredTrades = read('supabase/functions/featured-trades-generator/index.ts');
const featuredTradeKeyAt = featuredTrades.indexOf('const geminiKey = (await resolveUserModelApiKey({');
assert(
  featuredTradeKeyAt > featuredTrades.indexOf('const authUser = await getAuthenticatedUser(req);')
    && featuredTrades.includes('if (!authUser || authUser.id !== userId)')
    && !featuredTrades.includes('isServiceRole ? null : await getAuthenticatedUser(req)'),
  'personal trade learning and model-key work has no unscoped service-role userId override',
);
const researchRunner = read('supabase/functions/research-daily-runner/index.ts');
const researchTarget = between(
  researchRunner,
  'async function resolveSecondBrainTarget(',
  'async function insertIfMissingKnowledgeSource(',
);
assert(
  researchTarget.includes('const member = await assertCircleMember(opts.supabase, circleId, userId);')
    && !researchTarget.includes('if (!opts.isServiceRole) {'),
  'service-role Second Brain targeting rechecks the exact current Circle membership',
);
const hfProxy = read('supabase/functions/hf-proxy/index.ts');
const hfDelegatedAuthorityAt = hfProxy.indexOf('if (isServiceRole) {');
const hfPersonalKeyAt = hfProxy.indexOf('const hfKey = await resolveUserModelApiKey({');
assert(
  hfDelegatedAuthorityAt >= 0
    && hfPersonalKeyAt > hfDelegatedAuthorityAt
    && /\.from\('circle_members'\)[\s\S]*?\.eq\('circle_id', serviceCircleId\)[\s\S]*?\.eq\('user_id', userId\)/.test(
      hfProxy.slice(hfDelegatedAuthorityAt, hfPersonalKeyAt),
    ),
  'delegated Hugging Face calls recheck current exact Circle membership before personal-key use',
);
assert(
  hfProxy.includes("if (isServiceRole) toolQuery = toolQuery.eq('circle_id', serviceCircleId);")
    && hfProxy.includes("console.error('[hf-proxy] request failed', {")
    && !hfProxy.includes("console.error('hf-proxy error:', error)"),
  'delegated Hugging Face tools stay in the authorized Circle and errors do not log personal content',
);
const computerUseAgent = read('supabase/functions/computer-use-agent/index.ts');
const computerUseScheduledAuthorityAt = computerUseAgent.indexOf('if (isScheduledServiceCall && !body.circleId)');
const computerUsePersonalKeyAt = computerUseAgent.indexOf('const apiKey = await resolveUserModelApiKey({');
assert(
  computerUseScheduledAuthorityAt >= 0
    && computerUsePersonalKeyAt > computerUseScheduledAuthorityAt
    && /\.from\("circle_members"\)[\s\S]*?\.eq\("circle_id", body\.circleId\)[\s\S]*?\.eq\("user_id", userId\)/.test(
      computerUseAgent.slice(computerUseScheduledAuthorityAt, computerUsePersonalKeyAt),
    ),
  'the scheduled Computer Use executor rechecks current exact Circle membership before personal-key use',
);
const watchScheduler = read('supabase/functions/watch-scheduler/index.ts');
const watchAuthority = between(
  watchScheduler,
  'async function resolveScheduleDispatchAuthority(',
  'async function deactivateRevokedSchedule(',
);
assert(
  /\.from\("circle_members"\)[\s\S]*?\.eq\("circle_id", schedule\.circle_id\)[\s\S]*?\.eq\("user_id", schedule\.created_by\)/.test(watchAuthority),
  'a watch requires its creator current membership in the exact Circle',
);
assert(
  watchAuthority.includes('.from("circle_chat_threads")')
    && watchAuthority.includes('.eq("circle_id", schedule.circle_id)')
    && watchAuthority.includes('threadQuery.eq("id", schedule.thread_id)')
    && watchAuthority.includes('threadQuery.eq("visibility", "circle")')
    && watchAuthority.includes('thread.created_by === schedule.created_by')
    && /\.from\("circle_chat_thread_members"\)[\s\S]*?\.eq\("thread_id", thread\.id\)[\s\S]*?\.eq\("user_id", schedule\.created_by\)/.test(watchAuthority),
  'a watch resolves one same-Circle destination using the exact private/shared-thread predicate',
);
const watchProcess = between(
  watchScheduler,
  'async function processSchedule(',
  '// ── Request handler',
);
const firstWatchAuthorityAt = watchProcess.indexOf('resolveScheduleDispatchAuthority(supabase, schedule)');
const watchSecretsAt = watchProcess.indexOf('resolveBrowserbaseCreds(supabase, schedule.circle_id)');
const finalWatchAuthorityAt = watchProcess.lastIndexOf('resolveScheduleDispatchAuthority(supabase, schedule)');
const watchDispatchAt = watchProcess.indexOf('const outcome = await runAgentTask({');
assert(
  firstWatchAuthorityAt >= 0
    && watchSecretsAt > firstWatchAuthorityAt
    && finalWatchAuthorityAt > watchSecretsAt
    && watchDispatchAt > finalWatchAuthorityAt,
  'a revoked watch returns before Circle-secret lookup and rechecks immediately before provider dispatch',
);
const watchPost = between(
  watchScheduler,
  'async function postWatchMessage(',
  '// ── Per-schedule processing',
);
assert(
  watchPost.indexOf('resolveScheduleDispatchAuthority(supabase, schedule)')
    < watchPost.indexOf('supabase.from("messages").insert({')
    && watchPost.includes('thread_id: authority.threadId'),
  'every service-role watch post rechecks and uses the resolved exact thread',
);

const scheduledRunner = read('supabase/functions/scheduled-action-runner/index.ts');
const scheduledAuthority = between(
  scheduledRunner,
  'async function verifyScheduledActionDispatchAuthority(',
  'async function runOnce(',
);
assert(
  scheduledAuthority.includes('if (!action.circle_id) return { ok: true };')
    && /\.from\('circle_members'\)[\s\S]*?\.eq\('circle_id', action\.circle_id\)[\s\S]*?\.eq\('user_id', action\.user_id\)/.test(scheduledAuthority),
  'personal scheduled actions stay self-scoped while Circle actions require current exact membership',
);
const scheduledRun = between(
  scheduledRunner,
  'async function runOnce(',
  'async function handleApprovalGate(',
);
const scheduledAuthorityAt = scheduledRun.indexOf('verifyScheduledActionDispatchAuthority(');
const scheduledDispatchFlagAt = scheduledRun.indexOf(".update({ dispatched_at: dispatchTime })");
const scheduledExecutorAt = scheduledRun.indexOf('const executor = EXECUTORS[sealedAction.kind]');
assert(
  scheduledAuthorityAt >= 0
    && scheduledDispatchFlagAt > scheduledAuthorityAt
    && scheduledExecutorAt > scheduledDispatchFlagAt,
  'scheduled Circle actions fail closed on revocation before the dispatch flag and credential-using executor',
);

const automationExecutor = read('supabase/functions/automation-executor/index.ts');
const automationAuthorityAt = automationExecutor.indexOf('const { data: creatorMembership, error: creatorMembershipError }');
const automationRunInsertAt = automationExecutor.indexOf('.from("automation_runs")');
const automationKeyAt = automationExecutor.indexOf('const resolvedAnthropicKey = await resolveUserModelApiKey({');
assert(
  automationAuthorityAt >= 0
    && automationRunInsertAt > automationAuthorityAt
    && automationKeyAt > automationRunInsertAt
    && automationExecutor.includes('.eq("user_id", creatorId)')
    && automationExecutor.includes('"automation_creator_revoked"'),
  'autonomous Circle automation rejects a departed creator before run creation or personal-key resolution',
);

console.log('Secret and personal-data log hygiene');
const invites = read('supabase/functions/send-invite-email/index.ts');
assert(
  !/console\.(?:log|info|warn|error)\([^\n]*(?:normalizedEmail|joinUrl|inviteCode|safeInviteCode)/.test(invites),
  'invite recipient, code, and join URL never enter hosted logs',
);
const teamsWebhook = read('supabase/functions/teams-webhook/index.ts');
assert(
  !/console\.(?:log|info|warn|error)\([^\n]*body\.text/.test(teamsWebhook),
  'inbound Teams message content never enters hosted logs',
);
const githubOAuth = read('supabase/functions/github-oauth/index.ts');
assert(
  !githubOAuth.includes('console.error("GitHub token exchange failed:", tokenData)'),
  'GitHub OAuth never logs a complete token response',
);
const googleOAuth = read('supabase/functions/google-oauth/index.ts');
assert(
  googleOAuth.includes('"Cache-Control": "no-store"')
    && githubOAuth.includes('"Cache-Control": "no-store"')
    && slackOAuth.includes('"Cache-Control": "no-store"')
    && teamsOAuth.includes('"Cache-Control": "no-store"'),
  'personal OAuth tokens, repository metadata, and connection state URLs are never cached',
);

console.log(`\nedge-tenant-isolation-smoketest: ${assertions} assertions passed.`);
