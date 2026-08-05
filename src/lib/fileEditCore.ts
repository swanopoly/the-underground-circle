// fileEditCore — the PURE precise-edit engine behind a Claude-Code-style
// `str_replace`/multi-edit file tool. Today the agent can only rewrite a whole
// file (desktop.file_write_text), which is token-heavy and error-prone on large
// files. This gives it exact-string replacement with the SAME safety contract as
// Claude Code's Edit tool:
//   - oldString must match the file EXACTLY (whitespace included) and be UNIQUE,
//     unless replaceAll is set — a non-unique match fails closed asking for more
//     surrounding context, so the agent never edits the wrong occurrence.
//   - edits apply SEQUENTIALLY: each edit matches against the result of the prior
//     one, so a multi-edit batch is deterministic.
//   - creating a new file is a single edit with an empty oldString.
//   - a no-op (oldString === newString) is rejected.
// Returns the new content + a unified-style diff for the approval preview. All
// replacement is LITERAL (indexOf/split-join, never String.replace), so a `$` or
// `\` in newString can never be reinterpreted as a regex/backref.
//
// PURITY: zero imports, tsx-loadable (smoke: file-edit-core). This module does NOT
// touch the filesystem — a bridge tool (desktop.edit_file) reads the file, calls
// applyFileEdits, shows the diff for approval, then writes via file_write_text.

export interface FileEdit {
  /** Exact substring to find. Empty string = create a new file (newString is the
   *  whole file body), valid only as the sole edit when the file does not exist. */
  oldString: string;
  /** Replacement text (embedded literally — never a regex/backref). */
  newString: string;
  /** Replace every occurrence instead of requiring a unique match. */
  replaceAll?: boolean;
}

export interface FileEditResult {
  ok: boolean;
  /** Resulting file content (equals the original on failure). */
  content: string;
  /** Total substrings replaced across all edits. */
  replacements: number;
  /** How many edits were applied before returning. */
  editsApplied: number;
  /** True when the batch created a new file (empty-oldString create). */
  created: boolean;
  /** Unified-style diff of original → result ('' when nothing changed / on failure). */
  diff: string;
  error?: string;
  /** 0-based index of the edit that failed (when error is set). */
  errorIndex?: number;
}

/** Guard: reject absurdly large match/replacement strings (a full file rewrite
 *  should use the write tool, not the editor). */
export const MAX_EDIT_STRING = 200_000;
/** Guard: cap the number of edits in one batch. */
export const MAX_EDITS_PER_BATCH = 64;

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

/** Replace the FIRST literal occurrence (no regex semantics). */
function replaceFirstLiteral(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

/** Replace EVERY literal occurrence (split/join — no regex semantics). */
function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}

function isEditArray(value: unknown): value is FileEdit[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (e) =>
        e != null &&
        typeof e === 'object' &&
        typeof (e as FileEdit).oldString === 'string' &&
        typeof (e as FileEdit).newString === 'string',
    )
  );
}

/**
 * Apply an ordered batch of exact-string edits to `originalContent`
 * (null/undefined = the file does not exist yet). Never throws — returns a typed
 * result with `ok:false` + a reason (and the offending edit index) on any
 * violation, leaving `content` equal to the original.
 */
export function applyFileEdits(
  originalContent: string | null | undefined,
  edits: unknown,
  opts?: { path?: string },
): FileEditResult {
  const original = typeof originalContent === 'string' ? originalContent : null;
  const fail = (error: string, errorIndex?: number): FileEditResult => ({
    ok: false,
    content: original ?? '',
    replacements: 0,
    editsApplied: 0,
    created: false,
    diff: '',
    error,
    ...(errorIndex === undefined ? {} : { errorIndex }),
  });

  if (!isEditArray(edits)) {
    return fail('edits must be a non-empty array of { oldString, newString } objects');
  }
  if (edits.length > MAX_EDITS_PER_BATCH) {
    return fail(`too many edits in one batch (${edits.length} > ${MAX_EDITS_PER_BATCH})`);
  }
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i];
    if (e.oldString.length > MAX_EDIT_STRING || e.newString.length > MAX_EDIT_STRING) {
      return fail(`edit ${i}: oldString/newString exceeds ${MAX_EDIT_STRING} chars (use the write tool for a full rewrite)`, i);
    }
  }

  // ── Create mode: file does not exist → one empty-oldString edit sets the body.
  const creating = original === null;
  if (creating) {
    if (edits.length !== 1 || edits[0].oldString !== '') {
      return fail('creating a new file requires exactly one edit with an empty oldString (its newString is the file body)', 0);
    }
    const content = edits[0].newString;
    return {
      ok: true,
      content,
      replacements: 1,
      editsApplied: 1,
      created: true,
      diff: computeUnifiedDiff('', content, { path: opts?.path }),
    };
  }

  // ── Edit mode: apply each edit against the running result. ──────────────────
  let working = original;
  let replacements = 0;
  for (let i = 0; i < edits.length; i += 1) {
    const { oldString, newString, replaceAll } = edits[i];
    if (oldString === '') {
      return fail(`edit ${i}: empty oldString is only valid when creating a new file`, i);
    }
    if (oldString === newString) {
      return fail(`edit ${i}: oldString and newString are identical (no-op)`, i);
    }
    const count = countOccurrences(working, oldString);
    if (count === 0) {
      return fail(`edit ${i}: oldString not found in file (it must match exactly, including whitespace)`, i);
    }
    if (count > 1 && !replaceAll) {
      return fail(
        `edit ${i}: oldString is not unique (${count} matches) — add surrounding context to disambiguate, or set replaceAll:true`,
        i,
      );
    }
    working = replaceAll ? replaceAllLiteral(working, oldString, newString) : replaceFirstLiteral(working, oldString, newString);
    replacements += replaceAll ? count : 1;
  }

  return {
    ok: true,
    content: working,
    replacements,
    editsApplied: edits.length,
    created: false,
    diff: computeUnifiedDiff(original, working, { path: opts?.path }),
  };
}

/** Single-edit convenience wrapper. */
export function applyFileEdit(
  originalContent: string | null | undefined,
  oldString: string,
  newString: string,
  replaceAll = false,
  opts?: { path?: string },
): FileEditResult {
  return applyFileEdits(originalContent, [{ oldString, newString, replaceAll }], opts);
}

// ── Unified-style diff ────────────────────────────────────────────────────────
// A localized str_replace changes a contiguous region, so we trim the common
// leading/trailing lines and emit ONE hunk with a few lines of context. This is a
// correct, readable preview (it shows exactly what changed) — not a minimal
// multi-hunk Myers diff, which a localized editor does not need.

/** Build a compact unified-style diff of `oldText` → `newText`. Returns '' when
 *  the two are identical. Never throws. */
export function computeUnifiedDiff(oldText: string, newText: string, opts?: { path?: string; context?: number }): string {
  if (oldText === newText) return '';
  const context = Math.max(0, Math.min(10, opts?.context ?? 3));
  const oldLines = oldText.length ? oldText.split('\n') : [];
  const newLines = newText.length ? newText.split('\n') : [];

  // Common leading lines.
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  // Common trailing lines (not overlapping the prefix).
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const ctxStart = Math.max(0, prefix - context);
  const oldChangeEnd = oldLines.length - suffix; // exclusive
  const newChangeEnd = newLines.length - suffix; // exclusive
  const oldCtxEnd = Math.min(oldLines.length, oldChangeEnd + context);
  const newCtxEnd = Math.min(newLines.length, newChangeEnd + context);

  const lines: string[] = [];
  const path = opts?.path || 'file';
  lines.push(`--- ${path}`);
  lines.push(`+++ ${path}`);
  // Hunk header (1-based line numbers).
  const oldHunkLen = oldCtxEnd - ctxStart;
  const newHunkLen = newCtxEnd - ctxStart;
  lines.push(`@@ -${ctxStart + 1},${oldHunkLen} +${ctxStart + 1},${newHunkLen} @@`);
  // Leading context.
  for (let i = ctxStart; i < prefix; i += 1) lines.push(` ${oldLines[i]}`);
  // Removed lines.
  for (let i = prefix; i < oldChangeEnd; i += 1) lines.push(`-${oldLines[i]}`);
  // Added lines.
  for (let i = prefix; i < newChangeEnd; i += 1) lines.push(`+${newLines[i]}`);
  // Trailing context.
  for (let i = oldChangeEnd; i < oldCtxEnd; i += 1) lines.push(` ${oldLines[i]}`);
  return lines.join('\n');
}

/** One-line, bounded description for an approval preview / notice. Never throws. */
export function describeFileEdits(edits: unknown, opts?: { path?: string }): string {
  const where = opts?.path ? ` ${opts.path}` : '';
  if (!isEditArray(edits)) return `Edit a file${where}`;
  if (edits.length === 1 && edits[0].oldString === '') {
    const bytes = edits[0].newString.length;
    return `Create${where} (${bytes} chars)`;
  }
  const anyAll = edits.some((e) => e.replaceAll);
  return `Apply ${edits.length} exact-string edit${edits.length === 1 ? '' : 's'}${where}${anyAll ? ' (some replace-all)' : ''}`;
}
