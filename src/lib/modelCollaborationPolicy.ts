/**
 * modelCollaborationPolicy — "AI models + SwanBot/OpenSwan work together" (PURE).
 *
 * The product vision is that a chat turn leans on AI MODELS first and streams a
 * plain answer for normal work; when a task needs more, it ACTIVATES
 * SwanBot/OpenSwan tools or deploys agents, and frontier models +
 * BlackSwan/OpenSwan COLLABORATE rather than one silently replacing the other.
 * A future app-trained model (BlackSwan-v5 at `cswan801/BlackSwan-v5`, reachable
 * via the `huggingface_endpoint/` route) slots in as a first-class collaborator
 * in exactly the same shape.
 *
 * This module turns a single chat/tool/agent turn into a concrete *collaboration
 * plan*: which model is primary, which (if any) is the app-grounding voice, which
 * reliable executor drives a tool loop, and a one-line `pattern` describing the
 * arrangement so chat handoff metadata / prompts can show it.
 *
 * It is the single decision point that reconciles two facts the codebase already
 * encodes separately:
 *   1. `blackswanRouting` knows what "is BlackSwan" means and that tool-heavy
 *      BlackSwan work must run on a reliable Claude executor
 *      (`BLACKSWAN_TOOL_EXECUTOR_MODEL_ID`) while BlackSwan stays as grounding
 *      context (see `buildBlackSwanRoutingMetadata` / `resolveOpenSwanToolLoopModel`).
 *   2. `serviceProfileSouls` knows how `auto` resolves to a concrete model.
 *
 * Purity: it imports VALUES only from `blackswanRouting` and `serviceProfileSouls`
 * (both tsx-safe, react-native-free) so the smoke test loads under tsx/esbuild.
 * No supabase, no react-native, no network.
 *
 * Project decisions honored: never expose secrets (this module only ever returns
 * model-id strings + role labels — no keys); fail closed to a concrete Claude id;
 * stream-by-default for normal turns then escalate when a tool/agent turn needs a
 * reliable executor; no Grok/xAI ever appears here.
 */

import {
  BLACKSWAN_TOOL_EXECUTOR_MODEL_ID,
  isBlackSwanModel,
} from './blackswanRouting';
import { resolveModelForSoul } from './serviceProfileSouls';

/**
 * The role a single model plays in a collaborating turn.
 *   - 'primary'   — produces the user-facing answer / drives the turn.
 *   - 'grounding' — injects app-state grounding (BlackSwan / app-trained model)
 *                   without driving a tool loop; its facts are highest priority
 *                   but a reliable executor does the tool calling.
 *   - 'executor'  — runs the tool/function-calling loop reliably.
 *   - 'router'    — chooses which provider/model handles a step (cross-provider).
 *   - 'reviewer'  — second-pass verification of another model's output.
 */
export type CollaborationRole =
  | 'primary'
  | 'grounding'
  | 'executor'
  | 'router'
  | 'reviewer';

/**
 * The concrete plan for one collaborating turn.
 *
 *   - primaryModel      — always a concrete id (never 'auto'); drives the turn.
 *   - groundingModel    — BlackSwan / app-trained id when it should ground the
 *                         turn as context, else null.
 *   - toolExecutorModel — reliable Claude executor for tool-heavy work, else null
 *                         (normal stream-first chat needs no separate executor).
 *   - pattern           — short human-readable description of the arrangement.
 *   - roles             — model id -> role map, so callers can render/telemeter
 *                         "who is doing what" for the turn.
 */
export interface CollaborationPlan {
  primaryModel: string;
  groundingModel: string | null;
  toolExecutorModel: string | null;
  pattern: string;
  roles: Record<string, CollaborationRole>;
}

/** Concrete fail-safe model. Mirrors serviceProfileSouls' DEFAULT_MODEL so a
 *  bad/empty resolution still yields a real, current Claude id rather than
 *  'auto' or a BlackSwan id that might fall back at runtime. */
const SAFE_DEFAULT_MODEL = 'claude-sonnet-4-6';

/** The future app-trained collaborator, addressed via its dedicated endpoint
 *  route. When `appTrainedModelAvailable` is set but the user did not explicitly
 *  pick a BlackSwan id, this is the grounding voice we bring in. Centralized so a
 *  new app-trained checkpoint only changes here. */
const APP_TRAINED_GROUNDING_MODEL_ID = 'huggingface_endpoint/cswan801/BlackSwan-v5';

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * True for the work shapes that benefit from app grounding — anything that
 * touches app state, tools, or agents. A plain 'chat' turn does not force
 * grounding on its own (it streams the model's answer), but the caller can still
 * opt in via `appTrainedModelAvailable`.
 */
function taskWantsAppGrounding(task: PlanInput['task']): boolean {
  return task === 'grounding' || task === 'tools' || task === 'agents';
}

/**
 * True for the work shapes that run a tool/function-calling loop and therefore
 * need a reliable executor. 'chat' and 'grounding' do not.
 */
function taskRunsToolLoop(task: PlanInput['task']): boolean {
  return task === 'tools' || task === 'agents';
}

interface PlanInput {
  /** The user's selected model id, or 'auto'. May be a BlackSwan id. */
  selectedModel: string;
  /** What this turn is for. Drives grounding + executor decisions. */
  task: 'chat' | 'tools' | 'agents' | 'grounding';
  /** When true, the app-trained BlackSwan-v5 collaborator is available to ground
   *  the turn even if the user did not explicitly pick a BlackSwan id. */
  appTrainedModelAvailable?: boolean;
  /** Marketplace providers the team has connected — passed through to the `auto`
   *  resolver so it can bias toward the user's own BYOK keys. */
  connectedProviders: string[];
}

/**
 * Plan how the selected model, BlackSwan/OpenSwan grounding, and a reliable tool
 * executor collaborate for one turn.
 *
 * Decision summary:
 *   1. BlackSwan selected (any form)         -> BlackSwan grounds; for a tool/
 *                                               agent turn a Claude executor runs
 *                                               the loop and is primary, otherwise
 *                                               BlackSwan is primary too.
 *   2. App-trained model available + the turn
 *      wants app grounding, frontier selected -> frontier is primary + executor,
 *                                               app-trained model added as grounding.
 *   3. Frontier model selected               -> it is primary (+ executor on a
 *                                               tool/agent turn); no forced grounding.
 *   4. 'auto'                                 -> resolve via serviceProfileSouls,
 *                                               then re-run this logic on the
 *                                               resolved concrete id.
 * Always fails safe to a concrete Claude id.
 */
export function planModelCollaboration(input: PlanInput): CollaborationPlan {
  const task = input.task;
  const appTrained = input.appTrainedModelAvailable === true;
  const providers = new Set(
    (Array.isArray(input.connectedProviders) ? input.connectedProviders : [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter(Boolean),
  );
  const selected = nonEmpty(input.selectedModel) || 'auto';

  // ── 'auto' resolves first, then the resolved concrete id flows back through
  //    this same function so an auto-picked frontier/BlackSwan id gets the exact
  //    same collaboration treatment as an explicit pick. resolveModelForSoul is
  //    the same ladder swanbot.ts uses (see swanbot.ts -> resolveModelForSoul),
  //    so 'auto' here lands on whatever that turn would have run anyway.
  if (selected === 'auto') {
    const resolved =
      nonEmpty(resolveModelForSoul('sr-engineer', 'auto', undefined, undefined, undefined, undefined, providers))
      || SAFE_DEFAULT_MODEL;
    // Guard against a resolver that somehow echoes 'auto': never recurse on it.
    const concrete = resolved === 'auto' ? SAFE_DEFAULT_MODEL : resolved;
    return planModelCollaboration({
      selectedModel: concrete,
      task,
      appTrainedModelAvailable: appTrained,
      connectedProviders: Array.from(providers),
    });
  }

  const roles: Record<string, CollaborationRole> = {};
  const setRole = (model: string | null, role: CollaborationRole) => {
    const id = nonEmpty(model);
    if (id) roles[id] = role;
  };

  // ── Case 1: BlackSwan / app-trained id is the selected model ────────────────
  // BlackSwan is the app-grounding brand. It must NOT drive a native tool loop
  // (it may fall back); mirror buildBlackSwanRoutingMetadata's split — BlackSwan
  // becomes grounding_context and a reliable Claude executor runs the tools.
  if (isBlackSwanModel(selected)) {
    if (taskRunsToolLoop(task)) {
      const executor = BLACKSWAN_TOOL_EXECUTOR_MODEL_ID || SAFE_DEFAULT_MODEL;
      setRole(executor, 'executor');
      setRole(selected, 'grounding');
      return {
        primaryModel: executor,
        groundingModel: selected,
        toolExecutorModel: executor,
        pattern: `BlackSwan grounds the app context while ${executor} reliably drives the ${task} loop`,
        roles,
      };
    }
    // Plain chat / pure grounding turn: BlackSwan can speak directly. It is both
    // the grounding voice and the primary — no separate executor is forced, so
    // normal turns still stream the model's own answer.
    setRole(selected, 'primary');
    return {
      primaryModel: selected,
      groundingModel: selected,
      toolExecutorModel: null,
      pattern:
        task === 'grounding'
          ? 'BlackSwan provides app-grounded context directly'
          : 'BlackSwan answers directly with app grounding (stream-first)',
      roles,
    };
  }

  // ── Frontier model selected ────────────────────────────────────────────────
  // It is primary. On a tool/agent turn it is also the executor (frontier Claude/
  // OpenAI/etc. have reliable native tool calling, so no swap is needed).
  const primary = selected;
  setRole(primary, 'primary');

  // Optional grounding: bring the app-trained BlackSwan-v5 collaborator in when
  // it's available AND the turn actually wants app grounding. A plain chat turn
  // with no app work does not get forced grounding — keep normal answers clean.
  const wantsGrounding = appTrained && taskWantsAppGrounding(task);
  const grounding = wantsGrounding ? APP_TRAINED_GROUNDING_MODEL_ID : null;
  if (grounding) setRole(grounding, 'grounding');

  if (taskRunsToolLoop(task)) {
    // Frontier model runs its own tools; record it as executor too (a model can
    // hold more than one role across the turn, but roles[] keeps one label per
    // id, so the executor view is reported via toolExecutorModel).
    const plan: CollaborationPlan = {
      primaryModel: primary,
      groundingModel: grounding,
      toolExecutorModel: primary,
      pattern: grounding
        ? `${primary} drives the ${task} loop with BlackSwan-v5 app grounding`
        : `${primary} drives the ${task} loop directly`,
      roles,
    };
    return plan;
  }

  // Plain chat / grounding turn on a frontier model: stream its answer; only add
  // grounding when explicitly available + wanted.
  return {
    primaryModel: primary,
    groundingModel: grounding,
    toolExecutorModel: null,
    pattern: grounding
      ? `${primary} answers with BlackSwan-v5 app grounding (stream-first)`
      : `${primary} answers directly (stream-first)`,
    roles,
  };
}
