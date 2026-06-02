import type { DesktopBridgeError } from './desktopBridgeProtocol';

export interface BrowserBridgeFailure {
  errorCode: DesktopBridgeError;
  rawError: string;
  recoveryHint: string;
  requiredEvidence: string[];
  message: string;
}

function clean(value: unknown, max = 1_600): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function normalizeExplicitCode(value: unknown): DesktopBridgeError | null {
  const code = clean(value, 120).toLowerCase();
  switch (code) {
    case 'human_verification_required':
    case 'browser_bridge_offline':
    case 'browser_dialog_blocked':
    case 'bridge_offline':
    case 'not_paired':
    case 'token_rejected':
    case 'selector_not_found':
    case 'uncertain_ui_target':
    case 'auth_required':
    case 'file_not_found':
    case 'path_not_allowed':
    case 'missing_permission':
    case 'permission_denied':
    case 'network_error':
    case 'server_error':
    case 'timeout':
    case 'invalid_input':
    case 'unknown':
      return code as DesktopBridgeError;
    default:
      return null;
  }
}

export function classifyBrowserBridgeFailure(error: unknown, explicitCode?: unknown): DesktopBridgeError {
  const normalized = normalizeExplicitCode(explicitCode);
  if (normalized && normalized !== 'unknown') return normalized;

  const text = clean(error).toLowerCase();
  if (!text) return normalized || 'unknown';
  if (/\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|cloudflare security check)\b/.test(text)) {
    return 'human_verification_required';
  }
  if (/\b(browser dialog|browser popup|native dialog|javascript dialog|beforeunload|alert|confirm|prompt)\b.*\b(blocked|needs a decision|manual|unsafe|not accepted|dismissed)\b/.test(text)) {
    return 'browser_dialog_blocked';
  }
  if (/\b(token rejected|unauthorized|401|not paired|pair first|desktop bridge not paired)\b/.test(text)) {
    return /token rejected|unauthorized|401/.test(text) ? 'token_rejected' : 'not_paired';
  }
  if (/\b(browser bridge|browser session|chrome launch|chromium fallback|playwright|context)\b.*\b(unavailable|offline|not running|failed|missing|closed|disconnected)\b/.test(text)) {
    return 'browser_bridge_offline';
  }
  if (/\b(waiting for selector|waiting for locator)\b/.test(text)) {
    return 'selector_not_found';
  }
  if (/\b(timeout|timed out|timeouterror)\b/.test(text)) {
    return /\b(locator|selector|getbyrole|element)\b/.test(text) ? 'selector_not_found' : 'timeout';
  }
  if (/\bstrict mode violation|resolved to \d+ elements|more than one element|ambiguous\b/.test(text)) {
    return 'uncertain_ui_target';
  }
  if (/\b(not visible|not enabled|not editable|intercepts pointer events|element is outside|detached from dom|element is hidden)\b/.test(text)) {
    return 'uncertain_ui_target';
  }
  if (/\b(login required|sign in required|authentication required|auth required|session expired)\b/.test(text)) {
    return 'auth_required';
  }
  if (/\b(file not found|no such file|enoent)\b/.test(text)) return 'file_not_found';
  if (/\b(path must stay under|not allowed|outside allowed)\b/.test(text)) return 'path_not_allowed';
  if (/\b(permission denied|eacces|operation not permitted|accessibility permission|screen recording)\b/.test(text)) {
    return 'permission_denied';
  }
  if (/\b(net::|network error|failed to fetch|econnreset|etimedout|connection refused)\b/.test(text)) {
    return 'network_error';
  }
  if (/\b(500|internal server error)\b/.test(text)) return 'server_error';
  return normalized || 'unknown';
}

export function browserBridgeRecoveryHint(errorCode: DesktopBridgeError): string {
  switch (errorCode) {
    case 'human_verification_required':
      return 'Pause automation and ask the user to complete the verification challenge in the UC browser profile.';
    case 'not_paired':
    case 'token_rejected':
      return 'Re-pair the local desktop bridge, then retry the browser action with a fresh page check.';
    case 'bridge_offline':
    case 'browser_bridge_offline':
      return 'Reconnect the local bridge/browser session, then collect fresh browser health before retrying.';
    case 'browser_dialog_blocked':
      return 'Read the browser popup text/buttons, use the guarded modal advisor, and retry only if it selects a safe acknowledgement or requested-output overwrite.';
    case 'selector_not_found':
      return 'Collect a fresh DOM snapshot, prefer role/name locators, and retry the failed action once.';
    case 'uncertain_ui_target':
      return 'Refresh DOM/screenshot evidence and ask for confirmation if more than one target still matches.';
    case 'auth_required':
      return 'Ask the user to sign in inside the UC browser profile before retrying.';
    case 'file_not_found':
      return 'Ask for or search the exact local file path before retrying the upload.';
    case 'path_not_allowed':
      return 'Use a file under the user home folder or request a scoped file grant.';
    case 'missing_permission':
    case 'permission_denied':
      return 'Ask the user to grant the missing local browser/desktop permission, then retry readiness.';
    case 'network_error':
    case 'server_error':
    case 'timeout':
      return errorCode === 'timeout'
        ? 'Collect current URL, title, screenshot or DOM state, then retry the timed browser step once with a bounded wait.'
        : 'Retry once after fresh page state and stop if the same failure repeats.';
    case 'invalid_input':
      return 'Fix the browser action arguments before sending another request.';
    default:
      return 'Capture fresh browser health, DOM state, and the raw error before retrying.';
  }
}

export function browserBridgeRequiredEvidence(errorCode: DesktopBridgeError): string[] {
  switch (errorCode) {
    case 'human_verification_required':
      return ['browser.verification_state', 'user.complete_browser_verification'];
    case 'not_paired':
    case 'token_rejected':
      return ['desktop.bridge_pairing', 'browser.health'];
    case 'bridge_offline':
    case 'browser_bridge_offline':
      return ['desktop.bridge_health', 'browser.health'];
    case 'browser_dialog_blocked':
      return ['browser.dialog_observation', 'browser.dom_snapshot', 'browser.screenshot'];
    case 'selector_not_found':
      return ['browser.dom_snapshot', 'browser.screenshot'];
    case 'uncertain_ui_target':
      return ['browser.dom_snapshot', 'browser.screenshot', 'user.confirm_target'];
    case 'auth_required':
      return ['browser.screenshot', 'user.sign_in_browser_profile'];
    case 'file_not_found':
      return ['desktop.file_search', 'desktop.file_stat'];
    case 'path_not_allowed':
      return ['desktop.file_grant', 'desktop.file_stat'];
    case 'missing_permission':
    case 'permission_denied':
      return ['desktop.permission_check', 'browser.health'];
    case 'timeout':
      return ['browser.health', 'browser.dom_snapshot', 'browser.screenshot'];
    case 'network_error':
    case 'server_error':
      return ['browser.health', 'browser.screenshot'];
    default:
      return ['browser.health', 'browser.dom_snapshot'];
  }
}

export function describeBrowserBridgeFailure(error: unknown, explicitCode?: unknown): BrowserBridgeFailure {
  const rawError = clean(error) || 'Browser action failed.';
  const errorCode = classifyBrowserBridgeFailure(rawError, explicitCode);
  const recoveryHint = browserBridgeRecoveryHint(errorCode);
  const requiredEvidence = browserBridgeRequiredEvidence(errorCode);
  return {
    errorCode,
    rawError,
    recoveryHint,
    requiredEvidence,
    message: `Browser action failed (${errorCode}): ${rawError} Next: ${recoveryHint} Evidence: ${requiredEvidence.join(', ')}.`,
  };
}
