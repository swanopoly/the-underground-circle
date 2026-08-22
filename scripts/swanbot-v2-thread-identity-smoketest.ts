/**
 * Guard exact Chat-thread binding across the local SwanBot v2 batch runtime,
 * the canonical OpenSwan messages.create handler, and the v2 edge continuation.
 *
 * Run: npm run smoke:swanbot-v2-thread-identity
 */

import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// openswanToolRuntime transitively imports React Native through Supabase. Use
// the same inert native stubs as the real-runtime progressive-disclosure smoke.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://thread-identity-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'thread-identity-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`pass: ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${message}`);
}

async function main(): Promise<void> {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const bindThread = runtime.resolveOpenSwanMessagesCreateThreadBinding;

  // Both ids represent threads the same authenticated user can see in one
  // circle. Visibility of B must never authorize a model turn rooted in A to
  // redirect messages.create into B.
  const visibleThreadA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const visibleThreadB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const omittedModelThread = bindThread(visibleThreadA, { content: 'hello' });
  assert(
    omittedModelThread.ok && omittedModelThread.threadId === visibleThreadA,
    'omitted model thread binds to the exact authenticated active thread',
  );

  const exactModelThread = bindThread(visibleThreadA, {
    content: 'hello',
    threadId: visibleThreadA,
  });
  assert(
    exactModelThread.ok && exactModelThread.threadId === visibleThreadA,
    'an exact compatibility echo preserves the authenticated active thread',
  );

  const sameCircleDifferentThread = bindThread(visibleThreadA, {
    content: 'redirect attempt',
    threadId: visibleThreadB,
  });
  assert(
    !sameCircleDifferentThread.ok
      && sameCircleDifferentThread.code === 'thread_identity_mismatch',
    'a model cannot redirect into another visible thread in the same circle',
  );

  const missingContext = bindThread(undefined, {
    content: 'model tries to supply authority',
    threadId: visibleThreadA,
  });
  assert(
    !missingContext.ok && missingContext.code === 'missing_thread_identity',
    'a model argument cannot establish thread authority when context is absent',
  );

  const invalidContext = bindThread('not-a-chat-thread-id', {
    content: 'matching invalid ids are still untrusted',
    threadId: 'not-a-chat-thread-id',
  });
  assert(
    !invalidContext.ok && invalidContext.code === 'missing_thread_identity',
    'a non-UUID context value is not accepted as authenticated thread identity',
  );

  const hostileModelValues: Array<[string, unknown]> = [
    ['empty string', ''],
    ['null', null],
    ['explicit undefined', undefined],
    ['non-string', 42],
    ['case-changed UUID', visibleThreadA.toUpperCase()],
    ['whitespace-wrapped UUID', ` ${visibleThreadA} `],
  ];
  for (const [label, threadId] of hostileModelValues) {
    const result = bindThread(visibleThreadA, { content: 'hostile', threadId });
    assert(
      !result.ok && result.code === 'thread_identity_mismatch',
      `model ${label} is an explicit mismatch, not an omission`,
    );
  }

  const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const localRuntime = readFileSync(join(repoRoot, 'src/lib/openswanToolRuntime.ts'), 'utf8');
  const batch = readFileSync(join(repoRoot, 'src/lib/swanbotV2BatchRuntime.ts'), 'utf8');
  const client = readFileSync(join(repoRoot, 'src/lib/swanbot.ts'), 'utf8');
  const edge = readFileSync(join(repoRoot, 'supabase/functions/swanbot-v2-ai/index.ts'), 'utf8');

  const createStart = localRuntime.lastIndexOf("case 'messages.create':");
  const createEnd = localRuntime.indexOf("case 'messages.search':", createStart);
  const createHandler = createStart >= 0 && createEnd > createStart
    ? localRuntime.slice(createStart, createEnd)
    : '';
  assert(createHandler.length > 0, 'local messages.create handler is present');
  assert(
    createHandler.indexOf('resolveOpenSwanMessagesCreateThreadBinding(context.threadId, args)')
      < createHandler.indexOf("await import('./chatService')"),
    'local handler proves exact thread binding before loading the write path',
  );
  assert(
    createHandler.includes('threadId: threadBinding.threadId'),
    'local insert receives only the resolved authenticated context thread',
  );
  assert(
    !createHandler.includes('a.threadId || context.threadId')
      && !createHandler.includes('threadId: a.threadId'),
    'local handler has no model-selected or threadless fallback write target',
  );

  assert(
    batch.includes('const authenticatedThreadId = extra.threadId;'),
    'local batch snapshots the caller thread identity once',
  );
  assert(
    (batch.match(/threadId: authenticatedThreadId/g) || []).length === 2,
    'local batch forwards the same exact thread to tool context and provider session',
  );
  assert(
    !batch.includes('threadId: extra.threadId'),
    'local batch does not re-read a mutable options object for thread identity',
  );

  assert(
    client.includes("...(clientLoopContext?.threadId ? { threadId: clientLoopContext.threadId } : {})"),
    'fresh v2 requests carry the active Chat thread identity',
  );
  assert(
    edge.includes('threadId: resumeFrom?.threadId ?? threadId ?? null'),
    'resumed tool calls restore thread identity from the authenticated continuation',
  );
  assert(
    edge.includes('...(ctx.threadId ? { threadId: ctx.threadId } : {})'),
    'pending continuations persist the validated thread identity',
  );
  assert(
    edge.includes('.from("circle_chat_thread_members")')
      && edge.includes('thread_authorization_unavailable')
      && edge.includes('thread_forbidden'),
    'the service-role edge checks exact thread visibility before model or tool work',
  );
  assert(
    edge.includes('if (!threadId) {')
      && edge.includes('active Chat thread identity required')
      && edge.includes('if (args.threadId && args.threadId !== threadId)')
      && edge.includes('thread_id: threadId'),
    'edge messages.create requires and uses only the pre-authorized active thread',
  );
  assert(
    !edge.includes('if (args.threadId) payload.thread_id = args.threadId'),
    'model-supplied thread ids cannot directly choose the service-role write target',
  );
  if (failures > 0) {
    throw new Error(`${failures} assertion(s) failed.`);
  }

  console.log('\nswanbot-v2-thread-identity-smoketest: all assertions passed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
