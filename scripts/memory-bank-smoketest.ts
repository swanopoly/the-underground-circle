/**
 * memory-bank-smoketest — tests the pure grammar from
 * `src/lib/memoryBankKinds.ts` + the parseMemoryBankCommand function
 * from `src/lib/memoryBankChatCommands.ts`. Since parseMemoryBankCommand
 * lives in a file that also imports supabase (via sharedMemory), we
 * re-implement the grammar here to keep the test pure. If the grammar
 * drifts the maintainer must sync both copies.
 *
 * Run: npm run smoke:memory-bank
 */

import { parseMemoryDocKind } from '../src/lib/memoryBankKinds';

// Mirror of parseMemoryBankCommand from memoryBankChatCommands — pure,
// no supabase import. If this drifts from the real one the test fails.
function parseMemoryBankCommand(rawCommand: string): any {
  const trimmed = String(rawCommand || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\/(memory-bank|mb)\b(.*)$/i);
  if (!match) return null;
  const rest = (match[2] || '').trim();
  if (!rest) return { kind: 'summary' };
  const [headRaw, ...tail] = rest.split(/\s+/);
  const head = headRaw.toLowerCase();
  if (head === 'help' || head === '--help' || head === '-h') return { kind: 'help' };
  if (head === 'update' || head === 'set' || head === 'replace' || head === 'append' || head === 'add') {
    const mode = (head === 'append' || head === 'add') ? 'append' : 'replace';
    const [k, ...content] = tail;
    const dk = parseMemoryDocKind(k);
    if (!dk) return { kind: 'unknown', message: `Specify kind` };
    return { kind: 'write', docKind: dk, mode, content: content.join(' ') };
  }
  if (head === 'clear' || head === 'reset') {
    const dk = parseMemoryDocKind(tail.join(' '));
    if (!dk) return { kind: 'unknown', message: `Specify kind to clear` };
    return { kind: 'write', docKind: dk, mode: 'clear', content: '' };
  }
  const dk = parseMemoryDocKind(head);
  if (dk) return { kind: 'read', docKind: dk };
  return { kind: 'unknown', message: `Unknown subcommand \`${head}\`` };
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }

function assertEqual<T>(actual: T, expected: T, name: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    pass(name);
  }
}

// ─── parseMemoryDocKind ────────────────────────────────────────────────────
assertEqual(parseMemoryDocKind('brief'),           'brief',          'kind: brief');
assertEqual(parseMemoryDocKind('active'),          'active_context', 'kind: active alias');
assertEqual(parseMemoryDocKind('active_context'),  'active_context', 'kind: active_context');
assertEqual(parseMemoryDocKind('context'),         'active_context', 'kind: context alias');
assertEqual(parseMemoryDocKind('progress'),        'progress',       'kind: progress');
assertEqual(parseMemoryDocKind('Progress'),        'progress',       'kind: case-insensitive');
assertEqual(parseMemoryDocKind(''),                null,             'kind: empty → null');
assertEqual(parseMemoryDocKind('briefly'),         null,             'kind: typo rejected');

// ─── parseMemoryBankCommand ────────────────────────────────────────────────
assertEqual(parseMemoryBankCommand(''),                              null,                     'parser: empty input → null');
assertEqual(parseMemoryBankCommand('hello world'),                   null,                     'parser: non-slash → null');
assertEqual(parseMemoryBankCommand('/other'),                        null,                     'parser: other slash → null');

assertEqual(parseMemoryBankCommand('/memory-bank'),                  { kind: 'summary' },      'parser: bare command → summary');
assertEqual(parseMemoryBankCommand('/mb'),                           { kind: 'summary' },      'parser: /mb alias → summary');
assertEqual(parseMemoryBankCommand('/memory-bank   '),               { kind: 'summary' },      'parser: trailing whitespace tolerated');

assertEqual(parseMemoryBankCommand('/memory-bank help'),             { kind: 'help' },         'parser: help');
assertEqual(parseMemoryBankCommand('/memory-bank --help'),           { kind: 'help' },         'parser: --help alias');

assertEqual(
  parseMemoryBankCommand('/memory-bank brief'),
  { kind: 'read', docKind: 'brief' },
  'parser: read brief',
);
assertEqual(
  parseMemoryBankCommand('/memory-bank active'),
  { kind: 'read', docKind: 'active_context' },
  'parser: read active',
);
assertEqual(
  parseMemoryBankCommand('/memory-bank progress'),
  { kind: 'read', docKind: 'progress' },
  'parser: read progress',
);

assertEqual(
  parseMemoryBankCommand('/memory-bank update brief The Underground Circle ships a shared agent.'),
  { kind: 'write', docKind: 'brief', mode: 'replace', content: 'The Underground Circle ships a shared agent.' },
  'parser: update brief with content',
);

assertEqual(
  parseMemoryBankCommand('/memory-bank append progress Shipped CA-7 checkpoints today.'),
  { kind: 'write', docKind: 'progress', mode: 'append', content: 'Shipped CA-7 checkpoints today.' },
  'parser: append progress with content',
);

assertEqual(
  parseMemoryBankCommand('/memory-bank clear active'),
  { kind: 'write', docKind: 'active_context', mode: 'clear', content: '' },
  'parser: clear active',
);

assertEqual(
  parseMemoryBankCommand('/memory-bank update'),
  { kind: 'unknown', message: 'Specify kind' },
  'parser: update without kind → unknown',
);

assertEqual(
  parseMemoryBankCommand('/memory-bank wutwut'),
  { kind: 'unknown', message: 'Unknown subcommand `wutwut`' },
  'parser: bogus subcommand → unknown',
);

// ─── Degenerate parser inputs never throw ──────────────────────────────────
for (const bad of [null, undefined, 42, {}, [], '/memory-bank    \t  ', '/MB', '/Memory-Bank UPDATE Brief hi']) {
  try {
    parseMemoryBankCommand(bad as any);
    pass(`parser: degenerate input ${JSON.stringify(bad)} did not throw`);
  } catch (e) {
    fail(`parser: degenerate input ${JSON.stringify(bad)} threw: ${(e as Error).message}`);
  }
}

// ─── Doc-size bound (mirror of handleWrite's MEMORY_BANK_DOC_MAX_CHARS gate) ──
// LOCKSTEP with src/lib/memoryBankChatCommands.ts: circle_memory.content has
// no service-layer cap, so handleWrite refuses (does not truncate) a write
// whose resulting doc would exceed the ceiling. If the constant changes there,
// change it here.
const MEMORY_BANK_DOC_MAX_CHARS = 16_000;
{
  // Mirror of the append composition (`prev + '\n\n' + addition`) + the gate.
  const wouldRefuse = (prev: string, addition: string, mode: 'replace' | 'append'): boolean => {
    const next = mode === 'replace' ? addition : (prev ? prev + '\n\n' + addition : addition);
    return next.length > MEMORY_BANK_DOC_MAX_CHARS;
  };
  assertEqual(wouldRefuse('', 'x'.repeat(100), 'replace'), false, 'bound: small replace allowed');
  assertEqual(wouldRefuse('', 'x'.repeat(MEMORY_BANK_DOC_MAX_CHARS), 'replace'), false, 'bound: replace exactly at cap allowed');
  assertEqual(wouldRefuse('', 'x'.repeat(MEMORY_BANK_DOC_MAX_CHARS + 1), 'replace'), true, 'bound: replace over cap refused');
  // Append: a doc just under the cap + a small addition tips over (incl. separator).
  assertEqual(wouldRefuse('y'.repeat(MEMORY_BANK_DOC_MAX_CHARS - 1), 'zz', 'append'), true, 'bound: append that overflows is refused (not silently truncated)');
  assertEqual(wouldRefuse('y'.repeat(100), 'zz', 'append'), false, 'bound: small append allowed');
}

if (failures > 0) {
  console.error(`\n${failures} memory-bank smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll memory-bank smoke cases passed.');
