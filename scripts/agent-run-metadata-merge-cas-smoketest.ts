/**
 * agent-run-metadata-merge-cas-smoketest
 *
 * Executes the real mergeRunMetadata implementation (plus its private value
 * matcher and per-run barrier) after extracting that block from
 * agentRunSystem.ts and transpiling it into a VM. A deterministic in-memory
 * Supabase query-chain mock pins optimistic-CAS and concurrency behavior
 * without importing the React Native/Supabase singleton or touching a network.
 *
 * Run: npx tsx scripts/agent-run-metadata-merge-cas-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

type Metadata = Record<string, unknown>;
type StoredRow = { metadata: Metadata; updated_at: string };
type QueryResult = { data: StoredRow | null; error: unknown | null };

const sourcePath = resolve(process.cwd(), 'src/lib/agentRunSystem.ts');
const source = readFileSync(sourcePath, 'utf8');
const blockStart = source.indexOf('const runMetadataMergeBarriers =');
const blockEnd = source.indexOf('/**\n * Run-reaper claim:', blockStart);

if (blockStart < 0 || blockEnd < 0) {
  throw new Error('Could not locate the canonical mergeRunMetadata source block.');
}

// Export the two private implementation details strictly for this VM. The
// function bodies remain source-identical to production.
const extractedSource = `${source.slice(blockStart, blockEnd)}\nexport { metadataValueMatches, runMetadataMergeBarriers };\n`;
const transpiled = ts.transpileModule(extractedSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
  fileName: 'agentRunSystem.metadata-merge.extracted.ts',
});

const syntaxErrors = (transpiled.diagnostics || []).filter((diagnostic) => (
  diagnostic.category === ts.DiagnosticCategory.Error
));
if (syntaxErrors.length > 0) {
  throw new Error(`Extracted mergeRunMetadata did not transpile: ${syntaxErrors.map((d) => d.messageText).join('; ')}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class MockAgentRunsDb {
  readonly rows = new Map<string, StoredRow>();
  readonly loadCounts = new Map<string, number>();
  readonly updateCounts = new Map<string, number>();
  readonly timeline: string[] = [];
  readonly alwaysLoseCas = new Set<string>();
  readonly returnMetadataWithoutPatch = new Set<string>();
  readonly conflictsRemaining = new Map<string, number>();
  beforeUpdate?: (runId: string) => Promise<void>;

  seed(runId: string, metadata: Metadata = {}): void {
    this.rows.set(runId, {
      metadata: clone(metadata),
      updated_at: '2026-08-12T00:00:00.000Z',
    });
  }

  private bump(counter: Map<string, number>, runId: string): number {
    const next = (counter.get(runId) || 0) + 1;
    counter.set(runId, next);
    return next;
  }

  async load(runId: string): Promise<QueryResult> {
    this.bump(this.loadCounts, runId);
    this.timeline.push(`load:${runId}`);
    const row = this.rows.get(runId);
    return { data: row ? clone(row) : null, error: null };
  }

  async update(runId: string, expectedUpdatedAt: string, values: StoredRow): Promise<QueryResult> {
    const updateNumber = this.bump(this.updateCounts, runId);
    this.timeline.push(`update:${runId}:${updateNumber}`);
    await this.beforeUpdate?.(runId);

    if (this.alwaysLoseCas.has(runId)) return { data: null, error: null };

    const conflictsLeft = this.conflictsRemaining.get(runId) || 0;
    if (conflictsLeft > 0) {
      const current = this.rows.get(runId);
      if (!current) return { data: null, error: null };
      this.conflictsRemaining.set(runId, conflictsLeft - 1);
      this.rows.set(runId, {
        metadata: { ...current.metadata, concurrent_writer_key: 'preserved' },
        updated_at: new Date(Date.parse(current.updated_at) + 1).toISOString(),
      });
      return { data: null, error: null };
    }

    const current = this.rows.get(runId);
    if (!current || current.updated_at !== expectedUpdatedAt) {
      return { data: null, error: null };
    }

    if (this.returnMetadataWithoutPatch.has(runId)) {
      return {
        data: { metadata: clone(current.metadata), updated_at: values.updated_at },
        error: null,
      };
    }

    const persisted = clone(values);
    this.rows.set(runId, persisted);
    return { data: clone(persisted), error: null };
  }
}

class MockQuery {
  private operation: 'load' | 'update' = 'load';
  private values: StoredRow | null = null;
  private filters = new Map<string, unknown>();

  constructor(private readonly db: MockAgentRunsDb) {}

  select(_columns: string): this {
    return this;
  }

  update(values: StoredRow): this {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.set(column, value);
    return this;
  }

  async maybeSingle(): Promise<QueryResult> {
    const runId = String(this.filters.get('id') || '');
    if (this.operation === 'load') return this.db.load(runId);
    return this.db.update(
      runId,
      String(this.filters.get('updated_at') || ''),
      clone(this.values as StoredRow),
    );
  }
}

function loadRuntime(db: MockAgentRunsDb): {
  mergeRunMetadata: (runId: string, patch: Metadata) => Promise<boolean>;
  metadataValueMatches: (actual: unknown, expected: unknown) => boolean;
  runMetadataMergeBarriers: Map<string, Promise<void>>;
  errors: string[];
} {
  const errors: string[] = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = {
    exports: exportsObject,
    supabase: {
      from(table: string) {
        if (table !== 'agent_runs') throw new Error(`Unexpected table: ${table}`);
        return new MockQuery(db);
      },
    },
    console: {
      error: (...args: unknown[]) => { errors.push(args.map(String).join(' ')); },
    },
  };
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: 'agentRunSystem.metadata-merge.vm.js' });
  return {
    mergeRunMetadata: exportsObject.mergeRunMetadata as (runId: string, patch: Metadata) => Promise<boolean>,
    metadataValueMatches: exportsObject.metadataValueMatches as (actual: unknown, expected: unknown) => boolean,
    runMetadataMergeBarriers: exportsObject.runMetadataMergeBarriers as Map<string, Promise<void>>,
    errors,
  };
}

let assertions = 0;
let failures = 0;

function assert(condition: unknown, message: string, detail?: string): void {
  assertions += 1;
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main(): Promise<void> {
  // The exact production matcher allows extra object keys, recursively checks
  // patch values, and requires exact array shape/order.
  {
    const db = new MockAgentRunsDb();
    const runtime = loadRuntime(db);
    assert(
      runtime.metadataValueMatches(
        { keep: true, nested: { state: 'done', extra: 1 }, list: ['a', { ok: true }] },
        { nested: { state: 'done' }, list: ['a', { ok: true }] },
      ),
      'metadataValueMatches accepts a recursively exact patch within a larger metadata object',
    );
    assert(
      !runtime.metadataValueMatches({ nested: {}, list: ['a', { ok: true }, 'extra'] }, { nested: { state: 'done' }, list: ['a', { ok: true }] }),
      'metadataValueMatches rejects missing object keys and non-exact arrays',
    );
  }

  // Successful update must be backed by the exact row Supabase returned.
  {
    const db = new MockAgentRunsDb();
    db.seed('success', { existing: 'kept' });
    const runtime = loadRuntime(db);
    const result = await runtime.mergeRunMetadata('success', { action: { status: 'completed' } });
    const metadata = db.rows.get('success')?.metadata;
    assert(result === true, 'an exact returned row verifies successfully');
    assert(
      metadata?.existing === 'kept'
        && (metadata?.action as Metadata | undefined)?.status === 'completed',
      'successful merge preserves prior metadata and adds the patch',
    );
    assert(
      db.loadCounts.get('success') === 1 && db.updateCounts.get('success') === 1,
      'uncontended success performs one load and one CAS update',
    );
  }

  // Supabase can return no error for an RLS-filtered or CAS-losing zero-row
  // update. It is never durable proof and retry count must stay bounded.
  {
    const db = new MockAgentRunsDb();
    db.seed('zero-row');
    db.alwaysLoseCas.add('zero-row');
    const runtime = loadRuntime(db);
    const result = await runtime.mergeRunMetadata('zero-row', { proof: true });
    assert(result === false, 'zero-row/no-error updates never report success');
    assert(
      db.loadCounts.get('zero-row') === 3 && db.updateCounts.get('zero-row') === 3,
      'zero-row contention retries exactly three times, then stops',
    );
    assert(
      runtime.errors.some((message) => message.includes('contention limit reached')),
      'bounded zero-row exhaustion records the contention-limit diagnostic',
    );
  }

  // A returned row is insufficient unless its metadata contains the exact
  // patch (including nested values).
  {
    const db = new MockAgentRunsDb();
    db.seed('missing-patch', { existing: true });
    db.returnMetadataWithoutPatch.add('missing-patch');
    const runtime = loadRuntime(db);
    const result = await runtime.mergeRunMetadata('missing-patch', { proof: { verified: true } });
    assert(result === false, 'returned metadata missing the requested patch fails verification');
    assert(
      db.updateCounts.get('missing-patch') === 1
        && runtime.errors.some((message) => message.includes('verification failed')),
      'verification mismatch fails closed immediately with a diagnostic',
    );
  }

  // A cross-client writer wins the first CAS. The next attempt must reload its
  // metadata, merge the local patch on top, and preserve both.
  {
    const db = new MockAgentRunsDb();
    db.seed('one-conflict', { original: true });
    db.conflictsRemaining.set('one-conflict', 1);
    const runtime = loadRuntime(db);
    const result = await runtime.mergeRunMetadata('one-conflict', { local_key: 'kept' });
    const metadata = db.rows.get('one-conflict')?.metadata;
    assert(result === true, 'one optimistic conflict reloads and succeeds');
    assert(
      db.loadCounts.get('one-conflict') === 2 && db.updateCounts.get('one-conflict') === 2,
      'one conflict performs one bounded reload/remerge cycle',
    );
    assert(
      metadata?.original === true
        && metadata?.concurrent_writer_key === 'preserved'
        && metadata?.local_key === 'kept',
      'conflict retry preserves both concurrent and local metadata keys',
    );
  }

  // Same-run calls share the private barrier: the second read begins only
  // after the first write/release, preventing a local lost update.
  {
    const db = new MockAgentRunsDb();
    db.seed('shared-run', { original: true });
    const runtime = loadRuntime(db);
    const [first, second] = await Promise.all([
      runtime.mergeRunMetadata('shared-run', { first_key: 1 }),
      runtime.mergeRunMetadata('shared-run', { second_key: 2 }),
    ]);
    const metadata = db.rows.get('shared-run')?.metadata;
    assert(first === true && second === true, 'two concurrent same-run merges both succeed');
    assert(
      metadata?.original === true && metadata?.first_key === 1 && metadata?.second_key === 2,
      'same-run serialization preserves both patches with no lost update',
    );
    assert(
      db.timeline.slice(0, 4).join('|') === 'load:shared-run|update:shared-run:1|load:shared-run|update:shared-run:2',
      'same-run barrier orders the second load after the first update',
      db.timeline.join('|'),
    );
    assert(runtime.runMetadataMergeBarriers.size === 0, 'same-run barriers are released and removed after completion');
  }

  // Barriers are keyed by run ID, not global. Hold one run inside its update;
  // another run must finish before the held update is released.
  {
    const db = new MockAgentRunsDb();
    db.seed('slow-run');
    db.seed('fast-run');
    const slowReachedUpdate = deferred();
    const releaseSlowUpdate = deferred();
    db.beforeUpdate = async (runId) => {
      if (runId !== 'slow-run') return;
      slowReachedUpdate.resolve();
      await releaseSlowUpdate.promise;
    };
    const runtime = loadRuntime(db);
    const slow = runtime.mergeRunMetadata('slow-run', { slow_key: true });
    await slowReachedUpdate.promise;
    const fast = runtime.mergeRunMetadata('fast-run', { fast_key: true });
    const fastFinishedWhileSlowHeld = await Promise.race([
      fast.then((value) => value),
      new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 100)),
    ]);
    assert(fastFinishedWhileSlowHeld === true, 'different run IDs are not globally serialized');
    releaseSlowUpdate.resolve();
    assert(await slow === true, 'held run completes after its own update is released');
    assert(
      db.rows.get('slow-run')?.metadata.slow_key === true
        && db.rows.get('fast-run')?.metadata.fast_key === true,
      'independent run barriers persist both run-specific patches',
    );
    assert(runtime.runMetadataMergeBarriers.size === 0, 'all per-run barriers are cleaned up');
  }

  if (failures > 0) {
    console.error(`\n${failures}/${assertions} assertions failed.`);
    process.exit(1);
  }
  console.log(`\n${assertions} metadata merge CAS assertions passed.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
