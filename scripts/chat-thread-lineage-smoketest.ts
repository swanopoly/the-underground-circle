/**
 * chat-thread-lineage-smoketest — CA-8j. Pins the lineage resolver,
 * ancestor walker, and BFS orderer. All three are pure; the migration
 * itself is exercised manually.
 *
 * Run: npm run smoke:chat-thread-lineage
 */

import {
  orderByLineage,
  resolveLineageRoot,
  walkLineageAncestors,
  type ChatThreadLineageRow,
} from '../src/lib/chatThreadLineage';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── resolveLineageRoot ──────────────────────────────────────────
  assert(resolveLineageRoot(null) === null, 'root: no parent → null');
  assert(resolveLineageRoot(undefined) === null, 'root: undefined parent → null');
  assert(
    resolveLineageRoot({ id: 'root-id' }) === 'root-id',
    'root: parent with no lineage_root_id → parent.id (first fork)',
  );
  assert(
    resolveLineageRoot({ id: 'mid-id', lineage_root_id: 'root-id' }) === 'root-id',
    'root: parent already in lineage → inherits lineage_root_id',
  );
  // Empty-string lineage_root_id counts as "no root set" → fall back to parent.id
  assert(
    resolveLineageRoot({ id: 'mid-id', lineage_root_id: '' }) === 'mid-id',
    'root: empty-string lineage_root_id → parent.id',
  );
  assert(
    resolveLineageRoot({ id: 'mid-id', lineage_root_id: null }) === 'mid-id',
    'root: null lineage_root_id → parent.id',
  );

  // ─── walkLineageAncestors ────────────────────────────────────────
  // Build a linear chain: A (root) ← B ← C
  const store: Record<string, ChatThreadLineageRow> = {
    A: { id: 'A', parent_thread_id: null },
    B: { id: 'B', parent_thread_id: 'A', lineage_root_id: 'A' },
    C: { id: 'C', parent_thread_id: 'B', lineage_root_id: 'A' },
  };
  const fetchRow = async (id: string) => store[id] || null;

  {
    const chain = await walkLineageAncestors('C', fetchRow);
    assert(chain.length === 3, `walk: 3 ancestors from C (got ${chain.length})`);
    assert(chain[0].id === 'C', 'walk: starts at C');
    assert(chain[1].id === 'B', 'walk: second is B');
    assert(chain[2].id === 'A', 'walk: last is A (root)');
  }
  {
    // Missing row mid-chain — stop cleanly
    const gappyStore: Record<string, ChatThreadLineageRow> = {
      X: { id: 'X', parent_thread_id: 'Y' }, // Y doesn't exist
    };
    const chain = await walkLineageAncestors('X', async (id) => gappyStore[id] || null);
    assert(chain.length === 1, 'walk: missing parent stops cleanly');
    assert(chain[0].id === 'X', 'walk: returns the rows it found');
  }
  {
    // Cycle guard — A ← B ← A (impossible via CHECK constraint but
    // smoke the logic anyway)
    const cyclic: Record<string, ChatThreadLineageRow> = {
      A: { id: 'A', parent_thread_id: 'B' },
      B: { id: 'B', parent_thread_id: 'A' },
    };
    const chain = await walkLineageAncestors('A', async (id) => cyclic[id] || null);
    assert(chain.length === 2, `walk: cycle detected after 2 nodes (got ${chain.length})`);
  }
  {
    // maxSteps cap
    const deepStore: Record<string, ChatThreadLineageRow> = {};
    for (let i = 0; i < 50; i += 1) {
      deepStore[`n${i}`] = { id: `n${i}`, parent_thread_id: i > 0 ? `n${i - 1}` : null };
    }
    const chain = await walkLineageAncestors('n49', async (id) => deepStore[id] || null, 20);
    assert(chain.length === 20, `walk: maxSteps caps at 20 (got ${chain.length})`);
  }

  // ─── orderByLineage: empty + single ──────────────────────────────
  assert(orderByLineage([]).length === 0, 'order: empty → empty');
  {
    const one: ChatThreadLineageRow[] = [{ id: 'A' }];
    const out = orderByLineage(one);
    assert(out.length === 1 && out[0].id === 'A', 'order: single row passthrough');
  }

  // ─── orderByLineage: linear chain ────────────────────────────────
  {
    // Intentionally shuffled — resolver must still put them in root-first order.
    const rows: ChatThreadLineageRow[] = [
      { id: 'C', parent_thread_id: 'B' },
      { id: 'A', parent_thread_id: null },
      { id: 'B', parent_thread_id: 'A' },
    ];
    const out = orderByLineage(rows);
    assert(out.map((r) => r.id).join('>') === 'A>B>C', `order: root→child→grandchild (got ${out.map((r) => r.id).join('>')})`);
  }

  // ─── orderByLineage: fork (two branches off root) ────────────────
  {
    const rows: ChatThreadLineageRow[] = [
      { id: 'root', parent_thread_id: null },
      { id: 'left', parent_thread_id: 'root' },
      { id: 'right', parent_thread_id: 'root' },
      { id: 'leftleft', parent_thread_id: 'left' },
    ];
    const out = orderByLineage(rows);
    assert(out[0].id === 'root', 'order: fork starts at root');
    // BFS — both immediate children appear before grandchildren.
    const leftIdx = out.findIndex((r) => r.id === 'left');
    const rightIdx = out.findIndex((r) => r.id === 'right');
    const leftleftIdx = out.findIndex((r) => r.id === 'leftleft');
    assert(leftIdx < leftleftIdx && rightIdx < leftleftIdx,
      `order: BFS — immediate children before grandchildren (left=${leftIdx}, right=${rightIdx}, leftleft=${leftleftIdx})`);
    assert(out.length === 4, 'order: no rows dropped');
  }

  // ─── orderByLineage: orphan (parent not in set) ──────────────────
  {
    const rows: ChatThreadLineageRow[] = [
      { id: 'a', parent_thread_id: 'missing-parent' },
      { id: 'b', parent_thread_id: 'a' },
    ];
    const out = orderByLineage(rows);
    // `a` is effectively a root within this set (its parent isn't here)
    assert(out[0].id === 'a', `order: orphan with external parent treated as root (got ${out[0].id})`);
    assert(out[1].id === 'b', 'order: child of orphan-root follows');
  }

  // ─── orderByLineage: multiple root candidates — pick the one with children ───
  {
    const rows: ChatThreadLineageRow[] = [
      { id: 'childless-root', parent_thread_id: null },
      { id: 'productive-root', parent_thread_id: null },
      { id: 'kid', parent_thread_id: 'productive-root' },
    ];
    const out = orderByLineage(rows);
    assert(out[0].id === 'productive-root', 'order: root with descendants wins over orphan root');
    // Childless root still appears in output (never dropped).
    assert(out.some((r) => r.id === 'childless-root'), 'order: childless root still included');
    assert(out.length === 3, 'order: all rows preserved');
  }

  // ─── orderByLineage: cycle doesn't drop rows ──────────────────────
  {
    const rows: ChatThreadLineageRow[] = [
      { id: 'x', parent_thread_id: 'y' },
      { id: 'y', parent_thread_id: 'x' },
    ];
    const out = orderByLineage(rows);
    assert(out.length === 2, 'order: cycle → both rows still in output');
  }

  if (failures > 0) {
    console.error(`\n${failures} chat-thread-lineage smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-thread-lineage smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
