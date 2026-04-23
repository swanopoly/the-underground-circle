/**
 * skill-relpath-smoketest — tests the pure relpath validator in
 * `src/lib/skillRelPath.ts`. Guards against path traversal, absolute
 * paths, control chars, and typical Windows pitfalls. The DB-side
 * `viewLibrarySkillFile` / `listLibrarySkillFiles` helpers are
 * integration-tested separately.
 *
 * Run: npm run smoke:skill-relpath
 */

import {
  parseSkillRelPath,
  isSafeSkillRelPath,
} from '../src/lib/skillRelPath';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Accepts ───────────────────────────────────────────────────────────────
const shouldAccept: Array<[string, string]> = [
  ['references/api.md',            'references/api.md'],
  ['templates/pr.md',               'templates/pr.md'],
  ['scripts/run.sh',                'scripts/run.sh'],
  ['SKILL.md',                      'SKILL.md'],
  ['nested/deep/path/file.md',      'nested/deep/path/file.md'],
  ['./references/api.md',           'references/api.md'],
  ['references//double.md',         'references/double.md'],
  ['references\\api.md',            'references/api.md'],
  ['  references/api.md  ',         'references/api.md'],
];

for (const [raw, expected] of shouldAccept) {
  const result = parseSkillRelPath(raw);
  if (result.ok) {
    assert(result.relpath === expected, `accepts: ${JSON.stringify(raw)} → ${expected}`, `got ${result.relpath}`);
  } else {
    fail(`accepts: ${JSON.stringify(raw)} → expected ok, got error "${result.error}"`);
  }
}

// ─── Rejects ───────────────────────────────────────────────────────────────
const shouldReject: string[] = [
  '',
  '   ',
  '/absolute/path.md',
  'C:/windows/path.md',
  'c:\\windows\\path.md',
  '\\server\\share\\file.md',
  '../escape.md',
  'references/../etc/passwd',
  'references/..',
  '..',
  'references/',                     // directory, not a file
  '.hidden/file.md',                 // dotfile segment
  'references/\x00nul.md',           // control char
  'references/\ttab.md',             // tab
  'x'.repeat(201),                   // length cap
];

for (const raw of shouldReject) {
  const result = parseSkillRelPath(raw);
  assert(!result.ok, `rejects: ${JSON.stringify(raw)}`);
}

// ─── isSafeSkillRelPath alias ──────────────────────────────────────────────
assert(isSafeSkillRelPath('references/api.md') === true, 'alias: accepts safe path');
assert(isSafeSkillRelPath('../escape') === false, 'alias: rejects traversal');

// ─── Non-string input ──────────────────────────────────────────────────────
{
  const r = parseSkillRelPath(null as any);
  assert(!r.ok, 'null input rejected');
}
{
  const r = parseSkillRelPath(42 as any);
  assert(!r.ok, 'number input rejected');
}

if (failures > 0) {
  console.error(`\n${failures} skill-relpath smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll skill-relpath smoke cases passed.');
