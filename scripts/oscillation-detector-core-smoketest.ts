/**
 * oscillation-detector-core-smoketest — the pure A-B-A-B thrash detector
 * (src/lib/oscillationDetectorCore.ts) that complements the EXACT-repeat stuck
 * guard in agentExecutionCore (toolLoopStuckCore.detectRepeatedToolFailure).
 * Load-bearing assertions:
 *
 *   detectOscillatingFailure(recent, opts):
 *   - canonical A-B-A-B (all failed) → stuck, pattern "A→B";
 *   - a success interrupting the trailing run ("no success in between") →
 *     not stuck ([A✗,B✓,A✗], success-at-tail, success-mid-run);
 *   - an EXACT repeat ([A✗,A✗], [A✗×4]) is NOT oscillation (distinct<2,
 *     deferred to detectRepeatedToolFailure);
 *   - short history / <minCycles full cycles → not stuck;
 *   - period-3 A-B-C-A-B-C and A-A-B-A-A-B → stuck; 3× cycle counts repeats;
 *   - minCycles + window opts clamp and gate detection;
 *   - argsKey disambiguates same-named calls (click#exp vs click#sav);
 *   - leading junk-failure / earlier success before the run still detects;
 *   - pattern/reason are bounded and content-correct.
 *
 *   And: every export is TOTAL — null / undefined / wrong-type / hostile /
 *   huge input never throws, always a safe neutral verdict.
 *
 * Pure — loads under tsx (oscillationDetectorCore has zero imports).
 */

import {
  detectOscillatingFailure,
  oscillationCallSignature,
  OSC_DEFAULT_MIN_CYCLES,
  OSC_DEFAULT_WINDOW,
  OSC_MAX_PERIOD,
  type ToolCallRecord,
  type OscillationVerdict,
} from '../src/lib/oscillationDetectorCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else { failures += 1; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// failed / succeeded call factories.
const f = (name: string, argsKey?: string): ToolCallRecord =>
  (argsKey !== undefined ? { name, ok: false, argsKey } : { name, ok: false });
const s = (name: string, argsKey?: string): ToolCallRecord =>
  (argsKey !== undefined ? { name, ok: true, argsKey } : { name, ok: true });

function main(): void {
  // ── 1. Canonical A-B-A-B thrash → stuck ────────────────────────────────────
  {
    const v = detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')]);
    assertEq(v.stuck, true, '(1) A-B-A-B → stuck');
    assertEq(v.pattern, 'A→B', '(1) A-B-A-B pattern');
    assert(v.reason.includes('oscillating'), '(1) reason names oscillation', v.reason);
    assert(v.reason.includes('→'), '(1) reason includes the cycle arrow', v.reason);
    assert(v.reason.includes('no success between'), '(1) reason states no-success', v.reason);
    assert(v.reason.includes('2×'), '(1) reason counts 2 cycles', v.reason);
  }

  // ── 2. A success in the trailing run → not stuck ("no success in between") ──
  {
    // canonical smoke example: success between two A failures
    const v1 = detectOscillatingFailure([f('A'), s('B'), f('A')]);
    assertEq(v1.stuck, false, '(2) [A✗,B✓,A✗] → not stuck');
    assertEq(v1.pattern, '', '(2) not-stuck pattern empty');
    assertEq(v1.reason, '', '(2) not-stuck reason empty');
    // most-recent call succeeded → trailing failure run is empty
    const v2 = detectOscillatingFailure([f('A'), f('B'), f('A'), f('B'), s('C')]);
    assertEq(v2.stuck, false, '(2) success at tail → not stuck');
    // success cuts the run mid-pattern, leaving too few failures after it
    const v3 = detectOscillatingFailure([f('A'), f('B'), s('C'), f('A'), f('B')]);
    assertEq(v3.stuck, false, '(2) success mid-run → not stuck');
    // success cuts a longer pre-run but the post-run tail still oscillates
    const v4 = detectOscillatingFailure([f('A'), f('B'), f('A'), s('ok'), f('A'), f('B'), f('A'), f('B')]);
    assertEq(v4.stuck, true, '(2) oscillation AFTER a success still detected');
    assertEq(v4.pattern, 'A→B', '(2) post-success pattern');
  }

  // ── 3. Exact repeat is NOT oscillation (distinct<2, other guard's job) ──────
  {
    assertEq(detectOscillatingFailure([f('A'), f('A')]).stuck, false, '(3) [A✗,A✗] → not oscillation');
    assertEq(detectOscillatingFailure([f('A'), f('A'), f('A'), f('A')]).stuck, false, '(3) A✗×4 → not oscillation');
    assertEq(
      detectOscillatingFailure([f('A'), f('A'), f('A'), f('A'), f('A'), f('A')]).stuck,
      false,
      '(3) A✗×6 → not oscillation',
    );
    // same name, absent argsKey, alternating "positions" is still one symbol
    assertEq(detectOscillatingFailure([f('go'), f('go'), f('go'), f('go')]).stuck, false, '(3) same-call ×4 → not oscillation');
  }

  // ── 4. Short history / too few full cycles → not stuck ──────────────────────
  {
    assertEq(detectOscillatingFailure([]).stuck, false, '(4) empty → not stuck');
    assertEq(detectOscillatingFailure([f('A')]).stuck, false, '(4) single call → not stuck');
    assertEq(detectOscillatingFailure([f('A'), f('B')]).stuck, false, '(4) one A-B (1 cycle) → not stuck');
    assertEq(detectOscillatingFailure([f('A'), f('B'), f('A')]).stuck, false, '(4) A-B-A (1.5 cycles) → not stuck');
    assertEq(detectOscillatingFailure([f('A'), f('B'), f('C')]).stuck, false, '(4) one A-B-C (1 cycle) → not stuck');
  }

  // ── 5. Longer cycles + repeat counting ──────────────────────────────────────
  {
    const v3 = detectOscillatingFailure([f('A'), f('B'), f('C'), f('A'), f('B'), f('C')]);
    assertEq(v3.stuck, true, '(5) A-B-C-A-B-C → stuck');
    assertEq(v3.pattern, 'A→B→C', '(5) period-3 pattern');
    // 3× period-2 → smallest period wins, repeats counted as 3
    const v3x = detectOscillatingFailure([f('A'), f('B'), f('A'), f('B'), f('A'), f('B')]);
    assertEq(v3x.stuck, true, '(5) A-B ×3 → stuck');
    assertEq(v3x.pattern, 'A→B', '(5) A-B ×3 reports fundamental period');
    assert(v3x.reason.includes('3×'), '(5) A-B ×3 reason counts 3 cycles', v3x.reason);
    // internal-structure period-3: A-A-B-A-A-B
    const vaab = detectOscillatingFailure([f('A'), f('A'), f('B'), f('A'), f('A'), f('B')]);
    assertEq(vaab.stuck, true, '(5) A-A-B-A-A-B → stuck');
    assertEq(vaab.pattern, 'A→A→B', '(5) A-A-B pattern');
    // tail-aligned cycle when history ends mid-period: A-B-A-B-A → tail B-A ×2
    const vtail = detectOscillatingFailure([f('A'), f('B'), f('A'), f('B'), f('A')]);
    assertEq(vtail.stuck, true, '(5) A-B-A-B-A → stuck (tail-aligned)');
    assertEq(vtail.pattern, 'B→A', '(5) tail-aligned pattern is B→A');
    // 3-cycle period-3
    const v33 = detectOscillatingFailure([f('A'), f('B'), f('C'), f('A'), f('B'), f('C'), f('A'), f('B'), f('C')]);
    assertEq(v33.stuck, true, '(5) A-B-C ×3 → stuck');
    assertEq(v33.pattern, 'A→B→C', '(5) A-B-C ×3 pattern');
  }

  // ── 6. minCycles option gates detection ─────────────────────────────────────
  {
    // A-B-A-B is only 2 cycles → needs 3 → not stuck
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: 3 }).stuck,
      false,
      '(6) minCycles=3 on 2 cycles → not stuck',
    );
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B'), f('A'), f('B')], { minCycles: 3 }).stuck,
      true,
      '(6) minCycles=3 on 3 cycles → stuck',
    );
    // minCycles below the floor clamps to 2 (a single A-B is still not enough)
    assertEq(
      detectOscillatingFailure([f('A'), f('B')], { minCycles: 1 }).stuck,
      false,
      '(6) minCycles=1 clamps to 2 → one cycle still not stuck',
    );
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: 1 }).stuck,
      true,
      '(6) minCycles=1 clamps to 2 → two cycles stuck',
    );
    // 0 / negative / non-number clamp to the default (2)
    assertEq(detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: 0 }).stuck, true, '(6) minCycles=0 → default');
    assertEq(detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: -5 }).stuck, true, '(6) minCycles=-5 → default');
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: NaN as unknown as number }).stuck,
      true,
      '(6) minCycles=NaN → default',
    );
    // absurdly high clamps to 8 → 2-cycle input can never meet it
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: 999 }).stuck,
      false,
      '(6) minCycles=999 clamps to 8 → not stuck',
    );
  }

  // ── 7. window option bounds what is inspected ───────────────────────────────
  {
    // window=2 only sees the last two calls → cannot see A-B-A-B
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { window: 2 }).stuck,
      false,
      '(7) window=2 → too small to see the cycle',
    );
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { window: 4 }).stuck,
      true,
      '(7) window=4 → sees the cycle',
    );
    // a success older than the window is irrelevant; the visible tail oscillates
    const many: ToolCallRecord[] = [];
    for (let i = 0; i < 30; i++) many.push(i % 2 === 0 ? f('A') : f('B'));
    assertEq(detectOscillatingFailure(many).stuck, true, '(7) long alternating tail → stuck (default window)');
    // window clamps: junk/huge value falls back / bounds without throwing
    assertEq(detectOscillatingFailure(many, { window: -1 }).stuck, false, '(7) window=-1 clamps to floor (2) → too small, no throw');
    assertEq(detectOscillatingFailure(many, { window: 1e9 }).stuck, true, '(7) window=1e9 clamps to 64, still detects');
  }

  // ── 8. argsKey disambiguates same-named calls ───────────────────────────────
  {
    const clicks = [f('click', 'exp'), f('click', 'sav'), f('click', 'exp'), f('click', 'sav')];
    const v = detectOscillatingFailure(clicks);
    assertEq(v.stuck, true, '(8) click#exp / click#sav alternating → stuck');
    assertEq(v.pattern, 'click#exp→click#sav', '(8) argsKey shown in pattern');
    // same name + same argsKey ×4 → exact repeat, not oscillation
    assertEq(
      detectOscillatingFailure([f('click', 'exp'), f('click', 'exp'), f('click', 'exp'), f('click', 'exp')]).stuck,
      false,
      '(8) same name+args ×4 → not oscillation',
    );
    // name matches but argsKey differs cyclically over 3 keys
    const v3 = detectOscillatingFailure([
      f('t', 'a'), f('t', 'b'), f('t', 'c'), f('t', 'a'), f('t', 'b'), f('t', 'c'),
    ]);
    assertEq(v3.stuck, true, '(8) t#a/t#b/t#c cycle → stuck');
    assertEq(v3.pattern, 't#a→t#b→t#c', '(8) three-argsKey pattern');
  }

  // ── 9. Leading junk failure / earlier success before the oscillation ────────
  {
    const vlead = detectOscillatingFailure([f('X'), f('A'), f('B'), f('A'), f('B')]);
    assertEq(vlead.stuck, true, '(9) leading one-off failure then A-B-A-B → stuck');
    assertEq(vlead.pattern, 'A→B', '(9) leading-junk pattern');
    const vsucc = detectOscillatingFailure([s('setup'), f('A'), f('B'), f('A'), f('B')]);
    assertEq(vsucc.stuck, true, '(9) earlier success then oscillation → stuck');
  }

  // ── 10. Output bounds + content correctness ─────────────────────────────────
  {
    const stuck = detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')]);
    assert(stuck.pattern.length > 0, '(10) stuck → non-empty pattern');
    assert(stuck.reason.length > 0, '(10) stuck → non-empty reason');
    const notStuck = detectOscillatingFailure([f('A')]);
    assertEq(notStuck.pattern, '', '(10) not-stuck → empty pattern');
    assertEq(notStuck.reason, '', '(10) not-stuck → empty reason');
    // a pathological giant tool name must not bloat pattern/reason
    const big = 'Z'.repeat(50000);
    const vbig = detectOscillatingFailure([f(big), f('B'), f(big), f('B')]);
    assertEq(vbig.stuck, true, '(10) huge-name oscillation still detected');
    assert(vbig.pattern.length <= 200, '(10) pattern bounded despite huge name', String(vbig.pattern.length));
    assert(vbig.reason.length <= 260, '(10) reason bounded despite huge name', String(vbig.reason.length));
    // huge argsKey too
    const vbig2 = detectOscillatingFailure([f('c', big), f('c', 'x'), f('c', big), f('c', 'x')]);
    assertEq(vbig2.stuck, true, '(10) huge-argsKey oscillation still detected');
    assert(vbig2.pattern.length <= 200, '(10) pattern bounded despite huge argsKey', String(vbig2.pattern.length));
  }

  // ── 11. oscillationCallSignature helper ─────────────────────────────────────
  {
    assertEq(
      oscillationCallSignature({ name: 'A', ok: false }),
      oscillationCallSignature({ name: 'A', ok: true }),
      '(11) signature ignores ok',
    );
    assertEq(
      oscillationCallSignature({ name: 'A', ok: false }),
      oscillationCallSignature({ name: 'A', ok: false, argsKey: '' }),
      '(11) absent argsKey == empty argsKey',
    );
    assert(
      oscillationCallSignature({ name: 'A', argsKey: 'x' }) !== oscillationCallSignature({ name: 'A', argsKey: 'y' }),
      '(11) different argsKey → different sig',
    );
    assert(
      oscillationCallSignature({ name: 'A' }) !== oscillationCallSignature({ name: 'B' }),
      '(11) different name → different sig',
    );
    assertEq(oscillationCallSignature(null), '', '(11) null → empty sig');
    assertEq(oscillationCallSignature(undefined), '', '(11) undefined → empty sig');
    assertEq(oscillationCallSignature(42), '', '(11) number → empty sig');
    assertEq(oscillationCallSignature('str'), '', '(11) string → empty sig');
  }

  // ── 12. Exported constants are sane ─────────────────────────────────────────
  {
    assertEq(OSC_DEFAULT_MIN_CYCLES, 2, '(12) default minCycles');
    assertEq(OSC_DEFAULT_WINDOW, 16, '(12) default window');
    assertEq(OSC_MAX_PERIOD, 8, '(12) max period');
    // period beyond the cap is (conservatively) not detected: period-9 ×2
    const p9: ToolCallRecord[] = [];
    for (let rep = 0; rep < 2; rep++) for (let i = 0; i < 9; i++) p9.push(f('T' + i));
    assertEq(detectOscillatingFailure(p9).stuck, false, '(12) period-9 cycle > OSC_MAX_PERIOD → not detected');
  }

  // ── 13. Degenerate / hostile input — must NEVER throw ───────────────────────
  try {
    const hostile: unknown[] = [
      null, undefined, 42, 0, NaN, true, false, 'string', {}, [],
      { name: 'A' }, { ok: false }, { stuck: 1 }, Symbol('x') as unknown,
    ];
    for (const h of hostile) {
      const v = detectOscillatingFailure(h);
      assert(typeof v.stuck === 'boolean', '(13) verdict.stuck is boolean for hostile input');
      assertEq(v.stuck, false, '(13) hostile scalar → not stuck');
      assertEq(typeof v.pattern, 'string', '(13) verdict.pattern always string');
      assertEq(typeof v.reason, 'string', '(13) verdict.reason always string');
    }
    // arrays full of junk entries
    const junkArr = [null, undefined, 5, {}, 'x', [], true, { name: 1, ok: false }] as unknown as ToolCallRecord[];
    const vj: OscillationVerdict = detectOscillatingFailure(junkArr);
    assertEq(vj.stuck, false, '(13) junk-entry array → not stuck');
    // records missing a name but strictly failed (name coerces to '') → same
    // symbol → exact repeat, not oscillation; must not throw
    const noName = [{ ok: false }, { ok: false }, { ok: false }, { ok: false }] as unknown as ToolCallRecord[];
    assertEq(detectOscillatingFailure(noName).stuck, false, '(13) nameless failures → not oscillation');
    // non-string names (number/object) coerce safely and can still oscillate
    const numNames = [
      { name: 1, ok: false }, { name: 2, ok: false }, { name: 1, ok: false }, { name: 2, ok: false },
    ] as unknown as ToolCallRecord[];
    assertEq(detectOscillatingFailure(numNames).stuck, true, '(13) numeric names coerce + oscillate');
    // name / argsKey whose toString THROWS must be caught (never propagates)
    const boom = { toString() { throw new Error('boom'); } };
    const throwers = [
      { name: boom, ok: false }, { name: 'B', ok: false },
      { name: boom, ok: false }, { name: 'B', ok: false },
    ] as unknown as ToolCallRecord[];
    const vt = detectOscillatingFailure(throwers);
    assertEq(typeof vt.stuck, 'boolean', '(13) throwing toString → no propagation');
    assertEq(oscillationCallSignature({ name: boom, ok: false } as unknown), oscillationCallSignature({ name: boom, ok: false } as unknown), '(13) throwing-name sig stable + safe');
    // opts hostile shapes
    assertEq(detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], null as unknown as {}).stuck, true, '(13) opts=null tolerated');
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: 'x', window: {} } as unknown as { minCycles?: number }).stuck,
      true,
      '(13) opts with junk fields → defaults',
    );
    assertEq(
      detectOscillatingFailure([f('A'), f('B'), f('A'), f('B')], { minCycles: Infinity, window: -Infinity } as unknown as { minCycles?: number }).stuck,
      true,
      '(13) non-finite opts fall back to defaults → stuck',
    );
    // huge array performance/bound — must not throw and stays fast
    const huge: ToolCallRecord[] = [];
    for (let i = 0; i < 20000; i++) huge.push(i % 2 === 0 ? f('A') : f('B'));
    const vh = detectOscillatingFailure(huge);
    assertEq(vh.stuck, true, '(13) 20k-entry alternating array → stuck, no throw');
    // argsKey as object / symbol / number coerces safely
    const oddArgs = [
      { name: 'k', ok: false, argsKey: 1 }, { name: 'k', ok: false, argsKey: 2 },
      { name: 'k', ok: false, argsKey: 1 }, { name: 'k', ok: false, argsKey: 2 },
    ] as unknown as ToolCallRecord[];
    assertEq(detectOscillatingFailure(oddArgs).stuck, true, '(13) numeric argsKey coerces + oscillates');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error('FAIL: (13) degenerate inputs threw: ' + ((e as Error) && (e as Error).message));
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll oscillation-detector-core smoke cases passed (' + passes + ' passed).');
}

main();
