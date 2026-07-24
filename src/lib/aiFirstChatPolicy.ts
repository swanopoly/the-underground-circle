/**
 * aiFirstChatPolicy — "use AI models more, activate SwanBot/OpenSwan when needed" (PURE).
 *
 * The product vision: chat should lean on AI MODELS first and stream a plain
 * answer for ordinary turns; only ACTIVATE SwanBot/OpenSwan tools when a turn
 * needs capability, and only SPAWN/DEPLOY agents when the user clearly wants a
 * swarm. Frontier models and BlackSwan/OpenSwan collaborate; a future
 * app-trained model (BlackSwan-v5 at `cswan801/BlackSwan-v5` via
 * `huggingface_endpoint`) slots in as a first-class collaborator without
 * changing this decision shape.
 *
 * This module decides ONLY the orchestration tier for a single chat turn:
 *
 *   - 'plain_model'    — conversational / Q&A. Stream a plain model answer.
 *   - 'escalate_tools' — the turn implies an app/computer/file/browser/web/
 *                        build/deploy/design/wordpress/code/verify action (or
 *                        the user explicitly asked for tools). Stream FIRST,
 *                        then escalate to SwanBot/OpenSwan tools on tool_use.
 *   - 'spawn_agents'   — the user clearly wants to deploy/spawn MULTIPLE agents
 *                        (or explicitly requested agents). Do not stream a plain
 *                        answer first; go straight to the deploy path.
 *
 * Design rules honored:
 *   - stream-by-default, escalate-on-tool-use (so `escalate_tools` keeps
 *     `streamFirst: true`; only `spawn_agents` flips it to false);
 *   - fail toward the cheaper/safer tier on ambiguity (default 'plain_model');
 *   - no secrets, no I/O — this is a deterministic, tsx-loadable pure function.
 *
 * Purity: this file is dependency-light on purpose so smoke tests load it under
 * tsx/esbuild (which cannot load react-native). It pulls the mass-deploy
 * constants from the already-pure `agentDeployPolicy`; the capability-family
 * names and action verbs are grounded (read-only) in
 * `src/lib/openswanToolRuntime.ts` (tool families: browser, desktop, wp, rooms,
 * vault, github, tasks, missions, goals, agent, memory, code, research, skills,
 * verification, plus the `team.deploy_agents` deploy tool) and
 * `src/lib/chatAutomationPlanner.ts` (the action/mutation verb heuristics).
 */

import { APPROVAL_AGENT_COUNT_THRESHOLD } from './agentDeployPolicy';

/** The orchestration tier chosen for a single chat turn. */
export type ChatOrchestrationTier = 'plain_model' | 'escalate_tools' | 'spawn_agents';

/** Signals available about a chat turn at decision time. */
export interface ChatTurnSignals {
  /** The raw user message text for this turn. */
  message: string;
  /** Selected chat mode, if any (e.g. an explicit OpenSwan/build mode). */
  mode?: string;
  /** The model id selected for the turn (frontier, BlackSwan, etc.). */
  modelId?: string;
  /** Whether the turn carries attachments (images, files). */
  hasAttachments?: boolean;
  /** Caller-detected explicit "use tools" request (e.g. a tool quick-action). */
  explicitToolRequest?: boolean;
  /** Caller-detected explicit "deploy/spawn agents" request (e.g. __SPAWN_AGENTS__). */
  explicitAgentRequest?: boolean;
}

/** The orchestration decision for a single chat turn. */
export interface OrchestrationDecision {
  tier: ChatOrchestrationTier;
  /** Short human-readable reason (safe to surface in telemetry, no secrets). */
  reason: string;
  /**
   * Whether to stream a plain model answer first. True for 'plain_model' and
   * 'escalate_tools' (stream, then escalate on tool_use); false for
   * 'spawn_agents' (go straight to the deploy path).
   */
  streamFirst: boolean;
  /**
   * Capability families the turn likely needs, grounded in real OpenSwan tool
   * families. Strings such as 'browser','desktop','wordpress','design','rooms',
   * 'memory','research','code','verify','deploy_agents'. Empty for pure chat.
   */
  suggestedCapabilities: string[];
}

// ── Capability-family detectors ─────────────────────────────────────────────
// Each family maps to a real OpenSwan tool prefix / pipeline. The capability
// STRINGS are the user-facing family names from the task spec; they line up
// with the runtime families (wp -> 'wordpress', verification -> 'verify',
// agent/team.deploy_agents -> 'deploy_agents').

interface CapabilityRule {
  capability: string;
  /** Any match marks the family as needed. */
  test: RegExp;
}

const CAPABILITY_RULES: CapabilityRule[] = [
  // Browser / web automation + research-on-the-web (browser.* family + Browserbase).
  {
    capability: 'browser',
    test: /\b(browser|browse|website|web ?page|web ?site|navigate|url|tab|click|scrape|crawl|fill (?:in|out)|form|submit|shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|stagehand|browserbase)\b/i,
  },
  // Local desktop / app control (desktop.* family). Also catches an
  // open/launch/focus/quit verb applied to a named desktop app (e.g.
  // "open Photoshop") — operating the app is desktop control even though the
  // creative work itself is also flagged as 'design' below.
  {
    capability: 'desktop',
    test: /\b(desktop|my computer|on my (?:mac|machine|pc)|local files?|hard drive|home folder|finder|launch app|open app|focus app|window|clipboard|screenshot|keystroke|shortcut|cad|autocad|solidworks)\b|\b(?:open|launch|focus|quit|close|switch to|bring up)\s+(?:the\s+)?(photoshop|indesign|illustrator|acrobat|excel|word|powerpoint|outlook|finder|chrome|safari|firefox|terminal|vs ?code|figma|sketch|blender)\b/i,
  },
  // WordPress / CMS admin (wp.* family).
  {
    capability: 'wordpress',
    test: /\b(wordpress|wp-admin|wp |dealer ?inspire|cms|publish (?:a |the )?(?:post|page|article)|media library|slide)\b/i,
  },
  // Creative / design AI (Photoshop, InDesign, Firefly, image/layout work).
  {
    capability: 'design',
    test: /\b(photoshop|indesign|illustrator|firefly|adobe|generative fill|generative expand|generate (?:an? )?image|design|logo|banner|poster|mockup|render|export (?:a |an )?(?:png|jpe?g|pdf|svg|psd)|data ?merge|contact sheet|vectori[sz]e|recolou?r|image ?trace|align\s+(?:the\s+|these\s+|those\s+|all\s+|my\s+)?(?:objects?|paths?|layers?|shapes?|elements?|artboards?|anchor\s?points?|selection))\b/i,
  },
  // Project rooms / files / services (rooms.* family).
  {
    capability: 'rooms',
    test: /\b(room|project room|room file|room chat|service|playground)\b/i,
  },
  // Memory + skills (memory.* / save_memory / skills.* families).
  {
    capability: 'memory',
    test: /\b(remember|memory|memorize|note this|save (?:this|that) for later|recall|skill|second brain|memory bank)\b/i,
  },
  // Live research / knowledge search (research.* / knowledge family).
  {
    capability: 'research',
    test: /\b(research|look (?:this )?up|find out|investigate|gather (?:sources|info|information)|search (?:the )?web|web search|deep dive|cite|citation|sources)\b/i,
  },
  // Coding / build (code.* family + build pipelines + GitHub).
  {
    capability: 'code',
    test: /\b(code|coding|implement|refactor|build (?:a |an |the )?(?:app|page|site|website|web app|feature|landing)|compile|repo|repository|pull request|commit|merge|github|deploy(?:ment)?|ci\/cd|landing page)\b/i,
  },
  // Verification / QA / proof (verification family).
  {
    capability: 'verify',
    test: /\b(verify|verification|double-?check|confirm (?:it|this|that) (?:works|is correct)|test (?:that|it|this)|qa|quality assurance|proof|validate)\b/i,
  },
];

// Generic action/mutation verbs that imply the turn wants to DO something on
// some surface even when no specific family matched — grounded in the planner's
// `hasReviewLevelMutationIntent` verb set plus app/file/computer phrasing.
const GENERIC_ACTION_INTENT =
  /\b(open|run|launch|execute|automate|operate|control|use (?:the )?computer|fix|repair|debug|deploy|publish|submit|send|upload|download|export|import|install|create|make|build|generate|edit|update|change|modify|rename|move|copy|delete|remove|overwrite|replace|save|write|fill (?:in|out)|book|reserve|order|checkout|pay|schedule|set up)\b/i;

// Explicit multi-agent / swarm intent. Requires BOTH a deploy/spawn verb AND a
// plural/swarm noun (or an explicit numeric fan-out) so a single "spawn an
// agent" doesn't trip the swarm tier — that stays in the normal tool path.
const DEPLOY_VERB = /\b(deploy|spawn|launch|fan ?out|dispatch|send out|stand up|kick off|swarm)\b/i;
const SWARM_NOUN = /\b(agents|swarm|fleet|team of (?:agents|bots)|bots|workers|multiple agents|several agents|many agents|a (?:bunch|group|squad|pack|wave) of (?:agents|bots))\b/i;
// "deploy 10 agents", "spawn 5 bots" — a number adjacent to agent/bot wording.
const NUMERIC_FANOUT = /\b(\d{1,3})\s*(agents?|bots?|workers?)\b/i;

function detectExplicitSwarm(message: string): { isSwarm: boolean; count: number | null } {
  const numeric = message.match(NUMERIC_FANOUT);
  const count = numeric ? Number(numeric[1]) : null;
  const hasDeployVerb = DEPLOY_VERB.test(message);
  // A numeric fan-out (>1) with a deploy verb is the clearest swarm signal.
  if (hasDeployVerb && count !== null && Number.isFinite(count) && count > 1) {
    return { isSwarm: true, count };
  }
  // Otherwise require a deploy verb AND an explicit plural/swarm noun.
  if (hasDeployVerb && SWARM_NOUN.test(message)) {
    return { isSwarm: true, count };
  }
  return { isSwarm: false, count };
}

function collectSuggestedCapabilities(message: string): string[] {
  const found: string[] = [];
  for (const rule of CAPABILITY_RULES) {
    if (rule.test.test(message) && !found.includes(rule.capability)) {
      found.push(rule.capability);
    }
  }
  return found;
}

// An explicitly-selected non-default chat mode means the user already opted
// into the OpenSwan/build runtime for this turn, so we should escalate even if
// the message text alone reads conversational.
function isExplicitRuntimeMode(mode?: string): boolean {
  if (!mode) return false;
  const m = mode.trim().toLowerCase();
  return m.length > 0 && m !== 'none' && m !== 'chat' && m !== 'plain';
}

/**
 * Decide the orchestration tier for one chat turn.
 *
 * Order of precedence (highest first):
 *   1. Explicit agent/swarm request -> 'spawn_agents' (streamFirst:false).
 *   2. Explicit tool request, app/computer/file/browser/web/build/deploy/
 *      design/wordpress/code/verify action intent, an explicit runtime mode,
 *      or attachments that imply file work -> 'escalate_tools' (streamFirst:true).
 *   3. Everything else -> 'plain_model' (streamFirst:true).
 */
export function decideChatOrchestration(signals: ChatTurnSignals): OrchestrationDecision {
  const message = String(signals?.message ?? '');
  const suggestedCapabilities = collectSuggestedCapabilities(message);

  // ── 1. Spawn agents ───────────────────────────────────────────────────────
  const swarm = detectExplicitSwarm(message);
  if (signals?.explicitAgentRequest || swarm.isSwarm) {
    // Make the deploy capability explicit, and keep any task-relevant families
    // the user named (e.g. "deploy 10 agents to research X" keeps 'research').
    const caps = ['deploy_agents', ...suggestedCapabilities.filter((c) => c !== 'deploy_agents')];
    const reason = signals?.explicitAgentRequest
      ? 'Explicit agent-deploy request — routing to the SwanBot/OpenSwan deploy path.'
      : swarm.count != null
        ? `User asked to deploy ${swarm.count} agents — fan-out beyond the ${APPROVAL_AGENT_COUNT_THRESHOLD}-agent approval line is gated downstream.`
        : 'User asked to deploy/spawn multiple agents — routing to the deploy path.';
    return {
      tier: 'spawn_agents',
      reason,
      streamFirst: false,
      suggestedCapabilities: caps,
    };
  }

  // ── 2. Escalate to tools ──────────────────────────────────────────────────
  const explicitTool = Boolean(signals?.explicitToolRequest);
  const runtimeMode = isExplicitRuntimeMode(signals?.mode);
  const hasFamilyCapability = suggestedCapabilities.length > 0;
  const hasGenericAction = GENERIC_ACTION_INTENT.test(message);
  // Attachments alone don't force tools (you can chat about an image), but an
  // attachment PLUS any action/family signal means the turn likely needs a
  // file/app/design tool, so let the action/family checks above carry it.

  if (explicitTool || runtimeMode || hasFamilyCapability || hasGenericAction) {
    const reason = explicitTool
      ? 'Explicit tool request — stream first, then activate SwanBot/OpenSwan tools on tool_use.'
      : runtimeMode
        ? `Explicit "${String(signals?.mode)}" mode selected — stream first, then escalate to OpenSwan tools.`
        : hasFamilyCapability
          ? `Action implies ${suggestedCapabilities.join(', ')} capability — stream first, then escalate on tool_use.`
          : 'Action intent detected — stream first, then escalate to tools on tool_use.';
    return {
      tier: 'escalate_tools',
      // Stream-by-default still holds: the model streams a plain answer and we
      // only switch to the tool loop when it actually emits tool_use.
      streamFirst: true,
      reason,
      suggestedCapabilities,
    };
  }

  // ── 3. Plain model (default) ──────────────────────────────────────────────
  return {
    tier: 'plain_model',
    reason: 'Conversational / Q&A turn — stream a plain model answer; escalate only if the model calls a tool.',
    streamFirst: true,
    suggestedCapabilities,
  };
}
