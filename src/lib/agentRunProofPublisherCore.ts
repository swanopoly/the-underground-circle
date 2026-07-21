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

// ─── OpenSwan chat/room turn bridge (adapter + publication gate) ─────────────
//
// The chat/room OpenSwan session runtime finishes a turn holding runtime tool
// actions in the SwanBotStructuredToolAction shape — { tool_name, status,
// title, output_preview } — which NEITHER sub-core can read:
//   - `openswanRunProofCore.toolNameOf` reads el.tool ⏐ el.toolName ⏐ el.name
//     (never `tool_name`), so the proof card would count zero tools.
//   - `taskPRLinkageCore` scans e.summary / e.result / e.preview text (never
//     `output_preview`), so a `git.run` commit/push output would never become
//     a canonical git_reference.
// `mapRuntimeToolActionsToProofEvents` is that missing adapter, and
// `decideOpenSwanTurnProofPublication` is the honest publish/suppress gate the
// runtime consults before writing the Feed rows.

const MAX_MAPPED_EVENTS = 200; // sub-cores cap their own scans; this bounds the bridge
const MAX_MAPPED_NAME = 120; // tool / status clip
const MAX_MAPPED_SUMMARY = 300; // title → summary clip
const MAX_MAPPED_RESULT = 1600; // output_preview (runtime clips at 1200) → result clip
const MAX_REASON_LEN = 60;

/** Proof-event shape both sub-cores understand (see bridge note above). */
export interface OpenSwanMappedProofEvent {
  tool: string;
  status: string;
  summary: string;
  result: string;
}

/**
 * Adapt openswanSessionRuntime's runtime tool actions —
 * `{ tool_name, status, title, output_preview }` — into the
 * `{ tool, status, summary, result }` proof-event shape.
 *
 * `output_preview → result` is the load-bearing move: it puts the git
 * commit/push output ("To github.com:owner/repo.git … [main abc1234]") and any
 * pasted PR URL where `extractGitReferences` scans, so real mutations become
 * canonical `git_references` on the proof row.
 *
 * `status` passes through RAW: the runtime's failure statuses — 'failed',
 * 'manual_required', 'blocked' — are all already in the proof core's
 * TOOL_FAIL_STATUS set, and 'completed' counts as success; re-mapping would
 * only invite drift.
 *
 * TOTAL + bounded: non-array → []; malformed elements skipped; ≤200 events;
 * per-field clips. Accepts an already-mapped `tool` key too (idempotent).
 * Never throws.
 */
export function mapRuntimeToolActionsToProofEvents(actions: unknown): OpenSwanMappedProofEvent[] {
  if (!Array.isArray(actions)) return [];
  const out: OpenSwanMappedProofEvent[] = [];
  for (const el of actions) {
    if (out.length >= MAX_MAPPED_EVENTS) break;
    if (!isRecord(el)) continue;
    let tool = '';
    if (typeof el.tool_name === 'string') tool = el.tool_name;
    else if (typeof el.tool === 'string') tool = el.tool;
    tool = clipText(tool.trim(), MAX_MAPPED_NAME);
    if (!tool) continue;
    const status = typeof el.status === 'string' ? clipText(el.status, MAX_MAPPED_NAME) : '';
    const summary = typeof el.title === 'string' ? clipText(el.title, MAX_MAPPED_SUMMARY) : '';
    const result =
      typeof el.output_preview === 'string' ? clipText(el.output_preview, MAX_MAPPED_RESULT) : '';
    out.push({ tool, status, summary, result });
  }
  return out;
}

// Mutation-shaped evidence for the receipt-less legacy fallback: tool-name
// prefixes plus the two real edit tools (LOCKSTEP with
// openswanRunProofCore.EDIT_TOOLS / openswanToolRuntime — the catalog's file
// mutators are desktop.*, not fs.*). `git.` is DELIBERATELY EXCLUDED: git.run
// is dual-use (read auto / mutate ask per CLAUDE.md), so a read-only `git
// status`/`log`/`diff` success must NEVER tally as proof-of-work. A genuine
// commit/push is still covered — its `[branch sha]` / pushed-ref output yields
// a git reference, so it publishes via the `committed` (typed loop) or
// `gitRefCount` (both loops) branches above, never this bare-prefix fallback.
const MUTATION_TOOL_PREFIXES = ['fs.', 'file.'];
const MUTATION_TOOL_NAMES = new Set<string>(['desktop.edit_file', 'desktop.file_write_text']);
// Explicit success statuses ('completed' = runtime shape, 'passed' = raw
// OpenSwanToolEvent). Anything else — failed/blocked/manual_required/missing —
// is NOT mutation evidence: the gate fails closed.
const TOOL_SUCCESS_STATUS = new Set<string>(['completed', 'passed']);

export type OpenSwanTurnStopReason = 'cancelled' | 'max_iterations' | 'end_turn';

export interface OpenSwanTurnProofDecisionInput {
  /** agent_runs surface for this turn ('main_chat' / 'room_chat' / 'feed_task' / …). */
  runSurface?: unknown;
  /** True when the user STOPped the turn (loop cancel or DB-side cancel). */
  cancelled?: unknown;
  /** True when the tool loop hit its per-turn step cap before a final answer. */
  incomplete?: unknown;
  /** verificationReceiptCore.VerificationReceipt — { editedFiles, committed, verdict }. */
  receipt?: unknown;
  /** Mapped proof events (mapRuntimeToolActionsToProofEvents output). */
  toolEvents?: unknown;
  /** structured.artifacts count for this turn. */
  artifactCount?: unknown;
  /** buildRunProofPublication(...).gitReferences.length once known. */
  gitRefCount?: unknown;
}

export interface OpenSwanTurnProofDecision {
  /** Write the proof_of_work row (and, unless suppressed, the activity row). */
  publish: boolean;
  /** True when a failed coding receipt must never tally a 'task_completed'
   *  activity — the durable proof row may still publish, honest and unverified. */
  suppressCompletedActivity: boolean;
  /** Honest stop family for buildRunProofPublication.stopReason. */
  stopReason: OpenSwanTurnStopReason;
  /** Short machine reason for observability/logs. */
  reason: string;
}

function nonNegCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/**
 * The publish/suppress gate for a finished chat/room OpenSwan turn.
 *
 * PUBLISH — only when the turn holds mutation-shaped evidence AND may publish:
 *   - `cancelled` → never publish. A user STOP leaves zero Feed rows; the
 *     partial work stays on the (honestly 'cancelled') agent_runs row.
 *   - `runSurface === 'feed_task'` → never publish. DOUBLE-POST GUARD: the
 *     Kanban/missions completion path (useKanbanData.runAgentOnTask) already
 *     publishes its own, richer proof for feed-task runs — task linkage,
 *     deliverable, attachments — so the session runtime must stay silent for
 *     that surface or every task run would hit the Feed twice.
 *   - Evidence, any of: receipt.editedFiles non-empty ⏐ receipt.committed ⏐
 *     gitRefCount>0 ⏐ artifactCount>0 ⏐ legacy fallback (no typed receipt on
 *     the legacy loop): a tool event with an explicit success status whose
 *     name starts fs./file. or is one of the catalog's edit tools. A bare
 *     git.* success is NOT evidence (git.run is dual-use); a real commit/push
 *     publishes via the committed / gitRefCount branches instead.
 *     A plain read-only Q&A turn publishes nothing.
 *
 * SUPPRESS — `receipt.verdict === 'failed'` (the typed loop's coding receipt
 * failed its checks): the 'task_completed' activity row is suppressed so a
 * failed change never tallies as a completion; the honest 'task_failed'
 * activity (from a failure-family stopReason) is never suppressed, and the
 * durable proof row still publishes when evidence exists.
 *
 * STOP REASON — cancelled → 'cancelled', incomplete → 'max_iterations', else
 * 'end_turn'. Both failure values sit in openswanRunProofCore's STOP_FAIL
 * family, so buildRunProofPublication stamps outcome 'stopped' → activity
 * 'task_failed' — a capped/stopped turn can never masquerade as a clean
 * completion. stopReason depends ONLY on cancelled/incomplete, so callers may
 * take it from a pre-pass call (before git references are known) and re-gate
 * `publish` with the real gitRefCount afterwards.
 *
 * TOTAL: hostile / null / wrong-type input never throws and fails closed
 * (publish false).
 */
export function decideOpenSwanTurnProofPublication(
  input: OpenSwanTurnProofDecisionInput,
): OpenSwanTurnProofDecision {
  const safe: OpenSwanTurnProofDecisionInput = isRecord(input) ? input : {};

  const cancelled = safe.cancelled === true;
  const incomplete = safe.incomplete === true;
  const stopReason: OpenSwanTurnStopReason = cancelled
    ? 'cancelled'
    : incomplete
      ? 'max_iterations'
      : 'end_turn';

  const receipt = isRecord(safe.receipt) ? safe.receipt : null;
  const editedCount = receipt
    ? Array.isArray(receipt.editedFiles)
      ? receipt.editedFiles.length
      : nonNegCount(receipt.editedFiles)
    : 0;
  const committed = receipt?.committed === true;
  const suppressCompletedActivity = receipt?.verdict === 'failed';

  const build = (publish: boolean, reason: string): OpenSwanTurnProofDecision => ({
    publish,
    suppressCompletedActivity,
    stopReason,
    reason: clipText(reason, MAX_REASON_LEN),
  });

  if (cancelled) return build(false, 'cancelled');
  const runSurface = typeof safe.runSurface === 'string' ? safe.runSurface : '';
  if (runSurface === 'feed_task') return build(false, 'feed-task-surface');

  if (editedCount > 0) return build(true, 'edited-files');
  if (committed) return build(true, 'committed');
  if (nonNegCount(safe.gitRefCount) > 0) return build(true, 'git-references');
  if (nonNegCount(safe.artifactCount) > 0) return build(true, 'artifacts');

  // Legacy fallback: the pre-typed loop produces no verification receipt, so a
  // successful file/git tool call is the remaining mutation signal.
  if (Array.isArray(safe.toolEvents)) {
    const n = Math.min(safe.toolEvents.length, MAX_MAPPED_EVENTS * 2);
    for (let i = 0; i < n; i += 1) {
      const el = safe.toolEvents[i];
      if (!isRecord(el)) continue;
      const tool =
        typeof el.tool === 'string' ? el.tool : typeof el.tool_name === 'string' ? el.tool_name : '';
      if (!tool) continue;
      const status = typeof el.status === 'string' ? el.status.toLowerCase() : '';
      if (!TOOL_SUCCESS_STATUS.has(status)) continue;
      if (MUTATION_TOOL_NAMES.has(tool) || MUTATION_TOOL_PREFIXES.some((p) => tool.startsWith(p))) {
        return build(true, 'mutating-tool');
      }
    }
  }

  return build(false, 'no-mutation-evidence');
}
