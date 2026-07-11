/**
 * Smoke test for src/lib/messagingNotify.ts (PURE, tsx-loadable).
 *
 * Run: npx tsx scripts/messaging-notify-smoketest.ts
 *
 * Covers the outbound team-channel messaging payload builders + validation:
 *   1. Provider-correct payload shape (Slack text/blocks, Discord content/embed,
 *      Teams MessageCard).
 *   2. Bounds: title/body/field clamps and field-count cap.
 *   3. Secret scrub: a token in body/title/fields NEVER appears in output.
 *   4. validateMessagingNotifyArgs: bad provider rejected, missing body rejected,
 *      good args normalized.
 *   5. describeMessagingNotify wording.
 *   6. Degenerate inputs never throw.
 *
 * This module is dependency-light (import type only) so it loads under
 * tsx/esbuild without pulling react-native.
 */

import {
  buildMessagingPayload,
  describeMessagingNotify,
  isMessagingProvider,
  MESSAGING_LIMITS,
  MESSAGING_PROVIDERS,
  scrubSecrets,
  validateMessagingNotifyArgs,
  type MessagingProvider,
} from '../src/lib/messagingNotify';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    // eslint-disable-next-line no-console
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL  ${label}`);
  }
}

// A serialized-JSON haystack helper so "secret never appears" checks are total.
function json(value: unknown): string {
  return JSON.stringify(value);
}

// ── 1. Slack payload shape ───────────────────────────────────────────────────
{
  const p = buildMessagingPayload('slack', {
    title: 'Deploy complete',
    body: 'Shipped v1.2.3 to production.',
    linkUrl: 'https://example.com/run/42',
    fields: [{ label: 'Env', value: 'prod' }, { label: 'Duration', value: '3m' }],
  });
  assert('slack has text fallback', typeof p.text === 'string' && (p.text as string).includes('Shipped v1.2.3'));
  assert('slack has blocks array', Array.isArray(p.blocks));
  const blocks = p.blocks as Array<Record<string, unknown>>;
  assert('slack header block present', blocks.some((b) => b.type === 'header'));
  assert('slack section block present', blocks.some((b) => b.type === 'section' && (b as any).text?.type === 'mrkdwn'));
  assert('slack fields block present', blocks.some((b) => b.type === 'section' && Array.isArray((b as any).fields)));
  assert('slack actions/button present for linkUrl', blocks.some((b) => b.type === 'actions'));
  assert('slack context footer present', blocks.some((b) => b.type === 'context'));
  // No linkUrl -> no actions block.
  const noLink = buildMessagingPayload('slack', { body: 'hi' });
  assert('slack without link -> no actions block', !(noLink.blocks as any[]).some((b) => b.type === 'actions'));
}

// ── 2. Discord payload shape ─────────────────────────────────────────────────
{
  const p = buildMessagingPayload('discord', {
    title: 'Alert',
    body: 'Error rate spiked.',
    linkUrl: 'https://example.com/incident/9',
    fields: [{ label: 'Service', value: 'api' }],
  });
  assert('discord has content string', typeof p.content === 'string' && (p.content as string).includes('Error rate spiked'));
  assert('discord content includes bold title', (p.content as string).includes('**Alert**'));
  assert('discord content includes link', (p.content as string).includes('https://example.com/incident/9'));
  assert('discord has embeds when title/fields present', Array.isArray(p.embeds) && (p.embeds as any[]).length === 1);
  const embed = (p.embeds as any[])[0];
  assert('discord embed has fields', Array.isArray(embed.fields) && embed.fields[0].name === 'Service');
  // Content hard cap at 2000.
  const big = buildMessagingPayload('discord', { body: 'x'.repeat(5000) });
  assert('discord content capped at 2000', (big.content as string).length <= 2000);
  // Plain body, no title, no fields -> no embed.
  const plain = buildMessagingPayload('discord', { body: 'just text' });
  assert('discord plain body -> no embed', plain.embeds === undefined);
}

// ── 3. Teams MessageCard shape ───────────────────────────────────────────────
{
  const p = buildMessagingPayload('teams', {
    title: 'Approval needed',
    body: 'Please approve the release.',
    linkUrl: 'https://example.com/approve/7',
    fields: [{ label: 'Requested by', value: 'agent' }, { label: 'Risk', value: 'low' }],
  });
  assert('teams @type is MessageCard', p['@type'] === 'MessageCard');
  assert('teams has @context', typeof p['@context'] === 'string');
  assert('teams has summary', typeof p.summary === 'string' && (p.summary as string).length > 0);
  assert('teams title set', p.title === 'Approval needed');
  assert('teams text set', p.text === 'Please approve the release.');
  assert('teams sections->facts present', Array.isArray(p.sections) && Array.isArray((p.sections as any[])[0].facts));
  assert('teams facts carry label/value', (p.sections as any[])[0].facts[0].name === 'Requested by');
  assert('teams potentialAction OpenUri for link', Array.isArray(p.potentialAction) && (p.potentialAction as any[])[0]['@type'] === 'OpenUri');
  // No link, no fields -> no sections / no potentialAction.
  const minimal = buildMessagingPayload('teams', { body: 'note' });
  assert('teams minimal -> no potentialAction', minimal.potentialAction === undefined);
  assert('teams minimal -> no sections', minimal.sections === undefined);
}

// ── 4. Bounds: title / body / fields clamp ───────────────────────────────────
{
  const longTitle = 'T'.repeat(500);
  const longBody = 'B'.repeat(5000);
  const manyFields = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`.repeat(50), value: `V${i}`.repeat(300) }));
  const v = validateMessagingNotifyArgs({ provider: 'slack', title: longTitle, body: longBody, fields: manyFields });
  assert('validate accepts oversized-but-clampable input', v.ok === true);
  if (v.ok) {
    assert('title clamped <= limit', (v.value.title || '').length <= MESSAGING_LIMITS.title);
    assert('body clamped <= limit', v.value.body.length <= MESSAGING_LIMITS.body);
    assert('fields capped <= 6', (v.value.fields || []).length <= MESSAGING_LIMITS.fields);
    const f0 = (v.value.fields || [])[0];
    assert('field label clamped', (f0?.label.length ?? 0) <= MESSAGING_LIMITS.fieldLabel);
    assert('field value clamped', (f0?.value.length ?? 0) <= MESSAGING_LIMITS.fieldValue);
  }
  // Builder itself clamps too (defense in depth) for each provider. Bound is
  // generous because the body is intentionally duplicated into the provider's
  // fallback text / embed description; what matters is a 20-field / 5000-char
  // hostile input cannot produce an UNBOUNDED payload (max ≈ title 200 + body
  // 3000 ×2 + 6 fields ×(80+500) ≈ 10.5KB for the largest, Slack).
  for (const provider of MESSAGING_PROVIDERS) {
    const built = buildMessagingPayload(provider, { title: longTitle, body: longBody, fields: manyFields });
    const size = json(built).length;
    assert(`${provider} payload stays bounded (<16000 chars)`, size < 16000);
    // Prove the field cap held (6, not 20) inside whatever provider shape.
    assert(`${provider} does not include 20th field label`, !json(built).includes('L19'));
  }
}

// ── 5. Secret scrub — a token NEVER reaches the payload ──────────────────────
{
  const secrets = [
    'xoxb-123456789012-abcdefghijklmnop',
    'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456',
    'api_key=SUPERSECRETVALUE123',
  ];
  for (const secret of secrets) {
    // scrubSecrets directly.
    assert(`scrubSecrets removes ${secret.slice(0, 10)}…`, !scrubSecrets(`leak ${secret} here`).includes(secret));
    // In body across all providers.
    for (const provider of MESSAGING_PROVIDERS) {
      const p = buildMessagingPayload(provider, { title: `key ${secret}`, body: `token is ${secret}`, fields: [{ label: secret, value: secret }] });
      assert(`${provider} payload never contains ${secret.slice(0, 8)}…`, !json(p).includes(secret));
    }
    // Through validation output.
    const v = validateMessagingNotifyArgs({ provider: 'slack', body: `body ${secret}`, title: secret, fields: [{ label: 'k', value: secret }] });
    assert(`validated args never contain ${secret.slice(0, 8)}…`, !json(v).includes(secret));
  }
}

// ── 6. validateMessagingNotifyArgs — rejections + normalization ──────────────
{
  assert('bad provider rejected', validateMessagingNotifyArgs({ provider: 'telegram', body: 'hi' }).ok === false);
  assert('missing provider rejected', validateMessagingNotifyArgs({ body: 'hi' }).ok === false);
  assert('missing body rejected', validateMessagingNotifyArgs({ provider: 'slack' }).ok === false);
  assert('empty body rejected', validateMessagingNotifyArgs({ provider: 'slack', body: '   ' }).ok === false);
  assert('non-object rejected', validateMessagingNotifyArgs(null).ok === false);
  assert('string arg rejected', validateMessagingNotifyArgs('nope').ok === false);

  const good = validateMessagingNotifyArgs({ provider: 'discord', body: 'ok', title: 'Hi', linkUrl: 'https://x.com', fields: [{ label: 'a', value: 'b' }] });
  assert('good args accepted', good.ok === true);
  if (good.ok) {
    assert('provider preserved', good.value.provider === 'discord');
    assert('body preserved', good.value.body === 'ok');
    assert('title preserved', good.value.title === 'Hi');
    assert('valid https link preserved', good.value.linkUrl === 'https://x.com');
    assert('fields preserved', (good.value.fields || []).length === 1);
  }

  // Non-http link is dropped, not accepted.
  const badLink = validateMessagingNotifyArgs({ provider: 'slack', body: 'x', linkUrl: 'javascript:alert(1)' });
  assert('non-http link dropped', badLink.ok === true && (badLink as any).value.linkUrl === undefined);
  const ftpLink = validateMessagingNotifyArgs({ provider: 'slack', body: 'x', linkUrl: 'ftp://host/file' });
  assert('ftp link dropped', ftpLink.ok === true && (ftpLink as any).value.linkUrl === undefined);

  // isMessagingProvider guard.
  assert('isMessagingProvider true for slack', isMessagingProvider('slack'));
  assert('isMessagingProvider false for telegram', !isMessagingProvider('telegram'));
  assert('isMessagingProvider false for number', !isMessagingProvider(5 as unknown));
}

// ── 7. describeMessagingNotify wording ───────────────────────────────────────
{
  assert('slack summary wording', describeMessagingNotify({ provider: 'slack', body: 'x' }) === 'Post a message to your Slack channel');
  assert('discord summary wording', describeMessagingNotify({ provider: 'discord', body: 'x' }) === 'Post a message to your Discord channel');
  assert('teams summary wording', describeMessagingNotify({ provider: 'teams', body: 'x' }) === 'Post a message to your Microsoft Teams channel');
  assert('summary includes title when present', describeMessagingNotify({ provider: 'slack', title: 'Deploy done', body: 'x' }).includes('Deploy done'));
  assert('summary safe for unknown provider', typeof describeMessagingNotify({ body: 'x' }) === 'string');
  assert('summary safe for garbage', typeof describeMessagingNotify(null) === 'string');
  // A secret in the title must not leak into the summary either.
  assert('summary scrubs secret in title', !describeMessagingNotify({ provider: 'slack', title: 'key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', body: 'x' }).includes('sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'));
}

// ── 8. Degenerate inputs never throw ─────────────────────────────────────────
{
  const degenerate: unknown[] = [
    undefined, null, 42, 'string', [], {}, { provider: 'slack' }, { body: 123 },
    { provider: 'slack', body: '', fields: 'not-an-array' },
    { provider: 'slack', body: 'x', fields: [null, 1, { label: '' }, {}] },
    { provider: 'teams', body: { nested: true } },
  ];
  for (const input of degenerate) {
    let threw = false;
    try {
      // Exercise every entry point.
      for (const provider of MESSAGING_PROVIDERS) buildMessagingPayload(provider, input as any);
      buildMessagingPayload('unknown' as MessagingProvider, input as any);
      validateMessagingNotifyArgs(input);
      describeMessagingNotify(input);
      scrubSecrets(input);
    } catch {
      threw = true;
    }
    assert(`degenerate input ${json(input)?.slice(0, 30)} never throws`, !threw);
  }
  // Empty-object build still yields a valid provider payload with a fallback body.
  const empty = buildMessagingPayload('slack', {} as any);
  assert('empty build has text fallback', typeof empty.text === 'string' && (empty.text as string).length > 0);
  const emptyDiscord = buildMessagingPayload('discord', {} as any);
  assert('empty discord build has content', typeof emptyDiscord.content === 'string');
  const emptyTeams = buildMessagingPayload('teams', {} as any);
  assert('empty teams build is a MessageCard', emptyTeams['@type'] === 'MessageCard');
  // Unknown provider falls back to slack shape (validation is the real gate).
  const unknown = buildMessagingPayload('nope' as MessagingProvider, { body: 'x' });
  assert('unknown provider falls back to slack shape', Array.isArray(unknown.blocks));
}

// ── 9. Approval-key parity contract (edge ⇄ client) ──────────────────────────
// The messaging-notify + custom-api-proxy edges verify a stored approval by
// recomputing buildApprovalKey(tool, args) and string-comparing it to the
// client's persisted toolApprovalKey. If the serializations diverge, the match
// ALWAYS fails and every approved post/write is rejected server-side. This pins
// the exact string the edge must produce against the canonical client builder.
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildOpenSwanToolApprovalKey,
    stableApprovalJson,
  } = require('../src/lib/openswanToolApprovals') as typeof import('../src/lib/openswanToolApprovals');

  const tool = 'messaging.notify';
  // Insertion order deliberately "wrong" so key-sorting actually matters.
  const args = { provider: 'slack', title: 'Deploy', body: 'shipped', fields: [{ value: 'v', label: 'k' }] };

  const clientKey = buildOpenSwanToolApprovalKey(tool, args);

  // FIXED edge formula (what buildApprovalKey now does): stableValue the whole
  // { version, tool, args } wrapper → top-level keys sorted too.
  const fixedEdgeKey = stableApprovalJson({ version: 1, tool, args });
  assert('edge fixed key === client canonical key', fixedEdgeKey === clientKey);

  // OLD buggy edge formula: sort only args, leave the literal wrapper in
  // insertion order. This MUST differ — the pin fails if anyone reverts.
  const buggyEdgeKey = JSON.stringify({ version: 1, tool, args: JSON.parse(stableApprovalJson(args)) });
  assert('old buggy edge key differed from client (regression guard)', buggyEdgeKey !== clientKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log(`\nmessaging-notify smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
