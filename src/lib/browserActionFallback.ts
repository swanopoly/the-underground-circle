import { analyzeBrowserTask, type BrowserTaskIntent } from './browserTaskIntent';

export type BrowserFallbackActionType =
  | 'navigate'
  | 'observe'
  | 'extract'
  | 'click'
  | 'fill'
  | 'screenshot'
  | 'select'
  | 'press_key'
  | 'wait'
  | 'scroll';

export interface BrowserFallbackAction {
  id: string;
  type: BrowserFallbackActionType;
  target?: string;
  value?: string;
  description: string;
  requiresApproval: boolean;
  approvalReason?: string;
  status: 'pending';
}

function actionId(index: number): string {
  return `action_${Date.now()}_${index}`;
}

export function buildFallbackBrowserActions(
  task: string,
  analyzedIntent: BrowserTaskIntent = analyzeBrowserTask(task),
): BrowserFallbackAction[] {
  const fallbackTarget = analyzedIntent.startUrls[0]
    || (analyzedIntent.allowedDomains[0] ? `https://${analyzedIntent.allowedDomains[0]}` : '')
    || task;
  const fallback: BrowserFallbackAction[] = [
    {
      id: actionId(0),
      type: 'navigate',
      target: fallbackTarget,
      description: analyzedIntent.startUrls[0]
        ? `Open ${analyzedIntent.startUrls[0]}`
        : `Open the browser target for: ${task}`,
      requiresApproval: true,
      approvalReason: analyzedIntent.allowedDomains.length > 0
        ? `Keep execution scoped to ${analyzedIntent.allowedDomains.join(', ')}`
        : undefined,
      status: 'pending',
    },
  ];

  if (analyzedIntent.mode === 'extract' || analyzedIntent.browserbaseWorkflow.expectsStructuredOutput) {
    fallback.push({
      id: actionId(fallback.length),
      type: 'wait',
      value: '1500',
      description: 'Wait briefly for rendered data to load',
      requiresApproval: false,
      status: 'pending',
    });
    fallback.push({
      id: actionId(fallback.length),
      type: 'extract',
      description: analyzedIntent.browserbaseWorkflow.expectsStructuredOutput
        ? 'Extract the requested structured records and fields from the page'
        : 'Extract the requested information from the page',
      requiresApproval: false,
      status: 'pending',
    });
    return fallback;
  }

  if (analyzedIntent.requiresLogin) {
    fallback.push({
      id: actionId(fallback.length),
      type: 'wait',
      value: '1500',
      description: 'Pause for login or account review before continuing',
      requiresApproval: true,
      approvalReason: 'Explicit review before interacting with authenticated state.',
      status: 'pending',
    });
  }
  fallback.push({
    id: actionId(fallback.length),
    type: 'screenshot',
    description: 'Capture the browser state for review',
    requiresApproval: false,
    status: 'pending',
  });
  return fallback;
}
