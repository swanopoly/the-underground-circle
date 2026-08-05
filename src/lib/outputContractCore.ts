// outputContractCore — the PURE validator that checks an agent's FINAL output
// against a required shape. It does NOT produce output or call any model: it
// takes a produced string plus a declarative contract (non-empty, must-include
// substrings, must-match regexes, forbidden substrings, length bounds, and a
// coarse format), evaluates EVERY clause, and returns which clauses were
// satisfied and which failed with human-readable notes.
//
// This feeds two callers: delegation acceptance (did the sub-agent's result
// meet the asked-for shape before we accept it?) and the verify stage (does the
// final answer still satisfy the contract before we hand it back?). Both want a
// full clause-by-clause report, not a boolean, so a caller can tell the user or
// the agent exactly what is missing.
//
// Posture (fail-closed on the check, not the process): a bad/undefined input is
// treated as an EMPTY output (so requireNonEmpty/minLen fail rather than crash),
// and a malformed regex in `mustMatch` becomes a FAILURE note ("invalid
// pattern: <src>") — never a thrown error. An undefined/empty contract has no
// clauses and therefore passes.
//
// PURITY: zero imports, tsx-loadable (smoke: output-contract-core). Never throws.

export interface OutputContract {
  /** Trimmed output length must be > 0. */
  requireNonEmpty?: boolean;
  /** Every substring must be present (case-sensitive). */
  mustInclude?: string[];
  /** Every regex-source (compiled safely) must match the raw output. */
  mustMatch?: string[];
  /** None of these substrings may be present (case-sensitive). */
  forbid?: string[];
  /** Trimmed length lower bound (inclusive). */
  minLen?: number;
  /** Trimmed length upper bound (inclusive). */
  maxLen?: number;
  /** Coarse shape: json is enforced, markdown/text are lenient. */
  format?: 'text' | 'json' | 'markdown';
}

export interface OutputCheck {
  /** true iff no clause failed. */
  pass: boolean;
  /** Human-readable failure reasons (empty when pass). */
  failures: string[];
  /** Human-readable labels for the clauses that were satisfied. */
  satisfied: string[];
}

/** Coerce anything into the string we validate; non-strings behave as empty. */
function asOutput(output: unknown): string {
  return typeof output === 'string' ? output : '';
}

/** Bounded, quote-wrapped echo of a substring/pattern for a note. */
function show(value: string): string {
  const MAX = 60;
  const clipped = value.length > MAX ? `${value.slice(0, MAX - 1)}…` : value;
  return `"${clipped}"`;
}

/**
 * Is `text` a valid JSON document? true for any parseable JSON value
 * (object, array, string, number, boolean, null). Never throws.
 */
export function isValidJson(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (!text.trim()) return false; // JSON.parse('') throws / '   ' is not JSON
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluate `output` against `contract`, collecting satisfied + failed clause
 * descriptions. Never throws. An undefined/empty contract passes with no
 * clauses. `pass === failures.length === 0`.
 */
export function checkOutputContract(output: unknown, contract: OutputContract | undefined | null): OutputCheck {
  const failures: string[] = [];
  const satisfied: string[] = [];

  // Guard: no contract → nothing to check → pass.
  if (!contract || typeof contract !== 'object') {
    return { pass: true, failures, satisfied };
  }

  const raw = asOutput(output);
  const trimmedLen = raw.trim().length;

  // requireNonEmpty
  if (contract.requireNonEmpty === true) {
    if (trimmedLen > 0) satisfied.push('non-empty');
    else failures.push('output is empty (requireNonEmpty)');
  }

  // mustInclude — every substring present (case-sensitive).
  if (Array.isArray(contract.mustInclude)) {
    for (const needle of contract.mustInclude) {
      if (typeof needle !== 'string') {
        failures.push('invalid mustInclude entry (not a string)');
        continue;
      }
      if (raw.includes(needle)) satisfied.push(`includes ${show(needle)}`);
      else failures.push(`missing required substring ${show(needle)}`);
    }
  }

  // mustMatch — every regex-source must match; a bad source → failure, not throw.
  if (Array.isArray(contract.mustMatch)) {
    for (const src of contract.mustMatch) {
      if (typeof src !== 'string') {
        failures.push('invalid mustMatch entry (not a string)');
        continue;
      }
      let re: RegExp | null = null;
      try {
        re = new RegExp(src);
      } catch {
        re = null;
      }
      if (re === null) {
        failures.push(`invalid pattern: ${src}`);
        continue;
      }
      let matched = false;
      try {
        matched = re.test(raw);
      } catch {
        matched = false;
      }
      if (matched) satisfied.push(`matches /${src}/`);
      else failures.push(`does not match required pattern /${src}/`);
    }
  }

  // forbid — none of the substrings present.
  if (Array.isArray(contract.forbid)) {
    for (const needle of contract.forbid) {
      if (typeof needle !== 'string') {
        // A non-string forbidden entry can't be present → treat as satisfied.
        satisfied.push('absent (invalid forbid entry ignored)');
        continue;
      }
      if (raw.includes(needle)) failures.push(`contains forbidden substring ${show(needle)}`);
      else satisfied.push(`absent ${show(needle)}`);
    }
  }

  // minLen (trimmed)
  if (typeof contract.minLen === 'number' && Number.isFinite(contract.minLen)) {
    if (trimmedLen >= contract.minLen) satisfied.push(`length >= ${contract.minLen}`);
    else failures.push(`output too short: ${trimmedLen} < minLen ${contract.minLen}`);
  }

  // maxLen (trimmed)
  if (typeof contract.maxLen === 'number' && Number.isFinite(contract.maxLen)) {
    if (trimmedLen <= contract.maxLen) satisfied.push(`length <= ${contract.maxLen}`);
    else failures.push(`output too long: ${trimmedLen} > maxLen ${contract.maxLen}`);
  }

  // format
  if (contract.format === 'json') {
    if (isValidJson(raw)) satisfied.push('valid json');
    else failures.push('output is not valid json (format: json)');
  } else if (contract.format === 'markdown') {
    // Lenient: markdown always passes, but note an empty body.
    if (trimmedLen > 0) satisfied.push('markdown');
    else failures.push('markdown output looks empty (format: markdown)');
  } else if (contract.format === 'text') {
    // Lenient: text always passes.
    satisfied.push('text');
  }

  return { pass: failures.length === 0, failures, satisfied };
}
