/**
 * skill-portability-heuristic-smoketest — verifies the pure classifier in
 * `src/lib/skillPortabilityHeuristic.ts`.
 *
 * Run: npm run smoke:skill-portability-heuristic
 *
 * Cases:
 *   1. no platform/risk keywords → generic + instruction-only
 *   2. platform name mentions → codex / claude / cursor detected
 *   3. path-style mentions (.claude/, .codex/, .cursor/) also detected
 *   4. risk severity ordering: credentials > external-writes > scripts
 *   5. risk keywords matched only in tags still counted
 *   6. multiple platforms mentioned → all captured, label picks first
 */

import { classifySkillPortability, PORTABILITY_LABELS, RISK_LABELS } from '../src/lib/skillPortabilityHeuristic';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // 1. Nothing matches → generic + instruction-only
  {
    const c = classifySkillPortability({ name: 'summarize_thread', description: 'Summarize a long chat thread into bullet points.', tags: ['chat', 'summary'] });
    assert(c.platforms.length === 0, 'no signal: platforms empty');
    assert(c.portabilityLabel === 'generic', 'no signal: label generic');
    assert(c.risk === 'instruction-only', 'no signal: risk instruction-only', c.risk);
    assert(c.riskMatchedKeywords.length === 0, 'no signal: no risk keywords');
  }

  // 2. Platform name mentions
  {
    const codex = classifySkillPortability({ name: 'codex_patch_helper', description: 'Uses apply_patch conventions from Codex CLI.', tags: [] });
    assert(codex.platforms.includes('codex'), 'codex: name mention detected');
    assert(codex.portabilityLabel === 'codex', 'codex: label picked');

    const claude = classifySkillPortability({ name: 'claude_code_review', description: 'A Claude Code skill for PR review.', tags: [] });
    assert(claude.platforms.includes('claude'), 'claude: description mention detected');

    const cursor = classifySkillPortability({ name: 'cursor_rules_sync', description: 'Keeps .cursorrules in sync.', tags: [] });
    assert(cursor.platforms.includes('cursor'), 'cursor: cursorrules mention detected');
  }

  // 3. Path-style mentions
  {
    const c = classifySkillPortability({ name: 'importer', description: 'Imports skills from .claude/skills into the circle library.', tags: [] });
    assert(c.platforms.includes('claude'), 'path: .claude/ path detected');
  }

  // 4. Risk severity ordering
  {
    const creds = classifySkillPortability({ name: 'login_flow', description: 'Reads the stored API key and logs into the vendor portal.', tags: [] });
    assert(creds.risk === 'credentials', 'risk: credentials wins over other mentions', creds.risk);

    const writes = classifySkillPortability({ name: 'pr_opener', description: 'Commits changes and opens a pull request.', tags: [] });
    assert(writes.risk === 'external-writes', 'risk: external-writes detected', writes.risk);

    const scripts = classifySkillPortability({ name: 'shell_runner', description: 'Runs a shell command to rebuild the project.', tags: [] });
    assert(scripts.risk === 'scripts', 'risk: scripts detected', scripts.risk);

    // Both credential and script keywords present — credentials must win (higher severity).
    const both = classifySkillPortability({ name: 'combo', description: 'Runs a shell command and reads the API key from vault.', tags: [] });
    assert(both.risk === 'credentials', 'risk: credentials outranks scripts when both present', both.risk);
  }

  // 5. Risk keyword matched only via tags
  {
    const c = classifySkillPortability({ name: 'deploy_it', description: 'General purpose helper.', tags: ['deploy', 'internal'] });
    assert(c.risk === 'external-writes', 'risk: tag-only match counted', c.risk);
  }

  // 6. Multiple platforms mentioned
  {
    const c = classifySkillPortability({ name: 'cross_platform_import', description: 'Imports the same skill for Claude, Codex, and Cursor.', tags: [] });
    assert(c.platforms.length === 3, 'multi: all three platforms captured', `got ${c.platforms.join(',')}`);
  }

  // Label maps have an entry for every possible value (defensive UI contract).
  {
    assert(PORTABILITY_LABELS.generic === 'GENERIC', 'labels: generic label present');
    assert(PORTABILITY_LABELS.codex && PORTABILITY_LABELS.claude && PORTABILITY_LABELS.cursor, 'labels: all platform labels present');
    assert(
      RISK_LABELS['instruction-only'] && RISK_LABELS.scripts && RISK_LABELS.credentials && RISK_LABELS['external-writes'],
      'labels: all risk labels present',
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} skill-portability-heuristic smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll skill-portability-heuristic smoke cases passed.');
}

main();
