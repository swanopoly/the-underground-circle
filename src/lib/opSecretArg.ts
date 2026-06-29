/**
 * opSecretArg — shell-safe validation for 1Password (`op` CLI) argument values.
 *
 * The bridge's `/secrets` endpoint forwards item/vault/field/uri values into
 * the local `op` CLI. Even though the bridge prefers `execFileSync` (no shell),
 * these validators are kept as defense-in-depth so a value that starts with a
 * dash cannot be reinterpreted as an `op` flag, and so any future shell-using
 * caller is protected from metacharacter injection.
 *
 * Dependency-light on purpose: no react-native, no fetch — pure functions so
 * the smoke harness (tsx/esbuild) can load it directly. The bridge
 * (CommonJS, no build step) mirrors `isSafeOpArg` inline.
 */

/** Shell metacharacters + control chars that must never appear in an `op`
 * argument. Spaces are deliberately allowed: 1Password vault/item/field names
 * legitimately contain spaces ("Agent Credentials", "WordPress Login") and the
 * bridge invokes `op` via execFileSync (argv, no shell), so a space cannot be
 * reinterpreted. Leading-dash and true shell metacharacters are still rejected
 * as defense-in-depth for any future shell-using caller. */
const SHELL_METACHARS_ALLOW_SPACE = /["'`$;&|<>(){}\\\t\n\r]/;

export type OpSecretArgKind = 'identifier' | 'uri';

/**
 * Accepts a single `op` argument value. Rejects empties, leading-dash
 * (flag-injection) values, and shell metacharacters. For `uri` the `op://`
 * prefix is required and spaces are permitted (only true control/shell
 * characters are rejected).
 */
export function isSafeOpArg(value: unknown, kind: OpSecretArgKind = 'identifier'): boolean {
  if (typeof value !== 'string') return false;
  const v = value;
  if (v.length === 0 || v.length > 512) return false;
  // Leading dash would be parsed by `op` as a flag.
  if (v.startsWith('-')) return false;
  if (kind === 'uri' && !v.startsWith('op://')) return false;
  // Spaces are safe (execFileSync / argv, no shell); reject only true shell
  // metacharacters and control characters.
  return !SHELL_METACHARS_ALLOW_SPACE.test(v);
}

export interface OpSecretArgs {
  item?: unknown;
  vault?: unknown;
  fields?: unknown;
  uri?: unknown;
}

/**
 * Validates the full `/secrets` argument set. Throws on the first unsafe
 * value so the caller can return a 400 before invoking `op`.
 */
export function assertSafeOpArgs(args: OpSecretArgs): void {
  const { item, vault, fields, uri } = args;
  if (uri !== undefined && uri !== null) {
    if (!isSafeOpArg(uri, 'uri')) throw new Error('Invalid credential reference: uri');
  }
  if (item !== undefined && item !== null) {
    if (!isSafeOpArg(item, 'identifier')) throw new Error('Invalid credential reference: item');
  }
  if (vault !== undefined && vault !== null) {
    if (!isSafeOpArg(vault, 'identifier')) throw new Error('Invalid credential reference: vault');
  }
  if (fields !== undefined && fields !== null) {
    if (!Array.isArray(fields)) throw new Error('Invalid credential reference: fields');
    for (const f of fields) {
      if (!isSafeOpArg(f, 'identifier')) throw new Error('Invalid credential reference: field');
    }
  }
}
