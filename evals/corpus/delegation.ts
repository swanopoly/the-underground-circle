// evals/corpus/delegation.ts — golden-case corpus for the DELEGATION cores of the
// deterministic, model-free tier-1 regression net
// (docs strategic plan ADD #1: "the safety net that makes every consolidation
// below safe"). This module extends the net with the subagent-delegation family:
//
//   • delegationSizingCore    — complexity → how many specialists a task is worth
//                               (trivial → minimal fan-out; complex → larger,
//                               bounded); the kept/dropped partition; total.
//   • specialistSelectionCore — signal-based specialist selection + priority rank
//                               (a domain signal wakes a dormant specialist;
//                               ranking puts the strongest signal first;
//                               conservative + whole-token; total).
//
// Each case runs the REAL core fn on a FIXED input and returns true iff the output
// equals the value CAPTURED from the real core (never invented). If a
// consolidation drifts a core's behavior, the matching case flips pass→fail and
// the aggregator surfaces it. Cases are self-contained + defensive: array/object
// goldens compare via JSON.stringify (order-sensitive on purpose where order is
// load-bearing), scalars via ===; a case that would throw is caught by the
// aggregator, but every case here returns a clean boolean.
//
// PURITY: both cores are dependency-light (zero runtime imports) and tsx-loadable,
// so this corpus loads under tsx/esbuild with no react-native / supabase / deno in
// the graph, exactly like the parent coreGoldenCorpus.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import {
  scoreDelegationComplexity,
  tierForScore,
  maxSpecialistsForScore,
  sizeDelegationSpecs,
  extractSpecRole,
} from '../../src/lib/delegationSizingCore';
import {
  selectSignaledSpecialists,
  rankSpecialistsByPriority,
} from '../../src/lib/specialistSelectionCore';

// ─── Tiny self-contained comparison helpers (no external imports) ──────────────

/** Order-sensitive structural equality via JSON — total (never throws). */
function jsonEq(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Map a spec list to its role strings (for partition/order assertions). */
function roleList(specs: unknown): string[] {
  if (!Array.isArray(specs)) return [];
  return specs.map((s) => {
    if (s && typeof s === 'object') {
      const r = (s as Record<string, unknown>).role;
      return typeof r === 'string' ? r : '';
    }
    return '';
  });
}

// ─── Fixed inputs shared by cases (frozen so goldens stay deterministic) ───────

/** A trivial "one-liner" ask that must score very-low and run coder-only. */
const TRIVIAL_MESSAGE = 'add a loading spinner';

/** A genuinely multi-part ask — captured score is 8 (high tier). */
const COMPLEX_MESSAGE =
  'Build the new billing dashboard and also migrate the legacy payments table, then integrate the Stripe webhook handler. Additionally, refactor the invoice service and wire it to the notification queue. Finally, add end-to-end tests and deploy the whole system to staging and production.\n1. schema migration\n2. webhook handler\n3. e2e tests\n4. deploy';

/** Six proposed specialists in a fixed insertion order (thinking-first). */
const COMPLEX_SPECS: ReadonlyArray<{ role: string }> = [
  { role: 'architect' },
  { role: 'coder' },
  { role: 'tester' },
  { role: 'reviewer' },
  { role: 'security' },
  { role: 'devops' },
];

/** An "everything" ask whose RAW score exceeds the ceiling → must clamp to 10. */
const MAXIMAL_MESSAGE =
  'Build the billing dashboard and also migrate the payments table, then integrate the Stripe webhook, plus refactor the invoice service and deploy the release.\n1. build\n2. migrate\n3. integrate\n4. deploy\nAdditionally add end-to-end tests and configure the pipeline while wiring the queue after the audit so the whole system ships to production and staging together for the launch of the new revenue platform.';
const MAXIMAL_PLAN = { kind: 'build', verification: ['typecheck', 'tests', 'lint', 'e2e'] };

/** A clear security ask (4 whole-token domain hits → high-strength signal). */
const SECURITY_MESSAGE =
  'Add secure password hashing and sanitize all inputs against sqli injection';

// ─── The delegation corpus ─────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ══ suite: delegation-sizing (delegationSizingCore) ═══════════════════════════

  {
    id: 'delegation-sizing-trivial-demotes-architect-to-coder',
    suite: 'delegation-sizing',
    describe:
      'a trivial one-liner scores very-low and keeps ONLY the builder — demoting an unconditional architect-first spec to coder-only fan-out',
    run: () => {
      const r = sizeDelegationSpecs({
        message: TRIVIAL_MESSAGE,
        specs: [{ role: 'architect' }, { role: 'coder' }, { role: 'tester' }],
      });
      return (
        r.score === 0 &&
        jsonEq(roleList(r.kept), ['coder']) &&
        jsonEq(roleList(r.dropped), ['architect', 'tester'])
      );
    },
  },
  {
    id: 'delegation-sizing-complex-keeps-four-bounded',
    suite: 'delegation-sizing',
    describe:
      'a complex multi-part ask scores high and keeps the first four specialists in insertion order — bounded at four even when six are proposed',
    run: () => {
      const r = sizeDelegationSpecs({ message: COMPLEX_MESSAGE, specs: COMPLEX_SPECS });
      return (
        r.score === 8 &&
        r.kept.length === 4 &&
        jsonEq(roleList(r.kept), ['architect', 'coder', 'tester', 'reviewer']) &&
        jsonEq(roleList(r.dropped), ['security', 'devops'])
      );
    },
  },
  {
    id: 'delegation-sizing-kept-dropped-exact-partition',
    suite: 'delegation-sizing',
    describe:
      'kept ∪ dropped is an exact partition of the input specs — same object references, none lost or duplicated',
    run: () => {
      const r = sizeDelegationSpecs({ message: COMPLEX_MESSAGE, specs: COMPLEX_SPECS });
      const union = [...r.kept, ...r.dropped];
      const everyRefExactlyOnce = COMPLEX_SPECS.every(
        (s) => union.filter((u) => u === s).length === 1,
      );
      return union.length === COMPLEX_SPECS.length && everyRefExactlyOnce;
    },
  },
  {
    id: 'delegation-sizing-tier-boundaries',
    suite: 'delegation-sizing',
    describe:
      'tierForScore maps the 0–10 score onto very-low(≤2)/low(≤4)/medium(≤6)/high(≥7) at exactly the documented boundaries',
    run: () =>
      tierForScore(2) === 'very-low' &&
      tierForScore(3) === 'low' &&
      tierForScore(4) === 'low' &&
      tierForScore(5) === 'medium' &&
      tierForScore(6) === 'medium' &&
      tierForScore(7) === 'high',
  },
  {
    id: 'delegation-sizing-max-specialists-bounded',
    suite: 'delegation-sizing',
    describe:
      'maxSpecialistsForScore steps 1→2→3→4 across the tiers and stays bounded at 4 for any over-ceiling score',
    run: () =>
      maxSpecialistsForScore(2) === 1 &&
      maxSpecialistsForScore(4) === 2 &&
      maxSpecialistsForScore(6) === 3 &&
      maxSpecialistsForScore(7) === 4 &&
      maxSpecialistsForScore(100) === 4,
  },
  {
    id: 'delegation-sizing-score-deterministic-and-clamped',
    suite: 'delegation-sizing',
    describe:
      'scoreDelegationComplexity is deterministic — trivial→0, junk→0 — and clamps a raw score above the ceiling to exactly 10',
    run: () =>
      scoreDelegationComplexity({ message: TRIVIAL_MESSAGE }) === 0 &&
      scoreDelegationComplexity(null) === 0 &&
      scoreDelegationComplexity({ message: { a: 1 } }) === 0 &&
      scoreDelegationComplexity({ message: MAXIMAL_MESSAGE, taskPlan: MAXIMAL_PLAN }) === 10,
  },
  {
    id: 'delegation-sizing-reason-names-tier-and-count',
    suite: 'delegation-sizing',
    describe:
      'the sizing reason string names the resolved tier and the kept-of-total count so callers can surface why fan-out was trimmed',
    run: () => {
      const r = sizeDelegationSpecs({
        message: TRIVIAL_MESSAGE,
        specs: [{ role: 'architect' }, { role: 'coder' }, { role: 'tester' }],
      });
      return (
        typeof r.reason === 'string' &&
        r.reason.includes('very-low') &&
        r.reason.includes('keep 1 of 3')
      );
    },
  },
  {
    id: 'delegation-sizing-empty-and-hostile-total',
    suite: 'delegation-sizing',
    describe:
      'empty, null, and garbage inputs never throw and return the neutral very-low, empty-partition sizing',
    run: () => {
      const empty = sizeDelegationSpecs({ message: 'x', specs: [] });
      const nul = sizeDelegationSpecs(null);
      return (
        empty.kept.length === 0 &&
        empty.dropped.length === 0 &&
        empty.score === 0 &&
        nul.kept.length === 0 &&
        nul.dropped.length === 0 &&
        extractSpecRole({ subagent: { role: 'Coder' } }) === 'coder' &&
        extractSpecRole({ role: 'Architect' }) === 'architect' &&
        extractSpecRole(null) === ''
      );
    },
  },

  // ══ suite: specialist-selection (specialistSelectionCore) ═════════════════════

  {
    id: 'delegation-specialist-selection-signal-wakes-security-high',
    suite: 'specialist-selection',
    describe:
      'a message with clear security terms wakes the dormant security specialist with the exact matched keywords at high strength',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: SECURITY_MESSAGE,
        capabilities: ['security', 'devops', 'designer'],
      });
      return (
        Array.isArray(sig) &&
        sig.length === 1 &&
        sig[0].role === 'security' &&
        sig[0].priority === 'high' &&
        jsonEq(sig[0].matched, ['secure', 'injection', 'sqli', 'sanitize'])
      );
    },
  },
  {
    id: 'delegation-specialist-selection-already-selected-excluded',
    suite: 'specialist-selection',
    describe:
      'a role the parent already selected is excluded from the proposed signals (no duplicate fan-out) even when it clearly matches',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: SECURITY_MESSAGE,
        capabilities: ['security', 'devops', 'designer'],
        alreadySelected: ['security'],
      });
      return Array.isArray(sig) && sig.length === 0;
    },
  },
  {
    id: 'delegation-specialist-selection-order-follows-capability-input',
    suite: 'specialist-selection',
    describe:
      'signals are emitted in capability INPUT order — a lower-priority security signal precedes a higher-priority devops signal because it appears first',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: 'Deploy the secure docker pipeline and sanitize the container inputs',
        capabilities: ['designer', 'security', 'devops'],
      });
      return (
        jsonEq(
          sig.map((s) => s.role),
          ['security', 'devops'],
        ) &&
        sig[0].priority === 'medium' &&
        sig[1].priority === 'high'
      );
    },
  },
  {
    id: 'delegation-specialist-selection-rank-puts-strongest-signal-first',
    suite: 'specialist-selection',
    describe:
      'ranking the emitted signals reorders them high→medium so the strongest domain signal (devops) is delegated first',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: 'Deploy the secure docker pipeline and sanitize the container inputs',
        capabilities: ['designer', 'security', 'devops'],
      });
      const ranked = rankSpecialistsByPriority(sig);
      return jsonEq(
        ranked.map((s) => s.role),
        ['devops', 'security'],
      );
    },
  },
  {
    id: 'delegation-specialist-selection-rank-stable-within-bucket-no-mutate',
    suite: 'specialist-selection',
    describe:
      'rankSpecialistsByPriority sorts high→medium→low, is stable within each bucket, and never mutates the input array',
    run: () => {
      const input = [
        { role: 'a', priority: 'low' as const },
        { role: 'b', priority: 'high' as const },
        { role: 'c', priority: 'medium' as const },
        { role: 'd', priority: 'high' as const },
      ];
      const ranked = rankSpecialistsByPriority(input);
      const inputUnchanged = jsonEq(
        input.map((x) => x.role),
        ['a', 'b', 'c', 'd'],
      );
      return (
        jsonEq(
          ranked.map((x) => x.role),
          ['b', 'd', 'c', 'a'],
        ) && inputUnchanged
      );
    },
  },
  {
    id: 'delegation-specialist-selection-priority-thresholds',
    suite: 'specialist-selection',
    describe:
      'match strength maps to priority at the documented thresholds: 1 hit→low, 2 hits→medium, ≥3 hits→high',
    run: () => {
      const low = selectSignaledSpecialists({ message: 'redesign the layout', capabilities: ['designer'] });
      const med = selectSignaledSpecialists({ message: 'update the ui layout', capabilities: ['designer'] });
      const high = selectSignaledSpecialists({ message: SECURITY_MESSAGE, capabilities: ['security'] });
      return (
        low.length === 1 &&
        low[0].priority === 'low' &&
        jsonEq(low[0].matched, ['layout']) &&
        med.length === 1 &&
        med[0].priority === 'medium' &&
        jsonEq(med[0].matched, ['ui', 'layout']) &&
        high.length === 1 &&
        high[0].priority === 'high'
      );
    },
  },
  {
    id: 'delegation-specialist-selection-conservative-generic-no-trip',
    suite: 'specialist-selection',
    describe:
      'ultra-generic verbs (fix/build/test/plan/help) already covered by the task-kind switch produce NO signals — the core is conservative by design',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: 'please help fix the build and test the plan',
        capabilities: ['security', 'devops', 'designer', 'tester', 'coder'],
      });
      return Array.isArray(sig) && sig.length === 0;
    },
  },
  {
    id: 'delegation-specialist-selection-whole-token-no-substring',
    suite: 'specialist-selection',
    describe:
      'matching is whole-token, never substring — "author" never trips security "auth" and "decision" never trips devops "ci"',
    run: () => {
      const sig = selectSignaledSpecialists({
        message: 'the author reached a decision',
        capabilities: ['security', 'devops'],
      });
      return Array.isArray(sig) && sig.length === 0;
    },
  },
  {
    id: 'delegation-specialist-selection-hostile-total',
    suite: 'specialist-selection',
    describe:
      'null, non-object, and non-array inputs never throw — selection and ranking both return a safe empty array',
    run: () => {
      const a = selectSignaledSpecialists(null as unknown as Parameters<typeof selectSignaledSpecialists>[0]);
      const b = selectSignaledSpecialists({ message: { a: { b: 1 } }, capabilities: 'not-an-array' });
      const c = rankSpecialistsByPriority(null as unknown as { priority: 'high' | 'medium' | 'low' }[]);
      const d = rankSpecialistsByPriority('nope' as unknown as { priority: 'high' | 'medium' | 'low' }[]);
      return (
        Array.isArray(a) &&
        a.length === 0 &&
        Array.isArray(b) &&
        b.length === 0 &&
        Array.isArray(c) &&
        c.length === 0 &&
        Array.isArray(d) &&
        d.length === 0
      );
    },
  },
];
