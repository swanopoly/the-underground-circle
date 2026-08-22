/**
 * Adversarial security smoke for the GitHub webhook edge function.
 *
 * Executes the dependency-free HMAC and payload-boundary helpers in a VM,
 * then pins authentication, persistence, and automation-dispatch ordering in
 * source. No network or database is contacted.
 *
 * Run: npx tsx scripts/github-webhook-security-smoketest.ts
 */

import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/github-webhook/index.ts', 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const boundaryHelpers = section(
  'const MAX_GITHUB_WEBHOOK_BODY_BYTES',
  '// ─── Event Parsers',
);
const payloadHelpers = section(
  'interface ParsedEvent {',
  'function parsePushEvent(',
);
const compiled = ts.transpileModule(
  `${boundaryHelpers}
${payloadHelpers}
;(globalThis as any).__githubWebhookSecurity = {
  readBoundedGitHubBody,
  verifyGitHubSignature,
  sanitizeParsedEvent,
  sanitizeGitHubPayload,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const sandbox: Record<string, unknown> = {
  crypto: webcrypto,
  corsHeaders: {},
  AbortSignal,
  Headers,
  ReadableStream,
  Request,
  Response,
  TextDecoder,
  TextEncoder,
  URL,
};
vm.runInNewContext(compiled, sandbox);
const core = sandbox.__githubWebhookSecurity as {
  readBoundedGitHubBody: (
    request: Request,
  ) => Promise<{ bytes: Uint8Array; text: string } | { response: Response }>;
  verifyGitHubSignature: (
    body: Uint8Array | string,
    signature: string | null,
    secret: string,
  ) => Promise<boolean>;
  sanitizeParsedEvent: (event: Record<string, unknown>) => Record<string, unknown>;
  sanitizeGitHubPayload: (payload: unknown) => unknown;
};

async function main(): Promise<void> {
  console.log('Constant-time HMAC boundary');
  {
    const body = JSON.stringify({ repository: { name: 'repo' }, action: 'opened' });
    const secret = 'correct-horse-battery-staple';
    const digest = createHmac('sha256', secret).update(body).digest('hex');
    assert(
      await core.verifyGitHubSignature(body, `sha256=${digest}`, secret),
      'an exact SHA-256 HMAC verifies',
    );
    assert(
      !await core.verifyGitHubSignature(`${body}x`, `sha256=${digest}`, secret),
      'a changed body is rejected',
    );
    assert(
      !await core.verifyGitHubSignature(body, `sha256=${digest.toUpperCase()}`, secret),
      'non-canonical signature encoding is rejected',
    );
    assert(
      !await core.verifyGitHubSignature(body, digest, secret)
        && !await core.verifyGitHubSignature(body, 'sha1=00', secret),
      'missing or wrong signature algorithms are rejected',
    );
    assert(
      !await core.verifyGitHubSignature(body, `sha256=${digest}`, 'short'),
      'weak or missing webhook secrets fail closed',
    );
  }

  console.log('Streaming body cap');
  {
    const normal = new Request('https://example.test/webhook', {
      method: 'POST',
      body: '{"ok":true}',
    });
    const read = await core.readBoundedGitHubBody(normal);
    assert('text' in read && read.text === '{"ok":true}', 'a small UTF-8 body is preserved exactly');

    const declared = new Request('https://example.test/webhook', {
      method: 'POST',
      headers: { 'content-length': '2000001' },
      body: 'x',
    });
    const rejected = await core.readBoundedGitHubBody(declared);
    assert(
      'response' in rejected && rejected.response.status === 413,
      'an oversized declared body is rejected before parsing',
    );

    const chunked = {
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2_000_001));
          controller.close();
        },
      }),
    } as Request;
    const chunkedRejected = await core.readBoundedGitHubBody(chunked);
    assert(
      'response' in chunkedRejected && chunkedRejected.response.status === 413,
      'a chunked body is stopped at the actual byte cap',
    );
  }

  console.log('Bounded untrusted payload projection');
  {
    const payload = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    payload.title = 'x'.repeat(20_000);
    payload.items = new Array(250).fill({ message: 'hello' });
    payload.deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'escape' } } } } } } } } };
    const sanitized = core.sanitizeGitHubPayload(payload) as Record<string, any>;
    assert(sanitized.title.length <= 10_001, 'stored payload strings are bounded');
    assert(sanitized.items.length === 200, 'stored payload arrays are capped');
    assert(!Object.prototype.hasOwnProperty.call(sanitized, '__proto__'), 'prototype keys are removed');
    assert(JSON.stringify(sanitized).includes('[truncated]'), 'deep payload data is explicitly truncated');

    const parsed = core.sanitizeParsedEvent({
      title: 't'.repeat(500),
      body: 'b'.repeat(3_000),
      author: 'a'.repeat(200),
      authorAvatar: 'http://127.0.0.1/avatar',
      url: 'javascript:alert(1)',
      ref: 'r'.repeat(500),
      commitsCount: Number.MAX_SAFE_INTEGER,
      additions: -2,
      deletions: 4.9,
    });
    assert((parsed.title as string).length === 240, 'event title is bounded');
    assert((parsed.body as string).length === 2_000, 'event body is bounded');
    assert(parsed.authorAvatar === '' && parsed.url === '', 'unsafe event URLs are removed');
    assert(
      parsed.commitsCount === 1_000_000_000
        && parsed.additions === 0
        && parsed.deletions === 4,
      'event counters are finite non-negative bounded integers',
    );
  }

  console.log('Handler authentication and dispatch ordering');
  {
    const handlerStart = source.indexOf('Deno.serve(async (req: Request) => {');
    assert(handlerStart >= 0, 'GitHub webhook handler is present');
    const handler = source.slice(handlerStart);
    const bodyAt = handler.indexOf('await readBoundedGitHubBody(req)');
    const parseAt = handler.indexOf('JSON.parse(body)');
    const lookupAt = handler.indexOf('.from("circle_github_connections")');
    const verifyAt = handler.indexOf('await verifyGitHubSignature(');
    const failureAt = handler.indexOf('Webhook authentication failed');
    const pingAt = handler.indexOf('if (eventType === "ping")');
    assert(
      bodyAt >= 0 && parseAt > bodyAt && lookupAt > parseAt && verifyAt > lookupAt
        && failureAt > verifyAt && pingAt > failureAt,
      'bounded read -> parse -> connection lookup -> HMAC -> uniform failure -> signed ping ordering is pinned',
    );
    assert(
      handler.includes('.maybeSingle()')
        && !handler.includes('No connection found')
        && !handler.includes('Invalid signature'),
      'missing connection and invalid signature share one non-enumerating failure',
    );
    assert(
      source.includes('crypto.subtle.verify(')
        && !source.includes('computed === expected'),
      'signature comparison delegates to WebCrypto verification rather than string equality',
    );
    assert(
      handler.includes('GITHUB_EVENT_PATTERN.test(eventType)')
        && handler.includes('GITHUB_DELIVERY_PATTERN.test(deliveryId)')
        && handler.includes('GITHUB_OWNER_PATTERN.test(repoOwner)')
        && handler.includes('GITHUB_REPO_PATTERN.test(repoName)'),
      'event, delivery, owner, and repository identities are bounded before lookup',
    );
    assert(
      handler.includes('const payload = sanitizeGitHubPayload(rawPayload)')
        && handler.includes('parsed = sanitizeParsedEvent(parsed);')
        && handler.includes('payload,'),
      'only bounded payload and parsed fields reach persistence and notifications',
    );

    const dispatch = section(
      '// Dispatch matching event-triggered automations',
      '// Mark event as processed',
    );
    assert(
      dispatch.includes('triggerSource: "event"')
        && dispatch.includes('trust: "untrusted_external_event"')
        && dispatch.includes('mutation_eligible: false')
        && !dispatch.includes('mutationAuthorizations')
        && !dispatch.includes('runId:'),
      'GitHub-triggered service runs carry untrusted data and no mutation authority',
    );
    assert(
      dispatch.includes('redirect: "manual"'),
      'internal automation dispatch refuses redirects',
    );
    assert(
      !handler.includes('JSON.stringify({ error: err.message })'),
      'unexpected failures do not expose internal error text',
    );
  }

  console.log(`github webhook security smoke passed (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
