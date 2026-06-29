/**
 * app-learned-facts-smoketest — pins the L3/L4 learned-app-facts layer
 * (docs/LEARNING_LOOP_RESEARCH_2026-06-12.md):
 *
 *   1. Outcome folding: per-surface ok/fail tallies, E1 breadcrumb folding
 *      (a11y_tree_empty / a11y_path_stale counters), bounds (≤8 surfaces,
 *      counters capped), success resets.
 *   2. Hint derivation is CONSERVATIVE: ≥3-fail/0-ok → 'partial' (never
 *      'missing'); lastSuccessSurfaceId → fill-gap 'ready' hint only.
 *   3. Merge rules: audit-derived statuses WIN on conflict — learned hints
 *      only fill gaps or demote ready→partial, never promote partial/missing.
 *   4. L3 propose matrix: 3-fail best-rung trigger, a11y-empty trigger,
 *      7-day cooldown suppression, success resets, evidence-citing reasons,
 *      laneId bound to the real connected_agent_buildout expansion lane.
 *   5. Auto-propose NEVER executes: shouldProposeCapabilityBuildout is pure
 *      (returns a decision only), and source assertions pin the runtime
 *      wiring to the existing HITL-approval buildout path (runId-anchored
 *      filing; unmet proposals recorded instead of unanchored dispatch).
 *   6. Store: parse/upsert with ≤30-app LRU eviction.
 *   7. L1 evidence gate (research open question 3): exampleAssisted/unassisted
 *      bucket folding (incl. compat with persisted records lacking the
 *      fields), and the shouldInjectDesktopExample matrix — <4 assisted
 *      samples ⇒ inject; suppress only when ≥4 assisted AND rate <60% AND
 *      ≥20 points below a ≥4-sample unassisted baseline; no baseline ⇒
 *      suppress only below 40%; reasons cite the measured numbers.
 *
 * Run: npm run smoke:app-learned-facts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  APP_LEARNED_FACTS_COUNT_CAP,
  APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_ASSISTED_SAMPLES,
  APP_LEARNED_FACTS_MAX_APPS,
  APP_LEARNED_FACTS_MAX_SURFACES,
  createEmptyAppLearnedFacts,
  shouldInjectDesktopExample,
  deriveCapabilityHintsFromFacts,
  inferRunSurfaceIdFromEscalations,
  mergeCapabilityStatusWithLearnedHints,
  normalizeAppKey,
  markBuildoutProposalFiled,
  markBuildoutProposalUnmet,
  parseAppLearnedFactsStore,
  recordAppRunOutcome,
  shouldProposeCapabilityBuildout,
  upsertAppLearnedFactsInStore,
  type AppLearnedFacts,
} from '../src/lib/appLearnedFacts';
import {
  CONNECTED_AGENT_BUILDOUT_LANE_ID,
  getComputerCapabilityExpansionLane,
} from '../src/lib/computerCapabilityExpansion';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

const crumb = (fromSurface: string, toSurface: string, failureCode: string | null, atIso = '2026-06-12T10:00:00.000Z') => ({
  fromSurface,
  toSurface,
  reason: 'r',
  atIso,
  appName: 'Adobe Photoshop',
  failureCode,
});

function main() {
  // ─── normalizeAppKey ───────────────────────────────────────────────
  assert(normalizeAppKey('  Adobe   Photoshop  ') === 'adobe photoshop', 'key: lowercased + whitespace collapsed');
  assert(normalizeAppKey(null) === '' && normalizeAppKey('') === '', 'key: empty/null → ""');
  assert(normalizeAppKey('x'.repeat(200)).length === 60, 'key: bounded to 60 chars');

  // ─── Outcome folding ───────────────────────────────────────────────
  const ok1 = recordAppRunOutcome(null, { surfaceId: 'os_accessibility', ok: true, atIso: '2026-06-12T10:00:00.000Z' });
  assert(ok1.v === 1 && ok1.surfaceOutcomes.os_accessibility?.ok === 1, 'fold: success from empty → ok tally 1');
  assert(ok1.lastSuccessSurfaceId === 'os_accessibility', 'fold: success records lastSuccessSurfaceId');
  assert(ok1.a11yEmptyCount === 0 && ok1.a11yStaleCount === 0, 'fold: fresh facts start at zero counters');

  const fail1 = recordAppRunOutcome(ok1, {
    surfaceId: 'screenshot_coordinate_fallback',
    ok: false,
    escalations: [
      crumb('os_accessibility', 'semantic_desktop', 'a11y_tree_empty'),
      crumb('semantic_desktop', 'screenshot_coordinate_fallback', 'a11y_path_stale'),
    ],
    atIso: '2026-06-12T11:00:00.000Z',
  });
  assert(fail1.surfaceOutcomes.os_accessibility?.fail === 1, 'fold: breadcrumb fromSurface gets a fail tally');
  assert(fail1.surfaceOutcomes.semantic_desktop?.fail === 1, 'fold: every breadcrumb fromSurface is counted');
  assert(fail1.surfaceOutcomes.screenshot_coordinate_fallback?.fail === 1, 'fold: final surface gets the run outcome');
  assert(fail1.a11yEmptyCount === 1, 'fold: a11y_tree_empty breadcrumb bumps a11yEmptyCount');
  assert(fail1.a11yStaleCount === 1, 'fold: a11y_path_stale breadcrumb bumps a11yStaleCount');
  assert(fail1.lastEscalation?.from === 'semantic_desktop' && fail1.lastEscalation?.to === 'screenshot_coordinate_fallback', 'fold: lastEscalation is the newest breadcrumb');
  assert(fail1.surfaceOutcomes.os_accessibility?.ok === 1, 'fold: prior success tally preserved');

  // Counter caps.
  let capped: AppLearnedFacts | null = null;
  for (let i = 0; i < 120; i += 1) {
    capped = recordAppRunOutcome(capped, {
      surfaceId: 'vendor_script_or_plugin_api',
      ok: false,
      escalations: [crumb('vendor_script_or_plugin_api', 'os_accessibility', 'a11y_tree_empty')],
    });
  }
  assert(capped!.surfaceOutcomes.vendor_script_or_plugin_api!.fail <= APP_LEARNED_FACTS_COUNT_CAP, 'bounds: fail tally capped');
  assert(capped!.a11yEmptyCount <= APP_LEARNED_FACTS_COUNT_CAP, 'bounds: a11y counter capped');

  // Surface bound: ≤8, oldest lastAtIso evicted, just-touched surface kept.
  let many: AppLearnedFacts | null = null;
  for (let i = 0; i < 12; i += 1) {
    many = recordAppRunOutcome(many, {
      surfaceId: `surface_${i}`,
      ok: false,
      atIso: `2026-06-0${Math.min(9, i + 1)}T0${i % 10}:00:00.000Z`,
    });
  }
  assert(Object.keys(many!.surfaceOutcomes).length === APP_LEARNED_FACTS_MAX_SURFACES, 'bounds: surfaces capped at 8');
  assert(!('surface_0' in many!.surfaceOutcomes), 'bounds: oldest surface evicted first');
  assert('surface_11' in many!.surfaceOutcomes, 'bounds: just-touched surface always kept');

  // Success resets a11y counters + clears unmet proposal.
  const unmet = markBuildoutProposalUnmet(fail1, 'photoshop: 3 failures on vendor_script_or_plugin_api');
  assert(unmet.unmetBuildoutProposal?.reason.includes('3 failures'), 'unmet: reason preserved on facts');
  const reset = recordAppRunOutcome(unmet, { surfaceId: 'os_accessibility', ok: true });
  assert(reset.a11yEmptyCount === 0 && reset.a11yStaleCount === 0, 'reset: success zeroes the a11y counters');
  assert(reset.unmetBuildoutProposal === null, 'reset: success clears the unmet proposal');
  assert(reset.lastSuccessSurfaceId === 'os_accessibility', 'reset: success updates lastSuccessSurfaceId');

  // ─── Final-surface inference ───────────────────────────────────────
  assert(inferRunSurfaceIdFromEscalations(null) === 'os_accessibility', 'surface: no breadcrumbs → default rung');
  assert(
    inferRunSurfaceIdFromEscalations([
      crumb('os_accessibility', 'semantic_desktop', null),
      crumb('semantic_desktop', 'screenshot_coordinate_fallback', null),
    ]) === 'screenshot_coordinate_fallback',
    'surface: last breadcrumb destination wins',
  );

  // ─── Hint derivation (conservative) ────────────────────────────────
  assert(Object.keys(deriveCapabilityHintsFromFacts(null)).length === 0, 'hints: null facts → no hints');
  const demotable: AppLearnedFacts = {
    ...createEmptyAppLearnedFacts('photoshop'),
    lastSuccessSurfaceId: 'semantic_desktop',
    surfaceOutcomes: {
      vendor_script_or_plugin_api: { ok: 0, fail: 3, lastAtIso: '2026-06-12T10:00:00.000Z' },
      os_accessibility: { ok: 0, fail: 2, lastAtIso: '2026-06-12T10:00:00.000Z' },
      semantic_desktop: { ok: 2, fail: 4, lastAtIso: '2026-06-12T10:00:00.000Z' },
    },
  };
  const hints = deriveCapabilityHintsFromFacts(demotable);
  assert(hints.vendor_script_or_plugin_api === 'partial', 'hints: ≥3 fails + 0 oks → partial demotion hint');
  assert(!('os_accessibility' in hints), 'hints: 2 fails is below the demotion threshold');
  assert(hints.semantic_desktop === 'ready', 'hints: surface with successes is never demoted; lastSuccess → ready hint');
  assert(Object.values(hints).every((v) => v === 'ready' || v === 'partial'), 'hints: never emit missing');

  // ─── Merge (audit wins) ────────────────────────────────────────────
  const merged = mergeCapabilityStatusWithLearnedHints(
    {
      vendor_script_or_plugin_api: 'ready',
      os_accessibility: 'missing',
      browser_dom_cdp: 'partial',
    },
    {
      vendor_script_or_plugin_api: 'partial', // demote allowed
      os_accessibility: 'ready',              // promotion BLOCKED — audit says missing
      browser_dom_cdp: 'ready',               // promotion BLOCKED — audit says partial
      semantic_desktop: 'ready',              // gap fill allowed
      screenshot_coordinate_fallback: 'partial', // gap fill allowed
    },
  );
  assert(merged.vendor_script_or_plugin_api === 'partial', 'merge: learned hint may demote audit ready → partial');
  assert(merged.os_accessibility === 'missing', 'merge: audit missing is NEVER promoted by a learned hint');
  assert(merged.browser_dom_cdp === 'partial', 'merge: audit partial is NEVER promoted by a learned hint');
  assert(merged.semantic_desktop === 'ready', 'merge: hint fills surfaces the audit has no signal for');
  assert(merged.screenshot_coordinate_fallback === 'partial', 'merge: partial hint fills gaps too');
  const auditOnly = mergeCapabilityStatusWithLearnedHints({ os_accessibility: 'ready' }, {});
  assert(auditOnly.os_accessibility === 'ready', 'merge: no hints → audit statuses pass through');

  // ─── L3 propose matrix ─────────────────────────────────────────────
  const NOW = '2026-06-12T12:00:00.000Z';
  const factsWith = (overrides: Partial<AppLearnedFacts>): AppLearnedFacts => ({
    ...createEmptyAppLearnedFacts('photoshop', '2026-06-10T00:00:00.000Z'),
    ...overrides,
  });

  assert(!shouldProposeCapabilityBuildout(null).propose, 'propose: no facts → no proposal');

  // 3-fail trigger on the BEST recorded rung.
  const threeFails = factsWith({
    surfaceOutcomes: { vendor_script_or_plugin_api: { ok: 0, fail: 3, lastAtIso: NOW } },
  });
  const d1 = shouldProposeCapabilityBuildout(threeFails, { nowIso: NOW });
  assert(d1.propose === true, 'propose: 3 failures + 0 successes on best rung → propose');
  assert(/photoshop: 3 failures on vendor_script_or_plugin_api/.test(d1.reason), 'propose: reason cites app, count, and rung', d1.reason);
  assert(d1.laneId === CONNECTED_AGENT_BUILDOUT_LANE_ID, 'propose: laneId is the connected_agent_buildout lane');
  assert(getComputerCapabilityExpansionLane(CONNECTED_AGENT_BUILDOUT_LANE_ID)?.id === 'connected_agent_buildout', 'propose: laneId binds to a REAL expansion lane');

  // Below threshold → no proposal.
  const twoFails = factsWith({
    surfaceOutcomes: { vendor_script_or_plugin_api: { ok: 0, fail: 2, lastAtIso: NOW } },
  });
  assert(!shouldProposeCapabilityBuildout(twoFails, { nowIso: NOW }).propose, 'propose: 2 failures is below threshold');

  // Best rung succeeded → lower-rung failures do NOT propose (the ladder works).
  const ladderWorks = factsWith({
    lastSuccessSurfaceId: 'vendor_script_or_plugin_api',
    surfaceOutcomes: {
      vendor_script_or_plugin_api: { ok: 2, fail: 1, lastAtIso: NOW },
      os_accessibility: { ok: 0, fail: 5, lastAtIso: NOW },
    },
  });
  assert(!shouldProposeCapabilityBuildout(ladderWorks, { nowIso: NOW }).propose, 'propose: best rung has successes → no proposal even with lower-rung failures');

  // a11y-empty trigger (control-detection signal, finding 6).
  const a11yEmpty = factsWith({ a11yEmptyCount: 4 });
  const d2 = shouldProposeCapabilityBuildout(a11yEmpty, { nowIso: NOW });
  assert(d2.propose === true, 'propose: a11yEmptyCount ≥3 triggers without rung failures');
  assert(/a11y tree empty 4×/.test(d2.reason), 'propose: a11y reason cites the count', d2.reason);

  // Combined evidence → reason carries both clauses.
  const combined = factsWith({
    a11yEmptyCount: 4,
    surfaceOutcomes: { vendor_script_or_plugin_api: { ok: 0, fail: 3, lastAtIso: NOW } },
  });
  const d3 = shouldProposeCapabilityBuildout(combined, { nowIso: NOW });
  assert(/3 failures on vendor_script_or_plugin_api/.test(d3.reason) && /a11y tree empty 4×/.test(d3.reason), 'propose: combined evidence cited together', d3.reason);

  // Cooldown suppression (7 days) — and expiry.
  const recentlyProposed = markBuildoutProposalFiled(combined, '2026-06-11T12:00:00.000Z');
  const cooled = shouldProposeCapabilityBuildout(recentlyProposed, { nowIso: NOW });
  assert(!cooled.propose && /cooldown/.test(cooled.reason), 'propose: proposal within 7 days → suppressed with cooldown reason');
  const oldProposal = markBuildoutProposalFiled(combined, '2026-06-01T12:00:00.000Z');
  assert(shouldProposeCapabilityBuildout(oldProposal, { nowIso: NOW }).propose, 'propose: cooldown expires after 7 days');
  assert(recentlyProposed.unmetBuildoutProposal === null, 'propose: filing clears any unmet record');

  // Success resets the evidence → no proposal.
  const afterSuccess = recordAppRunOutcome(combined, { surfaceId: 'vendor_script_or_plugin_api', ok: true, atIso: NOW });
  assert(!shouldProposeCapabilityBuildout(afterSuccess, { nowIso: NOW }).propose, 'propose: a success resets the trigger (ok tally + a11y counters)');

  // Pure / never executes: same inputs → same decision, no side effects.
  const again = shouldProposeCapabilityBuildout(combined, { nowIso: NOW });
  assert(JSON.stringify(again) === JSON.stringify(d3), 'propose: pure — identical decision for identical inputs (returns a decision, executes nothing)');
  assert(combined.lastBuildoutProposedAtIso === null, 'propose: deciding does NOT stamp the cooldown — only the wiring stamps after filing');

  // ─── L1 evidence-gate buckets (exampleAssisted / unassisted) ─────────
  // Compat: persisted records lacking the fields fold fine and stay clean.
  const legacy = createEmptyAppLearnedFacts('photoshop', NOW);
  assert(legacy.exampleAssisted === undefined && legacy.unassisted === undefined, 'buckets: empty facts carry neither bucket (persisted-compatible)');
  const noFlag = recordAppRunOutcome(legacy, { surfaceId: 'os_accessibility', ok: true, atIso: NOW });
  assert(noFlag.exampleAssisted === undefined && noFlag.unassisted === undefined, 'buckets: exampleInjected undefined touches NEITHER bucket');
  const assistedOk = recordAppRunOutcome(noFlag, { surfaceId: 'os_accessibility', ok: true, exampleInjected: true, atIso: '2026-06-12T13:00:00.000Z' });
  assert(assistedOk.exampleAssisted?.ok === 1 && (assistedOk.exampleAssisted?.fail || 0) === 0, 'buckets: exampleInjected:true + ok → exampleAssisted.ok');
  assert(assistedOk.exampleAssisted?.lastAtIso === '2026-06-12T13:00:00.000Z', 'buckets: assisted bucket stamps lastAtIso');
  assert(assistedOk.unassisted === undefined, 'buckets: assisted fold leaves unassisted untouched');
  const assistedFailFold = recordAppRunOutcome(assistedOk, { surfaceId: 'os_accessibility', ok: false, exampleInjected: true, atIso: NOW });
  assert(assistedFailFold.exampleAssisted?.ok === 1 && assistedFailFold.exampleAssisted?.fail === 1, 'buckets: exampleInjected:true + fail → exampleAssisted.fail');
  const unassistedFold = recordAppRunOutcome(assistedFailFold, { surfaceId: 'os_accessibility', ok: false, exampleInjected: false, atIso: NOW });
  assert(unassistedFold.unassisted?.fail === 1 && (unassistedFold.unassisted?.ok || 0) === 0, 'buckets: exampleInjected:false → unassisted bucket');
  assert(unassistedFold.exampleAssisted?.ok === 1 && unassistedFold.exampleAssisted?.fail === 1, 'buckets: unassisted fold preserves assisted tallies');
  assert(unassistedFold.surfaceOutcomes.os_accessibility!.ok >= 1 && unassistedFold.surfaceOutcomes.os_accessibility!.fail >= 1, 'buckets: existing surface folding unchanged alongside buckets');
  let bucketCapped: AppLearnedFacts | null = null;
  for (let i = 0; i < 120; i += 1) {
    bucketCapped = recordAppRunOutcome(bucketCapped, { surfaceId: 'os_accessibility', ok: false, exampleInjected: true });
    bucketCapped = recordAppRunOutcome(bucketCapped, { surfaceId: 'os_accessibility', ok: true, exampleInjected: false });
  }
  assert(bucketCapped!.exampleAssisted!.fail <= APP_LEARNED_FACTS_COUNT_CAP, 'buckets: assisted tallies capped at 99');
  assert(bucketCapped!.unassisted!.ok <= APP_LEARNED_FACTS_COUNT_CAP, 'buckets: unassisted tallies capped at 99');

  // ─── L1 gate matrix (shouldInjectDesktopExample) ──────────────────────
  const gateFacts = (
    assisted: { ok: number; fail: number } | null,
    unassisted: { ok: number; fail: number } | null,
  ): AppLearnedFacts => ({
    ...createEmptyAppLearnedFacts('photoshop', NOW),
    ...(assisted ? { exampleAssisted: { ...assisted, lastAtIso: NOW } } : {}),
    ...(unassisted ? { unassisted } : {}),
  });

  const gNull = shouldInjectDesktopExample(null);
  assert(gNull.inject === true, 'gate: no facts → inject (the verified default)');
  assert(/default/.test(gNull.reason), 'gate: no-facts reason names the default', gNull.reason);
  const gLegacy = shouldInjectDesktopExample(gateFacts(null, null));
  assert(gLegacy.inject === true, 'gate: persisted record without buckets → inject (compat)');
  const gFew = shouldInjectDesktopExample(gateFacts({ ok: 0, fail: 3 }, { ok: 4, fail: 0 }));
  assert(gFew.inject === true, 'gate: 3 assisted samples (<4) → inject even at 0% assisted');
  assert(/3 example-assisted sample/.test(gFew.reason) && new RegExp(`<${APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_ASSISTED_SAMPLES}`).test(gFew.reason), 'gate: insufficient-sample reason cites count + threshold', gFew.reason);

  // Suppression: ≥4 assisted AND rate <60% AND ≥20pts below ≥4-sample baseline.
  const gSuppress = shouldInjectDesktopExample(gateFacts({ ok: 1, fail: 4 }, { ok: 4, fail: 1 }));
  assert(gSuppress.inject === false, 'gate: assisted 1/5 (20%) vs unassisted 4/5 (80%) → suppress');
  assert(/photoshop: example-assisted 1\/5 .*vs unassisted 4\/5 .*— suppressing example injection/.test(gSuppress.reason), 'gate: suppression reason cites both measured rates', gSuppress.reason);
  // Exactly at the 20-point gap boundary with rate <60% → suppress (FP-safe).
  const gBoundary = shouldInjectDesktopExample(gateFacts({ ok: 2, fail: 3 }, { ok: 3, fail: 2 }));
  assert(gBoundary.inject === false, 'gate: 40% vs 60% (exactly 20pts below, <60%) → suppress at boundary');
  // Rate <60% but gap <20pts → keep injecting (not measurably worse).
  const gSmallGap = shouldInjectDesktopExample(gateFacts({ ok: 2, fail: 3 }, { ok: 2, fail: 2 }));
  assert(gSmallGap.inject === true, 'gate: 40% vs 50% baseline (gap <20pts) → inject');
  // Rate ≥60% never suppressed even when far below the baseline.
  const gHighRate = shouldInjectDesktopExample(gateFacts({ ok: 3, fail: 2 }, { ok: 5, fail: 0 }));
  assert(gHighRate.inject === true, 'gate: assisted 60% is never suppressed even below a 100% baseline');
  // No baseline (<4 unassisted samples): suppress only below 40%.
  const gNoBaseLow = shouldInjectDesktopExample(gateFacts({ ok: 1, fail: 4 }, { ok: 2, fail: 1 }));
  assert(gNoBaseLow.inject === false, 'gate: no ≥4-sample baseline + assisted 20% (<40%) → suppress');
  assert(/no unassisted baseline/.test(gNoBaseLow.reason) && /1\/5/.test(gNoBaseLow.reason), 'gate: no-baseline suppression reason cites the numbers', gNoBaseLow.reason);
  const gNoBaseAt40 = shouldInjectDesktopExample(gateFacts({ ok: 2, fail: 3 }, null));
  assert(gNoBaseAt40.inject === true, 'gate: no baseline + assisted exactly 40% → inject (suppress only BELOW 40%)');
  // Would suppress with a baseline (20% vs 80%), but the same record without
  // one only compares against the 40% floor — the asymmetry is deliberate.
  const gPure = shouldInjectDesktopExample(gateFacts({ ok: 1, fail: 4 }, { ok: 4, fail: 1 }));
  assert(JSON.stringify(gPure) === JSON.stringify(gSuppress), 'gate: pure — identical decision for identical inputs');

  // ─── Store: parse + LRU ────────────────────────────────────────────
  assert(Object.keys(parseAppLearnedFactsStore('not-json').apps).length === 0, 'store: corrupted raw → fresh empty store');
  assert(Object.keys(parseAppLearnedFactsStore(null).apps).length === 0, 'store: null raw → fresh empty store');
  let store = parseAppLearnedFactsStore(null);
  for (let i = 0; i < APP_LEARNED_FACTS_MAX_APPS + 1; i += 1) {
    store = upsertAppLearnedFactsInStore(store, {
      ...createEmptyAppLearnedFacts(`app-${String(i).padStart(2, '0')}`),
      updatedAtIso: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
  }
  assert(Object.keys(store.apps).length === APP_LEARNED_FACTS_MAX_APPS, 'store: LRU bounded to 30 apps');
  assert(!('app-00' in store.apps), 'store: oldest updatedAtIso evicted first');
  assert('app-30' in store.apps, 'store: newest upsert always kept');

  // ─── Wiring source assertions (never-auto-execute + audit-wins merge) ──
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/computerTaskRuntime.ts'), 'utf8');
  assert(
    runtimeSrc.includes('mergeCapabilityStatusWithLearnedHints(')
      && runtimeSrc.includes('deriveSurfaceCapabilityStatusFromAudit(args.audit)')
      && runtimeSrc.includes('deriveCapabilityHintsFromFacts(learnedFacts)'),
    'wiring: learned hints merged into the audit-derived capabilityStatusById before execution',
  );
  assert(runtimeSrc.includes('shouldProposeCapabilityBuildout(input.updatedFacts)'), 'wiring: propose trigger consulted on the freshly-recorded facts');
  assert(runtimeSrc.includes('learnedProposalReason: decision.reason'), 'wiring: propose routes through the EXISTING requestConnectedAppCapabilityBuildout path');
  assert(runtimeSrc.includes('...(args.runId ? { runId: args.runId } : {})'), 'wiring: runId anchors the openswanToolRuntime HITL approval (ask policy + dupe guard)');
  assert(
    runtimeSrc.includes('!canRequestCapabilityBuildout || !input.runId')
      && runtimeSrc.includes('filed: false,'),
    'wiring: no run anchor / disabled buildout → unmet proposal recorded, NEVER an unanchored auto-dispatch',
  );
  assert(runtimeSrc.includes('recordAppLearnedFactsBuildoutProposal'), 'wiring: filed/unmet proposal state stamped back onto the facts');
  assert(runtimeSrc.includes('runId: result.runId || null'), 'wiring: the agent-run seam passes its runId so a filed proposal waits as approval_required');
  // L1 evidence gate wiring: gate consulted with the app's loaded facts, the
  // injected/suppressed flag threaded into outcome recording (null = seam not
  // consulted → neither bucket), and post-retry outcomes folded too.
  assert(runtimeSrc.includes('shouldInjectDesktopExample(learnedFacts)'), 'wiring: example gate consulted with the loaded per-app facts');
  assert((runtimeSrc.match(/desktopExampleInjected \?\? undefined/g) || []).length >= 3, 'wiring: exampleInjected threaded into every agent-seam outcome recording');
  assert(runtimeSrc.includes('desktop example injection suppressed by learned evidence:'), 'wiring: suppression decision + reason surfaced on the runtime warnings channel');
  assert(
    (runtimeSrc.match(/recordLearnedAppOutcome\(Boolean\(retryAttempt\.response\), surfaceEscalations\)/g) || []).length === 2,
    'wiring: post-buildout-retry outcomes folded at BOTH retry call sites (success resets failure counters)',
  );

  if (failures > 0) {
    console.error(`\n${failures} app-learned-facts smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll app-learned-facts smoke cases passed.');
}

main();
