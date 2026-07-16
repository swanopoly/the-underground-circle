/**
 * command-frecency-core-smoketest — the pure per-user "frequent + recent"
 * ranking behind the chat slash-command menu (src/lib/commandFrecencyCore.ts,
 * chat-commands expansion v7). A bare `/` lists all ~103 registry commands
 * alpha-sorted (getMatchingChatCommands in src/lib/chatCommandRegistry.ts);
 * this core floats the commands THIS user reaches for to the top without
 * disturbing the rest. Load-bearing assertions:
 *
 *   NORMALIZE: trim + lowercase + collapse whitespace; must start with `/`;
 *   bare `/`, empty, and non-slash / non-string → null; args kept; bounded len.
 *
 *   RECORD: bumps count + sets lastUsedMs in a NEW map (input never mutated);
 *   invalid command → sanitized-but-unchanged; junk keys/values dropped; the
 *   tracked map is bounded at MAX_TRACKED_COMMANDS with lowest-frecency evicted.
 *
 *   SCORE: count × 0.5^(age/14d) — fresh = count, one half-life = count/2, two
 *   = count/4; future lastUsedMs clamps to no decay; invalid now → frequency
 *   only; count 0 / bad usage → 0; monotonic in both count and recency.
 *
 *   RERANK: frequently+recently used commands rank first; arg variants credit
 *   the most-specific candidate (/gh cat, not /gh); unused keep original order;
 *   stable ties; a strict permutation of the input (never drops/dupes); a NEW
 *   array; deterministic.
 *
 *   And: every export is total — degenerate / hostile / cyclic input never
 *   throws.
 *
 * Pure — loads under tsx (commandFrecencyCore has zero imports).
 */

import {
  normalizeCommandKey,
  recordCommandUsage,
  frecencyScore,
  rerankByFrecency,
  USAGE_HALF_LIFE_MS,
  MAX_TRACKED_COMMANDS,
  type CommandUsage,
} from '../src/lib/commandFrecencyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertClose(a: number, b: number, msg: string): void {
  assert(Math.abs(a - b) < 1e-9, msg, `got ${a} want ~${b}`);
}

/** Command fields, sorted — used to prove a re-rank is a permutation. */
function sortedCommands(list: Array<{ command?: unknown }>): string {
  return list.map((c) => String((c as { command?: unknown }).command)).sort().join('|');
}

function main(): void {
  // ─── (1) exported constants ───────────────────────────────────────────────
  assertEq(USAGE_HALF_LIFE_MS, 14 * 24 * 60 * 60 * 1000, '(1) half-life is 14 days in ms');
  assertEq(USAGE_HALF_LIFE_MS, 1209600000, '(1) half-life numeric value');
  assertEq(MAX_TRACKED_COMMANDS, 200, '(1) tracked cap is 200');

  // ─── (2) normalizeCommandKey ──────────────────────────────────────────────
  assertEq(normalizeCommandKey('/help'), '/help', '(2) plain command passes through');
  assertEq(normalizeCommandKey('  /Help  '), '/help', '(2) trims + lowercases');
  assertEq(normalizeCommandKey('/gh   status'), '/gh status', '(2) collapses inner whitespace');
  assertEq(normalizeCommandKey('/gh\tstatus\n'), '/gh status', '(2) tabs/newlines collapse + trim');
  assertEq(normalizeCommandKey('/gh cat foo.ts'), '/gh cat foo.ts', '(2) argument text is kept');
  assertEq(normalizeCommandKey('/'), null, '(2) bare slash → null');
  assertEq(normalizeCommandKey(''), null, '(2) empty → null');
  assertEq(normalizeCommandKey('   '), null, '(2) whitespace-only → null');
  assertEq(normalizeCommandKey('help'), null, '(2) missing leading slash → null');
  assertEq(normalizeCommandKey(42 as unknown), null, '(2) non-string number → null');
  assertEq(normalizeCommandKey(null as unknown), null, '(2) null → null');
  assertEq(normalizeCommandKey(undefined as unknown), null, '(2) undefined → null');
  const longKey = normalizeCommandKey(`/${'a'.repeat(400)}`);
  assert(typeof longKey === 'string' && longKey.length <= 120, '(2) key length bounded to 120');

  // ─── (3) recordCommandUsage bumps count + lastUsedMs, purely ──────────────
  const base3: Record<string, CommandUsage> = { '/help': { command: '/help', count: 2, lastUsedMs: 1000 } };
  const r3 = recordCommandUsage(base3, '/help', 5000);
  assertEq(r3['/help'].count, 3, '(3) existing count bumped by one');
  assertEq(r3['/help'].lastUsedMs, 5000, '(3) lastUsedMs updated to now');
  assertEq(r3['/help'].command, '/help', '(3) usage.command mirrors the key');
  assert(r3 !== base3, '(3) returns a NEW map object');
  assertEq(base3['/help'].count, 2, '(3) input count NOT mutated');
  assertEq(base3['/help'].lastUsedMs, 1000, '(3) input lastUsedMs NOT mutated');
  const r3b = recordCommandUsage(undefined, '/help', 42);
  assertEq(r3b['/help'].count, 1, '(3) first-ever use starts at count 1');
  assertEq(r3b['/help'].lastUsedMs, 42, '(3) first-ever use records now');
  const r3c = recordCommandUsage(r3b, '/GH  Status ', 99);
  assertEq(r3c['/gh status'].count, 1, '(3) raw command normalized before storing');
  assertEq(r3c['/gh status'].command, '/gh status', '(3) stored under normalized key');

  // ─── (4) record with invalid command / junk input ─────────────────────────
  const junkMap = { nope: { command: 'nope', count: 5, lastUsedMs: 1 }, '/help': { command: '/help', count: 1, lastUsedMs: 1 }, '/x': 'bad' };
  const r4 = recordCommandUsage(junkMap, '   ', 100);
  assert(!('nope' in r4), '(4) non-slash key dropped');
  assert(!('/x' in r4), '(4) non-object value dropped');
  assertEq(r4['/help'].count, 1, '(4) valid entry preserved');
  assertEq(Object.keys(r4).length, 1, '(4) invalid command adds no new key');
  const r4b = recordCommandUsage(junkMap, '/new', 100);
  assertEq(r4b['/new'].count, 1, '(4) valid command still records alongside sanitize');
  assertEq(r4b['/help'].count, 1, '(4) sibling valid entry kept');
  assert(!('nope' in r4b) && !('/x' in r4b), '(4) junk still dropped on the record path');

  // ─── (5) record clamps a hostile prior count ──────────────────────────────
  const r5 = recordCommandUsage({ '/x': { command: '/x', count: Number.MAX_SAFE_INTEGER, lastUsedMs: 0 } }, '/x', 10);
  assert(r5['/x'].count <= 1_000_000 + 1, '(5) count stays bounded even from a huge prior');
  assert(Number.isFinite(r5['/x'].count), '(5) bumped count is finite');

  // ─── (6) tracked map is bounded + evicts the lowest frecency ──────────────
  let big: Record<string, CommandUsage> = {};
  for (let i = 0; i < MAX_TRACKED_COMMANDS; i += 1) {
    big = recordCommandUsage(big, `/c${i}`, i * 1000); // /c0 is the oldest
  }
  assertEq(Object.keys(big).length, MAX_TRACKED_COMMANDS, '(6) fills exactly to the cap');
  const overflow = recordCommandUsage(big, '/cnew', 500000);
  assertEq(Object.keys(overflow).length, MAX_TRACKED_COMMANDS, '(6) stays at the cap after overflow');
  assert('/cnew' in overflow, '(6) the just-recorded command survives');
  assert(!('/c0' in overflow), '(6) the lowest-frecency (oldest) command is evicted');
  assert('/c199' in overflow, '(6) a recent command is retained');
  const reuse = recordCommandUsage(big, '/c5', 999999);
  assertEq(Object.keys(reuse).length, MAX_TRACKED_COMMANDS, '(6) re-recording an existing command does not grow the map');
  assertEq(reuse['/c5'].count, 2, '(6) re-recording bumps the existing count');

  // ─── (7) frecencyScore: decay curve ───────────────────────────────────────
  assertClose(frecencyScore({ command: '/x', count: 4, lastUsedMs: 0 }, 0), 4, '(7) fresh use scores full count');
  assertClose(frecencyScore({ command: '/x', count: 4, lastUsedMs: 0 }, USAGE_HALF_LIFE_MS), 2, '(7) one half-life halves the score');
  assertClose(frecencyScore({ command: '/x', count: 4, lastUsedMs: 0 }, USAGE_HALF_LIFE_MS * 2), 1, '(7) two half-lives quarter the score');
  assertEq(frecencyScore({ command: '/x', count: 5, lastUsedMs: 1000 }, 500), 5, '(7) future lastUsedMs → no decay (age clamped)');
  assertEq(frecencyScore({ command: '/x', count: 0, lastUsedMs: 0 }, 0), 0, '(7) count 0 → 0');
  assertEq(frecencyScore({ command: '/x', count: 3, lastUsedMs: 100 }, NaN), 3, '(7) invalid now → frequency only');

  // ─── (8) frecencyScore: monotonic in count + recency ──────────────────────
  assert(
    frecencyScore({ count: 2, lastUsedMs: 0 } as unknown, 1000) > frecencyScore({ count: 1, lastUsedMs: 0 } as unknown, 1000),
    '(8) higher count → higher score',
  );
  assert(
    frecencyScore({ count: 2, lastUsedMs: 1000 } as unknown, 2000) > frecencyScore({ count: 2, lastUsedMs: 0 } as unknown, 2000),
    '(8) more recent → higher score at equal count',
  );

  // ─── (9) rerank: frequent + recent floats to the front ────────────────────
  const cmds9 = [{ command: '/help' }, { command: '/summary' }, { command: '/gh status' }, { command: '/mission create' }];
  let u9: Record<string, CommandUsage> = {};
  u9 = recordCommandUsage(u9, '/gh status', 1000);
  u9 = recordCommandUsage(u9, '/gh status', 2000);
  u9 = recordCommandUsage(u9, '/gh status', 3000);
  u9 = recordCommandUsage(u9, '/help', 10); // once, long ago
  const ranked9 = rerankByFrecency(cmds9, u9, 3000);
  assertEq(ranked9.length, 4, '(9) length preserved');
  assertEq(ranked9[0].command, '/gh status', '(9) most frequent+recent ranks first');
  assertEq(ranked9[1].command, '/help', '(9) other used command second');
  assertEq(ranked9[2].command, '/summary', '(9) unused keep original order (summary)');
  assertEq(ranked9[3].command, '/mission create', '(9) unused keep original order (mission create)');
  assertEq(sortedCommands(ranked9), sortedCommands(cmds9), '(9) output is a permutation of the input');

  // ─── (10) rerank: arg variants credit the most-specific candidate ─────────
  const cmds10 = [{ command: '/gh' }, { command: '/gh cat' }, { command: '/gh status' }, { command: '/help' }];
  let u10: Record<string, CommandUsage> = {};
  u10 = recordCommandUsage(u10, '/gh cat a.ts', 1000);
  u10 = recordCommandUsage(u10, '/gh cat b.ts', 1000);
  const ranked10 = rerankByFrecency(cmds10, u10, 1000);
  assertEq(ranked10[0].command, '/gh cat', '(10) /gh cat a.ts + b.ts credit /gh cat');
  assertEq(ranked10[1].command, '/gh', '(10) /gh NOT boosted (most-specific wins) — original order');
  assertEq(ranked10[2].command, '/gh status', '(10) unused /gh status keeps order');
  assertEq(ranked10[3].command, '/help', '(10) unused /help keeps order');
  assertEq(sortedCommands(ranked10), sortedCommands(cmds10), '(10) permutation preserved');

  // ─── (11) rerank: longest-prefix + exact-parent assignment ────────────────
  const ranked11a = rerankByFrecency([{ command: '/gh' }, { command: '/gh status' }], recordCommandUsage({}, '/gh status foo bar', 1000), 1000);
  assertEq(ranked11a[0].command, '/gh status', '(11) "/gh status foo bar" → longest match /gh status');
  assertEq(ranked11a[1].command, '/gh', '(11) /gh not credited by the deeper key');
  const ranked11b = rerankByFrecency([{ command: '/gh status' }, { command: '/gh' }], recordCommandUsage({}, '/gh', 1000), 1000);
  assertEq(ranked11b[0].command, '/gh', '(11) exact "/gh" credits /gh');
  assertEq(ranked11b[1].command, '/gh status', '(11) /gh status not credited by a bare /gh use');
  // word-boundary: "/ghost" must not match candidate "/gh"
  const ranked11c = rerankByFrecency([{ command: '/gh' }, { command: '/help' }], { '/ghost': { command: '/ghost', count: 9, lastUsedMs: 1000 } }, 1000);
  assertEq(ranked11c[0].command, '/gh', '(11) no usage match → original order (gh)');
  assertEq(ranked11c[1].command, '/help', '(11) "/ghost" does not falsely boost "/gh"');

  // ─── (12) rerank: no / empty usage → identity order, new array ────────────
  const cmds12 = [{ command: '/a' }, { command: '/b' }, { command: '/c' }];
  const ranked12 = rerankByFrecency(cmds12, {}, 1000);
  assertEq(ranked12.map((c) => c.command).join(','), '/a,/b,/c', '(12) empty usage keeps original order');
  assert(ranked12 !== cmds12, '(12) returns a NEW array');
  assertEq(cmds12[0].command, '/a', '(12) input array order not mutated');
  const ranked12b = rerankByFrecency(cmds12, { '/zzz': { command: '/zzz', count: 5, lastUsedMs: 1000 } }, 1000);
  assertEq(ranked12b.map((c) => c.command).join(','), '/a,/b,/c', '(12) usage with no matching candidate → identity order');

  // ─── (13) rerank: stable ties keep original relative order ────────────────
  let u13: Record<string, CommandUsage> = {};
  u13 = recordCommandUsage(u13, '/aa', 1000);
  u13 = recordCommandUsage(u13, '/bb', 1000); // identical frecency to /aa
  const ranked13 = rerankByFrecency([{ command: '/zz' }, { command: '/aa' }, { command: '/bb' }], u13, 1000);
  assertEq(ranked13[0].command, '/aa', '(13) tie → earlier original index first (aa)');
  assertEq(ranked13[1].command, '/bb', '(13) tie → later original index second (bb)');
  assertEq(ranked13[2].command, '/zz', '(13) unused command trails');

  // ─── (14) rerank: summed frecency across variants outranks a single use ───
  let u14: Record<string, CommandUsage> = {};
  u14 = recordCommandUsage(u14, '/gh cat one', 1000);
  u14 = recordCommandUsage(u14, '/gh cat two', 1000);
  u14 = recordCommandUsage(u14, '/gh cat three', 1000);
  u14 = recordCommandUsage(u14, '/help', 1000); // single use, same instant
  const ranked14 = rerankByFrecency([{ command: '/help' }, { command: '/gh cat' }], u14, 1000);
  assertEq(ranked14[0].command, '/gh cat', '(14) three arg-variants outrank one /help use');
  assertEq(ranked14[1].command, '/help', '(14) /help second');

  // ─── (15) rerank: determinism ─────────────────────────────────────────────
  const d1 = rerankByFrecency(cmds9, u9, 3000).map((c) => c.command).join('|');
  const d2 = rerankByFrecency(cmds9, u9, 3000).map((c) => c.command).join('|');
  assertEq(d1, d2, '(15) same inputs → identical output');

  // ─── (16) rerank: realistic bare-"/" list keeps all commands ──────────────
  const fullList = ['/help', '/summary', '/wiki', '/memories', '/mission', '/gh status', '/gh prs', '/wp list', '/vault', '/browser plan', '/search', '/context'].map((command) => ({ command }));
  let uFull: Record<string, CommandUsage> = {};
  uFull = recordCommandUsage(uFull, '/gh prs', 5000);
  uFull = recordCommandUsage(uFull, '/gh prs', 6000);
  uFull = recordCommandUsage(uFull, '/context lean', 6100);
  const rankedFull = rerankByFrecency(fullList, uFull, 6100);
  assertEq(rankedFull.length, fullList.length, '(16) no command dropped from the full list');
  assertEq(sortedCommands(rankedFull), sortedCommands(fullList), '(16) full list is a permutation (no dupes)');
  assertEq(rankedFull[0].command, '/gh prs', '(16) heaviest command floats to the very top');
  assertEq(rankedFull[1].command, '/context', '(16) "/context lean" credits the /context candidate');

  // ─── (17) hostile / degenerate inputs never throw ─────────────────────────
  try {
    // recordCommandUsage
    assert(typeof recordCommandUsage(undefined, undefined as unknown, NaN) === 'object', '(17) record(undefined, undefined, NaN) → object');
    assert(typeof recordCommandUsage(null, '/x', 1) === 'object', '(17) record(null, ...) → object');
    assert(typeof recordCommandUsage(42 as unknown, '/x', 1) === 'object', '(17) record(number, ...) → object');
    assert(typeof recordCommandUsage('str' as unknown, '/x', 1) === 'object', '(17) record(string, ...) → object');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic['/x'] = { command: '/x', count: 1, lastUsedMs: 1 };
    const rc = recordCommandUsage(cyclic, '/y', 5);
    assertEq(rc['/x'].count, 1, '(17) cyclic map: valid slash entry survives');
    assertEq(rc['/y'].count, 1, '(17) cyclic map: new command still recorded');
    assert(!('self' in rc), '(17) cyclic self-key (no slash) dropped');

    // frecencyScore
    assertEq(frecencyScore(undefined as unknown, 1), 0, '(17) score(undefined) → 0');
    assertEq(frecencyScore(null as unknown, 1), 0, '(17) score(null) → 0');
    assertEq(frecencyScore(42 as unknown, 1), 0, '(17) score(number) → 0');
    assertEq(frecencyScore('nope' as unknown, 1), 0, '(17) score(string) → 0');
    assertEq(frecencyScore({ count: 'x', lastUsedMs: 'y' } as unknown, 1), 0, '(17) score(non-numeric fields) → 0');
    assertEq(frecencyScore({ count: Infinity, lastUsedMs: 1 } as unknown, 1), 0, '(17) score(Infinity count) → 0');
    assert(Number.isFinite(frecencyScore({ count: 1e400, lastUsedMs: 1 } as unknown, 1e400)), '(17) score(overflow) is finite');

    // rerankByFrecency
    assertEq(rerankByFrecency(undefined as unknown as Array<{ command: string }>, {}, 1).length, 0, '(17) rerank(undefined) → []');
    assertEq(rerankByFrecency(null as unknown as Array<{ command: string }>, {}, 1).length, 0, '(17) rerank(null) → []');
    assertEq(rerankByFrecency(42 as unknown as Array<{ command: string }>, {}, 1).length, 0, '(17) rerank(number) → []');
    assertEq(rerankByFrecency('nope' as unknown as Array<{ command: string }>, {}, 1).length, 0, '(17) rerank(string) → []');
    const junkList = [null, 5, { command: '/a' }, { nope: 1 }, { command: 42 }] as unknown as Array<{ command: string }>;
    const junkRanked = rerankByFrecency(junkList, { '/a': { command: '/a', count: 3, lastUsedMs: 1 } }, 2);
    assertEq(junkRanked.length, 5, '(17) junk elements preserved — none dropped');
    assertEq((junkRanked[0] as { command?: unknown }).command, '/a', '(17) valid used element floats past the junk');
    assert(typeof rerankByFrecency([{ command: '/a' }], undefined, 1)[0] === 'object', '(17) rerank(list, undefined usage) → identity');
    assert(typeof rerankByFrecency([{ command: '/a' }], null, 1)[0] === 'object', '(17) rerank(list, null usage) → identity');
    assert(typeof rerankByFrecency([{ command: '/a' }], 'x' as unknown, 1)[0] === 'object', '(17) rerank(list, string usage) → identity');
    assertEq(rerankByFrecency([{ command: '/a' }], { '/a': null } as unknown, 1)[0].command, '/a', '(17) rerank with null usage value → identity');
    normalizeCommandKey(Symbol('x') as unknown);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (17) hostile inputs threw :: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll command-frecency-core smoke cases passed (' + passes + ' passed).');
}

main();
