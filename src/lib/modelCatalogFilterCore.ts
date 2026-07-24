/**
 * modelCatalogFilterCore — the single source of truth for which models are
 * allowed to appear anywhere in the app, applied uniformly to EVERY dynamic
 * model feed (OpenRouter live catalog, the popularity-rankings feed, any
 * future auto-update source) as well as the deploy path.
 *
 * Why this exists: the model picker is fed from three dynamic sources today —
 * the OpenRouter `/models` live catalog, the openrouter-rankings "popular"
 * feed, and a static OpenRouter fallback shortlist — none of which passed
 * through the house "NO Grok / xAI" invariant that the hardcoded allowlist and
 * the model-catalog drift-guard enforce. So a banned vendor could (and did:
 * a hardcoded `openrouter/x-ai/grok-2` fallback entry, plus `x-ai` in the
 * live-fetch family list) slip into chat despite the policy. Centralizing the
 * gate here and running every dynamic feed through `filterDynamicModels` makes
 * the invariant hold by construction, no matter what a remote list returns.
 *
 * Pure / type-only: this module imports no runtime dependencies (only a type),
 * so it is loadable by tsx/esbuild for smoke tests — see
 * scripts/model-catalog-filter-core-smoketest.ts.
 */

/** Minimal shape this core needs from a model entry — anything with a string
 *  id. Kept structural so it accepts ModelOption, ChatModel, the raw
 *  OpenRouter `/models` row, etc., without importing any of them. */
export interface ModelIdBearing {
  id: string;
}

/** xAI provider tokens. Grok is matched separately (as a model family) so the
 *  bare `grok-...` form is caught even without an `x-ai` vendor segment. */
const BANNED_VENDOR_TOKENS: ReadonlySet<string> = new Set(['xai', 'x-ai', 'x_ai']);

/**
 * Banned-vendor gate (house invariant: NO Grok / xAI anywhere). Matches xAI's
 * provider tokens and the Grok model family in ANY `/`- or `:`-delimited
 * segment of the id, so passthrough forms like `openrouter/x-ai/grok-2`,
 * `openrouter/grok`, `xai/...`, and bare `grok-...` all fail closed. Kept
 * segment-scoped (not a raw substring scan) so an unrelated model whose name
 * merely contains these letters is never false-flagged.
 *
 * This is the relocated single source; `agentDeployModelPolicy` re-exports it
 * so the deploy path and every model feed share one definition.
 */
export function isBannedVendorModelId(id: string): boolean {
  const lower = (id || '').toLowerCase();
  if (!lower) return false;
  const segments = lower.split(/[/:]/).map((s) => s.trim()).filter(Boolean);
  return segments.some(
    (seg) => BANNED_VENDOR_TOKENS.has(seg) || seg === 'grok' || seg.startsWith('grok-'),
  );
}

/** The `<vendor>` segment of a provider-prefixed id, for optional family
 *  allow-listing. `openrouter/anthropic/claude-x` -> `anthropic`;
 *  `anthropic/claude-x` -> `anthropic`; bare `claude-x` -> `claude-x`. The
 *  OpenRouter `openrouter/` wrapper prefix is peeled first so the real vendor
 *  is inspected. */
export function modelFamilyOf(id: string): string {
  const segs = (id || '').toLowerCase().split('/').map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return '';
  if (segs[0] === 'openrouter' && segs.length > 1) return segs[1];
  return segs.length > 1 ? segs[0] : segs[0];
}

export interface FilterDynamicModelsOptions {
  /** When provided, keep only models whose vendor family is in this set
   *  (case-insensitive). Use to restrict a firehose feed to curated top
   *  families. Omit to allow every non-banned model through. */
  allowFamilies?: readonly string[];
}

/**
 * Filter a dynamic model feed: always drop banned vendors (Grok/xAI), and —
 * when `allowFamilies` is given — keep only curated top families. Preserves
 * input order and never throws on malformed entries (a missing/empty id is
 * dropped). Generic over any id-bearing shape so callers keep their own type.
 */
export function filterDynamicModels<T extends ModelIdBearing>(
  models: readonly T[] | null | undefined,
  opts: FilterDynamicModelsOptions = {},
): T[] {
  if (!Array.isArray(models)) return [];
  const allow = opts.allowFamilies
    ? new Set(opts.allowFamilies.map((f) => f.toLowerCase()))
    : null;
  return models.filter((m) => {
    const id = m && typeof m.id === 'string' ? m.id : '';
    if (!id) return false;
    if (isBannedVendorModelId(id)) return false;
    if (allow && !allow.has(modelFamilyOf(id))) return false;
    return true;
  });
}

/** Bare model id: strip an `openrouter/` wrapper and any vendor family, plus a
 *  `:variant` suffix, down to the model slug used to compare against the wired
 *  catalog. `openrouter/moonshotai/kimi-k3` -> `kimi-k3`; `kimi-k3` -> `kimi-k3`. */
export function bareModelSlug(id: string): string {
  const lower = (id || '').toLowerCase().replace(/^openrouter\//, '');
  const last = lower.split('/').pop() || '';
  return last.replace(/:.*$/, '');
}

export interface ModelFreshnessDiff {
  /** Live top-family model ids whose slug isn't in the wired catalog yet. */
  newTopModels: string[];
  /** How many live ids were in scope (top-family, non-banned) after filtering. */
  consideredCount: number;
  /** Distinct wired slugs the diff compared against. */
  wiredCount: number;
}

/**
 * Compute which currently-live models (e.g. from OpenRouter `/models`) are top
 * models NOT yet wired into the hardcoded catalog — the "a new top model came
 * out" signal that keeps the catalog auto-fresh. Pure: the caller does the
 * network fetch and the source-file read, this just diffs.
 *
 * A live id is reported when: it is not a banned vendor, its vendor family is
 * in `topFamilies`, and its bare slug is not already among the wired ids. This
 * flags a genuinely-new release (a future `moonshotai/kimi-k4`) while ignoring
 * the long tail of niche models by restricting to curated top families.
 */
export function computeModelFreshnessDiff(
  liveIds: readonly string[],
  wiredIds: readonly string[],
  opts: { topFamilies: readonly string[] },
): ModelFreshnessDiff {
  const top = new Set(opts.topFamilies.map((f) => f.toLowerCase()));
  const wired = new Set((wiredIds || []).map((id) => bareModelSlug(id)).filter(Boolean));
  const seen = new Set<string>();
  const newTopModels: string[] = [];
  let consideredCount = 0;
  for (const rawId of liveIds || []) {
    const id = typeof rawId === 'string' ? rawId : '';
    if (!id || isBannedVendorModelId(id)) continue;
    if (!top.has(modelFamilyOf(id))) continue;
    consideredCount += 1;
    const slug = bareModelSlug(id);
    if (!slug || wired.has(slug) || seen.has(id)) continue;
    seen.add(id);
    newTopModels.push(id);
  }
  newTopModels.sort();
  return { newTopModels, consideredCount, wiredCount: wired.size };
}
