/**
 * connected-resources-digest-smoketest — the pure "## Connected Resources"
 * prompt-block formatter (src/lib/connectedResourcesDigest.ts) behind
 * cross-dashboard agent awareness of marketplace integrations, vault site
 * credentials, Google Workspace, and BYOK provider keys. Load-bearing
 * assertions:
 *
 *   SECRET SAFETY: secret VALUES never appear — a JWT or password mis-supplied
 *   in a configuredSecretKeys/username slot renders as '[hidden]';
 *   assertNoSecretValues holds on every rendered block; siteUrl query strings
 *   (`?token=…`) are dropped entirely; SECRETISH_KEY_RE matches the canonical
 *   secretish key names and redactSecretishKeyName hides them.
 *
 *   FORMAT: vault grant wording (login ✓ vs `grant: none — run vault.grant`),
 *   integration `Connected: N/M.` header + caps/secrets segments, Google
 *   service→tool mapping + stable not-connected fallback, provider keys
 *   `(+N more)`, block assembly skips empty sections, returns '' when nothing
 *   is connected, caps at MAX_BLOCK_CHARS on a line boundary, deterministic.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (connectedResourcesDigest has zero imports).
 */

import {
  buildConnectedResourcesBlock,
  connectedResourcesStats,
  summarizeGoogleWorkspaceForModel,
  summarizeIntegrationsForModel,
  summarizeProviderKeysForModel,
  summarizeVaultForModel,
  assertNoSecretValues,
  redactSecretishKeyName,
  SECRETISH_KEY_RE,
  MAX_INTEGRATIONS_SHOWN,
  MAX_VAULT_CREDS_SHOWN,
  MAX_PROVIDER_KEYS_SHOWN,
  MAX_BLOCK_CHARS,
  type ConnectedResourcesInput,
} from '../src/lib/connectedResourcesDigest';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const JWT_VALUE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const PASSWORD_VALUE = 'Hunter2!SuperSecretProdPassword';
const LONG_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const LONG_B64 = 'QWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVW';

const wpCred = {
  platform: 'wordpress',
  label: 'Acme Blog',
  siteUrl: 'https://acme.com',
  username: 'admin@acme.com',
  allowedActions: ['login', 'post'],
  hasLoginGrant: true,
  loginAllowed: true,
};
const shopCred = {
  platform: 'shopify',
  label: 'Acme Store',
  siteUrl: 'store.acme.com',
  loginAllowed: true,
  hasLoginGrant: false,
};
const slackIntegration = {
  provider: 'slack',
  label: 'Slack',
  status: 'connected',
  connected: true,
  capabilities: ['send_message'],
  configuredSecretKeys: ['bot_token'],
};
const githubIntegration = {
  provider: 'github',
  label: 'GitHub',
  status: 'connected',
  connected: true,
  capabilities: ['repos', 'issues'],
};
const stripeIntegration = { provider: 'stripe', label: 'Stripe', status: 'disabled', connected: false };
const gwFull = { connected: true, email: 'team@acme.com', services: ['gmail', 'calendar', 'drive', 'sheets', 'docs'] };
const GOOGLE_NOT_CONNECTED =
  'Google Workspace: not connected — connect in Circle Settings → Google Workspace to enable gmail/docs/sheets/drive/calendar tools.';

function main(): void {
  // ─── (1) vault credentials summarizer ─────────────────────────────────────
  const v1 = summarizeVaultForModel([wpCred, shopCred]);
  assert(v1.includes('- wordpress/Acme Blog (acme.com) — login: admin@acme.com; actions: login, post; grant: login ✓'), '(1) full wordpress line rendered exactly', v1);
  assert(v1.includes('- shopify/Acme Store (store.acme.com)'), '(1) schemeless siteUrl kept as-is');
  assert(v1.includes('grant: none — run vault.grant'), '(1) loginAllowed without grant → run vault.grant wording');
  const shopLine = v1.split('\n').find((l) => l.includes('shopify')) || '';
  assert(!shopLine.includes('login:'), '(1) username omitted when absent');
  assertEq(summarizeVaultForModel([]), '', '(1) empty array → empty string');
  // grant segment omitted entirely when neither grant nor loginAllowed
  const v1b = summarizeVaultForModel([{ platform: 'ftp', label: 'Legacy' }]);
  assert(!v1b.includes('grant'), '(1) no grant segment when loginAllowed/hasLoginGrant absent');
  assertEq(v1b, '- ftp/Legacy', '(1) bare credential renders head only');
  // cap + overflow marker
  const manyCreds = Array.from({ length: 20 }, (_, i) => ({ platform: `plat${i}`, label: `Site ${i}` }));
  const v1c = summarizeVaultForModel(manyCreds);
  assertEq(v1c.split('\n').length, MAX_VAULT_CREDS_SHOWN + 1, '(1) capped at MAX_VAULT_CREDS_SHOWN + overflow line');
  assert(v1c.includes('(+5 more credentials not shown)'), '(1) overflow marker counts hidden creds');

  // ─── (2) vault secret safety ──────────────────────────────────────────────
  const v2 = summarizeVaultForModel([
    { platform: 'wordpress', label: 'Evil Site', username: JWT_VALUE, siteUrl: `https://acme.com/wp-admin?token=${JWT_VALUE}` },
  ]);
  assert(!v2.includes('eyJ'), '(2) JWT never survives into vault output', v2);
  assert(v2.includes('login: [hidden]'), '(2) JWT-shaped username → [hidden]');
  assert(v2.includes('(acme.com/wp-admin)'), '(2) siteUrl query string dropped, path kept');
  assert(!v2.includes('token='), '(2) token query param gone');
  assertEq(assertNoSecretValues(v2), true, '(2) vault output passes assertNoSecretValues');

  // ─── (3) integrations summarizer ──────────────────────────────────────────
  const i3 = summarizeIntegrationsForModel([slackIntegration, githubIntegration, stripeIntegration]);
  assert(i3.startsWith('Connected: 2/3.'), '(3) header counts connected/total', i3);
  assert(i3.includes('- Slack [slack] connected — caps: send_message; secrets: bot_token (set)'), '(3) slack line rendered exactly');
  assert(i3.includes('- GitHub [github] connected — caps: repos, issues'), '(3) caps joined, no secrets segment when none');
  assert(i3.includes('- Stripe [stripe] disabled'), '(3) disconnected integration bare line');
  const stripeLine = i3.split('\n').find((l) => l.includes('Stripe')) || '';
  assert(!stripeLine.includes('—'), '(3) no dash segment when no caps/secrets');
  assertEq(summarizeIntegrationsForModel([]), '', '(3) empty array → empty string');
  const manyIntegrations = Array.from({ length: 25 }, (_, i) => ({ provider: `prov${i}`, label: `Int ${i}`, status: 'connected', connected: true }));
  const i3b = summarizeIntegrationsForModel(manyIntegrations);
  assert(i3b.startsWith('Connected: 25/25.'), '(3) header counts all rows even past cap');
  assertEq(i3b.split('\n').length, 1 + MAX_INTEGRATIONS_SHOWN + 1, '(3) capped at MAX_INTEGRATIONS_SHOWN lines + overflow');
  assert(i3b.includes('(+5 more integrations not shown)'), '(3) integration overflow marker');

  // ─── (4) integration secret-key NAME safety ───────────────────────────────
  const i4 = summarizeIntegrationsForModel([
    {
      provider: 'custom_api',
      label: 'Acme API',
      status: 'connected',
      connected: true,
      configuredSecretKeys: ['bot_token', JWT_VALUE, PASSWORD_VALUE],
    },
  ]);
  assert(i4.includes('bot_token'), '(4) legit key NAME emitted with (set)');
  assert(i4.includes('secrets: bot_token, [hidden] (set)'), '(4) value-shaped entries collapse to one [hidden]', i4);
  assert(!i4.includes('eyJ'), '(4) JWT in key-name slot never survives');
  assert(!i4.includes('Hunter2'), '(4) password in key-name slot never survives');
  assertEq(assertNoSecretValues(i4), true, '(4) integrations output passes assertNoSecretValues');

  // ─── (5) SECRETISH_KEY_RE + redactSecretishKeyName ────────────────────────
  for (const key of ['access_token', 'client_secret', 'Authorization', 'privateKey', 'refresh_token', 'apikey', 'api_key', 'bearer', 'password']) {
    assert(SECRETISH_KEY_RE.test(key), `(5) SECRETISH_KEY_RE matches ${key}`);
  }
  assert(!SECRETISH_KEY_RE.test('workspaceName'), '(5) workspaceName not secretish');
  assert(!SECRETISH_KEY_RE.test('baseUrl'), '(5) baseUrl not secretish');
  assertEq(redactSecretishKeyName('workspaceName'), 'workspaceName', '(5) safe name passes through');
  assertEq(redactSecretishKeyName('api_key'), '[hidden]', '(5) secretish name hidden');
  assertEq(redactSecretishKeyName('bot_token'), '[hidden]', '(5) token-ish name hidden');
  assertEq(redactSecretishKeyName(JWT_VALUE), '[hidden]', '(5) value-shaped input hidden');
  assertEq(redactSecretishKeyName('x'.repeat(41)), '[hidden]', '(5) >40 chars hidden');
  assertEq(redactSecretishKeyName(''), '[hidden]', '(5) empty name hidden');

  // ─── (6) assertNoSecretValues detector ────────────────────────────────────
  assertEq(assertNoSecretValues('hello connected world'), true, '(6) plain prose passes');
  assertEq(assertNoSecretValues(`Bearer ${JWT_VALUE}`), false, '(6) JWT detected');
  assertEq(assertNoSecretValues(`hash ${LONG_HEX}`), false, '(6) long hex detected');
  assertEq(assertNoSecretValues(`blob ${LONG_B64}`), false, '(6) long base64 run detected');
  assertEq(assertNoSecretValues('key sk-ant-api03-abcdefghijklmnop'), false, '(6) sk- prefixed key detected');
  assertEq(assertNoSecretValues('-----BEGIN RSA PRIVATE KEY-----'), false, '(6) PEM header detected');

  // ─── (7) google workspace summarizer ──────────────────────────────────────
  const g7 = summarizeGoogleWorkspaceForModel(gwFull);
  assertEq(
    g7,
    'Google Workspace: connected as team@acme.com — gmail, calendar, drive, sheets, docs (tools: gmail.read/gmail.write, gcal.read/gcal.write, gdrive.read, gsheets.*, gdocs.*).',
    '(7) full connected line with service→tool mapping',
  );
  const g7b = summarizeGoogleWorkspaceForModel({ connected: true, email: 'a@b.com', services: ['gmail', 'drive'] });
  assert(g7b.includes('gmail.read/gmail.write') && g7b.includes('gdrive.read'), '(7) subset services map to their tools');
  assert(!g7b.includes('gcal'), '(7) absent service tools omitted');
  assertEq(summarizeGoogleWorkspaceForModel({ connected: false }), GOOGLE_NOT_CONNECTED, '(7) not connected → stable fallback line');
  assertEq(summarizeGoogleWorkspaceForModel(null), GOOGLE_NOT_CONNECTED, '(7) null → fallback');
  assertEq(summarizeGoogleWorkspaceForModel(42), GOOGLE_NOT_CONNECTED, '(7) number → fallback');
  const g7c = summarizeGoogleWorkspaceForModel({ connected: true, services: ['gmail'] });
  assert(g7c.startsWith('Google Workspace: connected —') && !g7c.includes('connected as'), '(7) missing email omits "connected as"');
  assertEq(summarizeGoogleWorkspaceForModel({ connected: true, email: 'a@b.com' }), 'Google Workspace: connected as a@b.com.', '(7) connected with no services → short line');

  // ─── (8) provider keys summarizer ─────────────────────────────────────────
  assertEq(
    summarizeProviderKeysForModel([{ provider: 'anthropic' }, { provider: 'openai' }, { provider: 'google_ai' }]),
    'Provider keys: anthropic, openai, google_ai.',
    '(8) simple provider list',
  );
  const manyKeys = Array.from({ length: MAX_PROVIDER_KEYS_SHOWN + 3 }, (_, i) => ({ provider: `prov${i}` }));
  const k8 = summarizeProviderKeysForModel(manyKeys);
  assert(k8.includes('(+3 more).'), '(8) overflow renders (+N more)', k8);
  assert(k8.includes('prov23') && !k8.includes('prov26'), '(8) first MAX shown, rest hidden');
  assertEq(
    summarizeProviderKeysForModel(['anthropic', { provider: 'anthropic' }, { provider: 'openai' }]),
    'Provider keys: anthropic, openai.',
    '(8) string entries accepted + case-insensitive dedupe',
  );
  assertEq(summarizeProviderKeysForModel([]), '', '(8) empty → empty string');
  assertEq(summarizeProviderKeysForModel([{ provider: JWT_VALUE }]), '', '(8) value-shaped provider name dropped, not leaked');

  // ─── (9) block assembly ───────────────────────────────────────────────────
  const fullInput: ConnectedResourcesInput = {
    integrations: [slackIntegration, githubIntegration, stripeIntegration],
    vaultCredentials: [wpCred, shopCred],
    googleWorkspace: gwFull,
    providerKeys: [{ provider: 'anthropic' }, { provider: 'openai' }],
    vaultDashboardHint: 'Vault dashboard: Office → Vault tab shows every stored credential.',
  };
  const block = buildConnectedResourcesBlock(fullInput);
  assert(block.startsWith('## Connected Resources'), '(9) block header first');
  assert(block.includes('vault.resolve_for_task then browser.fill_credential_field or fill_saved_login'), '(9) intro line present');
  assert(block.includes('Marketplace integrations — Connected: 2/3.'), '(9) integrations section merged header');
  assert(block.includes('Vault site credentials:'), '(9) vault section label');
  assert(block.includes('- wordpress/Acme Blog (acme.com)'), '(9) vault line inside block');
  assert(block.includes('Google Workspace: connected as team@acme.com'), '(9) google line inside block');
  assert(block.includes('Provider keys: anthropic, openai.'), '(9) provider keys line inside block');
  assert(block.includes('Vault dashboard: Office → Vault tab'), '(9) vaultDashboardHint appended');
  assertEq(assertNoSecretValues(block), true, '(9) full block passes assertNoSecretValues');
  assertEq(buildConnectedResourcesBlock(fullInput), block, '(9) deterministic across runs');

  // ─── (10) block skips empty sections / returns '' when nothing connected ──
  const onlyGoogle = buildConnectedResourcesBlock({ googleWorkspace: { connected: true, email: 'a@b.com', services: ['gmail'] } });
  assert(onlyGoogle.includes('Google Workspace: connected'), '(10) google-only block renders');
  assert(!onlyGoogle.includes('Vault site credentials'), '(10) empty vault section skipped');
  assert(!onlyGoogle.includes('Marketplace integrations'), '(10) empty integrations section skipped');
  assert(!onlyGoogle.includes('Provider keys:'), '(10) empty provider keys section skipped');
  const integrationsOnly = buildConnectedResourcesBlock({ integrations: [slackIntegration] });
  assert(integrationsOnly.includes('Google Workspace: not connected'), '(10) not-connected google pointer still included in non-empty block');
  assertEq(buildConnectedResourcesBlock({}), '', '(10) empty input → empty string');
  assertEq(buildConnectedResourcesBlock(null), '', '(10) null → empty string');
  assertEq(buildConnectedResourcesBlock(undefined), '', '(10) undefined → empty string');
  assertEq(
    buildConnectedResourcesBlock({ integrations: [], vaultCredentials: [], googleWorkspace: { connected: false }, providerKeys: [] }),
    '',
    '(10) all-empty + google disconnected → empty string',
  );
  assertEq(buildConnectedResourcesBlock({ vaultDashboardHint: 'hint only' }), '', '(10) hint alone does not force a block');

  // ─── (11) block cap on a line boundary ────────────────────────────────────
  const bulkyIntegrations = Array.from({ length: 20 }, (_, i) => ({
    provider: `provider_number_${i}`,
    label: `Integration Number ${i} With A Long Display Label Here`,
    status: 'connected',
    connected: true,
    capabilities: Array.from({ length: 6 }, (_, j) => `cap ${j} long capability description number ${i}`),
  }));
  const bigBlock = buildConnectedResourcesBlock({ integrations: bulkyIntegrations });
  assert(bigBlock.length <= MAX_BLOCK_CHARS, '(11) block capped at MAX_BLOCK_CHARS', String(bigBlock.length));
  assert(bigBlock.endsWith('… (truncated)'), '(11) truncation marker appended');
  assert(bigBlock.startsWith('## Connected Resources'), '(11) header survives truncation');
  const lastKeptLine = bigBlock.split('\n').slice(-2, -1)[0] || '';
  assert(lastKeptLine === '' || lastKeptLine.startsWith('- ') || lastKeptLine.startsWith('Marketplace'), '(11) cut lands on a line boundary', lastKeptLine);

  // ─── (12) stats ───────────────────────────────────────────────────────────
  const stats = connectedResourcesStats(fullInput);
  assertEq(stats.integrations, 3, '(12) integrations counted');
  assertEq(stats.vaultCredentials, 2, '(12) vault creds counted');
  assertEq(stats.googleConnected, true, '(12) google connected true');
  assertEq(stats.providerKeys, 2, '(12) provider keys counted');
  const junkStats = connectedResourcesStats({
    integrations: [null, 42, {}, { provider: 'slack' }],
    vaultCredentials: [null, { platform: 'wp' }, 'junk'],
    googleWorkspace: { connected: false },
    providerKeys: ['anthropic', 'anthropic', {}, null],
  } as unknown);
  assertEq(junkStats.integrations, 1, '(12) junk integration rows filtered');
  assertEq(junkStats.vaultCredentials, 1, '(12) junk vault rows filtered');
  assertEq(junkStats.googleConnected, false, '(12) google disconnected false');
  assertEq(junkStats.providerKeys, 1, '(12) provider keys deduped in stats');
  const zeroStats = connectedResourcesStats(null);
  assert(
    zeroStats.integrations === 0 && zeroStats.vaultCredentials === 0 && !zeroStats.googleConnected && zeroStats.providerKeys === 0,
    '(12) null input → zero stats',
  );

  // ─── (13) constants exported + sane ───────────────────────────────────────
  assertEq(MAX_INTEGRATIONS_SHOWN, 20, '(13) MAX_INTEGRATIONS_SHOWN is 20');
  assertEq(MAX_VAULT_CREDS_SHOWN, 15, '(13) MAX_VAULT_CREDS_SHOWN is 15');
  assertEq(MAX_PROVIDER_KEYS_SHOWN, 24, '(13) MAX_PROVIDER_KEYS_SHOWN is 24');
  assertEq(MAX_BLOCK_CHARS, 4000, '(13) MAX_BLOCK_CHARS is 4000');

  // ─── (14) degenerate / undefined never throws (sweep every export) ────────
  try {
    const junkInputs: unknown[] = [null, undefined, 42, 'nonsense', NaN, [null, 7, 'x', {}, []], { bogus: true }];
    for (const junk of junkInputs) {
      assert(typeof summarizeVaultForModel(junk) === 'string', '(14) summarizeVaultForModel total');
      assert(typeof summarizeIntegrationsForModel(junk) === 'string', '(14) summarizeIntegrationsForModel total');
      assert(typeof summarizeGoogleWorkspaceForModel(junk) === 'string', '(14) summarizeGoogleWorkspaceForModel total');
      assert(typeof summarizeProviderKeysForModel(junk) === 'string', '(14) summarizeProviderKeysForModel total');
      assert(typeof buildConnectedResourcesBlock(junk as never) === 'string', '(14) buildConnectedResourcesBlock total');
      assert(typeof redactSecretishKeyName(junk) === 'string', '(14) redactSecretishKeyName total');
      assert(typeof assertNoSecretValues(junk as never) === 'boolean', '(14) assertNoSecretValues total');
      assert(typeof connectedResourcesStats(junk).integrations === 'number', '(14) connectedResourcesStats total');
    }
    assertEq(summarizeVaultForModel([null, 42, 'str', {}, { platform: 'wp' }]), '- wp/wp', '(14) junk vault rows filtered, valid one renders with platform fallback label');
    assertEq(summarizeIntegrationsForModel([{ provider: 'slack' }]), 'Connected: 0/1.\n- slack [slack] unknown', '(14) minimal integration row gets fallbacks');
    assertEq(summarizeProviderKeysForModel('nope'), '', '(14) non-array provider keys → empty');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (14) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll connected-resources-digest smoke cases passed (${passes} passed).`);
}

main();
