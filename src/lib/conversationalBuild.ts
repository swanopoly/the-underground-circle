/**
 * conversationalBuild — state machine + system-prompt addendum that lets
 * the chat reason with the user through a build conversation without
 * requiring a slash command.
 *
 * Flow: idle → exploring → converging → confirmed → (launch workbench) → idle
 *
 * - `idle`: no active build conversation.
 * - `exploring`: user signaled build intent; bot asks targeted questions.
 * - `converging`: bot proposes a concrete brief and asks for confirmation.
 * - `confirmed`: user said yes; client launches the workbench.
 *
 * The LLM advances the state by emitting marker tokens in its response:
 *
 *   <BUILD_READY>{"brief": "dark-mode landing ..."}</BUILD_READY>
 *
 * When the client sees that marker, it strips the marker from the visible
 * text and surfaces a "Start building this?" pill. The user has to tap
 * "Start" for the workbench to fire — the marker is a proposal, not a
 * commit.
 *
 * Critical guarantee: at no point does the orchestrator bypass user
 * consent. Every path requires either an explicit slash command or a
 * tap on the confirm pill.
 */

import { Platform } from 'react-native';

export type BuildConversationState = 'idle' | 'exploring' | 'converging' | 'confirmed';

export interface BuildConversationRecord {
  state: BuildConversationState;
  /** Conversation topic/goal summary. Updated as the chat narrows scope. */
  topic?: string;
  /** The proposed brief once state is `converging` or `confirmed`. */
  brief?: string;
  /** Number of meaningful user turns captured in this build conversation. */
  userTurnCount?: number;
  /** Number of assistant clarifying-question turns asked so far. */
  assistantQuestionCount?: number;
  /** ISO timestamp for cache-pruning stale sessions. */
  updatedAt: string;
}

const DEFAULT_RECORD: BuildConversationRecord = { state: 'idle', updatedAt: new Date(0).toISOString() };

// Per-thread state lives in localStorage so it survives reloads but isn't
// synced across devices. That's the right fidelity — a build conversation
// is inherently local / ephemeral.
const STORAGE_PREFIX = 'uc_build_convo_v1:';

// Stale conversations get reset to idle after 24h. Prevents a month-old
// "exploring" state from silently steering every new chat.
const STALE_MS = 24 * 60 * 60 * 1000;

export function loadBuildConversation(threadKey: string): BuildConversationRecord {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return DEFAULT_RECORD;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${threadKey}`);
    if (!raw) return DEFAULT_RECORD;
    const parsed = JSON.parse(raw) as BuildConversationRecord;
    if (!parsed?.state) return DEFAULT_RECORD;
    if (Date.now() - new Date(parsed.updatedAt).getTime() > STALE_MS) {
      return DEFAULT_RECORD;
    }
    return parsed;
  } catch { return DEFAULT_RECORD; }
}

export function saveBuildConversation(threadKey: string, record: BuildConversationRecord): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${threadKey}`,
      JSON.stringify({ ...record, updatedAt: new Date().toISOString() }),
    );
  } catch { /* quota / SSR */ }
}

export function resetBuildConversation(threadKey: string): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try { window.localStorage.removeItem(`${STORAGE_PREFIX}${threadKey}`); } catch {}
}

// ─── Intent hinting (local heuristic) ────────────────────────────────────────
// This is a lightweight first-look signal, NOT a gate. If it fires, we add
// the orchestrator system addendum to the request so the LLM can confirm or
// reject the build framing. The LLM does the real classification.

const BUILD_INTENT_HINTS = [
  /\bwant(?:s|ed)?\s+to\s+(?:build|make|create|ship|launch|scaffold)\b/i,
  /\b(?:build|make|create|design)\s+(?:a|an|the|me|my|us|our)\s+(?:page|site|website|landing|app|tool|dashboard|form|component|feature|product|microsite)\b/i,
  /\b(?:new|build)\s+(?:saas|landing\s*page|marketing\s*site|portfolio|microsite|dashboard)\b/i,
  /\b(?:figma|mockup|design|wireframe)\s+to\s+(?:code|html|webpage|page|react)\b/i,
  /\blet'?s\s+(?:build|make|create|ship|design)\b/i,
  /\bhelp\s+me\s+(?:build|make|create|design)\b/i,
];

export function hasBuildIntentHint(message: string): boolean {
  if (!message) return false;
  return BUILD_INTENT_HINTS.some((re) => re.test(message));
}

const BUILD_CONTINUATION_HINTS = [
  /\b(hero|headline|cta|pricing|features|testimonials|faq|footer|navbar|section|landing|page|site|app|dashboard|form|component|layout|design|style|palette|brand|copy)\b/i,
  /\b(add|remove|change|update|make it|instead|actually|also|include|needs?|should have|with)\b/i,
];

const NON_BUILD_PIVOT_HINTS = [
  /^(hey|hi|hello)\b/i,
  /^(what|which|who|when|where|why|how)\b/i,
  /\b(monad|typescript|react|history|weather|stock|price|president|capital)\b/i,
];

function looksLikeBuildContinuation(message: string): boolean {
  return BUILD_CONTINUATION_HINTS.some((re) => re.test(message));
}

function looksLikeNonBuildPivot(message: string): boolean {
  if (hasBuildIntentHint(message)) return false;
  if (looksLikeBuildContinuation(message)) return false;
  return NON_BUILD_PIVOT_HINTS.some((re) => re.test(message));
}

// ─── System-prompt addendum ──────────────────────────────────────────────────
// Injected as an extra system block when buildState is active OR the user's
// latest message hints at build intent. Cache-friendly: the full text is
// stable so it can ride the prompt-cache prefix.

export function buildSystemAddendum(state: BuildConversationState): string {
  if (state === 'idle') return '';
  return [
    '# Build Conversation Protocol',
    '',
    'The user is exploring a build task with you. Your job is NOT to produce',
    'code in this turn. Your job is to converge on a concrete brief the',
    'user can confirm, then wait for their confirmation.',
    '',
    '## Rules',
    '',
    '1. Ask ONE focused clarifying question per turn (not five at once).',
    '   Prioritize in this order: purpose/audience, key sections/pages,',
    '   required elements (forms, CTAs, integrations), visual style.',
    '',
    '2. Keep answers short. Two or three sentences plus the question.',
    '',
    '3. Once you have: purpose + 2+ concrete sections/components + a style',
    '   cue (even rough), propose a brief and STOP asking questions. Render',
    '   the proposal like this — VERBATIM, including the marker tokens:',
    '',
    '   <BUILD_READY>',
    '   {"brief": "<one self-contained paragraph the scaffolder can build from>"}',
    '   </BUILD_READY>',
    '',
    '   Above or below the marker, write a human-friendly summary of what',
    '   you heard so the user can spot-check. DO NOT wrap the marker in',
    '   triple backticks — it must be parseable JSON inside the tags.',
    '',
    '4. Do NOT emit the <BUILD_READY> marker until you actually have scope',
    '   clarity. You must ask at least one real clarifying question and wait',
    '   for at least one follow-up answer from the user before you emit it.',
    '   If you are still in discovery, just ask the next question.',
    '',
    '5. If the user later adds more detail or edits, REGENERATE the marker',
    '   with the updated brief. Never keep a stale one.',
    '',
    '6. If the user changes topic away from building, drop this mode and',
    '   chat normally — do NOT keep forcing clarifying questions.',
  ].join('\n');
}

// ─── Marker parsing ─────────────────────────────────────────────────────────
// Extracts <BUILD_READY>{...}</BUILD_READY> from assistant text. Returns the
// parsed brief + the text with the marker stripped so it doesn't clutter the
// visible response.

export interface BuildMarker {
  brief: string;
  /** Assistant text with the marker block removed. */
  cleanedText: string;
}

const MARKER_RE = /<BUILD_READY>\s*([\s\S]*?)\s*<\/BUILD_READY>/i;

export function extractBuildMarker(text: string): BuildMarker | null {
  if (!text) return null;
  const match = text.match(MARKER_RE);
  if (!match) return null;
  const payload = match[1];
  let brief: string | undefined;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed.brief === 'string' && parsed.brief.trim().length > 0) {
      brief = parsed.brief.trim();
    }
  } catch {
    // Tolerate a bare-string payload too — some models hedge and emit
    // non-JSON. Strip quotes if present.
    const trimmed = payload.trim().replace(/^["']|["']$/g, '');
    if (trimmed.length > 10) brief = trimmed;
  }
  if (!brief) return null;
  const cleanedText = text.replace(MARKER_RE, '').trim();
  return { brief, cleanedText };
}

// ─── State transitions ──────────────────────────────────────────────────────
// Called by the send pipeline after sending a user message.

export function advanceOnUserMessage(
  current: BuildConversationRecord,
  userMessage: string,
): BuildConversationRecord {
  const trimmed = userMessage.trim();
  // If we already emitted a brief and the user replies affirmatively,
  // move to `confirmed` so the client launches the workbench.
  if (current.state === 'converging' && /^\s*(yes|yep|yeah|sure|go|do it|build it|let'?s go|start|sounds good|perfect|ship it|looks good|lgtm|\+1)\s*[.!]*\s*$/i.test(trimmed)) {
    return { ...current, state: 'confirmed', updatedAt: new Date().toISOString() };
  }
  // Let the user leave build mode naturally by asking an unrelated question.
  if ((current.state === 'exploring' || current.state === 'converging') && looksLikeNonBuildPivot(trimmed)) {
    return { state: 'idle', updatedAt: new Date().toISOString() };
  }
  // Entering exploration on first hint.
  if (current.state === 'idle' && hasBuildIntentHint(trimmed)) {
    return {
      state: 'exploring',
      topic: trimmed.slice(0, 120),
      userTurnCount: 1,
      assistantQuestionCount: 0,
      updatedAt: new Date().toISOString(),
    };
  }
  // While actively building, keep the topic fresh when the user adds details.
  if ((current.state === 'exploring' || current.state === 'converging') && looksLikeBuildContinuation(trimmed)) {
    return {
      ...current,
      topic: trimmed.slice(0, 120),
      userTurnCount: (current.userTurnCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
  }
  if ((current.state === 'exploring' || current.state === 'converging') && trimmed.length > 0) {
    return {
      ...current,
      userTurnCount: (current.userTurnCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
  }
  return current;
}

function assistantAskedClarifyingQuestion(text: string): boolean {
  if (!text) return false;
  if (!/\?/.test(text)) return false;
  return /\b(audience|goal|purpose|style|sections?|features?|pricing|cta|brand|integrations?|pages?|timeline|copy|visual|look|feel|who|what|which|where|why|how)\b/i.test(text);
}

export function advanceOnAssistantMessage(
  current: BuildConversationRecord,
  marker: BuildMarker | null,
  assistantText = '',
): BuildConversationRecord {
  const nextQuestionCount = assistantAskedClarifyingQuestion(assistantText)
    ? (current.assistantQuestionCount || 0) + 1
    : (current.assistantQuestionCount || 0);
  if (marker) {
    const hasEnoughDiscovery = nextQuestionCount >= 1 && (current.userTurnCount || 0) >= 2;
    if (!hasEnoughDiscovery) {
      return {
        ...current,
        state: 'exploring',
        assistantQuestionCount: nextQuestionCount,
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      ...current,
      state: 'converging',
      brief: marker.brief,
      assistantQuestionCount: nextQuestionCount,
      updatedAt: new Date().toISOString(),
    };
  }
  if (nextQuestionCount !== (current.assistantQuestionCount || 0)) {
    return {
      ...current,
      assistantQuestionCount: nextQuestionCount,
      updatedAt: new Date().toISOString(),
    };
  }
  return current;
}
