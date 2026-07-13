// diffHunkSelectCore — the PURE "per-hunk accept/reject" code-review primitive
// (the Cursor / Claude-Code partial-apply brain). A reviewer is shown a unified
// diff, parsed into per-file hunks; they accept or reject individual hunks; the
// core reconstructs a valid, internally-consistent unified diff of only the kept
// hunks — with RECOMPUTED `@@` headers and re-sequenced new-side offsets.
//
// Four pure functions do all the work; the runtime (chat/review UI) does the I/O:
//   1. parseUnifiedDiff — multi-file `diff --git` sections → ParsedFileDiff[]
//      (preamble lines + typed hunks). Best-effort: malformed input never throws.
//   2. selectHunks — keep only the accepted (file,hunk) pairs; drop emptied files.
//   3. reconstructDiff — emit preamble + kept hunks, recomputing each `@@` header
//      line count from the body and re-sequencing new-side start offsets so the
//      emitted patch is self-consistent even after some hunks were dropped.
//   4. summarizeHunks — "N files · M hunks · +A -B".
//
// PURITY: zero imports, tsx-loadable (smoke: diff-hunk-select-core). No clock, no
// filesystem, no randomness → deterministic. NEVER throws — a garbage diff yields
// [] and a header with missing counts is treated as a length of 1.

export interface DiffHunk {
  /** 0-based position of this hunk within its file (stable identity for select). */
  index: number;
  /** The raw `@@ -A,B +C,D @@ ...` header line as parsed (context text preserved). */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Raw body lines, each keeping its leading ' ', '+', or '-' (or '\' for the
   *  "\ No newline at end of file" marker). */
  lines: string[];
}

export interface ParsedFileDiff {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  /** The `diff --git` / `index` / `---` / `+++` header lines for this file, in
   *  order, so reconstruction can re-emit the file section verbatim. */
  preamble: string[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toText(diff: unknown): string {
  return typeof diff === 'string' ? diff : '';
}

/** Split into lines without a trailing empty element from a final newline, but
 *  keep genuine interior blank lines. */
function splitLines(text: string): string[] {
  if (!text) return [];
  // Normalize CRLF/CR → LF for parsing; emission uses '\n'.
  const norm = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = norm.split('\n');
  // Drop exactly one trailing empty produced by a terminal newline.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Parse a positive integer, defaulting when absent/NaN (used for count defaults). */
function intOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const HUNK_RE = /^@@+\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@+/;
// `diff --git a/path b/path` — capture both sides (paths may contain spaces, so
// we take a greedy-but-split approach: everything after "a/" up to " b/").
const GIT_HEADER_RE = /^diff --git a\/(.*) b\/(.*)$/;
const OLD_PATH_RE = /^--- (?:a\/)?(.*)$/;
const NEW_PATH_RE = /^\+\+\+ (?:b\/)?(.*)$/;

function stripTab(p: string): string {
  // `--- a/foo.ts\t2026-01-01` style timestamps → drop the tab suffix.
  const t = p.indexOf('\t');
  return t >= 0 ? p.slice(0, t) : p;
}

function emptyFile(): ParsedFileDiff {
  return { oldPath: '', newPath: '', hunks: [], preamble: [] };
}

// ── parse ───────────────────────────────────────────────────────────────────

/**
 * Parse a unified diff (possibly multi-file) into typed per-file diffs. Best
 * effort and never throws: unrecognized leading noise is ignored, a hunk header
 * with missing counts defaults that count to 1, and body lines are captured
 * verbatim (leading space/±/`\`). Empty/whitespace/garbage input → [].
 */
export function parseUnifiedDiff(diff: string): ParsedFileDiff[] {
  const lines = splitLines(toText(diff));
  const files: ParsedFileDiff[] = [];
  let file: ParsedFileDiff | null = null;
  let hunk: DiffHunk | null = null;

  const flushHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = null;
  };
  const flushFile = () => {
    flushHunk();
    if (file && (file.hunks.length || file.preamble.length)) files.push(file);
    file = null;
  };

  for (const line of lines) {
    const gitMatch = GIT_HEADER_RE.exec(line);
    if (gitMatch) {
      // Start a brand-new file section.
      flushFile();
      file = emptyFile();
      file.oldPath = stripTab(gitMatch[1] ?? '');
      file.newPath = stripTab(gitMatch[2] ?? '');
      file.preamble.push(line);
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      // A hunk can appear without a `diff --git` line (plain `diff -u` output):
      // synthesize a file from the most recent ---/+++ if needed.
      if (!file) file = emptyFile();
      flushHunk();
      hunk = {
        index: file.hunks.length,
        header: line,
        oldStart: intOr(hunkMatch[1], 0),
        oldLines: intOr(hunkMatch[2], 1),
        newStart: intOr(hunkMatch[3], 0),
        newLines: intOr(hunkMatch[4], 1),
        lines: [],
      };
      continue;
    }

    if (hunk) {
      // Inside a hunk body. Recognized body lines start with ' ', '+', '-', or
      // '\' (the no-newline marker). Anything else ends the hunk (defensive).
      const c = line[0];
      if (c === ' ' || c === '+' || c === '-' || c === '\\') {
        hunk.lines.push(line);
        continue;
      }
      // Unrecognized line: fall through so header handlers below can catch it.
      flushHunk();
    }

    // Preamble / metadata lines for the current (or a starting) file.
    const oldMatch = OLD_PATH_RE.exec(line);
    if (oldMatch) {
      if (!file) file = emptyFile();
      if (!file.oldPath) file.oldPath = stripTab(oldMatch[1] ?? '');
      file.preamble.push(line);
      continue;
    }
    const newMatch = NEW_PATH_RE.exec(line);
    if (newMatch) {
      if (!file) file = emptyFile();
      if (!file.newPath) file.newPath = stripTab(newMatch[1] ?? '');
      file.preamble.push(line);
      continue;
    }

    // `index …`, `new file mode …`, `similarity …`, etc. — keep as preamble if a
    // file is open; ignore stray leading noise otherwise.
    if (file) file.preamble.push(line);
  }
  flushFile();
  return files;
}

// ── select ────────────────────────────────────────────────────────────────────

/**
 * Return a NEW ParsedFileDiff[] containing only the accepted (file,hunk) pairs.
 * `file`/`hunk` are the 0-based indices from parseUnifiedDiff. Files that end up
 * with zero kept hunks are dropped; preamble/paths are preserved for kept files.
 * Never throws; out-of-range / malformed selections are ignored.
 */
export function selectHunks(
  files: ParsedFileDiff[],
  accepted: Array<{ file: number; hunk: number }>,
): ParsedFileDiff[] {
  const src = Array.isArray(files) ? files : [];
  const picks = Array.isArray(accepted) ? accepted : [];

  // fileIndex → Set of accepted hunk indices.
  const byFile = new Map<number, Set<number>>();
  for (const p of picks) {
    if (!p || typeof p !== 'object') continue;
    const f = Number(p.file);
    const h = Number(p.hunk);
    if (!Number.isInteger(f) || !Number.isInteger(h)) continue;
    let set = byFile.get(f);
    if (!set) { set = new Set(); byFile.set(f, set); }
    set.add(h);
  }

  const out: ParsedFileDiff[] = [];
  for (let fi = 0; fi < src.length; fi += 1) {
    const file = src[fi];
    if (!file || !Array.isArray(file.hunks)) continue;
    const keep = byFile.get(fi);
    if (!keep || keep.size === 0) continue;
    const keptHunks: DiffHunk[] = [];
    for (const hk of file.hunks) {
      if (hk && keep.has(hk.index)) {
        // Clone so callers can't mutate the source; keep the ORIGINAL index so
        // identity is stable, reconstruct re-sequences offsets separately.
        keptHunks.push({ ...hk, lines: [...hk.lines] });
      }
    }
    if (keptHunks.length === 0) continue;
    out.push({
      oldPath: file.oldPath,
      newPath: file.newPath,
      preamble: [...(file.preamble ?? [])],
      hunks: keptHunks,
    });
  }
  return out;
}

// ── count + reconstruct ─────────────────────────────────────────────────────

/** Count old-side (' ' + '-') and new-side (' ' + '+') lines in a hunk body.
 *  The `\ No newline …` marker and any stray lines are ignored. */
function countBody(bodyLines: string[]): { old: number; neu: number } {
  let oldN = 0;
  let newN = 0;
  for (const l of bodyLines) {
    const c = l[0];
    if (c === ' ') { oldN += 1; newN += 1; }
    else if (c === '-') { oldN += 1; }
    else if (c === '+') { newN += 1; }
  }
  return { old: oldN, neu: newN };
}

/** Preserve any trailing context after the closing `@@` of the original header
 *  (e.g. `@@ -1,3 +1,3 @@ function foo()`), which git uses as a section hint. */
function headerTrailer(header: string): string {
  const m = /^@@+[^@]*@@+(.*)$/.exec(header ?? '');
  const rest = m ? m[1] : '';
  return rest && rest.length ? rest : '';
}

/** Format one hunk's `@@` header with RECOMPUTED counts. Omit the count when it
 *  is exactly 1 to match git's canonical short form (`@@ -1 +1 @@`). */
function formatHeader(oldStart: number, oldLines: number, newStart: number, newLines: number, trailer: string): string {
  const oldSeg = oldLines === 1 ? `${oldStart}` : `${oldStart},${oldLines}`;
  const newSeg = newLines === 1 ? `${newStart}` : `${newStart},${newLines}`;
  return `@@ -${oldSeg} +${newSeg} @@${trailer}`;
}

/**
 * Emit a valid unified diff for the kept hunks. For each file: re-emit its
 * preamble verbatim, then each hunk with a RECOMPUTED header. Old-side starts are
 * preserved from the parsed hunk (they still refer to the original left file);
 * new-side starts are RE-SEQUENCED so that, after dropping some hunks, the
 * resulting patch is internally consistent (each hunk's newStart = previous
 * newStart + previous newLines, offset by the running old/new delta). Never
 * throws. The output ends with a trailing newline when non-empty.
 */
export function reconstructDiff(files: ParsedFileDiff[]): string {
  const src = Array.isArray(files) ? files : [];
  const outLines: string[] = [];

  for (const file of src) {
    if (!file) continue;
    const hunks = Array.isArray(file.hunks) ? file.hunks : [];
    // A file with preamble but no hunks contributes nothing meaningful to a
    // hunk-selection patch — skip it so summaries/round-trips stay clean.
    if (hunks.length === 0) continue;

    for (const l of file.preamble ?? []) outLines.push(l);

    // Running delta between new-side and old-side positions across kept hunks.
    // Start so the first kept hunk keeps its original newStart relative to its
    // oldStart, then accumulate the size change each hunk introduces.
    let delta: number | null = null;
    for (const hunk of hunks) {
      if (!hunk) continue;
      const body = Array.isArray(hunk.lines) ? hunk.lines : [];
      const { old: oldLines, neu: newLines } = countBody(body);
      const oldStart = Number.isFinite(hunk.oldStart) ? hunk.oldStart : 1;

      if (delta === null) {
        // Seed from the original relationship of the FIRST kept hunk so a fully
        // accepted single hunk round-trips exactly.
        const origNewStart = Number.isFinite(hunk.newStart) ? hunk.newStart : oldStart;
        delta = origNewStart - oldStart;
      }
      const newStart = oldStart + delta;
      const trailer = headerTrailer(hunk.header);
      outLines.push(formatHeader(oldStart, oldLines, newStart, newLines, trailer));
      for (const bl of body) outLines.push(bl);

      // After this hunk, the new side has grown by (newLines - oldLines).
      delta += newLines - oldLines;
    }
  }

  if (outLines.length === 0) return '';
  return `${outLines.join('\n')}\n`;
}

// ── summarize ──────────────────────────────────────────────────────────────

/**
 * One-line summary: `"N files · M hunks · +A -B"` where A/B are total added /
 * removed body lines across all hunks. Never throws.
 */
export function summarizeHunks(files: ParsedFileDiff[]): string {
  const src = Array.isArray(files) ? files : [];
  let fileCount = 0;
  let hunkCount = 0;
  let added = 0;
  let removed = 0;
  for (const file of src) {
    if (!file || !Array.isArray(file.hunks) || file.hunks.length === 0) continue;
    fileCount += 1;
    for (const hunk of file.hunks) {
      if (!hunk) continue;
      hunkCount += 1;
      for (const l of Array.isArray(hunk.lines) ? hunk.lines : []) {
        const c = l[0];
        if (c === '+') added += 1;
        else if (c === '-') removed += 1;
      }
    }
  }
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return `${plural(fileCount, 'file')} · ${plural(hunkCount, 'hunk')} · +${added} -${removed}`;
}
