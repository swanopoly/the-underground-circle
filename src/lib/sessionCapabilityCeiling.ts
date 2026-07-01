/**
 * sessionCapabilityCeiling — per-session / per-task capability CEILING (PURE).
 *
 * The user's rule: "I set the OS-control ceiling per task." This module is the
 * pure model of that ceiling: a DEFAULT-DENY, per-session allowlist of the
 * capability FAMILIES an agent may even *attempt* this task. It is deliberately
 * a different axis from the always-confirm floor:
 *
 *   - FLOOR  (computerGrantGate.STICKY_FLOOR_CATEGORIES: pay / delete / login /
 *     grant) gates the *action* — those categories always require a fresh
 *     confirmation no matter what else is allowed. The floor is not a family and
 *     is NEVER expressible in a ceiling.
 *   - CEILING (this module) gates *which capability families may be attempted at
 *     all* this session. Orthogonal: a family can be inside the ceiling and the
 *     floor can still stop a pay/delete/login/grant action taken through it.
 *
 * Fail-closed is the whole point. With NO ceiling set (null / expired), nothing
 * beyond the small SAFE_READ_FAMILIES is permitted — an agent that has not been
 * explicitly handed a per-task ceiling can still read (tabs, screen, files) but
 * cannot navigate, act, download, upload, write files, or use credentials.
 *
 * Family vocabulary: the identifiers here are the fine, per-verb capability
 * families the ceiling governs. They MAP onto the coarse capability menu in
 * `chatCapabilityManifest.ts` (its `AppCapability.family` tokens: browser,
 * desktop, vault, …) and onto the machine-capability observe/gated_act split in
 * `localComputerAwarenessIntent.ts` (LOCAL_COMPUTER_CAPABILITY_CATALOG). The
 * coarse `browser` family, for example, splits into browser_navigate /
 * browser_read / browser_act / browser_download / browser_upload so a ceiling
 * can allow "read a page" without allowing "submit a form". See
 * COARSE_FAMILY_FOR_CAPABILITY for the mapping the router/console surface uses.
 *
 * Dependency-light on purpose (type-only imports) so tsx smoke tests can load it
 * without react-native — same discipline as computerGrantGate.ts, whose module
 * shape (normalize → create → apply → serialize/parse → describe, tolerant
 * parser, hard invariants) this file mirrors.
 */

// Type-only anchors. Neither import adds a react-native dependency; they pin
// this module's family/floor reasoning to the source of truth so a rename or
// widening there shows up here as a type error rather than silent drift.
import type { LocalComputerAwarenessRiskTier } from './localComputerAwarenessIntent';
import type { ChatComputerConstraintCategory } from './chatComputerRequestRouter';

/**
 * The fine capability families a per-session ceiling can allow. Per-verb so a
 * ceiling can be precise (allow reads, allow downloads, but not form-acts).
 * Aligned to the coarse `chatCapabilityManifest` families (browser / desktop /
 * file / credential) and to the `localComputerAwarenessIntent` observe/gated_act
 * catalog. Keep this union and COARSE_FAMILY_FOR_CAPABILITY in lockstep.
 */
export type CapabilityFamily =
  // Browser (coarse manifest family 'browser'):
  | 'browser_navigate' // open/goto a URL, follow links — changes what page we're on
  | 'browser_read' // DOM snapshot, read text/roles — observation only (SAFE)
  | 'browser_act' // click/type/submit/select — DOM-level mutation
  | 'browser_download' // pull a file down from a site
  | 'browser_upload' // push a local file up to a site
  // Desktop (coarse manifest family 'desktop'):
  | 'desktop_read' // tabs / running apps / clipboard-inspect / a11y tree / screenshot (SAFE)
  | 'desktop_act' // launch/focus/type/click/menu/shortcut/window-manage — local mutation
  // Local files (coarse manifest family 'desktop', file sub-surface):
  | 'file_read' // list / read / search / stat a local file (SAFE)
  | 'file_write' // write / rename / copy / trash / mkdir a local file
  // Credentials (coarse manifest family 'vault'):
  | 'credential_use'; // resolve a vaulted credential FOR a task (never reveal)

/**
 * Every family, in a stable order (browser → desktop → file → credential). The
 * one source the parser/validator iterate so a family added to the union but
 * forgotten here trips the exhaustive check in `coarseFamilyFor` below.
 */
export const ALL_CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  'browser_navigate',
  'browser_read',
  'browser_act',
  'browser_download',
  'browser_upload',
  'desktop_read',
  'desktop_act',
  'file_read',
  'file_write',
  'credential_use',
] as const;

const FAMILY_SET = new Set<CapabilityFamily>(ALL_CAPABILITY_FAMILIES);

/**
 * The families that are ALWAYS implicitly allowed, ceiling or no ceiling. Reads
 * are the low-risk tier in the project's risk model (see
 * `localComputerAwarenessIntent` — observe-family / 'safe' tier), so a
 * default-deny ceiling still lets an agent look before it is handed the power to
 * act. Everything not in this set is denied unless an active ceiling names it.
 */
export const SAFE_READ_FAMILIES: readonly CapabilityFamily[] = [
  'browser_read',
  'desktop_read',
  'file_read',
] as const;

const SAFE_READ_SET = new Set<CapabilityFamily>(SAFE_READ_FAMILIES);

/**
 * The coarse `chatCapabilityManifest.AppCapability.family` token each fine
 * family rolls up to. Used by the router/console to surface the ceiling against
 * the same coarse menu the model reads. Exhaustive over the union.
 */
export function coarseFamilyFor(family: CapabilityFamily): 'browser' | 'desktop' | 'vault' {
  switch (family) {
    case 'browser_navigate':
    case 'browser_read':
    case 'browser_act':
    case 'browser_download':
    case 'browser_upload':
      return 'browser';
    case 'desktop_read':
    case 'desktop_act':
    case 'file_read':
    case 'file_write':
      return 'desktop';
    case 'credential_use':
      return 'vault';
    default: {
      // Exhaustiveness guard: a new family that is not mapped fails to compile.
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

/** Read-only lookup of the coarse family for each fine capability. */
export const COARSE_FAMILY_FOR_CAPABILITY: Readonly<Record<CapabilityFamily, 'browser' | 'desktop' | 'vault'>> =
  ALL_CAPABILITY_FAMILIES.reduce((acc, family) => {
    acc[family] = coarseFamilyFor(family);
    return acc;
  }, {} as Record<CapabilityFamily, 'browser' | 'desktop' | 'vault'>);

/**
 * The default per-task TTL. A ceiling is scoped to ONE task, so it is short by
 * design — long enough for a multi-step task, short enough that a stale ceiling
 * cannot silently keep granting act/write power into a later, unrelated task.
 */
export const SESSION_CEILING_DEFAULT_TTL_MINUTES = 60;
export const SESSION_CEILING_MIN_TTL_MINUTES = 1;
export const SESSION_CEILING_MAX_TTL_MINUTES = 240;
/** Bound on how many families a single ceiling may carry (all of them + slack). */
const SESSION_CEILING_MAX_FAMILIES = ALL_CAPABILITY_FAMILIES.length;

export interface SessionCapabilityCeiling {
  id: string;
  /** The families the agent may attempt this task (safe reads are always-on and not required here). */
  allowedFamilies: CapabilityFamily[];
  /** Who set the ceiling (audit); null when set by the system/default flow. */
  grantedByUserId: string | null;
  /** The task this ceiling is scoped to, when known — makes staleness obvious. */
  taskId: string | null;
  grantedAtIso: string;
  /** When the ceiling lapses back to safe-reads-only. Always set (per-task = short). */
  expiresAtIso: string;
}

// ─── Normalization ───────────────────────────────────────────────────────────

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function clampTtlMinutes(value: unknown): number {
  if (!Number.isFinite(value as number)) return SESSION_CEILING_DEFAULT_TTL_MINUTES;
  return Math.max(
    SESSION_CEILING_MIN_TTL_MINUTES,
    Math.min(SESSION_CEILING_MAX_TTL_MINUTES, Math.floor(value as number)),
  );
}

/** True for a real, known capability family token. Floor categories are NOT families. */
export function isCapabilityFamily(value: unknown): value is CapabilityFamily {
  return typeof value === 'string' && FAMILY_SET.has(value as CapabilityFamily);
}

/**
 * Normalize + dedupe a requested family list, dropping anything that is not a
 * known family. SAFE_READ_FAMILIES are intentionally NOT stripped here (a caller
 * may list them explicitly), but they are always-on regardless, so a ceiling
 * that names only safe reads is still meaningful (it just adds nothing beyond
 * the implicit floor of reads). Floor categories (pay/delete/login/grant) can
 * never appear because they are not members of CapabilityFamily.
 */
export function normalizeCapabilityFamilies(values: unknown): CapabilityFamily[] {
  if (!Array.isArray(values)) return [];
  const out: CapabilityFamily[] = [];
  for (const value of values) {
    const token = String(value || '').trim().toLowerCase();
    if (isCapabilityFamily(token) && !out.includes(token)) out.push(token);
    if (out.length >= SESSION_CEILING_MAX_FAMILIES) break;
  }
  return out;
}

function ceilingId(nowIso: string, taskId: string | null): string {
  const stamp = String(Date.parse(nowIso) || 0);
  const scope = (taskId || 'session').replace(/[^a-z0-9]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `ceiling_${scope || 'session'}_${stamp}`;
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

export type CreateSessionCeilingResult =
  | { ok: true; ceiling: SessionCapabilityCeiling }
  | { ok: false; error: string };

/**
 * Create a per-task capability ceiling. Validates + dedupes families and clamps
 * the TTL to the short per-task window. A ceiling with an EMPTY allowlist is
 * rejected — an empty ceiling is meaningless (safe reads are always-on anyway),
 * and rejecting it keeps the default-deny path honest: "no ceiling" is `null`,
 * not an empty-list object that looks like it grants something.
 */
export function createSessionCeiling(input: {
  allowedFamilies: CapabilityFamily[];
  grantedByUserId?: string | null;
  taskId?: string | null;
  ttlMinutes?: number;
  nowIso?: string;
}): CreateSessionCeilingResult {
  const requested = Array.isArray(input.allowedFamilies) ? input.allowedFamilies : [];
  const unknown = requested.filter((f) => !isCapabilityFamily(String(f || '').trim().toLowerCase()));
  const allowedFamilies = normalizeCapabilityFamilies(requested);
  if (allowedFamilies.length === 0) {
    return {
      ok: false,
      error: unknown.length > 0
        ? `No known capability families in [${unknown.map(String).join(', ')}]. A ceiling needs at least one real family.`
        : 'A capability ceiling needs at least one capability family to allow.',
    };
  }
  const nowIso = safeIso(input.nowIso) || new Date().toISOString();
  const ttlMinutes = clampTtlMinutes(input.ttlMinutes);
  const expiresAtIso = new Date(Date.parse(nowIso) + ttlMinutes * 60 * 1000).toISOString();
  const taskId = input.taskId ? String(input.taskId).slice(0, 160) : null;
  return {
    ok: true,
    ceiling: {
      id: ceilingId(nowIso, taskId),
      allowedFamilies,
      grantedByUserId: input.grantedByUserId ? String(input.grantedByUserId).slice(0, 120) : null,
      taskId,
      grantedAtIso: nowIso,
      expiresAtIso,
    },
  };
}

export function isCeilingExpired(ceiling: SessionCapabilityCeiling, nowMs = Date.now()): boolean {
  const ts = Date.parse(ceiling.expiresAtIso);
  return !Number.isFinite(ts) || ts <= nowMs;
}

/** A ceiling is active only while unexpired and carrying at least one family. */
export function isCeilingActive(ceiling: SessionCapabilityCeiling | null | undefined, nowMs = Date.now()): boolean {
  if (!ceiling) return false;
  return ceiling.allowedFamilies.length > 0 && !isCeilingExpired(ceiling, nowMs);
}

// ─── The gate ──────────────────────────────────────────────────────────────

/**
 * DEFAULT-DENY capability gate. A family is allowed only when it is a safe read
 * (always implicitly on), OR an ACTIVE ceiling explicitly names it. A null,
 * expired, or family-less ceiling collapses to safe-reads-only. An unknown
 * family string is never allowed.
 *
 * Note this governs whether a family may be *attempted*. Even when this returns
 * true, the always-confirm floor (pay/delete/login/grant, via computerGrantGate)
 * still gates the specific action taken through the family — the two are
 * orthogonal and BOTH must pass.
 */
export function isCapabilityAllowed(
  ceiling: SessionCapabilityCeiling | null | undefined,
  family: CapabilityFamily | string,
  nowMs = Date.now(),
): boolean {
  const token = String(family || '').trim().toLowerCase();
  if (!isCapabilityFamily(token)) return false;
  if (SAFE_READ_SET.has(token)) return true;
  if (!isCeilingActive(ceiling, nowMs)) return false;
  return ceiling!.allowedFamilies.includes(token);
}

export interface CeilingApplication {
  /** Requested families the current ceiling (or safe-read floor) permits. */
  allowed: CapabilityFamily[];
  /** Requested families denied — outside the ceiling this task. */
  blocked: CapabilityFamily[];
  /** Unrecognized family tokens in the request, dropped as neither allowed nor blocked-by-ceiling. */
  unknown: string[];
}

/**
 * Partition a batch of requested families against the ceiling. Unknown tokens
 * are surfaced separately rather than silently counted as "blocked" so a caller
 * can tell a typo from a real capability-outside-ceiling denial. Order and
 * de-duplication of the known inputs are preserved.
 */
export function applyCeiling(
  ceiling: SessionCapabilityCeiling | null | undefined,
  requestedFamilies: Array<CapabilityFamily | string>,
  nowMs = Date.now(),
): CeilingApplication {
  const allowed: CapabilityFamily[] = [];
  const blocked: CapabilityFamily[] = [];
  const unknown: string[] = [];
  const seenKnown = new Set<CapabilityFamily>();
  for (const raw of Array.isArray(requestedFamilies) ? requestedFamilies : []) {
    const token = String(raw || '').trim().toLowerCase();
    if (!isCapabilityFamily(token)) {
      if (token && !unknown.includes(token)) unknown.push(token);
      continue;
    }
    if (seenKnown.has(token)) continue;
    seenKnown.add(token);
    if (isCapabilityAllowed(ceiling, token, nowMs)) allowed.push(token);
    else blocked.push(token);
  }
  return { allowed, blocked, unknown };
}

/**
 * The structured reason a gate point returns when a family is refused by the
 * ceiling. `openswanToolRuntime` should block dispatch with this so the loop
 * (and any recovery) can distinguish a ceiling denial from a floor confirmation.
 */
export interface CapabilityOutsideCeilingReason {
  code: 'capability_outside_ceiling';
  family: CapabilityFamily;
  coarseFamily: 'browser' | 'desktop' | 'vault';
  /** True when there simply is no active ceiling (vs. an active one that omits this family). */
  ceilingMissing: boolean;
  message: string;
}

/**
 * Build the block reason for a denied family. Callers pass the family that
 * `isCapabilityAllowed` refused; safe-read families never reach here (they are
 * always allowed), so this is only for act/write/navigate/upload/credential.
 */
export function describeCapabilityOutsideCeiling(
  ceiling: SessionCapabilityCeiling | null | undefined,
  family: CapabilityFamily,
  nowMs = Date.now(),
): CapabilityOutsideCeilingReason {
  const active = isCeilingActive(ceiling, nowMs);
  return {
    code: 'capability_outside_ceiling',
    family,
    coarseFamily: coarseFamilyFor(family),
    ceilingMissing: !active,
    message: active
      ? `"${family}" is outside the capability ceiling set for this task. Raise the per-task ceiling to include it, then retry.`
      : `No capability ceiling is set for this task, so only safe reads are permitted. Set a per-task ceiling that includes "${family}" to allow it.`,
  };
}

// ─── Serialize + tolerant parse ──────────────────────────────────────────────

export interface CompactSessionCeiling {
  id: string;
  fams: CapabilityFamily[];
  by: string | null;
  task: string | null;
  at: string;
  exp: string;
}

/** Compact wire form for persistence / handoff metadata (bounded, no extras). */
export function serializeSessionCeiling(ceiling: SessionCapabilityCeiling): CompactSessionCeiling {
  return {
    id: ceiling.id,
    fams: [...ceiling.allowedFamilies],
    by: ceiling.grantedByUserId,
    task: ceiling.taskId,
    at: ceiling.grantedAtIso,
    exp: ceiling.expiresAtIso,
  };
}

/**
 * Tolerant parser for a persisted / handed-off ceiling. Drops garbage: bad
 * shape → null; unknown families are filtered out; a ceiling that ends up with
 * NO known families → null (fail closed to safe-reads-only rather than
 * resurrecting a broken grant). A missing/invalid expiry is treated as expired
 * (default-deny), never as "no expiry".
 */
export function parseSessionCeiling(raw: unknown): SessionCapabilityCeiling | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  // Accept both the compact wire form and a full record.
  const famsSource = 'fams' in record ? record.fams : record.allowedFamilies;
  const allowedFamilies = normalizeCapabilityFamilies(famsSource);
  if (allowedFamilies.length === 0) return null;

  const grantedAtIso = safeIso('at' in record ? record.at : record.grantedAtIso) || new Date(0).toISOString();
  const expiresAtIso = safeIso('exp' in record ? record.exp : record.expiresAtIso);
  if (!expiresAtIso) return null; // no valid expiry ⇒ fail closed, not "forever".

  const taskRaw = 'task' in record ? record.task : record.taskId;
  const byRaw = 'by' in record ? record.by : record.grantedByUserId;
  const idRaw = record.id;
  const taskId = taskRaw ? String(taskRaw).slice(0, 160) : null;
  return {
    id: idRaw ? String(idRaw).slice(0, 200) : ceilingId(grantedAtIso, taskId),
    allowedFamilies,
    grantedByUserId: byRaw ? String(byRaw).slice(0, 120) : null,
    taskId,
    grantedAtIso,
    expiresAtIso,
  };
}

// ─── Describe (UI / prompt) ──────────────────────────────────────────────────

export interface SessionCeilingDescription {
  /** True when an active ceiling is in force (vs. safe-reads-only default). */
  active: boolean;
  /** The families the agent may attempt right now, incl. always-on safe reads. */
  effectiveFamilies: CapabilityFamily[];
  /** One line for chat/console. */
  summary: string;
}

/**
 * Describe the ceiling for the UI / a prompt block. When active, lists the
 * granted act/write families plus the always-on safe reads; when null/expired,
 * states plainly that only safe reads are permitted (default-deny). Never
 * mentions floor categories — those are a different axis and are surfaced by the
 * router's approval path, not here.
 */
export function describeCeiling(
  ceiling: SessionCapabilityCeiling | null | undefined,
  nowMs = Date.now(),
): SessionCeilingDescription {
  const active = isCeilingActive(ceiling, nowMs);
  if (!active) {
    return {
      active: false,
      effectiveFamilies: [...SAFE_READ_FAMILIES],
      summary: 'No per-task capability ceiling set — only safe reads (browser/desktop/file read) are permitted. Set a ceiling to allow acting, downloading, uploading, writing files, or using credentials.',
    };
  }
  // Effective = safe reads (always-on) ∪ the explicitly granted families, in
  // canonical order.
  const granted = new Set<CapabilityFamily>([...SAFE_READ_FAMILIES, ...ceiling!.allowedFamilies]);
  const effectiveFamilies = ALL_CAPABILITY_FAMILIES.filter((f) => granted.has(f));
  const beyondReads = ceiling!.allowedFamilies.filter((f) => !SAFE_READ_SET.has(f));
  const beyond = beyondReads.length > 0 ? beyondReads.join(', ') : 'safe reads only';
  const scope = ceiling!.taskId ? ` for task ${ceiling!.taskId}` : '';
  return {
    active: true,
    effectiveFamilies,
    summary: `Capability ceiling${scope}: ${beyond} (plus always-on safe reads), until ${ceiling!.expiresAtIso}.`,
  };
}

// ─── In-memory active registry ───────────────────────────────────────────────

/**
 * The chat router is pure + synchronous and cannot read async storage, so the
 * host hydrates the current per-task ceiling into this registry (mount + top of
 * a computer task) and the router/runtime read it as the default source. Empty
 * until the host first sets it — which is the fail-closed default (no ceiling ⇒
 * safe-reads-only). Cleared when a task ends so a ceiling never leaks forward.
 */
let activeSessionCeiling: SessionCapabilityCeiling | null = null;

export function setActiveSessionCeiling(ceiling: SessionCapabilityCeiling | null): void {
  activeSessionCeiling = ceiling && isCeilingActive(ceiling) ? ceiling : null;
}

export function getActiveSessionCeiling(): SessionCapabilityCeiling | null {
  if (activeSessionCeiling && isCeilingExpired(activeSessionCeiling)) activeSessionCeiling = null;
  return activeSessionCeiling;
}

export function clearActiveSessionCeiling(): void {
  activeSessionCeiling = null;
}

// Type-only re-export anchor: keep the floor axis visible to consumers of this
// module without them importing the router directly. This is the category set
// the ceiling can NEVER express — floor gating stays in computerGrantGate /
// chatComputerRequestRouter.
export type { ChatComputerConstraintCategory, LocalComputerAwarenessRiskTier };
