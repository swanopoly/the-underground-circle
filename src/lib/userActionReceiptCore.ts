// userActionReceiptCore — the PURE user-facing action receipt formatter for
// SwanBot/OpenSwan chat action turns. Distinct from `toolResultSummaryCore`
// (which compresses oversized outputs for the MODEL): this core turns one tool
// result into the ONE compact human line the USER sees, fixing two findings:
//
//   (1) raw ~1200-char stringified JSON tool output was shown to the user as
//       the action "summary" (`summary: action.output_preview || action.title`
//       in openswanSessionRuntime's execution-stream mapping), and
//   (2) action turns showed no compact receipt of what actually happened.
//
// Exports:
//   buildUserActionReceipt(toolName, result, ok) — one bounded human line,
//     never raw JSON/fences. Family phrasing: rooms.create → 'Created room
//     "X"', tasks.create → 'Added task "X"', local.run_shell/git.run →
//     'Ran `cmd` — passed/failed', desktop.edit_file → 'Edited path (N
//     changes)', gmail.write → 'Sent email to X — "Subject"'. ok=false →
//     "Couldn't <verb>: <short reason>". Always < 200 chars.
//   summarizeToolResultForUser(toolName, result) — best-effort salient field
//     (resultsText/summary/title/name/path/url/status/count…) from an
//     object/string result; '' when nothing salient. Bounded ≤ 160 chars.
//   buildActionReceiptList(items) — bounded multi-line 'Done:' block for a
//     batch (≤ 8 receipt bullets + one overflow line); degenerate input → ''.
//
// Sanitization contract: code fences, <untrusted_quoted> blocks, and JSON
// braces are stripped from anything that leaks through; output is one line.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: user-action-receipt-core).
// Deterministic (no Date.now/Math.random). Every export is TOTAL — degenerate
// input (null/undefined/wrong types/circular/huge/symbols) never throws; a
// safe neutral string ('') comes back instead.

// ── Bounds (exported so wiring and smoke share the exact limits) ─────────────

/** Hard cap on a single user receipt line (strictly < 200 per contract). */
export const USER_RECEIPT_MAX_CHARS = 180;

/** Cap on the salient one-liner from summarizeToolResultForUser. */
export const USER_RECEIPT_SUMMARY_MAX_CHARS = 160;

/** Max receipt bullets in a 'Done:' block (one '…and N more.' line may follow). */
export const USER_RECEIPT_LIST_MAX_LINES = 8;

/** Any input string is sliced to this many chars before any regex/parse work. */
const MAX_INPUT_CHARS = 32_000;

/** Max batch items even looked at by buildActionReceiptList. */
const MAX_LIST_ITEMS_SCANNED = 64;

/** One batch item for buildActionReceiptList. `ok` wins over `status`. */
export interface UserActionReceiptItem {
  toolName: string;
  result?: unknown;
  ok?: boolean;
  /** Optional SwanBotStructuredToolAction-style status ('completed'|'failed'|…). */
  status?: string;
}

// ── Tiny total helpers ───────────────────────────────────────────────────────

/** String/finite-number → bounded string; everything else (symbols!) → ''. */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v.length > MAX_INPUT_CHARS ? v.slice(0, MAX_INPUT_CHARS) : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capWithEllipsis(s: string, cap: number): string {
  if (cap <= 1) return s.length > 0 ? '…' : '';
  return s.length > cap ? `${s.slice(0, cap - 1).trimEnd()}…` : s;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Minimal JSON-string-value unescape for regex-extracted (possibly truncated) values. */
function unescapeJsonValue(s: string): string {
  return s
    .replace(/\\(["'/])/g, '$1')
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\\\/g, '\\');
}

// ── Salient-text extraction ──────────────────────────────────────────────────

/** Priority order for salient string fields on a result object. */
const SALIENT_STRING_KEYS = [
  'resultsText',
  'summaryText',
  'summary',
  'message',
  'text',
  'title',
  'name',
  'label',
  'subject',
  'path',
  'url',
  'error',
  'reason',
  'status',
] as const;

/** Numeric fields that read as a count when no text field exists. */
const COUNT_KEYS = ['count', 'total', 'itemCount', 'actionCount'] as const;

function countText(n: number): string {
  return `${n} item${n === 1 ? '' : 's'}`;
}

/** First salient raw string from an object/array result. Depth-bounded. */
function rawSalientFromObjectish(value: unknown, depth: number): string {
  if (depth > 2) return '';
  if (Array.isArray(value)) {
    return value.length > 0 ? countText(value.length) : '';
  }
  if (!isObj(value)) return '';
  for (const key of SALIENT_STRING_KEYS) {
    const v = value[key];
    if (typeof v === 'string' && v.trim() !== '') return toStr(v);
  }
  for (const key of COUNT_KEYS) {
    const v = value[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return countText(Math.floor(v));
  }
  return rawSalientFromObjectish(value.data, depth + 1);
}

/** Regex-extract a known key's string value from unparseable/truncated JSON. */
function regexExtractKnownKey(jsonish: string): string {
  for (const key of SALIENT_STRING_KEYS) {
    const m = jsonish.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (m && m[1] && m[1].trim() !== '') return unescapeJsonValue(m[1]);
  }
  return '';
}

/**
 * The raw (pre-sanitize) salient text of any tool result: unwraps one level
 * of stringified JSON (including 1200-char TRUNCATED previews via regex),
 * walks known object keys, counts arrays. '' when nothing salient. Total.
 */
function rawSalientText(result: unknown): string {
  if (typeof result === 'string') {
    const s = toStr(result);
    const t = s.trimStart();
    if (t.startsWith('{') || t.startsWith('[')) {
      const parsed = tryParseJson(t);
      if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
        return rawSalientFromObjectish(parsed, 0);
      }
      const extracted = regexExtractKnownKey(t);
      if (extracted) return toStr(extracted);
    }
    return s;
  }
  if (Array.isArray(result) || isObj(result)) return rawSalientFromObjectish(result, 0);
  return toStr(result);
}

// ── Sanitization (fences / JSON braces / untrusted blocks → one clean line) ──

const UNTRUSTED_BLOCK_RE = /<\s*untrusted_quoted\s*>[\s\S]*?<\s*\/\s*untrusted_quoted\s*>/gi;
const UNTRUSTED_TAG_RE = /<\s*\/?\s*untrusted_quoted\s*>/gi;

function looksJsonish(line: string): boolean {
  return /^[[{]/.test(line) || /"\s*:\s*/.test(line);
}

/**
 * Collapse any raw text to ONE clean human line: drop <untrusted_quoted>
 * blocks and code fences, pick the first informative line, strip JSON chrome
 * (braces always; quotes/brackets/colons when the line looks like JSON),
 * collapse whitespace, cap with '…'. Total; '' on nothing usable.
 */
function sanitizeLine(raw: unknown, cap: number): string {
  let s = toStr(raw);
  if (s === '') return '';
  s = s.replace(UNTRUSTED_BLOCK_RE, ' ').replace(UNTRUSTED_TAG_RE, ' ');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  const openFence = s.indexOf('```');
  if (openFence >= 0) s = s.slice(0, openFence); // unbalanced fence → drop the rest
  let line = '';
  for (const rawLine of s.split(/\r?\n/)) {
    const t = rawLine.trim();
    if (t === '') continue;
    if (/^-{3,}\s*(stdout|stderr)/i.test(t)) continue; // exec section markers
    if (/^[{}[\]",:.\s\-=_|…]*$/.test(t)) continue; // pure punctuation/JSON chrome
    if (/^"?ok"?\s*[:=]\s*(true|false)\s*,?$/i.test(t)) continue; // bare ok flag line
    line = t;
    break;
  }
  if (line === '') return '';
  if (looksJsonish(line)) {
    line = line.replace(/["[\]]/g, ' ').replace(/\s*[:,]\s*/g, ' ');
  }
  line = line.replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();
  if (line === '') return '';
  return capWithEllipsis(line, cap);
}

/** Final belt-and-braces polish for a composed receipt: no fences, no braces,
 *  no untrusted tags, single line, hard cap (always < 200). */
function polishReceipt(s: string): string {
  const cleaned = s
    .replace(/```/g, ' ')
    .replace(UNTRUSTED_TAG_RE, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return capWithEllipsis(cleaned, USER_RECEIPT_MAX_CHARS);
}

// ── Family helpers ───────────────────────────────────────────────────────────

function normalizeToolName(toolName: unknown): string {
  return typeof toolName === 'string' ? toolName.trim().slice(0, 80).toLowerCase() : '';
}

/** 'rooms.create' → 'rooms create'; '' → 'the action'. */
function friendlyLabel(tool: string): string {
  const label = tool.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return label === '' ? 'the action' : capWithEllipsis(label, 40);
}

/** ok wins when boolean; else infer from result.ok / a `"ok":false` marker. */
function resolveOk(ok: unknown, result: unknown): boolean {
  if (ok === true) return true;
  if (ok === false) return false;
  if (isObj(result) && typeof result.ok === 'boolean') return result.ok;
  if (typeof result === 'string') {
    const m = toStr(result).match(/"ok"\s*:\s*(true|false)/);
    if (m) return m[1] === 'true';
  }
  return true;
}

/** First "double-quoted" chunk of the raw text (a name/title/subject). */
function firstQuotedName(raw: string): string {
  const m = raw.match(/"([^"\n]{1,80})"/);
  return m && m[1] ? m[1].replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** First email address after a 'to ' in the raw text. */
function emailRecipient(raw: string): string {
  const m = raw.match(/\bto\s+<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/i);
  return m && m[1] ? m[1].replace(/[.,;:]+$/, '') : '';
}

/** Short failure reason: salient line minus tool-name/'failed:'/'error:' echoes. */
function shortReason(raw: string, tool: string): string {
  let r = sanitizeLine(raw, 120);
  if (r === '') return '';
  if (tool !== '') {
    r = r.replace(new RegExp(`^${escapeRegex(tool)}[\\s:,-]+`, 'i'), '');
    const last = tool.split('.').pop() || '';
    if (last !== '' && last !== tool) r = r.replace(new RegExp(`^${escapeRegex(last)}[\\s:,-]+`, 'i'), '');
  }
  r = r.replace(/^error[\s:,-]+/i, '').replace(/^(failed|refused)[\s:,-]+/i, '');
  return r.trim();
}

function couldnt(verb: string, reason: string): string {
  return reason === '' ? `Couldn't ${verb}` : `Couldn't ${verb}: ${reason}`;
}

/** rooms.create / tasks.create style: '<prefix> "<name>"'. */
function createNounReceipt(prefix: string, raw: string, ok: boolean, failVerb: string, tool: string): string {
  if (!ok) return couldnt(failVerb, shortReason(raw, tool));
  const name = firstQuotedName(raw);
  if (name !== '') return `${prefix} "${name}"`;
  const salient = sanitizeLine(raw, 150);
  return salient !== '' ? salient : prefix;
}

/** local.run_shell / git.run: 'Ran `cmd` — passed/failed (exit N)/timed out'. */
function execReceipt(tool: string, raw: string, ok: boolean): string {
  const cmdMatch = raw.match(/(?:^|\n)\$ ([^\n]{1,200})/);
  if (!cmdMatch || !cmdMatch[1] || cmdMatch[1].trim() === '') {
    // The command never ran (refused / bridge offline / no exec header).
    const verb = tool === 'git.run' ? 'run the git command' : 'run the command';
    if (!ok) return couldnt(verb, shortReason(raw, tool));
    const salient = sanitizeLine(raw, 150);
    return salient !== '' ? salient : 'Ran the command — passed';
  }
  const cmd = capWithEllipsis(cmdMatch[1].trim().replace(/`/g, ''), 80);
  const statusMatch = raw.match(/(?:^|\n)\$ [^\n]*\n([^\n]{1,240})/);
  const statusLine = statusMatch && statusMatch[1] ? statusMatch[1] : '';
  let status: string;
  if (/TIMED OUT/i.test(statusLine)) status = 'timed out';
  else if (/OUTPUT OVERFLOW/i.test(statusLine)) status = 'failed (output overflow)';
  else if (/\bexit 0\b/.test(statusLine)) status = 'passed';
  else {
    const exitMatch = statusLine.match(/\bexit (\d{1,4})\b/);
    if (exitMatch && exitMatch[1] && exitMatch[1] !== '0') status = `failed (exit ${exitMatch[1]})`;
    else status = ok ? 'passed' : 'failed';
  }
  return `Ran \`${cmd}\` — ${status}`;
}

/** desktop.edit_file: 'Edited path (N changes)' / 'Created path'. */
function editFileReceipt(raw: string, ok: boolean): string {
  if (!ok) return couldnt('edit the file', shortReason(raw, 'desktop.edit_file'));
  let line = sanitizeLine(raw, 150);
  if (line === '') return 'Edited file';
  line = line.replace(/\((\d+)\s+replacements?\)/, (_m, n: string) => `(${n} ${n === '1' ? 'change' : 'changes'})`);
  return line;
}

/** gmail.write: 'Sent email to X — "Subject"' / 'Saved email draft to X — …'. */
function gmailWriteReceipt(raw: string, ok: boolean): string {
  if (!ok) return couldnt('send the email', shortReason(raw, 'gmail.write'));
  const isDraft = /\bdraft\b/i.test(raw) && !/email sent/i.test(raw);
  const base = isDraft ? 'Saved email draft' : 'Sent email';
  const to = emailRecipient(raw);
  const subject = firstQuotedName(raw);
  if (to === '' && subject === '') {
    const salient = sanitizeLine(raw, 120);
    return salient !== '' ? `${base} — ${salient}` : base;
  }
  return `${base}${to !== '' ? ` to ${to}` : ''}${subject !== '' ? ` — "${subject}"` : ''}`;
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Best-effort salient one-liner (title/name/path/count/status/results text)
 * from any tool result — object, stringified JSON (even truncated), or plain
 * text. '' when nothing salient. Never raw JSON, never fenced, ≤ 160 chars.
 * Total: never throws on any input.
 */
export function summarizeToolResultForUser(toolName: unknown, result: unknown): string {
  try {
    void normalizeToolName(toolName); // reserved for future per-family tuning
    return sanitizeLine(rawSalientText(result), USER_RECEIPT_SUMMARY_MAX_CHARS);
  } catch {
    return '';
  }
}

/**
 * ONE compact human receipt line for an executed tool action — what the USER
 * sees in the action turn. Never raw JSON or code fences; always < 200 chars.
 * Per-family phrasing for rooms.create, tasks.create (+room/mission task
 * variants), goals.create, local.run_shell, git.run, desktop.edit_file, and
 * gmail.write; anything else falls back to the salient result line or
 * 'Completed <tool>'. ok=false → "Couldn't <verb>: <short reason>". Total.
 */
export function buildUserActionReceipt(toolName: unknown, result: unknown, ok: unknown): string {
  let tool = '';
  try { tool = normalizeToolName(toolName); } catch { tool = ''; }
  let okFlag = true;
  try { okFlag = resolveOk(ok, result); } catch { okFlag = true; }
  let raw = '';
  // Hostile results (throwing getters, proxies) degrade to "no salient text"
  // instead of erasing the receipt — the neutral fallback line still renders.
  try { raw = rawSalientText(result); } catch { raw = ''; }
  try {
    if (tool === 'local.run_shell' || tool === 'git.run') return polishReceipt(execReceipt(tool, raw, okFlag));
    if (tool === 'desktop.edit_file') return polishReceipt(editFileReceipt(raw, okFlag));
    if (tool === 'gmail.write') return polishReceipt(gmailWriteReceipt(raw, okFlag));
    if (tool === 'rooms.create') {
      return polishReceipt(createNounReceipt('Created room', raw, okFlag, 'create the room', tool));
    }
    if (tool === 'tasks.create' || tool === 'rooms.create_task' || tool === 'missions.create_task') {
      return polishReceipt(createNounReceipt('Added task', raw, okFlag, 'add the task', tool));
    }
    if (tool === 'goals.create') {
      return polishReceipt(createNounReceipt('Created goal', raw, okFlag, 'create the goal', tool));
    }

    const salient = sanitizeLine(raw, 150);
    if (!okFlag) return polishReceipt(couldnt(`complete ${friendlyLabel(tool)}`, shortReason(raw, tool)));
    if (salient !== '') return polishReceipt(salient);
    return polishReceipt(`Completed ${friendlyLabel(tool)}`);
  } catch {
    // Absolute last resort: still hand back a neutral, truthful line.
    return polishReceipt(okFlag ? `Completed ${friendlyLabel(tool)}` : couldnt(`complete ${friendlyLabel(tool)}`, ''));
  }
}

/** SwanBotStructuredToolAction-style status → ok flag (undefined = unknown). */
function statusToOk(status: unknown): boolean | undefined {
  if (typeof status !== 'string') return undefined;
  const s = status.trim().toLowerCase();
  if (s === 'completed' || s === 'passed' || s === 'success') return true;
  if (s === 'failed' || s === 'blocked' || s === 'error' || s === 'manual_required') return false;
  return undefined;
}

/**
 * Bounded multi-line 'Done:' block for a batch of executed actions:
 * up to 8 '- <receipt>' bullets plus one '…and N more.' overflow line.
 * Rows without a usable toolName are skipped; degenerate input → ''. Total.
 */
export function buildActionReceiptList(items: UserActionReceiptItem[] | unknown): string {
  try {
    if (!Array.isArray(items) || items.length === 0) return '';
    const receipts: string[] = [];
    let usable = 0;
    for (const item of items.slice(0, MAX_LIST_ITEMS_SCANNED)) {
      try {
        if (!isObj(item)) continue;
        const nameRaw = item.toolName ?? item.tool_name ?? item.tool;
        const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
        if (name === '') continue;
        usable += 1;
        if (receipts.length >= USER_RECEIPT_LIST_MAX_LINES) continue; // still count overflow
        const result = 'result' in item ? item.result : 'output_preview' in item ? item.output_preview : item.output;
        const ok = typeof item.ok === 'boolean' ? item.ok : statusToOk(item.status);
        const receipt = buildUserActionReceipt(name, result, ok);
        if (receipt !== '') receipts.push(receipt);
      } catch {
        // skip the broken row, keep the batch
      }
    }
    if (receipts.length === 0) return '';
    const lines = receipts.map((r) => `- ${r}`);
    const overflow = usable - receipts.length;
    if (overflow > 0) lines.push(`…and ${overflow} more.`);
    return `Done:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}
