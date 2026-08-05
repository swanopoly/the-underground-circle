/**
 * verificationReceiptCore — a coding-lane "proof of work" receipt assembled at
 * run completion (verification expansion v7).
 *
 * At the end of an OpenSwan coding turn, `openswanSessionRuntime` holds a
 * `toolEvents` array where each event carries `{ tool, input, result, status,
 * summary }` (see `OpenSwanToolEvent` / `LegacyToolEvent`). This core folds
 * those events into a compact, secret-safe receipt that answers three
 * questions: which files were edited, which verification checks ran and
 * passed, and whether the work was committed — then a one-line human summary.
 *
 * The gate this rides behind (runAndFixGateCore) is BOOLEAN-only: there is no
 * diagnostic count / baseline, so this receipt never invents a "-3 errors"
 * delta. A check is simply passed or not; a file was edited or not.
 *
 * Signals recognized (matching the real tool catalog in openswanToolRuntime):
 *   edits  → `desktop.edit_file`, `desktop.file_write_text`, mutating `local.run_shell`
 *   checks → `verification.*` (typecheck / tests / lint / preview)
 *   commit → a `git.run` event whose verb is `commit`
 *
 * PURITY: zero imports. No Date.now()/Math.random() at module scope. Every
 * export is TOTAL — null / undefined / wrong-type / huge / hostile input yields
 * a safe neutral receipt and never throws. All output is bounded.
 */

// ─── Bounds (hostile-input safe) ────────────────────────────────────────────

const MAX_SCAN = 500; // max array elements scanned from any one field
const MAX_FILES = 100; // max edited file paths retained
const MAX_CHECKS = 40; // max checks retained
const MAX_PATH_LEN = 300; // max chars per edited path
const MAX_NAME_LEN = 60; // max chars per check name
const MAX_REF_LEN = 40; // git sha upper bound
const MAX_SUMMARY_LEN = 400; // max chars for the one-line summary
const MAX_ARGV_TOKENS = 200; // max flattened shell tokens scanned
const MAX_COMMIT_DEPTH = 4; // recursion cap when scanning nested commit input
const MAX_SHA_SCAN = 4000; // max chars of result text scanned for a sha

// Tool names (LOCKSTEP with openswanToolRuntime's tool catalog).
const EDIT_TOOLS = new Set<string>(['desktop.edit_file', 'desktop.file_write_text']);
const SHELL_TOOL = 'local.run_shell';
const GIT_TOOL = 'git.run';
const VERIFICATION_PREFIX = 'verification.';

// Shell commands whose presence marks a `local.run_shell` call as mutating a
// file. Best-effort classification for path extraction only — the verdict never
// depends on catching every mutation, just on whether a provable file path was
// produced.
const MUTATING_SHELL_CMDS = new Set<string>([
  'sed', 'tee', 'cp', 'mv', 'rm', 'rmdir', 'touch', 'mkdir', 'install', 'patch',
  'dd', 'ln', 'truncate', 'chmod', 'chown', 'rsync', 'mktemp',
]);
const SHELL_INTERPRETERS = new Set<string>(['sh', 'bash', 'zsh', 'dash', 'ksh']);

// Terminal check outcomes (OpenSwanExecutionStatus + OpenSwanToolEvent status).
const STATUS_PASS = new Set<string>(['passed', 'completed', 'success', 'ok']);
const STATUS_FAIL = new Set<string>(['failed', 'blocked', 'manual_required', 'error']);

// ─── Public shapes ──────────────────────────────────────────────────────────

export interface VerificationReceiptInput {
  /** Tool events (or pre-extracted path strings) to mine for edited files. */
  editedFiles?: unknown;
  /** Tool events (or pre-extracted {name,passed}) to mine for verification checks. */
  checks?: unknown;
  /** Tool events / commit ref / {committed,ref} to detect a git commit. */
  commit?: unknown;
}

export interface VerificationReceipt {
  editedFiles: string[];
  checks: Array<{ name: string; passed: boolean }>;
  committed: boolean;
  commitRef?: string;
  verdict: 'verified' | 'unverified' | 'failed';
  summary: string;
}

// ─── Small total helpers ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Coerce any value to a bounded array without throwing (huge → sliced). */
function boundedArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.length > MAX_SCAN ? v.slice(0, MAX_SCAN) : v;
  if (v === null || v === undefined) return [];
  return [v];
}

/**
 * Drop control chars (C0 + DEL), collapse whitespace runs, trim, clip to max.
 * Scan is bounded to a small multiple of `max` so a hostile multi-MB string
 * costs constant work (we only ever keep `max` chars anyway).
 */
function clip(s: string, max: number): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  const scanLimit = Math.min(s.length, max * 4 + 16);
  let out = '';
  let prevSpace = false;
  for (let i = 0; i < scanLimit; i++) {
    const code = s.charCodeAt(i);
    const isSpace = code < 33 || code === 127; // treat C0/DEL/space as whitespace
    if (isSpace) {
      if (!prevSpace && out.length > 0) out += ' ';
      prevSpace = true;
    } else {
      out += s[i];
      prevSpace = false;
      if (out.length >= max) break;
    }
  }
  // trailing collapsed space
  if (out.endsWith(' ')) out = out.slice(0, -1);
  return out.length > max ? out.slice(0, max) : out;
}

function statusOf(ev: Record<string, unknown>): string {
  return toStr(ev.status).toLowerCase();
}

function isSuccessStatus(s: string): boolean {
  return STATUS_PASS.has(s);
}

/** A mutation/commit "landed" when its status is success or simply absent
 *  (many callers don't stamp a status). Any explicit non-success is excluded. */
function countsAsDone(s: string): boolean {
  return s === '' || isSuccessStatus(s);
}

function basename(token: string): string {
  const i = token.lastIndexOf('/');
  return i >= 0 ? token.slice(i + 1) : token;
}

/** True when a shell token plausibly names a file path (not a flag/metachar). */
function looksLikePath(token: string): boolean {
  if (!token || token.length > MAX_PATH_LEN) return false;
  if (token.startsWith('-')) return false;
  if (/[<>|;&*?$`"'()\s]/.test(token)) return false;
  if (/\.[A-Za-z0-9]{1,8}$/.test(token)) return true; // has a file extension
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../');
}

// ─── Edited-file extraction ─────────────────────────────────────────────────

function pathsFromEditEvent(ev: Record<string, unknown>): string[] {
  const input = ev.input;
  if (isRecord(input)) {
    const p = toStr(input.path);
    if (p) return [p];
  }
  return [];
}

/** Flatten a shell argv (splitting compound `sh -c "..."` strings) to tokens. */
function flattenArgv(argv: unknown): string[] {
  const out: string[] = [];
  for (const raw of boundedArray(argv)) {
    const s = toStr(raw);
    if (!s) continue;
    if (/\s/.test(s)) {
      for (const t of s.split(/\s+/)) if (t) out.push(t);
    } else {
      out.push(s);
    }
    if (out.length >= MAX_ARGV_TOKENS) break;
  }
  return out.slice(0, MAX_ARGV_TOKENS);
}

/** Best-effort: is this `local.run_shell` mutating, and which paths did it touch? */
function shellEditInfo(ev: Record<string, unknown>): { mutating: boolean; paths: string[] } {
  const input = isRecord(ev.input) ? ev.input : {};
  const tokens = flattenArgv(input.argv);
  if (tokens.length === 0) return { mutating: false, paths: [] };

  // First real command token (skip leading env-assignments and flags).
  let cmd = '';
  for (const t of tokens) {
    if (t.startsWith('-')) continue;
    if (t.includes('=') && !t.includes('/')) continue;
    cmd = basename(t);
    break;
  }

  let mutating = MUTATING_SHELL_CMDS.has(cmd);
  // `sh -c "sed -i ... src/x.ts"` → inspect wrapped tokens for a mutating cmd.
  if (!mutating && SHELL_INTERPRETERS.has(cmd)) {
    for (const t of tokens) {
      if (MUTATING_SHELL_CMDS.has(basename(t))) { mutating = true; break; }
    }
  }

  const paths: string[] = [];
  // Redirection targets (`> out.log`, `>>foo.txt`) always mutate.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '>' || t === '>>') {
      mutating = true;
      const next = tokens[i + 1];
      if (next && looksLikePath(next)) paths.push(next);
    } else if (t.length > 1 && t.includes('>')) {
      mutating = true;
      const after = t.slice(t.lastIndexOf('>') + 1);
      if (after && looksLikePath(after)) paths.push(after);
    }
  }

  if (mutating) {
    for (let i = 1; i < tokens.length && paths.length < 12; i++) {
      if (looksLikePath(tokens[i])) paths.push(tokens[i]);
    }
  }
  return { mutating, paths };
}

function parseEditedFiles(v: unknown): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const c = clip(raw, MAX_PATH_LEN);
    if (!c || seen.has(c) || files.length >= MAX_FILES) return;
    seen.add(c);
    files.push(c);
  };

  for (const el of boundedArray(v)) {
    if (typeof el === 'string') {
      if (el) add(el); // pre-extracted path string
      continue;
    }
    if (!isRecord(el)) continue;
    const tool = toStr(el.tool);
    if (EDIT_TOOLS.has(tool)) {
      if (!countsAsDone(statusOf(el))) continue; // failed/blocked edit → no file
      for (const p of pathsFromEditEvent(el)) add(p);
    } else if (tool === SHELL_TOOL) {
      if (!countsAsDone(statusOf(el))) continue;
      const info = shellEditInfo(el);
      if (info.mutating) for (const p of info.paths) add(p);
    } else if (!tool && typeof el.path === 'string') {
      if (el.path) add(el.path); // pre-extracted { path } object
    }
    // any other tool (verification.*, git.run, reads) → not an edit
  }
  return files;
}

// ─── Verification-check extraction ──────────────────────────────────────────

function parseChecks(v: unknown): Array<{ name: string; passed: boolean }> {
  const checks: Array<{ name: string; passed: boolean }> = [];
  for (const el of boundedArray(v)) {
    if (checks.length >= MAX_CHECKS) break;
    if (!isRecord(el)) continue;
    const tool = toStr(el.tool);
    if (tool.startsWith(VERIFICATION_PREFIX)) {
      const s = statusOf(el);
      // Only terminal outcomes are real checks; planned/running/not_applicable/
      // unknown are skipped (they never prove or disprove the work).
      if (STATUS_PASS.has(s)) {
        const name = clip(tool.slice(VERIFICATION_PREFIX.length) || tool, MAX_NAME_LEN);
        if (name) checks.push({ name, passed: true });
      } else if (STATUS_FAIL.has(s)) {
        const name = clip(tool.slice(VERIFICATION_PREFIX.length) || tool, MAX_NAME_LEN);
        if (name) checks.push({ name, passed: false });
      }
    } else if (!tool && 'name' in el) {
      // pre-extracted { name, passed }
      const name = clip(toStr(el.name), MAX_NAME_LEN);
      if (name) checks.push({ name, passed: el.passed === true });
    }
  }
  return checks;
}

// ─── Commit detection ───────────────────────────────────────────────────────

/** Pull a git short/long sha from commit output like "[main abc1234] msg". */
function extractSha(textRaw: string): string {
  if (!textRaw) return '';
  const text = textRaw.length > MAX_SHA_SCAN ? textRaw.slice(0, MAX_SHA_SCAN) : textRaw;
  const bracket = text.match(/\[[^\]]{0,80}?([0-9a-f]{7,40})\]/i);
  const captured = bracket ? bracket[1] : undefined;
  if (captured) return captured.toLowerCase();
  const tokens = text.match(/\b[0-9a-f]{7,40}\b/gi);
  if (!tokens) return '';
  for (const t of tokens) if (/[0-9]/.test(t)) return t.toLowerCase(); // prefer a real sha (has a digit)
  const first: string | undefined = tokens[0];
  return first ? first.toLowerCase() : '';
}

function parseCommit(v: unknown, depth: number): { committed: boolean; commitRef?: string } {
  if (depth > MAX_COMMIT_DEPTH) return { committed: false };

  if (typeof v === 'string') {
    const sha = extractSha(v);
    const ref = sha || clip(v, MAX_REF_LEN);
    return ref ? { committed: true, commitRef: ref } : { committed: false };
  }

  if (Array.isArray(v)) {
    for (const el of boundedArray(v)) {
      const r = parseCommit(el, depth + 1);
      if (r.committed) return r;
    }
    return { committed: false };
  }

  if (isRecord(v)) {
    const tool = toStr(v.tool);
    if (tool === GIT_TOOL) {
      const input = isRecord(v.input) ? v.input : {};
      const verb = toStr(input.verb).toLowerCase();
      const args = boundedArray(input.args).map(toStr);
      const isCommit = verb === 'commit' || args.includes('commit');
      if (!isCommit) return { committed: false };
      if (!countsAsDone(statusOf(v))) return { committed: false };
      const sha = extractSha(toStr(v.result)) || extractSha(toStr(v.summary));
      return sha ? { committed: true, commitRef: sha } : { committed: true };
    }
    // pre-extracted { committed?, commitRef? | ref? | sha? }
    const refRaw = toStr(v.commitRef) || toStr(v.ref) || toStr(v.sha);
    const ref = extractSha(refRaw) || (refRaw ? clip(refRaw, MAX_REF_LEN) : '');
    if (v.committed === true) return ref ? { committed: true, commitRef: ref } : { committed: true };
    if (ref) return { committed: true, commitRef: ref };
    return { committed: false };
  }

  return { committed: false };
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Fold the run's tool events into a proof-of-work receipt.
 *
 * Verdict:
 *   - a failed check present            → 'failed'
 *   - all checks passed AND files edited → 'verified'
 *   - otherwise (edits w/o checks, no signal, empty) → 'unverified'
 */
export function buildVerificationReceipt(input: VerificationReceiptInput): VerificationReceipt {
  const safe: VerificationReceiptInput = isRecord(input) ? input : {};

  const editedFiles = parseEditedFiles(safe.editedFiles);
  const checks = parseChecks(safe.checks);
  const commit = parseCommit(safe.commit, 0);

  const anyFailed = checks.some((c) => !c.passed);
  const allPassed = checks.length > 0 && !anyFailed;
  const editsPresent = editedFiles.length > 0;

  let verdict: VerificationReceipt['verdict'];
  if (anyFailed) verdict = 'failed';
  else if (allPassed && editsPresent) verdict = 'verified';
  else verdict = 'unverified';

  const receipt: VerificationReceipt = {
    editedFiles,
    checks,
    committed: commit.committed,
    ...(commit.commitRef ? { commitRef: commit.commitRef } : {}),
    verdict,
    summary: '',
  };
  receipt.summary = formatVerificationReceipt(receipt);
  return receipt;
}

/** Coerce any value into a safe receipt so formatting is total. */
function normalizeReceipt(r: unknown): VerificationReceipt {
  const rec = isRecord(r) ? r : {};
  const editedFiles: string[] = [];
  for (const f of boundedArray(rec.editedFiles)) {
    if (editedFiles.length >= MAX_FILES) break;
    if (typeof f !== 'string') continue;
    const c = clip(f, MAX_PATH_LEN);
    if (c) editedFiles.push(c);
  }
  const checks: Array<{ name: string; passed: boolean }> = [];
  for (const c of boundedArray(rec.checks)) {
    if (checks.length >= MAX_CHECKS) break;
    if (!isRecord(c)) continue;
    const name = clip(toStr(c.name), MAX_NAME_LEN);
    if (name) checks.push({ name, passed: c.passed === true });
  }
  const verdict: VerificationReceipt['verdict'] =
    rec.verdict === 'verified' || rec.verdict === 'failed' ? rec.verdict : 'unverified';
  const committed = rec.committed === true;
  const refRaw = toStr(rec.commitRef);
  const commitRef = refRaw ? clip(refRaw, MAX_REF_LEN) : undefined;
  return {
    editedFiles,
    checks,
    committed,
    ...(commitRef ? { commitRef } : {}),
    verdict,
    summary: '',
  };
}

/**
 * Compact one-line receipt, e.g.:
 *   "✓ Verified: 3 files edited, typecheck+tests passed, committed abc1234"
 *   "✗ Failed: 2 files edited, typecheck passed, tests failed"
 *   "• Unverified: 1 file edited, no checks run"
 */
export function formatVerificationReceipt(r: VerificationReceipt): string {
  const rr = normalizeReceipt(r);
  const glyph = rr.verdict === 'verified' ? '✓' : rr.verdict === 'failed' ? '✗' : '•';
  const label = rr.verdict === 'verified' ? 'Verified' : rr.verdict === 'failed' ? 'Failed' : 'Unverified';

  const parts: string[] = [];

  const n = rr.editedFiles.length;
  parts.push(n === 0 ? 'no files edited' : `${n} file${n === 1 ? '' : 's'} edited`);

  if (rr.checks.length > 0) {
    const passed = rr.checks.filter((c) => c.passed).map((c) => c.name);
    const failed = rr.checks.filter((c) => !c.passed).map((c) => c.name);
    const seg: string[] = [];
    if (passed.length) seg.push(`${passed.join('+')} passed`);
    if (failed.length) seg.push(`${failed.join('+')} failed`);
    parts.push(seg.join(', '));
  } else {
    parts.push('no checks run');
  }

  if (rr.committed) parts.push(rr.commitRef ? `committed ${rr.commitRef}` : 'committed');

  return clip(`${glyph} ${label}: ${parts.join(', ')}`, MAX_SUMMARY_LEN);
}
