/**
 * response-artifact-extract-core-smoketest — the PURE response-artifact extractor
 * (src/lib/responseArtifactExtractCore.ts). It scans a finished agent answer and
 * pulls the typed, reusable artifacts a UI can save/copy/apply: a code block (with
 * an inferred save filename), a diff/patch, a command runbook, and an openable
 * link set. Load-bearing behavior asserted here (spec groups A–H):
 *
 *   (A) code: a ```lang fence → one 'code' artifact; language from the info string;
 *       suggestedFilename from info-string path / `// filepath:` comment / heading;
 *       content === verbatim body; heading → title.
 *   (B) diff: a ```diff fence AND a bare `--- / +++ / @@` block → 'diff' with
 *       fileCount/additions/deletions/paths cross-checked against parseUnifiedDiff.
 *   (C) commands: a ```bash script fence AND a bare `$ `-prefixed run → 'commands'
 *       with ordered commands, prompt markers + comment/blank lines stripped,
 *       `\`-continuations joined.
 *   (D) links: ≥3 distinct urls → one deduped, secret-safe 'links' artifact; <3 → none.
 *   (E) csv-ish code stays kind 'code' (table upgrade is the caller's job).
 *   (F) plan markdown is NOT emitted (delegated to planModeCore).
 *   (G) ordering: artifacts in first-appearance order with stable `artifact-N` ids.
 *   (H) HOSTILE: null/undefined/number/bool/{}/[]/NaN/bigint/huge/control-chars/
 *       cyclic/throwing-proxy/__proto__+constructor language/path-traversal filename
 *       never throw and yield safe, bounded, code-point-clean output (no pollution).
 *
 * Pure — loads under tsx (the core imports only zero-dep pure sibling cores).
 * Run: npx tsx scripts/response-artifact-extract-core-smoketest.ts
 */

import {
  extractResponseArtifacts,
  safeArtifactBasename,
  RESPONSE_ARTIFACT_MAX,
  RESPONSE_ARTIFACT_CONTENT_MAX,
  RESPONSE_ARTIFACT_TITLE_MAX,
  RESPONSE_ARTIFACT_FILENAME_MAX,
  RESPONSE_ARTIFACT_MIN_LINKS,
  RESPONSE_ARTIFACT_MAX_LINKS,
  RESPONSE_ARTIFACT_MAX_COMMANDS,
  type ExtractedArtifact,
} from '../src/lib/responseArtifactExtractCore';
import { parseUnifiedDiff } from '../src/lib/diffHunkSelectCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertLE(a: number, b: number, m: string): void {
  assert(typeof a === 'number' && a <= b, m, 'got ' + a + ' want <= ' + b);
}
function assertIncludes(hay: unknown, needle: string, m: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), m, JSON.stringify(hay) + ' missing "' + needle + '"');
}
function assertExcludes(hay: unknown, needle: string, m: string): void {
  assert(typeof hay === 'string' && !hay.includes(needle), m, JSON.stringify(hay) + ' unexpectedly has "' + needle + '"');
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try { fn(); } catch (e) { threw = true; err = String(e); }
  assert(!threw, m, err);
}

// ── control-char / code-point helpers (build control chars, never raw literals) ──
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const RLO = String.fromCharCode(0x202e); // bidi override
const BOM = String.fromCharCode(0xfeff);
const TAG = String.fromCodePoint(0xe0041); // Unicode-Tag block
const LONE_SUR = String.fromCharCode(0xd83d); // lone high surrogate

const cpLen = (s: string): number => Array.from(s).length;

/** No control / DEL / C1 / line-sep / format (zero-width, bidi) / Tag / lone-surrogate. */
function isCleanLabel(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of Array.from(s)) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x200e || c === 0x200f) return false;
    if (c === 0x2060 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return false; // lone surrogate
    if (c === 0x60 || c === 0x3c || c === 0x3e) return false; // ` < >
  }
  return true;
}
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}

const KINDS = new Set(['code', 'diff', 'commands', 'links']);

/** Structural + bounds + safety check for one artifact (used across groups). */
function wellFormed(a: ExtractedArtifact): boolean {
  return (
    !!a && typeof a === 'object' &&
    typeof a.id === 'string' && a.id.length > 0 &&
    typeof a.kind === 'string' && KINDS.has(a.kind) &&
    typeof a.title === 'string' && cpLen(a.title) <= RESPONSE_ARTIFACT_TITLE_MAX && isCleanLabel(a.title) &&
    typeof a.content === 'string' && cpLen(a.content) <= RESPONSE_ARTIFACT_CONTENT_MAX + 1 && !hasLoneSurrogate(a.content) &&
    (a.language === undefined || typeof a.language === 'string') &&
    (a.suggestedFilename === undefined ||
      (typeof a.suggestedFilename === 'string' &&
        a.suggestedFilename.length <= RESPONSE_ARTIFACT_FILENAME_MAX &&
        !a.suggestedFilename.includes('/') && !a.suggestedFilename.includes('\\') &&
        !a.suggestedFilename.includes('..') && isCleanLabel(a.suggestedFilename)))
  );
}
function allWellFormed(list: ExtractedArtifact[]): boolean {
  return Array.isArray(list) && list.every(wellFormed);
}
function firstOfKind(list: ExtractedArtifact[], kind: string): ExtractedArtifact | undefined {
  return list.find((a) => a.kind === kind);
}

function main(): void {
  // ─── (A) code extraction ───────────────────────────────────────────────────
  {
    const body = '// filepath: src/util/foo.ts\nexport const foo = () => 1;';
    const text = ['### Example helper', '```ts', body, '```'].join('\n');
    const arts = extractResponseArtifacts(text);
    assert(allWellFormed(arts), '(A) code result well-formed');
    const code = firstOfKind(arts, 'code');
    assert(!!code, '(A) a code artifact is produced');
    assertEq(code!.kind, 'code', '(A) kind is code');
    assertEq(code!.language, 'ts', '(A) language from info string');
    assertEq(code!.suggestedFilename, 'foo.ts', '(A) filename from `// filepath:` comment (basenamed)');
    assertEq(code!.content, body, '(A) content === verbatim body');
    assertEq(code!.title, 'Example helper', '(A) title from preceding heading');
    assertEq(code!.id, 'artifact-0', '(A) first artifact id is artifact-0');
  }

  // info-string path form: ```ts src/bar.tsx
  {
    const arts = extractResponseArtifacts('```ts src/bar.tsx\nconst x = 1;\n```');
    const code = firstOfKind(arts, 'code');
    assertEq(code!.language, 'ts', '(A) info-string space path: language');
    assertEq(code!.suggestedFilename, 'bar.tsx', '(A) info-string space path: filename basenamed');
  }
  // colon form: ```ts:src/baz.ts
  {
    const arts = extractResponseArtifacts('```ts:src/baz.ts\nconst y = 2;\n```');
    const code = firstOfKind(arts, 'code');
    assertEq(code!.language, 'ts', '(A) colon form: language');
    assertEq(code!.suggestedFilename, 'baz.ts', '(A) colon form: filename');
  }
  // attribute form: ```js title="app/main.js"
  {
    const arts = extractResponseArtifacts('```js title="app/main.js"\nconsole.log(1);\n```');
    const code = firstOfKind(arts, 'code');
    assertEq(code!.language, 'js', '(A) attribute form: language');
    assertEq(code!.suggestedFilename, 'main.js', '(A) attribute form: filename');
  }
  // heading that IS a filename → suggestedFilename from heading
  {
    const arts = extractResponseArtifacts('### render.py\n```python\nprint(1)\n```');
    const code = firstOfKind(arts, 'code');
    assertEq(code!.language, 'python', '(A) heading-filename: language');
    assertEq(code!.suggestedFilename, 'render.py', '(A) heading-filename → suggestedFilename');
  }
  // prose heading → title only, no suggestedFilename (caller infers from title+lang)
  {
    const arts = extractResponseArtifacts('## My Helper Module\n```ts\nconst a = 1;\n```');
    const code = firstOfKind(arts, 'code');
    assertEq(code!.title, 'My Helper Module', '(A) prose heading → title');
    assertEq(code!.suggestedFilename, undefined, '(A) prose heading → no suggestedFilename');
  }
  // empty fence is NOT surfaced (worth-surfacing threshold)
  {
    const arts = extractResponseArtifacts('```ts\n\n```');
    assertEq(firstOfKind(arts, 'code'), undefined, '(A) empty fence not surfaced');
  }
  // unclosed fence → still a code artifact with the rest as body
  {
    const arts = extractResponseArtifacts('```ts\nexport const z = 3;\nmore code here');
    const code = firstOfKind(arts, 'code');
    assert(!!code, '(A) unclosed fence still yields a code artifact');
    assertIncludes(code!.content, 'export const z = 3;', '(A) unclosed fence body captured');
  }
  // tilde fence works too
  {
    const arts = extractResponseArtifacts('~~~js\nvar q = 9;\n~~~');
    assertEq(firstOfKind(arts, 'code')?.language, 'js', '(A) tilde fence recognized');
  }

  // ─── (B) diff extraction ────────────────────────────────────────────────────
  {
    const diffBody = [
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' const d = 5;',
    ].join('\n');
    const text = 'Here is the change:\n```diff\n' + diffBody + '\n```';
    const arts = extractResponseArtifacts(text);
    assert(allWellFormed(arts), '(B) fenced diff result well-formed');
    const diff = firstOfKind(arts, 'diff');
    assert(!!diff, '(B) fenced diff artifact produced');
    assertEq(diff!.kind, 'diff', '(B) kind is diff');
    assert(!!diff!.diff, '(B) diff stats present');
    assertEq(diff!.diff!.fileCount, 1, '(B) fileCount 1');
    assertEq(diff!.diff!.additions, 2, '(B) additions 2');
    assertEq(diff!.diff!.deletions, 1, '(B) deletions 1');
    assert(diff!.diff!.paths.includes('src/foo.ts'), '(B) path listed');
    assertEq(diff!.content, diffBody, '(B) diff content verbatim');
    // cross-check against parseUnifiedDiff directly
    const files = parseUnifiedDiff(diffBody);
    let add = 0, del = 0;
    for (const f of files) for (const h of f.hunks) for (const l of h.lines) {
      if (l[0] === '+') add++; else if (l[0] === '-') del++;
    }
    assertEq(diff!.diff!.additions, add, '(B) additions cross-check parseUnifiedDiff');
    assertEq(diff!.diff!.deletions, del, '(B) deletions cross-check parseUnifiedDiff');
  }
  // bare diff (no fence)
  {
    const text = [
      'The patch:',
      '--- a/lib/x.js',
      '+++ b/lib/x.js',
      '@@ -10,2 +10,2 @@',
      '-old();',
      '+new();',
      '',
      'Thanks.',
    ].join('\n');
    const arts = extractResponseArtifacts(text);
    const diff = firstOfKind(arts, 'diff');
    assert(!!diff, '(B) bare diff artifact produced');
    assertEq(diff!.diff!.additions, 1, '(B) bare diff additions 1');
    assertEq(diff!.diff!.deletions, 1, '(B) bare diff deletions 1');
    assert(diff!.diff!.paths.includes('lib/x.js'), '(B) bare diff path listed');
  }
  // multi-file diff --git
  {
    const text = [
      '```diff',
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/two.ts b/two.ts',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -1 +1 @@',
      '-c',
      '+d',
      '```',
    ].join('\n');
    const diff = firstOfKind(extractResponseArtifacts(text), 'diff');
    assertEq(diff!.diff!.fileCount, 2, '(B) multi-file diff fileCount 2');
    assertEq(diff!.diff!.additions, 2, '(B) multi-file additions 2');
  }
  // absolute diff path is basenamed (no username leak)
  {
    const text = ['--- /Users/secret/app/z.ts', '+++ /Users/secret/app/z.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    const diff = firstOfKind(extractResponseArtifacts(text), 'diff');
    assert(!!diff, '(B) absolute-path diff produced');
    assert(diff!.diff!.paths.every((p) => !p.includes('secret')), '(B) absolute path basenamed (no username leak)');
    assert(diff!.diff!.paths.includes('z.ts'), '(B) absolute path reduced to basename');
  }

  // ─── (C) commands extraction ────────────────────────────────────────────────
  {
    const text = [
      '```bash',
      '# install deps',
      'npm install',
      '',
      'npm run build \\',
      '  --prod',
      '```',
    ].join('\n');
    const arts = extractResponseArtifacts(text);
    assert(allWellFormed(arts), '(C) script commands result well-formed');
    const cmds = firstOfKind(arts, 'commands');
    assert(!!cmds, '(C) commands artifact produced');
    assertEq(cmds!.kind, 'commands', '(C) kind is commands');
    assertEq(cmds!.language, 'bash', '(C) language bash');
    assert(Array.isArray(cmds!.commands), '(C) commands is an array');
    assertEq(cmds!.commands!.length, 2, '(C) comment + blank dropped → 2 commands');
    assertEq(cmds!.commands![0], 'npm install', '(C) first command clean');
    assertEq(cmds!.commands![1], 'npm run build --prod', '(C) `\\`-continuation joined');
    assertExcludes(cmds!.content, '#', '(C) comment stripped from content');
  }
  // bare `$ `-prefixed transcript run
  {
    const text = 'Run:\n$ git status\n$ git commit -m "msg"\nDone.';
    const cmds = firstOfKind(extractResponseArtifacts(text), 'commands');
    assert(!!cmds, '(C) bare `$ ` run produces commands');
    assertEq(cmds!.commands!.length, 2, '(C) bare run → 2 commands');
    assertEq(cmds!.commands![0], 'git status', '(C) `$ ` prompt marker stripped');
    assertEq(cmds!.commands![1], 'git commit -m "msg"', '(C) second command, quotes preserved');
  }
  // a single bare `$ ` line is NOT a command block (needs a run)
  {
    const arts = extractResponseArtifacts('The price is here.\n$ 5 off today\nokay');
    assertEq(firstOfKind(arts, 'commands'), undefined, '(C) single `$ ` line is not a commands block');
  }
  // transcript with `\`-continuation across a non-prompt line, inside a shell fence
  {
    const text = ['```console', '$ echo hello \\', 'world', '$ pwd', '```'].join('\n');
    const cmds = firstOfKind(extractResponseArtifacts(text), 'commands');
    assert(!!cmds, '(C) console transcript produces commands');
    assertEq(cmds!.commands![0], 'echo hello world', '(C) transcript `\\`-continuation folds non-prompt line');
    assertEq(cmds!.commands![1], 'pwd', '(C) subsequent prompt command kept');
  }
  // a plain `sh` one-liner is worth surfacing
  {
    const cmds = firstOfKind(extractResponseArtifacts('```sh\nls -la\n```'), 'commands');
    assert(!!cmds && cmds.commands!.length === 1, '(C) single-command shell fence surfaced');
  }

  // ─── (D) links extraction ───────────────────────────────────────────────────
  {
    const text = 'See https://a.example.com/one and https://b.example.com/two plus '
      + 'https://a.example.com/one again and https://c.example.com/three.';
    const links = firstOfKind(extractResponseArtifacts(text), 'links');
    assert(!!links, '(D) ≥3 distinct urls → links artifact');
    assertEq(links!.kind, 'links', '(D) kind is links');
    assert(Array.isArray(links!.urls), '(D) urls is an array');
    assertEq(links!.urls!.length, 3, '(D) duplicate url deduped → 3');
    assertIncludes(links!.content, 'https://a.example.com/one', '(D) content lists urls');
  }
  // <3 distinct urls → no links artifact
  {
    const arts = extractResponseArtifacts('Only https://x.example.com/a and https://y.example.com/b here.');
    assertEq(firstOfKind(arts, 'links'), undefined, '(D) <3 urls → no links artifact');
  }
  // exactly MIN_LINKS threshold
  {
    const text = 'https://p1.example.com https://p2.example.com https://p3.example.com';
    const links = firstOfKind(extractResponseArtifacts(text), 'links');
    assert(!!links && links.urls!.length === RESPONSE_ARTIFACT_MIN_LINKS, '(D) exactly MIN_LINKS surfaces');
  }
  // secret-safe: userinfo stripped, sensitive query redacted
  {
    const text = 'Links: https://user:pass@secret.example.com/p1 '
      + 'https://api.example.com/p2?token=abcdef123 https://plain.example.com/p3';
    const links = firstOfKind(extractResponseArtifacts(text), 'links');
    assert(!!links, '(D) secret-url set surfaces');
    assertExcludes(links!.content, 'user:pass', '(D) url userinfo stripped');
    assertExcludes(links!.content, 'pass@', '(D) no leftover credential marker');
    assertExcludes(links!.content, 'abcdef123', '(D) sensitive token query value redacted');
    assertIncludes(links!.content, 'REDACTED', '(D) redaction marker present');
    assertIncludes(links!.content, 'secret.example.com', '(D) host preserved');
  }

  // ─── (E) csv-ish code stays kind 'code' ─────────────────────────────────────
  {
    const arts = extractResponseArtifacts('```csv\nname,age\nalice,30\nbob,25\n```');
    const code = firstOfKind(arts, 'code');
    assert(!!code, '(E) csv fence produces an artifact');
    assertEq(code!.kind, 'code', '(E) csv stays kind code (caller upgrades to table)');
    assertEq(code!.language, 'csv', '(E) csv language preserved for the upgrade');
    assertEq(firstOfKind(arts, 'commands'), undefined, '(E) csv is not misread as commands');
    assertEq(firstOfKind(arts, 'diff'), undefined, '(E) csv is not misread as a diff');
  }

  // ─── (F) plan markdown is NOT emitted ───────────────────────────────────────
  {
    const plan = [
      '## Plan',
      '1. First refactor the router',
      '2. Then wire the new core',
      '- sub bullet a',
      '- sub bullet b',
      'Some closing prose about the plan.',
    ].join('\n');
    const arts = extractResponseArtifacts(plan);
    assertEq(arts.length, 0, '(F) plain plan markdown yields no artifacts');
  }

  // ─── (G) ordering + stable ids ──────────────────────────────────────────────
  {
    const text = [
      '# Title',
      '```ts',
      'export const a = 1;',
      '```',
      'Then a diff:',
      '```diff',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '```',
      'Docs: https://one.example.com https://two.example.com https://three.example.com',
    ].join('\n');
    const arts = extractResponseArtifacts(text);
    assert(allWellFormed(arts), '(G) ordering result well-formed');
    assertEq(arts.length, 3, '(G) three artifacts (code, diff, links)');
    assertEq(arts[0].kind, 'code', '(G) code appears first');
    assertEq(arts[1].kind, 'diff', '(G) diff appears second');
    assertEq(arts[2].kind, 'links', '(G) links appears last');
    assertEq(arts[0].id, 'artifact-0', '(G) stable id 0');
    assertEq(arts[1].id, 'artifact-1', '(G) stable id 1');
    assertEq(arts[2].id, 'artifact-2', '(G) stable id 2');
  }

  // ─── determinism ────────────────────────────────────────────────────────────
  {
    const text = '# H\n```ts\nconst a=1;\n```\ndiff:\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```\n'
      + 'https://one.example.com https://two.example.com https://three.example.com';
    assertEq(
      JSON.stringify(extractResponseArtifacts(text)),
      JSON.stringify(extractResponseArtifacts(text)),
      'determinism: identical input → identical output',
    );
    assertEq(
      JSON.stringify(extractResponseArtifacts('```bash\n$ a\n$ b\n```')),
      JSON.stringify(extractResponseArtifacts('```bash\n$ a\n$ b\n```')),
      'determinism: commands stable',
    );
  }

  // ─── safeArtifactBasename (direct, incl. path traversal) ────────────────────
  assertEq(safeArtifactBasename('../../etc/passwd'), 'passwd', 'basename: traversal reduced to basename');
  assertEq(safeArtifactBasename('/etc/shadow'), 'shadow', 'basename: absolute reduced to basename');
  assertEq(safeArtifactBasename('src\\win\\a.ts'), 'a.ts', 'basename: backslash separators handled');
  assertEq(safeArtifactBasename('..'), '', 'basename: all-dots rejected');
  assertEq(safeArtifactBasename('.'), '', 'basename: single dot rejected');
  assertEq(safeArtifactBasename('.env'), '.env', 'basename: dotfile kept');
  assertEq(safeArtifactBasename('a/b/c/'), 'c', 'basename: trailing slash trimmed');
  assertEq(safeArtifactBasename('foo' + NUL + ZWSP + RLO + '.ts'), 'foo.ts', 'basename: control/format chars dropped');
  assertEq(safeArtifactBasename(null), '', 'basename: null → ""');
  assertEq(safeArtifactBasename(42 as unknown), '', 'basename: number → ""');
  assert(safeArtifactBasename('x'.repeat(500)).length <= RESPONSE_ARTIFACT_FILENAME_MAX, 'basename: length capped');

  // filename hint via info string sanitized (traversal + format chars)
  {
    const code = firstOfKind(extractResponseArtifacts('```ts ../../etc/passwd\nconst a=1;\n```'), 'code');
    assertEq(code!.suggestedFilename, 'passwd', '(A/H) info-string traversal hint → safe basename');
  }
  {
    const code = firstOfKind(extractResponseArtifacts('```ts\n// filepath: /etc/shadow\nx()\n```'), 'code');
    assertEq(code!.suggestedFilename, 'shadow', '(A/H) filepath-comment absolute hint → safe basename');
  }

  // ─── (H) HOSTILE — never throws, always safe + bounded ──────────────────────
  const hugeCode = '```ts\n' + 'x'.repeat(2_000_000) + '\n```';
  const manyFences = Array.from({ length: 120 }, (_, i) => '```ts\ncode' + i + '();\n```').join('\n\n');
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  const throwingProxy = new Proxy({}, {
    get() { throw new Error('boom-get'); },
    has() { throw new Error('boom-has'); },
    ownKeys() { throw new Error('boom-keys'); },
    getOwnPropertyDescriptor() { throw new Error('boom-desc'); },
  });
  const ctrlText = '```ts' + BEL + ESC + '\nline' + NUL + LS + PS + DEL + TAG + BOM + '\n```';
  const surrogateBody = '```ts\nconst s = "' + LONE_SUR + '";\n```';
  const protoLang = '```__proto__\nevil()\n```';
  const ctorLang = '```constructor\nctor()\n```';
  const nested = '```` outer\n```\ninner\n```\nstill outer\n````';
  const adjacent = '```ts\na();\n```\n```js\nb();\n```';
  const protoKeyDoc = JSON.parse('{"__proto__":{"polluted":true},"text":"```ts\\nx();\\n```"}');

  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['boolean', true],
    ['empty-object', {}],
    ['array', []],
    ['bigint', 10n],
    ['symbol', Symbol('s')],
    ['empty-string', ''],
    ['whitespace', '   \n\t  '],
    ['cyclic', cyclic],
    ['throwing-proxy', throwingProxy],
    ['huge-2MB-code', hugeCode],
    ['120-fences', manyFences],
    ['control-chars', ctrlText],
    ['lone-surrogate-body', surrogateBody],
    ['proto-language', protoLang],
    ['constructor-language', ctorLang],
    ['nested-fences', nested],
    ['adjacent-fences', adjacent],
    ['proto-key-doc-value', protoKeyDoc && (protoKeyDoc as Record<string, unknown>).text],
    ['unclosed-diff', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a'],
    ['garbage-fence', '```\n```\n```\n```'],
    ['only-hashes', '### ### ###'],
    ['bidi-heading', '# ' + RLO + 'evil' + ZWSP + '\n```ts\nq();\n```'],
  ];

  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const arts = extractResponseArtifacts(input as unknown);
      assert(Array.isArray(arts), '(H) returns an array :: ' + label);
      assertLE(arts.length, RESPONSE_ARTIFACT_MAX, '(H) bounded artifact count :: ' + label);
      assert(allWellFormed(arts), '(H) every artifact well-formed + safe :: ' + label);
      for (const a of arts) {
        if (a.kind === 'commands') assertLE(a.commands!.length, RESPONSE_ARTIFACT_MAX_COMMANDS, '(H) commands bounded :: ' + label);
        if (a.kind === 'links') assertLE(a.urls!.length, RESPONSE_ARTIFACT_MAX_LINKS, '(H) urls bounded :: ' + label);
      }
    }, '(H) extractResponseArtifacts never throws :: ' + label);
  }

  // control chars are actually stripped from the surfaced title
  {
    const arts = extractResponseArtifacts(ctrlText);
    const code = firstOfKind(arts, 'code');
    if (code) {
      assert(isCleanLabel(code.title), '(H) title control/format-char-free');
      assert(!hasLoneSurrogate(code.content), '(H) body has no lone surrogate');
    }
    assert(true, '(H) control-char input handled');
  }
  // bidi heading → clean title, no bidi override
  {
    const code = firstOfKind(extractResponseArtifacts('# ' + RLO + 'Title' + ZWSP + '\n```ts\nq();\n```'), 'code');
    assert(!!code, '(H) bidi-heading still yields code');
    assert(isCleanLabel(code!.title), '(H) bidi/zero-width stripped from title');
    assertExcludes(code!.title, RLO, '(H) no bidi override in title');
  }
  // huge body clamped
  {
    const code = firstOfKind(extractResponseArtifacts(hugeCode), 'code');
    assert(!!code, '(H) huge fence yields a code artifact');
    assertLE(cpLen(code!.content), RESPONSE_ARTIFACT_CONTENT_MAX + 1, '(H) huge body clamped to cap (+ellipsis)');
  }
  // many fences capped
  {
    const arts = extractResponseArtifacts(manyFences);
    assertLE(arts.length, RESPONSE_ARTIFACT_MAX, '(H) 120 fences capped to RESPONSE_ARTIFACT_MAX');
  }
  // __proto__ / constructor language → no prototype pollution
  {
    extractResponseArtifacts(protoLang);
    extractResponseArtifacts(ctorLang);
    extractResponseArtifacts(protoKeyDoc && (protoKeyDoc as Record<string, unknown>).text);
    assert(({} as Record<string, unknown>).polluted === undefined, '(H) no Object.prototype pollution (instance)');
    assert((Object.prototype as Record<string, unknown>).polluted === undefined, '(H) Object.prototype untouched');
    const code = firstOfKind(extractResponseArtifacts(protoLang), 'code');
    assertEq(code!.language, '__proto__', '(H) __proto__ language survives as a plain string (no lookup hazard)');
  }
  // adjacent fences → two artifacts
  {
    const arts = extractResponseArtifacts(adjacent);
    assertEq(arts.length, 2, '(H) adjacent fences → 2 code artifacts');
    assertEq(arts[0].language, 'ts', '(H) adjacent fence 0 language');
    assertEq(arts[1].language, 'js', '(H) adjacent fence 1 language');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll response-artifact-extract-core smoke cases passed (' + passes + ' passed).');
}

main();
