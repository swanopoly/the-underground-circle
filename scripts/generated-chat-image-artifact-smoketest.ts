/**
 * Durable generated Chat image client/artifact contract.
 *
 * Run: npm run smoke:generated-chat-images
 */

import { readFileSync } from 'node:fs';
import {
  GENERATED_CHAT_IMAGE_SOURCE,
  isGeneratedChatImageArtifact,
  projectGeneratedChatImageArtifactForPersistence,
  readFreshGeneratedChatImageUrl,
  readGeneratedChatImageMetadata,
} from '../src/lib/generatedChatImageArtifactCore';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';
import type { SwanBotStructuredArtifact } from '../src/lib/swanbot';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

const nowMs = Date.parse('2026-08-20T12:00:00.000Z');
const supabaseUrl = 'https://project-ref.supabase.co';
const circleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const imageId = '11111111-1111-4111-8111-111111111111';
const signedUrl = `${supabaseUrl}/storage/v1/object/sign/chat-generated-images/${circleId}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc/dddddddd-dddd-4ddd-8ddd-dddddddddddd/${imageId}.png?token=signed-token`;
const durableMetadata = {
  source: GENERATED_CHAT_IMAGE_SOURCE,
  generatedImageId: imageId,
  provider: 'openai',
  model: 'gpt-image-2',
  requestedModel: 'openai/gpt-5.6-sol',
  mimeType: 'image/png',
  sha256: 'a'.repeat(64),
};
const optimisticArtifact: SwanBotStructuredArtifact = {
  kind: 'image',
  title: 'A quiet neon workspace',
  content: null,
  url: signedUrl,
  metadata: {
    ...durableMetadata,
    expiresAt: '2026-08-20T12:05:00.000Z',
    storagePath: 'must-not-persist',
  },
};

assert(isGeneratedChatImageArtifact(optimisticArtifact), 'generated image lane is recognized by its opaque-id metadata');
assert(
  readFreshGeneratedChatImageUrl(optimisticArtifact, { nowMs, supabaseUrl, circleId }) === signedUrl,
  'fresh same-project private-bucket signed URL can render optimistically',
);
assert(
  readFreshGeneratedChatImageUrl(optimisticArtifact, {
    nowMs,
    supabaseUrl,
    circleId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  }) === null,
  'optimistic signed URL cannot cross the current circle scope',
);
assert(
  readFreshGeneratedChatImageUrl({ ...optimisticArtifact, url: 'https://tracker.invalid/pixel.png' }, { nowMs, supabaseUrl }) === null,
  'forged external tracker URL is never rendered in the generated-image lane',
);
assert(
  readFreshGeneratedChatImageUrl({ ...optimisticArtifact, url: 'data:image/png;base64,AAAA' }, { nowMs, supabaseUrl }) === null,
  'data URL is never trusted as a generated-image fast path',
);
assert(
  readFreshGeneratedChatImageUrl({ ...optimisticArtifact, url: 'blob:https://project-ref.supabase.co/opaque' }, { nowMs, supabaseUrl }) === null,
  'blob URL is never trusted as a generated-image fast path',
);
assert(
  readFreshGeneratedChatImageUrl({
    ...optimisticArtifact,
    metadata: { ...optimisticArtifact.metadata, expiresAt: '2026-08-20T12:00:20.000Z' },
  }, { nowMs, supabaseUrl }) === null,
  'expired or near-expiry signed URL is refreshed instead of rendered',
);
assert(
  readFreshGeneratedChatImageUrl({
    ...optimisticArtifact,
    url: signedUrl.replace('/chat-generated-images/', '/chat-attachments/'),
  }, { nowMs, supabaseUrl }) === null,
  'a signed URL for another private bucket is not accepted',
);

const projected = projectGeneratedChatImageArtifactForPersistence(optimisticArtifact);
const projectedMetadata = readGeneratedChatImageMetadata(projected);
assert(projected.url == null && projected.content == null, 'persistence projection strips transient image URL and content');
assert(projectedMetadata?.generatedImageId === imageId, 'persistence projection retains the opaque image id');
assert(projectedMetadata?.provider === 'openai' && projectedMetadata.model === 'gpt-image-2', 'actual generator provenance round-trips');
assert(projectedMetadata?.requestedModel === 'openai/gpt-5.6-sol', 'requested model remains audit metadata');
assert(!Object.prototype.hasOwnProperty.call(projected.metadata || {}, 'expiresAt'), 'signed URL expiry is transient only');
assert(!Object.prototype.hasOwnProperty.call(projected.metadata || {}, 'storagePath'), 'private storage path is never message metadata');

const legacyImage: SwanBotStructuredArtifact = {
  kind: 'image',
  title: 'Legacy inline proof',
  url: 'data:image/png;base64,AAAA',
  metadata: { source: 'browser_proof' },
};
assert(
  projectGeneratedChatImageArtifactForPersistence(legacyImage) === legacyImage,
  'non-generated image artifacts preserve their existing rendering/persistence behavior',
);

const urlVariants = [
  signedUrl,
  'data:image/png;base64,' + 'A'.repeat(20_000),
  'blob:https://project-ref.supabase.co/transient-object',
];
const formatted = formatPersistedChatBotMessage('OpenSwan', 'Here is your generated image.', {
  artifacts: urlVariants.map((url, index) => ({
    ...optimisticArtifact,
    url,
    metadata: {
      ...optimisticArtifact.metadata,
      generatedImageId: `${index + 1}1111111-1111-4111-8111-111111111111`,
    },
  })),
});
const roundTrip = readPersistedChatBotMetadata(formatted);
assert(formatted.length <= 9_000, 'generated-image message stays within the persisted Chat cap');
assert(!formatted.includes(signedUrl), 'signed URL is absent from canonical message content');
assert(!formatted.includes('data:image/'), 'base64 data URL is absent from canonical message content');
assert(!formatted.includes('blob:'), 'blob URL is absent from canonical message content');
assert(roundTrip?.artifacts?.length === 3, 'all bounded opaque image references round-trip after reload');
assert(
  roundTrip?.artifacts?.every((artifact) => artifact.url == null && Boolean(readGeneratedChatImageMetadata(artifact))),
  'reloaded artifacts contain valid opaque references and no render URL',
);

const malformedGenerated = projectGeneratedChatImageArtifactForPersistence({
  kind: 'image',
  title: 'Forged generated image',
  url: 'https://tracker.invalid/pixel.png',
  metadata: {
    source: GENERATED_CHAT_IMAGE_SOURCE,
    generatedImageId: '../../foreign-object',
    provider: 'openai',
    model: 'gpt-image-2',
    mimeType: 'image/svg+xml',
    sha256: 'not-a-digest',
  },
});
assert(malformedGenerated.url == null, 'malformed generated reference still loses its attacker-controlled URL');
assert(readGeneratedChatImageMetadata(malformedGenerated) == null, 'malformed id/MIME/digest cannot become a signing request');

const coreSource = readFileSync('src/lib/generatedChatImageArtifactCore.ts', 'utf8');
const clientSource = readFileSync('src/lib/generatedChatImages.ts', 'utf8');
const rendererSource = readFileSync('src/components/chat/ChatArtifacts.tsx', 'utf8');
assert(!coreSource.includes("from 'react-native'"), 'pure persistence artifact core has no React Native dependency');
assert(clientSource.includes("isStrictLocalAiModeEnabled()"), 'generation client enforces strict-local privacy mode');
assert(clientSource.includes("getFreshAccessToken"), 'generation/sign client captures a fresh bearer before exact invocation');
assert(clientSource.includes("action: 'generate'") && clientSource.includes("action: 'sign'"), 'client uses the reviewed generate/sign Edge contract');
assert(rendererSource.includes('onError={handleImageError}'), 'renderer refreshes a failed signed image URL');
assert(
  rendererSource.includes('automaticRefreshScopeRef.current !== scopeKey'),
  'renderer bounds automatic failed-image re-signing to one attempt per image scope',
);
assert(rendererSource.includes('accessibilityLiveRegion="polite"'), 'renderer announces loading and error state accessibly');
assert(rendererSource.includes('styles.imageActionButton'), 'retry/full-size actions use the 44px image action target');
assert(!rendererSource.includes('document.write('), 'image preview never writes untrusted HTML into a new tab');

if (failures > 0) {
  console.error(`\n${failures} generated Chat image artifact assertion(s) failed.`);
  process.exit(1);
}

console.log('\nAll generated Chat image artifact assertions passed.');
