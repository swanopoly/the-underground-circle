/**
 * chatMemoryLabelCore — pure memory-reference label formatters.
 *
 * Decomposition unit U1 (see docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md):
 * these 8 formatters are extracted VERBATIM from
 * `src/screens/circles/tabs/ChatTab.tsx` (lines 626–689). Behavior is identical
 * to the inline copies for every real `PromptMemoryReference`; the follow-up
 * hot-file edit deletes the inline definitions and imports them from here.
 * (The same 8 formatters are byte-identical duplicates in
 * `components/chat/RunHistoryDrawer.tsx`, which may later re-import this core
 * too — out of scope for U1. `chat/ChatTranscript.tsx` was dead code and has
 * been deleted; the live render path is inline in `ChatTab.tsx`.)
 *
 * PURITY: `import type` only — the `PromptMemoryReference` type is fully erased
 * at compile time, so this module pulls in ZERO runtime deps (no supabase, no
 * react-native) and loads cleanly under tsx for smoke testing.
 *
 * TOTALITY: the originals throw on a non-object `ref` (property access on
 * null/undefined). The typed call sites always map over `PromptMemoryReference[]`
 * so that never happens in the app — but per the pure-core contract every export
 * is TOTAL. A tiny `asRef` guard coerces a non-object argument to an empty ref
 * (its outputs match what the verbatim code already produces for an object with
 * those fields absent), and `safeString` shields the one `String(...)` call from
 * an adversarial `toString`. Neither changes any observable output for a valid
 * reference, so the extraction stays behavior-identical.
 *
 * Note: `formatMemoryRecencyLabel` reads `Date.now()` inside the function body
 * (verbatim) — that is intentional runtime freshness, not module-scope time.
 */

import type { PromptMemoryReference } from './memoryService';

/**
 * Coerce an untrusted argument into a safe reference object. For any real
 * `PromptMemoryReference` (a non-null object) this returns the argument
 * unchanged, so downstream field reads are identical to the verbatim code. For
 * null/undefined/primitives it returns an empty object whose absent fields drive
 * the same neutral defaults the formatters already emit for a fieldless ref.
 */
function asRef(ref: PromptMemoryReference): PromptMemoryReference {
  return ref && typeof ref === 'object' ? ref : ({} as PromptMemoryReference);
}

/** `String(value)` that never throws on a hostile `toString`/`Symbol.toPrimitive`. */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

export function formatMemoryRecencyLabel(ref: PromptMemoryReference): string {
  const r = asRef(ref);
  const timestamp = r.lastAccessedAt || r.updatedAt;
  if (!timestamp) return 'unknown freshness';
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 24) return 'fresh today';
  const ageDays = ageHours / 24;
  if (ageDays < 7) return `${Math.max(1, Math.round(ageDays))}d old`;
  if (ageDays < 30) return `${Math.max(1, Math.round(ageDays / 7))}w old`;
  return `${Math.max(1, Math.round(ageDays / 30))}mo old`;
}

export function formatMemoryStrengthLabel(ref: PromptMemoryReference): string {
  const score = asRef(ref).importance ?? 0.5;
  if (score >= 0.9) return 'core';
  if (score >= 0.75) return 'strong';
  if (score >= 0.6) return 'active';
  return 'light';
}

export function formatMemoryStateLabel(ref: PromptMemoryReference): string {
  const r = asRef(ref);
  if (r.memoryState === 'distilled') return 'distilled guidance';
  if (r.retrievalMode === 'startup' && r.pinned) return 'pinned startup';
  if (r.retrievalMode === 'startup') return 'startup guidance';
  if (r.pinned) return 'pinned';
  if (r.memoryState === 'supporting') return 'supporting';
  return 'retrieved';
}

export function formatMemoryTrustLabel(ref: PromptMemoryReference): string {
  const helpfulness = asRef(ref).helpfulness;
  if (helpfulness == null) return 'unrated';
  if (helpfulness >= 0.8) return 'trusted';
  if (helpfulness >= 0.6) return 'proven';
  if (helpfulness <= 0.3) return 'weak';
  return 'mixed';
}

export function formatArchiveBiasLabel(ref: PromptMemoryReference): string | null {
  const r = asRef(ref);
  if (r.archiveBias === 'boosted') return 'archive boosted';
  if (r.archiveBias === 'suppressed') return 'archive suppressed';
  if (r.archiveBias === 'neutral' && r.archivePassiveScore != null) return 'archive neutral';
  return null;
}

export function formatMemorySourceLabel(ref: PromptMemoryReference): string | null {
  switch (asRef(ref).sourceSurface) {
    case 'claude_code_bridge': return 'Claude Code';
    case 'codex_bridge': return 'Codex';
    case 'cursor_bridge': return 'Cursor';
    case 'gemini_bridge': return 'Gemini';
    default: return null;
  }
}

export function getMemoryFamily(ref: PromptMemoryReference): 'guidance' | 'pattern' {
  return ['instruction', 'preference', 'decision', 'policy'].includes(safeString(asRef(ref).memoryKind))
    ? 'guidance'
    : 'pattern';
}

export function getMemoryFamilyLabel(ref: PromptMemoryReference): string {
  return getMemoryFamily(ref) === 'guidance' ? 'Guidance' : 'Pattern';
}
