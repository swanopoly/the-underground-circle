/**
 * canonical-skills-smoketest
 *
 * Validates every canonical skill under skills/<name>/SKILL.md so they stay
 * loadable by the live library and keep the agentskills.io shape + pipeline
 * discipline. Each is parsed with the real `parseSkillFrontmatter`, checked for
 * required sections, real tool references, per-skill content probes, and the
 * absence of local-path / secret leaks.
 *
 * Run: npm run smoke:canonical-skills
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSkillFrontmatter } from '../src/lib/skillFrontmatter';
import { CANONICAL_SKILLS } from '../src/lib/canonicalSkills.generated';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(repoRoot, 'skills');

// Per-skill required content probes — each skill must exercise its surface.
const PROBES: Record<string, RegExp[]> = {
  'app-task-automation': [
    /find-ladder|find the target/i,
    /agent\.build_app_capability/,
    /desktop\.read_a11y_tree/,
    /never repeat the same failed action/i,
    /completion signal/i,
  ],
  'browser-form-submission': [
    /browser\.dom_snapshot/,
    /browser\.fill_credential_field/,
    /browser\.verification_state/,
    /approvals\.request/,
    /double submission|re-?submit/i,
  ],
  'design-app-export': [
    /_export_proof/,
    /desktop\.file_stat/,
    /document_status/,
    /approvals\.request/,
    /overwrite/i,
  ],
  'file-organization': [
    /desktop\.file_search/,
    /desktop\.file_stat/,
    /grant/i,
    /approvals\.request/,
    /scoped|approved root/i,
  ],
  'engineering-design': [
    /engineering\.calc/,
    /engineering\.model_3d/,
    /engineering\.inspect_mesh/,
    /desktop\.cad_compile/,
    /size .*model.*measure|compose at the seams/i,
    /watertight/i,
  ],
};

const REAL_TOOL_RE = /\b(?:desktop|browser|approvals|agent|research)\.[a-z_]+/g;
const SECRET_RE = /\b(?:sk-[a-z0-9]{12,}|AKIA[0-9A-Z]{16})\b|password\s*[:=]\s*\S/i;

const skillNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
  .map((entry) => entry.name)
  .sort();

assert(skillNames.length >= 3, `expected >= 3 canonical skills, found ${skillNames.length}`);

for (const skillName of skillNames) {
  const content = readFileSync(join(skillsDir, skillName, 'SKILL.md'), 'utf8');
  const parsed = parseSkillFrontmatter(content);

  // Frontmatter (stays loadable + ranked by the live library).
  assert.equal(parsed.name, skillName, `${skillName}: frontmatter name matches directory`);
  assert(parsed.description && parsed.description.length >= 40, `${skillName}: meaningful description`);
  assert(parsed.description!.length <= 600, `${skillName}: description stays compact`);
  assert(/^\d+\.\d+\.\d+$/.test(parsed.version || ''), `${skillName}: semver version`);
  assert((parsed.tags || []).length >= 2, `${skillName}: has tags`);

  // agentskills.io required sections.
  for (const section of ['## Procedure', '## Pitfalls', '## Verification']) {
    assert(parsed.body.includes(section), `${skillName}: has ${section}`);
  }

  // References the real tool surface (>= 3 distinct tools).
  const tools = new Set((parsed.body.match(REAL_TOOL_RE) || []));
  assert(tools.size >= 3, `${skillName}: references >= 3 real tools (found ${tools.size})`);

  // Per-skill content probes.
  const probes = PROBES[skillName];
  assert(probes, `${skillName}: missing a probe registry entry (add one when adding a skill)`);
  for (const probe of probes) {
    assert(probe.test(parsed.body), `${skillName}: body must match ${probe}`);
  }

  // Safety: no local paths / secret-looking content.
  assert(!content.includes('/Users/'), `${skillName}: no local path leak`);
  assert(!SECRET_RE.test(content), `${skillName}: no secret-looking content`);

  // The bundled runtime module must stay in sync with the file (drift guard for
  // the in-app "Add canonical skills" action). Regenerate: npm run build:canonical-skills-bundle
  const bundled = CANONICAL_SKILLS.find((s) => s.name === parsed.name);
  assert(bundled, `${skillName}: missing from canonicalSkills.generated.ts — run build:canonical-skills-bundle`);
  assert.equal(bundled!.content, content, `${skillName}: bundled content drifted from SKILL.md — run build:canonical-skills-bundle`);
  assert.equal(bundled!.version, parsed.version, `${skillName}: bundled version drifted`);
  assert.deepEqual(bundled!.tags, parsed.tags || [], `${skillName}: bundled tags drifted`);

  console.log(`pass: ${skillName} (v${parsed.version}, ${tools.size} tools, [${(parsed.tags || []).join(', ')}])`);
}

assert.equal(CANONICAL_SKILLS.length, skillNames.length, 'bundle has an entry per skill (no stale/extra rows)');

console.log(`\nAll ${skillNames.length} canonical skill(s) validated (+ bundle in sync).`);
