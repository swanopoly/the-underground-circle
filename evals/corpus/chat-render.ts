// chat-render corpus — a deterministic, model-free golden-case module for the
// CHAT-RENDER cores, extending the tier-1 regression net in `../coreGoldenCorpus`
// (docs strategic plan ADD #1: "an eval CI merge-gate … the safety net that makes
// every consolidation below safe"). It pins the exact OUTPUT of the three pure
// cores the chat bubble renders through — block segmentation, tappable-entity
// detection, and the pre-send input guard — on FIXED inputs, so CI catches ANY
// behavioral drift with NO API keys, NO network, and NO flakiness:
//
//   • markdownSegmentCore.segmentMarkdown / hasRenderableMarkdown — splits a
//     message into ordered block segments (fenced code w/ lang, ATX heading,
//     bullet, blockquote, coalesced text) and the cheap "is there anything to
//     segment?" pre-check.
//   • chatEntityLinkifyCore.detectChatEntities / splitByEntities — the span
//     detector that makes @file:/@symbol: mentions, file paths, and URLs
//     tappable, WITHOUT turning a social "@word" or a non-path slash-pair
//     ("and/or") into a false link.
//   • chatSendGuardCore.guardChatSend / looksLikeErrorDump — the send-box gate
//     that blocks only the genuinely-empty case, confirms huge pastes / error
//     dumps, and biases hard to send otherwise.
//
// A regression that dropped a code fence's language, linkified a plain "@word",
// or started silently blocking normal sends would flip a case here from
// pass→fail. Every golden below was CAPTURED from the real core output (never
// invented) via a throwaway tsx probe on 2026-07-15, then pinned.
//
// CONTRACT: matches `../coreGoldenCorpus` — each `CoreGoldenCase.run()` executes
// a real core fn on a FROZEN input and returns `true` iff the output equals the
// pinned golden. `run()` is self-contained + total (the local deep-equal never
// throws; the aggregator also catches any throw). Ids are globally-unique CI
// anchors, all prefixed `chat-render-`.
//
// PURITY EXCEPTION (as with the parent corpus): this file IMPORTS the cores at
// RUNTIME — that is the point, it exercises them. All three are dependency-light
// + tsx-loadable (smokes: markdown-segment-core / chat-entity-linkify-core /
// chat-send-guard-core), so this module loads under tsx with no react-native /
// supabase / deno in the graph.
//
// COPY-FIDELITY NOTE: pure-ASCII outputs are pinned by full deep-equality; the
// two verdict hints that carry an em dash (huge-paste / error-dump) are pinned by
// their ASCII machine `reason` + `action` plus copy-sensitive ASCII substrings of
// the hint, so a typographic copy slip can never mask a real regression.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { segmentMarkdown, hasRenderableMarkdown } from '../../src/lib/markdownSegmentCore';
import { detectChatEntities, splitByEntities } from '../../src/lib/chatEntityLinkifyCore';
import { guardChatSend, looksLikeErrorDump } from '../../src/lib/chatSendGuardCore';

// ─── Local total deep-equal (mirrors the exec-policy sibling's `deepEq`) ──────
// Arrays compared index-wise (segment/span/chunk order is semantic); object keys
// compared order-insensitively (a cosmetic key reorder must not flip a case);
// depth-bounded and total (never throws on a hostile/cyclic value → returns false).
function deepEq(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (a === b) return true;
  const ta = typeof a;
  if (ta !== typeof b) return false;
  if (a === null || b === null) return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!deepEq(ao[k], bo[k], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

export const CASES: CoreGoldenCase[] = [
  // ── suite: markdown-segment (segmentMarkdown / hasRenderableMarkdown) ────────
  {
    id: 'chat-render-md-fenced-code-block-lang',
    suite: 'markdown-segment',
    describe:
      'a fenced ```ts code block segments to ONE {kind:code} carrying the inner source and the lang tag (fences dropped)',
    run: () =>
      deepEq(segmentMarkdown('```ts\nconst x = 1;\n```'), [
        { kind: 'code', content: 'const x = 1;', lang: 'ts' },
      ]),
  },
  {
    id: 'chat-render-md-plain-text-single-segment',
    suite: 'markdown-segment',
    describe: 'plain prose with no markup coalesces into a single {kind:text} segment (verbatim content)',
    run: () =>
      deepEq(segmentMarkdown('just plain text here'), [{ kind: 'text', content: 'just plain text here' }]),
  },
  {
    id: 'chat-render-md-heading-level',
    suite: 'markdown-segment',
    describe: 'an ATX `# ` line becomes a {kind:heading, level:1} with the marker stripped from content',
    run: () => deepEq(segmentMarkdown('# Hello world'), [{ kind: 'heading', content: 'Hello world', level: 1 }]),
  },
  {
    id: 'chat-render-md-bullets-drop-markers',
    suite: 'markdown-segment',
    describe: 'each `- ` line becomes its own {kind:bullet} carrying only the item text (the marker is dropped)',
    run: () =>
      deepEq(segmentMarkdown('- item one\n- item two'), [
        { kind: 'bullet', content: 'item one' },
        { kind: 'bullet', content: 'item two' },
      ]),
  },
  {
    id: 'chat-render-md-quote-strips-marker',
    suite: 'markdown-segment',
    describe: 'a `> ` blockquote line becomes a {kind:quote} with the `>` cue removed from content',
    run: () => deepEq(segmentMarkdown('> quoted line'), [{ kind: 'quote', content: 'quoted line' }]),
  },
  {
    id: 'chat-render-md-empty-nonstring-total',
    suite: 'markdown-segment',
    describe: 'segmentMarkdown is total: empty string AND a non-string both yield [] (never throws)',
    run: () => deepEq(segmentMarkdown(''), []) && deepEq(segmentMarkdown(123 as unknown), []),
  },
  {
    id: 'chat-render-md-has-renderable-true',
    suite: 'markdown-segment',
    describe: 'hasRenderableMarkdown fires on a heading, a code fence, AND **bold** (there is block/inline markup to segment)',
    run: () =>
      hasRenderableMarkdown('# Heading') === true &&
      hasRenderableMarkdown('```ts\nx\n```') === true &&
      hasRenderableMarkdown('some **bold** text') === true,
  },
  {
    id: 'chat-render-md-has-renderable-false',
    suite: 'markdown-segment',
    describe: 'hasRenderableMarkdown is false on plain prose and total on empty/non-string (no wasted segmentation)',
    run: () =>
      hasRenderableMarkdown('plain text no markup') === false &&
      hasRenderableMarkdown('') === false &&
      hasRenderableMarkdown(42 as unknown) === false,
  },

  // ── suite: chat-entity-linkify (detectChatEntities / splitByEntities) ────────
  {
    id: 'chat-render-link-file-mention',
    suite: 'chat-entity-linkify',
    describe:
      '`@file:src/x.ts` is detected as ONE mention span at its exact offsets with target = the bare path (text.slice(start,end)===text)',
    run: () =>
      deepEq(detectChatEntities('see @file:src/x.ts for that'), [
        { kind: 'mention', text: '@file:src/x.ts', start: 4, end: 18, target: 'src/x.ts' },
      ]),
  },
  {
    id: 'chat-render-link-symbol-mention',
    suite: 'chat-entity-linkify',
    describe: '`@symbol:NAME` is detected as a mention span whose target is the bare symbol name',
    run: () =>
      deepEq(detectChatEntities('call @symbol:guardChatSend now'), [
        { kind: 'mention', text: '@symbol:guardChatSend', start: 5, end: 26, target: 'guardChatSend' },
      ]),
  },
  {
    id: 'chat-render-link-social-at-not-linkified',
    suite: 'chat-entity-linkify',
    describe:
      'LOAD-BEARING guard: a plain social `@everyone` (no file:/symbol: prefix) is NOT linkified — it yields zero spans',
    run: () => deepEq(detectChatEntities('hey @everyone look at this'), []),
  },
  {
    id: 'chat-render-link-plain-no-tokens',
    suite: 'chat-entity-linkify',
    describe: 'ordinary prose with no URL / path / mention / task-ref yields zero spans',
    run: () => deepEq(detectChatEntities('just a normal sentence with no entities'), []),
  },
  {
    id: 'chat-render-link-absolute-filepath',
    suite: 'chat-entity-linkify',
    describe: 'an absolute unix path `/Users/me/x.ts` is detected as one {kind:filepath} span with target = the path',
    run: () =>
      deepEq(detectChatEntities('open /Users/me/x.ts please'), [
        { kind: 'filepath', text: '/Users/me/x.ts', start: 5, end: 19, target: '/Users/me/x.ts' },
      ]),
  },
  {
    id: 'chat-render-link-url',
    suite: 'chat-entity-linkify',
    describe: 'an http(s) URL is detected as one {kind:url} span (trailing sentence punctuation excluded)',
    run: () =>
      deepEq(detectChatEntities('visit https://example.com/page now'), [
        { kind: 'url', text: 'https://example.com/page', start: 6, end: 30, target: 'https://example.com/page' },
      ]),
  },
  {
    id: 'chat-render-link-and-or-guard',
    suite: 'chat-entity-linkify',
    describe:
      'LOAD-BEARING guard: extension-less slash-pairs (`and/or`, `I/O`) are NOT mistaken for file paths — zero spans',
    run: () => deepEq(detectChatEntities('use and/or here, or I/O maybe'), []),
  },
  {
    id: 'chat-render-link-split-reconstruction',
    suite: 'chat-entity-linkify',
    describe:
      'splitByEntities returns alternating plain/entity chunks AND the concatenation of chunk texts reconstructs the original string',
    run: () => {
      const input = 'see @file:src/x.ts ok';
      const chunks = splitByEntities(input);
      const golden = [
        { text: 'see ', entity: null },
        {
          text: '@file:src/x.ts',
          entity: { kind: 'mention', text: '@file:src/x.ts', start: 4, end: 18, target: 'src/x.ts' },
        },
        { text: ' ok', entity: null },
      ];
      return deepEq(chunks, golden) && chunks.map((c) => c.text).join('') === input;
    },
  },

  // ── suite: chat-send-guard (guardChatSend / looksLikeErrorDump) ──────────────
  {
    id: 'chat-render-guard-empty-blocks',
    suite: 'chat-send-guard',
    describe: "an empty message with no attachment BLOCKs with the exact 'Type a message or attach a file.' hint",
    run: () =>
      deepEq(guardChatSend(''), {
        action: 'block',
        reason: 'empty-no-attachment',
        hint: 'Type a message or attach a file.',
      }),
  },
  {
    id: 'chat-render-guard-whitespace-only-blocks',
    suite: 'chat-send-guard',
    describe: 'a whitespace-only message (spaces/newline/tab) BLOCKs identically to empty (nothing to send)',
    run: () =>
      deepEq(guardChatSend('   \n\t  '), {
        action: 'block',
        reason: 'empty-no-attachment',
        hint: 'Type a message or attach a file.',
      }),
  },
  {
    id: 'chat-render-guard-normal-text-sends',
    suite: 'chat-send-guard',
    describe: 'ordinary text SENDs cleanly (action:send, reason:ok, empty hint) — the bias-hard-to-send default',
    run: () => deepEq(guardChatSend('hello world'), { action: 'send', reason: 'ok', hint: '' }),
  },
  {
    id: 'chat-render-guard-empty-with-attachment-sends',
    suite: 'chat-send-guard',
    describe:
      'LOAD-BEARING: empty text WITH an attachment SENDs (the attachment is the payload) — the empty-block is overridden',
    run: () =>
      deepEq(guardChatSend('', { hasAttachment: true }), {
        action: 'send',
        reason: 'empty-with-attachment',
        hint: '',
      }),
  },
  {
    id: 'chat-render-guard-nonstring-blocks',
    suite: 'chat-send-guard',
    describe: 'a non-string message is total-safe: treated as empty → BLOCK (empty-no-attachment), never throws',
    run: () =>
      deepEq(guardChatSend(123 as unknown), {
        action: 'block',
        reason: 'empty-no-attachment',
        hint: 'Type a message or attach a file.',
      }),
  },
  {
    id: 'chat-render-guard-huge-paste-confirms',
    suite: 'chat-send-guard',
    describe: 'a paste over the huge threshold CONFIRMs (reason:huge-paste) rather than blocking or silently sending',
    run: () => {
      const v = guardChatSend('x'.repeat(9000));
      return (
        v.action === 'confirm' &&
        v.reason === 'huge-paste' &&
        typeof v.hint === 'string' &&
        v.hint.includes('large paste') &&
        v.hint.includes('crowd the chat')
      );
    },
  },
  {
    id: 'chat-render-guard-error-dump-confirms',
    suite: 'chat-send-guard',
    describe: 'a pasted multi-frame stack trace CONFIRMs (reason:error-dump) with the offer-to-debug hint',
    run: () => {
      const v = guardChatSend('TypeError: boom\n    at foo (src/a.ts:10:5)\n    at bar (src/b.ts:20:1)');
      return (
        v.action === 'confirm' &&
        v.reason === 'error-dump' &&
        typeof v.hint === 'string' &&
        v.hint.startsWith('Looks like an error') &&
        v.hint.includes('debug it')
      );
    },
  },
  {
    id: 'chat-render-guard-looks-like-error-dump',
    suite: 'chat-send-guard',
    describe:
      'looksLikeErrorDump is true on a multi-frame trace but CONSERVATIVELY false on a lone "Error:" line (single line is conversation)',
    run: () =>
      looksLikeErrorDump('TypeError: boom\n    at foo (src/a.ts:10:5)\n    at bar (src/b.ts:20:1)') === true &&
      looksLikeErrorDump('Error: something went wrong') === false,
  },
];
