/**
 * Source contract for the private, durable Chat generated-image backend.
 *
 * This intentionally inspects the Edge function and its canonical migration
 * without importing the Deno runtime or touching a live Supabase project.
 *
 * Run: npm run smoke:chat-generated-image-backend
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backendPath = resolve(root, 'supabase/functions/image-generate/index.ts');
const migrationPath = resolve(
  root,
  'supabase/migrations/20260820120000_chat_generated_images.sql',
);
const backend = readFileSync(backendPath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8');

let failures = 0;

function check(condition: unknown, message: string, detail?: string): void {
  if (condition) {
    console.log(`pass: ${message}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
}

function sourceSection(
  source: string,
  startMarker: string,
  endMarker?: string,
): string {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  if (!endMarker) return source.slice(start);
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? '' : source.slice(start, end);
}

function compact(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

function hasInOrder(source: string, markers: string[]): boolean {
  let cursor = 0;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor);
    if (next < 0) return false;
    cursor = next + marker.length;
  }
  return true;
}

function sameSet(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...new Set(actual)].sort()) === JSON.stringify([...expected].sort());
}

const serve = sourceSection(backend, 'Deno.serve(async (req: Request) => {');
const requestReader = sourceSection(
  backend,
  'async function readRequestJson',
  'async function readResponseJson',
);
const boundedStreamReader = sourceSection(
  backend,
  'async function readBoundedStream',
  'function decodeUtf8',
);
const responseReader = sourceSection(
  backend,
  'async function readResponseJson',
  'function joinAbortSignals',
);
const selector = sourceSection(
  backend,
  'async function selectGenerator',
  'async function generateOpenAi',
);
const candidateRouter = sourceSection(
  backend,
  'function candidateSpecs',
  'async function selectGenerator',
);
const sourceVerifier = sourceSection(
  backend,
  'async function verifyOwnedSourceMessage',
  'async function verifyCircleMembership',
);
const chatGenerate = sourceSection(
  backend,
  'async function handleChatGenerate',
  'async function handleSign',
);
const signer = sourceSection(
  backend,
  'async function signReadyImage',
  'function rowMatchesRequest',
);
const signHandler = sourceSection(
  backend,
  'async function handleSign',
  'async function handleTerminalCompatibility',
);
const reservation = sourceSection(
  backend,
  'async function reserveAndClaimChatImage',
  'async function createAndClaimTerminalImage',
);
const completion = sourceSection(
  backend,
  'async function completeClaimedGeneration',
  'async function reserveAndClaimChatImage',
);
const imageInspection = sourceSection(
  backend,
  'async function inspectImage',
  'async function sha256Text',
);
const fixedEgress = sourceSection(
  backend,
  'async function fixedFetch',
  'async function delayWithinDeadline',
);
const replicateUrlGuard = sourceSection(
  backend,
  'function replicateOutputUrl',
  'async function generateReplicate',
);

check(Boolean(serve), 'Edge request handler is present');
const authAt = serve.indexOf('getAuthenticatedUser(req)');
const callerAt = serve.indexOf('createCallerClient(authorization)');
const serviceAt = serve.indexOf('createServiceRoleClient()');
const bodyAt = serve.indexOf('readRequestJson(req');
check(
  authAt >= 0 && callerAt > authAt && serviceAt > authAt && bodyAt > authAt,
  'user authentication completes before caller/service clients or request-body parsing',
);
check(
  (backend.match(/createServiceRoleClient\(\)/g) || []).length === 1,
  'service-role client has one request-scoped creation point after authentication',
);
check(
  serve.includes('if (req.method !== "POST")') && serve.indexOf('if (req.method !== "POST")') < authAt,
  'non-POST requests are rejected before privileged setup',
);

check(
  requestReader.includes('readBoundedStream(')
    && requestReader.includes('MAX_BODY_BYTES')
    && requestReader.includes('Content-Type must be application/json.'),
  'request JSON is content-type checked and byte bounded',
);
check(
  boundedStreamReader.includes('Promise.race([reader.read(), abortPromise])')
    && boundedStreamReader.includes('deadlineTimer = setTimeout(abortRead, remaining)')
    && boundedStreamReader.includes('options.signal?.addEventListener("abort", abortRead')
    && boundedStreamReader.includes('reader.cancel()')
    && responseReader.includes('{ signal, deadlineAt }')
    && (backend.match(/\{ signal, deadlineAt \}/g) || []).length >= 8,
  'request and every provider body remain abort/deadline bounded through the final byte',
);
check(
  requestReader.includes('Object.prototype.hasOwnProperty.call(record, "api_key")')
    && requestReader.includes('Client-supplied provider keys are not accepted.'),
  'request-supplied provider credentials are explicitly rejected',
);
check(
  selector.includes('resolveUserModelApiKey({')
    && selector.includes('supabase: serviceClient')
    && selector.includes('userId')
    && selector.includes('provider: spec.provider')
    && selector.includes('label: null')
    && selector.includes('credentialPolicy: "user_required"')
    && selector.includes('failOnStoredLookupError: true'),
  'provider selection requires the authenticated user\'s stored BYOK credential',
);
check(
  !/\bbody\.(?:api_?key|providerKey)\b/i.test(backend)
    && !/headers\.get\(["'](?:x-api-key|x-provider-key)["']\)/i.test(backend)
    && !/(?:OPENAI_API_KEY|HUGGINGFACE_API_KEY|HF_API_KEY|REPLICATE_API_KEY|REPLICATE_API_TOKEN)/.test(backend),
  'provider calls cannot fall back to request or platform image-provider keys',
);

check(
  sourceVerifier.includes('.from("messages")')
    && sourceVerifier.includes('.select("id,circle_id,thread_id,user_id,is_bot")')
    && sourceVerifier.includes('.eq("id", sourceMessageId)')
    && sourceVerifier.includes('.eq("circle_id", circleId)')
    && sourceVerifier.includes('.eq("thread_id", threadId)')
    && sourceVerifier.includes('data.user_id !== userId')
    && sourceVerifier.includes('data.is_bot === true'),
  'Chat source authority binds exact message, circle, thread, owner, and non-bot identity',
);
check(
  hasInOrder(chatGenerate, [
    'isUuid(circleId)',
    'isUuid(threadId)',
    'isUuid(sourceMessageId)',
    'await verifyOwnedSourceMessage(',
    'await readGeneratedRowBySource(',
  ]),
  'persisted UUID source lineage is verified before receipt lookup or generation routing',
);
check(
  chatGenerate.indexOf('await verifyOwnedSourceMessage(') >= 0
    && chatGenerate.indexOf('await verifyOwnedSourceMessage(') < chatGenerate.indexOf('await selectGenerator(')
    && chatGenerate.indexOf('await verifyOwnedSourceMessage(') < chatGenerate.indexOf('await reserveAndClaimChatImage(')
    && chatGenerate.indexOf('await verifyOwnedSourceMessage(') < chatGenerate.indexOf('await completeClaimedGeneration('),
  'no Chat provider path is reachable before exact source verification',
);

const generatorSpecs = [...backend.matchAll(
  /const\s+[A-Z0-9_]+:\s*GeneratorSpec\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/g,
)].map((match) => {
  const body = match[1];
  return [
    /provider:\s*"([^"]+)"/.exec(body)?.[1],
    /model:\s*"([^"]+)"/.exec(body)?.[1],
    /logicalModel:\s*"([^"]+)"/.exec(body)?.[1],
  ].join('|');
});
const expectedGeneratorSpecs = [
  'openai|gpt-image-2|gpt-image-2',
  'huggingface|black-forest-labs/FLUX.1-schnell|flux-schnell',
  'replicate|black-forest-labs/flux-schnell|flux-schnell',
  'replicate|black-forest-labs/flux-dev|flux-dev',
  'huggingface|stabilityai/stable-diffusion-xl-base-1.0|stable-diffusion-xl',
];
check(
  sameSet(generatorSpecs, expectedGeneratorSpecs),
  'backend exposes only the five reviewed exact provider/model mappings',
  generatorSpecs.join(', '),
);
const compactRouter = compact(candidateRouter);
check(
  compactRouter.includes('case "gpt-image-2": candidates = [OPENAI_GPT_IMAGE_2];')
    && compactRouter.includes('case "flux-dev": candidates = [REPLICATE_FLUX_DEV];')
    && compactRouter.includes('case "stable-diffusion-xl": candidates = [HF_SDXL];')
    && compactRouter.includes('case "flux-schnell": candidates = [HF_FLUX_SCHNELL, REPLICATE_FLUX_SCHNELL];'),
  'explicit image choices route to their exact reviewed provider families',
);
check(
  candidateRouter.includes('if (exactModelInput && !logicalModel)')
    && candidateRouter.includes('if (!logicalModel && looksLikeUnsupportedImageModel(requestedModel))')
    && candidateRouter.includes('candidates = candidates.filter'),
  'unsupported explicit image models and provider/model mismatches fail closed',
);

check(
  fixedEgress.includes('redirect: "manual"')
    && fixedEgress.includes('signal: bounded.signal')
    && fixedEgress.includes('deadlineAt - Date.now()'),
  'all provider egress uses manual redirects and the shared abort/deadline fence',
);
check(
  (backend.match(/\bfetch\s*\(/g) || []).length === 1,
  'the fixed egress helper is the only direct network fetch site',
);
for (const endpoint of [
  'https://api.openai.com/v1/images/generations',
  'https://router.huggingface.co/hf-inference/models/${spec.model}',
  'https://api.replicate.com/v1/models/${owner}/${model}/predictions',
  'https://api.replicate.com/v1/predictions/${predictionId}',
]) {
  check(backend.includes(endpoint), `provider egress is pinned to ${endpoint}`);
}
check(
  replicateUrlGuard.includes('url.protocol !== "https:"')
    && replicateUrlGuard.includes('url.username || url.password')
    && replicateUrlGuard.includes('(url.port && url.port !== "443")')
    && replicateUrlGuard.includes('host !== "replicate.delivery"')
    && replicateUrlGuard.includes('!host.endsWith(".replicate.delivery")'),
  'Replicate output downloads allow only credential-free HTTPS replicate.delivery hosts',
);
check(
  backend.includes('const REPLICATE_PREDICTION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;')
    && backend.includes('REPLICATE_PREDICTION_ID_RE.test(predictionId)'),
  'Replicate polling paths accept only bounded opaque prediction ids',
);

for (const cap of [
  'const MAX_BODY_BYTES = 12_000;',
  'const MAX_IMAGE_BYTES = 20 * 1024 * 1024;',
  'const MAX_PROVIDER_JSON_BYTES = 30 * 1024 * 1024;',
  'const MAX_PROVIDER_CONTROL_JSON_BYTES = 512 * 1024;',
  'const MAX_DIMENSION = 8_192;',
  'const MAX_PIXELS = 40_000_000;',
]) {
  check(backend.includes(cap), `backend pins ${cap.replace('const ', '').replace(';', '')}`);
}
check(
  backend.includes('value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8')
    && backend.includes('binary.length > MAX_IMAGE_BYTES')
    && backend.includes('readBoundedStream(\n      response.body,\n      MAX_IMAGE_BYTES')
    && backend.includes('readResponseJson(\n    response,\n    MAX_PROVIDER_CONTROL_JSON_BYTES'),
  'base64, binary, image-response, and provider-control payloads are independently bounded',
);
check(
  imageInspection.includes('bytes[0] === 0x89')
    && imageInspection.includes('String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"')
    && imageInspection.includes('parseJpegDimensions(bytes)')
    && imageInspection.includes('parseWebpDimensions(bytes)')
    && imageInspection.includes('declared !== mimeType'),
  'image acceptance is based on PNG/JPEG/WebP magic and declared-type agreement',
);
check(
  imageInspection.includes('width > MAX_DIMENSION')
    && imageInspection.includes('height > MAX_DIMENSION')
    && imageInspection.includes('width * height > MAX_PIXELS')
    && imageInspection.includes('crypto.subtle.digest("SHA-256"'),
  'validated images are dimension/pixel capped and content hashed',
);

check(
  reservation.includes('.eq("source_message_id", input.sourceMessageId)')
    && reservation.includes('.eq("generation_scope", "chat")')
    && reservation.includes('rowMatchesRequest(row, { ...input, scope: "chat" })'),
  'reservation conflicts re-read and compare the exact source-bound request',
);
check(
  reservation.includes('row.status === "outcome_unknown"')
    && reservation.includes('if (row.provider_started_at)')
    && reservation.includes('"generation_in_progress"')
    && reservation.includes('It will not be replayed'),
  'ambiguous or already-started source messages never auto-replay provider I/O',
);
check(
  hasInOrder(reservation, [
    '.update({ provider_started_at: providerStartedAt })',
    '.eq("id", row.id)',
    '.eq("status", "pending")',
    '.is("provider_started_at", null)',
    '.select("*")',
  ]),
  'provider dispatch is guarded by a pending/null compare-and-set claim',
);
check(
  hasInOrder(completion, [
    'const providerResult = await callProvider(',
    'const inspected = await inspectImage(',
    '.from(GENERATED_IMAGE_BUCKET)',
    '.upload(row.storage_path, inspected.bytes',
    '.from("chat_generated_images")',
    'status: "ready"',
    'await signReadyImage(serviceClient, readyRow)',
  ])
    && completion.includes('await markOutcomeUnknown(serviceClient, row.id, normalized.code)'),
  'a claimed call is validated, privately stored, receipted, signed, and fail-closed on uncertainty',
);

check(
  completion.includes('cacheControl: "0"')
    && completion.includes('upsert: false')
    && signer.includes('.from(GENERATED_IMAGE_BUCKET)')
    && signer.includes('.createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)'),
  'private storage is non-overwriting and exposed only by short-lived signed URLs',
);
check(
  !backend.includes('.getPublicUrl(')
    && !backend.includes('.createPublicUrl(')
    && !backend.includes('publicUrl'),
  'backend contains no public generated-image URL path',
);
check(
  signHandler.indexOf('.from("messages")') >= 0
    && signHandler.indexOf('.from("messages")') < signHandler.lastIndexOf('signReadyImage(serviceClient, row)')
    && signHandler.includes('.eq("id", row.source_message_id)')
    && signHandler.includes('.eq("circle_id", row.circle_id)')
    && signHandler.includes('.eq("thread_id", row.thread_id)')
    && signHandler.includes('await verifyCircleMembership(callerClient, userId, row.circle_id)'),
  're-signing revalidates Chat source visibility or terminal ownership/membership first',
);

const tableDefinition = sourceSection(
  migration,
  'CREATE TABLE IF NOT EXISTS public.chat_generated_images (',
  'CREATE OR REPLACE FUNCTION public.enforce_chat_generated_image_contract_v1()',
);
check(
  /thread_id uuid REFERENCES public\.circle_chat_threads/.test(tableDefinition)
    && /source_message_id uuid REFERENCES public\.messages/.test(tableDefinition)
    && !/thread_id uuid NOT NULL/.test(tableDefinition)
    && !/source_message_id uuid NOT NULL/.test(tableDefinition),
  'migration keeps Chat lineage columns nullable for the isolated terminal scope',
);
check(
  tableDefinition.includes("generation_scope = 'chat'")
    && tableDefinition.includes('thread_id IS NOT NULL')
    && tableDefinition.includes('source_message_id IS NOT NULL')
    && tableDefinition.includes("generation_scope = 'terminal'")
    && tableDefinition.includes('thread_id IS NULL')
    && tableDefinition.includes('source_message_id IS NULL'),
  'scope constraint is null-safe for exact Chat versus terminal lineage',
);
const providerModelConstraint = sourceSection(
  tableDefinition,
  'CONSTRAINT chat_generated_images_provider_model_check_v1',
  'CONSTRAINT chat_generated_images_scope_lineage_check_v1',
);
const migrationProviderModelValues = [...providerModelConstraint.matchAll(/'([^']+)'/g)]
  .map((match) => match[1]);
check(
  sameSet(migrationProviderModelValues, [
    'openai',
    'gpt-image-2',
    'huggingface',
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-xl-base-1.0',
    'replicate',
    'black-forest-labs/flux-schnell',
    'black-forest-labs/flux-dev',
  ]),
  'database receipt allowlist matches the exact backend provider/model map',
  migrationProviderModelValues.join(', '),
);
check(
  tableDefinition.includes("status <> 'ready'")
    && tableDefinition.includes('provider_started_at IS NOT NULL')
    && tableDefinition.includes('size_bytes BETWEEN 1 AND 20971520')
    && tableDefinition.includes('width BETWEEN 1 AND 8192')
    && tableDefinition.includes('height BETWEEN 1 AND 8192')
    && tableDefinition.includes('width::bigint * height::bigint <= 40000000')
    && tableDefinition.includes("sha256 ~ '^[0-9a-f]{64}$'")
    && tableDefinition.includes("status <> 'outcome_unknown'"),
  'database requires bounded complete ready/unknown receipts after provider dispatch',
);

const dispatchAuthority = sourceSection(
  migration,
  'CREATE OR REPLACE FUNCTION public.chat_generated_image_requester_authorized_v1',
  'CREATE OR REPLACE FUNCTION public.enforce_chat_generated_image_contract_v1()',
);
const receiptTrigger = sourceSection(
  migration,
  'CREATE OR REPLACE FUNCTION public.enforce_chat_generated_image_contract_v1()',
  'CREATE OR REPLACE FUNCTION public.chat_generated_image_storage_path_matches_row_v1',
);
check(
  receiptTrigger.includes("NEW.status <> 'pending'")
    && receiptTrigger.includes('NEW.provider_started_at IS NOT NULL')
    && receiptTrigger.includes('new rows must begin as an unclaimed pending receipt'),
  'database reservations must begin pending and unclaimed',
);
check(
  receiptTrigger.includes('source_row.circle_id IS DISTINCT FROM NEW.circle_id')
    && receiptTrigger.includes('source_row.thread_id IS DISTINCT FROM NEW.thread_id')
    && receiptTrigger.includes('source_row.user_id IS DISTINCT FROM NEW.requested_by')
    && receiptTrigger.includes('COALESCE(source_row.is_bot, false)')
    && receiptTrigger.includes('source_thread_circle_id IS DISTINCT FROM NEW.circle_id'),
  'database independently enforces null-safe source, requester, and thread lineage',
);
check(
  dispatchAuthority.includes('FROM public.circle_members AS member')
    && dispatchAuthority.includes('FROM public.circle_chat_threads AS thread')
    && dispatchAuthority.includes('FROM public.circle_chat_thread_members AS thread_member')
    && (dispatchAuthority.match(/FOR KEY SHARE;/g) || []).length === 3
    && receiptTrigger.includes('OLD.provider_started_at IS NULL')
    && receiptTrigger.includes('NEW.provider_started_at IS NOT NULL')
    && receiptTrigger.includes("IF NEW.status <> 'pending' THEN")
    && receiptTrigger.includes('provider dispatch must be claimed before a terminal transition')
    && receiptTrigger.includes('chat_generated_image_requester_authorized_v1(')
    && receiptTrigger.includes('requester authority retired before provider dispatch'),
  'database locks and revalidates exact membership/thread visibility at the provider-dispatch claim',
);
for (const immutableField of [
  'id',
  'generation_scope',
  'circle_id',
  'thread_id',
  'source_message_id',
  'requested_by',
  'provider',
  'model',
  'requested_model',
  'prompt_sha256',
  'storage_path',
  'created_at',
]) {
  check(
    receiptTrigger.includes(`NEW.${immutableField} IS DISTINCT FROM OLD.${immutableField}`),
    `database makes receipt identity field ${immutableField} immutable`,
  );
}
check(
  receiptTrigger.includes("IF OLD.status <> 'pending' THEN")
    && receiptTrigger.includes('IF NEW IS DISTINCT FROM OLD THEN')
    && receiptTrigger.includes('terminal receipts are immutable')
    && receiptTrigger.includes('provider dispatch marker is immutable once set')
    && receiptTrigger.includes('provider request identity is immutable once set'),
  'terminal receipts and provider-dispatch identities are immutable',
);

const storagePathContract = sourceSection(
  migration,
  'CREATE OR REPLACE FUNCTION public.chat_generated_image_storage_path_matches_row_v1',
  'CREATE UNIQUE INDEX IF NOT EXISTS chat_generated_images_storage_path_unique_v1',
);
check(
  storagePathContract.includes("p_scope = 'chat'")
    && storagePathContract.includes("array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 5")
    && storagePathContract.includes("split_part(p_name, '/', 3) = p_source_message_id::text")
    && storagePathContract.includes("p_scope = 'terminal'")
    && storagePathContract.includes("array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4")
    && storagePathContract.includes("split_part(p_name, '/', 2) = '_terminal'"),
  'database validates exact extensionless Chat and terminal storage paths',
);
check(
  migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS chat_generated_images_source_message_unique_v1')
    && migration.includes('ON public.chat_generated_images(source_message_id)')
    && migration.includes("WHERE generation_scope = 'chat'"),
  'one database receipt is reserved per persisted Chat source message',
);
check(
  migration.includes('ALTER TABLE public.chat_generated_images ENABLE ROW LEVEL SECURITY;')
    && migration.includes('ALTER TABLE public.chat_generated_images FORCE ROW LEVEL SECURITY;')
    && migration.includes('REVOKE ALL ON TABLE public.chat_generated_images FROM PUBLIC, anon, authenticated;')
    && migration.includes('GRANT ALL ON TABLE public.chat_generated_images TO service_role;'),
  'receipt table is service-owned with RLS forced and client access revoked',
);
check(
  migration.includes('Hosted Supabase owns storage.objects through supabase_storage_admin')
    && !migration.includes('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'),
  'migration manages private-bucket policies without altering the platform-owned Storage table',
);
check(
  migration.includes("'chat-generated-images',\n  'chat-generated-images',\n  false,\n  20971520,")
    && migration.includes('public = false')
    && migration.includes('file_size_limit = 20971520')
    && migration.includes("allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]")
    && migration.includes('private bucket identity mismatch'),
  'migration creates only the identity-checked private 20 MB raster bucket',
);
for (const role of ['authenticated', 'anon']) {
  for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const roleOperationPattern = new RegExp(
      `AS RESTRICTIVE\\s+FOR ${operation}\\s+TO ${role}[\\s\\S]*?bucket_id <> 'chat-generated-images'`,
    );
    check(
      roleOperationPattern.test(migration),
      `${role} ${operation.toLowerCase()} remains restricted from the private bucket`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} generated Chat image backend assertion(s) failed.`);
  process.exit(1);
}

console.log('\nAll generated Chat image backend and migration assertions passed.');
