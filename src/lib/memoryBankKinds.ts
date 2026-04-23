/**
 * memoryBankKinds — pure doc-kind type + parser, split out from
 * `services/sharedMemory.ts` so slash-command grammar tests can import
 * it in Node without pulling supabase / react-native through sharedMemory.
 */

export type MemoryDocKind = 'brief' | 'active_context' | 'progress';

export const ALL_MEMORY_DOC_KINDS: MemoryDocKind[] = ['brief', 'active_context', 'progress'];

export const MEMORY_DOC_KIND_LABELS: Record<MemoryDocKind, string> = {
  brief:          'Brief',
  active_context: 'Active Context',
  progress:       'Progress',
};

export const MEMORY_DOC_KIND_DESCRIPTIONS: Record<MemoryDocKind, string> = {
  brief:          'Stable summary of what this circle is and who it serves.',
  active_context: 'What the crew is working on right now.',
  progress:       'What has shipped so far and what remains.',
};

/** Canonicalize a user-typed token (`brief`, `active`, `context`,
 *  `progress`) into a `MemoryDocKind`. Returns null for anything else
 *  so callers can prompt for a correction. */
export function parseMemoryDocKind(input: string | null | undefined): MemoryDocKind | null {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'brief') return 'brief';
  if (raw === 'progress') return 'progress';
  if (raw === 'active' || raw === 'active_context' || raw === 'context') return 'active_context';
  return null;
}
