/**
 * Focused Room reload-page smoke.
 *
 * Proves the repository fetches the newest bounded rows with a deterministic
 * timestamp/id order, then reverses that page for chronological UI rendering.
 * No React Native or live Supabase dependency is required.
 *
 * Run: npx tsx scripts/room-message-reload-pagination-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

type Row = {
  id: string;
  room_id: string;
  created_at: string;
  content: string;
};

type QueryCall = readonly [string, ...unknown[]];

const repositoryPath = resolve(
  process.cwd(),
  'src/screens/circles/tabs/rooms/roomRepository.ts',
);
const source = readFileSync(repositoryPath, 'utf8');
const sourceFile = ts.createSourceFile(
  repositoryPath,
  source,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

function functionDeclaration(name: string): ts.FunctionDeclaration {
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert(declaration, `${name} declaration exists`);
  return declaration;
}

function executableLoadMessages(injections: Record<string, unknown>): (
  roomId: string,
  limit?: number,
) => Promise<Row[]> {
  const declaration = functionDeclaration('loadMessages').getText(sourceFile).replace(/^export\s+/, '');
  const javascript = ts.transpileModule(declaration, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const names = Object.keys(injections);
  const factory = new Function(
    ...names,
    `'use strict';\n${javascript}\nreturn loadMessages;`,
  );
  return factory(...names.map((name) => injections[name])) as (
    roomId: string,
    limit?: number,
  ) => Promise<Row[]>;
}

function fakeSupabase(sourceRows: Row[] | null, queryError: unknown = null): {
  client: Record<string, unknown>;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const orders: Array<{ column: keyof Row; ascending: boolean }> = [];
  let requestedRoomId = '';

  const builder = {
    select(columns: string) {
      calls.push(['select', columns]);
      return this;
    },
    eq(column: string, value: string) {
      calls.push(['eq', column, value]);
      assert.equal(column, 'room_id');
      requestedRoomId = value;
      return this;
    },
    order(column: keyof Row, options: { ascending: boolean }) {
      calls.push(['order', column, options]);
      orders.push({ column, ascending: options.ascending });
      return this;
    },
    limit(value: number) {
      calls.push(['limit', value]);
      if (queryError) return Promise.resolve({ data: null, error: queryError });
      const data = sourceRows == null
        ? null
        : sourceRows
            .filter((row) => row.room_id === requestedRoomId)
            .slice()
            .sort((left, right) => {
              for (const order of orders) {
                const comparison = String(left[order.column]).localeCompare(String(right[order.column]));
                if (comparison !== 0) return order.ascending ? comparison : -comparison;
              }
              return 0;
            })
            .slice(0, value);
      return Promise.resolve({ data, error: null });
    },
  };

  return {
    client: {
      from(table: string) {
        calls.push(['from', table]);
        assert.equal(table, 'room_messages');
        return builder;
      },
    },
    calls,
  };
}

function buildRows(count: number): Row[] {
  const start = Date.UTC(2026, 7, 12, 12, 0, 0);
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${String(index).padStart(3, '0')}`,
    room_id: 'room-exact',
    // Two rows share each timestamp so the id tie-break is exercised.
    created_at: new Date(start + Math.floor(index / 2) * 1_000).toISOString(),
    content: `message ${index}`,
  }));
}

function chronologicalKey(row: Row): string {
  return `${row.created_at}:${row.id}`;
}

async function main(): Promise<void> {
  const allRows = buildRows(205);
  const { client, calls } = fakeSupabase(allRows);
  const loggedErrors: unknown[][] = [];
  const loadMessages = executableLoadMessages({
    supabase: client,
    toRoomMessage: (row: Row) => row,
    console: { error: (...args: unknown[]) => loggedErrors.push(args) },
  });

  const page = await loadMessages('room-exact');
  assert.equal(page.length, 200);
  assert.equal(page[0]?.id, 'message-005');
  assert.equal(page.at(-1)?.id, 'message-204');
  assert(!page.some((row) => ['message-000', 'message-001', 'message-002', 'message-003', 'message-004'].includes(row.id)));
  assert.deepEqual(
    page.map(chronologicalKey),
    page.map(chronologicalKey).slice().sort(),
    'newest database page is reversed into timestamp/id ascending UI order',
  );
  assert.deepEqual(calls, [
    ['from', 'room_messages'],
    ['select', '*'],
    ['eq', 'room_id', 'room-exact'],
    ['order', 'created_at', { ascending: false }],
    ['order', 'id', { ascending: false }],
    ['limit', 200],
  ]);
  assert.equal(loggedErrors.length, 0);
  console.log('pass: >200 rows returns the deterministic newest 200 in chronological UI order');

  const smallQuery = fakeSupabase(allRows);
  const loadSmall = executableLoadMessages({
    supabase: smallQuery.client,
    toRoomMessage: (row: Row) => row,
    console: { error: () => undefined },
  });
  assert.deepEqual(
    (await loadSmall('room-exact', 3)).map((row) => row.id),
    ['message-202', 'message-203', 'message-204'],
  );
  assert.deepEqual(smallQuery.calls.at(-1), ['limit', 3]);

  const oversizedQuery = fakeSupabase(allRows);
  const loadOversized = executableLoadMessages({
    supabase: oversizedQuery.client,
    toRoomMessage: (row: Row) => row,
    console: { error: () => undefined },
  });
  assert.equal((await loadOversized('room-exact', 10_000)).length, 200);
  assert.deepEqual(oversizedQuery.calls.at(-1), ['limit', 200]);
  console.log('pass: custom pages stay bounded and preserve the newest rows');

  for (const [label, rows, error] of [
    ['empty rows', [] as Row[], null],
    ['null data', null, null],
    ['query error', null, new Error('offline')],
  ] as const) {
    const query = fakeSupabase(rows, error);
    const errors: unknown[][] = [];
    const load = executableLoadMessages({
      supabase: query.client,
      toRoomMessage: (row: Row) => row,
      console: { error: (...args: unknown[]) => errors.push(args) },
    });
    assert.deepEqual(await load('room-exact'), [], label);
    assert.equal(errors.length, error ? 1 : 0, label);
  }
  console.log('pass: empty, null-data, and error outcomes are bounded and non-throwing');

  console.log('\nRoom message reload pagination smoke passed.');
}

void main();
