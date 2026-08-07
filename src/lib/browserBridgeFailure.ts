import type { DesktopBridgeError } from './desktopBridgeProtocol';

export type BrowserBridgeRetryability =
  | 'retry_once'
  | 'retry_after_evidence'
  | 'needs_user'
  | 'do_not_retry';

export interface BrowserBridgeFailure {
  errorCode: DesktopBridgeError;
  rawError: string;
  recoveryHint: string;
  requiredEvidence: string[];
  message: string;
  /** Optional machine-readable retry posture (additive; existing readers ignore it). */
  retryability?: BrowserBridgeRetryability;
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
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
    case 'browser_target_capacity':
    case 'browser_fill_canary_blocked':
    case 'browser_fill_verification_failed':
    case 'browser_toggle_canary_blocked':
    case 'browser_toggle_verification_failed':
    case 'browser_scroll_verification_failed':
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
    case 'ambiguous_locator':
    case 'verification_gate':
    case 'stale_bridge':
    case 'helper_missing':
    case 'a11y_tree_empty':
    case 'a11y_path_stale':
    case 'origin_blocked':
    case 'app_not_found':
    case 'path_not_found':
    case 'file_access_not_granted':
    case 'platform_unsupported':
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
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
      return 'Collect a fresh browser DOM snapshot before retrying with its exact context, page, and URL identity.';
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
      return 'Observe the exact field or state control again and retry only with the new single-use browser target capability.';
    case 'browser_target_capacity':
      return 'Wait for stale target observations to expire, then observe the exact field once and retry.';
    case 'browser_fill_canary_blocked':
      return 'Use the dedicated approval-gated submit or credential path; this canary only fills non-secret fields without submission.';
    case 'browser_fill_verification_failed':
      return 'Collect a fresh DOM snapshot and inspect the field before deciding whether one bounded retry is safe.';
    case 'browser_toggle_canary_blocked':
      return 'Do not use the toggle canary for this control. Use a dedicated reviewed action, or pause for the user when authentication or human verification is involved.';
    case 'browser_toggle_verification_failed':
      return 'Collect a fresh DOM snapshot and inspect the exact state control before deciding whether one bounded retry is safe.';
    case 'browser_scroll_verification_failed':
      return 'Collect a fresh DOM snapshot or screenshot and inspect whether the viewport is already at its boundary. Do not replay the scroll without fresh evidence.';
    case 'ambiguous_locator':
      return 'Pick a candidate by nth (0-based) or a more specific role+name/selector; do not click the first match.';
    case 'uncertain_ui_target':
      return 'Refresh DOM/screenshot evidence and ask for confirmation if more than one target still matches.';
    case 'verification_gate':
      return 'Pause automation and ask the user to complete the verification challenge in the UC browser profile.';
    case 'a11y_tree_empty':
      return 'The accessibility tree came back empty; fall back to a screenshot + coordinate path or retry after re-reading the tree.';
    case 'a11y_path_stale':
      return 'The app PID changed since the tree was read; re-read the accessibility tree before acting on element paths.';
    case 'stale_bridge':
      return 'The bridge state is stale; refresh bridge/browser health and re-observe the page before retrying.';
    case 'helper_missing':
      return 'The desktop helper binary is not compiled; rebuild via `npm run bridge` or fall back to vision-grounded tools.';
    case 'origin_blocked':
      return 'The target origin is blocked; confirm the URL is allowed and ask the user before navigating there.';
    case 'app_not_found':
      return 'The named app could not be found; confirm it is installed and the exact name before retrying.';
    case 'path_not_found':
      return 'Ask for or search the exact local path before retrying.';
    case 'file_access_not_granted':
      return 'Request a scoped file-access grant from the user before reading or uploading the file.';
    case 'platform_unsupported':
      return 'This action is not supported on the current platform; report the limitation instead of retrying.';
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
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
    case 'browser_fill_verification_failed':
    case 'browser_toggle_verification_failed':
    case 'browser_scroll_verification_failed':
      return ['browser.dom_snapshot'];
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
    case 'browser_target_capacity':
      return ['browser.dom_snapshot', 'browser.fill_target'];
    case 'browser_fill_canary_blocked':
      return ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'];
    case 'browser_toggle_canary_blocked':
      return ['browser.dom_snapshot', 'user.approve_dedicated_browser_action'];
    case 'ambiguous_locator':
      return ['browser.dom_snapshot', 'browser.candidate_list'];
    case 'uncertain_ui_target':
      return ['browser.dom_snapshot', 'browser.screenshot', 'user.confirm_target'];
    case 'verification_gate':
      return ['browser.verification_state', 'user.complete_browser_verification'];
    case 'a11y_tree_empty':
    case 'a11y_path_stale':
      return ['browser.dom_snapshot', 'browser.screenshot'];
    case 'stale_bridge':
      return ['desktop.bridge_health', 'browser.health'];
    case 'helper_missing':
      return ['desktop.bridge_health'];
    case 'origin_blocked':
      return ['browser.health', 'user.confirm_navigation'];
    case 'app_not_found':
      return ['desktop.list_installed_apps'];
    case 'path_not_found':
      return ['desktop.file_search', 'desktop.file_stat'];
    case 'file_access_not_granted':
      return ['desktop.file_grant', 'desktop.file_stat'];
    case 'platform_unsupported':
      return ['desktop.bridge_health'];
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

export function browserBridgeRetryability(errorCode: DesktopBridgeError): BrowserBridgeRetryability {
  switch (errorCode) {
    // The user must act before another attempt makes sense.
    case 'human_verification_required':
    case 'verification_gate':
    case 'auth_required':
    case 'not_paired':
    case 'token_rejected':
    case 'missing_permission':
    case 'permission_denied':
    case 'file_access_not_granted':
    case 'origin_blocked':
    case 'browser_dialog_blocked':
      return 'needs_user';
    // Retry only after collecting fresh observations.
    case 'selector_not_found':
    case 'ambiguous_locator':
    case 'uncertain_ui_target':
    case 'browser_identity_required':
    case 'browser_identity_mismatch':
    case 'browser_target_required':
    case 'browser_target_mismatch':
    case 'browser_target_expired':
    case 'browser_target_replayed':
    case 'browser_target_revoked':
    case 'browser_target_unknown':
    case 'browser_target_capacity':
    case 'browser_fill_verification_failed':
    case 'browser_toggle_verification_failed':
    case 'browser_scroll_verification_failed':
    case 'a11y_tree_empty':
    case 'a11y_path_stale':
    case 'stale_bridge':
    case 'bridge_offline':
    case 'browser_bridge_offline':
      return 'retry_after_evidence';
    // A single bounded retry is reasonable.
    case 'timeout':
    case 'network_error':
    case 'server_error':
      return 'retry_once';
    // Nothing to gain from retrying as-is.
    case 'invalid_input':
    case 'browser_fill_canary_blocked':
    case 'browser_toggle_canary_blocked':
    case 'platform_unsupported':
    case 'helper_missing':
    case 'app_not_found':
    case 'path_not_found':
    case 'file_not_found':
    case 'path_not_allowed':
      return 'do_not_retry';
    default:
      return 'retry_after_evidence';
  }
}

export function describeBrowserBridgeFailure(error: unknown, explicitCode?: unknown): BrowserBridgeFailure {
  const rawError = clean(error) || 'Browser action failed.';
  const errorCode = classifyBrowserBridgeFailure(rawError, explicitCode);
  const recoveryHint = browserBridgeRecoveryHint(errorCode);
  const requiredEvidence = browserBridgeRequiredEvidence(errorCode);
  const retryability = browserBridgeRetryability(errorCode);
  return {
    errorCode,
    rawError,
    recoveryHint,
    requiredEvidence,
    retryability,
    message: `Browser action failed (${errorCode}): ${rawError} Next: ${recoveryHint} Evidence: ${requiredEvidence.join(', ')}.`,
  };
}
