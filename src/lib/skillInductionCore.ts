/**
 * skillInductionCore — skills-expansion v8 (priority #2): auto-SUGGEST a new
 * SKILL.md when a SUCCESSFUL multi-tool procedure RECURS across agent runs, so
 * proven team procedures become reusable skills.
 *
 * This module only DETECTS + DRAFTS. It never writes. The caller runs it over
 * recent `agent_runs` signatures and files each returned candidate through the
 * existing HITL path (`skillLibraryWrite.fileComputerTaskRecipeProposal` →
 * `skill.create` in `agent_approvals`), where a circle member approves before
 * `applyApprovedSkillAction` performs the DB write. Mirrors the
 * frequency/success gating of `repeatedFlowDetection` but keys on the ORDERED
 * TOOL-NAME sequence (the "procedure") rather than a command string.
 *
 * PURE + secret-safe by construction:
 *   - Zero imports. Loads under tsx (no react-native / supabase).
 *   - No Date.now()/Math.random() — induction is a function of run signatures,
 *     not wall-clock.
 *   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile /
 *     cyclic input degrades to a safe neutral ('' or []) and never throws.
 *   - RunSignatureInput deliberately exposes only surface / status / toolNames
 *     / title. Raw tool INPUTS and OUTPUTS are never accepted, folded into a
 *     fingerprint, or echoed into a draft — no secret can leak through here.
 *   - All output is bounded (candidate count, tool sequence length, draft body
 *     ~6k chars).
 */

/** One run reduced to the fields induction is allowed to see. */
export interface RunSignatureInput {
  /** Run surface, e.g. 'main_chat' | 'office_terminal' | 'feed_task'. */
  surface?: unknown;
  /** Terminal status, e.g. 'completed' | 'failed' | 'cancelled'. */
  status?: unknown;
  /** Ordered tool names used in the run (strings, or rows with toolName/tool/name). */
  toolNames?: unknown;
  /** Human run title — normalized into a cluster key, never used verbatim as identity. */
  title?: unknown;
}

/** A proven, recurring procedure worth proposing as a SKILL.md. */
export interface SkillCandidate {
  /** Stable identity: surface + normalized title cluster + ordered tool sequence. */
  fingerprint: string;
  /** How many runs shared this fingerprint. */
  occurrences: number;
  /** completed / occurrences, rounded to 3 places (0..1). */
  successRatio: number;
  /** Normalized surface the procedure runs on. */
  surface: string;
  /** Ordered, bounded tool-name sequence (the procedure). */
  toolSequence: string[];
  /** Human-readable proposed skill title. */
  draftTitle: string;
  /** Full SKILL.md draft (frontmatter + When-to-use / Procedure / Pitfalls / Verification), bounded. */
  draftBody: string;
}

/** Hard cap on generated SKILL.md draft size (chars). */
export const DRAFT_BODY_MAX_CHARS = 6000;

// ─── Bounds ─────────────────────────────────────────────────────────────────
const MAX_RUNS_SCANNED = 20_000;
const MAX_TOOLS = 40;
const MAX_TOOL_NAME_CHARS = 48;
const MAX_TITLE_CLUSTER_CHARS = 80;
const MAX_TITLE_TOKENS = 10;
const MAX_SURFACE_CHARS = 60;
const MAX_PROCEDURE_STEPS = 30;
const MAX_CANDIDATES = 12;
const MAX_NAME_LIST = 5_000;
/** A procedure worth saving uses at least this many tools. */
const MIN_TOOL_STEPS = 2;

const SUCCESS_STATUSES = new Set(['completed', 'succeeded', 'success', 'done']);

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fingerprint a single run on surface + ordered tool-NAME sequence + a
 * normalized title cluster. Raw tool inputs/outputs are never folded in.
 * Total: any input (including a hostile proxy) yields a stable string.
 */
export function fingerprintRun(input: RunSignatureInput): string {
  try {
    return deriveSignature(input).fingerprint;
  } catch {
    return 'unknown||';
  }
}

/**
 * Group `runs` by fingerprint and return the groups that clear every gate:
 *   - occurrences >= minOccurrences (default 3)
 *   - successRatio >= minSuccessRatio (default 0.8)
 *   - a genuine multi-tool procedure (>= 2 tools)
 *   - not already covered by an existing skill
 *   - not already an open pending proposal
 * Each survivor becomes a parameterized SKILL.md draft candidate. Total: any
 * malformed / hostile input degrades to []. Output is bounded and sorted
 * strongest-first (occurrences, then success, then fingerprint).
 */
export function induceSkillCandidates(
  runs: unknown,
  opts?: {
    minOccurrences?: number;
    minSuccessRatio?: number;
    existingSkillNames?: unknown;
    pendingSkillTitles?: unknown;
  },
): SkillCandidate[] {
  try {
    const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {};
    const minOccurrences = Math.max(2, toFiniteInt(o.minOccurrences, 3));
    const minSuccessRatio = clamp(toFiniteNum(o.minSuccessRatio, 0.8), 0, 1);
    const existingSlugs = buildSlugSet(o.existingSkillNames);
    const pendingSlugs = buildSlugSet(o.pendingSkillTitles);

    const list = Array.isArray(runs) ? runs : [];
    const scanLimit = Math.min(list.length, MAX_RUNS_SCANNED);

    const groups = new Map<string, GroupAcc>();
    for (let i = 0; i < scanLimit; i++) {
      const sig = deriveSignature(list[i] as RunSignatureInput);
      // Only multi-tool procedures are induction-worthy — a single tool is not
      // a "procedure" and a zero-tool run carries no reusable sequence.
      if (sig.toolSequence.length < MIN_TOOL_STEPS) continue;

      let g = groups.get(sig.fingerprint);
      if (!g) {
        g = { sig, occurrences: 0, successCount: 0 };
        groups.set(sig.fingerprint, g);
      }
      g.occurrences += 1;
      if (SUCCESS_STATUSES.has(normalizeStatus(safeGet(list[i], 'status')))) {
        g.successCount += 1;
      }
    }

    const candidates: SkillCandidate[] = [];
    for (const g of groups.values()) {
      if (g.occurrences < minOccurrences) continue;
      const successRatio = g.occurrences > 0 ? g.successCount / g.occurrences : 0;
      if (successRatio < minSuccessRatio) continue;

      const draftTitle = buildDraftTitle(g.sig);
      const candidateSlug = slug(draftTitle);
      // Don't re-propose something the library already documents, or that is
      // already sitting in the approval queue.
      if (isCovered(candidateSlug, existingSlugs)) continue;
      if (isCovered(candidateSlug, pendingSlugs)) continue;

      const roundedRatio = Math.round(successRatio * 1000) / 1000;
      candidates.push({
        fingerprint: g.sig.fingerprint,
        occurrences: g.occurrences,
        successRatio: roundedRatio,
        surface: g.sig.surface,
        toolSequence: g.sig.toolSequence.slice(0, MAX_TOOLS),
        draftTitle,
        draftBody: buildDraftBody(g.sig, draftTitle, candidateSlug, g.occurrences, roundedRatio),
      });
    }

    candidates.sort((a, b) => {
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      if (b.successRatio !== a.successRatio) return b.successRatio - a.successRatio;
      return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
    });
    return candidates.slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

interface DerivedSignature {
  fingerprint: string;
  surface: string;
  titleCluster: string;
  toolSequence: string[];
}

interface GroupAcc {
  sig: DerivedSignature;
  occurrences: number;
  successCount: number;
}

function deriveSignature(input: RunSignatureInput): DerivedSignature {
  const surface = normalizeSurface(safeGet(input, 'surface'));
  const titleCluster = normalizeTitleCluster(safeGet(input, 'title'));
  const toolSequence = extractToolNames(safeGet(input, 'toolNames'));
  // Delimiters (`|` and `>`) are stripped from each part below so this join is
  // unambiguous.
  const fingerprint = `${surface}|${titleCluster}|${toolSequence.join('>')}`;
  return { fingerprint, surface, titleCluster, toolSequence };
}

function normalizeSurface(value: unknown): string {
  const s = safeStr(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[|>]/g, '/')
    .slice(0, MAX_SURFACE_CHARS);
  return s || 'unknown';
}

function normalizeStatus(value: unknown): string {
  return safeStr(value).trim().toLowerCase();
}

/**
 * Collapse a run title into a cluster key: lowercase, strip punctuation, drop
 * pure-number tokens (ids / counters / "#3") so "Deploy staging #1" and
 * "Deploy staging #2" cluster together. Order-preserving, bounded.
 */
function normalizeTitleCluster(value: unknown): string {
  const tokens = safeStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !/^\d+$/.test(t));
  return tokens.slice(0, MAX_TITLE_TOKENS).join(' ').slice(0, MAX_TITLE_CLUSTER_CHARS);
}

function extractToolNames(value: unknown): string[] {
  let arr: unknown[];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string') arr = [value];
  else return [];
  const out: string[] = [];
  for (let i = 0; i < arr.length && out.length < MAX_TOOLS; i++) {
    const name = extractOneToolName(arr[i]);
    if (name) out.push(name);
  }
  return out;
}

function extractOneToolName(item: unknown): string {
  let raw = '';
  if (typeof item === 'string') {
    raw = item;
  } else if (item && typeof item === 'object') {
    raw = safeStr(safeGet(item, 'toolName') ?? safeGet(item, 'tool') ?? safeGet(item, 'name') ?? '');
  }
  return raw.trim().replace(/\s+/g, ' ').replace(/[|>]/g, '').slice(0, MAX_TOOL_NAME_CHARS);
}

function buildSlugSet(value: unknown): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(value)) return set;
  const limit = Math.min(value.length, MAX_NAME_LIST);
  for (let i = 0; i < limit; i++) {
    const s = slug(safeStr(value[i]));
    if (s) set.add(s);
  }
  return set;
}

function isCovered(candidateSlug: string, existing: Set<string>): boolean {
  if (!candidateSlug || existing.size === 0) return false;
  if (existing.has(candidateSlug)) return true;
  // Near-cover: one non-trivial slug fully contains the other (e.g. an existing
  // "deploy-staging" covering a "deploy-staging-site" candidate).
  for (const e of existing) {
    if (e.length >= 6 && candidateSlug.length >= 6 && (e.includes(candidateSlug) || candidateSlug.includes(e))) {
      return true;
    }
  }
  return false;
}

function buildDraftTitle(sig: DerivedSignature): string {
  if (sig.titleCluster) return titleCase(sig.titleCluster).slice(0, 80);
  const first = sig.toolSequence[0] || 'tool';
  const last = sig.toolSequence[sig.toolSequence.length - 1] || first;
  const surfaceWord = sig.surface === 'unknown' ? '' : `${titleCase(sig.surface.replace(/_/g, ' '))} `;
  return `${surfaceWord}${first} to ${last} procedure`.slice(0, 80);
}

function buildDraftBody(
  sig: DerivedSignature,
  title: string,
  nameSlug: string,
  occurrences: number,
  successRatio: number,
): string {
  const pct = Math.round(clamp(successRatio, 0, 1) * 100);
  const name = nameSlug || 'induced-procedure';
  const surfaceTag = slug(sig.surface) || 'unknown';
  const first = sig.toolSequence[0] || 'tool';
  const last = sig.toolSequence[sig.toolSequence.length - 1] || first;
  const intent = sig.titleCluster || `${first} → ${last}`;
  const desc = `Induced team procedure (${sig.toolSequence.length} tools on ${sig.surface}) that recurred across ${occurrences} successful runs.`
    .replace(/\n/g, ' ')
    .slice(0, 200);

  const steps = sig.toolSequence.slice(0, MAX_PROCEDURE_STEPS);
  const procedureLines = steps.map(
    (tool, idx) =>
      `${idx + 1}. \`${tool}\` — run with the appropriate input (substitute \`{{step_${idx + 1}_input}}\`); verify the result before continuing.`,
  );
  if (sig.toolSequence.length > steps.length) {
    procedureLines.push(
      `${steps.length + 1}. … ${sig.toolSequence.length - steps.length} more step(s) trimmed to fit the draft budget — keep the same observe → act → verify rhythm.`,
    );
  }

  const lines: string[] = [
    '---',
    `name: ${name}`,
    `description: ${desc}`,
    'version: 1.0.0',
    `tags: [induced-skill, team-procedure, ${surfaceTag}]`,
    '---',
    '',
    `# ${title}`,
    '',
    '## When to use',
    `When you need to ${intent} on the \`${sig.surface}\` surface. This multi-tool`,
    `procedure recurred across ${occurrences} successful team run(s) (${pct}% success),`,
    'so it is a proven, repeatable flow — follow it instead of re-deriving the steps.',
    '',
    '## Procedure',
    'Run these tools in order. Substitute each `{{...}}` slot with the concrete value',
    'for your task, and confirm each step before moving to the next:',
    ...procedureLines,
    '',
    '## Pitfalls',
    '- Observe the live state before each step; a stale or missing target invalidates',
    '  the remaining recorded steps (they are hypotheses from past runs, not guarantees).',
    '- Pause for human approval before any irreversible step (submit, publish, delete,',
    '  payment, upload, or credential use).',
    '- If a result does not match the expectation, stop replaying and re-plan from the',
    '  current situation rather than forcing the recorded sequence.',
    '',
    '## Verification',
    '- Finish with concrete proof (screenshot, file stats, URL/id, or command output)',
    '  before declaring the task done.',
    '- The source runs ended in a completed state — match that terminal outcome.',
  ];

  const body = lines.join('\n');
  return body.length > DRAFT_BODY_MAX_CHARS ? body.slice(0, DRAFT_BODY_MAX_CHARS) : body;
}

// ─── Safe primitives ────────────────────────────────────────────────────────

function safeGet(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    const s = String(value);
    return typeof s === 'string' ? s : '';
  } catch {
    return '';
  }
}

function toFiniteNum(value: unknown, fallback: number): number {
  try {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function toFiniteInt(value: unknown, fallback: number): number {
  return Math.floor(toFiniteNum(value, fallback));
}

function clamp(n: number, lo: number, hi: number): number {
  if (!(n >= lo)) return lo; // also catches NaN
  if (n > hi) return hi;
  return n;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
