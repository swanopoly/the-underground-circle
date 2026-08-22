/** Runtime regression for the browser-safe llm-proxy error contract. */

import {
  getLLMProxyCredentialRecoveryPresentation,
  getLLMProxyProviderAvailabilityPresentation,
  getLLMProxyProviderQuarantineKind,
  LLMProxyInvocationError,
  normalizeLLMProxyErrorPayload,
  normalizeLLMProxyErrorResponseText,
  readLLMProxyInvokeError,
  shouldRetryLLMProxyFailure,
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
  check(!shouldRetryLLMProxyFailure(details), 'missing credentials are not retried');
  check(!shouldRetryLLMProxyFailure(unreadable), 'unreadable credentials are not retried');
  const passiveCatalogUnreadable = normalizeLLMProxyErrorPayload({
    status: 'unavailable',
    provider: 'hostile-provider',
    models: [],
    code: 'credential_unreadable',
    error: 'Reconnect the saved provider credential.',
  }, 'fallback', undefined, 'openai');
  check(passiveCatalogUnreadable.code === 'credential_unreadable' && passiveCatalogUnreadable.status === undefined, 'handled list_models HTTP 200 envelope preserves stable non-ready code without inventing an error status');
  check(passiveCatalogUnreadable.provider === 'openai' && !shouldRetryLLMProxyFailure(passiveCatalogUnreadable), 'handled catalog failure stays exact-provider and non-retryable');
  const rejected = normalizeLLMProxyErrorPayload({
    code: 'provider_credential_rejected',
    error: 'The provider rejected this credential.',
  }, 'fallback', 502, 'openai');
  const rejectedRecovery = getLLMProxyCredentialRecoveryPresentation(rejected);
  check(rejectedRecovery?.message.includes('saved OpenAI credential was rejected'), 'provider 401/403 maps to bounded reconnect guidance');
  check(rejectedRecovery?.actionLabel === 'Reconnect OpenAI', 'rejected credentials expose the exact safe Marketplace repair');
  check(!shouldRetryLLMProxyFailure(rejected), 'provider-rejected credentials are not retried in the same turn');
  const billingUnavailable = normalizeLLMProxyErrorPayload({
    code: 'provider_billing_unavailable',
    error: 'The selected provider account has no available billing capacity.',
  }, 'fallback', 502, 'openrouter');
  const billingPresentation = getLLMProxyProviderAvailabilityPresentation(billingUnavailable);
  check(billingUnavailable.code === 'provider_billing_unavailable' && billingUnavailable.provider === 'openrouter', 'preserves the exact provider billing refusal');
  check(billingPresentation?.message.includes('OpenRouter') && billingPresentation.message.includes('No other provider was tried in this turn'), 'billing refusal copy preserves no-same-turn-replay truth');
  check(billingPresentation?.providerId === 'openrouter', 'billing refusal keeps the exact safe provider scope');
  check(getLLMProxyCredentialRecoveryPresentation(billingUnavailable) === null, 'valid-but-unfunded provider is not mislabeled as a credential reconnect');
  check(getLLMProxyProviderQuarantineKind(billingUnavailable) === 'billing', 'billing refusal receives a finite provider quarantine kind');
  check(getLLMProxyProviderQuarantineKind(rejected) === 'credential', 'rejected keys retain key-change quarantine semantics');
  check(!shouldRetryLLMProxyFailure(billingUnavailable), 'provider billing refusal is never retried in the same turn');
  check(!shouldRetryLLMProxyFailure({ code: 'validation', status: 400 }), 'validation failures are not retried');
  check(shouldRetryLLMProxyFailure({ status: 429 }), 'rate limits permit one bounded retry');
  check(shouldRetryLLMProxyFailure({ code: 'upstream_error', status: 502 }), 'upstream failures permit one bounded retry');
  check(shouldRetryLLMProxyFailure({}), 'statusless transport failures permit one bounded retry');

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
