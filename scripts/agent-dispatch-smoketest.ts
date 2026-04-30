/**
 * agent-dispatch-smoketest — verifies the intent parser handles the
 * three input forms correctly and rejects ambiguous chat messages.
 *
 * Run: `npx tsx scripts/agent-dispatch-smoketest.ts`
 *
 * Exit 0 = all assertions pass; 1 = any failure.
 */
import {
  parseDispatchIntent,
  parseDispatchSlash,
  parseDispatchNatural,
} from '../src/lib/agentDispatchIntent';

let failures = 0;

function eq<T>(actual: T, expected: T, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error('FAIL:', msg);
    console.error('  actual:  ', JSON.stringify(actual));
    console.error('  expected:', JSON.stringify(expected));
  } else {
    console.log('  ok:', msg);
  }
}

console.log('\nparseDispatchSlash');

eq(
  parseDispatchSlash('/assign whistling-taco run npm test'),
  { target: 'whistling-taco', task: 'run npm test', verb: 'auto', source: 'slash' },
  '/assign with hyphenated session name + task',
);

eq(
  parseDispatchSlash('/delegate codex deep research on react 19'),
  { target: 'codex', task: 'deep research on react 19', verb: 'auto', source: 'slash' },
  '/delegate ⇒ verb auto',
);

eq(
  parseDispatchSlash('/spawn claude-code build me a landing page'),
  { target: 'claude-code', task: 'build me a landing page', verb: 'spawn', source: 'slash' },
  '/spawn ⇒ verb spawn',
);

eq(
  parseDispatchSlash('/send blackswan summarize today'),
  { target: 'blackswan', task: 'summarize today', verb: 'send', source: 'slash' },
  '/send ⇒ verb send',
);

eq(
  parseDispatchSlash('/queue cursor refactor the login screen'),
  { target: 'cursor', task: 'refactor the login screen', verb: 'queue', source: 'slash' },
  '/queue ⇒ verb queue',
);

eq(
  parseDispatchSlash('/assign @whistling-taco run tests'),
  { target: 'whistling-taco', task: 'run tests', verb: 'auto', source: 'slash' },
  '/assign strips @ prefix from target',
);

eq(parseDispatchSlash('/help'),                 null, '/help is not a dispatch slash');
eq(parseDispatchSlash('/run npm test'),         null, '/run is not a dispatch slash');
eq(parseDispatchSlash('hello world'),           null, 'plain text returns null');

eq(
  parseDispatchSlash('/assign'),
  { target: '', task: '', verb: 'auto', source: 'slash' },
  'bare /assign returns empty intent (caller shows usage)',
);

console.log('\nparseDispatchNatural');

eq(
  parseDispatchNatural('Assign this task to claude-code: run npm test'),
  { target: 'claude-code', task: 'run npm test', verb: 'auto', source: 'natural' },
  '"Assign this task to X: <body>" picks the colon body as task',
);

eq(
  parseDispatchNatural('assign npm test to whistling-taco'),
  { target: 'whistling-taco', task: 'npm test', verb: 'auto', source: 'natural' },
  '"assign <task> to <target>" extracts task and target',
);

eq(
  parseDispatchNatural('hand this off to codex: dig into the build error'),
  { target: 'codex', task: 'dig into the build error', verb: 'auto', source: 'natural' },
  '"hand this off to X: <body>" works',
);

eq(
  parseDispatchNatural('hand-off the regression to cursor'),
  { target: 'cursor', task: 'the regression', verb: 'auto', source: 'natural' },
  'hyphenated "hand-off" still parses',
);

eq(
  parseDispatchNatural('@blackswan handle the github review'),
  { target: 'blackswan', task: 'the github review', verb: 'auto', source: 'natural' },
  '"@<target> handle <task>"',
);

eq(
  parseDispatchNatural('@whistling-taco run the build'),
  { target: 'whistling-taco', task: 'the build', verb: 'auto', source: 'natural' },
  '"@<target> run <task>"',
);

eq(
  parseDispatchNatural('refactor the login screen — @cursor'),
  { target: 'cursor', task: 'refactor the login screen', verb: 'auto', source: 'natural' },
  '"<task> — @<target>" trailing form (em-dash)',
);

eq(
  parseDispatchNatural('Assign this to claude-code'),
  { target: 'claude-code', task: '', verb: 'auto', source: 'natural' },
  '"Assign this to X" with no body returns empty task (caller can use replyTo)',
);

// Negative cases — false positives would silently dispatch wrong things
eq(parseDispatchNatural('hello world'),                                   null, 'plain text returns null');
eq(parseDispatchNatural('what should I assign to my agent?'),             null, 'question form returns null');
eq(parseDispatchNatural('I send emails to people'),                       null, 'plain "send X to Y" without verb-leading');
eq(parseDispatchNatural('a-b'),                                            null, 'short hyphen text returns null');

console.log('\nparseDispatchIntent (combined)');

eq(
  parseDispatchIntent('/assign claude-code run tests'),
  { target: 'claude-code', task: 'run tests', verb: 'auto', source: 'slash' },
  'combined parser hits slash first',
);
eq(
  parseDispatchIntent('assign refactor.ts to cursor'),
  { target: 'cursor', task: 'refactor.ts', verb: 'auto', source: 'natural' },
  'combined parser falls through to natural',
);
eq(parseDispatchIntent('thanks!'), null, 'plain text returns null');

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
