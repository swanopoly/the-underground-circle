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
const stripBlackSwanReasoningText = extractFunction<(text: string | null) => string | null>('stripBlackSwanReasoningText');

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
  'two or more third-person "the user" references (each directly followed by a verb) without a casual opener is flagged',
  looksLikeGarbledBlackSwanOutput(
    'Sure — the user wants a summary of open tasks, and the user has 2 in progress right now.',
  ) === true,
);
assert(
  'a single "the user is ..." mention with no second occurrence is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Thanks for asking — the user is able to update their own preferences from settings.') === false,
);
// Fixed via independent review fleet (2026-07-17): the unqualified bare-
// bigram version of this check ("the user" appearing >=2 times, with no
// requirement on what follows) also flagged ordinary text discussing
// product documentation, since "the user manual"/"the user guide" both
// contain the literal substring "the user". Narrowed to require an
// immediate state/planning verb, which the live leak still has twice
// ("the user IS messaggiooned ... the user WOULD need ...") but ordinary
// noun phrases like "the user manual" never do.
assert(
  '"the user manual ... the user guide ..." (genuine docs text) is NOT flagged',
  looksLikeGarbledBlackSwanOutput('The user manual is in the shared drive, and the user guide covers setup.') === false,
);
assert(
  'a casual "Hmm," opener followed by "I need to" (isolated from the "the user" count check) is flagged',
  looksLikeGarbledBlackSwanOutput('Hmm, I need to double-check that before I answer.') === true,
);

const highNonLatin = '어어어어어어어어어어어어어어어어어어어어'; // dense Hangul block
assert('high non-Latin character density is flagged', looksLikeGarbledBlackSwanOutput(highNonLatin) === true);
assert(
  'a normal answer with one non-English word is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Great work today — that streak is looking très bien, keep it up!') === false,
);
assert(
  '3 stray CJK characters in an otherwise-short, mostly-English reply are flagged (still above 5% density at this length)',
  looksLikeGarbledBlackSwanOutput('No sensors — IAF A才有了. NO BLACKSWAN') === true,
);
// Fixed via independent review fleet (2026-07-17): a prior version made ANY
// single non-Latin character match a hard trigger regardless of density, to
// catch a live case with only 3 stray CJK characters scattered through a
// long (~1600 char) garbled reply. That was reverted after the review found
// and verified it discards otherwise-correct replies that legitimately name
// a teammate in Cyrillic or quote a room-chat message in Korean. Reverting
// to a pure density ratio does NOT fully solve the false-positive problem
// though — this is a known, still-open, PRE-EXISTING limitation (predates
// this round's changes): a short reply genuinely built around quoting one
// foreign word has just as high a density as short foreign-heavy garbling,
// so it is still (incorrectly) flagged. Documented here rather than
// silently left unverified.
assert(
  'a short reply that genuinely quotes one foreign word is still flagged (known pre-existing density-ratio limitation, not solved by this round)',
  looksLikeGarbledBlackSwanOutput("'hello' in Japanese is こんにちは.") === true,
);
// The dropped live case above (3 CJK chars in a long garbled reply) is
// instead caught by the excessive-bold-span check below, which was the
// response's more distinctive and much safer-to-detect symptom.
assert(
  'excessive short markdown-bold spans (8+) are flagged',
  looksLikeGarbledBlackSwanOutput(
    "You're stating a task creation request. BlackSwan QA Agent **currently has a task creation capability.** " +
      'However, it does not have the information about **specific task details.** ' +
      "BlackSwan QA Agent's **current task board capacity** is 70 days. " +
      'Sensor **resource compliance** was not checked, resulting in **resource sensor availability.** ' +
      'You are currently in **BlackSwan Recovery** — BlackSwan QA Agent could **verify if they have specific task details** but instead, it was not checked. ' +
      "BlackSwan QA Agent's **stated: SIXTY** — **answered: SIXTY**: time.",
  ) === true,
);
assert(
  'a genuine reply with 2 bold labels (e.g. Done/Next) is NOT flagged',
  looksLikeGarbledBlackSwanOutput("Update:\n**Done:** shipped the fix\n**Next:** writing tests\nAnything I'm missing?") === false,
);
// Fixed via independent review fleet (2026-07-17): a bare "8+ bold spans"
// count false-positived on completely ordinary bolded lists this app
// produces routinely — a weekly digest bolding each teammate's name once,
// or a plan bolding each step label once. Both are 8+ DISTINCT spans with
// no real repetition, unlike the garbled evidence above (whose spans share
// content words: "specific task details" in 2 spans, "SIXTY" in 2 spans).
assert(
  'a genuine 8-person weekly digest (one bold name per line) is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    "🦋 Here's your weekly digest:\n**Chris**: 5-day streak, 3 tasks done\n**Sam**: 2-day streak, 1 task done\n**Jamie**: 7-day streak, 4 tasks done\n**Alex**: 1-day streak, 0 tasks done\n**Morgan**: 4-day streak, 2 tasks done\n**Taylor**: 6-day streak, 5 tasks done\n**Jordan**: 3-day streak, 2 tasks done\n**Casey**: 0-day streak, 0 tasks done\nKeep up the great work, team!",
  ) === false,
);
assert(
  'a genuine 8-step plan (one bold step label per line) is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    '**Step 1:** Review the PR\n**Step 2:** Merge if green\n**Step 3:** Deploy to staging\n**Step 4:** Smoke test\n**Step 5:** Deploy to prod\n**Step 6:** Announce in Circle\n**Step 7:** Close the task\n**Step 8:** Celebrate',
  ) === false,
);

// Found live (round 5 QA fleet, 2026-07-17): a bare colon-terminated label
// slipped past the <5-char near-empty check.
assert('a bare "length:" label is flagged as a degenerate fragment', looksLikeGarbledBlackSwanOutput('length:') === true);
assert(
  '"Section one summary:" (3 words, over the <=2-word cutoff) is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Section one summary:') === false,
);
// Boundary test for the trimmed.length < 40 gate (found missing via
// independent review fleet, 2026-07-17).
assert('a 39-char single-word colon fragment (just under the 40-char gate) is flagged', looksLikeGarbledBlackSwanOutput('x'.repeat(38) + ':') === true);
assert('a 40-char single-word colon fragment (at the 40-char gate) is NOT flagged', looksLikeGarbledBlackSwanOutput('x'.repeat(39) + ':') === false);
assert('"On it!" is NOT flagged as a degenerate fragment', looksLikeGarbledBlackSwanOutput('On it!') === false);
assert('"yep, sounds good" is NOT flagged as a degenerate fragment', looksLikeGarbledBlackSwanOutput('yep, sounds good') === false);
// A single-lowercase-letter-opener check (meant to catch mid-sentence
// truncation like "s to one or two sentences.") was removed after an
// independent review fleet found and verified it also flagged ordinary
// casual replies ("k, got it!", "u ready for standup?") and lettered lists
// ("a) do the dishes"). These genuine short openers must stay unflagged —
// this is an intentional, accepted trade-off, not an oversight.
assert('"A great job today, keep it up!" is NOT flagged', looksLikeGarbledBlackSwanOutput('A great job today, keep it up!') === false);
assert("\"I'll get right on it.\" is NOT flagged", looksLikeGarbledBlackSwanOutput("I'll get right on it.") === false);

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

// Found live (round 5 QA fleet, 2026-07-17): a loop where the wording drifts
// slightly between repeats never lines up into an identical 24-char sliding
// window, so the check above misses it — but the same full sentence (50+
// chars) recurring verbatim is still the same failure mode at the sentence
// level. Floor is 50 chars, not 30 — see the false-positive regression test
// below (raised via independent review fleet, 2026-07-17).
assert(
  'a full sentence repeated verbatim (with drifting wording elsewhere) is flagged',
  looksLikeGarbledBlackSwanOutput(
    'Based on the plan, you need two days, which means at least two days for the plan. ' +
      'The plan status is in check, which is a product status. ' +
      'So, there is no information so this is purely a product. ' +
      'The plan status is in check, which is a product status.',
  ) === true,
);
assert(
  'a short greeting repeated twice in casual speech is NOT flagged',
  looksLikeGarbledBlackSwanOutput('Hey! Hey, nice to see you back today.') === false,
);
// Fixed via independent review fleet (2026-07-17): the original 30-char
// sentence-length floor also flagged a genuine multi-person digest reusing
// the same short congratulatory template sentence for two different
// people — a real, non-garbled shape for this product (per-member
// streak/check-in summaries). Raised the floor to 50 chars, which still
// catches the drifting-repetition test above (each repeated sentence is
// 50+ chars) while no longer catching this shorter, legitimate case.
assert(
  'the same short congratulatory sentence reused for two different people in a digest is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    'Alex checked in today. Great job, keep up that streak of yours! Jamie checked in today. Great job, keep up that streak of yours!',
  ) === false,
);

// Found via live direct-endpoint testing (2026-07-17, bypassing the app):
// a word-salad loop of many short, fragmentary, unpunctuated lines — a
// different shape than either repetition check above (no exact-repeated
// text, so neither the sliding window nor the sentence-repeat check fires).
const degenerateLineSalad = `***** Messages: *****

Q: ** interval since QA units* Sonic chess car got blac swan

S: <- QA
    interval since sonic units* blac got blac swan
    the car was purely the
    it was a
    blac swan car
    blac swan car
    the car was
    the car was
    the car was      blac swan
QA
    blac got QA
    blac chess car got

    QA
    blac got QA
    blac swan car got QA
    internal QA

    blac swan car got QA
    internal QA
    pure QA

    QA
    blac got QA
    internal QA

    blac swan car got QA


    pure internal QA
    pure internal blac swan
    pure internal QA
    internal pure blac swan QA`;
assert('a long word-salad loop of short unpunctuated lines is flagged', looksLikeGarbledBlackSwanOutput(degenerateLineSalad) === true);
assert(
  'a genuine multi-item task list (7 lines, still under the 10-line floor) is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    "🦢 Here's where things stand:\n- Fix login bug (in progress)\n- Write API docs (todo)\n- Deploy checklist (todo)\n- Client follow-up (todo)\n- Design review (blocked)\n\nStart with the login bug since it's already moving.",
  ) === false,
);
assert(
  'a genuine Done/Next update (short lines, but not degenerate-shaped) is NOT flagged',
  looksLikeGarbledBlackSwanOutput("Update:\n**Done:** shipped the fix\n**Next:** writing tests\nAnything I'm missing?") === false,
);
// Fixed via independent review fleet (2026-07-17): the line-shortness ratio
// alone false-positived on genuine short-line answers this app produces
// routinely — a 12-item numbered task list, a 10-step app walkthrough, a
// 10-person team roster. These ARE >=10 lines that are mostly short and
// unpunctuated, but each line carries real, distinguishing content (a
// name, a number), unlike the garbled evidence above which draws from a
// tiny, constantly-recombined vocabulary. Now also requires low lexical
// diversity among the words/numbers used across those short lines.
assert(
  'a genuine 12-item numbered task list is NOT flagged',
  looksLikeGarbledBlackSwanOutput('1. Task 1\n2. Task 2\n3. Task 3\n4. Task 4\n5. Task 5\n6. Task 6\n7. Task 7\n8. Task 8\n9. Task 9\n10. Task 10\n11. Task 11\n12. Task 12') === false,
);
assert(
  'a genuine 10-step app walkthrough is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    '1. Open the app\n2. Tap Feed\n3. Tap the + button\n4. Enter a title\n5. Pick a due date\n6. Assign to yourself\n7. Add a description\n8. Tap Save\n9. Confirm it appears\n10. Done',
  ) === false,
);
assert(
  'a genuine 10-person team roster (name - streak per line) is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    'Team roster:\nChris - 5 day streak\nDana - 3 day streak\nMarco - 8 day streak\nAna - 1 day streak\nBen - 12 day streak\nSam - 0 day streak\nJo - 6 day streak\nLee - 9 day streak\nMax - 2 day streak\nKai - 4 day streak',
  ) === false,
);

// Found via live direct-endpoint testing (2026-07-17, same session as the
// line-structure check above): a repeated short phrase ("can't create
// plan") embedded inside otherwise-varying, individually-punctuated lines
// — a third distinct loop shape neither the sentence-repeat nor the
// line-structure check catches.
const repeatedPhraseSalad = `You can't take other (can't create plan), but with 0/2 - can't create plan.
You can't check in, but with a plan - can't create plan.
You haven't checked in today - can't create plan.
You can't create the (can't create plan).
You can't create (can't create plan).
You love you (can't create plan).
You watch Chris (can't create plan).
You can't take (can't create plan).`;
assert('a repeated short phrase embedded in otherwise-varying punctuated lines is flagged', looksLikeGarbledBlackSwanOutput(repeatedPhraseSalad) === true);
assert(
  'a mid-sentence phrase repeated only 3 times (below the 4-occurrence floor) is NOT flagged',
  looksLikeGarbledBlackSwanOutput(
    "It's not a real issue, don't worry about it. He said it's not a real issue too. She agreed it's not a real issue.",
  ) === false,
);
assert(
  'a 4-item numbered list is NOT flagged',
  looksLikeGarbledBlackSwanOutput('1. Fix the login bug\n2. Fix the API docs typo\n3. Fix the deployment script\n4. Fix the test suite') === false,
);
assert(
  "a task referenced 3 times across one sentence is NOT flagged",
  looksLikeGarbledBlackSwanOutput("Please review this task, then review this task's dependencies, then review this task's PR before merging.") === false,
);
assert(
  'a genuine reply with 4 short "today"-ending sentences is NOT flagged',
  looksLikeGarbledBlackSwanOutput("🦢 Nice work! You checked in today. You finished your task today. You're on track today.") === false,
);
// An earlier version of this check excluded windows starting at a
// sentence's opening words, specifically so a templated/parallel answer
// (a reminders list or FAQ where every entry intentionally opens the same
// way) wouldn't trip it. A follow-up review found and verified that
// exclusion was a net-negative regression: it also stopped catching a
// short garbled sentence repeated verbatim ("I can't create plan." x4,
// every occurrence necessarily sentence-initial), a common real loop
// shape — and the exclusion's position bookkeeping could silently desync
// on any input containing period-bearing tokens (abbreviations, "e.g."),
// exempting phrases nowhere near a real sentence start. Reverted to plain
// count-only. Known, accepted trade-off (documented rather than silently
// left unverified): a genuine templated 4-item reminders/FAQ list can
// still trip this check — reliably catching real degenerate loops matters
// more here than avoiding this rarer false positive.
assert(
  'KNOWN TRADE-OFF: a genuine templated reminders list (4 entries sharing an opener) IS flagged',
  looksLikeGarbledBlackSwanOutput(
    'You should always check in with your team lead before deploying. You should always check in on the staging environment first. You should always check in with QA before merging. You should always check in on your calendar for conflicts.',
  ) === true,
);
assert(
  'a genuine short sentence repeated verbatim (sentence-initial each time) is flagged — the regression this reversion fixes',
  looksLikeGarbledBlackSwanOutput("I can't create plan. I can't create plan. I can't create plan. I can't create plan.") === true,
);

// ─── stripBlackSwanReasoningText ───────────────────────────────────────────
console.log('stripBlackSwanReasoningText');

// 2026-07-17: found while auditing the prepared production-shaped training
// data (which uses a <think>...</think> XML-tag reasoning format) against
// the live detector — a well-formed <think> block used to make the ENTIRE
// response, including a genuinely good answer written after the closing
// tag, get discarded and replaced with the generic fallback message, since
// nothing extracted the real answer first. If a future training cycle uses
// this data as-is, the model would likely learn to always wrap answers in
// <think> tags, which would then make close to every response hit this
// bug. Fixed by extracting content after a closed </think> tag before the
// garbling check runs, so a real answer underneath survives.
assert(
  'a well-formed <think> block followed by a real answer is salvaged, not discarded',
  stripBlackSwanReasoningText(
    '<think>\nHer streak is 0, so I should acknowledge that plainly.\n</think>\n🦢 Looks like your streak reset to 0 — happens to everyone. Want to jump back in today?',
  ) === '🦢 Looks like your streak reset to 0 — happens to everyone. Want to jump back in today?',
);
// Found via live direct-endpoint testing (2026-07-17, not just synthetic
// cases): the model's chat template evidently auto-opens the think block
// before generation starts, so the raw completion routinely begins
// mid-reasoning with NO literal opening <think> tag at all, and only the
// closing tag appears — a real, well-formed 2-task answer was being
// discarded purely because of this lone closing tag. The salvage logic
// must match on the closing tag alone, not require both tags.
assert(
  'a lone closing </think> tag with no opening tag is still salvaged (the model\'s template auto-opens it)',
  stripBlackSwanReasoningText(
    'Thinking about the user\'s request.\n\nSam is on a 5-day streak with 2 open tasks.\n</think>\n\n🦢 You have 2 tasks open:\n1. [in_progress] Fix login bug\n2. [todo] Write API docs',
  ) === '🦢 You have 2 tasks open:\n1. [in_progress] Fix login bug\n2. [todo] Write API docs',
);
assert(
  'an unclosed <think> tag (leaked mid-generation, no closing tag at all) is still treated as garbled',
  stripBlackSwanReasoningText('<think>\nHer streak is 0, so I should') === null ||
    stripBlackSwanReasoningText('<think>\nHer streak is 0, so I should')?.startsWith("I couldn't form a clear answer"),
);
// Fixed via independent review fleet (2026-07-17): an earlier version only
// matched the FIRST closing tag, so a SECOND <think>...</think> pair left
// in the "salvaged" remainder would re-trip the raw tag check and discard
// an otherwise-good final answer written after it.
{
  const multiBlock = stripBlackSwanReasoningText(
    '<think>\nfirst reasoning\n</think>\nmid text\n<think>\nsecond reasoning\n</think>\n🦋 Final real answer here, all good.',
  );
  assert(
    'a response with TWO well-formed <think> blocks is fully salvaged (no tags remain, final answer present)',
    typeof multiBlock === 'string' && !multiBlock.includes('<think>') && !multiBlock.includes('</think>') && multiBlock.includes('Final real answer'),
  );
}
// The closing-tag match is unanchored and matches the literal "</think>"
// substring wherever it occurs, including inside genuine prose that
// merely mentions/quotes the tag as a topic (e.g. explaining what leaked
// reasoning markup looks like) — a word-allowlist guard was tried to
// detect that case ("tag"/"marker"/...) and leave the text untouched
// instead of truncating it. A follow-up review found and verified that
// guard was an unwinnable whack-a-mole (any other ordinary noun after the
// mention, like "element"/"sequence", still slipped past it and got
// truncated) plus a related bug (only the LAST mention's guard result was
// applied, so an earlier properly-guarded mention didn't protect the text
// once a later, unguarded mention appeared). Removed the guard entirely.
// KNOWN, accepted trade-off (documented rather than silently left
// unverified): genuine prose that mentions the tag as a topic can get
// truncated into a mangled fragment shown to the user. This is an
// exceedingly rare scenario for this app's actual question domain (little
// reason for an accountability tool to discuss LLM reasoning-tag
// internals), while reliably salvaging a real answer after a lone closing
// tag (the case this step exists for) is a routine, observed-live shape.
assert(
  'KNOWN TRADE-OFF: genuine prose mentioning the </think> tag as a topic IS truncated (no guard — see comment above)',
  stripBlackSwanReasoningText(
    "Great question! In this app, a model's raw completion sometimes contains a stray </think> tag before the real answer — that's just leaked reasoning markup, not part of your task list.",
  ) === 'tag before the real answer — that\'s just leaked reasoning markup, not part of your task list.',
);
assert(
  'a closed <think> block with nothing written after it is still treated as garbled (no real answer to salvage)',
  stripBlackSwanReasoningText('<think>\nHer streak is 0.\n</think>')?.startsWith("I couldn't form a clear answer") === true,
);
assert(
  'a genuine reply with no think tags at all is returned unchanged',
  stripBlackSwanReasoningText('🦢 Nice, three days running — keep it up!') === '🦢 Nice, three days running — keep it up!',
);
assert(
  'the salvaged post-think answer is still checked for garbling (a repetition loop after the think block still falls back)',
  stripBlackSwanReasoningText(`<think>reasoning</think>\n${'loop now'.repeat(10)}`)?.startsWith("I couldn't form a clear answer") === true,
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
