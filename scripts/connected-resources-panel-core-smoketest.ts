/**
 * connected-resources-panel-core-smoketest — the pure model behind the
 * user-facing "What's connected" panel
 * (src/lib/connectedResourcesPanelCore.ts). Load-bearing assertions:
 *
 *   ROWS: a full ConnectedResourcesInput fixture yields exactly four rows in
 *   fixed order (integrations/vault/google/provider_keys) with correct
 *   countLabels, bounded item lists (≤6 names then one '+N more'), dedupe,
 *   and connect actions carrying the real CircleDetailScreen tab keys.
 *
 *   FRESH-EMPTY: null/empty input is the onboarding state — every row
 *   'Not connected', tone 'empty', with a connect action; summary line reads
 *   `Integrations 0 · Vault logins 0 · Google ✗ · Provider keys 0`.
 *
 *   TONES: connected / partial / empty mapping — integrations configured but
 *   none connected → partial; a vault login without its automation grant →
 *   partial; live connections → connected.
 *
 *   SECRET SAFETY (hard suite): inputs whose names/metadata carry key-like
 *   VALUES ('sk-live-…', JWTs, bearer tokens, long hex/base64, passwords,
 *   ?token= URLs, secretish provider names) produce a serialized panel model
 *   containing NONE of them; assertNoSecretValues holds on the whole model.
 *
 *   And: every export is total — degenerate/junk input never throws.
 *
 * Pure — loads under tsx (panel core imports only connectedResourcesDigest).
 */

import {
  buildConnectedResourcesPanel,
  MAX_PANEL_ITEMS_PER_ROW,
  type ConnectedResourcePanelRow,
} from '../src/lib/connectedResourcesPanelCore';
import {
  assertNoSecretValues,
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

function rowByKey(rows: ConnectedResourcePanelRow[], key: string): ConnectedResourcePanelRow {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`missing row ${key}`);
  return row;
}

function main(): void {
  // ── (1) Full fixture — counts, ordering, bounded items, connect actions ──────
  const full: ConnectedResourcesInput = {
    integrations: [
      { provider: 'slack', label: 'Slack', status: 'connected', connected: true },
      { provider: 'github', label: 'GitHub', status: 'connected', connected: true },
      { provider: 'wordpress', label: 'Acme WP', status: 'connected', connected: true },
      { provider: 'notion', label: 'Notion', status: 'configured', connected: false },
    ],
    vaultCredentials: [
      { platform: 'wordpress', label: 'Acme Blog', siteUrl: 'https://acme.com', username: 'admin@acme.com', loginAllowed: true, hasLoginGrant: true },
      { platform: 'shopify', label: 'Acme Store', loginAllowed: true, hasLoginGrant: true },
    ],
    googleWorkspace: { connected: true, email: 'team@acme.com', services: ['gmail', 'drive', 'sheets'] },
    providerKeys: [
      { provider: 'anthropic' }, { provider: 'openai' }, { provider: 'groq' },
    ],
  };
  const model = buildConnectedResourcesPanel(full);
  assertEq(model.rows.length, 4, '(1) exactly four rows');
  assertEq(model.rows.map((r) => r.key).join(','), 'integrations,vault,google,provider_keys', '(1) fixed row order');
  assertEq(model.summaryLine, 'Integrations 4 · Vault logins 2 · Google ✓ · Provider keys 3', '(1) summary line');
  assertEq(model.connectedSectionCount, 4, '(1) all four sections connected');

  const ints = rowByKey(model.rows, 'integrations');
  assertEq(ints.countLabel, '3 connected', '(1) integrations count = connected rows only');
  assertEq(ints.tone, 'connected', '(1) integrations tone');
  assert(ints.items[0] === 'Slack' && ints.items.includes('Notion'), '(1) integration items lead with connected, include configured', JSON.stringify(ints.items));
  assertEq(ints.connectAction.targetTab, 'INTEGRATIONS', '(1) integrations connect targets Marketplace tab');
  assert(ints.connectAction.label.includes('Connect more'), '(1) integrations connect label');

  const vault = rowByKey(model.rows, 'vault');
  assertEq(vault.countLabel, '2 saved', '(1) vault count label');
  assertEq(vault.tone, 'connected', '(1) vault tone (all grants present)');
  assert(vault.items.includes('Acme Blog (wordpress)'), '(1) vault item = label (platform)', JSON.stringify(vault.items));
  assertEq(vault.connectAction.targetTab, 'VAULT', '(1) vault connect targets Vault tab');

  const google = rowByKey(model.rows, 'google');
  assertEq(google.countLabel, 'Connected ✓', '(1) google connected label');
  assert(google.items.includes('team@acme.com') && google.items.includes('gmail'), '(1) google items carry email + services', JSON.stringify(google.items));
  assert(!google.connectAction.targetTab, '(1) google connect has no circle tab (Circle Settings screen)');

  const keys = rowByKey(model.rows, 'provider_keys');
  assertEq(keys.countLabel, '3 keys', '(1) provider keys count label');
  assert(keys.items.includes('anthropic') && keys.items.includes('openai'), '(1) provider key names listed', JSON.stringify(keys.items));
  assertEq(keys.connectAction.targetTab, 'INTEGRATIONS', '(1) provider keys connect targets Marketplace tab');

  // Singular key label.
  const oneKey = buildConnectedResourcesPanel({ providerKeys: [{ provider: 'anthropic' }] });
  assertEq(rowByKey(oneKey.rows, 'provider_keys').countLabel, '1 key', '(1) singular key label');

  // ── (2) Bounded item lists + '+N more' + dedupe ──────────────────────────────
  const many = buildConnectedResourcesPanel({
    integrations: Array.from({ length: 10 }, (_, i) => ({
      provider: `prov${i}`, label: `App ${i}`, status: 'connected', connected: true,
    })),
    providerKeys: [
      { provider: 'openai' }, { provider: 'OpenAI' }, { provider: 'openai' },
      { provider: 'anthropic' },
    ],
  });
  const manyInts = rowByKey(many.rows, 'integrations');
  assertEq(manyInts.items.length, MAX_PANEL_ITEMS_PER_ROW + 1, '(2) 10 integrations → 6 names + overflow entry');
  assertEq(manyInts.items[MAX_PANEL_ITEMS_PER_ROW], '+4 more', '(2) overflow entry text');
  assertEq(manyInts.countLabel, '10 connected', '(2) count label reflects full total');
  const manyKeys = rowByKey(many.rows, 'provider_keys');
  assertEq(manyKeys.countLabel, '2 keys', '(2) provider keys deduped case-insensitively');
  assertEq(manyKeys.items.length, 2, '(2) deduped provider key items');
  assert(!manyKeys.items.some((i) => i.startsWith('+')), '(2) no phantom overflow after dedupe', JSON.stringify(manyKeys.items));

  // ── (3) Fresh-empty onboarding state ─────────────────────────────────────────
  for (const empty of [undefined, null, {}, { integrations: [], vaultCredentials: [], googleWorkspace: null, providerKeys: [] }] as const) {
    const m = buildConnectedResourcesPanel(empty as ConnectedResourcesInput | null | undefined);
    assertEq(m.rows.length, 4, '(3) empty input still yields four rows');
    assertEq(m.connectedSectionCount, 0, '(3) empty input → zero connected sections');
    assertEq(m.summaryLine, 'Integrations 0 · Vault logins 0 · Google ✗ · Provider keys 0', '(3) empty summary line');
    for (const row of m.rows) {
      assertEq(row.countLabel, 'Not connected', `(3) ${row.key} reads Not connected`);
      assertEq(row.tone, 'empty', `(3) ${row.key} tone empty`);
      assertEq(row.items.length, 0, `(3) ${row.key} has no items`);
      assert(row.connectAction.label.length > 0, `(3) ${row.key} keeps its connect action`);
      assert(row.icon.length > 0 && row.title.length > 0, `(3) ${row.key} icon+title present`);
    }
  }

  // ── (4) Tone mapping ─────────────────────────────────────────────────────────
  const partial = buildConnectedResourcesPanel({
    integrations: [{ provider: 'slack', label: 'Slack', status: 'configured', connected: false }],
    vaultCredentials: [
      { platform: 'wordpress', label: 'Acme Blog', loginAllowed: true, hasLoginGrant: false },
    ],
    googleWorkspace: { connected: false },
  });
  assertEq(rowByKey(partial.rows, 'integrations').tone, 'partial', '(4) configured-but-unconnected integrations → partial');
  assertEq(rowByKey(partial.rows, 'integrations').countLabel, '1 configured, none connected', '(4) partial integrations label');
  assertEq(rowByKey(partial.rows, 'vault').tone, 'partial', '(4) login without automation grant → partial');
  assertEq(rowByKey(partial.rows, 'google').tone, 'empty', '(4) google not connected → empty');
  assertEq(rowByKey(partial.rows, 'google').countLabel, 'Not connected', '(4) google not-connected label');
  assertEq(partial.connectedSectionCount, 0, '(4) partial sections do not count as connected');

  const granted = buildConnectedResourcesPanel({
    vaultCredentials: [{ platform: 'wordpress', label: 'Acme Blog', loginAllowed: true, hasLoginGrant: true }],
  });
  assertEq(rowByKey(granted.rows, 'vault').tone, 'connected', '(4) granted login → connected');

  // ── (5) SECRET SAFETY — key-like values planted in every name/metadata slot ──
  const JWT_VALUE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const SK_LIVE = 'sk-live-abc';
  const SK_LONG = 'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
  const BEARER = 'Bearer eyJzb21ldGhpbmci.tokenish';
  const LONG_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  const LONG_B64 = 'QWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVW';
  const PASSWORD_VALUE = 'Hunter2SuperSecretProdPassword42';
  const GHP = 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  const XOX = 'xoxb-1234567890-abcdefghijklmnop';

  const hostile: ConnectedResourcesInput = {
    integrations: [
      { provider: SK_LIVE, label: SK_LONG, status: 'connected', connected: true, capabilities: [JWT_VALUE], configuredSecretKeys: ['admin_password', JWT_VALUE, PASSWORD_VALUE] },
      { provider: 'slack', label: XOX, status: 'connected', connected: true },
      { provider: GHP, label: '', status: 'connected', connected: true },
    ],
    vaultCredentials: [
      { platform: LONG_HEX, label: BEARER, siteUrl: `https://acme.com/?token=${JWT_VALUE}`, username: PASSWORD_VALUE, allowedActions: [LONG_B64], loginAllowed: true, hasLoginGrant: false },
      { platform: 'wordpress', label: SK_LIVE, username: 'admin', loginAllowed: true, hasLoginGrant: true },
    ],
    googleWorkspace: { connected: true, email: JWT_VALUE, services: [SK_LIVE, 'gmail'] },
    providerKeys: [
      { provider: JWT_VALUE }, { provider: SK_LIVE }, { provider: 'access_token' },
      { provider: LONG_HEX }, { provider: 'anthropic' }, XOX as unknown as { provider: string },
    ],
    vaultDashboardHint: `visit https://x.test/?key=${LONG_HEX}`,
  };
  const hostileModel = buildConnectedResourcesPanel(hostile);
  const serialized = JSON.stringify(hostileModel);
  for (const [name, value] of [
    ['sk-live', SK_LIVE], ['sk-ant long key', SK_LONG], ['JWT', JWT_VALUE],
    ['bearer token', BEARER], ['long hex', LONG_HEX], ['long base64', LONG_B64],
    ['password value', PASSWORD_VALUE], ['github token', GHP], ['slack token', XOX],
    ['secretish key name', 'admin_password'],
  ] as const) {
    assert(!serialized.includes(value), `(5) serialized panel never contains ${name}`);
  }
  assert(assertNoSecretValues(serialized), '(5) assertNoSecretValues holds on the whole serialized model');
  assert(!serialized.includes('token='), '(5) no token query fragment survives');
  // Sanity: legitimate names planted beside the hostile ones still surface.
  assert(serialized.includes('anthropic'), '(5) legitimate provider name survives the purge');
  assert(serialized.includes('gmail'), '(5) legitimate google service survives the purge');
  assert(serialized.includes('wordpress'), '(5) legitimate vault platform survives the purge');
  // Counts may include hostile rows (they exist) but items must not leak them.
  const hostileKeys = rowByKey(hostileModel.rows, 'provider_keys');
  assert(hostileKeys.items.every((i) => i === 'anthropic' || i.startsWith('+')), '(5) provider key items reduced to safe names', JSON.stringify(hostileKeys.items));

  // A value-shaped label with spaces but a secret pattern inside is dropped too.
  const inlineLeak = buildConnectedResourcesPanel({
    integrations: [{ provider: 'x', label: `prod key ${SK_LONG} backup`, status: 'connected', connected: true }],
  });
  assert(!JSON.stringify(inlineLeak).includes(SK_LONG), '(5) inline key inside a spaced label never surfaces');

  // ── (6) Totality — junk never throws ─────────────────────────────────────────
  const junkInputs: unknown[] = [
    undefined, null, 42, 'string', true, [], () => {},
    { integrations: 'nope', vaultCredentials: 7, googleWorkspace: 'yes', providerKeys: {} },
    { integrations: [null, 42, 'x', {}, { label: 9 }], vaultCredentials: [[], { platform: {} }], googleWorkspace: { connected: 'true' }, providerKeys: [null, 12, {}, { provider: null }] },
  ];
  for (const junk of junkInputs) {
    try {
      const m = buildConnectedResourcesPanel(junk as ConnectedResourcesInput);
      assertEq(m.rows.length, 4, '(6) junk input still yields four rows');
      assert(typeof m.summaryLine === 'string' && m.summaryLine.length > 0, '(6) junk input yields a summary line');
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (6) junk input threw: ${(e as Error)?.message}`);
    }
  }
  // Stringly google `connected` must not count as connected (digest parity).
  const stringlyGoogle = buildConnectedResourcesPanel({ googleWorkspace: { connected: 'true' } as never });
  assertEq(rowByKey(stringlyGoogle.rows, 'google').tone, 'empty', '(6) non-boolean google connected stays empty');

  // ── (7) Determinism ──────────────────────────────────────────────────────────
  assertEq(JSON.stringify(buildConnectedResourcesPanel(full)), JSON.stringify(buildConnectedResourcesPanel(full)), '(7) deterministic for identical input');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll connected-resources-panel-core smoke cases passed (${passes} passed).`);
}

main();
