/**
 * edge-context-compaction-smoketest — the LOCKSTEP guarantee that the v2 edge
 * pre-turn context compaction (supabase/functions/_shared/context-compaction.ts)
 * behaves EXACTLY like the client executors in src/lib/agentExecutionCore.ts on
 * the shared (string tool_result) message shape, so long multi-round edge runs
 * compact the same way client runs do — and never die on "prompt too long".
 *
 * Asserted:
 *   LOCKSTEP  — identical stub outputs (stubbedIndices/freedChars/bytes),
 *               identical shave outputs (returned estimate + bytes), identical
 *               token estimates, identical marker constants, and identical
 *               full-pipeline (plan → stub → shave) end states vs a client-side
 *               composite built from the same shared cores.
 *   SAFETY    — tool_use/tool_result ids and pairing survive stub AND shave;
 *               post-shave estimate ≤ hardLimit; stub is idempotent (second
 *               pass is a byte-identical no-op); 'none' tier leaves the history
 *               byte-identical; safety net fires when the plan says 'none' but
 *               the live estimate is over the hard limit; bounded reasons.
 *
 * Pure — loads under tsx (the edge mirror imports only the two zero-import
 * shared cores). Run:  npx tsx scripts/edge-context-compaction-smoketest.ts
 */

import {
  DROPPED_TOOL_RESULT_MARKER_PREFIX,
  HARD_TRUNCATE_MARKER_TEXT,
  shaveMessagesTextToHardLimit,
  stubStaleToolResultContents,
  type AgentMessage,
} from '../src/lib/agentExecutionCore';
import { estimateMessagesTokens as clientEstimateMessagesTokens } from '../src/lib/agentContextCompression';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, planCompactionTier } from '../src/lib/contextCompactionTierCore';
import { projectMessagesForCompaction } from '../src/lib/openswanContextCompactionCore';
import * as edge from '../supabase/functions/_shared/context-compaction.ts';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ─── Fixtures (edge shape: tool_result content is always a plain string) ─────

type FixtureBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type FixtureMessage = { role: 'user' | 'assistant'; content: string | FixtureBlock[] };

function clone(msgs: FixtureMessage[]): FixtureMessage[] {
  return JSON.parse(JSON.stringify(msgs)) as FixtureMessage[];
}

/** n pseudo-words so word-boundary truncation has boundaries to snap to. */
function words(n: number, seed: string): string {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(`${seed}${i % 97}pad`);
  return out.join(' ');
}

/** ~minChars of multi-line build-log-ish output (spaces + newlines). */
function buildLog(minChars: number, round: number): string {
  const lines: string[] = [];
  let len = 0;
  let i = 0;
  while (len < minChars) {
    const line = `round ${round} step ${i} ok — compiled module ${i} with ordinary output padding here`;
    lines.push(line);
    len += line.length + 1;
    i += 1;
  }
  return lines.join('\n');
}

/** Tool-loop history: briefing, `rounds` × (assistant tool_use + user tool_result), wrap-up. */
function buildToolLoopHistory(rounds: number, resultChars: number): FixtureMessage[] {
  const msgs: FixtureMessage[] = [
    { role: 'user', content: `Run the build and fix every failure. ${words(40, 'brief')}` },
  ];
  for (let i = 0; i < rounds; i += 1) {
    msgs.push({
      role: 'assistant',
      content: [
        { type: 'text', text: `working on round ${i}` },
        { type: 'tool_use', id: `tu_${i}`, name: 'local.run_shell', input: { command: `npm run step-${i}`, cwd: '/repo' } },
      ],
    });
    msgs.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: buildLog(resultChars, i) }],
    });
  }
  msgs.push({ role: 'assistant', content: [{ type: 'text', text: `assessing results ${words(30, 'assess')}` }] });
  msgs.push({ role: 'user', content: `Continue and finish the task. ${words(50, 'final')}` });
  return msgs;
}

/** [ordered tool_use ids, ordered tool_result tool_use_ids] across the history. */
function collectIds(msgs: FixtureMessage[]): [string, string] {
  const uses: string[] = [];
  const results: string[] = [];
  for (const m of msgs) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') uses.push(b.id);
      else if (b.type === 'tool_result') results.push(b.tool_use_id);
    }
  }
  return [uses.join(','), results.join(',')];
}

/** Per-message block-type signatures — shape must survive compaction exactly. */
function shapeSignature(msgs: FixtureMessage[]): string {
  return msgs
    .map((m) => (typeof m.content === 'string' ? 's' : m.content.map((b) => b.type).join('+')))
    .join('|');
}

/** Client-side composite of the SAME wiring the edge entry mirrors:
 *  plan (shared core) → drop-tier stub → unconditional hard-limit shave.
 *  Returns the final live estimate; mutates `msgs` like the runtime does. */
function clientCompactPipeline(
  msgs: AgentMessage[],
  opts: { contextWindowTokens: number; reservedOutputTokens: number; keepRecentCount: number; turnCount: number },
): { tier: string; hardLimitTokens: number; estAfter: number } {
  const plan = planCompactionTier({
    estimatedTokens: clientEstimateMessagesTokens(msgs),
    contextWindowTokens: opts.contextWindowTokens,
    reservedOutputTokens: opts.reservedOutputTokens,
    messages: projectMessagesForCompaction(msgs),
    keepRecentCount: opts.keepRecentCount,
    turnCount: opts.turnCount,
  });
  if (plan.tier !== 'none') stubStaleToolResultContents(msgs, opts.keepRecentCount);
  const preNet = clientEstimateMessagesTokens(msgs);
  const estAfter = preNet > plan.hardLimitTokens
    ? shaveMessagesTextToHardLimit(msgs, plan.hardLimitTokens, opts.keepRecentCount)
    : preNet;
  return { tier: plan.tier, hardLimitTokens: plan.hardLimitTokens, estAfter };
}

function main(): void {
  // ─── (1) constants lockstep ────────────────────────────────────────────────
  assertEq(edge.DROPPED_TOOL_RESULT_MARKER_PREFIX, DROPPED_TOOL_RESULT_MARKER_PREFIX, '(1) drop marker prefix matches client');
  assertEq(edge.HARD_TRUNCATE_MARKER_TEXT, HARD_TRUNCATE_MARKER_TEXT, '(1) hard-truncate marker matches client');
  assertEq(edge.EDGE_CONTEXT_WINDOW_TOKENS, 200_000, '(1) edge window const is 200k');
  assertEq(edge.EDGE_CONTEXT_WINDOW_TOKENS, DEFAULT_CONTEXT_WINDOW_TOKENS, '(1) edge window == tier-core default window');

  // ─── (2) token estimator parity (edge == client on the edge shape) ─────────
  const noisy = buildToolLoopHistory(8, 40_000);
  assertEq(edge.estimateEdgeMessagesTokens(noisy), clientEstimateMessagesTokens(clone(noisy) as AgentMessage[]),
    '(2) estimator parity on tool-heavy history');
  const tiny: FixtureMessage[] = [
    { role: 'user', content: 'hello there' },
    { role: 'assistant', content: [{ type: 'text', text: 'hi — ready to help' }] },
  ];
  assertEq(edge.estimateEdgeMessagesTokens(tiny), clientEstimateMessagesTokens(clone(tiny) as AgentMessage[]),
    '(2) estimator parity on tiny history');
  assertEq(edge.estimateEdgeMessagesTokens([]), 0, '(2) empty history estimates 0');

  // ─── (3) stub lockstep + id/shape preservation ─────────────────────────────
  const [usesBefore, resultsBefore] = collectIds(noisy);
  const shapeBefore = shapeSignature(noisy);
  const stubClient = clone(noisy);
  const stubEdge = clone(noisy);
  const rClient = stubStaleToolResultContents(stubClient as AgentMessage[], 6);
  const rEdge = edge.stubStaleEdgeToolResults(stubEdge, 6);
  assertEq(JSON.stringify(stubEdge), JSON.stringify(stubClient), '(3) stubbed histories byte-identical (edge == client)');
  assertEq(JSON.stringify(rEdge.stubbedIndices), JSON.stringify(rClient.stubbedIndices), '(3) stubbedIndices identical');
  assertEq(rEdge.freedChars, rClient.freedChars, '(3) freedChars identical');
  assert(rEdge.stubbedIndices.length > 0, '(3) fixture actually had stale results to stub', String(rEdge.stubbedIndices.length));
  assert(rEdge.freedChars > 0, '(3) stub freed bytes');
  const [usesAfterStub, resultsAfterStub] = collectIds(stubEdge);
  assertEq(usesAfterStub, usesBefore, '(3) tool_use ids preserved through stub');
  assertEq(resultsAfterStub, resultsBefore, '(3) tool_result ids preserved through stub');
  assertEq(shapeSignature(stubEdge), shapeBefore, '(3) message/block shape preserved through stub');
  const firstStub = stubEdge[rEdge.stubbedIndices[0]];
  assert(Array.isArray(firstStub.content)
    && firstStub.content.some((b) => b.type === 'tool_result' && b.content.startsWith(DROPPED_TOOL_RESULT_MARKER_PREFIX)),
    '(3) stubbed result carries the drop marker');
  // recent suffix untouched: the LAST tool_result keeps its original bytes
  const lastResultIdx = 16; // round 7's result (inside keep-recent 6)
  assertEq(JSON.stringify(stubEdge[lastResultIdx]), JSON.stringify(noisy[lastResultIdx]), '(3) recent tool_result untouched');

  // ─── (4) stub idempotency ──────────────────────────────────────────────────
  const once = JSON.stringify(stubEdge);
  const rEdge2 = edge.stubStaleEdgeToolResults(stubEdge, 6);
  assertEq(rEdge2.stubbedIndices.length, 0, '(4) second stub pass stubs nothing');
  assertEq(rEdge2.freedChars, 0, '(4) second stub pass frees nothing');
  assertEq(JSON.stringify(stubEdge), once, '(4) second stub pass is byte-identical');

  // ─── (5) shave lockstep + fits-under-limit ─────────────────────────────────
  const prose: FixtureMessage[] = [
    { role: 'user', content: `Investigate the incident. ${words(2200, 'alpha')}` },
    { role: 'assistant', content: [{ type: 'text', text: words(2400, 'beta') }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: words(1200, 'gamma') },
        { type: 'tool_use', id: 'tu_p1', name: 'gdocs.read', input: { docId: 'doc-1' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_p1', content: words(2600, 'delta') }] },
    { role: 'assistant', content: [{ type: 'text', text: words(1400, 'epsi') }] },
    { role: 'user', content: `Summarize everything and finish. ${words(600, 'omega')}` },
  ];
  const proseEst = edge.estimateEdgeMessagesTokens(prose);
  const hardLimit = 6_000;
  assert(proseEst > hardLimit, '(5) prose fixture is over the hard limit', String(proseEst));
  const shaveClient = clone(prose);
  const shaveEdge = clone(prose);
  const estClient = shaveMessagesTextToHardLimit(shaveClient as AgentMessage[], hardLimit, 3);
  const estEdge = edge.shaveEdgeMessagesTextToHardLimit(shaveEdge, hardLimit, 3);
  assertEq(estEdge, estClient, '(5) shave returns identical live estimate (edge == client)');
  assertEq(JSON.stringify(shaveEdge), JSON.stringify(shaveClient), '(5) shaved histories byte-identical (edge == client)');
  assert(estEdge <= hardLimit, '(5) post-shave estimate ≤ hardLimit', `${estEdge} vs ${hardLimit}`);
  assertEq(edge.estimateEdgeMessagesTokens(shaveEdge), estEdge, '(5) returned estimate matches re-measured history');
  const [usesAfterShave, resultsAfterShave] = collectIds(shaveEdge);
  assertEq(usesAfterShave, 'tu_p1', '(5) tool_use id preserved through shave');
  assertEq(resultsAfterShave, 'tu_p1', '(5) tool_result id preserved through shave');
  assertEq(shapeSignature(shaveEdge), shapeSignature(prose), '(5) message/block shape preserved through shave');
  assert(JSON.stringify(shaveEdge).includes(HARD_TRUNCATE_MARKER_TEXT), '(5) shaved history carries the truncate marker');
  const finalMsg = shaveEdge[shaveEdge.length - 1];
  assert(typeof finalMsg.content === 'string' && finalMsg.content.length > 0, '(5) final message keeps its minimal text core');
  // no-op path: already-fitting history returns unchanged on both sides
  const fitClient = clone(tiny);
  const fitEdge = clone(tiny);
  assertEq(edge.shaveEdgeMessagesTextToHardLimit(fitEdge, 6_000, 6),
    shaveMessagesTextToHardLimit(fitClient as AgentMessage[], 6_000, 6), '(5) under-limit shave estimates match');
  assertEq(JSON.stringify(fitEdge), JSON.stringify(tiny), '(5) under-limit shave is a no-op');

  // ─── (6) compactEdgeMessagesBeforeTurn end-to-end ──────────────────────────
  // (6a) small history → 'none', byte-identical
  const small = clone(tiny);
  const rSmall = edge.compactEdgeMessagesBeforeTurn(small, {
    contextWindowTokens: 200_000, reservedOutputTokens: 8_192, keepRecentCount: 6, turnCount: 1,
  });
  assertEq(rSmall.tier, 'none', '(6a) small history plans tier none');
  assertEq(JSON.stringify(small), JSON.stringify(tiny), '(6a) tier none leaves the history byte-identical');
  assertEq(rSmall.estBefore, rSmall.estAfter, '(6a) estBefore == estAfter when nothing ran');
  assert(rSmall.reason.startsWith('tier none'), '(6a) reason names the tier', rSmall.reason);

  // (6b) tool noise over the soft trigger → drop tier; full-pipeline client parity
  const optsB = { contextWindowTokens: 100_000, reservedOutputTokens: 8_192, keepRecentCount: 6, turnCount: 3 };
  const edgeB = clone(noisy);
  const clientB = clone(noisy);
  const rB = edge.compactEdgeMessagesBeforeTurn(edgeB, optsB);
  const cB = clientCompactPipeline(clientB as AgentMessage[], optsB);
  assertEq(rB.tier, 'drop_tool_noise', '(6b) noisy history picks the free drop tier');
  assertEq(rB.tier, cB.tier, '(6b) tier matches the client plan');
  assertEq(rB.hardLimitTokens, cB.hardLimitTokens, '(6b) hardLimit matches the client plan');
  assertEq(rB.estAfter, cB.estAfter, '(6b) estAfter matches the client pipeline');
  assertEq(JSON.stringify(edgeB), JSON.stringify(clientB), '(6b) full-pipeline end state byte-identical (edge == client)');
  assert(rB.estAfter < rB.estBefore, '(6b) compaction shrank the estimate', `${rB.estBefore} -> ${rB.estAfter}`);
  assert(rB.estAfter <= rB.hardLimitTokens, '(6b) estAfter ≤ hardLimit');
  assertEq(collectIds(edgeB).join(';'), [usesBefore, resultsBefore].join(';'), '(6b) all tool ids preserved');
  assert(rB.reason.length <= 240, '(6b) reason bounded to 240 chars', String(rB.reason.length));
  // deterministic second pass: pressure is relieved, so the next turn is a no-op
  const afterB = JSON.stringify(edgeB);
  const rB2 = edge.compactEdgeMessagesBeforeTurn(edgeB, optsB);
  assertEq(rB2.tier, 'none', '(6b) second pass plans none (pressure relieved)');
  assertEq(JSON.stringify(edgeB), afterB, '(6b) second pass is byte-identical');

  // (6c) drop alone can't fit a tiny window → shave nets under the hard limit
  const optsC = { contextWindowTokens: 20_000, reservedOutputTokens: 4_096, keepRecentCount: 6, turnCount: 3 };
  const edgeC = clone(noisy);
  const clientC = clone(noisy);
  const rC = edge.compactEdgeMessagesBeforeTurn(edgeC, optsC);
  const cC = clientCompactPipeline(clientC as AgentMessage[], optsC);
  assert(rC.tier !== 'none', '(6c) tiny-window pressure compacts', rC.tier);
  assertEq(rC.estAfter, cC.estAfter, '(6c) estAfter matches the client pipeline');
  assertEq(JSON.stringify(edgeC), JSON.stringify(clientC), '(6c) full-pipeline end state byte-identical (edge == client)');
  assert(rC.estAfter <= rC.hardLimitTokens, '(6c) estAfter ≤ hardLimit', `${rC.estAfter} vs ${rC.hardLimitTokens}`);
  assertEq(collectIds(edgeC).join(';'), [usesBefore, resultsBefore].join(';'), '(6c) all tool ids preserved');
  assertEq(shapeSignature(edgeC), shapeBefore, '(6c) message/block shape preserved');

  // (6d) plan 'none' but over the hard limit → safety net reports hard_truncate
  const mid: FixtureMessage[] = [];
  for (let i = 0; i < 8; i += 1) {
    mid.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: words(340, `mid${i}`) }); // ~3.4k chars each
  }
  const estMid = edge.estimateEdgeMessagesTokens(mid);
  const optsD = { contextWindowTokens: 10_000, reservedOutputTokens: 4_000, keepRecentCount: 6, turnCount: 2 };
  assert(estMid > 6_000 && estMid <= 7_500, '(6d) fixture sits between hardLimit and soft trigger', String(estMid));
  const rD = edge.compactEdgeMessagesBeforeTurn(mid, optsD);
  assertEq(rD.tier, 'hard_truncate', '(6d) safety net surfaces as hard_truncate');
  assert(rD.reason.includes('safety net'), '(6d) reason marks the safety net', rD.reason);
  assert(rD.estAfter <= rD.hardLimitTokens, '(6d) safety net landed under the hard limit', `${rD.estAfter} vs ${rD.hardLimitTokens}`);

  // (6e) degenerate input degrades to a no-op, never throws
  try {
    const rEmpty = edge.compactEdgeMessagesBeforeTurn([], { contextWindowTokens: NaN, reservedOutputTokens: -5, keepRecentCount: 0, turnCount: NaN });
    assertEq(rEmpty.tier, 'none', '(6e) empty history + junk opts → none');
    const rJunk = edge.compactEdgeMessagesBeforeTurn(null as unknown as edge.EdgeCompactionMessage[], undefined);
    assertEq(rJunk.tier, 'none', '(6e) non-array messages degrade to no-op none');
    assert(true, '(6e) degenerate sweep completed without throwing');
  } catch (err) {
    failures += 1;
    console.error(`FAIL: (6e) degenerate input threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(`\nedge-context-compaction smoketest: ${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
