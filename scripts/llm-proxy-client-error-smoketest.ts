/** Runtime regression for the browser-safe llm-proxy error contract. */

import {
  getLLMProxyCredentialRecoveryPresentation,
  LLMProxyInvocationError,
  normalizeLLMProxyErrorPayload,
  normalizeLLMProxyErrorResponseText,
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
  }, 'openrouter');
  check(cloneCalls === 1, 'reads the non-2xx JSON body from a cloned response');
  check(details.code === 'key_missing', 'preserves an allowlisted Edge error code');
  check(details.status === 400, 'preserves a bounded HTTP status');
  const thrown = new LLMProxyInvocationError(details);
  check(thrown.message.startsWith('key_missing:'), 'typed error keeps the code in its message');
  check(thrown.code === 'key_missing' && thrown.status === 400, 'typed error keeps structured code and status');
  check(thrown.provider === 'openrouter', 'typed error keeps the safe request-route provider');

  const missingRecovery = getLLMProxyCredentialRecoveryPresentation(details);
  check(missingRecovery?.message === 'Connect your OpenRouter API key in Marketplace → AI Models & APIs, then retry.', 'missing-key recovery uses accurate Marketplace copy');
  check(missingRecovery?.actionLabel === 'Connect OpenRouter', 'missing-key recovery provides a direct action label');
  check(missingRecovery?.providerId === 'openrouter' && missingRecovery.itemId === 'openrouter', 'missing-key recovery provides a safe provider/item target');

  const unreadable = normalizeLLMProxyErrorPayload({
    code: 'credential_unreadable',
    error: 'A saved provider credential could not be read. Re-enter it.',
  }, 'fallback', 409, 'anthropic');
  check(unreadable.code === 'credential_unreadable' && unreadable.status === 409, 'preserves the unreadable-ciphertext recovery code');
  const unreadableRecovery = getLLMProxyCredentialRecoveryPresentation(unreadable);
  check(unreadableRecovery?.message === 'Your saved Anthropic credential can no longer be read. Reconnect it in Marketplace → AI Models & APIs, then retry.', 'unreadable recovery explains that reconnection is required');
  check(unreadableRecovery?.actionLabel === 'Reconnect Anthropic', 'unreadable recovery labels the repair action');
  check(unreadableRecovery?.providerId === 'anthropic' && unreadableRecovery.itemId === 'anthropic', 'unreadable recovery targets the Anthropic Marketplace item');

  const streamed = normalizeLLMProxyErrorResponseText(JSON.stringify({
    code: 'credential_unreadable',
    error: 'Reconnect the saved credential.',
    provider: 'hostile-route',
  }), 'fallback', 409, 'anthropic');
  check(streamed.code === 'credential_unreadable' && streamed.status === 409, 'response-text parser preserves code and status');
  check(streamed.provider === 'anthropic', 'request route overrides an untrusted response provider');

  const legacyMessageBody = normalizeLLMProxyErrorResponseText(JSON.stringify({
    code: 'key_missing',
    message: 'Connect Anthropic.',
  }), 'fallback', 400, 'anthropic');
  check(legacyMessageBody.message === 'Connect Anthropic.', 'response-text parser remains compatible with legacy message bodies');

  const untrusted = normalizeLLMProxyErrorPayload({
    code: 'run_connected_agent',
    error: `Provider said\nBearer top-secret-token-value sk-ant-${'a'.repeat(48)} AIza${'b'.repeat(32)} ${'x'.repeat(900)}`,
    provider: '../../../../vault',
  });
  check(untrusted.code === undefined, 'rejects unknown response codes');
  check(!untrusted.message.includes('top-secret-token-value'), 'redacts bearer-token shaped text');
  check(!untrusted.message.includes('sk-ant-') && !untrusted.message.includes('AIza'), 'redacts provider-key shaped text');
  check(untrusted.provider === undefined, 'rejects arbitrary provider navigation targets');
  check(untrusted.message.length <= 500 && !untrusted.message.includes('\n'), 'bounds and flattens public error copy');
  check(getLLMProxyCredentialRecoveryPresentation(untrusted) === null, 'non-credential failures do not produce Marketplace recovery');

  const genericRecovery = getLLMProxyCredentialRecoveryPresentation({ code: 'key_missing' });
  check(genericRecovery?.providerId === null && genericRecovery.itemId === null, 'unknown provider never creates an arbitrary Marketplace target');
  check(genericRecovery?.actionLabel === 'Open Marketplace', 'unknown provider keeps a safe generic Marketplace action');

  const plainText = normalizeLLMProxyErrorResponseText(`upstream leaked sk-proj-${'z'.repeat(40)}`, 'fallback', 502, 'anthropic');
  check(plainText.status === 502 && plainText.provider === 'anthropic', 'plain-text errors retain safe structured route metadata');
  check(!plainText.message.includes('sk-proj-'), 'plain-text error fallback is secret-redacted');

  const malformed = await readLLMProxyInvokeError({
    message: 'safe generic error',
    context: { status: 999, clone: () => ({ json: async () => { throw new Error('bad json'); } }) },
  });
  check(malformed.message === 'safe generic error', 'malformed bodies retain a safe generic fallback');
  check(malformed.status === undefined, 'invalid status values are discarded');

  // Original three-argument normalizer and one-argument constructor remain
  // valid for existing callers that do not provide provider metadata.
  const legacy = new LLMProxyInvocationError(normalizeLLMProxyErrorPayload({ error: 'legacy' }));
  check(legacy.message === 'legacy' && legacy.provider === undefined, 'legacy client API remains compatible');

  console.log(`llm-proxy client error smoke passed (${assertions} assertions)`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
