// Smoke test for chatModelDisplayCore — pure, tsx-loadable, deterministic.
// Covers the model display / label logic extracted from ChatTab (decomposition
// unit U4). Locks autoModelDisplayName on provider-prefixed ids, date-suffixed
// ids, and :free variants; locks modelSectionAccent explicit + fallback hashing;
// and proves every export is total (hostile input -> safe neutral, never throws).
// Run: npx tsx scripts/chat-model-display-core-smoketest.ts
import {
  colorForOpenRouterAuthor,
  MODEL_SECTION_ACCENTS,
  MODEL_SECTION_FALLBACK_COLORS,
  modelSectionAccent,
  MODEL_ROUTE_PREFIXES,
  MODEL_AUTHOR_SEGMENTS,
  modelDisplayToken,
  compactVersionTokens,
  autoModelDisplayName,
} from '../src/lib/chatModelDisplayCore';

let passes = 0;
let failures = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function assertEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  FAIL: ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function noThrow(label: string, fn: () => unknown): unknown {
  try {
    const out = fn();
    passes += 1;
    return out;
  } catch (e) {
    failures += 1;
    console.error(`  FAIL (threw): ${label} -> ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

// Hostile fixtures reused across groups.
const cyclic: any = {};
cyclic.self = cyclic;
const throwy: any = { toString() { throw new Error('boom-toString'); }, valueOf() { throw new Error('boom-valueOf'); } };
const hugeStr = 'z'.repeat(40000);
const scalarHostiles: any[] = [
  null, undefined, 123, 0, NaN, Infinity, -Infinity, true, false,
  {}, [], [1, 2, 3], Symbol('s'), () => 1, cyclic, throwy, hugeStr,
];

// ---------------------------------------------------------------------------
// 1. colorForOpenRouterAuthor — known authors, unknown fallback, absent
// ---------------------------------------------------------------------------
assertEq('color anthropic', colorForOpenRouterAuthor('anthropic'), '#a855f7');
assertEq('color deepseek', colorForOpenRouterAuthor('deepseek'), '#ef4444');
assertEq('color google', colorForOpenRouterAuthor('google'), '#3b82f6');
assertEq('color inclusionai', colorForOpenRouterAuthor('inclusionai'), '#10b981');
assertEq('color minimax', colorForOpenRouterAuthor('minimax'), '#fb7185');
assertEq('color moonshotai', colorForOpenRouterAuthor('moonshotai'), '#f59e0b');
assertEq('color nvidia', colorForOpenRouterAuthor('nvidia'), '#84cc16');
assertEq('color openai', colorForOpenRouterAuthor('openai'), '#10b981');
assertEq('color stepfun', colorForOpenRouterAuthor('stepfun'), '#22c55e');
assertEq('color tencent', colorForOpenRouterAuthor('tencent'), '#f59e0b');
assertEq('color x-ai', colorForOpenRouterAuthor('x-ai'), '#6366f1');
assertEq('color z-ai', colorForOpenRouterAuthor('z-ai'), '#6366f1');
assertEq('color unknown -> default violet', colorForOpenRouterAuthor('who-dis'), '#a78bfa');
assertEq('color empty -> default violet', colorForOpenRouterAuthor(''), '#a78bfa');
assertEq('color undefined -> default violet', colorForOpenRouterAuthor(undefined), '#a78bfa');

// ---------------------------------------------------------------------------
// 2. modelSectionAccent — explicit table + deterministic fallback hashing
// ---------------------------------------------------------------------------
assertEq('accent action:auto', modelSectionAccent('action:auto'), '#22c55e');
assertEq('accent base:popular', modelSectionAccent('base:popular'), '#f59e0b');
assertEq('accent base:code', modelSectionAccent('base:code'), '#8b5cf6');
assertEq('accent base:reason', modelSectionAccent('base:reason'), '#ef4444');
assertEq('accent base:speed', modelSectionAccent('base:speed'), '#06b6d4');
assertEq('accent base:creative', modelSectionAccent('base:creative'), '#10b981');
assertEq('accent base:open', modelSectionAccent('base:open'), '#84cc16');
assertEq('accent provider:anthropic', modelSectionAccent('provider:anthropic'), '#d97706');
assertEq('accent provider:openai', modelSectionAccent('provider:openai'), '#10a37f');
assertEq('accent provider:huggingface', modelSectionAccent('provider:huggingface'), '#ffbd45');
assertEq('accent provider:hugging_face', modelSectionAccent('provider:hugging_face'), '#ffbd45');
assertEq('accent custom:hf-hub', modelSectionAccent('custom:hf-hub'), '#fb923c');
assertEq('accent action:add-hf-hub', modelSectionAccent('action:add-hf-hub'), '#f97316');
assertEq('accent known key ignores fallback param', modelSectionAccent('action:auto', '#000000'), '#22c55e');
// fallback hashing: empty string -> hash 0 -> FALLBACK[0]
assertEq('accent "" hashes to FALLBACK[0]', modelSectionAccent(''), '#22c55e');
// hand-computed hashes: "x" -> 120 % 14 = 8 ; "ab" -> 3105 % 14 = 11
assertEq('accent "x" hashes to FALLBACK[8]', modelSectionAccent('x'), '#14b8a6');
assertEq('accent "ab" hashes to FALLBACK[11]', modelSectionAccent('ab'), '#a78bfa');
assert('accent unknown key is a fallback color', MODEL_SECTION_FALLBACK_COLORS.includes(modelSectionAccent('totally-unknown-section')));
assertEq('accent deterministic (same key twice)', modelSectionAccent('some-key-42'), modelSectionAccent('some-key-42'));
assert('accent table has 28 entries', Object.keys(MODEL_SECTION_ACCENTS).length === 28);
assert('accent fallback palette has 14 colors', MODEL_SECTION_FALLBACK_COLORS.length === 14);

// ---------------------------------------------------------------------------
// 3. MODEL_ROUTE_PREFIXES / MODEL_AUTHOR_SEGMENTS — membership sets
// ---------------------------------------------------------------------------
assert('ROUTE is a Set', MODEL_ROUTE_PREFIXES instanceof Set);
assert('AUTHOR is a Set', MODEL_AUTHOR_SEGMENTS instanceof Set);
assert('ROUTE has openrouter', MODEL_ROUTE_PREFIXES.has('openrouter'));
assert('ROUTE has google_ai', MODEL_ROUTE_PREFIXES.has('google_ai'));
assert('ROUTE has huggingface_endpoint', MODEL_ROUTE_PREFIXES.has('huggingface_endpoint'));
assert('ROUTE has hugging_face', MODEL_ROUTE_PREFIXES.has('hugging_face'));
assert('ROUTE has zai', MODEL_ROUTE_PREFIXES.has('zai'));
assert('ROUTE has ollama', MODEL_ROUTE_PREFIXES.has('ollama'));
assert('ROUTE has replicate', MODEL_ROUTE_PREFIXES.has('replicate'));
assert('ROUTE lacks nonsense', !MODEL_ROUTE_PREFIXES.has('nonsense'));
assert('ROUTE lacks empty', !MODEL_ROUTE_PREFIXES.has(''));
assert('AUTHOR has anthropic', MODEL_AUTHOR_SEGMENTS.has('anthropic'));
assert('AUTHOR has deepseek', MODEL_AUTHOR_SEGMENTS.has('deepseek'));
assert('AUTHOR has cswan801', MODEL_AUTHOR_SEGMENTS.has('cswan801'));
assert('AUTHOR has qwen', MODEL_AUTHOR_SEGMENTS.has('qwen'));
assert('AUTHOR has meta-llama', MODEL_AUTHOR_SEGMENTS.has('meta-llama'));
assert('AUTHOR has x-ai', MODEL_AUTHOR_SEGMENTS.has('x-ai'));
assert('AUTHOR lacks nonsense', !MODEL_AUTHOR_SEGMENTS.has('nonsense'));
assert('ROUTE size is 23', MODEL_ROUTE_PREFIXES.size === 23);
assert('AUTHOR size is 17', MODEL_AUTHOR_SEGMENTS.size === 17);

// ---------------------------------------------------------------------------
// 4. modelDisplayToken — brand map, version/number patterns, generic case
// ---------------------------------------------------------------------------
assertEq('token gpt -> GPT', modelDisplayToken('gpt'), 'GPT');
assertEq('token GPT (upper) -> GPT', modelDisplayToken('GPT'), 'GPT');
assertEq('token claude -> Claude', modelDisplayToken('claude'), 'Claude');
assertEq('token deepseek -> DeepSeek', modelDisplayToken('deepseek'), 'DeepSeek');
assertEq('token minimax -> MiniMax', modelDisplayToken('minimax'), 'MiniMax');
assertEq('token glm -> GLM', modelDisplayToken('glm'), 'GLM');
assertEq('token oss -> OSS', modelDisplayToken('oss'), 'OSS');
assertEq('token v -> V', modelDisplayToken('v'), 'V');
assertEq('token sonnet -> Sonnet', modelDisplayToken('sonnet'), 'Sonnet');
assertEq('token haiku -> Haiku', modelDisplayToken('haiku'), 'Haiku');
assertEq('token opus -> Opus', modelDisplayToken('opus'), 'Opus');
assertEq('token codex -> Codex', modelDisplayToken('codex'), 'Codex');
assertEq('token o1 -> O1', modelDisplayToken('o1'), 'O1');
assertEq('token o3 -> O3', modelDisplayToken('o3'), 'O3');
assertEq('token 4o -> 4O', modelDisplayToken('4o'), '4O');
assertEq('token 120b -> 120B', modelDisplayToken('120b'), '120B');
assertEq('token r1 -> R1', modelDisplayToken('r1'), 'R1');
assertEq('token v5 -> V5', modelDisplayToken('v5'), 'V5');
assertEq('token pro -> Pro', modelDisplayToken('pro'), 'Pro');
assertEq('token mini -> Mini', modelDisplayToken('mini'), 'Mini');
assertEq('token flash -> Flash', modelDisplayToken('flash'), 'Flash');
assertEq('token hello -> Hello', modelDisplayToken('hello'), 'Hello');
assertEq('token WORLD -> World', modelDisplayToken('WORLD'), 'World');
assertEq('token empty -> empty', modelDisplayToken(''), '');
assertEq('token 4.6 -> 4.6', modelDisplayToken('4.6'), '4.6');

// ---------------------------------------------------------------------------
// 5. compactVersionTokens — merges consecutive numeric tokens into a.b
// ---------------------------------------------------------------------------
assert('compact [] -> []', JSON.stringify(compactVersionTokens([])) === '[]');
assert('compact [4,6] -> [4.6]', JSON.stringify(compactVersionTokens(['4', '6'])) === JSON.stringify(['4.6']));
assert('compact [4,5,6] -> [4.5,6]', JSON.stringify(compactVersionTokens(['4', '5', '6'])) === JSON.stringify(['4.5', '6']));
assert('compact [gpt,5,5] -> [gpt,5.5]', JSON.stringify(compactVersionTokens(['gpt', '5', '5'])) === JSON.stringify(['gpt', '5.5']));
assert('compact [a,b,c] unchanged', JSON.stringify(compactVersionTokens(['a', 'b', 'c'])) === JSON.stringify(['a', 'b', 'c']));
assert('compact [5] -> [5]', JSON.stringify(compactVersionTokens(['5'])) === JSON.stringify(['5']));
assert('compact [5,x] -> [5,x]', JSON.stringify(compactVersionTokens(['5', 'x'])) === JSON.stringify(['5', 'x']));
assert('compact [x,5] -> [x,5]', JSON.stringify(compactVersionTokens(['x', '5'])) === JSON.stringify(['x', '5']));
assert('compact [1,2,3,4] -> [1.2,3.4]', JSON.stringify(compactVersionTokens(['1', '2', '3', '4'])) === JSON.stringify(['1.2', '3.4']));
assert('compact [10,20] -> [10.20]', JSON.stringify(compactVersionTokens(['10', '20'])) === JSON.stringify(['10.20']));

// ---------------------------------------------------------------------------
// 6. autoModelDisplayName — provider-prefixed, date-suffixed, :free variants
// ---------------------------------------------------------------------------
assertEq('auto openrouter/anthropic/claude-sonnet-4.6', autoModelDisplayName('openrouter/anthropic/claude-sonnet-4.6'), 'Claude Sonnet 4.6');
assertEq('auto google_ai/gemini-2.5-pro', autoModelDisplayName('google_ai/gemini-2.5-pro'), 'Gemini 2.5 Pro');
assertEq('auto huggingface_endpoint/cswan801/BlackSwan-v5', autoModelDisplayName('huggingface_endpoint/cswan801/BlackSwan-v5'), 'Black Swan V5');
assertEq('auto date-suffixed claude-haiku-4-5-20251001', autoModelDisplayName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5');
assertEq('auto :free openrouter/openai/gpt-oss-120b:free', autoModelDisplayName('openrouter/openai/gpt-oss-120b:free'), 'GPT OSS 120B');
assertEq('auto :free strips author openrouter/deepseek/deepseek-r1:free', autoModelDisplayName('openrouter/deepseek/deepseek-r1:free'), 'R1');
assertEq('auto plain gpt-5.5', autoModelDisplayName('gpt-5.5'), 'GPT 5.5');
assertEq('auto plain claude-opus-4-8', autoModelDisplayName('claude-opus-4-8'), 'Claude Opus 4.8');
assertEq('auto openai/gpt-5.4-mini', autoModelDisplayName('openai/gpt-5.4-mini'), 'GPT 5.4 Mini');
assertEq('auto gemini-2.5-flash-lite', autoModelDisplayName('gemini-2.5-flash-lite'), 'Gemini 2.5 Flash Lite');
assertEq('auto strips ?query suffix', autoModelDisplayName('gpt-5.5?nocache=1'), 'GPT 5.5');
assertEq('auto null -> null', autoModelDisplayName(null), null);
assertEq('auto undefined -> null', autoModelDisplayName(undefined), null);
assertEq('auto empty string -> null', autoModelDisplayName(''), null);

// ---------------------------------------------------------------------------
// 7. Hostile no-throw — every export returns a safe neutral, never throws
// ---------------------------------------------------------------------------
for (const h of scalarHostiles) {
  const label = `hostile ${String(typeof h)}:${h === null ? 'null' : ''}`;
  const c = noThrow(`colorForOpenRouterAuthor(${label})`, () => colorForOpenRouterAuthor(h as any));
  assert('color hostile returns string', typeof c === 'string');

  const a = noThrow(`modelSectionAccent(${label})`, () => modelSectionAccent(h as any));
  assert('accent hostile key returns string', typeof a === 'string');

  const a2 = noThrow(`modelSectionAccent(valid, ${label})`, () => modelSectionAccent('provider:openai', h as any));
  assertEq('accent hostile fallback still resolves known key', a2, '#10a37f');

  const t = noThrow(`modelDisplayToken(${label})`, () => modelDisplayToken(h as any));
  assert('token hostile returns string', typeof t === 'string');

  const n = noThrow(`autoModelDisplayName(${label})`, () => autoModelDisplayName(h as any));
  assert('auto hostile returns string|null', n === null || typeof n === 'string');
}

// compactVersionTokens hostile: non-array -> [] ; weird-but-array elements -> no throw
const arrayLevelHostiles: any[] = [null, undefined, 123, 'string', {}, Symbol('s'), true, cyclic];
for (const h of arrayLevelHostiles) {
  const r = noThrow('compactVersionTokens(non-array)', () => compactVersionTokens(h as any));
  assert('compact non-array -> array', Array.isArray(r));
  assert('compact non-array -> empty array', Array.isArray(r) && (r as unknown[]).length === 0);
}
{
  const mixed = noThrow('compactVersionTokens(mixed element types)', () =>
    compactVersionTokens([null, undefined, 123, {}, [], '5', '6'] as any),
  );
  assert('compact mixed-element returns array', Array.isArray(mixed));
}

// huge-input sanity: no throw, bounded, correct shape
{
  const bigId = 'openrouter/' + 'a'.repeat(20000) + '/model-name-9-9';
  const r = noThrow('autoModelDisplayName(huge id)', () => autoModelDisplayName(bigId));
  assert('auto huge id returns non-empty string', typeof r === 'string' && (r as string).length > 0);
  const bigTokens = noThrow('compactVersionTokens(huge array)', () =>
    compactVersionTokens(Array.from({ length: 5000 }, (_, i) => String(i % 2 === 0 ? '1' : '2'))),
  );
  assert('compact huge array returns array', Array.isArray(bigTokens));
}

// ---------------------------------------------------------------------------
console.log(`\nchat-model-display-core smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS — chatModelDisplayCore is pure, total, and behavior-locked.');
