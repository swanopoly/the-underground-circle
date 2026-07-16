// toolCatalogManifestCore — the ONE canonical tool-catalog normalizer that both
// the RN app (src/lib/openswanToolRuntime.ts) and the Deno edge
// (supabase/functions/swanbot-v2-ai/index.ts) derive the SAME manifest row from,
// so the two surfaces stop drifting apart (ADD #2 of
// docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md — "a single
// dependency-light tool-catalog source both surfaces import").
//
// The two surfaces describe a tool DIFFERENTLY today:
//   - app: OpenSwanToolDefinition { name, label, surfaces, description,
//     inputSchema?, modes?, disclosure? } + a SEPARATE getOpenSwanToolPolicy()
//     ({ family, approvalMode:'auto'|'ask', mutatesState, ... }) + a SEPARATE
//     getOpenSwanToolDisclosure() ('pinned'|'deferred', per-tool override →
//     family default → fail-closed 'deferred').
//   - edge: ToolDef { name, description, input_schema, handler, clientOnly? }
//     with NO policy/disclosure fields at all.
//
// This core flattens EITHER shape (and a merged app view that spreads the policy
// onto the definition) into one canonical `ToolManifestEntry`, reading the REAL
// field names off whatever is present with tolerant fallbacks:
//   - name         ← `name` (required non-empty string; else the row is junk)
//   - family       ← ALWAYS derived from the name prefix (the disclosure/NAME
//                    family: chars before the first '.', or the whole name for
//                    flat tools like `fetch_url`). Deliberately NAME-derived —
//                    never an explicit `family` field — so both surfaces compute
//                    the identical family from the name alone and family can
//                    never be a source of false drift.
//   - approvalMode ← `approvalMode` ('auto'|'ask'); fail-CLOSED to 'ask' when
//                    absent/invalid (never silently auto-approve an unknown tool)
//   - disclosure   ← `disclosure` ('pinned'|'deferred'); fail-CLOSED to
//                    'deferred' when absent/invalid (mirrors the real
//                    "unknown families fail closed to 'deferred'" rule)
//   - mutates      ← `mutatesState` (real policy field) ?? `mutates` ?? false
//   - hasSchema    ← a non-empty `inputSchema`/`input_schema`/`parameters`
//                    object is present ?? explicit boolean `hasSchema` ?? false
//   - summary      ← `summary` ?? `description` ?? `label`, TRIMMED + length-
//                    bounded. NEVER pulled from schema property values, keys,
//                    examples, defaults, or enums — only authored human text —
//                    so a manifest can never leak a secret example value.
//
// The payoff is `diffToolManifests(a, b)`: the DRIFT detector a CI check runs to
// prove app↔edge parity. It reports which tool names exist on only one surface
// and which names carry a different POLICY/DISCLOSURE (approvalMode, disclosure,
// or mutates) on the two surfaces. Descriptive fields that legitimately differ
// (summary wording, hasSchema — the app omits inputSchema on some tools while
// the edge always ships one) are EXCLUDED from the change comparison so they
// never drown the real signal.
//
// PURITY: ZERO runtime imports (fully standalone, tsx-loadable — smoke:
// tool-catalog-manifest-core). No react-native/supabase/deno, no filesystem,
// no network, no Date.now()/Math.random(). Every export is TOTAL: null /
// undefined / wrong-typed / huge / hostile / cyclic input returns a safe neutral
// (null, [], or a neutral diff) and NEVER throws. Bounded: a manifest caps at
// MAX_MANIFEST_ENTRIES rows, names/families/summaries are length-clamped.

/** The single canonical, cross-surface tool-catalog row. */
export interface ToolManifestEntry {
  name: string;
  family: string;
  approvalMode: 'auto' | 'ask';
  disclosure: 'pinned' | 'deferred';
  mutates: boolean;
  hasSchema: boolean;
  summary: string;
}

/**
 * The drift report between two surfaces' manifests:
 *   - onlyInA / onlyInB: tool names present on exactly one surface.
 *   - changed: tool names present on BOTH but with a different
 *     policy/disclosure (approvalMode, disclosure, or mutates).
 * All three lists are sorted for deterministic CI output.
 */
export interface ToolManifestDiff {
  onlyInA: string[];
  onlyInB: string[];
  changed: string[];
}

/** A manifest never grows past this — bounds a hostile/huge catalog. */
export const MAX_MANIFEST_ENTRIES = 1000;
/** Tool names longer than this are treated as junk (huge → null). */
export const MAX_TOOL_NAME_CHARS = 200;
/** Family key clamp (family is name-derived, so already short — belt + braces). */
export const MAX_TOOL_FAMILY_CHARS = 120;
/** Manifest summary clamp — authored text only, but still bounded. */
export const MAX_TOOL_SUMMARY_CHARS = 200;

// ─── Internal total helpers (no throwing, no recursion → cyclic-safe) ────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Clamp authored text to `max` chars (trim first; ellipsis when truncated). */
function clampText(v: unknown, max: number): string {
  const s = asString(v);
  if (s === null) return '';
  const t = s.trim();
  if (!t) return '';
  if (max <= 1) return t.slice(0, Math.max(0, max));
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

/**
 * NAME/disclosure family — the prefix before the first '.', or the whole name
 * for flat tools. Mirrors getOpenSwanToolDisclosureFamily in the runtime so
 * both surfaces bucket a tool into the identical family from the name alone.
 */
function deriveFamily(name: string): string {
  const dot = name.indexOf('.');
  const fam = dot > 0 ? name.slice(0, dot) : name;
  return fam.length > MAX_TOOL_FAMILY_CHARS ? fam.slice(0, MAX_TOOL_FAMILY_CHARS) : fam;
}

/** True if `obj` has at least one OWN enumerable key. Non-recursive (cyclic-safe). */
function hasAnyOwnKey(obj: Record<string, unknown>): boolean {
  try {
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
    }
  } catch {
    /* hostile getter / proxy — treat as no usable keys */
  }
  return false;
}

/** approvalMode: valid enum passthrough; fail-CLOSED to 'ask' otherwise. */
function readApprovalMode(input: Record<string, unknown>): 'auto' | 'ask' {
  const v = input.approvalMode;
  return v === 'auto' || v === 'ask' ? v : 'ask';
}

/** disclosure: valid enum passthrough; fail-CLOSED to 'deferred' otherwise. */
function readDisclosure(input: Record<string, unknown>): 'pinned' | 'deferred' {
  const v = input.disclosure;
  return v === 'pinned' || v === 'deferred' ? v : 'deferred';
}

/** mutates: real `mutatesState` field first, then `mutates`, else false. */
function readMutates(input: Record<string, unknown>): boolean {
  if (typeof input.mutatesState === 'boolean') return input.mutatesState;
  if (typeof input.mutates === 'boolean') return input.mutates;
  return false;
}

/**
 * hasSchema: a non-empty input schema object is declared under any of the
 * cross-surface field names, else an explicit boolean `hasSchema` (lets a
 * built entry round-trip), else false. NEVER reads schema values — presence
 * only.
 */
function readHasSchema(input: Record<string, unknown>): boolean {
  for (const key of ['inputSchema', 'input_schema', 'parameters'] as const) {
    const schema = input[key];
    if (isPlainObject(schema)) return hasAnyOwnKey(schema);
  }
  return typeof input.hasSchema === 'boolean' ? input.hasSchema : false;
}

/**
 * summary: first non-empty authored text among summary → description → label,
 * clamped. Only these human-authored fields — never schema content — so the
 * manifest is secret-safe by construction.
 */
function readSummary(input: Record<string, unknown>): string {
  const a = clampText(input.summary, MAX_TOOL_SUMMARY_CHARS);
  if (a) return a;
  const b = clampText(input.description, MAX_TOOL_SUMMARY_CHARS);
  if (b) return b;
  return clampText(input.label, MAX_TOOL_SUMMARY_CHARS);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Normalize ONE tool definition (app OpenSwanToolDefinition, a merged
 * app-def+policy view, an edge ToolDef, or an already-built ToolManifestEntry)
 * into the canonical row. Returns null for junk (non-object, or no usable
 * name). Total, bounded, secret-free — never throws.
 */
export function deriveToolManifestEntry(toolDef: unknown): ToolManifestEntry | null {
  try {
    if (!isPlainObject(toolDef)) return null;
    const rawName = asString(toolDef.name);
    if (rawName === null) return null;
    const name = rawName.trim();
    if (!name || name.length > MAX_TOOL_NAME_CHARS) return null;
    return {
      name,
      family: deriveFamily(name),
      approvalMode: readApprovalMode(toolDef),
      disclosure: readDisclosure(toolDef),
      mutates: readMutates(toolDef),
      hasSchema: readHasSchema(toolDef),
      summary: readSummary(toolDef),
    };
  } catch {
    return null;
  }
}

/**
 * Map a list of tool definitions into the canonical manifest: junk rows are
 * dropped, duplicate names collapse (FIRST occurrence wins), input order is
 * preserved, and the result is capped at MAX_MANIFEST_ENTRIES. Non-array input
 * → []. Total — never throws.
 */
export function buildToolManifest(toolDefs: unknown): ToolManifestEntry[] {
  try {
    if (!Array.isArray(toolDefs)) return [];
    const out: ToolManifestEntry[] = [];
    const seen = new Set<string>();
    for (const def of toolDefs) {
      if (out.length >= MAX_MANIFEST_ENTRIES) break;
      const entry = deriveToolManifestEntry(def);
      if (!entry) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** The policy/disclosure signature compared for drift — NOT summary/hasSchema. */
function policySignature(entry: ToolManifestEntry): string {
  return `${entry.approvalMode}|${entry.disclosure}|${entry.mutates ? '1' : '0'}`;
}

/**
 * The DRIFT detector. Normalizes BOTH inputs (accepts raw tool-def lists OR
 * already-built manifests) and reports:
 *   - onlyInA / onlyInB: names on exactly one surface.
 *   - changed: names on both surfaces whose approvalMode, disclosure, or
 *     mutates differ.
 * A CI check asserts all three lists are empty to prove app↔edge parity.
 * Lists are sorted for deterministic output. Total — never throws.
 */
export function diffToolManifests(a: unknown, b: unknown): ToolManifestDiff {
  try {
    const ma = buildToolManifest(a);
    const mb = buildToolManifest(b);
    const mapA = new Map<string, ToolManifestEntry>();
    const mapB = new Map<string, ToolManifestEntry>();
    for (const e of ma) mapA.set(e.name, e);
    for (const e of mb) mapB.set(e.name, e);

    const onlyInA: string[] = [];
    const onlyInB: string[] = [];
    const changed: string[] = [];

    for (const [name, ea] of mapA) {
      const eb = mapB.get(name);
      if (!eb) onlyInA.push(name);
      else if (policySignature(ea) !== policySignature(eb)) changed.push(name);
    }
    for (const name of mapB.keys()) {
      if (!mapA.has(name)) onlyInB.push(name);
    }

    onlyInA.sort();
    onlyInB.sort();
    changed.sort();
    return { onlyInA, onlyInB, changed };
  } catch {
    return { onlyInA: [], onlyInB: [], changed: [] };
  }
}
