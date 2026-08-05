/**
 * wordpressPostTypeResolver — pure helpers for resolving a WordPress custom
 * post type's REST `rest_base` and classifying whether it is publishable over
 * the REST API (vs. needing the wp-admin browser fail-over path).
 *
 * The WP `GET /wp/v2/types` endpoint returns a map keyed by the type slug,
 * each entry carrying `slug`, `rest_base`, `name`, and (on newer cores)
 * `show_in_rest`. Posting to a CPT must target `rest_base`, which is NOT always
 * equal to the slug (e.g. slug `flavor_di_slides` may expose `rest_base`
 * `di-slides`). These helpers translate a requested slug into the correct REST
 * base and flag types that cannot be published over REST.
 *
 * Dependency-light (no `fetch`, `import type` only, no runtime imports) so it
 * can be exercised by a standalone tsx smoke. Classification is pure: it only
 * emits a `needsAdminFallback` flag — it NEVER triggers or returns a browser
 * path itself. Wiring this into the actual publish call site (R5) is a
 * follow-on step tracked in the roadmap.
 */

export interface WpPostTypeEntry {
  slug?: string;
  rest_base?: string;
  name?: string;
  show_in_rest?: boolean;
}

export type WpPostTypeMap = Record<string, WpPostTypeEntry>;

export interface ResolvedRestBase {
  restBase: string;
  matchedSlug: string;
  source: 'discovered' | 'fallback';
}

/**
 * Resolve the REST base for a requested post-type slug from a discovery map.
 * Match priority: (1) exact key match, (2) an entry whose `.slug` equals the
 * requested slug, (3) an entry whose `.rest_base` already equals the request.
 * Falls back to the requested slug when nothing matches or when a matched
 * entry has no `rest_base`. Never throws.
 */
export function resolveRestBase(
  types: WpPostTypeMap | null | undefined,
  requestedSlug: string,
): ResolvedRestBase {
  const map = types && typeof types === 'object' ? types : {};

  // (1) exact key match
  const byKey = map[requestedSlug];
  if (byKey) {
    return {
      restBase: byKey.rest_base && byKey.rest_base.trim() ? byKey.rest_base : requestedSlug,
      matchedSlug: byKey.slug || requestedSlug,
      source: 'discovered',
    };
  }

  // (2) entry whose .slug matches
  for (const key of Object.keys(map)) {
    const entry = map[key];
    if (entry && entry.slug === requestedSlug) {
      return {
        restBase: entry.rest_base && entry.rest_base.trim() ? entry.rest_base : requestedSlug,
        matchedSlug: entry.slug || key,
        source: 'discovered',
      };
    }
  }

  // (3) caller may already have supplied the REST base instead of the slug.
  for (const key of Object.keys(map)) {
    const entry = map[key];
    if (entry && entry.rest_base === requestedSlug) {
      return {
        restBase: entry.rest_base,
        matchedSlug: entry.slug || key,
        source: 'discovered',
      };
    }
  }

  return { restBase: requestedSlug, matchedSlug: requestedSlug, source: 'fallback' };
}

export interface PostTypeWritability {
  restPublishable: boolean;
  reason: string;
  needsAdminFallback: boolean;
}

/**
 * Classify whether a discovered post-type entry can be published over the REST
 * API. `show_in_rest === false` or a missing `rest_base` force the admin
 * fallback; `show_in_rest === undefined` does NOT (older cores omit it, and the
 * decision rests on `rest_base` presence). Pure classification only — emits the
 * `needsAdminFallback` flag; never triggers a browser path.
 */
export function classifyPostTypeWritability(
  entry: WpPostTypeEntry | null | undefined,
): PostTypeWritability {
  if (!entry) {
    return {
      restPublishable: false,
      reason: 'post type not found in discovery map',
      needsAdminFallback: true,
    };
  }
  if (entry.show_in_rest === false) {
    return {
      restPublishable: false,
      reason: 'show_in_rest is false',
      needsAdminFallback: true,
    };
  }
  if (!entry.rest_base || !entry.rest_base.trim()) {
    return {
      restPublishable: false,
      reason: 'missing rest_base',
      needsAdminFallback: true,
    };
  }
  return {
    restPublishable: true,
    reason: 'rest_base present and show_in_rest not disabled',
    needsAdminFallback: false,
  };
}
