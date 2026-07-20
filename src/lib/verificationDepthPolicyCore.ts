/**
 * verificationDepthPolicyCore — the PURE "verification depth dial" for OpenSwan.
 *
 * Problem it fixes: OpenSwan's verification DEPTH does not adapt to the
 * risk/blast-radius of the change a run actually made.
 * `openswanTaskPlanner.buildVerification(kind, message)` picks checks from the
 * task KIND plus a few message keyword regexes, so the `required:true` set is
 * fixed per kind and blind to what got touched — a `build` whose message never
 * says "test/api/logic/bug" gets ONLY typecheck+integration_review required even
 * if it rewrote `supabase/migrations/*`, `authSession`, provider routing, or
 * billing, while a one-line copy tweak gets that same suite. `runAndFixGateCore`
 * only ensures the ALREADY-planned verification runs and passes;
 * `verificationCoverageCore` only SCORES executed÷auto-planned AFTER the fact.
 * Nothing decides WHICH checks must run as a function of the change's
 * sensitivity/breadth. This core is that missing dial: it maps the changed-file
 * set (paths + a delete flag only — never content) to a risk tier and the set of
 * auto-verifiable checks that MUST run before a run may claim "verified", then
 * applies that required set to the existing task plan (which planned checks to
 * upgrade required→true, which to ADD) and surfaces advisory manual follow-ups.
 *
 * It is the exact sibling of delegationSizingCore (which sizes specialist
 * fan-out to message complexity) but for verification depth vs changed-file risk.
 *
 * Composition: this core decides the REQUIRED set BEFORE finalization;
 * verificationCoverageCore then SCORES coverage against that required auto set,
 * and runAndFixGateCore nudges until the now-required checks pass.
 *
 * PURITY: ZERO runtime imports (loads under tsx/esbuild for smoke testing —
 * smoke: verification-depth-policy-core). No Date.now() / Math.random() / argless
 * `new Date()`. Frozen const maps. Every export is TOTAL: null / undefined /
 * wrong-type / NaN / Infinity / huge / cyclic / throwing-getter input yields a
 * safe, bounded, neutral result and NEVER throws. BOUNDED: every path scan is
 * length-capped, every array capped, exported MAX_* consts for the caps.
 * SECRET-SAFE: outputs carry only fixed-vocabulary risk CATEGORIES + kind names +
 * counts — NEVER a raw changed-file path (the reason string is assembled purely
 * from that fixed vocabulary, so no user-influenced text can leak).
 */

// ── Mirrored vocabularies (mirrored by COMMENT, deliberately NOT imported so this
//    core stays import-free and tsx-loadable) ──────────────────────────────────
// AUTO-verifiable check kinds mirror verificationCoverageCore.AUTO_VERIFIABLE_CHECK_KINDS
//   ('typecheck' | 'tests' | 'lint' | 'build' | 'preview'). This core owns the
//   subset MINUS 'preview' — a UI/visual preview stays caller/human-driven and is
//   never auto-required as a function of change risk.
// The full plan vocabulary is openswanTaskPlanner.OpenSwanVerificationKind
//   ('typecheck'|'tests'|'lint'|'preview'|'manual_review'|'security_review'|
//    'performance_review'|'integration_review'). `manualReviewKinds` below draws
//   only from the non-auto advisory subset ('security_review'|'integration_review').

// ── Types ───────────────────────────────────────────────────────────────────────

export type VerificationRiskTier = 'low' | 'elevated' | 'high';

/** The auto-verifiable check kinds this core may REQUIRE (preview excluded). */
export type AutoVerifiableKind = 'typecheck' | 'tests' | 'lint' | 'build';

/** Fixed risk vocabulary. `app-code` is the neutral fallback for a code-bearing
 *  path that matches no sensitive keyword. */
export type RiskCategory =
  | 'schema'
  | 'auth'
  | 'payments'
  | 'edge'
  | 'provider-routing'
  | 'config'
  | 'app-code';

/** Secret-safe changed-file signal: only a path and a delete flag, never content. */
export interface ChangedFileSignal {
  path?: unknown;
  deleted?: unknown;
}

export interface VerificationDepthInput {
  /** Array<string | ChangedFileSignal> — the files the run actually touched. */
  changedFiles?: unknown;
  /** Optional task kind (informational; docs/research keep depth light). */
  taskKind?: unknown;
  /** Optional Array<{ kind?: unknown; required?: unknown; id?: unknown }> —
   *  the existing taskPlan.verification to apply the required set to. */
  plannedChecks?: unknown;
  /** Optional number|boolean — a delete/drop/reset ran this session. */
  destructiveOps?: unknown;
}

export interface VerificationDepthDecision {
  /** Overall risk tier for the change set. */
  riskTier: VerificationRiskTier;
  /** Auto checks that MUST run given the risk (ascending, deduped). */
  requiredKinds: AutoVerifiableKind[];
  /** Indices into plannedChecks whose required=false must be flipped to true
   *  (strictly ascending, unique, in-range). */
  upgradeIndices: number[];
  /** requiredKinds not covered by any planned check → the caller ADDS these. */
  missingKinds: AutoVerifiableKind[];
  /** Advisory non-auto follow-ups (security_review / integration_review), cap 3.
   *  ADVISORY ONLY — never auto-run. */
  manualReviewKinds: string[];
  /** Detected risk categories (sorted, deduped, bounded). */
  categories: RiskCategory[];
  /** Distinct code-bearing files (doc/image/binary excluded). */
  codeFileCount: number;
  /** Bounded (<=MAX_REASON_LEN); categories + counts only, never a path. */
  reason: string;
}

/** Options for {@link classifyChangedFileRisk}. */
export interface ClassifyRiskOptions {
  /** Cap on how many changed-file entries to scan (clamped to MAX_CHANGED_FILES).
   *  Non-positive / non-finite / wrong-type → the default cap. */
  maxFiles?: unknown;
}

// ── Caps (exported so wiring shares the exact same bounds) ──────────────────────

/** Max changed-file entries scanned for a hostile/huge array. */
export const MAX_CHANGED_FILES = 5000;
/** Max chars of any single path examined (a huge path is sliced to this). */
export const MAX_PATH_SCAN = 1024;
/** Max planned-check entries scanned for a hostile/huge plan. */
export const MAX_PLANNED_CHECKS = 100_000;
/** Max length of the reason string. */
export const MAX_REASON_LEN = 240;
/** Max categories reported (there are only 7 distinct categories). */
export const MAX_CATEGORIES = 7;
/** Max advisory manual-review kinds reported. */
export const MAX_MANUAL_REVIEW_KINDS = 3;

/** The full risk vocabulary, ordered. */
export const RISK_CATEGORIES: readonly RiskCategory[] = Object.freeze([
  'schema',
  'auth',
  'payments',
  'edge',
  'provider-routing',
  'config',
  'app-code',
] as const);

/** The auto-verifiable kinds this core may require, ascending. */
export const AUTO_VERIFIABLE_KINDS: readonly AutoVerifiableKind[] = Object.freeze([
  'build',
  'lint',
  'tests',
  'typecheck',
] as const);

/** The advisory manual-review kinds this core may emit. */
export const MANUAL_REVIEW_KINDS: readonly string[] = Object.freeze([
  'integration_review',
  'security_review',
] as const);

/** Neutral reason used when depth policy fails on malformed input. */
const NEUTRAL_REASON =
  'WARNING depth policy failed on malformed input — defaulting to low';

// ── Frozen keyword maps ─────────────────────────────────────────────────────────

/** HIGH-risk category keywords (substring match on a lowercased path). */
const HIGH_CATEGORY_KEYWORDS: Readonly<Record<'schema' | 'auth' | 'payments', readonly string[]>> =
  Object.freeze({
    schema: Object.freeze(['migrations/', '.sql']),
    auth: Object.freeze([
      'auth',
      'session',
      'oauth',
      'credential',
      'vault',
      'secret',
      'token',
      'login',
    ]),
    payments: Object.freeze(['billing', 'payment', 'wallet', 'stripe', 'invoice', 'charge']),
  });

/** ELEVATED-risk category keywords (substring match on a lowercased path). */
const ELEVATED_CATEGORY_KEYWORDS: Readonly<
  Record<'edge' | 'provider-routing' | 'config', readonly string[]>
> = Object.freeze({
  edge: Object.freeze(['supabase/functions/', '/api/', 'edge', 'server']),
  'provider-routing': Object.freeze(['provider', 'routing', 'llm-proxy', 'crossprovider']),
  config: Object.freeze([
    'package.json',
    'tsconfig',
    '.env',
    'app.json',
    'netlify',
    '.github/',
    'dockerfile',
    '.yml',
    '.yaml',
  ]),
});

/** Doc extensions — a path ending in one contributes NO category and NO breadth. */
const DOC_EXTENSIONS: readonly string[] = Object.freeze(['.md', '.mdx', '.txt', '.rst']);

/** Image/binary extensions — likewise non-code-bearing. */
const IMAGE_BINARY_EXTENSIONS: readonly string[] = Object.freeze([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.mp4',
  '.mov',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.icns',
]);

/** Tier → the ascending, deduped auto-verifiable set that tier requires. */
const DEPTH_BY_TIER: Readonly<Record<VerificationRiskTier, readonly AutoVerifiableKind[]>> =
  Object.freeze({
    low: Object.freeze(['typecheck'] as const),
    elevated: Object.freeze(['tests', 'typecheck'] as const),
    high: Object.freeze(['build', 'lint', 'tests', 'typecheck'] as const),
  });

// ── Internal scan shape (superset of the public classifier result) ──────────────

interface InternalScan {
  categories: RiskCategory[];
  codeFileCount: number;
  highHit: boolean;
  elevatedHit: boolean;
  /** Distinct code-bearing files flagged deleted (folds into destructive). */
  deletedCodeFileCount: number;
}

const EMPTY_SCAN: InternalScan = Object.freeze({
  categories: [],
  codeFileCount: 0,
  highHit: false,
  elevatedHit: false,
  deletedCodeFileCount: 0,
});

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Slice-then-lowercase a candidate path, returning null for unusable values. */
function normalizePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const sliced = raw.length > MAX_PATH_SCAN ? raw.slice(0, MAX_PATH_SCAN) : raw;
    const normalized = sliced.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  } catch {
    // Exotic string subclass / throwing length or slice — treat as no path.
    return null;
  }
}

/** True for a value that means "yes, deleted/destructive". */
function isTruthyFlag(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Pull a (path, deleted) pair off a changed-file entry without throwing. */
function readEntry(entry: unknown): { path: string | null; deleted: boolean } {
  if (typeof entry === 'string') return { path: normalizePath(entry), deleted: false };
  if (entry && typeof entry === 'object') {
    let rawPath: unknown;
    let rawDeleted: unknown;
    try {
      rawPath = (entry as { path?: unknown }).path;
    } catch {
      rawPath = undefined;
    }
    try {
      rawDeleted = (entry as { deleted?: unknown }).deleted;
    } catch {
      rawDeleted = undefined;
    }
    return { path: normalizePath(rawPath), deleted: isTruthyFlag(rawDeleted) };
  }
  return { path: null, deleted: false };
}

/** True when a lowercased path is a doc / image / binary (non-code-bearing). */
function isDocOrImagePath(path: string): boolean {
  for (const ext of DOC_EXTENSIONS) if (path.endsWith(ext)) return true;
  if (path.startsWith('docs/') || path.includes('/docs/')) return true;
  for (const ext of IMAGE_BINARY_EXTENSIONS) if (path.endsWith(ext)) return true;
  return false;
}

/** True when any keyword is a substring of the (already lowercased) path. */
function matchesAny(path: string, keywords: readonly string[]): boolean {
  for (const kw of keywords) if (path.includes(kw)) return true;
  return false;
}

/** All risk categories a code-bearing path matches (never empty → app-code). */
function classifyPathCategories(path: string): RiskCategory[] {
  const cats: RiskCategory[] = [];
  if (matchesAny(path, HIGH_CATEGORY_KEYWORDS.schema)) cats.push('schema');
  if (matchesAny(path, HIGH_CATEGORY_KEYWORDS.auth)) cats.push('auth');
  if (matchesAny(path, HIGH_CATEGORY_KEYWORDS.payments)) cats.push('payments');
  if (matchesAny(path, ELEVATED_CATEGORY_KEYWORDS.edge)) cats.push('edge');
  if (matchesAny(path, ELEVATED_CATEGORY_KEYWORDS['provider-routing'])) cats.push('provider-routing');
  if (matchesAny(path, ELEVATED_CATEGORY_KEYWORDS.config)) cats.push('config');
  if (cats.length === 0) cats.push('app-code');
  return cats;
}

/** Sort + dedupe a category set, bounded to MAX_CATEGORIES. */
function sortCategories(catSet: Set<RiskCategory>): RiskCategory[] {
  const arr = Array.from(catSet).sort();
  return arr.length > MAX_CATEGORIES ? arr.slice(0, MAX_CATEGORIES) : arr;
}

/** Sort + dedupe an auto-verifiable kind list, ascending. */
function dedupeSortKinds(kinds: AutoVerifiableKind[]): AutoVerifiableKind[] {
  return Array.from(new Set(kinds)).sort();
}

/** Resolve the scan cap from opts, clamped to MAX_CHANGED_FILES. */
function resolveMaxFiles(opts: ClassifyRiskOptions | null | undefined): number {
  if (opts && typeof opts === 'object') {
    try {
      const raw = (opts as { maxFiles?: unknown }).maxFiles;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        const floored = Math.floor(raw);
        return floored < MAX_CHANGED_FILES ? floored : MAX_CHANGED_FILES;
      }
    } catch {
      // Throwing getter — fall through to default.
    }
  }
  return MAX_CHANGED_FILES;
}

/** Single bounded, never-throwing scan of the changed-file set. */
function scanChangedFiles(changedFiles: unknown, maxFiles: number): InternalScan {
  // Fresh categories array: EMPTY_SCAN.categories is a shared module-level array
  // and Object.freeze is shallow, so spreading its reference would let a consumer
  // that mutates the returned `.categories` contaminate every later empty/non-array
  // decision. Every other returned array is built fresh per call; match that here.
  if (!Array.isArray(changedFiles)) return { ...EMPTY_SCAN, categories: [] };
  const length = changedFiles.length;
  const cap = maxFiles < MAX_CHANGED_FILES ? maxFiles : MAX_CHANGED_FILES;
  const limit = length < cap ? length : cap;

  const seen = new Set<string>();
  const deletedPaths = new Set<string>();
  const catSet = new Set<RiskCategory>();
  let codeFileCount = 0;
  let highHit = false;
  let elevatedHit = false;
  let deletedCodeFileCount = 0;

  for (let i = 0; i < limit; i += 1) {
    let entry: unknown;
    try {
      entry = changedFiles[i];
    } catch {
      // Hostile indexed getter — skip this slot.
      continue;
    }
    const { path, deleted } = readEntry(entry);
    if (path === null) continue;
    const firstSeen = !seen.has(path);
    if (firstSeen) seen.add(path);
    if (isDocOrImagePath(path)) continue; // non-code-bearing: no count, no cats
    // OR the deleted flag across all entries of a code-bearing path (folded once
    // per path) so a later deleted:true can't be suppressed by an earlier
    // un-deleted entry claiming the dedup slot first — risk must not depend on
    // the order of otherwise-equivalent entries.
    if (deleted && !deletedPaths.has(path)) {
      deletedPaths.add(path);
      deletedCodeFileCount += 1;
    }
    if (!firstSeen) continue; // distinct paths only for count + classification
    codeFileCount += 1;
    const cats = classifyPathCategories(path);
    for (const c of cats) {
      catSet.add(c);
      if (c === 'schema' || c === 'auth' || c === 'payments') highHit = true;
      else if (c === 'edge' || c === 'provider-routing' || c === 'config') elevatedHit = true;
    }
  }

  return {
    categories: sortCategories(catSet),
    codeFileCount,
    highHit,
    elevatedHit,
    deletedCodeFileCount,
  };
}

/** Breadth tier from the distinct code-bearing file count. */
function breadthTier(codeFileCount: number): VerificationRiskTier {
  if (codeFileCount >= 8) return 'high';
  if (codeFileCount >= 3) return 'elevated';
  return 'low';
}

/** Read a planned check's (kind, requiredFalsy) without traversing/throwing. */
function readPlannedCheck(item: unknown): { kind: string | null; requiredFalsy: boolean } {
  if (!item || typeof item !== 'object') return { kind: null, requiredFalsy: true };
  let rawKind: unknown;
  let rawRequired: unknown;
  try {
    rawKind = (item as { kind?: unknown }).kind;
  } catch {
    rawKind = undefined;
  }
  try {
    rawRequired = (item as { required?: unknown }).required;
  } catch {
    rawRequired = undefined;
  }
  const kind = typeof rawKind === 'string' ? rawKind.trim().toLowerCase() : null;
  // The plan stores `required: boolean`; only a literal true is "already required".
  return { kind, requiredFalsy: rawRequired !== true };
}

/** Apply the required set to the existing plan: which indices to upgrade, which
 *  kinds are missing. Single bounded scan of plannedChecks. */
function applyToPlannedChecks(
  requiredKinds: AutoVerifiableKind[],
  plannedChecks: unknown,
): { upgradeIndices: number[]; missingKinds: AutoVerifiableKind[] } {
  const presentKinds = new Set<string>();
  const falsyIndicesByKind = new Map<string, number[]>();

  if (Array.isArray(plannedChecks)) {
    const length = plannedChecks.length;
    const limit = length < MAX_PLANNED_CHECKS ? length : MAX_PLANNED_CHECKS;
    for (let i = 0; i < limit; i += 1) {
      let item: unknown;
      try {
        item = plannedChecks[i];
      } catch {
        continue;
      }
      const { kind, requiredFalsy } = readPlannedCheck(item);
      if (kind === null) continue;
      presentKinds.add(kind);
      if (requiredFalsy) {
        const arr = falsyIndicesByKind.get(kind);
        if (arr) arr.push(i);
        else falsyIndicesByKind.set(kind, [i]);
      }
    }
  }

  const upgradeSet = new Set<number>();
  const missing: AutoVerifiableKind[] = [];
  for (const kind of requiredKinds) {
    if (presentKinds.has(kind)) {
      const idxs = falsyIndicesByKind.get(kind);
      if (idxs) for (const idx of idxs) upgradeSet.add(idx);
    } else {
      missing.push(kind);
    }
  }

  const upgradeIndices = Array.from(upgradeSet).sort((a, b) => a - b);
  return { upgradeIndices, missingKinds: dedupeSortKinds(missing) };
}

/** Advisory manual follow-ups implied by the categories. Sorted, deduped, cap 3. */
function buildManualReviewKinds(
  categories: RiskCategory[],
  breadthAtLeastElevated: boolean,
): string[] {
  const set = new Set<string>();
  const has = (c: RiskCategory): boolean => categories.indexOf(c) >= 0;
  if (has('auth') || has('payments')) set.add('security_review');
  if (has('schema')) set.add('integration_review');
  if ((has('config') || has('provider-routing')) && breadthAtLeastElevated) {
    set.add('integration_review');
  }
  const arr = Array.from(set).sort();
  return arr.length > MAX_MANUAL_REVIEW_KINDS ? arr.slice(0, MAX_MANUAL_REVIEW_KINDS) : arr;
}

/** Assemble the bounded, path-free reason string from fixed vocabulary only. */
function buildReason(
  tier: VerificationRiskTier,
  codeFileCount: number,
  categories: RiskCategory[],
  requiredKinds: AutoVerifiableKind[],
  manualReviewKinds: string[],
): string {
  const catPart = categories.length > 0 ? categories.join(',') : 'none';
  const reqPart = requiredKinds.length > 0 ? requiredKinds.join(',') : 'none';
  let reason = `${tier} risk — ${codeFileCount} code file(s); categories: ${catPart}; require: ${reqPart}`;
  if (manualReviewKinds.length > 0) reason += `; manual: ${manualReviewKinds.join(',')}`;
  return reason.length > MAX_REASON_LEN ? reason.slice(0, MAX_REASON_LEN) : reason;
}

function neutralDecision(): VerificationDepthDecision {
  return {
    riskTier: 'low',
    requiredKinds: [],
    upgradeIndices: [],
    missingKinds: [],
    manualReviewKinds: [],
    categories: [],
    codeFileCount: 0,
    reason: NEUTRAL_REASON,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Classify a changed-file set into risk categories + a distinct code-file count.
 * Path-substring classifier (lowercased, per-path length-capped). Code-bearing
 * filter runs FIRST: docs (.md/.mdx/.txt/.rst or under docs/) and image/binary
 * files contribute NO category and NO breadth. Total: any input (null / wrong
 * type / cyclic / throwing getter / huge) yields a safe, bounded result.
 */
export function classifyChangedFileRisk(
  changedFiles: unknown,
  opts?: ClassifyRiskOptions,
): { categories: RiskCategory[]; codeFileCount: number; highHit: boolean; elevatedHit: boolean } {
  try {
    const scan = scanChangedFiles(changedFiles, resolveMaxFiles(opts));
    return {
      categories: scan.categories,
      codeFileCount: scan.codeFileCount,
      highHit: scan.highHit,
      elevatedHit: scan.elevatedHit,
    };
  } catch {
    return { categories: [], codeFileCount: 0, highHit: false, elevatedHit: false };
  }
}

/**
 * Decide the verification depth for a run given the change it actually made.
 *
 * Deterministic precedence:
 *   breadth (distinct code files): <=2 low, 3..7 elevated, >=8 high.
 *   tier: codeFileCount===0 → LOW with requiredKinds=[] (nothing to auto-verify).
 *     Else HIGH iff any HIGH category OR breadth=high OR (destructive AND (any
 *     elevated/high category OR breadth>=elevated)); ELEVATED iff any ELEVATED
 *     category OR breadth=elevated OR destructive; else LOW.
 *   depth: LOW→[typecheck]; ELEVATED→[tests,typecheck]; HIGH→[build,lint,tests,typecheck].
 *   ("destructive" = destructiveOps truthy OR any deleted code-bearing file.)
 *
 * Then apply the required set to plannedChecks (upgrade required-falsy indices,
 * report missing kinds) and derive advisory manualReviewKinds. Total: any
 * malformed input returns the neutral low decision (never throws).
 */
export function planVerificationDepth(
  input: VerificationDepthInput | null | undefined,
): VerificationDepthDecision {
  try {
    const source = input && typeof input === 'object' ? (input as VerificationDepthInput) : null;

    let changedFiles: unknown;
    let plannedChecks: unknown;
    let destructiveOps: unknown;
    if (source) {
      try {
        changedFiles = source.changedFiles;
      } catch {
        changedFiles = undefined;
      }
      try {
        plannedChecks = source.plannedChecks;
      } catch {
        plannedChecks = undefined;
      }
      try {
        destructiveOps = source.destructiveOps;
      } catch {
        destructiveOps = undefined;
      }
    }

    const scan = scanChangedFiles(changedFiles, MAX_CHANGED_FILES);
    const { codeFileCount } = scan;
    const destructive = isTruthyFlag(destructiveOps) || scan.deletedCodeFileCount > 0;
    const bt = breadthTier(codeFileCount);
    const breadthAtLeastElevated = codeFileCount >= 3;

    let riskTier: VerificationRiskTier;
    let requiredKinds: AutoVerifiableKind[];
    if (codeFileCount === 0) {
      // Nothing to auto-verify — the "light touch for trivial" direction.
      riskTier = 'low';
      requiredKinds = [];
    } else {
      const high =
        scan.highHit ||
        bt === 'high' ||
        (destructive && (scan.highHit || scan.elevatedHit || breadthAtLeastElevated));
      if (high) riskTier = 'high';
      else if (scan.elevatedHit || bt === 'elevated' || destructive) riskTier = 'elevated';
      else riskTier = 'low';
      requiredKinds = [...DEPTH_BY_TIER[riskTier]];
    }

    const { upgradeIndices, missingKinds } = applyToPlannedChecks(requiredKinds, plannedChecks);
    const manualReviewKinds = buildManualReviewKinds(scan.categories, breadthAtLeastElevated);
    const reason = buildReason(
      riskTier,
      codeFileCount,
      scan.categories,
      requiredKinds,
      manualReviewKinds,
    );

    return {
      riskTier,
      requiredKinds,
      upgradeIndices,
      missingKinds,
      manualReviewKinds,
      categories: scan.categories,
      codeFileCount,
      reason,
    };
  } catch {
    // Hostile input (throwing getters on `input` itself) — safe neutral.
    return neutralDecision();
  }
}
