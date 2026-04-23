/**
 * context-file-priority-smoketest — CA-8h. Pins the priority order
 * for project context files so a regression can't silently change
 * which file the agent auto-loads.
 *
 * The smoke mirrors the logic in `src/lib/openswanContextDiscovery.ts`
 * — importing directly would pull react-native through the Platform
 * check, so we re-declare the list + resolver as testable units.
 *
 * Run: npm run smoke:context-file-priority
 */

// MUST match CONTEXT_FILE_PRIORITY in src/lib/openswanContextDiscovery.ts
const CONTEXT_FILE_PRIORITY = [
  '.openswan.md',
  'AGENTS.md',
  'AGENT.md',
  'CLAUDE.md',
  '.cursorrules',
  '.hermes.md',
  'HERMES.md',
] as const;

function resolveContextFilePriority(available: readonly string[]): string | null {
  const set = new Set(available);
  for (const name of CONTEXT_FILE_PRIORITY) {
    if (set.has(name)) return name;
  }
  return null;
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Exact order ──────────────────────────────────────────────────
  // .openswan.md is UC's first-priority override; AGENTS.md is the
  // canonical team plan file; CLAUDE.md matches Claude Code's convention;
  // .cursorrules is Cursor; Hermes names are at the back so existing
  // projects still resolve.
  assert(CONTEXT_FILE_PRIORITY[0] === '.openswan.md', 'order: .openswan.md is first');
  assert(CONTEXT_FILE_PRIORITY[1] === 'AGENTS.md', 'order: AGENTS.md is second');
  assert(CONTEXT_FILE_PRIORITY[2] === 'AGENT.md', 'order: AGENT.md is third (singular)');
  assert(CONTEXT_FILE_PRIORITY[3] === 'CLAUDE.md', 'order: CLAUDE.md is fourth');
  assert(CONTEXT_FILE_PRIORITY[4] === '.cursorrules', 'order: .cursorrules is fifth');
  assert(CONTEXT_FILE_PRIORITY[5] === '.hermes.md', 'order: Hermes legacy at position 6');
  assert(CONTEXT_FILE_PRIORITY[6] === 'HERMES.md', 'order: HERMES.md at position 7');

  // ─── Resolver: first match wins ──────────────────────────────────
  assert(resolveContextFilePriority(['.openswan.md', 'AGENTS.md', 'CLAUDE.md']) === '.openswan.md',
    'resolve: .openswan.md wins over AGENTS.md + CLAUDE.md');
  assert(resolveContextFilePriority(['AGENTS.md', 'CLAUDE.md']) === 'AGENTS.md',
    'resolve: AGENTS.md wins over CLAUDE.md (no .openswan.md present)');
  assert(resolveContextFilePriority(['CLAUDE.md', '.cursorrules']) === 'CLAUDE.md',
    'resolve: CLAUDE.md wins over .cursorrules');
  assert(resolveContextFilePriority(['.cursorrules']) === '.cursorrules',
    'resolve: .cursorrules when alone');
  assert(resolveContextFilePriority(['.hermes.md']) === '.hermes.md',
    'resolve: .hermes.md still resolves when alone (legacy support)');
  assert(resolveContextFilePriority(['HERMES.md', '.hermes.md']) === '.hermes.md',
    'resolve: .hermes.md (dot-prefix) beats HERMES.md');
  assert(resolveContextFilePriority(['AGENT.md']) === 'AGENT.md',
    'resolve: AGENT.md (singular) resolves when plural absent');
  assert(resolveContextFilePriority(['AGENT.md', 'AGENTS.md']) === 'AGENTS.md',
    'resolve: AGENTS.md (plural) beats AGENT.md');

  // ─── Miss cases ───────────────────────────────────────────────────
  assert(resolveContextFilePriority([]) === null, 'resolve: empty list → null');
  assert(resolveContextFilePriority(['README.md', 'package.json']) === null,
    'resolve: non-context files → null');
  assert(resolveContextFilePriority(['agents.md']) === null,
    'resolve: wrong case (lowercase) → null (filenames are case-sensitive)');

  // ─── Coverage: every priority entry resolves when it's the only one
  for (const name of CONTEXT_FILE_PRIORITY) {
    assert(resolveContextFilePriority([name]) === name, `resolve: ${name} resolves when alone`);
  }

  // ─── Ordering invariant: unrelated entries don't shift result ────
  assert(
    resolveContextFilePriority(['random.md', '.openswan.md', 'foo.md']) === '.openswan.md',
    'resolve: unrelated entries ignored',
  );
  assert(
    resolveContextFilePriority(['.DS_Store', '.gitignore', 'AGENTS.md', 'CLAUDE.md']) === 'AGENTS.md',
    'resolve: dotfiles ignored, AGENTS wins',
  );

  if (failures > 0) {
    console.error(`\n${failures} context-file-priority smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll context-file-priority smoke cases passed.');
}

main();
