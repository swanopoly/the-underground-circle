import type { ExecutionSurface } from './scenarioPolicies';

export type AgentFailureClass =
  | 'human_verification_required'
  | 'mfa_required'
  | 'otp_required'
  | 'bridge_offline'
  | 'browser_bridge_offline'
  | 'browser_dialog_blocked'
  | 'desktop_bridge_offline'
  | 'bridge_endpoint_missing'
  | 'cors_preflight_blocked'
  | 'token_rejected'
  | 'missing_permission'
  | 'a11y_tree_unavailable'
  | 'screenshot_unavailable'
  | 'vault_grant_missing'
  | 'origin_not_allowed'
  | 'secret_redaction_required'
  | 'missing_user_key'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'model_tool_unsupported'
  | 'budget_exceeded'
  | 'selector_not_found'
  | 'uncertain_ui_target'
  | 'auth_required'
  | 'auth_expired'
  | 'publish_approval_required'
  | 'terminal_bridge_offline'
  | 'cli_missing'
  | 'permission_denied'
  | 'agent_session_failed'
  | 'file_not_found'
  | 'path_not_allowed'
  | 'network_error'
  | 'server_error'
  | 'constraint_violation'
  | 'duplicate_event'
  | 'cron_still_running'
  | 'usage_source_unknown'
  | 'no_progress_loop'
  | 'timeout'
  | 'model_refusal'
  | 'model_identity_leak'
  | 'missing_context'
  | 'unknown';

export type AgentFailureSeverity = 'info' | 'warning' | 'error' | 'critical';

export type AgentFailureAssessment = {
  failureClass: AgentFailureClass;
  severity: AgentFailureSeverity;
  surface: ExecutionSurface | 'unknown';
  retryable: boolean;
  userActionRequired: boolean;
  recommendedRecovery: string;
  signals: string[];
};

type FailureRule = {
  failureClass: AgentFailureClass;
  severity: AgentFailureSeverity;
  surface: AgentFailureAssessment['surface'];
  retryable: boolean;
  userActionRequired: boolean;
  recommendedRecovery: string;
  patterns: RegExp[];
};

const RULES: FailureRule[] = [
  {
    failureClass: 'human_verification_required',
    severity: 'warning',
    surface: 'human_takeover',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Pause automation and ask the human to complete the CAPTCHA or bot verification in the live browser.',
    patterns: [/\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|cloudflare security check)\b/i],
  },
  {
    failureClass: 'mfa_required',
    severity: 'warning',
    surface: 'human_takeover',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Pause and ask the user to complete MFA before resuming.',
    patterns: [/\b(mfa|2fa|two[- ]factor|verification code|authenticator|security code)\b/i],
  },
  {
    failureClass: 'otp_required',
    severity: 'warning',
    surface: 'human_takeover',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Pause and ask the user to enter the one-time password directly.',
    patterns: [/\b(otp|one[- ]time password|one time code)\b/i],
  },
  {
    failureClass: 'cors_preflight_blocked',
    severity: 'error',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Update the local bridge CORS allow-headers to include the requested desktop token header, then retry the health probe.',
    // Must be CORS-SPECIFIC. The bare word "preflight" collides with the
    // computer-app readiness preflight ("Photoshop … preflight: partial. 4
    // warnings"), which made every failed design-app task get mislabeled
    // "CORS blocked → restart the bridge" — wrong advice when CORS is fine.
    patterns: [/\bcors\b/i, /\bAccess-Control-Allow-(?:Headers|Origin)\b/i, /\bx-uc-desktop-token\b/i, /\b(?:cors|access-control)[\s-]*preflight\b/i, /\bpreflight\b[^.\n]*\b(?:cors|header|origin|access-control|blocked by)\b/i],
  },
  {
    failureClass: 'bridge_endpoint_missing',
    severity: 'error',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'The app and local bridge are on mismatched endpoint versions; upgrade/restart the bridge or call the advertised health endpoint.',
    patterns: [/\b404\b.*\b(desktop|bridge|browser_tabs|endpoint)\b/i, /\bUnknown \/desktop endpoint\b/i, /\bnot found\b.*\b(browser_tabs|desktop\/browser_tabs)\b/i],
  },
  {
    failureClass: 'desktop_bridge_offline',
    severity: 'error',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Start or reconnect the local desktop bridge, then retry the desktop health check.',
    patterns: [/\bdesktop bridge\b.*\b(offline|not connected|not running|failed to connect|connection refused)\b/i, /\blocal bridge\b.*\b(offline|not connected|not running)\b/i],
  },
  {
    failureClass: 'browser_bridge_offline',
    severity: 'error',
    surface: 'browser_semantic',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Start or reconnect the browser bridge/session and retry with a fresh page state.',
    patterns: [
      /\bbrowser_bridge_offline\b/i,
      /\bbrowser bridge\b.*\b(offline|not connected|not running|failed to connect|connection refused)\b/i,
      /\bbrowser session\b.*\b(404|reset|expired|missing)\b/i,
    ],
  },
  {
    failureClass: 'browser_dialog_blocked',
    severity: 'warning',
    surface: 'browser_semantic',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Read the browser popup text/buttons, apply the guarded modal advisor, and continue only for a safe acknowledgement or requested-output overwrite.',
    patterns: [
      /\bbrowser_dialog_blocked\b/i,
      /\bbrowser (?:dialog|popup)\b.*\b(needs a decision|blocked|unsafe|dismissed|not accepted)\b/i,
      /\bnative dialog\b.*\b(needs a decision|blocked|dismissed)\b/i,
    ],
  },
  {
    failureClass: 'token_rejected',
    severity: 'error',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Refresh desktop/browser bridge pairing and retry with the new local token.',
    patterns: [/\btoken_rejected\b/i, /\btoken rejected\b/i, /\b401\b.*\bdesktop.*token\b/i],
  },
  {
    failureClass: 'vault_grant_missing',
    severity: 'warning',
    surface: 'vault',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Ask for a scoped vault grant for this task and origin; never request or print the raw secret.',
    patterns: [/\bvault\b.*\b(grant|access|permission)\b.*\b(missing|required|denied)\b/i, /\bcredential\b.*\b(grant|access)\b.*\b(missing|required|denied)\b/i],
  },
  {
    failureClass: 'origin_not_allowed',
    severity: 'error',
    surface: 'vault',
    retryable: false,
    userActionRequired: true,
    recommendedRecovery: 'Ask the user to approve this exact origin or select a different credential.',
    patterns: [/\borigin\b.*\b(not allowed|blocked|mismatch|denied)\b/i, /\bdomain\b.*\b(not allowed|blocked|mismatch|denied)\b/i],
  },
  {
    failureClass: 'missing_user_key',
    severity: 'warning',
    surface: 'integration_api',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Ask the user to connect their own marketplace/API key for this provider before using the model or integration.',
    patterns: [/\bkey_missing\b/i, /\badd your own\b.*\bapi key\b/i, /\bmissing\b.*\b(api key|provider key|user key)\b/i],
  },
  {
    failureClass: 'model_tool_unsupported',
    severity: 'error',
    surface: 'model_only',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Route to a model/provider that supports the requested tool type or downgrade to semantic browser/desktop tools.',
    patterns: [/\bdoes not support tool types?\b/i, /\bunsupported\b.*\btool\b/i, /\bcomputer_\d+\b/i],
  },
  {
    failureClass: 'provider_rate_limited',
    severity: 'warning',
    surface: 'model_only',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Back off, switch provider/model if allowed, or ask the user to retry after the rate-limit window.',
    patterns: [/\brate limit/i, /\b429\b/, /\btoo many requests\b/i],
  },
  {
    failureClass: 'provider_unavailable',
    severity: 'warning',
    surface: 'model_only',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Retry with backoff or route to a fallback provider that has the required capabilities.',
    patterns: [/\b529\b/, /\btemporarily unavailable\b/i, /\bprovider unavailable\b/i, /\bauthentication service is temporarily unavailable\b/i],
  },
  {
    failureClass: 'budget_exceeded',
    severity: 'warning',
    surface: 'model_only',
    retryable: false,
    userActionRequired: true,
    recommendedRecovery: 'Pause the run and ask for budget approval or switch to a cheaper route.',
    patterns: [/\bbudget\b.*\b(exceeded|over|hit)\b/i, /\bcost cap\b/i, /\bspend limit\b/i],
  },
  {
    failureClass: 'selector_not_found',
    severity: 'warning',
    surface: 'browser_semantic',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Refresh DOM/ARIA state, use Stagehand observe, then retry with a semantic locator.',
    patterns: [
      /\bselector\b.*\b(not found|missing|failed)\b/i,
      /\bselector_not_found\b/i,
      /\blocator\b.*\b(not found|timeout|failed)\b/i,
      /\bno element\b/i,
      /\b(could not|couldn't|can'?t)\s+find\b.*\b(field|button|menu item|control|layer|text frame)\b/i,
      /\bfield target not found\b/i,
      /\bfield matching\b/i,
    ],
  },
  {
    failureClass: 'uncertain_ui_target',
    severity: 'warning',
    surface: 'desktop_a11y',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Pause and ask the user to confirm the intended UI target before clicking or typing.',
    patterns: [/\buncertain_ui_target\b/i, /\buncertain\b.*\b(ui|target|button|field)\b/i, /\bambiguous\b.*\b(ui|target|button|field)\b/i, /\bstrict mode violation\b/i],
  },
  {
    failureClass: 'timeout',
    severity: 'warning',
    surface: 'browser_semantic',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Collect current browser state, then retry the timed browser step once with bounded waits.',
    patterns: [/\btimeout\b/i, /\btimed out\b/i, /\btimeouterror\b/i],
  },
  {
    failureClass: 'missing_permission',
    severity: 'error',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Ask the user to grant the missing macOS/browser permission and retry the readiness check.',
    patterns: [/\bpermission\b.*\b(denied|required|missing)\b/i, /\baccessibility\b.*\b(denied|required|missing)\b/i, /\bscreen recording\b.*\b(denied|required|missing)\b/i],
  },
  {
    failureClass: 'permission_denied',
    severity: 'error',
    surface: 'terminal_bridge',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Fix local file/CLI permissions or run the terminal agent under the correct user account.',
    patterns: [/\bpermission denied\b/i, /\bEACCES\b/i, /\boperation not permitted\b/i],
  },
  {
    failureClass: 'cli_missing',
    severity: 'error',
    surface: 'terminal_bridge',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Install or expose the requested CLI on PATH, then retry the terminal launch.',
    patterns: [/\bcommand not found\b/i, /\bnot found\b.*\b(codex|claude|gemini|cursor)\b/i, /\bENOENT\b.*\b(codex|claude|gemini|cursor)\b/i],
  },
  {
    failureClass: 'file_not_found',
    severity: 'warning',
    surface: 'desktop_bridge',
    retryable: true,
    userActionRequired: true,
    recommendedRecovery: 'Ask for the correct file path or search root.',
    patterns: [/\bfile not found\b/i, /\bno such file\b/i, /\bENOENT\b/i, /\bpath[_\s-]*not[_\s-]*found\b/i, /\bpath does not exist\b/i, /\bfile or folder does not exist\b/i],
  },
  {
    failureClass: 'constraint_violation',
    severity: 'error',
    surface: 'integration_api',
    retryable: false,
    userActionRequired: false,
    recommendedRecovery: 'Patch the database write path or migration so app payloads match constraints.',
    patterns: [/\bviolates check constraint\b/i, /\b23514\b/i, /\bconstraint\b.*\bviolat/i],
  },
  {
    failureClass: 'duplicate_event',
    severity: 'warning',
    surface: 'integration_api',
    retryable: false,
    userActionRequired: false,
    recommendedRecovery: 'Treat the operation as idempotent or use upsert/on-conflict handling.',
    patterns: [/\bduplicate key\b/i, /\b23505\b/i, /\balready exists\b/i],
  },
  {
    failureClass: 'server_error',
    severity: 'error',
    surface: 'integration_api',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Retry once with backoff, then inspect server logs and classify the failing service.',
    patterns: [/\b500\b/, /\binternal server error\b/i],
  },
  {
    failureClass: 'network_error',
    severity: 'warning',
    surface: 'integration_api',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Retry after checking connectivity and target service status.',
    patterns: [/\bnetwork error\b/i, /\bfailed to fetch\b/i, /\bECONNRESET\b/i, /\bETIMEDOUT\b/i],
  },
  {
    failureClass: 'no_progress_loop',
    severity: 'warning',
    surface: 'model_only',
    retryable: false,
    userActionRequired: true,
    recommendedRecovery: 'Stop the loop, summarize completed steps, and ask for a narrower next action or approval.',
    patterns: [/\bno progress\b/i, /\brepeated action\b/i, /\bloop\b/i, /\bsame step\b/i],
  },
  {
    failureClass: 'model_identity_leak',
    severity: 'warning',
    surface: 'model_only',
    retryable: true,
    userActionRequired: false,
    recommendedRecovery: 'Re-answer using The Underground Circle capability contract instead of upstream model identity.',
    patterns: [/\bi am (a )?(large language model|google|anthropic|openai)\b/i, /\btrained by google\b/i],
  },
];

const DEFAULT_ASSESSMENT: AgentFailureAssessment = {
  failureClass: 'unknown',
  severity: 'warning',
  surface: 'unknown',
  retryable: true,
  userActionRequired: false,
  recommendedRecovery: 'Capture the raw error, stop speculative retries, and ask the planner to classify the blocker.',
  signals: [],
};

export function classifyAgentFailure(input: unknown): AgentFailureAssessment {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  for (const rule of RULES) {
    const signals = rule.patterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    if (signals.length > 0) {
      return {
        failureClass: rule.failureClass,
        severity: rule.severity,
        surface: rule.surface,
        retryable: rule.retryable,
        userActionRequired: rule.userActionRequired,
        recommendedRecovery: rule.recommendedRecovery,
        signals,
      };
    }
  }
  return { ...DEFAULT_ASSESSMENT };
}

export function isHumanTakeoverFailure(failureClass: AgentFailureClass): boolean {
  return failureClass === 'human_verification_required' || failureClass === 'mfa_required' || failureClass === 'otp_required';
}

export function isRetryableFailure(failureClass: AgentFailureClass): boolean {
  const assessment = RULES.find((rule) => rule.failureClass === failureClass);
  return assessment ? assessment.retryable : true;
}
