/**
 * transport-failover-badge-core-smoketest — guards the PURE failover render seam
 * (CHAT_OFFICE_FEED_NEXT_GAPS Finding 3):
 *
 *   - buildFailoverBadge: a fallback `servedBy` → compact chip
 *     ('via OpenRouter (Anthropic 529)'); a normal route → null (no noise).
 *   - who derivation (transport → model-prefix → generic) + reason prettify
 *     (provider-prefixed "anthropic: 529" → "Anthropic 529") + tone (info/warn).
 *   - failoverMetadataPatch: fallback → { failover: {…} } bounded; normal → {}.
 *   - readFailoverBadgeFromMetadata: round-trips a persisted row back to the
 *     identical badge; rejects junk.
 *   - secret-safety: keys/tokens leaked into any field never reach a chip or row.
 *   - bounds + hostile no-throw (null/undefined/wrong-type/huge/cyclic/hostile).
 *
 * Imports the REAL module (pure, zero runtime imports).
 * Run: npx tsx scripts/transport-failover-badge-core-smoketest.ts
 */

import {
  buildFailoverBadge,
  failoverMetadataPatch,
  readFailoverBadgeFromMetadata,
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
{
  const patch = failoverMetadataPatch({ transport: 'y'.repeat(400), model: 'z'.repeat(400), fallback: true, fallbackReason: 'w'.repeat(4000) });
  const f = (patch as any).failover;
  assert(!!f, 'huge input still yields a patch');
  assert((f.model?.length || 0) <= 80, 'patch.model clamped ≤ 80', String(f.model?.length));
  assert((f.transport?.length || 0) <= 48, 'patch.transport clamped ≤ 48', String(f.transport?.length));
  assert((f.reason?.length || 0) <= 120, 'patch.reason clamped ≤ 120', String(f.reason?.length));
  assert((f.label?.length || 0) <= 72, 'patch.label clamped ≤ 72', String(f.label?.length));
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
{
  const patch = failoverMetadataPatch({
    transport: `Bearer ${SECRET}`,
    model: `openai_compatible/${SECRET}`,
    fallback: true,
    fallbackReason: `api_key=${SECRET} rejected`,
  });
  assertNoSecret(patch, 'persisted patch carries no secret anywhere');
  assertNoSecret((patch as any).failover?.reason, 'patch.reason carries no secret');
  assertNoSecret((patch as any).failover?.model, 'patch.model carries no secret');
  assertNoSecret((patch as any).failover?.transport, 'patch.transport carries no secret');
}
// A long contiguous hex/base64 run is redacted too.
assertNoSecret(
  buildFailoverBadge({ transport: 'openrouter', fallback: true, fallbackReason: `token ${'a1b2c3d4'.repeat(6)} invalid` })?.label,
  'long token run is redacted from the label',
);

// ── 8. failoverMetadataPatch shape ────────────────────────────────────────────
assertEq(JSON.stringify(failoverMetadataPatch({ transport: 'openrouter' })), '{}', 'no fallback → {} (no-op merge)');
assertEq(JSON.stringify(failoverMetadataPatch({ transport: 'openrouter', fallback: false })), '{}', 'fallback:false → {}');
assertEq(JSON.stringify(failoverMetadataPatch(null)), '{}', 'null → {}');
{
  const patch = failoverMetadataPatch({
    model: 'anthropic/claude-3.5-sonnet',
    transport: 'openrouter',
    fallback: true,
    fallbackReason: 'anthropic: 529',
  });
  const f = (patch as any).failover;
  assert(!!f, 'fallback → { failover } present');
  assertEq(f.fallback, true, 'patch.failover.fallback true');
  assertEq(f.label, 'via OpenRouter (Anthropic 529)', 'patch carries the same label as the badge');
  assertEq(f.tone, 'warn', 'patch carries tone');
  assertEq(f.transport, 'openrouter', 'patch carries served transport');
  assertEq(f.model, 'anthropic/claude-3.5-sonnet', 'patch carries served model');
  assertEq(f.reason, 'anthropic: 529', 'patch carries the raw (redacted) reason');
  // Only the expected keys — bounded, no leakage of extra fields.
  assert(Object.keys(f).every((k) => ['fallback', 'label', 'tone', 'model', 'transport', 'reason'].includes(k)), 'patch keys are bounded to the allow-list', Object.keys(f).join(','));
}
{
  // Missing optionals are omitted, not stored as empty.
  const f = (failoverMetadataPatch({ fallback: true }) as any).failover;
  assert(!!f, 'bare fallback → patch present');
  assert(!('model' in f) && !('transport' in f) && !('reason' in f), 'empty optionals omitted from patch');
  assertEq(f.label, 'Served by a fallback route', 'bare fallback patch has the generic label');
}

// ── 9. readFailoverBadgeFromMetadata: round-trip + rejects junk ───────────────
{
  const servedBy = { model: 'anthropic/claude-3.5-sonnet', transport: 'openrouter', fallback: true, fallbackReason: 'anthropic: 529' };
  const live = buildFailoverBadge(servedBy);
  const patch = failoverMetadataPatch(servedBy);
  const readBack = readFailoverBadgeFromMetadata(patch);
  assert(readBack !== null, 'read-back from a persisted patch yields a badge');
  assertEq(readBack?.label, live?.label, 'round-trip label equals the live badge');
  assertEq(readBack?.tone, live?.tone, 'round-trip tone equals the live badge');
  assertEq(readBack?.detail, live?.detail, 'round-trip detail equals the live badge');
}
{
  // Accepts a wider persisted-metadata envelope (patch merged into a row).
  const row = { usage: { model: 'x' }, source: { actor: 'openswan' }, ...failoverMetadataPatch({ transport: 'groq', fallback: true, fallbackReason: 'openai: 503' }) };
  const badge = readFailoverBadgeFromMetadata(row);
  assertEq(badge?.label, 'via Groq (OpenAI 503)', 'reads the failover key out of a full metadata row');
}
{
  // Accepts the inner patch object directly (no `failover` wrapper).
  const badge = readFailoverBadgeFromMetadata({ fallback: true, transport: 'openrouter', reason: 'anthropic: 429' });
  assertEq(badge?.label, 'via OpenRouter (Anthropic 429)', 'reads a bare inner patch object');
}
assertEq(readFailoverBadgeFromMetadata({ usage: { model: 'x' } }), null, 'metadata with no failover key → null');
assertEq(readFailoverBadgeFromMetadata({ failover: { fallback: false, label: 'x' } }), null, 'persisted failover with fallback:false → null');
assertEq(readFailoverBadgeFromMetadata(null), null, 'null metadata → null');
assertEq(readFailoverBadgeFromMetadata({ failover: 'not-an-object' }), null, 'non-object failover → null');
// A secret that somehow sat in a persisted reason is re-redacted on read.
assertNoSecret(readFailoverBadgeFromMetadata({ failover: { fallback: true, transport: 'openrouter', reason: `key ${SECRET}` } })?.label, 'read-path re-redacts a persisted secret');

// ── 10. Hostile inputs never throw (all three exports) ────────────────────────
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
  noThrow(() => failoverMetadataPatch(input), `failoverMetadataPatch no-throw: ${label}`);
  noThrow(() => readFailoverBadgeFromMetadata(input), `readFailoverBadgeFromMetadata no-throw: ${label}`);
}
// Cyclic input still degrades to a coherent badge (top-level read only).
{
  const badge = buildFailoverBadge(cyclic);
  assertEq(badge?.label, 'via OpenRouter', 'cyclic input degrades to a coherent who-only badge');
}
// A patch is always a plain object (safe to spread), never null/array.
for (const input of hostiles) {
  const patch = failoverMetadataPatch(input);
  assert(patch !== null && typeof patch === 'object' && !Array.isArray(patch), 'patch is always a plain object', JSON.stringify(patch));
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
