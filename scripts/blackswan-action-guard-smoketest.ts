/**
 * Smoke test for the BlackSwan no-tools action-request guard in
 * supabase/functions/swanbot-ai/index.ts
 * (looksLikeUnsupportedActionRequestForBlackSwan / buildBlackSwanActionGuardMessage).
 *
 * That file is a Deno edge function, so it cannot be `import`-ed by tsx/Node
 * the way the pure `src/lib/*Core.ts` modules are. Following the established
 * pattern in scripts/blackswan-garble-detector-smoketest.ts, this test
 * extracts the REAL, shipped functions out of the source text via
 * UC_SMOKE_EXTRACT markers and executes them with `new Function`, so a
 * revert/regression in the real logic actually fails this test.
 *
 * Run: npx tsx scripts/blackswan-action-guard-smoketest.ts
 */

import fs from 'fs';
import ts from 'typescript';

const source = fs.readFileSync('supabase/functions/swanbot-ai/index.ts', 'utf8');

function extractFunction<T>(name: string): T {
  const startMarker = `/* UC_SMOKE_EXTRACT_START ${name} */`;
  const endMarker = `/* UC_SMOKE_EXTRACT_END ${name} */`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end <= start) {
    throw new Error(`UC_SMOKE_EXTRACT markers for ${name} not found in supabase/functions/swanbot-ai/index.ts`);
  }
  const tsSource = source.slice(start + startMarker.length, end);
  const fnSource = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSource}; return ${name};`)() as T;
}

const looksLikeUnsupportedActionRequestForBlackSwan = extractFunction<(message: string | null | undefined) => boolean>(
  'looksLikeUnsupportedActionRequestForBlackSwan',
);
const buildBlackSwanActionGuardMessage = extractFunction<() => string>('buildBlackSwanActionGuardMessage');

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

console.log('looksLikeUnsupportedActionRequestForBlackSwan');

assert('empty string is not an action request', looksLikeUnsupportedActionRequestForBlackSwan('') === false);
assert('null is not an action request', looksLikeUnsupportedActionRequestForBlackSwan(null) === false);
assert('undefined is not an action request', looksLikeUnsupportedActionRequestForBlackSwan(undefined) === false);

assert(
  '"open Photoshop and crop this image" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('open Photoshop and crop this image') === true,
);
assert(
  '"click the login button" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('click the login button') === true,
);
assert(
  '"navigate to the settings page" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('navigate to the settings page') === true,
);
assert(
  '"please fill out this form for me" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('please fill out this form for me') === true,
);
assert(
  '"take a screenshot of my screen" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('take a screenshot of my screen') === true,
);
assert(
  '"launch the browser and search for cats" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('launch the browser and search for cats') === true,
);
assert(
  '"open the wordpress admin panel and publish the post" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('open the wordpress admin panel and publish the post') === true,
);
assert(
  '"switch to my email tab and read the newest one" is flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('switch to my email tab and read the newest one') === true,
);
assert(
  '"go to https://imgur.com and upload this" is flagged (URL pattern)',
  looksLikeUnsupportedActionRequestForBlackSwan('go to https://imgur.com and upload this') === true,
);
assert(
  '"open www.example.com in a new tab" is flagged (www URL pattern)',
  looksLikeUnsupportedActionRequestForBlackSwan('open www.example.com in a new tab') === true,
);

assert(
  '"should we launch this feature this week?" (figurative, no app/browser noun) is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('should we launch this feature this week?') === false,
);
assert(
  '"lets open a new task for this" (figurative "open") is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan("let's open a new task for this") === false,
);
assert(
  '"can you check my streak?" (ordinary question) is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('can you check my streak?') === false,
);
assert(
  '"what is my current task list?" (ordinary question) is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('what is my current task list?') === false,
);
assert(
  '"I opened a PR yesterday" (past-tense narration, not a request) is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('I opened a PR yesterday') === false,
);
assert(
  '"click here for more info" (no app/browser noun within range) is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('click here for more info') === false,
);
assert(
  '"launch the campaign next monday" (figurative "launch") is NOT flagged',
  looksLikeUnsupportedActionRequestForBlackSwan('launch the campaign next monday') === false,
);
assert(
  '"go to imgur.com and upload this" (bare domain, no scheme/www) is NOT flagged — known conservative gap',
  looksLikeUnsupportedActionRequestForBlackSwan('go to imgur.com and upload this') === false,
);

console.log('\nbuildBlackSwanActionGuardMessage');

{
  const msg = buildBlackSwanActionGuardMessage();
  assert('guard message is non-empty', typeof msg === 'string' && msg.length > 0);
  assert('guard message is honest about not having tools attached', msg.includes("can't actually open apps"));
  assert('guard message points to the main Chat tab as the real path', msg.includes('main Chat tab'));
  assert('guard message does not claim the action was performed', !/\bdone\b|\bcompleted\b|\bfinished\b/i.test(msg));
}

if (failures > 0) {
  console.error(`\n${failures} blackswan-action-guard smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll blackswan-action-guard smoke cases passed.');
