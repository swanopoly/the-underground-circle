/**
 * openswanRunProofCore — turn a completed OpenSwan run into a human-readable
 * proof-of-work card for the activity feed (ACCOUNTABILITY #1).
 *
 * When `openswanSessionRuntime` finishes a turn it holds the run's signals:
 *   - tool events   (OpenSwanToolEvent[]  → { tool, input, result, status, summary })
 *   - files touched (derived edit paths, or mined from those tool events)
 *   - verification  (OpenSwanVerificationResult[] → { check:{label,kind}, status, ok, ... })
 *   - stop reason   (runResult.stopReason: 'end_turn'|'tool_use'|'max_tokens'|'stop_sequence',
 *                    plus loop-level 'failed'/'aborted'/'max_iterations' families)
 *   - durationMs    (wall-clock)
 *   - outputSummary (the model's own final response / summary text)
 *
 * `buildRunProof` folds those into a bounded, secret-safe card:
 *   { headline (≤120), bullets (≤8), verified, proofTags } — "what was done,
 *   what was verified". This is the proof-of-work entry the feed / agent_run_events
 *   shows so a completed run is visible and accountable, not a black box.
 *
 * The existing `verificationReceiptCore` produces a one-line coding receipt;
 * this core produces the fuller feed card and is deliberately self-contained
 * (it can mine files straight from tool events when a caller only has those).
 *
 * PURITY: zero runtime imports (nothing to import — pure transforms). No
 * Date.now()/Math.random() at module scope. Every export is TOTAL: null /
 * undefined / wrong-type / huge / hostile / cyclic input yields a safe neutral
 * card and never throws. All output is bounded. Secret-safe: file paths are
 * reduced to basenames and free text is scrubbed of secret-looking tokens.
 */

// ─── Bounds (hostile-input safe) ────────────────────────────────────────────

const MAX_HEADLINE = 120; // hard cap on the card headline
const MAX_BULLETS = 8; // hard cap on card bullets
const MAX_BULLET_LEN = 160; // per-bullet clip
const MAX_TAGS = 16; // hard cap on proofTags
const MAX_TAG_LEN = 40; // per-tag clip
const MAX_SCAN = 500; // max array elements scanned per field
const MAX_NAMES_LISTED = 6; // tool/file names listed inline in a bullet
const MAX_KIND_TAGS = 6; // per-check-kind tags emitted
const MAX_FILES = 100; // max distinct file basenames retained
const MAX_CHECKS = 60; // max checks scanned
const MAX_TOOLS = 200; // max distinct tool names retained
const MAX_NAME_LEN = 60; // per tool/check name clip
const MAX_BASENAME_LEN = 80; // per file basename clip
const MAX_PATH_LEN = 400; // reject absurd "path" tokens beyond this
const MAX_SUMMARY_LEN = 200; // outputSummary bullet clip
const MAX_STOPWORD_LEN = 40; // stop-reason word clip
const MAX_REDACT_SCAN = 1600; // chars pre-scanned before free-text redaction
const MAX_REDACT_TOKENS = 300; // tokens scrubbed in free text
const MAX_MS = 3.15e13; // ~1000y — clamp so duration strings stay small

// Terminal status vocab (matches openswanExecution.OpenSwanExecutionStatus +
// OpenSwanToolEvent.status + pre-extracted { passed }).
const PASS_STATUS = new Set<string>(['passed', 'completed', 'success', 'ok', 'done', 'finished']);
const FAIL_STATUS = new Set<string>(['failed', 'error']);
const REVIEW_STATUS = new Set<string>([
  'blocked', 'manual_required', 'planned', 'running', 'timeout', 'aborted', 'cancelled', 'canceled',
]);
const NA_STATUS = new Set<string>(['not_applicable', 'skipped', 'n/a', 'na']);

// Tool-event status that marks a tool call as failed (OpenSwanToolEvent.status).
const TOOL_FAIL_STATUS = new Set<string>([
  'failed', 'blocked', 'manual_required', 'error', 'aborted', 'cancelled', 'canceled', 'timeout',
]);

// runResult.stopReason families. 'tool_use' / unknown / '' are neutral.
const STOP_SUCCESS = new Set<string>(['end_turn', 'stop_sequence', 'completed', 'success', 'done', 'finished', 'ok']);
const STOP_FAIL = new Set<string>([
  'failed', 'error', 'aborted', 'cancelled', 'canceled', 'stopped', 'max_tokens', 'max_iterations',
  'max_iterations_exceeded', 'hit_max_iterations', 'cap_exhausted', 'timeout', 'no_progress',
  'loop_stopped_no_progress', 'blocked',
]);

// Edit tools whose input.path names a touched file (LOCKSTEP w/ openswanToolRuntime).
const EDIT_TOOLS = new Set<string>(['desktop.edit_file', 'desktop.file_write_text']);
const GIT_TOOL = 'git.run';
const VERIFICATION_PREFIX = 'verification.';

// ─── Public shapes ──────────────────────────────────────────────────────────

export interface RunProofInput {
  /** Tool names, or OpenSwanToolEvent[] ({ tool, status, input }), or a container. */
  toolsUsed?: unknown;
  /** File path strings, or edit events; reduced to basenames. */
  filesTouched?: unknown;
  /** OpenSwanVerificationResult[] / verification.* events / { name, passed }. */
  verification?: unknown;
  /** runResult.stopReason or loop status string. */
  stopReason?: unknown;
  /** Wall-clock duration in ms. */
  durationMs?: unknown;
  /** The model's own final response / summary text. */
  outputSummary?: unknown;
}

export interface RunProof {
  headline: string;
  bullets: string[];
  verified: boolean;
  proofTags: string[];
}

// ─── Small total helpers ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Scalar → string (string/number/bigint/boolean); everything else → ''. */
function asScalarStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

/** Coerce any value to a bounded array without throwing (huge → sliced). */
function boundedArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.length > MAX_SCAN ? v.slice(0, MAX_SCAN) : v;
  if (v === null || v === undefined) return [];
  return [v];
}

/**
 * Unwrap a common list container: if `v` is a record carrying one of `keys`
 * as an array, use that array; otherwise treat `v` itself as the list. Lets a
 * caller pass either `result.toolEvents` or `{ toolEvents: [...] }`.
 */
function unwrapList(v: unknown, keys: string[]): unknown[] {
  if (isRecord(v)) {
    for (const k of keys) {
      if (Array.isArray(v[k])) return boundedArray(v[k]);
    }
  }
  return boundedArray(v);
}

/**
 * Strip control chars (C0 + DEL), collapse whitespace runs to single spaces,
 * trim, clip to `max`. Scan is bounded to a small multiple of `max` so a
 * hostile multi-MB string costs constant work.
 */
function clip(s: string, max: number): string {
  if (typeof s !== 'string' || s.length === 0 || max <= 0) return '';
  const scanLimit = Math.min(s.length, max * 4 + 16);
  let out = '';
  let prevSpace = false;
  for (let i = 0; i < scanLimit; i++) {
    const code = s.charCodeAt(i);
    const isSpace = code < 33 || code === 127; // C0 / DEL / space
    if (isSpace) {
      if (!prevSpace && out.length > 0) out += ' ';
      prevSpace = true;
    } else {
      out += s[i];
      prevSpace = false;
      if (out.length >= max) break;
    }
  }
  if (out.endsWith(' ')) out = out.slice(0, -1);
  return out.length > max ? out.slice(0, max) : out;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** basename of a path token, stripping a trailing slash + wrapping punctuation. */
function pathBasename(tokenRaw: string): string {
  let t = tokenRaw;
  while (t.length > 1 && t.endsWith('/')) t = t.slice(0, -1);
  const i = t.lastIndexOf('/');
  let base = i >= 0 ? t.slice(i + 1) : t;
  base = base.replace(/^[('"[{]+/, '').replace(/[),.;:'"!?\]}]+$/, '');
  return base || t;
}

// ─── Secret-safe free-text redaction ────────────────────────────────────────

/** A token that looks like an API key / token / high-entropy secret. */
function isSecretToken(t: string): boolean {
  if (!t) return false;
  if (t.length > 400) return true; // absurdly long opaque token → mask
  if (/^(sk-|sk_live|sk_test|pk_live|rk_live|ghp_|gho_|ghu_|ghs_|github_pat_|glpat-|hf_|npm_|xox[baprs]-|AKIA[0-9A-Z]{6,}|ASIA[0-9A-Z]{6,}|AIza[0-9A-Za-z_-]{10,}|ya29\.)/i.test(t)) return true;
  if (/^[0-9a-f]{32,}$/i.test(t)) return true; // long hex
  if (/^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}$/.test(t)) return true; // jwt
  // high-entropy mixed base64-ish opaque blob
  if (t.length >= 40 && /[A-Z]/.test(t) && /[a-z]/.test(t) && /[0-9]/.test(t) && /^[A-Za-z0-9+/_=-]+$/.test(t)) return true;
  return false;
}

/** `password=...`, `api_key: ...`, `token=...` → key masked value. */
function redactKeyValue(t: string): string {
  const m = t.match(/^([\w.-]{0,40}(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|auth|access[_-]?key|credential|session)s?)\s*[=:]\s*(.+)$/i);
  if (m && m[2] && m[2].length > 0) return `${m[1]}=[redacted]`;
  return '';
}

/** True when a token plausibly names a filesystem path (not "and/or", not a URL). */
function isPathToken(t: string): boolean {
  if (!t || t.length > MAX_PATH_LEN) return false;
  if (t.indexOf('/') < 0) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // scheme://… URL — leave alone
  if (/^(~\/|\/|\.\/|\.\.\/)/.test(t)) return true; // absolute / home / relative-dot
  return /[\w.-]\/[\w.-]/.test(t) && /\.[A-Za-z0-9]{1,8}([),.;:'"!?\]}]*)$/.test(t); // rel path w/ extension
}

/**
 * Scrub free text for the feed: strip control chars, collapse whitespace,
 * reduce path-like tokens to basenames, mask secret-looking tokens, then clip.
 * Bounded token scan so hostile input costs constant work.
 */
function redactText(raw: unknown, max: number): string {
  const s0 = typeof raw === 'string' ? raw : '';
  if (!s0) return '';
  const pre = clip(s0, MAX_REDACT_SCAN);
  if (!pre) return '';
  const tokens = pre.split(' ');
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < tokens.length && i < MAX_REDACT_TOKENS; i++) {
    let t = tokens[i];
    if (!t) continue;
    if (isSecretToken(t)) {
      t = '[redacted]';
    } else {
      const kv = redactKeyValue(t);
      if (kv) t = kv;
      else if (isPathToken(t)) t = pathBasename(t);
    }
    out.push(t);
    len += t.length + 1;
    if (len >= max + 32) break;
  }
  return clip(out.join(' '), max);
}

/** Machine tag: lowercase, non-alnum → '-', collapse dashes, clip. */
function slug(s: string): string {
  const lowered = clip(s, MAX_TAG_LEN * 2).toLowerCase();
  const out = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return out.slice(0, MAX_TAG_LEN);
}

// ─── Tool parsing (names, count, failures, mined edit paths, commit) ─────────

interface ParsedTools {
  names: string[]; // distinct tool names
  callCount: number; // number of tool invocations recognized
  failedCount: number; // invocations whose status marks failure
  minedPaths: string[]; // edit-tool input.path basenames (fallback for filesTouched)
  committed: boolean; // a non-failed git.run commit was seen
}

function toolNameOf(el: Record<string, unknown>): string {
  return clip(toStr(el.tool) || toStr(el.toolName) || toStr(el.name), MAX_NAME_LEN);
}

function isCommitEvent(el: Record<string, unknown>): boolean {
  if (toStr(el.tool) !== GIT_TOOL) return false;
  const input = isRecord(el.input) ? el.input : {};
  const verb = toStr(input.verb).toLowerCase();
  if (verb === 'commit') return true;
  const args = boundedArray(input.args).map((a) => toStr(a).toLowerCase());
  return args.includes('commit');
}

function parseTools(v: unknown): ParsedTools {
  const list = unwrapList(v, ['toolEvents', 'tools', 'events', 'items', 'calls']);
  const names: string[] = [];
  const seenName = new Set<string>();
  const minedPaths: string[] = [];
  const seenPath = new Set<string>();
  let callCount = 0;
  let failedCount = 0;
  let committed = false;

  const addName = (n: string): void => {
    if (!n || seenName.has(n) || names.length >= MAX_TOOLS) return;
    seenName.add(n);
    names.push(n);
  };
  const addPath = (p: string): void => {
    const b = clip(pathBasename(p), MAX_BASENAME_LEN);
    if (!b || seenPath.has(b) || minedPaths.length >= MAX_FILES) return;
    seenPath.add(b);
    minedPaths.push(b);
  };

  for (const el of list) {
    if (typeof el === 'string') {
      const n = clip(el, MAX_NAME_LEN);
      if (n) { addName(n); callCount++; }
      continue;
    }
    if (!isRecord(el)) continue;
    const name = toolNameOf(el);
    if (!name) continue;
    callCount++;
    addName(name);
    const status = toStr(el.status).toLowerCase();
    const failed = TOOL_FAIL_STATUS.has(status);
    if (failed) failedCount++;
    if (!failed) {
      if (EDIT_TOOLS.has(toStr(el.tool)) && isRecord(el.input)) {
        const p = toStr(el.input.path);
        if (p) addPath(p);
      }
      if (isCommitEvent(el)) committed = true;
    }
  }

  return { names, callCount, failedCount, minedPaths, committed };
}

// ─── File parsing (basenames only — secret-safe) ─────────────────────────────

function fileTokenOf(el: unknown): string {
  if (typeof el === 'string') return el;
  if (!isRecord(el)) return '';
  const tool = toStr(el.tool);
  if (tool) {
    // A record that IS a tool event only names a *touched* file when it is an
    // edit tool — a read / verification / git event touches nothing. This lets
    // a caller safely pass the raw toolEvents array as `filesTouched` (parallel
    // to the sibling verification receipt) without counting reads.
    if (EDIT_TOOLS.has(tool) && isRecord(el.input)) {
      const p = toStr(el.input.path) || toStr(el.input.file);
      if (p) return p;
    }
    return '';
  }
  const direct = toStr(el.path) || toStr(el.file) || toStr(el.filePath) || toStr(el.filename);
  if (direct) return direct;
  if (isRecord(el.input)) {
    const nested = toStr(el.input.path) || toStr(el.input.file);
    if (nested) return nested;
  }
  return '';
}

function parseFiles(v: unknown): string[] {
  const list = unwrapList(v, ['filesTouched', 'files', 'paths', 'editedFiles']);
  const files: string[] = [];
  const seen = new Set<string>();
  for (const el of list) {
    if (files.length >= MAX_FILES) break;
    const tok = fileTokenOf(el);
    if (!tok) continue;
    const base = clip(pathBasename(tok), MAX_BASENAME_LEN);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    files.push(base);
  }
  return files;
}

// ─── Verification parsing ────────────────────────────────────────────────────

type CheckOutcome = 'pass' | 'fail' | 'review' | 'na';

interface ParsedChecks {
  pass: string[];
  fail: string[];
  review: string[];
  total: number; // pass + fail + review (na excluded — never counts)
}

function checkNameOf(el: Record<string, unknown>): string {
  let name = '';
  if (isRecord(el.check)) name = toStr(el.check.label) || toStr(el.check.kind);
  if (!name) {
    const tool = toStr(el.tool);
    if (tool.startsWith(VERIFICATION_PREFIX)) name = tool.slice(VERIFICATION_PREFIX.length);
  }
  if (!name) name = toStr(el.name) || toStr(el.label) || toStr(el.kind) || toStr(el.tool);
  const c = clip(name, MAX_NAME_LEN);
  return c || 'check';
}

/**
 * Only count a record as a verification check when it clearly IS one. A record
 * carrying a non-verification `tool` (e.g. `desktop.edit_file`) is a tool event,
 * NOT a check — so a caller can pass the raw toolEvents array as `verification`
 * (parallel to the sibling verification receipt) and pick up only the
 * `verification.*` events, never mistaking an edit for a passed check.
 */
function isCheckLike(el: Record<string, unknown>): boolean {
  if (isRecord(el.check)) return true; // OpenSwanVerificationResult
  const tool = toStr(el.tool);
  if (tool) return tool.startsWith(VERIFICATION_PREFIX);
  return 'passed' in el || 'name' in el || 'label' in el || 'kind' in el || 'status' in el || 'ok' in el;
}

function checkOutcomeOf(el: Record<string, unknown>): CheckOutcome {
  const status = toStr(el.status).toLowerCase();
  if (status) {
    if (NA_STATUS.has(status)) return 'na';
    if (PASS_STATUS.has(status)) return 'pass';
    if (FAIL_STATUS.has(status)) return 'fail';
    if (REVIEW_STATUS.has(status)) return 'review';
  }
  if (el.ok === true || el.passed === true) return 'pass';
  if (el.ok === false || el.passed === false) return 'fail';
  return 'na';
}

function parseChecks(v: unknown): ParsedChecks {
  const list = unwrapList(v, ['verificationResults', 'verification', 'results', 'checks']);
  const pass: string[] = [];
  const fail: string[] = [];
  const review: string[] = [];
  let scanned = 0;
  for (const el of list) {
    if (scanned >= MAX_CHECKS) break;
    if (!isRecord(el)) continue; // bare strings can't prove pass/fail — skip
    if (!isCheckLike(el)) continue; // a non-verification tool event is not a check
    scanned++;
    const outcome = checkOutcomeOf(el);
    if (outcome === 'na') continue;
    const name = checkNameOf(el);
    if (outcome === 'pass' && pass.length < MAX_CHECKS) pass.push(name);
    else if (outcome === 'fail' && fail.length < MAX_CHECKS) fail.push(name);
    else if (outcome === 'review' && review.length < MAX_CHECKS) review.push(name);
  }
  return { pass, fail, review, total: pass.length + fail.length + review.length };
}

// ─── Stop reason ─────────────────────────────────────────────────────────────

type StopClass = 'success' | 'fail' | 'neutral';

function classifyStop(v: unknown): StopClass {
  const s = asScalarStr(v).toLowerCase().trim();
  if (!s) return 'neutral';
  if (STOP_SUCCESS.has(s)) return 'success';
  if (STOP_FAIL.has(s)) return 'fail';
  return 'neutral';
}

/** Short, safe word for the stop reason (for headline/bullet). */
function stopWord(v: unknown): string {
  const s = asScalarStr(v).toLowerCase().trim();
  if (!s) return '';
  const safe = s.replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim();
  return clip(safe, MAX_STOPWORD_LEN);
}

// ─── Duration ────────────────────────────────────────────────────────────────

function humanDuration(v: unknown): string {
  const raw = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return '';
  const ms = Math.min(Math.floor(raw), MAX_MS);
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return sec > 0 ? `${totalMin}m ${sec}s` : `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min > 0 ? `${hours}h ${min}m` : `${hours}h`;
}

// ─── Presentation helpers ────────────────────────────────────────────────────

/** "a.ts, b.ts, c.ts (+2 more)" — first `cap` names, count of the rest. */
function joinNamed(names: string[], cap: number): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, cap).join(', ');
  const rest = names.length - Math.min(names.length, cap);
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
}

/** Either "a+b" (few short names) or "N words" fallback. */
function namesOrCount(names: string[], word: string): string {
  if (names.length === 0) return '';
  const joined = names.slice(0, 4).join('+');
  if (names.length <= 3 && joined.length <= 44) return joined;
  return plural(names.length, word);
}

// ─── Assembly ────────────────────────────────────────────────────────────────

/**
 * Fold a completed OpenSwan run's signals into a proof-of-work card.
 *
 * verified = at least one verification check passed AND none failed / need
 * review AND the run itself did not stop in a failure family. A failed run is
 * never "verified", even if some checks passed.
 */
export function buildRunProof(input: RunProofInput): RunProof {
  const safe: RunProofInput = isRecord(input) ? input : {};

  const tools = parseTools(safe.toolsUsed);
  let files = parseFiles(safe.filesTouched);
  if (files.length === 0 && tools.minedPaths.length > 0) files = tools.minedPaths;
  const checks = parseChecks(safe.verification);
  const stop = classifyStop(safe.stopReason);
  const stopText = stopWord(safe.stopReason);
  const duration = humanDuration(safe.durationMs);
  const summary = redactText(safe.outputSummary, MAX_SUMMARY_LEN);

  // ── verdict / verified ───────────────────────────────────────────────────
  const runFailed = stop === 'fail';
  const verified = checks.pass.length > 0 && checks.fail.length === 0 && checks.review.length === 0 && !runFailed;

  const hadActivity =
    tools.callCount > 0 || files.length > 0 || checks.total > 0 || summary !== '' || duration !== '';

  let outcome: 'completed' | 'failed' | 'stopped' | 'no-activity';
  if (checks.fail.length > 0) outcome = 'failed';
  else if (runFailed) outcome = 'stopped';
  else if (!hadActivity) outcome = 'no-activity';
  else outcome = 'completed';

  const label =
    outcome === 'failed' ? 'Failed' :
    outcome === 'stopped' ? 'Stopped' :
    outcome === 'completed' ? 'Completed' :
    '';

  // ── headline ─────────────────────────────────────────────────────────────
  const clauses: string[] = [];
  if (files.length > 0) clauses.push(plural(files.length, 'file') + ' edited');
  if (checks.total > 0) {
    if (checks.fail.length > 0) clauses.push(`${namesOrCount(checks.fail, 'check')} failed`);
    else if (checks.pass.length > 0) clauses.push(`${namesOrCount(checks.pass, 'check')} passed`);
    else if (checks.review.length > 0) clauses.push(`${checks.review.length} to review`);
  }
  if (clauses.length < 2 && tools.callCount > 0) clauses.push(plural(tools.names.length || tools.callCount, 'tool') + ' used');
  if (clauses.length < 2 && duration) clauses.push(`ran ${duration}`);

  let headline: string;
  if (outcome === 'no-activity') {
    headline = 'OpenSwan run — no recorded activity';
  } else if (clauses.length > 0) {
    headline = `${label}: ${clauses.slice(0, 3).join(', ')}`;
  } else if (summary) {
    headline = `${label}: ${summary}`;
  } else {
    // stopped/failed with no other detail
    const tail = outcome === 'failed' ? 'run failed' : stopText ? `run stopped (${stopText})` : 'run stopped';
    headline = `${label}: ${tail}`;
  }
  headline = clip(headline, MAX_HEADLINE);

  // ── bullets (honest, ordered by proof value) ─────────────────────────────
  const bullets: string[] = [];
  const pushBullet = (b: string): void => {
    if (bullets.length >= MAX_BULLETS) return;
    const c = clip(b, MAX_BULLET_LEN);
    if (c) bullets.push(c);
  };

  if (summary) pushBullet(summary);

  if (checks.total > 0) {
    const segs: string[] = [];
    if (checks.pass.length > 0) segs.push(`${namesOrCount(checks.pass, 'check')} passed`);
    if (checks.fail.length > 0) segs.push(`${namesOrCount(checks.fail, 'check')} failed`);
    if (checks.review.length > 0) segs.push(`${checks.review.length} need review`);
    if (segs.length > 0) pushBullet(`Verification: ${segs.join(', ')}`);
  } else if (files.length > 0 || tools.callCount > 0) {
    pushBullet('No verification checks were run');
  }

  if (files.length > 0) pushBullet(`Touched ${plural(files.length, 'file')}: ${joinNamed(files, MAX_NAMES_LISTED)}`);

  if (tools.callCount > 0) {
    const failNote = tools.failedCount > 0 ? ` (${tools.failedCount} failed)` : '';
    const namesList = joinNamed(tools.names, MAX_NAMES_LISTED);
    pushBullet(`Used ${plural(tools.callCount, 'tool call')}${failNote}${namesList ? `: ${namesList}` : ''}`);
  }

  if (tools.committed) pushBullet('Committed changes to git');

  if (stop !== 'success' && stopText && outcome !== 'no-activity') {
    pushBullet(`Stop reason: ${stopText}`);
  }

  if (duration) pushBullet(`Ran for ${duration}`);

  // ── proof tags (compact, machine-readable, deduped) ──────────────────────
  const tags: string[] = [];
  const seenTag = new Set<string>();
  const addTag = (t: string): void => {
    const c = clip(t, MAX_TAG_LEN);
    if (!c || seenTag.has(c) || tags.length >= MAX_TAGS) return;
    seenTag.add(c);
    tags.push(c);
  };

  addTag(outcome);
  if (verified) addTag('verified');
  else if (checks.total > 0 || files.length > 0 || tools.callCount > 0) addTag('unverified');
  if (files.length > 0) addTag(`files:${files.length}`);
  if (tools.names.length > 0) addTag(`tools:${tools.names.length}`);
  if (tools.committed) addTag('committed');
  let kindTags = 0;
  for (const name of checks.pass) {
    if (kindTags >= MAX_KIND_TAGS) break;
    const s = slug(name);
    if (s) { addTag(s); kindTags++; }
  }
  if (checks.fail.length > 0) addTag('checks-failed');
  if (checks.review.length > 0) addTag('needs-review');

  return { headline, bullets, verified, proofTags: tags };
}
