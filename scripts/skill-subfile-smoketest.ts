/**
 * skill-subfile-smoketest — CA-8i. Pins the safe-relpath validator
 * and (inlined) MIME inference used by the write_file / remove_file
 * actions of the `skills.manage` catalog tool. Real end-to-end
 * apply is exercised manually against a live circle since it needs
 * Supabase RLS + an actual approval row.
 *
 * Run: npm run smoke:skill-subfile
 */

// Can't import directly from src/lib/openswanToolRuntime (home of
// `skills.manage` since the O2 agentTools-registry retirement) — that
// module drags in the supabase client at load time. Mirror the pure
// helpers (`isSafeSkillRelpath` / `inferSkillFileMimeType`) here; the
// shape MUST stay in lockstep.
function isSafeSkillRelpath(raw: string | undefined): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return false;
  if (raw.startsWith('/') || raw.startsWith('\\')) return false;
  if (raw.includes('..')) return false;
  if (raw.includes('\0')) return false;
  if (!/[a-zA-Z0-9]/.test(raw)) return false;
  if (/^[a-zA-Z]:/.test(raw)) return false;
  return true;
}

function inferMimeType(relpath: string): string {
  const lower = relpath.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'application/yaml';
  if (lower.endsWith('.sh')) return 'text/x-shellscript';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'application/typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'application/javascript';
  return 'text/plain';
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Safe relpaths ──────────────────────────────────────────────
  const safe = [
    'references/api.md',
    'templates/pr.md',
    'scripts/run.sh',
    'dist/bundle.js',
    'nested/deep/path/to/file.md',
    'single-file.md',
    'a.md',
    'readme.txt',
    'data.json',
    'config.yaml',
  ];
  for (const p of safe) assert(isSafeSkillRelpath(p), `safe: "${p}" accepted`);

  // ─── Unsafe relpaths ────────────────────────────────────────────
  // Leading slashes — absolute paths would escape the skill folder
  assert(!isSafeSkillRelpath('/etc/passwd'), 'unsafe: leading / rejected');
  assert(!isSafeSkillRelpath('\\Windows\\System32'), 'unsafe: leading \\ rejected');
  assert(!isSafeSkillRelpath('/references/api.md'), 'unsafe: leading / on normal path rejected');

  // Parent-dir traversal
  assert(!isSafeSkillRelpath('../sibling.md'), 'unsafe: .. at start rejected');
  assert(!isSafeSkillRelpath('references/../../etc/passwd'), 'unsafe: .. segment rejected');
  assert(!isSafeSkillRelpath('references/a..b.md'), 'unsafe: even embedded .. rejected (conservative)');

  // Null bytes (historic C-string termination attack)
  assert(!isSafeSkillRelpath('references/api\0.md'), 'unsafe: null byte rejected');

  // Windows drive prefix
  assert(!isSafeSkillRelpath('C:/Users/foo/skill.md'), 'unsafe: Windows drive prefix rejected');
  assert(!isSafeSkillRelpath('c:foo.md'), 'unsafe: lowercase Windows drive rejected');

  // Empty / whitespace / non-alphanumeric-only
  assert(!isSafeSkillRelpath(''), 'unsafe: empty rejected');
  assert(!isSafeSkillRelpath(undefined), 'unsafe: undefined rejected');
  assert(!isSafeSkillRelpath('   '), 'unsafe: whitespace rejected (no alphanumeric)');
  assert(!isSafeSkillRelpath('---'), 'unsafe: dashes only rejected (no alphanumeric)');

  // Length cap
  assert(!isSafeSkillRelpath('a' + '/'.repeat(201)), 'unsafe: 202 chars rejected');
  assert(isSafeSkillRelpath('a' + '/'.repeat(198) + 'b'), 'safe: exactly 200 chars accepted');

  // Wrong type
  assert(!isSafeSkillRelpath(42 as any), 'unsafe: non-string rejected');
  assert(!isSafeSkillRelpath(null as any), 'unsafe: null rejected');

  // ─── MIME inference ─────────────────────────────────────────────
  assert(inferMimeType('refs/api.md') === 'text/markdown', 'mime: .md');
  assert(inferMimeType('refs/CONFIG.MD') === 'text/markdown', 'mime: .MD case-insensitive');
  assert(inferMimeType('data/payload.json') === 'application/json', 'mime: .json');
  assert(inferMimeType('ci/pipeline.yml') === 'application/yaml', 'mime: .yml');
  assert(inferMimeType('ci/pipeline.yaml') === 'application/yaml', 'mime: .yaml');
  assert(inferMimeType('scripts/deploy.sh') === 'text/x-shellscript', 'mime: .sh');
  assert(inferMimeType('src/index.ts') === 'application/typescript', 'mime: .ts');
  assert(inferMimeType('src/App.tsx') === 'application/typescript', 'mime: .tsx');
  assert(inferMimeType('dist/bundle.js') === 'application/javascript', 'mime: .js');
  assert(inferMimeType('dist/App.jsx') === 'application/javascript', 'mime: .jsx');
  assert(inferMimeType('notes.txt') === 'text/plain', 'mime: .txt → text/plain');
  assert(inferMimeType('LICENSE') === 'text/plain', 'mime: no extension → text/plain');
  assert(inferMimeType('archive.tar.gz') === 'text/plain', 'mime: unknown ext → text/plain');

  if (failures > 0) {
    console.error(`\n${failures} skill-subfile smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll skill-subfile smoke cases passed.');
}

main();
