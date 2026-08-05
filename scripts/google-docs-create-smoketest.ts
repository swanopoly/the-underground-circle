/**
 * Smoke: google-docs-create (capability-map gap #2).
 *
 * Pure assertions on `src/lib/googleDocsCreate.ts` — the API layer behind the
 * OpenSwan `docs.create_document` tool. Everything runs against injected
 * `getToken`/`fetchImpl` deps: no supabase import, no network, no real token.
 *
 * Covers: the Drive multipart upload contract (endpoint, method, auth header,
 * metadata + converted HTML in the body, URL built from the returned id), the
 * plain-language error mapping (no token → not_connected + Marketplace,
 * 401 → not_connected reconnect, 403 → missing_scope naming the exact scope,
 * 5xx/network → api_error), input bounds (60k markdown cap, empty content),
 * the markdown→HTML converter units, and the token-redaction guarantee (the
 * access token must never appear in any returned error string).
 *
 * Run: npx tsx scripts/google-docs-create-smoketest.ts
 */

import {
  createGoogleDocFromMarkdown,
  markdownToDocHtml,
  GOOGLE_DOCS_MARKDOWN_MAX_CHARS,
  GOOGLE_DRIVE_SCOPE,
  type GoogleDocsCreateResult,
} from '../src/lib/googleDocsCreate';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}`);
  }
}

const TOKEN = 'ya29.SECRET-smoke-token-DO-NOT-LEAK';
const tokenDep = async () => TOKEN;

type CapturedCall = { url: string; init: RequestInit };

function mockFetch(
  captured: CapturedCall[],
  respond: (url: string, init: RequestInit) => { status: number; json?: unknown; text?: string },
): typeof fetch {
  const impl = async (url: unknown, init?: unknown) => {
    const call: CapturedCall = { url: String(url), init: (init || {}) as RequestInit };
    captured.push(call);
    const r = respond(call.url, call.init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => r.text ?? '',
    };
  };
  return impl as unknown as typeof fetch;
}

/** Collected so the final sweep can assert the token never leaks anywhere. */
const allResults: GoogleDocsCreateResult[] = [];
async function run(input: Parameters<typeof createGoogleDocFromMarkdown>[0]): Promise<GoogleDocsCreateResult> {
  const result = await createGoogleDocFromMarkdown(input);
  allResults.push(result);
  return result;
}

async function main() {
  // ── Happy path: Drive multipart contract + URL from documentId ────────────
  console.log('happy path — Drive files.create multipart upload');
  {
    const calls: CapturedCall[] = [];
    const fetchImpl = mockFetch(calls, () => ({
      status: 200,
      // webViewLink deliberately present — the URL must still be BUILT from id.
      json: { id: 'doc_abc123', webViewLink: 'https://drive.google.com/ignored' },
    }));
    const result = await run({
      title: 'Q3 Launch Plan',
      markdown: '# Overview\n\nShip **fast**.\n\n- item one\n- item two',
      deps: { getToken: tokenDep, fetchImpl },
    });

    assert(calls.length === 1, 'exactly one Drive request made');
    const call = calls[0];
    assert(
      call.url.startsWith('https://www.googleapis.com/upload/drive/v3/files'),
      'hits the Drive v3 upload endpoint',
    );
    assert(call.url.includes('uploadType=multipart'), 'uses uploadType=multipart');
    assert((call.init.method || '').toUpperCase() === 'POST', 'uses POST');

    const headers = (call.init.headers || {}) as Record<string, string>;
    assert(headers.Authorization === `Bearer ${TOKEN}`, 'sends the bearer token in the Authorization header');
    assert(
      /^multipart\/related; boundary=/.test(headers['Content-Type'] || ''),
      'declares multipart/related with a boundary',
    );

    const body = String(call.init.body || '');
    assert(body.includes('"name":"Q3 Launch Plan"'), 'multipart metadata carries the title');
    assert(
      body.includes('"mimeType":"application/vnd.google-apps.document"'),
      'multipart metadata targets the Google Doc mime type',
    );
    assert(body.includes('Content-Type: text/html'), 'content part is uploaded as text/html');
    assert(body.includes('<h1>Overview</h1>'), 'converted heading is in the upload body');
    assert(body.includes('<strong>fast</strong>'), 'converted bold is in the upload body');
    assert(body.includes('<ul><li>item one</li><li>item two</li></ul>'), 'converted list is in the upload body');

    assert(result.ok === true, 'result is ok');
    if (result.ok) {
      assert(result.documentId === 'doc_abc123', 'documentId comes from the Drive response');
      assert(
        result.url === 'https://docs.google.com/document/d/doc_abc123/edit',
        'url is built from the documentId (not webViewLink)',
      );
    }
  }

  // ── Not connected: no token ───────────────────────────────────────────────
  console.log('no token — not_connected with Marketplace guidance');
  {
    const calls: CapturedCall[] = [];
    const fetchImpl = mockFetch(calls, () => ({ status: 200, json: { id: 'x' } }));
    const result = await run({
      title: 'Doc',
      markdown: 'hello',
      deps: { getToken: async () => null, fetchImpl },
    });
    assert(result.ok === false, 'fails without a token');
    if (!result.ok) {
      assert(result.code === 'not_connected', "code is 'not_connected'");
      assert(/Marketplace/.test(result.error), 'error tells the user to connect Google Drive in Marketplace');
      assert(/Google Drive/.test(result.error), 'error names Google Drive in plain language');
    }
    assert(calls.length === 0, 'Drive is never called without a token');
  }

  // ── Throwing token resolver degrades to not_connected ─────────────────────
  console.log('token resolver throws — treated as not connected');
  {
    const result = await run({
      title: 'Doc',
      markdown: 'hello',
      deps: {
        getToken: async () => {
          throw new Error(`resolver exploded carrying ${TOKEN}`);
        },
        fetchImpl: mockFetch([], () => ({ status: 200, json: { id: 'x' } })),
      },
    });
    assert(!result.ok && result.code === 'not_connected', 'resolver failure maps to not_connected');
  }

  // ── 403 → missing_scope naming the exact scope ────────────────────────────
  console.log('403 — missing_scope names the exact Drive scope');
  {
    const fetchImpl = mockFetch([], () => ({
      status: 403,
      text: JSON.stringify({
        error: {
          code: 403,
          message: `Request had insufficient authentication scopes. token=${TOKEN}`,
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      }),
    }));
    const result = await run({ title: 'Doc', markdown: 'hello', deps: { getToken: tokenDep, fetchImpl } });
    assert(result.ok === false, '403 fails');
    if (!result.ok) {
      assert(result.code === 'missing_scope', "code is 'missing_scope'");
      assert(result.error.includes(GOOGLE_DRIVE_SCOPE), `error names the exact scope (${GOOGLE_DRIVE_SCOPE})`);
      assert(/Marketplace/.test(result.error), 'error offers the Marketplace reconnect fix');
      assert(!result.error.includes(TOKEN), 'token from the 403 body is not echoed');
    }
  }

  // ── 401 → not_connected (expired; no client refresh path exists) ──────────
  console.log('401 — expired connection maps to not_connected');
  {
    const fetchImpl = mockFetch([], () => ({ status: 401, text: 'Invalid Credentials' }));
    const result = await run({ title: 'Doc', markdown: 'hello', deps: { getToken: tokenDep, fetchImpl } });
    assert(!result.ok && result.code === 'not_connected', '401 maps to not_connected');
    if (!result.ok) {
      assert(/[Rr]econnect/.test(result.error) && /Marketplace/.test(result.error), 'error says to reconnect in Marketplace');
    }
  }

  // ── 500 → api_error, plain message, token redacted from echoed body ───────
  console.log('500 — api_error with plain message and redacted body');
  {
    const fetchImpl = mockFetch([], () => ({
      status: 500,
      text: `Backend Error while processing Bearer ${TOKEN} upload`,
    }));
    const result = await run({ title: 'Doc', markdown: 'hello', deps: { getToken: tokenDep, fetchImpl } });
    assert(result.ok === false, '500 fails');
    if (!result.ok) {
      assert(result.code === 'api_error', "code is 'api_error'");
      assert(/HTTP 500/.test(result.error), 'error states the HTTP status plainly');
      assert(/Google Drive/.test(result.error), 'error names Google Drive, not raw API jargon');
      assert(!result.error.includes(TOKEN), 'token echoed by the API body is redacted from the error');
    }
  }

  // ── Network failure → api_error, token redacted from thrown message ───────
  console.log('network throw — api_error, token redacted');
  {
    const throwingFetch = (async () => {
      throw new Error(`socket hang up (auth: ${TOKEN})`);
    }) as unknown as typeof fetch;
    const result = await run({ title: 'Doc', markdown: 'hello', deps: { getToken: tokenDep, fetchImpl: throwingFetch } });
    assert(!result.ok && result.code === 'api_error', 'network failure maps to api_error');
    if (!result.ok) {
      assert(!result.error.includes(TOKEN), 'token inside the thrown error is redacted');
      assert(/Google Drive/.test(result.error), 'network error stays plain language');
    }
  }

  // ── Missing/invalid Drive response id → api_error ─────────────────────────
  console.log('empty Drive response — api_error');
  {
    const fetchImpl = mockFetch([], () => ({ status: 200, json: {} }));
    const result = await run({ title: 'Doc', markdown: 'hello', deps: { getToken: tokenDep, fetchImpl } });
    assert(!result.ok && result.code === 'api_error', 'missing document id maps to api_error');
  }

  // ── Bounds: oversized + empty markdown never reach the network ────────────
  console.log('input bounds');
  {
    const calls: CapturedCall[] = [];
    const fetchImpl = mockFetch(calls, () => ({ status: 200, json: { id: 'x' } }));

    const oversized = await run({
      title: 'Big',
      markdown: 'a'.repeat(GOOGLE_DOCS_MARKDOWN_MAX_CHARS + 1),
      deps: { getToken: tokenDep, fetchImpl },
    });
    assert(oversized.ok === false, `markdown over ${GOOGLE_DOCS_MARKDOWN_MAX_CHARS} chars is rejected`);
    if (!oversized.ok) {
      assert(/too large/i.test(oversized.error), 'oversized error is plain language');
    }

    const atLimit = 'a'.repeat(GOOGLE_DOCS_MARKDOWN_MAX_CHARS);
    const okAtLimit = await run({ title: 'Max', markdown: atLimit, deps: { getToken: tokenDep, fetchImpl } });
    assert(okAtLimit.ok === true, 'markdown exactly at the limit is accepted');

    const empty = await run({ title: 'Empty', markdown: '   \n  ', deps: { getToken: tokenDep, fetchImpl } });
    assert(empty.ok === false && !/Marketplace/.test(empty.ok === false ? empty.error : ''), 'empty content is rejected before auth');

    assert(calls.length === 1, 'only the at-limit doc reached the network (oversized/empty never fetch)');
  }

  // ── markdown→HTML converter units ─────────────────────────────────────────
  console.log('markdown→HTML converter');
  {
    assert(markdownToDocHtml('# Title').includes('<h1>Title</h1>'), 'h1 heading');
    assert(markdownToDocHtml('### Sub').includes('<h3>Sub</h3>'), 'h3 heading');
    assert(
      markdownToDocHtml('- a\n- b').includes('<ul><li>a</li><li>b</li></ul>'),
      'unordered list',
    );
    assert(
      markdownToDocHtml('1. one\n2. two').includes('<ol><li>one</li><li>two</li></ol>'),
      'ordered list',
    );
    assert(markdownToDocHtml('**bold** move').includes('<strong>bold</strong>'), 'bold');
    assert(markdownToDocHtml('an *emphasis* here').includes('<em>emphasis</em>'), 'italic');
    assert(markdownToDocHtml('use `npm run web` now').includes('<code>npm run web</code>'), 'inline code');
    assert(
      markdownToDocHtml('`**not bold**`').includes('<code>**not bold**</code>'),
      'inline code protects markers from bold formatting',
    );
    const fenced = markdownToDocHtml('```\nconst x = a < b && c > d;\n```');
    assert(fenced.includes('<pre>'), 'fenced code becomes <pre>');
    assert(fenced.includes('a &lt; b &amp;&amp; c &gt; d'), 'fenced code is HTML-escaped');
    assert(
      markdownToDocHtml('first para\n\nsecond para').includes('<p>first para</p><p>second para</p>'),
      'blank line splits paragraphs',
    );
    assert(
      markdownToDocHtml('[site](https://example.com)').includes('<a href="https://example.com">site</a>'),
      'links',
    );
    assert(
      markdownToDocHtml('<script>alert(1)</script>').includes('&lt;script&gt;'),
      'raw HTML in markdown is escaped, not passed through',
    );
    assert(
      markdownToDocHtml('step 1 done and step 2 next').includes('step 1 done and step 2 next'),
      'plain numbers in text survive code-span placeholder handling',
    );
    assert(markdownToDocHtml('# T').startsWith('<!DOCTYPE html>'), 'output is a full minimal HTML document');
  }

  // ── Final sweep: the token never appears in ANY returned result ───────────
  console.log('token redaction sweep');
  {
    const serialized = JSON.stringify(allResults);
    assert(!serialized.includes(TOKEN), `token never appears in any of the ${allResults.length} returned results`);
  }

  console.log('');
  if (failures > 0) {
    console.error(`google-docs-create smoke: ${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('google-docs-create smoke: all assertions passed');
}

main().catch((err) => {
  console.error('google-docs-create smoke: crashed:', err);
  process.exit(1);
});
