// planDiffCore — the PURE diff brain for comparing two structured agent plans.
//
// Given a "before" and "after" plan (each a list of steps keyed by id), it
// reports which steps were added, removed, changed (and WHICH fields changed),
// and whether the common steps were reordered. This backs two UI surfaces:
//   1. "Build from Plan" review — show the human what a re-plan actually changed
//      before they approve executing it.
//   2. Checkpoint-compare — diff a saved plan checkpoint against the live plan.
//
// Steps match by `id`. Field comparison is field-typed:
//   - title / status: string equality (trimmed).
//   - files / dependsOn: order-INSENSITIVE SET equality (a reorder is NOT a
//     change — the same files in a different order means the same thing).
// A step present in both with no field changes and the same position is NOT
// emitted in `changed` (unchanged steps are omitted).
//
// PURITY: zero runtime imports, tsx-loadable (smoke: plan-diff-core). Fully
// deterministic — no Date.now / Math.random. Never throws: every input is
// coerced defensively (missing/empty steps arrays and duplicate ids are safe;
// on a duplicate id, LAST wins, deterministically by array order).

export interface DiffPlanStep {
  id: string;
  title: string;
  status: string;
  files?: string[];
  dependsOn?: string[];
}

export interface DiffPlan {
  id?: string;
  title?: string;
  goal?: string;
  steps: DiffPlanStep[];
}

export type StepChangeKind =
  | 'added'
  | 'removed'
  | 'title'
  | 'status'
  | 'files'
  | 'deps'
  | 'unchanged';

export interface StepChange {
  id: string;
  kinds: StepChangeKind[];
  before?: DiffPlanStep;
  after?: DiffPlanStep;
  detail?: string;
}

export interface PlanDiff {
  added: string[];
  removed: string[];
  changed: StepChange[];
  reordered: boolean;
  summary: string;
}

// ── Defensive coercion ────────────────────────────────────────────────────────

function coerceStr(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Coerce an arbitrary value into a clean string[] (drops non-strings, trims,
 *  drops empties, de-dupes). files/deps are compared as SETS, so a duplicate
 *  entry carries no meaning and must not read as a change. Order preserved
 *  (first occurrence). Never throws. */
function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    let s: string;
    if (typeof item === 'string') {
      s = item.trim();
    } else if (item == null) {
      continue;
    } else {
      s = String(item).trim();
    }
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Coerce one arbitrary value into a valid step, or null if it has no usable id. */
function coerceStep(raw: unknown): DiffPlanStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = coerceStr(r.id).trim();
  if (!id) return null;
  const step: DiffPlanStep = {
    id,
    title: coerceStr(r.title),
    status: coerceStr(r.status),
  };
  const files = coerceStringArray(r.files);
  if (files.length) step.files = files;
  const deps = coerceStringArray(r.dependsOn);
  if (deps.length) step.dependsOn = deps;
  return step;
}

/** Ordered list of valid steps (ids preserved in first-seen array order) plus a
 *  by-id map where LAST occurrence wins (deterministic). Steps without a usable
 *  id are dropped. */
function normalizeSteps(rawPlan: unknown): { order: string[]; byId: Map<string, DiffPlanStep> } {
  const order: string[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, DiffPlanStep>();
  const stepsRaw =
    rawPlan && typeof rawPlan === 'object' ? (rawPlan as Record<string, unknown>).steps : undefined;
  if (!Array.isArray(stepsRaw)) return { order, byId };
  for (const raw of stepsRaw) {
    const step = coerceStep(raw);
    if (!step) continue;
    if (!seen.has(step.id)) {
      seen.add(step.id);
      order.push(step.id);
    }
    byId.set(step.id, step); // last wins
  }
  return { order, byId };
}

// ── Field comparison ──────────────────────────────────────────────────────────

/** Order-insensitive set equality for string arrays (already coerced/trimmed). */
function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const av = a ?? [];
  const bv = b ?? [];
  if (av.length !== bv.length) return false;
  if (av.length === 0) return true;
  const setA = new Set(av);
  const setB = new Set(bv);
  if (setA.size !== setB.size) return false;
  for (const x of setA) {
    if (!setB.has(x)) return false;
  }
  return true;
}

function sortedSet(a: string[] | undefined): string[] {
  return Array.from(new Set(a ?? [])).sort((x, y) => x.localeCompare(y));
}

/** Compute the differing fields between two steps that share an id. */
function diffStepFields(before: DiffPlanStep, after: DiffPlanStep): StepChangeKind[] {
  const kinds: StepChangeKind[] = [];
  if (before.title.trim() !== after.title.trim()) kinds.push('title');
  if (before.status.trim() !== after.status.trim()) kinds.push('status');
  if (!sameSet(before.files, after.files)) kinds.push('files');
  if (!sameSet(before.dependsOn, after.dependsOn)) kinds.push('deps');
  return kinds;
}

function describeChange(kinds: StepChangeKind[], before: DiffPlanStep, after: DiffPlanStep): string {
  const parts: string[] = [];
  for (const k of kinds) {
    if (k === 'title') {
      parts.push(`title "${before.title}" → "${after.title}"`);
    } else if (k === 'status') {
      parts.push(`status ${before.status || '(none)'} → ${after.status || '(none)'}`);
    } else if (k === 'files') {
      parts.push(`files [${sortedSet(before.files).join(', ')}] → [${sortedSet(after.files).join(', ')}]`);
    } else if (k === 'deps') {
      parts.push(`deps [${sortedSet(before.dependsOn).join(', ')}] → [${sortedSet(after.dependsOn).join(', ')}]`);
    }
  }
  return parts.join('; ');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Diff two structured plans. Pure and total (never throws). Steps are matched by
 * id; `added`/`removed`/`changed` are sorted deterministically. `reordered` is
 * true when the relative order of the ids COMMON to both plans differs.
 */
export function diffPlans(beforeRaw: DiffPlan, afterRaw: DiffPlan): PlanDiff {
  const before = normalizeSteps(beforeRaw);
  const after = normalizeSteps(afterRaw);

  const added: string[] = [];
  const removed: string[] = [];
  const changed: StepChange[] = [];

  // added = ids in after not before
  for (const id of after.order) {
    if (!before.byId.has(id)) added.push(id);
  }
  // removed = ids in before not after
  for (const id of before.order) {
    if (!after.byId.has(id)) removed.push(id);
  }
  // changed = same id in both with differing fields
  for (const id of before.order) {
    const b = before.byId.get(id);
    const a = after.byId.get(id);
    if (!b || !a) continue; // removed handled above
    const kinds = diffStepFields(b, a);
    if (kinds.length) {
      changed.push({ id, kinds, before: b, after: a, detail: describeChange(kinds, b, a) });
    }
  }

  added.sort((x, y) => x.localeCompare(y));
  removed.sort((x, y) => x.localeCompare(y));
  changed.sort((x, y) => x.id.localeCompare(y.id));

  // reordered = sequence of COMMON ids differs between before and after.
  const commonBefore = before.order.filter((id) => after.byId.has(id));
  const commonAfter = after.order.filter((id) => before.byId.has(id));
  let reordered = commonBefore.length !== commonAfter.length; // defensive (shouldn't differ)
  if (!reordered) {
    for (let i = 0; i < commonBefore.length; i += 1) {
      if (commonBefore[i] !== commonAfter[i]) {
        reordered = true;
        break;
      }
    }
  }

  return { added, removed, changed, reordered, summary: buildSummary(added, removed, changed, reordered) };
}

function buildSummary(
  added: string[],
  removed: string[],
  changed: StepChange[],
  reordered: boolean,
): string {
  const base = `+${added.length} -${removed.length} ~${changed.length}`;
  return reordered ? `${base} · reordered` : base;
}

/** Deterministic, human-readable rendering of a diff (for logs / review copy). */
export function renderPlanDiff(diffRaw: PlanDiff): string {
  const diff = normalizeDiff(diffRaw);
  const lines: string[] = [];
  lines.push(`Plan diff: ${diff.summary}`);
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    lines.push('  (no step changes)');
  }
  for (const id of diff.added) lines.push(`  + added: ${id}`);
  for (const id of diff.removed) lines.push(`  - removed: ${id}`);
  for (const c of diff.changed) {
    const kinds = c.kinds.filter((k) => k !== 'added' && k !== 'removed' && k !== 'unchanged');
    const detail = c.detail ? ` — ${c.detail}` : '';
    lines.push(`  ~ changed: ${c.id} [${kinds.join(', ')}]${detail}`);
  }
  if (diff.reordered) lines.push('  ↕ steps reordered');
  return lines.join('\n');
}

/** Defensive coercion for renderPlanDiff so a hand-built / partial diff is safe. */
function normalizeDiff(raw: unknown): PlanDiff {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const added = coerceStringArray(r.added);
  const removed = coerceStringArray(r.removed);
  const changedRaw = Array.isArray(r.changed) ? r.changed : [];
  const changed: StepChange[] = [];
  for (const c of changedRaw) {
    if (!c || typeof c !== 'object') continue;
    const cr = c as Record<string, unknown>;
    const id = coerceStr(cr.id).trim();
    if (!id) continue;
    const kinds = Array.isArray(cr.kinds)
      ? (cr.kinds.filter((k) => typeof k === 'string') as StepChangeKind[])
      : [];
    const entry: StepChange = { id, kinds };
    if (typeof cr.detail === 'string') entry.detail = cr.detail;
    changed.push(entry);
  }
  const reordered = r.reordered === true;
  const summary = typeof r.summary === 'string' ? r.summary : buildSummary(added, removed, changed, reordered);
  return { added, removed, changed, reordered, summary };
}
