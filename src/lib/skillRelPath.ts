/**
 * skillRelPath — pure normaliser + validator for Level-2 skill file
 * references. Split out of `skillLibrary.ts` so smoke tests import
 * without Supabase / react-native.
 *
 * Hermes accepts paths like `references/api.md`, `templates/pr.md`,
 * `scripts/run.sh`. We reject anything that could escape the skill
 * directory (absolute paths, `..`, double-slash runs, Windows drive
 * letters, control chars, leading dots).
 */

export type SkillRelPathResult =
  | { ok: true; relpath: string }
  | { ok: false; error: string; raw: string };

const MAX_LEN = 200;

/**
 * Normalises and validates a skill sub-file path. Returns the cleaned
 * `relpath` (forward-slash, no leading `/`, no trailing `/`) or a
 * structured error string the agent can surface.
 */
export function parseSkillRelPath(raw: string): SkillRelPathResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'path must be a string', raw: String(raw ?? '') };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'path is empty', raw };
  }
  if (trimmed.length > MAX_LEN) {
    return { ok: false, error: `path exceeds ${MAX_LEN} chars`, raw };
  }
  // Reject absolute paths + Windows drive letters up-front so they
  // never reach the DB.
  if (trimmed.startsWith('/') || /^[a-z]:[/\\]/i.test(trimmed) || trimmed.startsWith('\\')) {
    return { ok: false, error: 'path must be relative', raw };
  }
  // No `..` segments anywhere (walks up out of the skill dir).
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    return { ok: false, error: 'path may not contain `..`', raw };
  }
  // No leading dot-segment (`./` is fine to strip, but `.hidden/` is
  // dodgy and we don't need it).
  if (/(^|[\\/])\.[^/\\]/.test(trimmed) && !trimmed.startsWith('./')) {
    return { ok: false, error: 'path may not start with a dotfile segment', raw };
  }
  // Collapse backslashes → forward-slashes, drop leading './', squash
  // duplicate slashes.
  let normalised = trimmed.replace(/\\/g, '/');
  if (normalised.startsWith('./')) normalised = normalised.slice(2);
  normalised = normalised.replace(/\/{2,}/g, '/');
  if (normalised.endsWith('/')) {
    return { ok: false, error: 'path must reference a file, not a directory', raw };
  }
  // Control chars (including NUL, tab, newline) — Postgres text accepts
  // them but they're never legitimate in a relpath.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(normalised)) {
    return { ok: false, error: 'path contains control characters', raw };
  }
  return { ok: true, relpath: normalised };
}

/** Convenience boolean — returns true iff `parseSkillRelPath` would
 *  accept the input. Use when the caller doesn't need the error
 *  string. */
export function isSafeSkillRelPath(raw: string): boolean {
  return parseSkillRelPath(raw).ok;
}
