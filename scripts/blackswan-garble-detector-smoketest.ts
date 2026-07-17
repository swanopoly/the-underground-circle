/**
 * Smoke test for the BlackSwan-only garbling detector and shortened system
 * prompt builder in supabase/functions/swanbot-ai/index.ts
 * (looksLikeGarbledBlackSwanOutput / buildBlackSwanSystemPrompt).
 *
 * That file is a Deno edge function (imports `https://esm.sh/...` and other
 * Deno-only specifiers), so it cannot be `import`-ed by tsx/Node the way the
 * pure `src/lib/*Core.ts` modules are. Following the established pattern in
 * scripts/desktop-bridge-smoketest.ts and scripts/a11y-tree-smoketest.ts
 * (which extract real functions out of scripts/claude-bridge.js the same
 * way), this test extracts the REAL, shipped functions out of the source
 * text via UC_SMOKE_EXTRACT markers and executes them with `new Function`,
 * so a revert/regression in the real logic actually fails this test — it is
 * not a drift-prone hand-written mirror of the logic.
 *
 * Run: npx tsx scripts/blackswan-garble-detector-smoketest.ts
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
  // The extracted chunk is real TypeScript (type annotations, generics on
  // `new Map<...>()`, etc.) — `new Function` only accepts plain JS, so strip
  // types the same way tsx/esbuild would before executing the shipped logic.
  const fnSource = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSource}; return ${name};`)() as T;
}

const looksLikeGarbledBlackSwanOutput = extractFunction<(text: string) => boolean>('looksLikeGarbledBlackSwanOutput');
const buildBlackSwanSystemPrompt = extractFunction<(ctx: any) => string>('buildBlackSwanSystemPrompt');

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

// ─── looksLikeGarbledBlackSwanOutput ───────────────────────────────────────
console.log('looksLikeGarbledBlackSwanOutput');

assert('empty string is not garbled', looksLikeGarbledBlackSwanOutput('') === false);
assert(
  'a genuine short answer is not garbled',
  looksLikeGarbledBlackSwanOutput("🦢 Sounds good — I'll check back with you after your next session.") === false,
);
assert(
  'a 5-char reply is NOT flagged by the near-empty check (boundary)',
  looksLikeGarbledBlackSwanOutput('Sure!') === false,
);
assert('a single "." reply is flagged as near-empty garbling', looksLikeGarbledBlackSwanOutput('.') === true);
assert('a 2-char reply is flagged as near-empty garbling', looksLikeGarbledBlackSwanOutput('ok') === true);

assert(
  'a leaked <think> tag is flagged',
  looksLikeGarbledBlackSwanOutput('<think>the user wants a plan</think>Here is your plan.') === true,
);
assert(
  'an echoed prompt header is flagged',
  looksLikeGarbledBlackSwanOutput('## Expanded Knowledge\nSome dumped context follows.') === true,
);
assert(
  'a leaked reasoning preamble ("Thinking about...") is flagged',
  looksLikeGarbledBlackSwanOutput('Thinking about the answer: the user has 2 tasks open, so I should recommend focusing on the first one before moving on.') === true,
);
assert(
  'a leaked reasoning preamble ("Step 1:") is flagged',
  looksLikeGarbledBlackSwanOutput('Step 1: check the current streak. Step 2: recommend a check-in.') === true,
);
assert(
  // Fixed via code review: the reasoning-preamble regex used to match ANY
  // reply opening with "First, let's ..." / "First, I'll ..." / "First, I
  // need ...", not just leaked reasoning traces — flagging a genuine
  // friendly "First, let's celebrate your streak!" opener as garbled. Now
  // requires a reasoning-flavored verb (check/determine/analyze/...) right
  // after "let's"/"I'll"/"I need to" to count as a leak.
  '"First, let\'s celebrate ..." (a genuine good opener) is NOT flagged',
  looksLikeGarbledBlackSwanOutput("First, let's celebrate your 5-day streak — nice work!") === false,
);
assert(
  '"First, let\'s check the facts ..." (a genuine reasoning leak) is still flagged',
  looksLikeGarbledBlackSwanOutput("First, let's check the facts before I answer that.") === true,
);
assert(
  'a normal answer that opens differently is NOT flagged',
  looksLikeGarbledBlackSwanOutput("Nice, you already checked in three days running — keep it up!") === false,
);

// Found live (round 4 QA fleet, 2026-07-17): a repetition-flood adversarial
// prompt ("help help help ...") caused BlackSwan to leak raw third-person
// planning narration that opened with a casual "Okay,"/"Alright," filler
// instead of any of the specific reasoning-preamble openers above, and
// slipped past every existing check.
assert(
  'a leaked "Okay, the user is ..." third-person planning trace is flagged',
  looksLikeGarbledBlackSwanOutput(
    'Okay, the user is messaggiooned with a lot of "help" repeated in their input. Hmm, first I need to figure out what they actually need. So far, the user would need a detailed plan with that duration. Address the user\'s help needs.',
  ) === true,
);
assert(
  '"Alright, let me know if you need anything else!" (a genuine closer) is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Alright, let me know if you need anything else!') === false,
);
assert(
  '"Okay! Here\'s your update for today." (a genuine opener) is NOT flagged',
  looksLikeGarbledBlackSwanOutput("Okay! Here's your update for today.") === false,
);
assert(
  'two or more third-person "the user" references without a casual opener is flagged',
  looksLikeGarbledBlackSwanOutput(
    'Sure — the user wants a summary of open tasks, and the user has 2 in progress right now.',
  ) === true,
);

const highNonLatin = '어어어어어어어어어어어어어어어어어어어어'; // dense Hangul block
assert('high non-Latin character density is flagged', looksLikeGarbledBlackSwanOutput(highNonLatin) === true);
assert(
  'a normal answer with one non-English word is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Great work today — that streak is looking très bien, keep it up!') === false,
);

assert(
  'three or more bare --- hrule lines are flagged',
  looksLikeGarbledBlackSwanOutput('intro\n---\nmid\n---\nmore\n---\nend') === true,
);
assert(
  'a single markdown --- divider is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Here is the summary:\n---\nAll good.') === false,
);

assert(
  'six or more short backtick tokens are flagged',
  looksLikeGarbledBlackSwanOutput('`cw` `p` `app` `tools` `x` `y` are all things') === true,
);
assert(
  'one or two genuine code backticks are NOT flagged',
  looksLikeGarbledBlackSwanOutput('Run `npm run typecheck` before you commit.') === false,
);

// Sliding window is 24 chars, stepped by 8 — an 8-char repeating unit keeps
// every 24-char window byte-identical (period 8 divides window size 24), so
// this reliably reproduces the non-terminating verbatim loop failure mode
// regardless of step/period alignment.
const repeated = 'loop now'.repeat(10);
assert('a verbatim repetition loop is flagged', looksLikeGarbledBlackSwanOutput(repeated) === true);
assert(
  'genuine longer prose without repetition is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    'You have three open tasks this week. The first is the design review, which is close to done. ' +
      'The second is the client follow-up email, which still needs a draft. The third is the ' +
      'deployment checklist, which can probably wait until Friday.',
  ) === false,
);

// ─── buildBlackSwanSystemPrompt ────────────────────────────────────────────
console.log('buildBlackSwanSystemPrompt');

{
  const minimal = buildBlackSwanSystemPrompt({});
  assert('minimal ctx still returns the frozen persona block', minimal.includes('Agent 🦢'));
  assert('minimal ctx falls back to "Unknown" circle name', minimal.includes('Circle: Unknown'));
  assert('minimal ctx does not add a user greeting line', !minimal.includes("You're talking to"));
  assert(
    'shortened prompt never includes the full-prompt "Expanded Knowledge" section header',
    !minimal.includes('Expanded Knowledge'),
  );
  assert(
    'shortened prompt never includes the full-prompt grounding contract header',
    !minimal.includes('BlackSwan App-Grounding Contract'),
  );
}

{
  const full = buildBlackSwanSystemPrompt({
    circle: { name: 'Night Owls' },
    checkedInCount: 3,
    memberCount: 5,
    currentUser: { display_name: 'Chris', current_streak: 7, longest_streak: 12 },
    userTasks: [
      { status: 'in_progress', title: 'Ship the fix' },
      { status: 'todo', title: 'Write docs' },
    ],
    notCheckedIn: [{ display_name: 'Sam' }, { username: 'jamie' }],
  });
  assert('full ctx includes the circle name and check-in count', full.includes('Circle: Night Owls — 3/5 checked in today.'));
  assert('full ctx greets the current user with their streaks', full.includes("You're talking to Chris — current streak 7 days, longest 12 days."));
  assert('full ctx lists open tasks', full.includes('[in_progress] Ship the fix'));
  assert('full ctx lists who has not checked in', full.includes('Haven’t checked in today: Sam, jamie') || full.includes("Haven't checked in today: Sam, jamie"));
}

if (failures > 0) {
  console.error(`\n${failures} blackswan-garble-detector smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll blackswan-garble-detector smoke cases passed.');
