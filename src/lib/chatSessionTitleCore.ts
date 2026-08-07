/**
 * chatSessionTitleCore — pure session-title + thread-preference derivation for
 * SwanBot chat threads.
 *
 * Decomposition unit U6 from
 * docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md: extract ChatTab's
 * self-contained string logic for naming a fresh session from the first user
 * message, deciding whether a thread still carries an auto-generated
 * placeholder name, and normalizing a thread's stored model preference. This
 * is a verbatim logic move — the derivation behavior is byte-identical to the
 * former in-file copies for every real (string) input; the only additions are
 * house-standard boundary hardening (never throw on null/undefined/wrong-type)
 * and an input scan bound (never process a multi-megabyte blob).
 *
 * Callers (wiring — follow-up PR, once ChatTab is unlocked):
 *  - src/screens/circles/tabs/ChatTab.tsx (~line 4299): a new private thread is
 *    created with SESSION_FALLBACK_TITLE.
 *  - ChatTab (~lines 4351, 4450): thread.default_model is passed through
 *    normalizeThreadModelPreference before selecting the chat model.
 *  - ChatTab (~lines 7527-7528): after the first user turn, an auto-named
 *    thread (isAutoNamedSession) is renamed via deriveSessionTitleFromMessage.
 *  Replace those inline definitions with an import from this module.
 *
 * PURITY (load-bearing — the smoke runs under tsx/esbuild):
 *  - Zero runtime imports; zero side effects at import; deterministic (no
 *    Date.now / Math.random anywhere).
 *  - Every export is TOTAL: never throws on null/undefined/wrong-type/huge/
 *    hostile input; output is bounded (title <= SESSION_TITLE_MAX chars).
 *  - Secret-safe: only reshapes caller-supplied title/model/message text.
 */

/** Placeholder name given to a freshly created session before it is renamed. */
export const SESSION_FALLBACK_TITLE = 'OpenSwan Session';

/**
 * Default chat model id for newly created or otherwise unconfigured threads.
 * A thread that explicitly stores `auto` still passes through unchanged and
 * continues to engage the runtime resolver in serviceProfileSouls.
 */
export const DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6';

/**
 * Low-signal words dropped when deriving a session title from a message, so the
 * name reflects the request's nouns/verbs rather than filler ("help", "please",
 * "the", ...). Exposed as a ReadonlySet so callers cannot mutate the shared set.
 */
export const TITLE_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'build', 'can', 'create', 'do', 'for',
  'from', 'help', 'how', 'i', 'in', 'is', 'it', 'make', 'me', 'my', 'of', 'on',
  'please', 'show', 'the', 'this', 'to', 'we', 'with', 'you',
]);

/**
 * Bounded scan window for title derivation. A derived title is built from the
 * FIRST three meaningful words of a message, which always occur at the start,
 * so capping the processed input never changes a real title while it prevents a
 * multi-megabyte hostile blob from being regex-scanned.
 */
const TITLE_INPUT_SCAN_MAX = 4000;

/** Hard cap on the returned title. Real 3-word titles are far shorter; this is
 * only a safety bound for pathological single-giant-word input. */
const SESSION_TITLE_MAX = 120;

/**
 * Title-case a single title word: an all-caps short token (<= 4 chars, e.g.
 * "API", "SQL", "AI") is preserved as-is; everything else becomes
 * Capitalized-first, lower-rest. Empty / non-string input yields ''. Never
 * throws.
 */
export function formatSessionTitleWord(word: string): string {
  const w = typeof word === 'string' ? word : '';
  if (!w) return '';
  if (w.length <= 4 && w === w.toUpperCase()) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Derive a short session title from the first user message: strip URLs and
 * @/#//-mentions and punctuation, prefer meaningful (non stop-word, 3+ char)
 * words, take up to the first three, and title-case them. Falls back to
 * SESSION_FALLBACK_TITLE when nothing usable remains. Empty / non-string /
 * huge / hostile input never throws and yields the fallback or a bounded title.
 */
export function deriveSessionTitleFromMessage(content: string): string {
  const raw = typeof content === 'string' ? content.slice(0, TITLE_INPUT_SCAN_MAX) : '';
  const normalized = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@/#][\w-]+/g, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return SESSION_FALLBACK_TITLE;

  const words = normalized
    .split(' ')
    .map(word => word.replace(/^'+|'+$/g, '').trim())
    .filter(Boolean);

  const prioritized = words.filter(word => {
    const lower = word.toLowerCase();
    return word.length > 2 && !TITLE_STOP_WORDS.has(lower);
  });

  const chosen = (prioritized.length >= 2 ? prioritized : words)
    .slice(0, 3)
    .map(formatSessionTitleWord)
    .filter(Boolean);

  const title = chosen.length > 0 ? chosen.join(' ') : SESSION_FALLBACK_TITLE;
  return title.length > SESSION_TITLE_MAX ? title.slice(0, SESSION_TITLE_MAX).trim() : title;
}

/**
 * True when a thread title is still an auto-generated placeholder ('', the
 * OpenSwan Session fallback, or 'New Chat') and therefore safe to overwrite
 * with a derived title. Case-insensitive; null/undefined/non-string -> true
 * (treated as unnamed). Never throws.
 */
export function isAutoNamedSession(title: string | null | undefined): boolean {
  const normalized = (typeof title === 'string' ? title : '').trim().toLowerCase();
  return normalized === '' || normalized === 'openswan session' || normalized === 'new chat';
}

/**
 * Normalize a thread's stored model preference: blank / whitespace / the legacy
 * 'openswan' sentinel become DEFAULT_CHAT_MODEL ('claude-sonnet-4-6'); any
 * other value is returned unchanged (original casing/whitespace preserved),
 * including an explicitly stored 'auto'. null/undefined/non-string input
 * yields DEFAULT_CHAT_MODEL. Never throws.
 */
export function normalizeThreadModelPreference(model: string | null | undefined): string {
  const raw = typeof model === 'string' ? model : '';
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === 'openswan') return DEFAULT_CHAT_MODEL;
  return raw || DEFAULT_CHAT_MODEL;
}
