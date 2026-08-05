// verify-a11y-codebase — a DETERMINISTIC, model-free golden-case corpus module
// extending the tier-1 eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN ADD #1:
// "an eval CI merge-gate … the safety net that makes every consolidation safe").
//
// Same shape/contract as evals/coreGoldenCorpus.ts: each `CoreGoldenCase.run()`
// executes a REAL pure core on a FROZEN input and returns `true` iff the output
// equals the pinned GOLDEN value. Every golden below was CAPTURED from the real
// core output (throwaway `npx tsx` probe), never invented — so any behavioral
// drift in a covered core flips a case pass→fail and the aggregator exits nonzero.
//
// This module covers four load-bearing cores the a11y/codebase surfaces depend on:
//   • verificationDiagnosticsCore — turns raw tsc/eslint/jest output into a
//     compact, error-biased summary so a failed `verification.*` tool never
//     leaves the model blind.
//   • a11yTargetResolverCore     — resolves a durable label ("Export") to the
//     authoritative accessibility element (SoM index + path) at read time.
//   • codebaseSymbolCore         — extracts declaration symbols / leading-doc
//     summary / embed text per file for the codebase index.
//   • codebaseMentionsCore       — parses & resolves `@file:` / `@symbol:`
//     Cursor-style mentions against the indexed file list.
//
// PURITY EXCEPTION (spec-sanctioned, same as the sibling corpus): this module
// IMPORTS those cores AT RUNTIME — that is the whole point. Every imported core
// is dependency-light + tsx-loadable (verified), so this runs under tsx with no
// react-native / supabase / deno in the graph. No Date.now()/Math.random() at
// module scope. Each run() is self-contained + defensive (JSON.stringify deep-eq
// or explicit field/substring checks) and never depends on the live app state.

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import {
  summarizeDiagnostics,
  parseDiagnostics,
  countDiagnostics,
} from '../../src/lib/verificationDiagnosticsCore';
import {
  resolveA11yTarget,
  parseA11yLines,
} from '../../src/lib/a11yTargetResolverCore';
import {
  extractCodebaseSymbols,
  extractCodebaseSummary,
  buildCodebaseEmbedText,
} from '../../src/lib/codebaseSymbolCore';
import {
  parseCodebaseMentions,
  resolveCodebaseMentions,
  describeResolvedMentions,
} from '../../src/lib/codebaseMentionsCore';

// ─── Tiny defensive deep-equal (bounded via JSON.stringify; never throws) ──────
function sEq(actual: unknown, golden: unknown): boolean {
  try {
    return JSON.stringify(actual) === JSON.stringify(golden);
  } catch {
    return false;
  }
}

// ─── Frozen inputs (shared by cases; identical to the capture probe) ───────────

// A single tsc diagnostic line (`file(line,col): error TSxxxx: message`).
const TSC_LINE = "src/x.ts(12,5): error TS2304: Cannot find name 'foo'.";

// Rendered a11y tree lines (renderA11yTree shape: `[#N] [path] AXRole "Label"`).
const A11Y_LINES: readonly string[] = [
  'Accessibility tree:',
  '  [#7] [1.2.4.0] AXButton "Export"',
  '  [#8] [1.2.5.0] AXButton "Cancel"',
];
// Two nodes carrying the SAME label → the ambiguous tier.
const A11Y_AMBIGUOUS: readonly string[] = [
  '  [#7] [1.2.4.0] AXButton "Export"',
  '  [#9] [1.2.6.0] AXMenuItem "Export"',
];
// A node matchable only by ROLE (its label differs from the target).
const A11Y_ROLE_ONLY: readonly string[] = [
  '  [#5] [1.0.0.0] AXButton "Save"',
  '  [#6] [1.0.1.0] AXSlider "Volume"',
];
// A node with a [path] but no SoM [#N] index (act-by-path branch).
const A11Y_NO_INDEX: readonly string[] = ['[1.2.4.0] AXButton "Export"'];

// A TS file exercising every declaration kind the extractor recognizes.
const TS_SOURCE = [
  '// leading doc line one',
  '// leading doc line two',
  'export function alpha() {}',
  'export class Beta {}',
  'export interface Gamma {}',
  'export const delta = () => {};',
  'function helper() {}',
].join('\n');
// A leading /** */ block comment (em-dash written as — for byte-exactness).
const TS_BLOCK_DOC = [
  '/**',
  ' * The widget module — does a thing.',
  ' * Second line of doc.',
  ' */',
  'export function w() {}',
].join('\n');
const PY_SOURCE = 'def foo():\n    pass\nclass Bar:\n    pass';
const MD_SOURCE = '# Title Heading\n\nFirst paragraph here.\n\n## Second';

// Indexed RankableFile rows for the mention-resolution cases.
const INDEX_FILES: ReadonlyArray<{ path: string; symbols: string[] }> = [
  { path: 'src/lib/foo.ts', symbols: ['alpha', 'Beta'] },
  { path: 'src/lib/bar.ts', symbols: ['gamma'] },
];

// ─── The corpus ────────────────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ── suite: verification-diagnostics (verificationDiagnosticsCore) ────────────
  {
    id: 'verify-a11y-codebase-verification-diag-tsc-error-summarized',
    suite: 'verification-diagnostics',
    describe:
      'summarizeDiagnostics turns a raw tsc error line into a header ("1 error, 0 warnings:") plus a structured file:line:col code message line',
    run: () =>
      summarizeDiagnostics(TSC_LINE) ===
      "1 error, 0 warnings:\nsrc/x.ts:12:5 TS2304 Cannot find name 'foo'.",
  },
  {
    id: 'verify-a11y-codebase-verification-diag-empty-is-clean',
    suite: 'verification-diagnostics',
    describe: 'an empty / whitespace-only verification output summarizes to the empty string (no diagnostics → clean)',
    run: () => summarizeDiagnostics('') === '' && summarizeDiagnostics('   \n  ') === '',
  },
  {
    id: 'verify-a11y-codebase-verification-diag-eslint-error-biased-order',
    suite: 'verification-diagnostics',
    describe:
      'eslint errors are listed before warnings (error-biased), the rule id is peeled onto the code slot, and warnings carry a "warn" prefix',
    run: () =>
      summarizeDiagnostics(
        '/path/file.ts:12:5 error Unexpected var no-var\n/path/file.ts:3:1 warning Missing semi semi',
      ) ===
      '1 error, 1 warning:\n/path/file.ts:12:5 no-var Unexpected var\nwarn /path/file.ts:3:1 Missing semi semi',
  },
  {
    id: 'verify-a11y-codebase-verification-diag-jest-fail-summarized',
    suite: 'verification-diagnostics',
    describe: 'a jest FAIL header + failing-test bullet both surface as errors in the summary',
    run: () =>
      summarizeDiagnostics('FAIL src/a.test.ts\n  ✕ adds numbers (3 ms)') ===
      '2 errors, 0 warnings:\nsrc/a.test.ts test file failed\nadds numbers',
  },
  {
    id: 'verify-a11y-codebase-verification-diag-parse-structured-diagnostic',
    suite: 'verification-diagnostics',
    describe: 'parseDiagnostics distills a tsc line into a fully-typed Diagnostic (file/line/col/code/message/severity)',
    run: () =>
      sEq(parseDiagnostics(TSC_LINE), [
        { file: 'src/x.ts', line: 12, col: 5, code: 'TS2304', message: "Cannot find name 'foo'.", severity: 'error' },
      ]),
  },
  {
    id: 'verify-a11y-codebase-verification-diag-count-by-severity',
    suite: 'verification-diagnostics',
    describe: 'countDiagnostics buckets a mixed error+warning blob into {errors:1, warnings:1}',
    run: () => {
      const c = countDiagnostics(
        "src/x.ts(12,5): error TS2304: Cannot find name 'foo'.\nsrc/y.ts(3,1): warning TS6133: 'z' is declared but never used.",
      );
      return c.errors === 1 && c.warnings === 1;
    },
  },
  {
    id: 'verify-a11y-codebase-verification-diag-nonparse-fallback-tail',
    suite: 'verification-diagnostics',
    describe: 'output that parses to zero diagnostics but is non-empty yields a bounded, labeled fallback tail (never leaves the model blind)',
    run: () =>
      summarizeDiagnostics('just some noise line one\nnoise line two') ===
      '[no structured diagnostics parsed; last output]\njust some noise line one\nnoise line two',
  },

  // ── suite: a11y-target-resolver (a11yTargetResolverCore) ─────────────────────
  {
    id: 'verify-a11y-codebase-a11y-resolve-unique-label-to-element',
    suite: 'a11y-target-resolver',
    describe: 'a unique exact-label match resolves to found=true with its SoM elementIndex, path, and role, and the note prefers elementIndex over the bare path',
    run: () => {
      const r = resolveA11yTarget('Export', A11Y_LINES);
      return (
        r.found === true &&
        r.ambiguous === false &&
        r.candidates === 1 &&
        r.elementIndex === 7 &&
        r.path === '1.2.4.0' &&
        r.role === 'AXButton' &&
        typeof r.note === 'string' &&
        r.note.includes('elementIndex 7') &&
        r.note.includes('do not reuse a bare path')
      );
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-ambiguous-label-fails-closed',
    suite: 'a11y-target-resolver',
    describe: 'two elements sharing the label return found=false, ambiguous=true, candidates=2 (the documented ambiguity fallback)',
    run: () => {
      const r = resolveA11yTarget('Export', A11Y_AMBIGUOUS);
      return (
        r.found === false &&
        r.ambiguous === true &&
        r.candidates === 2 &&
        typeof r.note === 'string' &&
        r.note.includes('ambiguous')
      );
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-no-match-not-found',
    suite: 'a11y-target-resolver',
    describe: 'a label matching nothing returns found=false, ambiguous=false, candidates=0',
    run: () => {
      const r = resolveA11yTarget('Nonexistent', A11Y_LINES);
      return (
        r.found === false &&
        r.ambiguous === false &&
        r.candidates === 0 &&
        typeof r.note === 'string' &&
        r.note.includes('No accessibility element matched')
      );
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-empty-target-guarded',
    suite: 'a11y-target-resolver',
    describe: 'an empty target label is rejected with the fixed "provide a non-empty target" guidance (never throws)',
    run: () => {
      const r = resolveA11yTarget('', A11Y_LINES);
      return r.found === false && r.note === 'Provide a non-empty target label or role to resolve.';
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-resolve-by-role-tier',
    suite: 'a11y-target-resolver',
    describe: 'when no label matches, a unique AX-prefix-tolerant role match ("button" → AXButton) resolves the element',
    run: () => {
      const r = resolveA11yTarget('button', A11Y_ROLE_ONLY);
      return (
        r.found === true &&
        r.candidates === 1 &&
        r.elementIndex === 5 &&
        r.path === '1.0.0.0' &&
        r.role === 'AXButton'
      );
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-path-without-som-index',
    suite: 'a11y-target-resolver',
    describe: 'a node with a path but no SoM [#N] index resolves by path only (no elementIndex) and the note tells the caller to re-read for a stable index',
    run: () => {
      const r = resolveA11yTarget('Export', A11Y_NO_INDEX);
      return (
        r.found === true &&
        r.elementIndex === undefined &&
        r.path === '1.2.4.0' &&
        r.role === 'AXButton' &&
        typeof r.note === 'string' &&
        r.note.includes('re-read')
      );
    },
  },
  {
    id: 'verify-a11y-codebase-a11y-parse-lines-to-nodes',
    suite: 'a11y-target-resolver',
    describe: 'parseA11yLines turns rendered tree lines into typed nodes (index/path/role/label), skipping the header line',
    run: () =>
      sEq(parseA11yLines(A11Y_LINES), [
        { index: 7, path: '1.2.4.0', role: 'AXButton', label: 'Export' },
        { index: 8, path: '1.2.5.0', role: 'AXButton', label: 'Cancel' },
      ]),
  },

  // ── suite: codebase-symbol (codebaseSymbolCore) ──────────────────────────────
  {
    id: 'verify-a11y-codebase-symbol-extract-ts-ordered-deduped',
    suite: 'codebase-symbol',
    describe: 'extractCodebaseSymbols pulls every TS declaration kind (function/class/interface/const-arrow/plain-function) in first-seen order',
    run: () => sEq(extractCodebaseSymbols(TS_SOURCE, 'typescript'), ['alpha', 'Beta', 'Gamma', 'delta', 'helper']),
  },
  {
    id: 'verify-a11y-codebase-symbol-extract-empty-neutral',
    suite: 'codebase-symbol',
    describe: 'empty file content extracts to an empty symbol list (total on degenerate input)',
    run: () => sEq(extractCodebaseSymbols('', 'typescript'), []),
  },
  {
    id: 'verify-a11y-codebase-symbol-extract-python-def-class',
    suite: 'codebase-symbol',
    describe: 'the python pattern set extracts def and class names',
    run: () => sEq(extractCodebaseSymbols(PY_SOURCE, 'python'), ['foo', 'Bar']),
  },
  {
    id: 'verify-a11y-codebase-symbol-extract-markdown-headings',
    suite: 'codebase-symbol',
    describe: 'markdown symbol extraction returns the H1-H3 heading texts',
    run: () => sEq(extractCodebaseSymbols(MD_SOURCE, 'markdown'), ['Title Heading', 'Second']),
  },
  {
    id: 'verify-a11y-codebase-symbol-summary-block-comment',
    suite: 'codebase-symbol',
    describe: 'extractCodebaseSummary strips a leading /** */ block comment to its collapsed prose',
    run: () => extractCodebaseSummary(TS_BLOCK_DOC, 'typescript') === 'The widget module — does a thing. Second line of doc.',
  },
  {
    id: 'verify-a11y-codebase-symbol-embed-text-deterministic',
    suite: 'codebase-symbol',
    describe: 'buildCodebaseEmbedText composes path + language + symbols + summary into the fixed newline-separated embed input',
    run: () =>
      buildCodebaseEmbedText({
        path: 'src/lib/foo.ts',
        language: 'typescript',
        symbols: ['alpha', 'Beta'],
        summary: 'Does a thing.',
      }) === 'src/lib/foo.ts\nlanguage: typescript\nsymbols: alpha, Beta\nDoes a thing.',
  },

  // ── suite: codebase-mentions (codebaseMentionsCore) ──────────────────────────
  {
    id: 'verify-a11y-codebase-mentions-parse-file',
    suite: 'codebase-mentions',
    describe: 'parseCodebaseMentions parses a bare "@file:path" into {kind:file, raw, value}',
    run: () =>
      sEq(parseCodebaseMentions('@file:src/lib/foo.ts'), [
        { kind: 'file', raw: '@file:src/lib/foo.ts', value: 'src/lib/foo.ts' },
      ]),
  },
  {
    id: 'verify-a11y-codebase-mentions-plain-text-none',
    suite: 'codebase-mentions',
    describe: 'plain text with no @file/@symbol token parses to no mentions',
    run: () => sEq(parseCodebaseMentions('just some plain text with no mentions'), []),
  },
  {
    id: 'verify-a11y-codebase-mentions-midword-guard',
    suite: 'codebase-mentions',
    describe: 'an "@file:" glued to a preceding alphanumeric (email-like "x@file:y") is NOT parsed as a mention',
    run: () => sEq(parseCodebaseMentions('email x@file:y.com nope'), []),
  },
  {
    id: 'verify-a11y-codebase-mentions-quoted-value-with-spaces',
    suite: 'codebase-mentions',
    describe: 'a double-quoted mention value captures a path containing spaces, unquoted',
    run: () =>
      sEq(parseCodebaseMentions('see @file:"src/my file.ts" please'), [
        { kind: 'file', raw: '@file:"src/my file.ts"', value: 'src/my file.ts' },
      ]),
  },
  {
    id: 'verify-a11y-codebase-mentions-trailing-punctuation-stripped',
    suite: 'codebase-mentions',
    describe: 'trailing sentence punctuation is stripped from a bare value and excluded from raw',
    run: () =>
      sEq(parseCodebaseMentions('look at @symbol:applyFileEdits.'), [
        { kind: 'symbol', raw: '@symbol:applyFileEdits', value: 'applyFileEdits' },
      ]),
  },
  {
    id: 'verify-a11y-codebase-mentions-resolve-exact',
    suite: 'codebase-mentions',
    describe: 'resolveCodebaseMentions maps an exact @file path and an exact @symbol name to their indexed files with status "exact"',
    run: () => {
      const parsed = parseCodebaseMentions('@file:src/lib/foo.ts and @symbol:alpha');
      return sEq(resolveCodebaseMentions(parsed, INDEX_FILES), [
        {
          mention: { kind: 'file', raw: '@file:src/lib/foo.ts', value: 'src/lib/foo.ts' },
          status: 'exact',
          matches: [{ path: 'src/lib/foo.ts', score: 1 }],
        },
        {
          mention: { kind: 'symbol', raw: '@symbol:alpha', value: 'alpha' },
          status: 'exact',
          matches: [{ path: 'src/lib/foo.ts', score: 1, matchedSymbol: 'alpha' }],
        },
      ]);
    },
  },
  {
    id: 'verify-a11y-codebase-mentions-describe-block',
    suite: 'codebase-mentions',
    describe: 'describeResolvedMentions renders the compact one-line-per-mention block, appending #symbol for symbol hits',
    run: () => {
      const parsed = parseCodebaseMentions('@file:src/lib/foo.ts and @symbol:alpha');
      return (
        describeResolvedMentions(resolveCodebaseMentions(parsed, INDEX_FILES)) ===
        '@file:src/lib/foo.ts → src/lib/foo.ts (exact)\n@symbol:alpha → src/lib/foo.ts#alpha (exact)'
      );
    },
  },
];
