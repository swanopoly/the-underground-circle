/**
 * wp-command-risk-smoketest — offline guard for the /wp live-mutation confirm
 * gate: classification, confirm-token detection, arg stripping, and prompt.
 *
 * Run: npm run smoke:wp-command-risk
 */

import {
  classifyWpCommandRisk,
  classifyWpListTarget,
  inferWpListTargetFromText,
  inferWpPostListStatusFromText,
  buildWpConfirmPrompt,
} from '../src/lib/wordpressCommandRisk';

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Mutating classification ───────────────────────────────────────────────
{
  const r = classifyWpCommandRisk('publish 42');
  assert(r.action === 'publish', 'publish: action');
  assert(r.mutating, 'publish: mutating');
  assert(r.targetId === 42, 'publish: targetId parsed', String(r.targetId));
  assert(!r.hasConfirmToken, 'publish: no token by default');
}
{
  const r = classifyWpCommandRisk('publish 42 confirm');
  assert(r.hasConfirmToken, 'publish confirm: token detected');
  assert(r.argsWithoutToken === '42', 'publish confirm: token stripped', r.argsWithoutToken);
  assert(r.targetId === 42, 'publish confirm: targetId still parsed');
}
{
  const r = classifyWpCommandRisk('delete 7');
  assert(r.action === 'delete' && r.mutating && r.targetId === 7, 'delete: classified');
  assert(!r.hasConfirmToken, 'delete: no token');
}
{
  const r = classifyWpCommandRisk('trash 9 CONFIRM');
  assert(r.action === 'delete', 'trash: maps to delete action');
  assert(r.hasConfirmToken, 'trash: case-insensitive token');
  assert(r.argsWithoutToken === '9', 'trash: token stripped', r.argsWithoutToken);
}
{
  const r = classifyWpCommandRisk('schedule 2026-07-01 My Title');
  assert(r.action === 'schedule' && r.mutating, 'schedule: classified mutating');
  assert(r.targetId === undefined, 'schedule: no targetId');
  assert(!r.hasConfirmToken, 'schedule: no token');
}
{
  const r = classifyWpCommandRisk('schedule 2026-07-01 My Title confirm');
  assert(r.hasConfirmToken, 'schedule confirm: token detected');
  assert(r.argsWithoutToken === '2026-07-01 My Title', 'schedule confirm: token stripped, title preserved', r.argsWithoutToken);
}

// ── Non-mutating commands ─────────────────────────────────────────────────
for (const c of ['list', 'list drafts', 'get 5', 'status', 'pages', 'tags']) {
  const r = classifyWpCommandRisk(c);
  assert(r.action === 'other' && !r.mutating, `non-mutating: "${c}"`, JSON.stringify(r));
}

// ── Read-only list target routing ─────────────────────────────────────────
{
  const cases: Array<[string, ReturnType<typeof classifyWpListTarget>]> = [
    ['list', 'posts'],
    ['posts', 'posts'],
    ['list drafts', 'posts'],
    ['pages', 'pages'],
    ['list pages', 'pages'],
    ['categories', 'categories'],
    ['list categories', 'categories'],
    ['cats', 'categories'],
    ['tags', 'tags'],
    ['list tags', 'tags'],
    ['get 42', null],
  ];
  for (const [input, expected] of cases) {
    assert(classifyWpListTarget(input) === expected, `list target: ${input} -> ${expected || 'none'}`, String(classifyWpListTarget(input)));
  }
}

{
  const cases: Array<[string, ReturnType<typeof inferWpListTargetFromText>]> = [
    ['Show my WordPress posts', 'posts'],
    ['List pages in WordPress', 'pages'],
    ['Show categories on WP', 'categories'],
    ['List tags in the CMS', 'tags'],
  ];
  for (const [input, expected] of cases) {
    assert(inferWpListTargetFromText(input) === expected, `text list target: ${input} -> ${expected}`, String(inferWpListTargetFromText(input)));
  }
  assert(inferWpPostListStatusFromText('Show WordPress drafts') === 'draft', 'text list status: drafts -> draft');
  assert(inferWpPostListStatusFromText('List pending posts in WordPress') === 'pending', 'text list status: pending -> pending');
  assert(inferWpPostListStatusFromText('List all WordPress posts') === 'any', 'text list status: all -> any');
}

// A word merely containing "confirm" in a non-trailing spot must not trip it.
{
  const r = classifyWpCommandRisk('schedule 2026-07-01 confirm your booking');
  assert(!r.hasConfirmToken, 'schedule: mid-string "confirm" is not the token', JSON.stringify(r));
  assert(r.argsWithoutToken === '2026-07-01 confirm your booking', 'schedule: mid-string confirm kept in args', r.argsWithoutToken);
}

// ── Prompt builder ────────────────────────────────────────────────────────
{
  const p = buildWpConfirmPrompt('publish', 42, 'Launch Day');
  assert(p.includes('/wp publish 42 confirm'), 'prompt: publish re-issue line', p);
  assert(p.includes('Launch Day'), 'prompt: includes resolved title', p);
  assert(/live/i.test(p), 'prompt: publish mentions live', p);

  const d = buildWpConfirmPrompt('delete', 7);
  assert(d.includes('/wp delete 7 confirm'), 'prompt: delete re-issue line', d);
  assert(/trash/i.test(d), 'prompt: delete mentions trash', d);

  const s = buildWpConfirmPrompt('schedule');
  assert(s.includes('confirm'), 'prompt: schedule mentions confirm', s);
}

if (failures > 0) {
  console.error(`\n${failures} wp-command-risk smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wp-command-risk smoke cases passed.');
