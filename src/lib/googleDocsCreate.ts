/**
 * googleDocsCreate — creates a real Google Doc from markdown via the Drive
 * v3 multipart upload + HTML→Google-Doc conversion.
 *
 * Capability-map gap #2 (docs/HUMAN_PARITY_CAPABILITY_MAP.md): auth exists
 * (googleCreds + `google-oauth` edge fn + `user_google_credentials`), but no
 * creation tools did. This module owns the API mechanics; the OpenSwan tool
 * `docs.create_document` in `openswanToolRuntime.ts` is a thin adapter over
 * `createGoogleDocFromMarkdown` (LOCKSTEP — keep the two in step).
 *
 * Credential reality (be honest with users when this fails):
 *   - `startGoogleWorkspaceOAuth` (googleCreds.ts) stores provider tokens in a
 *     server-only table. The resolver calls authenticated google-oauth status
 *     and token actions; browser roles cannot select the credential row and
 *     the refresh token never reaches the client. Refresh refused by Google
 *     (revoked consent) → reconnect Google Drive in Marketplace.
 *   - Drive writes need the `https://www.googleapis.com/auth/drive` scope,
 *     which the Workspace connect flow requests when the `drive` service is
 *     selected.
 *
 * Content path: Drive `files.create` multipart upload with target mimeType
 * `application/vnd.google-apps.document`. We upload `text/html` (converted
 * from markdown by the small pure converter below) rather than
 * `text/markdown` because HTML→Doc import has been supported by Drive for
 * years across every tenant, while native markdown import (2024+) is newer
 * and not guaranteed on all accounts. The converter covers headings, lists,
 * bold/italic, links, inline code, and fenced code blocks — enough for
 * chat-authored documents.
 *
 * Security: the access token is NEVER logged and NEVER included in returned
 * error strings (see `scrubToken`). Deps are injectable so smoke tests run
 * without supabase/react-native imports (this module has no top-level value
 * imports; the default token resolver lazy-imports the singletons).
 */

export const GOOGLE_DOCS_MARKDOWN_MAX_CHARS = 60_000;

/** The Drive write scope the Workspace connect flow grants (SCOPE_SETS.drive
 *  in supabase/functions/google-oauth/index.ts). Named in missing_scope
 *  errors so users/agents know exactly what to re-consent to. */
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

/** Narrower per-file scope that also permits uploads — accepted if a future
 *  connect flow narrows consent. */
const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const DRIVE_MULTIPART_UPLOAD_URL =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';

const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document';

const NOT_CONNECTED_MESSAGE =
  "Google Drive isn't connected for this account yet. Connect Google Drive in Marketplace, then ask me to create the doc again.";

const CONNECTION_EXPIRED_MESSAGE =
  'Your Google Drive connection has expired. Reconnect Google Drive in Marketplace, then try again.';

export type GoogleDocsCreateErrorCode = 'not_connected' | 'missing_scope' | 'api_error';

export type GoogleDocsCreateResult =
  | { ok: true; documentId: string; url: string }
  | { ok: false; error: string; code?: GoogleDocsCreateErrorCode };

export interface GoogleDocsCreateDeps {
  /** Returns a usable Google OAuth access token, or null when not connected. */
  getToken?: () => Promise<string | null>;
  /** Fetch override for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface GoogleDocsCreateInput {
  title: string;
  markdown: string;
  circleId?: string;
  userId?: string;
  deps?: GoogleDocsCreateDeps;
}

// ─── Markdown → minimal HTML (pure, no deps) ────────────────────────────────

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline markdown: `code` (protected from further formatting), [text](url),
 *  **bold**, __bold__, *italic*, _italic_. Input is HTML-escaped first. */
function renderInline(text: string): string {
  let out = escapeHtml(text);

  // Protect inline code spans so bold/italic markers inside them survive.
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  out = out.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSpans[Number(index)] || '');
}

/**
 * Converts markdown to the minimal HTML document Drive imports as a Google
 * Doc: h1–h6, <ul>/<ol> lists, <p> paragraphs, <pre> fenced code, and the
 * inline formatting from `renderInline`. Pure and exported for unit smokes.
 */
export function markdownToDocHtml(markdown: string): string {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(renderInline).join('<br/>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listTag && listItems.length > 0) {
      blocks.push(`<${listTag}>${listItems.join('')}</${listTag}>`);
    }
    listItems = [];
    listTag = null;
  };

  for (const line of lines) {
    if (codeLines !== null) {
      if (/^\s*```/.test(line)) {
        blocks.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`);
        codeLines = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (listTag !== 'ul') flushList();
      listTag = 'ul';
      listItems.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listTag !== 'ol') flushList();
      listTag = 'ol';
      listItems.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeLines !== null) {
    // Unclosed fence — still render what we have instead of dropping it.
    blocks.push(`<pre>${escapeHtml(codeLines.join('\n'))}</pre>`);
  }
  flushParagraph();
  flushList();

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${blocks.join('')}</body></html>`;
}

// ─── Token resolution (real pattern; deps-overridable) ──────────────────────

/**
 * Default token resolver. Connection metadata and the short-lived token come
 * from authenticated google-oauth actions; the provider credential table is
 * server-only. Returns null (→ not_connected) in every other case.
 */
async function resolveGoogleDriveAccessToken(_explicitUserId?: string): Promise<string | null> {
  try {
    const { fetchGoogleWorkspaceAccessToken, getGoogleAuthStatusAuthoritative } = await import('./googleCreds');
    const status = await getGoogleAuthStatusAuthoritative();
    if (!status?.connected) return null;

    // Refuse tokens whose grant never included a Drive write scope — the
    // upload would 403; treating it as "Drive not connected" is the honest
    // user-facing state (Marketplace re-connect with Drive selected fixes it).
    const scopes: string[] = Array.isArray(status.scopes) ? status.scopes : [];
    if (scopes.length > 0 && !scopes.includes(GOOGLE_DRIVE_SCOPE) && !scopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
      return null;
    }

    return await fetchGoogleWorkspaceAccessToken();
  } catch {
    return null;
  }
}

// ─── Drive upload ───────────────────────────────────────────────────────────

/** Removes the access token from any outbound error text. Belt-and-braces:
 *  no code path intentionally embeds it, but API echoes and thrown fetch
 *  errors are outside our control. NEVER log or return the raw token. */
function scrubToken(text: string, token: string | null): string {
  if (!token || !text) return text;
  return text.split(token).join('[redacted]');
}

function buildMultipartBody(boundary: string, metadata: Record<string, unknown>, html: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function safeReadBody(res: { text?: () => Promise<string> }): Promise<string> {
  try {
    if (typeof res.text === 'function') return (await res.text()) || '';
  } catch {
    /* body unavailable — fine */
  }
  return '';
}

/**
 * Creates a Google Doc titled `title` with `markdown` converted to Doc
 * content. Resolves the token via the user's stored Google Workspace
 * connection unless `deps.getToken` overrides it. Never throws for expected
 * failures — every path returns a typed `GoogleDocsCreateResult` whose
 * `error` is plain language safe to show in chat.
 */
export async function createGoogleDocFromMarkdown(
  input: GoogleDocsCreateInput,
): Promise<GoogleDocsCreateResult> {
  const title = (typeof input.title === 'string' ? input.title : '').trim().slice(0, 256) || 'Untitled document';
  const markdown = typeof input.markdown === 'string' ? input.markdown : '';

  if (!markdown.trim()) {
    return { ok: false, error: 'Nothing to write — the document content is empty.' };
  }
  if (markdown.length > GOOGLE_DOCS_MARKDOWN_MAX_CHARS) {
    return {
      ok: false,
      error: `Document content is too large (${markdown.length.toLocaleString()} characters; the limit is ${GOOGLE_DOCS_MARKDOWN_MAX_CHARS.toLocaleString()}). Split it into smaller documents and try again.`,
    };
  }

  const fetchImpl = input.deps?.fetchImpl || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) {
    return { ok: false, code: 'api_error', error: 'No fetch implementation is available in this runtime.' };
  }

  const getToken = input.deps?.getToken || (() => resolveGoogleDriveAccessToken(input.userId));
  let token: string | null = null;
  try {
    token = await getToken();
  } catch {
    token = null;
  }
  if (!token) {
    return { ok: false, code: 'not_connected', error: NOT_CONNECTED_MESSAGE };
  }

  const html = markdownToDocHtml(markdown);
  const boundary = `uc_gdoc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const body = buildMultipartBody(boundary, { name: title, mimeType: GOOGLE_DOC_MIME_TYPE }, html);

  let res: Awaited<ReturnType<typeof fetchImpl>>;
  try {
    res = await fetchImpl(DRIVE_MULTIPART_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'api_error',
      error: scrubToken(`Could not reach Google Drive: ${message || 'network error'}.`, token),
    };
  }

  if (res.status === 401) {
    // The resolver already refreshes expired tokens via ?action=token, so a
    // 401 here means Google rejected the grant itself (revoked consent) —
    // the honest fix is reconnecting the Google Drive integration.
    return { ok: false, code: 'not_connected', error: CONNECTION_EXPIRED_MESSAGE };
  }
  if (res.status === 403) {
    await safeReadBody(res); // drain; detail intentionally not echoed to the user
    return {
      ok: false,
      code: 'missing_scope',
      error: `Google Drive refused the write because this connection is missing the "${GOOGLE_DRIVE_SCOPE}" permission. Reconnect Google Drive in Marketplace with Drive access included, then try again.`,
    };
  }
  if (!res.ok) {
    const detail = scrubToken(await safeReadBody(res), token).slice(0, 200).trim();
    return {
      ok: false,
      code: 'api_error',
      error: `Google Drive could not create the document (HTTP ${res.status}).${detail ? ` Details: ${detail}` : ''}`,
    };
  }

  let documentId = '';
  try {
    const payload = (await res.json()) as { id?: unknown };
    documentId = typeof payload?.id === 'string' ? payload.id : '';
  } catch {
    documentId = '';
  }
  if (!documentId) {
    return { ok: false, code: 'api_error', error: 'Google Drive accepted the upload but returned no document id.' };
  }

  return {
    ok: true,
    documentId,
    url: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}
