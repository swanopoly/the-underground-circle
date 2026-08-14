/**
 * capabilityFallbackCore — capability-aware model fallback (PURE).
 *
 * The MODEL/PROVIDER FLEXIBILITY axis already owns cost-DOWN
 * (budgetModelDownshiftCore), provider-error advance (providerErrorAdvanceCore),
 * backoff (providerBackoffCore), and window-FITTING (modelContextBudgetCore).
 * What it lacked in the GENERAL case is the axis's own promise that "a turn
 * still succeeds when the picked model LACKS a needed capability" — tools,
 * vision, native computer-use, or long context.
 *
 * The ONLY capability substitution that exists today is BlackSwan-specific:
 * `resolveOpenSwanToolLoopModel` swaps to a tool executor ONLY when
 * `isBlackSwanModel(model)` ("Non-BlackSwan models pass through unchanged"), so
 * a real turn silently degrades when:
 *   (a) a user picks a no-tool model (sonar-pro / deepseek-r1) with tools on —
 *       the tool loop runs on a model that can't call tools;
 *   (b) a user picks a text-only model (vision:false) and attaches an image —
 *       the image is dropped;
 *   (c) a turn needs native computer-use but the model isn't Sonnet-capable;
 *   (d) an assembled prompt exceeds an 8k/16k-window model (gpt-4, llama-3-8b).
 *
 * This core is the missing pure decision: map (turn's REQUIRED capabilities +
 * the picked model's capability PROFILE) → the minimal capability-preserving
 * substitute, or an honest "no substitute" when the always-routable Anthropic
 * spine can't cover the gap (e.g. a >200k context need with no long-context
 * provider connected).
 *
 * Composition (not duplication):
 *   - budgetModelDownshiftCore pushes cost DOWN on a spend ratio (never checks
 *     capabilities); this pushes capability UP on a requirement — it can even
 *     override a downshift (budget says haiku, but computer-use is needed →
 *     escalate to sonnet). They compose.
 *   - modelContextBudgetCore RESIZES the prompt to a known window; this treats
 *     overflow as ONE gap and substitutes a bigger-window model, consuming
 *     getModelContextWindow's output as INJECTED input (no re-impl).
 *   - providerErrorAdvanceCore / crossProviderRouter change the PROVIDER for a
 *     fixed model after a transport error; this changes the MODEL by capability,
 *     pre-dispatch.
 *   - Its output can feed modelRouteExplainCore.explainRoute (fallbackFrom +
 *     reason) for the visible notice.
 *
 * Injection, not lookup: the selected model's OWN flags + contextWindow are
 * INJECTED by the caller (getModelCapabilityFlags(model) + getModelContextWindow
 * (model)), so the open-world selected id needs no inlined table and this core
 * stays pure. The canonical candidate SUBSTITUTES are a tiny inlined set whose
 * capability facts mirror modelCapabilities.ts exactly, so this core and the
 * caller's injected flags can never disagree about the same id.
 *
 * PURITY (load-bearing — the smoke runs under tsx/esbuild): a TYPE-ONLY import
 * from ./modelCapabilities (erased at build → no runtime coupling). No
 * Date.now()/Math.random(); frozen const maps. Every export is TOTAL —
 * null/undefined/wrong-type/hostile/huge/cyclic input yields a safe identity,
 * never a throw. BOUNDED (gaps ≤ MAX_CAPABILITY_GAPS; reason ≤ MAX_REASON_CHARS;
 * the provider scan is length-capped). SECRET-SAFE — the reason names only gap
 * enum kinds + the canonical substitute literal (a known-safe id) and NEVER
 * echoes the raw selected id into free text (the `model` field echoes the
 * caller's own selected id, exactly as budgetModelDownshiftCore returns
 * `original`).
 *
 * Smoke: scripts/capability-fallback-core-smoketest.ts.
 */

import type { ModelCapabilityFlags, ModelCodingTier } from './modelCapabilities';

// ─── Contract types ──────────────────────────────────────────────────────────

/** What THIS turn needs. The caller derives each field: tools enabled →
 *  toolUse; image attachment → vision; native screenshot loop → computerUse;
 *  assembled prompt tokens → minContextTokens; complex coding → minCodingTier. */
export interface RequiredCapabilities {
  toolUse?: boolean;
  vision?: boolean;
  computerUse?: boolean;
  /** Minimum context window (approx tokens) the assembled turn needs. */
  minContextTokens?: number;
  /** Minimum agentic-coding trust tier the turn needs. */
  minCodingTier?: 'basic' | 'strong';
}

/** The picked/resolved model's OWN capabilities, injected by the caller from
 *  getModelCapabilityFlags(model) + getModelContextWindow(model). Injected (not
 *  looked up here) so the open-world selected id needs no inlined table. */
export interface SelectedModelProfile {
  model: string;
  flags: ModelCapabilityFlags;
  /** From getModelContextWindow(model); null/undefined when unknown. */
  contextWindow?: number | null;
}

/** A single missing-capability kind. */
export type CapabilityGap =
  | 'tool_use'
  | 'vision'
  | 'computer_use'
  | 'context_window'
  | 'coding_tier';

/** Options for the substitution scan. */
export interface CapabilityFallbackOpts {
  /** Providers the user/circle has keys for. A candidate whose provider is NOT
   *  platform-default is eligible only when its provider is listed here. May be
   *  null, a bare string (ONE provider), or a junk non-iterable — all total. */
  connectedProviders?: Iterable<string> | null;
}

export interface CapabilityFallbackResult {
  /** The model to use. Echoes the caller's own selected id on any identity. */
  model: string;
  /** True only when we actually swapped in a capability-preserving substitute. */
  substituted: boolean;
  /** The gaps detected on the SELECTED model (stable order; empty on identity). */
  gaps: CapabilityGap[];
  /** Short, bounded, secret-free explanation (gap enum kinds + safe substitute
   *  literal only — never a raw echo of the selected id). */
  reason: string;
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

/** There are exactly five capability-gap kinds; the gaps array never exceeds
 *  this (each kind is pushed at most once). Exported as the documented cap. */
export const MAX_CAPABILITY_GAPS = 5;
/** Hard cap on the `reason` string length. */
export const MAX_REASON_CHARS = 160;
/** Hard cap on how many connectedProviders entries we scan (hostile huge array
 *  guard — no provider set need be larger than this). */
const MAX_PROVIDER_SCAN = 256;

// ─── Canonical substitute candidates (capability facts mirror modelCapabilities.ts) ─
//
// A tiny inlined ladder, cheapest → strongest. Every capability fact mirrors
// getModelCapabilityFlags() / getModelContextWindow() for the same id EXACTLY,
// so a candidate and the caller's injected flags for the same model can never
// disagree. platformDefault candidates ride the always-reachable Anthropic
// platform spine; the others are eligible only when their provider is connected.
//
// GPT-5.6 Terra is the current OpenAI long-context anchor. Its capability facts
// intentionally mirror modelCapabilities.ts; it remains a basic coding-tier
// substitute here because this ladder is for capability preservation rather
// than the stronger coding-model policy owned elsewhere.

const HAIKU_FLAGS: ModelCapabilityFlags = Object.freeze({
  toolUse: true,
  computerUse: false,
  vision: true,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: 8192,
  codingTier: 'basic',
});
/** The ONLY canonical candidate with native computer-use (Sonnet-capable). */
const SONNET_FLAGS: ModelCapabilityFlags = Object.freeze({
  toolUse: true,
  computerUse: true,
  vision: true,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: 8192,
  codingTier: 'strong',
});
const GEMINI_PRO_FLAGS: ModelCapabilityFlags = Object.freeze({
  toolUse: true,
  computerUse: false,
  vision: true,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: 8192,
  codingTier: 'strong',
});
const GPT_TERRA_FLAGS: ModelCapabilityFlags = Object.freeze({
  toolUse: true,
  computerUse: false,
  vision: true,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: null,
  codingTier: 'basic',
});

export interface CapabilityCandidate {
  id: string;
  provider: string;
  /** True for the always-reachable Anthropic platform spine (platform keys). */
  platformDefault: boolean;
  flags: ModelCapabilityFlags;
  contextWindow: number;
}

/**
 * The substitute ladder, cheapest → strongest. Iterated in order; the FIRST
 * eligible candidate that satisfies the FULL required set wins (minimal
 * substitute). A >200k context gap resolves only when google_ai/openai is
 * connected — otherwise the Anthropic spine tops out at 200k and we return an
 * honest identity+gaps (fail-closed honesty about "always-routable").
 */
export const CANONICAL_CAPABILITY_CANDIDATES: readonly CapabilityCandidate[] = Object.freeze([
  Object.freeze({ id: 'claude-haiku-4-5', provider: 'anthropic', platformDefault: true, flags: HAIKU_FLAGS, contextWindow: 200_000 }),
  Object.freeze({ id: 'claude-sonnet-4-6', provider: 'anthropic', platformDefault: true, flags: SONNET_FLAGS, contextWindow: 200_000 }),
  Object.freeze({ id: 'gemini-3.6-flash', provider: 'google_ai', platformDefault: false, flags: GEMINI_PRO_FLAGS, contextWindow: 1_048_576 }),
  Object.freeze({ id: 'gpt-5.6-terra', provider: 'openai', platformDefault: false, flags: GPT_TERRA_FLAGS, contextWindow: 1_050_000 }),
]);

// ─── Total primitives ────────────────────────────────────────────────────────

/** Read a property off an unknown without ever throwing (Proxy/getter-safe). */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Strict boolean — only the literal `true` counts (an unknown flag is false). */
function isTrue(v: unknown): boolean {
  return v === true;
}

/** A real finite number, or null. Rejects strings/booleans/NaN/±Infinity —
 *  mirrors modelContextBudgetCore's strict window typing. */
function toFiniteNumberStrict(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce a flags.codingTier field to a known tier (fail-closed 'none'). */
function toCodingTier(v: unknown): ModelCodingTier {
  return v === 'strong' ? 'strong' : v === 'basic' ? 'basic' : 'none';
}

/** Coerce a required.minCodingTier to a tier requirement, or null (no need). */
function toRequiredTier(v: unknown): ModelCodingTier | null {
  return v === 'strong' ? 'strong' : v === 'basic' ? 'basic' : null;
}

/** Rank the coding tiers: none < basic < strong. */
function codingRank(t: ModelCodingTier): number {
  return t === 'strong' ? 2 : t === 'basic' ? 1 : 0;
}

/** The four capability facts detectCapabilityGaps reads off a profile's flags. */
interface ReadFlags {
  toolUse: boolean;
  vision: boolean;
  computerUse: boolean;
  codingTier: ModelCodingTier;
}

/** Coerce an unknown flags object into the four booleans/tier we consult. */
function asFlags(rawFlags: unknown): ReadFlags {
  return {
    toolUse: isTrue(safeGet(rawFlags, 'toolUse')),
    vision: isTrue(safeGet(rawFlags, 'vision')),
    computerUse: isTrue(safeGet(rawFlags, 'computerUse')),
    codingTier: toCodingTier(safeGet(rawFlags, 'codingTier')),
  };
}

/** Coerce an unknown selected profile into {flags, contextWindow}. */
function asProfile(rawSelected: unknown): { flags: ReadFlags; contextWindow: number | null } {
  return {
    flags: asFlags(safeGet(rawSelected, 'flags')),
    contextWindow: toFiniteNumberStrict(safeGet(rawSelected, 'contextWindow')),
  };
}

/** Coerce an unknown required object into a normalized requirement. */
function asRequired(rawRequired: unknown): {
  toolUse: boolean;
  vision: boolean;
  computerUse: boolean;
  minContextTokens: number | null;
  minCodingTier: ModelCodingTier | null;
} {
  return {
    toolUse: isTrue(safeGet(rawRequired, 'toolUse')),
    vision: isTrue(safeGet(rawRequired, 'vision')),
    computerUse: isTrue(safeGet(rawRequired, 'computerUse')),
    minContextTokens: toFiniteNumberStrict(safeGet(rawRequired, 'minContextTokens')),
    minCodingTier: toRequiredTier(safeGet(rawRequired, 'minCodingTier')),
  };
}

// ─── Model id normalization (self-contained copy; mirrors normalizeModelId) ───
//
// Kept a local copy so this module stays type-only-import. Used ONLY to detect
// when a candidate resolves to the SAME model the caller already selected (a
// provider-prefixed `anthropic/claude-haiku-4-5` must not be "substituted" with
// the bare `claude-haiku-4-5` — that is the same model and would not help).

const PROVIDER_PREFIX_HEADS: ReadonlySet<string> = new Set<string>([
  'openrouter',
  'openai', 'openai_compatible',
  'anthropic',
  'google_ai', 'googleai', 'google',
  'deepseek',
  'huggingface', 'huggingface_endpoint', 'hugging_face', 'hf',
  'groq',
  'mistral', 'mistral_ai', 'mistralai',
  'cohere',
  'perplexity',
  'together', 'together_ai',
  'fireworks', 'fireworks_ai',
  'zai', 'z_ai',
  'minimax',
  'ollama',
  'github', 'github-models', 'github_models',
  'replicate',
  'openswan',
  'meta-llama', 'deepseek-ai', 'qwen', 'black-forest-labs', 'stabilityai',
  'moonshotai', 'x-ai',
]);

function normalizeModelIdLocal(modelId: string): string {
  let id = (modelId || '').trim().toLowerCase();
  if (!id) return '';
  for (;;) {
    const slashIdx = id.indexOf('/');
    if (slashIdx <= 0) break;
    const head = id.slice(0, slashIdx);
    const rest = id.slice(slashIdx + 1);
    if (!rest || !PROVIDER_PREFIX_HEADS.has(head)) break;
    id = rest;
  }
  return id;
}

// ─── Provider reachability (mirrors codingModelSplitPolicy toProviderSet) ─────

/** Canonicalize a provider token to the alias the candidate table keys on
 *  (google/googleai → google_ai; anthropic-direct → anthropic). */
function canonicalizeProvider(raw: string): string {
  const n = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (!n) return '';
  if (n === 'google' || n === 'googleai' || n === 'google_ai') return 'google_ai';
  if (n === 'anthropic-direct' || n === 'anthropic_direct') return 'anthropic';
  return n;
}

/**
 * Materialize `connectedProviders` into a normalized lowercase set. Total:
 * null/undefined → empty; a bare string is ONE provider name (never iterated
 * char-by-char); non-string entries and junk non-iterables are dropped; the
 * scan is length-capped so a hostile huge array can't build an unbounded set.
 */
function toProviderSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (value == null) return out;
  if (typeof value === 'string') {
    const one = canonicalizeProvider(value);
    if (one) out.add(one);
    return out;
  }
  try {
    let scanned = 0;
    for (const entry of value as Iterable<unknown>) {
      if (scanned >= MAX_PROVIDER_SCAN) break;
      scanned += 1;
      if (typeof entry !== 'string') continue;
      const provider = canonicalizeProvider(entry);
      if (provider) out.add(provider);
    }
  } catch {
    /* non-iterable junk → treated as no providers listed */
  }
  return out;
}

// ─── Gap detection ───────────────────────────────────────────────────────────

/**
 * Which required capabilities the selected model is MISSING. Stable push order:
 * tool_use → vision → computer_use → coding_tier → context_window. A
 * context_window gap fires ONLY when the requirement is a finite number AND the
 * model's window is a KNOWN finite number below it — an unknown window yields NO
 * gap (fail-open, mirroring modelContextBudgetCore). TOTAL: any hostile input
 * (null/wrong-type/throwing getters/cyclic) yields whatever gaps were safely
 * accumulated, never a throw.
 */
export function detectCapabilityGaps(selected: SelectedModelProfile, required: RequiredCapabilities): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  try {
    const { flags, contextWindow } = asProfile(selected);
    const req = asRequired(required);
    if (req.toolUse && !flags.toolUse) gaps.push('tool_use');
    if (req.vision && !flags.vision) gaps.push('vision');
    if (req.computerUse && !flags.computerUse) gaps.push('computer_use');
    if (req.minCodingTier && codingRank(req.minCodingTier) > codingRank(flags.codingTier)) {
      gaps.push('coding_tier');
    }
    if (req.minContextTokens !== null && contextWindow !== null && contextWindow < req.minContextTokens) {
      gaps.push('context_window');
    }
  } catch {
    /* partial (bounded) gaps returned; never throws */
  }
  return gaps.slice(0, MAX_CAPABILITY_GAPS);
}

// ─── Reasons (secret-safe: gap enums + safe candidate literal only) ───────────

const SATISFIES_REASON = 'model satisfies all required capabilities';

function capReason(s: string): string {
  return s.length > MAX_REASON_CHARS ? s.slice(0, MAX_REASON_CHARS) : s;
}

function buildSubstituteReason(candidateId: string, gaps: CapabilityGap[]): string {
  return capReason(`substituted ${candidateId} — covers ${gaps.join(', ')}`);
}

function buildNoSubstituteReason(gaps: CapabilityGap[]): string {
  return capReason(`no eligible substitute covers ${gaps.join(', ')} — keeping selected model`);
}

// ─── Fallback resolution ─────────────────────────────────────────────────────

/**
 * Resolve a capability-preserving substitute for a picked model.
 *
 *   - No gaps → IDENTITY `{ model: selected.model, substituted:false, gaps:[] }`
 *     (no regression; the caller's pick stands untouched).
 *   - Some gaps → scan the canonical candidate ladder (cheapest → strongest) for
 *     the FIRST candidate that (a) is eligible — platform-default OR its provider
 *     is in connectedProviders — AND (b) satisfies the FULL required set (its own
 *     detectCapabilityGaps is empty) AND (c) differs from the selected model.
 *     Found → substitute; none → IDENTITY with the gaps reported (fail-open on
 *     the ACTION: never swap into something that does not actually cover the gap
 *     — the caller then compacts / surfaces a notice).
 *
 * TOTAL: any hostile input yields a safe identity, never a throw. The `reason`
 * is bounded and secret-free (gap enum kinds + a known-safe candidate literal),
 * so a selected id shaped like an API key can never leak into free text.
 */
export function resolveCapabilityFallback(
  selected: SelectedModelProfile,
  required: RequiredCapabilities,
  opts?: CapabilityFallbackOpts,
): CapabilityFallbackResult {
  // Echo the caller's own selected id (as budgetModelDownshiftCore returns
  // `original`) — computed defensively so it survives even the outer catch.
  const rawModel = safeGet(selected, 'model');
  const originalModel = typeof rawModel === 'string' ? rawModel : '';

  try {
    const gaps = detectCapabilityGaps(selected, required);
    if (gaps.length === 0) {
      return { model: originalModel, substituted: false, gaps: [], reason: SATISFIES_REASON };
    }

    const providers = toProviderSet(safeGet(opts, 'connectedProviders'));
    const selNorm = normalizeModelIdLocal(originalModel);

    for (const cand of CANONICAL_CAPABILITY_CANDIDATES) {
      const eligible = cand.platformDefault || providers.has(cand.provider);
      if (!eligible) continue;
      // Candidate must satisfy the FULL required set (reuse the same detector).
      const candGaps = detectCapabilityGaps(
        { model: cand.id, flags: cand.flags, contextWindow: cand.contextWindow },
        required,
      );
      if (candGaps.length !== 0) continue;
      // Never "substitute" into the same underlying model (would not help).
      if (normalizeModelIdLocal(cand.id) === selNorm) continue;
      return {
        model: cand.id,
        substituted: true,
        gaps,
        reason: buildSubstituteReason(cand.id, gaps),
      };
    }

    // Fail-open on the action: no eligible substitute covers the gap.
    return { model: originalModel, substituted: false, gaps, reason: buildNoSubstituteReason(gaps) };
  } catch {
    // Total-failure fail-open: keep the caller's pick, report no gaps.
    return { model: originalModel, substituted: false, gaps: [], reason: SATISFIES_REASON };
  }
}
