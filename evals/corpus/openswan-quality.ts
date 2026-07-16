// evals/corpus/openswan-quality.ts — golden-case corpus for the OPENSWAN-QUALITY
// cores of the deterministic, model-free tier-1 regression net
// (docs strategic plan ADD #1: "an eval CI merge-gate … the safety net that makes
// every consolidation below safe"). This module extends the net with four
// load-bearing OpenSwan run-quality / steering / skill-selection cores:
//
//   • skillRelevanceCore          — content-aware lexical relevance used as a
//                                   SECONDARY sort key for skill selection (a
//                                   domain-matching skill scores > 0 and breaks a
//                                   hint tie; hint precedence stays PRIMARY;
//                                   whole-token, bounded, total).
//   • steeringNotePreservationCore — per-thread parking lot for mid-run steering
//                                   notes the live bus dropped (a note is
//                                   preserved across the turn, merged in
//                                   chronological order, drained exactly once;
//                                   empty/garbage → empty; total).
//   • openswanQualityAggregateCore — hardened roll-up of run-quality rows into an
//                                   avg score + bounded outcome buckets (strong
//                                   rows → high grade, failed/blocked → low,
//                                   deterministic 4-key buckets, never NaN; total).
//   • verificationCoverageCore     — coverage scored ONLY against auto-verifiable
//                                   planned checks (manual kinds excluded from the
//                                   denominator; 0 planned → literal 0, never NaN;
//                                   clamped 0..1; total).
//
// Each case runs the REAL core fn on a FIXED input and returns true iff the output
// equals the value CAPTURED from the real core (never invented). If a
// consolidation drifts a core's behavior, the matching case flips pass→fail and
// the aggregator surfaces it. Cases are self-contained + total: object/array
// goldens compare via a small local order-insensitive `deepEq` (positional on
// arrays where order is load-bearing), scalars via ===; a case that would throw is
// caught by the aggregator, but every case here returns a clean boolean.
//
// PURITY: all four cores are dependency-light (zero runtime imports) and
// tsx-loadable, so this corpus loads under tsx/esbuild with no react-native /
// supabase / deno in the graph, exactly like the parent coreGoldenCorpus.
//
// STATE NOTE: steeringNotePreservationCore keeps a module-level per-thread Map.
// Every steering case below uses a UNIQUE thread id and calls
// `clearUnappliedNotes(id)` at the start of its `run()`, so cases are isolated and
// order-independent (and idempotent across repeated corpus runs).

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { skillContentScore, rankSkillsByRelevance, CONTENT_SCORE_MAX } from '../../src/lib/skillRelevanceCore';
import {
  preserveUnappliedNote,
  takeUnappliedNotes,
  hasUnappliedNotes,
  clearUnappliedNotes,
  MAX_UNAPPLIED_STEERING_NOTES,
} from '../../src/lib/steeringNotePreservationCore';
import { normalizeObservedEval, aggregateRunQuality } from '../../src/lib/openswanQualityAggregateCore';
import { computeVerificationCoverage, isAutoVerifiable } from '../../src/lib/verificationCoverageCore';

// ─── Tiny self-contained comparison helper (no external imports) ───────────────

/**
 * Order-insensitive-on-object-keys, positional-on-arrays deep equality. Total
 * (never throws), depth-bounded. Arrays compare index-by-index so a case pinning
 * chronological / rank order stays strict about order; objects compare by key set
 * so a cosmetic key-reordering in a core never falsely fails a case.
 */
function deepEq(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (a === b) return true;
  const ta = typeof a;
  if (ta !== typeof b) return false;
  if (a === null || b === null) return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEq(ao[k], bo[k], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

/** Map a skill list to its `name` strings (for rank-order assertions). */
function nameList(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills.map((s) => {
    if (s && typeof s === 'object') {
      const n = (s as Record<string, unknown>).name;
      return typeof n === 'string' ? n : '';
    }
    return '';
  });
}

// ─── Fixed inputs shared by the skill-relevance rank cases ─────────────────────
// A clearly-irrelevant skill and a domain-matching skill; the query overlaps only
// the second. Cases vary ONLY the hintScore to prove hint-vs-content precedence.

/** A skill whose name/desc share NO tokens with the security-audit query. */
const IRRELEVANT_SKILL = { name: 'weather forecast', description: 'get the weather' };
/** A skill whose tags/name/desc overlap the security-audit query. */
const RELEVANT_SKILL = { name: 'security audit', tags: ['security', 'auth'], description: 'audit code security' };
/** The turn content both rank cases score against. */
const AUDIT_QUERY = 'run a security audit on the auth code';

// ─── The openswan-quality corpus ───────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ══ suite: skill-relevance (skillRelevanceCore) ═══════════════════════════════

  {
    id: 'openswan-quality-skill-relevance-scores-best-field-per-token',
    suite: 'skill-relevance',
    describe:
      'a domain-matching skill scores each query token against its BEST-weighted field (tag=3, name=2, desc=1) — here 2+3+2 = a bounded content score of 7',
    run: () => {
      const score = skillContentScore(
        { name: 'code review', tags: ['security'], description: 'review code for vulnerabilities' },
        'review the security of this code',
      );
      return score === 7 && CONTENT_SCORE_MAX === 10;
    },
  },
  {
    id: 'openswan-quality-skill-relevance-irrelevant-and-degenerate-score-zero',
    suite: 'skill-relevance',
    describe:
      'an off-topic skill, an empty query, and a non-object skill each score 0 — content relevance never invents signal',
    run: () => {
      const irrelevant = skillContentScore(IRRELEVANT_SKILL, 'review the security of this code');
      const emptyQuery = skillContentScore(RELEVANT_SKILL, '');
      const nonObject = skillContentScore(null as unknown as { name: string }, 'security');
      return irrelevant === 0 && emptyQuery === 0 && nonObject === 0;
    },
  },
  {
    id: 'openswan-quality-skill-relevance-whole-token-not-substring',
    suite: 'skill-relevance',
    describe:
      "matching is whole-token, never substring — the query 'cat' never trips a skill named 'category' (scores 0)",
    run: () => skillContentScore({ name: 'category', tags: [], description: '' }, 'cat') === 0,
  },
  {
    id: 'openswan-quality-skill-relevance-content-breaks-hint-tie',
    suite: 'skill-relevance',
    describe:
      'when two skills are tied on hint score, the content-relevant one ranks FIRST — the secondary lexical key breaks the tie toward relevance',
    run: () => {
      const ranked = rankSkillsByRelevance(
        [
          { ...IRRELEVANT_SKILL, hintScore: 0 },
          { ...RELEVANT_SKILL, hintScore: 0 },
        ],
        AUDIT_QUERY,
      );
      return deepEq(nameList(ranked), ['security audit', 'weather forecast']);
    },
  },
  {
    id: 'openswan-quality-skill-relevance-hint-stays-primary-over-content',
    suite: 'skill-relevance',
    describe:
      'a hinted-but-irrelevant skill (hintScore 5) still outranks an unhinted content-relevant one — content NEVER overrides hint precedence',
    run: () => {
      const ranked = rankSkillsByRelevance(
        [
          { ...IRRELEVANT_SKILL, hintScore: 5 },
          { ...RELEVANT_SKILL, hintScore: 0 },
        ],
        AUDIT_QUERY,
      );
      return deepEq(nameList(ranked), ['weather forecast', 'security audit']);
    },
  },
  {
    id: 'openswan-quality-skill-relevance-rank-total-and-maxskills',
    suite: 'skill-relevance',
    describe:
      'ranking is total (empty and non-array inputs → []) and honors maxSkills by keeping only the top-ranked skill',
    run: () => {
      const empty = rankSkillsByRelevance([], 'x');
      const nonArray = rankSkillsByRelevance(null as unknown as { name: string }[], 'x');
      const sliced = rankSkillsByRelevance([IRRELEVANT_SKILL, RELEVANT_SKILL], 'security audit', { maxSkills: 1 });
      return (
        Array.isArray(empty) &&
        empty.length === 0 &&
        Array.isArray(nonArray) &&
        nonArray.length === 0 &&
        deepEq(nameList(sliced), ['security audit'])
      );
    },
  },

  // ══ suite: steering-note-preservation (steeringNotePreservationCore) ══════════

  {
    id: 'openswan-quality-steering-note-preserved-across-turn',
    suite: 'steering-note-preservation',
    describe:
      "a dropped steering note is parked and drained on the NEXT turn — it is preserved (not lost), reported by hasUnappliedNotes, and applies exactly once (a second drain is empty)",
    run: () => {
      const id = 'osq-steer-preserve';
      clearUnappliedNotes(id);
      preserveUnappliedNote(id, 'focus on the auth bug');
      const hadBefore = hasUnappliedNotes(id);
      const drained = takeUnappliedNotes(id);
      const drainedAgain = takeUnappliedNotes(id);
      const hasAfter = hasUnappliedNotes(id);
      return (
        hadBefore === true &&
        deepEq(drained, ['focus on the auth bug']) &&
        deepEq(drainedAgain, []) &&
        hasAfter === false
      );
    },
  },
  {
    id: 'openswan-quality-steering-notes-merge-chronological',
    suite: 'steering-note-preservation',
    describe:
      'multiple parked notes are MERGED (not overwritten) and drained oldest-first, so the next turn sees every dropped nudge in order',
    run: () => {
      const id = 'osq-steer-merge';
      clearUnappliedNotes(id);
      preserveUnappliedNote(id, 'first');
      preserveUnappliedNote(id, 'second');
      preserveUnappliedNote(id, 'third');
      return deepEq(takeUnappliedNotes(id), ['first', 'second', 'third']);
    },
  },
  {
    id: 'openswan-quality-steering-empty-note-not-stored',
    suite: 'steering-note-preservation',
    describe:
      'whitespace-only, null, and non-string notes are NOT stored — empty in → empty out, so the next turn never gets noise prepended',
    run: () => {
      const id = 'osq-steer-empty-note';
      clearUnappliedNotes(id);
      preserveUnappliedNote(id, '   ');
      preserveUnappliedNote(id, null);
      preserveUnappliedNote(id, 42);
      return hasUnappliedNotes(id) === false && deepEq(takeUnappliedNotes(id), []);
    },
  },
  {
    id: 'openswan-quality-steering-empty-thread-is-noop',
    suite: 'steering-note-preservation',
    describe:
      'an empty/garbage thread id makes preserve a safe no-op and drain return [] — a bad id never parks or leaks a note',
    run: () => {
      preserveUnappliedNote('', 'x');
      return deepEq(takeUnappliedNotes(''), []) && hasUnappliedNotes('') === false;
    },
  },
  {
    id: 'openswan-quality-steering-note-whitespace-normalized',
    suite: 'steering-note-preservation',
    describe:
      "a note's internal runs of whitespace are collapsed to single spaces and the ends trimmed before parking",
    run: () => {
      const id = 'osq-steer-normalize';
      clearUnappliedNotes(id);
      preserveUnappliedNote(id, '  focus   on\tthe   bug  ');
      return deepEq(takeUnappliedNotes(id), ['focus on the bug']);
    },
  },
  {
    id: 'openswan-quality-steering-bounded-oldest-dropped',
    suite: 'steering-note-preservation',
    describe:
      'past the max-unapplied cap (5) only the most-recent notes survive — steering is a nudge stream, so the oldest are dropped',
    run: () => {
      const id = 'osq-steer-bounded';
      clearUnappliedNotes(id);
      for (const n of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']) preserveUnappliedNote(id, n);
      return MAX_UNAPPLIED_STEERING_NOTES === 5 && deepEq(takeUnappliedNotes(id), ['n3', 'n4', 'n5', 'n6', 'n7']);
    },
  },

  // ══ suite: openswan-quality-aggregate (openswanQualityAggregateCore) ══════════

  {
    id: 'openswan-quality-aggregate-strong-rows-high-grade',
    suite: 'openswan-quality-aggregate',
    describe:
      'a batch of strong, high-score rows rolls up to a high avg score with all weight in the strong outcome bucket',
    run: () => {
      const agg = aggregateRunQuality([
        { score: 90, outcome: 'strong', verification: { coverageRatio: 1 } },
        { score: 80, outcome: 'strong', verification: { coverageRatio: 0.5 } },
      ]);
      return deepEq(agg, {
        count: 2,
        avgScore: 85,
        avgCoverage: 0.75,
        byOutcome: { strong: 2, partial: 0, blocked: 0, failed: 0 },
        totalCostUsd: 0,
        avgDurationMs: 0,
      });
    },
  },
  {
    id: 'openswan-quality-aggregate-failed-rows-low-grade',
    suite: 'openswan-quality-aggregate',
    describe:
      'a batch of failed/blocked, low-score rows rolls up to a low avg score with the weight in the failed and blocked buckets',
    run: () => {
      const agg = aggregateRunQuality([
        { score: 10, outcome: 'failed' },
        { score: 0, outcome: 'blocked' },
      ]);
      return deepEq(agg, {
        count: 2,
        avgScore: 5,
        avgCoverage: 0,
        byOutcome: { strong: 0, partial: 0, blocked: 1, failed: 1 },
        totalCostUsd: 0,
        avgDurationMs: 0,
      });
    },
  },
  {
    id: 'openswan-quality-aggregate-buckets-deterministic-unknown-folds-partial',
    suite: 'openswan-quality-aggregate',
    describe:
      "byOutcome always carries exactly the 4 known keys, and an unknown outcome folds into the neutral 'partial' bucket (never a phantom key)",
    run: () => {
      const agg = aggregateRunQuality([
        { score: 100, outcome: 'strong' },
        { score: 50, outcome: 'weird' },
        { score: 0, outcome: 'failed' },
      ]);
      return (
        deepEq(agg.byOutcome, { strong: 1, partial: 1, blocked: 0, failed: 1 }) &&
        agg.count === 3 &&
        agg.avgScore === 50
      );
    },
  },
  {
    id: 'openswan-quality-aggregate-nonarray-and-empty-neutral',
    suite: 'openswan-quality-aggregate',
    describe:
      'a non-array and an empty batch both yield the neutral aggregate — count 0, zeroed averages, and the 4 outcome keys at 0 (never NaN)',
    run: () => {
      const golden = {
        count: 0,
        avgScore: 0,
        avgCoverage: 0,
        byOutcome: { strong: 0, partial: 0, blocked: 0, failed: 0 },
        totalCostUsd: 0,
        avgDurationMs: 0,
      };
      return deepEq(aggregateRunQuality(null), golden) && deepEq(aggregateRunQuality([]), golden);
    },
  },
  {
    id: 'openswan-quality-aggregate-averages-cost-and-duration',
    suite: 'openswan-quality-aggregate',
    describe:
      'cost is summed and duration averaged across rows (with the outcome buckets partitioning strong vs partial)',
    run: () => {
      const agg = aggregateRunQuality([
        { score: 80, outcome: 'strong', durationMs: 1000, costUsd: 0.25 },
        { score: 60, outcome: 'partial', durationMs: 3000, costUsd: 0.75 },
      ]);
      return deepEq(agg, {
        count: 2,
        avgScore: 70,
        avgCoverage: 0,
        byOutcome: { strong: 1, partial: 1, blocked: 0, failed: 0 },
        totalCostUsd: 1,
        avgDurationMs: 2000,
      });
    },
  },
  {
    id: 'openswan-quality-aggregate-normalize-passthrough-and-hostile-defaults',
    suite: 'openswan-quality-aggregate',
    describe:
      'normalizeObservedEval passes a clean row through unchanged, defaults a hostile row to a fully-finite neutral, clamps score to 100, and never throws',
    run: () => {
      const clean = normalizeObservedEval({
        score: 95,
        outcome: 'strong',
        verification: { coverageRatio: 1 },
        durationMs: 5000,
        costUsd: 0.5,
      });
      const hostile = normalizeObservedEval({ score: NaN, outcome: 'weird', verification: undefined, durationMs: -5, costUsd: 'abc' });
      const clampedHigh = normalizeObservedEval({ score: 150 });
      const neutral = { score: 0, outcome: 'partial', verification: { coverageRatio: 0 }, durationMs: 0, costUsd: 0 };
      return (
        deepEq(clean, { score: 95, outcome: 'strong', verification: { coverageRatio: 1 }, durationMs: 5000, costUsd: 0.5 }) &&
        deepEq(hostile, neutral) &&
        clampedHigh.score === 100 &&
        deepEq(normalizeObservedEval(null), neutral)
      );
    },
  },

  // ══ suite: verification-coverage (verificationCoverageCore) ═══════════════════

  {
    id: 'openswan-quality-verification-coverage-partial-ratio',
    suite: 'verification-coverage',
    describe:
      'with 3 auto-verifiable planned checks and 2 executed, coverageRatio is 0.67 (2/3, 2dp) and fullyVerified is false',
    run: () => {
      const r = computeVerificationCoverage({
        plannedChecks: [{ kind: 'typecheck' }, { kind: 'tests' }, { kind: 'lint' }, { kind: 'manual_review' }],
        executedCount: 2,
      });
      return deepEq(r, { coverageRatio: 0.67, autoVerifiablePlanned: 3, fullyVerified: false });
    },
  },
  {
    id: 'openswan-quality-verification-coverage-manual-kinds-excluded',
    suite: 'verification-coverage',
    describe:
      'manual-only kinds (security_review / manual_review) are EXCLUDED from the denominator, so running both auto checks scores 1.0 fullyVerified — the core\'s whole point',
    run: () => {
      const r = computeVerificationCoverage({
        plannedChecks: [{ kind: 'typecheck' }, { kind: 'tests' }, { kind: 'security_review' }, { kind: 'manual_review' }],
        executedCount: 2,
      });
      return deepEq(r, { coverageRatio: 1, autoVerifiablePlanned: 2, fullyVerified: true });
    },
  },
  {
    id: 'openswan-quality-verification-coverage-zero-planned-is-literal-zero',
    suite: 'verification-coverage',
    describe:
      'zero auto-verifiable planned checks (manual-only or empty) yields coverageRatio literal 0 — never NaN from 0/0 that would slip a downstream <=0 guard',
    run: () => {
      const manualOnly = computeVerificationCoverage({ plannedChecks: [{ kind: 'manual_review' }], executedCount: 0 });
      const emptyPlan = computeVerificationCoverage({ plannedChecks: [], executedCount: 3 });
      const golden = { coverageRatio: 0, autoVerifiablePlanned: 0, fullyVerified: false };
      return (
        deepEq(manualOnly, golden) &&
        deepEq(emptyPlan, golden) &&
        Number.isFinite(manualOnly.coverageRatio) &&
        manualOnly.coverageRatio === 0
      );
    },
  },
  {
    id: 'openswan-quality-verification-coverage-over-executed-clamps-to-one',
    suite: 'verification-coverage',
    describe:
      'more executed checks than planned clamps coverageRatio to 1.0 (never > 1) and reports fullyVerified',
    run: () => {
      const r = computeVerificationCoverage({ plannedChecks: [{ kind: 'typecheck' }], executedCount: 5 });
      return deepEq(r, { coverageRatio: 1, autoVerifiablePlanned: 1, fullyVerified: true });
    },
  },
  {
    id: 'openswan-quality-verification-coverage-is-auto-verifiable-classification',
    suite: 'verification-coverage',
    describe:
      "isAutoVerifiable classifies machine kinds true (typecheck, and messy-cased '  TypeCheck  ') and manual/non-string false",
    run: () =>
      isAutoVerifiable('typecheck') === true &&
      isAutoVerifiable('  TypeCheck  ') === true &&
      isAutoVerifiable('manual_review') === false &&
      isAutoVerifiable(123) === false,
  },
  {
    id: 'openswan-quality-verification-coverage-null-and-string-kinds-total',
    suite: 'verification-coverage',
    describe:
      'a null input returns the neutral result, and bare-string planned kinds (not just {kind} objects) are counted — all four auto kinds executed scores 1.0',
    run: () => {
      const nul = computeVerificationCoverage(null);
      const stringKinds = computeVerificationCoverage({ plannedChecks: ['typecheck', 'lint', 'preview', 'build'], executedCount: 4 });
      return (
        deepEq(nul, { coverageRatio: 0, autoVerifiablePlanned: 0, fullyVerified: false }) &&
        deepEq(stringKinds, { coverageRatio: 1, autoVerifiablePlanned: 4, fullyVerified: true })
      );
    },
  },
];
