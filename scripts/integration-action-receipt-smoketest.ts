/**
 * integration-action-receipt-smoketest — the action→proof extraction
 * (src/lib/integrationActionReceipt.ts): a custom_api.request / messaging.notify
 * result becomes a verdict + secret-safe created-resource URL/id + one-line
 * proof summary.
 *
 * Pins the safety envelope: never surface a value under a secret-shaped key,
 * strip secret-shaped query params from URLs, reject token-shaped ids, stay
 * bounded, never throw. Pure — loads under tsx.
 */

import {
  buildIntegrationActionOutcome,
  buildIntegrationReceiptLines,
} from '../src/lib/integrationActionReceipt';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEqual(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) custom_api.request success: GitHub-style html_url ────────────────
  const gh = buildIntegrationActionOutcome({
    tool: 'custom_api.request',
    ok: true,
    status: 201,
    method: 'POST',
    url: 'https://api.github.com/repos/x/y/issues',
    integrationLabel: 'GitHub',
    bodyPreview: JSON.stringify({ id: 42, number: 7, html_url: 'https://github.com/x/y/issues/7', title: 'Fix login' }),
  });
  assertEqual(gh.verdict, 'success', '(1) 201 → success');
  assert(gh.resource?.kind === 'link', '(1) resource is a link');
  assertEqual(gh.resource?.ref, 'https://github.com/x/y/issues/7', '(1) extracts html_url over id/number');
  assert(/^✅ Created/.test(gh.summary), '(1) summary is a created proof', gh.summary);
  assert(gh.summary.includes('https://github.com/x/y/issues/7'), '(1) summary carries the URL');

  // ─── (2) Linear GraphQL nested url ────────────────────────────────────────
  const linear = buildIntegrationActionOutcome({
    tool: 'custom_api.request',
    ok: true,
    status: 200,
    method: 'POST',
    url: 'https://api.linear.app/graphql',
    integrationLabel: 'Linear',
    bodyPreview: JSON.stringify({ data: { issueCreate: { success: true, issue: { identifier: 'ENG-12', url: 'https://linear.app/acme/issue/ENG-12' } } } }),
  });
  assertEqual(linear.resource?.ref, 'https://linear.app/acme/issue/ENG-12', '(2) extracts nested GraphQL url');

  // ─── (3) Jira: no browse url → falls to self URL, else key ────────────────
  const jira = buildIntegrationActionOutcome({
    tool: 'custom_api.request',
    ok: true,
    status: 201,
    method: 'POST',
    url: 'https://acme.atlassian.net/rest/api/3/issue',
    integrationLabel: 'Jira Cloud',
    bodyPreview: JSON.stringify({ id: '10000', key: 'PROJ-1', self: 'https://acme.atlassian.net/rest/api/3/issue/10000' }),
  });
  assert(jira.resource !== null, '(3) jira yields a resource');
  assert(jira.resource?.ref === 'https://acme.atlassian.net/rest/api/3/issue/10000', '(3) jira uses the self URL', jira.resource?.ref);

  // ─── (4) id-only response (Airtable/HubSpot) → id resource ────────────────
  const airtable = buildIntegrationActionOutcome({
    tool: 'custom_api.request',
    ok: true,
    status: 200,
    method: 'POST',
    url: 'https://api.airtable.com/v0/appX/Tasks',
    integrationLabel: 'Airtable',
    bodyPreview: JSON.stringify({ id: 'rec12345', fields: { Name: 'Do it' } }),
  });
  assertEqual(airtable.resource?.kind, 'id', '(4) id-only → id resource');
  assertEqual(airtable.resource?.ref, 'rec12345', '(4) extracts the record id');
  assert(buildIntegrationReceiptLines(airtable).some((l) => l.includes('rec12345')), '(4) receipt lines include the id ref');

  // ─── (5) error verdicts ───────────────────────────────────────────────────
  const notFound = buildIntegrationActionOutcome({ tool: 'custom_api.request', ok: false, status: 404, method: 'POST', url: 'https://api.x.com/v1/things', integrationLabel: 'X' });
  assertEqual(notFound.verdict, 'client_error', '(5) 404 → client_error');
  assert(/^⚠️/.test(notFound.summary) && notFound.summary.includes('404'), '(5) client error summary', notFound.summary);
  assertEqual(notFound.resource, null, '(5) no resource on failure');
  const server = buildIntegrationActionOutcome({ tool: 'custom_api.request', ok: false, status: 503, method: 'PUT', url: 'https://api.x.com/v1/things/1', integrationLabel: 'X' });
  assertEqual(server.verdict, 'server_error', '(5) 503 → server_error');
  const blocked = buildIntegrationActionOutcome({ tool: 'custom_api.request', ok: false, status: null, method: 'DELETE', url: '', integrationLabel: 'X' });
  assertEqual(blocked.verdict, 'blocked', '(5) no status + not ok → blocked');

  // ─── (6) messaging.notify ─────────────────────────────────────────────────
  const slackOk = buildIntegrationActionOutcome({ tool: 'messaging.notify', ok: true, status: 200, provider: 'Slack', integrationLabel: 'Slack', providerMessage: 'ok' });
  assert(/^✅ Posted to Slack/.test(slackOk.summary), '(6) messaging success proof', slackOk.summary);
  assertEqual(slackOk.resource, null, '(6) messaging has no resource');
  const slackFail = buildIntegrationActionOutcome({ tool: 'messaging.notify', ok: false, status: 404, provider: 'Slack', providerMessage: 'no_service' });
  assert(/^⚠️ Could not post to Slack/.test(slackFail.summary), '(6) messaging failure proof', slackFail.summary);

  // ─── (7) SECRET SAFETY ────────────────────────────────────────────────────
  // A body carrying a token beside a real URL never surfaces the token.
  const withSecret = buildIntegrationActionOutcome({
    tool: 'custom_api.request',
    ok: true,
    status: 201,
    method: 'POST',
    url: 'https://api.x.com/v1/things',
    integrationLabel: 'X',
    bodyPreview: JSON.stringify({ access_token: 'sk-supersecrettokenvalue1234567890', authorization: 'Bearer abc', html_url: 'https://x.com/things/9' }),
  });
  assertEqual(withSecret.resource?.ref, 'https://x.com/things/9', '(7) extracts the URL, not the token');
  assert(!/sk-supersecret|Bearer abc/.test(withSecret.summary), '(7) summary never leaks a token');
  // A URL with a secret-shaped query param → param stripped.
  const urlSecret = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 200, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: JSON.stringify({ url: 'https://x.com/r/1?token=leakme123&page=2' }),
  });
  assert(!!urlSecret.resource && !/token=leakme123/.test(urlSecret.resource.ref), '(7) secret query param stripped from URL', urlSecret.resource?.ref);
  assert(!!urlSecret.resource && /page=2/.test(urlSecret.resource.ref), '(7) safe query param kept');
  // A token-shaped id is not surfaced.
  const tokenId = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 201, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: JSON.stringify({ id: 'ghp1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q' }),
  });
  assertEqual(tokenId.resource, null, '(7) token-shaped id is not surfaced');
  // A short numeric id IS fine (not token-shaped).
  const numId = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 201, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: JSON.stringify({ id: 10042 }),
  });
  assertEqual(numId.resource?.ref, '10042', '(7) numeric id surfaced');

  // ─── (8) robustness: truncated / non-JSON preview never throws ────────────
  const truncated = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 201, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: '{"html_url":"https://x.com/things/5","extra":{"nested":',
  });
  assert(truncated.verdict === 'success', '(8) truncated preview still yields a verdict');
  const nonJson = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 200, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: '<html>Created</html>',
  });
  assertEqual(nonJson.resource, null, '(8) non-JSON preview → no resource, no throw');

  // ─── (9) bounds ───────────────────────────────────────────────────────────
  assert(gh.summary.length <= 240, '(9) summary bounded');
  const longUrl = 'https://x.com/' + 'a'.repeat(600);
  const bounded = buildIntegrationActionOutcome({
    tool: 'custom_api.request', ok: true, status: 201, method: 'POST', url: 'https://api.x.com/v1', integrationLabel: 'X',
    bodyPreview: JSON.stringify({ html_url: longUrl }),
  });
  // Over-long URL with no query is rejected by sanitizeUrl (returns null) → no resource.
  assert(bounded.resource === null || (bounded.resource.ref.length <= 400), '(9) ref bounded or dropped');

  // ─── (10) degenerate inputs never throw ───────────────────────────────────
  try {
    buildIntegrationActionOutcome({ tool: 'custom_api.request' } as any);
    buildIntegrationActionOutcome({ tool: 'messaging.notify' } as any);
    buildIntegrationActionOutcome({} as any);
    buildIntegrationReceiptLines({ summary: 'x', resource: null } as any);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll integration-action-receipt smoke cases passed (${passes} passed).`);
}

main();
