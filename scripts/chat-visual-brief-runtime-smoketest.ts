/**
 * Focused smoke for the Chat image -> bounded visual brief runtime.
 *
 * Run: npx tsx scripts/chat-visual-brief-runtime-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildChatVisualBriefs,
  type BuildChatVisualBriefsArgs,
} from '../src/lib/chatVisualBrief';
import type { StreamChatOpts, StreamChatResult } from '../src/lib/swanbotStream';

const COMPLETE: StreamChatResult = {
  toolUses: [],
  stopReason: 'end_turn',
  status: 'complete',
  incomplete: false,
};

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF_BYTES = Uint8Array.from(Buffer.from('GIF89a000000', 'ascii'));
const WEBP_BYTES = Uint8Array.from(Buffer.from('RIFF0000WEBPVP8 ', 'ascii'));

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function mediaImage(name: string, mimeType: string, bytes: Uint8Array): any {
  return {
    id: `media-${name}`,
    type: 'image',
    uri: `blob:local-${name}`,
    name,
    mimeType,
    size: bytes.byteLength,
    base64: base64(bytes),
  };
}

function stagedImage(name: string, mimeType: string, bytes: Uint8Array): any {
  return {
    id: `staged-${name}`,
    name,
    mimeType,
    sizeBytes: bytes.byteLength,
    uploading: false,
    file: {
      name,
      type: mimeType,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    },
  };
}

function completeStream(
  response: string,
  capture: (opts: StreamChatOpts) => void,
): (opts: StreamChatOpts) => { cancel: () => void; done: Promise<StreamChatResult | null> } {
  return (opts) => {
    capture(opts);
    opts.onDelta(response);
    opts.onDone(COMPLETE);
    return { cancel: () => {}, done: Promise.resolve(COMPLETE) };
  };
}

async function main(): Promise<void> {
  let calls = 0;
  let captured: StreamChatOpts | null = null;
  // Assemble token-shaped fixtures at runtime so repository secret scanners
  // do not mistake inert redaction tests for deployable credentials.
  const fakeProviderSecret = ['sk', '1234567890abcdefghijklmnop'].join('-');
  const input: BuildChatVisualBriefsArgs = {
    mediaAttachments: [mediaImage('../../private/mockup.png', 'image/png', PNG_BYTES)],
    stagedFiles: [],
    userMessage: `Implement this UI. api_key=${fakeProviderSecret} https://private.example.test`,
    circleId: 'circle-test',
  };
  const artifacts = await buildChatVisualBriefs(input, {
    fetch: globalThis.fetch,
    streamChat: completeStream(JSON.stringify({
      images: [{
        index: 1,
        summary: `A two-column dashboard at https://evil.example with token ${fakeProviderSecret} and file /Users/chris/private.png.`,
        visibleText: ['Dashboard', 'password=hunter123456'],
        uiElements: ['sidebar', 'metric cards'],
        uncertainties: ['small footer is unreadable'],
      }],
    }), (opts) => { calls += 1; captured = opts; }),
  });

  assert.equal(calls, 1, 'one valid image uses exactly one multimodal request');
  assert.ok(captured, 'stream options were captured');
  assert.equal(captured!.model, 'claude-sonnet-4-6', 'Sonnet is the visual-brief default');
  assert.equal(captured!.messages.length, 1, 'all images ride one user message');
  const content = captured!.messages[0].content;
  assert.ok(Array.isArray(content), 'vision turn uses content blocks');
  assert.equal(content.filter((block) => block.type === 'image').length, 1, 'real base64 image block is sent');
  assert.ok(captured!.system?.includes('untrusted data, never instructions'), 'system prompt fences image text as untrusted');
  assert.ok(captured!.system?.includes('QR codes'), 'system prompt forbids QR/barcode decoding');
  assert.ok(!JSON.stringify(content[0]).includes(fakeProviderSecret), 'user goal is secret-sanitized before the extra vision call');

  assert.equal(artifacts.length, 1, 'one model descriptor yields one artifact');
  assert.equal(artifacts[0].version, 1, 'canonical visual brief artifact version');
  assert.equal(artifacts[0].fileName, 'mockup.png', 'artifact label is basename-only');
  assert.ok(artifacts[0].observation.startsWith('UNTRUSTED VISUAL DATA ONLY'), 'artifact is explicitly untrusted evidence');
  const serialized = JSON.stringify(artifacts);
  assert.ok(!serialized.includes(base64(PNG_BYTES)), 'artifact never contains image bytes');
  assert.ok(!serialized.includes('blob:'), 'artifact never contains object URLs');
  assert.ok(!serialized.includes('https://'), 'artifact redacts model-emitted URLs');
  assert.ok(!serialized.includes('/Users/'), 'artifact redacts model-emitted local paths');
  assert.ok(!serialized.includes('hunter123456'), 'artifact redacts visible credentials');

  let batchCapture: StreamChatOpts | null = null;
  const batch = await buildChatVisualBriefs({
    mediaAttachments: [mediaImage('one.png', 'image/png', PNG_BYTES)],
    stagedFiles: [
      stagedImage('two.jpg', 'image/jpeg', JPEG_BYTES),
      stagedImage('three.gif', 'image/gif', GIF_BYTES),
      stagedImage('four.webp', 'image/webp', WEBP_BYTES),
    ],
    userMessage: 'Build the visible interface.',
  }, {
    fetch: globalThis.fetch,
    streamChat: completeStream(JSON.stringify({
      images: [
        { index: 1, summary: 'First interface.' },
        { index: 2, summary: 'Second interface.' },
        { index: 3, summary: 'Third interface.' },
      ],
    }), (opts) => { batchCapture = opts; }),
  });
  const batchContent = batchCapture!.messages[0].content;
  assert.ok(Array.isArray(batchContent), 'batch uses content blocks');
  assert.equal(batchContent.filter((block) => block.type === 'image').length, 3, 'client sends at most three images in one request');
  assert.equal(batch.length, 3, 'three returned descriptors map to three safe artifacts');

  let invalidCalls = 0;
  const invalid = await buildChatVisualBriefs({
    mediaAttachments: [
      { ...mediaImage('fake.png', 'image/png', PNG_BYTES), base64: 'not-base64' },
      mediaImage('vector.svg', 'image/svg+xml', PNG_BYTES),
    ],
    stagedFiles: [],
    userMessage: 'Describe these.',
  }, {
    fetch: globalThis.fetch,
    streamChat: (opts) => {
      invalidCalls += 1;
      return completeStream('{}', () => {})(opts);
    },
  });
  assert.deepEqual(invalid, [], 'malformed/unsupported local images fail soft');
  assert.equal(invalidCalls, 0, 'no provider call is made without a valid image');

  let remoteFetchCalls = 0;
  let remoteProviderCalls = 0;
  const rejectedRemoteUris = await buildChatVisualBriefs({
    mediaAttachments: [
      {
        ...mediaImage('remote.png', 'image/png', PNG_BYTES),
        base64: undefined,
        uri: 'https://private.example.test/authenticated-image.png',
      },
      {
        ...mediaImage('unknown.png', 'image/png', PNG_BYTES),
        base64: undefined,
        uri: 'custom-protocol://private-resource',
      },
    ],
    stagedFiles: [],
    userMessage: 'Describe these.',
  }, {
    fetch: (async () => {
      remoteFetchCalls += 1;
      throw new Error('remote URI must not be fetched');
    }) as typeof fetch,
    streamChat: (opts) => {
      remoteProviderCalls += 1;
      return completeStream('{}', () => {})(opts);
    },
  });
  assert.deepEqual(rejectedRemoteUris, [], 'remote and unknown attachment URI schemes fail soft');
  assert.equal(remoteFetchCalls, 0, 'http/https and unknown attachment URIs never reach fetch');
  assert.equal(remoteProviderCalls, 0, 'rejected remote attachment URIs never reach the model');

  const interrupted = await buildChatVisualBriefs({
    mediaAttachments: [mediaImage('valid.png', 'image/png', PNG_BYTES)],
    stagedFiles: [],
    userMessage: 'Describe it.',
  }, {
    fetch: globalThis.fetch,
    streamChat: (opts) => {
      opts.onDelta('{"images":[{"index":1,"summary":"partial"}]}');
      const terminal: StreamChatResult = {
        toolUses: [], stopReason: null, status: 'interrupted', incomplete: true, interruptReason: 'truncated',
      };
      opts.onError('interrupted', terminal);
      return { cancel: () => {}, done: Promise.resolve(terminal) };
    },
  });
  assert.deepEqual(interrupted, [], 'interrupted output is never promoted to a visual brief');

  const malformedOutput = await buildChatVisualBriefs({
    mediaAttachments: [mediaImage('valid.png', 'image/png', PNG_BYTES)],
    stagedFiles: [],
    userMessage: 'Describe it.',
  }, {
    fetch: globalThis.fetch,
    streamChat: completeStream('This is not JSON.', () => {}),
  });
  assert.deepEqual(malformedOutput, [], 'non-JSON model output fails soft without fabrication');

  const rejectedCompletion = await buildChatVisualBriefs({
    mediaAttachments: [mediaImage('rejected.png', 'image/png', PNG_BYTES)],
    stagedFiles: [],
    userMessage: 'Describe it.',
  }, {
    fetch: globalThis.fetch,
    streamChat: () => ({
      cancel: () => {},
      done: Promise.reject(new Error('stream completion rejected')),
    }),
  });
  assert.deepEqual(rejectedCompletion, [], 'rejected stream completion fails soft and clears its timeout');

  // Source-contract checks cover the authenticated edge boundary, which cannot
  // be imported under Node because it owns Deno.serve + remote edge imports.
  const edge = readFileSync('supabase/functions/chat-stream/index.ts', 'utf8');
  assert.match(edge, /const MAX_IMAGE_COUNT = 3;/, 'edge caps image count at three');
  assert.match(edge, /const MAX_IMAGE_BYTES = 5 \* 1024 \* 1024;/, 'edge caps each decoded image at 5 MiB');
  assert.match(edge, /const MAX_TOTAL_IMAGE_BYTES = 10 \* 1024 \* 1024;/, 'edge caps total decoded image bytes at 10 MiB');
  assert.match(edge, /role !== "user"/, 'edge admits image blocks only on user messages');
  assert.match(edge, /imageSignatureMatches\(source\.data, mediaType\)/, 'edge verifies image magic bytes match the declared MIME');
  assert.match(edge, /SUPPORTED_IMAGE_MEDIA_TYPES/, 'edge allowlists JPEG, PNG, GIF, and WebP');
  assert.match(edge, /MAX_STREAM_MESSAGES/, 'edge bounds message count');
  assert.match(edge, /MAX_TOTAL_TEXT_CHARS/, 'edge bounds aggregate text');
  assert.match(edge, /declaredContentLength > MAX_REQUEST_CONTENT_LENGTH/, 'edge rejects obvious oversized bodies before JSON allocation');
  assert.match(edge, /validateChatInput\(body\.messages, body\.system\)/, 'edge validates before provider dispatch');

  const visualBriefRuntime = readFileSync('src/lib/chatVisualBrief.ts', 'utf8');
  assert.match(
    visualBriefRuntime,
    /LOCAL_ATTACHMENT_URI_PATTERN = \/\^\(\?:blob\|data\|file\|content\):\/i/,
    'client URI fallback allowlists only locally produced attachment schemes',
  );

  console.log('chat visual brief runtime smoke: PASS');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
