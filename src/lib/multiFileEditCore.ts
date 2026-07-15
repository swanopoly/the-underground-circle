// multiFileEditCore — TRANSACTIONAL multi-file edit planner. A coding agent that
// edits several files one-at-a-time fails HALF-WAY: file 1 and 2 are already
// written to disk when file 3's oldString turns out not to match, leaving the
// working tree torn (some files changed, some not) — the dominant failure mode of
// sequential single-file edits. This plans + validates EVERY file's edits against
// its already-read content BEFORE any write, so a match/uniqueness failure is
// caught while NOTHING has changed on disk. `ok` is true only when EVERY file's
// edits apply cleanly (atomic all-or-nothing); the first failure names the file and
// reason, and NO file is considered applied.
//
// Per-file matching is delegated to the PURE fileEditCore.applyFileEdits, so this
// layer inherits the exact-match + UNIQUENESS + literal-replacement + create-mode
// contract and only owns cross-file atomicity, bounds, and the summary.
//
// PURITY: the only import is the zero-import, tsx-loadable ./fileEditCore. This
// module does NOT touch the filesystem — a bridge tool (desktop.edit_files) reads
// all files, calls planMultiFileEdits, and writes ALL files only when ok. Never
// throws: every export is TOTAL (null/undefined/wrong-type/huge/hostile → safe
// neutral) with bounded output. No Date.now()/Math.random().

import { applyFileEdits, type FileEditResult } from './fileEditCore';

/** One file's requested edits (same single-file edit shape as fileEditCore). */
export interface FileEditSpec {
  path: string;
  edits: Array<{ oldString: string; newString: string; replaceAll?: boolean }>;
}

/** The planned outcome for one file (no disk write happens here). */
export interface FilePlanResult {
  path: string;
  ok: boolean;
  /** Failure reason (set only when ok is false). */
  error?: string;
  /** Planned new content (set only when ok is true) — what the caller would write. */
  newContent?: string;
  /** Substrings replaced in this file (0 on failure). */
  replacements: number;
}

/** The whole-batch plan. `ok` is the atomic AND of every file's ok. */
export interface MultiFilePlan {
  ok: boolean;
  files: FilePlanResult[];
  /** First file that could not be planned (set only when ok is false). */
  failedPath?: string;
  /** Reason the plan is blocked (set only when ok is false). */
  reason?: string;
}

/** Cap files in one transaction — a larger batch is rejected, never truncated
 *  (silently dropping files would break the all-or-nothing contract). */
export const MAX_FILES_PER_PLAN = 50;
/** Outer bound on edits per file at this layer (fileEditCore caps a single batch
 *  lower still; this just refuses a hostile array before delegating). */
export const MAX_EDITS_PER_FILE = 200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own-property string lookup for the read-content map. Inherited keys (e.g.
 *  'constructor', '__proto__') read as absent, and a non-string value reads as
 *  undefined — undefined tells fileEditCore the file does not exist yet (create). */
function readContentFor(readContents: unknown, path: string): string | undefined {
  if (!isPlainObject(readContents)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(readContents, path)) return undefined;
  const v = readContents[path];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Plan an atomic multi-file edit. For each file, its edits are applied (via the
 * pure fileEditCore.applyFileEdits) against readContents[path] to produce the
 * planned newContent. The plan is ok ONLY if every file applies cleanly; the first
 * failure sets ok:false + failedPath + reason. Never throws; bounded work.
 */
export function planMultiFileEdits(input: {
  files: FileEditSpec[];
  readContents: Record<string, string>;
}): MultiFilePlan {
  const inp = input as unknown;
  if (!isPlainObject(inp)) {
    return { ok: false, files: [], reason: 'input must be an object with { files, readContents }' };
  }
  const filesRaw: unknown = inp.files;
  const readContents: unknown = inp.readContents;
  if (!Array.isArray(filesRaw)) {
    return { ok: false, files: [], reason: 'files must be an array of { path, edits }' };
  }
  if (filesRaw.length === 0) {
    return { ok: false, files: [], reason: 'no files to edit' };
  }
  if (filesRaw.length > MAX_FILES_PER_PLAN) {
    return {
      ok: false,
      files: [],
      reason: `too many files in one batch (${filesRaw.length} > ${MAX_FILES_PER_PLAN})`,
    };
  }

  const results: FilePlanResult[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < filesRaw.length; i += 1) {
    const spec: unknown = filesRaw[i];
    const specObj = isPlainObject(spec) ? spec : null;
    const path = specObj && typeof specObj.path === 'string' ? specObj.path : '';
    if (!path) {
      results.push({ path: '', ok: false, error: `file ${i}: missing or non-string path`, replacements: 0 });
      continue;
    }
    if (seenPaths.has(path)) {
      results.push({ path, ok: false, error: 'duplicate path in batch (a file may appear only once)', replacements: 0 });
      continue;
    }
    seenPaths.add(path);

    const edits: unknown = specObj ? specObj.edits : undefined;
    if (Array.isArray(edits) && edits.length > MAX_EDITS_PER_FILE) {
      results.push({
        path,
        ok: false,
        error: `too many edits for one file (${edits.length} > ${MAX_EDITS_PER_FILE})`,
        replacements: 0,
      });
      continue;
    }

    const content = readContentFor(readContents, path);
    let r: FileEditResult | null = null;
    try {
      r = applyFileEdits(content, edits, { path });
    } catch {
      // applyFileEdits is total, but stay defensive at the boundary.
      r = null;
    }
    if (!r) {
      results.push({ path, ok: false, error: 'edit engine error', replacements: 0 });
      continue;
    }
    if (r.ok) {
      results.push({ path, ok: true, newContent: r.content, replacements: r.replacements });
    } else {
      results.push({ path, ok: false, error: r.error || 'edit failed', replacements: 0 });
    }
  }

  const firstFail = results.find((f) => !f.ok);
  if (firstFail) {
    return { ok: false, files: results, failedPath: firstFail.path, reason: firstFail.error || 'edit failed' };
  }
  return { ok: true, files: results };
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Bounded, human-readable one-line summary of a plan. On success:
 *  "N files, M edits: path (+k), …" (M = total replacements, k = per-file). On
 *  failure: names the blocking path/reason and states that nothing was written.
 *  Never throws. */
export function summarizeMultiFilePlan(plan: MultiFilePlan): string {
  if (!isPlainObject(plan) || !Array.isArray(plan.files)) return 'No multi-file plan.';
  const files = plan.files as FilePlanResult[];

  if (plan.ok !== true) {
    const reasonRaw = typeof plan.reason === 'string' && plan.reason ? plan.reason : 'edits do not apply cleanly';
    const reason = clip(reasonRaw, 300);
    const at = typeof plan.failedPath === 'string' && plan.failedPath ? ` at ${clip(plan.failedPath, 160)}` : '';
    return `Plan blocked${at}: ${reason} (no files written).`;
  }

  if (files.length === 0) return 'Empty plan (no files).';

  let total = 0;
  for (let i = 0; i < files.length; i += 1) {
    const k = files[i] && typeof files[i].replacements === 'number' && files[i].replacements > 0 ? files[i].replacements : 0;
    total += k;
  }

  const MAX_LISTED = 12;
  const parts: string[] = [];
  for (let i = 0; i < files.length && i < MAX_LISTED; i += 1) {
    const f = files[i];
    const p = clip(f && typeof f.path === 'string' && f.path ? f.path : '(unknown)', 160);
    const k = f && typeof f.replacements === 'number' && f.replacements > 0 ? f.replacements : 0;
    parts.push(`${p} (+${k})`);
  }
  if (files.length > MAX_LISTED) parts.push(`… (+${files.length - MAX_LISTED} more)`);

  const head = `${files.length} file${files.length === 1 ? '' : 's'}, ${total} edit${total === 1 ? '' : 's'}`;
  return clip(`${head}: ${parts.join(', ')}`, 2000);
}
