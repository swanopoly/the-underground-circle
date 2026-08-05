/**
 * Smoke: P21 image side channel + image economics in the typed agent loop.
 *
 *   npm run smoke:agent-image-economics
 *
 * Pins the three-seam protocol end to end:
 *   PRODUCER  — extractToolResultImageSideChannel (bridge seam): large base64
 *               → data.image + omission marker in the raw copy.
 *   CONSUMER  — runAgent/dispatchOne: data.image → REAL Anthropic image block;
 *               the text envelope NEVER contains a base64 payload.
 *   ECONOMICS — pruneStaleToolResultImages keeps the MAX_LIVE_IMAGES newest
 *               images; older ones become placeholder text; checkpoint
 *               snapshots keep their originals (replace-not-mutate contract).
 *   COMPRESSION — image blocks count a fixed token estimate and are replaced
 *               by markers before summarisation.
 */
import {
  runAgent,
  extractToolResultImageSideChannel,
  readToolResultImageSideChannel,
  stripBase64Payloads,
  pruneStaleToolResultImages,
  binaryOmittedMarker,
  normalizeImageMediaType,
  MAX_LIVE_IMAGES,
  BINARY_SIDE_CHANNEL_MIN_CHARS,
  type AgentMessage,
  type AgentMessageContentBlock,
  type AgentProvider,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';
import {
  PRUNED_IMAGE_PLACEHOLDER_TEXT,
  IMAGE_BLOCK_TOKEN_ESTIMATE,
  replaceToolResultImageBlocksWithMarkers,
} from '../src/lib/agentContextCompression';

let passed = 0;
function assert(cond: unknown, msg: string, detail?: unknown) {
  if (!cond) {
    console.error(`FAIL: ${msg}${detail !== undefined ? `\n  detail: ${JSON.stringify(detail)?.slice(0, 400)}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`pass: ${msg}`);
}

const FAKE_BASE64 = 'iVBORw0KGgo' + 'A'.repeat(4000); // > threshold, recognizable

function scriptedProvider(turns: ProviderTurnResult[]): AgentProvider {
  let i = 0;
  return {
    async turn() {
      if (i >= turns.length) throw new Error(`out of scripted turns at ${i}`);
      return turns[i++];
    },
  };
}

(async () => {
  // ── 1. Producer seam ───────────────────────────────────────────────────────
  {
    const raw = { ok: true, resultsText: 'Captured screenshot (240 KB PNG).', base64: FAKE_BASE64, mimeType: 'image/png', sizeBytes: 245760 };
    const side = extractToolResultImageSideChannel(raw);
    assert(!!side, 'producer: large base64 extracted');
    assert(side!.image.base64 === FAKE_BASE64, 'producer: payload carried intact');
    assert(side!.image.mimeType === 'image/png', 'producer: mimeType kept');
    assert(side!.sanitizedRaw.base64 === binaryOmittedMarker(FAKE_BASE64.length), 'producer: raw copy carries omission marker');
    assert((side!.sanitizedRaw.resultsText as string).includes('Captured'), 'producer: other fields survive');
    assert((raw as any).base64 === FAKE_BASE64, 'producer: original result untouched (shallow copy)');

    assert(extractToolResultImageSideChannel({ base64: 'short' }) === null, 'producer: small base64 stays inline');
    assert(extractToolResultImageSideChannel({ base64: 'x'.repeat(BINARY_SIDE_CHANNEL_MIN_CHARS) }) === null, 'producer: at-threshold stays inline');
    assert(extractToolResultImageSideChannel(null) === null, 'producer: null safe');
    assert(extractToolResultImageSideChannel('str') === null, 'producer: primitive safe');
    const weird = extractToolResultImageSideChannel({ base64: FAKE_BASE64, mimeType: 'application/pdf' });
    assert(weird!.image.mimeType === 'image/png', 'producer: unsupported media type normalizes to png');
    assert(normalizeImageMediaType('image/webp') === 'image/webp', 'producer: webp accepted');
  }

  // ── 2. Consumer read ───────────────────────────────────────────────────────
  {
    assert(readToolResultImageSideChannel({ image: { base64: 'abc', mimeType: 'image/jpeg' } })?.mimeType === 'image/jpeg', 'reader: happy path');
    assert(readToolResultImageSideChannel({ image: { base64: '' } }) === null, 'reader: empty base64 rejected');
    assert(readToolResultImageSideChannel({}) === null, 'reader: absent image null');
    assert(readToolResultImageSideChannel(undefined) === null, 'reader: undefined safe');
  }

  // ── 3. Deep scrub ──────────────────────────────────────────────────────────
  {
    const nested = { a: { b: { base64: FAKE_BASE64 } }, list: [{ base64: FAKE_BASE64 }], keep: 'ok' };
    const scrubbed = stripBase64Payloads(nested) as any;
    assert(scrubbed.a.b.base64 === binaryOmittedMarker(FAKE_BASE64.length), 'scrub: nested payload replaced');
    assert(scrubbed.list[0].base64 === binaryOmittedMarker(FAKE_BASE64.length), 'scrub: array payload replaced');
    assert(scrubbed.keep === 'ok', 'scrub: other fields survive');
    assert(!JSON.stringify(scrubbed).includes('AAAA'), 'scrub: no payload bytes remain');
    const cyc: any = { base64: FAKE_BASE64 };
    cyc.self = cyc;
    const scrubbedCyc = stripBase64Payloads(cyc) as any;
    assert(scrubbedCyc.self === '[omitted: circular]', 'scrub: cycles fail closed');
  }

  // ── 4. End-to-end: tool returns base64 → model sees an image block ────────
  {
    const toolTurn: ProviderTurnResult = {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'taking a look' },
        { type: 'tool_use', id: 'tu_img', name: 'screenshot', input: {} },
      ],
    } as any;
    const endTurn: ProviderTurnResult = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] } as any;

    const capturedRequests: AgentMessage[][] = [];
    const scripted = scriptedProvider([toolTurn, endTurn]);
    const provider: AgentProvider = {
      async turn(args) {
        capturedRequests.push(JSON.parse(JSON.stringify(args.messages)));
        return scripted.turn(args as any);
      },
    };

    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'look at my screen' }],
      tools: [{
        name: 'screenshot',
        description: 'capture',
        input_schema: { type: 'object', properties: {} },
        handler: async () => {
          // Simulate the bridge PRODUCER seam output shape exactly.
          const raw = { ok: true, resultsText: 'Captured screenshot.', base64: FAKE_BASE64, mimeType: 'image/png' };
          const side = extractToolResultImageSideChannel(raw)!;
          return { ok: true, data: { raw: side.sanitizedRaw, image: side.image, text: 'Captured screenshot.' } };
        },
      }],
      provider,
      maxIterations: 4,
    });

    assert(result.stopReason === 'end_turn', 'e2e: run completed');
    // The tool_result message the SECOND provider turn saw:
    const secondTurnMessages = capturedRequests[1];
    const toolResultMsg = secondTurnMessages[secondTurnMessages.length - 1];
    assert(Array.isArray(toolResultMsg.content), 'e2e: tool result message has block content');
    const trBlock = (toolResultMsg.content as AgentMessageContentBlock[]).find((b) => b.type === 'tool_result') as any;
    assert(!!trBlock, 'e2e: tool_result block present');
    assert(Array.isArray(trBlock.content), 'e2e: tool_result content is a part array');
    const parts = trBlock.content as any[];
    const textPart = parts.find((p) => p.type === 'text');
    const imagePart = parts.find((p) => p.type === 'image');
    assert(!!textPart && !!imagePart, 'e2e: both text and image parts present');
    assert(imagePart.source?.type === 'base64', 'e2e: image source type exact');
    assert(imagePart.source?.media_type === 'image/png', 'e2e: media_type exact');
    assert(imagePart.source?.data === FAKE_BASE64, 'e2e: model receives the real pixels');
    assert(!textPart.text.includes('AAAA'), 'e2e: text envelope contains NO base64 payload');
    assert(textPart.text.includes(binaryOmittedMarker(FAKE_BASE64.length)), 'e2e: text envelope carries the omission marker');
    assert(!textPart.text.includes('"image"'), 'e2e: image side channel stripped from text envelope');
  }

  // ── 5. Non-image tools keep the legacy string shape (regression) ──────────
  {
    const toolTurn: ProviderTurnResult = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_plain', name: 'plain', input: {} }],
    } as any;
    const endTurn: ProviderTurnResult = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } as any;
    const captured: AgentMessage[][] = [];
    const scripted = scriptedProvider([toolTurn, endTurn]);
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [{
        name: 'plain',
        description: 'no image',
        input_schema: { type: 'object', properties: {} },
        handler: async () => ({ ok: true, data: { raw: { ok: true, resultsText: 'plain result' } } }),
      }],
      provider: {
        async turn(args) {
          captured.push(JSON.parse(JSON.stringify(args.messages)));
          return scripted.turn(args as any);
        },
      },
      maxIterations: 4,
    });
    assert(result.stopReason === 'end_turn', 'regression: plain run completed');
    const trBlock = (captured[1][captured[1].length - 1].content as any[]).find((b) => b.type === 'tool_result');
    assert(typeof trBlock.content === 'string', 'regression: non-image tool_result stays a plain string');
    assert(trBlock.content.includes('plain result'), 'regression: payload intact');
  }

  // ── 6. Pruning policy ──────────────────────────────────────────────────────
  {
    const img = (n: number): AgentMessageContentBlock => ({
      type: 'tool_result',
      tool_use_id: `tu_${n}`,
      content: [
        { type: 'text', text: `capture ${n}` },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: `payload${n}` } },
      ],
    } as any);
    const messages: AgentMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'user', content: [img(1)] },
      { role: 'user', content: [img(2)] },
      { role: 'user', content: [img(3)] },
      { role: 'user', content: [img(4)] },
    ];
    const checkpointSnapshot = [...messages]; // shallow copy, shares message objects
    const pruned = pruneStaleToolResultImages(messages, MAX_LIVE_IMAGES);
    assert(pruned === 2, `prune: exactly ${4 - MAX_LIVE_IMAGES} pruned`, pruned);
    const partsOf = (m: AgentMessage) => ((m.content as any[])[0].content as any[]);
    assert(partsOf(messages[1])[1].type === 'text' && partsOf(messages[1])[1].text === PRUNED_IMAGE_PLACEHOLDER_TEXT, 'prune: oldest replaced by placeholder');
    assert(partsOf(messages[2])[1].type === 'text', 'prune: second-oldest replaced');
    assert(partsOf(messages[3])[1].type === 'image', 'prune: newest-1 kept');
    assert(partsOf(messages[4])[1].type === 'image', 'prune: newest kept');
    // Replace-not-mutate: the checkpoint's shared objects keep their images.
    assert(partsOf(checkpointSnapshot[1])[1].type === 'image', 'prune: checkpoint snapshot keeps original image (replace-not-mutate)');
    assert(pruneStaleToolResultImages(messages, MAX_LIVE_IMAGES) === 0, 'prune: idempotent second pass');
    // Degenerates
    assert(pruneStaleToolResultImages([], 2) === 0, 'prune: empty history safe');
    assert(pruneStaleToolResultImages([{ role: 'user', content: 'plain' }], 2) === 0, 'prune: string content safe');
  }

  // ── 7. Compression handles image blocks ────────────────────────────────────
  {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tu_c',
          content: [
            { type: 'text', text: 'cap' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PAYLOAD_C' } },
          ],
        } as any],
      },
    ];
    const replaced = replaceToolResultImageBlocksWithMarkers(messages);
    const parts = ((replaced[0].content as any[])[0].content as any[]);
    assert(parts[1].type === 'text' && parts[1].text === PRUNED_IMAGE_PLACEHOLDER_TEXT, 'compression: image → marker before summarisation');
    assert(!JSON.stringify(replaced).includes('PAYLOAD_C'), 'compression: no payload survives marker replacement');
    // Originals untouched
    assert(((messages[0].content as any[])[0].content as any[])[1].type === 'image', 'compression: source messages untouched');
    assert(IMAGE_BLOCK_TOKEN_ESTIMATE >= 500 && IMAGE_BLOCK_TOKEN_ESTIMATE <= 2000, 'compression: image token estimate in sane range');
  }

  console.log(`\nAll agent image economics smoke cases passed (${passed} assertions).`);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
