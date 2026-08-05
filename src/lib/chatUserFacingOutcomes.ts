/**
 * chatUserFacingOutcomes — single owner for translating runtime failures
 * into plain language + one concrete next action (Phase 2a of
 * `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Today errors reach the user as jargon ("ETIMEDOUT", "bridge unreachable",
 * "execution failed") with no way to act. This module sits on top of
 * `agentFailureTaxonomy.classifyAgentFailure` — the existing single source
 * of failure classification — and adds the user-facing layer: what
 * happened, what to do next, and where to do it. Callers that get `null`
 * back (unclassified failure) keep their existing copy, so the translator
 * can only improve wording, never lose information. Raw errors stay
 * available for recovery/debug paths; this is presentation only.
 *
 * One classification lives here rather than in the taxonomy: desktop-bridge
 * reachability failures (the P17 `/apps` probe vocabulary — bridge offline/
 * unreachable/not paired, older bridge build, engine_not_installed). Several
 * of those phrases are invisible to the taxonomy, and all of them deserve a
 * next action that pairs the concrete fix with the `/apps` recheck. The
 * translator receives only failure text (no task/app context), so that
 * mention stays generic (`/apps <app>`) instead of guessing an app name.
 *
 * Pure module (taxonomy is dependency-light) — smoke-testable via tsx
 * (`npm run smoke:chat-user-facing-outcomes`).
 */

import {
  classifyAgentFailure,
  type AgentFailureAssessment,
  type AgentFailureClass,
} from './agentFailureTaxonomy';

// ─── Output model ───────────────────────────────────────────────────────────

/** Where the next action happens, so UIs can deep-link instead of just say. */
export type ChatUserFacingActionTarget =
  | 'marketplace'
  | 'bridge'
  | 'approvals'
  | 'live_view'
  | 'vault'
  | 'retry'
  | 'settings'
  | 'none';

export type ChatUserFacingOutcome = {
  failureClass: AgentFailureClass;
  /** One plain sentence: what happened, no codes or transport nouns. */
  summary: string;
  /** One imperative sentence: the single most useful thing to do next. */
  nextAction: string | null;
  actionTarget: ChatUserFacingActionTarget;
  /** Canonical provider display name when the failure names one. */
  provider: string | null;
  retryable: boolean;
  userActionRequired: boolean;
};

// ─── Provider detection ─────────────────────────────────────────────────────

/**
 * Known provider names → display names. Deliberately a display-only list
 * (NOT a routing surface — `llmProviders.ts` owns routing); safe to trail
 * the catalog because unmatched providers just fall back to generic copy.
 */
const PROVIDER_DISPLAY_PATTERNS: Array<[RegExp, string]> = [
  [/\bopen\s?router\b/i, 'OpenRouter'],
  [/\bopenai\b|\bgpt-\d/i, 'OpenAI'],
  [/\banthropic\b|\bclaude\b/i, 'Anthropic'],
  [/\bhugging\s?_?face\b|\bhuggingface\b/i, 'Hugging Face'],
  [/\bgroq\b/i, 'Groq'],
  [/\bgoogle[\s_]?ai\b|\bgemini\b/i, 'Google AI'],
  [/\bmistral\b/i, 'Mistral AI'],
  [/\bcohere\b/i, 'Cohere'],
  [/\bperplexity\b/i, 'Perplexity'],
  [/\btogether\b/i, 'Together AI'],
  [/\bfireworks\b/i, 'Fireworks AI'],
  [/\bdeepseek\b/i, 'DeepSeek'],
  [/\bz[._-]?ai\b/i, 'z.ai'],
  [/\bminimax\b/i, 'MiniMax'],
  [/\bollama\b/i, 'Ollama'],
  [/\bgithub\s?models\b/i, 'GitHub Models'],
  [/\breplicate\b/i, 'Replicate'],
  [/\bbrave\b/i, 'Brave Search'],
  [/\bbrowserbase\b/i, 'Browserbase'],
  [/\bstagehand\b/i, 'Stagehand'],
];

/** Best-effort provider display name mentioned in an error blob, or null. */
export function detectProviderName(text: string): string | null {
  const value = String(text || '');
  for (const [pattern, display] of PROVIDER_DISPLAY_PATTERNS) {
    if (pattern.test(value)) return display;
  }
  return null;
}

// ─── Desktop-bridge reachability detection ──────────────────────────────────

/**
 * Bridge-reachability failure kinds — mirrors the P17 `appReachability`
 * status vocabulary so the `/apps` reachability card and this translator
 * speak the same language.
 */
export type BridgeReachabilityFailureKind =
  | 'bridge_offline'
  | 'bridge_outdated'
  | 'engine_not_installed';

/**
 * Desktop-bridge reachability phrases → kind. First match wins, so the
 * specific outdated-build/engine phrases sit above the generic offline nets.
 * These phrases come from the reachability system's headlines/fixes and the
 * bridge probes; the taxonomy alone leaves several of them unclassified
 * ("bridge is running an older build", "engine_not_installed").
 */
const BRIDGE_REACHABILITY_PATTERNS: Array<[RegExp, BridgeReachabilityFailureKind]> = [
  [/\bbridge is running an older build\b/i, 'bridge_outdated'],
  [/\bengine_not_installed\b/i, 'engine_not_installed'],
  [/\bdesktop bridge offline\b/i, 'bridge_offline'],
  [/\bbridge (?:offline|unreachable|not paired)\b/i, 'bridge_offline'],
];

/** Best-effort bridge-reachability kind mentioned in an error blob, or null. */
export function detectBridgeReachabilityKind(text: string): BridgeReachabilityFailureKind | null {
  const value = String(text || '');
  for (const [pattern, kind] of BRIDGE_REACHABILITY_PATTERNS) {
    if (pattern.test(value)) return kind;
  }
  return null;
}

// ─── Copy templates per failure class ───────────────────────────────────────

type OutcomeTemplate = {
  summary: string | ((provider: string | null) => string);
  nextAction: string | ((provider: string | null) => string);
  actionTarget: ChatUserFacingActionTarget;
};

const providerLabel = (provider: string | null) => provider ?? 'the model provider';

const TEMPLATES: Partial<Record<AgentFailureClass, OutcomeTemplate>> = {
  bridge_offline: {
    summary: 'The local bridge that runs desktop/browser actions is not reachable.',
    nextAction: 'Start it on this machine (`npm run bridge`), then retry the task.',
    actionTarget: 'bridge',
  },
  desktop_bridge_offline: {
    summary: 'The desktop bridge on this machine is offline, so local app actions cannot run.',
    nextAction: 'Start the bridge (`npm run bridge`) and retry — or ask me to do this in the cloud browser instead.',
    actionTarget: 'bridge',
  },
  browser_bridge_offline: {
    summary: 'The local browser bridge is offline, so tab/page actions cannot run.',
    nextAction: 'Start the bridge (`npm run bridge`) and retry — or ask me to use the cloud browser instead.',
    actionTarget: 'bridge',
  },
  terminal_bridge_offline: {
    summary: 'The terminal bridge is offline, so local commands cannot run.',
    nextAction: 'Start the bridge (`npm run bridge`), then retry.',
    actionTarget: 'bridge',
  },
  bridge_endpoint_missing: {
    summary: 'The bridge is running but does not support this action yet.',
    nextAction: 'Update the bridge to the latest version, then retry.',
    actionTarget: 'bridge',
  },
  missing_user_key: {
    summary: (provider) => `${providerLabel(provider)} is not connected — there is no API key for it.`,
    nextAction: (provider) => `Connect ${providerLabel(provider)} in Marketplace → Providers, then resend this request.`,
    actionTarget: 'marketplace',
  },
  provider_unavailable: {
    summary: (provider) => `${providerLabel(provider)} failed to answer just now.`,
    nextAction: 'Retry — if it keeps failing, switch to another model in the picker.',
    actionTarget: 'retry',
  },
  provider_rate_limited: {
    summary: (provider) => `${providerLabel(provider)} rate-limited this request (too many calls or quota reached).`,
    nextAction: 'Wait a minute and retry, or switch to another provider in Marketplace.',
    actionTarget: 'marketplace',
  },
  model_tool_unsupported: {
    summary: 'The selected model cannot run the tools this task needs.',
    nextAction: 'Pick a tool-capable model (Claude Sonnet works) and resend.',
    actionTarget: 'settings',
  },
  budget_exceeded: {
    summary: "This run stopped at the circle's spend cap.",
    nextAction: 'Raise the cap (or approve the higher budget) and I will resume from where it stopped.',
    actionTarget: 'approvals',
  },
  auth_required: {
    summary: 'The target site/app wants you to sign in before this can continue.',
    nextAction: 'Log in via the live view, then tell me to resume.',
    actionTarget: 'live_view',
  },
  auth_expired: {
    summary: 'The saved sign-in for the target site/app has expired.',
    nextAction: 'Log in again via the live view, then tell me to resume.',
    actionTarget: 'live_view',
  },
  token_rejected: {
    summary: 'The connection token was rejected, so the request never ran.',
    nextAction: 'Reconnect the integration in Marketplace, then retry.',
    actionTarget: 'marketplace',
  },
  mfa_required: {
    summary: 'The site is asking for a verification code only you can provide.',
    nextAction: 'Enter the code in the live view, then tell me to resume.',
    actionTarget: 'live_view',
  },
  otp_required: {
    summary: 'The site is asking for a one-time passcode only you can provide.',
    nextAction: 'Enter the code in the live view, then tell me to resume.',
    actionTarget: 'live_view',
  },
  human_verification_required: {
    summary: 'The site is showing a human check (captcha or similar) that I will not bypass.',
    nextAction: 'Complete the check in the live view, then tell me to resume.',
    actionTarget: 'live_view',
  },
  vault_grant_missing: {
    summary: 'This task needs a credential you have not granted for this run.',
    nextAction: 'Approve the credential grant when prompted (or add it in the vault), then retry.',
    actionTarget: 'vault',
  },
  missing_permission: {
    summary: 'A permission needed for this action has not been granted.',
    nextAction: 'Grant the requested permission, then retry.',
    actionTarget: 'settings',
  },
  permission_denied: {
    summary: 'The system refused this action — the account/machine lacks permission for it.',
    nextAction: 'Grant the permission (or pick a target you own), then retry.',
    actionTarget: 'settings',
  },
  origin_not_allowed: {
    summary: 'That site/app is outside the allowed list for automation.',
    nextAction: 'Add it to the allowed origins in settings, then retry.',
    actionTarget: 'settings',
  },
  path_not_allowed: {
    summary: 'That file path is outside the folders automation is allowed to touch.',
    nextAction: 'Move the file into an allowed folder or widen the allowed paths in settings.',
    actionTarget: 'settings',
  },
  publish_approval_required: {
    summary: 'Publishing is held for an approval first.',
    nextAction: 'Approve it in the approvals banner (or Office), and it will continue.',
    actionTarget: 'approvals',
  },
  selector_not_found: {
    summary: 'The page/app changed and the element I was aiming for is gone.',
    nextAction: "Say 'retry' — I will re-observe the screen fresh before acting again.",
    actionTarget: 'retry',
  },
  uncertain_ui_target: {
    summary: 'The screen did not match what I expected, so I stopped instead of guessing.',
    nextAction: "Say 'retry' for a fresh look, or take over in the live view and tell me when to continue.",
    actionTarget: 'retry',
  },
  a11y_tree_unavailable: {
    summary: 'I could not read the app window to find the next control.',
    nextAction: 'Bring the app to the foreground (not minimized), then retry.',
    actionTarget: 'retry',
  },
  screenshot_unavailable: {
    summary: 'I could not capture the screen to verify the state.',
    nextAction: 'Check screen-recording permission for the bridge, then retry.',
    actionTarget: 'bridge',
  },
  network_error: {
    summary: 'A network hop dropped mid-request.',
    nextAction: 'Check connectivity and retry — nothing was changed.',
    actionTarget: 'retry',
  },
  cors_preflight_blocked: {
    summary: 'The browser blocked the request before it reached the service.',
    nextAction: 'Retry once; if it persists, the bridge/proxy needs a restart (`npm run bridge`).',
    actionTarget: 'bridge',
  },
  server_error: {
    summary: 'The service errored on its side mid-request.',
    nextAction: 'Retry — if it keeps failing, it is on their end, not yours.',
    actionTarget: 'retry',
  },
  timeout: {
    summary: 'It ran out of time before finishing.',
    nextAction: "Say 'retry' to continue from the last checkpoint, or narrow the task.",
    actionTarget: 'retry',
  },
  no_progress_loop: {
    summary: 'It stopped because the last few steps were not making progress.',
    nextAction: 'Take over in the live view, or rephrase the step it was stuck on and retry.',
    actionTarget: 'live_view',
  },
  model_refusal: {
    summary: 'The model declined this request as written.',
    nextAction: 'Rephrase or narrow the task and resend.',
    actionTarget: 'none',
  },
  cli_missing: {
    summary: 'A required tool is not installed on this machine.',
    nextAction: 'Install it (the recovery notes name the exact tool), then retry.',
    actionTarget: 'bridge',
  },
  file_not_found: {
    summary: 'That file or path was not found.',
    nextAction: 'Check the name/location and resend with the corrected path.',
    actionTarget: 'none',
  },
};

/**
 * Copy for the bridge-reachability classification: the concrete fix (start/
 * restart the bridge, install the engine) PLUS the `/apps` recheck. The
 * translator only sees failure text, so `/apps <app>` stays a generic
 * placeholder — the `/apps` card itself resolves the real app. failureClass
 * reuses the closest taxonomy class so downstream consumers keep working.
 */
const BRIDGE_REACHABILITY_TEMPLATES: Record<
  BridgeReachabilityFailureKind,
  { failureClass: AgentFailureClass; summary: string; nextAction: string }
> = {
  bridge_offline: {
    failureClass: 'desktop_bridge_offline',
    summary: 'The desktop bridge on this machine is offline, so chat cannot reach or drive desktop apps.',
    nextAction: 'Start the bridge (`npm run bridge`), then run `/apps <app>` to confirm it is reachable and retry.',
  },
  bridge_outdated: {
    failureClass: 'bridge_endpoint_missing',
    summary: 'The desktop bridge is running an older build that is missing tools this task needs.',
    nextAction: 'Restart the bridge (`npm run bridge`) to pick up the new tools, then run `/apps <app>` to re-check.',
  },
  engine_not_installed: {
    failureClass: 'cli_missing',
    summary: 'The engine this app task runs through is not installed on this machine.',
    nextAction: 'Install the missing engine — run `/apps <app>` for the exact install hint — then retry.',
  },
};

// ─── Translation ────────────────────────────────────────────────────────────

function renderTemplate(
  value: string | ((provider: string | null) => string),
  provider: string | null,
): string {
  return typeof value === 'function' ? value(provider) : value;
}

/**
 * Translate a raw failure (message, Error, tool result blob) into plain
 * language + a next action. Returns null when the taxonomy cannot classify
 * it — callers keep their existing message in that case, so this can only
 * improve copy, never eat detail.
 */
export function translateChatFailure(
  input: unknown,
  ctx: { assessment?: AgentFailureAssessment } = {},
): ChatUserFacingOutcome | null {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');

  // Desktop-bridge reachability failures win first: the taxonomy misses
  // several of these phrases entirely, and all of them get the fix + /apps
  // recheck copy. Bridge work is on this machine → always the user's move.
  const bridgeKind = detectBridgeReachabilityKind(text);
  if (bridgeKind) {
    const bridgeTemplate = BRIDGE_REACHABILITY_TEMPLATES[bridgeKind];
    return {
      failureClass: bridgeTemplate.failureClass,
      summary: bridgeTemplate.summary,
      nextAction: bridgeTemplate.nextAction,
      actionTarget: 'bridge',
      provider: detectProviderName(text),
      retryable: true,
      userActionRequired: true,
    };
  }

  const assessment = ctx.assessment ?? classifyAgentFailure(input);
  if (!assessment || assessment.failureClass === 'unknown') return null;
  const template = TEMPLATES[assessment.failureClass];
  if (!template) return null;
  const provider = detectProviderName(text);
  return {
    failureClass: assessment.failureClass,
    summary: renderTemplate(template.summary, provider),
    nextAction: renderTemplate(template.nextAction, provider),
    actionTarget: template.actionTarget,
    provider,
    retryable: assessment.retryable,
    userActionRequired: assessment.userActionRequired,
  };
}

/** "summary Next: action" as a single chat-ready string. */
export function formatChatUserFacingOutcome(
  outcome: ChatUserFacingOutcome,
  opts: { includeNext?: boolean } = {},
): string {
  const includeNext = opts.includeNext ?? true;
  if (!includeNext || !outcome.nextAction) return outcome.summary;
  return `${outcome.summary}\n**Next:** ${outcome.nextAction}`;
}

/**
 * Drop-in policy for computer-use error display (replaces the old
 * strip-jargon-or-generic fallback in `useComputerUseTask`):
 *   1. cancellations pass through untouched,
 *   2. classified failures become summary + next action,
 *   3. unclassified jargon becomes the safe generic line,
 *   4. unclassified plain text passes through (it was already readable).
 */
export function translateComputerUseErrorMessage(message: string | null | undefined): string {
  const text = String(message || '').trim();
  if (!text) return 'Computer Use could not finish. Technical details were saved for recovery.';
  if (/^cancel/i.test(text)) return text;
  const translated = translateChatFailure(text);
  if (translated) return formatChatUserFacingOutcome(translated);
  if (/\b(?:HTTP\s+\d{3}|supabase|edge function|fetch failed|Failed to fetch|NetworkError|TypeError|ECONN|ETIMEDOUT|EADDR|JWT|Bearer|postgres|PostgREST|stack|functions\/v1|computer-use-agent|Browserbase.*(?:error|failed)|Anthropic.*(?:error|failed))\b/i.test(text)) {
    return 'Computer Use could not finish. Technical details were saved for recovery.';
  }
  return text;
}

/**
 * Provider blocker for the attention strip (`chatAttentionQueue`
 * `providerBlockers` input): non-null only when the failure is a
 * fix-it-in-Marketplace problem, so the strip never nags about transient
 * provider hiccups.
 */
export function providerBlockerFromFailure(
  input: unknown,
): { provider: string; reason: string } | null {
  const translated = translateChatFailure(input);
  if (!translated) return null;
  if (translated.actionTarget !== 'marketplace') return null;
  return {
    provider: translated.provider ?? 'Provider',
    reason: `${translated.summary} ${translated.nextAction ?? ''}`.trim(),
  };
}
