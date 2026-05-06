/**
 * computerUseIntent — decides whether a natural-language message is a
 * request the Computer Use agent should try to fulfill autonomously.
 *
 * Rule of thumb: if the user is asking us to DO something on the computer
 * across the web, files, or connected apps, route to the agent. If they're
 * just chatting or asking a knowledge question Claude can answer directly,
 * don't.
 *
 * Keep this high-precision. False positives ("I'm researching a new job")
 * that turn a normal chat turn into a 2-minute browser session are much
 * more annoying than false negatives (user can always type /browser).
 */

export interface ComputerUseIntentResult {
  /** True if we should route to the Computer Use agent. */
  route: boolean;
  /** Cleaned-up task text to pass to the agent. */
  task: string;
  /** A short human-readable reason the matcher fired, for logging. */
  reason: string;
  /** Soft category hint — used for UI copy only. */
  category: 'research' | 'browse' | 'find' | 'transactional' | 'post' | 'files' | 'apps' | 'hybrid' | 'unknown';
}

interface Pattern {
  re: RegExp;
  category: ComputerUseIntentResult['category'];
  reason: string;
}

// Anchored patterns — start with an imperative verb + web target.
const PATTERNS: Pattern[] = [
  // Browserbase workflows — direct requests for extraction, Stagehand,
  // and form automation should enter Computer Use even when phrased
  // without "open/browse".
  { re: /^\s*(extract|scrape|collect|gather|capture|export|pull)\b.*\b(data|records?|rows?|items?|products?|prices?|catalog|table|listings?|results?|fields?|schema|structured|json|csv)\b/i, category: 'find', reason: 'browserbase-data-retrieval' },
  { re: /^\s*(extract|scrape|collect|gather|capture|export|pull)\b.*\bfrom\b.*\b(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})\b/i, category: 'find', reason: 'browserbase-extract-url' },
  { re: /\b(web\s*data\s*retrieval|data\s*retrieval)\b.*\b(https?:\/\/|www\.|site|website|page|browserbase)\b/i, category: 'find', reason: 'browserbase-web-data-retrieval' },
  { re: /\b(use\s+)?(browserbase\s+)?stagehand\b.*\b(open|go|click|fill|extract|act|submit|navigate|website|page|form)\b/i, category: 'browse', reason: 'browserbase-stagehand' },
  { re: /^\s*(fill|complete|submit|send|populate)\b.*\b(form|survey|application|registration|checkout|data\s*entry|lead\s*capture|intake)\b/i, category: 'transactional', reason: 'browserbase-form-submission' },
  { re: /\b(automate|complete)\b.*\b(form submissions?|forms?|surveys?|applications?|data\s*entry)\b/i, category: 'transactional', reason: 'browserbase-form-automation' },

  // Research — "research X", "look up X and tell me", "find info on X"
  { re: /^\s*(research|look\s*up|investigate|find\s+(?:me\s+)?(?:info|information|details|stuff)\s+(?:on|about))\b/i, category: 'research', reason: 'research-verb' },
  { re: /^\s*(compare|contrast)\b.*\b(reviews?|prices?|options|products|tools|services)\b/i, category: 'research', reason: 'compare-commerce' },
  { re: /\b(summarize|summary)\b.*\b(article|website|page|news|blog|post)\b/i, category: 'research', reason: 'summarize-webpage' },

  // Find / list
  { re: /^\s*(find|list|show\s*me)\b.*\b(top|best|cheapest|most|newest|latest)\b/i, category: 'find', reason: 'find-superlative' },
  { re: /^\s*(find|search\s*for)\b.*\b(on|from)\s+[a-z0-9.-]+\.(com|io|org|net|co|ai|dev|app)\b/i, category: 'find', reason: 'find-site' },

  // Browse / open
  { re: /^\s*(browse|open|visit|go\s*to)\b.*\b(https?:\/\/|www\.|\.com\b|\.io\b|\.org\b|\.net\b)/i, category: 'browse', reason: 'browse-url' },
  { re: /\bcan\s*you\s*(?:browse|check|open|visit|look\s*at)\b.*\b(https?:\/\/\S+)/i, category: 'browse', reason: 'browse-checkurl' },

  // Transactional
  { re: /^\s*(book|order|buy|purchase|reserve|schedule)\b.*\b(flight|ticket|hotel|meeting|appointment|room|table|table\s*at|delivery)\b/i, category: 'transactional', reason: 'transactional-domain' },
  { re: /\b(log\s*in\s*to|sign\s*in\s*to)\b.*\b([a-z0-9.-]+\.[a-z]{2,})\b/i, category: 'transactional', reason: 'login-to-site' },

  // Post / publish
  { re: /^\s*(post|publish|tweet|share)\b.*\b(to|on)\s+(twitter|x|linkedin|facebook|wordpress|substack|blog|instagram)\b/i, category: 'post', reason: 'post-to-platform' },
  { re: /^\s*(find|locate|search)\b.*\b(file|folder|directory|document|pdf|spreadsheet|csv|json|markdown|repo|repository)\b/i, category: 'files', reason: 'file-search' },
  { re: /^\s*(open|read|scan|search)\b.*\b(on my computer|in my files|in downloads|in documents|in desktop)\b/i, category: 'files', reason: 'local-file-scope' },
  { re: /^\s*(open|check|use|update|review)\b.*\b(slack|notion|figma|github|calendar|email|mail|discord|teams)\b/i, category: 'apps', reason: 'app-surface' },
  { re: /^\s*(find|locate|pull)\b.*\b(file|document)\b.*\bthen\b.*\b(open|upload|send|share|post)\b/i, category: 'hybrid', reason: 'file-to-app-hybrid' },
];

// Short-circuit patterns — clearly conversational messages the agent
// should NOT hijack even if they contain a keyword like "research".
const NEGATIVE_HINTS: RegExp[] = [
  /\b(idk|i\s+dunno|i\s+don'?t\s+know|not\s+sure|maybe|just\s+thinking|wondering)\b/i,
  /\b(what\s+do\s+you\s+think|how\s+do\s+you\s+feel|your\s+opinion)\b/i,
  /\b(help\s+me\s+understand|explain|teach\s+me)\b/i,
  /^\s*(hi|hey|hello|yo|sup|what'?s up)\b/i,
  /^\s*(thanks|thank\s+you|ty|thx|cool|nice|ok|okay|got\s+it)\b/i,
];

// Domain / URL in the message is a strong positive signal — if we see a
// URL, we'll route to the agent unless a negative hint nukes it.
const HAS_URL = /\bhttps?:\/\/\S+/i;

export function detectComputerUseIntent(message: string): ComputerUseIntentResult {
  const text = (message || '').trim();
  const noIntent: ComputerUseIntentResult = {
    route: false,
    task: text,
    reason: 'no-match',
    category: 'unknown',
  };
  if (text.length < 5) return noIntent;

  if (NEGATIVE_HINTS.some((re) => re.test(text))) {
    return { ...noIntent, reason: 'negative-hint' };
  }

  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      return { route: true, task: text, reason: p.reason, category: p.category };
    }
  }

  if (HAS_URL.test(text) && /^(can\s+you|please|tell\s+me|what'?s\s+on|give\s+me)\b/i.test(text)) {
    return { route: true, task: text, reason: 'question-about-url', category: 'browse' };
  }

  return noIntent;
}
