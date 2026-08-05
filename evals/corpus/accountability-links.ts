// evals/corpus/accountability-links.ts — golden-case corpus for the
// ACCOUNTABILITY-LINK cores of the deterministic, model-free tier-1 regression
// net (docs strategic plan ADD #1: "the safety net that makes every
// consolidation below safe"). This module extends the net with the three cores
// that turn finished agent work into durable, shareable team accountability:
//
//   • skillInductionCore      — induct a reusable SKILL.md draft from a
//                               successful multi-tool procedure that RECURS
//                               across runs (proven flow → reusable skill),
//                               while a trivial / one-off / low-success run
//                               induces nothing.
//   • taskPRLinkageCore       — link a COMPLETED task to its GitHub proof (a
//                               PR / commit / branch mentioned in the
//                               deliverable or emitted by git.run) → a typed,
//                               host-scoped, canonical link artifact; no
//                               reference → unlinked.
//   • circleMemoryDigestCore  — digest the multi-doc Circle Memory bank into
//                               ONE bounded, recency-ordered, untrusted-fenced
//                               prompt block under a single shared budget;
//                               empty → empty digest.
//
// Each case runs the REAL core fn on a FIXED input and returns true iff the
// output equals the value CAPTURED from real core output (never invented). If a
// consolidation drifts a core's behavior, the matching case flips pass→fail and
// the aggregator surfaces it. Cases are self-contained + total: object/array
// goldens compare via a small local depth-bounded deepEq; strings via ===; a
// case never throws (a hostile input is checked, not caught).
//
// PURITY: all three cores are dependency-light (zero runtime imports) and
// tsx-loadable, so this corpus loads under tsx/esbuild with no react-native /
// supabase / deno in the graph, exactly like the parent coreGoldenCorpus.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { induceSkillCandidates, fingerprintRun, DRAFT_BODY_MAX_CHARS } from '../../src/lib/skillInductionCore';
import { extractGitReferences, formatGitReferenceLabel } from '../../src/lib/taskPRLinkageCore';
import { formatCircleMemoryDigest, selectMemoryDocsForBudget } from '../../src/lib/circleMemoryDigestCore';

// ─── Tiny self-contained comparison helper (no external imports) ───────────────
// Order-INSENSITIVE on object keys (a cosmetic key-order change never breaks a
// case), order-SENSITIVE on arrays (recency / tool-sequence order is
// load-bearing), depth-bounded, and TOTAL (never throws).
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
    for (let i = 0; i < ak.length; i += 1) if (ak[i] !== bk[i]) return false;
    for (const k of ak) if (!deepEq(ao[k], bo[k], depth + 1)) return false;
    return true;
  }
  return false;
}

// ─── Fixed inputs shared by cases (frozen so goldens stay deterministic) ───────

/** Three runs of the SAME proven procedure. The `#1/#2/#3` title counters are
 *  id tokens the cluster key drops, so all three share one fingerprint; all
 *  three terminal statuses are success statuses (completed / succeeded). */
const SUCCESS_RUNS: ReadonlyArray<Record<string, unknown>> = [
  { surface: 'feed_task', title: 'Deploy staging #1', status: 'completed', toolNames: ['git.clone', 'git.commit', 'git.push'] },
  { surface: 'feed_task', title: 'Deploy staging #2', status: 'completed', toolNames: ['git.clone', 'git.commit', 'git.push'] },
  { surface: 'feed_task', title: 'Deploy staging #3', status: 'succeeded', toolNames: ['git.clone', 'git.commit', 'git.push'] },
];

/** The canonical fingerprint every SUCCESS_RUNS row shares (surface | cluster |
 *  ordered tool sequence). */
const GOLDEN_FINGERPRINT = 'feed_task|deploy staging|git.clone>git.commit>git.push';

/** Same procedure but only 1 of 3 runs succeeded → successRatio 0.33 < 0.8. */
const LOW_SUCCESS_RUNS: ReadonlyArray<Record<string, unknown>> = [
  { surface: 'feed_task', title: 'Deploy staging', status: 'completed', toolNames: ['git.clone', 'git.commit', 'git.push'] },
  { surface: 'feed_task', title: 'Deploy staging', status: 'failed', toolNames: ['git.clone', 'git.commit', 'git.push'] },
  { surface: 'feed_task', title: 'Deploy staging', status: 'failed', toolNames: ['git.clone', 'git.commit', 'git.push'] },
];

/** Recurring single-tool runs — a lone tool is NOT a multi-tool "procedure". */
const SINGLE_TOOL_RUNS: ReadonlyArray<Record<string, unknown>> = [
  { surface: 'main_chat', title: 'ping', status: 'completed', toolNames: ['read'] },
  { surface: 'main_chat', title: 'ping', status: 'completed', toolNames: ['read'] },
  { surface: 'main_chat', title: 'ping', status: 'completed', toolNames: ['read'] },
];

/** Three populated Circle Memory docs — DELIBERATELY out of recency order in the
 *  source array so the digest's most-recent-first ordering is a real assertion. */
const MEMORY_SET: ReadonlyArray<Record<string, unknown>> = [
  { doc_kind: 'brief', content: 'We are building the accountability workspace.', updated_at: '2026-07-10T00:00:00Z' },
  { doc_kind: 'active_context', content: 'Currently wiring the eval regression net.', updated_at: '2026-07-14T00:00:00Z' },
  { doc_kind: 'progress', content: 'Shipped nine corpus modules.', updated_at: '2026-07-12T00:00:00Z' },
];

/** The exact digest block (budget 1000): recency order active_context →
 *  progress → brief, each content wrapped in the `<untrusted_quoted>` fence,
 *  blocks joined by a blank line. Captured from real formatCircleMemoryDigest. */
const GOLDEN_DIGEST = [
  'Active Context',
  '<untrusted_quoted>',
  'Currently wiring the eval regression net.',
  '</untrusted_quoted>',
  '',
  'Progress',
  '<untrusted_quoted>',
  'Shipped nine corpus modules.',
  '</untrusted_quoted>',
  '',
  'Brief',
  '<untrusted_quoted>',
  'We are building the accountability workspace.',
  '</untrusted_quoted>',
].join('\n');

/** Under a tiny shared budget only the single most-recent doc survives (the
 *  budget is shared ACROSS docs, not per-doc). Captured from real output. */
const GOLDEN_DIGEST_TINY = [
  'Active Context',
  '<untrusted_quoted>',
  'Currently wiring the eval regression net.',
  '</untrusted_quoted>',
].join('\n');

/** Docs selected under a generous budget: recency-ordered, full content
 *  retained, updated_at carried through. Captured from selectMemoryDocsForBudget. */
const GOLDEN_SELECTED = [
  { doc_kind: 'active_context', content: 'Currently wiring the eval regression net.', updated_at: '2026-07-14T00:00:00Z' },
  { doc_kind: 'progress', content: 'Shipped nine corpus modules.', updated_at: '2026-07-12T00:00:00Z' },
  { doc_kind: 'brief', content: 'We are building the accountability workspace.', updated_at: '2026-07-10T00:00:00Z' },
];

// ─── The accountability-link corpus ────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ══ suite: skill-induction (skillInductionCore) ═══════════════════════════════

  {
    id: 'accountability-links-skill-induction-recurring-success-inducts-one',
    suite: 'skill-induction',
    describe:
      'a proven multi-tool procedure that recurs across three successful runs induces exactly one skill candidate with the pinned fingerprint, occurrences, 1.0 success ratio, surface, tool sequence, and draft title',
    run: () => {
      const cands = induceSkillCandidates(SUCCESS_RUNS);
      if (cands.length !== 1) return false;
      const c = cands[0];
      return deepEq(
        {
          fingerprint: c.fingerprint,
          occurrences: c.occurrences,
          successRatio: c.successRatio,
          surface: c.surface,
          toolSequence: c.toolSequence,
          draftTitle: c.draftTitle,
        },
        {
          fingerprint: GOLDEN_FINGERPRINT,
          occurrences: 3,
          successRatio: 1,
          surface: 'feed_task',
          toolSequence: ['git.clone', 'git.commit', 'git.push'],
          draftTitle: 'Deploy Staging',
        },
      );
    },
  },
  {
    id: 'accountability-links-skill-induction-id-counters-cluster-runs',
    suite: 'skill-induction',
    describe:
      'fingerprintRun drops pure-number id/counter title tokens so "Deploy staging #1" and "Deploy staging #7" resolve to the SAME fingerprint (the clustering that lets one procedure accumulate occurrences)',
    run: () => {
      const a = fingerprintRun({ surface: 'feed_task', title: 'Deploy staging #1', toolNames: ['git.clone', 'git.commit', 'git.push'] });
      const b = fingerprintRun({ surface: 'feed_task', title: 'Deploy staging #7', toolNames: ['git.clone', 'git.commit', 'git.push'] });
      return a === GOLDEN_FINGERPRINT && b === GOLDEN_FINGERPRINT;
    },
  },
  {
    id: 'accountability-links-skill-induction-single-tool-not-a-procedure',
    suite: 'skill-induction',
    describe:
      'recurring SINGLE-tool runs induce nothing — a lone tool is not a multi-tool procedure worth saving as a skill',
    run: () => induceSkillCandidates(SINGLE_TOOL_RUNS).length === 0,
  },
  {
    id: 'accountability-links-skill-induction-below-min-occurrences-suppressed',
    suite: 'skill-induction',
    describe:
      'a procedure seen only twice stays below the default minOccurrences (3) gate and induces no candidate',
    run: () => induceSkillCandidates([SUCCESS_RUNS[0], SUCCESS_RUNS[1]]).length === 0,
  },
  {
    id: 'accountability-links-skill-induction-low-success-ratio-suppressed',
    suite: 'skill-induction',
    describe:
      'a procedure that recurs enough but succeeds only 1 of 3 times (0.33 < the 0.8 floor) is NOT inducted — only proven flows become skills',
    run: () => induceSkillCandidates(LOW_SUCCESS_RUNS).length === 0,
  },
  {
    id: 'accountability-links-skill-induction-draft-is-well-formed-skill-md',
    suite: 'skill-induction',
    describe:
      'the induced draft is a bounded, well-formed SKILL.md — slug frontmatter name, H1 title, and each tool rendered as a numbered procedure step',
    run: () => {
      const c = induceSkillCandidates(SUCCESS_RUNS)[0];
      return (
        !!c &&
        typeof c.draftBody === 'string' &&
        c.draftBody.includes('name: deploy-staging') &&
        c.draftBody.includes('# Deploy Staging') &&
        c.draftBody.includes('`git.clone`') &&
        c.draftBody.includes('`git.push`') &&
        c.draftBody.length <= DRAFT_BODY_MAX_CHARS
      );
    },
  },
  {
    id: 'accountability-links-skill-induction-hostile-total',
    suite: 'skill-induction',
    describe:
      'null / hostile input never throws — induceSkillCandidates returns [] and fingerprintRun returns the neutral "unknown||" signature',
    run: () =>
      induceSkillCandidates(null as unknown).length === 0 &&
      fingerprintRun(null as unknown as never) === 'unknown||',
  },

  // ══ suite: task-pr-linkage (taskPRLinkageCore) ════════════════════════════════

  {
    id: 'accountability-links-task-pr-linkage-pr-url-links-canonical',
    suite: 'task-pr-linkage',
    describe:
      'a completed deliverable mentioning a github.com PR URL links to a canonical, typed pull_request reference carrying prNumber + repo',
    run: () => {
      const refs = extractGitReferences({ deliverable: 'Done. Opened https://github.com/acme/app/pull/42 for review.' });
      return deepEq(refs, [
        { type: 'pull_request', url: 'https://github.com/acme/app/pull/42', prNumber: 42, repo: 'acme/app' },
      ]);
    },
  },
  {
    id: 'accountability-links-task-pr-linkage-prose-pr-links-number-only',
    suite: 'task-pr-linkage',
    describe:
      'a prose "opened PR #7" with no URL still links a soft pull_request signal — prNumber 7, empty url, no repo',
    run: () => {
      const refs = extractGitReferences({ deliverable: 'Completed the task and opened PR #7.' });
      return deepEq(refs, [{ type: 'pull_request', url: '', prNumber: 7 }]);
    },
  },
  {
    id: 'accountability-links-task-pr-linkage-no-reference-unlinked',
    suite: 'task-pr-linkage',
    describe: 'a deliverable with no PR / commit / branch reference yields no links — the task stays unlinked',
    run: () => extractGitReferences({ deliverable: 'Finished the task; nothing to link here.' }).length === 0,
  },
  {
    id: 'accountability-links-task-pr-linkage-spoofed-host-rejected',
    suite: 'task-pr-linkage',
    describe:
      'host-spoofing URLs (github.com.evil.com and github.com@evil.com) are rejected by exact-host scoping → no reference is ever linked from untrusted deliverable text',
    run: () => {
      const refs = extractGitReferences({
        deliverable: 'see https://github.com.evil.com/acme/app/pull/42 and https://github.com@evil.com/acme/app/pull/9',
      });
      return refs.length === 0;
    },
  },
  {
    id: 'accountability-links-task-pr-linkage-git-run-commit-linked',
    suite: 'task-pr-linkage',
    describe:
      "a git.run tool event's remote line + `[main sha]` commit bracket links a canonical commit reference (sha + repo) — proof pulled straight from the agent's own tool output",
    run: () => {
      const refs = extractGitReferences({
        toolEvents: [{ tool: 'git.run', result: 'remote: github.com/acme/app\n[main 7d3a1f2] wire login\n 1 file changed' }],
      });
      return deepEq(refs, [
        { type: 'commit', url: 'https://github.com/acme/app/commit/7d3a1f2', sha: '7d3a1f2', repo: 'acme/app' },
      ]);
    },
  },
  {
    id: 'accountability-links-task-pr-linkage-label-renders-typed-link',
    suite: 'task-pr-linkage',
    describe:
      'formatGitReferenceLabel renders the compact human artifact label for a PR and a branch ref, and returns "" for a non-object ref',
    run: () =>
      formatGitReferenceLabel({ type: 'pull_request', url: 'https://github.com/acme/app/pull/42', prNumber: 42, repo: 'acme/app' }) ===
        'PR #42 (acme/app)' &&
      formatGitReferenceLabel({ type: 'branch', url: 'https://github.com/acme/app/tree/feature/login', repo: 'acme/app' }) ===
        'branch feature/login (acme/app)' &&
      formatGitReferenceLabel(null as unknown as never) === '',
  },
  {
    id: 'accountability-links-task-pr-linkage-hostile-total',
    suite: 'task-pr-linkage',
    describe: 'a null / hostile input never throws — extractGitReferences returns []',
    run: () => extractGitReferences(null as unknown as never).length === 0,
  },

  // ══ suite: circle-memory-digest (circleMemoryDigestCore) ══════════════════════

  {
    id: 'accountability-links-circle-memory-digest-orders-recent-first-fenced',
    suite: 'circle-memory-digest',
    describe:
      'the fixed memory set digests to one deterministic block: docs most-recently-updated first (active_context → progress → brief), each wrapped in the <untrusted_quoted> fence',
    run: () => formatCircleMemoryDigest(MEMORY_SET, { totalBudgetChars: 1000 }) === GOLDEN_DIGEST,
  },
  {
    id: 'accountability-links-circle-memory-digest-empty-set-empty-string',
    suite: 'circle-memory-digest',
    describe:
      'an empty / null / non-doc / blank-content memory set produces an empty digest — no heading, no fence, nothing injected',
    run: () =>
      formatCircleMemoryDigest([]) === '' &&
      formatCircleMemoryDigest(null) === '' &&
      formatCircleMemoryDigest({}) === '' &&
      formatCircleMemoryDigest([{ doc_kind: 'brief', content: '   ' }]) === '',
  },
  {
    id: 'accountability-links-circle-memory-digest-select-orders-by-recency',
    suite: 'circle-memory-digest',
    describe:
      'selectMemoryDocsForBudget returns the docs recency-ordered with full content and updated_at carried through when the shared budget is generous',
    run: () => deepEq(selectMemoryDocsForBudget(MEMORY_SET, 1000), GOLDEN_SELECTED),
  },
  {
    id: 'accountability-links-circle-memory-digest-tiny-budget-concentrates',
    suite: 'circle-memory-digest',
    describe:
      'under a tiny shared budget only the single most-recent doc is rendered — the budget is split ACROSS docs, not per-doc, so it never triples the block',
    run: () => formatCircleMemoryDigest(MEMORY_SET, { totalBudgetChars: 60 }) === GOLDEN_DIGEST_TINY,
  },
  {
    id: 'accountability-links-circle-memory-digest-zero-budget-empty',
    suite: 'circle-memory-digest',
    describe: 'a zero shared budget selects no docs (empty result), never a partial or negative allocation',
    run: () => selectMemoryDocsForBudget(MEMORY_SET, 0).length === 0,
  },
  {
    id: 'accountability-links-circle-memory-digest-hostile-total',
    suite: 'circle-memory-digest',
    describe: 'a non-collection / hostile input never throws — formatCircleMemoryDigest returns the empty string',
    run: () => {
      const out = formatCircleMemoryDigest(42 as unknown);
      return typeof out === 'string' && out === '';
    },
  },
];
