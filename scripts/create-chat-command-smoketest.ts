/**
 * create-chat-command-smoketest — guards the `/create <anything>` friendly
 * entry point (src/lib/createChatCommand.ts):
 *
 *  1. Parse grammar: whole-token `/create` (+ `/make` alias) only —
 *     `/created x` falls through (null); bare `/create` is the menu case;
 *     oversized briefs fail closed with a friendly error.
 *  2. Every intent class classifies from 2 realistic novice phrasings, and
 *     precedence holds (wordpress/spreadsheet/presentation beat document).
 *  3. Directives rewrite into the EXISTING lanes (`/build-page`, `/imagine`,
 *     natural wordpress draft, `/task new`, `/watch`, `/automation`, coding /
 *     document / CSV-artifact chat lanes), pass unclassified briefs through
 *     verbatim, and answer honestly (menu, presentations never pretend).
 *  4. Every directive note is non-empty and ≤120 chars; the formatted
 *     routing note is one bounded, newline-free line.
 *
 * Pure module — no supabase, no react-native, no injected deps needed.
 *
 * Run: npx tsx scripts/create-chat-command-smoketest.ts
 */

import {
  MAX_CREATE_BRIEF_LENGTH,
  MAX_CREATE_NOTE_LENGTH,
  buildCreateDirective,
  classifyCreateIntent,
  formatCreateRoutingNote,
  parseCreateCommand,
  type CreateIntentClass,
} from '../src/lib/createChatCommand';

let failures = 0;
let passes = 0;
function pass(message: string): void {
  passes += 1;
  console.log('pass:', message);
}
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    message,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function main(): void {
  // ─── (a) parse grammar ────────────────────────────────────────────────────
  assertEqual(parseCreateCommand('/created x'), null, '(a) "/created x" is not our token — null fall-through');
  assertEqual(parseCreateCommand('/maker a logo'), null, '(a) "/maker …" falls through');
  assertEqual(parseCreateCommand('just chatting about /create'), null, '(a) non-command text falls through');
  assertEqual(parseCreateCommand(''), null, '(a) empty input falls through');

  {
    const parsed = parseCreateCommand('/create');
    assert(parsed?.ok === true && parsed.brief === '', '(a) bare /create → ok with empty brief (menu case)');
  }
  {
    const parsed = parseCreateCommand('  /create   ');
    assert(parsed?.ok === true && parsed.brief === '', '(a) whitespace-padded bare /create still the menu case');
  }
  {
    const parsed = parseCreateCommand('/make a logo for my podcast');
    assert(parsed?.ok === true, '(a) /make alias accepted');
    if (parsed?.ok) assertEqual(parsed.brief, 'a logo for my podcast', '(a) /make brief extracted');
  }
  {
    const parsed = parseCreateCommand('/CREATE a landing page for my bakery');
    assert(parsed?.ok === true, '(a) /CREATE is case-insensitive');
  }
  {
    const parsed = parseCreateCommand(`/create ${'x'.repeat(MAX_CREATE_BRIEF_LENGTH + 1)}`);
    assert(parsed !== null && parsed.ok === false, '(a) oversized brief fails closed');
    if (parsed && parsed.ok === false) {
      assert(/too long/i.test(parsed.error), '(a) oversized-brief error says why', parsed.error);
    }
  }

  // ─── (b) every intent class from 2 realistic novice phrasings ────────────
  const classifyCases: Array<[string, CreateIntentClass]> = [
    ['create a landing page for my bakery', 'webpage'],
    ['create a website for my portfolio', 'webpage'],
    ['create a logo for my podcast', 'image'],
    ['create a picture of a sunset over the lake', 'image'],
    ['create a python script that renames files', 'code'],
    ['create a function that adds two numbers', 'code'],
    ['create a resume for a nurse', 'document'],
    ['create a cover letter for a barista job', 'document'],
    ['create a spreadsheet of my monthly bills', 'spreadsheet'],
    ['create a table of our team contacts', 'spreadsheet'],
    ['create a blog post on my wordpress site about spring', 'wordpress_post'],
    ['create a wp post about our summer sale', 'wordpress_post'],
    ['create a task for Dana to call the vendor', 'task'],
    ['create a todo to renew the domain', 'task'],
    ['create a mockup of the new dashboard', 'design'],
    ['create a poster in photoshop for the launch party', 'design'],
    ['create a slide deck about our Q3 goals', 'presentation'],
    ['create a powerpoint about onboarding', 'presentation'],
    ['create a daily watch on the weather', 'watch'],
    ['create a recurring check on competitor pricing', 'watch'],
    ['create an automation that posts a summary every friday', 'automation'],
    ['whenever a new lead comes in then email me', 'automation'],
  ];
  for (const [brief, expected] of classifyCases) {
    assertEqual(classifyCreateIntent(brief), expected, `(b) "${brief}" → ${expected}`);
  }
  assertEqual(classifyCreateIntent('create something nice for mom'), null, '(b) no keyword match → null (planner decides)');
  assertEqual(classifyCreateIntent(''), null, '(b) empty brief classifies as null');

  // ─── (c) precedence — most specific class wins ────────────────────────────
  assertEqual(classifyCreateIntent('create an article on my wordpress site'), 'wordpress_post', '(c) wordpress beats document');
  assertEqual(classifyCreateIntent('create a spreadsheet report of expenses'), 'spreadsheet', '(c) spreadsheet beats document');
  assertEqual(classifyCreateIntent('create a slide deck report for the board'), 'presentation', '(c) presentation beats document');

  // ─── (d) directives rewrite into the existing lanes ───────────────────────
  {
    const d = buildCreateDirective('a landing page for my bakery');
    assertEqual(d.intent, 'webpage', '(d) webpage directive intent');
    assert(d.action.kind === 'resend_as' && d.action.message === '/build-page a landing page for my bakery',
      '(d) webpage → resend_as "/build-page <brief>"');
  }
  {
    const d = buildCreateDirective('a logo for my podcast');
    assert(d.action.kind === 'resend_as' && d.action.message === '/imagine a logo for my podcast',
      '(d) image → resend_as "/imagine <brief>"');
  }
  {
    const d = buildCreateDirective('a blog post on my wordpress site about spring');
    assertEqual(d.intent, 'wordpress_post', '(d) wordpress directive intent');
    assert(d.action.kind === 'resend_as'
      && d.action.message === 'draft a wordpress post: a blog post on my wordpress site about spring',
      '(d) wordpress → natural "draft a wordpress post: …" resend');
    if (d.action.kind === 'resend_as') {
      // Shape the planner's conversational WordPress intent catches: a
      // draft/write/post verb followed by a wordpress/site mention.
      assert(/\b(draft|write|post)\b[\s\S]*\bwordpress\b/i.test(d.action.message),
        '(d) wordpress resend matches the planner intent shape (draft … wordpress)');
    }
  }
  {
    const d = buildCreateDirective('a task for Dana to call the vendor');
    assert(d.action.kind === 'resend_as' && d.action.message === '/task new Dana to call the vendor',
      '(d) task → "/task new" with create-words stripped',
      d.action.kind === 'resend_as' ? d.action.message : d.action.kind);
  }
  {
    const d = buildCreateDirective('a daily watch on the weather');
    assert(d.action.kind === 'resend_as' && d.action.message === '/watch daily a daily watch on the weather',
      '(d) watch → "/watch daily <brief>"');
    assert(/cadence/i.test(d.note), '(d) watch note says the cadence is editable', d.note);
  }
  {
    const d = buildCreateDirective('an hourly check on the login page');
    assertEqual(d.intent, 'watch', '(d) hourly phrasing still classifies as watch');
    assert(d.action.kind === 'resend_as' && d.action.message.startsWith('/watch hourly '),
      '(d) hourly wording sniffed into "/watch hourly …"');
  }
  {
    const d = buildCreateDirective('an automation that posts a summary every friday');
    assert(d.action.kind === 'resend_as' && d.action.message === '/automation an automation that posts a summary every friday',
      '(d) automation → resend_as "/automation <brief>"');
  }
  {
    const d = buildCreateDirective('a python script that renames files');
    assert(d.action.kind === 'resend_as' && d.action.message === 'Write the code: a python script that renames files',
      '(d) code → "Write the code: <brief>" plain-chat coding lane');
  }
  {
    const brief = 'a poster in photoshop for the launch party';
    const d = buildCreateDirective(brief);
    assertEqual(d.intent, 'design', '(d) design directive intent');
    assert(d.action.kind === 'resend_as' && d.action.message === brief,
      '(d) design → brief passed verbatim to the agent design pipeline');
    assert(/approval/i.test(d.note), '(d) design note mentions approvals', d.note);
  }
  {
    const d = buildCreateDirective('a resume for a nurse');
    assert(d.action.kind === 'resend_as'
      && d.action.message === 'Write the full resume as a markdown code block I can download: a resume for a nurse',
      '(d) document → docType-aware markdown-artifact resend');
    if (d.action.kind === 'resend_as') {
      assert(d.action.message.includes('markdown code block'), '(d) document resend requests a downloadable code block');
    }
  }
  {
    const d = buildCreateDirective('a spreadsheet of my monthly bills');
    assert(d.action.kind === 'resend_as', '(d) spreadsheet is a resend directive');
    if (d.action.kind === 'resend_as') {
      assert(d.action.message.includes('csv code block'), '(d) spreadsheet directive message contains "csv code block"');
      assert(d.action.message.includes('Return ONLY'), '(d) spreadsheet directive demands only the csv block');
      assert(d.action.message.endsWith('a spreadsheet of my monthly bills'), '(d) spreadsheet directive carries the brief');
    }
    assert(/artifact card|downloadable|file/i.test(d.note), '(d) spreadsheet note explains the downloadable file', d.note);
  }
  {
    // P14: presentations now ship as HTML slide decks via the live builder.
    const d = buildCreateDirective('a slide deck about our Q3 goals');
    assertEqual(d.intent, 'presentation', '(d) presentation directive intent');
    assertEqual(d.action.kind, 'resend_as', '(d) presentation routes to the deck builder');
    if (d.action.kind === 'resend_as') {
      assert(d.action.message.startsWith('/build-page '), '(d) presentation rides /build-page');
      assert(/slide/i.test(d.action.message) && /print/i.test(d.action.message),
        '(d) deck brief demands slides + print-to-PDF stylesheet');
      assert(d.action.message.includes('a slide deck about our Q3 goals'), '(d) deck brief carries the user brief');
    }
    assert(/pptx not supported/i.test(d.note), '(d) note stays honest about .pptx');
  }
  {
    const d = buildCreateDirective('');
    assertEqual(d.intent, null, '(d) menu directive has no intent class');
    assertEqual(d.action.kind, 'reply', '(d) bare brief → menu reply');
    if (d.action.kind === 'reply') {
      const bullets = d.action.message.match(/• \*\*/g) || [];
      assert(bullets.length >= 8, `(d) menu lists ≥8 creatable things (got ${bullets.length})`);
      for (const label of ['Webpage', 'Image', 'Code', 'Document', 'Spreadsheet', 'WordPress post', 'Task', 'Recurring watch', 'Automation']) {
        assert(d.action.message.includes(`**${label}**`), `(d) menu lists ${label}`);
      }
      assert(d.action.message.includes('/create'), '(d) menu says to just describe it after /create');
      assert(/one example|\/create a /.test(d.action.message), '(d) menu shows an example per lane');
    }
  }
  {
    const brief = 'something nice for mom';
    const d = buildCreateDirective(brief);
    assertEqual(d.intent, null, '(d) unclassified directive has no intent class');
    assert(d.action.kind === 'resend_as' && d.action.message === brief, '(d) unclassified passes the brief through verbatim');
    assertEqual(d.note, 'letting the planner decide', '(d) unclassified note is the planner-decides line');
  }

  // ─── (e) every directive note bounded; routing line is one bounded line ──
  const representativeBriefs: Array<[string, CreateIntentClass | null]> = [
    ['a landing page for my bakery', 'webpage'],
    ['a logo for my podcast', 'image'],
    ['a python script that renames files', 'code'],
    ['a resume for a nurse', 'document'],
    ['a spreadsheet of my monthly bills', 'spreadsheet'],
    ['a blog post on my wordpress site about spring', 'wordpress_post'],
    ['a task for Dana to call the vendor', 'task'],
    ['a slide deck about our Q3 goals', 'presentation'],
    ['a daily watch on the weather', 'watch'],
    ['a mockup of the new dashboard', 'design'],
    ['an automation that posts a summary every friday', 'automation'],
    ['something nice for mom', null],
    ['', null], // menu
  ];
  for (const [brief, expectedIntent] of representativeBriefs) {
    const label = brief === '' ? '<menu>' : brief;
    const d = buildCreateDirective(brief);
    assertEqual(d.intent, expectedIntent, `(e) "${label}" directive intent`);
    assert(d.note.trim().length > 0, `(e) "${label}" note is non-empty`);
    assert(d.note.length <= MAX_CREATE_NOTE_LENGTH,
      `(e) "${label}" note ≤${MAX_CREATE_NOTE_LENGTH} chars`, `${d.note.length} chars`);
    const line = formatCreateRoutingNote(d);
    assert(line.startsWith('🪄 Creating via '), `(e) "${label}" routing line has the 🪄 Creating via prefix`, line);
    assert(!line.includes('\n'), `(e) "${label}" routing line is a single line`);
    assert(line.length <= 160, `(e) "${label}" routing line is bounded`, `${line.length} chars`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll create-chat-command smoke cases passed (${passes} passed).`);
}

main();
