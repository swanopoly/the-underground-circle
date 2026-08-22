/**
 * agentDeployPlan — Phase-3 mass-agent-deploy plan builder (PURE).
 *
 * Turns a deploy request (mode + count + model selection) into a concrete,
 * capped list of per-agent specs. This is the deterministic shape the
 * orchestrator consumes; it makes NO network calls and has no react-native
 * imports, so it is tsx-loadable for smoke tests.
 *
 * Modes:
 *   - 'uniform'    — every agent runs the same `model`.
 *   - 'individual' — agent i runs `perAgentModels[i]`, falling back to
 *                    `model` (then the safe default) when the per-agent
 *                    list is short. Specialty roles follow the same exact
 *                    per-agent contract through `perAgentRoles`.
 *   - 'max'        — fan out to MAX_AGENTS_PER_DEPLOY agents on `model`,
 *                    ignoring the requested count (the explicit "give me
 *                    the whole ceiling" mode). Still clamped by policy.
 */

import { capDeployCount, MAX_AGENTS_PER_DEPLOY } from './agentDeployPolicy';

export type AgentDeployMode = 'uniform' | 'individual' | 'max';

export interface AgentDeploySpec {
  index: number;
  model: string;
  role: string | null;
  prompt: string | null;
}

export interface AgentDeployPlan {
  mode: AgentDeployMode;
  specs: AgentDeploySpec[];
  requestedCount: number;
  cappedCount: number;
  truncated: boolean;
}

/** Used when no model is supplied anywhere — keeps the plan non-empty and
 *  honest. `agentDeployModelPolicy.resolveDeployModel` still validates this
 *  before anything launches, so a bad default fails closed downstream. */
const DEFAULT_DEPLOY_MODEL = 'claude-sonnet-4-6';

export function buildAgentDeployPlan(input: {
  mode: AgentDeployMode;
  count: number;
  model?: string;
  perAgentModels?: string[];
  perAgentRoles?: Array<string | null | undefined>;
  role?: string | null;
  prompt?: string | null;
}): AgentDeployPlan {
  const mode: AgentDeployMode = input.mode;
  const fallbackModel = nonEmpty(input.model) || DEFAULT_DEPLOY_MODEL;
  const role = nonEmpty(input.role);
  const prompt = input.prompt ?? null;
  const requestedCount = Number(input.count) || 0;

  // 'max' deliberately overrides the requested count and asks policy for the
  // whole ceiling; capDeployCount still owns the actual clamp.
  const targetCount = mode === 'max' ? MAX_AGENTS_PER_DEPLOY : requestedCount;
  const { count: cappedCount, truncated } = capDeployCount(targetCount);

  const perAgentModels = Array.isArray(input.perAgentModels) ? input.perAgentModels : [];
  const perAgentRoles = Array.isArray(input.perAgentRoles) ? input.perAgentRoles : [];

  const specs: AgentDeploySpec[] = [];
  for (let index = 0; index < cappedCount; index += 1) {
    let model: string;
    if (mode === 'individual') {
      model = nonEmpty(perAgentModels[index]) || fallbackModel;
    } else {
      // 'uniform' and 'max' both run the same model on every agent.
      model = fallbackModel;
    }
    const specRole = mode === 'individual'
      ? nonEmpty(perAgentRoles[index]) || role
      : role;
    specs.push({ index, model, role: specRole, prompt });
  }

  return {
    mode,
    specs,
    // For 'max', surface the policy ceiling as the requested count so the UI
    // reflects what the user actually asked for ("max").
    requestedCount: mode === 'max' ? MAX_AGENTS_PER_DEPLOY : requestedCount,
    cappedCount,
    truncated,
  };
}

function nonEmpty(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
