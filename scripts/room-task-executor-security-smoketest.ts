/**
 * Source-level security contract for room-task-executor.
 *
 * No live edge function, provider, URL, or database is contacted.
 *
 * Run:
 *   npx tsx scripts/room-task-executor-security-smoketest.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'supabase', 'functions', 'room-task-executor', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`room-task-executor security smoke failed: ${message}`);
}

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function ordered(haystack: string, needles: string[], message: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1);
    check(next > cursor, `${message}: ${needle}`);
    cursor = next;
  }
}

// ── Search-result SSRF boundary ─────────────────────────────────────────────

const endpointMatch = source.match(/const BRAVE_SEARCH_ENDPOINT = '([^']+)'/);
check(!!endpointMatch, 'declares one fixed Brave search endpoint');
const braveEndpoint = new URL(endpointMatch![1]);
check(braveEndpoint.protocol === 'https:', 'Brave endpoint uses HTTPS');
check(braveEndpoint.hostname === 'api.search.brave.com', 'Brave endpoint pins the exact public hostname');
check(braveEndpoint.username === '' && braveEndpoint.password === '', 'Brave endpoint has no URL credentials');
check(braveEndpoint.hash === '', 'Brave endpoint has no fragment');
check(braveEndpoint.port === '', 'Brave endpoint has no custom port');

const research = section(
  'async function handleWebResearch(',
  'async function handleRunScript(',
);
check((research.match(/\bfetch\(/g) || []).length === 1, 'web research has exactly one network fetch');
check(research.includes('fetch(searchUrl, {'), 'the only fetch uses the fixed Brave URL object');
check(research.includes("redirect: 'error'"), 'Brave fetch refuses every redirect');
check(research.includes('signal: AbortSignal.timeout(8_000)'), 'Brave fetch has a bounded timeout');
check(research.includes("searchUrl.searchParams.set('q', prompt)"), 'prompt is encoded as a query parameter');
check(!research.includes('fetch(result.url'), 'search-result URLs are never fetched');
check(!research.includes('fetch(row'), 'parsed result rows are never fetched');
check(!research.includes('urlsToFetch'), 'arbitrary result fetch loop is absent');
check(!research.includes('pageRes'), 'arbitrary page response path is absent');
check(!research.includes('fetchedContent'), 'arbitrary page content is never ingested');
check(!research.includes('.text()'), 'search provider error/page bodies are never read as raw text');
check(research.includes("typeof body.braveApiKey === 'string'"),
  'web research accepts only the server-resolved Brave key');
check(!research.includes("Deno.env.get('BRAVE_API_KEY')"),
  'web research cannot spend the platform Brave key directly');

const publicUrl = section(
  'function normalizePublicResultUrl(',
  '// ─── Helpers',
);
check(publicUrl.includes("url.protocol !== 'https:' && url.protocol !== 'http:'"),
  'display URLs reject non-HTTP schemes');
check(publicUrl.includes('if (url.username || url.password) return null'),
  'display URLs reject embedded credentials');
check(publicUrl.includes("url.hash = ''"), 'display URLs strip fragments');
const credentialedDisplayUrl = `https://${['user', 'pass'].join(':')}@example.com`;
for (const vector of [
  'http://127.0.0.1',
  'http://10.0.0.1',
  'http://100.64.0.1',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1]',
  'http://[fe80::1]',
  'http://[fc00::1]',
  'http://[::ffff:127.0.0.1]',
  credentialedDisplayUrl,
  'file:///etc/passwd',
  'gopher://127.0.0.1',
]) {
  check(!research.includes(`fetch('${vector}`) && !research.includes(`fetch("${vector}`),
    `SSRF vector cannot reach fetch: ${vector}`);
}

// ── Authentication, method, and tenant ordering ─────────────────────────────

const handler = source.slice(source.indexOf('Deno.serve(async'));
ordered(handler, [
  "if (req.method !== 'GET' && req.method !== 'POST')",
  'const user = await getAuthenticatedUser(req)',
  "if (req.method === 'GET')",
  'parsedBody = await req.json()',
  'const supabase = createSupabaseClient()',
  ".from('circle_rooms')",
  ".from('circle_members')",
  ".from('room_tasks')",
  "const { data: agentRow, error: agentError } = await supabase",
  'const resolvedAnthropicKey = await resolveUserModelApiKey({',
  "if (taskType === 'web_research')",
  'const resolvedBraveKey = await resolveUserModelApiKey({',
], 'method/auth/body/room/member/task/agent checks precede model credentials');
check(handler.indexOf('const user = await getAuthenticatedUser(req)') < handler.indexOf('parsedBody = await req.json()'),
  'authentication happens before JSON parsing');
check(handler.indexOf("if (req.method !== 'GET' && req.method !== 'POST')") < handler.indexOf('parsedBody = await req.json()'),
  'method gate happens before JSON parsing');
check(handler.indexOf("if (req.method === 'GET')") > handler.indexOf('const user = await getAuthenticatedUser(req)'),
  'GET health metadata requires in-function authentication');
check(handler.includes("return errResponse(400, 'validation', 'Invalid JSON body.')"),
  'invalid JSON receives a bounded validation response');

const membership = section(
  "const { data: membership } = await supabase",
  '// Umbrella Claude spend cap',
);
ordered(membership, [
  ".from('circle_members')",
  ".eq('circle_id', room.circle_id)",
  ".eq('user_id', user.id)",
  '.maybeSingle()',
], 'membership binds the authenticated user to the room-derived circle');

const taskBinding = section(
  "const { data: taskRow } = await supabase",
  '// agentId is caller-supplied',
);
check(taskBinding.includes(".from('room_tasks')"), 'task binding reads the canonical task row');
check(taskBinding.includes(".eq('id', taskId)"), 'task binding looks up the exact task id');
check(taskBinding.includes('taskRow.room_id !== roomId'), 'task binding requires the exact authorized room');

const agentAuthorization = section(
  '// agentId is caller-supplied',
  'authorizedTaskId = taskId',
);
ordered(agentAuthorization, [
  ".from('circle_office_agents')",
  ".eq('id', agentId)",
  ".eq('circle_id', room.circle_id)",
  '.maybeSingle()',
], 'agent lookup binds caller id to the room-derived circle');
check(agentAuthorization.includes("return errResponse(403, 'agent_mismatch'"),
  'cross-circle agent id fails closed');
check(agentAuthorization.includes("return errResponse(503, 'authorization_unavailable'"),
  'indeterminate agent authorization fails closed');

const agentMutation = section(
  '// Reset only the pre-authorized agent',
  '// Mark task done',
);
ordered(agentMutation, [
  ".from('circle_office_agents')",
  ".eq('id', authorizedAgentId)",
  ".eq('circle_id', room.circle_id)",
], 'agent mutation repeats the exact id and circle constraints');
check(!handler.includes(".eq('id', agentId);"), 'no agent mutation uses the raw caller id alone');

const braveResolution = section(
  '// Web search has its own billable provider boundary.',
  '// Post "working on it" system message',
);
ordered(braveResolution, [
  'body.braveApiKey = null',
  "if (taskType === 'web_research')",
  'const resolvedBraveKey = await resolveUserModelApiKey({',
  'userId: user.id',
  "provider: 'brave'",
  "envVarName: 'BRAVE_API_KEY'",
  'body.braveApiKey = resolvedBraveKey?.apiKey || null',
], 'Brave cost boundary is server-resolved and user-bound');
check(braveResolution.indexOf('body.braveApiKey = null') < braveResolution.indexOf("if (taskType === 'web_research')"),
  'caller-supplied Brave keys are cleared before resolution');

// ── Sanitized failure paths ─────────────────────────────────────────────────

const safeLogger = section('function logSafeError(', 'function clipUntrustedText(');
check(safeLogger.includes('error instanceof Error ? error.name : typeof error'),
  'safe logger records error type only');
check(!safeLogger.includes('.message'), 'safe logger never records an exception message');
check(!source.includes('err.message'), 'raw exception messages are never persisted or returned');
check(!source.includes('error.message'), 'raw exception messages are never persisted or returned');
check(!source.includes('req.clone().json()'), 'failure path never reparses an untrusted consumed body');
check(handler.includes("error: 'task_execution_failed'"), 'authorized task failure stores a fixed error code');
check(handler.includes("return errResponse(500, 'internal', 'Room task execution failed.')"),
  'client receives fixed generic failure copy');
check(handler.includes('if (authorizedTaskId && authorizedSupabase)'),
  'failure mutation requires a previously authorized task and client');

console.log(`room-task-executor security smoke passed (${assertions} assertions)`);
