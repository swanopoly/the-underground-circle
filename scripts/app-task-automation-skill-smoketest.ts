/**
 * app-task-automation-skill-smoketest
 *
 * Validates the canonical app-automation SKILL.md against the real
 * `parseSkillFrontmatter` so it stays loadable by the skill library, has the
 * agentskills.io structure (Procedure / Pitfalls / Verification), exercises the
 * actual app-automation pipeline (observe→find→act→verify, find-ladder,
 * research, buildout, proof), and leaks no local paths/secrets.
 *
 * Run: npm run smoke:app-task-automation-skill
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSkillFrontmatter } from '../src/lib/skillFrontmatter';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, '..', 'skills', 'app-task-automation', 'SKILL.md');
const content = readFileSync(skillPath, 'utf8');
const parsed = parseSkillFrontmatter(content);

// ── Frontmatter parses (stays loadable by the live library) ────────────────
assert.equal(parsed.name, 'app-task-automation', 'name parses');
assert(parsed.description && parsed.description.length >= 40, 'description is meaningful');
assert(parsed.description!.length <= 600, 'description stays compact for the metadata table');
assert(/^\d+\.\d+\.\d+$/.test(parsed.version || ''), 'version is semver');
const tags = parsed.tags || [];
for (const tag of ['automation', 'computer-use', 'observe-act-verify']) {
  assert(tags.includes(tag), `tags include ${tag}`);
}
// Description should advertise *when* to use it (relevance-ranking signal).
assert(/\bapp\b/i.test(parsed.description!) && /\b(desktop|web|computer)\b/i.test(parsed.description!));

// ── agentskills.io required sections ───────────────────────────────────────
const body = parsed.body;
for (const section of ['## Procedure', '## Pitfalls', '## Verification']) {
  assert(body.includes(section), `body has ${section}`);
}

// ── Exercises the observe→find→act→verify pipeline ─────────────────────────
assert(/observe/i.test(body) && /verify/i.test(body), 'encodes observe + verify');
assert(/before the next/i.test(body), 'verify-before-next-action cadence');
assert(/find-ladder|find the target/i.test(body), 'has the universal find-ladder');
for (const probe of ['accessibility', 'command palette', 'menu', 'keyboard shortcut']) {
  assert(new RegExp(probe, 'i').test(body), `find-ladder mentions ${probe}`);
}
assert(/research\.search|research first|research when unfamiliar/i.test(body), 'research-when-unfamiliar step');
assert(/agent\.build_app_capability/.test(body), 'connected-agent buildout escalation');
assert(/never repeat the same failed action/i.test(body), 'no blind-repeat recovery rule');

// ── References the real tool surface ───────────────────────────────────────
for (const tool of [
  'desktop.read_a11y_tree',
  'desktop.menu_click',
  'desktop.window_state',
  'desktop.file_stat',
  'approvals.request',
  'browser.dom_snapshot',
]) {
  assert(body.includes(tool), `references real tool ${tool}`);
}

// ── Proof-based completion + checkpoint awareness ──────────────────────────
assert(/completion signal/i.test(body), 'completion is signal-based, not vibes');
assert(/file_stat/.test(body), 'file outputs verified via file_stat');
assert(/checkpoint|resume/i.test(body), 'step-cap resume guidance');

// ── Safety: no local paths / secret-looking content ────────────────────────
assert(!content.includes('/Users/'), 'no local path leak');
assert(!/\b(sk-[a-z0-9]{12,}|AKIA[0-9A-Z]{16}|password\s*[:=]\s*\S)/i.test(content), 'no secret-looking content');

console.log('All app-task-automation skill smoke cases passed.');
