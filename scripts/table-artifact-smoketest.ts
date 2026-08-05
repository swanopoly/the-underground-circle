/**
 * table-artifact-smoketest — verifies the pure csv/table helpers behind the
 * `table` structured artifact kind (gap #1 in
 * docs/HUMAN_PARITY_CAPABILITY_MAP.md): RFC-4180-ish parsing (quoted commas,
 * escaped quotes, newlines in quotes, ragged padding, caps), round-trip-safe
 * serialization, and the csv-fence detection swanbot uses to upgrade `code`
 * artifacts to `table`.
 *
 * Run: npx tsx scripts/table-artifact-smoketest.ts
 */

import {
  looksLikeCsvArtifact,
  parseCsvText,
  tableToCsv,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  type ParsedTable,
} from '../src/lib/tableArtifact';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── parseCsvText: plain csv ─────────────────────────────────────────────────
{
  const table = parseCsvText('name,role,city\nAda,Engineer,London\nGrace,Admiral,Arlington');
  expect(!!table, 'plain csv parses');
  expect(deepEquals(table!.headers, ['name', 'role', 'city']), 'headers come from the first row');
  expect(table!.rows.length === 2, 'two data rows');
  expect(deepEquals(table!.rows[1], ['Grace', 'Admiral', 'Arlington']), 'row cells preserved in order');
  expect(table!.sourceRowCount === 2 && table!.sourceColCount === 3, 'source counts exposed');
  pass('plain csv → headers + rows');
}

// ── parseCsvText: quoted commas ─────────────────────────────────────────────
{
  const table = parseCsvText('item,price\n"Beans, canned",1.25\n"Rice, long grain",2.10');
  expect(!!table, 'quoted-comma csv parses');
  expect(table!.rows[0][0] === 'Beans, canned', 'comma inside quotes stays in the field');
  expect(table!.rows[0].length === 2, 'quoted comma does not split the field');
  pass('quoted fields keep embedded commas');
}

// ── parseCsvText: escaped quotes ────────────────────────────────────────────
{
  const table = parseCsvText('quote,who\n"She said ""hello"" twice",Ada');
  expect(!!table, 'escaped-quote csv parses');
  expect(table!.rows[0][0] === 'She said "hello" twice', 'doubled quotes decode to one literal quote');
  pass('escaped quotes ("" → ")');
}

// ── parseCsvText: newlines inside quotes ────────────────────────────────────
{
  const table = parseCsvText('note,owner\n"line one\nline two",Grace\nplain,Ada');
  expect(!!table, 'newline-in-quotes csv parses');
  expect(table!.rows.length === 2, 'quoted newline does not start a new record');
  expect(table!.rows[0][0] === 'line one\nline two', 'newline survives inside the field');
  pass('newlines inside quoted fields');
}

// ── parseCsvText: CRLF + blank lines ────────────────────────────────────────
{
  const table = parseCsvText('a,b\r\n1,2\r\n\r\n3,4\r\n');
  expect(!!table, 'CRLF csv parses');
  expect(table!.rows.length === 2, 'blank lines and trailing newline dropped');
  expect(deepEquals(table!.rows, [['1', '2'], ['3', '4']]), 'CRLF rows parse cleanly');
  pass('CRLF endings + blank-line tolerance');
}

// ── parseCsvText: ragged padding ────────────────────────────────────────────
{
  const table = parseCsvText('a,b,c\n1,2\n4,5,6');
  expect(!!table, 'short-row csv parses');
  expect(deepEquals(table!.rows[0], ['1', '2', '']), 'short row padded with empty cells');
  expect(table!.rows.every((row) => row.length === 3), 'all rows match header width');
  pass('short rows pad to the header width');
}

// ── parseCsvText: minority over-wide row tolerated, majority rejected ───────
{
  const minority = parseCsvText('a,b\n1,2\n3,4,5\n6,7');
  expect(!!minority, 'a single over-wide row is tolerated');
  expect(deepEquals(minority!.rows[1], ['3', '4']), 'over-wide row truncates to the header width');
  const majority = parseCsvText('a,b\n1,2,3,4\n5,6,7,8\n9,10');
  expect(majority === null, 'majority over-wide rows → ragged beyond tolerance → null');
  pass('raggedness tolerance (pad short, reject majority-wide)');
}

// ── parseCsvText: empty / header-only → null ────────────────────────────────
{
  expect(parseCsvText('') === null, 'empty string → null');
  expect(parseCsvText('   \n  \n') === null, 'whitespace-only → null');
  expect(parseCsvText('name,role') === null, 'header with no data rows → null');
  expect(parseCsvText(',\n,') === null, 'entirely empty header cells → null');
  pass('empty and header-only inputs → null');
}

// ── parseCsvText: clamps at 200 rows × 30 cols, counts exposed ──────────────
{
  const wideHeader = Array.from({ length: 40 }, (_, i) => `col${i}`).join(',');
  const wideRow = Array.from({ length: 40 }, (_, i) => `v${i}`).join(',');
  const manyRows = Array.from({ length: 250 }, () => wideRow).join('\n');
  const table = parseCsvText(`${wideHeader}\n${manyRows}`);
  expect(!!table, 'oversized csv still parses');
  expect(table!.rows.length === TABLE_MAX_ROWS, `rows clamp to ${TABLE_MAX_ROWS}`);
  expect(table!.headers.length === TABLE_MAX_COLS, `cols clamp to ${TABLE_MAX_COLS}`);
  expect(table!.rows.every((row) => row.length === TABLE_MAX_COLS), 'every row clamps to the col cap');
  expect(table!.sourceRowCount === 250, 'sourceRowCount exposes the pre-clamp row count');
  expect(table!.sourceColCount === 40, 'sourceColCount exposes the pre-clamp col count');
  pass(`silent clamp at ${TABLE_MAX_ROWS}×${TABLE_MAX_COLS} with source counts`);
}

// ── tableToCsv: round-trip (parse(toCsv(t)) deep-equals t) ──────────────────
{
  const original: ParsedTable = {
    headers: ['name', 'notes, extra', 'quote"col'],
    rows: [
      ['Ada', 'multi\nline note', 'she said "hi"'],
      ['Grace, RADM', '', 'plain'],
    ],
  };
  const csv = tableToCsv(original);
  const reparsed = parseCsvText(csv);
  expect(!!reparsed, 'serialized table re-parses');
  expect(deepEquals(reparsed!.headers, original.headers), 'headers round-trip exactly');
  expect(deepEquals(reparsed!.rows, original.rows), 'rows round-trip exactly (commas, quotes, newlines)');
  pass('tableToCsv → parseCsvText round-trip is lossless');
}

// ── tableToCsv: only risky fields get quoted ────────────────────────────────
{
  const csv = tableToCsv({ headers: ['a', 'b'], rows: [['plain', 'has,comma']] });
  expect(csv === 'a,b\nplain,"has,comma"', 'plain fields stay bare; comma fields quote');
  pass('quoting is minimal and correct');
}

// ── looksLikeCsvArtifact: language signals ──────────────────────────────────
{
  expect(looksLikeCsvArtifact('csv', 'anything'), "language 'csv' → true regardless of content");
  expect(looksLikeCsvArtifact('CSV', 'x'), 'language check is case-insensitive');
  expect(!looksLikeCsvArtifact('python', 'a,b\n1,2\n3,4'), 'explicit non-text language vetoes even comma-consistent content');
  expect(!looksLikeCsvArtifact('json', '"a","b"\n1,2'), "language 'json' → false");
  pass('language signal: csv true, other languages veto');
}

// ── looksLikeCsvArtifact: content heuristic ─────────────────────────────────
{
  expect(
    looksLikeCsvArtifact(null, 'name,age,city\nAda,36,London\nGrace,79,Arlington'),
    'no language + consistent comma counts ≥1 → true',
  );
  expect(
    looksLikeCsvArtifact('text', 'name,age\nAda,36'),
    "generic 'text' language defers to the content heuristic",
  );
  expect(
    !looksLikeCsvArtifact(null, 'name,age,city\nAda,36\nGrace,79,Arlington,USA'),
    'inconsistent comma counts → false',
  );
  expect(!looksLikeCsvArtifact(null, 'just one line, with commas'), 'single line → false');
  expect(!looksLikeCsvArtifact(null, '| a | b |\n|---|---|\n| 1 | 2 |'), 'markdown table → false');
  expect(
    !looksLikeCsvArtifact(null, 'function add(a, b) {\n  return a + b;\n}'),
    'code-looking content → false',
  );
  expect(
    !looksLikeCsvArtifact(null, '{\n  "a": 1,\n  "b": 2\n}'),
    'json object → false',
  );
  expect(
    !looksLikeCsvArtifact(null, '[1,2],\n[3,4],\n[5,6],'),
    'json-ish array lines → false',
  );
  expect(
    !looksLikeCsvArtifact(null, '```csv\na,b\n1,2\n```'),
    'content containing ``` markers → false',
  );
  expect(!looksLikeCsvArtifact(null, ''), 'empty content → false');
  expect(!looksLikeCsvArtifact(undefined, 'a b c\nd e f'), 'comma-free lines → false');
  pass('content heuristic: consistent commas in, markdown/code/json out');
}

if (failures > 0) {
  console.error(`\n${failures} table artifact smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll table artifact smoke cases passed.');
