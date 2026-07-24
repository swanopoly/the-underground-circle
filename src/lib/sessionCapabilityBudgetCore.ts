// sessionCapabilityBudgetCore — the PURE guard that keeps an unattended agent
// session from silently assembling the "lethal trifecta" of capabilities that
// makes prompt-injection exfiltration guaranteed-exploitable.
//
// A session accumulates up to three capabilities:
//   (A) untrustedInput     — has processed untrusted / external content this
//                            session (a web page, an email, a tool result, a
//                            file authored by someone else). This is the vector
//                            through which an attacker can plant instructions.
//   (B) sensitiveAccess    — has access to private data or credentials (the
//                            secret an attacker would want to steal).
//   (C) stateChangeOrExfil — can change state or communicate externally
//                            (write / send / publish / pay) — the channel an
//                            attacker would use to act or exfiltrate.
//
// Simon Willison's "lethal trifecta": holding ALL THREE at once means a
// prompt-injection attack can read the secret AND ship it out — guaranteed
// exploitable. Meta's "Agents Rule of Two": an unattended session should hold
// AT MOST TWO of the three without explicit human approval. This module is the
// pure decision core; a runtime supplies the state and enforces the verdict.
//
// PURITY: zero imports, tsx-loadable (smoke: session-capability-budget-core).
// Deterministic (no clock, no randomness — the caller passes `now` if it ever
// needs one; today it does not). Never throws; guards undefined/null inputs to
// an empty state.

export const LETHAL_TRIFECTA_NOTE =
  'The lethal trifecta (Simon Willison): an agent session that at once (A) has ' +
  'processed untrusted input, (B) can access sensitive data or credentials, and ' +
  '(C) can change state or communicate externally is guaranteed-exploitable — a ' +
  'prompt injection can read the secret and exfiltrate it. Meta’s Rule of Two ' +
  'says an unattended session should satisfy at most two of these three without ' +
  'explicit human approval.';

export interface SessionCapabilityState {
  /** (A) Has processed untrusted / external content this session. */
  untrustedInput: boolean;
  /** (B) Has access to private data / credentials. */
  sensitiveAccess: boolean;
  /** (C) Can change state or communicate externally (write/send/publish/pay). */
  stateChangeOrExfil: boolean;
}

export interface ProposedAction {
  addsUntrustedInput?: boolean;
  addsSensitiveAccess?: boolean;
  addsStateChangeOrExfil?: boolean;
  /** Optional human label for the action, surfaced in `reason`. */
  label?: string;
}

/** Coerce anything into a strict boolean-triple state. Guards null/undefined and
 *  any missing/non-boolean field to `false` — an unknown state is the safe one. */
function toState(raw: unknown): SessionCapabilityState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<SessionCapabilityState>;
  return {
    untrustedInput: s.untrustedInput === true,
    sensitiveAccess: s.sensitiveAccess === true,
    stateChangeOrExfil: s.stateChangeOrExfil === true,
  };
}

/** Coerce anything into a ProposedAction. Missing/non-boolean adds => false. */
function toAction(raw: unknown): Required<Omit<ProposedAction, 'label'>> & { label: string } {
  const a = (raw && typeof raw === 'object' ? raw : {}) as ProposedAction;
  return {
    addsUntrustedInput: a.addsUntrustedInput === true,
    addsSensitiveAccess: a.addsSensitiveAccess === true,
    addsStateChangeOrExfil: a.addsStateChangeOrExfil === true,
    label: typeof a.label === 'string' ? a.label : '',
  };
}

/** The zero state — a fresh session holds no capabilities. */
export function emptyCapabilityState(): SessionCapabilityState {
  return { untrustedInput: false, sensitiveAccess: false, stateChangeOrExfil: false };
}

/**
 * Apply a proposed action to a state, returning a NEW state (pure). The merge is
 * a monotonic OR: once a capability is held it stays held for the rest of the
 * session — capabilities accumulate and are never silently dropped. Re-applying
 * an already-held capability is therefore a no-op.
 */
export function applyAction(state: SessionCapabilityState, action: ProposedAction): SessionCapabilityState {
  const s = toState(state);
  const a = toAction(action);
  return {
    untrustedInput: s.untrustedInput || a.addsUntrustedInput,
    sensitiveAccess: s.sensitiveAccess || a.addsSensitiveAccess,
    stateChangeOrExfil: s.stateChangeOrExfil || a.addsStateChangeOrExfil,
  };
}

/** How many of the three capabilities are held (0..3). */
export function countHeld(state: SessionCapabilityState): number {
  const s = toState(state);
  return (s.untrustedInput ? 1 : 0) + (s.sensitiveAccess ? 1 : 0) + (s.stateChangeOrExfil ? 1 : 0);
}

const CAPABILITY_LABELS: Record<keyof SessionCapabilityState, string> = {
  untrustedInput: 'untrusted input (A)',
  sensitiveAccess: 'sensitive/credential access (B)',
  stateChangeOrExfil: 'state-change/exfiltration (C)',
};

/** Names of the held capabilities, in canonical A→B→C order. */
function heldNames(state: SessionCapabilityState): string[] {
  const s = toState(state);
  const out: string[] = [];
  if (s.untrustedInput) out.push(CAPABILITY_LABELS.untrustedInput);
  if (s.sensitiveAccess) out.push(CAPABILITY_LABELS.sensitiveAccess);
  if (s.stateChangeOrExfil) out.push(CAPABILITY_LABELS.stateChangeOrExfil);
  return out;
}

/**
 * Rule-of-Two verdict for taking `action` from `state`. Computes the projected
 * state (state OR-merged with the action) and reports whether that projection
 * would hold all three capabilities — the lethal trifecta — which is the only
 * case that requires explicit human approval. Pure; never throws.
 */
export function evaluateRuleOfTwo(
  state: SessionCapabilityState,
  action: ProposedAction,
): {
  projected: SessionCapabilityState;
  heldCount: number;
  trifecta: boolean;
  requiresHumanApproval: boolean;
  reason: string;
} {
  const projected = applyAction(state, action);
  const heldCount = countHeld(projected);
  const trifecta = heldCount === 3;
  const requiresHumanApproval = trifecta;

  let reason: string;
  if (trifecta) {
    reason =
      `Lethal trifecta: this session would hold all three capabilities — ` +
      `${heldNames(projected).join(', ')} — which is guaranteed-exploitable. ` +
      `Explicit human approval is required (Rule of Two exceeded).`;
  } else {
    const held = heldNames(projected);
    const heldPart = held.length ? `holding ${held.join(', ')}` : 'holding none of the three';
    reason =
      `Within the Rule of Two: this session would hold ${heldCount} of 3 capabilities ` +
      `(${heldPart}). No human approval required.`;
  }

  return { projected, heldCount, trifecta, requiresHumanApproval, reason };
}

/** One-line human summary of a capability state. Never throws. */
export function describeCapabilityState(state: SessionCapabilityState): string {
  const s = toState(state);
  const held = heldNames(s);
  const count = held.length;
  if (count === 0) return 'Session holds 0 of 3 capabilities (none).';
  const suffix = count === 3 ? ' — LETHAL TRIFECTA, human approval required' : '';
  return `Session holds ${count} of 3 capabilities: ${held.join(', ')}${suffix}.`;
}
