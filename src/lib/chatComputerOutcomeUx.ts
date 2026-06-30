import {
  isDirectLocalImageFormatConversionTask,
  isLocalImageExportProofTask,
  isLowRiskLocalImageExportTask,
} from './computerTaskPlanner';
import type { ComputerTaskPhase } from './computerTaskState';

export interface ChatComputerOutcomePresentationInput {
  task: string;
  outcomeStatus: string;
  outcomeMessage: string;
  rawWarnings: string[];
  visibleWarnings: string[];
  preflightBlockers: string[];
  preflightWarnings: string[];
  groundingBlockers: string[];
  capabilityBlockers?: string[];
  capabilityPhase?: ComputerTaskPhase | null;
  suppressGenericRecovery?: boolean;
}

export interface ChatComputerOutcomePresentation {
  warningBlock: string;
  blockerList: string[];
  shouldRecoverOutcome: boolean;
  statePhase: ComputerTaskPhase;
  compactUserMessage: string | null;
  hideRecoveryDetails: boolean;
  hideComputerHandoff: boolean;
  hideComputerTaskStatus: boolean;
  nextSteps: string[];
}

const PHOTOSHOP_SAVE_FOR_WEB_RECONNECT_STEP = 'Tap the desktop bridge button to reconnect, then retry the Photoshop Save for Web request.';
const PHOTOSHOP_SAVE_FOR_WEB_BLOCKER = 'Desktop bridge needs to reconnect before Photoshop Save for Web can continue.';
const DIRECT_IMAGE_CONVERSION_RECONNECT_STEP = 'Reconnect the desktop bridge, approve the requested folder if prompted, then retry the image conversion.';
const DIRECT_IMAGE_CONVERSION_BLOCKER = 'Desktop bridge is not connected or does not have the requested folder access.';
const DIRECT_IMAGE_CONVERSION_RECONNECT_MESSAGE = [
  'I could not finish the image conversion because the desktop bridge is not ready.',
  'Reconnect the bridge, approve the requested folder if prompted, then retry. I will only mark it done after the saved image is verified.',
].join('\n\n');
const DIRECT_IMAGE_CONVERSION_NOT_FOUND_STEP = 'Send the exact image path or refresh the file search, then retry the conversion once.';
const DIRECT_IMAGE_CONVERSION_NOT_FOUND_BLOCKER = 'Source image could not be found before conversion.';
const DIRECT_IMAGE_CONVERSION_NOT_FOUND_MESSAGE = [
  'I could not find the image to convert.',
  DIRECT_IMAGE_CONVERSION_NOT_FOUND_STEP,
].join('\n\n');
const DIRECT_IMAGE_CONVERSION_AMBIGUOUS_STEP = 'Send the exact image path for the one you want converted, then retry once.';
const DIRECT_IMAGE_CONVERSION_AMBIGUOUS_BLOCKER = 'More than one matching source image was found before conversion.';
const DIRECT_IMAGE_CONVERSION_AMBIGUOUS_MESSAGE = [
  'I found more than one matching image to convert.',
  DIRECT_IMAGE_CONVERSION_AMBIGUOUS_STEP,
].join('\n\n');
const DIRECT_IMAGE_CONVERSION_CONFLICT_STEP = 'Choose a different output name or move the existing converted image, then retry once.';
const DIRECT_IMAGE_CONVERSION_CONFLICT_BLOCKER = 'Converted image output already exists.';
const DIRECT_IMAGE_CONVERSION_CONFLICT_MESSAGE = [
  'A converted image with that name already exists.',
  DIRECT_IMAGE_CONVERSION_CONFLICT_STEP,
].join('\n\n');
const LOCAL_IMAGE_EXPORT_MISSING_PROOF_BLOCKER = 'Saved-image proof was not captured, so the task cannot be marked done yet.';
const LOCAL_IMAGE_EXPORT_MISSING_PROOF_STEP = 'Retry once after reconnecting the desktop bridge, then verify the saved image before reporting completion.';
const LOCAL_IMAGE_EXPORT_MISSING_PROOF_MESSAGE = [
  'I could not verify that the saved image was created, so I stopped before marking it done.',
  'Retry once after reconnecting the desktop bridge. I will report completion only after the saved image is verified.',
].join('\n\n');
const WORDPRESS_AUTOMATION_BLOCKER = 'WordPress automation stopped before the requested site change was completed.';
const WORDPRESS_AUTOMATION_RECOVERY_STEP = 'Technical details were saved for recovery. Refresh WordPress admin evidence, then retry once or ask for details.';
const WORDPRESS_AUTOMATION_FAILURE_MESSAGE = [
  'I could not finish the WordPress automation.',
  WORDPRESS_AUTOMATION_RECOVERY_STEP,
].join('\n\n');
const CREDENTIAL_AUTOMATION_BLOCKER = 'Saved-login step needs approval, an origin check, or a fresh login page before it can continue.';
const CREDENTIAL_AUTOMATION_RECOVERY_STEP = 'Open the expected login page, approve the saved-login step, and retry once. The password will stay inside the approved browser tool.';
const CREDENTIAL_AUTOMATION_FAILURE_MESSAGE = [
  'I could not finish the login step safely.',
  CREDENTIAL_AUTOMATION_RECOVERY_STEP,
].join('\n\n');
const APP_AUTOMATION_BLOCKER = 'App automation needs fresh on-screen evidence before the next action can continue.';
const APP_AUTOMATION_RECOVERY_STEP = 'Refresh the app observation, then retry once with the current window state and accessibility tree.';
const APP_AUTOMATION_FAILURE_MESSAGE = [
  'I could not finish the app action.',
  APP_AUTOMATION_RECOVERY_STEP,
].join('\n\n');
const LOCAL_FILE_AUTOMATION_BLOCKER = 'Local file access needs a fresh file check or folder permission before the task can continue.';
const LOCAL_FILE_AUTOMATION_RECOVERY_STEP = 'Refresh the file search/stat evidence, approve the requested folder if prompted, then retry once.';
const LOCAL_FILE_AUTOMATION_FAILURE_MESSAGE = [
  'I could not access the requested local file yet.',
  LOCAL_FILE_AUTOMATION_RECOVERY_STEP,
].join('\n\n');
const LOCAL_FILE_NOT_FOUND_RECOVERY_STEP = 'Send the exact file path or refresh the file search, then retry once.';
const LOCAL_FILE_NOT_FOUND_FAILURE_MESSAGE = [
  'I could not find the requested local file.',
  LOCAL_FILE_NOT_FOUND_RECOVERY_STEP,
].join('\n\n');
const LOCAL_FILE_PERMISSION_RECOVERY_STEP = 'Approve the requested folder access, then retry once.';
const LOCAL_FILE_PERMISSION_FAILURE_MESSAGE = [
  'I need folder access before I can work with that local file.',
  LOCAL_FILE_PERMISSION_RECOVERY_STEP,
].join('\n\n');
const LOCAL_FILE_AMBIGUOUS_RECOVERY_STEP = 'Send the exact file path for the one you want, then retry once.';
const LOCAL_FILE_AMBIGUOUS_FAILURE_MESSAGE = [
  'I found more than one matching local file.',
  LOCAL_FILE_AMBIGUOUS_RECOVERY_STEP,
].join('\n\n');
const BROWSER_AUTOMATION_BLOCKER = 'Browser automation needs a fresh browser connection or page observation before it can continue.';
const BROWSER_AUTOMATION_RECOVERY_STEP = 'Refresh the browser page observation, reconnect the browser bridge if prompted, then retry once.';
const BROWSER_AUTOMATION_FAILURE_MESSAGE = [
  'I could not finish the browser step.',
  BROWSER_AUTOMATION_RECOVERY_STEP,
].join('\n\n');

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, max);
}

function extractImageFilename(task: string, outcomeMessage: string): string | null {
  const candidates = Array.from(`${outcomeMessage}\n${task}`.matchAll(/(?:^|[\s*"`/\\])([^\/\\\n\r:*?"<>|]{1,140}\.(?:png|jpe?g|tiff?|gif|bmp|heic))(?:$|[\s*"`.,)])/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1] || null;
}

function hasLocalImageExportProof(outcomeMessage: string): boolean {
  return /\bdesktop\.convert_image\b/i.test(outcomeMessage)
    || /\bSaved\s+[^\n\r]+\.(?:png|jpe?g|tiff?|gif|bmp|heic)\s+\((?:png|jpe?g|jpg|tiff?|gif|bmp|heic),\s*[1-9]\d*\s+bytes\)\.?/i.test(outcomeMessage)
    || /\boutputPath\s*[:=]\s*[^\n\r]+\.(?:png|jpe?g|tiff?|gif|bmp|heic)\b[\s\S]{0,120}\bbytes\s*[:=]\s*[1-9]\d*\b/i.test(outcomeMessage)
    || /\bVerified\b[\s\S]{0,160}\b(?:output|file_stat|bytes?|size)\b[\s\S]{0,160}\.(?:png|jpe?g|tiff?|gif|bmp|heic)\b/i.test(outcomeMessage);
}

function buildCompactLocalImageExportSuccessMessage(task: string, outcomeStatus: string, outcomeMessage: string): string | null {
  if (outcomeStatus !== 'completed') return null;
  if (!isLocalImageExportProofTask(task)) return null;
  if (!hasLocalImageExportProof(outcomeMessage)) return null;
  const filename = extractImageFilename(task, outcomeMessage);
  return filename
    ? `Done. Saved **${filename}** and verified the output file.`
    : 'Done. Saved and verified the output image file.';
}

export function isQuietSuccessfulComputerTaskWarning(warning: string): boolean {
  return /\bstale_bridge\b/i.test(warning)
    && /(?:desktop_photoshop_export_proof|photoshop_export_proof|save_for_web_fallback|save for web)/i.test(warning);
}

export function isCompactPhotoshopSaveForWebBridgeFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  if (isDirectLocalImageFormatConversionTask(task)) return false;
  if (!isLowRiskLocalImageExportTask(task)) return false;
  const text = [outcomeMessage, ...warnings].join('\n');
  return /\b(stale_bridge|Unknown \/desktop endpoint|desktop_photoshop_export_proof|photoshop_export_proof)\b/i.test(text)
    && /\b(Photoshop|save for web|raster|png|jpe?g|image export)\b/i.test(text);
}

export function isCompactDirectImageConversionBridgeFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  if (!isDirectLocalImageFormatConversionTask(task)) return false;
  const text = [outcomeMessage, ...warnings].join('\n');
  return /\b(?:bridge(?:\s+needs\s+to\s+reconnect|_offline| unavailable| unreachable)|stale_bridge|Unknown \/desktop endpoint|desktop\.convert_image|desktop_photoshop_export_proof|photoshop_export_proof)\b/i.test(text)
    && /\b(?:png|jpe?g|image|convert|conversion|export|save)\b/i.test(text);
}

function directImageConversionFailureCopy(
  outcomeMessage: string,
  warnings: string[],
): { message: string; blocker: string; recoveryStep: string } {
  const text = [outcomeMessage, ...warnings].join('\n');
  if (/\b(?:ambiguous_file_match|ambiguous|more than one|multiple matching|multiple matches?)\b/i.test(text)) {
    return {
      message: DIRECT_IMAGE_CONVERSION_AMBIGUOUS_MESSAGE,
      blocker: DIRECT_IMAGE_CONVERSION_AMBIGUOUS_BLOCKER,
      recoveryStep: DIRECT_IMAGE_CONVERSION_AMBIGUOUS_STEP,
    };
  }
  if (/\b(?:output_conflict|already exists|overwrit(?:e|ing)|conflict)\b/i.test(text)) {
    return {
      message: DIRECT_IMAGE_CONVERSION_CONFLICT_MESSAGE,
      blocker: DIRECT_IMAGE_CONVERSION_CONFLICT_BLOCKER,
      recoveryStep: DIRECT_IMAGE_CONVERSION_CONFLICT_STEP,
    };
  }
  if (/\b(?:file_not_found|path_not_found|ENOENT|not found|does not exist|missing source|could not find|no matching source image)\b/i.test(text)) {
    return {
      message: DIRECT_IMAGE_CONVERSION_NOT_FOUND_MESSAGE,
      blocker: DIRECT_IMAGE_CONVERSION_NOT_FOUND_BLOCKER,
      recoveryStep: DIRECT_IMAGE_CONVERSION_NOT_FOUND_STEP,
    };
  }
  return {
    message: DIRECT_IMAGE_CONVERSION_RECONNECT_MESSAGE,
    blocker: DIRECT_IMAGE_CONVERSION_BLOCKER,
    recoveryStep: DIRECT_IMAGE_CONVERSION_RECONNECT_STEP,
  };
}

export function buildCompactPhotoshopSaveForWebBridgeFailureMessage(): string {
  return [
    'I could not finish the Photoshop PNG export because the desktop bridge needs to reconnect before Photoshop actions can continue.',
    'Tap the desktop bridge button to reconnect it, then retry the request. The next run will use Photoshop Save for Web and save the renamed PNG to the requested destination.',
  ].join('\n\n');
}

export function isCompactWordPressAutomationFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  const text = [task, outcomeMessage, ...warnings].join('\n');
  return /\b(?:wordpress|wp-admin|wp\.|wp-json|dealer inspire|di slides?|cms|browser\.wp_admin_source_intelligence|wp_admin_source_intelligence|\/browser\/page_source)\b/i.test(text)
    && /\b(?:failed|could not|blocked|forbidden|unauthorized|session expired|approval|error|http\s*(?:4\d\d|5\d\d)|rest_[a-z0-9_]+)\b/i.test(text);
}

export function isCompactCredentialAutomationFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  const text = [task, outcomeMessage, ...warnings].join('\n');
  return /\b(?:login|log in|sign in|credential|credentials|password|username|saved login|1password|vault|browser\.fill_credential_field|credentials\.get|credentialId|login_url|vault_grant_missing)\b/i.test(text)
    && /\b(?:failed|could not|blocked|missing|approval|unauthorized|forbidden|origin|mfa|captcha|token|error)\b/i.test(text);
}

export function isCompactAppAutomationFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  const text = [task, outcomeMessage, ...warnings].join('\n');
  return /\b(?:desktop\.(?:click_element|set_element_value|read_a11y_tree|launch_app|focus_app|menu_click|press_keys)|a11y_path_stale|\/desktop\/a11y_tree|AX(?:Path|Element)|pid\s*[:=]|\bpath-not-found\b)\b/i.test(text)
    && /\b(?:failed|could not|blocked|stale|missing|not found|permission|accessibility|error)\b/i.test(text);
}

export function isCompactLocalFileAutomationFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  const text = [task, outcomeMessage, ...warnings].join('\n');
  return /\b(?:desktop\.(?:open_path|file_stat|file_search|file_read|file_write_text|file_copy|file_rename|file_trash)|X-UC-File-Session-Token|EACCES|EPERM|ENOENT|operation not permitted|file or folder does not exist|\/Users\/|Desktop bridge open path failed)\b/i.test(text)
    && /\b(?:file|folder|path|desktop|downloads?|documents?|image|pdf|csv|permission|access|missing|not found|failed|blocked|error)\b/i.test(text);
}

function localFileAutomationFailureCopy(
  task: string,
  outcomeMessage: string,
  warnings: string[],
): { message: string; recoveryStep: string } {
  const text = [task, outcomeMessage, ...warnings].join('\n');
  if (/\b(?:ambiguous|more than one|multiple matches?|multiple matching)\b/i.test(text)) {
    return {
      message: LOCAL_FILE_AMBIGUOUS_FAILURE_MESSAGE,
      recoveryStep: LOCAL_FILE_AMBIGUOUS_RECOVERY_STEP,
    };
  }
  if (/\b(?:ENOENT|not found|does not exist|no file named|missing\s+(?:file|folder|path|source)|file\s+missing|folder\s+missing|path\s+missing)\b/i.test(text)) {
    return {
      message: LOCAL_FILE_NOT_FOUND_FAILURE_MESSAGE,
      recoveryStep: LOCAL_FILE_NOT_FOUND_RECOVERY_STEP,
    };
  }
  if (/\b(?:X-UC-File-Session-Token|EACCES|EPERM|operation not permitted|permission|folder access|grant|approve)\b/i.test(text)) {
    return {
      message: LOCAL_FILE_PERMISSION_FAILURE_MESSAGE,
      recoveryStep: LOCAL_FILE_PERMISSION_RECOVERY_STEP,
    };
  }
  return {
    message: LOCAL_FILE_AUTOMATION_FAILURE_MESSAGE,
    recoveryStep: LOCAL_FILE_AUTOMATION_RECOVERY_STEP,
  };
}

export function isCompactGenericBrowserAutomationFailure(
  task: string,
  outcomeStatus: string,
  outcomeMessage: string,
  warnings: string[],
): boolean {
  if (outcomeStatus === 'completed') return false;
  const text = [task, outcomeMessage, ...warnings].join('\n');
  if (isCompactWordPressAutomationFailure(task, outcomeStatus, outcomeMessage, warnings)) return false;
  return /\b(?:browser\.(?:dom_snapshot|click_role|fill_field|open_url|verification_state|screenshot)|\/browser\/[a-z0-9_/-]+|token_rejected|bridge_offline|HTTP\s*(?:401|403|404|5\d\d))\b/i.test(text)
    && /\b(?:failed|could not|blocked|unauthorized|forbidden|not found|offline|token|error)\b/i.test(text);
}

export function buildChatComputerOutcomePresentation(
  input: ChatComputerOutcomePresentationInput,
): ChatComputerOutcomePresentation {
  const capabilityBlockers = input.capabilityBlockers || [];
  const compactBridgeFailure = isCompactPhotoshopSaveForWebBridgeFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const compactDirectImageConversionBridgeFailure = isCompactDirectImageConversionBridgeFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const directImageConversionFailureCopyValue = compactDirectImageConversionBridgeFailure
    ? directImageConversionFailureCopy(input.outcomeMessage, input.rawWarnings)
    : null;
  const compactImageExportSuccess = buildCompactLocalImageExportSuccessMessage(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
  );
  const compactWordPressAutomationFailure = isCompactWordPressAutomationFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const compactCredentialAutomationFailure = isCompactCredentialAutomationFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const compactAppAutomationFailure = isCompactAppAutomationFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const compactLocalFileAutomationFailure = isCompactLocalFileAutomationFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const compactGenericBrowserAutomationFailure = isCompactGenericBrowserAutomationFailure(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
    input.rawWarnings,
  );
  const localFileFailureCopy = compactLocalFileAutomationFailure
    ? localFileAutomationFailureCopy(input.task, input.outcomeMessage, input.rawWarnings)
    : null;
  const compactTechnicalFailure = compactDirectImageConversionBridgeFailure
    || compactBridgeFailure
    || compactWordPressAutomationFailure
    || compactCredentialAutomationFailure
    || compactAppAutomationFailure
    || compactLocalFileAutomationFailure
    || compactGenericBrowserAutomationFailure;
  const missingLocalImageExportProof = input.outcomeStatus === 'completed'
    && isLocalImageExportProofTask(input.task)
    && !compactImageExportSuccess;
  const warningBlock = !compactTechnicalFailure && input.visibleWarnings.length
    ? `\n\n${input.visibleWarnings.map((warning) => `- ${warning}`).join('\n')}`
    : '';
  const hasCapabilityAction = capabilityBlockers.length > 0
    || Boolean(input.capabilityPhase && input.capabilityPhase !== 'completed');
  const completedWithoutActionableIssues = input.outcomeStatus === 'completed'
    && input.visibleWarnings.length === 0
    && input.preflightBlockers.length === 0
    && input.groundingBlockers.length === 0
    && !hasCapabilityAction
    && !missingLocalImageExportProof;
  const blockerList = uniqueCompact([
    compactDirectImageConversionBridgeFailure ? directImageConversionFailureCopyValue?.blocker || DIRECT_IMAGE_CONVERSION_BLOCKER : null,
    compactBridgeFailure ? PHOTOSHOP_SAVE_FOR_WEB_BLOCKER : null,
    missingLocalImageExportProof ? LOCAL_IMAGE_EXPORT_MISSING_PROOF_BLOCKER : null,
    compactCredentialAutomationFailure ? CREDENTIAL_AUTOMATION_BLOCKER : null,
    compactWordPressAutomationFailure && !compactCredentialAutomationFailure ? WORDPRESS_AUTOMATION_BLOCKER : null,
    compactAppAutomationFailure ? APP_AUTOMATION_BLOCKER : null,
    compactLocalFileAutomationFailure ? LOCAL_FILE_AUTOMATION_BLOCKER : null,
    compactGenericBrowserAutomationFailure ? BROWSER_AUTOMATION_BLOCKER : null,
    ...(compactTechnicalFailure ? [] : input.visibleWarnings),
    ...(compactTechnicalFailure ? [] : input.preflightBlockers),
    ...(compactTechnicalFailure || completedWithoutActionableIssues ? [] : input.preflightWarnings),
    ...(compactTechnicalFailure ? [] : input.groundingBlockers),
    ...(compactTechnicalFailure ? [] : capabilityBlockers),
  ], 8);
  const hasRecoverableProblem = input.outcomeStatus !== 'completed'
    || missingLocalImageExportProof
    || input.visibleWarnings.length > 0
    || input.preflightBlockers.length > 0
    || input.groundingBlockers.length > 0;
  const shouldRecoverOutcome = !input.suppressGenericRecovery
    && !compactDirectImageConversionBridgeFailure
    && !compactBridgeFailure
    && hasRecoverableProblem;
  const statePhase = input.capabilityPhase
    || (compactTechnicalFailure || missingLocalImageExportProof || input.visibleWarnings.length > 0 || input.outcomeStatus !== 'completed' ? 'blocked' : 'completed');

  return {
    warningBlock,
    blockerList,
    shouldRecoverOutcome,
    statePhase,
    compactUserMessage: compactDirectImageConversionBridgeFailure
      ? directImageConversionFailureCopyValue?.message || DIRECT_IMAGE_CONVERSION_RECONNECT_MESSAGE
      : compactBridgeFailure
        ? buildCompactPhotoshopSaveForWebBridgeFailureMessage()
        : missingLocalImageExportProof
        ? LOCAL_IMAGE_EXPORT_MISSING_PROOF_MESSAGE
        : compactCredentialAutomationFailure
        ? CREDENTIAL_AUTOMATION_FAILURE_MESSAGE
        : compactWordPressAutomationFailure
        ? WORDPRESS_AUTOMATION_FAILURE_MESSAGE
        : compactAppAutomationFailure
        ? APP_AUTOMATION_FAILURE_MESSAGE
        : compactLocalFileAutomationFailure
        ? localFileFailureCopy?.message || LOCAL_FILE_AUTOMATION_FAILURE_MESSAGE
        : compactGenericBrowserAutomationFailure
        ? BROWSER_AUTOMATION_FAILURE_MESSAGE
        : compactImageExportSuccess,
    hideRecoveryDetails: compactTechnicalFailure || Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    hideComputerHandoff: compactTechnicalFailure || Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    hideComputerTaskStatus: compactTechnicalFailure || Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    nextSteps: compactDirectImageConversionBridgeFailure
      ? [directImageConversionFailureCopyValue?.recoveryStep || DIRECT_IMAGE_CONVERSION_RECONNECT_STEP]
      : compactBridgeFailure
        ? [PHOTOSHOP_SAVE_FOR_WEB_RECONNECT_STEP]
        : missingLocalImageExportProof
        ? [LOCAL_IMAGE_EXPORT_MISSING_PROOF_STEP]
        : compactCredentialAutomationFailure
        ? [CREDENTIAL_AUTOMATION_RECOVERY_STEP]
        : compactWordPressAutomationFailure
        ? [WORDPRESS_AUTOMATION_RECOVERY_STEP]
        : compactAppAutomationFailure
        ? [APP_AUTOMATION_RECOVERY_STEP]
        : compactLocalFileAutomationFailure
        ? [localFileFailureCopy?.recoveryStep || LOCAL_FILE_AUTOMATION_RECOVERY_STEP]
        : compactGenericBrowserAutomationFailure
        ? [BROWSER_AUTOMATION_RECOVERY_STEP]
        : [],
  };
}
