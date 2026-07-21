// contextDepthPolicy — the PURE user-controlled context dial for SwanBot
// turns. Today the prompt context stack is sized ONLY by message-complexity
// heuristics (resolveChatPromptContextPolicy in chatPromptAssembly.ts); the
// user has no say. This core adds a per-device preference with three levels:
//
//   lean     — snappy turns: identity + basic recall only, tight budgets.
//   standard — exactly today's behavior (the transform is an IDENTITY —
//              byte-identical prompts, smoke-pinned).
//   max      — "give the model everything": every context family loads, the
//              extras budget/retrieval scale far past the complex tier, and
//              complexity floors at 'complex' so tiers never starve sections
//              like last_session (which sits last in emit order and is the
//              first casualty of a small clip budget).
//
// Also owns the CONTEXT RECEIPT: a user-facing "what did I load this turn"
// rendering of assembleChatPromptExtras telemetry, so `/context` can show
// exactly which sections reached the model and what got clipped.
//
// Storage follows the codingModelSplitPolicy house pattern: localStorage on
// web behind try/catch (fail-soft to 'standard' on native/node). Pure
// otherwise: type-only imports, tsx-loadable (smoke: context-depth-policy),
// never throws.

import type {
  ChatPromptComplexity,
  ChatPromptContextPolicy,
  ChatPromptSectionKey,
} from './chatPromptAssembly';

export type ChatContextDepth = 'lean' | 'standard' | 'max';

export const DEFAULT_CONTEXT_DEPTH: ChatContextDepth = 'standard';
export const CONTEXT_DEPTH_STORAGE_KEY = 'uc_context_depth';

/** Budgets for the 'max' dial — deliberately past the 'complex' tier. */
export const MAX_DEPTH_EXTRAS_CHARS = 16_000;
export const MAX_DEPTH_RETRIEVAL_BUDGET = 5_000;
export const MAX_DEPTH_RETRIEVAL_COUNT = 20;
/** Caps for the 'lean' dial — identity + basic recall, nothing heavy. */
export const LEAN_DEPTH_EXTRAS_CHARS = 2_500;
export const LEAN_DEPTH_RETRIEVAL_BUDGET = 600;
export const LEAN_DEPTH_RETRIEVAL_COUNT = 3;

/** Tolerant parser for user/command/storage input. Null when unrecognized. */
export function parseContextDepth(raw: unknown): ChatContextDepth | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (['lean', 'minimal', 'min', 'low', 'light', 'fast'].includes(v)) return 'lean';
  if (['standard', 'normal', 'default', 'auto', 'balanced', 'off'].includes(v)) return 'standard';
  if (['max', 'maximum', 'full', 'everything', 'high', 'deep', 'all'].includes(v)) return 'max';
  return null;
}

/**
 * Session-scoped fallback so the dial also works where localStorage is
 * unavailable (native): the latest set always applies for this JS session;
 * web additionally persists across restarts.
 */
let sessionDepthOverride: ChatContextDepth | null = null;

/**
 * Resolve the active preference: explicit per-turn override → this session's
 * last set → web localStorage → 'standard'. Never throws.
 */
export function resolveStoredContextDepth(explicit?: ChatContextDepth | null): ChatContextDepth {
  if (explicit) return explicit;
  if (sessionDepthOverride) return sessionDepthOverride;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const parsed = parseContextDepth(store?.getItem?.(CONTEXT_DEPTH_STORAGE_KEY));
    if (parsed) return parsed;
  } catch { /* storage unavailable (native/node) → default */ }
  return DEFAULT_CONTEXT_DEPTH;
}

/**
 * Apply the preference. Always takes effect for this session; returns true
 * only when it also PERSISTED (web localStorage present) so callers can tell
 * the user whether it survives a restart.
 */
export function setStoredContextDepth(depth: ChatContextDepth): boolean {
  sessionDepthOverride = depth;
  try {
    const store = (globalThis as { localStorage?: { setItem?: (k: string, v: string) => void } }).localStorage;
    if (!store?.setItem) return false;
    store.setItem(CONTEXT_DEPTH_STORAGE_KEY, depth);
    return true;
  } catch {
    return false;
  }
}

/**
 * The depth-driven complexity floor: at 'max' the turn always classifies at
 * least 'complex' (full section families). Compose with the lane floor via
 * composeComplexityFloors.
 */
export function resolveContextDepthComplexityFloor(
  depth: ChatContextDepth,
): ChatPromptComplexity | null {
  return depth === 'max' ? 'complex' : null;
}

const FLOOR_RANK: Readonly<Record<ChatPromptComplexity, number>> = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
};

/** Higher of two optional floors (null = no floor). */
export function composeComplexityFloors(
  a: ChatPromptComplexity | null | undefined,
  b: ChatPromptComplexity | null | undefined,
): ChatPromptComplexity | null {
  if (!a) return b || null;
  if (!b) return a;
  return FLOOR_RANK[a] >= FLOOR_RANK[b] ? a : b;
}

/**
 * Transform the complexity-derived policy by the user's dial.
 * 'standard' is an IDENTITY (returns the same object — the no-preference
 * path is byte-identical to today). 'lean' caps, 'max' boosts; neither ever
 * lowers a boost below the incoming policy on the boost path or raises a cap
 * above it on the cap path.
 */
export function applyContextDepthToPolicy(
  policy: ChatPromptContextPolicy,
  depth: ChatContextDepth,
): ChatPromptContextPolicy {
  if (depth === 'standard') return policy;
  if (depth === 'lean') {
    return {
      ...policy,
      loadWisdom: false,
      loadMissions: false,
      retrievalBudget: Math.min(policy.retrievalBudget, LEAN_DEPTH_RETRIEVAL_BUDGET),
      retrievalCount: Math.min(policy.retrievalCount, LEAN_DEPTH_RETRIEVAL_COUNT),
      maxExtrasChars: Math.min(policy.maxExtrasChars, LEAN_DEPTH_EXTRAS_CHARS),
    };
  }
  return {
    loadProfile: true,
    loadMemory: true,
    loadWisdom: true,
    loadRetrieval: true,
    loadMissions: true,
    loadSkills: true,
    retrievalBudget: Math.max(policy.retrievalBudget, MAX_DEPTH_RETRIEVAL_BUDGET),
    retrievalCount: Math.max(policy.retrievalCount, MAX_DEPTH_RETRIEVAL_COUNT),
    maxExtrasChars: Math.max(policy.maxExtrasChars, MAX_DEPTH_EXTRAS_CHARS),
  };
}

/** One-line, user-facing status for the /context command reply. */
export function describeContextDepthSetting(depth: ChatContextDepth): string {
  if (depth === 'lean') {
    return 'Context depth: **lean** — fast turns with just your profile, key memories, and skills. `/context standard` or `/context max` to load more.';
  }
  if (depth === 'max') {
    return 'Context depth: **max** — every turn loads the full stack (memory, past sessions, wisdom, missions, codebase, connected resources) with expanded budgets.';
  }
  return 'Context depth: **standard** — context scales with each message automatically. `/context max` to always load everything, `/context lean` for speed.';
}

// ─── Context receipt ────────────────────────────────────────────────────────

/** Human names for the receipt — one per prompt section key. */
export const CONTEXT_SECTION_LABELS: Readonly<Record<ChatPromptSectionKey, string>> = {
  runtime_bundle: 'Runtime bundle',
  task_pipeline: 'Task pipeline match',
  computer_request_route: 'Computer request route',
  computer_strategy: 'App/browser strategy',
  computer_grounding: 'Computer grounding',
  design_automation: 'Design automation profile',
  design_execution_pipeline: 'Design execution pipeline',
  design_creative_ai: 'Design creative AI',
  design_creative_ai_recipe: 'Creative AI recipe',
  design_object_manifest: 'Design object manifest',
  design_operation_runbook: 'Design operation runbook',
  design_proof_review: 'Design proof review',
  cad_operation_runbook: 'CAD operation runbook',
  computer_receipt: 'Computer execution receipt',
  collab_manifest: 'Capability manifest',
  collab_note: 'Model collaboration note',
  blackswan_grounding: 'BlackSwan grounding',
  connected_resources: 'Connected resources (marketplace/vault/Google)',
  user_chat_profile: 'Your chat profile',
  memory_user_notes: 'Your saved notes',
  memory_user_profile: 'Inferred profile memory',
  memory_runtime: 'Runtime memory bundle',
  memory_working: 'Working memory',
  soul_wisdom: 'SOUL wisdom',
  turn_retrieval: 'Retrieved memories (this turn)',
  wiki_context: 'Wiki context',
  attachment_context: 'Attachments',
  codebase_mentions: '@file/@symbol code context',
  project_discovery: 'Project discovery',
  project_conventions: 'Repo conventions (CLAUDE.md/.cursorrules)',
  skills: 'Skill library',
  agent_identity: 'Agent identity',
  missions: 'Missions',
  circle_snapshot: 'Circle snapshot',
  proactive_surfacing: 'Proactive heads-up (failed runs / stalled missions / approvals)',
  last_session: 'Previous sessions + persistent knowledge',
};

export interface ContextReceiptInput {
  depth: ChatContextDepth;
  complexity: ChatPromptComplexity;
  rendered: ReadonlyArray<{ key: ChatPromptSectionKey; chars: number }>;
  clipped: boolean;
  maxExtrasChars: number;
}

/**
 * Render the "what context did I load" receipt for the /context command.
 * Bounded, never throws; degenerate input yields a friendly empty message.
 */
export function buildContextReceipt(input: ContextReceiptInput | null | undefined): string {
  if (!input || !Array.isArray(input.rendered)) {
    return 'No context receipt yet this session — send a message first, then run `/context` again.';
  }
  const lines: string[] = ['## Context loaded on the last turn'];
  lines.push(`Depth: ${input.depth} · message tier: ${input.complexity} · budget: ${Math.round(input.maxExtrasChars / 1000)}k chars`);
  if (input.rendered.length === 0) {
    lines.push('No dynamic sections rendered (base prompt only).');
    return lines.join('\n');
  }
  let total = 0;
  for (const section of input.rendered.slice(0, 40)) {
    // Runtime input may carry keys newer than this map — fall back to the raw key.
    const label = (CONTEXT_SECTION_LABELS as Readonly<Record<string, string>>)[section.key] || section.key;
    const chars = Math.max(0, Number(section.chars) || 0);
    total += chars;
    lines.push(`- ${label} — ${chars.toLocaleString()} chars`);
  }
  lines.push(`Total: ${total.toLocaleString()} chars${input.clipped ? ` (clipped to the ${Math.round(input.maxExtrasChars / 1000)}k budget — later sections were cut)` : ''}`);
  if (input.clipped && input.depth !== 'max') {
    lines.push('Tip: `/context max` raises the budget so nothing gets cut.');
  }
  return lines.join('\n');
}

// ─── Last-receipt store (session-scoped transparency) ───────────────────────
// In-memory only — the receipt describes the CURRENT device's last assembled
// prompt; persisting it would just be stale telemetry. Module-scoped like the
// agentTodoStore pattern, guarded so recording can never break a turn.

let lastReceipt: ContextReceiptInput | null = null;

export function recordContextReceipt(input: ContextReceiptInput): void {
  try {
    if (!input || typeof input !== 'object') return;
    lastReceipt = {
      depth: input.depth,
      complexity: input.complexity,
      rendered: Array.isArray(input.rendered) ? input.rendered.slice(0, 60) : [],
      clipped: Boolean(input.clipped),
      maxExtrasChars: Number(input.maxExtrasChars) || 0,
    };
  } catch { /* recording must never break a turn */ }
}

export function getLastContextReceipt(): ContextReceiptInput | null {
  return lastReceipt;
}
