// envReadinessCore — the PURE parse/validate brain for a project ENVIRONMENT
// manifest (`uc.environment.json`), the Cursor-parity background-agent
// environment config. A background/coding agent reads this file to learn how to
// bootstrap a repo: which command installs deps, which starts the app, which
// runs the test/watch/lint/typecheck loop, and which env vars the run needs.
//
// This module does NOT execute anything and does NOT read the filesystem. It
// takes the manifest text, best-effort parses it, and reports readiness: which
// command fields are usable, which required ones are missing, human warnings,
// and the NAMES of env keys that look secret-shaped.
//
// SECRET SAFETY (load-bearing): env values are NEVER echoed. We surface only the
// NAME of a secret-ish key (e.g. "OPENAI_API_KEY"), and if such a key carries a
// real (non-placeholder) value we emit a generic "inject securely, don't
// hardcode" warning — but the VALUE itself never appears in commands, missing,
// warnings, or secretishEnvKeys. Over-flagging a name is safe; leaking a value
// is not.
//
// PURITY: zero imports, tsx-loadable (smoke: env-readiness-core). Deterministic.
// Never throws — bad/garbage input degrades to a clean, empty-ish result.

export interface UcEnvironment {
  install?: string;
  start?: string;
  test?: string;
  watch?: string;
  lint?: string;
  typecheck?: string;
  env?: Record<string, string>;
}

export interface EnvReadiness {
  /** true when every required field is present (missing.length === 0). */
  valid: boolean;
  /** Known command fields present as non-empty strings, keyed by field name. */
  commands: Record<string, string>;
  /** Required fields (opts.require, default ['install','test']) that are absent. */
  missing: string[];
  /** Human-facing, secret-free advisories. */
  warnings: string[];
  /** NAMES only of env keys that look secret-shaped — never their values. */
  secretishEnvKeys: string[];
}

export const KNOWN_COMMAND_FIELDS = [
  'install',
  'start',
  'test',
  'watch',
  'lint',
  'typecheck',
] as const;

const DEFAULT_REQUIRED = ['install', 'test'] as const;

// Env KEY NAMES that look like they name a secret. Matched against the key only.
const SECRETISH_KEY = /(_KEY|_TOKEN|_SECRET|PASSWORD|APIKEY|_PWD)/i;

// Values that are obviously placeholders, not real secrets. If a secret-ish key
// only holds one of these we do NOT nag about hardcoding (nothing to leak).
const PLACEHOLDER_VALUE =
  /^(|<[^>]*>|\{\{[^}]*\}\}|\$\{?[A-Za-z0-9_]+\}?|x{3,}|\*{3,}|changeme|change_me|placeholder|your[-_ ]?\w+|todo|tbd|none|null|undefined|example|dummy|redacted|\.{3,})$/i;

/** True only for a genuinely-populated string. */
function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Best-effort parse of a `uc.environment.json` document. Returns a clean object
 * carrying only well-typed fields we understand. On any parse error, or when the
 * payload is not a plain object, returns {}. Never throws.
 */
export function parseUcEnvironment(json: unknown): UcEnvironment {
  if (typeof json !== 'string') return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  // Reject non-objects (arrays, numbers, strings, null) — a manifest is a map.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const src = raw as Record<string, unknown>;
  const out: UcEnvironment = {};

  // Copy through only known command fields that are non-empty strings; a
  // wrong-typed field (number/array/object/empty) is silently dropped.
  for (const field of KNOWN_COMMAND_FIELDS) {
    const v = src[field];
    if (nonEmptyString(v)) out[field] = v.trim();
  }

  // env must be a plain object of string→string; coerce/skip anything else.
  const envSrc = src.env;
  if (envSrc !== null && typeof envSrc === 'object' && !Array.isArray(envSrc)) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(envSrc as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k.length) continue;
      if (typeof v === 'string') env[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') env[k] = String(v);
      // objects/arrays/null values are dropped (can't be a shell env value)
    }
    if (Object.keys(env).length > 0) out.env = env;
  }

  return out;
}

/**
 * Evaluate a parsed manifest for background-agent readiness. Deterministic and
 * never throwing; tolerates a malformed/partial `env` object. The returned
 * payload is secret-safe: no env VALUE is ever placed into any field.
 */
export function evaluateEnvReadiness(
  env: unknown,
  opts?: { require?: readonly string[] },
): EnvReadiness {
  const manifest: UcEnvironment =
    env && typeof env === 'object' && !Array.isArray(env)
      ? (env as UcEnvironment)
      : {};

  // Commands: every known field present as a non-empty string.
  const commands: Record<string, string> = {};
  for (const field of KNOWN_COMMAND_FIELDS) {
    const v = manifest[field];
    if (nonEmptyString(v)) commands[field] = v.trim();
  }

  // Required fields (default install+test). Sanitize the override to known,
  // non-empty string field names and de-dup so `missing`/`valid` stay stable.
  const requiredList =
    Array.isArray(opts?.require) && opts!.require!.length
      ? opts!.require!
      : DEFAULT_REQUIRED;
  const required: string[] = [];
  for (const r of requiredList) {
    if (typeof r === 'string' && r.trim() && !required.includes(r.trim())) {
      required.push(r.trim());
    }
  }
  const missing = required.filter((r) => !(r in commands));

  const warnings: string[] = [];
  if (!('install' in commands)) {
    warnings.push('no install command — dependencies may not be bootstrapped');
  }
  if (!('test' in commands)) {
    warnings.push('no test command — cannot verify changes');
  }

  // Secret-ish env keys: flag by NAME only. If such a key holds a real
  // (non-placeholder) value, add ONE generic hardcoding warning — the value is
  // never included in that message (or anywhere else).
  const secretishEnvKeys: string[] = [];
  let sawHardcodedSecret = false;
  const rawEnv = manifest.env;
  if (rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)) {
    for (const key of Object.keys(rawEnv as Record<string, unknown>)) {
      if (typeof key !== 'string' || !SECRETISH_KEY.test(key)) continue;
      if (!secretishEnvKeys.includes(key)) secretishEnvKeys.push(key);
      const value = (rawEnv as Record<string, unknown>)[key];
      if (typeof value === 'string' && !PLACEHOLDER_VALUE.test(value.trim())) {
        sawHardcodedSecret = true;
      }
    }
  }
  if (sawHardcodedSecret) {
    warnings.push(
      'secret-shaped env keys carry hardcoded values — inject secrets securely at runtime, do not store them in uc.environment.json',
    );
  }

  return {
    valid: missing.length === 0,
    commands,
    missing,
    warnings,
    secretishEnvKeys,
  };
}
