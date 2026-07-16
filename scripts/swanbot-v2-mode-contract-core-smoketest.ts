/**
 * Smoke for swanbotV2ModeContractCore — pins the LOCKSTEP mirror of the edge
 * MODE_CONTRACT (supabase/functions/swanbot-v2-ai/index.ts:111-128) + totality.
 * If the edge strings change, this smoke breaks — update BOTH in lockstep.
 */
import {
  V2_MODE_CONTRACT,
  v2ModeContractFor,
  appendV2ModeContract,
  type SwanbotV2Mode,
} from '../src/lib/swanbotV2ModeContractCore';

let passes = 0, failures = 0;
function assert(c: boolean, m: string, e?: string) { if (c) passes++; else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); } }
function assertEq(a: unknown, b: unknown, m: string) { assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// The pinned edge strings (byte-identical copies of index.ts:111-128).
const EDGE: Record<SwanbotV2Mode, string> = {
  talk: 'Respond like a strong senior teammate: concise, grounded, calm. No fluff, no forced enthusiasm.',
  build: 'Act like a professional implementation lead. Be specific, execution-first, technically accountable. Prefer exact files, commands, interfaces. State assumptions.',
  plan: "Frame the work, identify risks, order subtasks. Don't pretend to be certain when the problem is still underspecified.",
  execute: 'Do the task directly. Minimal preamble. Report outcome, not intention.',
  review: "Find real problems, ranked by severity. Cite files/lines. Don't pad with generic advice.",
  research: 'Survey before synthesis. Cite sources. Distinguish evidence from opinion.',
  support: 'Diagnose before prescribing. Ask the smallest question that unblocks the user.',
  design: 'Start from constraints and audience. Give one recommendation with one tradeoff.',
};

function main() {
  // ── Group 1: lockstep — every mode matches the edge byte-for-byte ──────────
  const modes = Object.keys(EDGE) as SwanbotV2Mode[];
  assertEq(modes.length, 8, '1.0 exactly 8 modes');
  for (const m of modes) {
    assertEq(V2_MODE_CONTRACT[m], EDGE[m], `1.${m} map matches edge`);
    assertEq(v2ModeContractFor(m), EDGE[m], `1.${m}.fn matches edge`);
  }

  // ── Group 2: default / unknown / hostile → talk contract (never throws) ────
  assertEq(v2ModeContractFor('none'), EDGE.talk, '2.1 none → talk');
  assertEq(v2ModeContractFor(''), EDGE.talk, '2.2 empty → talk');
  assertEq(v2ModeContractFor('  BUILD '), EDGE.build, '2.3 trim + lowercase');
  assertEq(v2ModeContractFor('nonsense'), EDGE.talk, '2.4 unknown → talk');
  const hostile = [null, undefined, 42, {}, [], true, Symbol('x'), () => {}, { toString() { throw new Error('x'); } }];
  for (let i = 0; i < hostile.length; i++) {
    let threw = false; let out = '';
    try { out = v2ModeContractFor(hostile[i]); } catch { threw = true; }
    assert(!threw, `2.5.${i} v2ModeContractFor never throws on hostile`);
    assertEq(out, EDGE.talk, `2.5.${i} hostile → talk`);
  }

  // ── Group 3: appendV2ModeContract ──────────────────────────────────────────
  assertEq(appendV2ModeContract('SYS', 'build'), `SYS\n\n[MODE RESPONSE CONTRACT]\n${EDGE.build}`, '3.1 appends block');
  assertEq(appendV2ModeContract('', 'talk'), `[MODE RESPONSE CONTRACT]\n${EDGE.talk}`, '3.2 empty base → just the block');
  assertEq(appendV2ModeContract('SYS', 'zzz'), `SYS\n\n[MODE RESPONSE CONTRACT]\n${EDGE.talk}`, '3.3 unknown mode → talk block');
  // hostile base never throws
  let t = false; try { appendV2ModeContract(null, null); } catch { t = true; }
  assert(!t, '3.4 hostile append never throws');

  // ── Group 4: the map is frozen (immutable) ─────────────────────────────────
  let frozeThrew = false;
  try { (V2_MODE_CONTRACT as Record<string, string>).talk = 'mutated'; } catch { frozeThrew = true; }
  assert(V2_MODE_CONTRACT.talk === EDGE.talk, '4.1 frozen map unchanged by mutation attempt');
  assert(frozeThrew || V2_MODE_CONTRACT.talk === EDGE.talk, '4.2 Object.freeze holds');

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll swanbot-v2-mode-contract-core smoke cases passed (' + passes + ' passed).');
}
main();
