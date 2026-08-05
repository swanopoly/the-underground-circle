import { planSectionFit, resolveSectionPriority } from './promptSectionPriorityCore';

/**
 * chatPromptAssembly — W5 (unified prompt builder): the PURE core of the
 * shared chat system-prompt assembler.
 *
 * Why this module exists (plan: docs/CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN.md,
 * internal-map frictions 3-4): the stream, batch, and OpenSwan-v2 lanes all
 * funnel through `buildSystemPromptAsync` in `swanbot.ts`, but that file is
 * react-native-tainted so the block ORDERING, the complexity-tier context
 * policy, the extras char budget, and the cache-boundary join could never be
 * smoke-pinned — they drifted silently. This module owns those decisions as
 * pure data + pure functions; `swanbot.ts` keeps the I/O (memory fetch,
 * circle context, skills resolution) and delegates the decisions here.
 *
 * Research grounding (verified 2026-07-09, three-source consensus):
 *   - One assembly mechanism, lane variation as configuration — Claude Code
 *     builds ONE system prompt from ~30 conditional section builders, never
 *     per-lane builders (dbreunig.com 2026-04-04; shloked.com source
 *     patterns).
 *   - Deterministic foundational→volatile section order, volatile content
 *     kept OUT of the cacheable prefix (Anthropic effective-context-
 *     engineering 2025-09-29; Manus KV-cache lessons 2025-07-18: a moving
 *     byte ahead of the boundary kills the 10× cache economics).
 *   - Sections carry stability tags so cache breakpoints derive from tags,
 *     not per-lane hand placement (Claude Code's
 *     __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ pattern).
 *
 * BYTE-IDENTITY CONTRACT: `assembleChatPromptExtras` +
 * `composeChatSystemPrompt` reproduce the legacy inline join/clip/boundary
 * EXACTLY (same '\n\n' join, same slice + 0.7-lastBreak clip, same boundary
 * marker, same base-only return when no extras). The wiring in swanbot.ts is
 * a refactor, not a behavior change — smoke-pinned here.
 *
 * Pure by construction: no imports outside `import type`, tsx-loadable,
 * bounded, never throws.
 */

// ─── Complexity tiers ───────────────────────────────────────────────────────

export type ChatPromptComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

const COMPLEXITY_RANK: Readonly<Record<ChatPromptComplexity, number>> = {
  trivial: 0,
  simple: 1,
  moderate: 2,
  complex: 3,
};

/**
 * X1 (P44): lanes whose turn must never drop below a context tier apply a
 * floor AFTER message-derived detection. The v2 session runtime floors at
 * `moderate` — its tool runs always warrant memory/wisdom/missions — while a
 * genuinely complex message still classifies `complex` from the clean text.
 * No floor → detection verbatim.
 */
export function applyChatPromptComplexityFloor(
  detected: ChatPromptComplexity,
  floor: ChatPromptComplexity | null | undefined,
): ChatPromptComplexity {
  if (!floor) return detected;
  return COMPLEXITY_RANK[detected] >= COMPLEXITY_RANK[floor] ? detected : floor;
}

/**
 * Which context families a turn loads, by message complexity. Mirrors the
 * adaptive-context-loading tiers that lived inline in buildSystemPromptAsync:
 *   trivial  → profile only (greeting, thanks, yes/no)
 *   simple   → profile + memory startup bundle + turn retrieval + skills
 *   moderate → + SOUL wisdom + wiki + missions + circle snapshot
 *   complex  → + attachments + full retrieval budget
 */
export interface ChatPromptContextPolicy {
  loadProfile: boolean;
  loadMemory: boolean;
  loadWisdom: boolean;
  loadRetrieval: boolean;
  loadMissions: boolean;
  loadSkills: boolean;
  retrievalBudget: number;
  retrievalCount: number;
  /** Adaptive extras budget — trivial gets a tiny prompt, complex the full stack. */
  maxExtrasChars: number;
}

export function resolveChatPromptContextPolicy(
  complexity: ChatPromptComplexity,
): ChatPromptContextPolicy {
  return {
    loadProfile: true,
    loadMemory: complexity !== 'trivial',
    loadWisdom: complexity === 'moderate' || complexity === 'complex',
    loadRetrieval: complexity !== 'trivial',
    loadMissions: complexity === 'moderate' || complexity === 'complex',
    loadSkills: complexity !== 'trivial',
    retrievalBudget: complexity === 'complex' ? 2500 : complexity === 'moderate' ? 1200 : 600,
    retrievalCount: complexity === 'complex' ? 12 : complexity === 'moderate' ? 6 : 3,
    maxExtrasChars:
      complexity === 'trivial' ? 1200 : complexity === 'simple' ? 3000 : complexity === 'moderate' ? 5500 : 8000,
  };
}

// ─── Section registry ───────────────────────────────────────────────────────

/**
 * Every dynamic-context section the shared assembler can emit, in canonical
 * order. The order is load-bearing: it reproduces the legacy emit order
 * (including the old `extras.unshift(runtimeBundle)` — runtime_bundle is
 * simply first here) so wiring is byte-identical. New sections get a key
 * here + one keyed push at the producing site; ordering is no longer decided
 * by push-call position.
 */
export type ChatPromptSectionKey =
  | 'runtime_bundle'
  | 'task_pipeline'
  | 'computer_request_route'
  | 'computer_strategy'
  | 'computer_grounding'
  | 'design_automation'
  | 'design_execution_pipeline'
  | 'design_creative_ai'
  | 'design_creative_ai_recipe'
  | 'design_object_manifest'
  | 'design_operation_runbook'
  | 'design_proof_review'
  | 'cad_operation_runbook'
  | 'computer_receipt'
  | 'collab_manifest'
  | 'collab_note'
  | 'blackswan_grounding'
  | 'connected_resources'
  | 'user_chat_profile'
  | 'memory_user_notes'
  | 'memory_user_profile'
  | 'memory_runtime'
  | 'memory_working'
  | 'soul_wisdom'
  | 'turn_retrieval'
  | 'wiki_context'
  | 'attachment_context'
  | 'codebase_mentions'
  | 'project_discovery'
  | 'project_conventions'
  | 'skills'
  | 'agent_identity'
  | 'missions'
  | 'circle_snapshot'
  | 'proactive_surfacing'
  | 'last_session';

export const CHAT_PROMPT_SECTION_ORDER: ReadonlyArray<ChatPromptSectionKey> = [
  'runtime_bundle',
  'task_pipeline',
  'computer_request_route',
  'computer_strategy',
  'computer_grounding',
  'design_automation',
  'design_execution_pipeline',
  'design_creative_ai',
  'design_creative_ai_recipe',
  'design_object_manifest',
  'design_operation_runbook',
  'design_proof_review',
  'cad_operation_runbook',
  'computer_receipt',
  'collab_manifest',
  'collab_note',
  'blackswan_grounding',
  // Cross-dashboard awareness: what the circle has connected (marketplace,
  // vault logins, Google Workspace, provider keys) so the agent reaches for
  // the right tool/credential instead of discovering connections by failing.
  'connected_resources',
  'user_chat_profile',
  // User-authored notes precede the inferred profile — openswanMemoryStores'
  // own ordering rule: "user-authored notes first (highest signal)".
  'memory_user_notes',
  'memory_user_profile',
  'memory_runtime',
  'memory_working',
  'soul_wisdom',
  'turn_retrieval',
  'wiki_context',
  'attachment_context',
  // Coding-agent P4: resolved @file/@symbol mention context (codebase index)
  // sits with the other user-supplied-material sections, before discovery.
  'codebase_mentions',
  'project_discovery',
  // Coding-agent P4: the ACTIVE local repo's CLAUDE.md/.cursorrules (via the
  // desktop bridge) — the local-disk counterpart of project_discovery.
  'project_conventions',
  'skills',
  'agent_identity',
  'missions',
  'circle_snapshot',
  // Proactive heads-up (failed runs / stalled missions / blocked approvals)
  // sits after the snapshot it derives from, ahead of session continuity.
  'proactive_surfacing',
  'last_session',
];

/**
 * Cache-stability tag per section (research rule: breakpoints derive from
 * tags, not hand placement). Today every section in this registry sits in
 * the per-turn dynamic tail below the cache boundary — the frozen prefix is
 * the base personality prompt built upstream. The tag exists so a future
 * pass can promote genuinely stable sections (e.g. skills metadata) above
 * the boundary without inventing a second ordering mechanism.
 */
export type ChatPromptSectionStability = 'frozen' | 'turn';

export const CHAT_PROMPT_SECTION_STABILITY: Readonly<
  Record<ChatPromptSectionKey, ChatPromptSectionStability>
> = {
  runtime_bundle: 'turn',
  task_pipeline: 'turn',
  computer_request_route: 'turn',
  computer_strategy: 'turn',
  computer_grounding: 'turn',
  design_automation: 'turn',
  design_execution_pipeline: 'turn',
  design_creative_ai: 'turn',
  design_creative_ai_recipe: 'turn',
  design_object_manifest: 'turn',
  design_operation_runbook: 'turn',
  design_proof_review: 'turn',
  cad_operation_runbook: 'turn',
  computer_receipt: 'turn',
  collab_manifest: 'turn',
  collab_note: 'turn',
  blackswan_grounding: 'turn',
  connected_resources: 'turn',
  user_chat_profile: 'turn',
  memory_user_notes: 'turn',
  memory_user_profile: 'turn',
  memory_runtime: 'turn',
  memory_working: 'turn',
  soul_wisdom: 'turn',
  turn_retrieval: 'turn',
  wiki_context: 'turn',
  attachment_context: 'turn',
  codebase_mentions: 'turn',
  project_discovery: 'turn',
  project_conventions: 'turn',
  skills: 'turn',
  agent_identity: 'turn',
  missions: 'turn',
  circle_snapshot: 'turn',
  proactive_surfacing: 'turn',
  last_session: 'turn',
};

export interface ChatPromptSectionInput {
  key: ChatPromptSectionKey;
  body: string;
}

// ─── Assembly ───────────────────────────────────────────────────────────────

/**
 * Cache boundary — everything ABOVE it in the final prompt is the stable
 * base (personality, rules, capabilities) that Anthropic's prompt caching
 * can reuse across turns; everything BELOW is the dynamic per-turn tail.
 * Exact legacy bytes — do not edit without a cache-discipline review.
 */
export const CHAT_PROMPT_CACHE_BOUNDARY =
  '\n\n---\n<!-- dynamic context below — changes per turn -->\n';

export interface AssembledChatPromptExtras {
  /** Ordered, joined, budget-clipped extras text ('' when no sections rendered). */
  text: string;
  /** Which sections rendered, in emit order — stamp onto telemetry to audit prompt-shape drift. */
  rendered: Array<{ key: ChatPromptSectionKey; chars: number }>;
  /** True when the char budget truncated the tail. */
  clipped: boolean;
}

/**
 * Order sections canonically, join with '\n\n', clip to the tier budget.
 * The clip reproduces the legacy inline logic exactly: hard slice at
 * maxExtrasChars, then back off to the last newline when that newline sits
 * past 70% of the budget (avoids ending mid-word without discarding most of
 * the tail). Sections with empty/whitespace bodies are dropped. Unknown
 * ordering is impossible by type; duplicate keys keep insertion order.
 */
export function assembleChatPromptExtras(
  sections: ReadonlyArray<ChatPromptSectionInput>,
  opts: { maxExtrasChars: number; prioritizeOnClip?: boolean },
): AssembledChatPromptExtras {
  const ordered: ChatPromptSectionInput[] = [];
  for (const key of CHAT_PROMPT_SECTION_ORDER) {
    for (const section of sections) {
      if (section.key !== key) continue;
      if (!section.body || !section.body.trim()) continue;
      ordered.push(section);
    }
  }

  if (ordered.length === 0) return { text: '', rendered: [], clipped: false };

  const combinedFull = ordered.map((s) => s.body).join('\n\n');

  // Under budget — nothing to clip.
  if (combinedFull.length <= opts.maxExtrasChars) {
    return {
      text: combinedFull,
      rendered: ordered.map((s) => ({ key: s.key, chars: s.body.length })),
      clipped: false,
    };
  }

  // Over budget. Priority-aware fit (opt-in) keeps the highest-value sections —
  // even ones LATE in the canonical order (e.g. `last_session`, `turn_retrieval`)
  // — and drops or truncates low-priority ones, instead of the blunt tail-slice
  // that always sacrifices whatever renders last regardless of its value. When
  // the caller has not opted in, the legacy tail-slice below runs byte-identical.
  if (opts.prioritizeOnClip) {
    const plan = planSectionFit(
      ordered.map((s) => ({ key: s.key, tokens: s.body.length, priority: resolveSectionPriority(s.key) })),
      opts.maxExtrasChars,
    );
    const keepSet = new Set(plan.keep);
    const truncMap = new Map(plan.truncate.map((t) => [t.key, t.toTokens]));
    // Apply the per-key plan to the canonically-ordered sections. (Duplicate
    // keys are effectively absent in practice; the final char guard below keeps
    // the ≤ budget invariant even if one slips through.)
    const kept: Array<{ key: ChatPromptSectionKey; body: string }> = [];
    for (const s of ordered) {
      if (keepSet.has(s.key)) {
        kept.push({ key: s.key, body: s.body });
      } else if (truncMap.has(s.key)) {
        const to = truncMap.get(s.key) as number;
        if (to > 0) kept.push({ key: s.key, body: s.body.slice(0, to) });
      }
      // dropped keys are omitted
    }
    let combined = kept.map((s) => s.body).join('\n\n');
    // planSectionFit fits the bodies, not the '\n\n' separators — guard the
    // char ceiling against that join overhead.
    if (combined.length > opts.maxExtrasChars) combined = combined.slice(0, opts.maxExtrasChars);
    return {
      text: combined,
      rendered: kept.map((s) => ({ key: s.key, chars: s.body.length })),
      clipped: true,
    };
  }

  // Legacy tail-slice (unchanged): hard slice, then back off to the last newline
  // when it sits past 70% of the budget.
  let combined = combinedFull.slice(0, opts.maxExtrasChars);
  const lastBreak = combined.lastIndexOf('\n');
  if (lastBreak > opts.maxExtrasChars * 0.7) {
    combined = combined.slice(0, lastBreak);
  }
  return {
    text: combined,
    rendered: ordered.map((s) => ({ key: s.key, chars: s.body.length })),
    clipped: true,
  };
}

/**
 * Final composition: base prompt + cache boundary + dynamic tail. When no
 * extras rendered, returns the base UNCHANGED (no boundary) — the legacy
 * `if (extras.length === 0) return base` fast path.
 */
export function composeChatSystemPrompt(base: string, extrasText: string): string {
  if (!extrasText) return base;
  return base + CHAT_PROMPT_CACHE_BOUNDARY + extrasText;
}

/**
 * Drop the sections a lane already delivers through its own channel (the
 * X1 dedupe: the v2 session runtime carries these blocks in the user-message
 * ladder, so the assembler's message-derived copies are pure duplication in
 * the system tail). Non-mutating; unknown keys are simply absent.
 */
export function omitChatPromptSections(
  sections: ReadonlyArray<ChatPromptSectionInput>,
  omit: ReadonlyArray<ChatPromptSectionKey> | null | undefined,
): ChatPromptSectionInput[] {
  if (!omit || omit.length === 0) return [...sections];
  const omitSet = new Set(omit);
  return sections.filter((s) => !omitSet.has(s.key));
}

// ─── Lane contract ──────────────────────────────────────────────────────────

/**
 * The three-plus lanes that enter the shared assembler, and what each is
 * responsible for providing/suppressing. This is the typed statement of the
 * divergence the internal map found (2026-07-09): the assembler is shared
 * but the ENTERING CONTEXT differs per lane — the stream lane enters thin,
 * the batch lane pre-resolves collaboration + memory, and the v2 session
 * runtime prepends its own block ladder that DUPLICATES the assembler's
 * computer/design sections and re-recalls memory. Encoding the contract
 * here makes the gap auditable and gives the dedupe pass a pinned spec.
 */
export type ChatPromptLane = 'stream' | 'batch' | 'openswan_v2' | 'conversational_build';

export interface ChatPromptLaneSpec {
  lane: ChatPromptLane;
  /** Lane pre-resolves the model-collaboration plan before the assembler. */
  providesCollaborationPlan: boolean;
  /** Lane pre-resolves memory stores (assembler must NOT recall again when set). */
  providesMemoryStores: boolean;
  /** Lane sets a systemDirective that suppresses the collaboration menu (lean build turns). */
  suppressesCollaboration: boolean;
  /**
   * Sections this lane ALSO builds outside the assembler today — the
   * duplication debt. Dedupe direction (settled by the X1 code read): the
   * lane's own ladder KEEPS its copies — they are equal-or-richer (task
   * pipeline at limit 3, mode contract, agentic-coding prompt) and they
   * belong in the volatile user message, not the system tail — and the
   * ASSEMBLER omits exactly these keys via `omitChatPromptSections`. The
   * assembler's copies are derived from the ladder text itself, so they are
   * pure duplication (and can even be false-positive noise when a runbook
   * mentions another app's name).
   */
  duplicateSectionDebt: ChatPromptSectionKey[];
}

const LANE_SPECS: Readonly<Record<ChatPromptLane, ChatPromptLaneSpec>> = {
  stream: {
    lane: 'stream',
    providesCollaborationPlan: false,
    providesMemoryStores: false,
    suppressesCollaboration: false,
    duplicateSectionDebt: [],
  },
  batch: {
    lane: 'batch',
    providesCollaborationPlan: true,
    providesMemoryStores: true,
    suppressesCollaboration: false,
    duplicateSectionDebt: [],
  },
  openswan_v2: {
    lane: 'openswan_v2',
    providesCollaborationPlan: false,
    providesMemoryStores: true,
    suppressesCollaboration: false,
    // The v2 session runtime's pre-prompt ladder rebuilds these computer/
    // design blocks that buildSystemPromptAsync also emits for the same
    // message (openswanSessionRuntime.ts prompt ladder vs swanbot.ts extras).
    duplicateSectionDebt: [
      'task_pipeline',
      'computer_request_route',
      'computer_strategy',
      'computer_grounding',
      'design_automation',
      'design_execution_pipeline',
      'design_creative_ai',
      'design_creative_ai_recipe',
      'design_object_manifest',
      'design_operation_runbook',
      'design_proof_review',
      'cad_operation_runbook',
      'computer_receipt',
      'blackswan_grounding',
    ],
  },
  conversational_build: {
    lane: 'conversational_build',
    providesCollaborationPlan: false,
    providesMemoryStores: false,
    suppressesCollaboration: true,
    duplicateSectionDebt: [],
  },
};

export function getChatPromptLaneSpec(lane: ChatPromptLane): ChatPromptLaneSpec {
  return LANE_SPECS[lane];
}
