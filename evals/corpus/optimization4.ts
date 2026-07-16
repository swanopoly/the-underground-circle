// evals/corpus/optimization4.ts — a SATELLITE golden-case corpus module for the
// deterministic tier-1 eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md,
// ADD #1: "an eval CI merge-gate … the safety net that makes every consolidation
// below safe"). It mirrors the shape of `evals/coreGoldenCorpus.ts` and its
// satellites `optimization.ts` / `optimization2.ts` / `optimization3.ts` — an
// array of `CoreGoldenCase`, each pinning the exact OUTPUT of a real pure core on
// a FROZEN input — but scopes to the SIX accountability / response-quality /
// message-decomposition cores built in wave 4, the ones that publish a completed
// run as Feed-visible proof, make retrieved-memory provenance + staleness visible
// to the model, grade a finished answer's groundedness, attribute its sources,
// format the failure-recovery cards, and type-guard the shared ChatMessage:
//
//   • src/lib/agentRunProofPublisherCore.ts (buildRunProofPublication) — the
//     accountability keystone that COMPOSES `buildRunProof` + `extractGitReferences`
//     into the two Feed rows (`proof_of_work` + `agent_activity`) plus the typed
//     git refs. Load-bearing: a verified/completed run → verified=true,
//     activity_type 'task_completed', a canonical PR ref linked into BOTH rows and
//     a "PR #N (owner/repo)" display label; a failed/stopped run is HONEST
//     (verified=false, 'task_failed', status 'failed'); an empty run degrades to a
//     neutral no-activity row (fallback headline, run_id null, at ''); and it is
//     SECRET-SAFE (a filesystem path collapses to a basename, an api-key-shaped
//     token is [redacted]) and TOTAL (null input never throws).
//   • src/lib/memoryProvenanceCore.ts (memoryConfidenceBand + formatAsOf +
//     formatMemoryProvenance + formatMemoryReferenceLine) — the R2/R5 provenance +
//     as-of markers. Load-bearing: a score buckets high≥.66 / medium≥.33 / low
//     (0..1 OR a 0..100 percentage; out-of-range/non-numeric → 'unknown'); a date
//     renders a coarse `as of Nd/Nw ago`; the full line appends a compact,
//     secret-safe suffix `[conf:high · as of 2d ago · src:chat · #a1b2c3]` in which
//     an id NEVER leaks past a ≤6-char citation token and a source PATH collapses
//     to a basename; empty text → ''.
//   • src/lib/responseFaithfulnessCore.ts (assessFaithfulness + faithfulnessFlag)
//     — the RAG-faithfulness heuristic. Load-bearing: a response whose specific
//     claims all appear in context → score 1 / flag 'ok'; an invented specific
//     claim (absent from context) → flag 'ungrounded' + the sentence surfaced;
//     a half-grounded answer → groundedRatio .5 / flag 'review'; pure fluff and
//     empty/hostile input NEVER false-flag (neutral 'ok'); explicit citations add
//     a small score credit ABOVE the raw overlap; emitted claims are secret-redacted.
//   • src/lib/chatSourcesSurfaceCore.ts (buildSourcesSurface) — the R7 "Sources"
//     surface. Load-bearing: extracted citations + tool events fold into ONE
//     deduped, rank-ordered list (file < url < commit < tool) with a markdown
//     block; a url cited in the answer text DEDUPES against the same url a tool
//     fetched; and it is secret-safe (url userinfo stripped + sensitive query
//     values REDACTED; an absolute path → basename) and TOTAL (hostile → neutral).
//   • src/lib/chatRecoveryDisplayCore.ts (the recovery formatters + the
//     customer-safe visible-message sanitizer, moved verbatim from ChatTab).
//     Load-bearing: a message leaking bridge/stack internals on a non-completed
//     task is REPLACED with one generic customer-safe line while a clean message
//     (and any completed message) passes through unchanged; the actor / surface /
//     failure-area / evidence / handoff labels map to their exact display text;
//     and the reliability STATUS honors its precedence (user-step > agent-repair >
//     ready/needs-evidence > stopped) feeding the reliability CARD.
//   • src/lib/chatMessageTypes.ts (the ChatMessage type-guards + accessors). Load-
//     bearing: isChatMessage requires the six non-optional fields correctly typed
//     (a non-Date timestamp / missing field / non-object all fail); isChatBotMessage
//     vs isChatUserMessage split on isBot/isUser; the optional-field shape guards
//     accept `{}` but reject a wrong-typed present field; and the accessors read
//     id/artifacts/pending/route-chips/reaction-count/memory-ref-count without ever
//     throwing on hostile input.
//
// PURITY EXCEPTION (spec-sanctioned, same as the parent corpus): this module
// IMPORTS the cores AT RUNTIME — that is the whole point, it exercises them. All
// six are dependency-light, tsx-loadable pure cores (each pulls in only sibling
// pure cores and/or `import type`-only symbols, zero react-native / supabase / deno
// at runtime, no Date.now()/Math.random() at MODULE scope — the two clock-reading
// cores take an injected `nowMs`), so this file runs under tsx with none of those
// in the graph.
//
// EVERY golden value below was CAPTURED from the REAL core output (via a tsx
// probe), never invented. Each `run()` is self-contained, defensive, and TOTAL
// (the cores never throw, and the compares guard their inputs); it returns `true`
// iff the real output still equals the pinned golden — so any behavioral drift
// flips exactly its case pass→fail. The two special glyphs a golden pins — the
// em dash (U+2014) in the no-activity headline and the middle dot (U+00B7) in the
// provenance/recovery separators — are written as `—` / `·` escapes so
// the match is encoding-proof.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { buildRunProofPublication } from '../../src/lib/agentRunProofPublisherCore';
import {
  memoryConfidenceBand,
  formatAsOf,
  formatMemoryProvenance,
  formatMemoryReferenceLine,
} from '../../src/lib/memoryProvenanceCore';
import { assessFaithfulness, faithfulnessFlag } from '../../src/lib/responseFaithfulnessCore';
import { buildSourcesSurface } from '../../src/lib/chatSourcesSurfaceCore';
import {
  sanitizeVisibleComputerTaskMessage,
  isSupportOnlyComputerTaskWarning,
  appendCustomerSafeRecoveryMessage,
  getRecoveryOptionActorLabel,
  formatRecoverySurfaceKind,
  formatRecoveryFailureArea,
  formatRecoveryEvidenceLabel,
  formatHandoffSurfaceRouteLabel,
  getRecoveryReliabilityStatus,
  buildRecoveryReliabilityCard,
} from '../../src/lib/chatRecoveryDisplayCore';
import {
  isChatMessage,
  isChatBotMessage,
  isChatUserMessage,
  isChatMessageSource,
  isChatBotMessageExtra,
  getChatMessageId,
  chatMessageHasArtifacts,
  isPendingChatMessage,
  chatMessageShowsRouteChips,
  chatMessageReactionCount,
  countChatMessageMemoryRefs,
} from '../../src/lib/chatMessageTypes';

// ─── Tiny defensive helpers (self-contained; never throw) ─────────────────────

/** Stable JSON of a value, or a sentinel that can never equal a real golden — so
 *  a malformed/unstringifiable output can never accidentally "match". */
function j(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return ' unstringifiable';
  }
}

/** Order-sensitive structural equality via stable JSON (enough for these fixed,
 *  small, array/scalar goldens). */
function eq(a: unknown, b: unknown): boolean {
  return j(a) === j(b);
}

/** Read a key off an unknown value without ever throwing (guards hostile getters). */
function get(o: unknown, k: string): unknown {
  if (!o || typeof o !== 'object') return undefined;
  try {
    return (o as Record<string, unknown>)[k];
  } catch {
    return undefined;
  }
}

// A frozen wall clock (epoch ms) + a day so the two clock-reading cores stay
// deterministic. NOW is 2023-11-14T22:13:20.000Z; day/week offsets are exact
// multiples (never on a rounding boundary) so the coarse relative-age buckets are
// stable regardless of when CI runs.
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

// The separators the goldens pin, as encoding-proof escapes.
const DOT = '·'; // middle dot — provenance / recovery-card separator
const EM = '—'; // em dash — no-activity headline

export const CASES: CoreGoldenCase[] = [
  // ══ suite: run-proof-publisher (agentRunProofPublisherCore) ══════════════════
  {
    id: 'optimization4-proof-verified-completed-both-rows',
    suite: 'run-proof-publisher',
    describe:
      'a verified/completed run yields BOTH Feed rows: proof_of_work (pow_type agent_run, verified, task_id) + a task_completed agent_activity row, with the canonical PR ref linked into both and a "PR #123 (owner/repo)" label; a filesystem path is reduced to a basename',
    run: () => {
      const pub = buildRunProofPublication({
        runId: 'run_abc',
        taskId: 'task_42',
        toolsUsed: ['desktop.edit_file', 'git.run'],
        filesTouched: ['/Users/secret/proj/src/lib/foo.ts'],
        verification: [{ kind: 'typecheck', ok: true }],
        stopReason: 'completed',
        durationMs: 12000,
        outputSummary: 'Fixed the bug and opened https://github.com/owner/repo/pull/123',
        deliverable: 'See PR https://github.com/owner/repo/pull/123',
        nowMs: NOW,
      });
      const pr = {
        type: 'pull_request',
        url: 'https://github.com/owner/repo/pull/123',
        prNumber: 123,
        repo: 'owner/repo',
      };
      const proofJson = j(pub.proofRow);
      return (
        get(pub.proofRow, 'pow_type') === 'agent_run' &&
        get(pub.proofRow, 'verified') === true &&
        get(pub.proofRow, 'run_id') === 'run_abc' &&
        get(pub.proofRow, 'task_id') === 'task_42' &&
        get(pub.proofRow, 'title') === get(pub.proofRow, 'headline') &&
        get(pub.proofRow, 'at') === '2023-11-14T22:13:20.000Z' &&
        eq(pub.gitReferences, [pr]) &&
        eq(get(pub.proofRow, 'git_references'), [pr]) &&
        get(pub.activityRow, 'activity_type') === 'task_completed' &&
        get(pub.activityRow, 'status') === 'completed' &&
        eq(get(get(pub.activityRow, 'metadata'), 'git_labels'), ['PR #123 (owner/repo)']) &&
        // secret-safe: the full path never rides a row; only the basename does.
        proofJson.includes('foo.ts') &&
        !proofJson.includes('/Users/secret')
      );
    },
  },
  {
    id: 'optimization4-proof-failed-run-honest',
    suite: 'run-proof-publisher',
    describe:
      'a failed run is honest: verified=false, activity_type task_failed, status failed, a "failed" proof tag, and NO task_id key when none was supplied',
    run: () => {
      const pub = buildRunProofPublication({
        runId: 'run_x',
        toolsUsed: ['desktop.edit_file'],
        verification: [{ kind: 'tests', ok: false }],
        stopReason: 'error',
        nowMs: NOW,
      });
      const tags = get(pub.proofRow, 'proof_tags');
      return (
        get(pub.proofRow, 'verified') === false &&
        get(pub.activityRow, 'activity_type') === 'task_failed' &&
        get(pub.activityRow, 'status') === 'failed' &&
        Array.isArray(tags) &&
        tags.includes('failed') &&
        !('task_id' in (pub.proofRow as Record<string, unknown>))
      );
    },
  },
  {
    id: 'optimization4-proof-empty-no-activity-neutral',
    suite: 'run-proof-publisher',
    describe:
      "an empty run degrades to a neutral no-activity row: fallback headline 'OpenSwan run — no recorded activity' (title = headline), run_id null, at '', empty bullets, a single 'no-activity' tag, no git refs, default task_completed",
    run: () => {
      const pub = buildRunProofPublication({});
      return (
        get(pub.proofRow, 'headline') === `OpenSwan run ${EM} no recorded activity` &&
        get(pub.proofRow, 'title') === `OpenSwan run ${EM} no recorded activity` &&
        get(pub.proofRow, 'run_id') === null &&
        get(pub.proofRow, 'at') === '' &&
        get(pub.proofRow, 'pow_type') === 'agent_run' &&
        eq(get(pub.proofRow, 'bullets'), []) &&
        eq(get(pub.proofRow, 'proof_tags'), ['no-activity']) &&
        pub.gitReferences.length === 0 &&
        get(pub.activityRow, 'activity_type') === 'task_completed' &&
        get(pub.activityRow, 'body') === ''
      );
    },
  },
  {
    id: 'optimization4-proof-secret-redacted',
    suite: 'run-proof-publisher',
    describe:
      'an api-key-shaped token in the output summary is [redacted] on the proof bullet and NEVER appears verbatim anywhere in the published rows',
    run: () => {
      const secret = `sk-ant-${'a'.repeat(50)}`;
      const pub = buildRunProofPublication({
        runId: 'run_s',
        toolsUsed: ['read'],
        outputSummary: `Configured with key ${secret} now`,
        stopReason: 'completed',
        nowMs: NOW,
      });
      const bullets = get(pub.proofRow, 'bullets');
      const firstBullet = Array.isArray(bullets) ? bullets[0] : undefined;
      return (
        !j(pub).includes(secret) &&
        typeof firstBullet === 'string' &&
        firstBullet.includes('[redacted]') &&
        !firstBullet.includes(secret)
      );
    },
  },
  {
    id: 'optimization4-proof-hostile-null-total',
    suite: 'run-proof-publisher',
    describe:
      'a null input is TOTAL: it still returns both object rows with the neutral fallback headline and a default task_completed activity row, never throwing',
    run: () => {
      const pub = buildRunProofPublication(null as never);
      return (
        pub != null &&
        typeof pub.proofRow === 'object' &&
        typeof pub.activityRow === 'object' &&
        get(pub.proofRow, 'headline') === `OpenSwan run ${EM} no recorded activity` &&
        get(pub.activityRow, 'activity_type') === 'task_completed' &&
        Array.isArray(pub.gitReferences)
      );
    },
  },

  // ══ suite: memory-provenance (memoryProvenanceCore) ══════════════════════════
  {
    id: 'optimization4-memprov-confidence-bands',
    suite: 'memory-provenance',
    describe:
      "memoryConfidenceBand buckets high≥.66 / medium≥.33 / low, accepts a 0..100 percentage (85→high, 50→medium), and returns 'unknown' for out-of-range / non-numeric input",
    run: () =>
      memoryConfidenceBand(0.9) === 'high' &&
      memoryConfidenceBand(0.66) === 'high' &&
      memoryConfidenceBand(0.65) === 'medium' &&
      memoryConfidenceBand(0.33) === 'medium' &&
      memoryConfidenceBand(0.32) === 'low' &&
      memoryConfidenceBand(0.1) === 'low' &&
      memoryConfidenceBand(85) === 'high' &&
      memoryConfidenceBand(50) === 'medium' &&
      memoryConfidenceBand(-1) === 'unknown' &&
      memoryConfidenceBand(200) === 'unknown' &&
      memoryConfidenceBand('abc') === 'unknown' &&
      memoryConfidenceBand(NaN) === 'unknown' &&
      memoryConfidenceBand(null) === 'unknown',
  },
  {
    id: 'optimization4-memprov-asof-relative',
    suite: 'memory-provenance',
    describe:
      "formatAsOf renders a coarse relative marker ('as of 2d ago' / '3w ago' / '5h ago'), reads a future/clock-skew date as 'as of just now', and returns '' when either the date or nowMs is unusable",
    run: () =>
      formatAsOf(NOW - 2 * DAY, NOW) === 'as of 2d ago' &&
      formatAsOf(NOW - 21 * DAY, NOW) === 'as of 3w ago' &&
      formatAsOf(NOW - 5 * 3600000, NOW) === 'as of 5h ago' &&
      formatAsOf(NOW + 99999, NOW) === 'as of just now' &&
      formatAsOf('nope', NOW) === '' &&
      formatAsOf(NOW, null) === '',
  },
  {
    id: 'optimization4-memprov-full-line-all-tokens',
    suite: 'memory-provenance',
    describe:
      'formatMemoryProvenance appends the compact suffix `[conf:high · as of 2d ago · src:chat · #abc123]` (confidence band, as-of, source token, and a ≤6-char id token, joined by the middle dot)',
    run: () => {
      const line = formatMemoryProvenance(
        {
          text: 'User prefers dark mode',
          score: 0.9,
          source: 'chat',
          updatedAtMs: NOW - 2 * DAY,
          id: 'abc123def456ghi789',
        },
        NOW,
      );
      return line === `User prefers dark mode [conf:high ${DOT} as of 2d ago ${DOT} src:chat ${DOT} #abc123]`;
    },
  },
  {
    id: 'optimization4-memprov-no-id-leak-and-basename',
    suite: 'memory-provenance',
    describe:
      'the provenance suffix NEVER leaks a full id (a UUID collapses to #550e84, the later segments absent) and a source PATH collapses to a basename (no /Users/... leak)',
    run: () => {
      const idLine = formatMemoryProvenance(
        { text: 'fact', id: '550e8400-e29b-41d4-a716-446655440000' },
        NOW,
      );
      const srcLine = formatMemoryProvenance({ text: 'x', source: '/Users/secret/notes/db.md' }, NOW);
      return (
        idLine === 'fact [#550e84]' &&
        !idLine.includes('446655440000') &&
        srcLine === 'x [src:db.md]' &&
        !srcLine.includes('/Users/secret')
      );
    },
  },
  {
    id: 'optimization4-memprov-empty-and-plain-and-cyclic',
    suite: 'memory-provenance',
    describe:
      "empty text → '' (nothing to render); a line whose every suffix token is empty renders just the bounded text; a hostile cyclic object degrades to its text and never throws",
    run: () => {
      const cyc: Record<string, unknown> = { text: 'hi' };
      cyc.self = cyc;
      return (
        formatMemoryProvenance({ text: '', score: 0.9 }, NOW) === '' &&
        formatMemoryProvenance({ text: 'plain fact' }, NOW) === 'plain fact' &&
        formatMemoryProvenance(cyc, NOW) === 'hi'
      );
    },
  },
  {
    id: 'optimization4-memprov-reference-line-memoryentry',
    suite: 'memory-provenance',
    describe:
      "formatMemoryReferenceLine adapts a real MemoryEntry row (title/content/confidence/source_surface/updated_at) into `Port: dev server 8081 [conf:high · as of 3d ago · src:session · #mem9]`",
    run: () => {
      const line = formatMemoryReferenceLine(
        {
          id: 'mem_9',
          title: 'Port',
          content: 'dev server 8081',
          confidence: 0.8,
          source_surface: 'session',
          updated_at: NOW - 3 * DAY,
        },
        NOW,
      );
      return line === `Port: dev server 8081 [conf:high ${DOT} as of 3d ago ${DOT} src:session ${DOT} #mem9]`;
    },
  },

  // ══ suite: response-faithfulness (responseFaithfulnessCore) ══════════════════
  {
    id: 'optimization4-faith-grounded-ok',
    suite: 'response-faithfulness',
    describe:
      "a response whose specific claims all appear in the context scores 1 with flag 'ok' and no unsupported claims",
    run: () => {
      const s = assessFaithfulness({
        responseText: 'The dev server runs on port 8081. BlackSwan-v5 is the model.',
        contextText: 'The dev server runs on port 8081. BlackSwan-v5 lives at cswan801.',
      });
      return eq(s, { score: 1, unsupportedClaims: [], groundedRatio: 1, flag: 'ok' });
    },
  },
  {
    id: 'optimization4-faith-invented-ungrounded',
    suite: 'response-faithfulness',
    describe:
      "an invented specific claim (numbers + a proper noun absent from context) → score 0, groundedRatio 0, flag 'ungrounded', and the offending sentence surfaced",
    run: () => {
      const s = assessFaithfulness({
        responseText: 'The API costs $4200 per month and was launched in 2019 by Zenaptix Corporation.',
        contextText: 'The weather is nice today and the sky is blue.',
      });
      return eq(s, {
        score: 0,
        unsupportedClaims: ['The API costs $4200 per month and was launched in 2019 by Zenaptix Corporation.'],
        groundedRatio: 0,
        flag: 'ungrounded',
      });
    },
  },
  {
    id: 'optimization4-faith-mixed-review',
    suite: 'response-faithfulness',
    describe:
      "a half-grounded answer (one supported claim, one invented) → groundedRatio .5, score .5, flag 'review', with only the invented sentence surfaced",
    run: () => {
      const s = assessFaithfulness({
        responseText: 'The server runs on port 8081. The secret founder is Napoleon Bonaparte.',
        contextText: 'The server runs on port 8081.',
      });
      return eq(s, {
        score: 0.5,
        unsupportedClaims: ['The secret founder is Napoleon Bonaparte.'],
        groundedRatio: 0.5,
        flag: 'review',
      });
    },
  },
  {
    id: 'optimization4-faith-fluff-and-empty-neutral',
    suite: 'response-faithfulness',
    describe:
      "pure fluff (no specific claim) and empty/null input NEVER false-flag — each returns the neutral score-1 'ok' signal; and faithfulnessFlag maps the thresholds (≥.7 ok, ≥.4 review, else ungrounded)",
    run: () => {
      const neutral = { score: 1, unsupportedClaims: [], groundedRatio: 1, flag: 'ok' };
      return (
        eq(
          assessFaithfulness({
            responseText: 'Sure, I can help you with that! Let me know what you need.',
            contextText: '',
          }),
          neutral,
        ) &&
        eq(assessFaithfulness({}), neutral) &&
        eq(assessFaithfulness(null), neutral) &&
        faithfulnessFlag(0.7) === 'ok' &&
        faithfulnessFlag(0.5) === 'review' &&
        faithfulnessFlag(0.4) === 'review' &&
        faithfulnessFlag(0.2) === 'ungrounded'
      );
    },
  },
  {
    id: 'optimization4-faith-citation-credit',
    suite: 'response-faithfulness',
    describe:
      'explicit citations add a small score credit ABOVE the raw overlap: the same half-grounded answer scores .6 with citations vs .5 without, while groundedRatio stays .5',
    run: () => {
      const withCite = assessFaithfulness({
        responseText: 'The server runs on port 8081. The founder is Napoleon Bonaparte.',
        contextText: 'The server runs on port 8081.',
        citations: ['unrelated reference material xyzzy'],
      });
      const noCite = assessFaithfulness({
        responseText: 'The server runs on port 8081. The founder is Napoleon Bonaparte.',
        contextText: 'The server runs on port 8081.',
      });
      return (
        eq(withCite, {
          score: 0.6,
          unsupportedClaims: ['The founder is Napoleon Bonaparte.'],
          groundedRatio: 0.5,
          flag: 'review',
        }) &&
        noCite.score === 0.5 &&
        withCite.score > withCite.groundedRatio
      );
    },
  },
  {
    id: 'optimization4-faith-secret-redacted-claim',
    suite: 'response-faithfulness',
    describe:
      'a long secret-shaped run inside an ungrounded claim is [redacted] in the surfaced sentence (never echoed verbatim), and the claim is flagged ungrounded',
    run: () => {
      const secret = 'a'.repeat(50);
      const s = assessFaithfulness({
        responseText: `The token is ${secret} and the port is 9999.`,
        contextText: 'nothing relevant here at all.',
      });
      return (
        eq(s, {
          score: 0,
          unsupportedClaims: ['The token is [redacted] and the port is 9999.'],
          groundedRatio: 0,
          flag: 'ungrounded',
        }) && !j(s).includes(secret)
      );
    },
  },

  // ══ suite: chat-sources-surface (chatSourcesSurfaceCore) ═════════════════════
  {
    id: 'optimization4-sources-dedupe-and-markdown',
    suite: 'chat-sources-surface',
    describe:
      'a url cited in the answer text DEDUPES against the same url a tool fetched (one url entry); the file ranks before the url; and the markdown block renders both under a **Sources** heading',
    run: () => {
      const s = buildSourcesSurface({
        citations: 'See the docs at https://github.com/owner/repo and file src/lib/foo.ts:42',
        toolEvents: [{ tool: 'web.fetch', metadata: { url: 'https://github.com/owner/repo' } }],
      });
      const urlCount = s.sources.filter((x) => x.kind === 'url').length;
      return (
        s.count === 2 &&
        urlCount === 1 &&
        eq(s.sources, [
          { label: 'src/lib/foo.ts:42', kind: 'file', ref: 'src/lib/foo.ts:42' },
          { label: 'github.com', kind: 'url', ref: 'https://github.com/owner/repo' },
        ]) &&
        s.markdown === '**Sources**\n- `src/lib/foo.ts:42`\n- https://github.com/owner/repo'
      );
    },
  },
  {
    id: 'optimization4-sources-secret-safe-url',
    suite: 'chat-sources-surface',
    describe:
      'a surfaced url strips `user:pass@` userinfo and REDACTS a sensitive query value (apiKey) while keeping a benign one (page); the label is the bare hostname',
    run: () => {
      const s = buildSourcesSurface({
        citations: 'https://user:pass@api.example.com/data?apiKey=SECRET123&page=2',
      });
      return (
        eq(s.sources, [
          {
            label: 'api.example.com',
            kind: 'url',
            ref: 'https://api.example.com/data?apiKey=REDACTED&page=2',
          },
        ]) && !j(s).includes('SECRET123') && !j(s).includes('user:pass')
      );
    },
  },
  {
    id: 'optimization4-sources-absolute-path-basename',
    suite: 'chat-sources-surface',
    describe:
      'an absolute path cited in text is reduced to a basename (secret.ts) so a username directory never leaks into the Sources surface',
    run: () => {
      const s = buildSourcesSurface({ citations: 'edited /Users/chris/proj/src/secret.ts today' });
      return (
        eq(s.sources, [{ label: 'secret.ts', kind: 'file', ref: 'secret.ts' }]) &&
        !j(s).includes('/Users/chris')
      );
    },
  },
  {
    id: 'optimization4-sources-tool-marker-and-rank',
    suite: 'chat-sources-surface',
    describe:
      'a tool event with no natural reference emits a generic "(tool)" marker labelled by tool name; and the rank order groups file < url < commit',
    run: () => {
      const toolOnly = buildSourcesSurface({
        toolEvents: [{ tool: 'desktop.read_file', summary: 'no url here' }],
      });
      const ranked = buildSourcesSurface({
        citations: `commit ${'a'.repeat(40)} url https://x.io/p file lib/a.ts`,
      });
      return (
        eq(toolOnly.sources, [{ label: 'desktop.read_file', kind: 'tool', ref: 'desktop.read_file' }]) &&
        toolOnly.markdown === '**Sources**\n- desktop.read_file (tool)' &&
        eq(ranked.sources.map((x) => x.kind), ['file', 'url', 'commit'])
      );
    },
  },
  {
    id: 'optimization4-sources-hostile-neutral',
    suite: 'chat-sources-surface',
    describe:
      'empty / null / cyclic input each yields the neutral { sources: [], markdown: "", count: 0 } and never throws',
    run: () => {
      const cyc: Record<string, unknown> = {};
      cyc.self = cyc;
      const neutral = { sources: [], markdown: '', count: 0 };
      return (
        eq(buildSourcesSurface({}), neutral) &&
        eq(buildSourcesSurface(null as never), neutral) &&
        eq(buildSourcesSurface(cyc as never), neutral)
      );
    },
  },

  // ══ suite: chat-recovery-display (chatRecoveryDisplayCore) ════════════════════
  {
    id: 'optimization4-recovery-customer-safe-sanitizer',
    suite: 'chat-recovery-display',
    describe:
      'sanitizeVisibleComputerTaskMessage REPLACES a message leaking bridge/stack internals on a non-completed task with one generic customer-safe line, but passes a clean message (and ANY completed-status message) through unchanged',
    run: () => {
      const leaky = sanitizeVisibleComputerTaskMessage(
        'desktop.edit_file failed: ECONNREFUSED at endpoint',
        'failed',
      );
      return (
        leaky === 'I could not finish that app or file action. Technical details were saved for recovery.' &&
        sanitizeVisibleComputerTaskMessage('I opened Photoshop and applied the filter.', 'failed') ===
          'I opened Photoshop and applied the filter.' &&
        sanitizeVisibleComputerTaskMessage('desktop.edit_file done', 'completed') === 'desktop.edit_file done'
      );
    },
  },
  {
    id: 'optimization4-recovery-support-warning-and-append',
    suite: 'chat-recovery-display',
    describe:
      'isSupportOnlyComputerTaskWarning flags a technical bridge/stack warning (true) but not a human-actionable one (false); appendCustomerSafeRecoveryMessage adds a recovery line with a blank-line gap, or leaves the trimmed base alone when none is given',
    run: () =>
      isSupportOnlyComputerTaskWarning('stale_bridge TypeError') === true &&
      isSupportOnlyComputerTaskWarning('Please approve the login') === false &&
      appendCustomerSafeRecoveryMessage('Base message.  ', 'Try reconnecting.') ===
        'Base message.\n\nTry reconnecting.' &&
      appendCustomerSafeRecoveryMessage('Base message.', null) === 'Base message.',
  },
  {
    id: 'optimization4-recovery-actor-and-surface-labels',
    suite: 'chat-recovery-display',
    describe:
      'the recovery actor labels (openswan/connected_agent/llm/user/none) and the surface-kind labels (desktop_app/local_file/browser/hybrid/agent_buildout/other) each map to their exact display text',
    run: () =>
      getRecoveryOptionActorLabel('openswan') === 'OpenSwan' &&
      getRecoveryOptionActorLabel('connected_agent') === 'Connected agent' &&
      getRecoveryOptionActorLabel('llm') === 'LLM' &&
      getRecoveryOptionActorLabel('user') === 'User' &&
      getRecoveryOptionActorLabel('none') === 'Stop' &&
      formatRecoverySurfaceKind('desktop_app') === 'Desktop app' &&
      formatRecoverySurfaceKind('local_file') === 'Local files' &&
      formatRecoverySurfaceKind('browser') === 'Browser' &&
      formatRecoverySurfaceKind('hybrid') === 'Multi-surface' &&
      formatRecoverySurfaceKind('agent_buildout') === 'Capability buildout' &&
      formatRecoverySurfaceKind('other') === 'Task',
  },
  {
    id: 'optimization4-recovery-area-evidence-handoff-labels',
    suite: 'chat-recovery-display',
    describe:
      "formatRecoveryFailureArea title-cases a snake area (default 'Recovery'); formatRecoveryEvidenceLabel strips the tool namespace to a human phrase; formatHandoffSurfaceRouteLabel maps each known surface and returns null for unknown/absent",
    run: () =>
      formatRecoveryFailureArea('observe_before_action') === 'Observe Before Action' &&
      formatRecoveryFailureArea(null) === 'Recovery' &&
      formatRecoveryEvidenceLabel('desktop.observe_app') === 'observe app' &&
      formatRecoveryEvidenceLabel('browser.read_page') === 'read page' &&
      formatHandoffSurfaceRouteLabel({ surface: 'desktop' } as never) === 'Desktop app' &&
      formatHandoffSurfaceRouteLabel({ surface: 'local_files' } as never) === 'Local files' &&
      formatHandoffSurfaceRouteLabel({ surface: 'browser' } as never) === 'Browser' &&
      formatHandoffSurfaceRouteLabel({ surface: 'computer' } as never) === 'Computer' &&
      formatHandoffSurfaceRouteLabel({ surface: 'zzz' } as never) === null &&
      formatHandoffSurfaceRouteLabel(null) === null,
  },
  {
    id: 'optimization4-recovery-reliability-status-and-card',
    suite: 'chat-recovery-display',
    describe:
      'getRecoveryReliabilityStatus honors its precedence (user-step > agent-repair > ready > needs-evidence > stopped; null → null) and buildRecoveryReliabilityCard folds a ready desktop summary into the exact titled card (subtitle joined by the middle dot)',
    run: () => {
      const userStep = getRecoveryReliabilityStatus({ userActionRequired: true } as never);
      const agent = getRecoveryReliabilityStatus({ connectedAgentAllowed: true } as never);
      const ready = getRecoveryReliabilityStatus({ retryAllowed: true, readinessStatus: 'ready' } as never);
      const needs = getRecoveryReliabilityStatus({ retryAllowed: true, readinessStatus: 'stale' } as never);
      const stopped = getRecoveryReliabilityStatus({} as never);
      const precedence = getRecoveryReliabilityStatus({
        userActionRequired: true,
        connectedAgentAllowed: true,
        retryAllowed: true,
      } as never);
      const card = buildRecoveryReliabilityCard({
        retryAllowed: true,
        readinessStatus: 'ready',
        surfaceKind: 'desktop_app',
        failureArea: 'proof_after',
        targetName: 'Photoshop',
        nextEvidenceTools: ['desktop.observe_app', 'desktop.screenshot'],
        verificationCommands: ['typecheck'],
      } as never);
      return (
        get(userStep, 'label') === 'User step' &&
        get(userStep, 'color') === '#f59e0b' &&
        get(agent, 'label') === 'Agent repair' &&
        get(ready, 'label') === 'Ready' &&
        get(needs, 'label') === 'Needs evidence' &&
        get(stopped, 'label') === 'Stopped' &&
        get(precedence, 'label') === 'User step' &&
        getRecoveryReliabilityStatus(null) === null &&
        eq(card, {
          title: 'Desktop app recovery',
          subtitle: `Photoshop ${DOT} Proof After`,
          statusLabel: 'Ready',
          color: '#22c55e',
          detail: 'desktop.observe_app',
          chips: ['Evidence ready', 'observe app', 'screenshot', '1 checks'],
        }) &&
        buildRecoveryReliabilityCard(null) === null
      );
    },
  },

  // ══ suite: chat-message-types (chatMessageTypes) ═════════════════════════════
  {
    id: 'optimization4-msgtype-ischatmessage-structural',
    suite: 'chat-message-types',
    describe:
      'isChatMessage requires the six non-optional fields correctly typed: a valid bot/user row passes; a missing timestamp, a non-Date timestamp, and null/array/string all fail',
    run: () => {
      const bot = { id: 'm1', content: 'hi', isBot: true, isUser: false, timestamp: new Date(0), reactions: {} };
      const user = { id: 'm2', content: 'yo', isBot: false, isUser: true, timestamp: new Date(0), reactions: {} };
      return (
        isChatMessage(bot) === true &&
        isChatMessage(user) === true &&
        isChatMessage({ id: 'x', content: 'c', isBot: true, isUser: false, reactions: {} }) === false &&
        isChatMessage({ ...bot, timestamp: 12345 }) === false &&
        isChatMessage(null) === false &&
        isChatMessage([bot]) === false &&
        isChatMessage('m') === false
      );
    },
  },
  {
    id: 'optimization4-msgtype-bot-vs-user',
    suite: 'chat-message-types',
    describe:
      'isChatBotMessage / isChatUserMessage split on isBot vs isUser (a bot row is bot-not-user, a user row is user-not-bot), and both reject a non-ChatMessage shape',
    run: () => {
      const bot = { id: 'm1', content: 'hi', isBot: true, isUser: false, timestamp: new Date(0), reactions: {} };
      const user = { id: 'm2', content: 'yo', isBot: false, isUser: true, timestamp: new Date(0), reactions: {} };
      return (
        isChatBotMessage(bot) === true &&
        isChatUserMessage(bot) === false &&
        isChatBotMessage(user) === false &&
        isChatUserMessage(user) === true &&
        isChatBotMessage({ isBot: true }) === false
      );
    },
  },
  {
    id: 'optimization4-msgtype-optional-shape-guards',
    suite: 'chat-message-types',
    describe:
      'the optional-field shape guards accept the empty object {} but reject a wrong-typed present field (numeric actor / non-boolean localOnly), and reject null',
    run: () =>
      isChatMessageSource({}) === true &&
      isChatMessageSource({ actor: 'agent', showRouteChips: true }) === true &&
      isChatMessageSource({ actor: 42 }) === false &&
      isChatMessageSource(null) === false &&
      isChatBotMessageExtra({}) === true &&
      isChatBotMessageExtra({ localOnly: 'yes' }) === false &&
      isChatBotMessageExtra(null) === false,
  },
  {
    id: 'optimization4-msgtype-accessors-total',
    suite: 'chat-message-types',
    describe:
      "the accessors read id / artifacts / pending / route-chips / reaction-count / memory-ref-count off a message and degrade safely ('' / false / 0) on hostile input, never throwing",
    run: () => {
      const bot = { id: 'm1', content: 'hi', isBot: true, isUser: false, timestamp: new Date(0), reactions: { '👍': ['u1', 'u2'] } };
      return (
        getChatMessageId(bot) === 'm1' &&
        getChatMessageId(null) === '' &&
        chatMessageHasArtifacts({ ...bot, artifacts: [{}] }) === true &&
        chatMessageHasArtifacts(bot) === false &&
        isPendingChatMessage({ ...bot, isPending: true }) === true &&
        isPendingChatMessage(bot) === false &&
        chatMessageShowsRouteChips({ ...bot, source: { showRouteChips: true } }) === true &&
        chatMessageShowsRouteChips(bot) === false &&
        chatMessageReactionCount(bot, '👍') === 2 &&
        chatMessageReactionCount(bot, '🎉') === 0 &&
        countChatMessageMemoryRefs({ ...bot, memoryRefs: [{}, {}] }) === 2 &&
        countChatMessageMemoryRefs(bot) === 0
      );
    },
  },
];
