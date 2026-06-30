/**
 * agentDeployOrchestrator — Phase-3 mass-agent-deploy glue (IMPURE shell,
 * PURE-testable core).
 *
 * Takes a capped AgentDeployPlan and actually launches the agents. This is
 * the ONLY impure layer in the deploy stack. It is NOT wired into any
 * model-callable tool or ChatTab dispatch yet (runtime-proof gate per the
 * Phase-3 plan) and ships safe-dormant: nothing calls `deployAgents` until a
 * later, separately-flagged wiring step.
 *
 * Channel selection:
 *   - WEB (default, Netlify-safe): each spec runs via
 *     `subagentRegistry.delegateToSubagent`, so the deployed turn goes
 *     through the in-app OpenSwan -> swanbot-ai / llm-proxy path (v1). That
 *     path takes an EXPLICIT `model` per turn, so the deployed agent runs the
 *     per-agent model resolved upstream — it can NOT fall through to
 *     `swanbot-v2-ai`'s `claude-haiku` default (a different edge fn we never
 *     touch here). The delegation gate (`canDelegate`, enforced inside
 *     `delegateToSubagent`) still applies its depth / concurrency /
 *     daily-spend caps on top of our per-deploy cost cap.
 *   - BRIDGE (fallback ONLY): the local Claude Code CLI bridge
 *     (`agentSpawner.spawnAgents`) is used only when a bridge-availability
 *     check passes. Models were already fail-closed to claude-* for the
 *     bridge channel upstream in `resolveDeployModel`.
 *
 * Transient contract: deployed agents auto-retire after their task. We do
 * NOT call `circleOffice.publishAgentToCircle` (which persists a
 * circle_office_agents row) — that would violate
 * DEPLOYED_AGENTS_ARE_TRANSIENT. `delegateToSubagent` only creates a child
 * `agent_runs` row (the Run Ledger), which finalizes itself; no persistent
 * roster agent is created.
 *
 * Testability / smoke-loadability: the heavy runtime deps (subagentRegistry,
 * agentSpawner) are TYPE-ONLY imports here, and the three impure downstream
 * calls (delegate, bridge spawn, bridge-availability) are INJECTABLE via an
 * optional second `deps` argument. When a dep is NOT injected it is lazily
 * `import()`-ed at call time, so the module's import graph never pulls in
 * react-native / supabase at load time. That lets the orchestrator smoke
 * (`scripts/agent-deploy-orchestrator-smoketest.ts`) import `deployAgents`
 * under tsx and exercise the full fan-out / capping / per-agent-model /
 * partial-failure / transient / bridge-gating LOGIC with mocks, while
 * production callers using `deployAgents(input)` get the real impls unchanged.
 */

import type { AgentDeployPlan, AgentDeploySpec } from './agentDeployPlan';
import { DEPLOYED_AGENTS_ARE_TRANSIENT, MAX_AGENTS_PER_DEPLOY } from './agentDeployPolicy';
import {
  getSubagentCapability,
  listSubagentCapabilities,
  type SubagentCapabilityProfile,
  type SubagentRole,
} from './subagentCapabilities';
// Type-only: importing the VALUES from these modules would drag react-native /
// supabase into the load graph and break tsx smoke loadability. The real
// implementations are pulled in lazily (see resolveDeps) only when not injected.
import type { DelegationResult, SubagentProfile } from './subagentRegistry';
import type { RunSurface } from './agentRunSystem';
import type { SpawnResult, SpawnTask } from './agentSpawner';

export interface DeployAgentsResult {
  deployed: number;
  failed: number;
  channel: 'web' | 'bridge' | 'none';
  items: Array<{ index: number; ok: boolean; error?: string }>;
}

/**
 * Injectable impure dependencies. Every field is optional; when omitted the
 * real implementation is lazily imported, so production callers use
 * `deployAgents(input)` exactly as before. The smoke passes mocks for full
 * unit coverage of the launch logic without touching the network / supabase /
 * a bridge.
 */
export interface DeployAgentsDeps {
  /** Web channel: route one deploy spec through the in-app OpenSwan path. */
  delegate?: (opts: {
    circleId: string;
    userId: string;
    surface: RunSurface;
    message: string;
    subagent: SubagentProfile;
    model?: string;
  }) => Promise<DelegationResult>;
  /** Bridge channel (fallback): launch detached CLI sessions. */
  spawn?: (opts: { tasks: SpawnTask[] }) => Promise<SpawnResult>;
  /** Bridge gate: only fall back to the bridge when this resolves true. */
  bridgeAvailable?: () => Promise<boolean>;
}

type ResolvedDeps = Required<DeployAgentsDeps>;

/** Lazily resolve the real impls for any dep the caller did not inject. The
 *  dynamic imports are what keep this module's static graph free of
 *  react-native / supabase, so the smoke can load `deployAgents` under tsx. */
async function resolveDeps(deps: DeployAgentsDeps): Promise<ResolvedDeps> {
  const delegate = deps.delegate
    ?? (await import('./subagentRegistry')).delegateToSubagent;
  const spawnerNeeded = !deps.spawn || !deps.bridgeAvailable;
  const spawner = spawnerNeeded ? await import('./agentSpawner') : null;
  const spawn = deps.spawn ?? spawner!.spawnAgents;
  const bridgeAvailable = deps.bridgeAvailable ?? spawner!.isBridgeAvailable;
  return { delegate, spawn, bridgeAvailable };
}

/** Fallback role/profile when a spec carries no (or an unknown) role. The
 *  coder profile is the most generic "do the task" specialist. */
const DEFAULT_DEPLOY_ROLE: SubagentRole = 'coder';

export async function deployAgents(
  input: {
    circleId: string;
    userId: string;
    plan: AgentDeployPlan;
    connectedProviders: string[];
  },
  deps: DeployAgentsDeps = {},
): Promise<DeployAgentsResult> {
  const specs = input.plan?.specs || [];
  if (specs.length === 0) {
    return { deployed: 0, failed: 0, channel: 'none', items: [] };
  }

  // Defensive: assert the transient contract holds. If a future edit flips
  // this constant we want the deploy path to be obviously wrong, not quietly
  // persisting office rows.
  if (!DEPLOYED_AGENTS_ARE_TRANSIENT) {
    return {
      deployed: 0,
      failed: specs.length,
      channel: 'none',
      items: specs.map((spec) => ({
        index: spec.index,
        ok: false,
        error: 'Deploy aborted: transient-agent contract is disabled.',
      })),
    };
  }

  // Defensive: never fan out past the policy ceiling even if a hand-built
  // plan slipped through with too many specs (buildAgentDeployPlan already
  // caps, but the orchestrator is the last gate before launch).
  const launchSpecs = specs.length > MAX_AGENTS_PER_DEPLOY
    ? specs.slice(0, MAX_AGENTS_PER_DEPLOY)
    : specs;

  const resolved = await resolveDeps(deps);

  // WEB channel is the default and works on Netlify. Run each spec through
  // the in-app delegation path so deployed turns use OpenSwan -> swanbot-ai.
  const webResult = await deployViaWeb(input, launchSpecs, resolved);
  if (webResult.deployed > 0) {
    return webResult;
  }

  // Web produced zero successes — fall back to the bridge ONLY when it is
  // actually reachable.
  if (await canFallBackToBridge(resolved.bridgeAvailable)) {
    return deployViaBridge(launchSpecs, resolved.spawn);
  }

  return webResult;
}

// ─── WEB channel ─────────────────────────────────────────────────────────────

async function deployViaWeb(
  input: { circleId: string; userId: string; connectedProviders: string[] },
  specs: AgentDeploySpec[],
  deps: ResolvedDeps,
): Promise<DeployAgentsResult> {
  const items: DeployAgentsResult['items'] = [];

  const settled = await Promise.allSettled(
    specs.map((spec) =>
      // delegateToSubagent enforces the delegation gate (depth / concurrency /
      // daily-spend) internally and creates a child run that auto-completes —
      // no persistent office-agent row is created, so the agent is transient.
      //
      // Each turn carries an EXPLICIT per-agent `model` (resolved upstream by
      // agentDeployModelPolicy.resolveDeployModel), so the deployed agent runs
      // exactly that model. This is the v2-Haiku-fallback guard: the explicit
      // model means the v1 child loop's own 'claude-haiku-4-5' default never
      // fires, and we never reach swanbot-v2-ai's `claude-haiku` default at
      // all because this path uses swanbot-ai (v1).
      //
      // Mass deploy is a ROOT fan-out: we intentionally pass NO parentRunId so
      // each spec is a depth-1 root delegation rather than chaining off some
      // caller run (which would risk tripping the depth cap immediately). The
      // gate's concurrency/spend caps still apply per the circle.
      deps.delegate({
        circleId: input.circleId,
        userId: input.userId,
        surface: 'main_chat',
        message: spec.prompt || `Deployed agent ${spec.index + 1} task.`,
        subagent: resolveSubagentProfile(spec.role),
        model: spec.model,
      }),
    ),
  );

  let deployed = 0;
  let failed = 0;
  for (let i = 0; i < settled.length; i += 1) {
    const spec = specs[i];
    const entry = settled[i];
    if (entry.status === 'fulfilled') {
      // A gate rejection comes back as a fulfilled DelegationResult carrying
      // `gateRejection` (not a throw) — treat that as a failed launch but let
      // the rest of the fan-out proceed (partial-failure aggregation).
      const rejected = entry.value?.gateRejection;
      if (rejected) {
        failed += 1;
        items.push({ index: spec.index, ok: false, error: gateRejectionMessage(rejected) });
      } else {
        deployed += 1;
        items.push({ index: spec.index, ok: true });
      }
    } else {
      failed += 1;
      items.push({
        index: spec.index,
        ok: false,
        error: entry.reason?.message || String(entry.reason || 'delegation failed'),
      });
    }
  }

  return { deployed, failed, channel: 'web', items };
}

// ─── BRIDGE channel (fallback) ────────────────────────────────────────────────

async function deployViaBridge(
  specs: AgentDeploySpec[],
  spawn: ResolvedDeps['spawn'],
): Promise<DeployAgentsResult> {
  // Map each deploy spec to a bridge spawn task. Models were already
  // fail-closed to claude-* upstream for the bridge channel, so the explicit
  // per-agent model rides through to the CLI session here too.
  const tasks: SpawnTask[] = specs.map((spec) => ({
    task: spec.prompt || `Deployed agent ${spec.index + 1} task.`,
    model: spec.model,
  }));

  // The bridge is the FALLBACK, not the primary deploy path. spawnAgents
  // launches detached CLI sessions; the bridge owns reaping/auto-retiring
  // those sessions, so nothing persistent is created here either — the
  // transient contract holds on this channel as well.
  const result = await spawn({ tasks });

  const perTask = Array.isArray(result.results) ? result.results : [];
  const items: DeployAgentsResult['items'] = specs.map((spec, i) => {
    const r = perTask[i];
    if (!r) {
      return { index: spec.index, ok: false, error: 'No spawn result returned.' };
    }
    return { index: spec.index, ok: !!r.ok, error: r.ok ? undefined : r.error || result.message };
  });

  const deployed = items.filter((item) => item.ok).length;
  return { deployed, failed: items.length - deployed, channel: 'bridge', items };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pure copy of subagentRegistry.capabilityToProfile — adapts a (tsx-loadable)
 *  capability profile into the SubagentProfile shape delegateToSubagent wants,
 *  without importing the heavy registry module. */
function capabilityToProfile(capability: SubagentCapabilityProfile): SubagentProfile {
  return {
    role: capability.role,
    displayName: capability.displayName,
    description: capability.description,
    systemPrompt: capability.systemPrompt,
    modelPreference: capability.modelPreference,
    triggerPatterns: capability.triggerPatterns,
    icon: capability.icon,
    color: capability.color,
    spiritId: capability.spiritId,
    skillBundleId: capability.skillBundleId,
    skills: capability.skills,
    allowedTools: capability.allowedTools,
    preferredArtifacts: capability.preferredArtifacts,
    preferredVerification: capability.preferredVerification,
    preferredTaskKinds: capability.preferredTaskKinds,
    riskTier: capability.riskTier,
    evidencePosture: capability.evidencePosture,
    communicationDensity: capability.communicationDensity,
  };
}

/** Resolve a deploy spec's role string to a concrete SubagentProfile from the
 *  capability catalog, defaulting to the generic coder when the role is
 *  null/unknown. Sourced from the pure `subagentCapabilities` catalog (the
 *  same source subagentRegistry.SUBAGENTS is built from) so this stays
 *  tsx-loadable. */
function resolveSubagentProfile(role: string | null): SubagentProfile {
  const match = role ? getSubagentCapability(role as SubagentRole) : null;
  if (match) return capabilityToProfile(match);
  const fallback = getSubagentCapability(DEFAULT_DEPLOY_ROLE);
  if (fallback) return capabilityToProfile(fallback);
  // The catalog is always non-empty; the first profile is a safe last resort
  // if even 'coder' is somehow absent.
  return capabilityToProfile(listSubagentCapabilities()[0]);
}

function gateRejectionMessage(rejection: DelegationResult['gateRejection']): string {
  if (!rejection) return 'Delegation blocked by gate.';
  return `Delegation blocked (${rejection.reason}): ${rejection.detail || ''}`.trim();
}

/** Best-effort "should we even try the bridge" pre-check. Kept tiny; any
 *  throw means "not available" so we never fall back into an unreachable
 *  bridge. */
async function canFallBackToBridge(
  bridgeAvailable: ResolvedDeps['bridgeAvailable'],
): Promise<boolean> {
  try {
    return await bridgeAvailable();
  } catch {
    return false;
  }
}
