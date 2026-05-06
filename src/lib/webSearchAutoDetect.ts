/**
 * webSearchAutoDetect — pure heuristic that decides whether a chat
 * message should auto-attach OpenRouter web search even when the
 * user hasn't toggled it on. Triggered per-turn from the chat send
 * path, never changes the persistent toggle state.
 *
 * Design rules:
 *   - Bias toward NOT triggering. False positives cost cents per
 *     turn and add 2-5s latency; users notice and complain. False
 *     negatives are easy to recover from (the user notices, toggles
 *     manually).
 *   - Strong positive markers must beat strong negative markers.
 *     A code question that mentions "today" should NOT trigger;
 *     a question about today's news SHOULD.
 *   - Pure function, no I/O. Smoke-testable without mocks.
 *   - Returns `reason` so the bot reply can show "auto-enabled web
 *     search because: looks like a current-events question". Hides
 *     surprise — users learn what triggered the override.
 */

export interface WebSearchAutoDetectResult {
  /** True when the message would benefit from web search. */
  auto: boolean;
  /** Plain-English reason — surfaced in the bot footer when auto
   *  triggers, so users see the heuristic's call. */
  reason?: string;
  /** Score / inspection breakdown for debugging + smoke tests. */
  debug?: { positiveHits: string[]; negativeHits: string[]; score: number };
}

// Strong positive patterns — current state of the world questions.
// Each pattern's [marker, label] tuple lets the heuristic surface a
// human-readable reason instead of "regex matched".
const POSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(latest|newest|current(ly)?|right\s+now|as\s+of)\b/i, 'asks about current state'],
  [/\b(today|tonight|tomorrow|yesterday|this\s+(week|month|year|morning|afternoon|evening))\b/i, 'time-anchored to now'],
  [/\b(news|announc(e|ed|ement|ements|ing)|releas(e|ed|es|ing)|ship(ped|ping|s)|launch(ed|ing|es)?)\b/i, 'asks about recent events / releases'],
  [/\b(price|cost|stock|crypto|exchange\s+rate|interest\s+rate|tariff|ticker)\b/i, 'asks about market / price data'],
  [/\b(weather|forecast|temperature|rain|snow|storm|hurricane)\b/i, 'asks about weather'],
  [/\b(who\s+(is|won|leads?|runs|owns|founded)|who(['']s|\s+is)\s+the\s+(ceo|cto|president|pm|prime\s+minister))\b/i, 'asks about a real person / role'],
  [/\b(what(['']s|\s+is)\s+happening|what\s+just\s+happened|breaking)\b/i, 'asks what is happening'],
  [/\b(version|changelog|deprecat(ed|ion)|EOL|end\s+of\s+life)\b/i, 'asks about software version state'],
  [/\b20(2[5-9]|[3-9]\d)\b/, 'mentions a year >= 2025'],   // current-or-future year
  [/\b(google|search|look\s+up|find\s+out|search\s+the\s+web|browse|fetch)\b\s+(?!for\s+(a|an)\b)/i, 'explicit search verb'],
  [/https?:\/\/\S+/i, 'mentions a URL — likely wants info from it'],
  [/\b(score|game|match|standings?|playoffs?|tournament)\b/i, 'asks about a live sports event'],
  [/\b(election|poll|vote|race)\b/i, 'asks about elections / polls'],
];

// Strong negative patterns — code / abstract reasoning where web
// search adds noise, not signal. When a negative pattern fires it
// veto-cancels weak positives (e.g. "today" inside a code question).
const NEGATIVE_PATTERNS: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/, 'contains a code block'],
  [/`[^`]+`/, 'contains inline code'],
  [/\b(function|class|method|interface|const|var|let|import|export|return|async|await)\b/i, 'code keywords'],
  [/\b(refactor|debug|implement|build\s+a|write\s+a|create\s+a)\b/i, 'asks for code authoring'],
  [/\b(explain\s+(how|what|why)|what\s+is\s+the\s+difference|how\s+does\s+\w+\s+work)\b/i, 'asks for an explanation of a stable concept'],
  [/\b(format|parse|convert)\s+(date|time|json|xml|csv)\b/i, 'data-format question (stable)'],
  // "the XX of YYYY" / "born in 1992" — historical, doesn't need web.
  [/\b(born|died|founded|established)\s+in\s+\d{4}\b/i, 'asks about a historical fact'],
];

// Heuristic threshold. With strong positive + no negative we attach.
// With weak positive + strong negative we don't. The score is
// computed as POS - 2*NEG so a single negative pattern overrides
// almost any positive evidence.
const POSITIVE_WEIGHT = 1;
const NEGATIVE_WEIGHT = 2;
const TRIGGER_THRESHOLD = 1;

export function shouldAutoAttachWebSearch(rawMessage: string): WebSearchAutoDetectResult {
  const message = String(rawMessage || '').trim();
  if (!message || message.length < 3) {
    return { auto: false, debug: { positiveHits: [], negativeHits: [], score: 0 } };
  }

  const positiveHits: string[] = [];
  for (const [re, label] of POSITIVE_PATTERNS) {
    if (re.test(message)) positiveHits.push(label);
  }
  const negativeHits: string[] = [];
  for (const [re, label] of NEGATIVE_PATTERNS) {
    if (re.test(message)) negativeHits.push(label);
  }

  const score = (positiveHits.length * POSITIVE_WEIGHT) - (negativeHits.length * NEGATIVE_WEIGHT);
  const debug = { positiveHits, negativeHits, score };

  if (score >= TRIGGER_THRESHOLD) {
    // Surface the strongest positive signal (first match) as the
    // user-visible reason. More terse than listing every match.
    return {
      auto: true,
      reason: positiveHits[0] || 'looks current-events related',
      debug,
    };
  }
  return { auto: false, debug };
}

/**
 * Convenience — called by the chat composer after sending. Used to
 * decide whether to attach web search for THIS turn even when the
 * persistent toggle is off. Honors the toggle: if it's already on,
 * the caller already attaches search; if it's off, this helper
 * decides whether to override for one message.
 */
export function decideWebSearchForTurn(
  message: string,
  persistentToggleOn: boolean,
): { attach: boolean; auto: boolean; reason?: string } {
  if (persistentToggleOn) {
    return { attach: true, auto: false };
  }
  const result = shouldAutoAttachWebSearch(message);
  return { attach: result.auto, auto: result.auto, reason: result.reason };
}
