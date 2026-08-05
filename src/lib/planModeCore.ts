// planModeCore — the PURE brain behind "Plan Mode" (Cursor-parity): the agent
// proposes a structured, editable plan; the user approves/edits it step-by-step;
// then "Build from Plan" executes the approved, dependency-ordered steps.
//
// This module owns the plan data model and its pure transforms ONLY. The runtime
// (chat surface, execution loop, persistence) does the I/O; every function here
// is deterministic and side-effect-free:
//   - createPlan(input, now)          — normalize a proposed plan (stable ids)
//   - applyPlanEdit(plan, edit)        — apply ONE user edit → NEW plan
//   - selectBuildableSteps(plan)       — approved steps in topo order + blockers
//   - renderPlanMarkdown / parsePlanMarkdown — round-trippable serialization
//   - summarizePlan(plan)              — one-line status ("3/7 approved · …")
//
// PURITY: zero imports, tsx-loadable (smoke: plan-mode-core). The caller passes
// `now` (epoch ms); we never read the clock or use Math.random(). Never throws —
// every input is guarded (undefined/null/wrong-type → safe default).

export type PlanStepStatus = 'pending' | 'approved' | 'rejected' | 'done' | 'skipped';

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  files: string[];
  risk: 'low' | 'medium' | 'high';
  status: PlanStepStatus;
  dependsOn: string[];
}

export interface PlanQuestion {
  id: string;
  question: string;
  answer?: string;
}

export interface AgentPlan {
  id: string;
  title: string;
  goal: string;
  steps: PlanStep[];
  questions: PlanQuestion[];
  risks: string[];
  createdAt: number;
}

export type PlanEdit =
  | { op: 'setStepStatus'; stepId: string; status: PlanStepStatus }
  | { op: 'editStep'; stepId: string; patch: Partial<Pick<PlanStep, 'title' | 'detail' | 'files' | 'risk' | 'dependsOn'>> }
  | { op: 'addStep'; step: Partial<PlanStep> & { title: string } }
  | { op: 'removeStep'; stepId: string }
  | { op: 'answerQuestion'; questionId: string; answer: string }
  | { op: 'reorderSteps'; orderedIds: string[] };

// ── Bounds & valid-value sets ────────────────────────────────────────────────
export const MAX_TEXT_LEN = 2000;
const STATUS_VALUES: readonly PlanStepStatus[] = ['pending', 'approved', 'rejected', 'done', 'skipped'];
const RISK_VALUES: readonly PlanStep['risk'][] = ['low', 'medium', 'high'];

// ── Small pure helpers ────────────────────────────────────────────────────────
function clampText(raw: unknown, max = MAX_TEXT_LEN): string {
  const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  return s.length > max ? s.slice(0, max) : s;
}

function coerceStatus(raw: unknown): PlanStepStatus {
  return STATUS_VALUES.includes(raw as PlanStepStatus) ? (raw as PlanStepStatus) : 'pending';
}

function coerceRisk(raw: unknown): PlanStep['risk'] {
  return RISK_VALUES.includes(raw as PlanStep['risk']) ? (raw as PlanStep['risk']) : 'low';
}

/** Normalize a list of strings: coerce, trim, drop empties, dedupe (stable order). */
function normalizeStringList(raw: unknown, perItemMax = MAX_TEXT_LEN): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = clampText(item, perItemMax).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// ── createPlan ────────────────────────────────────────────────────────────────
/**
 * Normalize a proposed plan into a valid `AgentPlan`. Missing step/question ids
 * are assigned deterministically from their index (`step-1`, `question-1`); an
 * id supplied by the caller is kept unless it collides, in which case a stable
 * fallback is used. `dependsOn` is deduped; unknown status/risk fall back to
 * safe defaults; text fields are length-clamped. Never throws.
 */
export function createPlan(inputRaw: (Partial<AgentPlan> & { title: string; goal: string }) | null | undefined, now: number): AgentPlan {
  const input = (inputRaw ?? {}) as Partial<AgentPlan> & { title?: unknown; goal?: unknown };
  const createdAt = isFiniteNumber(now) ? now : 0;

  const stepsRaw = Array.isArray(input.steps) ? input.steps : [];
  const usedStepIds = new Set<string>();
  const steps: PlanStep[] = stepsRaw.map((s, i) => {
    const raw = (s ?? {}) as Partial<PlanStep>;
    let id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || usedStepIds.has(id)) id = `step-${i + 1}`;
    // Extremely defensive: guarantee uniqueness even if the fallback collides.
    while (usedStepIds.has(id)) id = `${id}-${i + 1}`;
    usedStepIds.add(id);
    return {
      id,
      title: clampText(raw.title),
      detail: raw.detail === undefined ? undefined : clampText(raw.detail),
      files: normalizeStringList(raw.files),
      risk: coerceRisk(raw.risk),
      status: coerceStatus(raw.status),
      dependsOn: normalizeStringList(raw.dependsOn),
    };
  });

  const questionsRaw = Array.isArray(input.questions) ? input.questions : [];
  const usedQIds = new Set<string>();
  const questions: PlanQuestion[] = questionsRaw.map((q, i) => {
    const raw = (q ?? {}) as Partial<PlanQuestion>;
    let id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || usedQIds.has(id)) id = `question-${i + 1}`;
    while (usedQIds.has(id)) id = `${id}-${i + 1}`;
    usedQIds.add(id);
    return {
      id,
      question: clampText(raw.question),
      answer: raw.answer === undefined ? undefined : clampText(raw.answer),
    };
  });

  return {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `plan-${createdAt}`,
    title: clampText(input.title),
    goal: clampText(input.goal),
    steps,
    questions,
    risks: normalizeStringList(input.risks),
    createdAt,
  };
}

// ── applyPlanEdit ───────────────────────────────────────────────────────────
/**
 * Apply ONE edit to a plan and return a NEW plan (the input is never mutated).
 * Any invalid op — unknown step/question id, malformed payload, bad enum value,
 * or an `op` we don't recognize — is a no-op that returns the plan unchanged.
 * Never throws.
 */
export function applyPlanEdit(planRaw: AgentPlan | null | undefined, editRaw: PlanEdit | null | undefined): AgentPlan {
  // Re-normalize the plan defensively so a hand-built/corrupt plan can't throw.
  const plan = createPlan((planRaw ?? { title: '', goal: '' }) as any, (planRaw as any)?.createdAt ?? 0);
  const edit = editRaw as PlanEdit | undefined;
  if (!edit || typeof (edit as any).op !== 'string') return plan;

  switch (edit.op) {
    case 'setStepStatus': {
      const status = coerceStatus(edit.status);
      if (!STATUS_VALUES.includes(edit.status)) return plan; // reject unknown status → no-op
      let found = false;
      const steps = plan.steps.map((s) => {
        if (s.id !== edit.stepId) return s;
        found = true;
        return { ...s, status };
      });
      return found ? { ...plan, steps } : plan;
    }

    case 'editStep': {
      const patch = (edit.patch ?? {}) as Partial<Pick<PlanStep, 'title' | 'detail' | 'files' | 'risk' | 'dependsOn'>>;
      let found = false;
      const steps = plan.steps.map((s) => {
        if (s.id !== edit.stepId) return s;
        found = true;
        const next: PlanStep = { ...s };
        if ('title' in patch && patch.title !== undefined) next.title = clampText(patch.title);
        if ('detail' in patch) next.detail = patch.detail === undefined ? undefined : clampText(patch.detail);
        if ('files' in patch) next.files = normalizeStringList(patch.files);
        if ('risk' in patch && RISK_VALUES.includes(patch.risk as PlanStep['risk'])) next.risk = patch.risk as PlanStep['risk'];
        if ('dependsOn' in patch) next.dependsOn = normalizeStringList(patch.dependsOn);
        return next;
      });
      return found ? { ...plan, steps } : plan;
    }

    case 'addStep': {
      const raw = (edit.step ?? {}) as Partial<PlanStep> & { title?: unknown };
      const title = clampText(raw.title).trim();
      if (!title) return plan; // title is required for an add
      const used = new Set(plan.steps.map((s) => s.id));
      let id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id || used.has(id)) {
        // Deterministic next id: smallest `step-N` not already taken.
        let n = plan.steps.length + 1;
        id = `step-${n}`;
        while (used.has(id)) { n += 1; id = `step-${n}`; }
      }
      const step: PlanStep = {
        id,
        title,
        detail: raw.detail === undefined ? undefined : clampText(raw.detail),
        files: normalizeStringList(raw.files),
        risk: coerceRisk(raw.risk),
        status: coerceStatus(raw.status),
        dependsOn: normalizeStringList(raw.dependsOn),
      };
      return { ...plan, steps: [...plan.steps, step] };
    }

    case 'removeStep': {
      if (!plan.steps.some((s) => s.id === edit.stepId)) return plan;
      const steps = plan.steps
        .filter((s) => s.id !== edit.stepId)
        // Drop dangling references to the removed step from other steps' deps.
        .map((s) => (s.dependsOn.includes(edit.stepId) ? { ...s, dependsOn: s.dependsOn.filter((d) => d !== edit.stepId) } : s));
      return { ...plan, steps };
    }

    case 'answerQuestion': {
      let found = false;
      const questions = plan.questions.map((q) => {
        if (q.id !== edit.questionId) return q;
        found = true;
        return { ...q, answer: clampText(edit.answer) };
      });
      return found ? { ...plan, questions } : plan;
    }

    case 'reorderSteps': {
      const orderedIds = Array.isArray(edit.orderedIds) ? edit.orderedIds : [];
      const byId = new Map(plan.steps.map((s) => [s.id, s]));
      const seen = new Set<string>();
      const reordered: PlanStep[] = [];
      for (const id of orderedIds) {
        const step = byId.get(id);
        if (step && !seen.has(id)) { seen.add(id); reordered.push(step); }
      }
      // Any steps not named in orderedIds keep their original relative order at the end.
      for (const s of plan.steps) if (!seen.has(s.id)) reordered.push(s);
      return { ...plan, steps: reordered };
    }

    default:
      return plan; // unknown op → no-op
  }
}

// ── selectBuildableSteps ──────────────────────────────────────────────────────
/**
 * Return the APPROVED steps in dependency-topological order, plus a list of
 * steps that can't be built and why.
 *
 * Rules:
 *   - Only `approved` steps are candidates. A step is buildable once every id in
 *     its `dependsOn` is either already `done` OR is an approved step that
 *     appears EARLIER in the returned order.
 *   - A dependency that is rejected/skipped, or points at an id that doesn't
 *     exist (or at a non-done, non-approved step), makes the step blocked.
 *   - Cycles are detected: any approved step caught in a dependency cycle is
 *     blocked with reason 'dependency cycle'. Never infinite-loops.
 * Never throws.
 */
export function selectBuildableSteps(planRaw: AgentPlan | null | undefined): {
  steps: PlanStep[];
  blocked: Array<{ id: string; reason: string }>;
} {
  const plan = createPlan((planRaw ?? { title: '', goal: '' }) as any, (planRaw as any)?.createdAt ?? 0);
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const approved = plan.steps.filter((s) => s.status === 'approved');
  const approvedIds = new Set(approved.map((s) => s.id));

  const ordered: PlanStep[] = [];
  const orderedIds = new Set<string>();
  const blocked: Array<{ id: string; reason: string }> = [];
  const blockedIds = new Set<string>();
  const addBlocked = (id: string, reason: string) => {
    if (blockedIds.has(id)) return;
    blockedIds.add(id);
    blocked.push({ id, reason });
  };

  // Precompute a static block reason for deps that can never satisfy (missing /
  // rejected / skipped / not-approved-and-not-done). This is cycle-independent.
  const staticDepProblem = (dep: string): string | null => {
    const target = byId.get(dep);
    if (!target) return `depends on missing step "${dep}"`;
    if (target.status === 'rejected') return `depends on rejected step "${dep}"`;
    if (target.status === 'skipped') return `depends on skipped step "${dep}"`;
    if (target.status === 'done') return null; // satisfiable now
    if (target.status === 'approved') return null; // satisfiable if ordered earlier
    return `depends on step "${dep}" which is not approved`; // e.g. 'pending'
  };

  // Kahn-style topo over the approved subgraph (edges = approved deps). Deps that
  // are already `done` are treated as satisfied and don't participate as nodes.
  const remaining = new Set(approvedIds);
  // Steps with an unsatisfiable static dep can't build regardless of ordering.
  for (const s of approved) {
    for (const dep of s.dependsOn) {
      const problem = staticDepProblem(dep);
      if (problem) { addBlocked(s.id, problem); break; }
    }
  }
  for (const id of blockedIds) remaining.delete(id);

  // Iteratively pull steps whose approved-deps are all already ordered (or done).
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const s of approved) {
      if (!remaining.has(s.id)) continue;
      const ready = s.dependsOn.every((dep) => {
        const target = byId.get(dep);
        if (target && target.status === 'done') return true; // satisfied outside the ordering
        return orderedIds.has(dep); // an approved dep must already be placed
      });
      if (ready) {
        ordered.push(s);
        orderedIds.add(s.id);
        remaining.delete(s.id);
        progressed = true;
      }
    }
  }

  // Anything still remaining is caught in a cycle among approved steps.
  for (const s of approved) {
    if (remaining.has(s.id)) addBlocked(s.id, 'dependency cycle');
  }

  return { steps: ordered, blocked };
}

// ── Markdown serialization (stable, greppable, round-trippable) ───────────────
// Shape (one step per bullet, pipe-delimited metadata after the title):
//
//   # <title>
//
//   > Goal: <goal>
//
//   ## Steps
//   - [<id>] (<status>, risk:<risk>) <title>
//     - detail: <detail>
//     - files: a.ts, b.ts
//     - dependsOn: step-1, step-2
//
//   ## Questions
//   - [<id>] <question>
//     - answer: <answer>
//
//   ## Risks
//   - <risk line>

function escapeInline(s: string): string {
  // Keep single-line; strip CR/LF so the greppable shape is never broken.
  return s.replace(/\r?\n/g, ' ').trim();
}

export function renderPlanMarkdown(planRaw: AgentPlan | null | undefined): string {
  const plan = createPlan((planRaw ?? { title: '', goal: '' }) as any, (planRaw as any)?.createdAt ?? 0);
  const lines: string[] = [];
  lines.push(`# ${escapeInline(plan.title)}`);
  lines.push('');
  lines.push(`> Goal: ${escapeInline(plan.goal)}`);
  lines.push('');
  lines.push('## Steps');
  if (plan.steps.length === 0) {
    lines.push('(none)');
  } else {
    for (const s of plan.steps) {
      lines.push(`- [${s.id}] (${s.status}, risk:${s.risk}) ${escapeInline(s.title)}`);
      if (s.detail !== undefined) lines.push(`  - detail: ${escapeInline(s.detail)}`);
      if (s.files.length) lines.push(`  - files: ${s.files.map(escapeInline).join(', ')}`);
      if (s.dependsOn.length) lines.push(`  - dependsOn: ${s.dependsOn.map(escapeInline).join(', ')}`);
    }
  }
  lines.push('');
  lines.push('## Questions');
  if (plan.questions.length === 0) {
    lines.push('(none)');
  } else {
    for (const q of plan.questions) {
      lines.push(`- [${q.id}] ${escapeInline(q.question)}`);
      if (q.answer !== undefined) lines.push(`  - answer: ${escapeInline(q.answer)}`);
    }
  }
  lines.push('');
  lines.push('## Risks');
  if (plan.risks.length === 0) {
    lines.push('(none)');
  } else {
    for (const r of plan.risks) lines.push(`- ${escapeInline(r)}`);
  }
  return lines.join('\n');
}

// Section header the parser keys off of.
type Section = 'none' | 'steps' | 'questions' | 'risks';

const STEP_HEAD_RE = /^-\s+\[([^\]]*)\]\s+\((pending|approved|rejected|done|skipped),\s*risk:(low|medium|high)\)\s?(.*)$/;
const Q_HEAD_RE = /^-\s+\[([^\]]*)\]\s?(.*)$/;
const SUB_RE = /^\s{2,}-\s+(detail|files|dependsOn|answer):\s?(.*)$/;

function splitList(raw: string): string[] {
  return normalizeStringList(raw.split(',').map((x) => x.trim()));
}

/**
 * Best-effort inverse of `renderPlanMarkdown`. Tolerant of surrounding text,
 * missing sections, and minor formatting drift; anything unparseable is dropped
 * rather than throwing. `parse(render(p))` preserves step ids/status/titles/deps
 * (and files, questions, risks). Never throws.
 */
export function parsePlanMarkdown(mdRaw: unknown): AgentPlan {
  const md = typeof mdRaw === 'string' ? mdRaw : '';
  const rawLines = md.split(/\r?\n/);

  let title = '';
  let goal = '';
  let section: Section = 'none';
  const steps: PlanStep[] = [];
  const questions: PlanQuestion[] = [];
  const risks: string[] = [];
  let lastStep: PlanStep | null = null;
  let lastQuestion: PlanQuestion | null = null;

  for (const line of rawLines) {
    if (title === '' && /^#\s+/.test(line)) { title = line.replace(/^#\s+/, '').trim(); continue; }
    const goalMatch = /^>\s*Goal:\s?(.*)$/.exec(line);
    if (goalMatch) { goal = goalMatch[1].trim(); continue; }

    if (/^##\s+Steps\s*$/i.test(line)) { section = 'steps'; lastStep = null; lastQuestion = null; continue; }
    if (/^##\s+Questions\s*$/i.test(line)) { section = 'questions'; lastStep = null; lastQuestion = null; continue; }
    if (/^##\s+Risks\s*$/i.test(line)) { section = 'risks'; lastStep = null; lastQuestion = null; continue; }

    // Sub-bullets attach to the most recent step/question.
    const sub = SUB_RE.exec(line);
    if (sub) {
      const key = sub[1];
      const val = sub[2];
      if (section === 'steps' && lastStep) {
        if (key === 'detail') lastStep.detail = clampText(val);
        else if (key === 'files') lastStep.files = splitList(val);
        else if (key === 'dependsOn') lastStep.dependsOn = splitList(val);
      } else if (section === 'questions' && lastQuestion) {
        if (key === 'answer') lastQuestion.answer = clampText(val);
      }
      continue;
    }

    if (section === 'steps') {
      const m = STEP_HEAD_RE.exec(line);
      if (m) {
        const step: PlanStep = {
          id: (m[1] || '').trim() || `step-${steps.length + 1}`,
          title: clampText(m[4]).trim(),
          files: [],
          risk: coerceRisk(m[3]),
          status: coerceStatus(m[2]),
          dependsOn: [],
        };
        steps.push(step);
        lastStep = step;
        continue;
      }
    } else if (section === 'questions') {
      const m = Q_HEAD_RE.exec(line);
      if (m) {
        const q: PlanQuestion = {
          id: (m[1] || '').trim() || `question-${questions.length + 1}`,
          question: clampText(m[2]).trim(),
        };
        questions.push(q);
        lastQuestion = q;
        continue;
      }
    } else if (section === 'risks') {
      const m = /^-\s+(.*)$/.exec(line);
      if (m && m[1].trim() && m[1].trim() !== '(none)') risks.push(clampText(m[1]).trim());
      continue;
    }
  }

  // Re-run through createPlan so ids/dedupe/clamps are consistent with the model.
  // createdAt is not encoded in the markdown; 0 is the deterministic default.
  return createPlan({ title, goal, steps, questions, risks }, 0);
}

// ── summarizePlan ─────────────────────────────────────────────────────────────
/**
 * One-line status of the plan, e.g. "3/7 approved · 2 done · 1 blocked".
 * "approved" counts steps that are approved OR done (they've cleared the gate);
 * "done" counts completed steps; "blocked" comes from selectBuildableSteps.
 * Never throws.
 */
export function summarizePlan(planRaw: AgentPlan | null | undefined): string {
  const plan = createPlan((planRaw ?? { title: '', goal: '' }) as any, (planRaw as any)?.createdAt ?? 0);
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === 'done').length;
  const approvedOrDone = plan.steps.filter((s) => s.status === 'approved' || s.status === 'done').length;
  const { blocked } = selectBuildableSteps(plan);
  const parts = [`${approvedOrDone}/${total} approved`, `${done} done`, `${blocked.length} blocked`];
  const openQuestions = plan.questions.filter((q) => q.answer === undefined || q.answer.trim() === '').length;
  if (openQuestions > 0) parts.push(`${openQuestions} open question${openQuestions === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
