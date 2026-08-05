/**
 * agentReceipt — the product's SIGNATURE accountability primitive.
 *
 * The plumbing for trust already exists (evidence contracts, approval gates,
 * agent_run_events, proof receipts, outcome signals) but it renders scattered
 * per-surface with no canonical "what did the agent do → who approved → what's
 * the proof → verified?" summary. The branding + capability audits both flag
 * that missing summary as the #1 gap (docs/APP_BRANDING_DESIGN_REVIEW.md §4).
 *
 * This module is the PURE, dependency-light assembler for that summary. It
 * folds the data already living on a persisted bot message (its computer
 * handoff / evidence contract, artifacts, browser plans, computer findings,
 * recovery options, and outcome signal) into one bounded `AgentReceipt`, and
 * decides whether that receipt is worth showing at all.
 *
 * HARD RULES:
 *   - `import type` only — this file must stay smoke-testable (no react-native,
 *     no runtime imports of the heavy modules; it accepts their exported
 *     SHAPES, so a partial/junk object never makes it throw).
 *   - Everything is bounded (proof <= MAX_PROOF entries, strings clamped).
 *   - Total: any partial/degenerate input yields a minimal receipt or null,
 *     and never throws.
 *   - It NEVER surfaces on casual chat — a plain reply with no action, no
 *     approval, and no proof returns null.
 *
 * Risk tiers reuse the app-wide evidence-contract vocabulary rather than
 * reinventing one: `highestApprovalRisk` classifies a contract's approval
 * reasons as low/medium/high/critical, which map 1:1 onto the audit's
 * read / reversible / external / irreversible tiers.
 */

import type { ChatOutcomeVerdict } from './chatOutcomeSignals';
import type {
  ComputerTaskApprovalRisk,
  ComputerTaskEvidenceContract,
} from './computerTaskEvidenceContract';
// Pure, dependency-free — keeps this module tsx-loadable for the smoke.
import { extractIntegrationReceiptFromToolEvent } from './integrationActionReceipt';

// ─── Public model ────────────────────────────────────────────────────────────

/** The four risk tiers from the branding audit; null when there is no action
 *  worth tiering (a pure read / plain reply). Maps 1:1 onto the evidence
 *  contract's approval-risk classifier (see `deriveRiskTier`). */
export type AgentReceiptRiskTier = 'read' | 'reversible' | 'external' | 'irreversible';

/** Where an approval stood when the agent finished this turn. */
export type AgentReceiptApprovalState =
  | 'not_required'
  | 'approved'
  | 'awaiting'
  | 'expired'
  | 'reused';

/** One piece of proof the agent produced. `ref` is an optional URL / id the
 *  card MAY make tappable (read-only) — never a secret. */
export type AgentReceiptProofKind =
  | 'artifact'
  | 'screenshot'
  | 'file'
  | 'link'
  | 'receipt'
  | 'measurement';

export interface AgentReceiptProof {
  kind: AgentReceiptProofKind;
  label: string;
  ref?: string;
}

export interface AgentReceiptApproval {
  state: AgentReceiptApprovalState;
  approverLabel?: string;
}

/**
 * The at-a-glance accountability summary for one agent turn. Bounded and
 * PII-free (labels are plain-language; refs are URLs/ids the message already
 * carried, never raw secrets).
 */
export interface AgentReceipt {
  /** Plain-language statement of what the agent did. */
  action: string;
  /** Risk tier of the action, or null when nothing is worth tiering. */
  riskTier: AgentReceiptRiskTier | null;
  approval: AgentReceiptApproval;
  /** Bounded proof list (<= MAX_PROOF). */
  proof: AgentReceiptProof[];
  /** Machine-derived outcome verdict, or null when unknown/absent. */
  verdict: ChatOutcomeVerdict | null;
  canUndo: boolean;
  canRetry: boolean;
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

const MAX_PROOF = 6;
const ACTION_MAX = 160;
const PROOF_LABEL_MAX = 80;
const PROOF_REF_MAX = 300;
const APPROVER_MAX = 60;

// ─── Loose input shapes (accept what the modules already expose) ─────────────
//
// We take the shapes structurally rather than importing the runtime modules,
// so a persisted row (untrusted after round-trip) can be passed straight in.
// Every field is optional/unknown and re-validated defensively below.

interface LooseArtifact {
  kind?: unknown;
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

interface LooseFinding {
  title?: unknown;
  url?: unknown;
  price?: unknown;
  rating?: unknown;
}

interface LooseBrowserPlan {
  planId?: unknown;
  task?: unknown;
  status?: unknown;
  backendLiveUrl?: unknown;
  requiresApproval?: unknown;
}

interface LooseRecoveryOption {
  actor?: unknown;
  recommended?: unknown;
}

interface LooseHandoff {
  surface?: unknown;
  taskLabel?: unknown;
  approvalSummary?: unknown;
  blockers?: unknown;
  blockerCount?: unknown;
  standingGrant?: { scopeKey?: unknown } | null;
  evidenceContract?: ComputerTaskEvidenceContract | null;
  appRouteDecision?: {
    status?: unknown;
    missingApprovals?: unknown;
    missingConfirmations?: unknown;
    userActionBlockers?: unknown;
  } | null;
  designAppTask?: { appName?: unknown } | null;
}

interface LooseOutcomeSignal {
  verdict?: unknown;
}

/**
 * The full input to `buildAgentReceipt`. Everything is optional; callers spread
 * whatever a bot message row carries. Nothing here is required for the function
 * to be total.
 */
export interface BuildAgentReceiptInput {
  /** The bot reply text (used only as a last-resort action fallback). */
  content?: string | null;
  computerHandoff?: LooseHandoff | null;
  artifacts?: ReadonlyArray<LooseArtifact | null | undefined> | null;
  computerFindings?: { items?: ReadonlyArray<LooseFinding | null | undefined> | null } | null;
  browserPlans?: ReadonlyArray<LooseBrowserPlan | null | undefined> | null;
  /** Persisted tool events for the turn — integration writes/posts here become
   *  proof (their formatted result leads with the "✅ Created …: <url>" line). */
  toolEvents?: ReadonlyArray<{ tool?: string | null; result?: string | null; status?: string | null } | null | undefined> | null;
  recoveryOptions?: ReadonlyArray<LooseRecoveryOption | null | undefined> | null;
  outcomeSignal?: LooseOutcomeSignal | null;
  /** Whether the caller can wire an undo affordance for this turn. */
  canUndo?: boolean;
  /** Whether the caller can wire a retry affordance for this turn. */
  canRetry?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OUTCOME_VERDICTS: readonly ChatOutcomeVerdict[] = [
  'completed',
  'partial',
  'blocked',
  'failed',
  'unknown',
];

function clamp(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** True when a ref looks safe to surface as a tappable link (http/https or a
 *  scheme-less path/id). We never surface anything that smells like a secret. */
function safeRef(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  if (/(?:api[_-]?key|secret|token|password|authorization|bearer)/i.test(text)) return undefined;
  return clamp(text, PROOF_REF_MAX);
}

// ─── Risk tier ───────────────────────────────────────────────────────────────

const APPROVAL_RISK_TO_TIER: Record<ComputerTaskApprovalRisk, AgentReceiptRiskTier> = {
  critical: 'irreversible',
  high: 'external',
  medium: 'reversible',
  low: 'read',
};

/**
 * Inline mirror of `highestApprovalRisk` from computerTaskEvidenceContract.
 *
 * We reuse the contract's regex-based classifier VOCABULARY (critical > high >
 * medium > low) but re-implement the tiny scan here so this module needs only
 * `import type` and stays smoke-testable. The regexes are copied verbatim from
 * the owner so the two never drift on the cases that matter (money /
 * destructive / external → critical; submit/save/export/credential → high).
 */
const RISK_CRITICAL_RE = /\b(pay|payment|purchase|buy|checkout|send money|wire|transfer funds|delete|destroy|wipe|erase|publish|post publicly|send (?:email|message|invite|dm)|invite|external upload|upload to|share externally|overwrite|irreversible|deploy|go live)\b/i;
const RISK_HIGH_RE = /\b(submit|save|export|package|render|flatten|rasterize|relink|place (?:local )?asset|run(?:ning)? (?:new )?(?:scripts?|plugins?|actions?|macros?|add-?ins?)|connected-agent adapter code|patch|credential|sign ?in|log ?in|password|api key|token|move|copy|rename|archive|recursive scan|broad scan|batch|mass)\b/i;
const RISK_MEDIUM_RE = /\b(document mutation|mutat|edit|modify|change|update|create|insert|type|fill|cross-origin|navigat|new note|write)\b/i;

function classifyReasonRisk(reason: string): ComputerTaskApprovalRisk {
  const text = reason.trim();
  if (!text) return 'low';
  if (RISK_CRITICAL_RE.test(text)) return 'critical';
  if (RISK_HIGH_RE.test(text)) return 'high';
  if (RISK_MEDIUM_RE.test(text)) return 'medium';
  return 'low';
}

const RISK_ORDER: Record<ComputerTaskApprovalRisk, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Derive the receipt risk tier from the handoff's evidence contract when
 * present (its most-severe approvalBefore reason), else from the browser-plan
 * approval flag, else null. Total: junk contracts yield null, never throw.
 */
function deriveRiskTier(handoff: LooseHandoff | null | undefined, browserPlanNeedsApproval: boolean): AgentReceiptRiskTier | null {
  const contract = handoff?.evidenceContract;
  const reasons = asArray<unknown>(contract?.approvalBefore).map(asString).filter(Boolean);
  if (reasons.length > 0) {
    let worst: ComputerTaskApprovalRisk = 'low';
    for (const reason of reasons) {
      const risk = classifyReasonRisk(reason);
      if (RISK_ORDER[risk] < RISK_ORDER[worst]) worst = risk;
    }
    return APPROVAL_RISK_TO_TIER[worst];
  }
  // No structured contract: a browser plan that needs approval is at least an
  // external-side-effect gate; a read-only handoff/plan tiers as 'read'.
  if (handoff || browserPlanNeedsApproval) {
    return browserPlanNeedsApproval ? 'external' : 'read';
  }
  return null;
}

// ─── Approval state ──────────────────────────────────────────────────────────

/**
 * Derive the approval state + approver label from the data on the message.
 * Priority:
 *   1. explicit missing-approval / awaiting signals from the app route decision
 *      or a recovery option that needs the USER → 'awaiting'
 *   2. a standing (reused) grant stamp → 'reused'
 *   3. an approval summary / satisfied route → 'approved'
 *   4. otherwise → 'not_required'
 */
function deriveApproval(
  handoff: LooseHandoff | null | undefined,
  recoveryOptions: ReadonlyArray<LooseRecoveryOption | null | undefined> | null | undefined,
): AgentReceiptApproval {
  const route = handoff?.appRouteDecision || null;
  const missingApprovals = asArray<unknown>(route?.missingApprovals).map(asString).filter(Boolean);
  const missingConfirmations = asArray<unknown>(route?.missingConfirmations).map(asString).filter(Boolean);
  const routeStatus = asString(route?.status);
  const blockerCount = typeof handoff?.blockerCount === 'number' ? handoff.blockerCount : asArray<unknown>(handoff?.blockers).length;

  const userMustAct = asArray<LooseRecoveryOption>(recoveryOptions).some(
    (option) => option?.actor === 'user',
  );

  // 1. Something is still waiting on a human to approve / confirm / unblock.
  if (
    missingApprovals.length > 0 ||
    missingConfirmations.length > 0 ||
    routeStatus === 'needs_approval' ||
    routeStatus === 'needs_user_action' ||
    (userMustAct && blockerCount > 0) ||
    userMustAct
  ) {
    return { state: 'awaiting', approverLabel: 'You' };
  }

  // 2. A standing grant carried this turn without a fresh prompt.
  const standingScope = asString(handoff?.standingGrant?.scopeKey);
  if (standingScope) {
    return { state: 'reused', approverLabel: clamp(standingScope, APPROVER_MAX) };
  }

  // 3. An approval was summarized (i.e. it happened) or the route is satisfied.
  const approvalSummary = asString(handoff?.approvalSummary);
  if (approvalSummary || routeStatus === 'ready_to_execute') {
    return { state: 'approved', approverLabel: 'You' };
  }

  return { state: 'not_required' };
}

// ─── Proof ───────────────────────────────────────────────────────────────────

const ARTIFACT_PROOF_KIND: Record<string, AgentReceiptProofKind> = {
  image: 'screenshot',
  vision: 'screenshot',
  webpage: 'link',
  code: 'file',
  table: 'file',
  summary: 'artifact',
  translation: 'artifact',
  classification: 'artifact',
  audio: 'file',
};

function pushProof(list: AgentReceiptProof[], entry: AgentReceiptProof | null): void {
  if (!entry || list.length >= MAX_PROOF) return;
  if (!entry.label) return;
  list.push(entry);
}

/**
 * Assemble the bounded proof list from artifacts → browser findings → browser
 * sessions. Order matters (durable artifacts first, then findings, then a live
 * session link) so a tight slice keeps the strongest evidence.
 */
function deriveProof(input: BuildAgentReceiptInput): AgentReceiptProof[] {
  const proof: AgentReceiptProof[] = [];

  // Integration writes/posts first — for an `/integrations act` turn this is
  // the primary proof (the created Linear issue / posted Slack message).
  for (const raw of asArray<{ tool?: string | null; result?: string | null; status?: string | null }>(input.toolEvents)) {
    if (!raw || proof.length >= MAX_PROOF) break;
    const extracted = extractIntegrationReceiptFromToolEvent(raw);
    if (!extracted) continue;
    pushProof(proof, { kind: 'receipt', label: clamp(extracted.label, PROOF_LABEL_MAX), ref: safeRef(extracted.ref) });
  }

  for (const raw of asArray<LooseArtifact>(input.artifacts)) {
    if (!raw || proof.length >= MAX_PROOF) break;
    const kindKey = asString(raw.kind);
    const kind = ARTIFACT_PROOF_KIND[kindKey] || 'artifact';
    const label = clamp(asString(raw.title) || (kindKey ? `${kindKey} artifact` : 'Artifact'), PROOF_LABEL_MAX);
    pushProof(proof, { kind, label, ref: safeRef(raw.url) });
  }

  for (const raw of asArray<LooseFinding>(input.computerFindings?.items)) {
    if (!raw || proof.length >= MAX_PROOF) break;
    const title = asString(raw.title);
    if (!title) continue;
    const price = asString(raw.price);
    const rating = asString(raw.rating);
    const suffix = [price, rating].filter(Boolean).join(' · ');
    const label = clamp(suffix ? `${title} — ${suffix}` : title, PROOF_LABEL_MAX);
    pushProof(proof, { kind: 'receipt', label, ref: safeRef(raw.url) });
  }

  for (const raw of asArray<LooseBrowserPlan>(input.browserPlans)) {
    if (!raw || proof.length >= MAX_PROOF) break;
    if (asString(raw.status) !== 'completed') continue;
    const label = clamp(asString(raw.task) || 'Browser run', PROOF_LABEL_MAX);
    const ref = safeRef(raw.backendLiveUrl);
    pushProof(proof, { kind: 'link', label, ref });
  }

  return proof;
}

// ─── Action + verdict ────────────────────────────────────────────────────────

function deriveAction(
  input: BuildAgentReceiptInput,
  proof: AgentReceiptProof[],
  verdict: ChatOutcomeVerdict | null,
): string {
  const handoff = input.computerHandoff || null;
  const label = asString(handoff?.taskLabel);
  if (label) return clamp(label, ACTION_MAX);
  const firstBrowserTask = asArray<LooseBrowserPlan>(input.browserPlans)
    .map((plan) => asString(plan?.task))
    .find(Boolean);
  if (firstBrowserTask) return clamp(firstBrowserTask, ACTION_MAX);
  if (verdict === 'blocked') return 'Action blocked before completion';
  if (verdict === 'failed') return 'Action did not complete';
  if (verdict === 'partial') return 'Action partially completed';
  const designApp = asString(handoff?.designAppTask?.appName);
  if (designApp) return clamp(`Worked in ${designApp}`, ACTION_MAX);
  const surface = asString(handoff?.surface);
  if (surface === 'browser') return 'Ran a browser task';
  if (surface === 'desktop') return 'Ran a desktop app task';
  if (surface === 'local_files') return 'Worked with local files';
  if (surface === 'computer') return 'Ran a computer task';
  if (proof.length > 0) return `Produced ${proof.length === 1 ? '1 result' : `${proof.length} results`}`;
  return 'Action result recorded';
}

function deriveVerdict(input: BuildAgentReceiptInput): ChatOutcomeVerdict | null {
  const verdict = asString(input.outcomeSignal?.verdict);
  if (verdict && (OUTCOME_VERDICTS as readonly string[]).includes(verdict)) {
    return verdict as ChatOutcomeVerdict;
  }
  return null;
}

// ─── Assembler ───────────────────────────────────────────────────────────────

/**
 * Fold a bot message's data into a bounded `AgentReceipt`, or return null when
 * there is nothing worth showing (a plain chat reply with no action, approval,
 * or proof). Total: any partial / junk input returns a receipt-or-null and
 * never throws.
 */
export function buildAgentReceipt(input: BuildAgentReceiptInput | null | undefined): AgentReceipt | null {
  if (!input || typeof input !== 'object') return null;

  const handoff = input.computerHandoff && typeof input.computerHandoff === 'object'
    ? input.computerHandoff
    : null;

  const browserPlanNeedsApproval = asArray<LooseBrowserPlan>(input.browserPlans).some(
    (plan) => plan?.requiresApproval === true,
  );

  const proof = deriveProof(input);
  const approval = deriveApproval(handoff, input.recoveryOptions);
  const riskTier = deriveRiskTier(handoff, browserPlanNeedsApproval);
  const verdict = deriveVerdict(input);
  const hasActionSignal = !!handoff || browserPlanNeedsApproval;

  // Nothing worth surfacing: a plain reply with no action, no approval, no
  // proof, and no meaningful verdict. (An explicit failed/blocked verdict on
  // its own IS worth a receipt — it tells the team the turn did not land.)
  const meaningfulVerdict = verdict === 'failed' || verdict === 'blocked' || verdict === 'partial';
  const hasApprovalSignal = approval.state !== 'not_required';
  if (!hasActionSignal && proof.length === 0 && !hasApprovalSignal && !meaningfulVerdict) {
    return null;
  }

  const action = deriveAction(input, proof, verdict);

  return {
    action,
    riskTier,
    approval,
    proof,
    verdict,
    canUndo: input.canUndo === true,
    canRetry: input.canRetry === true,
  };
}

/**
 * Whether a receipt is worth rendering. A receipt with a real action, an
 * approval that mattered, proof, an undo/retry affordance, or a
 * failed/blocked/partial verdict renders; a hollow one does not. Total: a null
 * receipt returns false.
 */
export function shouldRenderReceipt(receipt: AgentReceipt | null | undefined): boolean {
  if (!receipt || typeof receipt !== 'object') return false;
  if (Array.isArray(receipt.proof) && receipt.proof.length > 0) return true;
  if (receipt.approval?.state && receipt.approval.state !== 'not_required') return true;
  if (receipt.riskTier && receipt.riskTier !== 'read') return true;
  if (receipt.verdict === 'failed' || receipt.verdict === 'blocked' || receipt.verdict === 'partial') return true;
  if (receipt.canUndo || receipt.canRetry) return true;
  // A bare "read" action with a completed/unknown verdict and no proof/approval
  // is not worth a receipt — it is casual chat dressed up.
  return false;
}

// ─── Risk-tier presentation model (chip label + tone, PII-free) ──────────────

export interface AgentReceiptRiskTierDescriptor {
  label: string;
  tone: 'green' | 'blue' | 'amber' | 'red';
  icon: string;
}

const RISK_TIER_DESCRIPTORS: Record<AgentReceiptRiskTier, AgentReceiptRiskTierDescriptor> = {
  read: { label: 'Read-only', tone: 'green', icon: '✅' },
  reversible: { label: 'Reversible', tone: 'blue', icon: '🔄' },
  external: { label: 'External', tone: 'amber', icon: '⚠️' },
  irreversible: { label: 'Irreversible', tone: 'red', icon: '🔴' },
};

/**
 * Presentation descriptor for a risk tier (chip label + tone + icon). A null /
 * unknown tier collapses to the safe 'read' descriptor so the card always has
 * something to render.
 */
export function describeRiskTier(
  tier: AgentReceiptRiskTier | null | undefined,
): AgentReceiptRiskTierDescriptor {
  if (tier && RISK_TIER_DESCRIPTORS[tier]) return RISK_TIER_DESCRIPTORS[tier];
  return RISK_TIER_DESCRIPTORS.read;
}

// ─── Verdict presentation model (badge label + tone, PII-free) ───────────────

export interface AgentReceiptVerdictDescriptor {
  label: string;
  tone: 'green' | 'blue' | 'amber' | 'red' | 'neutral';
}

const VERDICT_DESCRIPTORS: Record<ChatOutcomeVerdict, AgentReceiptVerdictDescriptor> = {
  completed: { label: 'Verified', tone: 'green' },
  partial: { label: 'Partial', tone: 'blue' },
  blocked: { label: 'Blocked', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  unknown: { label: 'Done', tone: 'neutral' },
};

/**
 * Presentation descriptor for an outcome verdict (verdict badge). Null / junk
 * collapses to the neutral 'Done' descriptor.
 */
export function describeVerdict(
  verdict: ChatOutcomeVerdict | null | undefined,
): AgentReceiptVerdictDescriptor {
  if (verdict && VERDICT_DESCRIPTORS[verdict]) return VERDICT_DESCRIPTORS[verdict];
  return VERDICT_DESCRIPTORS.unknown;
}

/**
 * Presentation descriptor for an approval state (one compact line). PII-free:
 * the approver label is the short scope/actor the message already carried.
 */
export function describeApproval(approval: AgentReceiptApproval | null | undefined): {
  label: string;
  tone: 'green' | 'amber' | 'red' | 'neutral';
} {
  const state = approval?.state;
  const who = approval?.approverLabel ? clamp(approval.approverLabel, APPROVER_MAX) : '';
  switch (state) {
    case 'approved':
      return { label: who ? `Approved by ${who}` : 'Approved', tone: 'green' };
    case 'reused':
      return { label: who ? `Standing grant: ${who}` : 'Reused standing grant', tone: 'green' };
    case 'awaiting':
      return { label: who ? `Awaiting ${who}` : 'Awaiting approval', tone: 'amber' };
    case 'expired':
      return { label: 'Approval expired', tone: 'red' };
    default:
      return { label: 'No approval needed', tone: 'neutral' };
  }
}
