/**
 * accountabilityDigestCore — pure agent-work accountability digest builder.
 *
 * Folds the rows the Feed/Office surfaces already persist — `proof_of_work`
 * (agent_run proofs written by agentRunProofPublisherCore with
 * detail: { verified, bullets[], git_references[] }, plus webhook-shape
 * commit/pr/deploy rows with detail.url), `agent_activity`
 * (task_completed / task_failed rows, metadata.run_id), and kanban `tasks` —
 * into one compact standup digest: run counts, verification coverage,
 * unverified completions, PR references, task completion/overdue counts,
 * top agents, and short highlight lines.
 *
 * TOTAL: never throws. Missing/malformed arrays, rows, timestamps, or details
 * degrade to zeros / exclusion, never to an exception. Pure: no I/O, no
 * Date.now() when `nowMs` is supplied (smoke-testable via tsx).
 */

// ─── Input row shapes (loose on purpose; every field is guarded) ─────────────

export interface DigestProofRow {
  id?: string;
  pow_type?: string;
  title?: string | null;
  agent_name?: string | null;
  created_at?: string | null;
  /** agent_run shape: { verified, bullets[], git_references[], run_id } —
   *  webhook shape (pr/commit/deploy): { url, pr_number, repo, ... } */
  detail?: any;
}

export interface DigestActivityRow {
  id?: string;
  agent_name?: string | null;
  activity_type?: string | null;
  title?: string | null;
  created_at?: string | null;
  /** publisher shape: { run_id, verified, git_references, ... } */
  metadata?: any;
}

export interface DigestTaskRow {
  id?: string;
  status?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
}

export interface DigestRunRow {
  id?: string;
  agent_name?: string | null;
  agent_id?: string | null;
  status?: string | null;
  started_at?: string | null;
  created_at?: string | null;
}

export interface AccountabilityDigestInput {
  nowMs?: number;
  /** Window length in days; default 7, clamped to [1, 90]. */
  windowDays?: number;
  proofRows?: DigestProofRow[] | null;
  activityRows?: DigestActivityRow[] | null;
  taskRows?: DigestTaskRow[] | null;
  /** Optional explicit run rows (task_runs / agent_runs shaped). When present
   *  they own the `runs` count and topAgents; otherwise agent_run proof rows
   *  stand in. */
  runRows?: DigestRunRow[] | null;
}

// ─── Output ──────────────────────────────────────────────────────────────────

export interface AccountabilityDigestCounts {
  runs: number;
  verifiedRuns: number;
  unverifiedCompletions: number;
  prReferences: number;
  tasksCompleted: number;
  tasksOverdue: number;
}

export interface AccountabilityDigest {
  counts: AccountabilityDigestCounts;
  topAgents: Array<{ name: string; runs: number }>;
  highlights: string[];
  windowLabel: string;
}

const MAX_TOP_AGENTS = 3;
const MAX_HIGHLIGHTS = 5;
const DEFAULT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

// ─── Guards ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

function toMs(v: unknown): number | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function emptyDigest(windowLabel: string): AccountabilityDigest {
  return {
    counts: {
      runs: 0,
      verifiedRuns: 0,
      unverifiedCompletions: 0,
      prReferences: 0,
      tasksCompleted: 0,
      tasksOverdue: 0,
    },
    topAgents: [],
    highlights: [],
    windowLabel,
  };
}

/** PR identity from a taskPRLinkageCore GitReference-shaped entry, or '' when
 *  the entry is not a PR reference. */
function prIdentityFromGitRef(ref: unknown): string {
  if (!isRecord(ref)) return '';
  const isPr =
    ref.type === 'pull_request' ||
    (typeof ref.prNumber === 'number' && Number.isFinite(ref.prNumber));
  if (!isPr) return '';
  if (typeof ref.url === 'string' && ref.url.length > 0) return ref.url;
  const repo = typeof ref.repo === 'string' ? ref.repo : '';
  const num = typeof ref.prNumber === 'number' ? ref.prNumber : null;
  if (num !== null) return `${repo}#${num}`;
  return '';
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildAccountabilityDigest(
  input?: AccountabilityDigestInput | null,
): AccountabilityDigest {
  // Sanitize window up-front so even the failure path has an honest label.
  const rawDays = isRecord(input) ? input.windowDays : undefined;
  const windowDays =
    typeof rawDays === 'number' && Number.isFinite(rawDays) && rawDays >= 1
      ? Math.min(90, Math.floor(rawDays))
      : DEFAULT_WINDOW_DAYS;
  const windowLabel = `Last ${plural(windowDays, 'day')}`;

  try {
    const safe: AccountabilityDigestInput = isRecord(input) ? input : {};
    const nowMs =
      typeof safe.nowMs === 'number' && Number.isFinite(safe.nowMs)
        ? safe.nowMs
        : Date.now();
    const windowStart = nowMs - windowDays * DAY_MS;
    const inWindow = (ms: number | null): boolean =>
      ms !== null && ms >= windowStart && ms <= nowMs;

    const proofRows = asArray(safe.proofRows).filter(isRecord);
    const activityRows = asArray(safe.activityRows).filter(isRecord);
    const taskRows = asArray(safe.taskRows).filter(isRecord);
    const runRows = asArray(safe.runRows).filter(isRecord);

    // ── Proof rows in window, split by shape ────────────────────────────────
    const proofsInWindow = proofRows.filter((p) => inWindow(toMs(p.created_at)));
    const agentRunProofs = proofsInWindow.filter((p) => p.pow_type === 'agent_run');

    // ── runs + topAgents (explicit runRows own both when provided) ──────────
    const runRowsInWindow = runRows.filter((r) =>
      inWindow(toMs(r.started_at) ?? toMs(r.created_at)),
    );
    const useRunRows = runRows.length > 0;
    const runs = useRunRows ? runRowsInWindow.length : agentRunProofs.length;

    const runsByAgent = new Map<string, number>();
    if (useRunRows) {
      for (const r of runRowsInWindow) {
        const name = cleanName(r.agent_name) || cleanName(r.agent_id);
        if (!name) continue;
        runsByAgent.set(name, (runsByAgent.get(name) || 0) + 1);
      }
    } else {
      for (const p of agentRunProofs) {
        const name = cleanName(p.agent_name);
        if (!name) continue;
        runsByAgent.set(name, (runsByAgent.get(name) || 0) + 1);
      }
    }
    const topAgents = Array.from(runsByAgent.entries())
      .map(([name, count]) => ({ name, runs: count }))
      .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, MAX_TOP_AGENTS);

    // ── Verification ────────────────────────────────────────────────────────
    const verifiedRuns = agentRunProofs.filter(
      (p) => isRecord(p.detail) && p.detail.verified === true,
    ).length;

    // Unverified completions, shape 1: agent_run proof with verified !== true.
    let unverifiedCompletions = agentRunProofs.length - verifiedRuns;

    // Shape 2: a task_completed activity row with no matching verified proof.
    // Match by metadata.run_id ↔ detail.run_id first, then exact title.
    // An activity matching ANY agent_run proof (verified or not) is already
    // represented by shape 1, so only proof-less completions add here.
    const proofRunIds = new Set<string>();
    const proofTitles = new Set<string>();
    for (const p of agentRunProofs) {
      const runId = isRecord(p.detail) && typeof p.detail.run_id === 'string'
        ? p.detail.run_id
        : '';
      if (runId) proofRunIds.add(runId);
      const title = cleanName(p.title);
      if (title) proofTitles.add(title);
    }
    for (const a of activityRows) {
      if (a.activity_type !== 'task_completed') continue;
      if (!inWindow(toMs(a.created_at))) continue;
      const runId =
        isRecord(a.metadata) && typeof a.metadata.run_id === 'string'
          ? a.metadata.run_id
          : '';
      if (runId && proofRunIds.has(runId)) continue;
      const title = cleanName(a.title);
      if (!runId && title && proofTitles.has(title)) continue;
      unverifiedCompletions += 1;
    }

    // ── PR references (deduped across both proof shapes) ────────────────────
    const prIdentities = new Set<string>();
    for (let i = 0; i < proofsInWindow.length; i++) {
      const p = proofsInWindow[i];
      const detail = isRecord(p.detail) ? p.detail : {};
      // agent_run shape: detail.git_references[]
      if (Array.isArray(detail.git_references)) {
        for (const ref of detail.git_references) {
          const id = prIdentityFromGitRef(ref);
          if (id) prIdentities.add(id);
        }
      }
      // webhook shape: pow_type 'pr' rows with detail.url / pr_number.
      if (p.pow_type === 'pr') {
        if (typeof detail.url === 'string' && detail.url.length > 0) {
          prIdentities.add(detail.url);
        } else if (typeof detail.pr_number === 'number' && Number.isFinite(detail.pr_number)) {
          const repo = typeof detail.repo === 'string' ? detail.repo : '';
          prIdentities.add(`${repo}#${detail.pr_number}`);
        } else {
          prIdentities.add(`row:${typeof p.id === 'string' ? p.id : i}`);
        }
      }
    }
    const prReferences = prIdentities.size;

    // ── Tasks ───────────────────────────────────────────────────────────────
    let tasksCompleted = 0;
    let tasksOverdue = 0;
    for (const t of taskRows) {
      const done = t.status === 'done';
      if (done && inWindow(toMs(t.completed_at))) tasksCompleted += 1;
      if (!done) {
        const due = toMs(t.due_date);
        if (due !== null && due < nowMs) tasksOverdue += 1;
      }
    }

    // ── Highlights (bounded, warning-first) ─────────────────────────────────
    const highlights: string[] = [];
    if (unverifiedCompletions > 0) {
      highlights.push(`${plural(unverifiedCompletions, 'completion')} had no verification`);
    }
    if (runs > 0) {
      highlights.push(`${verifiedRuns} of ${plural(runs, 'run')} verified`);
    }
    if (tasksOverdue > 0) {
      highlights.push(`${plural(tasksOverdue, 'task')} overdue`);
    }
    if (prReferences > 0) {
      highlights.push(`${plural(prReferences, 'PR reference')} linked`);
    }
    if (topAgents.length > 0 && topAgents[0].runs > 0) {
      highlights.push(`${topAgents[0].name} led with ${plural(topAgents[0].runs, 'run')}`);
    }

    return {
      counts: {
        runs,
        verifiedRuns,
        unverifiedCompletions,
        prReferences,
        tasksCompleted,
        tasksOverdue,
      },
      topAgents,
      highlights: highlights.slice(0, MAX_HIGHLIGHTS),
      windowLabel,
    };
  } catch {
    return emptyDigest(windowLabel);
  }
}

/** True when the digest has nothing to report (used to hide the card). */
export function isEmptyAccountabilityDigest(digest?: AccountabilityDigest | null): boolean {
  if (!isRecord(digest) || !isRecord(digest.counts)) return true;
  const c = digest.counts;
  return (
    !(c.runs > 0) &&
    !(c.verifiedRuns > 0) &&
    !(c.unverifiedCompletions > 0) &&
    !(c.prReferences > 0) &&
    !(c.tasksCompleted > 0) &&
    !(c.tasksOverdue > 0)
  );
}
