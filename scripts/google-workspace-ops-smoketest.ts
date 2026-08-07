/**
 * google-workspace-ops-smoketest — the pure Google Workspace contract core
 * (src/lib/googleWorkspaceOps.ts) behind the Gmail/Docs/Sheets/Drive/Calendar
 * agent tools. Load-bearing assertions:
 *
 *   PLANS: every planner's method + EXACT URL (including encodeURIComponent
 *   behavior for query args); path ids reject `../evil` and `a/b` (path
 *   injection); gmail maxResults clamps to 1..25 (default 10); send/draft body
 *   shapes incl. threadId placement; docs append auto-adds a trailing newline;
 *   sheets values validation failures; drive plain-query wrapping + \' quote
 *   escaping + operator passthrough; export vs alt=media download; calendar
 *   ISO validation + all-day {date} detection; per-service scopeAnyOf pins
 *   (docs→documents only, sheets→spreadsheets only, etc.).
 *
 *   RFC822/BASE64: header presence + blank-line separation; CRLF header
 *   injection stripped from to+subject (no smuggled Bcc:/X-Evil: header);
 *   non-ASCII subject → RFC 2047 =?UTF-8?B?…?=; non-ASCII body flips to base64
 *   transfer encoding; base64url round-trips ASCII/UTF-8/emoji, known vectors,
 *   tolerant decode of both alphabets and missing padding.
 *
 *   EXTRACTORS: gmail nested-multipart text/plain wins; html-only fallback
 *   strips tags + decodes entities; docs paragraphs + table cells; sheet pipe
 *   table + truncation notes; drive/calendar summarizers; describeGoogleApiError
 *   code map (401/403/403-rate/404/429/5xx) + Bearer-token scrub pin.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (googleWorkspaceOps has zero runtime imports).
 */

import {
  SCOPE_GMAIL_MODIFY,
  SCOPE_GMAIL_READONLY,
  SCOPE_GMAIL_SEND,
  SCOPE_MAIL_FULL,
  SCOPE_DOCUMENTS,
  SCOPE_SPREADSHEETS,
  SCOPE_DRIVE,
  SCOPE_CALENDAR,
  checkGoogleScope,
  base64UrlEncode,
  base64UrlDecode,
  buildRfc822Email,
  planGmailSearch,
  planGmailGet,
  planGmailSend,
  planGmailDraft,
  planGdocsGet,
  planGdocsAppend,
  planGsheetsRead,
  planGsheetsAppend,
  planGsheetsUpdate,
  planGdriveSearch,
  planGdriveExport,
  planGdriveDownload,
  planGcalList,
  planGcalCreate,
  extractGmailMessageText,
  summarizeGmailList,
  extractGoogleDocText,
  renderSheetValues,
  summarizeDriveFiles,
  summarizeCalendarEvents,
  describeGoogleApiError,
  type GoogleApiPlan,
  type GoogleApiPlanResult,
} from '../src/lib/googleWorkspaceOps';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: unwrap an ok plan (asserting), or return a dummy on error. */
function okPlan(r: GoogleApiPlanResult, msg: string): GoogleApiPlan {
  assert(r.ok, msg, r.ok ? undefined : `error: ${r.error}`);
  if (r.ok) return r;
  return { ok: true, op: 'gmail_search', method: 'GET', url: '', scopeAnyOf: [], readOnly: true };
}
function isErr(r: GoogleApiPlanResult): boolean {
  return r.ok === false && typeof r.error === 'string' && r.error.length > 0;
}

function main(): void {
  // ─── (1) gmail search: URL, encoding, clamp ───────────────────────────────
  const s1 = okPlan(planGmailSearch({ query: 'from:bob' }), '(1) basic search ok');
  assertEq(s1.method, 'GET', '(1) search method GET');
  assertEq(s1.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from%3Abob&maxResults=10', '(1) exact search URL, default maxResults 10');
  assertEq(s1.op, 'gmail_search', '(1) op tag');
  assertEq(s1.readOnly, true, '(1) search is readOnly');
  const s1b = okPlan(planGmailSearch({ query: 'subject:"hi there" &weird=stuff' }), '(1) encoded search ok');
  assert(s1b.url.includes(`q=${encodeURIComponent('subject:"hi there" &weird=stuff')}`), '(1) query is encodeURIComponent-encoded', s1b.url);
  assert(okPlan(planGmailSearch({ query: 'x', maxResults: 999 }), '(1)').url.endsWith('maxResults=25'), '(1) maxResults clamps high → 25');
  assert(okPlan(planGmailSearch({ query: 'x', maxResults: 0 }), '(1)').url.endsWith('maxResults=1'), '(1) maxResults clamps low → 1');
  assert(okPlan(planGmailSearch({ query: 'x', maxResults: -3 }), '(1)').url.endsWith('maxResults=1'), '(1) negative maxResults → 1');
  assert(okPlan(planGmailSearch({ query: 'x', maxResults: 7.9 }), '(1)').url.endsWith('maxResults=7'), '(1) fractional maxResults floors');
  assert(okPlan(planGmailSearch({ query: 'x', maxResults: NaN }), '(1)').url.endsWith('maxResults=10'), '(1) NaN maxResults → default 10');
  assert(isErr(planGmailSearch({ query: '' })), '(1) empty query → error');
  assert(isErr(planGmailSearch({ query: '   ' })), '(1) whitespace query → error');
  assertEq(JSON.stringify(s1.scopeAnyOf), JSON.stringify([SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL, SCOPE_GMAIL_READONLY]), '(1) gmail read scopeAnyOf [modify, mail full, readonly]');

  // ─── (2) gmail get: URL + id sanitization ─────────────────────────────────
  const g2 = okPlan(planGmailGet({ messageId: 'abc_123-XYZ' }), '(2) gmail get ok');
  assertEq(g2.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/abc_123-XYZ?format=full', '(2) exact get URL with format=full');
  assertEq(g2.method, 'GET', '(2) get method');
  assertEq(g2.readOnly, true, '(2) get readOnly');
  assert(isErr(planGmailGet({ messageId: '../evil' })), '(2) path traversal id rejected');
  assert(isErr(planGmailGet({ messageId: 'a/b' })), '(2) slash id rejected');
  assert(isErr(planGmailGet({ messageId: '' })), '(2) empty id rejected');
  assert(isErr(planGmailGet({ messageId: 'id?format=raw' })), '(2) query-smuggling id rejected');

  // ─── (3) base64url encode/decode ──────────────────────────────────────────
  assertEq(base64UrlEncode('hello'), 'aGVsbG8', '(3) known vector hello → aGVsbG8');
  assertEq(base64UrlDecode('aGVsbG8'), 'hello', '(3) decode inverse of known vector');
  assertEq(base64UrlEncode('???>'), 'Pz8_Pg', '(3) url-safe alphabet: / → _, padding stripped');
  assertEq(base64UrlDecode('Pz8/Pg=='), '???>', '(3) decode tolerates standard alphabet + padding');
  assertEq(base64UrlDecode('Pz8_Pg'), '???>', '(3) decode tolerates url alphabet, no padding');
  const utf8Sample = 'héllo 🌍 世界';
  assertEq(base64UrlDecode(base64UrlEncode(utf8Sample)), utf8Sample, '(3) UTF-8 + emoji round-trip');
  assert(!/[+/=]/.test(base64UrlEncode('ÿþý any ??? >>>')), '(3) encode output never contains + / =');
  assertEq(base64UrlDecode('!!!not base64!!!'), '', "(3) invalid input decodes to ''");
  assertEq(base64UrlDecode('A'), '', "(3) impossible length (4n+1) decodes to ''");
  assertEq(base64UrlDecode(''), '', "(3) empty string decodes to ''");
  assertEq(base64UrlDecode('aGVs\r\nbG8='), 'hello', '(3) decode tolerates line wraps + stray padding');

  // ─── (4) buildRfc822Email: shape + injection guards ───────────────────────
  const eml4 = buildRfc822Email({ to: 'a@b.com', subject: 'Weekly sync', bodyText: 'See you at 3pm.' });
  const [head4, ...bodyParts4] = eml4.split('\r\n\r\n');
  const headerLines4 = head4.split('\r\n');
  assert(headerLines4.includes('To: a@b.com'), '(4) To header present');
  assert(headerLines4.includes('Subject: Weekly sync'), '(4) Subject header present');
  assert(headerLines4.includes('MIME-Version: 1.0'), '(4) MIME-Version header present');
  assert(headerLines4.includes('Content-Type: text/plain; charset="UTF-8"'), '(4) Content-Type header present');
  assert(headerLines4.includes('Content-Transfer-Encoding: 7bit'), '(4) ASCII body → 7bit CTE');
  assertEq(bodyParts4.join('\r\n\r\n'), 'See you at 3pm.', '(4) blank line separates headers from body');
  assert(!headerLines4.some((l) => l.startsWith('Cc:')), '(4) no Cc header when cc absent');
  const eml4b = buildRfc822Email({ to: 'a@b.com', cc: 'c@d.com', subject: 'S', bodyText: 'b' });
  assert(eml4b.split('\r\n\r\n')[0].split('\r\n').includes('Cc: c@d.com'), '(4) Cc header when cc present');
  // CRLF header injection: smuggled Bcc must NOT become its own header line.
  const emlInj = buildRfc822Email({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 'S', bodyText: 'b' });
  const injHeaderLines = emlInj.split('\r\n\r\n')[0].split('\r\n');
  assert(!injHeaderLines.some((l) => /^Bcc:/i.test(l)), '(4) CRLF in to cannot smuggle a Bcc header');
  assert(injHeaderLines.some((l) => l.startsWith('To: a@b.com Bcc: evil@x.com')), '(4) injected CRLF flattened into the To value');
  const emlInj2 = buildRfc822Email({ to: 'a@b.com', subject: 'hi\r\nX-Evil: 1', bodyText: 'b' });
  assert(!emlInj2.split('\r\n\r\n')[0].split('\r\n').some((l) => /^X-Evil:/i.test(l)), '(4) CRLF in subject cannot smuggle a header');
  // RFC 2047 subject + base64 CTE body for non-ASCII.
  const emlU = buildRfc822Email({ to: 'a@b.com', subject: '📈 Résultats', bodyText: 'Résumé attached ✔' });
  const headU = emlU.split('\r\n\r\n')[0];
  const subjLine = headU.split('\r\n').find((l) => l.startsWith('Subject: ')) || '';
  const subjToken = subjLine.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/);
  assert(!!subjToken, '(4) non-ASCII subject uses RFC 2047 =?UTF-8?B?…?=', subjLine);
  assertEq(subjToken ? base64UrlDecode(subjToken[1]) : '', '📈 Résultats', '(4) RFC 2047 token decodes back to the subject');
  assert(headU.includes('Content-Transfer-Encoding: base64'), '(4) non-ASCII body flips CTE to base64');
  const bodyU = emlU.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, '');
  assertEq(base64UrlDecode(bodyU), 'Résumé attached ✔', '(4) base64 body decodes back to the original text');
  // In-Reply-To / References.
  const emlR = buildRfc822Email({ to: 'a@b.com', subject: 'Re: x', bodyText: 'b', inReplyTo: 'mid123@mail.gmail.com' });
  const headR = emlR.split('\r\n\r\n')[0].split('\r\n');
  assert(headR.includes('In-Reply-To: <mid123@mail.gmail.com>'), '(4) In-Reply-To present + angle-bracketed');
  assert(headR.includes('References: <mid123@mail.gmail.com>'), '(4) References mirrors In-Reply-To');
  assert(!eml4.includes('In-Reply-To'), '(4) no In-Reply-To without inReplyTo');

  // ─── (5) gmail send/draft plans ───────────────────────────────────────────
  const send5 = okPlan(planGmailSend({ to: 'a@b.com', subject: 'Hi', bodyText: 'Hello there.' }), '(5) send ok');
  assertEq(send5.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', '(5) exact send URL');
  assertEq(send5.method, 'POST', '(5) send POST');
  assertEq(send5.readOnly, false, '(5) send is not readOnly');
  const sendBody5 = send5.body as { raw?: unknown; threadId?: unknown };
  assert(typeof sendBody5.raw === 'string' && sendBody5.raw.length > 0, '(5) send body carries raw');
  assert(!('threadId' in sendBody5), '(5) no threadId key when absent');
  const decodedRaw5 = base64UrlDecode(String(sendBody5.raw));
  assert(decodedRaw5.includes('To: a@b.com'), '(5) raw decodes to an RFC822 message with To');
  assert(decodedRaw5.includes('Subject: Hi'), '(5) raw includes Subject');
  const send5t = okPlan(planGmailSend({ to: 'a@b.com', subject: 'Hi', bodyText: 'B', threadId: 'thr_1' }), '(5) send+thread ok');
  assertEq((send5t.body as { threadId?: string }).threadId, 'thr_1', '(5) send threadId sits at body top level');
  const draft5 = okPlan(planGmailDraft({ to: 'a@b.com', subject: 'Hi', bodyText: 'B', threadId: 'thr_1' }), '(5) draft ok');
  assertEq(draft5.url, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', '(5) exact draft URL');
  const draftMsg5 = (draft5.body as { message?: { raw?: unknown; threadId?: unknown } }).message;
  assert(typeof draftMsg5?.raw === 'string', '(5) draft body nests raw under message');
  assertEq(draftMsg5?.threadId, 'thr_1', '(5) draft threadId sits inside message');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: 'x', bodyText: 'b', threadId: '../t' })), '(5) invalid threadId rejected');
  // Name-form + cc + reply metadata flow into the RFC822.
  const send5n = okPlan(planGmailSend({
    to: 'Alice Smith <alice@example.com>, bob@example.com',
    cc: 'boss@example.com',
    subject: 'Re: numbers',
    bodyText: 'Attached.',
    replyToMessageId: 'orig-mid@mail.gmail.com',
  }), '(5) name-form to + cc + reply ok');
  const decoded5n = base64UrlDecode(String((send5n.body as { raw: string }).raw));
  assert(decoded5n.includes('To: Alice Smith <alice@example.com>, bob@example.com'), '(5) name-form recipients preserved');
  assert(decoded5n.includes('Cc: boss@example.com'), '(5) cc header present in raw');
  assert(decoded5n.includes('In-Reply-To: <orig-mid@mail.gmail.com>'), '(5) replyToMessageId → In-Reply-To');
  // Validation failures.
  assert(isErr(planGmailSend({ to: 'not-an-email', subject: 'x', bodyText: 'b' })), '(5) invalid to → error');
  assert(isErr(planGmailSend({ to: '', subject: 'x', bodyText: 'b' })), '(5) empty to → error');
  assert(isErr(planGmailSend({ to: Array.from({ length: 11 }, (_, i) => `u${i}@x.co`).join(','), subject: 'x', bodyText: 'b' })), '(5) 11 recipients → error');
  assert(planGmailSend({ to: Array.from({ length: 10 }, (_, i) => `u${i}@x.co`).join(','), subject: 'x', bodyText: 'b' }).ok, '(5) 10 recipients ok');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: '', bodyText: 'b' })), '(5) empty subject → error');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: 'x'.repeat(501), bodyText: 'b' })), '(5) subject >500 → error');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: 'x', bodyText: '' })), '(5) empty body → error');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: 'x', bodyText: 'y'.repeat(50_001) })), '(5) body >50k → error');
  assert(isErr(planGmailSend({ to: 'a@b.com', subject: 'x', bodyText: 'b', cc: 'bogus' })), '(5) invalid cc → error');
  // Scopes: send accepts gmail.send; draft must NOT.
  assertEq(JSON.stringify(send5.scopeAnyOf), JSON.stringify([SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL, SCOPE_GMAIL_SEND]), '(5) send scopeAnyOf includes gmail.send');
  assertEq(JSON.stringify(draft5.scopeAnyOf), JSON.stringify([SCOPE_GMAIL_MODIFY, SCOPE_MAIL_FULL]), '(5) draft scopeAnyOf excludes gmail.send');
  // Tokens never leak: plans carry no auth material.
  assert(!JSON.stringify(send5).toLowerCase().includes('bearer'), '(5) plan JSON carries no bearer token');

  // ─── (6) docs plans ───────────────────────────────────────────────────────
  const d6 = okPlan(planGdocsGet({ documentId: 'doc_1' }), '(6) docs get ok');
  assertEq(d6.url, 'https://docs.googleapis.com/v1/documents/doc_1', '(6) exact docs get URL');
  assertEq(d6.readOnly, true, '(6) docs get readOnly');
  assert(isErr(planGdocsGet({ documentId: '../evil' })), '(6) docs id traversal rejected');
  assert(isErr(planGdocsGet({ documentId: 'a/b' })), '(6) docs id slash rejected');
  const a6 = okPlan(planGdocsAppend({ documentId: 'doc_1', text: 'hello' }), '(6) docs append ok');
  assertEq(a6.url, 'https://docs.googleapis.com/v1/documents/doc_1:batchUpdate', '(6) exact batchUpdate URL');
  assertEq(a6.method, 'POST', '(6) append POST');
  assertEq(a6.readOnly, false, '(6) append not readOnly');
  const a6body = a6.body as { requests: Array<{ insertText: { endOfSegmentLocation: object; text: string } }> };
  assertEq(a6body.requests[0].insertText.text, 'hello\n', '(6) newline auto-appended');
  assertEq(JSON.stringify(a6body.requests[0].insertText.endOfSegmentLocation), '{}', '(6) endOfSegmentLocation {} present');
  const a6b = okPlan(planGdocsAppend({ documentId: 'doc_1', text: 'hi\n' }), '(6) append w/ newline ok');
  assertEq((a6b.body as typeof a6body).requests[0].insertText.text, 'hi\n', '(6) existing newline not doubled');
  assert(isErr(planGdocsAppend({ documentId: 'doc_1', text: '' })), '(6) empty text → error');
  assert(isErr(planGdocsAppend({ documentId: 'doc_1', text: 'x'.repeat(60_001) })), '(6) >60k text → error');
  assertEq(JSON.stringify(d6.scopeAnyOf), JSON.stringify([SCOPE_DOCUMENTS]), '(6) docs scope is documents ONLY');

  // ─── (7) sheets plans ─────────────────────────────────────────────────────
  const r7 = okPlan(planGsheetsRead({ spreadsheetId: 'sheet_1', range: 'Sheet1!A1:B2' }), '(7) read ok');
  assertEq(r7.url, 'https://sheets.googleapis.com/v4/spreadsheets/sheet_1/values/Sheet1!A1%3AB2?majorDimension=ROWS', '(7) exact read URL, range encoded');
  assertEq(r7.method, 'GET', '(7) read GET');
  const ap7 = okPlan(planGsheetsAppend({ spreadsheetId: 'sheet_1', range: 'Sheet1!A:B', values: [['a', 1], [true, null]] }), '(7) append ok');
  assertEq(ap7.url, 'https://sheets.googleapis.com/v4/spreadsheets/sheet_1/values/Sheet1!A%3AB:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', '(7) exact append URL');
  assertEq(ap7.method, 'POST', '(7) append POST');
  assertEq(JSON.stringify(ap7.body), JSON.stringify({ values: [['a', 1], [true, null]] }), '(7) append body is { values }');
  const up7 = okPlan(planGsheetsUpdate({ spreadsheetId: 'sheet_1', range: 'Sheet1!A1', values: [['x']] }), '(7) update ok');
  assertEq(up7.url, 'https://sheets.googleapis.com/v4/spreadsheets/sheet_1/values/Sheet1!A1?valueInputOption=USER_ENTERED', '(7) exact update URL');
  assertEq(up7.method, 'PUT', '(7) update PUT');
  assert(isErr(planGsheetsRead({ spreadsheetId: 'a/b', range: 'A1' })), '(7) spreadsheetId sanitized');
  assert(isErr(planGsheetsRead({ spreadsheetId: 'sheet_1', range: '' })), '(7) empty range → error');
  assert(isErr(planGsheetsRead({ spreadsheetId: 'sheet_1', range: 'x'.repeat(201) })), '(7) >200 char range → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: [] })), '(7) empty values → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: 'nope' as never })), '(7) non-array values → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: ['not-a-row'] as never })), '(7) non-array row → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: [[{ nested: true }]] as never })), '(7) object cell → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: Array.from({ length: 201 }, () => ['x']) })), '(7) >200 rows → error');
  assert(isErr(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: [Array.from({ length: 51 }, () => 'x')] })), '(7) >50 cells/row → error');
  assert(planGsheetsAppend({ spreadsheetId: 's', range: 'A1', values: [[null, 'ok', 0, false]] }).ok, '(7) null/number/boolean cells ok');
  assertEq(JSON.stringify(r7.scopeAnyOf), JSON.stringify([SCOPE_SPREADSHEETS]), '(7) sheets scope is spreadsheets ONLY');

  // ─── (8) drive plans: q building + export/download ────────────────────────
  const dr8 = okPlan(planGdriveSearch({ query: 'quarterly report' }), '(8) plain search ok');
  const wrappedQ = "name contains 'quarterly report' or fullText contains 'quarterly report'";
  assertEq(
    dr8.url,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(wrappedQ)}&pageSize=10&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,size)')}&orderBy=${encodeURIComponent('modifiedTime desc')}`,
    '(8) exact wrapped-search URL with fields + orderBy',
  );
  const dr8q = okPlan(planGdriveSearch({ query: "O'Brien notes" }), '(8) quote search ok');
  assert(dr8q.url.includes(encodeURIComponent("name contains 'O\\'Brien notes'")), "(8) single quotes escaped as \\' in wrapped q", dr8q.url);
  // SECURITY: a query containing a Drive operator used to be forwarded VERBATIM
  // as the `q` expression. Drive reads are auto-approved, so a model- or
  // injection-controlled query could silently widen its own scope. Operators
  // are now inert text inside the quoted literal, never structure.
  const dr8op = okPlan(planGdriveSearch({ query: "mimeType='application/pdf' and name contains 'x'" }), '(8) operator search ok');
  assert(
    !dr8op.url.includes(`q=${encodeURIComponent("mimeType='application/pdf' and name contains 'x'")}`),
    '(8) an operator-bearing query is NOT passed through verbatim',
  );
  assert(
    dr8op.url.includes(encodeURIComponent("name contains 'mimeType=\\'application/pdf\\' and name contains \\'x\\''")),
    '(8) operator text is escaped into the name-contains literal',
  );
  const dr8op2 = okPlan(planGdriveSearch({ query: "name contains 'foo'" }), '(8) contains-operator ok');
  assert(
    !dr8op2.url.includes(`q=${encodeURIComponent("name contains 'foo'")}`),
    '(8) a bare contains operator is NOT passed through verbatim',
  );
  // Scope-widening attempts stay inside the literal: every quote is escaped, so
  // the four structural quotes of the wrapper are the only unescaped ones.
  for (const hostile of [
    "x' or trashed = true or name contains '",
    "' or '1'='1",
    "a\\",
    "x' and 'me' in writers or name contains '",
  ]) {
    const plan = okPlan(planGdriveSearch({ query: hostile }), '(8) hostile drive query still plans');
    const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(plan.url) as RegExpExecArray)[1]);
    let unescaped = 0;
    for (let i = 0; i < q.length; i += 1) {
      if (q[i] === "'") {
        let slashes = 0;
        let j = i - 1;
        while (j >= 0 && q[j] === '\\') { slashes += 1; j -= 1; }
        if (slashes % 2 === 0) unescaped += 1;
      }
    }
    assert(unescaped === 4, `(8) hostile drive query cannot break out of the literal: ${hostile}`);
  }
  assert(okPlan(planGdriveSearch({ query: 'x', maxResults: 99 }), '(8)').url.includes('pageSize=25'), '(8) pageSize clamps to 25');
  assert(isErr(planGdriveSearch({ query: '' })), '(8) empty drive query → error');
  const ex8 = okPlan(planGdriveExport({ fileId: 'f_1' }), '(8) export ok');
  assertEq(ex8.url, 'https://www.googleapis.com/drive/v3/files/f_1/export?mimeType=text%2Fplain', '(8) export defaults to text/plain');
  const ex8b = okPlan(planGdriveExport({ fileId: 'f_1', mimeType: 'application/pdf' }), '(8) export custom mime ok');
  assertEq(ex8b.url, 'https://www.googleapis.com/drive/v3/files/f_1/export?mimeType=application%2Fpdf', '(8) export mime encoded');
  const dl8 = okPlan(planGdriveDownload({ fileId: 'f_1' }), '(8) download ok');
  assertEq(dl8.url, 'https://www.googleapis.com/drive/v3/files/f_1?alt=media', '(8) download uses alt=media');
  assert(isErr(planGdriveExport({ fileId: '../etc' })), '(8) export id sanitized');
  assert(isErr(planGdriveDownload({ fileId: 'a/b' })), '(8) download id sanitized');
  assertEq(JSON.stringify(dr8.scopeAnyOf), JSON.stringify([SCOPE_DRIVE]), '(8) drive scope is drive ONLY');
  assertEq(dr8.readOnly && ex8.readOnly && dl8.readOnly, true, '(8) drive search/export/download readOnly');

  // ─── (9) calendar plans ───────────────────────────────────────────────────
  const c9 = okPlan(planGcalList({}), '(9) list default ok');
  assertEq(c9.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=10', '(9) exact default list URL');
  const c9b = okPlan(planGcalList({ timeMinIso: '2026-07-13T00:00:00Z', timeMaxIso: '2026-07-20', query: 'standup sync', maxResults: 5 }), '(9) list combo ok');
  assert(c9b.url.includes('maxResults=5'), '(9) maxResults honored');
  assert(c9b.url.includes('&timeMin=2026-07-13T00%3A00%3A00Z'), '(9) timeMin encoded');
  assert(c9b.url.includes('&timeMax=2026-07-20'), '(9) date-only timeMax accepted (loose ISO)');
  assert(c9b.url.includes('&q=standup%20sync'), '(9) q encoded');
  assert(isErr(planGcalList({ timeMinIso: 'next tuesday' })), '(9) invalid timeMin → error');
  assert(isErr(planGcalList({ timeMaxIso: '07/20/2026' })), '(9) invalid timeMax → error');
  const cc9 = okPlan(planGcalCreate({
    summary: 'Team sync',
    startIso: '2026-07-14T09:00:00-05:00',
    endIso: '2026-07-14T09:30:00-05:00',
    description: 'Weekly',
    attendees: ['a@b.co', 'Bob <bob@x.io>'],
    timeZone: 'America/Chicago',
  }), '(9) create ok');
  assertEq(cc9.url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', '(9) exact create URL');
  assertEq(cc9.method, 'POST', '(9) create POST');
  assertEq(cc9.readOnly, false, '(9) create not readOnly');
  const cc9body = cc9.body as {
    summary: string; description?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: Array<{ email: string }>;
  };
  assertEq(cc9body.start.dateTime, '2026-07-14T09:00:00-05:00', '(9) start.dateTime set');
  assertEq(cc9body.start.timeZone, 'America/Chicago', '(9) start.timeZone set');
  assertEq(cc9body.end.timeZone, 'America/Chicago', '(9) end.timeZone set');
  assertEq(cc9body.description, 'Weekly', '(9) description carried');
  assertEq(JSON.stringify(cc9body.attendees), JSON.stringify([{ email: 'a@b.co' }, { email: 'bob@x.io' }]), '(9) attendees normalized to {email} (name form unwrapped)');
  const allDay9 = okPlan(planGcalCreate({ summary: 'PTO', startIso: '2026-07-15', endIso: '2026-07-16' }), '(9) all-day ok');
  const allDayBody9 = allDay9.body as { start: Record<string, string>; end: Record<string, string> };
  assertEq(allDayBody9.start.date, '2026-07-15', '(9) all-day uses start.date');
  assert(!('dateTime' in allDayBody9.start), '(9) all-day has no start.dateTime');
  assertEq(allDayBody9.end.date, '2026-07-16', '(9) all-day uses end.date');
  assert(isErr(planGcalCreate({ summary: '', startIso: '2026-07-15', endIso: '2026-07-16' })), '(9) empty summary → error');
  assert(isErr(planGcalCreate({ summary: 'x'.repeat(301), startIso: '2026-07-15', endIso: '2026-07-16' })), '(9) summary >300 → error');
  assert(isErr(planGcalCreate({ summary: 'x', startIso: '07/15/2026', endIso: '2026-07-16' })), '(9) invalid startIso → error');
  assert(isErr(planGcalCreate({ summary: 'x', startIso: '2026-07-15', endIso: 'tomorrow' })), '(9) invalid endIso → error');
  assert(isErr(planGcalCreate({ summary: 'x', startIso: '2026-07-15', endIso: '2026-07-16', attendees: ['nope'] })), '(9) invalid attendee → error');
  assert(isErr(planGcalCreate({ summary: 'x', startIso: '2026-07-15', endIso: '2026-07-16', attendees: Array.from({ length: 21 }, (_, i) => `u${i}@x.co`) })), '(9) >20 attendees → error');
  assertEq(JSON.stringify(c9.scopeAnyOf), JSON.stringify([SCOPE_CALENDAR]), '(9) calendar scope is calendar ONLY');

  // ─── (10) gmail message extraction (nested multipart + html fallback) ─────
  const gmailFixture = {
    snippet: 'Hey — quick question',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Quarterly numbers' },
        { name: 'From', value: 'Bob <bob@example.com>' },
        { name: 'To', value: 'alice@example.com' },
        { name: 'Date', value: 'Sun, 12 Jul 2026 10:00:00 -0500' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/html', body: { data: base64UrlEncode('<b>html version</b>') } },
            { mimeType: 'text/plain', body: { data: base64UrlEncode('Plain body — café ☕') } },
          ],
        },
        { mimeType: 'application/pdf', body: { attachmentId: 'att1' } },
      ],
    },
  };
  const gm10 = extractGmailMessageText(gmailFixture);
  assertEq(gm10.subject, 'Quarterly numbers', '(10) subject from headers');
  assertEq(gm10.from, 'Bob <bob@example.com>', '(10) from header');
  assertEq(gm10.to, 'alice@example.com', '(10) to header');
  assertEq(gm10.date, 'Sun, 12 Jul 2026 10:00:00 -0500', '(10) date header');
  assertEq(gm10.snippet, 'Hey — quick question', '(10) snippet carried');
  assertEq(gm10.bodyText, 'Plain body — café ☕', '(10) nested text/plain wins over html + decodes UTF-8');
  const htmlOnlyFixture = {
    payload: {
      mimeType: 'text/html',
      headers: [{ name: 'subject', value: 'lowercase header name matched' }],
      body: { data: base64UrlEncode('<div>Tom &amp; Jerry &lt;3</div><p>Line&nbsp;two&#39;s &quot;quote&quot;</p>') },
    },
  };
  const gm10h = extractGmailMessageText(htmlOnlyFixture);
  assertEq(gm10h.subject, 'lowercase header name matched', '(10) header names matched case-insensitively');
  assert(gm10h.bodyText.includes('Tom & Jerry <3'), '(10) html fallback strips tags + decodes &amp;/&lt;', gm10h.bodyText);
  assert(gm10h.bodyText.includes(`Line two's "quote"`), '(10) html fallback decodes &nbsp;/&#39;/&quot;', gm10h.bodyText);
  assert(!gm10h.bodyText.includes('<div>'), '(10) no tags survive');
  const longBody = 'z'.repeat(30_000);
  const capMsg = extractGmailMessageText({ payload: { mimeType: 'text/plain', body: { data: base64UrlEncode(longBody) } } });
  assertEq(capMsg.bodyText.length, 20_000, '(10) bodyText capped at 20000');

  // ─── (11) list/summary extractors ─────────────────────────────────────────
  const list11 = summarizeGmailList({ messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }, { threadId: 'orphan' }] });
  assertEq(list11.length, 2, '(11) gmail list keeps only entries with ids');
  assertEq(JSON.stringify(list11[0]), JSON.stringify({ id: 'm1', threadId: 't1' }), '(11) gmail list shape');
  const doc11 = extractGoogleDocText({
    title: 'Plan',
    body: {
      content: [
        { paragraph: { elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'world\n' } }] } },
        {
          table: {
            tableRows: [{
              tableCells: [
                { content: [{ paragraph: { elements: [{ textRun: { content: 'cell A\n' } }] } }] },
                { content: [{ paragraph: { elements: [{ textRun: { content: 'cell B\n' } }] } }] },
              ],
            }],
          },
        },
        { sectionBreak: {} },
      ],
    },
  });
  assertEq(doc11.title, 'Plan', '(11) doc title');
  assertEq(doc11.text, 'Hello world\ncell A\ncell B\n', '(11) doc text includes paragraphs AND table cells');
  const sheet11 = renderSheetValues({ values: [['a', 'b'], ['1', '22']] });
  assertEq(sheet11, '| a | b  |\n| 1 | 22 |', '(11) aligned pipe table with header row');
  assertEq(renderSheetValues({ values: [] }), 'No values in range.', '(11) empty values → neutral message');
  assertEq(renderSheetValues({}), 'No values in range.', '(11) missing values → neutral message');
  const rowCap11 = renderSheetValues({ values: Array.from({ length: 250 }, (_, i) => [`r${i}`]) });
  assert(rowCap11.includes('truncated: 50 more row(s)'), '(11) row-cap truncation note', rowCap11.slice(-80));
  assertEq(rowCap11.split('\n').length, 201, '(11) 200 data lines + 1 note line');
  const charCap11 = renderSheetValues({ values: Array.from({ length: 90 }, () => ['x'.repeat(100)]) });
  assert(charCap11.includes('truncated at 8000 characters'), '(11) char-cap truncation note');
  assert(charCap11.length <= 8_100, '(11) char cap enforced');
  const drive11 = summarizeDriveFiles({
    files: [
      { id: 'f1', name: 'Report.pdf', mimeType: 'application/pdf', modifiedTime: '2026-07-01T00:00:00Z', webViewLink: 'https://drive.google.com/f1', size: '1024' },
      { name: 'no-id-dropped' },
    ],
  });
  assertEq(drive11.length, 1, '(11) drive files without ids dropped');
  assertEq(JSON.stringify(drive11[0]), JSON.stringify({ id: 'f1', name: 'Report.pdf', mimeType: 'application/pdf', modifiedTime: '2026-07-01T00:00:00Z', webViewLink: 'https://drive.google.com/f1' }), '(11) drive summary shape');
  const cal11 = summarizeCalendarEvents({
    items: [
      { id: 'e1', summary: 'Standup', location: 'Zoom', start: { dateTime: '2026-07-14T09:00:00-05:00' }, end: { dateTime: '2026-07-14T09:15:00-05:00' }, attendees: [{ email: 'a@b.co' }, { email: 'c@d.co' }] },
      { id: 'e2', summary: 'PTO', start: { date: '2026-07-15' }, end: { date: '2026-07-16' } },
      { summary: 'no id' },
    ],
  });
  assertEq(cal11.length, 2, '(11) calendar events without ids dropped');
  assertEq(cal11[0].start, '2026-07-14T09:00:00-05:00', '(11) event start from dateTime');
  assertEq(cal11[0].attendees, 2, '(11) attendee count');
  assertEq(cal11[1].start, '2026-07-15', '(11) all-day start falls back to date');
  assertEq(cal11[1].attendees, 0, '(11) missing attendees → 0');

  // ─── (12) describeGoogleApiError: code map + token scrub ──────────────────
  const e401 = describeGoogleApiError(401, '');
  assertEq(e401.code, 'reconnect_required', '(12) 401 → reconnect_required');
  assert(e401.message.includes('reconnect Google Workspace in Circle Settings'), '(12) 401 message names the fix');
  const e403 = describeGoogleApiError(403, '{"error":{"message":"insufficient scopes"}}');
  assertEq(e403.code, 'missing_scope', '(12) 403 → missing_scope');
  assert(/re-?connect/i.test(e403.message) && /checked/.test(e403.message), '(12) 403 message mentions re-connecting with the service checked');
  assertEq(describeGoogleApiError(403, '{"reason":"rateLimitExceeded"}').code, 'rate_limited', '(12) 403 + rateLimitExceeded → rate_limited');
  assertEq(describeGoogleApiError(403, 'userRateLimitExceeded').code, 'rate_limited', '(12) 403 + userRateLimitExceeded → rate_limited');
  assertEq(describeGoogleApiError(404, '').code, 'not_found', '(12) 404 → not_found');
  assertEq(describeGoogleApiError(429, '').code, 'rate_limited', '(12) 429 → rate_limited');
  assertEq(describeGoogleApiError(undefined, undefined).code, 'not_connected', '(12) no status → not_connected');
  const e500 = describeGoogleApiError(500, 'boom '.repeat(100));
  assertEq(e500.code, 'api_error', '(12) 500 → api_error');
  assert(e500.message.includes('HTTP 500'), '(12) api_error names the status');
  assert(e500.message.length < 400, '(12) api_error detail clipped to 300 chars');
  const eTok = describeGoogleApiError(500, 'request failed: Authorization: Bearer ya29.abc-DEF_123.xyz was rejected');
  assert(eTok.message.includes('Bearer [redacted]'), '(12) Bearer token scrubbed to [redacted]');
  assert(!eTok.message.includes('ya29'), '(12) raw token never reaches the message');

  // ─── (13) checkGoogleScope ────────────────────────────────────────────────
  assertEq(checkGoogleScope([SCOPE_GMAIL_READONLY], s1), true, '(13) any-of match on read scope');
  assertEq(checkGoogleScope([SCOPE_GMAIL_READONLY], send5), false, '(13) readonly grant does NOT satisfy send');
  assertEq(checkGoogleScope([SCOPE_MAIL_FULL], send5), true, '(13) full mail scope satisfies send');
  assertEq(checkGoogleScope(`openid ${SCOPE_GMAIL_SEND} email`, send5), true, '(13) space-separated scope string accepted');
  assertEq(checkGoogleScope([SCOPE_DRIVE], d6), false, '(13) drive grant does NOT satisfy docs (documents only)');
  assertEq(checkGoogleScope(undefined, s1), false, '(13) undefined granted → false');
  assertEq(checkGoogleScope([SCOPE_DRIVE], null), false, '(13) null plan → false');

  // ─── (14) degenerate / undefined never throws ─────────────────────────────
  try {
    const junk: unknown[] = [undefined, null, 42, 'garbage', { nested: { deep: true } }, ['array'], 'x'.repeat(200_000)];
    const planners: Array<(v: never) => GoogleApiPlanResult> = [
      planGmailSearch, planGmailGet, planGmailSend, planGmailDraft,
      planGdocsGet, planGdocsAppend, planGsheetsRead, planGsheetsAppend,
      planGsheetsUpdate, planGdriveSearch, planGdriveExport, planGdriveDownload,
      planGcalList, planGcalCreate,
    ];
    for (const plan of planners) {
      for (const input of junk) {
        const result = plan(input as never);
        assert(typeof result.ok === 'boolean', `(14) planner returns shaped result for ${JSON.stringify(input)?.slice(0, 20)}`);
        if (!result.ok) assert(typeof result.error === 'string' && result.error.length > 0, '(14) error result carries a message');
      }
    }
    // planGcalList() with no args is legitimately ok.
    assert(planGcalList().ok === true, '(14) planGcalList() with no args → ok plan');
    // But every planner that REQUIRES args must fail closed on undefined.
    assert(isErr(planGmailSend(undefined as never)), '(14) planGmailSend(undefined) → error result');
    // Extractors + helpers.
    assertEq(extractGmailMessageText(undefined).bodyText, '', '(14) extractGmailMessageText(undefined) → empty');
    assertEq(extractGmailMessageText(42).subject, '', '(14) extractGmailMessageText(number) → empty');
    assertEq(summarizeGmailList(null).length, 0, '(14) summarizeGmailList(null) → []');
    assertEq(extractGoogleDocText('nope').text, '', '(14) extractGoogleDocText(string) → empty');
    assertEq(renderSheetValues(undefined), 'No values in range.', '(14) renderSheetValues(undefined) → neutral');
    assertEq(renderSheetValues({ values: [null, 7, 'scalar'] }).length > 0, true, '(14) junk rows tolerated');
    assertEq(summarizeDriveFiles(12).length, 0, '(14) summarizeDriveFiles(number) → []');
    assertEq(summarizeCalendarEvents({ items: 'nope' }).length, 0, '(14) non-array items → []');
    assertEq(base64UrlEncode(undefined as never), '', '(14) base64UrlEncode(undefined) → ""');
    assertEq(base64UrlDecode(undefined as never), '', '(14) base64UrlDecode(undefined) → ""');
    assert(typeof buildRfc822Email(undefined as never) === 'string', '(14) buildRfc822Email(undefined) returns a string');
    assert(typeof buildRfc822Email({ to: 123 as never, subject: {} as never, bodyText: [] as never }) === 'string', '(14) buildRfc822Email(junk fields) returns a string');
    assertEq(checkGoogleScope(3.14, { scopeAnyOf: 'nope' as never }), false, '(14) checkGoogleScope junk → false');
    assertEq(describeGoogleApiError(NaN, 'x').code, 'not_connected', '(14) NaN status → not_connected');
    assert(typeof describeGoogleApiError(-1, undefined).message === 'string', '(14) negative status handled');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (14) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll google-workspace-ops smoke cases passed (${passes} passed).`);
}

main();
