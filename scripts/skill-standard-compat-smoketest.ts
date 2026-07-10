/**
 * skill-standard-compat-smoketest — verifies the X8 (P50) Agent Skills
 * standard auditor in `src/lib/skillStandardCompat.ts`, and runs the
 * CONTINUOUS CONFORMANCE GATE: every skill we ship in-repo (the `skills/`
 * folders and the generated CANONICAL_SKILLS bundle) must be portable —
 * zero error-severity findings — so a portability regression fails CI, not
 * a future export.
 *
 * Covers:
 *   - spec constants pinned (name ≤64 [a-z0-9-], reserved words, desc ≤1024,
 *     5k-token body guidance)
 *   - auditor failure classes per field (empty/too-long/charset/reserved/xml,
 *     missing when-signal warning, frontmatter mismatch, body budget,
 *     unsafe relpaths)
 *   - portable = no errors (warnings don't flip it)
 *   - name normalization (export-side coercion)
 *   - buildStandardSkillMd round-trip through parseSkillFrontmatter
 *   - summarizeSkillCompat (errors lead; silent when clean)
 *   - conformance gate over skills/ + CANONICAL_SKILLS
 *
 * Run: npm run smoke:skill-standard-compat
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import {
  auditSkillStandardCompat,
  normalizeSkillNameForStandard,
  buildStandardSkillMd,
  summarizeSkillCompat,
  ANTHROPIC_SKILL_NAME_MAX_CHARS,
  ANTHROPIC_SKILL_NAME_PATTERN,
  ANTHROPIC_SKILL_RESERVED_NAME_WORDS,
  ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_BODY_TOKEN_GUIDANCE,
} from '../src/lib/skillStandardCompat';
import { parseSkillFrontmatter } from '../src/lib/skillFrontmatter';
import { CANONICAL_SKILLS } from '../src/lib/canonicalSkills.generated';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  // ─── Case 1: spec constants pinned ──────────────────────────────────────
  {
    assert(ANTHROPIC_SKILL_NAME_MAX_CHARS === 64, 'case1: name max 64');
    assert(ANTHROPIC_SKILL_NAME_PATTERN.test('pdf-processing-2'), 'case1: charset accepts kebab');
    assert(!ANTHROPIC_SKILL_NAME_PATTERN.test('PDF_Processing'), 'case1: charset rejects uppercase/underscore');
    assert(ANTHROPIC_SKILL_RESERVED_NAME_WORDS.includes('anthropic') && ANTHROPIC_SKILL_RESERVED_NAME_WORDS.includes('claude'),
      'case1: reserved words pinned');
    assert(ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS === 1024, 'case1: description max 1024');
    assert(SKILL_BODY_TOKEN_GUIDANCE === 5000, 'case1: 5k-token body guidance');
  }

  // ─── Case 2: auditor failure classes ────────────────────────────────────
  {
    const good = auditSkillStandardCompat({
      name: 'wordpress-banner-update',
      description: 'Updates dealership banner copy in InDesign. Use when the user asks to change prices, APR, or disclaimers on a banner.',
      content: '---\nname: wordpress-banner-update\ndescription: d\n---\n\n## Procedure\nDo the thing.\n',
    });
    assert(good.portable && good.findings.length === 0, 'case2: conforming skill → portable, zero findings',
      JSON.stringify(good.findings));

    const bad = auditSkillStandardCompat({ name: 'My Claude Helper!', description: '' });
    const rules = bad.findings.map((f) => f.rule);
    assert(!bad.portable, 'case2: violations → not portable');
    assert(rules.includes('name-charset'), 'case2: uppercase/spaces caught');
    assert(rules.includes('name-reserved-word'), 'case2: reserved word "claude" caught');
    assert(rules.includes('description-empty'), 'case2: empty description caught');

    const long = auditSkillStandardCompat({ name: 'x'.repeat(70), description: 'y'.repeat(1100) });
    const longRules = long.findings.map((f) => f.rule);
    assert(longRules.includes('name-too-long') && longRules.includes('description-too-long'),
      'case2: length caps enforced');

    const xml = auditSkillStandardCompat({ name: 'a<b>c', description: 'Does <thing/> stuff. Use when needed.' });
    const xmlRules = xml.findings.map((f) => f.rule);
    assert(xmlRules.includes('name-xml') && xmlRules.includes('description-xml'),
      'case2: XML tags rejected in both fields');

    const noWhen = auditSkillStandardCompat({ name: 'ok-skill', description: 'Formats spreadsheets nicely.' });
    assert(noWhen.portable, 'case2: missing when-signal is a WARNING — still portable');
    assert(noWhen.findings.some((f) => f.rule === 'description-missing-when-signal' && f.severity === 'warning'),
      'case2: when-signal warning present');

    const mismatch = auditSkillStandardCompat({
      name: 'library-name',
      description: 'Does a thing. Use when asked.',
      content: '---\nname: other-name\ndescription: d\n---\nBody.',
    });
    assert(mismatch.findings.some((f) => f.rule === 'frontmatter-name-mismatch' && f.severity === 'warning'),
      'case2: frontmatter/library name mismatch warned');

    const fat = auditSkillStandardCompat({
      name: 'ok-skill',
      description: 'Does a thing. Use when asked.',
      content: '---\nname: ok-skill\ndescription: d\n---\n' + 'word '.repeat(6000),
    });
    assert(fat.portable && fat.findings.some((f) => f.rule === 'body-over-token-guidance'),
      'case2: oversized body is a warning, not a rejection');

    const files = auditSkillStandardCompat({
      name: 'ok-skill',
      description: 'Does a thing. Use when asked.',
      fileRelpaths: ['scripts/run.py', '../escape.md'],
    });
    assert(!files.portable && files.findings.some((f) => f.rule === 'file-unsafe-relpath'),
      'case2: path-escape supporting file is an error');
    assert(files.findings.filter((f) => f.rule === 'file-unsafe-relpath').length === 1,
      'case2: safe relative file path passes');
  }

  // ─── Case 3: name normalization ─────────────────────────────────────────
  {
    assert(normalizeSkillNameForStandard('My Cool Skill v2.1') === 'my-cool-skill-v2-1',
      'case3: spaces/dots/case coerced', normalizeSkillNameForStandard('My Cool Skill v2.1'));
    assert(normalizeSkillNameForStandard('__weird__name__') === 'weird-name',
      'case3: underscores collapse to single hyphens, trimmed');
    assert(normalizeSkillNameForStandard('x'.repeat(80)).length === 64, 'case3: clipped to 64');
    assert(normalizeSkillNameForStandard('émoji✨skill') === 'mojiskill', 'case3: illegal chars dropped');
    assert(normalizeSkillNameForStandard(null) === '', 'case3: null → empty (audit catches it)');
  }

  // ─── Case 4: buildStandardSkillMd round-trip ────────────────────────────
  {
    const built = buildStandardSkillMd({
      name: 'Banner Update Recipe',
      description: 'Updates <b>banner</b> copy.   Use when the user asks for price changes.',
      content: '---\nname: old-name\ndescription: old\nversion: 0.9\n---\n## Procedure\nSteps here.\n',
      version: '1.0.0',
      tags: ['indesign', 'banners'],
    });
    assert(built.normalizedName === 'banner-update-recipe', 'case4: exported name normalized');
    const parsed = parseSkillFrontmatter(built.markdown);
    assert(parsed.name === 'banner-update-recipe', 'case4: round-trip name');
    assert(parsed.description === 'Updates banner copy. Use when the user asks for price changes.',
      'case4: description XML-scrubbed + whitespace-normalized', parsed.description);
    assert(parsed.version === '1.0.0' && (parsed.tags || []).join(',') === 'indesign,banners',
      'case4: extras carried');
    assert(parsed.body.includes('## Procedure') && !parsed.body.includes('old-name'),
      'case4: body carried from content, old frontmatter stripped');
    assert(built.findings.every((f) => f.severity !== 'error'),
      'case4: exported artifact has no error findings', JSON.stringify(built.findings));

    const unfixable = buildStandardSkillMd({ name: 'claude-helper', description: 'Helps. Use when helping.' });
    assert(unfixable.findings.some((f) => f.rule === 'name-reserved-word'),
      'case4: reserved words are NOT mechanically fixable — residual error reported');
  }

  // ─── Case 5: summary line ────────────────────────────────────────────────
  {
    const clean = auditSkillStandardCompat({ name: 'ok', description: 'Does x. Use when y.' });
    assert(summarizeSkillCompat(clean) === null, 'case5: clean audit → null (no noise)');
    const broken = summarizeSkillCompat(auditSkillStandardCompat({ name: 'Bad Name', description: '' }));
    assert(!!broken && broken.startsWith('⚠️ not portable'), 'case5: errors lead the summary', broken || 'null');
    const warned = summarizeSkillCompat(auditSkillStandardCompat({ name: 'ok', description: 'Formats things.' }));
    assert(!!warned && warned.startsWith('portable with warnings'), 'case5: warning-only summary');
  }

  // ─── Case 6: CONFORMANCE GATE — every in-repo skill is portable ─────────
  {
    // (a) skills/ folders on disk.
    const skillsDir = join(repoRoot, 'skills');
    const folders = existsSync(skillsDir)
      ? readdirSync(skillsDir).filter((entry) => {
          const full = join(skillsDir, entry);
          return statSync(full).isDirectory() && existsSync(join(full, 'SKILL.md'));
        })
      : [];
    assert(folders.length >= 4, 'case6: found the in-repo skills/ folders', `got ${folders.length}`);
    for (const folder of folders) {
      const md = readFileSync(join(skillsDir, folder, 'SKILL.md'), 'utf8');
      const fm = parseSkillFrontmatter(md);
      // Supporting files = everything in the folder except SKILL.md, as
      // folder-relative paths (what an exported zip would contain).
      const supporting: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (entry !== 'SKILL.md' || dir !== join(skillsDir, folder)) {
            supporting.push(relative(join(skillsDir, folder), full));
          }
        }
      };
      walk(join(skillsDir, folder));
      const audit = auditSkillStandardCompat({
        name: fm.name || folder,
        description: fm.description,
        content: md,
        fileRelpaths: supporting,
      });
      const errors = audit.findings.filter((f) => f.severity === 'error');
      assert(errors.length === 0,
        `case6: skills/${folder} is standard-portable`,
        errors.map((e) => `${e.rule}: ${e.message}`).join('; '));
      assert((fm.name || folder) === folder,
        `case6: skills/${folder} frontmatter name matches its folder name`,
        `frontmatter=${fm.name}`);
    }

    // (b) the generated canonical bundle.
    assert(Array.isArray(CANONICAL_SKILLS) && CANONICAL_SKILLS.length >= 4,
      'case6: canonical bundle present', `got ${(CANONICAL_SKILLS as any[])?.length}`);
    for (const skill of CANONICAL_SKILLS as Array<{ name: string; description?: string; content?: string }>) {
      const audit = auditSkillStandardCompat({
        name: skill.name,
        description: skill.description,
        content: skill.content,
      });
      const errors = audit.findings.filter((f) => f.severity === 'error');
      assert(errors.length === 0,
        `case6: canonical "${skill.name}" is standard-portable`,
        errors.map((e) => `${e.rule}: ${e.message}`).join('; '));
    }
  }

  console.log(failures === 0 ? '\nskill-standard-compat smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
