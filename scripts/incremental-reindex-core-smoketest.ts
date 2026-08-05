/**
 * incremental-reindex-core-smoketest — the pure incremental-reindex planner
 * (src/lib/incrementalReindexCore.ts) behind the codebase-index cost fix:
 * indexCodebase re-embeds the whole repo every run, so this core diffs a fresh
 * crawl against the stored `codebase_files` rows and schedules embeddings only
 * for what actually changed. Load-bearing assertions:
 *
 *   NEEDS RE-INDEX when: new path, size changed, modified_at changed, no stored
 *   embedding, or a different embedding_model (provider migration).
 *   REUSE when: unchanged + already embedded (same model). DELETE stored paths
 *   the fresh crawl no longer produced. force=true → every crawled file is
 *   re-indexed (stale still removed). And every export is TOTAL — degenerate /
 *   null / hostile input never throws and yields a safe, bounded plan/boolean.
 *
 * Pure — loads under tsx (incrementalReindexCore has zero imports).
 */

import {
  MAX_PLAN_FILES,
  normalizeCrawledEntries,
  normalizeIndexedRows,
  fileSignatureChanged,
  planIncrementalReindex,
  type CrawledEntry,
  type IndexedRow,
} from '../src/lib/incrementalReindexCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else {
    failures += 1;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

const MODEL = 'text-embedding-3-small';

/** A stored row that is fully up to date for MODEL. */
function embedded(path: string, extra?: Partial<IndexedRow>): IndexedRow {
  return {
    path,
    size_bytes: 100,
    modified_at: '2026-07-14T00:00:00Z',
    embedding_present: true,
    embedding_model: MODEL,
    ...extra,
  };
}
/** A crawled entry matching `embedded(path)`'s signature. */
function crawled(path: string, extra?: Partial<CrawledEntry>): CrawledEntry {
  return { path, sizeBytes: 100, modifiedAt: '2026-07-14T00:00:00Z', ...extra };
}

function main(): void {
  // ── 1. Unchanged embedded row → toReuse, nothing else ─────────────────────
  {
    const plan = planIncrementalReindex([crawled('a.ts')], [embedded('a.ts')], {
      embeddingModel: MODEL,
    });
    assertEq(plan.toReindex.length, 0, '(1) unchanged → no reindex');
    assertEq(plan.toReuse.length, 1, '(1) unchanged → one reuse');
    assertEq(plan.toReuse[0], 'a.ts', '(1) reuse path is a.ts');
    assertEq(plan.toDelete.length, 0, '(1) unchanged → no delete');
    assert(plan.reason.includes('up to date'), '(1) reason says up to date', plan.reason);
  }

  // ── 2. New file (absent from existing) → toReindex ────────────────────────
  {
    const plan = planIncrementalReindex(
      [crawled('a.ts'), crawled('brand-new.ts')],
      [embedded('a.ts')],
      { embeddingModel: MODEL },
    );
    assertEq(plan.toReindex.length, 1, '(2) one new → one reindex');
    assertEq(plan.toReindex[0].path, 'brand-new.ts', '(2) reindex the new file');
    assertEq(plan.toReuse.length, 1, '(2) the old file reused');
    assertEq(plan.toReuse[0], 'a.ts', '(2) reuse a.ts');
    assertEq(plan.toDelete.length, 0, '(2) nothing deleted');
    assert(plan.reason.includes('1 new'), '(2) reason counts 1 new', plan.reason);
  }

  // ── 3. Changed size → toReindex ───────────────────────────────────────────
  {
    const plan = planIncrementalReindex(
      [crawled('a.ts', { sizeBytes: 999 })],
      [embedded('a.ts')],
      { embeddingModel: MODEL },
    );
    assertEq(plan.toReindex.length, 1, '(3) size change → reindex');
    assertEq(plan.toReindex[0].path, 'a.ts', '(3) reindex a.ts');
    assertEq(plan.toReuse.length, 0, '(3) size change → no reuse');
    assert(plan.reason.includes('1 changed'), '(3) reason counts 1 changed', plan.reason);
  }

  // ── 4. Changed modified_at → toReindex ────────────────────────────────────
  {
    const plan = planIncrementalReindex(
      [crawled('a.ts', { modifiedAt: '2026-07-15T12:00:00Z' })],
      [embedded('a.ts')],
      { embeddingModel: MODEL },
    );
    assertEq(plan.toReindex.length, 1, '(4) mtime change → reindex');
    assertEq(plan.toReuse.length, 0, '(4) mtime change → no reuse');
  }

  // ── 5. Missing embedding → toReindex ──────────────────────────────────────
  {
    const noVec = embedded('a.ts', { embedding_present: false });
    const plan = planIncrementalReindex([crawled('a.ts')], [noVec], {
      embeddingModel: MODEL,
    });
    assertEq(plan.toReindex.length, 1, '(5) no embedding → reindex');
    assertEq(plan.toReuse.length, 0, '(5) no embedding → no reuse');
    // Also derive embedding_present from a raw DB `embedding` field:
    const rawNull = { path: 'b.ts', size_bytes: 5, embedding: null, embedding_model: MODEL };
    const plan2 = planIncrementalReindex(
      [crawled('b.ts', { sizeBytes: 5 })],
      [rawNull],
      { embeddingModel: MODEL },
    );
    assertEq(plan2.toReindex.length, 1, '(5) raw null embedding → reindex');
    const rawSet = { path: 'b.ts', size_bytes: 5, embedding: '[0.1,0.2]', embedding_model: MODEL };
    const plan3 = planIncrementalReindex(
      [crawled('b.ts', { sizeBytes: 5, modifiedAt: undefined })],
      [rawSet],
      { embeddingModel: MODEL },
    );
    assertEq(plan3.toReuse.length, 1, '(5) raw non-empty embedding → reuse');
  }

  // ── 6. embedding_model mismatch (provider migration) → toReindex ──────────
  {
    const oldModel = embedded('a.ts', { embedding_model: 'ada-002' });
    const plan = planIncrementalReindex([crawled('a.ts')], [oldModel], {
      embeddingModel: MODEL,
    });
    assertEq(plan.toReindex.length, 1, '(6) model mismatch → reindex');
    assertEq(plan.toReuse.length, 0, '(6) model mismatch → no reuse');
    // Same rows but NOT migrating (no embeddingModel opt) → reuse, model ignored.
    const planNoOpt = planIncrementalReindex([crawled('a.ts')], [oldModel]);
    assertEq(planNoOpt.toReuse.length, 1, '(6) no target model → model ignored, reuse');
    assertEq(planNoOpt.toReindex.length, 0, '(6) no target model → no reindex');
  }

  // ── 7. Deleted file (stored path no longer crawled) → toDelete ────────────
  {
    const plan = planIncrementalReindex(
      [crawled('a.ts')],
      [embedded('a.ts'), embedded('gone.ts')],
      { embeddingModel: MODEL },
    );
    assertEq(plan.toDelete.length, 1, '(7) one vanished → one delete');
    assertEq(plan.toDelete[0], 'gone.ts', '(7) delete gone.ts');
    assertEq(plan.toReuse.length, 1, '(7) surviving file reused');
    assertEq(plan.toReindex.length, 0, '(7) nothing reindexed');
    assert(plan.reason.includes('remove 1 stale'), '(7) reason counts stale', plan.reason);
  }

  // ── 8. force → everything toReindex (stale still removed) ─────────────────
  {
    const plan = planIncrementalReindex(
      [crawled('a.ts'), crawled('b.ts')],
      [embedded('a.ts'), embedded('b.ts')],
      { embeddingModel: MODEL, force: true },
    );
    assertEq(plan.toReindex.length, 2, '(8) force → both reindex');
    assertEq(plan.toReuse.length, 0, '(8) force → nothing reused');
    assert(plan.reason.startsWith('force:'), '(8) reason marks force', plan.reason);
    // force also deletes files that vanished
    const plan2 = planIncrementalReindex(
      [crawled('a.ts')],
      [embedded('a.ts'), embedded('old.ts')],
      { embeddingModel: MODEL, force: true },
    );
    assertEq(plan2.toReindex.length, 1, '(8) force reindexes the survivor');
    assertEq(plan2.toDelete.length, 1, '(8) force still removes stale');
    assertEq(plan2.toDelete[0], 'old.ts', '(8) force deletes old.ts');
  }

  // ── 9. fileSignatureChanged direct unit tests ─────────────────────────────
  {
    assertEq(
      fileSignatureChanged(crawled('a.ts'), embedded('a.ts'), MODEL),
      false,
      '(9) identical + embedded + same model → unchanged',
    );
    assertEq(
      fileSignatureChanged(crawled('a.ts', { sizeBytes: 7 }), embedded('a.ts'), MODEL),
      true,
      '(9) size differs → changed',
    );
    assertEq(
      fileSignatureChanged(crawled('a.ts', { modifiedAt: 'later' }), embedded('a.ts'), MODEL),
      true,
      '(9) mtime differs → changed',
    );
    assertEq(
      fileSignatureChanged(crawled('a.ts'), embedded('a.ts', { embedding_present: false }), MODEL),
      true,
      '(9) unembedded → changed',
    );
    assertEq(
      fileSignatureChanged(crawled('a.ts'), embedded('a.ts', { embedding_model: 'x' }), MODEL),
      true,
      '(9) model differs → changed',
    );
    // Unknown size on one side is NOT treated as a change (cost guard).
    assertEq(
      fileSignatureChanged({ path: 'a.ts' }, embedded('a.ts'), MODEL),
      false,
      '(9) crawl size unknown → not a change',
    );
    assertEq(
      fileSignatureChanged(crawled('a.ts'), { path: 'a.ts', embedding_present: true, embedding_model: MODEL }, MODEL),
      false,
      '(9) stored size/mtime unknown + embedded → not a change',
    );
    // embedding_present undefined → treated as not embedded → changed.
    assertEq(
      fileSignatureChanged(crawled('a.ts'), { path: 'a.ts' }, undefined),
      true,
      '(9) embedding_present undefined → changed',
    );
    // No target model → model field ignored even when it differs.
    assertEq(
      fileSignatureChanged(crawled('a.ts'), embedded('a.ts', { embedding_model: 'x' })),
      false,
      '(9) no target model → model ignored',
    );
  }

  // ── 10. normalizeCrawledEntries: dedupe, coercion, size/modified fallback ──
  {
    const raw = [
      { path: 'a.ts', size: 10, modified_at: '2026-01-01' }, // raw crawler keys
      { path: 'a.ts', size: 999 }, // duplicate → dropped (first wins)
      { path: 'b.ts', sizeBytes: 20, modifiedAt: 'm' }, // camel keys
      { path: '  c.ts  ' }, // trimmed
      { path: 'win\\d.ts' }, // backslashes normalized
      { path: '' }, // empty → dropped
      { nope: 1 }, // no path → dropped
      null, // dropped
      42, // dropped
    ];
    const out = normalizeCrawledEntries(raw);
    assertEq(out.length, 4, '(10) 4 valid unique entries');
    assertEq(out[0].path, 'a.ts', '(10) first a.ts kept');
    assertEq(out[0].sizeBytes, 10, '(10) raw size → sizeBytes');
    assertEq(out[0].modifiedAt, '2026-01-01', '(10) raw modified_at → modifiedAt');
    assertEq(out[1].sizeBytes, 20, '(10) camel sizeBytes preserved');
    assertEq(out[2].path, 'c.ts', '(10) whitespace trimmed');
    assertEq(out[3].path, 'win/d.ts', '(10) backslashes normalized');
    assertEq(normalizeCrawledEntries('nope' as unknown).length, 0, '(10) non-array → []');
    assertEq(normalizeCrawledEntries(null).length, 0, '(10) null → []');
    // NaN/Infinity sizes coerced away.
    const bad = normalizeCrawledEntries([{ path: 'x', sizeBytes: NaN }]);
    assertEq(bad[0].sizeBytes, undefined, '(10) NaN size → undefined');
  }

  // ── 11. normalizeIndexedRows: embedding_present derive + dedupe ───────────
  {
    const rows = normalizeIndexedRows([
      { path: 'a.ts', embedding: '[1,2]', embedding_model: MODEL, size_bytes: 5 },
      { path: 'b.ts', embedding: null },
      { path: 'c.ts', embedding_present: true },
      { path: 'a.ts', embedding: null }, // dup → dropped
      { path: 'd.ts' }, // no embedding info → present undefined
      'junk',
      undefined,
    ]);
    assertEq(rows.length, 4, '(11) 4 unique valid rows');
    assertEq(rows[0].embedding_present, true, '(11) non-empty embedding → present');
    assertEq(rows[0].size_bytes, 5, '(11) size_bytes preserved');
    assertEq(rows[1].embedding_present, false, '(11) null embedding → not present');
    assertEq(rows[2].embedding_present, true, '(11) explicit embedding_present kept');
    assertEq(rows[3].embedding_present, undefined, '(11) no info → undefined');
    assertEq(normalizeIndexedRows({} as unknown).length, 0, '(11) non-array → []');
  }

  // ── 12. reason string variants + empty inputs ─────────────────────────────
  {
    const empty = planIncrementalReindex([], []);
    assertEq(empty.toReindex.length, 0, '(12) empty crawl → no reindex');
    assertEq(empty.toReuse.length, 0, '(12) empty → no reuse');
    assertEq(empty.toDelete.length, 0, '(12) empty → no delete');
    assert(empty.reason.includes('up to date'), '(12) empty reason up to date', empty.reason);
    const mixed = planIncrementalReindex(
      [crawled('a.ts'), crawled('new.ts'), crawled('b.ts', { sizeBytes: 5 })],
      [embedded('a.ts'), embedded('b.ts'), embedded('gone.ts')],
      { embeddingModel: MODEL },
    );
    assert(mixed.reason.includes('1 new'), '(12) mixed reason 1 new', mixed.reason);
    assert(mixed.reason.includes('1 changed'), '(12) mixed reason 1 changed', mixed.reason);
    assert(mixed.reason.includes('reuse 1'), '(12) mixed reason reuse 1', mixed.reason);
    assert(mixed.reason.includes('remove 1'), '(12) mixed reason remove 1', mixed.reason);
    // First crawled entry preserved; order stable.
    assertEq(mixed.toReindex[0].path, 'new.ts', '(12) order: new before changed');
    assertEq(mixed.toReindex[1].path, 'b.ts', '(12) order: changed second');
  }

  // ── 13. bounded output (MAX_PLAN_FILES) ───────────────────────────────────
  {
    const huge: Array<{ path: string }> = [];
    for (let i = 0; i < MAX_PLAN_FILES + 5000; i += 1) huge.push({ path: 'f' + i + '.ts' });
    const norm = normalizeCrawledEntries(huge);
    assertEq(norm.length, MAX_PLAN_FILES, '(13) crawl normalization capped');
    const plan = planIncrementalReindex(huge, []);
    assert(plan.toReindex.length <= MAX_PLAN_FILES, '(13) toReindex bounded', String(plan.toReindex.length));
    const hugeRows: Array<{ path: string }> = [];
    for (let i = 0; i < MAX_PLAN_FILES + 5000; i += 1) hugeRows.push({ path: 'g' + i + '.ts' });
    assertEq(normalizeIndexedRows(hugeRows).length, MAX_PLAN_FILES, '(13) rows normalization capped');
  }

  // ── 14. degenerate / hostile input → never throws ─────────────────────────
  try {
    const hostiles: unknown[] = [
      undefined,
      null,
      0,
      '',
      'string',
      42,
      true,
      NaN,
      {},
      [],
      [null, undefined, 1, 'x', {}, { path: 42 }, { path: null }],
      [{ path: 'a.ts', size_bytes: 'huge', embedding: {}, embedding_model: 99 }],
      { path: 'not-an-array' },
      Symbol('s') as unknown,
      (() => {}) as unknown,
    ];
    for (const a of hostiles) {
      for (const b of hostiles) {
        const plan = planIncrementalReindex(a, b);
        assert(Array.isArray(plan.toReindex), '(14) toReindex always array');
        assert(Array.isArray(plan.toReuse), '(14) toReuse always array');
        assert(Array.isArray(plan.toDelete), '(14) toDelete always array');
        assert(typeof plan.reason === 'string', '(14) reason always string');
      }
    }
    // hostile opts
    assert(
      Array.isArray(planIncrementalReindex([], [], 'nope' as unknown as { force?: boolean }).toReindex),
      '(14) hostile opts tolerated',
    );
    assert(
      planIncrementalReindex([crawled('a.ts')], [], { force: 'yes' as unknown as boolean }).toReindex.length === 1,
      '(14) non-boolean force is falsy → normal path',
    );
    // fileSignatureChanged hostile — must return a boolean, never throw.
    assertEq(typeof fileSignatureChanged(null as unknown as CrawledEntry, null as unknown as IndexedRow), 'boolean', '(14) fsc(null,null) boolean');
    assertEq(fileSignatureChanged(null as unknown as CrawledEntry, null as unknown as IndexedRow), true, '(14) fsc null existing → true (fail safe)');
    assertEq(typeof fileSignatureChanged(undefined as unknown as CrawledEntry, undefined as unknown as IndexedRow, 123 as unknown as string), 'boolean', '(14) fsc undefined boolean');
    assertEq(typeof fileSignatureChanged({ path: 'a' }, {} as IndexedRow), 'boolean', '(14) fsc empty existing boolean');
    // normalizers on hostile
    assert(Array.isArray(normalizeCrawledEntries(Symbol('x') as unknown)), '(14) normalizeCrawled symbol → array');
    assert(Array.isArray(normalizeIndexedRows(123 as unknown)), '(14) normalizeRows number → array');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error('FAIL: (14) degenerate inputs threw :: ' + ((e as Error)?.message || String(e)));
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll incremental-reindex-core smoke cases passed (' + passes + ' passed).');
}

main();
