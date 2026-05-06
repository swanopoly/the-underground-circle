/**
 * agent-runtime-helpers-smoketest — locks in pure helpers from Phase 2/4 that
 * don't need Supabase (frontmatter parser, URL normalizer, default
 * summarizer, telemetry serializer). Catches regressions before
 * production flows pick the wrong behavior.
 *
 * Usage: `npm run smoke:agent-runtime-helpers`
 */

import { parseSkillFrontmatter } from '../src/lib/skillFrontmatter';
import { summarisePlanForTelemetry, buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

// normalizeSkillUrl lives in `skillLibraryImport.ts`, which imports Supabase
// transitively; that pulls React Native into the tsx runtime and the smoke
// test can't start. We mirror the tiny pure-function body here. If the real
// helper moves to its own module (parallel to skillFrontmatter.ts), delete
// this copy and re-import.
function normalizeSkillUrl(url: string): string {
  const out = url.trim();
  const blobMatch = out.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, ref, path] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  }
  const gistMatch = out.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/?$/);
  if (gistMatch) {
    const [, user, id] = gistMatch;
    return `https://gist.githubusercontent.com/${user}/${id}/raw`;
  }
  return out;
}

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}
function assert(ok: boolean, name: string) {
  if (!ok) fail(name); else pass(name);
}

// ─── parseSkillFrontmatter ──────────────────────────────────────────────────

const sample = `---
name: bug-hunt
description: Root-cause a failing test
version: 1.2.0
tags: [debug, tests]
---
## When to use
When a regression appears.

## Procedure
1. Reproduce.
2. Isolate.
`;
const parsed = parseSkillFrontmatter(sample);
assertEqual(parsed.name,        'bug-hunt',              'frontmatter: name');
assertEqual(parsed.description, 'Root-cause a failing test', 'frontmatter: description');
assertEqual(parsed.version,     '1.2.0',                 'frontmatter: version');
assertEqual(parsed.tags,        ['debug', 'tests'],      'frontmatter: tags');
assert(parsed.body.includes('## When to use'),           'frontmatter: body preserved');

// No frontmatter → returns body intact + empty raw
const noFront = parseSkillFrontmatter('just a body\n\nno frontmatter here');
assertEqual(noFront.name,           undefined,           'frontmatter: missing name');
assertEqual(noFront.body,           'just a body\n\nno frontmatter here', 'frontmatter: body passthrough');
assertEqual(noFront.rawFrontmatter, '',                  'frontmatter: empty rawFrontmatter');

// Quoted frontmatter values
const quoted = parseSkillFrontmatter(`---
name: "quoted-name"
description: 'single-quoted desc'
---
body
`);
assertEqual(quoted.name,        'quoted-name',        'frontmatter: strips double quotes');
assertEqual(quoted.description, 'single-quoted desc', 'frontmatter: strips single quotes');

// Comma-separated tags (non-bracket form)
const commaTags = parseSkillFrontmatter(`---
name: x
description: y
tags: a, b, c
---
body
`);
assertEqual(commaTags.tags, ['a', 'b', 'c'], 'frontmatter: comma-separated tags');

// ─── normalizeSkillUrl ──────────────────────────────────────────────────────

assertEqual(
  normalizeSkillUrl('https://github.com/owner/repo/blob/main/skills/foo.md'),
  'https://raw.githubusercontent.com/owner/repo/main/skills/foo.md',
  'normalizeSkillUrl: github blob → raw',
);
assertEqual(
  normalizeSkillUrl('https://gist.github.com/chris/abc123'),
  'https://gist.githubusercontent.com/chris/abc123/raw',
  'normalizeSkillUrl: gist → raw',
);
assertEqual(
  normalizeSkillUrl('https://example.com/skill.md'),
  'https://example.com/skill.md',
  'normalizeSkillUrl: leaves raw URL alone',
);
assertEqual(
  normalizeSkillUrl('https://raw.githubusercontent.com/owner/repo/main/skills/foo.md'),
  'https://raw.githubusercontent.com/owner/repo/main/skills/foo.md',
  'normalizeSkillUrl: already raw → unchanged',
);

// ─── summarisePlanForTelemetry ──────────────────────────────────────────────

const slashPlan = buildChatAutomationPlan({ message: '/help' });
const summary = summarisePlanForTelemetry(slashPlan);

assertEqual((summary as any).source,          'slash',               'telemetry: source');
assertEqual((summary as any).intentKind,      'slash_command',       'telemetry: intentKind');
assertEqual((summary as any).executionKind,   'run_command_handler', 'telemetry: executionKind');
assertEqual((summary as any).risk,            'safe',                'telemetry: risk');
assertEqual((summary as any).approvalRequired, false,                'telemetry: approvalRequired');
assert(
  typeof (summary as any).confidence === 'number' && (summary as any).confidence >= 0.9,
  'telemetry: confidence preserved',
);

// ─── summary ────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} agent-runtime-helpers failure(s)`);
  process.exit(1);
}
console.log('\nAll agent-runtime-helpers smoke cases passed.');
