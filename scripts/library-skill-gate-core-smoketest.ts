/**
 * library-skill-gate-core-smoketest — pins the SKILL.md library render + gate
 * core (src/lib/librarySkillGateCore.ts). Load-bearing assertions:
 *
 *   renderLibrarySkillsBlock(skills, query): string
 *     - gate quiet ('none' — zero content overlap anywhere) ⇒ output is
 *       STRING-EQUAL to the legacy formatLibrarySkillsBlock golden (header +
 *       legacy-ordered rows, nothing appended);
 *     - gate quiet ('suggest' — a lone weak leader below strongScore 6) ⇒
 *       byte-identical no-gate golden too;
 *     - 'apply' (strong dominant content match) ⇒ EXACTLY ONE extra line right
 *       after the two header lines, naming the matching skill:
 *         Best match for this request: "<name>" — call viewLibrarySkill('<name>') …
 *       and removing that one line restores the legacy golden byte-for-byte;
 *     - 'disambiguate' (two tag-tied skills) ⇒ the ask line naming both,
 *       leader-first in the gate core's deterministic order;
 *     - success/usage popularity ALONE (usage 100 / success 100, zero token
 *       overlap) can NEVER clear the gate floor ⇒ no gate line, while the
 *       success boost still orders the TABLE (ordering-only, exactly legacy);
 *     - fence/control chars in a skill name are stripped from the GATE line ids
 *       by the gate core (the table row keeps the legacy raw rendering);
 *     - zero skills ⇒ '' (block elided).
 *
 * Pure — loads under tsx (value imports only reach the two zero-dep cores).
 */

import {
  renderLibrarySkillsBlock,
  buildLibrarySkillGateLine,
  LIBRARY_SKILL_GATE_MAX_ALTERNATIVES,
} from '../src/lib/librarySkillGateCore';
import type { LibrarySkillMetadata } from '../src/lib/skillLibrary';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function makeSkill(overrides: Partial<LibrarySkillMetadata> & { name: string }): LibrarySkillMetadata {
  return {
    id: `skill-${overrides.name}`,
    circleId: 'circle-1',
    authorId: null,
    description: '',
    version: '1.0.0',
    tags: [],
    usageCount: 0,
    successCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const HEADER = [
  '## SKILL.md Library',
  'Circle-authored procedures. Call `viewLibrarySkill(name)` for the full body (procedure / pitfalls / verification) when one looks relevant.',
];

// ── 1. 'none' (zero overlap) ⇒ string-equal legacy golden, nothing appended ────
{
  const skills = [
    makeSkill({ name: 'deploy-checklist', tags: ['deploy'], description: 'steps to deploy the api' }),
    makeSkill({ name: 'onboarding-guide', description: 'welcome new members' }),
  ];
  const query = 'what is our vacation policy';
  const legacyGolden = [
    ...HEADER,
    '- deploy-checklist (v1.0.0) [deploy]: steps to deploy the api',
    '- onboarding-guide (v1.0.0): welcome new members',
  ].join('\n');
  assertEq(renderLibrarySkillsBlock(skills, query), legacyGolden, 'none: block is byte-identical to the legacy golden');
  assertEq(buildLibrarySkillGateLine(skills, query), null, 'none: gate line is null');
}

// ── 2. 'suggest' (lone weak leader, score 1 < strongScore 6) ⇒ nothing appended ─
{
  const skills = [
    makeSkill({ name: 'deploy-checklist', tags: ['deploy'], description: 'steps to roll out the api' }),
    makeSkill({ name: 'onboarding-guide', description: 'welcome new members' }),
  ];
  const query = 'can someone roll back the change';
  const legacyGolden = [
    ...HEADER,
    '- deploy-checklist (v1.0.0) [deploy]: steps to roll out the api',
    '- onboarding-guide (v1.0.0): welcome new members',
  ].join('\n');
  assertEq(renderLibrarySkillsBlock(skills, query), legacyGolden, 'suggest: block is byte-identical to the legacy golden');
  assertEq(buildLibrarySkillGateLine(skills, query), null, 'suggest: gate line is null');
}

// ── 3. 'apply' (strong dominant match) ⇒ exactly one line, right name, right spot ─
{
  const skills = [
    makeSkill({
      name: 'mobile-release',
      tags: ['release', 'production'],
      description: 'how to ship the mobile app build to production stores',
    }),
    makeSkill({ name: 'weather-widget', tags: ['weather'], description: 'render weather forecasts' }),
  ];
  const query = 'release the mobile app to production';
  const gateLine =
    'Best match for this request: "mobile-release" — call viewLibrarySkill(\'mobile-release\') and follow it before answering.';
  const legacyGolden = [
    ...HEADER,
    '- mobile-release (v1.0.0) [release, production]: how to ship the mobile app build to production stores',
    '- weather-widget (v1.0.0) [weather]: render weather forecasts',
  ].join('\n');
  const block = renderLibrarySkillsBlock(skills, query);
  const expected = [...HEADER, gateLine,
    '- mobile-release (v1.0.0) [release, production]: how to ship the mobile app build to production stores',
    '- weather-widget (v1.0.0) [weather]: render weather forecasts',
  ].join('\n');
  assertEq(block, expected, 'apply: block equals header + gate line + legacy rows');
  const gateLines = block.split('\n').filter((l) => l.startsWith('Best match for this request:'));
  assertEq(gateLines.length, 1, 'apply: exactly one gate line appended');
  assert(gateLines[0]?.includes('"mobile-release"'), 'apply: gate line names the matching skill');
  assertEq(block.split('\n')[2], gateLine, 'apply: gate line sits right after the two header lines');
  assertEq(
    block.split('\n').filter((l) => l !== gateLine).join('\n'),
    legacyGolden,
    'apply: removing the one gate line restores the legacy golden byte-for-byte',
  );
}

// ── 4. 'disambiguate' (two tag-tied skills) ⇒ ask line naming both ─────────────
{
  const skills = [
    makeSkill({ name: 'auth-hardening', tags: ['security'], description: 'lock down endpoints' }),
    makeSkill({ name: 'dependency-audit', tags: ['security'], description: 'check package versions' }),
  ];
  const query = 'improve the security posture';
  const askLine =
    'Multiple skills match closely: "auth-hardening", "dependency-audit". Ask the user which one applies before relying on either.';
  const block = renderLibrarySkillsBlock(skills, query);
  assertEq(block.split('\n')[2], askLine, 'disambiguate: ask line names both tied skills, right after the header');
  assertEq(buildLibrarySkillGateLine(skills, query), askLine, 'disambiguate: gate helper returns the ask line');
  assertEq(
    block.split('\n').filter((l) => l.startsWith('Multiple skills match closely:')).length,
    1,
    'disambiguate: exactly one ask line',
  );
}

// ── 5. success boost alone never clears the floor (ordering-only) ──────────────
{
  const skills = [
    makeSkill({
      name: 'standup-notes',
      tags: ['meetings'],
      description: 'summarize daily standups',
      usageCount: 100,
      successCount: 100,
    }),
    makeSkill({ name: 'expense-report', tags: ['finance'], description: 'file monthly expenses' }),
  ];
  const query = 'what is our vacation policy';
  const block = renderLibrarySkillsBlock(skills, query);
  assertEq(buildLibrarySkillGateLine(skills, query), null, 'popularity: usage-100/success-100 zero-overlap skill gets NO gate line');
  const legacyGolden = [
    ...HEADER,
    // Success boost (min(2, 100/100) = 1) still orders the TABLE: boosted first.
    '- standup-notes (v1.0.0) [meetings]: summarize daily standups',
    '- expense-report (v1.0.0) [finance]: file monthly expenses',
  ].join('\n');
  assertEq(block, legacyGolden, 'popularity: block stays byte-identical legacy (boost orders the table only)');
}

// ── 6. fence chars in a name are stripped from the GATE line ids ───────────────
{
  const skills = [
    makeSkill({
      name: 'deploy<step> `runner`',
      tags: ['deploy', 'production'],
      description: 'run the deploy pipeline to production',
    }),
    makeSkill({ name: 'onboarding-guide', description: 'welcome new members' }),
  ];
  const query = 'deploy the service to production';
  const gateLine = buildLibrarySkillGateLine(skills, query);
  assert(typeof gateLine === 'string' && gateLine.startsWith('Best match for this request:'), 'fence: strong match still applies');
  assert(gateLine !== null && !/[<>`]/.test(gateLine), 'fence: gate line contains no fence chars');
  assert(gateLine !== null && gateLine.includes('"deploystep runner"'), 'fence: gate id is the sanitized name');
  // The table row keeps the legacy raw rendering (byte-identical mandate).
  const block = renderLibrarySkillsBlock(skills, query);
  assert(block.includes('- deploy<step> `runner` (v1.0.0)'), 'fence: table row keeps the raw legacy name');
}

// ── 7. zero skills ⇒ '' + exported cap sanity ──────────────────────────────────
{
  assertEq(renderLibrarySkillsBlock([], 'anything'), '', 'empty: zero skills elide the block');
  assertEq(LIBRARY_SKILL_GATE_MAX_ALTERNATIVES, 2, 'cap: gate surfaces at most 2 alternatives');
}

console.log(`\nlibrary-skill-gate-core-smoketest: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
