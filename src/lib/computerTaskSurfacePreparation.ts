import type { ComputerTaskExecutionEnvelope } from './computerTaskExecution';
import type {
  DesktopBridgeAutoConnectResult,
  DesktopBridgeAutoConnectStatus,
} from './desktopBridgeAutoConnect';

export type ComputerTaskSurfacePreparationSurface =
  | 'browser'
  | 'desktop_app'
  | 'local_file'
  | 'hybrid'
  | 'unknown';

export interface ComputerTaskSurfacePreparationPlan {
  surface: ComputerTaskSurfacePreparationSurface;
  shouldPrepareDesktopBridge: boolean;
  quietWhenReady: boolean;
  reason: string;
  touched: string[];
}

export interface ComputerTaskSurfacePreparationReceipt {
  attempted: boolean;
  ok: boolean;
  status: DesktopBridgeAutoConnectStatus | 'skipped' | 'failed';
  userActionRequired: boolean;
  summary: string;
  warnings: string[];
  touched: string[];
}

export interface ComputerTaskSurfacePreparationBlockedPresentation {
  shouldBlock: boolean;
  message: string;
  blockers: string[];
  nextSteps: string[];
}

export interface ComputerTaskLocalFileAccessBlockedPresentation {
  message: string;
  blockers: string[];
  nextSteps: string[];
}

function compact(value: unknown, max = 360): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function joinRoots(roots: string[]): string {
  const cleaned = roots.map((root) => String(root || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return 'the requested local files';
  if (cleaned.length <= 2) return cleaned.join(', ');
  return `${cleaned.slice(0, 2).join(', ')} and ${cleaned.length - 2} more`;
}

export function buildComputerTaskSurfacePreparationPlan(
  execution: Pick<ComputerTaskExecutionEnvelope, 'preview' | 'entrypoint'>,
): ComputerTaskSurfacePreparationPlan {
  if (execution.entrypoint === 'browser_runtime') {
    return {
      surface: 'browser',
      shouldPrepareDesktopBridge: false,
      quietWhenReady: true,
      reason: 'Browser runtime tasks use the browser permission flow and do not need the local desktop bridge prepared first.',
      touched: ['surface:browser'],
    };
  }

  if (execution.preview.kind === 'file_task') {
    return {
      surface: 'local_file',
      shouldPrepareDesktopBridge: true,
      quietWhenReady: true,
      reason: 'Local file tasks use desktop bridge file endpoints, so prepare and pair the bridge before the runtime prepares scoped file access.',
      touched: ['surface:local_file', 'surface:desktop_bridge'],
    };
  }

  if (execution.preview.kind === 'hybrid_task') {
    return {
      surface: 'hybrid',
      shouldPrepareDesktopBridge: true,
      quietWhenReady: true,
      reason: 'Hybrid app/file/browser tasks often need local app or file control, so prepare the desktop bridge before deeper routing.',
      touched: ['surface:hybrid_computer_task', 'surface:desktop_bridge'],
    };
  }

  if (execution.preview.kind === 'app_task') {
    return {
      surface: 'desktop_app',
      shouldPrepareDesktopBridge: true,
      quietWhenReady: true,
      reason: 'Native app tasks use desktop bridge launch, focus, accessibility, keyboard, mouse, and file-open tools.',
      touched: ['surface:desktop_app', 'surface:desktop_bridge'],
    };
  }

  return {
    surface: 'unknown',
    shouldPrepareDesktopBridge: false,
    quietWhenReady: true,
    reason: 'Unknown computer task surface; wait for the planner before preparing local desktop capabilities.',
    touched: ['surface:computer_task'],
  };
}

export function buildComputerTaskLocalFileAccessBlockedPresentation(input: {
  roots: string[];
  scope: 'read' | 'write';
  error?: string | null;
  errorCode?: string | null;
}): ComputerTaskLocalFileAccessBlockedPresentation {
  const rootLabel = joinRoots(input.roots);
  const action = input.scope === 'write' ? 'modify or export files' : 'read or locate files';
  const scopeLabel = input.scope === 'write' ? 'write' : 'read';
  const detail = compact(input.error || input.errorCode || 'local file access was not granted', 260);
  const blockers = [
    `Local file ${scopeLabel} access is not ready for ${rootLabel}.`,
    detail,
  ].filter(Boolean).slice(0, 4);

  return {
    message: [
      `I could not prepare local file ${scopeLabel} access for ${rootLabel}, so I stopped before trying to ${action}.`,
      '',
      'Approve the local file access prompt if it appears. If no prompt appears, tap the desktop bridge button to reconnect, then retry the request.',
    ].join('\n'),
    blockers,
    nextSteps: [
      `Approve local file ${scopeLabel} access for ${rootLabel} if prompted`,
      'Tap the desktop bridge button to reconnect if no prompt appears',
      'Retry the request after access is ready',
    ],
  };
}

export function buildComputerTaskSurfacePreparationReceipt(
  plan: ComputerTaskSurfacePreparationPlan,
  result?: DesktopBridgeAutoConnectResult | null,
): ComputerTaskSurfacePreparationReceipt {
  if (!plan.shouldPrepareDesktopBridge) {
    return {
      attempted: false,
      ok: true,
      status: 'skipped',
      userActionRequired: false,
      summary: plan.reason,
      warnings: [],
      touched: plan.touched,
    };
  }

  if (!result) {
    const summary = 'Desktop bridge preparation did not run before the local computer task.';
    return {
      attempted: false,
      ok: false,
      status: 'failed',
      userActionRequired: true,
      summary,
      warnings: [summary],
      touched: [...plan.touched, 'desktop_bridge:prepare_missing'],
    };
  }

  if (result.ok) {
    const summary = result.status === 'started_and_paired'
      ? 'Desktop bridge started and paired automatically for this task.'
      : result.status === 'paired'
        ? 'Desktop bridge paired automatically for this task.'
        : 'Desktop bridge was already ready for this task.';
    return {
      attempted: true,
      ok: true,
      status: result.status,
      userActionRequired: false,
      summary,
      warnings: [],
      touched: [...plan.touched, `desktop_bridge:${result.status}`],
    };
  }

  const detail = compact(result.detail || result.content || 'desktop bridge preparation failed');
  const summary = result.status === 'starter_unavailable'
    ? 'I tried to prepare the desktop bridge, but no local starter endpoint is reachable from the browser.'
    : result.status === 'unsupported'
      ? 'This platform does not support local desktop automation yet.'
      : result.status === 'pair_failed'
        ? 'The desktop bridge answered, but pairing failed.'
        : result.status === 'starter_failed'
          ? 'I tried to start the desktop bridge, but the local starter returned an error.'
          : 'Desktop bridge preparation failed before the local computer task could run.';
  return {
    attempted: true,
    ok: false,
    status: result.status,
    userActionRequired: result.userActionRequired !== false,
    summary,
    warnings: [detail ? `${summary} ${detail}` : summary],
    touched: [...plan.touched, `desktop_bridge:${result.status}`],
  };
}

export function buildComputerTaskSurfacePreparationBlockedPresentation(
  receipt: ComputerTaskSurfacePreparationReceipt,
): ComputerTaskSurfacePreparationBlockedPresentation {
  const blockers = receipt.ok
    ? []
    : (receipt.warnings.length > 0 ? receipt.warnings : [receipt.summary]).slice(0, 4);

  if (!receipt.attempted || receipt.ok || !receipt.userActionRequired) {
    return {
      shouldBlock: false,
      message: '',
      blockers,
      nextSteps: [],
    };
  }

  if (receipt.status === 'unsupported') {
    return {
      shouldBlock: true,
      message: 'This device cannot run local desktop/app automation yet.\n\nUse a supported desktop environment, then retry the request.',
      blockers,
      nextSteps: [
        'Use a supported desktop environment for local app automation',
        'Retry the request after the desktop bridge is available',
      ],
    };
  }

  if (receipt.status === 'pair_failed') {
    return {
      shouldBlock: true,
      message: 'I reached the desktop bridge, but pairing did not finish.\n\nTap the desktop bridge button to reconnect, then retry the request.',
      blockers,
      nextSteps: [
        'Tap the desktop bridge button to reconnect',
        'Retry the desktop/app/browser task',
      ],
    };
  }

  if (receipt.status === 'starter_unavailable') {
    return {
      shouldBlock: true,
      message: 'I already tried to start or pair the desktop bridge for this task, but no local bridge or starter answered.\n\nTap the desktop bridge button to retry. If it still stays offline, run `npm run start` or `npm run bridge` once from this repo, then retry the request.',
      blockers,
      nextSteps: [
        'Tap the desktop bridge button to retry the local connect path',
        'If it stays offline, run npm run start or npm run bridge once from this repo',
      ],
    };
  }

  if (receipt.status === 'starter_failed') {
    return {
      shouldBlock: true,
      message: 'I tried to start the desktop bridge automatically, but the local starter returned an error.\n\nTap the desktop bridge button to retry. If it still fails, run `npm run bridge` once from this repo, then retry the request.',
      blockers,
      nextSteps: [
        'Tap the desktop bridge button to retry automatic startup',
        'If startup still fails, run npm run bridge once from this repo',
      ],
    };
  }

  return {
    shouldBlock: true,
    message: 'I could not start this computer task because the desktop bridge is not ready yet.\n\nTap the desktop bridge button to start or reconnect it, then retry the request.',
    blockers,
    nextSteps: [
      'Tap the desktop bridge button to start or reconnect it',
      'Retry the desktop/app/browser task',
    ],
  };
}
