// entityHandleCore — the PURE deep-link "entity handle" for cross-surface
// navigation. Grounds docs/CHAT_OFFICE_FEED_NEXT_GAPS.md Finding 4: today every
// cross-surface jump is a `uc:switch-tab` CustomEvent whose payload is ONLY
// `{ tab }` (FeedTab.tsx:281, OfficeTab.tsx:4222, ChatTab.tsx:4320,
// MissionsTab.tsx:389, missionChatCommands.ts:176, ProfileTab.tsx:22; listener
// CircleDetailScreen.tsx:226-238). So the app can move you *to* a surface but
// never *to the specific thing* — "go to chat/office" dead-ends at a cold,
// generic tab. This core adds the missing tiny payload: a stable, compact string
// that names the entity AND the surface it belongs on, so the existing listener
// can decode it and focus the run/thread/task/agent it already knows how to open.
//
// Format (compact, self-describing, secret-free): `<surface>:<kind>:<id>`, e.g.
// `office:run:abc123`, `chat:thread:9f2c…`, `office:agent:default::blackswan`.
// The surface comes FIRST so a nav listener knows which tab to open before it
// looks at the entity; when the caller doesn't pin a surface, encode fills in the
// canonical home for that kind via targetSurfaceForEntity (run→office, task→feed,
// thread→chat, …). Ids in this app take many shapes — UUIDs (`hex-…`),
// prefix+timestamp (`task_1721`, `msg_1721_ab12`, `run_<hash>`), and
// namespace ids that legitimately contain colons (`default::blackswan`,
// CLAUDE.md). Decode therefore splits on only the FIRST TWO colons and keeps the
// remainder verbatim as the id, so a `::`-namespaced agent id roundtrips exactly.
//
// The surface vocabulary here is lowercase (`chat|office|feed|rooms`); the app's
// tab keys are UPPERCASE (`CHAT|OFFICE|FEED|ROOMS`). The wiring layer maps between
// them via CircleDetailScreen's `normalizeTabKey`, which already uppercases — so a
// lowercase surface from a decoded handle normalizes straight onto a tab key.
//
// PURITY: zero imports (not even `import type`), tsx-loadable
// (smoke: entity-handle-core). DETERMINISTIC — no Date.now / Math.random / mutable
// module state, so encode is stable (same handle → same string every time). Every
// export is TOTAL: null / undefined / wrong-typed / huge / hostile / cyclic input
// yields a safe neutral (encode → '', decode → null, targetSurface → 'chat') and
// NEVER throws. Output is bounded (MAX_ID_LEN / MAX_ENTITY_HANDLE_LEN). Secret-safe:
// nothing but surface + kind + id ever appears in the string, and hostile ids are
// rejected rather than logged or truncated into a wrong entity.

/** The kinds of entity a cross-surface deep link can point at. */
export type EntityKind = 'task' | 'run' | 'thread' | 'mission' | 'agent' | 'room' | 'message';

/** The four live agent surfaces a handle can open onto (lowercase; maps to a tab key). */
export type EntitySurface = 'chat' | 'office' | 'feed' | 'rooms';

/**
 * A resolved deep-link target. `surface` is optional on input: when omitted,
 * encode derives the canonical home for `kind`. Decode always returns a concrete
 * `surface` (either the one that was encoded, or the derived default).
 */
export interface EntityHandle {
  kind: EntityKind;
  id: string;
  surface?: EntitySurface;
}

/** All valid kinds, in a stable order (also the smoke/validation source of truth). */
export const ENTITY_KINDS: readonly EntityKind[] = [
  'task',
  'run',
  'thread',
  'mission',
  'agent',
  'room',
  'message',
] as const;

/** All valid surfaces, in a stable order. */
export const ENTITY_SURFACES: readonly EntitySurface[] = ['chat', 'office', 'feed', 'rooms'] as const;

// ── Bounds (keep encode/decode bounded on hostile / huge input) ────────────────
/** Longest id we will encode/accept. UUIDs are 36; `default::blackswan` short. */
export const MAX_ID_LEN = 256;
/** Longest whole handle string we will decode (surface + kind + 2 colons + id). */
export const MAX_ENTITY_HANDLE_LEN = 320;

// The safe id charset. Covers every real id shape in this app:
//   - UUIDs:            hex + '-'
//   - prefix+stamp:     'task_1721', 'msg_1721_ab12', 'run_<hash>'  (needs '_')
//   - namespaced ids:   'default::blackswan'                         (needs ':')
//   - dotted variants:  kept via '.'
// Anything outside this set (spaces, newlines, quotes, unicode, control chars)
// is rejected — a corrupted deep link is worse than no deep link.
const SAFE_ID_RE = /^[A-Za-z0-9._:-]+$/;

/** Canonical home surface for each kind. Frozen so it can't be mutated at runtime. */
const SURFACE_BY_KIND: Readonly<Record<EntityKind, EntitySurface>> = Object.freeze({
  task: 'feed',
  run: 'office',
  thread: 'chat',
  mission: 'feed',
  agent: 'office',
  room: 'rooms',
  message: 'chat',
});

/** Fallback surface when the kind is unknown/junk — Chat is the primary surface. */
const FALLBACK_SURFACE: EntitySurface = 'chat';

// ── Type guards (strict: exact canonical lowercase membership) ─────────────────

/** True iff `x` is exactly one of the canonical (lowercase) entity kinds. */
export function isEntityKind(x: unknown): x is EntityKind {
  return typeof x === 'string' && (ENTITY_KINDS as readonly string[]).includes(x);
}

/** True iff `x` is exactly one of the canonical (lowercase) surfaces. */
export function isEntitySurface(x: unknown): x is EntitySurface {
  return typeof x === 'string' && (ENTITY_SURFACES as readonly string[]).includes(x);
}

// ── Lenient coercion (used internally: trim + lowercase + membership) ──────────

function coerceKind(x: unknown): EntityKind | null {
  if (typeof x !== 'string') return null;
  const k = x.trim().toLowerCase();
  return (ENTITY_KINDS as readonly string[]).includes(k) ? (k as EntityKind) : null;
}

function coerceSurface(x: unknown): EntitySurface | null {
  if (typeof x !== 'string') return null;
  const s = x.trim().toLowerCase();
  return (ENTITY_SURFACES as readonly string[]).includes(s) ? (s as EntitySurface) : null;
}

/**
 * Where a given entity kind should open. run→office, task→feed, thread→chat,
 * mission→feed, agent→office, room→rooms, message→chat. Total: an unknown or
 * junk kind (including non-strings and case variants that don't match) falls back
 * to the primary surface, 'chat'. Never throws.
 */
export function targetSurfaceForEntity(kind: unknown): EntitySurface {
  const k = coerceKind(kind);
  return k === null ? FALLBACK_SURFACE : SURFACE_BY_KIND[k];
}

/**
 * Encode a handle into a stable, compact, secret-free nav param string
 * (`<surface>:<kind>:<id>`, e.g. `office:run:abc123`).
 *
 * - Surface: uses `h.surface` when it is a valid surface; otherwise derives the
 *   canonical home for `h.kind` via targetSurfaceForEntity.
 * - Kind: coerced leniently (trimmed + lowercased); an unknown kind → ''.
 * - Id: must be a non-empty string within MAX_ID_LEN whose chars are all in the
 *   safe set; anything else (non-string, empty, too long, unsafe char) → ''.
 *
 * Returns '' — the neutral "no handle" value that `decodeEntityHandle` maps back
 * to null — for any junk input. Never throws; never partially truncates an id.
 */
export function encodeEntityHandle(h: unknown): string {
  if (!h || typeof h !== 'object') return '';
  try {
    // Read only the three fields we care about; safe on cyclic objects (no deep
    // walk). Wrapped in try/catch so a hostile throwing getter / proxy trap on
    // kind/id/surface degrades to '' instead of escaping as an exception.
    const rec = h as { kind?: unknown; id?: unknown; surface?: unknown };

    const kind = coerceKind(rec.kind);
    if (kind === null) return '';

    if (typeof rec.id !== 'string') return '';
    const id = rec.id.trim();
    if (id.length === 0 || id.length > MAX_ID_LEN) return '';
    if (!SAFE_ID_RE.test(id)) return '';

    const surface = coerceSurface(rec.surface) ?? SURFACE_BY_KIND[kind];
    return `${surface}:${kind}:${id}`;
  } catch {
    return '';
  }
}

/**
 * Decode a nav param string back into a handle. Parses `<surface>:<kind>:<id>`,
 * splitting on only the first two colons so a `::`-namespaced id
 * (`default::blackswan`) survives verbatim. Surface/kind are matched
 * case-insensitively; the id keeps its exact case.
 *
 * Returns null for any junk — a non-string, an over-length string, a missing
 * segment, an unknown surface or kind, or an id that is empty or contains an
 * unsafe character. Never throws.
 */
export function decodeEntityHandle(s: unknown): EntityHandle | null {
  if (typeof s !== 'string') return null;
  const raw = s.trim();
  if (raw.length === 0 || raw.length > MAX_ENTITY_HANDLE_LEN) return null;

  const i1 = raw.indexOf(':');
  if (i1 <= 0) return null; // no surface segment, or leading colon
  const i2 = raw.indexOf(':', i1 + 1);
  if (i2 <= i1 + 1) return null; // no kind segment, or empty kind (adjacent colons)

  const surface = coerceSurface(raw.slice(0, i1));
  if (surface === null) return null;
  const kind = coerceKind(raw.slice(i1 + 1, i2));
  if (kind === null) return null;

  const id = raw.slice(i2 + 1);
  if (id.length === 0 || id.length > MAX_ID_LEN) return null;
  if (!SAFE_ID_RE.test(id)) return null;

  return { kind, id, surface };
}
