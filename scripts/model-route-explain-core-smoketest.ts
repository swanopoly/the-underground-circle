/**
 * model-route-explain-core-smoketest — pins the pure "why this model / route"
 * explainer (src/lib/modelRouteExplainCore.ts) that turns an invisible routing
 * decision (chosen model, provider, fallback reason, BlackSwan tool-executor
 * swap, escalation, BYOK) into a friendly, bounded, secret-safe one-liner +
 * detail + badge chips for a chat route-chip / OpenSwan console. Load-bearing
 * assertions:
 *
 *   PRETTIFY: prettyModelName mirrors describeFallbackModelForNotice
 *   (`anthropic/claude-haiku-4-5-20251001` -> `Claude Haiku 4.5`, any BlackSwan
 *   id -> `BlackSwan`, `openrouter/auto` -> `Auto-route`, gpt/gemini families);
 *   prettyProviderName mirrors the app's provider labels + alias normalization
 *   (`huggingface_endpoint` -> `Hugging Face`, `z_ai` -> `z.ai`,
 *   `anthropic-direct` -> `Anthropic`).
 *
 *   EXPLAIN: a BlackSwan + Haiku tool-executor route -> "BlackSwan grounding +
 *   Claude Haiku 4.5 tool executor" with ['BlackSwan','Tool executor']; a
 *   fallback route NAMES the reason (529 -> overloaded) + provider + a
 *   'Fallback' badge; an Auto-lane escalation names the escalation reason with an
 *   'Escalated' badge; a BYOK route is flagged with a 'Your key' badge + a BYOK
 *   detail; BlackSwan-primary / plain-model / provider-only routes read cleanly;
 *   empty input -> a neutral explanation.
 *
 *   BOUNDED + SECRET-SAFE: short/detail/badges are length-capped, badges deduped
 *   and count-capped (≤ MAX_BADGES); a Bearer/sk-/JWT secret embedded in any
 *   field (reason / model / fallbackFrom / toolExecutor) NEVER survives into the
 *   copy or a badge.
 *
 *   TOTALITY: every export survives null / undefined / number / bigint / symbol /
 *   function / array / huge / circular / Proxy-with-throwing-getters input
 *   without throwing, always returning a valid bounded shape.
 *
 * Pure — loads under tsx (modelRouteExplainCore has zero imports).
 */

import {
  explainRoute,
  prettyModelName,
  prettyProviderName,
  MAX_BADGES,
} from '../src/lib/modelRouteExplainCore';
import type { RouteExplanation } from '../src/lib/modelRouteExplainCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

/** A secret that must never appear in any output. */
const SECRET_FRAG = 'DEADBEEFdeadbeef';
const SK_SECRET = `sk-ant-api03-${SECRET_FRAG}LEAK`;

function isValid(e: RouteExplanation): boolean {
  return !!e && typeof e === 'object'
    && typeof e.short === 'string' && e.short.length > 0 && e.short.length <= 160
    && typeof e.detail === 'string' && e.detail.length <= 400
    && Array.isArray(e.badges) && e.badges.length <= MAX_BADGES
    && e.badges.every((b) => typeof b === 'string' && b.length > 0 && b.length <= 24);
}

function blob(e: RouteExplanation): string {
  return `${e.short}\n${e.detail}\n${e.badges.join('\n')}`;
}
function leaks(e: RouteExplanation, frag: string): boolean {
  return blob(e).includes(frag);
}
function badgeCount(e: RouteExplanation, b: string): number {
  return e.badges.filter((x) => x === b).length;
}

function main(): void {
  // ─── (1) prettyModelName ───────────────────────────────────────────────────
  assertEq(prettyModelName('cswan801/BlackSwan-v5'), 'BlackSwan', '(1) hosted BlackSwan repo id');
  assertEq(prettyModelName('huggingface_endpoint/cswan801/BlackSwan-v5'), 'BlackSwan', '(1) endpoint BlackSwan id');
  assertEq(prettyModelName('blackswan'), 'BlackSwan', '(1) bare blackswan');
  assertEq(prettyModelName('ollama/blackswan'), 'BlackSwan', '(1) local ollama blackswan');
  assertEq(prettyModelName('claude-opus-4-8'), 'Claude Opus 4.8', '(1) claude bare');
  assertEq(prettyModelName('anthropic/claude-opus-4-8'), 'Claude Opus 4.8', '(1) claude provider-prefixed');
  assertEq(prettyModelName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5', '(1) claude date suffix stripped');
  assertEq(prettyModelName('anthropic/claude-haiku-4-5-20251001'), 'Claude Haiku 4.5', '(1) claude prefix + date');
  assertEq(prettyModelName('openrouter/auto'), 'Auto-route', '(1) openrouter/auto');
  assertEq(prettyModelName('gpt-5.5'), 'GPT-5.5', '(1) gpt version');
  assertEq(prettyModelName('gpt-5.4-mini'), 'GPT-5.4 Mini', '(1) gpt mini');
  assertEq(prettyModelName('gpt-4o'), 'GPT-4o', '(1) gpt-4o');
  assertEq(prettyModelName('google/gemini-2.5-pro'), 'Gemini 2.5 Pro', '(1) gemini pro');
  assertEq(prettyModelName('gemini-3.1-flash-lite'), 'Gemini 3.1 Flash Lite', '(1) gemini flash lite');
  assert(prettyModelName('meta-llama/Llama-3.3-70B-Instruct').includes('Llama-3.3-70B'), '(1) llama passthrough', prettyModelName('meta-llama/Llama-3.3-70B-Instruct'));
  assertEq(prettyModelName(''), '', '(1) empty -> empty');
  assertEq(prettyModelName('   '), '', '(1) whitespace -> empty');
  assertEq(prettyModelName(null), '', '(1) null -> empty');

  // ─── (2) prettyProviderName ────────────────────────────────────────────────
  assertEq(prettyProviderName('openrouter'), 'OpenRouter', '(2) openrouter');
  assertEq(prettyProviderName('anthropic'), 'Anthropic', '(2) anthropic');
  assertEq(prettyProviderName('anthropic-direct'), 'Anthropic', '(2) anthropic-direct alias');
  assertEq(prettyProviderName('huggingface'), 'Hugging Face', '(2) huggingface');
  assertEq(prettyProviderName('huggingface_endpoint'), 'Hugging Face', '(2) huggingface_endpoint alias');
  assertEq(prettyProviderName('hugging_face'), 'Hugging Face', '(2) hugging_face alias');
  assertEq(prettyProviderName('z_ai'), 'z.ai', '(2) z_ai alias');
  assertEq(prettyProviderName('google_ai'), 'Google AI', '(2) google_ai');
  assertEq(prettyProviderName('openai'), 'OpenAI', '(2) openai');
  assertEq(prettyProviderName('together_ai'), 'Together AI', '(2) together_ai');
  assertEq(prettyProviderName('deepseek'), 'DeepSeek', '(2) deepseek');
  assertEq(prettyProviderName('openswan'), 'OpenSwan', '(2) openswan');
  assertEq(prettyProviderName('blackswan'), 'BlackSwan', '(2) blackswan provider');
  assertEq(prettyProviderName('weird_provider'), 'Weird Provider', '(2) unknown title-cased');
  assertEq(prettyProviderName(''), '', '(2) empty -> empty');
  assertEq(prettyProviderName(null), '', '(2) null -> empty');

  // ─── (3) constant + basic shape ────────────────────────────────────────────
  assertEq(MAX_BADGES, 6, '(3) MAX_BADGES is 6');
  assert(isValid(explainRoute({ model: 'claude-opus-4-8' })), '(3) basic route is a valid shape');
  assert(Array.isArray(explainRoute({}).badges), '(3) badges is always an array');

  // ─── (4) BlackSwan + tool-executor swap ────────────────────────────────────
  const exec = explainRoute({ model: 'cswan801/BlackSwan-v5', provider: 'anthropic', toolExecutor: 'claude-haiku-4-5' });
  assertEq(exec.short, 'BlackSwan grounding + Claude Haiku 4.5 tool executor', '(4) executor short');
  assert(exec.badges.includes('BlackSwan'), '(4) executor has BlackSwan badge', JSON.stringify(exec.badges));
  assert(exec.badges.includes('Tool executor'), '(4) executor has Tool executor badge', JSON.stringify(exec.badges));
  assert(exec.badges.includes('Anthropic'), '(4) executor has provider badge', JSON.stringify(exec.badges));
  assert(exec.detail.includes('grounding context'), '(4) executor detail explains grounding', exec.detail);
  assert(exec.detail.includes('tool loop'), '(4) executor detail explains tool loop', exec.detail);
  assert(isValid(exec), '(4) executor route valid/bounded');

  // ─── (5) BlackSwan primary ─────────────────────────────────────────────────
  const bsp = explainRoute({ model: 'cswan801/BlackSwan-v5', provider: 'huggingface' });
  assertEq(bsp.short, 'BlackSwan (app-trained) handled this', '(5) primary short');
  assert(bsp.badges.includes('BlackSwan'), '(5) primary BlackSwan badge', JSON.stringify(bsp.badges));
  assert(bsp.badges.includes('App-grounded'), '(5) primary App-grounded badge', JSON.stringify(bsp.badges));
  assert(bsp.badges.includes('Hugging Face'), '(5) primary provider badge', JSON.stringify(bsp.badges));
  assert(/app data|app-domain|grounding/i.test(bsp.detail), '(5) primary detail mentions app grounding', bsp.detail);
  assert(isValid(bsp), '(5) primary route valid/bounded');

  // ─── (6) fallback route NAMES the reason (529 -> overloaded) ───────────────
  const fall = explainRoute({ model: 'openrouter/auto', provider: 'openrouter', reason: '529', fallbackFrom: 'claude-opus-4-8' });
  assert(fall.short.startsWith('Fell back to'), '(6) fallback short starts with Fell back to', fall.short);
  assert(fall.short.includes('OpenRouter'), '(6) fallback short names provider', fall.short);
  assert(fall.short.includes('overloaded'), '(6) fallback short NAMES the reason', fall.short);
  assert(fall.badges.includes('Fallback'), '(6) fallback badge present', JSON.stringify(fall.badges));
  assert(fall.badges.includes('Overloaded'), '(6) overloaded reason badge present', JSON.stringify(fall.badges));
  assert(fall.badges.includes('OpenRouter'), '(6) fallback provider badge', JSON.stringify(fall.badges));
  assert(fall.detail.includes('Claude Opus 4.8'), '(6) fallback detail names the from-model', fall.detail);
  assert(isValid(fall), '(6) fallback route valid/bounded');
  // A 429 reads as rate-limited, a 500 as a server error.
  const rl = explainRoute({ model: 'claude-haiku-4-5', reason: '429', fallbackFrom: 'cswan801/BlackSwan-v5' });
  assert(rl.short.includes('rate-limited'), '(6) 429 -> rate-limited', rl.short);
  assert(rl.badges.includes('Rate-limited'), '(6) rate-limited badge', JSON.stringify(rl.badges));
  const se = explainRoute({ model: 'claude-haiku-4-5', reason: 'Edge Function returned a non-2xx status code', fallbackFrom: 'cswan801/BlackSwan-v5' });
  assert(se.badges.includes('Server error'), '(6) non-2xx -> server error badge', JSON.stringify(se.badges));

  // ─── (7) BlackSwan endpoint failover reasons (cold / not-connected) ────────
  const cold = explainRoute({ model: 'claude-haiku-4-5', provider: 'anthropic', reason: 'blackswan_endpoint_cold_or_unreachable', fallbackFrom: 'cswan801/BlackSwan-v5' });
  assert(cold.short.includes('waking up'), '(7) cold short says waking up', cold.short);
  assert(cold.badges.includes('Cold start'), '(7) cold badge', JSON.stringify(cold.badges));
  assert(cold.badges.includes('BlackSwan'), '(7) cold names BlackSwan (from-model)', JSON.stringify(cold.badges));
  assert(cold.detail.includes('BlackSwan'), '(7) cold detail names BlackSwan', cold.detail);
  assert(isValid(cold), '(7) cold route valid');
  const nc = explainRoute({ model: 'claude-haiku-4-5', reason: 'blackswan_endpoint_not_configured', fallbackFrom: 'cswan801/BlackSwan-v5' });
  assert(/isn't connected|not connected/i.test(nc.short), '(7) not-configured short', nc.short);
  assert(nc.badges.includes('Not connected'), '(7) not-connected badge', JSON.stringify(nc.badges));
  assert(isValid(nc), '(7) not-connected route valid');

  // ─── (8) Auto-lane escalation reasons ──────────────────────────────────────
  const escCases: Array<[string, string]> = [
    ['multi_step', 'multi-step request'],
    ['action_verb', 'action request'],
    ['technical_reasoning', 'technical reasoning'],
    ['long_compound', 'long, compound request'],
    ['ambiguous', 'ambiguous request'],
  ];
  for (const [slug, phrase] of escCases) {
    const e = explainRoute({ model: 'claude-opus-4-8', provider: 'anthropic', reason: slug });
    assert(e.short.startsWith('Escalated to Claude Opus 4.8'), `(8) ${slug} short`, e.short);
    assert(e.short.includes(phrase), `(8) ${slug} short names phrase`, e.short);
    assert(e.badges.includes('Escalated'), `(8) ${slug} Escalated badge`, JSON.stringify(e.badges));
    assert(e.detail.includes('frontier model'), `(8) ${slug} detail mentions frontier model`, e.detail);
    assert(isValid(e), `(8) ${slug} valid`);
  }

  // ─── (9) BYOK flagging ─────────────────────────────────────────────────────
  const byok = explainRoute({ model: 'gpt-5.5', provider: 'openai', byok: true });
  assertEq(byok.short, 'Using GPT-5.5 via OpenAI', '(9) byok plain short');
  assert(byok.badges.includes('Your key'), '(9) BYOK flagged with Your key badge', JSON.stringify(byok.badges));
  assert(byok.detail.includes('BYOK'), '(9) BYOK detail mentions BYOK', byok.detail);
  assert(isValid(byok), '(9) byok route valid');
  // byok also works from string / number signals.
  assert(explainRoute({ model: 'gpt-5.5', byok: 'true' }).badges.includes('Your key'), '(9) byok string true');
  assert(explainRoute({ model: 'gpt-5.5', byok: 1 }).badges.includes('Your key'), '(9) byok number 1');
  assert(!explainRoute({ model: 'gpt-5.5', byok: 'false' }).badges.includes('Your key'), '(9) byok "false" not flagged');
  // byok-only (no model/provider) still surfaces a neutral-but-flagged shape.
  const byokOnly = explainRoute({ byok: true });
  assert(byokOnly.badges.includes('Your key'), '(9) byok-only flagged', JSON.stringify(byokOnly.badges));
  assert(byokOnly.detail.includes('BYOK'), '(9) byok-only detail', byokOnly.detail);

  // ─── (10) plain model / provider-only / empty neutral ─────────────────────
  const plain = explainRoute({ model: 'claude-opus-4-8' });
  assertEq(plain.short, 'Using Claude Opus 4.8', '(10) plain model short');
  assert(plain.detail.includes('Claude Opus 4.8'), '(10) plain model detail', plain.detail);
  const provOnly = explainRoute({ provider: 'openrouter' });
  assertEq(provOnly.short, 'Routed via OpenRouter', '(10) provider-only short');
  assert(provOnly.badges.includes('OpenRouter'), '(10) provider-only badge', JSON.stringify(provOnly.badges));
  const empty = explainRoute({});
  assertEq(empty.short, 'Route details unavailable', '(10) empty neutral short');
  assertEq(empty.detail, '', '(10) empty neutral detail');
  assertEq(empty.badges.length, 0, '(10) empty neutral no badges');
  assert(isValid(empty), '(10) empty neutral valid');

  // ─── (11) bounds + badge dedupe/cap ────────────────────────────────────────
  // provider that duplicates a scenario badge must dedupe.
  const dup = explainRoute({ model: 'cswan801/BlackSwan-v5', provider: 'blackswan' });
  assertEq(badgeCount(dup, 'BlackSwan'), 1, '(11) BlackSwan badge deduped', JSON.stringify(dup.badges));
  assert(dup.badges.includes('App-grounded'), '(11) dedupe keeps App-grounded', JSON.stringify(dup.badges));
  // huge inputs stay bounded.
  const huge = explainRoute({
    model: 'x'.repeat(5000), provider: 'y'.repeat(5000), reason: 'z'.repeat(5000),
    fallbackFrom: 'w'.repeat(5000), toolExecutor: 'q'.repeat(5000), byok: true,
  });
  assert(isValid(huge), '(11) huge input stays bounded', `short ${huge.short.length} detail ${huge.detail.length}`);
  assert(huge.badges.length <= MAX_BADGES, '(11) huge input badge count capped', String(huge.badges.length));
  // control chars in a free-text reason never leak into copy.
  const ctl = explainRoute({ model: 'claude-opus-4-8', reason: `weird${NUL}${BEL}${ESC}[0m reason` });
  assert(!/[\u0000-\u001F\u007F]/.test([ctl.short, ctl.detail, ...ctl.badges].join('')), '(11) no control chars in output', JSON.stringify(ctl));
  assert(isValid(ctl), '(11) control-char reason still valid');

  // ─── (12) secret-safety: no key survives into copy or badge ────────────────
  const secReason = explainRoute({ model: 'claude-opus-4-8', provider: 'anthropic', reason: `route died: Bearer ${SK_SECRET} rejected`, fallbackFrom: 'cswan801/BlackSwan-v5' });
  assert(!leaks(secReason, SECRET_FRAG), '(12) secret in reason never leaks', blob(secReason));
  assert(!leaks(secReason, 'sk-ant'), '(12) sk-ant prefix in reason never leaks', blob(secReason));
  const secModel = explainRoute({ model: SK_SECRET, provider: 'anthropic' });
  assert(!leaks(secModel, SECRET_FRAG), '(12) secret in model never leaks', blob(secModel));
  const secFrom = explainRoute({ model: 'claude-haiku-4-5', reason: '529', fallbackFrom: SK_SECRET });
  assert(!leaks(secFrom, SECRET_FRAG), '(12) secret in fallbackFrom never leaks', blob(secFrom));
  const secExec = explainRoute({ model: 'cswan801/BlackSwan-v5', toolExecutor: `Bearer ${SK_SECRET}` });
  assert(!leaks(secExec, SECRET_FRAG), '(12) secret in toolExecutor never leaks', blob(secExec));
  assert(!prettyModelName(SK_SECRET).includes(SECRET_FRAG), '(12) prettyModelName redacts secret', prettyModelName(SK_SECRET));
  assert(!prettyProviderName(`Bearer ${SK_SECRET}`).includes(SECRET_FRAG), '(12) prettyProviderName redacts secret', prettyProviderName(`Bearer ${SK_SECRET}`));
  // Fuzz: a secret embedded in every field at once must still never appear.
  const secAll = explainRoute({ model: SK_SECRET, provider: SK_SECRET, reason: SK_SECRET, fallbackFrom: SK_SECRET, toolExecutor: SK_SECRET, byok: SK_SECRET });
  assert(!leaks(secAll, SECRET_FRAG), '(12) secret in ALL fields never leaks', blob(secAll));

  // ─── (13) totality — degenerate / hostile inputs never throw ───────────────
  try {
    const circular: Record<string, unknown> = { model: 'loop' };
    circular.self = circular;
    const bigintV: unknown = typeof BigInt === 'function' ? BigInt(42) : 42;
    const junk: unknown[] = [
      null, undefined, {}, [], ['x'], 0, -1, Number.NaN, Number.POSITIVE_INFINITY,
      true, false, 42.5, '', '   ', Symbol('s'), () => 'x', bigintV, new Map(), new Set(),
      circular, new Date(0), /regex/, 'a'.repeat(100000), `${NUL}${BEL}${ESC}`,
      { toString() { throw new Error('nope'); } },
    ];
    for (const j of junk) {
      const e = explainRoute(j as never);
      if (!isValid(e)) assert(false, '(13) explainRoute produced invalid/unbounded shape', JSON.stringify(e));
      if (typeof prettyModelName(j) !== 'string') assert(false, '(13) prettyModelName not a string', String(prettyModelName(j)));
      if (typeof prettyProviderName(j) !== 'string') assert(false, '(13) prettyProviderName not a string', String(prettyProviderName(j)));
    }

    // Hostile field values (each field a distinct exotic type).
    const exotic = explainRoute({
      model: Symbol('m') as never,
      provider: (() => 'p') as never,
      reason: {} as never,
      fallbackFrom: bigintV as never,
      toolExecutor: [1, 2, 3] as never,
      byok: Number.NaN,
    });
    assert(isValid(exotic), '(13) exotic field types -> valid shape', JSON.stringify(exotic));

    // Proxy whose every property read throws — must be swallowed.
    const evil = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); } });
    assert(isValid(explainRoute(evil as never)), '(13) throwing-getter proxy input -> valid', JSON.stringify(explainRoute(evil as never)));
    assertEq(prettyModelName(evil), '', '(13) throwing-getter proxy -> empty model name');
    assertEq(prettyProviderName(evil), '', '(13) throwing-getter proxy -> empty provider name');

    // A field whose value is a throwing-getter proxy.
    const evilField = explainRoute({ model: new Proxy({}, { get() { throw new Error('x'); } }) as never, provider: 'anthropic' });
    assert(isValid(evilField), '(13) throwing-getter field value -> valid', JSON.stringify(evilField));

    assert(true, '(13) full degenerate barrage completed without throwing');
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (13) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (Nb) OpenRouter multi-segment keys must not leak into route copy ──────
  {
    const OR_FRAG = 'abcdef0123456789';
    const OR_KEY = `sk-or-v1-${OR_FRAG}${OR_FRAG}`;
    const e = explainRoute({ model: 'claude-opus-4-8', reason: `relayed ${OR_KEY} upstream` });
    assert(!leaks(e, OR_FRAG), '(Nb) OpenRouter sk-or-v1 key body redacted from route copy', blob(e));
    assert(!leaks(e, 'sk-or-v1'), '(Nb) OpenRouter key prefix not present verbatim', blob(e));
    assert(isValid(e), '(Nb) explanation still valid after redaction');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll model-route-explain-core smoke cases passed (${passes} passed).`);
}

main();
