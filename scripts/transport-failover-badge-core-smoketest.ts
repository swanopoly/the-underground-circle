/**
 * transport-failover-badge-core-smoketest — guards the PURE failover render seam
 * (CHAT_OFFICE_FEED_NEXT_GAPS Finding 3):
 *
 *   - buildFailoverBadge: a fallback `servedBy` → compact chip
 *     ('via OpenRouter (Anthropic 529)'); a normal route → null (no noise).
 *   - who derivation (transport → model-prefix → generic) + reason prettify
 *     (provider-prefixed "anthropic: 529" → "Anthropic 529") + tone (info/warn).
 *   - ChatTab adapter parity: the `failoverBadgeForMessage` mapping of a
 *     persisted `routing` block (routing_fallback → servedBy) yields the
 *     canonical chip. (The `failoverMetadataPatch` / `readFailoverBadgeFromMetadata`
 *     pair was pruned — the persisted routing block already round-trips this.)
 *   - secret-safety: keys/tokens leaked into any field never reach a chip.
 *   - bounds + hostile no-throw (null/undefined/wrong-type/huge/cyclic/hostile).
 *
 * Imports the REAL module (pure, zero runtime imports).
 * Run: npx tsx scripts/transport-failover-badge-core-smoketest.ts
 */

import {
  buildFailoverBadge,
  type FailoverBadge,
} from '../src/lib/transportFailoverBadgeCore';

let failures = 0;
let passes = 0;
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) {
    passes += 1;
  } else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`);
  }
}
function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function noThrow(fn: () => unknown, message: string): unknown {
  try {
    const value = fn();
    passes += 1;
    return value;
  } catch (err) {
    failures += 1;
    console.error('FAIL (threw):', message, err);
    return undefined;
  }
}

// A secret must never appear in any user-visible / persisted string.
const SECRET = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function assertNoSecret(text: unknown, message: string): void {
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  assert(!s.includes('sk-ant-') && !s.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), message, s);
}

// ── 1. Normal route → null (no noise) ─────────────────────────────────────────
assertEq(buildFailoverBadge({ model: 'claude-haiku-4-5', transport: 'chat-stream' }), null, 'no fallback field → null');
assertEq(buildFailoverBadge({ model: 'x', transport: 'openrouter', fallback: false }), null, 'fallback:false → null');
assertEq(buildFailoverBadge({ provider: 'openrouter', modelId: 'auto', label: 'OpenRouter' }), null, 'bare ProviderRoute (no fallback) → null');
assertEq(buildFailoverBadge({ model: 'gpt-4o', transport: 'swanbot', fallback: 0 }), null, 'fallback:0 → null');
assertEq(buildFailoverBadge({ fallbackReason: 'anthropic: 529' }), null, 'reason present but fallback unset → null (gate is fallback)');
assertEq(buildFailoverBadge({}), null, 'empty object → null');

// ── 2. Fallback badge — the exact task example ────────────────────────────────
{
  const badge = buildFailoverBadge({
    model: 'anthropic/claude-3.5-sonnet',
    transport: 'openrouter',
    fallback: true,
    fallbackReason: 'anthropic: 529',
  });
  assert(badge !== null, 'fallback servedBy → badge (not null)');
  assertEq(badge?.label, 'via OpenRouter (Anthropic 529)', 'label matches the canonical example');
  assertEq(badge?.show, true, 'show is true on a returned badge');
  assertEq(badge?.tone, 'warn', '529 → warn tone');
  assert((badge?.detail || '').includes('OpenRouter'), 'detail names the serving provider');
  assert((badge?.detail || '').includes('Anthropic 529'), 'detail carries the reason');
  assert((badge?.detail || '').includes('may differ'), 'detail warns quality/cost/latency may differ');
}

// String 'true' fallback flag (untrusted round-trip) still fires.
assert(buildFailoverBadge({ transport: 'groq', fallback: 'true', fallbackReason: 'anthropic: overloaded' }) !== null, "fallback:'true' string fires");
assert(buildFailoverBadge({ transport: 'groq', fallback: 1 }) !== null, 'fallback:1 fires');

// ── 3. Who derivation ─────────────────────────────────────────────────────────
assertEq(
  buildFailoverBadge({ transport: 'openrouter', fallback: true })?.label,
  'via OpenRouter',
  'transport-derived who, no reason',
);
assertEq(
  buildFailoverBadge({ model: 'together_ai/llama-3.1-70b', fallback: true })?.label,
  'via Together AI',
  'model-prefix-derived who when transport absent',
);
assertEq(
  buildFailoverBadge({ model: 'claude-haiku-4-5', fallback: true })?.label,
  'Served by a fallback route',
  'no transport + non-provider-prefixed model → generic label (never title-case a model as who)',
);
assertEq(
  buildFailoverBadge({ fallback: true })?.label,
  'Served by a fallback route',
  'no who + no reason → generic label',
);
assertEq(
  buildFailoverBadge({ transport: 'my_custom_relay', fallback: true })?.label,
  'via My Custom Relay',
  'unknown transport is title-cased',
);
assertEq(
  buildFailoverBadge({ transport: 'huggingface_endpoint', fallback: true })?.label,
  'via Hugging Face',
  'alias transport maps to a clean label',
);

// ── 4. Reason prettify ────────────────────────────────────────────────────────
assertEq(
  buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: 'anthropic: 529 overloaded' })?.label,
  'via OpenRouter (Anthropic 529 overloaded)',
  'provider-prefixed reason → prettified provider + detail',
);
assertEq(
  buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: 'primary was slow' })?.label,
  'via OpenRouter (primary was slow)',
  'non-provider reason passes through verbatim',
);
assertEq(
  buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: '   ' })?.label,
  'via OpenRouter',
  'blank reason → who-only label',
);
assertEq(
  buildFailoverBadge({ fallback: true, fallbackReason: 'deepseek: timeout' })?.label,
  'Fell back — DeepSeek timeout',
  'reason-only (no who) → "Fell back —" prefix with prettified reason',
);
// `reason` (not `fallbackReason`) is also accepted defensively.
assertEq(
  buildFailoverBadge({ transport: 'groq', fallback: true, reason: 'anthropic: 500' })?.label,
  'via Groq (Anthropic 500)',
  'alt `reason` key is honored',
);

// ── 5. Tone: warn on hard failure, info on benign reroute ─────────────────────
const warnReasons = ['anthropic: 529', 'anthropic: 429 rate limit', 'openai: 500 internal error', 'timeout', 'provider overloaded', 'auth 401', 'quota exhausted', 'integration not connected'];
for (const r of warnReasons) {
  assertEq(buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: r })?.tone, 'warn', `warn tone for reason: ${r}`);
}
const infoReasons = ['cost preference', 'user routing preference', 'cheaper route available'];
for (const r of infoReasons) {
  assertEq(buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: r })?.tone, 'info', `info tone for reason: ${r}`);
}
assertEq(buildFailoverBadge({ transport: 'openrouter', fallback: true })?.tone, 'info', 'no reason → info tone');

// ── 6. Bounds: every emitted string is clamped ────────────────────────────────
{
  const huge = 'x'.repeat(5000);
  const badge = buildFailoverBadge({ transport: huge, model: huge, fallback: true, fallbackReason: huge });
  assert(badge !== null, 'huge input still yields a badge');
  assert((badge?.label.length || 0) <= 72, 'label is clamped ≤ 72', String(badge?.label.length));
  assert((badge?.detail.length || 0) <= 220, 'detail is clamped ≤ 220', String(badge?.detail.length));
  assert(badge?.tone === 'info' || badge?.tone === 'warn', 'tone stays a valid enum');
}

// ── 7. Secret-safety: leaked keys/tokens never reach a chip or a row ──────────
{
  const badge = buildFailoverBadge({
    transport: 'openrouter',
    model: `anthropic/${SECRET}`,
    fallback: true,
    fallbackReason: `auth failed for key ${SECRET}`,
  });
  assert(badge !== null, 'secret-laden fallback still yields a badge');
  assertNoSecret(badge?.label, 'badge.label carries no secret');
  assertNoSecret(badge?.detail, 'badge.detail carries no secret');
  assert((badge?.label || '').includes('[redacted]') || !(badge?.label || '').includes('sk-ant-'), 'secret in label is redacted/absent');
  assertEq(badge?.tone, 'warn', 'auth-failure reason → warn');
}
// A long contiguous hex/base64 run is redacted too.
assertNoSecret(
  buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: `token ${'a1b2c3d4'.repeat(6)} invalid` })?.label,
  'long token run is redacted from the label',
);

// ── 8. ChatTab adapter parity — failoverBadgeForMessage's exact mapping ───────
// Mirrors `failoverBadgeForMessage` in ChatTab.tsx (keep in sync): the badge is
// rebuilt from the PERSISTED `routing` block (routing_fallback survives the
// persistedChatMetadata round-trip), so this mapping IS the round-trip path.
type AdapterMessage = {
  isBot?: boolean;
  routing?: { provider_routed?: string; provider_model?: string; routing_fallback?: { provider: string; reason: string } };
  usage?: { model?: string };
};
function adapterBadge(message: AdapterMessage): FailoverBadge | null {
  const rf = message.isBot ? message.routing?.routing_fallback : null;
  if (!rf) return null;
  return buildFailoverBadge({
    fallback: true,
    model: message.routing?.provider_model ?? message.usage?.model ?? null,
    transport: message.routing?.provider_routed ?? null,
    fallbackReason: `${rf.provider}: ${rf.reason}`,
  });
}
{
  // The item's canonical example: OpenRouter 529 → served via Anthropic.
  const badge = adapterBadge({
    isBot: true,
    routing: {
      provider_routed: 'anthropic',
      provider_model: 'claude-haiku-4-5',
      routing_fallback: { provider: 'openrouter', reason: '529' },
    },
  });
  assertEq(badge?.label, 'via Anthropic (OpenRouter 529)', 'persisted routing block → canonical chip');
  assertEq(badge?.tone, 'warn', '529 fallback → warn tone');
  assert((badge?.detail || '').includes('Anthropic'), 'adapter detail names the serving provider');
}
assertEq(adapterBadge({ isBot: true, routing: { provider_routed: 'anthropic', provider_model: 'claude-haiku-4-5' } }), null, 'routing without routing_fallback → no chip (no noise)');
assertEq(adapterBadge({ isBot: true }), null, 'no routing block → no chip');
assertEq(adapterBadge({ isBot: false, routing: { routing_fallback: { provider: 'openrouter', reason: '529' } } }), null, 'user message never gets a failover chip');
{
  // provider_routed absent → who falls back to the served model's provider prefix.
  const badge = adapterBadge({
    isBot: true,
    routing: { routing_fallback: { provider: 'openrouter', reason: 'timeout' } },
    usage: { model: 'groq/llama-3.1-70b' },
  });
  assertEq(badge?.label, 'via Groq (OpenRouter timeout)', 'usage.model prefix derives who when provider_routed absent');
}
// An unbounded / secret-laden edge reason never reaches the chip raw.
{
  const badge = adapterBadge({
    isBot: true,
    routing: { provider_routed: 'anthropic', routing_fallback: { provider: 'openrouter', reason: `auth failed for key ${SECRET} ${'x'.repeat(4000)}` } },
  });
  assert(badge !== null, 'hostile edge reason still yields a chip');
  assertNoSecret(badge?.label, 'adapter chip label carries no secret');
  assertNoSecret(badge?.detail, 'adapter chip detail carries no secret');
  assert((badge?.label.length || 0) <= 72, 'adapter chip label stays clamped ≤ 72', String(badge?.label.length));
}

// ── 10. Hostile inputs never throw ────────────────────────────────────────────
const cyclic: any = { fallback: true, transport: 'openrouter' };
cyclic.self = cyclic;
cyclic.chain = { back: cyclic };
const nan = { fallback: true, model: NaN, transport: NaN, fallbackReason: NaN };
const weird = { fallback: true, transport: Symbol('s'), model: () => 1, fallbackReason: { toString() { throw new Error('boom'); } } };
const hostiles: unknown[] = [
  null, undefined, 0, 1, -1, NaN, Infinity, '', 'string', true, false,
  [], [1, 2, 3], {}, { fallback: true }, { fallback: 'true' },
  cyclic, nan, weird,
  Object.create(null),
  new Map(), new Set(),
  { fallback: true, transport: 12345, model: [], fallbackReason: [] },
  { fallback: {}, fallbackReason: {} },
];
for (const input of hostiles) {
  const label = JSON.stringify(input === undefined ? 'undefined' : (typeof input === 'object' && input && (input as any).self ? 'cyclic' : input)) || String(input);
  noThrow(() => buildFailoverBadge(input), `buildFailoverBadge no-throw: ${label}`);
}
// Cyclic input still degrades to a coherent badge (top-level read only).
{
  const badge = buildFailoverBadge(cyclic);
  assertEq(badge?.label, 'via OpenRouter', 'cyclic input degrades to a coherent who-only badge');
}
// buildFailoverBadge is always null or the full shape.
for (const input of hostiles) {
  const badge = buildFailoverBadge(input) as FailoverBadge | null;
  assert(
    badge === null || (typeof badge.show === 'boolean' && typeof badge.label === 'string' && (badge.tone === 'info' || badge.tone === 'warn') && typeof badge.detail === 'string'),
    'badge is null or a complete FailoverBadge',
    JSON.stringify(badge),
  );
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`transport-failover-badge-core smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('transport-failover-badge-core smoke: ALL PASS');
