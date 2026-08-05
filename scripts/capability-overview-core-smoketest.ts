/**
 * capability-overview-core-smoketest — the pure capability catalog + renderers
 * (src/lib/capabilityOverviewCore.ts) behind "what can you do?", the
 * empty-chat starter suggestions, and per-feature discovery hints.
 * Load-bearing assertions:
 *
 *   CATALOG: 7-9 deep-frozen groups with unique ids, the seven required
 *   product areas present (coding / computer / tasks / memory / knowledge /
 *   create / team), every group carrying a nonempty title+blurb and 2-3
 *   bounded example prompts, and the flagship syntax actually taught
 *   (@file:/@symbol:, /context, /wiki, /research, /create, /browser, /apps).
 *
 *   OVERVIEW: full render includes every title + every example + the /help
 *   and /context discoverability footer, stays under OVERVIEW_MAX_CHARS with
 *   no truncation; compact render is one bullet per group (first example
 *   only) and strictly shorter than full. Both deterministic call-to-call.
 *
 *   SUGGESTIONS: default 4 drawn flagship-first (coding → computer → create →
 *   team, first example each), all distinct, all real catalog examples,
 *   ≤ 100 chars; max is floored + clamped to [0, 6] with NaN/non-number →
 *   default 4 and Infinity → 6.
 *
 *   HINTS: 'mentions' returns the exact @file:/@symbol: teacher line; every
 *   canonical id yields a single-line 'Tip:' string; aliases + normalization
 *   ('/context', '@mentions', 'computer use', 'best-of-n') resolve; unknown,
 *   hostile ('__proto__', 'constructor'), empty, and huge ids return ''.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (capabilityOverviewCore has zero imports).
 */

import {
  CAPABILITY_CATALOG,
  buildCapabilityOverview,
  buildEmptyChatSuggestions,
  buildFeatureDiscoveryHint,
  DEFAULT_EMPTY_CHAT_SUGGESTIONS,
  MAX_EMPTY_CHAT_SUGGESTIONS,
  OVERVIEW_MAX_CHARS,
  KNOWN_FEATURE_HINT_IDS,
  type CapabilityGroup,
} from '../src/lib/capabilityOverviewCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: the catalog group with the given id (assumed present — asserted in group 1). */
function groupById(id: string): CapabilityGroup {
  return CAPABILITY_CATALOG.find((g) => g.id === id) as CapabilityGroup;
}

function main(): void {
  // ─── (1) catalog shape ─────────────────────────────────────────────────────
  assert(
    CAPABILITY_CATALOG.length >= 7 && CAPABILITY_CATALOG.length <= 9,
    '(1) catalog has 7-9 groups',
    `got ${CAPABILITY_CATALOG.length}`
  );
  const ids = CAPABILITY_CATALOG.map((g) => g.id);
  assertEq(new Set(ids).size, ids.length, '(1) group ids are unique');
  for (const required of ['coding', 'computer', 'tasks', 'memory', 'knowledge', 'create', 'team']) {
    assert(ids.includes(required), `(1) required group '${required}' present`);
  }
  for (const group of CAPABILITY_CATALOG) {
    assert(typeof group.id === 'string' && group.id.length > 0, `(1) [${group.id}] id nonempty`);
    assert(typeof group.title === 'string' && group.title.length > 0 && group.title.length <= 60, `(1) [${group.id}] title nonempty + bounded`);
    assert(typeof group.blurb === 'string' && group.blurb.length > 0 && group.blurb.length <= 200, `(1) [${group.id}] blurb nonempty + bounded`);
    assert(group.examples.length >= 2 && group.examples.length <= 3, `(1) [${group.id}] has 2-3 examples`, `got ${group.examples.length}`);
    assert(
      group.examples.every((e) => typeof e === 'string' && e.trim().length > 0 && e.length <= 100),
      `(1) [${group.id}] examples nonempty + <= 100 chars`
    );
  }
  assert(Object.isFrozen(CAPABILITY_CATALOG), '(1) catalog array frozen');
  assert(Object.isFrozen(CAPABILITY_CATALOG[0]), '(1) first group frozen');
  assert(Object.isFrozen(CAPABILITY_CATALOG[0].examples), '(1) first group examples frozen');

  // ─── (2) flagship features are actually taught in the catalog ─────────────
  const catalogText = JSON.stringify(CAPABILITY_CATALOG);
  for (const marker of ['@file:', '@symbol:', '/context', '/wiki', '/research', '/create', '/browser', '/apps', '/remember', '/bestof']) {
    assert(catalogText.includes(marker), `(2) catalog teaches '${marker}'`);
  }

  // ─── (3) full overview render ──────────────────────────────────────────────
  const full = buildCapabilityOverview();
  assert(typeof full === 'string' && full.length > 800, '(3) full overview is a substantial string', `len ${full.length}`);
  assert(full.length <= OVERVIEW_MAX_CHARS, '(3) full overview within OVERVIEW_MAX_CHARS');
  assert(!full.endsWith('…'), '(3) full overview not truncated');
  for (const group of CAPABILITY_CATALOG) {
    assert(full.includes(`**${group.title}**`), `(3) full includes title '${group.title}'`);
    assert(group.examples.every((e) => full.includes(e)), `(3) full includes every '${group.id}' example`);
  }
  assert(full.includes('@file:'), '(3) full teaches @file: mentions');
  assert(full.includes('/context'), '(3) full teaches the /context dial');
  assert(full.includes('/help'), '(3) full points at /help');
  assert(!full.includes('undefined') && !full.includes('[object Object]'), '(3) full has no junk interpolation');

  // ─── (4) compact overview render ───────────────────────────────────────────
  const compact = buildCapabilityOverview({ compact: true });
  assert(typeof compact === 'string' && compact.length > 0, '(4) compact overview nonempty');
  assert(compact.length < full.length, '(4) compact shorter than full', `${compact.length} vs ${full.length}`);
  assertEq(compact.split('• **').length - 1, CAPABILITY_CATALOG.length, '(4) compact renders one bullet per group');
  for (const group of CAPABILITY_CATALOG) {
    assert(compact.includes(`**${group.title}**`), `(4) compact includes title '${group.title}'`);
  }
  const coding = groupById('coding');
  assert(compact.includes(coding.examples[0]), '(4) compact keeps first coding example');
  assert(!compact.includes(coding.examples[1]), '(4) compact drops second coding example');
  assert(compact.includes('/help'), '(4) compact points at /help');

  // ─── (5) determinism ───────────────────────────────────────────────────────
  assertEq(buildCapabilityOverview(), full, '(5) full render is deterministic');
  assertEq(buildCapabilityOverview({ compact: true }), compact, '(5) compact render is deterministic');
  assertEq(
    JSON.stringify(buildEmptyChatSuggestions()),
    JSON.stringify(buildEmptyChatSuggestions()),
    '(5) suggestions are deterministic'
  );

  // ─── (6) default empty-chat suggestions: flagship-first, varied, real ─────
  const defaults = buildEmptyChatSuggestions();
  assertEq(defaults.length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(6) default suggestion count is 4');
  assertEq(defaults[0], groupById('coding').examples[0], '(6) first suggestion teaches coding/@file:');
  assert(defaults[0].includes('@file:'), '(6) first suggestion contains @file: syntax');
  assertEq(defaults[1], groupById('computer').examples[0], '(6) second suggestion is computer use');
  assertEq(defaults[2], groupById('create').examples[0], '(6) third suggestion is create');
  assertEq(defaults[3], groupById('team').examples[0], '(6) fourth suggestion is team');
  assertEq(new Set(defaults).size, defaults.length, '(6) suggestions are distinct');
  const allExamples = new Set(CAPABILITY_CATALOG.flatMap((g) => g.examples.map((e) => e.trim())));
  assert(defaults.every((s) => allExamples.has(s)), '(6) every suggestion is a real catalog example');
  assert(defaults.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 100), '(6) suggestions nonempty + <= 100 chars');

  // ─── (7) suggestion max handling: floor + clamp [0, 6] ────────────────────
  assertEq(buildEmptyChatSuggestions({ max: 6 }).length, 6, '(7) max 6 → 6');
  assertEq(buildEmptyChatSuggestions({ max: 1 }).length, 1, '(7) max 1 → 1');
  assertEq(buildEmptyChatSuggestions({ max: 0 }).length, 0, '(7) max 0 → []');
  assertEq(buildEmptyChatSuggestions({ max: -3 }).length, 0, '(7) negative max → []');
  assertEq(buildEmptyChatSuggestions({ max: 2.9 }).length, 2, '(7) fractional max floors');
  assertEq(buildEmptyChatSuggestions({ max: 99 }).length, MAX_EMPTY_CHAT_SUGGESTIONS, '(7) huge max clamps to cap');
  assertEq(buildEmptyChatSuggestions({ max: Infinity }).length, MAX_EMPTY_CHAT_SUGGESTIONS, '(7) Infinity clamps to cap');
  assertEq(buildEmptyChatSuggestions({ max: -Infinity }).length, 0, '(7) -Infinity → []');
  assertEq(buildEmptyChatSuggestions({ max: NaN }).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(7) NaN → default');
  assertEq(buildEmptyChatSuggestions({}).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(7) missing max → default');
  const six = buildEmptyChatSuggestions({ max: 6 });
  assertEq(new Set(six).size, 6, '(7) six suggestions all distinct');
  const sixGroups = new Set(
    six.map((s) => CAPABILITY_CATALOG.find((g) => g.examples.some((e) => e.trim() === s))?.id)
  );
  assertEq(sixGroups.size, 6, '(7) six suggestions span six distinct groups');

  // ─── (8) feature hints: content per flagship ───────────────────────────────
  assertEq(
    buildFeatureDiscoveryHint('mentions'),
    'Tip: type @file:src/... or @symbol:name to pull real code into the chat.',
    '(8) mentions hint is the exact teacher line'
  );
  const hintExpectations: Array<[id: string, marker: string]> = [
    ['context', '/context max'],
    ['coding', '/run'],
    ['computer_use', '/browser'],
    ['create', '/create'],
    ['watch', '/watch'],
    ['apps', '/apps'],
    ['memory', '/remember'],
    ['knowledge', '/wiki'],
    ['review', '/review'],
    ['bestof', '/bestof'],
    ['screen', '/screen'],
    ['run', '/run'],
    ['missions', '/mission'],
    ['integrations', '/integrations'],
    ['vault', '/vault'],
  ];
  for (const [id, marker] of hintExpectations) {
    assert(buildFeatureDiscoveryHint(id).includes(marker), `(8) '${id}' hint teaches '${marker}'`);
  }

  // ─── (9) hint aliases + normalization ──────────────────────────────────────
  const mentionsHint = buildFeatureDiscoveryHint('mentions');
  assertEq(buildFeatureDiscoveryHint('Mentions'), mentionsHint, '(9) case-insensitive id');
  assertEq(buildFeatureDiscoveryHint('  MENTIONS  '), mentionsHint, '(9) trimmed id');
  assertEq(buildFeatureDiscoveryHint('file-mentions'), mentionsHint, "(9) 'file-mentions' alias");
  assertEq(buildFeatureDiscoveryHint('@mentions'), mentionsHint, "(9) leading '@' stripped");
  assertEq(buildFeatureDiscoveryHint('/context'), buildFeatureDiscoveryHint('context'), "(9) leading '/' stripped");
  assertEq(buildFeatureDiscoveryHint('computer use'), buildFeatureDiscoveryHint('computer_use'), '(9) space → underscore');
  assertEq(buildFeatureDiscoveryHint('computer-use'), buildFeatureDiscoveryHint('computer_use'), '(9) dash → underscore');
  assertEq(buildFeatureDiscoveryHint('browser'), buildFeatureDiscoveryHint('computer_use'), "(9) 'browser' alias");
  assertEq(buildFeatureDiscoveryHint('wiki'), buildFeatureDiscoveryHint('knowledge'), "(9) 'wiki' alias");
  assertEq(buildFeatureDiscoveryHint('best-of-n'), buildFeatureDiscoveryHint('bestof'), "(9) 'best-of-n' alias");
  assertEq(buildFeatureDiscoveryHint('task'), buildFeatureDiscoveryHint('missions'), "(9) 'task' alias");

  // ─── (10) hint shape for every canonical id ────────────────────────────────
  assertEq(KNOWN_FEATURE_HINT_IDS.length, 16, '(10) 16 canonical hint ids');
  assert(Object.isFrozen(KNOWN_FEATURE_HINT_IDS), '(10) hint id list frozen');
  assertEq(
    KNOWN_FEATURE_HINT_IDS.filter((id) => {
      const hint = buildFeatureDiscoveryHint(id);
      return !(hint.length > 0 && hint.length <= 220 && hint.startsWith('Tip:') && !hint.includes('\n'));
    }).length,
    0,
    "(10) every canonical id → single-line bounded 'Tip:' string"
  );
  assert(KNOWN_FEATURE_HINT_IDS.includes('mentions') && KNOWN_FEATURE_HINT_IDS.includes('context'), '(10) flagship ids enumerated');

  // ─── (11) hint unknown / hostile / huge ids → '' ───────────────────────────
  assertEq(buildFeatureDiscoveryHint('flurble'), '', "(11) unknown id → ''");
  assertEq(buildFeatureDiscoveryHint(''), '', "(11) empty id → ''");
  assertEq(buildFeatureDiscoveryHint('   '), '', "(11) whitespace id → ''");
  assertEq(buildFeatureDiscoveryHint('__proto__'), '', "(11) '__proto__' → '' (no prototype walk)");
  assertEq(buildFeatureDiscoveryHint('constructor'), '', "(11) 'constructor' → ''");
  assertEq(buildFeatureDiscoveryHint('toString'), '', "(11) 'toString' → ''");
  assertEq(buildFeatureDiscoveryHint('hasOwnProperty'), '', "(11) 'hasOwnProperty' → ''");
  assertEq(buildFeatureDiscoveryHint('x'.repeat(500_000)), '', "(11) huge id → ''");

  // ─── (12) degenerate input never throws, returns neutral values ───────────
  try {
    // buildCapabilityOverview
    assertEq(buildCapabilityOverview(null as any), full, '(12) overview(null) → default view');
    assertEq(buildCapabilityOverview(undefined), full, '(12) overview(undefined) → default view');
    assertEq(buildCapabilityOverview({} as any), full, '(12) overview({}) → default view');
    assertEq(buildCapabilityOverview([] as any), full, '(12) overview([]) → default view');
    assertEq(buildCapabilityOverview(42 as any), full, '(12) overview(42) → default view');
    assertEq(buildCapabilityOverview('compact' as any), full, '(12) overview(string) → default view');
    assertEq(buildCapabilityOverview({ compact: 0 } as any), full, '(12) overview(compact: 0) → default view');
    assertEq(buildCapabilityOverview({ compact: 'yes' } as any), compact, '(12) overview(compact: truthy string) → compact view');
    // buildEmptyChatSuggestions
    assertEq(buildEmptyChatSuggestions(null as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(null) → default 4');
    assertEq(buildEmptyChatSuggestions(undefined).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(undefined) → default 4');
    assertEq(buildEmptyChatSuggestions([] as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions([]) → default 4');
    assertEq(buildEmptyChatSuggestions('x' as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(string) → default 4');
    assertEq(buildEmptyChatSuggestions(42 as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(number) → default 4');
    assertEq(buildEmptyChatSuggestions({ max: '6' } as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, "(12) suggestions(max: '6') → default 4");
    assertEq(buildEmptyChatSuggestions({ max: {} } as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(max: {}) → default 4');
    assertEq(buildEmptyChatSuggestions({ max: null } as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(max: null) → default 4');
    assertEq(buildEmptyChatSuggestions({ max: true } as any).length, DEFAULT_EMPTY_CHAT_SUGGESTIONS, '(12) suggestions(max: true) → default 4');
    // buildFeatureDiscoveryHint
    assertEq(buildFeatureDiscoveryHint(null as any), '', "(12) hint(null) → ''");
    assertEq(buildFeatureDiscoveryHint(undefined as any), '', "(12) hint(undefined) → ''");
    assertEq(buildFeatureDiscoveryHint({} as any), '', "(12) hint({}) → ''");
    assertEq(buildFeatureDiscoveryHint([] as any), '', "(12) hint([]) → ''");
    assertEq(buildFeatureDiscoveryHint(42 as any), '', "(12) hint(number) → ''");
    assertEq(buildFeatureDiscoveryHint(false as any), '', "(12) hint(boolean) → ''");
    // catalog untouched after everything above
    assertEq(CAPABILITY_CATALOG.length, ids.length, '(12) catalog length unchanged after all calls');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll capability-overview-core smoke cases passed (${passes} passed).`);
}

main();
