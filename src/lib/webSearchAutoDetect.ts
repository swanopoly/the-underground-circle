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

export interface OptionalWebSearchLaneDecision {
  attach: boolean;
  auto: boolean;
  reason?: string;
}

export type OptionalWebSearchLaneOutcome<T> =
  | { status: 'skipped' }
  | { status: 'completed'; value: T }
  | {
      status: 'degraded';
      /** Short, customer-safe copy shown before canonical plain Chat continues. */
      userNotice: string;
      /** Hidden prompt context that prevents the plain answer from implying live verification. */
      promptContext: string;
      failureCode?: string;
    };

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

// Pure social turns should never pay for or depend on a tool call, even when
// the circle's persistent Web toggle is enabled. Keep this deliberately
// narrow: a greeting followed by an actual request ("hello, latest news?")
// does not match and can still use search.
const CONVERSATION_ONLY_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|hiya|howdy|yo|sup|wassup|whassup|yo\s+yo)(?:\s+(?:there|everyone|everybody|team|openswan|swan))?[\s!.,?]*$/i,
  /^good\s+(?:morning|afternoon|evening)(?:\s+(?:there|everyone|everybody|team|openswan|swan))?[\s!.,?]*$/i,
  /^(?:thanks|thank\s+you|thank\s+you\s+very\s+much|thx|got\s+it|okay|ok|cool|sounds\s+good|great|awesome|perfect)[\s!.,?]*$/i,
  /^(?:how\s+are\s+you|how(?:'s|\s+is)\s+it\s+going|what(?:'s|\s+is)\s+up|what(?:'s|\s+is)\s+good|nice\s+to\s+meet\s+you)[\s!.,?]*$/i,
];

export function isConversationOnlyTurn(rawMessage: string): boolean {
  const message = String(rawMessage || '').trim();
  return message.length > 0 && CONVERSATION_ONLY_PATTERNS.some((pattern) => pattern.test(message));
}

export function shouldAutoAttachWebSearch(rawMessage: string): WebSearchAutoDetectResult {
  const message = String(rawMessage || '').trim();
  if (!message || message.length < 3) {
    return { auto: false, debug: { positiveHits: [], negativeHits: [], score: 0 } };
  }
  if (isConversationOnlyTurn(message)) {
    return { auto: false, debug: { positiveHits: [], negativeHits: ['conversation-only turn'], score: -2 } };
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
  if (isConversationOnlyTurn(message)) {
    return { attach: false, auto: false };
  }
  if (persistentToggleOn) {
    return { attach: true, auto: false };
  }
  const result = shouldAutoAttachWebSearch(message);
  return { attach: result.auto, auto: result.auto, reason: result.reason };
}

function boundedFailureCode(error: unknown): string | undefined {
  const raw = typeof (error as { code?: unknown } | null | undefined)?.code === 'string'
    ? String((error as { code: string }).code).trim().toLowerCase()
    : '';
  return /^[a-z0-9_.:-]{1,80}$/.test(raw) ? raw : undefined;
}

/**
 * Run Web Search as optional enrichment, never as the terminal owner of an
 * ordinary Chat turn. A failed search resolves to `degraded` so the caller can
 * continue through the canonical plain-Chat transport exactly once. It never
 * manufactures action receipts, recovery-agent launches, or retry authority.
 */
export async function runOptionalWebSearchLane<T>(
  decision: OptionalWebSearchLaneDecision,
  execute: () => Promise<T>,
): Promise<OptionalWebSearchLaneOutcome<T>> {
  if (!decision.attach) return { status: 'skipped' };

  try {
    return { status: 'completed', value: await execute() };
  } catch (error) {
    const failureCode = boundedFailureCode(error);
    const needsProviderKey = failureCode === 'key_missing'
      || /\bkey_missing\b|\bapi key\b/i.test(error instanceof Error ? error.message : String(error || ''));
    return {
      status: 'degraded',
      userNotice: needsProviderKey
        ? 'Web search is unavailable for this turn because OpenRouter needs a valid API key. I will continue with plain Chat, so current facts will not be web-verified.'
        : 'Web search is unavailable for this turn. I will continue with plain Chat, so current facts will not be web-verified.',
      promptContext: [
        'WEB SEARCH DEGRADATION:',
        'Web search was requested for this turn but did not complete.',
        'Continue with the normal Chat response, clearly distinguish stable knowledge from current facts, and do not claim that current facts or sources were web-verified.',
      ].join(' '),
      failureCode,
    };
  }
}
