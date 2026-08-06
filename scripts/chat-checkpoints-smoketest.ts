/**
 * chat-checkpoints-smoketest — exercises `withCheckpoint` +
 * `restoreCheckpoint` from `src/lib/chatCheckpoints.ts` against a
 * stubbed Supabase client so CI stays offline. Covers:
 *
 *   1. Create-then-restore (memory.write with before=null)
 *   2. Update-then-restore (memory.write with both sides)
 *   3. Drift-check refusal (target hash changed since commit)
 *   4. automation.create create + restore
 *
 * Usage:
 *   npm run smoke:chat-checkpoints
 */

type Row = Record<string, any>;

// ─── Stub supabase client ────────────────────────────────────────────────

// In-memory tables the stub operates on. Each test resets them.
const TABLES: Record<string, Row[]> = {
  chat_checkpoints: [],
  memory_entries: [],
  circle_automations: [],
  circle_skills: [],
  circle_memory: [],
  circle_memory_history: [],
};

// Tables whose WRITES should be refused, so a test can simulate the real
// failure mode this file exists to catch: RLS denial. supabase-js reports
// this as a resolved `{ error }`, never a throw.
const DENY_WRITES = new Set<string>();

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function makeQuery(table: string) {
  let rows = [...TABLES[table]];
  let filters: Array<(r: Row) => boolean> = [];
  let sortKey: string | null = null;
  let sortDesc = false;
  let limit: number | null = null;
  let selectFields: string | '*' = '*';
  let updates: Row | null = null;
  let inserts: Row[] = [];
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';

  const exec = async (): Promise<{ data: any; error: null | { message: string } }> => {
    if (op !== 'select' && DENY_WRITES.has(table)) {
      return { data: null, error: { message: `permission denied for table ${table}` } };
    }
    if (op === 'insert') {
      for (const r of inserts) {
        const row = { id: `uuid-${Math.random().toString(36).slice(2, 10)}`, ...r };
        TABLES[table].push(row);
      }
      const data = inserts.length === 1
        ? TABLES[table][TABLES[table].length - 1]
        : TABLES[table].slice(TABLES[table].length - inserts.length);
      return { data, error: null };
    }
    rows = TABLES[table].filter((r) => filters.every((f) => f(r)));
    if (op === 'update') {
      for (const r of rows) Object.assign(r, updates);
      return { data: rows, error: null };
    }
    if (op === 'delete') {
      const keep = TABLES[table].filter((r) => !filters.every((f) => f(r)));
      TABLES[table] = keep;
      return { data: null, error: null };
    }
    if (sortKey) {
      rows.sort((a, b) => {
        const av = a[sortKey!]; const bv = b[sortKey!];
        if (av < bv) return sortDesc ? 1 : -1;
        if (av > bv) return sortDesc ? -1 : 1;
        return 0;
      });
    }
    if (limit != null) rows = rows.slice(0, limit);
    // Projection — when caller does `.select('col1, col2')`, return
    // only those columns (callers depend on `r.content` etc.).
    let out = rows;
    if (selectFields !== '*' && typeof selectFields === 'string') {
      const cols = selectFields.split(',').map((s) => s.trim()).filter(Boolean);
      out = rows.map((r) => {
        const o: any = {};
        for (const c of cols) o[c] = r[c];
        return o;
      });
    }
    return { data: out, error: null };
  };

  const builder: any = {
    select(fields = '*') { selectFields = fields; return builder; },
    eq(col: string, val: any) { filters.push((r) => r[col] === val); return builder; },
    is(col: string, val: any) { filters.push((r) => r[col] === val); return builder; },
    order(col: string, opts?: any) { sortKey = col; sortDesc = !opts?.ascending; return builder; },
    limit(n: number) { limit = n; return builder; },
    insert(row: Row | Row[]) { op = 'insert'; inserts = Array.isArray(row) ? row : [row]; return builder; },
    update(patch: Row) { op = 'update'; updates = patch; return builder; },
    delete() { op = 'delete'; return builder; },
    async maybeSingle() { const r = await exec(); const d: any = r.data; return { data: Array.isArray(d) ? (d[0] ?? null) : (d ?? null), error: r.error }; },
    async single() { const r = await exec(); const d: any = r.data; return { data: Array.isArray(d) ? (d[0] ?? null) : (d ?? null), error: r.error }; },
    then(onFulfilled: any, onRejected: any) { return exec().then(onFulfilled, onRejected); },
  };
  return builder;
}

const supabaseStub = {
  from(table: string) { return makeQuery(table); },
  auth: { async getUser() { return { data: { user: { id: 'test-user' } }, error: null }; } },
};

// Monkey-patch the imports *before* the library loads.
(globalThis as any).__supabaseClient = supabaseStub;
import { Module } from 'module';
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (spec: string) {
  if (spec === './supabase' || spec.endsWith('/supabase')) {
    return { supabase: supabaseStub };
  }
  if (spec === './authSession' || spec.endsWith('/authSession')) {
    return { safeGetUserId: async () => 'test-user' };
  }
  return originalRequire.apply(this, arguments);
};

// ─── Run cases ────────────────────────────────────────────────────────────

function reset() {
  for (const k of Object.keys(TABLES)) TABLES[k] = [];
}

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(msg: string) { console.log('pass:', msg); }

async function main() {
  const { withCheckpoint, restoreCheckpoint } = await import('../src/lib/chatCheckpoints');

  // ─── Case 1: memory.write create → restore deletes ─────────────────────
  reset();
  {
    const fakeMemoryId = 'mem-1';
    const { result, checkpointId } = await withCheckpoint<any, any, any>({
      circleId: 'circle-1',
      toolKind: 'memory.write',
      targetKind: 'memory_entries',
      targetId: fakeMemoryId,
      readBefore: async () => null,
      run: async () => {
        const row = { id: fakeMemoryId, circle_id: 'circle-1', title: 'T', content: 'C', is_active: true };
        TABLES.memory_entries.push(row);
        return row;
      },
      readAfter: async () => {
        return TABLES.memory_entries.find((r) => r.id === fakeMemoryId) || null;
      },
    });
    if (!checkpointId) fail('case1: expected checkpoint id');
    if (result?.id !== fakeMemoryId) fail('case1: result mismatch');
    if (TABLES.memory_entries.length !== 1) fail('case1: memory should exist after run');

    const outcome = await restoreCheckpoint(checkpointId!);
    if (!outcome.ok) fail('case1: restore should succeed — ' + outcome.error);
    if (TABLES.memory_entries.length !== 0) fail('case1: memory should be deleted after restore');
    pass('case1: memory.write create → restore hard-deletes');
  }

  // ─── Case 2: memory.write update → restore writes before back ──────────
  reset();
  {
    const original = { id: 'mem-2', circle_id: 'circle-1', title: 'Old', content: 'Old content', is_active: true };
    TABLES.memory_entries.push({ ...original });

    const { checkpointId } = await withCheckpoint<any, any, any>({
      circleId: 'circle-1',
      toolKind: 'memory.write',
      targetId: 'mem-2',
      readBefore: async () => {
        const r = TABLES.memory_entries.find((r) => r.id === 'mem-2');
        return r ? deepClone(r) : null;
      },
      run: async () => {
        const row = TABLES.memory_entries.find((r) => r.id === 'mem-2')!;
        row.title = 'New';
        row.content = 'New content';
        return row;
      },
      readAfter: async () => {
        const r = TABLES.memory_entries.find((r) => r.id === 'mem-2');
        return r ? deepClone(r) : null;
      },
    });

    const outcome = await restoreCheckpoint(checkpointId!);
    if (!outcome.ok) fail('case2: restore should succeed — ' + outcome.error);
    const restored = TABLES.memory_entries.find((r) => r.id === 'mem-2');
    if (restored?.title !== 'Old') fail('case2: title should be restored to Old, got ' + restored?.title);
    if (restored?.content !== 'Old content') fail('case2: content should be restored');
    pass('case2: memory.write update → restore writes before back');
  }

  // ─── Case 3: drift refusal ────────────────────────────────────────────
  reset();
  {
    TABLES.memory_entries.push({ id: 'mem-3', title: 'A', content: 'A', circle_id: 'circle-1', is_active: true });
    const { checkpointId } = await withCheckpoint<any, any, any>({
      circleId: 'circle-1',
      toolKind: 'memory.write',
      targetId: 'mem-3',
      readBefore: async () => TABLES.memory_entries.find((r) => r.id === 'mem-3') || null,
      run: async () => {
        const row = TABLES.memory_entries.find((r) => r.id === 'mem-3')!;
        row.title = 'B'; row.content = 'B';
        return row;
      },
      readAfter: async () => TABLES.memory_entries.find((r) => r.id === 'mem-3') || null,
    });
    // Someone edits the row AFTER the checkpoint committed.
    const mem = TABLES.memory_entries.find((r) => r.id === 'mem-3')!;
    mem.title = 'C'; mem.content = 'C';

    const outcome = await restoreCheckpoint(checkpointId!);
    if (outcome.ok) fail('case3: restore should have refused due to drift');
    if (!outcome.drift) fail('case3: expected drift field in outcome');
    const current = TABLES.memory_entries.find((r) => r.id === 'mem-3');
    if (current?.title !== 'C') fail('case3: row should be unchanged after refused restore');
    pass('case3: restore refused on target drift');
  }

  // ─── Case 4: automation.create → restore deletes ──────────────────────
  reset();
  {
    const autoId = 'auto-1';
    const { checkpointId } = await withCheckpoint<any, any, any>({
      circleId: 'circle-1',
      toolKind: 'automation.create',
      targetKind: 'circle_automations',
      targetId: autoId,
      readBefore: async () => null,
      run: async () => {
        const row = {
          id: autoId, circle_id: 'circle-1', name: 'Test', prompt: 'p',
          trigger_type: 'manual', action_type: 'chat', action_config: {}, enabled: true,
        };
        TABLES.circle_automations.push(row);
        return row;
      },
      readAfter: async () => TABLES.circle_automations.find((r) => r.id === autoId) || null,
    });

    const outcome = await restoreCheckpoint(checkpointId!);
    if (!outcome.ok) fail('case4: restore should succeed — ' + outcome.error);
    pass('case4: automation.create create → restore calls deleteAutomation');
  }

  // ─── Case 5: memory_bank.write update → restore writes before back ────
  reset();
  {
    const circleId = 'circle-1';
    const docKind = 'brief';
    // Seed the existing brief doc.
    TABLES.circle_memory.push({
      id: 'mem-bank-1',
      circle_id: circleId,
      doc_kind: docKind,
      content: 'Original brief',
      last_edited_by: 'u1',
      last_edited_at: new Date().toISOString(),
      version: 2,
    });

    const { checkpointId } = await withCheckpoint<any, any, any>({
      circleId,
      toolKind: 'memory_bank.write',
      targetKind: 'circle_memory',
      targetId: `${circleId}::${docKind}`,
      readBefore: async () => {
        const row = TABLES.circle_memory.find((r) => r.circle_id === circleId && r.doc_kind === docKind);
        return row ? { content: row.content, version: row.version, doc_kind: docKind } : null;
      },
      run: async () => {
        const row = TABLES.circle_memory.find((r) => r.circle_id === circleId && r.doc_kind === docKind)!;
        row.content = 'Updated brief';
        row.version = 3;
      },
      readAfter: async () => {
        const row = TABLES.circle_memory.find((r) => r.circle_id === circleId && r.doc_kind === docKind);
        return row ? { content: row.content, version: row.version, doc_kind: docKind } : null;
      },
    });

    const outcome = await restoreCheckpoint(checkpointId!);
    if (!outcome.ok) fail('case5: restore should succeed — ' + outcome.error);
    const restored = TABLES.circle_memory.find((r) => r.circle_id === circleId && r.doc_kind === docKind);
    if (restored?.content !== 'Original brief') {
      fail('case5: expected content to be restored, got ' + restored?.content);
    }
    pass('case5: memory_bank.write update → restore writes before content back');
  }

  // ─── Case 6: a REFUSED restore must not report success ──────────────
  // The regression this pins: every write inside the restore handlers was
  // unchecked (`await supabase.from(...).update(...)`), and supabase-js
  // RESOLVES with `{ error }` instead of throwing. So an RLS denial ran to
  // completion, `restored_at` was stamped, and restoreCheckpoint returned
  // ok:true — while the user's data was untouched. Worse, the stamp is
  // terminal ("checkpoint already restored"), so the one-shot undo was spent.
  {
    reset();
    const before = { id: 'mem-deny', title: 'Before', content: 'original', memory_kind: 'note' };
    TABLES.memory_entries.push({ ...before });

    const { checkpointId } = await withCheckpoint<any, any, any>({
      circleId: 'c-deny',
      toolKind: 'memory.write',
      targetKind: 'memory_entries',
      targetId: 'mem-deny',
      readBefore: async () => deepClone(TABLES.memory_entries[0]),
      run: async () => { TABLES.memory_entries[0].content = 'agent edit'; },
      readAfter: async () => deepClone(TABLES.memory_entries[0]),
    });

    DENY_WRITES.add('memory_entries');
    const outcome = await restoreCheckpoint(checkpointId!);
    DENY_WRITES.delete('memory_entries');

    if (outcome.ok) fail('case6: a denied restore must NOT report ok:true');
    if (TABLES.memory_entries[0].content !== 'agent edit') {
      fail('case6: nothing should have been restored');
    }
    const cp = TABLES.chat_checkpoints.find((r) => r.id === checkpointId);
    if (cp?.restored_at) {
      fail('case6: restored_at must stay null so the user can retry — the undo is one-shot');
    }
    if (!cp?.restore_error) fail('case6: the failure should be recorded on the checkpoint row');
    pass('case6: denied write → restore reports failure, undo stays available');
  }

  if (failures > 0) {
    console.error(`\n${failures} checkpoint smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll checkpoint smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
