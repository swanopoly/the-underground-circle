/**
 * Smoke: app automation docs index — the registry that makes docs/apps/*.md
 * load-bearing for connected-agent buildouts.
 *
 *   npm run smoke:app-automation-docs-index
 *
 * Pins: every registry entry has a real file on disk whose Status header
 * matches the registry status; alias resolution picks the right app with
 * word-boundary safety; the prompt line names the doc path.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP_AUTOMATION_DOCS,
  resolveAppAutomationDoc,
  buildAppAutomationDocPromptLine,
} from '../src/lib/appAutomationDocsIndex';

let passed = 0;
function assert(cond: unknown, label: string, detail?: unknown) {
  if (!cond) {
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`pass: ${label}`);
}

const repoRoot = join(__dirname, '..');

// ── Registry ↔ disk lockstep ────────────────────────────────────────────────
const STATUS_HEADER: Record<string, string> = {
  executable: 'executable',
  partial: 'partial',
  buildout_only: 'buildout-only',
  web_only: 'web-only',
  cloud_service: 'cloud-service',
};

assert(APP_AUTOMATION_DOCS.length >= 31, `registry covers all app docs (${APP_AUTOMATION_DOCS.length})`);
const slugs = new Set<string>();
for (const doc of APP_AUTOMATION_DOCS) {
  assert(!slugs.has(doc.slug), `slug unique: ${doc.slug}`);
  slugs.add(doc.slug);
  const absPath = join(repoRoot, doc.docPath);
  assert(existsSync(absPath), `doc exists on disk: ${doc.docPath}`);
  const body = readFileSync(absPath, 'utf8');
  const statusWord = STATUS_HEADER[doc.status];
  assert(
    new RegExp(`>\\s*App automation profile\\. Status:.*${statusWord}`, 'i').test(body),
    `status lockstep (${doc.slug} = ${statusWord})`,
  );
  assert(doc.aliases.length > 0, `aliases present: ${doc.slug}`);
}

// ── Resolution matrix ───────────────────────────────────────────────────────
const cases: Array<[string, string | null]> = [
  ['Remove the background from hero.psd in Photoshop', 'photoshop'],
  ['open my .scad file and compile it', 'openscad'],
  ['convert this STEP file with FreeCAD', 'freecad'],
  ['add a page to my InDesign data merge template', 'indesign'],
  ['resize the logo in Affinity Designer', 'affinity-designer'],
  ['edit the photo in Affinity Photo', 'affinity-photo'],
  ['export my Figma frames as PNGs', 'figma'],
  ['render a turntable in Blender', 'blender'],
  ['route this KiCad board and export gerbers', 'kicad'],
  ['color grade the timeline in DaVinci Resolve', 'davinci-resolve'],
  ['organize my Downloads folder', null],
  ['book a table for two', null],
];
for (const [task, expected] of cases) {
  const resolved = resolveAppAutomationDoc(task);
  assert(
    (resolved?.slug ?? null) === expected,
    `resolve: "${task.slice(0, 44)}" → ${expected ?? 'null'}`,
    resolved?.slug,
  );
}

// Word-boundary safety: substrings inside words must not match.
assert(resolveAppAutomationDoc('the trip to Mayan ruins') === null, 'no match inside words (mayan ≠ maya)');
assert(resolveAppAutomationDoc('sketchy behavior in the logs') === null, 'no match inside words (sketchy ≠ sketch app)');
// Longest alias wins.
assert(resolveAppAutomationDoc('use affinity designer for this')?.slug === 'affinity-designer', 'longest alias beats shorter');
// Explicit app name is honored.
assert(resolveAppAutomationDoc('touch up this image', 'Adobe Photoshop 2026')?.slug === 'photoshop', 'explicit appName resolves');

// ── Prompt line ─────────────────────────────────────────────────────────────
const line = buildAppAutomationDocPromptLine('fix the mask in photoshop');
assert(!!line && line.includes('docs/apps/photoshop.md'), 'prompt line cites the doc path');
assert(!!line && /FIRST/.test(line), 'prompt line instructs reading the profile first');
assert(buildAppAutomationDocPromptLine('walk the dog') === null, 'no prompt line without a match');

console.log(`\nAll app-automation-docs-index smoke cases passed (${passed} assertions).`);
