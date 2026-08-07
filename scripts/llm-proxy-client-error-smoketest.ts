/** Runtime regression for the browser-safe llm-proxy error contract. */

import {
  LLMProxyInvocationError,
  normalizeLLMProxyErrorPayload,
  readLLMProxyInvokeError,
} from '../src/lib/llmProxyErrorCore';

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`llm-proxy client error smoke failed: ${message}`);
}

async function main(): Promise<void> {
  let cloneCalls = 0;
  const details = await readLLMProxyInvokeError({
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status: 400,
      clone: () => ({
        json: async () => {
          cloneCalls += 1;
          return {
            code: 'key_missing',
            error: 'Add your own OpenRouter API key in Office > Customize > API Keys.',
          };
        },
      }),
    },
  });
  check(cloneCalls === 1, 'reads the non-2xx JSON body from a cloned response');
  check(details.code === 'key_missing', 'preserves an allowlisted Edge error code');
  check(details.status === 400, 'preserves a bounded HTTP status');
  const thrown = new LLMProxyInvocationError(details);
  check(thrown.message.startsWith('key_missing:'), 'typed error keeps the code in its message');
  check(thrown.code === 'key_missing' && thrown.status === 400, 'typed error keeps structured code and status');

  const unreadable = normalizeLLMProxyErrorPayload({
    code: 'credential_unreadable',
    error: 'A saved provider credential could not be read. Re-enter it.',
  }, 'fallback', 409);
  check(unreadable.code === 'credential_unreadable' && unreadable.status === 409, 'preserves the unreadable-ciphertext recovery code');

  const untrusted = normalizeLLMProxyErrorPayload({
    code: 'run_connected_agent',
    error: `Provider said\nBearer top-secret-token-value ${'x'.repeat(900)}`,
  });
  check(untrusted.code === undefined, 'rejects unknown response codes');
  check(!untrusted.message.includes('top-secret-token-value'), 'redacts bearer-token shaped text');
  check(untrusted.message.length <= 500 && !untrusted.message.includes('\n'), 'bounds and flattens public error copy');

  const malformed = await readLLMProxyInvokeError({
    message: 'safe generic error',
    context: { status: 999, clone: () => ({ json: async () => { throw new Error('bad json'); } }) },
  });
  check(malformed.message === 'safe generic error', 'malformed bodies retain a safe generic fallback');
  check(malformed.status === undefined, 'invalid status values are discarded');

  console.log(`llm-proxy client error smoke passed (${assertions} assertions)`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
