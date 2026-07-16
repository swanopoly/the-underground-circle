/**
 * agentRunProofPublisherCore — the ACCOUNTABILITY keystone (docs/
 * ACCOUNTABILITY_PROOF_OF_WORK_PLAN.md GAP 1/2/3/4).
 *
 * The app has a fully-built proof-of-work Feed lane, a proof-card summarizer
 * (`openswanRunProofCore.buildRunProof`), and a task↔PR extractor
 * (`taskPRLinkageCore.extractGitReferences`) — but **the write path is never
 * connected**. A completed OpenSwan run persists rich telemetry to `agent_runs`
 * / `agent_run_events`, yet the team Feed reads a *different* set of tables
 * (`agent_activity`, `proof_of_work`, …) and so shows GitHub webhook rows and
 * manual check-ins, but never a single agent run.
 *
 * This core is the missing bridge. It COMPOSES the two already-built pure cores
 * into a Feed-visible, proof-of-work **row payload**:
 *   - `buildRunProof(...)`      → the bounded, secret-safe proof card
 *     (headline ≤120, ≤8 bullets, verified, proofTags) — "what was done, what
 *     was verified".
 *   - `extractGitReferences(...)`→ canonical, host-scoped GitHub PR / commit /
 *     branch / compare links found in the run's deliverable, tool events, and
 *     attachments — so the Feed can show "Linked PR #123 (owner/repo)" and a
 *     later merge webhook can settle it against the same canonical URL.
 *
 * `buildRunProofPublication(...)` returns BOTH rows the Feed needs:
 *   - `proofRow`    — the `proof_of_work` content payload (pow_type 'agent_run',
 *                     title = headline, bullets, verified, git_references,
 *                     proof_tags, run_id, task_id?, at). Durable proof lane.
 *   - `activityRow` — an `agent_activity` `task_completed` / `task_failed` row
 *                     so a completed run also rides the EXISTING realtime Feed
 *                     subscription (`agent_activity` INSERT on circle_id).
 *   - `gitReferences` — the raw typed refs (also embedded in both rows).
 *
 * IDENTITY IS THE CALLER'S. This core is pure and cannot know `circle_id`,
 * `agent_name`, `user_id`, or `mission_id` (they are runtime identity, not run
 * signals). The caller merges those in and performs the DB write, e.g.:
 *   addProofOfWork({ circle_id, user_id, agent_name, mission_id,
 *     pow_type: proofRow.pow_type, title: proofRow.title, detail: proofRow });
 *   logActivity({ circle_id, agent_name, ...activityRow });
 * The DB write (and its RLS / non-fatal guard) stays the caller's concern.
 *
 * PURITY: the only imports are the two SIBLING PURE cores (both zero-import,
 * tsx-loadable) at RUNTIME. No Date.now()/Math.random() at module scope — the
 * timestamp is derived from an injected `nowMs`. Every export is TOTAL: null /
 * undefined / wrong-type / huge / hostile / cyclic input yields safe, neutral,
 * JSON-serializable rows and NEVER throws. All output is bounded. Secret-safe:
 * both sub-cores already reduce paths to basenames, mask secret-looking tokens,
 * and hard-scope URLs to github.com — this core never writes raw run text into a
 * row, so no full path or key can leak into `proof_of_work` / `agent_activity`.
 */

import { buildRunProof, type RunProof } from './openswanRunProofCore';
import {
  extractGitReferences,
  formatGitReferenceLabel,
  type GitReference,
} from './taskPRLinkageCore';

// ─── Bounds (hostile-input safe) ────────────────────────────────────────────

const MAX_ID_LEN = 200; // per-id clip (run_id / task_id)
const MAX_HEADLINE = 120; // matches openswanRunProofCore headline cap
const MAX_BULLETS = 8; // matches openswanRunProofCore bullet cap
const MAX_TAGS = 16; // matches openswanRunProofCore tag cap
const MAX_BODY_LEN = 700; // activity_type body clip (compact-row rule)
const MAX_GIT_LABELS = 8; // display labels rendered into body/metadata
const MAX_EPOCH_MS = 8.64e15; // JS Date valid range bound (±100,000,000 days)

// pow_type for a completed agent run — styled by ActivityFeedPanel + PowType.
const POW_TYPE_AGENT_RUN = 'agent_run';

// ─── Public shapes ──────────────────────────────────────────────────────────

export interface RunProofPublicationInput {
  /** agent_runs.id (the OpenSwan/typed-core run). Coerced to a bounded id. */
  runId?: unknown;
  /** Feed task id, when the run completed a task. Omitted from rows when absent. */
  taskId?: unknown;
  /** Tool names, OpenSwanToolEvent[], or a container → buildRunProof.toolsUsed. */
  toolsUsed?: unknown;
  /** File path strings / edit events → buildRunProof.filesTouched (basenames). */
  filesTouched?: unknown;
  /** OpenSwanVerificationResult[] / verification.* events → buildRunProof. */
  verification?: unknown;
  /** runResult.stopReason or loop status → buildRunProof.stopReason. */
  stopReason?: unknown;
  /** Wall-clock duration in ms → buildRunProof.durationMs. */
  durationMs?: unknown;
  /** The model's final response / summary → buildRunProof.outputSummary. */
  outputSummary?: unknown;
  /** Completed task deliverable text → extractGitReferences.deliverable. */
  deliverable?: unknown;
  /** Agent tool events (git.run output etc.) → extractGitReferences.toolEvents.
   *  Falls back to `toolsUsed` when omitted (the real caller often has one array). */
  toolEvents?: unknown;
  /** Attachment URLs → extractGitReferences.attachments. */
  attachments?: unknown;
  /** Injected wall-clock ms for the `at` stamp (purity: no Date.now here). */
  nowMs?: unknown;
}

export interface RunProofPublication {
  /**
   * The `proof_of_work` content payload for the Feed's durable proof lane.
   * Caller adds identity (circle_id / agent_name / user_id / mission_id) and
   * writes it: `addProofOfWork({ …identity, pow_type: proofRow.pow_type,
   * title: proofRow.title, detail: proofRow })`.
   */
  proofRow: Record<string, unknown>;
  /**
   * An `agent_activity` `task_completed` / `task_failed` row so the completed
   * run rides the existing realtime Feed subscription. Caller adds identity
   * (circle_id / agent_name) and writes it via `logActivity(...)`.
   */
  activityRow: Record<string, unknown>;
  /** The canonical, host-scoped GitHub refs (also embedded in both rows). */
  gitReferences: GitReference[];
}

// ─── Small total helpers ────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerce a scalar id (string / finite number / bigint) to a bounded, control-
 * char-free string; everything else → ''. Ids are caller identity, not model
 * output, so they are clipped (not secret-redacted — that would mangle a uuid).
 */
function scalarId(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else if (typeof v === 'bigint') s = String(v);
  else return '';
  // Clip BEFORE regex work so a hostile multi-MB "id" costs constant time.
  if (s.length > MAX_ID_LEN * 4) s = s.slice(0, MAX_ID_LEN * 4);
  s = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > MAX_ID_LEN ? s.slice(0, MAX_ID_LEN) : s;
}

/** Injected-ms → ISO string, guarded. Invalid / out-of-range → '' (DB default
 *  created_at covers the real stamp). Never throws. */
function isoFromMs(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  if (v < 0 || v > MAX_EPOCH_MS) return '';
  try {
    return new Date(v).toISOString();
  } catch {
    return '';
  }
}

/** Clip free text to `max` (control chars already scrubbed upstream by the
 *  sub-cores; this only bounds the joined body). */
function clipText(s: string, max: number): string {
  if (typeof s !== 'string' || s.length === 0 || max <= 0) return '';
  return s.length > max ? s.slice(0, max) : s;
}

/** Normalize a bullet/tag list from a sub-core: keep only bounded strings. */
function boundedStrings(v: unknown, cap: number, perLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const el of v) {
    if (out.length >= cap) break;
    if (typeof el !== 'string' || el.length === 0) continue;
    out.push(el.length > perLen ? el.slice(0, perLen) : el);
  }
  return out;
}

/**
 * The run's outcome as stamped by buildRunProof — it adds exactly one of these
 * as the FIRST proof tag (`addTag(outcome)`), so scanning the tags recovers it
 * without re-deriving. 'failed' / 'stopped' mean the run did not cleanly finish.
 */
function outcomeFromTags(tags: string[]): 'completed' | 'failed' | 'stopped' | 'no-activity' | '' {
  for (const t of tags) {
    if (t === 'failed') return 'failed';
    if (t === 'stopped') return 'stopped';
    if (t === 'completed') return 'completed';
    if (t === 'no-activity') return 'no-activity';
  }
  return '';
}

// ─── Compose ─────────────────────────────────────────────────────────────────

/**
 * Fold a completed run's signals into the two Feed rows + the typed git refs.
 *
 * Composition:
 *   1. `buildRunProof` → the secret-safe proof card (headline / bullets /
 *      verified / proofTags). Sub-core is TOTAL; wrapped defensively anyway.
 *   2. `extractGitReferences` → canonical github.com refs from deliverable +
 *      tool events + attachments (falls back to `toolsUsed` for the tool-event
 *      source when `toolEvents` is omitted).
 *   3. Assemble `proofRow` (proof_of_work content) and `activityRow`
 *      (agent_activity task_completed/failed). Honest: a failed / stopped run
 *      → verified=false, activity_type 'task_failed', status 'failed'.
 *
 * Never throws. Identity (circle_id / agent_name / user_id / mission_id) and the
 * DB write are the caller's.
 */
export function buildRunProofPublication(input: RunProofPublicationInput): RunProofPublication {
  const safe: RunProofPublicationInput = isRecord(input) ? input : {};

  // 1) proof card — secret-safe, bounded. (buildRunProof is total; guard anyway.)
  let proof: RunProof;
  try {
    proof = buildRunProof({
      toolsUsed: safe.toolsUsed,
      filesTouched: safe.filesTouched,
      verification: safe.verification,
      stopReason: safe.stopReason,
      durationMs: safe.durationMs,
      outputSummary: safe.outputSummary,
    });
  } catch {
    proof = { headline: '', bullets: [], verified: false, proofTags: [] };
  }
  if (!isRecord(proof)) proof = { headline: '', bullets: [], verified: false, proofTags: [] };

  const headline = clipText(typeof proof.headline === 'string' ? proof.headline : '', MAX_HEADLINE)
    || 'OpenSwan run — no recorded activity';
  const bullets = boundedStrings(proof.bullets, MAX_BULLETS, 160);
  const proofTags = boundedStrings(proof.proofTags, MAX_TAGS, 40);
  const verified = proof.verified === true;

  // 2) canonical github refs. The tool-event text source falls back to toolsUsed
  //    so the common single-array caller ({tool_events}) still links its PRs.
  const gitEventsSource =
    safe.toolEvents !== undefined && safe.toolEvents !== null ? safe.toolEvents : safe.toolsUsed;
  let gitReferences: GitReference[];
  try {
    const refs = extractGitReferences({
      deliverable: safe.deliverable,
      toolEvents: gitEventsSource,
      attachments: safe.attachments,
    });
    gitReferences = Array.isArray(refs) ? refs.filter((r): r is GitReference => isRecord(r)) : [];
  } catch {
    gitReferences = [];
  }

  const runId = scalarId(safe.runId);
  const taskId = scalarId(safe.taskId);
  const at = isoFromMs(safe.nowMs);

  const outcome = outcomeFromTags(proofTags);
  const runFailed = outcome === 'failed' || outcome === 'stopped';

  // Display labels ("PR #123 (owner/repo)") — total, bounded.
  const gitLabels: string[] = [];
  for (const ref of gitReferences) {
    if (gitLabels.length >= MAX_GIT_LABELS) break;
    let label = '';
    try {
      label = formatGitReferenceLabel(ref);
    } catch {
      label = '';
    }
    if (label) gitLabels.push(label);
  }

  // 3a) proofRow — the proof_of_work content payload.
  const proofRow: Record<string, unknown> = {
    run_id: runId || null,
    pow_type: POW_TYPE_AGENT_RUN,
    title: headline, // proof_of_work.title
    headline,
    bullets,
    verified,
    git_references: gitReferences,
    proof_tags: proofTags,
    at,
  };
  if (taskId) proofRow.task_id = taskId;

  // 3b) activityRow — agent_activity row that rides the realtime Feed.
  const bodyBase = bullets.join(' — ');
  const bodyWithLinks =
    gitLabels.length > 0
      ? `${bodyBase}${bodyBase ? ' — ' : ''}Linked: ${gitLabels.join(', ')}`
      : bodyBase;
  const body = clipText(bodyWithLinks, MAX_BODY_LEN);

  const activityRow: Record<string, unknown> = {
    activity_type: runFailed ? 'task_failed' : 'task_completed',
    source: 'system',
    status: runFailed ? 'failed' : 'completed',
    title: headline,
    body,
    metadata: {
      run_id: runId || null,
      ...(taskId ? { task_id: taskId } : {}),
      verified,
      proof_tags: proofTags,
      git_references: gitReferences,
      git_labels: gitLabels,
      at,
    },
  };

  return { proofRow, activityRow, gitReferences };
}
