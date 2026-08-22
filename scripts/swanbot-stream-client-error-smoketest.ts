/**
 * Source/runtime smoke for chat-stream pre-handshake error metadata.
 *
 * swanbotStream imports the React Native Supabase client and cannot be loaded
 * directly by tsx. The response parser itself is pure and exercised at runtime
 * here; narrow source assertions pin the adapter wiring and additive callback
 * shape without mocking the application runtime.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LLMProxyInvocationError,
  normalizeLLMProxyErrorResponseText,
} from '../src/lib/llmProxyErrorCore';

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`swanbot stream client error smoke failed: ${message}`);
}

const source = readFileSync(
  fileURLToPath(new URL('../src/lib/swanbotStream.ts', import.meta.url)),
  'utf8',
);

const details = normalizeLLMProxyErrorResponseText(JSON.stringify({
  code: 'credential_unreadable',
  error: `Saved key sk-ant-${'a'.repeat(48)} cannot be read.`,
}), 'fallback', 409, 'anthropic');
const structured = new LLMProxyInvocationError(details);

check(structured instanceof Error, 'structured stream error remains an Error object');
check(structured.code === 'credential_unreadable', 'structured stream error preserves public code');
check(structured.status === 409, 'structured stream error preserves HTTP status');
check(structured.provider === 'anthropic', 'structured stream error preserves the Anthropic route');
check(!structured.message.includes('sk-ant-'), 'structured stream error redacts credential material');

check(
  /onError:\s*\(\s*message:\s*string,\s*result\?:\s*StreamChatResult,\s*error\?:\s*LLMProxyInvocationError,?\s*\)\s*=>\s*void/s.test(source),
  'onError exposes a backward-compatible optional structured third argument',
);
check(
  /normalizeLLMProxyErrorResponseText\(\s*errText,[\s\S]*?res\.status,[\s\S]*?'anthropic',?\s*\)/.test(source),
  'non-2xx response text is normalized with status and the authoritative Anthropic provider',
);
check(
  /finishPreStreamError\(details\.message,\s*new LLMProxyInvocationError\(details\)\)/.test(source),
  'pre-stream HTTP failure passes safe display copy plus a structured Error object',
);
check(
  /opts\.onError\(message,\s*undefined,\s*error\)/.test(source),
  'structured metadata is additive and does not occupy the existing result argument',
);

// Compatibility proof: callbacks that consume only the original message
// argument are still assignable to the expanded optional-argument contract.
type CompatibleOnError = (
  message: string,
  result?: unknown,
  error?: LLMProxyInvocationError,
) => void;
const legacyOnError: CompatibleOnError = (message: string) => {
  check(message === details.message, 'legacy one-argument callback still receives display copy');
};
legacyOnError(details.message, undefined, structured);

console.log(`swanbot stream client error smoke passed (${assertions} assertions)`);
