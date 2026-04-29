/**
 * terminal-commands-smoketest — pure TS smoke test for /run, /sh, /cd,
 * /pwd, /diag bridge parsing and the cwd-wrapping logic.
 *
 * Does NOT call the bridge — covers the parser + cwd persistence + outcome
 * shape so we catch regressions before they reach real keystrokes.
 *
 * Run with: `npx tsx scripts/terminal-commands-smoketest.ts`
 *
 * Exit code 0 = all cases passed; 1 = any failure.
 */

// Use the RN-free parser module so the smoketest can run under tsx
// without webpacking the whole React Native dep graph.
import {
  parseTerminalCommand,
  buildEffectiveCommand,
} from '../src/lib/terminalCommandParser';

let failures = 0;

function assert(ok: boolean, msg: string) {
  if (!ok) {
    failures += 1;
    console.error('FAIL:', msg);
  } else {
    console.log('  ok:', msg);
  }
}

function eq<T>(actual: T, expected: T, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${msg} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ─── parseTerminalCommand ────────────────────────────────────────────────

console.log('\nparseTerminalCommand — slash command parsing');

eq(parseTerminalCommand('/run npm test'), { verb: 'run', rest: 'npm test' }, '/run npm test → run');
eq(parseTerminalCommand('/sh ls -la'), { verb: 'run', rest: 'ls -la' }, '/sh aliases /run');
eq(parseTerminalCommand('/exec pwd'), { verb: 'run', rest: 'pwd' }, '/exec aliases /run');
eq(parseTerminalCommand('/$ echo hi'), { verb: 'run', rest: 'echo hi' }, '/$ aliases /run');
eq(parseTerminalCommand('/run'), { verb: 'run', rest: '' }, 'bare /run shows usage');
eq(parseTerminalCommand('/RUN npm test'), { verb: 'run', rest: 'npm test' }, '/run is case-insensitive');

eq(parseTerminalCommand('/cd /tmp'), { verb: 'cd', rest: '/tmp' }, '/cd <path> parses');
eq(parseTerminalCommand('/cd'), { verb: 'cd', rest: '' }, 'bare /cd clears');
eq(parseTerminalCommand('/cd ~/code'), { verb: 'cd', rest: '~/code' }, '/cd preserves tilde');

eq(parseTerminalCommand('/pwd'), { verb: 'pwd', rest: '' }, '/pwd parses');

eq(parseTerminalCommand('/diag bridge'), { verb: 'diag', rest: 'bridge' }, '/diag bridge parses (back-compat)');
eq(parseTerminalCommand('/diag-bridge'), { verb: 'diag', rest: 'bridge' }, '/diag-bridge alias');
eq(parseTerminalCommand('/diag'), { verb: 'diag', rest: 'all' }, 'bare /diag → all');
eq(parseTerminalCommand('/diag all'), { verb: 'diag', rest: 'all' }, '/diag all explicit');
eq(parseTerminalCommand('/diag claude-code'), { verb: 'diag', rest: 'claude-code' }, '/diag claude-code drills into one');
eq(parseTerminalCommand('/diag openswan-proxy'), { verb: 'diag', rest: 'openswan-proxy' }, '/diag openswan-proxy single');

// Negative cases
eq(parseTerminalCommand('hello world'), null, 'plain text returns null');
eq(parseTerminalCommand('/help'), null, 'unrelated slash returns null');
eq(parseTerminalCommand(''), null, 'empty returns null');
eq(parseTerminalCommand('/runner'), null, '/runner is not /run');

// ─── buildEffectiveCommand — cwd wrapping ─────────────────────────────

console.log('\nbuildEffectiveCommand — cwd wrapping');

eq(
  buildEffectiveCommand('npm test', null),
  'npm test',
  'no cwd → returns command unchanged',
);
eq(
  buildEffectiveCommand('npm test', '/tmp'),
  `cd '/tmp' && npm test`,
  'cwd prepended via cd && command',
);
eq(
  buildEffectiveCommand('ls -la', "/Users/o'brien/code"),
  `cd '/Users/o'\\''brien/code' && ls -la`,
  'single-quote in cwd is escaped',
);

// ─── Done ──────────────────────────────────────────────────────────────

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
