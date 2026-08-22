/**
 * Source-level wiring smoke for Chat's canonical generated-image lane.
 * Run: npx tsx scripts/chat-image-generation-routing-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
const commands = readFileSync('src/lib/huggingFaceChatCommands.ts', 'utf8');
const capabilities = readFileSync('src/lib/modelCapabilities.ts', 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source marker: ${end}`);
  return source.slice(from, to);
}

const persistedWrapper = between(
  chat,
  'const executePersistedChatImageCommand = async',
  '// Every attachment consumer shares one durability barrier.',
);
assert.ok(
  persistedWrapper.indexOf('await requirePersistedChatImageSource()')
    < persistedWrapper.indexOf('return await executeHfCommand('),
  'image provider dispatch happens only after the persisted source barrier',
);
for (const field of ['circleId', 'threadId: imageThreadId', 'sourceMessageId', 'requestedModel:', 'signal: controller.signal']) {
  assert.match(persistedWrapper, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
const persistenceFailure = between(
  chat,
  'const imagePersistenceFailureResult =',
  'const executePersistedChatImageCommand = async',
);
assert.match(
  persistenceFailure,
  /activeThreadScopeRef\.current\.circleId === circleId[\s\S]*activeThreadScopeRef\.current\.threadId === activeThreadId[\s\S]*setInput\(displayContent\)/,
  'late image-persistence failure restores the visible draft only in its original thread scope',
);
assert.match(
  persistenceFailure,
  /persistDraftForThread\(activeThreadId, displayContent\)/,
  'late image-persistence failure always saves the draft back to its original thread',
);

const catalogGate = between(chat, 'const plannerRequestsImageGeneration', '// Resolve a model only from one exact');
assert.match(catalogGate, /directImagineTurn/);
assert.match(catalogGate, /selectedImageModelPromptTurn/);
assert.match(catalogGate, /!canonicalImageGenerationTurn/);

const pickerLane = between(chat, 'if (selectedImageModelPromptTurn', "if (!lowerContent.startsWith('/'))");
assert.match(pickerLane, /executeDetectedConversationalIntent/);
assert.match(pickerLane, /type: 'generate_image', prompt: content/);
assert.match(pickerLane, /executeHfCommand: executePersistedChatImageCommand/);
assert.match(chat, /currentStagedFiles\.length > 0[\s\S]{0,800}Reference-image generation is not supported yet/);
assert.match(chat, /currentStagedFiles\.length > 0[\s\S]{0,900}No image provider was called/);

const directLane = between(chat, 'const hfPrefixes =', '// ─── GitHub commands');
assert.match(directLane, /isDirectImageCommand/);
assert.match(directLane, /executePersistedChatImageCommand\(content, commandContext\)/);
assert.match(chat, /requestSourceMessageId: result\.imageGeneration\?\.sourceMessageId/);
assert.match(chat, /effectiveModel: result\.imageGeneration\?\.model/);
assert.match(chat, /provider: result\.imageGeneration\?\.provider/);
const pendingRecord = between(chat, 'function buildPendingBotMessageRecord(', 'function saveRecoverableChatMessage(');
assert.match(pendingRecord, /artifacts: message\.artifacts\?\.map\(projectGeneratedChatImageArtifactForPersistence\)/);
assert.doesNotMatch(pendingRecord, /artifacts: message\.artifacts,/, 'pending recovery must not persist transient signed URLs');

const imagineHandler = between(commands, 'async function handleImagine(', 'async function handleVision(');
assert.match(commands, /lower === '\/imagine' \|\| lower\.startsWith\('\/imagine '\)/);
assert.match(imagineHandler, /import\('\.\/generatedChatImages'\)/);
assert.match(imagineHandler, /threadId: ctx\.threadId/);
assert.match(imagineHandler, /sourceMessageId: ctx\.sourceMessageId/);
assert.doesNotMatch(imagineHandler, /callHfProxy|data:image|createObjectURL/);

assert.doesNotMatch(capabilities, /api-inference\.huggingface\.co|URL\.createObjectURL|generateImageHF/);
assert.match(capabilities, /'gpt-image-2':\s+\['image_gen'\]/);
assert.match(chat, /id: 'gpt-image-2'.+connected OpenAI key/);
for (const id of ['flux-schnell', 'flux-dev', 'stable-diffusion-xl']) {
  assert.match(chat, new RegExp(`id: '${id}'`), `${id} remains an exact Creative picker choice`);
}
assert.match(chat, /modelId === 'flux-schnell'[\s\S]{0,180}providers: \['huggingface', 'replicate'\]/);
assert.match(chat, /modelId === 'flux-dev'[\s\S]{0,140}providers: \['replicate'\]/);
assert.match(chat, /modelId === 'stable-diffusion-xl'[\s\S]{0,160}providers: \['huggingface'\]/);
assert.match(
  chat,
  /imageProviderRequirements\.providers\.includes\(normalizeConnectedProviderKey\(group\.provider as string\)\)[\s\S]{0,80}group\.connected/,
  'every image-only picker is enabled only by an exact connected generator credential',
);

console.log('All canonical Chat image-generation routing smoke cases passed.');
