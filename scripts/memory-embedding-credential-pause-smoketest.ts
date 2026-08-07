/**
 * Source-backed regression checks for the session-terminal embedding credential
 * pause. Loading memoryEmbeddings directly under tsx pulls the React Native
 * runtime, so this smoke verifies the I/O wiring while the pure state-machine
 * behavior remains covered by memory-embedding-policy-core-smoketest.ts.
 *
 *   npx tsx scripts/memory-embedding-credential-pause-smoketest.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

let passed = 0;
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0, `source section starts with ${startMarker}`);
  check(end > start, `source section ends with ${endMarker}`);
  return source.slice(start, end);
}

const embeddings = read('src/lib/memoryEmbeddings.ts');
const providers = read('src/lib/llmProviders.ts');
const marketplace = read('src/screens/circles/tabs/IntegrationsTab.tsx');

check(
  embeddings.includes("import { readLLMProxyInvokeError } from './llmProxyErrorCore';"),
  'embedding errors use the shared structured llm-proxy error reader',
);
check(
  embeddings.includes("import { safeGetSession } from './authSession';"),
  'the terminal pause is bound to a safely read signed-in session',
);
check(
  embeddings.includes("type EmbeddingCredentialBlockCode = 'key_missing' | 'credential_unreadable';"),
  'only permanent missing/unreadable credential outcomes create the terminal pause',
);

const proxy = section(embeddings, 'async function callEmbedProxy(', '/** pgvector wants');
const earlyBlock = proxy.indexOf('if (embeddingCredentialBlock) return null;');
const invoke = proxy.indexOf("supabase.functions.invoke('llm-proxy'");
check(earlyBlock >= 0 && invoke > earlyBlock, 'a paused session exits before another llm-proxy request');
check(
  proxy.indexOf('while (embeddingProxyTurn)') < invoke
    && proxy.indexOf('embeddingProxyTurn = proxyTurn;') < invoke,
  'startup embedding calls serialize until the first credential verdict is known',
);
check(
  proxy.includes('EMBEDDING_PROXY_TIMEOUT_MS') && proxy.includes('signal: controller.signal'),
  'a hung proxy turn is abort-bounded instead of wedging all embedding work',
);
check(
  proxy.indexOf("readLLMProxyInvokeError(error, 'openai')") > invoke,
  'the proxy failure is decoded into its structured provider/code contract',
);
check(
  proxy.includes('if (isEmbeddingCredentialBlockCode(details.code))')
    && proxy.includes('code: details.code')
    && proxy.includes("provider: 'openai'"),
  'key_missing and credential_unreadable persist one OpenAI session block',
);
check(
  proxy.includes('paused until the OpenAI Marketplace key changes'),
  'the first terminal credential failure emits one actionable pause warning',
);
check(
  proxy.includes('requestCredentialGeneration !== embeddingCredentialGeneration'),
  'a response from a replaced in-flight key cannot re-pause the new credential generation',
);
check(
  proxy.includes('completedAuth.userId !== requestUserId')
    && proxy.includes('embeddingCredentialBlock.userId !== initialAuth.userId'),
  'a terminal pause cannot leak across an in-place signed-in account switch',
);
check(!proxy.includes('JSON.stringify(error)'), 'credential/proxy errors are never serialized into logs');
check(!proxy.includes('JSON.stringify(data)'), 'unexpected proxy response bodies are not serialized into logs');
check(!proxy.includes("console.warn('[memoryEmbeddings] proxy call failed:', err)"), 'raw thrown proxy objects are not logged');

const reset = section(
  embeddings,
  'export function resetMemoryEmbeddingCredentialBlock()',
  'async function callEmbedProxy(',
);
check(
  reset.includes('embeddingCredentialGeneration += 1;')
    && reset.includes('embeddingCredentialBlock = null;')
    && !reset.includes('if (!embeddingCredentialBlock) return;'),
  'every successful OpenAI key write invalidates old in-flight results and clears the pause',
);
check(
  reset.indexOf('embeddingCredentialBlock = null;')
    < reset.indexOf('ensureMemoryEmbeddingCoverage({ force: true })'),
  'reset clears the pause before forcing one bounded repair probe',
);
check(
  reset.includes('breakerState = recordEmbeddingSuccess(breakerState);'),
  'a successful Marketplace key write also releases the transient breaker',
);
check(
  reset.includes('const activeRepair = repairInFlight;')
    && reset.includes('activeRepair.catch(() => undefined)'),
  'resume waits for an already-running old-key repair before forcing the new-key probe',
);

const drain = section(embeddings, 'async function drainEmbedQueue()', '/**\n * Await the write-path queue');
check(
  drain.includes('if (embedQueue.length > 0 && embeddingCredentialBlock)')
    && drain.includes("noteOrphans(embedQueue.length, 'OpenAI Marketplace credential unavailable', false)")
    && drain.includes('embedQueue = [];'),
  'queued writes preserve repair debt quietly and stop retrying while credentials are blocked',
);

const repair = section(
  embeddings,
  'export async function repairMemoryEmbeddings(',
  '/**\n * THE TRIGGER.',
);
check(
  repair.includes("return repairResult(createRepairCursor(Date.now()), 'credential_blocked', false, 0, dryRun)"),
  'a repair started during the pause exits with credential_blocked',
);
const pageBlock = repair.indexOf("stopReason = 'credential_blocked';");
const advanceCursor = repair.indexOf('cursor = advanceRepairCursor(');
check(
  pageBlock >= 0 && advanceCursor > pageBlock,
  'a credential failure discovered mid-page stops before advancing past unattempted rows',
);

const ensure = section(
  embeddings,
  'export async function ensureMemoryEmbeddingCoverage(',
  '/** Row counts behind the semantic-retrieval gap.',
);
check(
  ensure.includes("if (embeddingCredentialBlock) return { ...idle, reason: 'credential_blocked' }"),
  'hot-path coverage checks remain request-free while the terminal pause is active',
);
check(
  embeddings.includes("credentialBlock: Omit<EmbeddingCredentialBlock, 'userId'> | null")
    && !embeddings.includes('credentialBlock: embeddingCredentialBlock ? { ...embeddingCredentialBlock } : null'),
  'safe runtime diagnostics expose pause metadata without the authenticated user id',
);

const notification = section(
  providers,
  'export function notifyUserApiKeyChanges(',
  '// ─── Model catalogs per provider',
);
check(
  notification.includes("if (provider === 'openai')")
    && notification.includes("import('./memoryEmbeddings')")
    && notification.includes('resetMemoryEmbeddingCredentialBlock()'),
  'only an exact OpenAI Marketplace change lazy-loads and resumes embedding repair',
);
check(
  (providers.match(/resetMemoryEmbeddingCredentialBlock\(\)/g) || []).length === 1,
  'there is no unconditional or non-OpenAI embedding reset path',
);
check(
  providers.includes('if (options.notify !== false) notifyUserApiKeyChanges(provider);'),
  'successful storeApiKey writes notify with the exact provider identity',
);
check(
  marketplace.includes("notifyUserApiKeyChanges('anthropic');"),
  'the verified Anthropic path refreshes Chat without waking OpenAI embeddings',
);
check(
  marketplace.includes('if (!error) notifyUserApiKeyChanges(userApiProvider);'),
  'the generic Marketplace path resumes embeddings only after a successful provider-key write',
);

console.log(`memory-embedding-credential-pause smoke: ${passed} passed`);
