import { fetchAllMcpTools, callMcpTool, type McpTool } from './mcpClient';
import { loadConnections } from './connectionManager';
import {
  getInstalledIntegrationProviders,
  getCircleIntegrationCapabilities,
  type CircleIntegrationProvider,
} from './circleIntegrations';
import {
  matchKnownApp,
  resolveMacLaunchName,
  renderAppShortcut,
  detectPlatform,
} from './knownAppShortcuts';
import {
  detectLocalComputerAwarenessIntent,
  detectLocalComputerAwarenessIntentSequence,
  renderLocalComputerAwarenessIntent,
  type LocalComputerAwarenessIntent,
} from './localComputerAwarenessIntent';
import {
  buildInDesignRecoveryCandidatesForIntent,
  isInDesignIntent,
} from './indesignRecovery';
import {
  isDesktopBridgeAvailable,
  launchApp as bridgeLaunchApp,
  focusApp as bridgeFocusApp,
  manageWindow as bridgeManageWindow,
  mouseMove as bridgeMouseMove,
  mouseClick as bridgeMouseClick,
  mouseDown as bridgeMouseDown,
  mouseUp as bridgeMouseUp,
  mouseDrag as bridgeMouseDrag,
  mouseScroll as bridgeMouseScroll,
  takeScreenshot as bridgeTakeScreenshot,
  getScreenSize as bridgeGetScreenSize,
  openUrl as bridgeOpenUrl,
  openPath as bridgeOpenPath,
  searchFiles as bridgeSearchFiles,
  statFile as bridgeStatFile,
  copyFile as bridgeCopyFile,
  writeClipboard as bridgeWriteClipboard,
  clearClipboard as bridgeClearClipboard,
  createNote as bridgeCreateNote,
  getWindowState as bridgeGetWindowState,
  readA11yTree as bridgeReadA11yTree,
  clickElement as bridgeClickElement,
  setElementValue as bridgeSetElementValue,
  typeText as bridgeTypeText,
  pasteText as bridgePasteText,
  pressKeys as bridgePressKeys,
  clickMenu as bridgeClickMenu,
  indesignFindChange as bridgeInDesignFindChange,
  indesignBatchFindChange as bridgeInDesignBatchFindChange,
  indesignDocumentStatus as bridgeInDesignDocumentStatus,
  indesignTextInventory as bridgeInDesignTextInventory,
  indesignSetLayerState as bridgeInDesignSetLayerState,
  indesignBatchUpdateTextLayers as bridgeInDesignBatchUpdateTextLayers,
  indesignUpdateTextLayer as bridgeInDesignUpdateTextLayer,
  indesignRelinkAsset as bridgeInDesignRelinkAsset,
  indesignPackageDocument as bridgeInDesignPackageDocument,
  indesignExportProof as bridgeInDesignExportProof,
  photoshopDocumentStatus as bridgePhotoshopDocumentStatus,
  photoshopLayerInventory as bridgePhotoshopLayerInventory,
  photoshopSetLayerState as bridgePhotoshopSetLayerState,
  photoshopUpdateTextLayer as bridgePhotoshopUpdateTextLayer,
  photoshopPlaceAsset as bridgePhotoshopPlaceAsset,
  photoshopExportProof as bridgePhotoshopExportProof,
  waitForApp as bridgeWaitForApp,
  observeApp as bridgeObserveApp,
  observeNativeSemanticActionTarget as bridgeObserveNativeSemanticActionTarget,
  performNativeSemanticAction as bridgePerformNativeSemanticAction,
  ensureDesktopBridgePaired,
  type A11yNode,
  type DesktopFileStat,
  type ObserveAppData,
  type NativeSemanticActionExecution,
  type NativeSemanticActionTarget,
} from './desktopBridge';
import {
  detectBlockingAppModalPlan,
  type BlockingAppModalPlan,
} from './desktopBlockingModals';
import {
  buildDesktopAIModalDecisionPrompt,
  decideDesktopAIModalAction,
  extractDesktopAIModalObservation,
  parseDesktopAIModalCandidate,
  validateDesktopAIModalCandidate,
  type DesktopAIModalDecision,
} from './desktopAIModalAdvisor';
import { callBlackSwan } from './blackswanLLM';
import {
  findPreferredSaveForWebFormatControl,
  findPreferredSaveForWebFormatOption,
  findPreferredSaveExtensionMismatchButton,
  findPreferredSaveReplaceExistingButton,
  isStatableLocalSavePath,
  normalizeFileExtension,
  normalizeSaveForWebTargetFormat,
  saveDialogVisibleText,
  treeShowsSaveForWebTargetFormat,
  treeLooksLikeSaveExtensionMismatchDialog,
  treeLooksLikeSaveReplaceExistingDialog,
  type SaveForWebTargetFormat,
} from './computerAppSaveDialogs';
import {
  appendSurfaceEscalation,
  buildAppleNotesCreateNoteRecipe,
  buildAppleNotesCreateNoteSequence,
  buildAppAutomationControlSurfacePlan,
  extractSurfaceFailureSignal,
  planSurfaceEscalation,
  serializeAppAutomationRecipe,
  type AppAutomationControlSurfaceCandidate,
  type AppAutomationRecipe,
  type ComputerTaskSurfaceEscalation,
  type SurfaceCapabilityStatus,
  type SurfaceEscalationDecision,
} from './appAutomationControlSurfaces';
import { hasTerminalDesktopSequenceCompletionProof } from './computerTaskOutcome';

export interface ComputerAppAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
  /** E1: escalation decision attached when a failure consulted the surface-escalation policy. */
  surfaceEscalation?: SurfaceEscalationDecision;
  /** E1: bounded (≤3) escalation breadcrumbs recorded for this run. */
  surfaceEscalations?: ComputerTaskSurfaceEscalation[];
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export type NativeAppActivationKind = 'launch_app' | 'focus_app';

export type NativeAppActivationObservation = {
  app: string;
  requestedAppName?: string | null;
  resolvedAppName?: string;
  pid?: number;
  processIdentityVersion?: number;
  indexGeneration?: number;
  appRunning: boolean;
  frontmost: boolean;
  windowCount: number;
};

export type NativeAppActivationBridgeResult<T> = {
  ok: boolean;
  error?: string;
  errorCode?: string;
  data?: T;
};

function normalizeNativeBridgeErrorCode(
  value: unknown,
  fallback = 'unknown',
): string {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,63}$/.test(normalized)
    ? normalized
    : fallback;
}

function renderNativeBridgeFailure(errorCode: unknown): string {
  return `local bridge error (${normalizeNativeBridgeErrorCode(errorCode)})`;
}

export type NativeAppActivationDispatch = {
  appName: string;
  requestedAppName?: string;
  resolvedAppName?: string;
};

export type NativeAppActivationDeps = {
  observeApp: (args: {
    appName?: string;
    maxDepth?: number;
    maxNodes?: number;
  }) => Promise<NativeAppActivationBridgeResult<NativeAppActivationObservation>>;
  launchApp: (appName: string) => Promise<NativeAppActivationBridgeResult<NativeAppActivationDispatch>>;
  focusApp: (appName: string) => Promise<NativeAppActivationBridgeResult<NativeAppActivationDispatch>>;
  waitForApp?: (
    appName: string,
    timeoutMs?: number,
  ) => Promise<NativeAppActivationBridgeResult<{ appName: string; elapsedMs: number }>>;
  now?: () => string;
};

export type NativeOpenPathApprovalProposal = {
  schemaVersion: 1;
  operation: 'native_open_path';
  targetFingerprint: string;
  targetKind: 'file' | 'directory';
  evidenceId: string;
  observedAt: string;
  targetSummary: 'one exact local file or folder';
  approvalRequired: true;
  risk: 'medium';
};

export type NativeOpenPathApprovalDecision = {
  approved: boolean;
  /** Runtime-issued approval receipt; never a model assertion. */
  approvalId?: string;
  reason?: string;
};

export type NativeOpenPathDispatchRequest = {
  /** Transient exact path. Callers must never persist or render this value. */
  path: string;
  targetFingerprint: string;
  approvalId: string;
};

export type NativeOpenPathDispatchResult = NativeAppActivationBridgeResult<{
  /** Exact bridge echo used only inside the sealed adapter. */
  path: string;
  /** Resolved explicit app when the bridge has one; null for the default app. */
  appName: string | null;
}> & {
  /** True only after the durable dispatch boundary was entered. */
  mutationAttempted: boolean;
  /** Conservative runtime verdict for a missing or ambiguous dispatch receipt. */
  outcomeUnknown: boolean;
};

export type NativeOpenPathDeps = {
  statFile: (path: string) => Promise<NativeAppActivationBridgeResult<DesktopFileStat>>;
  observeApp: (args: {
    appName?: string;
    maxDepth?: number;
    maxNodes?: number;
    target?: string;
  }) => Promise<NativeAppActivationBridgeResult<ObserveAppData>>;
  fingerprint: (value: unknown) => Promise<string | null>;
  approvalGate: (
    proposal: NativeOpenPathApprovalProposal,
  ) => Promise<NativeOpenPathApprovalDecision>;
  /**
   * The OpenSwan runtime implementation claims the durable action first and
   * advances it to dispatched immediately before its sole openPath call.
   */
  dispatchOpenPath: (
    request: NativeOpenPathDispatchRequest,
  ) => Promise<NativeOpenPathDispatchResult>;
  now?: () => string;
};

export type BoundedNativeOpenPathObservation = {
  observedAt: string;
  appFingerprint: string;
  pid: number;
  appRunning: boolean;
  frontmost: boolean;
  windowCount: number;
  targetEvidenceMatched: boolean;
  evidenceFingerprint: string;
};

export type NativeSemanticActionRequest = {
  action: 'press';
  appName: string;
  /** Positive PID bound by the caller's preceding model-visible observation. */
  expectedPid: number;
  /** Exact dotted AX path from the same fresh observation. */
  targetPath: string;
  expectedRole: string;
  expectedLabel: string;
};

export type NativeSemanticActionApprovalProposal = {
  schemaVersion: 1;
  operation: 'native_semantic_press';
  action: 'press';
  app: string;
  pid: number;
  targetRole: string;
  targetFingerprint: string;
  evidenceId: string;
  /** Privacy-safe epoch from the sealed accessibility observation. */
  observedAt: string;
  /** Positive tree generation bound to the exact sealed observation. */
  indexGeneration: number;
  targetSummary: string;
  approvalRequired: true;
  risk: 'medium';
  expiresAt: string;
};

export type NativeSemanticActionApprovalDecision = {
  approved: boolean;
  /** Runtime-issued approval receipt; never the model's own assertion. */
  approvalId?: string;
  reason?: string;
};

export type NativeSemanticActionDeps = {
  observeApp: (args: {
    appName?: string;
    maxDepth?: number;
    maxNodes?: number;
    target?: string;
  }) => Promise<NativeAppActivationBridgeResult<ObserveAppData>>;
  observeSemanticActionTarget: (args: {
    action: 'press';
    appName: string;
    pid: number;
    indexGeneration: number;
    targetPath: string;
    expectedRole: string;
    expectedLabel: string;
  }) => Promise<NativeAppActivationBridgeResult<NativeSemanticActionTarget>>;
  performSemanticAction: (args: {
    targetId: string;
    targetFingerprint: string;
    approvalId: string;
  }) => Promise<NativeAppActivationBridgeResult<NativeSemanticActionExecution>>;
  approvalGate: (
    proposal: NativeSemanticActionApprovalProposal,
  ) => Promise<NativeSemanticActionApprovalDecision>;
};

export type BoundedNativeAppObservation = {
  observedAt: string;
  app: string;
  resolvedAppName: string;
  pid: number;
  indexGeneration?: number;
  appRunning: boolean;
  frontmost: boolean;
  windowCount: number;
  targetMatched: boolean;
};

function normalizedAppIdentity(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\.app$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function versionStrippedNativeAppIdentity(value: unknown): string {
  return normalizedAppIdentity(value)
    .replace(/\b(20\d{2}|19\d{2}|v?\d+(?:\.\d+){0,3})\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NATIVE_APP_EXPLICIT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['chrome', 'google chrome'],
  ['edge', 'microsoft edge'],
  ['zoom', 'zoom us'],
  ['vscode', 'visual studio code'],
  ['photoshop', 'adobe photoshop'],
  ['indesign', 'adobe indesign'],
  ['illustrator', 'adobe illustrator'],
  ['premiere', 'premiere pro', 'adobe premiere pro'],
  ['after effects', 'adobe after effects'],
  ['acrobat', 'adobe acrobat'],
  ['word', 'microsoft word'],
  ['excel', 'microsoft excel'],
  ['powerpoint', 'microsoft powerpoint'],
  ['outlook', 'microsoft outlook'],
  ['teams', 'microsoft teams'],
  ['onenote', 'microsoft onenote'],
];

function exactOrExplicitNativeAppAliasMatches(
  observedValue: unknown,
  expectedValue: unknown,
): boolean {
  const observed = normalizedAppIdentity(observedValue);
  const expected = normalizedAppIdentity(expectedValue);
  if (!observed || !expected) return false;
  if (observed === expected) return true;
  const observedNoVersion = versionStrippedNativeAppIdentity(observedValue);
  const expectedNoVersion = versionStrippedNativeAppIdentity(expectedValue);
  if (observedNoVersion && observedNoVersion === expectedNoVersion) return true;
  return NATIVE_APP_EXPLICIT_ALIAS_GROUPS.some(
    (group) => group.includes(observedNoVersion) && group.includes(expectedNoVersion),
  );
}

function resolveInitialNativeAppIdentity(
  value: NativeAppActivationObservation,
  requestedName: string,
): string | null {
  const app = String(value.app || '').trim().slice(0, 120);
  const requestedEcho = String(value.requestedAppName || '').trim().slice(0, 120);
  const resolved = String(value.resolvedAppName || '').trim().slice(0, 120);
  if (requestedEcho && normalizedAppIdentity(requestedEcho) !== normalizedAppIdentity(requestedName)) {
    return null;
  }
  if (resolved) {
    if (!app || normalizedAppIdentity(app) !== normalizedAppIdentity(resolved)) return null;
    if (!exactOrExplicitNativeAppAliasMatches(resolved, requestedName)) return null;
    return resolved;
  }
  return exactOrExplicitNativeAppAliasMatches(app, requestedName) ? app : null;
}

function boundedNativeAppObservation(
  value: NativeAppActivationObservation,
  expectedResolvedApp: string,
  observedAt: string,
  expectedPid?: number,
  expectedRequestedApp: string = expectedResolvedApp,
): BoundedNativeAppObservation {
  const app = String(value.app || '').trim().slice(0, 120);
  const resolvedAppName = String(value.resolvedAppName || app).trim().slice(0, 120);
  const requestedEcho = String(value.requestedAppName || '').trim().slice(0, 120);
  const pid = Math.max(0, Math.trunc(Number(value.pid || 0)));
  const indexGeneration = Math.max(0, Math.trunc(Number(value.indexGeneration || 0))) || undefined;
  const identityMatches = (
    normalizedAppIdentity(app) === normalizedAppIdentity(expectedResolvedApp)
    && normalizedAppIdentity(resolvedAppName) === normalizedAppIdentity(expectedResolvedApp)
    && (!requestedEcho || normalizedAppIdentity(requestedEcho) === normalizedAppIdentity(expectedRequestedApp))
    && (value.appRunning !== true || pid > 0)
    && (!(Number(expectedPid) > 0) || pid === expectedPid)
  );
  return {
    observedAt,
    app,
    resolvedAppName,
    pid,
    ...(indexGeneration ? { indexGeneration } : {}),
    appRunning: value.appRunning === true,
    frontmost: value.frontmost === true,
    windowCount: Number.isFinite(Number(value.windowCount))
      ? Math.max(0, Math.min(10_000, Math.floor(Number(value.windowCount))))
      : 0,
    targetMatched: identityMatches,
  };
}

function nativeAppPostconditionSatisfied(
  kind: NativeAppActivationKind,
  observation: BoundedNativeAppObservation,
): boolean {
  return observation.targetMatched
    && observation.appRunning
    && (kind === 'launch_app' || observation.frontmost);
}

function normalizeNativeOpenPathEvidence(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function nativeOpenPathBasename(value: unknown): string | null {
  const clean = String(value || '').trim().replace(/[\\/]+$/, '');
  if (!clean) return null;
  const basename = clean.split(/[\\/]/).filter(Boolean).pop() || '';
  if (
    !basename
    || basename === '.'
    || basename === '..'
    || basename.length > 240
    || /[\u0000-\u001f\u007f]/.test(basename)
  ) {
    return null;
  }
  return basename;
}

function nativeOpenPathErrorCode(value: unknown, fallback = 'unknown'): string {
  const code = String(value || '').trim().toLowerCase();
  return [
    'invalid_input',
    'path_not_found',
    'file_access_not_granted',
    'uncertain_ui_target',
    'stale_bridge',
    'bridge_offline',
    'approval_required',
    'native_open_path_verification_failed',
  ].includes(code)
    ? code
    : fallback;
}

async function safeNativeOpenPathFingerprint(
  fingerprint: NativeOpenPathDeps['fingerprint'],
  value: unknown,
): Promise<string | null> {
  try {
    const result = await fingerprint(value);
    return result && /^[a-f0-9]{64}$/.test(result) ? result : null;
  } catch {
    return null;
  }
}

function nativeOpenPathEvidenceMatchesTarget(
  candidateInput: unknown,
  targetNameInput: string,
): boolean {
  const candidate = normalizeNativeOpenPathEvidence(candidateInput);
  const targetName = normalizeNativeOpenPathEvidence(targetNameInput);
  if (!candidate || !targetName) return false;
  if (candidate === targetName) return true;
  if (!candidate.startsWith(targetName)) return false;
  const after = candidate[targetName.length] || '';
  // Exact basename occurrence only: reject look-alike prefixes/suffixes such
  // as report.pdf.exe or my-report.pdf. Only standard app-title delimiters
  // remain acceptable after the exact name (for example
  // "report.pdf — Preview").
  return !after || /[\s—–\-|•·(\[]/u.test(after);
}

function findNativeOpenPathEvidence(
  observation: ObserveAppData,
  targetName: string,
): string | null {
  for (const title of (observation.windowTitles || []).slice(0, 8)) {
    if (nativeOpenPathEvidenceMatchesTarget(title, targetName)) return title;
  }
  const stack: A11yNode[] = observation.tree ? [observation.tree] : [];
  let visited = 0;
  while (stack.length > 0 && visited < 400) {
    const node = stack.shift()!;
    visited += 1;
    for (const candidate of [node.label, node.value]) {
      if (nativeOpenPathEvidenceMatchesTarget(candidate, targetName)) {
        return String(candidate || '');
      }
    }
    for (const child of (node.children || []).slice(0, 80)) stack.push(child);
  }
  return null;
}

async function boundedNativeOpenPathObservation(
  value: ObserveAppData,
  observedAt: string,
  targetName: string,
  fingerprint: NativeOpenPathDeps['fingerprint'],
): Promise<BoundedNativeOpenPathObservation | null> {
  const app = String(value.resolvedAppName || value.app || '').trim().slice(0, 120);
  const pid = Math.max(0, Math.trunc(Number(value.pid || 0)));
  const frontmostApp = String(value.frontmostApp || '').trim().slice(0, 120);
  if (
    !app
    || value.appRunning !== true
    || value.frontmost !== true
    || !(pid > 0)
    || (frontmostApp && !exactOrExplicitNativeAppAliasMatches(frontmostApp, app))
    || !Number.isFinite(Date.parse(observedAt))
  ) {
    return null;
  }
  const targetEvidence = findNativeOpenPathEvidence(value, targetName);
  const appFingerprint = await safeNativeOpenPathFingerprint(fingerprint, {
    schemaVersion: 1,
    kind: 'native_app_process',
    app,
    pid,
  });
  const evidenceFingerprint = targetEvidence
    ? await safeNativeOpenPathFingerprint(fingerprint, {
        schemaVersion: 1,
        kind: 'native_open_path_evidence',
        app,
        pid,
        targetEvidence,
      })
    : null;
  if (
    !appFingerprint
    || !evidenceFingerprint
  ) {
    return null;
  }
  return {
    observedAt,
    appFingerprint,
    pid,
    appRunning: true,
    frontmost: true,
    windowCount: Number.isFinite(Number(value.windowCount))
      ? Math.max(0, Math.min(10_000, Math.floor(Number(value.windowCount))))
      : 0,
    targetEvidenceMatched: true,
    evidenceFingerprint,
  };
}

function nativeOpenPathFailureData(
  phase: string,
  errorCode: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'desktop_open_path',
    operation: 'native_open_path',
    phase,
    errorCode,
    completionVerified: false,
    outcomeUnknown: false,
    outcomeUnknownPolicy: 'never_retry',
    replayAllowed: false,
    ...extra,
  };
}

/**
 * Fresh stat + frontmost observation → exact-call approval → one durable
 * dispatch callback → fresh frontmost observation with exact basename proof.
 *
 * Raw paths, app names, window titles, accessibility text, and bridge errors
 * remain transient. The returned proof contains only bounded booleans, counts,
 * process ids, and cryptographic fingerprints.
 */
export async function executeObservedNativeOpenPath(
  pathInput: string,
  deps: NativeOpenPathDeps,
): Promise<ComputerAppAdapterResult> {
  const requestedPath = String(pathInput || '').trim();
  const now = deps.now || (() => new Date().toISOString());
  if (
    !requestedPath
    || requestedPath.length > 2_048
    || /[\u0000-\u001f\u007f]/.test(requestedPath)
  ) {
    return {
      ok: false,
      message: 'I stopped before observing the local target because the exact path identity was invalid.',
      warnings: ['native open path blocked before observation: invalid target identity'],
      data: nativeOpenPathFailureData('input', 'invalid_input'),
    };
  }

  let statResult: NativeAppActivationBridgeResult<DesktopFileStat>;
  try {
    statResult = await deps.statFile(requestedPath);
  } catch {
    statResult = { ok: false, errorCode: 'unknown' };
  }
  const stat = statResult.data;
  const resolvedPath = String(stat?.path || '').trim();
  const targetName = nativeOpenPathBasename(resolvedPath);
  if (
    !statResult.ok
    || !stat
    || stat.exists !== true
    || (stat.kind !== 'file' && stat.kind !== 'directory')
    || !resolvedPath
    || !targetName
  ) {
    return {
      ok: false,
      message: 'I stopped before approval because a fresh exact file/folder stat was unavailable.',
      warnings: ['native open path blocked before mutation: exact target stat unavailable'],
      data: nativeOpenPathFailureData(
        'file_observation',
        nativeOpenPathErrorCode(
          statResult.errorCode,
          stat?.exists === false ? 'path_not_found' : 'uncertain_ui_target',
        ),
      ),
    };
  }

  let beforeResult: NativeAppActivationBridgeResult<ObserveAppData>;
  try {
    beforeResult = await deps.observeApp({ maxDepth: 1, maxNodes: 1 });
  } catch {
    beforeResult = { ok: false, errorCode: 'unknown' };
  }
  const before = beforeResult.data;
  const beforeApp = String(before?.resolvedAppName || before?.app || '').trim().slice(0, 120);
  const beforePid = Math.max(0, Math.trunc(Number(before?.pid || 0)));
  if (
    !beforeResult.ok
    || !before
    || before.appRunning !== true
    || before.frontmost !== true
    || !beforeApp
    || !(beforePid > 0)
  ) {
    return {
      ok: false,
      message: 'I stopped before approval because a fresh frontmost-app observation was unavailable.',
      warnings: ['native open path blocked before mutation: frontmost observation unavailable'],
      data: nativeOpenPathFailureData(
        'before_observation',
        nativeOpenPathErrorCode(beforeResult.errorCode, 'uncertain_ui_target'),
      ),
    };
  }

  const observedAt = now();
  const targetFingerprint = await safeNativeOpenPathFingerprint(deps.fingerprint, {
    schemaVersion: 1,
    operation: 'native_open_path',
    requestedPath,
    resolvedPath,
    kind: stat.kind,
    size: stat.size,
    modifiedAt: stat.modifiedAt,
  });
  const beforeAppFingerprint = await safeNativeOpenPathFingerprint(deps.fingerprint, {
    schemaVersion: 1,
    kind: 'native_app_process',
    app: beforeApp,
    pid: beforePid,
  });
  const evidenceId = targetFingerprint && beforeAppFingerprint
    ? await safeNativeOpenPathFingerprint(deps.fingerprint, {
        schemaVersion: 1,
        operation: 'native_open_path_observation',
        targetFingerprint,
        beforeAppFingerprint,
        observedAt,
      })
    : null;
  if (
    !targetFingerprint
    || !beforeAppFingerprint
    || !evidenceId
    || !Number.isFinite(Date.parse(observedAt))
  ) {
    return {
      ok: false,
      message: 'I stopped before approval because cryptographic target binding was unavailable.',
      warnings: ['native open path blocked before mutation: target binding unavailable'],
      data: nativeOpenPathFailureData('target_binding', 'invalid_input'),
    };
  }

  const proposal: NativeOpenPathApprovalProposal = {
    schemaVersion: 1,
    operation: 'native_open_path',
    targetFingerprint,
    targetKind: stat.kind,
    evidenceId,
    observedAt,
    targetSummary: 'one exact local file or folder',
    approvalRequired: true,
    risk: 'medium',
  };
  let approval: NativeOpenPathApprovalDecision;
  try {
    approval = await deps.approvalGate(proposal);
  } catch {
    approval = { approved: false, reason: 'approval gate unavailable' };
  }
  const approvalId = String(approval.approvalId || '').trim();
  if (
    !approval.approved
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalId)
  ) {
    return {
      ok: false,
      message: approval.approved
        ? 'I did not open the local target because the approval gate returned no valid runtime receipt.'
        : 'The exact local open action is awaiting live runtime approval. Nothing was opened.',
      warnings: ['native open path not dispatched: approval required'],
      data: nativeOpenPathFailureData('approval', 'approval_required', {
        approvalRequired: true,
        approvalGranted: false,
        mutationAttempted: false,
      }),
    };
  }

  let dispatched: NativeOpenPathDispatchResult;
  try {
    // Exactly one dispatch callback. The runtime implementation advances the
    // durable row immediately before its one and only bridge openPath call.
    dispatched = await deps.dispatchOpenPath({
      path: resolvedPath,
      targetFingerprint,
      approvalId,
    });
  } catch {
    dispatched = {
      ok: false,
      mutationAttempted: true,
      outcomeUnknown: true,
      errorCode: 'unknown',
    };
  }
  if ((!dispatched.ok || !dispatched.data) && !dispatched.mutationAttempted) {
    const outcomeUnknown = dispatched.outcomeUnknown || dispatched.mutationAttempted;
    return {
      ok: false,
      message: outcomeUnknown
        ? 'The approved local open call crossed the dispatch boundary without exact completion proof. Its outcome is unknown and it will not be replayed.'
        : 'The approved local open call stopped before dispatch. Nothing was opened.',
      warnings: [
        outcomeUnknown
          ? 'native open path outcome unknown; never replay automatically'
          : 'native open path blocked before bridge dispatch',
      ],
      data: nativeOpenPathFailureData(
        outcomeUnknown ? 'dispatch' : 'before_dispatch',
        nativeOpenPathErrorCode(dispatched.errorCode),
        {
          mutationAttempted: dispatched.mutationAttempted,
          outcomeUnknown,
        },
      ),
    };
  }

  const dispatchAcknowledged = dispatched.ok === true && Boolean(dispatched.data);
  const dispatchPathMatched = dispatchAcknowledged
    && String(dispatched.data?.path || '') === resolvedPath;
  // `open` acknowledges before a cold default app necessarily publishes its
  // first window. This is one bounded settle barrier, not a mutation or
  // observation retry; the following observeApp call remains the sole
  // post-action proof attempt.
  await sleep(900);
  let afterResult: NativeAppActivationBridgeResult<ObserveAppData>;
  try {
    afterResult = await deps.observeApp({
      maxDepth: 10,
      maxNodes: 400,
      target: targetName,
    });
  } catch {
    afterResult = { ok: false, errorCode: 'unknown' };
  }
  const afterRaw = afterResult.data;
  const afterObservedAt = now();
  const after = afterResult.ok && afterRaw
    ? await boundedNativeOpenPathObservation(
        afterRaw,
        afterObservedAt,
        targetName,
        deps.fingerprint,
      )
    : null;
  const explicitDispatchApp = String(dispatched.data?.appName || '').trim();
  const explicitAppMatched = !explicitDispatchApp || (
    !!afterRaw
    && exactOrExplicitNativeAppAliasMatches(
      afterRaw.resolvedAppName || afterRaw.app,
      explicitDispatchApp,
    )
  );
  const completionVerified = Boolean(
    dispatchPathMatched
    && dispatchAcknowledged
    && explicitAppMatched
    && after
    && after.targetEvidenceMatched
  );
  const proof = {
    schemaVersion: 1,
    operation: 'native_open_path',
    targetFingerprint,
    evidenceId,
    requestedPostcondition: 'frontmost_app_contains_exact_target_evidence',
    mutationAttempted: true,
    mutationPerformed: completionVerified,
    dispatchAcknowledged,
    dispatchTargetMatched: dispatchPathMatched,
    explicitAppMatched,
    completionVerified,
    outcomeUnknown: !completionVerified,
    outcomeUnknownPolicy: 'never_retry',
    replayAllowed: false,
    before: {
      observedAt,
      appFingerprint: beforeAppFingerprint,
      pid: beforePid,
      appRunning: true,
      frontmost: true,
      windowCount: Math.max(0, Math.min(10_000, Math.floor(Number(before.windowCount || 0)))),
    },
    after,
  };

  if (!completionVerified) {
    return {
      ok: false,
      message: 'The bridge accepted the exact local open call, but a fresh frontmost-app observation did not prove the exact file/folder target. The outcome is unknown and the call will not be replayed.',
      warnings: ['native open path failed closed: exact post-open target proof missing'],
      data: nativeOpenPathFailureData('after_observation', 'native_open_path_verification_failed', {
        mutationAttempted: true,
        outcomeUnknown: true,
        proof,
      }),
    };
  }

  return {
    ok: true,
    message: 'Opened and verified the exact approved local target in the frontmost app.',
    warnings: [],
    data: {
      kind: 'desktop_open_path',
      operation: 'native_open_path',
      phase: 'completed',
      approvalRequired: true,
      approvalGranted: true,
      mutationAttempted: true,
      completionVerified: true,
      outcomeUnknown: false,
      outcomeUnknownPolicy: 'never_retry',
      replayAllowed: false,
      proof,
    },
  };
}

/**
 * Observe-first, proof-bearing launch/focus lane.
 *
 * This deliberately projects observations onto a bounded shape. Window
 * titles and accessibility content never leave desktopBridge through this
 * result. A dispatch acknowledgement is progress only; completion requires a
 * second fresh observation of the requested running/frontmost postcondition.
 */
export async function executeObservedNativeAppActivation(
  kind: NativeAppActivationKind,
  requestedNameInput: string,
  deps: NativeAppActivationDeps,
): Promise<ComputerAppAdapterResult> {
  const requestedName = String(requestedNameInput || '').trim().slice(0, 120);
  const resultKind = kind === 'focus_app' ? 'desktop_bridge_focus' : 'desktop_bridge_launch';
  const actionVerb = kind === 'focus_app' ? 'focus' : 'launch';
  const completedVerb = kind === 'focus_app' ? 'Focused' : 'Launched';
  const requestedPostcondition = kind === 'focus_app' ? 'running_and_frontmost' : 'running';
  const now = deps.now || (() => new Date().toISOString());
  if (
    !requestedName
    || !/^[A-Za-z0-9 .\-_()]+$/.test(requestedName)
  ) {
    return {
      ok: false,
      message: `I stopped before trying to ${actionVerb} the app because its exact name was missing or invalid.`,
      warnings: ['desktop app activation blocked before observation: invalid app identity'],
      data: {
        kind: 'desktop_bridge_error',
        operation: kind,
        phase: 'input',
        errorCode: 'invalid_input',
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
      },
    };
  }

  let beforeResult: NativeAppActivationBridgeResult<NativeAppActivationObservation>;
  try {
    beforeResult = await deps.observeApp({
      appName: requestedName,
      maxDepth: 1,
      maxNodes: 1,
    });
  } catch {
    beforeResult = {
      ok: false,
      errorCode: 'bridge_exception',
    };
  }
  if (!beforeResult.ok || !beforeResult.data) {
    const beforeErrorCode = normalizeNativeBridgeErrorCode(beforeResult.errorCode);
    return {
      ok: false,
      message: `I stopped before trying to ${actionVerb} **${requestedName}** because a fresh pre-action app observation was unavailable: ${renderNativeBridgeFailure(beforeErrorCode)}.`,
      warnings: ['desktop app activation blocked before mutation: fresh observation unavailable'],
      data: {
        kind: 'desktop_bridge_error',
        operation: kind,
        phase: 'before_observation',
        errorCode: beforeErrorCode,
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
      },
    };
  }

  const resolvedName = resolveInitialNativeAppIdentity(beforeResult.data, requestedName);
  const before = boundedNativeAppObservation(
    beforeResult.data,
    resolvedName || requestedName,
    now(),
    undefined,
    requestedName,
  );
  if (!resolvedName || !before.targetMatched) {
    return {
      ok: false,
      message: `I stopped before trying to ${actionVerb} **${requestedName}** because the fresh observation resolved to a different app target.`,
      warnings: ['desktop app activation blocked before mutation: observed target mismatch'],
      data: {
        kind: 'desktop_bridge_error',
        operation: kind,
        phase: 'before_observation',
        errorCode: 'uncertain_ui_target',
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
        proof: {
          schemaVersion: 1,
          operation: kind,
          requestedName,
          resolvedAppName: resolvedName,
          requestedPostcondition,
          mutationNeeded: null,
          mutationAttempted: false,
          mutationPerformed: false,
          dispatchAcknowledged: false,
          completionVerified: false,
          outcomeUnknown: false,
          outcomeUnknownPolicy: 'verify_before_retry',
          replayAllowed: false,
          before,
          after: null,
        },
      },
    };
  }

  if (kind === 'focus_app' && !before.appRunning) {
    return {
      ok: false,
      message: `I did not try to focus **${resolvedName}** because a fresh observation confirmed it is not running. Launch it first.`,
      warnings: ['desktop focus blocked before mutation: app is not running'],
      data: {
        kind: 'desktop_bridge_error',
        operation: kind,
        phase: 'before_observation',
        errorCode: 'app_not_running',
        displayName: resolvedName,
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
        outcomeUnknown: false,
        proof: {
          schemaVersion: 1,
          operation: kind,
          requestedName,
          resolvedAppName: resolvedName,
          requestedPostcondition,
          mutationNeeded: false,
          mutationAttempted: false,
          mutationPerformed: false,
          dispatchAcknowledged: false,
          dispatchTargetMatched: false,
          completionVerified: false,
          outcomeUnknown: false,
          outcomeUnknownPolicy: 'verify_before_retry',
          replayAllowed: false,
          before,
          after: null,
        },
      },
    };
  }

  const mutationNeeded = !nativeAppPostconditionSatisfied(kind, before);
  let dispatchResult: NativeAppActivationBridgeResult<NativeAppActivationDispatch> | null = null;
  if (mutationNeeded) {
    try {
      dispatchResult = kind === 'focus_app'
        ? await deps.focusApp(resolvedName)
        : await deps.launchApp(resolvedName);
    } catch {
      dispatchResult = {
        ok: false,
        errorCode: 'bridge_exception',
      };
    }
  }

  const dispatchName = String(dispatchResult?.data?.appName || '').trim().slice(0, 120);
  const dispatchResolvedName = String(dispatchResult?.data?.resolvedAppName || '').trim().slice(0, 120);
  const dispatchRequestedName = String(dispatchResult?.data?.requestedAppName || '').trim().slice(0, 120);
  const dispatchTargetMatched = !mutationNeeded || (
    !!dispatchName
    && !!dispatchResolvedName
    && !!dispatchRequestedName
    && normalizedAppIdentity(dispatchName) === normalizedAppIdentity(resolvedName)
    && normalizedAppIdentity(dispatchResolvedName) === normalizedAppIdentity(resolvedName)
    && normalizedAppIdentity(dispatchRequestedName) === normalizedAppIdentity(resolvedName)
  );
  const displayName = resolvedName;
  if (
    kind === 'launch_app'
    && dispatchResult?.ok
    && dispatchTargetMatched
    && deps.waitForApp
  ) {
    // `open -a` acknowledges before slower apps publish a process/window.
    // This is only a bounded readiness barrier; the following observeApp
    // call remains the source of completion proof.
    await deps.waitForApp(resolvedName, 8_000).catch(() => null);
  }
  let afterResult: NativeAppActivationBridgeResult<NativeAppActivationObservation>;
  try {
    afterResult = await deps.observeApp({
      appName: resolvedName,
      maxDepth: 1,
      maxNodes: 1,
    });
  } catch {
    afterResult = {
      ok: false,
      errorCode: 'bridge_exception',
    };
  }

  const after = afterResult.ok && afterResult.data
    ? boundedNativeAppObservation(
        afterResult.data,
        resolvedName,
        now(),
        before.appRunning ? before.pid : undefined,
      )
    : null;
  const dispatchAcknowledged = mutationNeeded ? dispatchResult?.ok === true : false;
  const afterPostconditionVerified = after !== null && nativeAppPostconditionSatisfied(kind, after);
  const completionVerified = afterPostconditionVerified && (
    !mutationNeeded || (dispatchAcknowledged && dispatchTargetMatched)
  );
  const outcomeUnknown = mutationNeeded && !completionVerified;
  const proof = {
    schemaVersion: 1,
    operation: kind,
    requestedName,
    resolvedAppName: resolvedName,
    requestedPostcondition,
    mutationNeeded,
    mutationAttempted: mutationNeeded,
    mutationPerformed: mutationNeeded && dispatchAcknowledged && dispatchTargetMatched && completionVerified,
    dispatchAcknowledged,
    dispatchTargetMatched,
    completionVerified,
    outcomeUnknown,
    outcomeUnknownPolicy: 'verify_before_retry',
    replayAllowed: false,
    before,
    after,
  };

  if (mutationNeeded && !dispatchAcknowledged) {
    const dispatchErrorCode = normalizeNativeBridgeErrorCode(dispatchResult?.errorCode);
    return {
      ok: false,
      message: `I could not ${actionVerb} **${requestedName}** through the local bridge: ${renderNativeBridgeFailure(dispatchErrorCode)}.`,
      warnings: [`desktop_action failed with ${dispatchErrorCode}`],
      data: {
        kind: 'desktop_bridge_error',
        operation: kind,
        phase: 'dispatch',
        errorCode: dispatchErrorCode,
        displayName,
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
        outcomeUnknown,
        proof,
      },
    };
  }

  if (mutationNeeded && dispatchAcknowledged && !dispatchTargetMatched) {
    return {
      ok: false,
      message: `The bridge accepted the ${actionVerb} request but returned a different resolved app identity. I stopped without replaying it and could not accept completion for **${resolvedName}**.`,
      warnings: ['desktop app activation failed closed: dispatch target identity changed'],
      data: {
        kind: resultKind,
        operation: kind,
        phase: 'dispatch',
        errorCode: 'uncertain_ui_target',
        displayName,
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
        outcomeUnknown: true,
        proof,
      },
    };
  }

  if (!completionVerified) {
    const missingState = kind === 'focus_app'
      ? 'the requested app running in the frontmost state'
      : 'the requested app running';
    return {
      ok: false,
      message: `${mutationNeeded ? `The bridge accepted the ${actionVerb} request` : `**${requestedName}** initially appeared to satisfy the request`}, but a fresh post-action observation did not confirm ${missingState}.`,
      warnings: ['desktop app activation failed closed: requested postcondition was not verified'],
      data: {
        kind: resultKind,
        operation: kind,
        phase: 'after_observation',
        errorCode: normalizeNativeBridgeErrorCode(
          afterResult.errorCode,
          !after?.targetMatched ? 'uncertain_ui_target' : 'unknown',
        ),
        displayName,
        requestedName,
        capability: 'desktop_action',
        completionVerified: false,
        outcomeUnknown,
        proof,
      },
    };
  }

  const noOpMessage = kind === 'focus_app'
    ? `**${displayName}** was already frontmost; a fresh observation confirmed no focus action was needed.`
    : `**${displayName}** was already running; a fresh observation confirmed no launch action was needed.`;
  return {
    ok: true,
    message: mutationNeeded
      ? `${completedVerb} and verified **${displayName}** via fresh local app observation.`
      : noOpMessage,
    warnings: [],
    data: {
      kind: resultKind,
      operation: kind,
      displayName,
      requestedName,
      capability: 'desktop_action',
      completionVerified: true,
      proof,
    },
  };
}

type ExactNativeSemanticNode = {
  node: A11yNode;
  ancestors: A11yNode[];
  container: A11yNode | null;
};

function normalizeNativeSemanticText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function findExactNativeSemanticNode(
  root: A11yNode,
  targetPath: string,
): ExactNativeSemanticNode | null {
  let match: ExactNativeSemanticNode | null = null;
  const walk = (node: A11yNode, ancestors: A11yNode[], container: A11yNode | null): void => {
    if (match) return;
    const roleKey = normalizeNativeSemanticText(node.role).replace(/[\s_-]+/g, '');
    const nextContainer = /ax(alert|dialog|sheet)/.test(roleKey) ? node : container;
    if (node.id === targetPath) {
      match = { node, ancestors, container: nextContainer };
      return;
    }
    for (const child of node.children || []) walk(child, [...ancestors, node], nextContainer);
  };
  walk(root, [], null);
  return match;
}

function nativeSemanticContext(match: ExactNativeSemanticNode): string {
  const contextNodes = match.container
    ? flattenA11yNodes(match.container).slice(0, 120)
    : [...match.ancestors.slice(-12), match.node];
  return contextNodes
    .map((node) => `${node.label || ''} ${node.value || ''}`)
    .join(' ')
    .slice(0, 2000);
}

function classifyNativeSemanticNode(
  match: ExactNativeSemanticNode,
): { ok: true } | { ok: false; reason: string } {
  const role = normalizeNativeSemanticText(match.node.role).replace(/[\s_-]+/g, '');
  const containerRole = normalizeNativeSemanticText(match.container?.role).replace(/[\s_-]+/g, '');
  const label = normalizeNativeSemanticText(match.node.label);
  const value = normalizeNativeSemanticText(match.node.value);
  const context = normalizeNativeSemanticText(`${label} ${nativeSemanticContext(match)}`).slice(0, 2000);
  const blockedRole = /textfield|textarea|textentry|searchfield|combobox|popupbutton|checkbox|switch|radiobutton|slider|incrementor|disclosuretriangle|securetextfield|link|cell|row|table|outline|webarea/;
  if (blockedRole.test(role)) return { ok: false, reason: 'state_or_text_control' };
  if (!['axbutton', 'axmenuitem', 'axmenubaritem'].includes(role)) {
    return { ok: false, reason: 'unsupported_role' };
  }
  if (/^ax(alert|dialog|sheet)$/.test(containerRole)) {
    return { ok: false, reason: 'modal_context' };
  }
  if (value) return { ok: false, reason: 'value_bearing_target' };
  if (!label) return { ok: false, reason: 'missing_label' };
  const consequential = /\b(delete|remove|erase|trash|discard|reset|replace|overwrite|close without saving|quit|terminate|kill|pay|payment|purchase|buy|checkout|order|subscribe|subscription|billing|credit card|bank|wire|transfer|refund|sign in|signin|log in|login|log out|logout|password|passcode|authenticate|authentication|verify identity|account|credential|token|api key|allow|permission|authorize|authorization|access|privacy|camera|microphone|location|contacts|screen recording|accessibility|send|submit|publish|post|upload|install|update|accept|agree|consent|terms|license|confirm|approve)\b/;
  if (consequential.test(context)) return { ok: false, reason: 'consequential_context' };
  const allowed = (
    /^(show|hide) (details|sidebar|toolbar|inspector|preview|info|information|status bar|tab bar)$/.test(label)
    || /^(zoom in|zoom out|actual size|fit to (window|screen|page)|enter full screen|exit full screen)$/.test(label)
    || /^(help|settings|preferences)$/.test(label)
    || /^about(?: [a-z0-9][a-z0-9 ._'()&+-]{0,80})?$/.test(label)
  );
  return allowed ? { ok: true } : { ok: false, reason: 'unknown_semantics' };
}

function nativeSemanticFailureData(
  phase: string,
  errorCode: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: 'desktop_semantic_action',
    operation: 'native_semantic_press',
    phase,
    errorCode,
    completionVerified: false,
    outcomeUnknown: false,
    outcomeUnknownPolicy: 'verify_before_retry',
    replayAllowed: false,
    ...extra,
  };
}

/**
 * Production dependency bundle. The caller must supply a real runtime/user
 * approval gate; there is deliberately no auto-approve default.
 */
export function createNativeSemanticActionBridgeDeps(
  approvalGate: NativeSemanticActionDeps['approvalGate'],
): NativeSemanticActionDeps {
  return {
    observeApp: bridgeObserveApp,
    observeSemanticActionTarget: bridgeObserveNativeSemanticActionTarget,
    performSemanticAction: bridgePerformNativeSemanticAction,
    approvalGate,
  };
}

/**
 * Observe → exact-node classify → prepare one-shot target → approval →
 * dispatch once → accept only exact-target after proof.
 *
 * Raw AX paths, labels, and the target capability are not returned in the
 * execution receipt. A transport failure after perform starts is
 * conservatively outcome-unknown and never replayable.
 */
export async function executeObservedNativeSemanticAction(
  requestInput: NativeSemanticActionRequest,
  deps: NativeSemanticActionDeps,
): Promise<ComputerAppAdapterResult> {
  const request: NativeSemanticActionRequest = {
    action: requestInput?.action,
    appName: String(requestInput?.appName || '').trim().slice(0, 120),
    expectedPid: Math.trunc(Number(requestInput?.expectedPid || 0)),
    targetPath: String(requestInput?.targetPath || '').trim(),
    expectedRole: String(requestInput?.expectedRole || '').trim().slice(0, 80),
    expectedLabel: String(requestInput?.expectedLabel || '').trim().slice(0, 120),
  };
  if (
    request.action !== 'press'
    || !request.appName
    || !/^[A-Za-z0-9 .\-_()]+$/.test(request.appName)
    || !(request.expectedPid > 0)
    || !/^[0-9]+(\.[0-9]+)*$/.test(request.targetPath)
    || !request.expectedRole
    || !request.expectedLabel
  ) {
    return {
      ok: false,
      message: 'I stopped before observing the native app because the exact semantic-action identity was invalid.',
      warnings: ['native semantic action blocked before observation: invalid exact target identity'],
      data: nativeSemanticFailureData('input', 'invalid_input'),
    };
  }

  let observation: NativeAppActivationBridgeResult<ObserveAppData>;
  try {
    observation = await deps.observeApp({
      appName: request.appName,
      maxDepth: 10,
      maxNodes: 400,
    });
  } catch {
    observation = {
      ok: false,
      errorCode: 'bridge_exception',
    };
  }
  if (!observation.ok || !observation.data) {
    const observationErrorCode = normalizeNativeBridgeErrorCode(observation.errorCode);
    return {
      ok: false,
      message: `I stopped before preparing the native action because a fresh app observation was unavailable: ${renderNativeBridgeFailure(observationErrorCode)}.`,
      warnings: ['native semantic action blocked before mutation: fresh app observation unavailable'],
      data: nativeSemanticFailureData('before_observation', observationErrorCode),
    };
  }

  const observed = observation.data;
  const resolvedApp = resolveInitialNativeAppIdentity(observed, request.appName);
  const pid = Math.max(0, Math.trunc(Number(observed.pid || 0)));
  const indexGeneration = Math.max(0, Math.trunc(Number(observed.indexGeneration || 0)));
  if (
    !resolvedApp
    || !observed.appRunning
    || observed.frontmost !== true
    || !(pid > 0)
    || pid !== request.expectedPid
    || !(indexGeneration > 0)
    || !observed.tree
  ) {
    return {
      ok: false,
      message: 'I stopped before preparing the native action because the exact running app, PID, or fresh accessibility tree was unavailable.',
      warnings: ['native semantic action blocked before mutation: incomplete exact observation'],
      data: nativeSemanticFailureData('before_observation', 'uncertain_ui_target'),
    };
  }

  const exactNode = findExactNativeSemanticNode(observed.tree, request.targetPath);
  if (
    !exactNode
    || String(exactNode.node.role || '') !== request.expectedRole
    || normalizeNativeSemanticText(exactNode.node.label) !== normalizeNativeSemanticText(request.expectedLabel)
  ) {
    return {
      ok: false,
      message: 'I stopped before preparing the native action because the exact AX path, role, and label did not all match the fresh observation.',
      warnings: ['native semantic action blocked before mutation: exact target mismatch'],
      data: nativeSemanticFailureData('target_validation', 'uncertain_ui_target'),
    };
  }
  const localClassification = classifyNativeSemanticNode(exactNode);
  if (!localClassification.ok) {
    return {
      ok: false,
      message: 'I stopped before preparing the native action because that control is outside the narrow low-consequence semantic-action canary.',
      warnings: [`native semantic action blocked before mutation: ${localClassification.reason}`],
      data: nativeSemanticFailureData('target_validation', 'native_semantic_target_blocked'),
    };
  }

  let prepared: NativeAppActivationBridgeResult<NativeSemanticActionTarget>;
  try {
    prepared = await deps.observeSemanticActionTarget({
      action: 'press',
      appName: resolvedApp,
      pid,
      indexGeneration,
      targetPath: request.targetPath,
      expectedRole: request.expectedRole,
      expectedLabel: request.expectedLabel,
    });
  } catch {
    prepared = {
      ok: false,
      errorCode: 'bridge_exception',
    };
  }
  if (!prepared.ok || !prepared.data) {
    const preparationErrorCode = normalizeNativeBridgeErrorCode(prepared.errorCode);
    return {
      ok: false,
      message: `I stopped before approval because the bridge could not seal the exact fresh native target: ${renderNativeBridgeFailure(preparationErrorCode)}.`,
      warnings: ['native semantic action blocked before mutation: one-shot target unavailable'],
      data: nativeSemanticFailureData('target_preparation', preparationErrorCode),
    };
  }
  const target = prepared.data;
  const preparedIdentityMatched = (
    target.schemaVersion === 1
    && target.action === 'press'
    && exactOrExplicitNativeAppAliasMatches(target.app, resolvedApp)
    && target.pid === pid
    && target.indexGeneration === indexGeneration
    && target.targetPath === request.targetPath
    && target.targetRole === request.expectedRole
    && normalizeNativeSemanticText(target.targetLabel) === normalizeNativeSemanticText(request.expectedLabel)
    && /^[a-f0-9]{48}$/.test(target.targetId)
    && /^[a-f0-9]{64}$/.test(target.targetFingerprint)
    && Number.isFinite(Date.parse(target.observedAt))
    && target.indexGeneration > 0
    && target.approvalRequired === true
    && target.risk === 'medium'
  );
  if (!preparedIdentityMatched) {
    return {
      ok: false,
      message: 'I stopped before approval because the prepared target did not preserve the exact observed app, PID, node, and semantics.',
      warnings: ['native semantic action blocked before mutation: prepared target mismatch'],
      data: nativeSemanticFailureData('target_preparation', 'uncertain_ui_target'),
    };
  }

  const approvalProposal: NativeSemanticActionApprovalProposal = {
    schemaVersion: 1,
    operation: 'native_semantic_press',
    action: 'press',
    app: resolvedApp,
    pid,
    targetRole: target.targetRole,
    targetFingerprint: target.targetFingerprint,
    evidenceId: target.evidenceId,
    observedAt: target.observedAt,
    indexGeneration: target.indexGeneration,
    targetSummary: target.targetSummary,
    approvalRequired: true,
    risk: 'medium',
    expiresAt: target.expiresAt,
  };
  let approval: NativeSemanticActionApprovalDecision;
  try {
    approval = await deps.approvalGate(approvalProposal);
  } catch {
    approval = {
      approved: false,
      reason: 'approval_gate_unavailable',
    };
  }
  const approvalId = String(approval.approvalId || '').trim();
  if (!approval.approved || !/^[A-Za-z0-9._:-]{8,160}$/.test(approvalId)) {
    return {
      ok: false,
      message: approval.approved
        ? 'I did not dispatch the native action because the approval gate did not return a valid runtime receipt.'
        : 'The native action was not approved. Review or retry the approval request.',
      warnings: ['native semantic action not dispatched: approval required'],
      data: nativeSemanticFailureData('approval', 'approval_required', {
        approvalRequired: true,
        approvalGranted: false,
        approvalSummary: target.targetSummary,
        evidenceId: target.evidenceId,
        mutationAttempted: false,
      }),
    };
  }

  let execution: NativeAppActivationBridgeResult<NativeSemanticActionExecution>;
  try {
    // Exactly one perform call. The one-shot target is consumed server-side
    // before freshness checks or helper dispatch.
    execution = await deps.performSemanticAction({
      targetId: target.targetId,
      targetFingerprint: target.targetFingerprint,
      approvalId,
    });
  } catch (error: any) {
    return {
      ok: false,
      message: 'The approved native action call ended without a receipt. Its outcome is unknown, so I will not replay it.',
      warnings: ['native semantic action outcome unknown after dispatch call; verify before any retry'],
      data: nativeSemanticFailureData('dispatch', 'bridge_offline', {
        evidenceId: target.evidenceId,
        mutationAttempted: true,
        outcomeUnknown: true,
      }),
    };
  }

  if (!execution.ok || !execution.data) {
    const proof = execution.data?.proof;
    const outcomeUnknown = proof
      ? proof.outcomeUnknown === true
      : true;
    const mutationAttempted = proof
      ? proof.mutationAttempted === true
      : true;
    return {
      ok: false,
      message: outcomeUnknown
        ? 'The approved native action was not verified against the exact target. Its outcome is unknown, so I will not replay it.'
        : `The bridge stopped before dispatching the approved native action: ${renderNativeBridgeFailure(execution.errorCode)}.`,
      warnings: [
        outcomeUnknown
          ? 'native semantic action outcome unknown; verify before any retry'
          : 'native semantic action consumed without dispatch after fresh target validation failed',
      ],
      data: nativeSemanticFailureData(
        proof?.mutationAttempted ? 'after_observation' : 'before_dispatch',
        normalizeNativeBridgeErrorCode(execution.errorCode),
        {
          evidenceId: target.evidenceId,
          mutationAttempted,
          outcomeUnknown,
          ...(proof ? { proof } : {}),
        },
      ),
    };
  }

  const completed = execution.data;
  const beforeProof = completed.proof.before;
  const afterProof = completed.proof.after;
  const exactTargetPostcondition = !!beforeProof
    && !!afterProof
    && beforeProof.app === resolvedApp
    && afterProof.app === resolvedApp
    && beforeProof.pid === pid
    && afterProof.pid === pid
    && beforeProof.targetPresent === true
    && beforeProof.targetFingerprint === target.targetFingerprint
    && (
      (
        completed.proof.diff.kind === 'target_disappeared'
        && afterProof.targetPresent === false
        && afterProof.targetFingerprint === null
      )
      || (
        completed.proof.diff.kind === 'target_semantics_changed'
        && afterProof.targetPresent === true
        && !!afterProof.targetFingerprint
        && afterProof.targetFingerprint !== beforeProof.targetFingerprint
      )
    );
  const exactCompletion = (
    completed.app === resolvedApp
    && completed.pid === pid
    && completed.targetFingerprint === target.targetFingerprint
    && completed.evidenceId === target.evidenceId
    && completed.completionVerified === true
    && completed.outcomeUnknown === false
    && completed.replayAllowed === false
    && completed.proof.completionVerified === true
    && completed.proof.outcomeUnknown === false
    && completed.proof.replayAllowed === false
    && completed.proof.noOp === false
    && completed.proof.mutationAttempted === true
    && completed.proof.mutationPerformed === true
    && completed.proof.dispatchAcknowledged === true
    && (
      completed.proof.dispatchMethod === 'ax_press'
      || completed.proof.dispatchMethod === 'cg_event'
    )
    && exactTargetPostcondition
  );
  if (!exactCompletion) {
    return {
      ok: false,
      message: 'The bridge returned a receipt, but it did not prove a local postcondition on the exact approved target. I will not replay the action.',
      warnings: ['native semantic action failed closed: exact-target completion proof missing'],
      data: nativeSemanticFailureData('after_observation', 'native_semantic_verification_failed', {
        evidenceId: target.evidenceId,
        mutationAttempted: true,
        outcomeUnknown: true,
        proof: completed.proof,
      }),
    };
  }

  return {
    ok: true,
    message: `Pressed and verified the approved native control in **${resolvedApp}**.`,
    warnings: [],
    data: {
      kind: 'desktop_semantic_action',
      operation: 'native_semantic_press',
      phase: 'completed',
      app: resolvedApp,
      pid,
      evidenceId: target.evidenceId,
      approvalRequired: true,
      approvalGranted: true,
      mutationAttempted: true,
      completionVerified: true,
      outcomeUnknown: false,
      outcomeUnknownPolicy: 'verify_before_retry',
      replayAllowed: false,
      proof: completed.proof,
    },
  };
}

function toolMatches(tool: Pick<McpTool, 'name' | 'description'>, needles: string[]): boolean {
  const haystack = `${normalizeText(tool.name)} ${normalizeText(tool.description)}`;
  return needles.some((needle) => haystack.includes(needle));
}

function isDesktopOrAppTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'desktop',
    'application',
    'window',
    'slack',
    'figma',
    'notion',
    'github',
    'browser',
    'computer',
    'app',
    'mail',
    'calendar',
    'discord',
    'teams',
  ]);
}

function providerMentioned(task: string, provider: string): boolean {
  return new RegExp(`\\b${provider.replace(/[_-]/g, '[-_ ]?')}\\b`, 'i').test(task);
}

function inferTargetProviders(task: string): CircleIntegrationProvider[] {
  const providers: CircleIntegrationProvider[] = [
    'slack', 'github', 'notion', 'figma', 'discord', 'teams', 'wordpress', 'shopify',
    'stripe', 'salesforce', 'pipedrive', 'mailchimp', 'convertkit', 'posthog',
  ];
  return providers.filter((provider) => providerMentioned(task, provider));
}

function hasInputProp(tool: McpTool, key: string): boolean {
  const props = tool.inputSchema?.properties;
  return !!props && typeof props === 'object' && key in props;
}

function inferQuery(task: string): string {
  return String(task || '')
    .replace(/\b(check|open|inspect|review|look at|look up|search|find|show|use|in)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildArgs(tool: McpTool, task: string): Record<string, unknown> {
  const query = inferQuery(task);
  const args: Record<string, unknown> = {};
  if (hasInputProp(tool, 'query')) args.query = query;
  if (hasInputProp(tool, 'q')) args.q = query;
  if (hasInputProp(tool, 'search')) args.search = query;
  if (hasInputProp(tool, 'prompt')) args.prompt = query;
  if (hasInputProp(tool, 'task')) args.task = task;
  if (hasInputProp(tool, 'message')) args.message = query;
  if (hasInputProp(tool, 'limit')) args.limit = 10;
  return Object.keys(args).length > 0 ? args : { query };
}

function stringifyResult(result: any): string {
  if (result == null) return 'No result returned.';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.slice(0, 8).map((item) => JSON.stringify(item)).join('\n');
  if (typeof result === 'object') {
    if (Array.isArray(result.content)) {
      return result.content
        .slice(0, 8)
        .map((item: any) => typeof item?.text === 'string' ? item.text : JSON.stringify(item))
        .join('\n');
    }
    return JSON.stringify(result, null, 2).slice(0, 2000);
  }
  return String(result);
}

function flattenA11yNodes(node: A11yNode | null | undefined, out: A11yNode[] = []): A11yNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children || []) flattenA11yNodes(child, out);
  return out;
}

function scoreA11yNode(node: A11yNode, target: string): number {
  const normalizedTarget = normalizeText(target).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const label = normalizeText(`${node.label || ''} ${node.value || ''}`).replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalizedTarget || !label) return 0;
  let score = 0;
  if (label === normalizedTarget) score += 120;
  else if (label.includes(normalizedTarget)) score += 90;
  else if (normalizedTarget.includes(label) && label.length >= 3) score += 70;
  const targetWords = normalizedTarget.split(' ').filter(Boolean);
  const labelWords = new Set(label.split(' ').filter(Boolean));
  const matchedWords = targetWords.filter((word) => labelWords.has(word)).length;
  if (targetWords.length > 0 && matchedWords === targetWords.length) score += 75;
  else score += matchedWords * 18;
  if (/button|menu|checkbox|radio|tab|link|textfield|text field|popup|cell|row/i.test(node.role)) score += 12;
  if (node.bbox) score += 8;
  return score;
}

function findBestA11yNode(root: A11yNode, targetLabel: string): A11yNode | null {
  const nodes = flattenA11yNodes(root).filter((node) => node.id && (node.label || node.value));
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    const score = scoreA11yNode(node, targetLabel);
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

function findBestTextEntryA11yNode(root: A11yNode, targetLabel: string): A11yNode | null {
  const nodes = flattenA11yNodes(root).filter((node) => node.id && (node.label || node.value));
  const textEntryRole = /textfield|text field|textarea|text area|combobox|combo box|search|editable/i;
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    let score = scoreA11yNode(node, targetLabel);
    if (textEntryRole.test(node.role)) score += 45;
    if (/statictext|image|button|checkbox|radio|tab/i.test(node.role)) score -= 25;
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || findBestA11yNode(root, targetLabel);
}

function looksLikeFilename(value: string): boolean {
  return /^[^/\\:*?"<>|\r\n]{1,180}\.[A-Za-z0-9]{2,8}$/.test(String(value || '').trim());
}

function isSaveDialogFilenameIntent(intent: { kind?: string | null; reason?: string; text?: string }): boolean {
  return intent.kind === 'paste_text' && intent.reason === 'local-save-dialog-filename' && looksLikeFilename(intent.text || '');
}

function isSaveDialogOutputPathIntent(intent: { kind?: string | null; reason?: string; text?: string }): boolean {
  return intent.kind === 'paste_text' && intent.reason === 'local-save-dialog-output-path' && Boolean(String(intent.text || '').trim());
}

function isSaveForWebSaveButtonIntent(intent: { kind?: string | null; reason?: string; targetLabel?: string }): boolean {
  return intent.kind === 'semantic_click' && intent.reason === 'local-save-for-web-save-button';
}

function isImageFilename(value: string): boolean {
  return /\.(?:jpe?g|png|gif|webp|tiff?|bmp|heic)$/i.test(String(value || '').trim());
}

function findLikelySaveFilenameField(root: A11yNode): A11yNode | null {
  const textEntryRole = /textfield|text field|textarea|text area|combobox|combo box|editable/i;
  const nodes = flattenA11yNodes(root).filter((node) => node.id && textEntryRole.test(node.role || ''));
  let best: { node: A11yNode; score: number } | null = null;
  for (const node of nodes) {
    const haystack = normalizeText(`${node.role || ''} ${node.label || ''} ${node.value || ''}`);
    let score = 50;
    if (/\b(save|save as|filename|file name|name|untitled|copy)\b/i.test(haystack)) score += 60;
    if (looksLikeFilename(node.value || '')) score += 45;
    if (/\b(search|filter|tags?|where|format)\b/i.test(haystack)) score -= 20;
    if (node.bbox) score += 10;
    if (score < 45) continue;
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node || null;
}

function treeLooksLikeSaveDialog(root: A11yNode): boolean {
  const labels = flattenA11yNodes(root)
    .slice(0, 120)
    .map((node) => `${node.role || ''} ${node.label || ''} ${node.value || ''}`)
    .join(' ');
  return /\b(save|save as|save a copy|save for web|export|optimized|preset|file name|filename|where|format|options|quality|replace|jpeg|jpg|png|gif)\b/i.test(labels);
}

function compactA11yCandidates(root: A11yNode): string {
  return flattenA11yNodes(root)
    .filter((node) => node.id && (node.label || node.value || /textfield|button|menu|sheet|dialog/i.test(node.role || '')))
    .slice(0, 16)
    .map((node) => `[${node.id}] ${node.role}${node.label ? ` "${node.label}"` : ''}${node.value && node.value !== node.label ? ` = "${node.value}"` : ''}`)
    .join('\n');
}

// ─── A11y tree observation cache ─────────────────────────────────────────
//
// Models re-reading the same app tree within a few seconds tend to
// re-describe an identical UI from scratch, wasting turns. We cache a
// cheap hash of the last serialized tree per app ({pid, hash, at});
// when a re-read inside a short window hashes identical, the result
// carries an explicit "[unchanged since last observation Xs ago]" note
// so the model can move on. The read itself ALWAYS still happens — the
// evidence-freshness contract is untouched; this only annotates that
// nothing changed. Bounded: 1 entry per cache key, ≤5 keys, oldest
// evicted. E2 cache-coherence decision: the key is app + slice mode +
// target (not just app), so pruned targeting slices for different
// targets are tracked as distinct observations rather than colliding
// with each other or with full reads.

const A11Y_OBSERVATION_UNCHANGED_WINDOW_MS = 10_000;
const A11Y_OBSERVATION_CACHE_MAX_APPS = 5;

interface A11yObservationCacheEntry {
  pid: number;
  hash: string;
  at: number;
}

const a11yObservationCache = new Map<string, A11yObservationCacheEntry>();

/** Cheap djb2-xor string hash — a cache hint, not a security boundary. */
function hashA11yObservation(serialized: string): string {
  let hash = 5381;
  for (let i = 0; i < serialized.length; i += 1) {
    hash = ((hash << 5) + hash) ^ serialized.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function noteA11yTreeObservation(args: {
  app: string;
  pid: number;
  serializedTree: string;
  /** E2 — sliced reads with different targets are DIFFERENT observations:
   *  the cache key includes slice mode + target so a pruned "Save"-slice
   *  never marks a later "Cancel"-slice (or a full read) as unchanged. */
  target?: string | null;
  slice?: string | null;
  now?: number;
}): { unchanged: boolean; note: string | null } {
  const appKey = String(args.app || '').trim().toLowerCase();
  if (!appKey) return { unchanged: false, note: null };
  const key = `${appKey}::${String(args.slice || 'full').toLowerCase()}::${String(args.target || '').trim().toLowerCase()}`;
  const now = typeof args.now === 'number' ? args.now : Date.now();
  const hash = hashA11yObservation(args.serializedTree);
  const prev = a11yObservationCache.get(key) || null;
  a11yObservationCache.set(key, { pid: args.pid, hash, at: now });
  if (a11yObservationCache.size > A11Y_OBSERVATION_CACHE_MAX_APPS) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [cachedKey, entry] of a11yObservationCache) {
      if (entry.at < oldestAt) { oldestAt = entry.at; oldestKey = cachedKey; }
    }
    if (oldestKey && oldestKey !== key) a11yObservationCache.delete(oldestKey);
  }
  if (!prev) return { unchanged: false, note: null };
  const ageMs = now - prev.at;
  if (prev.pid !== args.pid) return { unchanged: false, note: null };
  if (ageMs < 0 || ageMs > A11Y_OBSERVATION_UNCHANGED_WINDOW_MS) return { unchanged: false, note: null };
  if (prev.hash !== hash) return { unchanged: false, note: null };
  const seconds = Math.max(1, Math.round(ageMs / 1000));
  return { unchanged: true, note: `[unchanged since last observation ${seconds}s ago]` };
}

async function decideBlockingModalWithAdvisor(args: {
  root: A11yNode;
  app?: string | null;
  task?: string | null;
}): Promise<DesktopAIModalDecision | null> {
  const localDecision = decideDesktopAIModalAction({
    root: args.root,
    app: args.app || null,
    task: args.task || '',
  });
  if (!localDecision) return null;
  if (localDecision.action === 'click_button' || localDecision.risk !== 'unknown') return localDecision;

  const observation = extractDesktopAIModalObservation(args.root, args.app || null);
  if (!observation) return localDecision;
  try {
    const prompt = buildDesktopAIModalDecisionPrompt({
      task: args.task || '',
      observation,
    });
    const response = await callBlackSwan([
      {
        role: 'system',
        content: 'You classify desktop app popups for a computer-control agent. Return only the requested JSON object.',
      },
      { role: 'user', content: prompt },
    ], {
      temperature: 0,
      maxTokens: 240,
      timeoutMs: 4500,
    });
    const candidate = parseDesktopAIModalCandidate(response.content);
    if (!candidate) return localDecision;
    return validateDesktopAIModalCandidate({
      candidate,
      observation,
      task: args.task || '',
    });
  } catch {
    return localDecision;
  }
}

async function handleBlockingAppModals(
  appQuery: string | undefined,
  options: { maxDialogs?: number; context?: string; task?: string } = {},
): Promise<ComputerAppAdapterResult | null> {
  const appName = appQuery || undefined;
  const handled: BlockingAppModalPlan[] = [];
  const maxDialogs = Math.max(1, Math.min(5, Math.trunc(options.maxDialogs || 3)));
  for (let attempt = 0; attempt < maxDialogs; attempt += 1) {
    if (appName) await bridgeFocusApp(appName).catch(() => null);
    await sleep(attempt === 0 ? 250 : 500);
    const tree = await bridgeReadA11yTree({ appName, maxDepth: 12, maxNodes: 900 });
    if (!tree.ok || !tree.data?.tree) {
      return handled.length > 0
        ? {
          ok: true,
          message: `Handled ${handled.length} blocking app dialog${handled.length === 1 ? '' : 's'}, then accessibility inspection became unavailable.`,
          warnings: [
            ...handled.map((item) => `handled ${item.policyLabel} via ${item.buttonLabel}`),
            `desktop_a11y_tree unavailable after modal handling: ${tree.errorCode || 'unknown_error'}`,
          ],
          data: { kind: 'desktop_blocking_modal_handled', handled, context: options.context || null },
        }
        : null;
    }
    const plan = detectBlockingAppModalPlan(tree.data.tree, tree.data.app || appName);
    const aiDecision: DesktopAIModalDecision | null = plan
      ? null
      : await decideBlockingModalWithAdvisor({
        root: tree.data.tree,
        app: tree.data.app || appName || null,
        task: options.task || options.context || '',
      });
    if (!plan && !aiDecision) break;
    if (!plan && aiDecision && aiDecision.action !== 'click_button') {
      return {
        ok: false,
        message: aiDecision.userMessage || `A ${tree.data.app || appName || 'desktop app'} popup needs a decision before I continue.`,
        warnings: [`desktop_ai_modal_advisor ${aiDecision.risk}`],
        data: {
          kind: 'desktop_ai_modal_decision_needed',
          decision: aiDecision,
          context: options.context || null,
        },
      };
    }
    const activePlan: BlockingAppModalPlan = plan || {
      policyId: `ai_modal_advisor:${aiDecision?.risk || 'unknown'}`,
      policyLabel: 'AI modal advisor',
      app: tree.data.app || appName || null,
      buttonLabel: aiDecision?.buttonLabel || 'selected button',
      buttonPath: aiDecision?.buttonId || '',
      summary: aiDecision?.reason || 'AI modal advisor selected a guarded popup action.',
    };
    if (!activePlan.buttonPath) break;
    const clicked = await bridgeClickElement({ pid: tree.data.pid, path: activePlan.buttonPath, appName: tree.data.app || appName });
    if (!clicked.ok) {
      return {
        ok: false,
        message: `Detected a blocking **${activePlan.policyLabel}** dialog, but could not click **${activePlan.buttonLabel}**: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_blocking_modal_click failed with ${clicked.errorCode || 'unknown_error'}`],
        data: {
          kind: 'desktop_blocking_modal_failed',
          plan: activePlan,
          context: options.context || null,
          errorCode: clicked.errorCode,
        },
      };
    }
    handled.push(activePlan);
  }
  if (handled.length === 0) return null;
  return {
    ok: true,
    message: `Handled ${handled.length} blocking app dialog${handled.length === 1 ? '' : 's'}: ${handled.map((item) => `${item.policyLabel} → ${item.buttonLabel}`).join(', ')}.`,
    warnings: handled.map((item) => `handled ${item.policyLabel} via ${item.buttonLabel}`),
    data: {
      kind: 'desktop_blocking_modal_handled',
      handled,
      context: options.context || null,
    },
  };
}

function treeLooksLikeSaveForWebDialog(root: A11yNode): boolean {
  const labels = flattenA11yNodes(root)
    .slice(0, 180)
    .map((node) => `${node.role || ''} ${node.label || ''} ${node.value || ''}`)
    .join(' ');
  return /\b(save for web|optimized|preset|quality|metadata|color table|jpeg|jpg|png|gif|export)\b/i.test(labels);
}

function findLikelySaveForWebButton(root: A11yNode): A11yNode | null {
  const candidates = flattenA11yNodes(root).filter((node) => node.id && /\bsave\b/i.test(`${node.label || ''} ${node.value || ''}`));
  const exactButtons = candidates.filter((node) => /button/i.test(node.role || '') && /^\s*save(?:\.\.\.)?\s*$/i.test(`${node.label || ''} ${node.value || ''}`.trim()));
  if (exactButtons.length > 0) return exactButtons[0];
  const saveButtons = candidates.filter((node) => /button/i.test(node.role || ''));
  if (saveButtons.length > 0) return saveButtons[0];
  return null;
}

async function ensureSaveForWebFormat(
  appQuery: string | undefined,
  targetFormat: SaveForWebTargetFormat | null,
  currentTree?: { pid: number; app?: string | null; tree: A11yNode },
): Promise<ComputerAppAdapterResult | null> {
  if (!targetFormat) return null;
  const appLabel = appQuery || 'the frontmost app';
  const readCurrentTree = async () => {
    if (currentTree) return { ok: true as const, data: currentTree };
    return bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  };
  const initialTree = await readCurrentTree();
  if (!initialTree.ok || !initialTree.data?.tree) {
    const initialError = initialTree as { error?: string; errorCode?: string };
    return {
      ok: false,
      message: `I opened Save for Web in **${appLabel}**, but could not inspect the format picker before saving: ${initialError.error || initialError.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${initialError.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_format_unverified', app: appQuery || null, targetFormat, errorCode: initialError.errorCode },
    };
  }
  if (treeShowsSaveForWebTargetFormat(initialTree.data.tree, targetFormat)) {
    return {
      ok: true,
      message: `Verified Save for Web is already set to **${targetFormat.toUpperCase()}**.`,
      warnings: [],
      data: { kind: 'desktop_save_for_web_format_verified', app: initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const formatControl = findPreferredSaveForWebFormatControl(initialTree.data.tree, targetFormat);
  if (!formatControl) {
    return {
      ok: false,
      message:
        `I verified the Save for Web dialog in **${initialTree.data.app || appLabel}**, but could not find the preset/format picker needed to switch the export to **${targetFormat.toUpperCase()}** before saving.\n\n` +
        `Visible controls:\n${compactA11yCandidates(initialTree.data.tree) || '(no format controls returned)'}`,
      warnings: ['save for web format picker not found'],
      data: { kind: 'desktop_save_for_web_format_picker_missing', app: initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const opened = await bridgeClickElement({ pid: initialTree.data.pid, path: formatControl.id, appName: initialTree.data.app || appQuery });
  if (!opened.ok) {
    return {
      ok: false,
      message: `I found the Save for Web format picker, but could not open it before saving: ${opened.error || opened.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${opened.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_for_web_format_picker_failed',
        app: initialTree.data.app || appQuery || null,
        targetFormat,
        targetPath: formatControl.id,
        errorCode: opened.errorCode,
      },
    };
  }
  await sleep(350);
  const menuTree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 14, maxNodes: 1200 });
  if (!menuTree.ok || !menuTree.data?.tree) {
    return {
      ok: false,
      message: `I opened the Save for Web format picker, but could not inspect the format options: ${menuTree.error || menuTree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${menuTree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_format_options_unverified', app: initialTree.data.app || appQuery || null, targetFormat, errorCode: menuTree.errorCode },
    };
  }
  const formatOption = findPreferredSaveForWebFormatOption(menuTree.data.tree, targetFormat);
  if (!formatOption) {
    return {
      ok: false,
      message:
        `I opened the Save for Web format picker in **${menuTree.data.app || initialTree.data.app || appLabel}**, but could not find a **${targetFormat.toUpperCase()}** option. ` +
        `I stopped before saving so Photoshop does not export the wrong file type.\n\n` +
        `Visible controls:\n${compactA11yCandidates(menuTree.data.tree) || '(no format options returned)'}`,
      warnings: ['save for web target format option not found'],
      data: { kind: 'desktop_save_for_web_format_option_missing', app: menuTree.data.app || initialTree.data.app || appQuery || null, targetFormat },
    };
  }
  const selected = await bridgeClickElement({ pid: menuTree.data.pid, path: formatOption.id, appName: menuTree.data.app || appQuery });
  if (!selected.ok) {
    return {
      ok: false,
      message: `I found the Save for Web **${targetFormat.toUpperCase()}** option, but could not select it: ${selected.error || selected.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${selected.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_for_web_format_option_failed',
        app: menuTree.data.app || initialTree.data.app || appQuery || null,
        targetFormat,
        targetPath: formatOption.id,
        errorCode: selected.errorCode,
      },
    };
  }
  await sleep(500);
  const verifyTree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  if (verifyTree.ok && verifyTree.data?.tree && treeLooksLikeSaveForWebDialog(verifyTree.data.tree) && !treeShowsSaveForWebTargetFormat(verifyTree.data.tree, targetFormat)) {
    return {
      ok: false,
      message:
        `I selected the Save for Web **${targetFormat.toUpperCase()}** option, but Photoshop still did not report that format. ` +
        `I stopped before saving so the export does not use the wrong file type.`,
      warnings: ['save for web target format not verified after selection'],
      data: { kind: 'desktop_save_for_web_format_not_verified', app: verifyTree.data.app || appQuery || null, targetFormat },
    };
  }
  return {
    ok: true,
    message: `Set Save for Web format to **${targetFormat.toUpperCase()}** before saving.`,
    warnings: [],
    data: {
      kind: 'desktop_save_for_web_format_selected',
      app: menuTree.data.app || initialTree.data.app || appQuery || null,
      targetFormat,
      targetPath: formatOption.id,
      verified: Boolean(verifyTree.ok && verifyTree.data?.tree && treeShowsSaveForWebTargetFormat(verifyTree.data.tree, targetFormat)),
    },
  };
}

async function clickSaveForWebSaveButton(appQuery?: string, targetFormat?: SaveForWebTargetFormat | null): Promise<ComputerAppAdapterResult> {
  const appLabel = appQuery || 'the frontmost app';
  await sleep(250);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 });
  if (!tree.ok || !tree.data?.tree) {
    return {
      ok: false,
      message: `I opened Save for Web in **${appLabel}**, but could not inspect the dialog before clicking Save: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_dialog_unverified', app: appQuery || null, errorCode: tree.errorCode },
    };
  }
  if (!treeLooksLikeSaveForWebDialog(tree.data.tree)) {
    return {
      ok: false,
      message:
        `I opened Save for Web in **${tree.data.app || appLabel}**, but I could not verify that the Save for Web export dialog appeared. ` +
        `Photoshop may have no active document, the shortcut may be disabled, or macOS may not be exposing the dialog.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no useful controls returned)'}`,
      warnings: ['save for web dialog not verified'],
      data: { kind: 'desktop_save_for_web_dialog_missing', app: tree.data.app || appQuery || null },
    };
  }
  const formatResult = await ensureSaveForWebFormat(appQuery, targetFormat || null, {
    pid: tree.data.pid,
    app: tree.data.app || appQuery || null,
    tree: tree.data.tree,
  });
  if (formatResult && !formatResult.ok) return formatResult;
  const saveTree = targetFormat
    ? await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 1000 })
    : tree;
  if (!saveTree.ok || !saveTree.data?.tree) {
    return {
      ok: false,
      message: `I set the Save for Web format in **${appLabel}**, but could not re-inspect the dialog before clicking Save: ${saveTree.error || saveTree.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_a11y_tree failed with ${saveTree.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_for_web_dialog_unverified', app: appQuery || null, targetFormat: targetFormat || null, errorCode: saveTree.errorCode },
    };
  }
  if (!treeLooksLikeSaveForWebDialog(saveTree.data.tree)) {
    return {
      ok: false,
      message: `I set the Save for Web format in **${appLabel}**, but the Save for Web dialog was no longer visible before saving.`,
      warnings: ['save for web dialog disappeared before save'],
      data: { kind: 'desktop_save_for_web_dialog_missing_after_format', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null },
    };
  }
  const saveButton = findLikelySaveForWebButton(saveTree.data.tree);
  if (!saveButton) {
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Verified the Save for Web dialog${targetFormat ? ` with **${targetFormat.toUpperCase()}** format` : ''} and pressed Return because the Save button was not exposed by accessibility.`,
        warnings: ['save for web save button not found; used Return fallback'],
        data: { kind: 'desktop_save_for_web_save_return', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, format: formatResult?.data || null },
      };
    }
    return {
      ok: false,
      message:
        `I verified the Save for Web dialog in **${saveTree.data.app || appLabel}**, but could not find the dialog's Save button.\n\n` +
        `Visible controls:\n${compactA11yCandidates(saveTree.data.tree) || '(no Save controls returned)'}`,
      warnings: ['save for web save button not found'],
      data: { kind: 'desktop_save_for_web_save_missing', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, format: formatResult?.data || null },
    };
  }
  const clicked = await bridgeClickElement({ pid: saveTree.data.pid, path: saveButton.id, appName: saveTree.data.app || appQuery });
  if (!clicked.ok) {
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Found the Save for Web Save button, but clicking it failed; pressed Return as the dialog fallback.`,
        warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}; used Return fallback`],
        data: { kind: 'desktop_save_for_web_save_return', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, targetPath: saveButton.id, format: formatResult?.data || null },
      };
    }
    return {
      ok: false,
      message: `Found the Save for Web Save button, but clicking it failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: saveButton.id },
    };
  }
  return {
    ok: true,
    message: `Verified the Save for Web dialog${targetFormat ? ` with **${targetFormat.toUpperCase()}** format` : ''} and clicked Save.`,
    warnings: [],
    data: { kind: 'desktop_save_for_web_save_clicked', app: saveTree.data.app || appQuery || null, targetFormat: targetFormat || null, targetPath: saveButton.id, format: formatResult?.data || null },
  };
}

async function setSaveDialogFilename(filename: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const appLabel = appQuery || 'the frontmost app';
  await sleep(250);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 12, maxNodes: 800 });
  if (tree.ok && tree.data?.tree) {
    const saveDialogSeen = treeLooksLikeSaveDialog(tree.data.tree);
    const field = findLikelySaveFilenameField(tree.data.tree);
    if (!saveDialogSeen) {
      return {
        ok: false,
        message:
          `I opened the save/export command for **${appLabel}**, but I could not verify that a filename dialog appeared. ` +
          `Photoshop may have no active document, the command may be disabled, or macOS did not give the bridge access to the export dialog.\n\n` +
          `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no useful controls returned)'}`,
        warnings: ['save/export dialog not verified'],
        data: { kind: 'desktop_save_dialog_missing', app: tree.data.app || appQuery || null },
      };
    }
    if (!field) {
      return {
        ok: false,
        message:
          `I found a Save dialog in **${tree.data.app || appLabel}**, but could not find the filename field to set **${filename}**.\n\n` +
          `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no filename controls returned)'}`,
        warnings: ['save filename field not found'],
        data: { kind: 'desktop_save_filename_field_missing', app: tree.data.app || appQuery || null },
      };
    }
    const set = await bridgeSetElementValue({ pid: tree.data.pid, path: field.id, text: filename, appName: tree.data.app || appQuery });
    if (set.ok) {
      return {
        ok: true,
        message: `Verified the Save dialog and set the filename field to **${filename}** via accessibility.`,
        warnings: [],
        data: { kind: 'desktop_save_filename_set', app: tree.data.app || appQuery || null, targetPath: field.id, method: set.data?.method || 'ax_set_value', chars: set.data?.chars ?? filename.length },
      };
    }
    const clicked = await bridgeClickElement({ pid: tree.data.pid, path: field.id, appName: tree.data.app || appQuery });
    if (!clicked.ok) {
      return {
        ok: false,
        message: `Found the Save dialog filename field, but could not focus it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: field.id },
      };
    }
    await bridgePressKeys('Cmd+A').catch(() => null);
    const pasted = await bridgePasteText(filename, { restoreClipboard: true, focusMode: 'skip' });
    if (!pasted.ok) {
      return {
        ok: false,
        message: `Focused the Save dialog filename field, but paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode, targetPath: field.id },
      };
    }
    return {
      ok: true,
      message: `Verified the Save dialog and pasted **${filename}** into the filename field.`,
      warnings: [`Direct AX set failed: ${set.error || set.errorCode || 'unknown error'}`],
      data: { kind: 'desktop_save_filename_pasted', app: tree.data.app || appQuery || null, targetPath: field.id, chars: pasted.data?.chars ?? filename.length },
    };
  }

  const win = await bridgeGetWindowState();
  const title = `${win.data?.frontmostApp || ''} ${win.data?.activeWindowTitle || ''} ${(win.data?.windows || []).join(' ')}`;
  if (win.ok && /\b(save|copy|export|options|replace)\b/i.test(title)) {
    const pasted = await bridgePasteText(filename, { restoreClipboard: true, focusMode: 'skip' });
    if (!pasted.ok) {
      return {
        ok: false,
        message: `A save-related window appears to be frontmost, but filename paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode },
      };
    }
    return {
      ok: true,
      message: `Could not read the Save dialog accessibility tree, but the active window looked save-related and I pasted **${filename}** into the focused field.`,
      warnings: [`desktop_a11y_tree unavailable: ${tree.error || tree.errorCode || 'unknown error'}`],
      data: { kind: 'desktop_save_filename_pasted_unverified', app: win.data?.frontmostApp || appQuery || null, chars: pasted.data?.chars ?? filename.length },
    };
  }

  return {
    ok: false,
    message:
      `I opened the save/export command for **${appLabel}**, but could not verify a filename dialog before entering **${filename}**. ` +
      `This usually means Photoshop has no active image/document, Save for Web/Save As is disabled, or the local bridge cannot inspect the dialog yet.`,
    warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
    data: { kind: 'desktop_save_dialog_unverified', app: appQuery || null, errorCode: tree.errorCode },
  };
}

function splitSaveDialogOutputPath(outputPath: string): { folderPath: string | null; filename: string } {
  const clean = String(outputPath || '').trim().replace(/[\\/]+$/, '');
  const slashIndex = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (slashIndex <= 0) return { folderPath: null, filename: clean };
  return {
    folderPath: clean.slice(0, slashIndex),
    filename: clean.slice(slashIndex + 1),
  };
}

async function setSaveDialogOutputPath(outputPath: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const target = splitSaveDialogOutputPath(outputPath);
  if (!looksLikeFilename(target.filename)) {
    return {
      ok: false,
      message: `The requested Photoshop export filename is not a safe image filename: ${target.filename || '(empty)'}.`,
      warnings: ['invalid save dialog filename'],
      data: { kind: 'desktop_invalid_input', outputPath },
    };
  }
  if (target.folderPath) {
    const goToFolder = await bridgePressKeys('Cmd+Shift+G');
    if (!goToFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not open Go to Folder for **${target.folderPath}**: ${goToFolder.error || goToFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_press_keys failed with ${goToFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: goToFolder.errorCode, outputPath },
      };
    }
    await sleep(250);
    const pastedFolder = await bridgePasteText(target.folderPath, { restoreClipboard: true, focusMode: 'skip' });
    if (!pastedFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not enter the destination folder **${target.folderPath}**: ${pastedFolder.error || pastedFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_paste_text failed with ${pastedFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: pastedFolder.errorCode, outputPath },
      };
    }
    const confirmedFolder = await bridgePressKeys('Return');
    if (!confirmedFolder.ok) {
      return {
        ok: false,
        message: `The Save dialog opened, but I could not confirm the destination folder **${target.folderPath}**: ${confirmedFolder.error || confirmedFolder.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_press_keys failed with ${confirmedFolder.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: confirmedFolder.errorCode, outputPath },
      };
    }
    await sleep(600);
  }
  return setSaveDialogFilename(target.filename, appQuery);
}

async function maybeResolveSaveExtensionMismatch(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  const targetExtension = normalizeFileExtension(filename);
  if (!targetExtension || !isImageFilename(filename)) return null;
  await sleep(500);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 700 });
  if (!tree.ok || !tree.data?.tree) return null;
  if (!treeLooksLikeSaveExtensionMismatchDialog(tree.data.tree, filename)) return null;
  const keepExtensionButton = findPreferredSaveExtensionMismatchButton(tree.data.tree, filename);
  if (!keepExtensionButton?.id) {
    return {
      ok: false,
      message:
        `Photoshop asked whether to keep **.${targetExtension}** for **${splitSaveDialogOutputPath(filename).filename}**, ` +
        `but the local bridge could not find the **Use .${targetExtension}** button. I stopped before choosing the wrong format.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no extension controls returned)'}`,
      warnings: ['save extension mismatch unresolved'],
      data: {
        kind: 'desktop_save_extension_mismatch_unresolved',
        app: tree.data.app || appQuery || null,
        filename,
        targetExtension,
      },
    };
  }
  const clicked = await bridgeClickElement({ pid: tree.data.pid, path: keepExtensionButton.id, appName: tree.data.app || appQuery });
  if (!clicked.ok) {
    return {
      ok: false,
      message: `Photoshop asked whether to keep **.${targetExtension}**, but clicking **${keepExtensionButton.label || keepExtensionButton.value || `Use .${targetExtension}`}** failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_extension_mismatch_click_failed',
        app: tree.data.app || appQuery || null,
        filename,
        targetExtension,
        targetPath: keepExtensionButton.id,
        errorCode: clicked.errorCode,
      },
    };
  }
  return {
    ok: true,
    message: `Confirmed the save extension warning by keeping **.${targetExtension}** for **${splitSaveDialogOutputPath(filename).filename}**.`,
    warnings: [],
    data: {
      kind: 'desktop_save_extension_mismatch_confirmed',
      app: tree.data.app || appQuery || null,
      filename,
      targetExtension,
      targetPath: keepExtensionButton.id,
      buttonLabel: keepExtensionButton.label || keepExtensionButton.value || null,
    },
  };
}

async function maybeResolveSaveReplaceExisting(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  if (!filename || !isImageFilename(filename)) return null;
  await sleep(500);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 700 });
  if (!tree.ok || !tree.data?.tree) return null;
  if (!treeLooksLikeSaveReplaceExistingDialog(tree.data.tree, filename)) return null;
  const replaceButton = findPreferredSaveReplaceExistingButton(tree.data.tree);
  if (!replaceButton?.id) {
    return {
      ok: false,
      message:
        `Photoshop said **${splitSaveDialogOutputPath(filename).filename}** already exists, but the local bridge could not find the **Replace** button. ` +
        `I stopped before choosing the wrong action.\n\n` +
        `Visible controls:\n${compactA11yCandidates(tree.data.tree) || '(no replace controls returned)'}`,
      warnings: ['save replace existing unresolved'],
      data: {
        kind: 'desktop_save_replace_existing_unresolved',
        app: tree.data.app || appQuery || null,
        filename,
      },
    };
  }
  const clicked = await bridgeClickElement({ pid: tree.data.pid, path: replaceButton.id, appName: tree.data.app || appQuery });
  if (!clicked.ok) {
    return {
      ok: false,
      message: `Photoshop said **${splitSaveDialogOutputPath(filename).filename}** already exists, but clicking **${replaceButton.label || replaceButton.value || 'Replace'}** failed: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
      data: {
        kind: 'desktop_save_replace_existing_click_failed',
        app: tree.data.app || appQuery || null,
        filename,
        targetPath: replaceButton.id,
        errorCode: clicked.errorCode,
      },
    };
  }
  return {
    ok: true,
    message: `Confirmed Photoshop can replace the existing **${splitSaveDialogOutputPath(filename).filename}** file.`,
    warnings: [],
    data: {
      kind: 'desktop_save_replace_existing_confirmed',
      app: tree.data.app || appQuery || null,
      filename,
      targetPath: replaceButton.id,
      buttonLabel: replaceButton.label || replaceButton.value || null,
    },
  };
}

async function runPhotoshopSaveForWebExportFallback(outputPath: string, appQuery?: string): Promise<ComputerAppAdapterResult> {
  const appName = appQuery || 'Photoshop';
  const target = splitSaveDialogOutputPath(outputPath);
  const targetFormat = normalizeSaveForWebTargetFormat(target.filename);
  await bridgeFocusApp(appName).catch(() => null);
  const shortcut = await bridgePressKeys('Cmd+Opt+Shift+S');
  if (!shortcut.ok) {
    return {
      ok: false,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web shortcut failed: ${shortcut.error || shortcut.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_press_keys failed with ${shortcut.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: shortcut.errorCode, outputPath },
    };
  }
  await sleep(1500);
  const clickedSave = await clickSaveForWebSaveButton(appName, targetFormat);
  if (!clickedSave.ok) {
    return {
      ...clickedSave,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web fallback could not continue. ${clickedSave.message}`,
      warnings: ['photoshop_export_proof stale_bridge; save_for_web_fallback failed', ...clickedSave.warnings],
    };
  }
  await sleep(1000);
  const namedFile = await setSaveDialogOutputPath(outputPath, appName);
  if (!namedFile.ok) {
    return {
      ...namedFile,
      message: `Photoshop proof export endpoint was unavailable, and the Save for Web fallback could not set the output path. ${namedFile.message}`,
      warnings: ['photoshop_export_proof stale_bridge; save_for_web_fallback failed', ...namedFile.warnings],
    };
  }
  const confirmed = await bridgePressKeys('Return');
  if (!confirmed.ok) {
    return {
      ok: false,
      message: `Save for Web set **${target.filename}**, but confirming the Save dialog failed: ${confirmed.error || confirmed.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_press_keys failed with ${confirmed.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: confirmed.errorCode, outputPath },
    };
  }
  const postSave = await maybeHandlePostSaveImageDialogs(appName, target.filename);
  if (postSave && !postSave.ok) {
    return {
      ...postSave,
      message: `Photoshop Save for Web reached the final save dialog, but the export could not safely finish. ${postSave.message}`,
      warnings: ['photoshop_save_for_web_post_save_dialog failed', ...postSave.warnings],
    };
  }
  const outputVerification = await verifySaveDialogOutputFile(outputPath);
  if (outputVerification && !outputVerification.ok) {
    return {
      ...outputVerification,
      message: `Photoshop Save for Web reached the final save dialog, but the export could not be verified. ${outputVerification.message}`,
      warnings: ['photoshop_save_for_web_output_verification failed', ...outputVerification.warnings],
    };
  }
  const outputVerificationData = (outputVerification?.data || {}) as {
    sizeBytes?: unknown;
  };
  return {
    ok: true,
    message: `Photoshop proof export endpoint was unavailable, so I used Save for Web and saved **${target.filename}**${target.folderPath ? ` to **${target.folderPath}**` : ''}.`,
    warnings: [
      'photoshop_export_proof stale_bridge; used save_for_web_fallback',
      ...clickedSave.warnings,
      ...namedFile.warnings,
      ...(postSave?.warnings || []),
      ...(outputVerification?.warnings || []),
    ],
    data: {
      kind: 'desktop_photoshop_save_for_web_fallback',
      outputPath,
      filename: target.filename,
      folderPath: target.folderPath,
      fileExists: outputVerification ? true : null,
      sizeBytes: typeof outputVerificationData.sizeBytes === 'number' ? outputVerificationData.sizeBytes : null,
      saveForWeb: clickedSave.data || null,
      filenameEntry: namedFile.data || null,
      postSave: postSave?.data || null,
      outputVerification: outputVerification?.data || null,
      completionVerified: outputVerification?.ok === true,
    },
  };
}

async function maybeConfirmPostSaveOptions(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  if (!isImageFilename(filename)) return null;
  await sleep(700);
  const tree = await bridgeReadA11yTree({ appName: appQuery, maxDepth: 10, maxNodes: 600 });
  if (tree.ok && tree.data?.tree) {
    if (treeLooksLikeSaveExtensionMismatchDialog(tree.data.tree, filename)) return null;
    if (treeLooksLikeSaveReplaceExistingDialog(tree.data.tree, filename)) return null;
    const labels = saveDialogVisibleText(tree.data.tree, 120);
    if (!/\b(jpeg|jpg|png|tiff|image options|quality|format options|options)\b/i.test(labels)) return null;
    const okButton = findBestA11yNode(tree.data.tree, 'OK') || findBestA11yNode(tree.data.tree, 'Save');
    if (okButton) {
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: okButton.id, appName: tree.data.app || appQuery });
      if (clicked.ok) {
        return {
          ok: true,
          message: `Confirmed the post-save image options dialog for **${filename}**.`,
          warnings: [],
          data: { kind: 'desktop_save_options_confirmed', app: tree.data.app || appQuery || null, targetPath: okButton.id },
        };
      }
    }
    const pressed = await bridgePressKeys('Return');
    if (pressed.ok) {
      return {
        ok: true,
        message: `Confirmed the post-save image options dialog with Return.`,
        warnings: [],
        data: { kind: 'desktop_save_options_confirmed', app: tree.data.app || appQuery || null, method: 'return_key' },
      };
    }
  }
  return null;
}

async function maybeHandlePostSaveImageDialogs(appQuery: string | undefined, filename: string): Promise<ComputerAppAdapterResult | null> {
  const handled: ComputerAppAdapterResult[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const extensionMismatch = await maybeResolveSaveExtensionMismatch(appQuery, filename);
    if (extensionMismatch) {
      if (!extensionMismatch.ok) return extensionMismatch;
      handled.push(extensionMismatch);
      continue;
    }
    const replaceExisting = await maybeResolveSaveReplaceExisting(appQuery, filename);
    if (replaceExisting) {
      if (!replaceExisting.ok) return replaceExisting;
      handled.push(replaceExisting);
      continue;
    }
    break;
  }
  const imageOptions = await maybeConfirmPostSaveOptions(appQuery, filename);
  if (imageOptions && !imageOptions.ok) return imageOptions;
  const allHandled = [...handled, ...(imageOptions ? [imageOptions] : [])];
  if (allHandled.length > 1) {
    return {
      ok: true,
      message: allHandled.map((result) => result.message).join(' '),
      warnings: allHandled.flatMap((result) => result.warnings),
      data: {
        kind: 'desktop_post_save_image_dialogs_confirmed',
        dialogs: allHandled.map((result) => result.data || null),
      },
    };
  }
  return allHandled[0] || null;
}

async function verifySaveDialogOutputFile(outputPath: string): Promise<ComputerAppAdapterResult | null> {
  const cleanPath = String(outputPath || '').trim();
  if (!cleanPath || !isImageFilename(cleanPath) || !isStatableLocalSavePath(cleanPath)) return null;
  const target = splitSaveDialogOutputPath(cleanPath);
  await sleep(800);
  const stat = await bridgeStatFile(cleanPath).catch(() => null);
  if (!stat) {
    return {
      ok: false,
      message: `The save dialog closed, but I could not verify that **${target.filename}** was written. I stopped before reporting the Photoshop export as complete.`,
      warnings: ['save output verification unavailable'],
      data: { kind: 'desktop_save_output_unverified', outputPath: cleanPath, filename: target.filename },
    };
  }
  if (!stat.ok) {
    return {
      ok: false,
      message: `The save dialog closed, but I could not verify **${target.filename}**: ${stat.error || stat.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_file_stat failed with ${stat.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_save_output_stat_failed', outputPath: cleanPath, filename: target.filename, errorCode: stat.errorCode },
    };
  }
  if (!stat.data?.exists || stat.data.kind !== 'file') {
    return {
      ok: false,
      message: `The save dialog closed, but **${target.filename}** was not found at **${cleanPath}**. I stopped before reporting the Photoshop export as complete.`,
      warnings: ['save output file missing after export'],
      data: {
        kind: 'desktop_save_output_missing',
        outputPath: cleanPath,
        filename: target.filename,
        exists: stat.data?.exists ?? false,
        fileKind: stat.data?.kind ?? null,
      },
    };
  }
  return {
    ok: true,
    message: `Verified **${target.filename}** exists${target.folderPath ? ` at **${target.folderPath}**` : ''}.`,
    warnings: [],
    data: {
      kind: 'desktop_save_output_verified',
      outputPath: cleanPath,
      filename: target.filename,
      filePath: stat.data.path,
      sizeBytes: stat.data.size,
      modifiedAt: stat.data.modifiedAt,
    },
  };
}

function detectComputerAppAdapterSequence(task: string): {
  sequence: LocalComputerAwarenessIntent[];
  recipe: AppAutomationRecipe | null;
} {
  const recipe = buildAppleNotesCreateNoteRecipe(task);
  if (recipe) {
    return {
      sequence: buildAppleNotesCreateNoteSequence(recipe),
      recipe,
    };
  }
  return {
    sequence: detectLocalComputerAwarenessIntentSequence(task),
    recipe: null,
  };
}

export const __computerAppAdapterTestables = {
  treeLooksLikeSaveExtensionMismatchDialog,
  findPreferredSaveExtensionMismatchButton,
  normalizeFileExtension,
  buildAppleNotesCreateNoteRecipe,
  buildAppleNotesCreateNoteSequence,
  detectComputerAppAdapterSequence,
  executeObservedNativeAppActivation,
  executeObservedNativeSemanticAction,
};

// E3 — region-zoom coordinate re-click. When an a11y element click fails
// but the matched node carries a bbox, take ONE bounded region screenshot
// around the target (zoom re-observe at full resolution — the
// vendor-validated fix for missed small targets) and then a single
// coordinate click at the bbox centre. Returns null when the fallback
// is not applicable (no bbox, bad bounds, zoom or click failed) so the
// caller surfaces the original element-click failure.
const REGION_ZOOM_PADDING_PX = 48;

async function regionZoomCoordinateReclick(args: {
  match: A11yNode;
  app: string | null;
  targetLabel: string;
  failedClickError: string;
}): Promise<ComputerAppAdapterResult | null> {
  const bbox = args.match.bbox;
  if (!bbox || bbox.length !== 4) return null;
  const x = Math.max(0, Math.round(bbox[0]));
  const y = Math.max(0, Math.round(bbox[1]));
  const w = Math.round(bbox[2]);
  const h = Math.round(bbox[3]);
  if (w <= 0 || h <= 0) return null;
  const screen = await bridgeGetScreenSize();
  if (!screen.ok || !screen.data) return null;
  const screenW = Number(screen.data.width || 0);
  const screenH = Number(screen.data.height || 0);
  const centerX = Math.round(x + w / 2);
  const centerY = Math.round(y + h / 2);
  if (screenW <= 0 || screenH <= 0 || centerX >= screenW || centerY >= screenH) return null;
  const region: [number, number, number, number] = [
    Math.max(0, x - REGION_ZOOM_PADDING_PX),
    Math.max(0, y - REGION_ZOOM_PADDING_PX),
    Math.min(screenW, x + w + REGION_ZOOM_PADDING_PX),
    Math.min(screenH, y + h + REGION_ZOOM_PADDING_PX),
  ];
  if (region[2] <= region[0] || region[3] <= region[1]) return null;
  const zoom = await bridgeTakeScreenshot({ region });
  if (!zoom.ok || !zoom.data) return null;
  const clicked = await bridgeMouseClick({ x: centerX, y: centerY });
  if (!clicked.ok) return null;
  const label = args.match.label || args.match.value || args.targetLabel;
  return {
    ok: true,
    message:
      `Accessibility click on **${label}** failed (${args.failedClickError}), so I re-observed the target with a ` +
      `${region[2] - region[0]}x${region[3] - region[1]}px region zoom (${Math.round((zoom.data.sizeBytes || 0) / 1024)} KB) ` +
      `and clicked its centre at (${centerX}, ${centerY})${args.app ? ` in **${args.app}**` : ''}.`,
    warnings: ['a11y element click failed; used region-zoom coordinate fallback'],
    data: {
      kind: 'desktop_semantic_click_coordinate_fallback',
      app: args.app,
      targetPath: args.match.id,
      targetRole: args.match.role,
      targetLabel: label,
      region,
      clickX: centerX,
      clickY: centerY,
      zoomSizeBytes: zoom.data.sizeBytes || 0,
    },
  };
}

async function observeBeforeCoordinateAction(points: Array<{ x: number; y: number }>): Promise<{ ok: true; note: string } | { ok: false; message: string }> {
  const screen = await bridgeGetScreenSize();
  if (!screen.ok || !screen.data) {
    return { ok: false, message: `Could not verify screen size before coordinate action: ${screen.error || screen.errorCode || 'unknown error'}.` };
  }
  const width = Number(screen.data.width || 0);
  const height = Number(screen.data.height || 0);
  const outOfBounds = points.find((point) => point.x < 0 || point.y < 0 || point.x >= width || point.y >= height);
  if (outOfBounds) {
    return { ok: false, message: `Coordinate (${outOfBounds.x}, ${outOfBounds.y}) is outside the primary screen bounds ${width}x${height}.` };
  }
  const screenshot = await bridgeTakeScreenshot();
  if (!screenshot.ok || !screenshot.data) {
    return { ok: false, message: `Could not capture a screenshot before coordinate action: ${screenshot.error || screenshot.errorCode || 'unknown error'}.` };
  }
  return {
    ok: true,
    note: `Preflight observed screen ${width}x${height} and captured a ${Math.round((screenshot.data.sizeBytes || 0) / 1024)} KB screenshot before the pointer action.`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(50, Math.min(30_000, Math.trunc(ms)))));
}

type DesktopSequenceContext = {
  expectedInDesignDocumentName?: string | null;
  expectedInDesignDocumentPath?: string | null;
  expectedPhotoshopDocumentName?: string | null;
  expectedPhotoshopDocumentPath?: string | null;
};

function basenameFromDesktopPath(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.split(/[\\/]/).filter(Boolean).pop() || null;
}

async function openFirstFileSearchMatch(intent: {
  query?: string;
  rootPath?: string;
  extensions?: string[];
  appQuery?: string;
}): Promise<ComputerAppAdapterResult> {
  const query = String(intent.query || '').trim();
  const rootPath = String(intent.rootPath || '~').trim() || '~';
  if (!query) {
    return {
      ok: false,
      message: 'File search open failed because no filename or search query was provided.',
      warnings: ['desktop_open_file_search_match missing query'],
      data: { kind: 'desktop_bridge_error', errorCode: 'invalid_input' },
    };
  }

  const isGoogleDriveSearch = isGoogleDriveRootPath(rootPath);
  const searchOptions: { maxResults: number; maxDepth: number; includeContent: boolean; extensions?: string[] } = {
    maxResults: isGoogleDriveSearch ? 12 : 8,
    maxDepth: isGoogleDriveSearch ? 12 : 8,
    includeContent: false,
  };
  if (Array.isArray(intent.extensions) && intent.extensions.length > 0) {
    searchOptions.extensions = intent.extensions;
  }

  const rootCandidates = buildFileSearchRootCandidates(rootPath);
  const attempts: Array<{ rootPath: string; ok: boolean; error?: string; errorCode?: string; matchCount?: number; truncated?: boolean }> = [];
  let lastSearch: Awaited<ReturnType<typeof bridgeSearchFiles>> | null = null;
  let sawSuccessfulSearch = false;
  for (const candidateRoot of rootCandidates) {
    const searched = await bridgeSearchFiles(candidateRoot, query, searchOptions);
    lastSearch = searched;
    attempts.push({
      rootPath: candidateRoot,
      ok: searched.ok,
      error: searched.error,
      errorCode: searched.errorCode,
      matchCount: searched.data?.matches?.length || 0,
      truncated: searched.data?.truncated,
    });
    if (!searched.ok) {
      if (searched.errorCode === 'file_access_not_granted' && sawSuccessfulSearch) continue;
      if (searched.errorCode && !/\bpath_not_found|not_found|invalid_input\b/i.test(searched.errorCode)) break;
      continue;
    }
    sawSuccessfulSearch = true;
    const matches = searched.data?.matches || [];
    if (matches.length === 0) continue;
    const queryLower = query.toLowerCase();
    const match = matches.find((item) => item.name.toLowerCase() === queryLower) || matches[0];
    const sourcePhrase = isGoogleDriveSearch
      ? (isLikelyGoogleDriveSearchRoot(candidateRoot) ? 'in Google Drive' : 'from the broadened local search')
      : '';
    let openPath = match.path;
    let savedDesktopPath: string | null = null;
    if (isGoogleDriveSearch) {
      const desktopPath = desktopCopyPathForDriveFile(match.name);
      const copied = await bridgeCopyFile(match.path, desktopPath, { overwrite: true });
      if (!copied.ok) {
        return {
          ok: false,
          message: `Found **${match.name}** ${sourcePhrase} at **${match.path}**, but could not save it to Desktop before opening: ${copied.error || copied.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_file_copy failed with ${copied.errorCode || 'unknown_error'}`],
          data: {
            kind: 'desktop_bridge_error',
            errorCode: copied.errorCode,
            originalPath: match.path,
            desktopPath,
            attempts,
          },
        };
      }
      savedDesktopPath = copied.data?.toPath || desktopPath;
      openPath = savedDesktopPath;
    }

    const opened = await bridgeOpenPath(openPath, intent.appQuery ? { appName: intent.appQuery } : undefined);
    if (!opened.ok) {
      return {
        ok: false,
        message: `Found **${match.name}**${savedDesktopPath ? ` and saved it to Desktop at **${savedDesktopPath}**` : ''}, but could not open it: ${opened.error || opened.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_open_path failed with ${opened.errorCode || 'unknown_error'}`],
        data: {
          kind: 'desktop_bridge_error',
          errorCode: opened.errorCode,
          originalPath: match.path,
          path: openPath,
          desktopPath: savedDesktopPath,
          attempts,
        },
      };
    }

    let modalResult: ComputerAppAdapterResult | null = null;
    if (intent.appQuery) {
      await bridgeWaitForApp(intent.appQuery, 12_000).catch(() => null);
      modalResult = await handleBlockingAppModals(intent.appQuery, {
        context: 'after_open_file_search_match',
        maxDialogs: 4,
      });
      if (modalResult && !modalResult.ok) return modalResult;
    }

    const recoveredRoot = candidateRoot !== rootCandidates[0];
    const googleDriveCopyMessage = savedDesktopPath
      ? `Found **${match.name}** ${sourcePhrase}, saved a Desktop copy at **${savedDesktopPath}**, and opened that copy.`
      : `Found and opened **${match.name}** from **${match.path}**.`;
    return {
      ok: true,
      message: `${recoveredRoot ? `The first search root had no match, so I broadened the search. ` : ''}${googleDriveCopyMessage}${modalResult ? ` ${modalResult.message}` : ''}`,
      warnings: [
        ...(searched.data?.truncated ? ['desktop_file_search truncated'] : []),
        ...(recoveredRoot ? [`desktop_file_search recovered via ${candidateRoot}`] : []),
        ...(savedDesktopPath ? ['desktop_google_drive_file_saved_to_desktop'] : []),
        ...(modalResult?.warnings || []),
      ],
      data: {
        kind: 'desktop_open_file_search_match',
        query,
        rootPath: searched.data?.rootPath || candidateRoot,
        path: opened.data?.path || openPath,
        originalPath: match.path,
        desktopPath: savedDesktopPath,
        savedToDesktop: Boolean(savedDesktopPath),
        matchCount: matches.length,
        app: intent.appQuery || null,
        attempts,
        recovery: recoveredRoot ? { strategy: 'broaden_file_search_root', rootPath: candidateRoot } : null,
        modalHandling: modalResult?.data || null,
      },
    };
  }

  const searched = lastSearch;
  if (searched && !searched.ok && !sawSuccessfulSearch) {
    return {
      ok: false,
      message: `Could not search **${rootPath}** for **${query}**: ${searched.error || searched.errorCode || 'unknown bridge error'}.`,
      warnings: [`desktop_file_search failed with ${searched.errorCode || 'unknown_error'}`],
      data: { kind: 'desktop_bridge_error', errorCode: searched.errorCode, rootPath, query, attempts },
    };
  }

  return {
    ok: false,
    message: `No local file matches for **${query}** under **${rootCandidates.join('**, **')}**.${isGoogleDriveSearch ? ' Make sure Google Drive for Desktop is running and the file is available offline or synced locally, then retry.' : ''}`,
    warnings: ['desktop_file_search no matches'],
    data: { kind: 'desktop_file_search', rootPath, query, matches: [], attempts },
  };
}

function isGoogleDriveRootPath(rootPath: string): boolean {
  return /^(?:google[_\s-]*drive|gdrive|my\s+drive)$/i.test(String(rootPath || '').trim());
}

function isLikelyGoogleDriveSearchRoot(rootPath: string): boolean {
  return /(?:CloudStorage|Google Drive|My Drive|~\/Drive|\/Drive\b)/i.test(String(rootPath || ''));
}

function desktopCopyPathForDriveFile(fileName: string): string {
  const safeName = String(fileName || 'Google Drive file')
    .replace(/[/:`$;|&><\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Google Drive file';
  return `~/Desktop/${safeName}`;
}

function buildFileSearchRootCandidates(rootPath: string): string[] {
  const normalized = String(rootPath || '~').trim() || '~';
  if (isGoogleDriveRootPath(normalized)) {
    return [
      '~/Library/CloudStorage',
      '~/Google Drive',
      '~/My Drive',
      '~/Drive',
      '~/Documents',
      '~',
    ];
  }
  const roots = normalized === '~'
    ? ['~/Desktop', '~/Documents', '~/Downloads', '~']
    : [normalized, '~/Desktop', '~/Documents', '~/Downloads', '~'];
  return Array.from(new Set(roots));
}

type DesktopSequenceStepRecord = {
  index: number;
  kind: string | null;
  command: string;
  ok: boolean;
  message: string;
  recovered?: boolean;
  recovery?: string;
};

function shouldCheckBlockingModalAfterStep(
  step: LocalComputerAwarenessIntent,
  nextStep?: LocalComputerAwarenessIntent,
): boolean {
  const appQuery = step.appQuery || nextStep?.appQuery;
  if (!appQuery) return false;
  const currentKind = step.kind || '';
  const nextKind = nextStep?.kind || '';
  return [
    'open_file_search_match',
    'open_path',
    'launch_app',
    'focus_app',
    'wait_for_app',
    'menu_click',
    'press_keys',
    'semantic_click',
    'indesign_find_change',
    'indesign_batch_find_change',
    'indesign_document_status',
    'indesign_text_inventory',
    'indesign_set_layer_state',
    'indesign_batch_update_text_layers',
    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
    'photoshop_layer_inventory',
    'photoshop_set_layer_state',
    'photoshop_update_text_layer',
    'photoshop_place_asset',
    'photoshop_export_proof',
  ].includes(currentKind) || [
    'menu_click',
    'semantic_click',
    'set_field_text',
    'type_text',
    'paste_text',
    'press_keys',
    'indesign_find_change',
    'indesign_batch_find_change',
    'indesign_document_status',
    'indesign_text_inventory',
    'indesign_set_layer_state',
    'indesign_batch_update_text_layers',
    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
    'photoshop_layer_inventory',
    'photoshop_set_layer_state',
    'photoshop_update_text_layer',
    'photoshop_place_asset',
    'photoshop_export_proof',
  ].includes(nextKind);
}

function formatInDesignStatusSummary(status: NonNullable<Awaited<ReturnType<typeof bridgeInDesignDocumentStatus>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!status.appRunning) {
    return {
      message: `${status.appName || 'InDesign'} is not currently running.`,
      warnings: ['indesign_document_status app not running'],
    };
  }
  if (status.documentCount < 1 || !status.activeDocumentName) {
    return {
      message: `${status.appName || 'InDesign'} is running, but there is no active document open.`,
      warnings: ['indesign_document_status no active document'],
    };
  }
  const issueCount = (status.missingLinks || 0) + (status.modifiedLinks || 0) + (status.missingFonts || 0);
  const lockNote = status.lockedLayers > 0 || status.hiddenLayers > 0
    ? ` ${status.lockedLayers} locked layer${status.lockedLayers === 1 ? '' : 's'} and ${status.hiddenLayers} hidden layer${status.hiddenLayers === 1 ? '' : 's'} detected.`
    : '';
  const issueNote = issueCount > 0
    ? ` Needs attention: ${status.missingLinks} missing link${status.missingLinks === 1 ? '' : 's'}, ${status.modifiedLinks} modified link${status.modifiedLinks === 1 ? '' : 's'}, ${status.missingFonts} missing font${status.missingFonts === 1 ? '' : 's'}.`
    : ' No missing fonts or link issues were detected.';
  const openDocs = status.documents.length > 1
    ? ` Open documents: ${status.documents.map((doc) => doc.name).join(', ')}.`
    : '';
  return {
    message: `InDesign status for **${status.activeDocumentName}**: ${status.pageCount} page${status.pageCount === 1 ? '' : 's'}, ${status.spreadCount} spread${status.spreadCount === 1 ? '' : 's'}, ${status.layerCount} layer${status.layerCount === 1 ? '' : 's'}, ${status.linkCount} link${status.linkCount === 1 ? '' : 's'}, ${status.fontCount} font${status.fontCount === 1 ? '' : 's'}. Document is ${status.activeDocumentModified ? 'modified' : 'not modified'} and ${status.activeDocumentSaved ? 'saved' : 'unsaved'}.${issueNote}${lockNote}${openDocs}`,
    warnings: [
      ...(issueCount > 0 ? ['indesign_document_status needs attention'] : []),
      ...(status.lockedLayers > 0 ? ['indesign_document_status locked layers'] : []),
      ...(status.hiddenLayers > 0 ? ['indesign_document_status hidden layers'] : []),
    ],
  };
}

function formatInDesignTextInventorySummary(inventory: NonNullable<Awaited<ReturnType<typeof bridgeInDesignTextInventory>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!inventory.appRunning) {
    return {
      message: `${inventory.appName || 'InDesign'} is not currently running.`,
      warnings: ['indesign_text_inventory app not running'],
    };
  }
  if (!inventory.documentName) {
    return {
      message: `${inventory.appName || 'InDesign'} is running, but there is no active document to inspect.`,
      warnings: ['indesign_text_inventory no active document'],
    };
  }
  const sampleFrames = inventory.frames.slice(0, 8).map((frame, index) => {
    const labelParts = [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || 'unnamed frame';
    const flags = [
      frame.overflows ? 'overset' : '',
      frame.locked ? 'locked' : '',
      frame.visible ? '' : 'hidden',
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const matchText = inventory.query && frame.matchCount > 0 ? ` [${frame.matchCount} match${frame.matchCount === 1 ? '' : 'es'}]` : '';
    const preview = frame.contentPreview ? `: ${frame.contentPreview}` : '';
    return `${index + 1}. ${labelParts}${suffix}${matchText}${preview}`;
  });
  const layerHint = inventory.layerNames.length > 0
    ? ` Layers include: ${inventory.layerNames.slice(0, 12).join(', ')}${inventory.layerNames.length > 12 ? ', ...' : ''}.`
    : '';
  const queryNote = inventory.query ? ` matching **${inventory.query}**` : '';
  const matchNote = inventory.query ? `, ${inventory.queryMatches} text occurrence${inventory.queryMatches === 1 ? '' : 's'}` : '';
  return {
    message: `InDesign text inventory for **${inventory.documentName}**${queryNote}: ${inventory.textFrameCount} text frame${inventory.textFrameCount === 1 ? '' : 's'}, ${inventory.matchedFrames} matching frame${inventory.matchedFrames === 1 ? '' : 's'}${matchNote}, ${inventory.oversetFrames} overset frame${inventory.oversetFrames === 1 ? '' : 's'}. ${sampleFrames.length > 0 ? `Top candidates:\n${sampleFrames.join('\n')}` : 'No text frame candidates were returned.'}${layerHint}`,
    warnings: [
      ...(inventory.oversetFrames > 0 ? ['indesign_text_inventory overset text'] : []),
      ...(inventory.lockedLayers > 0 ? ['indesign_text_inventory locked layers'] : []),
      ...(inventory.hiddenLayers > 0 ? ['indesign_text_inventory hidden layers'] : []),
      ...(inventory.error ? ['indesign_text_inventory reported error'] : []),
    ],
  };
}

function formatPhotoshopStatusSummary(status: NonNullable<Awaited<ReturnType<typeof bridgePhotoshopDocumentStatus>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!status.appRunning) {
    return {
      message: `${status.appName || 'Photoshop'} is not currently running.`,
      warnings: ['photoshop_document_status app not running'],
    };
  }
  if (status.documentCount < 1 || !status.activeDocumentName) {
    return {
      message: `${status.appName || 'Photoshop'} is running, but there is no active document open.`,
      warnings: ['photoshop_document_status no active document'],
    };
  }
  const issueNote = status.lockedLayers > 0 || status.hiddenLayers > 0
    ? ` ${status.lockedLayers} locked layer${status.lockedLayers === 1 ? '' : 's'} and ${status.hiddenLayers} hidden layer${status.hiddenLayers === 1 ? '' : 's'} detected.`
    : '';
  const selectionNote = status.selectionActive ? ' A selection is active.' : ' No active selection was detected.';
  const openDocs = status.documents.length > 1
    ? ` Open documents: ${status.documents.map((doc) => doc.name).join(', ')}.`
    : '';
  return {
    message: `Photoshop status for **${status.activeDocumentName}**: ${status.widthPx}x${status.heightPx}px at ${status.resolution || 0} ppi, ${status.layerCount} layer${status.layerCount === 1 ? '' : 's'}, ${status.textLayerCount} text layer${status.textLayerCount === 1 ? '' : 's'}, ${status.smartObjectCount} smart object${status.smartObjectCount === 1 ? '' : 's'}, ${status.adjustmentLayerCount} adjustment layer${status.adjustmentLayerCount === 1 ? '' : 's'}. Document is ${status.activeDocumentModified ? 'modified' : 'not modified'} and ${status.activeDocumentSaved ? 'saved' : 'unsaved'}.${selectionNote}${issueNote}${openDocs}`,
    warnings: [
      ...(status.lockedLayers > 0 ? ['photoshop_document_status locked layers'] : []),
      ...(status.hiddenLayers > 0 ? ['photoshop_document_status hidden layers'] : []),
    ],
  };
}

function formatPhotoshopLayerInventorySummary(inventory: NonNullable<Awaited<ReturnType<typeof bridgePhotoshopLayerInventory>>['data']>): {
  message: string;
  warnings: string[];
} {
  if (!inventory.appRunning) {
    return {
      message: `${inventory.appName || 'Photoshop'} is not currently running.`,
      warnings: ['photoshop_layer_inventory app not running'],
    };
  }
  if (!inventory.documentName) {
    return {
      message: `${inventory.appName || 'Photoshop'} is running, but there is no active document to inspect.`,
      warnings: ['photoshop_layer_inventory no active document'],
    };
  }
  const sampleLayers = inventory.layers.slice(0, 10).map((layer, index) => {
    const flags = [
      layer.visible ? '' : 'hidden',
      layer.locked ? 'locked' : '',
      layer.hasMask ? 'mask' : '',
      layer.kind || layer.type || '',
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    const preview = layer.textPreview ? `: ${layer.textPreview}` : '';
    return `${index + 1}. ${layer.path || layer.name || 'unnamed layer'}${suffix}${preview}`;
  });
  const queryNote = inventory.query ? ` matching **${inventory.query}**` : '';
  return {
    message: `Photoshop layer inventory for **${inventory.documentName}**${queryNote}: ${inventory.layerCount} layer${inventory.layerCount === 1 ? '' : 's'}, ${inventory.matchedLayers} candidate${inventory.matchedLayers === 1 ? '' : 's'}, ${inventory.textLayerCount} text layer${inventory.textLayerCount === 1 ? '' : 's'}, ${inventory.smartObjectCount} smart object${inventory.smartObjectCount === 1 ? '' : 's'}, ${inventory.maskLayerCount} masked layer${inventory.maskLayerCount === 1 ? '' : 's'}. ${sampleLayers.length > 0 ? `Top layers:\n${sampleLayers.join('\n')}` : 'No layer candidates were returned.'}`,
    warnings: [
      ...(inventory.lockedLayers > 0 ? ['photoshop_layer_inventory locked layers'] : []),
      ...(inventory.hiddenLayers > 0 ? ['photoshop_layer_inventory hidden layers'] : []),
      ...(inventory.error ? ['photoshop_layer_inventory reported error'] : []),
    ],
  };
}

type InDesignRecoveryAttempt = {
  command: string;
  kind: string | null;
  ok: boolean;
  message: string;
};

type InDesignRecoveryOutcome = {
  result: ComputerAppAdapterResult;
  attempts: InDesignRecoveryAttempt[];
  strategy: string;
};

type InDesignRecoveryMemoryRow = {
  signature: string;
  recovery: string;
  at?: string;
};

const INDESIGN_RECOVERY_MEMORY_KEY = 'uc_indesign_recovery_memory_v1';

function rememberInDesignRecovery(signature: string, recovery: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const existing = JSON.parse(localStorage.getItem(INDESIGN_RECOVERY_MEMORY_KEY) || '[]');
    const rows = Array.isArray(existing) ? existing : [];
    rows.unshift({ signature, recovery, at: new Date().toISOString() });
    localStorage.setItem(INDESIGN_RECOVERY_MEMORY_KEY, JSON.stringify(rows.slice(0, 50)));
  } catch {
    /* best-effort local recovery memory */
  }
}

function readInDesignRecoveryMemory(signature: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const existing = JSON.parse(localStorage.getItem(INDESIGN_RECOVERY_MEMORY_KEY) || '[]');
    if (!Array.isArray(existing)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of existing as InDesignRecoveryMemoryRow[]) {
      if (row?.signature !== signature || !row.recovery || seen.has(row.recovery)) continue;
      seen.add(row.recovery);
      out.push(row.recovery);
    }
    return out.slice(0, 5);
  } catch {
    return [];
  }
}

function getInDesignRecoverySignature(step: LocalComputerAwarenessIntent): string {
  return `${step.kind}:${step.appQuery || 'InDesign'}:${step.targetLabel || step.menuPath?.join(' > ') || step.combo || step.reason}`;
}

function prioritizeInDesignRecoveryCandidates(
  signature: string,
  candidates: LocalComputerAwarenessIntent[],
): LocalComputerAwarenessIntent[] {
  const remembered = readInDesignRecoveryMemory(signature);
  if (remembered.length === 0) return candidates;
  return [...candidates].sort((a, b) => {
    const aStrategy = remembered.findIndex((strategy) => strategy === `fallback:${renderLocalComputerAwarenessIntent(a)}`);
    const bStrategy = remembered.findIndex((strategy) => strategy === `fallback:${renderLocalComputerAwarenessIntent(b)}`);
    const aRank = aStrategy === -1 ? Number.MAX_SAFE_INTEGER : aStrategy;
    const bRank = bStrategy === -1 ? Number.MAX_SAFE_INTEGER : bStrategy;
    return aRank - bRank;
  });
}

async function executeLocalDesktopSequenceStep(
  step: LocalComputerAwarenessIntent,
  command: string,
  context: DesktopSequenceContext = {},
): Promise<ComputerAppAdapterResult> {
  if (step.kind === 'wait') {
    await sleep(step.durationMs || 1000);
    return {
      ok: true,
      message: `Waited ${Math.round((step.durationMs || 1000) / 100) / 10} seconds.`,
      warnings: [],
      data: { kind: 'desktop_wait', durationMs: step.durationMs || 1000 },
    };
  }
  if (isSaveDialogFilenameIntent(step)) {
    return setSaveDialogFilename(step.text || '', step.appQuery);
  }
  if (isSaveDialogOutputPathIntent(step)) {
    return setSaveDialogOutputPath(step.text || '', step.appQuery);
  }
  if (isSaveForWebSaveButtonIntent(step)) {
    return clickSaveForWebSaveButton(step.appQuery, normalizeSaveForWebTargetFormat(step.format || step.outputPath || step.text || null));
  }
  if (step.kind === 'open_file_search_match') {
    return openFirstFileSearchMatch(step);
  }
  if (step.kind === 'photoshop_document_status') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_document_status',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const status = await bridgePhotoshopDocumentStatus({
      appName: step.appQuery || 'Photoshop',
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!status.ok || !status.data) {
      const staleHint = status.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop status endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect Photoshop document status: ${status.error || status.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_document_status failed with ${status.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: status.errorCode },
      };
    }
    const summary = formatPhotoshopStatusSummary(status.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_photoshop_document_status',
        ...status.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_layer_inventory') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_layer_inventory',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const inventory = await bridgePhotoshopLayerInventory({
      appName: step.appQuery || 'Photoshop',
      query: step.query || undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
      maxItems: 40,
    });
    if (!inventory.ok || !inventory.data) {
      const staleHint = inventory.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop layer inventory endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect Photoshop layers: ${inventory.error || inventory.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_layer_inventory failed with ${inventory.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: inventory.errorCode },
      };
    }
    const summary = formatPhotoshopLayerInventorySummary(inventory.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_photoshop_layer_inventory',
        ...inventory.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_set_layer_state') {
    const layerName = String(step.targetLabel || '').trim();
    const action = step.layerStateAction;
    if (!layerName || !action) {
      return {
        ok: false,
        message: 'No target Photoshop layer name or layer-state action was provided.',
        warnings: ['photoshop_set_layer_state missing layerName or action'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_set_layer_state',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgePhotoshopSetLayerState({
      appName: step.appQuery || 'Photoshop',
      layerName,
      action,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop layer-state endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop layer-state update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_set_layer_state failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName, action },
      };
    }
    if (!updated.data.appRunning) {
      return {
        ok: false,
        message: `${updated.data.appName || 'Photoshop'} is not currently running.`,
        warnings: ['photoshop_set_layer_state app not running'],
        data: {
          kind: 'desktop_photoshop_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    if (updated.data.error || updated.data.matchedLayers !== 1) {
      const matchHint = updated.data.matchedLayers > 1
        ? `${updated.data.matchedLayers} layers matched; provide an exact layer name or full group path.`
        : updated.data.error || 'No matching layer was changed.';
      return {
        ok: false,
        message: `Photoshop did not change layer **${layerName}**: ${matchHint}`,
        warnings: ['photoshop_set_layer_state not applied'],
        data: {
          kind: 'desktop_photoshop_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    const stateText = action === 'show' || action === 'hide'
      ? `visible=${updated.data.afterVisible}`
      : `locked=${updated.data.afterLocked}`;
    return {
      ok: true,
      message: `${updated.data.changedLayers > 0 ? 'Changed' : 'Confirmed'} Photoshop layer **${updated.data.layerName}** is ${action}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''} (${stateText}).`,
      warnings: updated.data.changedLayers > 0 ? [] : ['photoshop_set_layer_state already in requested state'],
      data: {
        kind: 'desktop_photoshop_set_layer_state',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_update_text_layer') {
    const layerName = String(step.targetLabel || '').trim();
    const replacementText = String(step.text || '');
    if (!layerName) {
      return {
        ok: false,
        message: 'No target Photoshop text layer was provided.',
        warnings: ['photoshop_update_text_layer missing layerName'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_update_text_layer',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgePhotoshopUpdateTextLayer({
      appName: step.appQuery || 'Photoshop',
      layerName,
      replacementText,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop text-layer update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_update_text_layer failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName },
      };
    }
    const layerList = updated.data.layerNames.length > 0 ? ` Matching layers: ${updated.data.layerNames.map((name) => `**${name}**`).join(', ')}.` : '';
    const alreadyApplied = updated.data.updatedLayers < 1 && updated.data.replacementMatches > 0;
    return {
      ok: updated.data.updatedLayers > 0 || alreadyApplied,
      message: updated.data.updatedLayers > 0
        ? `Updated ${updated.data.updatedLayers} Photoshop text layer${updated.data.updatedLayers === 1 ? '' : 's'} for **${layerName}**${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}.${layerList}`
        : alreadyApplied
          ? `No Photoshop text layer needed a change: **${layerName}** already contains the requested text.${layerList}`
          : `No editable Photoshop text layer matched **${layerName}**. Checked ${updated.data.matchedLayers} matching layer${updated.data.matchedLayers === 1 ? '' : 's'}.${layerList}`,
      warnings: [
        ...(updated.data.updatedLayers > 0 || alreadyApplied ? [] : ['photoshop_update_text_layer no layers updated']),
      ],
      data: {
        kind: 'desktop_photoshop_update_text_layer',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_place_asset') {
    const assetPath = String(step.assetPath || step.path || '').trim();
    if (!assetPath) {
      return {
        ok: false,
        message: 'No asset path was provided for the Photoshop placement.',
        warnings: ['photoshop_place_asset missing assetPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_place_asset',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const placed = await bridgePhotoshopPlaceAsset({
      appName: step.appQuery || 'Photoshop',
      assetPath,
      layerName: step.targetLabel || undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!placed.ok || !placed.data) {
      const staleHint = placed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Photoshop place-asset endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Photoshop asset placement failed: ${placed.error || placed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_photoshop_place_asset failed with ${placed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: placed.errorCode, assetPath },
      };
    }
    return {
      ok: !placed.data.error,
      message: placed.data.error
        ? `Photoshop could not place **${assetPath}**: ${placed.data.error}`
        : `Placed **${assetPath}** in Photoshop${placed.data.documentName ? ` document **${placed.data.documentName}**` : ''}${placed.data.placedLayerName ? ` as layer **${placed.data.placedLayerName}**` : ''}.`,
      warnings: placed.data.error ? ['photoshop_place_asset reported error'] : [],
      data: {
        kind: 'desktop_photoshop_place_asset',
        ...placed.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'photoshop_export_proof') {
    const outputPath = String(step.outputPath || step.path || '').trim();
    if (!outputPath) {
      return {
        ok: false,
        message: 'No output path was provided for the Photoshop proof export.',
        warnings: ['photoshop_export_proof missing outputPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'Photoshop', {
      context: 'before_photoshop_export_proof',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const exported = await bridgePhotoshopExportProof({
      appName: step.appQuery || 'Photoshop',
      outputPath,
      format: step.format === 'jpg' || step.format === 'jpeg' || step.format === 'png' ? step.format : undefined,
      expectedDocumentName: context.expectedPhotoshopDocumentName || undefined,
      sourceDocumentPath: context.expectedPhotoshopDocumentPath || undefined,
    });
    if (!exported.ok || !exported.data) {
      if (exported.errorCode === 'stale_bridge') {
        const fallback = await runPhotoshopSaveForWebExportFallback(outputPath, step.appQuery || 'Photoshop');
        return {
          ...fallback,
          message: fallback.ok
            ? `${fallback.message} This avoided the stale /desktop/photoshop_export_proof bridge endpoint.`
            : `${fallback.message} Original proof export error: ${exported.error || exported.errorCode || 'unknown bridge error'}.`,
          warnings: [
            `desktop_photoshop_export_proof failed with ${exported.errorCode}`,
            ...fallback.warnings,
          ],
          data: {
            ...(fallback.data || {}),
            originalErrorCode: exported.errorCode,
            originalError: exported.error || null,
          },
        };
      }
      return {
        ok: false,
        message: `Photoshop proof export failed: ${exported.error || exported.errorCode || 'unknown bridge error'}.`,
        warnings: [`desktop_photoshop_export_proof failed with ${exported.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: exported.errorCode, outputPath },
      };
    }
    return {
      ok: exported.data.fileExists && !exported.data.error,
      message: exported.data.fileExists
        ? `Exported Photoshop proof to **${exported.data.outputPath}** (${Math.round((exported.data.sizeBytes || 0) / 1024)} KB, ${exported.data.format}).`
        : `Photoshop proof export did not produce **${exported.data.outputPath}**.${exported.data.error ? ` ${exported.data.error}` : ''}`,
      warnings: [
        ...(exported.data.fileExists ? [] : ['photoshop_export_proof missing output file']),
        ...(exported.data.error ? ['photoshop_export_proof reported error'] : []),
      ],
      data: {
        kind: 'desktop_photoshop_export_proof',
        ...exported.data,
        modalHandling: modalResult?.data || null,
        completionVerified: exported.data.fileExists && !exported.data.error,
      },
    };
  }
  if (step.kind === 'indesign_export_proof') {
    const outputPath = String(step.outputPath || step.path || '').trim();
    if (!outputPath) {
      return {
        ok: false,
        message: 'No output path was provided for the InDesign proof export.',
        warnings: ['indesign_export_proof missing outputPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_export_proof',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const exported = await bridgeInDesignExportProof({
      appName: step.appQuery || 'InDesign',
      outputPath,
      format: 'pdf',
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!exported.ok || !exported.data) {
      const staleHint = exported.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign proof export endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign proof export failed: ${exported.error || exported.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_export_proof failed with ${exported.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: exported.errorCode, outputPath },
      };
    }
    return {
      ok: exported.data.fileExists && !exported.data.error,
      message: exported.data.fileExists
        ? `Exported InDesign proof PDF to **${exported.data.outputPath}** (${Math.round((exported.data.sizeBytes || 0) / 1024)} KB, ${exported.data.pageCount} page${exported.data.pageCount === 1 ? '' : 's'}).`
        : `InDesign proof export did not produce **${exported.data.outputPath}**.${exported.data.error ? ` ${exported.data.error}` : ''}`,
      warnings: [
        ...(exported.data.fileExists ? [] : ['indesign_export_proof missing output file']),
        ...(exported.data.error ? ['indesign_export_proof reported error'] : []),
      ],
      data: {
        kind: 'desktop_indesign_export_proof',
        ...exported.data,
        modalHandling: modalResult?.data || null,
        completionVerified: exported.data.fileExists && !exported.data.error,
      },
    };
  }
  if (step.kind === 'indesign_package_document') {
    const outputFolderPath = String(step.outputFolderPath || step.outputPath || step.path || '').trim();
    if (!outputFolderPath) {
      return {
        ok: false,
        message: 'No output folder was provided for the InDesign package.',
        warnings: ['indesign_package_document missing outputFolderPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_package_document',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const packaged = await bridgeInDesignPackageDocument({
      appName: step.appQuery || 'InDesign',
      outputFolderPath,
      includeIdml: step.includeIdml === true,
      includePdf: step.includePdf === true,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!packaged.ok || !packaged.data) {
      const staleHint = packaged.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign package endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign package failed: ${packaged.error || packaged.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_package_document failed with ${packaged.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: packaged.errorCode, outputFolderPath },
      };
    }
    return {
      ok: packaged.data.packageOk && !packaged.data.error,
      message: packaged.data.packageOk
        ? `Packaged InDesign document to **${packaged.data.outputFolderPath}** (${packaged.data.fileCount} files, ${Math.round((packaged.data.sizeBytes || 0) / 1024)} KB).`
        : `InDesign did not complete packaging to **${packaged.data.outputFolderPath}**.${packaged.data.error ? ` ${packaged.data.error}` : ''}`,
      warnings: [
        ...(packaged.data.packageOk ? [] : ['indesign_package_document packageForPrint failed']),
        ...(packaged.data.error ? ['indesign_package_document reported error'] : []),
        ...(packaged.data.missingLinksBefore > 0 ? ['indesign_package_document missing links before package'] : []),
        ...(packaged.data.modifiedLinksBefore > 0 ? ['indesign_package_document modified links before package'] : []),
        ...(packaged.data.missingFontsBefore > 0 ? ['indesign_package_document missing fonts before package'] : []),
      ],
      data: {
        kind: 'desktop_indesign_package_document',
        ...packaged.data,
        modalHandling: modalResult?.data || null,
        completionVerified: packaged.data.packageOk
          && packaged.data.fileCount > 0
          && !packaged.data.error,
      },
    };
  }
  if (step.kind === 'indesign_relink_asset') {
    const assetPath = String(step.assetPath || step.path || '').trim();
    if (!assetPath) {
      return {
        ok: false,
        message: 'No replacement asset path was provided for the InDesign relink.',
        warnings: ['indesign_relink_asset missing assetPath'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_relink_asset',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const relinked = await bridgeInDesignRelinkAsset({
      appName: step.appQuery || 'InDesign',
      assetPath,
      linkQuery: step.linkQuery || step.targetLabel || undefined,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!relinked.ok || !relinked.data) {
      const staleHint = relinked.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign relink endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign asset relink failed: ${relinked.error || relinked.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_relink_asset failed with ${relinked.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: relinked.errorCode, assetPath },
      };
    }
    const linkList = relinked.data.linkNames.length > 0 ? ` Links: ${relinked.data.linkNames.map((name) => `**${name}**`).join(', ')}.` : '';
    return {
      ok: relinked.data.relinkedLinks > 0 && !relinked.data.error,
      message: relinked.data.relinkedLinks > 0
        ? `Relinked ${relinked.data.relinkedLinks} InDesign asset${relinked.data.relinkedLinks === 1 ? '' : 's'} to **${relinked.data.assetPath}**${relinked.data.documentName ? ` in **${relinked.data.documentName}**` : ''}.${linkList}`
        : `InDesign did not relink an asset to **${relinked.data.assetPath}**.${relinked.data.error ? ` ${relinked.data.error}` : ''}`,
      warnings: [
        ...(relinked.data.relinkedLinks > 0 ? [] : ['indesign_relink_asset no links relinked']),
        ...(relinked.data.error ? ['indesign_relink_asset reported error'] : []),
        ...(relinked.data.missingAfter > 0 ? ['indesign_relink_asset remaining missing or modified links'] : []),
      ],
      data: {
        kind: 'desktop_indesign_relink_asset',
        ...relinked.data,
        modalHandling: modalResult?.data || null,
        completionVerified: relinked.data.relinkedLinks > 0
          && relinked.data.missingAfter === 0
          && !relinked.data.error,
      },
    };
  }
  if (step.kind === 'indesign_document_status') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_document_status',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const status = await bridgeInDesignDocumentStatus({
      appName: step.appQuery || 'InDesign',
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!status.ok || !status.data) {
      const staleHint = status.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign status endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect InDesign document status: ${status.error || status.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_document_status failed with ${status.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: status.errorCode },
      };
    }
    const summary = formatInDesignStatusSummary(status.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_indesign_document_status',
        ...status.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_text_inventory') {
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_text_inventory',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const inventory = await bridgeInDesignTextInventory({
      appName: step.appQuery || 'InDesign',
      query: step.query || undefined,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
      maxItems: 30,
    });
    if (!inventory.ok || !inventory.data) {
      const staleHint = inventory.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign text inventory endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not inspect InDesign text frames: ${inventory.error || inventory.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_text_inventory failed with ${inventory.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: inventory.errorCode },
      };
    }
    const summary = formatInDesignTextInventorySummary(inventory.data);
    return {
      ok: true,
      message: summary.message,
      warnings: summary.warnings,
      data: {
        kind: 'desktop_indesign_text_inventory',
        ...inventory.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_set_layer_state') {
    const layerName = String(step.targetLabel || '').trim();
    const action = step.layerStateAction;
    if (!layerName || !action) {
      return {
        ok: false,
        message: 'No target InDesign layer name or layer-state action was provided.',
        warnings: ['indesign_set_layer_state missing layerName or action'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_set_layer_state',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignSetLayerState({
      appName: step.appQuery || 'InDesign',
      layerName,
      action,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign layer-state endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign layer-state update failed for **${layerName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_set_layer_state failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, layerName, action },
      };
    }
    if (updated.data.error || updated.data.matchedLayers !== 1) {
      const matchHint = updated.data.matchedLayers > 1
        ? `${updated.data.matchedLayers} layers matched; provide an exact layer name.`
        : updated.data.error || 'No matching layer was changed.';
      return {
        ok: false,
        message: `InDesign did not change layer **${layerName}**: ${matchHint}`,
        warnings: ['indesign_set_layer_state not applied'],
        data: {
          kind: 'desktop_indesign_set_layer_state',
          ...updated.data,
          modalHandling: modalResult?.data || null,
        },
      };
    }
    const stateText = action === 'show' || action === 'hide'
      ? `visible=${updated.data.afterVisible}`
      : `locked=${updated.data.afterLocked}`;
    return {
      ok: true,
      message: `${updated.data.changedLayers > 0 ? 'Changed' : 'Confirmed'} InDesign layer **${updated.data.layerName}** is ${action}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''} (${stateText}).`,
      warnings: updated.data.changedLayers > 0 ? [] : ['indesign_set_layer_state already in requested state'],
      data: {
        kind: 'desktop_indesign_set_layer_state',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_batch_update_text_layers') {
    const updates = Array.isArray(step.fieldUpdates)
      ? step.fieldUpdates.map((update) => ({
          fieldName: String(update.fieldName || '').trim(),
          replacementText: String(update.replacementText ?? ''),
        })).filter((update) => update.fieldName)
      : [];
    if (updates.length < 1) {
      return {
        ok: false,
        message: 'No InDesign text fields were provided for the batch update.',
        warnings: ['indesign_batch_update_text_layers missing updates'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_batch_update_text_layers',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignBatchUpdateTextLayers({
      appName: step.appQuery || 'InDesign',
      updates,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign batch text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign batch text-layer update failed: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_batch_update_text_layers failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, updates },
      };
    }
    const rows = updated.data.results.map((result, index) => {
      const layerText = result.layerNames.length > 0 ? ` on ${result.layerNames.join(', ')}` : '';
      const status = result.updatedFrames > 0
        ? `updated ${result.updatedFrames}${layerText}`
        : result.matchedFrames > 0 && result.replacementMatches > 0
          ? 'already applied'
          : result.matchedFrames > 0
            ? 'matched but not updated'
            : 'not found';
      return `${index + 1}. **${result.fieldName}**: ${status}`;
    });
    const failures = updated.data.results.filter((result) => result.matchedFrames < 1 || (result.updatedFrames < 1 && result.replacementMatches < 1));
    return {
      ok: failures.length === 0,
      message: `Batch InDesign text-layer update completed ${updated.data.results.length} field${updated.data.results.length === 1 ? '' : 's'}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}. Total updated frames: ${updated.data.updatedFrames}.\n${rows.join('\n')}`,
      warnings: [
        ...(failures.length > 0 ? ['indesign_batch_update_text_layers incomplete fields'] : []),
        ...(updated.data.unlockedCount > 0 ? ['indesign_batch_update_text_layers used lock-safe update'] : []),
      ],
      data: {
        kind: 'desktop_indesign_batch_update_text_layers',
        ...updated.data,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_update_text_layer') {
    const fieldName = String(step.targetLabel || '').trim();
    const replacementText = String(step.text || '');
    if (!fieldName) {
      return {
        ok: false,
        message: 'No target InDesign text field or layer was provided.',
        warnings: ['indesign_update_text_layer missing fieldName'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_update_text_layer',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const updated = await bridgeInDesignUpdateTextLayer({
      appName: step.appQuery || 'InDesign',
      fieldName,
      replacementText,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!updated.ok || !updated.data) {
      const staleHint = updated.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign text-layer endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign text-layer update failed for **${fieldName}**: ${updated.error || updated.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_update_text_layer failed with ${updated.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: updated.errorCode, fieldName },
      };
    }
    const count = updated.data.updatedFrames;
    const inventory = count < 1
      ? await bridgeInDesignTextInventory({
          appName: step.appQuery || 'InDesign',
          query: fieldName,
          expectedDocumentName: context.expectedInDesignDocumentName || undefined,
          sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
          maxItems: 10,
        }).catch(() => null)
      : null;
    const inventoryHint = inventory?.ok && inventory.data?.frames.length
      ? ` Candidate frames found: ${inventory.data.frames.slice(0, 5).map((frame) => [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || frame.contentPreview.slice(0, 60) || 'unnamed frame').join('; ')}.`
      : inventory?.ok && inventory.data
        ? ` I also inspected ${inventory.data.textFrameCount} text frame${inventory.data.textFrameCount === 1 ? '' : 's'} and found no candidates matching **${fieldName}**.`
        : '';
    const layerList = updated.data.layerNames.length > 0 ? ` on ${updated.data.layerNames.map((name) => `**${name}**`).join(', ')}` : '';
    return {
      ok: count > 0,
      message: count > 0
        ? `Updated ${count} InDesign text frame${count === 1 ? '' : 's'} for **${fieldName}**${layerList}${updated.data.documentName ? ` in **${updated.data.documentName}**` : ''}.`
        : `No editable InDesign text frame matched **${fieldName}**. I checked ${updated.data.matchedLayers} matching layer${updated.data.matchedLayers === 1 ? '' : 's'} and ${updated.data.matchedFrames} text frame${updated.data.matchedFrames === 1 ? '' : 's'}.${inventoryHint}`,
      warnings: [
        ...(count > 0 ? [] : ['indesign_update_text_layer no frames updated']),
        ...(inventory?.ok && inventory.data ? ['indesign_update_text_layer inspected text inventory'] : []),
        ...(updated.data.unlockedCount > 0 ? ['indesign_update_text_layer used lock-safe update'] : []),
      ],
      data: {
        kind: 'desktop_indesign_update_text_layer',
        ...updated.data,
        inventory: inventory?.ok ? inventory.data : null,
        modalHandling: modalResult?.data || null,
      },
    };
  }
  if (step.kind === 'indesign_find_change') {
    const findText = String(step.query || '').trim();
    const changeText = String(step.text || '');
    if (!findText) {
      return {
        ok: false,
        message: 'No Find text was provided for the InDesign Find/Change operation.',
        warnings: ['indesign_find_change missing findText'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_find_change',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const changed = await bridgeInDesignFindChange({
      appName: step.appQuery || 'InDesign',
      findText,
      changeText,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!changed.ok) {
      const staleHint = changed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign Find/Change endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign Find/Change failed for **${findText} → ${changeText}**: ${changed.error || changed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_find_change failed with ${changed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: changed.errorCode, findText, changeText },
      };
    }
    const count = changed.data?.changed ?? 0;
    const matched = changed.data?.matched ?? 0;
    const remaining = changed.data?.remaining ?? 0;
    const replacementMatches = changed.data?.replacementMatches ?? 0;
    const unlockedCount = changed.data?.unlockedCount ?? 0;
    const usedUnlockRecovery = changed.data?.method === 'find-change-unlocked';
    const alreadyApplied = count < 1 && matched < 1 && remaining < 1 && replacementMatches > 0;
    const diagnosticInventory = count < 1 || remaining > 0
      ? await bridgeInDesignTextInventory({
          appName: step.appQuery || 'InDesign',
          query: findText,
          expectedDocumentName: context.expectedInDesignDocumentName || undefined,
          sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
          maxItems: 10,
        }).catch(() => null)
      : null;
    const diagnosticHint = diagnosticInventory?.ok && diagnosticInventory.data
      ? diagnosticInventory.data.queryMatches > 0
        ? ` Inventory still sees ${diagnosticInventory.data.queryMatches} occurrence${diagnosticInventory.data.queryMatches === 1 ? '' : 's'} of **${findText}** across ${diagnosticInventory.data.matchedFrames} text frame${diagnosticInventory.data.matchedFrames === 1 ? '' : 's'}. Candidate frames: ${diagnosticInventory.data.frames.slice(0, 5).map((frame) => [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || frame.contentPreview.slice(0, 60) || 'unnamed frame').join('; ')}.`
        : ` Inventory checked ${diagnosticInventory.data.textFrameCount} text frame${diagnosticInventory.data.textFrameCount === 1 ? '' : 's'} and found no remaining text occurrences of **${findText}**.`
      : '';
    const recoveryNote = usedUnlockRecovery
      ? ` Used lock-safe recovery and restored ${unlockedCount} locked object${unlockedCount === 1 ? '' : 's'}.`
      : '';
    const verificationNote = count > 0
      ? remaining > 0
        ? ` Verification found ${remaining} original match${remaining === 1 ? '' : 'es'} still present.${diagnosticHint}`
        : ' Verified no original matches remain.'
      : '';
    const warnings = count > 0
      ? [
          ...(usedUnlockRecovery ? ['indesign_find_change used lock-safe recovery'] : []),
          ...(remaining > 0 ? ['indesign_find_change partial verification'] : []),
          ...(diagnosticInventory?.ok && diagnosticInventory.data ? ['indesign_find_change inspected text inventory'] : []),
        ]
      : [
          alreadyApplied
            ? 'indesign_find_change already applied'
            : matched > 0
              ? 'indesign_find_change matches not changed'
              : 'indesign_find_change no matches changed',
          ...(diagnosticInventory?.ok && diagnosticInventory.data ? ['indesign_find_change inspected text inventory'] : []),
        ];
    return {
      ok: true,
      message: count > 0
        ? `Changed ${count} InDesign text occurrence${count === 1 ? '' : 's'} from **${findText}** to **${changeText}**${changed.data?.documentName ? ` in **${changed.data.documentName}**` : ''}.${recoveryNote}${verificationNote}`
        : alreadyApplied
          ? `No original **${findText}** text remains, and **${changeText}** already exists in the target InDesign document. The requested change appears to already be applied.`
          : matched > 0
            ? `InDesign found ${matched} match${matched === 1 ? '' : 'es'} for **${findText}**, but none were changed. The text may be on a protected master item, unavailable plugin object, or otherwise locked beyond local bridge recovery.${diagnosticHint}`
            : `Ran InDesign Find/Change for **${findText} → ${changeText}**, but no matching text was changed.${diagnosticHint}`,
      warnings,
      data: {
        kind: 'desktop_indesign_find_change',
        app: changed.data?.appName || step.appQuery || 'InDesign',
        documentName: changed.data?.documentName || null,
        expectedDocumentName: changed.data?.expectedDocumentName || null,
        sourceDocumentPath: changed.data?.sourceDocumentPath || null,
        findText,
        changeText,
        matched,
        changed: count,
        remaining,
        replacementMatches,
        method: changed.data?.method || null,
        unlockedCount,
        lockedLayers: changed.data?.lockedLayers ?? 0,
        hiddenLayers: changed.data?.hiddenLayers ?? 0,
        lockedPageItems: changed.data?.lockedPageItems ?? 0,
        docWasModified: changed.data?.docWasModified === true,
        docModified: changed.data?.docModified === true,
        docSaved: changed.data?.docSaved === true,
        fallbackReason: changed.data?.fallbackReason || null,
        inventory: diagnosticInventory?.ok ? diagnosticInventory.data : null,
        completionVerified: remaining === 0 && (count > 0 || alreadyApplied),
      },
    };
  }
  if (step.kind === 'indesign_batch_find_change') {
    const pairs = Array.isArray(step.replacements)
      ? step.replacements.map((pair) => ({
          findText: String(pair.findText || '').trim(),
          changeText: String(pair.changeText ?? ''),
        })).filter((pair) => pair.findText)
      : [];
    if (pairs.length < 1) {
      return {
        ok: false,
        message: 'No Find/Change pairs were provided for the InDesign batch operation.',
        warnings: ['indesign_batch_find_change missing pairs'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const modalResult = await handleBlockingAppModals(step.appQuery || 'InDesign', {
      context: 'before_indesign_batch_find_change',
      maxDialogs: 4,
    });
    if (modalResult && !modalResult.ok) return modalResult;
    const changed = await bridgeInDesignBatchFindChange({
      appName: step.appQuery || 'InDesign',
      pairs,
      expectedDocumentName: context.expectedInDesignDocumentName || undefined,
      sourceDocumentPath: context.expectedInDesignDocumentPath || undefined,
    });
    if (!changed.ok || !changed.data) {
      const staleHint = changed.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new InDesign batch Find/Change endpoint is available.'
        : '';
      return {
        ok: false,
        message: `InDesign batch Find/Change failed: ${changed.error || changed.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_indesign_batch_find_change failed with ${changed.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: changed.errorCode, pairs },
      };
    }
    const rows = changed.data.results.map((result, index) => {
      const status = result.changed > 0
        ? `changed ${result.changed}`
        : result.remaining < 1 && result.replacementMatches > 0
          ? 'already applied'
          : result.matched > 0
            ? 'matched but not changed'
            : 'not found';
      const remaining = result.remaining > 0 ? `, ${result.remaining} remaining` : '';
      return `${index + 1}. **${result.findText}** -> **${result.changeText}**: ${status}${remaining}`;
    });
    const failures = changed.data.results.filter((result) => result.changed < 1 && !(result.remaining < 1 && result.replacementMatches > 0));
    return {
      ok: failures.length === 0,
      message: `Batch InDesign Find/Change completed ${changed.data.results.length} replacement${changed.data.results.length === 1 ? '' : 's'}${changed.data.documentName ? ` in **${changed.data.documentName}**` : ''}. Total changed: ${changed.data.changed}.\n${rows.join('\n')}`,
      warnings: [
        ...(failures.length > 0 ? ['indesign_batch_find_change incomplete replacements'] : []),
        ...(changed.data.remaining > 0 ? ['indesign_batch_find_change remaining source matches'] : []),
        ...(changed.data.unlockedCount > 0 ? ['indesign_batch_find_change used lock-safe recovery'] : []),
      ],
      data: {
        kind: 'desktop_indesign_batch_find_change',
        ...changed.data,
        modalHandling: modalResult?.data || null,
        completionVerified: failures.length === 0 && changed.data.remaining === 0,
      },
    };
  }
  if (step.kind === 'notes_create') {
    const body = String(step.text || '').trim();
    if (!body) {
      return {
        ok: false,
        message: 'No note text was provided. Tell me what the note should say.',
        warnings: ['notes_create missing text'],
        data: { kind: 'desktop_invalid_input' },
      };
    }
    const created = await bridgeCreateNote({ text: body });
    if (!created.ok) {
      const staleHint = /unknown\s+\/desktop\s+endpoint/i.test(created.error || '') || created.errorCode === 'stale_bridge'
        ? ' Restart `node scripts/claude-bridge.js` so the new Notes endpoint is available.'
        : '';
      return {
        ok: false,
        message: `Could not create the note via the Notes app: ${created.error || created.errorCode || 'unknown bridge error'}.${staleHint}`,
        warnings: [`desktop_notes_create failed with ${created.errorCode || 'unknown_error'}`],
        data: { kind: 'desktop_bridge_error', errorCode: created.errorCode },
      };
    }
    return {
      ok: true,
      message: `Created a note in Notes${created.data?.title ? ` titled "${created.data.title}"` : ''}.`,
      warnings: [],
      data: { kind: 'desktop_notes_create', title: created.data?.title || '', chars: created.data?.chars || body.length },
    };
  }
  return await executeLocalDesktopIntent(command, { sequenceMode: true }) || {
    ok: false,
    message: `Could not execute parsed step: ${command}`,
    warnings: ['desktop sequence step not executable'],
    data: { kind: 'desktop_sequence_step_unhandled' },
  };
}

async function recoverLocalDesktopSequenceStep(
  step: LocalComputerAwarenessIntent,
  failedResult: ComputerAppAdapterResult,
): Promise<InDesignRecoveryOutcome | null> {
  if (!isInDesignIntent(step)) return null;
  if (step.kind === 'indesign_find_change' || step.kind === 'indesign_batch_find_change' || step.kind === 'indesign_document_status' || step.kind === 'indesign_text_inventory' || step.kind === 'indesign_set_layer_state' || step.kind === 'indesign_batch_update_text_layers' || step.kind === 'indesign_update_text_layer' || step.kind === 'indesign_relink_asset' || step.kind === 'indesign_package_document' || step.kind === 'indesign_export_proof' || step.kind === 'photoshop_set_layer_state') return null;
  const errorCode = String(failedResult.data?.errorCode || '');
  if (errorCode === 'stale_bridge' || failedResult.warnings.some((warning) => /\bstale_bridge\b/.test(warning))) {
    return null;
  }
  const signature = getInDesignRecoverySignature(step);
  const candidates = prioritizeInDesignRecoveryCandidates(
    signature,
    buildInDesignRecoveryCandidatesForIntent(step),
  );
  if (candidates.length === 0) return null;

  const attempts: InDesignRecoveryAttempt[] = [];
  await bridgeFocusApp(step.appQuery || 'InDesign').catch(() => null);
  await sleep(350);

  if (step.kind === 'semantic_click' && step.targetLabel && /\b(disclaimer|legal|fine print|terms|offer|apr|finance|lease|payment|price|sale price|msrp|vehicle|dealer|cta|headline)\b/i.test(step.targetLabel)) {
    await bridgeClickMenu({ appName: step.appQuery || 'InDesign', menuPath: ['Window', 'Layers'] }).catch(() => null);
    await sleep(450);
  }

  for (const candidate of candidates) {
    const command = renderLocalComputerAwarenessIntent(candidate);
    const result = await executeLocalDesktopSequenceStep(candidate, command);
    attempts.push({ command, kind: candidate.kind, ok: result.ok, message: result.message });
    if (!result.ok) continue;
    const sameMenuPath = JSON.stringify(candidate.menuPath || null) === JSON.stringify(step.menuPath || null);
    const strategy = candidate.kind === step.kind && candidate.targetLabel === step.targetLabel && sameMenuPath
      ? 'focus_and_retry'
      : `fallback:${command}`;
    rememberInDesignRecovery(signature, strategy);
    return {
      result: {
        ...result,
        warnings: [
          `Recovered after: ${failedResult.message}`,
          ...result.warnings,
          `InDesign recovery strategy: ${strategy}`,
        ],
        data: {
          ...(result.data || {}),
          recovery: {
            strategy,
            failedMessage: failedResult.message,
            attempts,
            learned: true,
          },
        },
      },
      attempts,
      strategy,
    };
  }

  if (attempts.length > 0) {
    const suggestions = [
      'Make sure the target InDesign document is the active frontmost document.',
      'Open Window > Layers and verify the target layer/text frame is visible and unlocked.',
      'If this is a Find/Change task, open Edit > Find/Change once, then retry the chat command.',
    ];
    return {
      result: {
        ...failedResult,
        message: `${failedResult.message}\n\nI tried ${attempts.length} InDesign recovery path${attempts.length === 1 ? '' : 's'} and still could not complete that step. Try: ${suggestions.join(' ')}`,
        warnings: [
          ...failedResult.warnings,
          'InDesign recovery attempted but did not complete',
        ],
        data: {
          ...(failedResult.data || {}),
          recovery: {
            strategy: 'failed_recovery',
            failedMessage: failedResult.message,
            attempts,
            suggestions,
          },
        },
      },
      attempts,
      strategy: 'failed_recovery',
    };
  }

  return null;
}

function shouldPasteForTextEntry(text: string): boolean {
  return text.length > 160 || /[\r\n\t]/.test(text);
}

interface AutoChainResult {
  ok: boolean;
  steps: string[];
  error?: string;
  elapsedMs?: number;
}

// Common utterance → sequence patterns. Pure bridge calls, no model
// turns. Add entries here only when the sequence is stable + universal
// across users (not personalised).
//
// Phase 1c replaced the old `sleep(1200)` race with `waitForApp` —
// polls the running-app list until the named app appears before
// issuing the follow-up keystrokes. Means we start typing into the
// RIGHT app, not whichever app happened to be focused when `open -a`
// returned.
async function runAutoChain(appId: string): Promise<AutoChainResult> {
  const started = Date.now();
  const steps: string[] = [];
  try {
    if (appId === 'terminal-claude') {
      const waited = await bridgeWaitForApp('Terminal', 5_000);
      steps.push(waited.ok ? `wait for Terminal (${waited.data?.elapsedMs}ms)` : 'wait for Terminal timed out');
      const focus = await bridgeFocusApp('Terminal');
      steps.push(focus.ok ? 'focus Terminal' : `focus Terminal failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const type = await bridgeTypeText('claude');
      steps.push(type.ok ? 'type "claude"' : `type failed: ${type.error}`);
      if (!type.ok) return { ok: false, steps, error: type.error };
      const enter = await bridgePressKeys('Return');
      steps.push(enter.ok ? 'press Return' : `press Return failed: ${enter.error}`);
      if (!enter.ok) return { ok: false, steps, error: enter.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    if (appId === 'zoom') {
      // macOS bundle display name is `zoom.us`, not `Zoom` — same
      // reason the launch call needs resolveMacLaunchName().
      const zoomName = 'zoom.us';
      const waited = await bridgeWaitForApp(zoomName, 8_000);
      steps.push(waited.ok ? `wait for Zoom (${waited.data?.elapsedMs}ms)` : 'wait for Zoom timed out');
      const focus = await bridgeFocusApp(zoomName);
      steps.push(focus.ok ? 'focus Zoom' : `focus failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const press = await bridgePressKeys('Cmd+N');
      steps.push(press.ok ? 'press Cmd+N' : `keys failed: ${press.error}`);
      if (!press.ok) return { ok: false, steps, error: press.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    // No auto-chain — callers rely on the model to invoke desktop.*
    // tools for additional actions.
    return { ok: true, steps: ['no auto-chain'], elapsedMs: Date.now() - started };
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || 'auto-chain threw' };
  }
}

async function executeLocalDesktopIntent(
  task: string,
  options: { sequenceMode?: boolean } = {},
): Promise<ComputerAppAdapterResult | null> {
  const detectedSequence = detectComputerAppAdapterSequence(task);
  const { sequence, recipe } = detectedSequence;
  if (sequence.length > 1) {
    const needsBridge = sequence.some((step) => step.kind !== 'wait');
    if (needsBridge) {
      const bridgeAvailable = await isDesktopBridgeAvailable();
      if (!bridgeAvailable) {
        return {
          ok: false,
          message: 'Desktop bridge offline. Start `node scripts/claude-bridge.js`, pair it once, then retry the app action.',
          warnings: ['desktop bridge unavailable'],
          data: { kind: 'desktop_bridge_error', errorCode: 'bridge_offline' },
        };
      }
      await ensureDesktopBridgePaired().catch(() => null);
    }

	    const sequenceContext: DesktopSequenceContext = {};
	    const steps: DesktopSequenceStepRecord[] = [];
	    for (let index = 0; index < sequence.length; index += 1) {
	      const step = sequence[index];
	      const command = renderLocalComputerAwarenessIntent(step);
	      let result = await executeLocalDesktopSequenceStep(step, command, sequenceContext);
      let successRecorded = false;
      if (!result.ok) {
        const recovery = await recoverLocalDesktopSequenceStep(step, result);
        if (recovery?.result.ok) {
          steps.push({
            index: steps.length + 1,
            kind: step.kind,
            command,
            ok: false,
            message: `Initial failure before recovery: ${result.message}`,
          });
          result = recovery.result;
          steps.push({
            index: steps.length + 1,
            kind: step.kind,
            command: recovery.attempts.find((attempt) => attempt.ok)?.command || command,
            ok: true,
            message: `Recovered with ${recovery.strategy}: ${result.message}`,
            recovered: true,
            recovery: recovery.strategy,
          });
          successRecorded = true;
        } else if (recovery) {
          result = recovery.result;
        }
      }
      if (!result.ok) {
        steps.push({ index: steps.length + 1, kind: step.kind, command, ok: result.ok, message: result.message });
        return {
          ok: false,
          message: `Stopped at step ${index + 1}/${sequence.length}: ${result.message}`,
          warnings: ['desktop sequence stopped', ...result.warnings],
          data: { kind: 'desktop_action_sequence', steps, recipe: serializeAppAutomationRecipe(recipe) },
        };
      }
      if (!successRecorded) {
        steps.push({ index: steps.length + 1, kind: step.kind, command, ok: result.ok, message: result.message });
      }
      if (
        result.ok
        && result.data?.kind === 'desktop_open_file_search_match'
        && /\bindesign\b/i.test(String(step.appQuery || sequence[index + 1]?.appQuery || ''))
      ) {
        const openedPath = String(result.data.path || result.data.desktopPath || result.data.originalPath || '').trim();
        sequenceContext.expectedInDesignDocumentPath = openedPath || null;
        sequenceContext.expectedInDesignDocumentName = basenameFromDesktopPath(openedPath);
      }
      if (
        result.ok
        && result.data?.kind === 'desktop_open_file_search_match'
        && /\bphotoshop\b/i.test(String(step.appQuery || sequence[index + 1]?.appQuery || ''))
      ) {
        const openedPath = String(result.data.path || result.data.desktopPath || result.data.originalPath || '').trim();
        sequenceContext.expectedPhotoshopDocumentPath = openedPath || null;
        sequenceContext.expectedPhotoshopDocumentName = basenameFromDesktopPath(openedPath);
      }
      const postSaveDialog = result.ok && step.kind === 'press_keys' && step.combo === 'Return' && (isSaveDialogFilenameIntent(sequence[index - 1] || {}) || isSaveDialogOutputPathIntent(sequence[index - 1] || {}))
        ? await maybeHandlePostSaveImageDialogs(step.appQuery, sequence[index - 1]?.text || '')
        : null;
      if (postSaveDialog) {
        steps.push({ index: steps.length + 1, kind: 'post_save_confirm', command: `confirm save dialogs for ${sequence[index - 1]?.text || 'image'}`, ok: postSaveDialog.ok, message: postSaveDialog.message });
        if (!postSaveDialog.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${postSaveDialog.message}`,
            warnings: ['desktop sequence stopped', ...postSaveDialog.warnings],
            data: { kind: 'desktop_action_sequence', steps, recipe: serializeAppAutomationRecipe(recipe) },
          };
        }
      }
      const outputVerification = result.ok && step.kind === 'press_keys' && step.combo === 'Return' && (isSaveDialogFilenameIntent(sequence[index - 1] || {}) || isSaveDialogOutputPathIntent(sequence[index - 1] || {}))
        ? await verifySaveDialogOutputFile(sequence[index - 1]?.text || '')
        : null;
      if (outputVerification) {
        steps.push({ index: steps.length + 1, kind: 'output_verification', command: `verify saved output ${sequence[index - 1]?.text || 'image'}`, ok: outputVerification.ok, message: outputVerification.message });
        if (!outputVerification.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${outputVerification.message}`,
            warnings: ['desktop sequence stopped', ...outputVerification.warnings],
            data: { kind: 'desktop_action_sequence', steps, recipe: serializeAppAutomationRecipe(recipe) },
          };
        }
      }
      const modalAppQuery = step.appQuery || sequence[index + 1]?.appQuery;
      const modalResult = shouldCheckBlockingModalAfterStep(step, sequence[index + 1])
        ? await handleBlockingAppModals(modalAppQuery, {
          context: `after_sequence_step:${step.kind || 'unknown'}`,
          task: command,
          maxDialogs: 4,
        })
        : null;
      if (modalResult) {
        steps.push({
          index: steps.length + 1,
          kind: 'modal_interrupt',
          command: `handle blocking dialog in ${modalAppQuery || 'frontmost app'}`,
          ok: modalResult.ok,
          message: modalResult.message,
          recovered: modalResult.ok,
          recovery: modalResult.ok ? 'blocking_modal_handler' : 'blocking_modal_failed',
        });
        if (!modalResult.ok) {
          return {
            ok: false,
            message: `Stopped after step ${index + 1}/${sequence.length}: ${modalResult.message}`,
            warnings: ['desktop sequence stopped', ...modalResult.warnings],
            data: { kind: 'desktop_action_sequence', steps, recipe: serializeAppAutomationRecipe(recipe) },
          };
        }
      }
    }
    return {
      ok: true,
      message: `Completed ${steps.length} desktop app steps:\n${steps.map((step) => `${step.index}. ${step.message}`).join('\n')}`,
      warnings: [],
      data: {
        kind: 'desktop_action_sequence',
        steps,
        recipe: serializeAppAutomationRecipe(recipe),
        completionVerified: hasTerminalDesktopSequenceCompletionProof(steps),
      },
    };
  }

  const intent = detectLocalComputerAwarenessIntent(task);
  if (!intent.route || !intent.kind) return null;
  const executableKinds = new Set([
    'launch_app',
    'focus_app',
    'open_url',
    'open_path',
    'open_file_search_match',
    'clipboard_write',
    'clipboard_clear',
    'screen_state',
    'a11y_tree',
    'window_manage',
    'semantic_click',
    'menu_click',
    'type_text',
    'paste_text',
	    'set_field_text',
	    'indesign_find_change',
	    'indesign_batch_find_change',
	    'indesign_document_status',
	    'indesign_text_inventory',
	    'indesign_set_layer_state',
	    'indesign_batch_update_text_layers',
	    'indesign_update_text_layer',
    'indesign_relink_asset',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_document_status',
	    'photoshop_layer_inventory',
	    'photoshop_set_layer_state',
	    'photoshop_update_text_layer',
	    'photoshop_place_asset',
	    'photoshop_export_proof',
	    'press_keys',
    'wait',
    'wait_for_app',
    'mouse_move',
    'mouse_click',
    'mouse_down',
    'mouse_up',
    'mouse_drag',
    'mouse_scroll',
  ]);
  if (!executableKinds.has(intent.kind)) return null;

  try {
    const bridgeAvailable = await isDesktopBridgeAvailable();
    if (!bridgeAvailable) {
      return {
        ok: false,
        message: 'Desktop bridge offline. Start `node scripts/claude-bridge.js`, pair it once, then retry the app action.',
        warnings: ['desktop bridge unavailable'],
        data: { kind: 'desktop_bridge_error', errorCode: 'bridge_offline' },
      };
    }
    await ensureDesktopBridgePaired().catch(() => null);

    if (
      intent.kind === 'notes_create' ||
      intent.kind === 'indesign_document_status' ||
	      intent.kind === 'indesign_text_inventory' ||
	      intent.kind === 'indesign_set_layer_state' ||
	      intent.kind === 'indesign_batch_update_text_layers' ||
      intent.kind === 'indesign_update_text_layer' ||
      intent.kind === 'indesign_find_change' ||
      intent.kind === 'indesign_batch_find_change' ||
      intent.kind === 'indesign_relink_asset' ||
      intent.kind === 'indesign_package_document' ||
      intent.kind === 'indesign_export_proof' ||
      intent.kind === 'photoshop_document_status' ||
      intent.kind === 'photoshop_layer_inventory' ||
      intent.kind === 'photoshop_set_layer_state' ||
      intent.kind === 'photoshop_update_text_layer' ||
      intent.kind === 'photoshop_place_asset' ||
      intent.kind === 'photoshop_export_proof'
    ) {
      return executeLocalDesktopSequenceStep(intent, renderLocalComputerAwarenessIntent(intent), {});
    }

    if ((intent.kind === 'launch_app' || intent.kind === 'focus_app') && intent.appQuery) {
      return executeObservedNativeAppActivation(intent.kind, intent.appQuery, {
        observeApp: bridgeObserveApp,
        launchApp: bridgeLaunchApp,
        focusApp: bridgeFocusApp,
        waitForApp: bridgeWaitForApp,
      });
    }

    if (intent.kind === 'wait_for_app' && intent.appQuery) {
      const waited = await bridgeWaitForApp(intent.appQuery, intent.durationMs || 8_000);
      if (!waited.ok) {
        return {
          ok: false,
          message: `Timed out waiting for **${intent.appQuery}** to open: ${waited.error || waited.errorCode || 'not detected'}.`,
          warnings: [`desktop_wait_for_app failed with ${waited.errorCode || 'timeout'}`],
          data: { kind: 'desktop_bridge_error', errorCode: waited.errorCode, app: intent.appQuery },
        };
      }
      return {
        ok: true,
        message: `Detected **${waited.data?.appName || intent.appQuery}** after ${waited.data?.elapsedMs ?? 0}ms.`,
        warnings: [],
        data: { kind: 'desktop_wait_for_app', app: waited.data?.appName || intent.appQuery, elapsedMs: waited.data?.elapsedMs ?? 0 },
      };
    }

    if (intent.kind === 'open_url' && intent.url) {
      const r = await bridgeOpenUrl(intent.url);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not open **${intent.url}** through the local bridge: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_open_url failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, url: intent.url },
        };
      }
      return {
        ok: true,
        message: `Opened **${r.data?.url || intent.url}** in the default browser.`,
        warnings: [],
        data: { kind: 'desktop_open_url', url: r.data?.url || intent.url, scheme: r.data?.scheme || null },
      };
    }

    if (intent.kind === 'open_file_search_match') {
      return openFirstFileSearchMatch(intent);
    }

    if (intent.kind === 'open_path' && intent.path) {
      const r = await bridgeOpenPath(intent.path);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not open **${intent.path}** through the local bridge: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_open_path failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, path: intent.path },
        };
      }
      return {
        ok: true,
        message: `Opened **${r.data?.path || intent.path}** locally.`,
        warnings: [],
        data: { kind: 'desktop_open_path', path: r.data?.path || intent.path },
      };
    }

    if (intent.kind === 'clipboard_write' && typeof intent.text === 'string') {
      const r = await bridgeWriteClipboard(intent.text);
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not write to the clipboard: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_clipboard_write failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: `Copied ${r.data?.chars ?? intent.text.length} characters to the clipboard.`,
        warnings: [],
        data: { kind: 'desktop_clipboard_write', chars: r.data?.chars ?? intent.text.length },
      };
    }

    if (intent.kind === 'clipboard_clear') {
      const r = await bridgeClearClipboard();
      if (!r.ok) {
        return {
          ok: false,
          message: `Could not clear the clipboard: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_clipboard_clear failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: 'Cleared the clipboard.',
        warnings: [],
        data: { kind: 'desktop_clipboard_clear' },
      };
    }

    if (intent.kind === 'screen_state') {
      const shot = await bridgeTakeScreenshot();
      if (!shot.ok || !shot.data) {
        return {
          ok: false,
          message: `Could not capture a screenshot: ${shot.error || shot.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_screenshot failed with ${shot.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: shot.errorCode },
        };
      }
      return {
        ok: true,
        message: `Captured a desktop screenshot (${Math.round((shot.data.sizeBytes || 0) / 1024)} KB).`,
        warnings: [],
        data: { kind: 'desktop_screenshot', sizeBytes: shot.data.sizeBytes, mimeType: shot.data.mimeType },
      };
    }

    if (intent.kind === 'a11y_tree') {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 8, maxNodes: 250 });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      const controls = flattenA11yNodes(tree.data.tree)
        .filter((node) => node.label || node.value)
        .slice(0, 12)
        .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`);
      const observation = noteA11yTreeObservation({
        app: tree.data.app || intent.appQuery || 'frontmost',
        pid: tree.data.pid,
        serializedTree: JSON.stringify(tree.data.tree),
      });
      return {
        ok: true,
        message: `Read **${tree.data.app || intent.appQuery || 'the frontmost app'}** accessibility tree (${tree.data.budget_used || 0} nodes).${observation.note ? ` ${observation.note}` : ''}${controls.length ? `\nTop controls:\n${controls.join('\n')}` : ''}`,
        warnings: [],
        data: {
          kind: 'desktop_a11y_tree',
          app: tree.data.app,
          pid: tree.data.pid,
          nodeCount: tree.data.budget_used || 0,
          unchangedSinceLastObservation: observation.unchanged,
        },
      };
    }

    if (intent.kind === 'window_manage' && intent.windowAction) {
      const r = await bridgeManageWindow({
        action: intent.windowAction,
        appName: intent.appQuery,
        width: intent.width,
        height: intent.height,
      });
      if (!r.ok) {
        return {
          ok: false,
          message: `Window action failed: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_window_manage failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      return {
        ok: true,
        message: `Completed window action **${r.data?.action || intent.windowAction}**${r.data?.appName ? ` for **${r.data.appName}**` : ''}.`,
        warnings: [],
        data: { kind: 'desktop_window_action', ...r.data },
      };
    }

    if (intent.kind === 'semantic_click' && intent.targetLabel) {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      // E2 — request a pruned targeting slice around the label we want to
      // click (matches + ancestors + ±2 siblings + interactive roles)
      // instead of a full dump. findBestA11yNode runs on the slice.
      let tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500, target: intent.targetLabel });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message:
            `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ` +
            `${tree.error || tree.errorCode || 'unknown bridge error'}. Use a screenshot-grounded click with coordinates as a fallback.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      let match = findBestA11yNode(tree.data.tree, intent.targetLabel);
      if (!match && tree.data.slice === 'interactive') {
        // E2 — slice missed: the pruning is token-based while
        // findBestA11yNode is fuzzier. Retry ONCE on the full tree
        // before declaring no-match (full stays available on request).
        const fullTree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500, slice: 'full' });
        if (fullTree.ok && fullTree.data?.tree) {
          tree = fullTree;
          match = findBestA11yNode(fullTree.data.tree, intent.targetLabel);
        }
      }
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      if (!match) {
        const candidates = flattenA11yNodes(tree.data.tree)
          .filter((node) => node.label || node.value)
          .slice(0, 20)
          .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`)
          .join('\n');
        return {
          ok: false,
          message:
            `I read **${tree.data.app || intent.appQuery || 'the frontmost app'}** but could not find a control matching **${intent.targetLabel}**.\n\n` +
            `Visible controls I can target:\n${candidates || '(no labeled controls returned)'}`,
          warnings: ['semantic click target not found'],
          data: { kind: 'desktop_semantic_click_no_match', targetLabel: intent.targetLabel, app: tree.data.app },
        };
      }
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: match.id, appName: tree.data.app || intent.appQuery });
      if (!clicked.ok) {
        // E3 — small/missed-target recovery: one bounded region screenshot
        // around the target bbox (zoom re-observe at full resolution),
        // then a single coordinate re-click at the bbox centre.
        const reclicked = await regionZoomCoordinateReclick({
          match,
          app: tree.data.app || intent.appQuery || null,
          targetLabel: intent.targetLabel,
          failedClickError: clicked.error || clicked.errorCode || 'unknown bridge error',
        });
        if (reclicked) return reclicked;
        return {
          ok: false,
          message: `Found **${match.label || match.value || intent.targetLabel}** but could not click it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: match.id },
        };
      }
      return {
        ok: true,
        message: `Clicked **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** via accessibility (${clicked.data?.method || 'unknown'}).`,
        warnings: [],
        data: {
          kind: 'desktop_semantic_click',
          app: tree.data.app,
          pid: tree.data.pid,
          targetPath: match.id,
          targetRole: match.role,
          targetLabel: match.label || match.value || intent.targetLabel,
          method: clicked.data?.method || 'unknown',
        },
      };
    }

    if (intent.kind === 'menu_click' && intent.menuPath?.length) {
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      const r = await bridgeClickMenu({ appName: intent.appQuery, menuPath: intent.menuPath });
      if (!r.ok) {
        return {
          ok: false,
          message: `Menu action **${intent.menuPath.join(' > ')}** failed${intent.appQuery ? ` in **${intent.appQuery}**` : ''}: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_menu_click failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, menuPath: intent.menuPath },
        };
      }
      return {
        ok: true,
        message: `Clicked menu **${(r.data?.menuPath || intent.menuPath).join(' > ')}**${r.data?.appName ? ` in **${r.data.appName}**` : ''}.`,
        warnings: [],
        data: { kind: 'desktop_menu_click', app: r.data?.appName || intent.appQuery || null, menuPath: r.data?.menuPath || intent.menuPath },
      };
    }

    if (intent.kind === 'set_field_text' && intent.targetLabel && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to put into the field.', warnings: ['empty desktop field text'], data: { kind: 'desktop_invalid_input' } };
      }
      if (intent.appQuery) await bridgeFocusApp(intent.appQuery).catch(() => null);
      // E2 — pruned targeting slice around the field label; full-tree
      // retry once when the slice misses (see semantic_click).
      let tree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500, target: intent.targetLabel });
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      let match = findBestTextEntryA11yNode(tree.data.tree, intent.targetLabel);
      if (!match && tree.data.slice === 'interactive') {
        const fullTree = await bridgeReadA11yTree({ appName: intent.appQuery, maxDepth: 10, maxNodes: 500, slice: 'full' });
        if (fullTree.ok && fullTree.data?.tree) {
          tree = fullTree;
          match = findBestTextEntryA11yNode(fullTree.data.tree, intent.targetLabel);
        }
      }
      if (!tree.ok || !tree.data?.tree) {
        return {
          ok: false,
          message: `Could not read the accessibility tree${intent.appQuery ? ` for **${intent.appQuery}**` : ''}: ${tree.error || tree.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_a11y_tree failed with ${tree.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: tree.errorCode },
        };
      }
      if (!match) {
        const candidates = flattenA11yNodes(tree.data.tree)
          .filter((node) => node.label || node.value)
          .slice(0, 20)
          .map((node) => `[${node.id}] ${node.role} "${node.label || node.value || ''}"`)
          .join('\n');
        return {
          ok: false,
          message: `I read **${tree.data.app || intent.appQuery || 'the frontmost app'}** but could not find a field matching **${intent.targetLabel}**.\n\nVisible controls I can target:\n${candidates || '(no labeled controls returned)'}`,
          warnings: ['field target not found'],
          data: { kind: 'desktop_set_field_no_match', targetLabel: intent.targetLabel, app: tree.data.app },
        };
      }
      const set = await bridgeSetElementValue({ pid: tree.data.pid, path: match.id, text: intent.text, appName: tree.data.app || intent.appQuery });
      if (set.ok) {
        return {
          ok: true,
          message: `Set **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** to ${set.data?.chars ?? intent.text.length} characters via accessibility.`,
          warnings: [],
          data: { kind: 'desktop_set_field_text', app: tree.data.app, pid: tree.data.pid, targetPath: match.id, targetRole: match.role, targetLabel: match.label || match.value || intent.targetLabel, method: set.data?.method || 'ax_set_value', chars: set.data?.chars ?? intent.text.length },
        };
      }
      const clicked = await bridgeClickElement({ pid: tree.data.pid, path: match.id, appName: tree.data.app || intent.appQuery });
      if (!clicked.ok) {
        return {
          ok: false,
          message: `Found **${match.label || match.value || intent.targetLabel}** but could not focus it: ${clicked.error || clicked.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_set_element_value failed with ${set.errorCode || 'unknown_error'}`, `desktop_click_element failed with ${clicked.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: clicked.errorCode, targetPath: match.id },
        };
      }
      const pasted = await bridgePasteText(intent.text, {
        appName: options.sequenceMode ? undefined : intent.appQuery,
        restoreClipboard: true,
        focusMode: options.sequenceMode ? 'best_effort' : 'require',
      });
      if (!pasted.ok) {
        return {
          ok: false,
          message: `Found and focused **${match.label || match.value || intent.targetLabel}**, but fallback paste failed: ${pasted.error || pasted.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_set_element_value failed with ${set.errorCode || 'unknown_error'}`, `desktop_paste_text failed with ${pasted.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: pasted.errorCode, targetPath: match.id },
        };
      }
      return {
        ok: true,
        message: `Focused **${match.label || match.value || intent.targetLabel}** in **${tree.data.app || intent.appQuery || 'the frontmost app'}** and pasted ${pasted.data?.chars ?? intent.text.length} characters after direct accessibility set failed.`,
        warnings: [`Direct AX set failed: ${set.error || set.errorCode || 'unknown error'}`],
        data: { kind: 'desktop_set_field_text_fallback_paste', app: tree.data.app, pid: tree.data.pid, targetPath: match.id, targetRole: match.role, targetLabel: match.label || match.value || intent.targetLabel, chars: pasted.data?.chars ?? intent.text.length },
      };
    }

    if (intent.kind === 'type_text' && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to type.', warnings: ['empty desktop type text'], data: { kind: 'desktop_invalid_input' } };
      }
      const focusWarnings: string[] = [];
      if (intent.appQuery) {
        const focused = await bridgeFocusApp(intent.appQuery);
        if (!focused.ok) {
          if (options.sequenceMode) {
            focusWarnings.push(`desktop_focus_app warning before typing: ${focused.error || focused.errorCode || 'unknown bridge error'}`);
          } else {
            return {
              ok: false,
              message: `Could not focus **${intent.appQuery}** before typing: ${focused.error || focused.errorCode || 'unknown bridge error'}.`,
              warnings: [`desktop_focus_app failed with ${focused.errorCode || 'unknown_error'}`],
              data: { kind: 'desktop_bridge_error', errorCode: focused.errorCode },
            };
          }
        }
      }
      const usePaste = shouldPasteForTextEntry(intent.text);
      const r = usePaste
        ? await bridgePasteText(intent.text, {
            appName: options.sequenceMode ? undefined : intent.appQuery,
            restoreClipboard: true,
            focusMode: options.sequenceMode ? 'best_effort' : 'require',
          })
        : await bridgeTypeText(intent.text);
      if (!r.ok) {
        return {
          ok: false,
          message: `${usePaste ? 'Paste' : 'Typing'} failed: ${r.error || r.errorCode || 'unknown bridge error'}.`,
          warnings: [`desktop_${usePaste ? 'paste_text' : 'type_text'} failed with ${r.errorCode || 'unknown_error'}`],
          data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
        };
      }
      const pasteFocusWarning = usePaste ? (r.data as any)?.focusWarning : null;
      return {
        ok: true,
        message: `${usePaste ? 'Pasted' : 'Typed'} ${r.data?.chars ?? intent.text.length} characters${intent.appQuery ? ` into **${intent.appQuery}**` : ' into the focused app'}${usePaste ? ' using a restored temporary clipboard.' : ''}.`,
        warnings: [...focusWarnings, ...(pasteFocusWarning ? [`desktop_paste_text focus warning: ${pasteFocusWarning}`] : [])],
        data: { kind: usePaste ? 'desktop_paste_text' : 'desktop_type_text', chars: r.data?.chars ?? intent.text.length, app: intent.appQuery || null },
      };
    }

    if (intent.kind === 'paste_text' && typeof intent.text === 'string') {
      if (!intent.text.trim()) {
        return { ok: false, message: 'No text was provided to paste.', warnings: ['empty desktop paste text'], data: { kind: 'desktop_invalid_input' } };
      }
      const r = await bridgePasteText(intent.text, {
        appName: options.sequenceMode ? undefined : intent.appQuery,
        restoreClipboard: true,
        focusMode: options.sequenceMode ? 'best_effort' : 'require',
      });
      if (!r.ok) return { ok: false, message: `Paste failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_paste_text failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return {
        ok: true,
        message: `Pasted ${r.data?.chars ?? intent.text.length} characters${r.data?.appName || intent.appQuery ? ` into **${r.data?.appName || intent.appQuery}**` : ' into the focused app'} with clipboard restoration ${r.data?.restoredClipboard ? 'enabled' : 'skipped'}.`,
        warnings: r.data?.focusWarning ? [`desktop_paste_text focus warning: ${r.data.focusWarning}`] : [],
        data: { kind: 'desktop_paste_text', chars: r.data?.chars ?? intent.text.length, app: r.data?.appName || intent.appQuery || null, restoredClipboard: r.data?.restoredClipboard ?? false },
      };
    }

    if (intent.kind === 'press_keys' && intent.combo) {
      const focusWarnings: string[] = [];
      if (intent.appQuery) {
        const focused = await bridgeFocusApp(intent.appQuery);
        if (!focused.ok) {
          if (options.sequenceMode) {
            focusWarnings.push(`desktop_focus_app warning before key press: ${focused.error || focused.errorCode || 'unknown bridge error'}`);
          } else {
            return {
              ok: false,
              message: `Could not focus **${intent.appQuery}** before pressing keys: ${focused.error || focused.errorCode || 'unknown bridge error'}.`,
              warnings: [`desktop_focus_app failed with ${focused.errorCode || 'unknown_error'}`],
              data: { kind: 'desktop_bridge_error', errorCode: focused.errorCode },
            };
          }
        }
      }
      const r = await bridgePressKeys(intent.combo);
      if (!r.ok) return { ok: false, message: `Key press failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_press_keys failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return {
        ok: true,
        message: `Pressed **${r.data?.combo || intent.combo}**${intent.appQuery ? ` in **${intent.appQuery}**` : ' in the focused app'}.`,
        warnings: focusWarnings,
        data: { kind: 'desktop_press_keys', combo: r.data?.combo || intent.combo, app: intent.appQuery || null },
      };
    }

    if (intent.kind === 'mouse_move' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const r = await bridgeMouseMove(intent.x, intent.y);
      if (!r.ok) return { ok: false, message: `Mouse move failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_move failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Moved mouse to (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_move', ...r.data } };
    }

    if (intent.kind === 'mouse_click' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.x, y: intent.y }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseClick({ x: intent.x, y: intent.y, button: intent.mouseButton, count: intent.clickCount });
      if (!r.ok) return { ok: false, message: `Mouse click failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_click failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nClicked ${r.data?.button || 'left'} x${r.data?.count || 1} at (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_click', ...r.data } };
    }

    if (intent.kind === 'mouse_down' && typeof intent.x === 'number' && typeof intent.y === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.x, y: intent.y }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseDown({ x: intent.x, y: intent.y, button: intent.mouseButton });
      if (!r.ok) return { ok: false, message: `Mouse down failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_down failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nHeld ${r.data?.button || 'left'} mouse down at (${r.data?.x}, ${r.data?.y}).`, warnings: [], data: { kind: 'desktop_mouse_down', ...r.data } };
    }

    if (intent.kind === 'mouse_up') {
      const hasCoords = typeof intent.x === 'number' && typeof intent.y === 'number';
      if (hasCoords) {
        const observed = await observeBeforeCoordinateAction([{ x: intent.x as number, y: intent.y as number }]);
        if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      }
      const r = await bridgeMouseUp({ x: intent.x, y: intent.y, button: intent.mouseButton });
      if (!r.ok) return { ok: false, message: `Mouse up failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_up failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Released ${r.data?.button || 'left'} mouse${r.data?.x != null && r.data?.y != null ? ` at (${r.data.x}, ${r.data.y})` : ''}.`, warnings: [], data: { kind: 'desktop_mouse_up', ...r.data } };
    }

    if (intent.kind === 'mouse_drag' && typeof intent.fromX === 'number' && typeof intent.fromY === 'number' && typeof intent.toX === 'number' && typeof intent.toY === 'number') {
      const observed = await observeBeforeCoordinateAction([{ x: intent.fromX, y: intent.fromY }, { x: intent.toX, y: intent.toY }]);
      if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      const r = await bridgeMouseDrag({ fromX: intent.fromX, fromY: intent.fromY, toX: intent.toX, toY: intent.toY });
      if (!r.ok) return { ok: false, message: `Mouse drag failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_drag failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `${observed.note}\nDragged from (${r.data?.fromX}, ${r.data?.fromY}) to (${r.data?.toX}, ${r.data?.toY}).`, warnings: [], data: { kind: 'desktop_mouse_drag', ...r.data } };
    }

    if (intent.kind === 'mouse_scroll') {
      const points = typeof intent.x === 'number' && typeof intent.y === 'number' ? [{ x: intent.x, y: intent.y }] : [];
      if (points.length) {
        const observed = await observeBeforeCoordinateAction(points);
        if (!observed.ok) return { ok: false, message: observed.message, warnings: ['coordinate preflight failed'], data: { kind: 'desktop_coordinate_preflight_failed' } };
      }
      const r = await bridgeMouseScroll({ deltaX: intent.deltaX, deltaY: intent.deltaY, x: intent.x, y: intent.y });
      if (!r.ok) return { ok: false, message: `Mouse scroll failed: ${r.error || r.errorCode || 'unknown bridge error'}.`, warnings: [`desktop_mouse_scroll failed with ${r.errorCode || 'unknown_error'}`], data: { kind: 'desktop_bridge_error', errorCode: r.errorCode } };
      return { ok: true, message: `Scrolled mouse deltaX=${r.data?.deltaX ?? 0}, deltaY=${r.data?.deltaY ?? 0}.`, warnings: [], data: { kind: 'desktop_mouse_scroll', ...r.data } };
    }

    if (intent.kind === 'wait') {
      await sleep(intent.durationMs || 1000);
      return { ok: true, message: `Waited ${Math.round((intent.durationMs || 1000) / 100) / 10} seconds.`, warnings: [], data: { kind: 'desktop_wait', durationMs: intent.durationMs || 1000 } };
    }
  } catch (err: any) {
    return {
      ok: false,
      message: `Local desktop action failed: ${err?.message || 'Unknown error'}`,
      warnings: ['desktop_action threw'],
      data: { kind: 'desktop_bridge_error' },
    };
  }

  return null;
}

// ─── E1: mid-execution surface escalation (failure-side wiring) ────────────
//
// When the deterministic adapter path fails, consult the pure escalation
// policy (`planSurfaceEscalation`) instead of just erroring. A `descend`
// decision is attached to the result so the runtime can continue on the
// next-ranked control surface after a FRESH observation; a `stop` decision
// carries the attempted-surface history so the existing recovery/buildout
// diagnosis can pick the next move; `retry_same` asks for a fresh re-observe
// on the same rung.
//
// TELEMETRY: a11y-failure breadcrumbs carry the app name + structured failure
// code (`a11y_tree_empty`, `a11y_path_stale`, ...). Persisted alongside task
// results, these breadcrumbs ARE our macOS AX-coverage dataset — the
// 2026-06-11 research round (docs/EXECUTION_LADDER_RESEARCH_2026-06-11.md,
// RQ2) found no published macOS coverage numbers, so we measure per-app
// coverage ourselves from exactly these records.

/**
 * Map an adapter failure shape onto the control-surface rung that was being
 * driven when it failed, restricted to ids the route plan actually ranks.
 */
function inferAttemptedSurfaceId(
  result: ComputerAppAdapterResult,
  candidates: AppAutomationControlSurfaceCandidate[],
  failureCode: string | null,
): string {
  const ids = new Set(candidates.map((item) => item.id as string));
  const pick = (...preferred: string[]): string =>
    preferred.find((id) => ids.has(id)) || candidates[0]?.id || '';
  const data = (result.data || {}) as Record<string, unknown>;
  const kind = typeof data.kind === 'string' ? data.kind : '';
  // MCP/app-tool execution failures happened on the vendor script/API rung.
  if (typeof data.toolName === 'string') return pick('vendor_script_or_plugin_api', 'os_accessibility');
  // a11y reads/element actions are the OS accessibility rung.
  if (
    failureCode === 'a11y_tree_empty'
    || failureCode === 'a11y_path_stale'
    || /a11y/.test(kind)
  ) {
    return pick('os_accessibility', 'semantic_desktop');
  }
  // Any other desktop_* failure (launch, focus, menu, save dialogs, …) was
  // driven through the bridge's accessibility/semantic surface.
  if (kind.startsWith('desktop_')) return pick('os_accessibility', 'semantic_desktop');
  return pick('os_accessibility');
}

function applySurfaceEscalationToAdapterFailure(
  task: string,
  result: ComputerAppAdapterResult,
  options?: { capabilityStatusById?: Record<string, SurfaceCapabilityStatus> },
): ComputerAppAdapterResult {
  if (result.ok) return result;
  let decision: SurfaceEscalationDecision;
  let fromSurfaceId = '';
  let failureCode: string | null = null;
  let appName: string | null = null;
  try {
    const failure = extractSurfaceFailureSignal({
      message: result.message,
      warnings: result.warnings,
      data: (result.data as Record<string, unknown>) || null,
    });
    failureCode = failure.code || null;
    const plan = buildAppAutomationControlSurfacePlan(task);
    const data = (result.data || {}) as Record<string, unknown>;
    appName = String(data.app || data.displayName || plan.targetName || '').trim() || null;
    fromSurfaceId = inferAttemptedSurfaceId(result, plan.candidates, failureCode);
    decision = planSurfaceEscalation({
      currentSurfaceId: fromSurfaceId,
      candidates: plan.candidates,
      failure,
      attemptedSurfaceIds: [fromSurfaceId],
      capabilityStatusById: options?.capabilityStatusById,
    });
  } catch {
    // The escalation policy must never turn a readable failure into a crash.
    return result;
  }
  if (decision.action === 'retry_same') {
    return {
      ...result,
      surfaceEscalation: decision,
      message: `${result.message}\n\n**Surface retry:** ${decision.reason}`,
    };
  }
  if (decision.action === 'stop') {
    // Attempted-surface history rides in decision.reason — this message feeds
    // the existing failure-time recovery diagnosis.
    return {
      ...result,
      surfaceEscalation: decision,
      message: `${result.message}\n\n**Surface escalation stopped:** ${decision.reason}`,
    };
  }
  const surfaceEscalations = appendSurfaceEscalation(result.surfaceEscalations, {
    fromSurface: fromSurfaceId,
    toSurface: decision.next.id,
    reason: decision.reason,
    atIso: new Date().toISOString(),
    appName,
    failureCode,
  });
  const approvalLine = decision.extraApprovalsRequired.length > 0
    ? `\nApprovals required BEFORE acting on the new surface: ${decision.extraApprovalsRequired.join('; ')}.`
    : '';
  return {
    ...result,
    surfaceEscalation: decision,
    surfaceEscalations,
    message: `${result.message}\n\n**Surface escalation:** ${decision.reason} Take a FRESH observation on **${decision.next.label}** before any mutation.${approvalLine}`,
  };
}

export async function executeComputerAppTask(args: {
  circleId: string;
  task: string;
  /** E1: live capability status per control-surface id (deriveSurfaceCapabilityStatusFromAudit). */
  capabilityStatusById?: Record<string, SurfaceCapabilityStatus>;
}): Promise<ComputerAppAdapterResult> {
  const result = await executeComputerAppTaskInner(args);
  return applySurfaceEscalationToAdapterFailure(args.task, result, {
    capabilityStatusById: args.capabilityStatusById,
  });
}

async function executeComputerAppTaskInner(args: {
  circleId: string;
  task: string;
}): Promise<ComputerAppAdapterResult> {
  const task = String(args.task || '').trim();
  if (!task) {
    return {
      ok: false,
      message: 'No app task was provided.',
      warnings: [],
    };
  }

  // Multi-step app instructions ("open Photoshop then click File > Save")
  // need to stay in the deterministic desktop pipeline. The single-app
  // shortcut below would otherwise stop after the launch step.
  if (detectComputerAppAdapterSequence(task).sequence.length > 1) {
    const sequencedDesktopResult = await executeLocalDesktopIntent(task);
    if (sequencedDesktopResult) return sequencedDesktopResult;
  }

  // ─── Precedence step 1: Claude Code bridge (Phase 1b) ─────────────────
  // If the user has the local desktop bridge running + a known app is in
  // the utterance, launch natively — most reliable path, single HITL
  // gate, follow-up tool calls (type/keys) happen via the agent loop.
  //
  // We probe health first so we can distinguish "bridge offline" from
  // "bridge running but call errored" — the user's experience is very
  // different in those two states and silently falling through to the
  // URL-scheme shortcut (with a muddled warning) is the opposite of
  // what the user wants when they HAVE paired.
  const bridgeCandidate = matchKnownApp(task);
  if (bridgeCandidate) {
    try {
      const bridgeAvailable = await isDesktopBridgeAvailable();
      if (bridgeAvailable) {
        // Auto-pair if needed — ensureDesktopBridgePaired is idempotent
        // and silent when already paired.
        await ensureDesktopBridgePaired().catch(() => null);
        const detectedKnownIntent = detectLocalComputerAwarenessIntent(task);
        const activationKind: NativeAppActivationKind = detectedKnownIntent.kind === 'focus_app'
          ? 'focus_app'
          : 'launch_app';
        const activationResult = await executeObservedNativeAppActivation(
          activationKind,
          resolveMacLaunchName(bridgeCandidate),
          {
            observeApp: bridgeObserveApp,
            launchApp: bridgeLaunchApp,
            focusApp: bridgeFocusApp,
            waitForApp: bridgeWaitForApp,
          },
        );
        if (activationResult.ok) {
          // For utterances with a built-in follow-up pattern we know
          // from the alias match (e.g. "open Claude Code" → launch
          // Terminal + type `claude` + Return), auto-chain the
          // sequence here rather than relying on the model to call
          // desktop.* tools. Client-side only — same trust boundary
          // as the launch itself, and avoids needing the hardcoded
          // swanbot-ai edge fn to know about desktop tools.
          const autoChainSteps = activationKind === 'launch_app'
            ? await runAutoChain(bridgeCandidate.id)
            : { ok: true, steps: ['no auto-chain for focus'], elapsedMs: 0 };
          const hasUnverifiedAutoChain = activationKind === 'launch_app'
            && (bridgeCandidate.id === 'terminal-claude' || bridgeCandidate.id === 'zoom');

          const followupMessages: Record<string, string> = {
            'terminal-claude': 'Ran `claude` in Terminal.',
            zoom: 'Sent Cmd+N to start a new meeting.',
          };
          const chainMsg = activationKind === 'launch_app' && autoChainSteps.ok && followupMessages[bridgeCandidate.id]
            ? ` ${followupMessages[bridgeCandidate.id]}`
            : autoChainSteps.error
              ? ` Auto-chain hit an issue: ${autoChainSteps.error}.`
              : '';

          return {
            ok: true,
            message:
              `${activationResult.message}${chainMsg}` +
              (autoChainSteps.ok
                ? ''
                : ' Follow up with `desktop.type_text` / `desktop.press_keys` for further actions.'),
            warnings: [
              ...activationResult.warnings,
              ...(hasUnverifiedAutoChain ? ['desktop auto-chain actions have no fresh after-state proof'] : []),
            ],
            data: {
              kind: activationResult.data?.kind || (activationKind === 'focus_app' ? 'desktop_bridge_focus' : 'desktop_bridge_launch'),
              appId: bridgeCandidate.id,
              displayName: bridgeCandidate.displayName,
              capability: 'desktop_action',
              autoChain: autoChainSteps,
              completionVerified: activationResult.data?.completionVerified === true && !hasUnverifiedAutoChain,
              proof: activationResult.data?.proof || null,
            },
          };
        }
        const launchErrorCode = String(activationResult.data?.errorCode || 'unknown');
        // Bridge reachable but launch failed — surface the specific
        // error state inline rather than silently returning the URL
        // shortcut. The user wants to know WHY the real path didn't
        // work so they can fix it.
        if (launchErrorCode === 'permission_denied') {
          return {
            ok: false,
            message:
              `**macOS Accessibility permission required.**\n\n` +
              `The bridge tried to ${activationKind === 'focus_app' ? 'focus' : 'launch'} **${bridgeCandidate.displayName}** but was blocked. ` +
              `Open **System Settings → Privacy & Security → Accessibility** and enable it for ` +
              `whichever Terminal / iTerm is running \`node scripts/claude-bridge.js\`. ` +
              `Retry the same command afterwards — no re-pairing needed.`,
            warnings: ['desktop_action failed with permission_denied'],
            data: { ...activationResult.data, kind: 'desktop_bridge_error', errorCode: launchErrorCode, displayName: bridgeCandidate.displayName },
          };
        }
        if (launchErrorCode === 'app_not_found') {
          return {
            ok: false,
            message:
              `**${bridgeCandidate.displayName} isn't installed on this Mac.**\n\n` +
              `The bridge tried \`open -a "${bridgeCandidate.displayName}"\` and got "not found." ` +
              `Install the app or ask me for a browser fallback (${bridgeCandidate.webUrl}).`,
            warnings: ['desktop_action failed with app_not_found'],
            data: { ...activationResult.data, kind: 'desktop_bridge_error', errorCode: launchErrorCode, displayName: bridgeCandidate.displayName, webFallback: bridgeCandidate.webUrl },
          };
        }
        if (launchErrorCode === 'not_paired') {
          return {
            ok: false,
            message:
              `**Bridge running but not paired.** Tap **⎇ Pair Desktop Bridge** ` +
              `in the Chat Actions menu once, then retry.`,
            warnings: ['desktop_action failed with not_paired'],
            data: { ...activationResult.data, kind: 'desktop_bridge_error', errorCode: launchErrorCode },
          };
        }
        if (launchErrorCode === 'origin_blocked') {
          // CORS preflight failed. Before 2026-04-23 the bridge didn't
          // include `X-UC-Desktop-Token` in Access-Control-Allow-Headers,
          // so every authed call died here even with a paired token.
          // Fixed in scripts/claude-bridge.js; users on older builds see
          // this path. Tell them to restart the bridge.
          return {
            ok: false,
            message:
              `**Bridge CORS rejected the token header.**\n\n` +
              `Stop your \`node scripts/claude-bridge.js\` process and start it again ` +
              `after running \`git pull\` — the CORS allow-list was widened to accept ` +
              `the desktop-token header. Then run \`/desktop diag\` to confirm.`,
            warnings: ['desktop_action failed with origin_blocked'],
            data: { ...activationResult.data, kind: 'desktop_bridge_error', errorCode: launchErrorCode },
          };
        }
        // The lane has either blocked before mutation, observed an
        // unverified after-state, or recorded an ambiguous dispatch. Do not
        // fall through to a second launch surface and risk a blind retry.
        return {
          ...activationResult,
          data: {
            ...activationResult.data,
            displayName: bridgeCandidate.displayName,
            webFallback: bridgeCandidate.webUrl,
          },
        };
      }
    } catch {
      // Bridge probe threw — continue with the non-bridge paths.
    }
  }

  // Generic native app/window/pointer path. This covers installed apps
  // not in KNOWN_APPS plus exact local desktop actions like click,
  // drag, scroll, and semantic accessibility clicks.
  const localDesktopResult = await executeLocalDesktopIntent(task);
  if (localDesktopResult) return localDesktopResult;

  const [tools, connections, providers, capabilities] = await Promise.all([
    fetchAllMcpTools(args.circleId).catch(() => [] as McpTool[]),
    loadConnections().catch(() => []),
    getInstalledIntegrationProviders(args.circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(args.circleId).catch(() => [] as string[]),
  ]);

  const appTools = tools.filter(isDesktopOrAppTool);
  const targetProviders = inferTargetProviders(task);
  const matchingTool = [...appTools].sort((a, b) => {
    const aScore = targetProviders.some((provider) => toolMatches(a, [provider])) ? 2 : 0;
    const bScore = targetProviders.some((provider) => toolMatches(b, [provider])) ? 2 : 0;
    return bScore - aScore;
  })[0];

  if (matchingTool) {
    const toolArgs = buildArgs(matchingTool, task);
    try {
      const result = await callMcpTool(matchingTool.serverId, matchingTool.name, toolArgs);
      return {
        ok: true,
        message: [
          `Executed app task with **${matchingTool.name}**.`,
          '',
          stringifyResult(result),
        ].join('\n'),
        warnings: [],
        data: {
          toolName: matchingTool.name,
          toolArgs,
          rawResult: result,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        message: `App tool execution failed: ${error?.message || 'Unknown error'}`,
        warnings: ['App MCP call failed.'],
        data: {
          toolName: matchingTool.name,
          toolArgs,
        },
      };
    }
  }

  const enabledConnections = connections.filter((connection) => connection.enabled);
  const lines: string[] = [];
  if (providers.length > 0) {
    lines.push(`Connected integrations: ${providers.join(', ')}`);
  }
  if (capabilities.length > 0) {
    lines.push(`Integration capabilities: ${capabilities.slice(0, 10).join(', ')}`);
  }
  if (enabledConnections.length > 0) {
    lines.push(`Enabled bridges: ${enabledConnections.map((connection) => connection.provider).join(', ')}`);
  }
  if (appTools.length > 0) {
    lines.push(`MCP app tools: ${appTools.slice(0, 6).map((tool) => tool.name).join(', ')}`);
  }

  // Before giving up, check whether the user asked for a well-known
  // desktop app (Zoom, Slack, Notion, …). If so, hand back a clickable
  // shortcut that uses the OS URL handler — native launch in one click
  // even without an app_tools bridge. This is the "Option A" fallback
  // documented in `docs/DESKTOP_APP_CAPABILITY_PATHS.md`.
  //
  // NOTE: by the time we reach this branch, the bridge-first step
  // above already failed (bridge offline, or bridge running but launch
  // errored with an unrecognised code). Include an inline prompt to
  // start the bridge for full automation — otherwise the user has no
  // signal that there's a stronger path available.
  const knownApp = matchKnownApp(task);
  if (knownApp) {
    const platform = detectPlatform();
    const shortcut = renderAppShortcut(knownApp, { platform });
    const bridgeHint = [
      '',
      '— — —',
      '**Want full automation?** Launch, type, and press keys without clicking anything:',
      '1. Run `node scripts/claude-bridge.js` in a terminal',
      '2. Tap **⎇ Pair Desktop Bridge** in the Chat Actions menu once',
      '3. Retry your request — the agent will drive the app directly.',
    ].join('\n');
    return {
      ok: true,
      message: shortcut.markdown + '\n' + bridgeHint,
      warnings: lines.length === 0
        ? ['Desktop bridge offline — served via known-app URL-scheme shortcut. Run the bridge for full automation.']
        : ['Missing app MCP tool match — offering known-app URL-scheme shortcut as fallback.'],
      data: {
        kind: 'known_app_shortcut',
        appId: knownApp.id,
        displayName: knownApp.displayName,
        osUrl: shortcut.osUrl,
        webUrl: shortcut.webUrl,
        keyboardHint: shortcut.keyboardHint,
        platform,
        bridgeHint: true,
      },
    };
  }

  if (lines.length === 0) {
    return {
      ok: false,
      message: 'No connected app surfaces are available for this circle yet — missing an app adapter or bridge tool to drive this app.',
      warnings: ['Missing app MCP / integration / bridge surface.'],
    };
  }

  return {
    ok: true,
    message: [
      'App-capable surfaces are available, but this task is missing an app adapter for the exact action requested.',
      '',
      ...lines.map((line) => `- ${line}`),
      '',
      'The next step is to build an app-specific action adapter for these surfaces (or provide explicit access guidance).',
    ].join('\n'),
    warnings: ['No direct app MCP tool match; returning surface inventory instead.'],
    data: {
      // Tag so the runtime routes this to capability buildout instead of
      // short-circuiting it as a "successful" pure launch.
      kind: 'app_capability_gap',
      providers,
      capabilities,
      enabledBridgeProviders: enabledConnections.map((connection) => connection.provider),
      appToolNames: appTools.map((tool) => tool.name),
    },
  };
}
