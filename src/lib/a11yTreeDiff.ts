/**
 * a11yTreeDiff — before/after macOS accessibility-tree diff for action
 * verification.
 *
 * Pattern: instead of taking another screenshot to ask "did my click
 * work?", the agent snapshots the a11y tree BEFORE a mutation, performs
 * the action, re-reads the tree, and diffs the two snapshots into a
 * structured +/−/~ answer:
 *
 *   snapshotA11ySummary(beforeTree) ── act ── snapshotA11ySummary(afterTree)
 *     → diffA11ySummaries(before, after)
 *     → classifyA11yDiffOutcome(diff, expectation)   // pass/fail signal
 *     → describeA11yDiffForModel(diff, { fence })    // compact tool-loop text
 *
 * `no_change` after a mutation is the actionable failure signal — the
 * click/keystroke very likely did not land.
 *
 * Input shape: consumes the EXACT node shape the desktop bridge returns
 * from `readA11yTree` (src/lib/desktopBridge.ts:1433 `A11yNode`:
 * { id, role, label?, value?, bbox?, index?, children? }) as-is —
 * callers pass `result.data.tree` straight in. The structural type below
 * is a minimal superset: `enabled`/`focused` are accepted when present
 * (forward-compatible; the Swift helper does not emit them yet) and the
 * bridge-only fields (`id`, `bbox`, `index`) are ignored. A compile-time
 * assertion below guarantees the bridge shape stays assignable.
 *
 * Dependency-light by contract (see MEMORY: smoke-tests-need-pure-modules):
 * type-only imports ONLY, no react-native/supabase/runtime imports, so
 * scripts/a11y-tree-diff-smoketest.ts can execute this module under tsx.
 *
 * SECURITY: a11y labels/values are app/page-controlled and therefore
 * UNTRUSTED (same channel as the E6 note on
 * `fenceUntrustedObservationText` in src/lib/openswanToolRuntime.ts).
 * `describeA11yDiffForModel` routes every label/value fragment through an
 * injectable `fence` function — callers producing model-visible output
 * MUST pass the runtime's fencing helper. Structural tokens (sanitized
 * role names, +/−/~ counts, boolean literals, 'unset') stay outside the
 * fence so the model can still trust them.
 */

import type { A11yNode as BridgeA11yNode } from './desktopBridge';

// ─── Input shape ─────────────────────────────────────────────────────

/**
 * Minimal structural node this differ consumes. The bridge's `A11yNode`
 * satisfies it as-is; synthetic trees in tests only need `role`.
 */
export interface A11yDiffSourceNode {
  role?: string | null;
  label?: string | null;
  value?: string | null;
  /** Forward-compatible: not emitted by the Swift helper today. */
  enabled?: boolean;
  /** Forward-compatible: not emitted by the Swift helper today. */
  focused?: boolean;
  children?: A11yDiffSourceNode[] | null;
}

/** Compile-time guarantee that the bridge's node shape stays diffable. */
type AssertAssignable<_T extends A11yDiffSourceNode> = true;
export type BridgeA11yNodeIsDiffable = AssertAssignable<BridgeA11yNode>;

// ─── Bounds ──────────────────────────────────────────────────────────

/** Snapshot walks at most this many nodes (matches the bridge's ~400-node budget). */
export const A11Y_SNAPSHOT_MAX_NODES = 400;
/** Snapshot descends at most this many levels (root = depth 0). */
export const A11Y_SNAPSHOT_MAX_DEPTH = 12;
/** Display strings (role/label/value) are clamped to this many chars. */
export const A11Y_SNAPSHOT_MAX_STRING_LENGTH = 120;
/** Each diff list (added/removed/changed) is capped at this many entries. */
export const A11Y_DIFF_MAX_LIST_ITEMS = 40;
/** Default budget for the model-visible describe string. */
export const A11Y_DESCRIBE_MAX_CHARS = 600;

// Key-internal bounds (identity segments, not display strings).
const KEY_SEGMENT_ROLE_MAX = 40;
const KEY_SEGMENT_LABEL_MAX = 48;
const KEY_TOTAL_MAX = 240;
const KEY_TRUNCATED_PREFIX = 220;
const DESCRIBE_ITEM_LABEL_MAX = 48;
const DESCRIBE_ITEM_VALUE_MAX = 24;

// ─── Shared helpers ──────────────────────────────────────────────────

/** Trim + collapse internal whitespace runs to single spaces. */
function collapseWhitespace(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

/** Clamp to `max` chars, marking truncation with a single '…'. */
function clampString(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function clampInt(raw: number | undefined, min: number, max: number, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** djb2-xor, base36 — deterministic short hash for over-long keys. */
function hashKey(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** Bound a full key; over-long keys keep a deterministic hash suffix so distinct paths stay distinct. */
function boundKey(fullKey: string): string {
  if (fullKey.length <= KEY_TOTAL_MAX) return fullKey;
  return `${fullKey.slice(0, KEY_TRUNCATED_PREFIX)}~${hashKey(fullKey)}`;
}

function normalizeForMatch(raw: unknown): string {
  return collapseWhitespace(raw).toLowerCase();
}

/** 'AXDialog' / 'dialog' / ' Dialog ' all normalize to 'dialog'. */
function normalizeRoleForMatch(raw: unknown): string {
  return normalizeForMatch(raw).replace(/^ax/, '');
}

// ─── snapshotA11ySummary ─────────────────────────────────────────────

/** One flattened node in a snapshot. Display casing is preserved; the `key` uses lowercase matching. */
export interface A11ySummaryNode {
  /**
   * Stable path-ish identity: per-level segments of
   * `role:normalized-label` (lowercased, whitespace-collapsed), with a
   * sibling-index fallback (`role@i`) for unlabeled nodes and an
   * occurrence suffix (`#n`) for duplicate role+label siblings, joined
   * with '/'. First duplicate keeps the unsuffixed segment so it stays
   * stable when a twin appears/disappears.
   */
  key: string;
  role: string;
  /** '' when the node has no label. */
  label: string;
  value?: string;
  enabled?: boolean;
  focused?: boolean;
}

export interface SnapshotA11ySummaryOptions {
  /** Default {@link A11Y_SNAPSHOT_MAX_NODES}. */
  maxNodes?: number;
  /** Default {@link A11Y_SNAPSHOT_MAX_DEPTH} (root = depth 0). */
  maxDepth?: number;
  /** Default {@link A11Y_SNAPSHOT_MAX_STRING_LENGTH}. */
  maxStringLength?: number;
}

/** Identity segment for a node among its siblings (drives duplicate-safe keys). */
function segmentFor(
  node: A11yDiffSourceNode,
  siblingIndex: number,
  segmentCounts: Map<string, number>,
): string {
  const roleKey = normalizeForMatch(node.role).slice(0, KEY_SEGMENT_ROLE_MAX) || 'unknown';
  const labelKey = normalizeForMatch(node.label).slice(0, KEY_SEGMENT_LABEL_MAX);
  const base = labelKey ? `${roleKey}:${labelKey}` : `${roleKey}@${siblingIndex}`;
  const priorTwins = segmentCounts.get(base) || 0;
  segmentCounts.set(base, priorTwins + 1);
  return priorTwins === 0 ? base : `${base}#${priorTwins}`;
}

/**
 * Flatten an a11y tree (the exact `readA11yTree` node shape from
 * src/lib/desktopBridge.ts) into a bounded pre-order index suitable for
 * diffing. Never throws: null/empty/cyclic/giant trees degrade to an
 * empty or capped array. Normalization: whitespace collapsed, display
 * casing preserved, keys matched lowercase, strings clamped.
 */
export function snapshotA11ySummary(
  tree: A11yDiffSourceNode | null | undefined,
  opts: SnapshotA11ySummaryOptions = {},
): A11ySummaryNode[] {
  const maxNodes = clampInt(opts.maxNodes, 1, 5000, A11Y_SNAPSHOT_MAX_NODES);
  const maxDepth = clampInt(opts.maxDepth, 0, 64, A11Y_SNAPSHOT_MAX_DEPTH);
  const maxString = clampInt(opts.maxStringLength, 8, 4000, A11Y_SNAPSHOT_MAX_STRING_LENGTH);

  const out: A11ySummaryNode[] = [];
  if (!tree || typeof tree !== 'object') return out;

  // Cycle guard: bridge payloads are JSON (acyclic), but a hand-built or
  // corrupted tree must not hang the verifier.
  const seen = new Set<object>();

  const visit = (node: A11yDiffSourceNode, parentKey: string, segment: string, depth: number): void => {
    if (out.length >= maxNodes) return;
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);

    const key = boundKey(parentKey ? `${parentKey}/${segment}` : segment);
    const summary: A11ySummaryNode = {
      key,
      role: clampString(collapseWhitespace(node.role) || 'unknown', maxString),
      label: clampString(collapseWhitespace(node.label), maxString),
    };
    if (node.value !== undefined && node.value !== null) {
      summary.value = clampString(collapseWhitespace(node.value), maxString);
    }
    if (typeof node.enabled === 'boolean') summary.enabled = node.enabled;
    if (typeof node.focused === 'boolean') summary.focused = node.focused;
    out.push(summary);

    if (depth >= maxDepth) return;
    const children = Array.isArray(node.children) ? node.children : [];
    const segmentCounts = new Map<string, number>();
    for (let i = 0; i < children.length; i += 1) {
      if (out.length >= maxNodes) break;
      const child = children[i];
      if (!child || typeof child !== 'object') continue;
      visit(child, key, segmentFor(child, i, segmentCounts), depth + 1);
    }
  };

  visit(tree, '', segmentFor(tree, 0, new Map()), 0);
  return out;
}

// ─── diffA11ySummaries ───────────────────────────────────────────────

export type A11yChangedField = 'value' | 'enabled' | 'focused';

export interface A11yFieldChange {
  key: string;
  role: string;
  label: string;
  field: A11yChangedField;
  before: string | boolean | undefined;
  after: string | boolean | undefined;
}

export interface A11ySummaryDiff {
  /** Nodes present after but not before (capped at {@link A11Y_DIFF_MAX_LIST_ITEMS}). */
  added: A11ySummaryNode[];
  /** Nodes present before but not after (capped). */
  removed: A11ySummaryNode[];
  /** value/enabled/focused transitions on matched nodes (capped). */
  changed: A11yFieldChange[];
  /** Matched nodes with no field changes. */
  unchangedCount: number;
  /** True counts before list capping — describe/classify use these. */
  addedTotal: number;
  removedTotal: number;
  changedTotal: number;
  addedTruncated: boolean;
  removedTruncated: boolean;
  changedTruncated: boolean;
  /** True when any list was capped. */
  truncated: boolean;
}

const CHANGED_FIELDS: A11yChangedField[] = ['value', 'enabled', 'focused'];

/**
 * Structural diff of two snapshots keyed by stable node identity.
 * Label/role changes surface as removed+added (identity changed); only
 * value/enabled/focused surface as `changed`. Case-only label changes
 * map to the same key and read as unchanged by design. Never throws on
 * null/empty inputs.
 */
export function diffA11ySummaries(
  before: readonly A11ySummaryNode[] | null | undefined,
  after: readonly A11ySummaryNode[] | null | undefined,
): A11ySummaryDiff {
  const beforeList = Array.isArray(before) ? before : [];
  const afterList = Array.isArray(after) ? after : [];

  const beforeByKey = new Map<string, A11ySummaryNode>();
  for (const node of beforeList) {
    if (node && typeof node.key === 'string') beforeByKey.set(node.key, node);
  }

  const added: A11ySummaryNode[] = [];
  const changed: A11yFieldChange[] = [];
  const matched = new Set<string>();
  let addedTotal = 0;
  let changedTotal = 0;
  let unchangedCount = 0;

  for (const node of afterList) {
    if (!node || typeof node.key !== 'string') continue;
    const prev = beforeByKey.get(node.key);
    if (!prev || matched.has(node.key)) {
      addedTotal += 1;
      if (added.length < A11Y_DIFF_MAX_LIST_ITEMS) added.push(node);
      continue;
    }
    matched.add(node.key);
    let fieldsChanged = 0;
    for (const field of CHANGED_FIELDS) {
      const b = prev[field];
      const a = node[field];
      if (b === a) continue;
      fieldsChanged += 1;
      changedTotal += 1;
      if (changed.length < A11Y_DIFF_MAX_LIST_ITEMS) {
        changed.push({ key: node.key, role: node.role, label: node.label, field, before: b, after: a });
      }
    }
    if (fieldsChanged === 0) unchangedCount += 1;
  }

  const removed: A11ySummaryNode[] = [];
  let removedTotal = 0;
  for (const node of beforeList) {
    if (!node || typeof node.key !== 'string' || matched.has(node.key)) continue;
    removedTotal += 1;
    if (removed.length < A11Y_DIFF_MAX_LIST_ITEMS) removed.push(node);
  }

  const addedTruncated = addedTotal > added.length;
  const removedTruncated = removedTotal > removed.length;
  const changedTruncated = changedTotal > changed.length;
  return {
    added,
    removed,
    changed,
    unchangedCount,
    addedTotal,
    removedTotal,
    changedTotal,
    addedTruncated,
    removedTruncated,
    changedTruncated,
    truncated: addedTruncated || removedTruncated || changedTruncated,
  };
}

// ─── classifyA11yDiffOutcome ─────────────────────────────────────────

export type A11yDiffOutcome = 'state_changed' | 'no_change' | 'target_appeared' | 'target_disappeared';

export interface A11yDiffExpectation {
  /** Case-insensitive, whitespace-collapsed substring match against node labels. */
  expectLabel?: string;
  /** 'dialog' matches 'AXDialog' (leading 'AX' ignored on both sides). */
  expectRole?: string;
  expectKind: 'appear' | 'disappear' | 'value_change';
}

function expectationTargetsNode(
  role: string | undefined,
  label: string | undefined,
  expectation: A11yDiffExpectation,
): boolean {
  const wantLabel = normalizeForMatch(expectation.expectLabel);
  if (wantLabel && !normalizeForMatch(label).includes(wantLabel)) return false;
  const wantRole = normalizeRoleForMatch(expectation.expectRole);
  if (wantRole) {
    const haveRole = normalizeRoleForMatch(role);
    if (haveRole !== wantRole && !haveRole.includes(wantRole)) return false;
  }
  return true;
}

/**
 * Strict boolean: did the diff satisfy the expectation? 'appear' checks
 * `added`, 'disappear' checks `removed`, 'value_change' checks `changed`
 * entries with field === 'value' (enabled/focused flips do not count).
 * An expectation with neither label nor role matches any node of the
 * expected kind. NOTE: matching runs over the capped lists — when the
 * relevant `*Truncated` flag is set and this returns false, re-snapshot
 * with a target slice before declaring failure.
 */
export function a11yDiffMatchesExpectation(
  diff: A11ySummaryDiff | null | undefined,
  expectation: A11yDiffExpectation | null | undefined,
): boolean {
  if (!diff || !expectation) return false;
  switch (expectation.expectKind) {
    case 'appear':
      return (diff.added || []).some((n) => n && expectationTargetsNode(n.role, n.label, expectation));
    case 'disappear':
      return (diff.removed || []).some((n) => n && expectationTargetsNode(n.role, n.label, expectation));
    case 'value_change':
      return (diff.changed || []).some(
        (c) => c && c.field === 'value' && expectationTargetsNode(c.role, c.label, expectation),
      );
    default:
      return false;
  }
}

/**
 * Turn a diff into the verification signal for a mutation step:
 *
 * - 'no_change'          — nothing moved: the actionable failure signal
 *                          after a click/keystroke (action likely missed).
 * - 'target_appeared'    — expectation kind 'appear' matched in `added`.
 * - 'target_disappeared' — expectation kind 'disappear' matched in `removed`.
 * - 'state_changed'      — something changed; for expectKind
 *                          'value_change' use {@link a11yDiffMatchesExpectation}
 *                          for the strict pass/fail on the target field.
 */
export function classifyA11yDiffOutcome(
  diff: A11ySummaryDiff | null | undefined,
  expectation?: A11yDiffExpectation | null,
): A11yDiffOutcome {
  if (!diff) return 'no_change';
  const addedTotal = Number.isFinite(diff.addedTotal) ? diff.addedTotal : (diff.added || []).length;
  const removedTotal = Number.isFinite(diff.removedTotal) ? diff.removedTotal : (diff.removed || []).length;
  const changedTotal = Number.isFinite(diff.changedTotal) ? diff.changedTotal : (diff.changed || []).length;
  if (addedTotal + removedTotal + changedTotal === 0) return 'no_change';
  if (expectation && expectation.expectKind === 'appear' && a11yDiffMatchesExpectation(diff, expectation)) {
    return 'target_appeared';
  }
  if (expectation && expectation.expectKind === 'disappear' && a11yDiffMatchesExpectation(diff, expectation)) {
    return 'target_disappeared';
  }
  return 'state_changed';
}

// ─── describeA11yDiffForModel ────────────────────────────────────────

export interface DescribeA11yDiffOptions {
  /**
   * UNTRUSTED-CONTENT FENCE. Every label and string-value fragment in
   * the output passes through this function. Defaults to identity —
   * callers building MODEL-VISIBLE text MUST pass the runtime's fencing
   * helper (`fenceUntrustedObservationText` in
   * src/lib/openswanToolRuntime.ts) or an equivalent, because a11y
   * labels/values are app/page-controlled and can smuggle instructions.
   * Structural tokens (sanitized role names, counts, '→', boolean
   * literals, 'unset', truncation markers) are emitted outside the
   * fence by design.
   */
  fence?: (fragment: string) => string;
  /** Hard output budget. Default {@link A11Y_DESCRIBE_MAX_CHARS}. */
  maxChars?: number;
  /** Items rendered per added/removed/changed section. Default 3. */
  maxItemsPerList?: number;
}

/** 'AXCheckBox' → 'checkbox'; sanitized to [a-z0-9_. -] so roles are safe outside the fence. */
function displayRole(role: string | undefined): string {
  const stripped = collapseWhitespace(role).replace(/^AX/i, '');
  const safe = stripped.replace(/[^A-Za-z0-9_. -]/g, '').trim().toLowerCase();
  return clampString(safe, 24) || 'node';
}

/**
 * Compact bounded string for the tool loop, e.g.
 * `+3 −1 ~2 | added: dialog 'Export As', button 'Cancel' | changed:
 * checkbox 'Embed profile' value 0→1`.
 *
 * Guarantees:
 * - never exceeds `maxChars` (default 600) — fragments are appended
 *   atomically, so an expanding fence is never cut mid-tag;
 * - header counts use pre-cap totals;
 * - EVERY label/value fragment is wrapped through `opts.fence` (see
 *   {@link DescribeA11yDiffOptions.fence} — pass the runtime fence for
 *   model-visible output).
 */
export function describeA11yDiffForModel(
  diff: A11ySummaryDiff | null | undefined,
  opts: DescribeA11yDiffOptions = {},
): string {
  const fence = typeof opts.fence === 'function' ? opts.fence : (s: string) => s;
  const maxChars = clampInt(opts.maxChars, 80, 4000, A11Y_DESCRIBE_MAX_CHARS);
  const maxItems = clampInt(opts.maxItemsPerList, 1, A11Y_DIFF_MAX_LIST_ITEMS, 3);
  if (!diff) return 'no a11y diff available';

  const addedTotal = Number.isFinite(diff.addedTotal) ? diff.addedTotal : (diff.added || []).length;
  const removedTotal = Number.isFinite(diff.removedTotal) ? diff.removedTotal : (diff.removed || []).length;
  const changedTotal = Number.isFinite(diff.changedTotal) ? diff.changedTotal : (diff.changed || []).length;
  const unchangedCount = Number.isFinite(diff.unchangedCount) ? diff.unchangedCount : 0;

  if (addedTotal + removedTotal + changedTotal === 0) {
    return clampString(`no a11y changes detected (${unchangedCount} unchanged)`, maxChars);
  }

  const fencedLabel = (label: string | undefined): string =>
    label ? `'${fence(clampString(label, DESCRIBE_ITEM_LABEL_MAX))}'` : '(unlabeled)';
  const fencedValue = (v: string | boolean | undefined): string => {
    if (v === undefined) return 'unset';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (v === '') return "''";
    return fence(clampString(v, DESCRIBE_ITEM_VALUE_MAX));
  };
  const nodeItem = (n: A11ySummaryNode): string => `${displayRole(n.role)} ${fencedLabel(n.label)}`;
  const changeItem = (c: A11yFieldChange): string =>
    `${displayRole(c.role)} ${fencedLabel(c.label)} ${c.field} ${fencedValue(c.before)}→${fencedValue(c.after)}`;

  // Atomic assembly: a fragment is appended whole or not at all, so the
  // ≤maxChars guarantee holds even when the fence expands strings, and a
  // fenced fragment can never be sliced open.
  const parts: string[] = [];
  let used = 0;
  const ELLIPSIS = ' …';
  let exhausted = false;
  const tryPush = (fragment: string): boolean => {
    if (used + fragment.length > maxChars - ELLIPSIS.length) return false;
    parts.push(fragment);
    used += fragment.length;
    return true;
  };

  tryPush(`+${addedTotal} −${removedTotal} ~${changedTotal}`);

  const pushSection = (name: string, items: string[], total: number): void => {
    if (exhausted || items.length === 0) return;
    for (let i = 0; i < items.length; i += 1) {
      const fragment = i === 0 ? ` | ${name}: ${items[i]}` : `, ${items[i]}`;
      if (!tryPush(fragment)) {
        exhausted = true;
        return;
      }
    }
    const more = total - items.length;
    if (more > 0 && !tryPush(` (+${more} more)`)) exhausted = true;
  };

  pushSection('added', (diff.added || []).filter(Boolean).slice(0, maxItems).map(nodeItem), addedTotal);
  pushSection('removed', (diff.removed || []).filter(Boolean).slice(0, maxItems).map(nodeItem), removedTotal);
  pushSection('changed', (diff.changed || []).filter(Boolean).slice(0, maxItems).map(changeItem), changedTotal);

  if (exhausted) parts.push(ELLIPSIS);
  return parts.join('');
}
