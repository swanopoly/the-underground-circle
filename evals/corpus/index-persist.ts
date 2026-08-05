// index-persist — a golden-case corpus module extending the DETERMINISTIC,
// model-free eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md,
// ADD #1: "the safety net that makes every consolidation safe"). It pins the
// exact OUTPUT of the three PURE cores that stand between an agent run and what
// actually lands in the codebase-index / telemetry persistence path:
//
//   • incrementalReindexCore  — decides which crawled files must be RE-EMBEDDED
//     vs REUSED vs DELETED (a drift here silently re-burns embedding spend on
//     unchanged files, or worse, reuses an incompatible vector after a provider
//     migration);
//   • eventBoundCore          — bounds every agent_run_events payload under four
//     ceilings + secret-masks it (a drift here bloats rows, spins on a cycle, or
//     leaks a token into a telemetry table read back into prompts);
//   • codebaseIndexCore       — plans WHAT is worth indexing and lexically ranks
//     files for a query (a drift here silently indexes vendored junk, or stops
//     surfacing the right file for `@mentions`).
//
// Each case runs the REAL core fn on a FIXED input and returns true iff the
// output equals a golden value that was CAPTURED from the live core (never
// invented). Every imported core is dependency-light + tsx-loadable, so this
// module (like coreGoldenCorpus) runs under tsx with no react-native / supabase
// / deno in the graph. No Date.now()/Math.random() at module scope. Each run()
// is self-contained and defensive; a case that throws is caught by the
// aggregator (runCoreGoldenCase) and scored as a failing row, never a crash.
//
// WIRING: the eval runner concatenates these CASES onto CORE_GOLDEN_CORPUS as
// part of the always-on, key-free tier-1 suite. Ids are CI anchors, so every id
// is globally unique and carries the mandatory 'index-persist-' prefix.

import type { CoreGoldenCase } from '../coreGoldenCorpus';

// ── Cores under test (imported at RUNTIME — the whole point is to exercise them) ─
import { planIncrementalReindex, fileSignatureChanged } from '../../src/lib/incrementalReindexCore';
import {
  boundEventPayload,
  boundToolCallsAggregate,
  EVENT_PAYLOAD_MAX_CHARS,
} from '../../src/lib/eventBoundCore';
import { planCodebaseIndex, rankFilesForQuery, tokenize } from '../../src/lib/codebaseIndexCore';

// ── Tiny total helper: exact, order-sensitive golden match on the serialized form.
// The cores emit deterministic, JSON-safe values (arrays are pre-sorted, object
// key insertion order is stable), so a strict `JSON.stringify(actual) === golden`
// is the strongest "ANY behavioral drift flips this case" signal. Total: a
// (theoretically impossible) cyclic result yields false, never a throw.
function jsonEq(actual: unknown, goldenJson: string): boolean {
  try {
    return JSON.stringify(actual) === goldenJson;
  } catch {
    return false;
  }
}

export const CASES: CoreGoldenCase[] = [
  // ── suite: incremental-reindex (incrementalReindexCore) ─────────────────────
  {
    id: 'index-persist-reindex-unchanged-reuses-vector',
    suite: 'incremental-reindex',
    describe:
      'a file whose size + mtime + embedding-model all match its stored row is REUSED (never re-embedded), scheduling nothing',
    run: () => {
      const plan = planIncrementalReindex(
        [{ path: 'a.ts', sizeBytes: 100, modifiedAt: '2026-01-01' }],
        [
          {
            path: 'a.ts',
            size_bytes: 100,
            modified_at: '2026-01-01',
            embedding_present: true,
            embedding_model: 'openai-embed',
          },
        ],
        { embeddingModel: 'openai-embed' },
      );
      return jsonEq(plan, '{"toReindex":[],"toReuse":["a.ts"],"toDelete":[],"reason":"up to date: reuse all 1 embedded file(s)"}');
    },
  },
  {
    id: 'index-persist-reindex-size-change-reindexes',
    suite: 'incremental-reindex',
    describe: 'a changed byte-size versus the stored row forces the file back into toReindex (counted as changed)',
    run: () => {
      const plan = planIncrementalReindex(
        [{ path: 'a.ts', sizeBytes: 200, modifiedAt: '2026-01-01' }],
        [
          {
            path: 'a.ts',
            size_bytes: 100,
            modified_at: '2026-01-01',
            embedding_present: true,
            embedding_model: 'openai-embed',
          },
        ],
        { embeddingModel: 'openai-embed' },
      );
      return jsonEq(
        plan,
        '{"toReindex":[{"path":"a.ts","sizeBytes":200,"modifiedAt":"2026-01-01"}],"toReuse":[],"toDelete":[],"reason":"re-index 1 (0 new, 1 changed), reuse 0, remove 0 stale"}',
      );
    },
  },
  {
    id: 'index-persist-reindex-new-file-and-stale-delete',
    suite: 'incremental-reindex',
    describe: 'a path absent from stored rows is indexed as NEW while a stored path the crawl no longer produced is scheduled for DELETE',
    run: () => {
      const plan = planIncrementalReindex(
        [{ path: 'new.ts' }],
        [{ path: 'gone.ts', embedding_present: true }],
      );
      return jsonEq(
        plan,
        '{"toReindex":[{"path":"new.ts"}],"toReuse":[],"toDelete":["gone.ts"],"reason":"re-index 1 (1 new, 0 changed), reuse 0, remove 1 stale"}',
      );
    },
  },
  {
    id: 'index-persist-reindex-force-reindexes-all',
    suite: 'incremental-reindex',
    describe: 'force:true re-indexes every crawled file regardless of an otherwise-matching stored signature',
    run: () => {
      const plan = planIncrementalReindex(
        [{ path: 'a.ts' }, { path: 'b.ts' }],
        [{ path: 'a.ts', embedding_present: true }],
        { force: true },
      );
      return jsonEq(
        plan,
        '{"toReindex":[{"path":"a.ts"},{"path":"b.ts"}],"toReuse":[],"toDelete":[],"reason":"force: re-index all 2 crawled file(s)"}',
      );
    },
  },
  {
    id: 'index-persist-reindex-sig-identical-unchanged',
    suite: 'incremental-reindex',
    describe: 'fileSignatureChanged returns false when size + mtime match and an embedding is present (the reuse fast-path)',
    run: () =>
      fileSignatureChanged(
        { path: 'a.ts', sizeBytes: 100, modifiedAt: 'x' },
        { path: 'a.ts', size_bytes: 100, modified_at: 'x', embedding_present: true },
      ) === false,
  },
  {
    id: 'index-persist-reindex-sig-provider-migration',
    suite: 'incremental-reindex',
    describe: 'fileSignatureChanged returns true when the stored embedding_model differs from the current one (provider migration)',
    run: () =>
      fileSignatureChanged(
        { path: 'a.ts' },
        { path: 'a.ts', embedding_present: true, embedding_model: 'old' },
        'new',
      ) === true,
  },
  {
    id: 'index-persist-reindex-sig-missing-embedding',
    suite: 'incremental-reindex',
    describe: 'fileSignatureChanged returns true when the stored row has no embedding yet (embedding_present !== true)',
    run: () => fileSignatureChanged({ path: 'a.ts' }, { path: 'a.ts', embedding_present: false }) === true,
  },

  // ── suite: event-bound (eventBoundCore) ─────────────────────────────────────
  {
    id: 'index-persist-event-small-payload-passthrough',
    suite: 'event-bound',
    describe: 'a small, clean payload survives the bounder structurally unchanged (a nested object round-trips)',
    run: () => {
      const out = boundEventPayload('tool_call_start', { name: 'read', input: { path: 'a.ts' }, ok: true });
      return jsonEq(out, '{"name":"read","input":{"path":"a.ts"},"ok":true}');
    },
  },
  {
    id: 'index-persist-event-oversized-string-clipped',
    suite: 'event-bound',
    describe: 'a 500KB string field is clipped to the 2000-char head + a "[+N chars]" marker, siblings survive, and the whole payload fits under the byte cap',
    run: () => {
      const out = boundEventPayload('tool_call_start', { blob: 'z'.repeat(500_000), keep: 'v' }) as Record<string, unknown>;
      const blobOk = out.blob === `${'z'.repeat(2000)}…[+498000 chars]`;
      const keepOk = out.keep === 'v';
      const underCap = JSON.stringify(out).length <= EVENT_PAYLOAD_MAX_CHARS;
      return blobOk && keepOk && underCap;
    },
  },
  {
    id: 'index-persist-event-secret-masked',
    suite: 'event-bound',
    describe: 'a secret-shaped Anthropic key value is masked to [REDACTED] while a non-secret sibling passes through',
    run: () => {
      const out = boundEventPayload('x', { token: `sk-ant-${'a'.repeat(40)}`, safe: 'ok' });
      return jsonEq(out, '{"token":"[REDACTED]","safe":"ok"}');
    },
  },
  {
    id: 'index-persist-event-cyclic-marker',
    suite: 'event-bound',
    describe: 'a self-referential (cyclic) payload becomes a [cyclic] marker and never spins or throws',
    run: () => {
      const cyc: Record<string, unknown> = { a: 1 };
      cyc.self = cyc;
      const out = boundEventPayload('x', cyc);
      return jsonEq(out, '{"a":1,"self":"[cyclic]"}');
    },
  },
  {
    id: 'index-persist-event-total-size-guard-wrapper',
    suite: 'event-bound',
    describe: 'when JSON escaping pushes the serialized clone past the cap, the authoritative guard collapses it to an __eventPayloadClipped wrapper that provably fits',
    run: () => {
      const out = boundEventPayload('tool_call_start', {
        fields: Array.from({ length: 100 }, () => '"'.repeat(300)),
      }) as Record<string, unknown>;
      return out.__eventPayloadClipped === true && JSON.stringify(out).length <= EVENT_PAYLOAD_MAX_CHARS;
    },
  },
  {
    id: 'index-persist-event-depth-marker',
    suite: 'event-bound',
    describe: 'nesting deeper than the depth ceiling (6) collapses the over-deep node to a [max-depth] marker',
    run: () => {
      const out = boundEventPayload('x', { l1: { l2: { l3: { l4: { l5: { l6: { l7: 'deep' } } } } } } });
      return jsonEq(out, '{"l1":{"l2":{"l3":{"l4":{"l5":{"l6":"[max-depth]"}}}}}}');
    },
  },
  {
    id: 'index-persist-event-toolcalls-cap-and-marker',
    suite: 'event-bound',
    describe: 'boundToolCallsAggregate caps a 60-entry array to 50 bounded entries plus a trailing truncation marker (length 51)',
    run: () => {
      const agg = boundToolCallsAggregate(Array.from({ length: 60 }, (_, i) => ({ name: `tool_${i}` }))) as unknown[];
      return (
        Array.isArray(agg) &&
        agg.length === 51 &&
        jsonEq(agg[agg.length - 1], '{"__truncated":true,"omitted":10,"total":60}')
      );
    },
  },
  {
    id: 'index-persist-event-toolcalls-nonarray-empty',
    suite: 'event-bound',
    describe: 'boundToolCallsAggregate returns an empty array for non-array input (never throws)',
    run: () => jsonEq(boundToolCallsAggregate('nope'), '[]'),
  },

  // ── suite: codebase-index (codebaseIndexCore) ───────────────────────────────
  {
    id: 'index-persist-codebase-plan-classifies-and-skips',
    suite: 'codebase-index',
    describe: 'planCodebaseIndex indexes supported source (path-sorted) while skipping ignored_dir / generated / unsupported_ext / too_large with the right reason each',
    run: () => {
      const plan = planCodebaseIndex([
        { path: 'src/auth.ts' },
        { path: 'node_modules/pkg/index.js' },
        { path: 'README.md' },
        { path: 'package-lock.json' },
        { path: 'notes.txt' },
        { path: 'big.ts', size: 999_999 },
      ]);
      return jsonEq(
        plan,
        '{"toIndex":[{"path":"README.md","language":"markdown"},{"path":"src/auth.ts","language":"typescript"}],"skipped":[{"path":"big.ts","reason":"too_large"},{"path":"node_modules/pkg/index.js","reason":"ignored_dir"},{"path":"notes.txt","reason":"unsupported_ext"},{"path":"package-lock.json","reason":"generated"}],"byLanguage":{"markdown":1,"typescript":1},"totalIndexed":2}',
      );
    },
  },
  {
    id: 'index-persist-codebase-plan-nonarray-neutral',
    suite: 'codebase-index',
    describe: 'planCodebaseIndex returns an empty neutral plan for non-array input (never throws)',
    run: () => jsonEq(planCodebaseIndex('nope'), '{"toIndex":[],"skipped":[],"byLanguage":{},"totalIndexed":0}'),
  },
  {
    id: 'index-persist-codebase-rank-basename-beats-summary',
    suite: 'codebase-index',
    describe: 'rankFilesForQuery scores a basename+symbol hit far above a summary-only hit, excludes zero-match files, and sorts score desc',
    run: () => {
      const ranked = rankFilesForQuery('auth token', [
        { path: 'src/authToken.ts', symbols: ['validateAuthToken'], summary: 'handles login' },
        { path: 'src/misc.ts', summary: 'auth token auth token auth token' },
        { path: 'src/unrelated.ts', summary: 'nothing here' },
      ]);
      return jsonEq(
        ranked,
        '[{"path":"src/authToken.ts","score":36,"matchedTerms":["auth","token"]},{"path":"src/misc.ts","score":9,"matchedTerms":["auth","token"]}]',
      );
    },
  },
  {
    id: 'index-persist-codebase-rank-empty-query-empty',
    suite: 'codebase-index',
    describe: 'rankFilesForQuery returns [] when the query has no scorable terms',
    run: () => jsonEq(rankFilesForQuery('', [{ path: 'a.ts' }]), '[]'),
  },
  {
    id: 'index-persist-codebase-tokenize-camel-snake',
    suite: 'codebase-index',
    describe: 'tokenize splits camelCase + snake_case boundaries and drops query stopwords (getUserProfile from auth_service → 5 terms)',
    run: () => jsonEq(tokenize('getUserProfile from auth_service'), '["get","user","profile","auth","service"]'),
  },
  {
    id: 'index-persist-codebase-tokenize-keep-stopwords',
    suite: 'codebase-index',
    describe: 'tokenize with keepStopwords retains stopword tokens (so a symbol literally named "for"/"the" stays matchable)',
    run: () => jsonEq(tokenize('for the win', true), '["for","the","win"]'),
  },
];
