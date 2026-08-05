// googleWorkspaceOps — the PURE contract core for the Google Workspace agent
// tools (Gmail / Docs / Sheets / Drive / Calendar). This module owns the two
// deterministic, side-effect-free halves of every Workspace operation so they
// can be smoke-tested before any runtime wiring:
//
//   (A) REQUEST PLANS — one `plan*` function per op. Each validates its args
//       and returns a `GoogleApiPlanResult`: either `{ ok: true, method, url,
//       body?, scopeAnyOf, readOnly }` with EXACT, fully URL-encoded URLs, or
//       `{ ok: false, error }` with a plain-language reason. The runtime layer
//       (openswanToolRuntime / a swanbot tool adapter) resolves the OAuth
//       token, checks `scopeAnyOf` via `checkGoogleScope`, executes the plan
//       with fetch, and feeds failures to `describeGoogleApiError`.
//
//   (B) RESPONSE SHAPING — extractors that turn raw Google API JSON into the
//       compact, chat-safe shapes agents consume: Gmail message text (nested
//       multipart walk + base64url decode + HTML fallback), Docs text (incl.
//       tables), Sheets pipe-table rendering, Drive/Calendar summaries, and a
//       user-honest error-code mapper with Bearer-token scrubbing.
//
// SECURITY INVARIANTS (smoke-pinned in scripts/google-workspace-ops-smoketest.ts):
//   - NO tokens ever enter or leave this module; `describeGoogleApiError`
//     scrubs any `Bearer …` echo from API bodies before they can reach chat.
//   - Path ids (message/document/spreadsheet/file/thread) are restricted to
//     [A-Za-z0-9_-] — path-injection like `../evil` or `a/b` is rejected.
//   - RFC822 header values have CR/LF stripped (header-injection guard), and
//     recipient lists are strictly validated (1..10 real addresses).
//
// PURITY: ZERO runtime imports, tsx-loadable. No fetch, no Buffer/atob/btoa —
// UTF-8 and base64url are implemented by hand. Every export is TOTAL: it never
// throws on degenerate/undefined input, returning an error-shaped result or an
// empty/neutral value instead.

// ─── Op + plan types ─────────────────────────────────────────────────────────

export type GoogleWorkspaceOp =
  | 'gmail_search'
  | 'gmail_get'
  | 'gmail_send'
  | 'gmail_draft'
  | 'gdocs_get'
  | 'gdocs_append'
  | 'gsheets_read'
  | 'gsheets_append'
  | 'gsheets_update'
  | 'gdrive_search'
  | 'gdrive_export'
  | 'gcal_list'
  | 'gcal_create';

export interface GoogleApiPlan {
  ok: true;
  op: GoogleWorkspaceOp;
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  body?: unknown;
  /** The plan is executable when ANY one of these scopes was granted. */
  scopeAnyOf: string[];
  readOnly: boolean;
}

export interface GoogleApiPlanError {
  ok: false;
  error: string;
}

export type GoogleApiPlanResult = GoogleApiPlan | GoogleApiPlanError;

// ─── Scope constants ─────────────────────────────────────────────────────────

export const SCOPE_GMAIL_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
export const SCOPE_GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
export const SCOPE_GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
/** The full-mailbox legacy scope — implies every Gmail capability. */
export const SCOPE_MAIL_FULL = 'https://mail.google.com/';
export const SCOPE_DOCUMENTS = 'https://www.googleapis.com/auth/documents';
export const SCOPE_SPREADSHEETS = 'https://www.googleapis.com/auth/spreadsheets';
export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive';
export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar';

const GMAIL_READ_SCOPES = [SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL, SCOPE_GMAIL_READONLY];
const GMAIL_SEND_SCOPES = [SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL, SCOPE_GMAIL_SEND];
// gmail.send does NOT permit draft creation, so drafts need modify (or full).
const GMAIL_DRAFT_SCOPES = [SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL];
// Docs → documents ONLY, Sheets → spreadsheets ONLY, Drive → drive ONLY,
// Calendar → calendar ONLY (deliberately no drive-as-superset shortcuts).
const DOCS_SCOPES = [SCOPE_DOCUMENTS];
const SHEETS_SCOPES = [SCOPE_SPREADSHEETS];
const DRIVE_SCOPES = [SCOPE_DRIVE];
const CALENDAR_SCOPES = [SCOPE_CALENDAR];

/**
 * True when any scope the plan accepts is present in the granted list (exact
 * string match). Accepts a string[] or a space-separated scope string (the two
 * shapes OAuth token responses use). Degenerate input → false, never throws.
 */
export function checkGoogleScope(
  grantedScopes: unknown,
  plan: { scopeAnyOf: string[] } | null | undefined,
): boolean {
  try {
    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.scopeAnyOf)) return false;
    let granted: string[];
    if (Array.isArray(grantedScopes)) {
      granted = grantedScopes.filter((s): s is string => typeof s === 'string');
    } else if (typeof grantedScopes === 'string') {
      granted = grantedScopes.split(/\s+/).filter(Boolean);
    } else {
      return false;
    }
    const set = new Set(granted);
    return plan.scopeAnyOf.some((s) => typeof s === 'string' && set.has(s));
  } catch {
    return false;
  }
}

// ─── Small total helpers ─────────────────────────────────────────────────────

function planError(error: string): GoogleApiPlanError {
  return { ok: false, error };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Path-segment ids must be [A-Za-z0-9_-] only (path-injection guard). */
function cleanId(v: unknown): string | null {
  const s = asString(v).trim();
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// ─── UTF-8 + base64url (pure — no Buffer/atob/btoa) ─────────────────────────

const B64_STD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_REVERSE: Record<string, number> = {};
for (let i = 0; i < B64_STD_ALPHABET.length; i += 1) B64_REVERSE[B64_STD_ALPHABET[i]] = i;

/** Encodes a JS string to UTF-8 bytes, codepoint by codepoint. */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) {
      bytes.push(cp);
    } else if (cp <= 0x7ff) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

/** Decodes UTF-8 bytes back to a string; invalid sequences become U+FFFD. */
function utf8DecodeBytes(bytes: number[]): string {
  let out = '';
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b0 = bytes[i] & 0xff;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc0 && b0 < 0xe0 && i + 1 < len && (bytes[i + 1] & 0xc0) === 0x80) {
      out += String.fromCodePoint(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (
      b0 >= 0xe0 && b0 < 0xf0 && i + 2 < len &&
      (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80
    ) {
      out += String.fromCodePoint(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else if (
      b0 >= 0xf0 && b0 < 0xf8 && i + 3 < len &&
      (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80 && (bytes[i + 3] & 0xc0) === 0x80
    ) {
      const cp =
        ((b0 & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
      i += 4;
    } else {
      out += '�';
      i += 1;
    }
  }
  return out;
}

function bytesToBase64(bytes: number[], urlSafe: boolean, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes[i] & 0xff;
    const b1 = remaining > 1 ? bytes[i + 1] & 0xff : 0;
    const b2 = remaining > 2 ? bytes[i + 2] & 0xff : 0;
    out += B64_STD_ALPHABET[b0 >> 2];
    out += B64_STD_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += remaining > 1 ? B64_STD_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : pad ? '=' : '';
    out += remaining > 2 ? B64_STD_ALPHABET[b2 & 0x3f] : pad ? '=' : '';
  }
  return urlSafe ? out.replace(/\+/g, '-').replace(/\//g, '_') : out;
}

/** UTF-8 string → base64url (no padding). Total: non-strings become ''. */
export function base64UrlEncode(input: string): string {
  return bytesToBase64(utf8Bytes(asString(input)), true, false);
}

/**
 * base64url (or standard base64, padded or not) → UTF-8 string. Tolerant of
 * missing padding and of whitespace/line wraps; invalid input → ''.
 */
export function base64UrlDecode(input: string): string {
  try {
    if (typeof input !== 'string') return '';
    const s = input
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/=+$/, '');
    if (s === '') return '';
    if (!/^[A-Za-z0-9+/]+$/.test(s)) return '';
    if (s.length % 4 === 1) return '';
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of s) {
      buffer = (buffer << 6) | B64_REVERSE[ch];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }
    return utf8DecodeBytes(bytes);
  } catch {
    return '';
  }
}

// ─── RFC822 email building (pure) ────────────────────────────────────────────

/** CR/LF can never survive into a header value (header-injection guard). */
function stripHeaderValue(v: unknown): string {
  return asString(v).replace(/[\r\n]+/g, ' ').trim();
}

function isAscii(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(s);
}

function wrapBase64Lines(s: string): string {
  return s.replace(/(.{76})(?=.)/g, '$1\r\n');
}

export interface Rfc822EmailInput {
  to?: string;
  subject?: string;
  bodyText?: string;
  cc?: string;
  /** RFC822 Message-ID being replied to → In-Reply-To + References headers. */
  inReplyTo?: string;
}

/**
 * Builds a minimal RFC822 text/plain message. Header values are CR/LF-stripped;
 * non-ASCII subjects get RFC 2047 UTF-8 base64 encoding; non-ASCII bodies flip
 * Content-Transfer-Encoding from 7bit to base64. Total — degenerate input just
 * yields a message with empty headers/body.
 */
export function buildRfc822Email(input: Rfc822EmailInput): string {
  const i = asRecord(input);
  const to = stripHeaderValue(i.to);
  const cc = stripHeaderValue(i.cc);
  const subjectRaw = stripHeaderValue(i.subject);
  const subject = isAscii(subjectRaw)
    ? subjectRaw
    : `=?UTF-8?B?${bytesToBase64(utf8Bytes(subjectRaw), false, true)}?=`;
  const inReplyToRaw = stripHeaderValue(i.inReplyTo).replace(/\s+/g, '');
  const inReplyTo = inReplyToRaw
    ? inReplyToRaw.startsWith('<') ? inReplyToRaw : `<${inReplyToRaw}>`
    : '';
  const bodyText = asString(i.bodyText);
  const bodyIsAscii = isAscii(bodyText);

  const headers: string[] = [`To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    `Content-Transfer-Encoding: ${bodyIsAscii ? '7bit' : 'base64'}`,
  );
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  }
  const body = bodyIsAscii
    ? bodyText
    : wrapBase64Lines(bytesToBase64(utf8Bytes(bodyText), false, true));
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

// ─── Address validation ──────────────────────────────────────────────────────

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Accepts `a@b.c` or `Name <a@b.c>`; returns the bare address or null. */
function extractEmailAddress(entry: string): string | null {
  const trimmed = entry.trim();
  const angled = trimmed.match(/^[^<>]*<([^<>]+)>$/);
  const addr = (angled ? angled[1] : trimmed).trim();
  return EMAIL_RE.test(addr) ? addr : null;
}

type AddressListResult = { ok: true; display: string; count: number } | { ok: false; error: string };

function validateAddressList(v: unknown, label: string, max: number): AddressListResult {
  const raw = stripHeaderValue(v);
  if (!raw) return { ok: false, error: `${label} is required (comma-separated email addresses).` };
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: `${label} is required (comma-separated email addresses).` };
  if (parts.length > max) return { ok: false, error: `${label} has too many recipients (${parts.length}; the limit is ${max}).` };
  for (const part of parts) {
    if (!extractEmailAddress(part)) {
      return { ok: false, error: `${label} contains an invalid email address: "${part.slice(0, 80)}".` };
    }
  }
  return { ok: true, display: parts.join(', '), count: parts.length };
}

// ─── Gmail planners ──────────────────────────────────────────────────────────

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailSearchInput {
  query: string;
  maxResults?: number;
}

export function planGmailSearch(input: GmailSearchInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const query = asString(i.query).trim();
  if (!query) return planError('Gmail search needs a non-empty query.');
  const n = clampInt(i.maxResults, 1, 25, 10);
  return {
    ok: true,
    op: 'gmail_search',
    method: 'GET',
    url: `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${n}`,
    scopeAnyOf: [...GMAIL_READ_SCOPES],
    readOnly: true,
  };
}

export interface GmailGetInput {
  messageId: string;
}

export function planGmailGet(input: GmailGetInput): GoogleApiPlanResult {
  const id = cleanId(asRecord(input).messageId);
  if (!id) return planError('Gmail get needs a valid messageId (letters, digits, "_" and "-" only).');
  return {
    ok: true,
    op: 'gmail_get',
    method: 'GET',
    url: `${GMAIL_BASE}/messages/${id}?format=full`,
    scopeAnyOf: [...GMAIL_READ_SCOPES],
    readOnly: true,
  };
}

export interface GmailOutboundInput {
  to: string;
  subject: string;
  bodyText: string;
  cc?: string;
  replyToMessageId?: string;
  threadId?: string;
}

const GMAIL_SUBJECT_MAX_CHARS = 500;
const GMAIL_BODY_MAX_CHARS = 50_000;

function planGmailOutbound(input: unknown, op: 'gmail_send' | 'gmail_draft'): GoogleApiPlanResult {
  const label = op === 'gmail_send' ? 'Gmail send' : 'Gmail draft';
  const i = asRecord(input);

  const toResult = validateAddressList(i.to, `${label}: "to"`, 10);
  if (!toResult.ok) return planError(toResult.error);

  let ccDisplay: string | undefined;
  if (i.cc !== undefined && i.cc !== null && asString(i.cc).trim() !== '') {
    const ccResult = validateAddressList(i.cc, `${label}: "cc"`, 10);
    if (!ccResult.ok) return planError(ccResult.error);
    ccDisplay = ccResult.display;
  }

  const subject = stripHeaderValue(i.subject);
  if (!subject) return planError(`${label}: subject is required.`);
  if (subject.length > GMAIL_SUBJECT_MAX_CHARS) {
    return planError(`${label}: subject is too long (${subject.length} chars; the limit is ${GMAIL_SUBJECT_MAX_CHARS}).`);
  }

  const bodyText = asString(i.bodyText);
  if (!bodyText.trim()) return planError(`${label}: bodyText is required.`);
  if (bodyText.length > GMAIL_BODY_MAX_CHARS) {
    return planError(`${label}: bodyText is too long (${bodyText.length} chars; the limit is ${GMAIL_BODY_MAX_CHARS}).`);
  }

  const inReplyTo = stripHeaderValue(i.replyToMessageId);

  let threadId: string | undefined;
  if (i.threadId !== undefined && i.threadId !== null && asString(i.threadId).trim() !== '') {
    const t = cleanId(i.threadId);
    if (!t) return planError(`${label}: threadId is invalid (letters, digits, "_" and "-" only).`);
    threadId = t;
  }

  const raw = base64UrlEncode(
    buildRfc822Email({
      to: toResult.display,
      cc: ccDisplay,
      subject,
      bodyText,
      inReplyTo: inReplyTo || undefined,
    }),
  );

  if (op === 'gmail_send') {
    return {
      ok: true,
      op,
      method: 'POST',
      url: `${GMAIL_BASE}/messages/send`,
      body: threadId ? { raw, threadId } : { raw },
      scopeAnyOf: [...GMAIL_SEND_SCOPES],
      readOnly: false,
    };
  }
  return {
    ok: true,
    op,
    method: 'POST',
    url: `${GMAIL_BASE}/drafts`,
    body: { message: threadId ? { raw, threadId } : { raw } },
    scopeAnyOf: [...GMAIL_DRAFT_SCOPES],
    readOnly: false,
  };
}

export function planGmailSend(input: GmailOutboundInput): GoogleApiPlanResult {
  return planGmailOutbound(input, 'gmail_send');
}

export function planGmailDraft(input: GmailOutboundInput): GoogleApiPlanResult {
  return planGmailOutbound(input, 'gmail_draft');
}

// ─── Docs planners ───────────────────────────────────────────────────────────

const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const GDOCS_APPEND_MAX_CHARS = 60_000;

export interface GdocsGetInput {
  documentId: string;
}

export function planGdocsGet(input: GdocsGetInput): GoogleApiPlanResult {
  const id = cleanId(asRecord(input).documentId);
  if (!id) return planError('Docs get needs a valid documentId (letters, digits, "_" and "-" only).');
  return {
    ok: true,
    op: 'gdocs_get',
    method: 'GET',
    url: `${DOCS_BASE}/${id}`,
    scopeAnyOf: [...DOCS_SCOPES],
    readOnly: true,
  };
}

export interface GdocsAppendInput {
  documentId: string;
  text: string;
}

export function planGdocsAppend(input: GdocsAppendInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const id = cleanId(i.documentId);
  if (!id) return planError('Docs append needs a valid documentId (letters, digits, "_" and "-" only).');
  const text = asString(i.text);
  if (!text.trim()) return planError('Docs append needs non-empty text.');
  if (text.length > GDOCS_APPEND_MAX_CHARS) {
    return planError(`Docs append text is too long (${text.length} chars; the limit is ${GDOCS_APPEND_MAX_CHARS}).`);
  }
  const finalText = text.endsWith('\n') ? text : `${text}\n`;
  return {
    ok: true,
    op: 'gdocs_append',
    method: 'POST',
    url: `${DOCS_BASE}/${id}:batchUpdate`,
    body: { requests: [{ insertText: { endOfSegmentLocation: {}, text: finalText } }] },
    scopeAnyOf: [...DOCS_SCOPES],
    readOnly: false,
  };
}

// ─── Sheets planners ─────────────────────────────────────────────────────────

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const GSHEETS_RANGE_MAX_CHARS = 200;
const GSHEETS_MAX_ROWS = 200;
const GSHEETS_MAX_CELLS_PER_ROW = 50;

export type SheetCellValue = string | number | boolean | null;

function validateSheetRange(v: unknown, label: string): { ok: true; range: string } | GoogleApiPlanError {
  const range = asString(v).trim();
  if (!range) return planError(`${label} needs a non-empty range (e.g. "Sheet1!A1:C10").`);
  if (range.length > GSHEETS_RANGE_MAX_CHARS) {
    return planError(`${label} range is too long (${range.length} chars; the limit is ${GSHEETS_RANGE_MAX_CHARS}).`);
  }
  return { ok: true, range };
}

function validateSheetValues(v: unknown, label: string): { ok: true; values: SheetCellValue[][] } | GoogleApiPlanError {
  if (!Array.isArray(v) || v.length === 0) {
    return planError(`${label} needs "values" as a non-empty array of rows.`);
  }
  if (v.length > GSHEETS_MAX_ROWS) {
    return planError(`${label} has too many rows (${v.length}; the limit is ${GSHEETS_MAX_ROWS}).`);
  }
  for (const row of v) {
    if (!Array.isArray(row)) return planError(`${label}: every row in "values" must be an array of cells.`);
    if (row.length > GSHEETS_MAX_CELLS_PER_ROW) {
      return planError(`${label}: a row has too many cells (${row.length}; the limit is ${GSHEETS_MAX_CELLS_PER_ROW}).`);
    }
    for (const cell of row) {
      const t = typeof cell;
      const okCell =
        cell === null ||
        t === 'string' ||
        t === 'boolean' ||
        (t === 'number' && Number.isFinite(cell as number));
      if (!okCell) return planError(`${label}: cells must be string, number, boolean, or null.`);
    }
  }
  return { ok: true, values: v as SheetCellValue[][] };
}

export interface GsheetsReadInput {
  spreadsheetId: string;
  range: string;
}

export function planGsheetsRead(input: GsheetsReadInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const id = cleanId(i.spreadsheetId);
  if (!id) return planError('Sheets read needs a valid spreadsheetId (letters, digits, "_" and "-" only).');
  const range = validateSheetRange(i.range, 'Sheets read');
  if (!range.ok) return range;
  return {
    ok: true,
    op: 'gsheets_read',
    method: 'GET',
    url: `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range.range)}?majorDimension=ROWS`,
    scopeAnyOf: [...SHEETS_SCOPES],
    readOnly: true,
  };
}

export interface GsheetsWriteInput {
  spreadsheetId: string;
  range: string;
  values: SheetCellValue[][];
}

export function planGsheetsAppend(input: GsheetsWriteInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const id = cleanId(i.spreadsheetId);
  if (!id) return planError('Sheets append needs a valid spreadsheetId (letters, digits, "_" and "-" only).');
  const range = validateSheetRange(i.range, 'Sheets append');
  if (!range.ok) return range;
  const values = validateSheetValues(i.values, 'Sheets append');
  if (!values.ok) return values;
  return {
    ok: true,
    op: 'gsheets_append',
    method: 'POST',
    url: `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    body: { values: values.values },
    scopeAnyOf: [...SHEETS_SCOPES],
    readOnly: false,
  };
}

export function planGsheetsUpdate(input: GsheetsWriteInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const id = cleanId(i.spreadsheetId);
  if (!id) return planError('Sheets update needs a valid spreadsheetId (letters, digits, "_" and "-" only).');
  const range = validateSheetRange(i.range, 'Sheets update');
  if (!range.ok) return range;
  const values = validateSheetValues(i.values, 'Sheets update');
  if (!values.ok) return values;
  return {
    ok: true,
    op: 'gsheets_update',
    method: 'PUT',
    url: `${SHEETS_BASE}/${id}/values/${encodeURIComponent(range.range)}?valueInputOption=USER_ENTERED`,
    body: { values: values.values },
    scopeAnyOf: [...SHEETS_SCOPES],
    readOnly: false,
  };
}

// ─── Drive planners ──────────────────────────────────────────────────────────

const DRIVE_FILES_BASE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_LIST_FIELDS = 'files(id,name,mimeType,modifiedTime,webViewLink,size)';

/**
 * Builds the Drive `q` expression. Queries that already use Drive query
 * operators (`contains`, `mimeType`, `=`) pass through verbatim so power
 * callers keep full control; plain-text queries are wrapped as a
 * name-or-fullText search with single quotes escaped as \' (so "O'Brien"
 * cannot break out of the quoted literal).
 */
function buildDriveQuery(raw: string): string {
  if (/\bcontains\b|\bmimeType\b|=/.test(raw)) return raw;
  const escaped = raw.replace(/'/g, "\\'");
  return `name contains '${escaped}' or fullText contains '${escaped}'`;
}

export interface GdriveSearchInput {
  query: string;
  maxResults?: number;
}

export function planGdriveSearch(input: GdriveSearchInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const query = asString(i.query).trim();
  if (!query) return planError('Drive search needs a non-empty query.');
  const n = clampInt(i.maxResults, 1, 25, 10);
  const q = buildDriveQuery(query);
  return {
    ok: true,
    op: 'gdrive_search',
    method: 'GET',
    url:
      `${DRIVE_FILES_BASE}?q=${encodeURIComponent(q)}&pageSize=${n}` +
      `&fields=${encodeURIComponent(DRIVE_LIST_FIELDS)}` +
      `&orderBy=${encodeURIComponent('modifiedTime desc')}`,
    scopeAnyOf: [...DRIVE_SCOPES],
    readOnly: true,
  };
}

export interface GdriveExportInput {
  fileId: string;
  /** Export mime for Google-native files; defaults to text/plain. */
  mimeType?: string;
}

export function planGdriveExport(input: GdriveExportInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const id = cleanId(i.fileId);
  if (!id) return planError('Drive export needs a valid fileId (letters, digits, "_" and "-" only).');
  const mime = asString(i.mimeType).trim() || 'text/plain';
  return {
    ok: true,
    op: 'gdrive_export',
    method: 'GET',
    url: `${DRIVE_FILES_BASE}/${id}/export?mimeType=${encodeURIComponent(mime)}`,
    scopeAnyOf: [...DRIVE_SCOPES],
    readOnly: true,
  };
}

export interface GdriveDownloadInput {
  fileId: string;
}

/** The `alt=media` variant for non-Google-native (binary/uploaded) files. */
export function planGdriveDownload(input: GdriveDownloadInput): GoogleApiPlanResult {
  const id = cleanId(asRecord(input).fileId);
  if (!id) return planError('Drive download needs a valid fileId (letters, digits, "_" and "-" only).');
  return {
    ok: true,
    op: 'gdrive_export',
    method: 'GET',
    url: `${DRIVE_FILES_BASE}/${id}?alt=media`,
    scopeAnyOf: [...DRIVE_SCOPES],
    readOnly: true,
  };
}

// ─── Calendar planners ───────────────────────────────────────────────────────

const CALENDAR_EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Loose ISO-8601: date, or date + time with optional seconds/ms/offset. */
const ISO_DATETIME_LOOSE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const ALL_DAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GcalListInput {
  timeMinIso?: string;
  timeMaxIso?: string;
  query?: string;
  maxResults?: number;
}

export function planGcalList(input?: GcalListInput): GoogleApiPlanResult {
  const i = asRecord(input);
  const n = clampInt(i.maxResults, 1, 25, 10);
  let url = `${CALENDAR_EVENTS_BASE}?singleEvents=true&orderBy=startTime&maxResults=${n}`;

  const timeMin = asString(i.timeMinIso).trim();
  if (timeMin) {
    if (!ISO_DATETIME_LOOSE_RE.test(timeMin)) {
      return planError(`Calendar list: timeMinIso is not a valid ISO-8601 datetime: "${timeMin.slice(0, 80)}".`);
    }
    url += `&timeMin=${encodeURIComponent(timeMin)}`;
  }
  const timeMax = asString(i.timeMaxIso).trim();
  if (timeMax) {
    if (!ISO_DATETIME_LOOSE_RE.test(timeMax)) {
      return planError(`Calendar list: timeMaxIso is not a valid ISO-8601 datetime: "${timeMax.slice(0, 80)}".`);
    }
    url += `&timeMax=${encodeURIComponent(timeMax)}`;
  }
  const query = asString(i.query).trim();
  if (query) url += `&q=${encodeURIComponent(query)}`;

  return {
    ok: true,
    op: 'gcal_list',
    method: 'GET',
    url,
    scopeAnyOf: [...CALENDAR_SCOPES],
    readOnly: true,
  };
}

export interface GcalCreateInput {
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
  attendees?: string[];
  timeZone?: string;
}

const GCAL_SUMMARY_MAX_CHARS = 300;
const GCAL_MAX_ATTENDEES = 20;

type GcalEventTime = { date: string } | { dateTime: string; timeZone?: string };

function buildEventTime(iso: string, timeZone: string): GcalEventTime {
  if (ALL_DAY_DATE_RE.test(iso)) return { date: iso };
  return timeZone ? { dateTime: iso, timeZone } : { dateTime: iso };
}

export function planGcalCreate(input: GcalCreateInput): GoogleApiPlanResult {
  const i = asRecord(input);

  const summary = asString(i.summary).trim();
  if (!summary) return planError('Calendar create: summary is required.');
  if (summary.length > GCAL_SUMMARY_MAX_CHARS) {
    return planError(`Calendar create: summary is too long (${summary.length} chars; the limit is ${GCAL_SUMMARY_MAX_CHARS}).`);
  }

  const startIso = asString(i.startIso).trim();
  if (!ISO_DATETIME_LOOSE_RE.test(startIso)) {
    return planError(`Calendar create: startIso is not a valid ISO-8601 datetime: "${startIso.slice(0, 80)}".`);
  }
  const endIso = asString(i.endIso).trim();
  if (!ISO_DATETIME_LOOSE_RE.test(endIso)) {
    return planError(`Calendar create: endIso is not a valid ISO-8601 datetime: "${endIso.slice(0, 80)}".`);
  }

  let attendees: Array<{ email: string }> | undefined;
  if (i.attendees !== undefined && i.attendees !== null) {
    if (!Array.isArray(i.attendees)) {
      return planError('Calendar create: attendees must be an array of email addresses.');
    }
    if (i.attendees.length > GCAL_MAX_ATTENDEES) {
      return planError(`Calendar create: too many attendees (${i.attendees.length}; the limit is ${GCAL_MAX_ATTENDEES}).`);
    }
    const emails: Array<{ email: string }> = [];
    for (const entry of i.attendees) {
      const email = typeof entry === 'string' ? extractEmailAddress(entry) : null;
      if (!email) {
        return planError(`Calendar create: attendees contains an invalid email address: "${asString(entry).slice(0, 80)}".`);
      }
      emails.push({ email });
    }
    if (emails.length > 0) attendees = emails;
  }

  const timeZone = stripHeaderValue(i.timeZone);
  const description = asString(i.description);

  const body: Record<string, unknown> = {
    summary,
    start: buildEventTime(startIso, timeZone),
    end: buildEventTime(endIso, timeZone),
  };
  if (description.trim()) body.description = description;
  if (attendees) body.attendees = attendees;

  return {
    ok: true,
    op: 'gcal_create',
    method: 'POST',
    url: CALENDAR_EVENTS_BASE,
    body,
    scopeAnyOf: [...CALENDAR_SCOPES],
    readOnly: false,
  };
}

// ─── Response extractors (pure, total) ───────────────────────────────────────

const GMAIL_BODY_TEXT_CAP = 20_000;
const GDOC_TEXT_CAP = 40_000;
const SHEET_RENDER_ROW_CAP = 200;
const SHEET_RENDER_CHAR_CAP = 8_000;

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return '';
  const wanted = name.toLowerCase();
  for (const h of headers) {
    const rec = asRecord(h);
    if (asString(rec.name).toLowerCase() === wanted) return asString(rec.value);
  }
  return '';
}

/** Depth-first search for the first part of `mime` that carries body data. */
function findMimePart(part: unknown, mime: string, depth = 0): Record<string, unknown> | null {
  if (depth > 20) return null;
  const p = asRecord(part);
  const partMime = asString(p.mimeType).toLowerCase();
  const data = asString(asRecord(p.body).data);
  if (partMime.startsWith(mime) && data) return p;
  if (Array.isArray(p.parts)) {
    for (const child of p.parts) {
      const found = findMimePart(child, mime, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Simple regex tag strip + minimal entity decode (&amp; decoded last). */
function stripHtmlToText(html: string): string {
  let s = html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return s.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Shapes a Gmail `messages.get` (format=full) response into chat-safe text.
 * Prefers a decoded text/plain part (walking nested multiparts); falls back to
 * tag-stripped text/html. Degenerate input → all-empty strings.
 */
export function extractGmailMessageText(message: unknown): {
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  bodyText: string;
} {
  try {
    const m = asRecord(message);
    const payload = asRecord(m.payload);
    const headers = payload.headers;

    let bodyText = '';
    const plain = findMimePart(payload, 'text/plain');
    if (plain) {
      bodyText = base64UrlDecode(asString(asRecord(plain.body).data));
    } else {
      const html = findMimePart(payload, 'text/html');
      if (html) bodyText = stripHtmlToText(base64UrlDecode(asString(asRecord(html.body).data)));
    }

    return {
      subject: headerValue(headers, 'Subject'),
      from: headerValue(headers, 'From'),
      to: headerValue(headers, 'To'),
      date: headerValue(headers, 'Date'),
      snippet: asString(m.snippet),
      bodyText: bodyText.slice(0, GMAIL_BODY_TEXT_CAP),
    };
  } catch {
    return { subject: '', from: '', to: '', date: '', snippet: '', bodyText: '' };
  }
}

/** Shapes a Gmail `messages.list` response into id/threadId pairs. */
export function summarizeGmailList(list: unknown): Array<{ id: string; threadId: string }> {
  try {
    const messages = asRecord(list).messages;
    if (!Array.isArray(messages)) return [];
    const out: Array<{ id: string; threadId: string }> = [];
    for (const entry of messages) {
      const rec = asRecord(entry);
      const id = asString(rec.id);
      if (!id) continue;
      out.push({ id, threadId: asString(rec.threadId) });
    }
    return out;
  } catch {
    return [];
  }
}

function walkDocContent(content: unknown, out: string[], depth: number): void {
  if (!Array.isArray(content) || depth > 10) return;
  for (const element of content) {
    const el = asRecord(element);
    const paragraph = asRecord(el.paragraph);
    if (Array.isArray(paragraph.elements)) {
      for (const pe of paragraph.elements) {
        const textRun = asRecord(asRecord(pe).textRun);
        if (typeof textRun.content === 'string') out.push(textRun.content);
      }
    }
    const table = asRecord(el.table);
    if (Array.isArray(table.tableRows)) {
      for (const row of table.tableRows) {
        const cells = asRecord(row).tableCells;
        if (!Array.isArray(cells)) continue;
        for (const cell of cells) walkDocContent(asRecord(cell).content, out, depth + 1);
      }
    }
  }
}

/** Extracts title + linear text (paragraphs and table cells) from a Doc. */
export function extractGoogleDocText(doc: unknown): { title: string; text: string } {
  try {
    const d = asRecord(doc);
    const out: string[] = [];
    walkDocContent(asRecord(d.body).content, out, 0);
    return { title: asString(d.title), text: out.join('').slice(0, GDOC_TEXT_CAP) };
  } catch {
    return { title: '', text: '' };
  }
}

/** Renders a Sheets `values.get` response as an aligned pipe table. */
export function renderSheetValues(resp: unknown): string {
  try {
    const values = asRecord(resp).values;
    if (!Array.isArray(values) || values.length === 0) return 'No values in range.';

    const totalRows = values.length;
    const rows: string[][] = values.slice(0, SHEET_RENDER_ROW_CAP).map((row) =>
      Array.isArray(row)
        ? row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
        : [row === null || row === undefined ? '' : String(row)],
    );

    const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    if (colCount === 0) return 'No values in range.';
    const widths: number[] = new Array(colCount).fill(0);
    for (const r of rows) {
      for (let c = 0; c < colCount; c += 1) widths[c] = Math.max(widths[c], (r[c] ?? '').length);
    }

    const lines = rows.map(
      (r) => `| ${widths.map((w, c) => (r[c] ?? '').padEnd(w)).join(' | ')} |`,
    );
    let out = lines.join('\n');
    let note = totalRows > SHEET_RENDER_ROW_CAP
      ? `\n… truncated: ${totalRows - SHEET_RENDER_ROW_CAP} more row(s) not shown.`
      : '';
    if (out.length > SHEET_RENDER_CHAR_CAP) {
      out = out.slice(0, SHEET_RENDER_CHAR_CAP);
      note = `\n… truncated at ${SHEET_RENDER_CHAR_CAP} characters.`;
    }
    return out + note;
  } catch {
    return 'No values in range.';
  }
}

/** Shapes a Drive `files.list` response into compact file summaries. */
export function summarizeDriveFiles(resp: unknown): Array<{
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
}> {
  try {
    const files = asRecord(resp).files;
    if (!Array.isArray(files)) return [];
    const out: Array<{ id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }> = [];
    for (const entry of files) {
      const rec = asRecord(entry);
      const id = asString(rec.id);
      if (!id) continue;
      out.push({
        id,
        name: asString(rec.name),
        mimeType: asString(rec.mimeType),
        modifiedTime: asString(rec.modifiedTime),
        webViewLink: asString(rec.webViewLink),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Shapes a Calendar `events.list` response into compact event summaries. */
export function summarizeCalendarEvents(resp: unknown): Array<{
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  attendees: number;
}> {
  try {
    const items = asRecord(resp).items;
    if (!Array.isArray(items)) return [];
    const out: Array<{ id: string; summary: string; start: string; end: string; location: string; attendees: number }> = [];
    for (const entry of items) {
      const rec = asRecord(entry);
      const id = asString(rec.id);
      if (!id) continue;
      const start = asRecord(rec.start);
      const end = asRecord(rec.end);
      out.push({
        id,
        summary: asString(rec.summary),
        start: asString(start.dateTime) || asString(start.date),
        end: asString(end.dateTime) || asString(end.date),
        location: asString(rec.location),
        attendees: Array.isArray(rec.attendees) ? rec.attendees.length : 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Error mapping ───────────────────────────────────────────────────────────

export type GoogleApiErrorCode =
  | 'not_connected'
  | 'reconnect_required'
  | 'missing_scope'
  | 'rate_limited'
  | 'not_found'
  | 'api_error';

const ERROR_DETAIL_CAP = 300;

/** Removes any Bearer token an API body might echo back. */
function scrubBearerTokens(text: string): string {
  return text.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

/**
 * Maps an HTTP failure from any Workspace API into an honest, user-facing
 * code + message. Never echoes tokens; clips API detail to 300 chars.
 */
export function describeGoogleApiError(
  status: number | undefined,
  bodyText: string | undefined,
): { code: GoogleApiErrorCode; message: string } {
  const text = typeof bodyText === 'string' ? bodyText : '';
  const s = typeof status === 'number' && Number.isFinite(status) ? Math.floor(status) : 0;

  if (s <= 0) {
    return {
      code: 'not_connected',
      message:
        "Google Workspace isn't connected for this account (no API response). Connect Google Workspace in Circle Settings, then try again.",
    };
  }
  if (s === 401) {
    return {
      code: 'reconnect_required',
      message:
        'Google rejected the connection (HTTP 401) — the authorization has expired or was revoked. Please reconnect Google Workspace in Circle Settings, then try again.',
    };
  }
  if (s === 403) {
    if (/rateLimitExceeded|userRateLimitExceeded/.test(text)) {
      return {
        code: 'rate_limited',
        message: 'Google is rate-limiting this account (HTTP 403 rate limit). Wait a minute, then try again.',
      };
    }
    return {
      code: 'missing_scope',
      message:
        'Google refused this operation (HTTP 403) — the connection is missing a required permission. Re-connect Google Workspace in Circle Settings with the needed service checked (Gmail, Docs, Sheets, Drive, or Calendar), then try again.',
    };
  }
  if (s === 404) {
    return {
      code: 'not_found',
      message: 'Google could not find that resource (HTTP 404). Check the id or range and try again.',
    };
  }
  if (s === 429) {
    return {
      code: 'rate_limited',
      message: 'Google is rate-limiting requests (HTTP 429). Wait a minute, then try again.',
    };
  }
  const detail = scrubBearerTokens(text).slice(0, ERROR_DETAIL_CAP).trim();
  return {
    code: 'api_error',
    message: `Google API error (HTTP ${s}).${detail ? ` Details: ${detail}` : ''}`,
  };
}
