// Smoke test for src/lib/outputContractCore.ts — pure, tsx-loadable.
// Run: npx tsx scripts/output-contract-core-smoketest.ts
// Prints "output-contract-core smoke: N passed, M failed" and exits 1 on any failure.

import { checkOutputContract, isValidJson, type OutputContract } from '../src/lib/outputContractCore';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function hasNote(notes: string[], fragment: string): boolean {
  return notes.some((n) => n.includes(fragment));
}

// --- requireNonEmpty --------------------------------------------------------
const nonEmpty: OutputContract = { requireNonEmpty: true };
assert('requireNonEmpty: "" fails', checkOutputContract('', nonEmpty).pass === false);
assert('requireNonEmpty: whitespace-only fails', checkOutputContract('   ', nonEmpty).pass === false);
assert('requireNonEmpty: "x" passes', checkOutputContract('x', nonEmpty).pass === true);
assert(
  'requireNonEmpty: failure lists the clause',
  hasNote(checkOutputContract('', nonEmpty).failures, 'requireNonEmpty'),
);
assert(
  'requireNonEmpty: satisfied label present when ok',
  hasNote(checkOutputContract('x', nonEmpty).satisfied, 'non-empty'),
);

// --- mustInclude ------------------------------------------------------------
const inc: OutputContract = { mustInclude: ['alpha', 'beta'] };
assert('mustInclude: all present passes', checkOutputContract('alpha and beta here', inc).pass === true);
const incMiss = checkOutputContract('only alpha here', inc);
assert('mustInclude: missing one fails', incMiss.pass === false);
assert('mustInclude: names the missing substring', hasNote(incMiss.failures, 'beta'));
assert('mustInclude: does NOT flag the present one', !hasNote(incMiss.failures, '"alpha"'));
assert(
  'mustInclude: case-sensitive (Alpha != alpha)',
  checkOutputContract('Alpha only', { mustInclude: ['alpha'] }).pass === false,
);

// --- mustMatch (valid + deliberately bad regex) -----------------------------
assert(
  'mustMatch: valid regex that matches passes',
  checkOutputContract('order #1234 ok', { mustMatch: ['#\\d{4}'] }).pass === true,
);
assert(
  'mustMatch: valid regex that does not match fails',
  checkOutputContract('no number', { mustMatch: ['#\\d{4}'] }).pass === false,
);
const badRe = checkOutputContract('anything', { mustMatch: ['('] });
assert('mustMatch: bad regex "(" does NOT throw and fails', badRe.pass === false);
assert('mustMatch: bad regex yields "invalid pattern" note', hasNote(badRe.failures, 'invalid pattern:'));
assert(
  'mustMatch: satisfied label on match',
  hasNote(checkOutputContract('#1234', { mustMatch: ['#\\d{4}'] }).satisfied, 'matches'),
);

// --- forbid -----------------------------------------------------------------
const forb: OutputContract = { forbid: ['TODO', 'FIXME'] };
assert('forbid: present triggers fail', checkOutputContract('done but TODO left', forb).pass === false);
assert('forbid: absent passes', checkOutputContract('all clean', forb).pass === true);
assert(
  'forbid: failure names the forbidden substring',
  hasNote(checkOutputContract('has FIXME', forb).failures, 'FIXME'),
);

// --- minLen / maxLen (trimmed) ----------------------------------------------
assert('minLen: below bound fails', checkOutputContract('hi', { minLen: 5 }).pass === false);
assert('minLen: at bound passes', checkOutputContract('hello', { minLen: 5 }).pass === true);
assert('maxLen: above bound fails', checkOutputContract('abcdef', { maxLen: 3 }).pass === false);
assert('maxLen: at bound passes', checkOutputContract('abc', { maxLen: 3 }).pass === true);
assert(
  'minLen: uses TRIMMED length (padded short string still fails)',
  checkOutputContract('  hi  ', { minLen: 5 }).pass === false,
);

// --- format: json -----------------------------------------------------------
assert('format json: valid object passes', checkOutputContract('{"a":1}', { format: 'json' }).pass === true);
assert('format json: valid array passes', checkOutputContract('[1,2,3]', { format: 'json' }).pass === true);
assert('format json: invalid fails', checkOutputContract('{not json}', { format: 'json' }).pass === false);
assert('format json: prose fails', checkOutputContract('just words', { format: 'json' }).pass === false);

// --- format: text / markdown ------------------------------------------------
assert('format text: always ok (prose)', checkOutputContract('literally anything', { format: 'text' }).pass === true);
assert('format text: empty still ok', checkOutputContract('', { format: 'text' }).pass === true);
assert('format markdown: non-empty ok', checkOutputContract('# Title', { format: 'markdown' }).pass === true);
assert(
  'format markdown: empty body noted as failure',
  checkOutputContract('   ', { format: 'markdown' }).pass === false,
);

// --- empty / undefined contract → pass --------------------------------------
assert('empty contract {} passes', checkOutputContract('whatever', {}).pass === true);
assert('empty contract {} has no clauses', checkOutputContract('whatever', {}).satisfied.length === 0);
assert('undefined contract passes', checkOutputContract('whatever', undefined).pass === true);
assert('null contract passes', checkOutputContract('whatever', null).pass === true);

// --- non-string output treated as empty -------------------------------------
assert(
  'non-string output fails requireNonEmpty',
  checkOutputContract(undefined as unknown as string, { requireNonEmpty: true }).pass === false,
);
assert(
  'non-string output fails minLen',
  checkOutputContract(42 as unknown as string, { minLen: 1 }).pass === false,
);

// --- multiple failures accumulate -------------------------------------------
const multi = checkOutputContract('short', {
  requireNonEmpty: true,
  mustInclude: ['missingA', 'missingB'],
  forbid: ['short'],
  minLen: 100,
  format: 'json',
});
assert('multiple failures: overall fails', multi.pass === false);
assert('multiple failures: accumulates several notes', multi.failures.length >= 4);
assert('multiple failures: still records satisfied clauses', multi.satisfied.length >= 1);

// --- pass invariant ---------------------------------------------------------
const okAll = checkOutputContract('{"status":"ok"}', {
  requireNonEmpty: true,
  mustInclude: ['ok'],
  mustMatch: ['status'],
  forbid: ['error'],
  minLen: 3,
  maxLen: 100,
  format: 'json',
});
assert('all-clauses-pass: pass true', okAll.pass === true);
assert('all-clauses-pass: failures empty', okAll.failures.length === 0);
assert('pass equals (failures.length === 0)', okAll.pass === (okAll.failures.length === 0));

// --- isValidJson direct -----------------------------------------------------
assert('isValidJson: object', isValidJson('{"a":1}') === true);
assert('isValidJson: array', isValidJson('[]') === true);
assert('isValidJson: primitive number', isValidJson('42') === true);
assert('isValidJson: primitive string', isValidJson('"hi"') === true);
assert('isValidJson: true/false/null', isValidJson('true') && isValidJson('false') && isValidJson('null'));
assert('isValidJson: garbage false', isValidJson('{oops}') === false);
assert('isValidJson: empty false', isValidJson('') === false);
assert('isValidJson: whitespace false', isValidJson('   ') === false);
assert('isValidJson: non-string false', isValidJson(undefined) === false);

// --- report -----------------------------------------------------------------
console.log(`output-contract-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
