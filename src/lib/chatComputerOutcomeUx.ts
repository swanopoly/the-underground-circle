import { isLowRiskLocalImageExportTask } from './computerTaskPlanner';
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

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, max);
}

function extractImageFilename(task: string, outcomeMessage: string): string | null {
  const candidates = Array.from(`${outcomeMessage}\n${task}`.matchAll(/(?:^|[\s*"`])([^\/\\\n\r:*?"<>|]{1,140}\.(?:png|jpe?g))(?:$|[\s*"`.,])/gi))
    .map((match) => match[1]?.trim())
    .filter(Boolean) as string[];
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1] || null;
}

function buildCompactLocalImageExportSuccessMessage(task: string, outcomeStatus: string, outcomeMessage: string): string | null {
  if (outcomeStatus !== 'completed') return null;
  if (!isLowRiskLocalImageExportTask(task)) return null;
  if (!/\b(?:completed \d+ desktop app steps|save for web|saved|exported)\b/i.test(outcomeMessage)) return null;
  const filename = extractImageFilename(task, outcomeMessage);
  return filename
    ? `Done. I opened the image in Photoshop and saved the renamed file as **${filename}**.`
    : 'Done. I opened the image in Photoshop and saved the renamed image file.';
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
  if (!isLowRiskLocalImageExportTask(task)) return false;
  const text = [outcomeMessage, ...warnings].join('\n');
  return /\b(stale_bridge|Unknown \/desktop endpoint|desktop_photoshop_export_proof|photoshop_export_proof)\b/i.test(text)
    && /\b(Photoshop|save for web|raster|png|jpe?g|image export)\b/i.test(text);
}

export function buildCompactPhotoshopSaveForWebBridgeFailureMessage(): string {
  return [
    'I could not finish the Photoshop PNG export because the desktop bridge needs to reconnect before Photoshop actions can continue.',
    'Tap the desktop bridge button to reconnect it, then retry the request. The next run will use Photoshop Save for Web and save the renamed PNG to the requested destination.',
  ].join('\n\n');
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
  const compactImageExportSuccess = buildCompactLocalImageExportSuccessMessage(
    input.task,
    input.outcomeStatus,
    input.outcomeMessage,
  );
  const warningBlock = input.visibleWarnings.length
    ? `\n\n${input.visibleWarnings.map((warning) => `- ${warning}`).join('\n')}`
    : '';
  const hasCapabilityAction = capabilityBlockers.length > 0
    || Boolean(input.capabilityPhase && input.capabilityPhase !== 'completed');
  const completedWithoutActionableIssues = input.outcomeStatus === 'completed'
    && input.visibleWarnings.length === 0
    && input.preflightBlockers.length === 0
    && input.groundingBlockers.length === 0
    && !hasCapabilityAction;
  const blockerList = uniqueCompact([
    compactBridgeFailure ? PHOTOSHOP_SAVE_FOR_WEB_BLOCKER : null,
    ...input.visibleWarnings,
    ...input.preflightBlockers,
    ...(completedWithoutActionableIssues ? [] : input.preflightWarnings),
    ...input.groundingBlockers,
    ...capabilityBlockers,
  ], 8);
  const hasRecoverableProblem = input.outcomeStatus !== 'completed'
    || input.visibleWarnings.length > 0
    || input.preflightBlockers.length > 0
    || input.groundingBlockers.length > 0;
  const shouldRecoverOutcome = !input.suppressGenericRecovery
    && !compactBridgeFailure
    && hasRecoverableProblem;
  const statePhase = input.capabilityPhase
    || (compactBridgeFailure || input.visibleWarnings.length > 0 || input.outcomeStatus !== 'completed' ? 'blocked' : 'completed');

  return {
    warningBlock,
    blockerList,
    shouldRecoverOutcome,
    statePhase,
    compactUserMessage: compactBridgeFailure ? buildCompactPhotoshopSaveForWebBridgeFailureMessage() : compactImageExportSuccess,
    hideRecoveryDetails: compactBridgeFailure || Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    hideComputerHandoff: compactBridgeFailure || Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    hideComputerTaskStatus: Boolean(compactImageExportSuccess) || completedWithoutActionableIssues,
    nextSteps: compactBridgeFailure ? [PHOTOSHOP_SAVE_FOR_WEB_RECONNECT_STEP] : [],
  };
}
