// crossSurfaceFollowupCore — the PURE producer that turns a FINALIZED chat turn /
// agent run into concrete, ranked follow-up actions on OTHER app surfaces. It is
// the structural counterpart to crossSurfaceReferenceResolverCore (Round 1):
//   - the resolver reads a user MESSAGE -> EXISTING entity nav targets;
//   - this core reads the machine OUTCOME -> PROPOSED NEW actions (often creating
//     or attaching work).
//
// The runtime already knows, the moment a bot message is finalized: the machine
// verdict (chatOutcomeSignals.deriveOutcomeVerdict), what was produced
// (artifacts / browser proof / findings / git PR+commit refs via
// taskPRLinkageCore.extractGitReferences), and which mission/room/task/run is in
// scope for the thread. But NOTHING converts that STRUCTURAL outcome into the
// accountability loop the product is built on (CLAUDE.md #1): a finished computer
// task that produced a PR + 3 screenshots dead-ends in chat — it is never offered
// as "log proof to mission X", "link PR #123 to the source task", or "create a
// Feed task to track this". The one existing producer, agentRuntime.detectHandoff,
// only fires when the model's PROSE literally says "let's create a task" — it is
// verdict-blind, entity-blind (regexes a title out of prose), single-shot, and can
// only express create_task/open_room/escalate. Silent completions, computer-task
// outcomes, and PR-producing runs (the common case) trigger no handoff at all.
//
// This module is that missing structural producer. Given the already-derived
// verdict plus the compact "what was produced / what is in scope" facts, it emits
// a small, ranked, deduped set of typed CrossSurfaceFollowup descriptors — each
// carrying a real EntityHandle nav target (round-trips through
// entityHandleCore.encodeEntityHandle) or a real `/task new` seed command — that
// the chat surface can render as a chip row under the receipt.
//
// PURITY: the ONLY imports are `import type` from three zero-import, tsx-loadable
// siblings (chatOutcomeSignals, entityHandleCore, taskPRLinkageCore); nothing is
// imported at runtime, so this file loads under tsx with zero dependencies. No
// supabase / react-native / network. DETERMINISTIC — no Date.now / Math.random /
// mutable module state; all decision tables are frozen const maps, so identical
// input always yields byte-identical output. Every export is TOTAL: null /
// undefined / wrong-typed / huge / hostile / cyclic / throwing-getter input yields
// a safe bounded result and NEVER throws. BOUNDED — MAX_FOLLOWUPS hard cap and a
// clamp on every emitted string (label / hint / seed / title). SECRET-SAFE — the
// user-influenced actionLabel and entity titles pass through a local cleanText +
// looksLikeSecretValue guard (a value-shaped string renders '[hidden]'), git
// prNumber/sha/repo are public-only (sha sliced to 7), and an EntityHandle is
// emitted only after its id passes the SAFE_ID_RE / MAX_ID_LEN guard that
// entityHandleCore.encodeEntityHandle enforces, so every emitted handle round-trips.

import type { ChatOutcomeVerdict } from './chatOutcomeSignals';
import type { EntityKind, EntitySurface, EntityHandle } from './entityHandleCore';
import type { GitReference } from './taskPRLinkageCore';

// ── Public types ──────────────────────────────────────────────────────────────

/** The typed cross-surface actions this core can propose. */
export type FollowupActionKind =
  | 'attach_proof_to_mission'
  | 'link_pr_to_task'
  | 'create_feed_task'
  | 'open_mission'
  | 'open_room'
  | 'open_run'
  | 'retry_run'
  | 'request_approval';

/** Why a follow-up was proposed (compact, PII-free — safe to persist / mine). */
export type FollowupReason =
  | 'completed_with_proof'
  | 'produced_untracked_work'
  | 'git_ref_and_source_task'
  | 'decision_touches_mission'
  | 'context_room_in_scope'
  | 'context_run_in_scope'
  | 'failed_recoverable'
  | 'blocked_on_approval';

/** A compact in-scope entity the thread is bound to (mission/room/task/run). */
export interface FollowupEntityRef {
  kind: EntityKind;
  id: string;
  title?: string;
}

/**
 * Everything the finalize point already holds when a bot message is finalized.
 * All fields optional/nullable so a caller can pass exactly what it has; junk /
 * missing fields are treated as "absent", never an error.
 */
export interface CrossSurfaceFollowupInput {
  /** The machine verdict from chatOutcomeSignals.deriveOutcomeVerdict. */
  verdict?: ChatOutcomeVerdict | null;
  /** The "what happened" label (agentReceipt.action / handoff.taskLabel). */
  actionLabel?: string | null;
  artifactCount?: number | null;
  proofCount?: number | null;
  hasBrowserProof?: boolean | null;
  /** taskPRLinkageCore.extractGitReferences output (consumed type-only). */
  gitReferences?: ReadonlyArray<GitReference> | null;
  /** handoff.surface (browser|desktop|local_files|computer) — carried for wiring
   *  context; it does not gate any rule today. */
  computerSurface?: string | null;
  contextMission?: FollowupEntityRef | null;
  contextRoom?: FollowupEntityRef | null;
  contextTask?: FollowupEntityRef | null;
  contextRun?: FollowupEntityRef | null;
  alreadyTracked?: boolean | null;
  hasRecoveryOptions?: boolean | null;
  approvalPending?: boolean | null;
  canRetry?: boolean | null;
}

/** One proposed cross-surface action. `handle` feeds encodeEntityHandle; when it
 *  is null the action is driven by `seedCommand` (or is a generic office action). */
export interface CrossSurfaceFollowup {
  kind: FollowupActionKind;
  surface: EntitySurface;
  label: string;
  hint: string;
  handle: EntityHandle | null;
  seedCommand: string | null;
  score: number;
  reason: FollowupReason;
}

/** The full result: ranked (desc), deduped by kind, ≤ MAX_FOLLOWUPS, + one line. */
export interface CrossSurfaceFollowupResult {
  followups: CrossSurfaceFollowup[];
  line: string;
}

// ── Bounds (exported so callers share the exact same caps) ──────────────────────
/** Hard cap on how many follow-ups are ever returned. */
export const MAX_FOLLOWUPS = 4;
/** Longest emitted label before clamping. */
export const MAX_LABEL_LEN = 48;
/** Longest emitted hint before clamping. */
export const MAX_HINT_LEN = 80;
/** Longest embedded entity title before clamping. */
export const MAX_TITLE_LEN = 60;
/** Longest emitted seedCommand before clamping. */
export const MAX_SEED_LEN = 120;

// ── Internal bounds ─────────────────────────────────────────────────────────────
/**
 * Longest id we accept for a handle. LOCKSTEP with entityHandleCore.MAX_ID_LEN
 * (256): an id longer than this is rejected by encodeEntityHandle, so we never
 * emit a handle it cannot round-trip.
 */
const MAX_ID_LEN = 256;
/** Most gitReferences entries scanned in one call (the rest are ignored). */
const MAX_GIT_SCAN = 200;
/** Longest cleaned actionLabel woven into the create-task seed/label. */
const ACTION_LABEL_MAX = 100;
/** Longest emitted summary line. */
const MAX_LINE_LEN = 240;

// ── Frozen decision tables (deterministic) ──────────────────────────────────────

/** Base score per action kind — higher wins when the cap trims the set. Frozen. */
const BASE_SCORE: Readonly<Record<FollowupActionKind, number>> = Object.freeze({
  attach_proof_to_mission: 100,
  request_approval: 95,
  link_pr_to_task: 92,
  create_feed_task: 85,
  retry_run: 70,
  open_mission: 60,
  open_room: 55,
  open_run: 50,
});

/** Stable tiebreak order (lower = higher priority) for equal scores. Frozen. */
const KIND_ORDER: Readonly<Record<FollowupActionKind, number>> = Object.freeze({
  attach_proof_to_mission: 0,
  request_approval: 1,
  link_pr_to_task: 2,
  create_feed_task: 3,
  retry_run: 4,
  open_mission: 5,
  open_room: 6,
  open_run: 7,
});

/** Authored hint templates (never model text). All ≤ MAX_HINT_LEN. Frozen. */
const HINTS: Readonly<Record<FollowupActionKind, string>> = Object.freeze({
  attach_proof_to_mission: "Attach this run's proof-of-work to the mission",
  request_approval: 'This run is waiting on approval before it can finish',
  link_pr_to_task: 'Attach this GitHub reference to the source Feed task',
  create_feed_task: 'Create a Feed task so this work is tracked',
  retry_run: 'Re-run from where it stopped using recovery options',
  open_mission: 'Update the mission with what just changed',
  open_room: 'Continue this work in the project room',
  open_run: 'Open the full run in Office',
});

/** Membership sets for the analytics coercion (never mutated). */
const FOLLOWUP_KIND_SET: ReadonlySet<string> = new Set<string>([
  'attach_proof_to_mission',
  'request_approval',
  'link_pr_to_task',
  'create_feed_task',
  'retry_run',
  'open_mission',
  'open_room',
  'open_run',
]);
const FOLLOWUP_REASON_SET: ReadonlySet<string> = new Set<string>([
  'completed_with_proof',
  'produced_untracked_work',
  'git_ref_and_source_task',
  'decision_touches_mission',
  'context_room_in_scope',
  'context_run_in_scope',
  'failed_recoverable',
  'blocked_on_approval',
]);
const ENTITY_SURFACE_SET: ReadonlySet<string> = new Set<string>(['chat', 'office', 'feed', 'rooms']);

/**
 * The safe id charset. LOCKSTEP with entityHandleCore.SAFE_ID_RE — an id we
 * cannot encode is never turned into a handle, guaranteeing every emitted handle
 * round-trips through encodeEntityHandle.
 */
const SAFE_ID_RE = /^[A-Za-z0-9._:-]+$/;

// ── Secret-safe text cleaning (mirrors crossSurfaceReferenceResolverCore) ───────

/** Value-shaped secret material found ANYWHERE inside a string. */
function containsSecretPattern(text: string): boolean {
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest/key
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub tokens
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack tokens
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

/** Heuristic: does this string look like a secret VALUE (not a short name/title)? */
function looksLikeSecretValue(text: string): boolean {
  if (text.length > 40 && !/\s/.test(text)) return true; // long + spaceless
  if (containsSecretPattern(text)) return true;
  if (
    text.length >= 24 &&
    !/\s/.test(text) &&
    /[A-Za-z]/.test(text) &&
    /\d/.test(text) &&
    /^[A-Za-z0-9+/=._-]+$/.test(text)
  ) return true; // high-entropy-ish api-key shape
  return false;
}

/**
 * Flatten a user-influenced field for one prompt-safe line: turn control chars /
 * DEL / C1 (incl. \n \r \t) into spaces, strip fence/tag chars (`<`,`>`,backtick),
 * collapse EVERY whitespace run — JS `\s` also covers the U+2028/U+2029 line
 * separators — to a single space, then hard-clip to `max`. Returns '' for
 * non-scalar/empty. Pre-clips huge input so the regex work stays bounded.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  let raw: string;
  try {
    raw = String(value);
  } catch {
    return '';
  }
  const cap = Math.max(1, max) * 4;
  if (raw.length > cap) raw = raw.slice(0, cap);
  const text = raw
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

/** cleanText + secret-VALUE guard: a value-shaped string becomes '[hidden]'. */
function guardText(value: unknown, max: number): string {
  const cleaned = cleanText(value, max);
  if (!cleaned) return '';
  return looksLikeSecretValue(cleaned) ? '[hidden]' : cleaned;
}

// ── Defensive readers (hostile proxy / throwing-getter safe) ────────────────────

/** Read one property of an object without ever throwing (a trap → undefined). */
function readField(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/** Trim + validate an id against the encodeEntityHandle contract; '' if unusable. */
function coerceId(x: unknown): string {
  if (typeof x !== 'string') return '';
  const id = x.trim();
  if (id.length === 0 || id.length > MAX_ID_LEN) return '';
  return SAFE_ID_RE.test(id) ? id : '';
}

/** Coerce an arbitrary value to a known verdict; anything else → 'unknown'. */
function coerceVerdict(x: unknown): ChatOutcomeVerdict {
  if (x === 'completed' || x === 'partial' || x === 'blocked' || x === 'failed' || x === 'unknown') return x;
  return 'unknown';
}

/** A safe non-negative count: non-number / NaN / negative → 0. */
function safeCount(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return 0;
  return x;
}

/** Hard clamp (no ellipsis) so byte cost stays predictable. */
function clamp(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Build a nav handle from an in-scope ref, forcing the SLOT's canonical kind +
 * surface (a contextMission is always a mission→feed handle, regardless of what
 * ref.kind claims). Returns null when the id is missing/unsafe/oversized so the
 * caller can drop a handle-requiring action rather than emit a dead link.
 */
function buildHandle(ref: unknown, kind: EntityKind, surface: EntitySurface): EntityHandle | null {
  try {
    if (!ref || typeof ref !== 'object') return null;
    const id = coerceId(readField(ref as Record<string, unknown>, 'id'));
    if (!id) return null;
    return { kind, id, surface };
  } catch {
    return null;
  }
}

/** Secret-guarded, clamped title of an in-scope ref, or '' when absent/unsafe. */
function readTitle(ref: unknown): string {
  try {
    if (!ref || typeof ref !== 'object') return '';
    return guardText(readField(ref as Record<string, unknown>, 'title'), MAX_TITLE_LEN);
  } catch {
    return '';
  }
}

/** Does the gitReferences input carry at least one entry (bounded, never throws)? */
function hasAnyGitRef(gitReferences: unknown): boolean {
  try {
    return Array.isArray(gitReferences) && gitReferences.length > 0;
  } catch {
    return false;
  }
}

/**
 * The public label for the FIRST linkable git reference (a pull_request or a
 * commit), built ONLY from public prNumber / short-sha — never any url tail,
 * query, or fragment. Returns null when no linkable ref is present. Bounded scan.
 */
function firstLinkableGitRef(gitReferences: unknown): string | null {
  if (!Array.isArray(gitReferences)) return null;
  const n = Math.min(gitReferences.length, MAX_GIT_SCAN);
  for (let i = 0; i < n; i += 1) {
    try {
      const ref = gitReferences[i];
      if (!ref || typeof ref !== 'object') continue;
      const rec = ref as Record<string, unknown>;
      const type = readField(rec, 'type');
      if (type === 'pull_request') {
        const prNumber = readField(rec, 'prNumber');
        if (typeof prNumber === 'number' && Number.isFinite(prNumber) && Number.isInteger(prNumber) && prNumber > 0) {
          return `PR #${prNumber}`;
        }
      } else if (type === 'commit') {
        const sha = readField(rec, 'sha');
        if (typeof sha === 'string') {
          const short = sha.trim().toLowerCase().slice(0, 7);
          if (/^[0-9a-f]{7}$/.test(short)) return `commit ${short}`;
        }
      }
    } catch {
      // one malformed ref never aborts the scan
    }
  }
  return null;
}

/** Compose the real `/task new <label>` seed (command id "task-new"), bounded. */
function buildTaskSeed(actionLabelClean: string): string {
  const seed = actionLabelClean ? `/task new ${actionLabelClean}` : '/task new';
  return clamp(seed, MAX_SEED_LEN);
}

/** Assemble one follow-up from its parts, applying every string cap centrally. */
function makeFollowup(
  kind: FollowupActionKind,
  surface: EntitySurface,
  rawLabel: string,
  handle: EntityHandle | null,
  seedCommand: string | null,
  reason: FollowupReason,
): CrossSurfaceFollowup {
  return {
    kind,
    surface,
    label: clamp(rawLabel, MAX_LABEL_LEN),
    hint: clamp(HINTS[kind], MAX_HINT_LEN),
    handle,
    seedCommand: seedCommand ? clamp(seedCommand, MAX_SEED_LEN) : null,
    score: BASE_SCORE[kind],
    reason,
  };
}

/** Read opts.maxFollowups defensively and clamp to [0, MAX_FOLLOWUPS]. */
function resolveLimit(opts?: { maxFollowups?: number }): number {
  let maxOpt: unknown;
  try {
    const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {};
    maxOpt = o.maxFollowups;
  } catch {
    maxOpt = undefined;
  }
  const requested =
    typeof maxOpt === 'number' && Number.isFinite(maxOpt) ? Math.floor(maxOpt) : MAX_FOLLOWUPS;
  return Math.max(0, Math.min(requested, MAX_FOLLOWUPS));
}

/** Sort by score desc → KIND_ORDER asc, dedupe by kind, slice to the limit. */
function rankAndBound(candidates: CrossSurfaceFollowup[], limit: number): CrossSurfaceFollowup[] {
  const sorted = candidates.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  });
  const seen = new Set<FollowupActionKind>();
  const out: CrossSurfaceFollowup[] = [];
  for (const c of sorted) {
    if (out.length >= limit) break;
    if (seen.has(c.kind)) continue;
    seen.add(c.kind);
    out.push(c);
  }
  return out;
}

/** One compact, secret-safe summary line (labels are already cleaned + clamped). */
function buildLine(followups: CrossSurfaceFollowup[]): string {
  if (!followups.length) return '';
  const n = followups.length;
  const labels = followups.map((f) => f.label).join(' · ');
  return clamp(`${n} follow-up${n === 1 ? '' : 's'}: ${labels}`, MAX_LINE_LEN);
}

// ── Public: derive follow-ups ───────────────────────────────────────────────────

/**
 * Turn a finalized turn's structural outcome into a ranked, deduped, bounded set
 * of cross-surface follow-up actions. Pure, deterministic, total.
 *
 * The rule set (each candidate is emitted only if its gate passes; the set is then
 * sorted by score desc, tiebroken by KIND_ORDER, deduped by kind, and sliced to
 * min(opts.maxFollowups ?? MAX_FOLLOWUPS, MAX_FOLLOWUPS)):
 *
 *   1. attach_proof_to_mission (100) — completed/partial + any proof + a mission.
 *   2. request_approval        (95)  — blocked verdict or approvalPending.
 *   3. link_pr_to_task         (92)  — a PR/commit git ref + a source task.
 *   4. create_feed_task        (85)  — completed/partial + untracked produced work
 *                                      (artifact/browser/git) + no source task.
 *   5. retry_run               (70)  — failed/partial + a retry/recovery affordance.
 *   6. open_mission            (60)  — a mission on a completed/partial turn where
 *                                      attach_proof_to_mission did NOT fire.
 *   7. open_room               (55)  — a room in scope.
 *   8. open_run                (50)  — a run in scope where retry_run did NOT fire.
 *
 * Total: any non-object / cyclic / hostile / junk input → { followups: [], line: '' }.
 */
export function deriveCrossSurfaceFollowups(
  input?: CrossSurfaceFollowupInput | null,
  opts?: { maxFollowups?: number },
): CrossSurfaceFollowupResult {
  const empty: CrossSurfaceFollowupResult = { followups: [], line: '' };
  try {
    if (!input || typeof input !== 'object') return empty;
    const rec = input as Record<string, unknown>;

    const limit = resolveLimit(opts);
    if (limit <= 0) return empty;

    // Normalize every field defensively (a throwing getter on one field defaults
    // that field rather than nuking the whole result).
    const verdict = coerceVerdict(readField(rec, 'verdict'));
    const artifactCount = safeCount(readField(rec, 'artifactCount'));
    const proofCount = safeCount(readField(rec, 'proofCount'));
    const hasBrowserProof = readField(rec, 'hasBrowserProof') === true;
    const alreadyTracked = readField(rec, 'alreadyTracked') === true;
    const hasRecoveryOptions = readField(rec, 'hasRecoveryOptions') === true;
    const approvalPending = readField(rec, 'approvalPending') === true;
    const canRetry = readField(rec, 'canRetry') === true;
    const gitReferences = readField(rec, 'gitReferences');
    const hasGitRefs = hasAnyGitRef(gitReferences);
    const actionLabelClean = guardText(readField(rec, 'actionLabel'), ACTION_LABEL_MAX);

    const contextMission = readField(rec, 'contextMission');
    const contextTask = readField(rec, 'contextTask');
    const contextRoom = readField(rec, 'contextRoom');
    const contextRun = readField(rec, 'contextRun');

    const missionHandle = buildHandle(contextMission, 'mission', 'feed');
    const missionTitle = readTitle(contextMission);
    const taskHandle = buildHandle(contextTask, 'task', 'feed');
    const roomHandle = buildHandle(contextRoom, 'room', 'rooms');
    const roomTitle = readTitle(contextRoom);
    const runHandle = buildHandle(contextRun, 'run', 'office');

    const completedOrPartial = verdict === 'completed' || verdict === 'partial';
    const failedOrPartial = verdict === 'failed' || verdict === 'partial';
    // attach counts proofCount; create (untracked work) deliberately does NOT.
    const hasProofForMission = proofCount > 0 || hasBrowserProof || artifactCount > 0 || hasGitRefs;
    const hasUntrackedWork = artifactCount > 0 || hasBrowserProof || hasGitRefs;
    // A source task counts as "in scope" only if we can actually reference it.
    const contextTaskPresent = taskHandle !== null;

    const candidates: CrossSurfaceFollowup[] = [];
    let attachProofFired = false;
    let retryRunFired = false;

    // 1. attach_proof_to_mission — THE accountability action.
    if (completedOrPartial && hasProofForMission && missionHandle) {
      candidates.push(
        makeFollowup(
          'attach_proof_to_mission',
          'feed',
          missionTitle ? `Log proof to ${missionTitle}` : 'Log proof to mission',
          missionHandle,
          null,
          'completed_with_proof',
        ),
      );
      attachProofFired = true;
    }

    // 2. request_approval — the turn stopped at a gate.
    if (verdict === 'blocked' || approvalPending) {
      candidates.push(
        makeFollowup('request_approval', 'office', 'Review and approve', runHandle, null, 'blocked_on_approval'),
      );
    }

    // 3. link_pr_to_task — a real PR/commit + a source task to attach it to.
    const gitRefLabel = firstLinkableGitRef(gitReferences);
    if (gitRefLabel && taskHandle) {
      candidates.push(
        makeFollowup('link_pr_to_task', 'feed', `Link ${gitRefLabel} to task`, taskHandle, null, 'git_ref_and_source_task'),
      );
    }

    // 4. create_feed_task — structural safety-net for the common untracked case.
    if (completedOrPartial && hasUntrackedWork && !alreadyTracked && !contextTaskPresent) {
      const label = actionLabelClean ? `Track: ${actionLabelClean}` : 'Track as a Feed task';
      candidates.push(
        makeFollowup('create_feed_task', 'feed', label, null, buildTaskSeed(actionLabelClean), 'produced_untracked_work'),
      );
    }

    // 5. retry_run — kept even without a specific run (retry in chat).
    if (failedOrPartial && (canRetry || hasRecoveryOptions)) {
      candidates.push(
        makeFollowup('retry_run', runHandle ? 'office' : 'chat', 'Retry this run', runHandle, null, 'failed_recoverable'),
      );
      retryRunFired = true;
    }

    // 6. open_mission — a goal-update turn with no fresh proof to log.
    if (missionHandle && completedOrPartial && !attachProofFired) {
      candidates.push(
        makeFollowup(
          'open_mission',
          'feed',
          missionTitle ? `Open ${missionTitle}` : 'Open mission',
          missionHandle,
          null,
          'decision_touches_mission',
        ),
      );
    }

    // 7. open_room — a project room in scope.
    if (roomHandle) {
      candidates.push(
        makeFollowup('open_room', 'rooms', roomTitle ? `Open ${roomTitle}` : 'Open room', roomHandle, null, 'context_room_in_scope'),
      );
    }

    // 8. open_run — a run in scope we are not already offering to retry.
    if (runHandle && !retryRunFired) {
      candidates.push(makeFollowup('open_run', 'office', 'Open the run', runHandle, null, 'context_run_in_scope'));
    }

    const followups = rankAndBound(candidates, limit);
    return { followups, line: buildLine(followups) };
  } catch {
    return { followups: [], line: '' };
  }
}

/**
 * A compact, PII-free `kind|surface|reason` token for analytics/telemetry. Total:
 * a junk / partial / hostile follow-up yields 'unknown' segments, never a throw,
 * never a leaked label/title/seed (only the three enum fields are read).
 */
export function describeFollowupForAnalytics(
  f: Pick<CrossSurfaceFollowup, 'kind' | 'surface' | 'reason'>,
): string {
  try {
    if (!f || typeof f !== 'object') return 'unknown|unknown|unknown';
    const rec = f as Record<string, unknown>;
    const kindRaw = readField(rec, 'kind');
    const surfaceRaw = readField(rec, 'surface');
    const reasonRaw = readField(rec, 'reason');
    const kind = typeof kindRaw === 'string' && FOLLOWUP_KIND_SET.has(kindRaw) ? kindRaw : 'unknown';
    const surface = typeof surfaceRaw === 'string' && ENTITY_SURFACE_SET.has(surfaceRaw) ? surfaceRaw : 'unknown';
    const reason = typeof reasonRaw === 'string' && FOLLOWUP_REASON_SET.has(reasonRaw) ? reasonRaw : 'unknown';
    return `${kind}|${surface}|${reason}`;
  } catch {
    return 'unknown|unknown|unknown';
  }
}
