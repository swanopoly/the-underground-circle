/**
 * agentDeployPolicy — Phase-3 mass-agent-deploy guardrails (PURE).
 *
 * Single source of truth for the hard limits on a single mass deploy:
 *   - ceiling of MAX_AGENTS_PER_DEPLOY agents per deploy,
 *   - a ~$PER_DEPLOY_COST_CAP_USD soft cost cap that forces approval,
 *   - deployed agents are TRANSIENT (auto-retire after task; the deploy
 *     path must NOT create persistent circle_office_agents rows).
 *
 * This module is intentionally dependency-light so it is tsx-loadable for
 * smoke tests — it pulls token pricing from `modelPricing` (also pure) and
 * uses `import type` only for any cross-module shapes.
 *
 * Project decisions honored here:
 *   - ceiling 50 agents / deploy,
 *   - ~$10 per-deploy cost cap (require approval above it),
 *   - approval also required for large fan-outs (> 10 agents) regardless of
 *     the dollar estimate, so a cheap-but-huge deploy still gets a gate.
 */

import { resolveModelRate } from './modelPricing';

/** Hard ceiling on agents launched in a single mass deploy. */
export const MAX_AGENTS_PER_DEPLOY = 50;

/** Soft per-deploy cost cap (USD). Above this, approval is required. */
export const PER_DEPLOY_COST_CAP_USD = 10;

/**
 * Deployed agents are transient: they run their task and auto-retire. The
 * orchestrator must NOT persist office-agent rows for them. Exported so the
 * deploy UI / orchestrator can assert the contract rather than re-deciding.
 */
export const DEPLOYED_AGENTS_ARE_TRANSIENT = true;

/** Approval is forced once a fan-out exceeds this many agents, even if cheap. */
export const APPROVAL_AGENT_COUNT_THRESHOLD = 10;

/**
 * Max deploy agents the orchestrator launches CONCURRENTLY within one fan-out.
 *
 * The plan is capped at MAX_AGENTS_PER_DEPLOY (50) total, but launching all 50
 * at once fires 50 simultaneous model turns and defeats the per-circle
 * delegation concurrency cap (that cap is a check-then-act count read; 50
 * parallel launches all observe the same pre-launch snapshot and pass
 * together). Bounding in-flight launches keeps the burst sane and lets the
 * downstream gate actually throttle. The remaining specs run as earlier ones
 * settle, so the TOTAL launched is still the full (capped) plan — only the
 * instantaneous parallelism is bounded.
 */
export const MAX_CONCURRENT_DEPLOY_LAUNCHES = 5;

export interface DeployCostEstimateOptions {
  /** Model turns per agent (a streamed deploy turn + a couple tool rounds). */
  avgTurnsPerAgent?: number;
  /** Input tokens charged per turn (prompt + grounding + tool results). */
  avgInTokens?: number;
  /** Output tokens charged per turn. */
  avgOutTokens?: number;
}

const DEFAULT_AVG_TURNS_PER_AGENT = 3;
const DEFAULT_AVG_IN_TOKENS = 4000;
const DEFAULT_AVG_OUT_TOKENS = 1500;

/**
 * Clamp a requested agent count into 1..MAX_AGENTS_PER_DEPLOY.
 *
 * Non-finite / NaN / <= 0 requests clamp UP to 1 (you can't deploy zero
 * agents meaningfully); anything over the ceiling clamps DOWN and reports
 * `truncated: true` so the caller can tell the user it was capped.
 */
export function capDeployCount(requested: number): { count: number; truncated: boolean } {
  const raw = Number(requested);
  if (!Number.isFinite(raw) || raw <= 0) {
    // Below the floor is a caller mistake, not a truncation of intent.
    return { count: 1, truncated: false };
  }
  const floored = Math.floor(raw);
  if (floored > MAX_AGENTS_PER_DEPLOY) {
    return { count: MAX_AGENTS_PER_DEPLOY, truncated: true };
  }
  if (floored < 1) return { count: 1, truncated: false };
  return { count: floored, truncated: false };
}

/**
 * Over-estimate the USD cost of running `models.length` agents (one model
 * id per agent). Per Swan's directive, `modelPricing` already bakes a ~25%
 * buffer into its rates and we use full (non-cached) input price for every
 * input token, so this is deliberately conservative.
 *
 * Cost per agent = turns * (inTokens * inRate + outTokens * outRate).
 */
export function estimateDeployCostUsd(
  models: string[],
  opts?: DeployCostEstimateOptions,
): number {
  if (!Array.isArray(models) || models.length === 0) return 0;
  const turns = positive(opts?.avgTurnsPerAgent, DEFAULT_AVG_TURNS_PER_AGENT);
  const inTokens = positive(opts?.avgInTokens, DEFAULT_AVG_IN_TOKENS);
  const outTokens = positive(opts?.avgOutTokens, DEFAULT_AVG_OUT_TOKENS);

  let total = 0;
  for (const model of models) {
    const rate = resolveModelRate(model);
    const perTurn = (inTokens * rate.inPer1M + outTokens * rate.outPer1M) / 1_000_000;
    total += perTurn * turns;
  }
  // Guard against any float dust producing a negative.
  return total > 0 ? total : 0;
}

/**
 * Decide whether a mass deploy needs explicit human approval.
 * Required when the estimate exceeds the dollar cap OR the fan-out is large
 * (> APPROVAL_AGENT_COUNT_THRESHOLD agents), whichever trips first.
 */
export function shouldRequireApproval(input: {
  count: number;
  estimateUsd: number;
}): { required: boolean; reason: string } {
  const count = Number(input?.count) || 0;
  const estimateUsd = Number(input?.estimateUsd) || 0;

  const overCost = estimateUsd > PER_DEPLOY_COST_CAP_USD;
  const overCount = count > APPROVAL_AGENT_COUNT_THRESHOLD;

  if (overCost && overCount) {
    return {
      required: true,
      reason: `Estimated $${estimateUsd.toFixed(2)} exceeds the $${PER_DEPLOY_COST_CAP_USD} per-deploy cap and ${count} agents exceeds the ${APPROVAL_AGENT_COUNT_THRESHOLD}-agent approval threshold.`,
    };
  }
  if (overCost) {
    return {
      required: true,
      reason: `Estimated $${estimateUsd.toFixed(2)} exceeds the $${PER_DEPLOY_COST_CAP_USD} per-deploy cost cap.`,
    };
  }
  if (overCount) {
    return {
      required: true,
      reason: `${count} agents exceeds the ${APPROVAL_AGENT_COUNT_THRESHOLD}-agent approval threshold.`,
    };
  }
  return {
    required: false,
    reason: `Within limits: ${count} agent${count === 1 ? '' : 's'}, ~$${estimateUsd.toFixed(2)} estimated.`,
  };
}

function positive(value: number | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
