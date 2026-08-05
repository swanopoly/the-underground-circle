export type AgentMonitorStatus =
  | 'starting'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'idle';

export type AgentMonitorSource = 'computer_use' | 'openswan' | 'browser' | 'desktop' | 'custom';
export type AgentMonitorTone = 'neutral' | 'active' | 'approval' | 'success' | 'danger';

export interface AgentMonitorFrame {
  index: number;
  b64: string | null;
  url: string | null;
  at: number | null;
  label: string;
  actionLabel: string | null;
}

export interface AgentMonitorAction {
  tool: string;
  label: string;
  at: number | null;
  tone: AgentMonitorTone;
  inputPreview: string | null;
}

export interface AgentMonitorCounts {
  actions: number;
  frames: number;
  reasoning: number;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  findings: number;
}

export interface AgentMonitorDisplayText {
  title: string;
  subtitle: string;
  status: string;
  primary: string;
  secondary: string | null;
}

export interface AgentMonitorTask {
  id: string;
  source: AgentMonitorSource;
  sourceLabel: string;
  title: string;
  status: AgentMonitorStatus;
  statusLabel: string;
  runId: string | null;
  sessionId: string | null;
  liveUrl: string | null;
  currentAction: AgentMonitorAction | null;
  latestAction: AgentMonitorAction | null;
  frames: AgentMonitorFrame[];
  latestFrame: AgentMonitorFrame | null;
  counts: AgentMonitorCounts;
  actionCount: number;
  frameCount: number;
  needsAttention: boolean;
  attentionLabel: string | null;
  displayText: AgentMonitorDisplayText;
  summary: string;
}

export interface AgentMonitorComputerUseActionLike {
  tool?: string | null;
  input?: unknown;
  at?: number | string | null;
}

export interface AgentMonitorComputerUseFrameLike {
  b64?: string | null;
  url?: string | null;
  at?: number | string | null;
  label?: string | null;
}

export interface AgentMonitorPendingConfirmationLike {
  id?: string | null;
  question?: string | null;
  options?: readonly string[] | null;
  context?: string | null;
  timeoutSec?: number | null;
  askedAt?: number | string | null;
}

export interface AgentMonitorComputerUseLikeState {
  status: 'idle' | 'starting' | 'running' | 'done' | 'error';
  task?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  liveUrl?: string | null;
  reasoning?: readonly string[] | null;
  actions?: readonly AgentMonitorComputerUseActionLike[] | null;
  screenshots?: readonly AgentMonitorComputerUseFrameLike[] | null;
  frames?: readonly AgentMonitorComputerUseFrameLike[] | null;
  usage?: {
    iteration?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
  } | null;
  pendingConfirmation?: AgentMonitorPendingConfirmationLike | null;
  result?: {
    summary?: string | null;
    iterations?: number | null;
    tokens?: { input?: number | null; output?: number | null } | null;
    findings?: readonly unknown[] | null;
  } | null;
  errorMessage?: string | null;
  rawErrorMessage?: string | null;
}

export interface AgentMonitorNormalizeOptions {
  sourceLabel?: string;
  idPrefix?: string;
  hideIdle?: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function truncate(text: string, max: number): string {
  const value = text.trim().replace(/\s+/g, ' ');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function timestampOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusLabel(status: AgentMonitorStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Running';
    case 'needs_input':
      return 'Approval needed';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Stopped';
    case 'idle':
      return 'Idle';
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Agent Monitor status: ${String(value)}`);
}

function mapComputerUseStatus(state: AgentMonitorComputerUseLikeState): AgentMonitorStatus {
  if (state.pendingConfirmation && state.status !== 'done' && state.status !== 'error') return 'needs_input';
  if (state.status === 'done') return 'completed';
  if (state.status === 'error') return 'failed';
  if (state.status === 'starting') return 'starting';
  if (state.status === 'running') return 'running';
  return 'idle';
}

function formatCoordinate(value: unknown): string {
  return Array.isArray(value) && value.length >= 2
    ? `at (${String(value[0])}, ${String(value[1])})`
    : 'on target';
}

function displayUrl(value: unknown): string {
  const raw = textOrNull(value);
  if (!raw) return 'page';
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split(/[?#]/)[0] || 'page';
  }
}

function inputRecord(action: AgentMonitorComputerUseActionLike): UnknownRecord {
  return isRecord(action.input) ? action.input : {};
}

function previewInput(input: UnknownRecord): string | null {
  const action = textOrNull(input.action);
  if (action === 'navigate') return displayUrl(input.url ?? input.text);
  if (action === 'type') return 'typed text';
  if (action === 'key') return textOrNull(input.text);
  if (textOrNull(input.command)) return truncate(textOrNull(input.command) || '', 80);
  if (textOrNull(input.question)) return truncate(textOrNull(input.question) || '', 80);
  return action;
}

export function formatAgentMonitorComputerUseAction(
  action: AgentMonitorComputerUseActionLike | undefined,
): string {
  if (!action) return 'Preparing the browser or app workspace.';
  const input = inputRecord(action);
  const rawAction = textOrNull(input.action) || '';
  if (action.tool === 'ask_user') {
    return truncate(`Waiting for approval: ${textOrNull(input.question) || 'Review needed'}`, 96);
  }
  if (action.tool === 'bash') {
    return truncate(`Running command: ${textOrNull(input.command) || ''}`, 96);
  }
  switch (rawAction) {
    case 'screenshot':
      return 'Capturing proof';
    case 'left_click':
      return `Clicking ${formatCoordinate(input.coordinate)}`;
    case 'right_click':
      return `Right-clicking ${formatCoordinate(input.coordinate)}`;
    case 'double_click':
      return `Double-clicking ${formatCoordinate(input.coordinate)}`;
    case 'type':
      return 'Typing text';
    case 'key':
      return truncate(`Pressing ${textOrNull(input.text) || 'key'}`, 96);
    case 'scroll':
      return `Scrolling ${textOrNull(input.scroll_direction) || 'down'}`;
    case 'navigate':
      return truncate(`Opening ${displayUrl(input.url ?? input.text)}`, 96);
    case 'wait':
      return 'Waiting for the page';
    default:
      if (rawAction) return truncate(`Running ${rawAction.replace(/_/g, ' ')}`, 96);
      return truncate(`Using ${action.tool || 'computer'}`, 96);
  }
}

function actionTone(status: AgentMonitorStatus): AgentMonitorTone {
  return getAgentMonitorStatusTone(status) === 'neutral' ? 'active' : getAgentMonitorStatusTone(status);
}

function normalizeAction(
  action: AgentMonitorComputerUseActionLike,
  status: AgentMonitorStatus,
): AgentMonitorAction {
  const input = inputRecord(action);
  return {
    tool: action.tool || 'computer',
    label: formatAgentMonitorComputerUseAction(action),
    at: timestampOrNull(action.at),
    tone: actionTone(status),
    inputPreview: previewInput(input),
  };
}

function syntheticAction(
  status: AgentMonitorStatus,
  label: string,
  tool: string,
  at: number | string | null | undefined = null,
): AgentMonitorAction {
  return {
    tool,
    label,
    at: timestampOrNull(at),
    tone: actionTone(status),
    inputPreview: null,
  };
}

function currentActionForStatus(
  status: AgentMonitorStatus,
  state: AgentMonitorComputerUseLikeState,
  actions: readonly AgentMonitorComputerUseActionLike[],
): AgentMonitorAction | null {
  if (status === 'needs_input') {
    return syntheticAction(
      status,
      truncate(`Waiting for approval: ${state.pendingConfirmation?.question || 'Review needed'}`, 96),
      'ask_user',
      state.pendingConfirmation?.askedAt,
    );
  }
  const latestRawAction = actions.length > 0 ? actions[actions.length - 1] : null;
  if (latestRawAction) return normalizeAction(latestRawAction, status);
  if (status === 'starting') return syntheticAction(status, 'Preparing the browser or app workspace.', 'computer_use.start');
  if (status === 'running') return syntheticAction(status, 'Watching the active task.', 'computer_use.run');
  return null;
}

function normalizeFrames(
  rawFrames: readonly AgentMonitorComputerUseFrameLike[],
  actions: readonly AgentMonitorComputerUseActionLike[],
): AgentMonitorFrame[] {
  return rawFrames
    .map((frame, index) => {
      const b64 = textOrNull(frame.b64);
      const url = textOrNull(frame.url);
      if (!b64 && !url) return null;
      const actionLabel = actions[index] ? formatAgentMonitorComputerUseAction(actions[index]) : null;
      return {
        index: index + 1,
        b64,
        url,
        at: timestampOrNull(frame.at),
        label: textOrNull(frame.label) || url || `Frame ${index + 1}`,
        actionLabel,
      } satisfies AgentMonitorFrame;
    })
    .filter((frame): frame is AgentMonitorFrame => frame !== null);
}

function buildCounts(state: AgentMonitorComputerUseLikeState, actionCount: number, frameCount: number): AgentMonitorCounts {
  return {
    actions: actionCount,
    frames: frameCount,
    reasoning: state.reasoning?.length || 0,
    iterations: numberOrZero(state.result?.iterations) || numberOrZero(state.usage?.iteration),
    inputTokens: numberOrZero(state.result?.tokens?.input) || numberOrZero(state.usage?.inputTokens),
    outputTokens: numberOrZero(state.result?.tokens?.output) || numberOrZero(state.usage?.outputTokens),
    estimatedCostUsd: numberOrZero(state.usage?.estimatedCost),
    findings: state.result?.findings?.length || 0,
  };
}

function countsText(counts: AgentMonitorCounts): string | null {
  const parts = [
    counts.actions > 0 ? `${counts.actions} action${counts.actions === 1 ? '' : 's'}` : null,
    counts.frames > 0 ? `${counts.frames} frame${counts.frames === 1 ? '' : 's'}` : null,
    counts.iterations > 0 ? `${counts.iterations} iteration${counts.iterations === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' | ') : null;
}

function latestReasoning(state: AgentMonitorComputerUseLikeState): string | null {
  const reasoning = state.reasoning || [];
  return reasoning.length > 0 ? textOrNull(reasoning[reasoning.length - 1]) : null;
}

function buildDisplayText(
  status: AgentMonitorStatus,
  state: AgentMonitorComputerUseLikeState,
  currentAction: AgentMonitorAction | null,
  counts: AgentMonitorCounts,
): AgentMonitorDisplayText {
  const task = truncate(state.task || 'Computer Use task', 120);
  const countSummary = countsText(counts);
  switch (status) {
    case 'needs_input':
      return {
        title: 'Approval needed',
        subtitle: task,
        status: statusLabel(status),
        primary: truncate(state.pendingConfirmation?.question || 'Review needed before the agent continues.', 140),
        secondary: state.pendingConfirmation?.options?.length
          ? `Options: ${state.pendingConfirmation.options.join(', ')}`
          : countSummary,
      };
    case 'completed':
      return {
        title: 'Computer task finished',
        subtitle: task,
        status: statusLabel(status),
        primary: truncate(state.result?.summary || 'The task finished and proof is available.', 180),
        secondary: countSummary,
      };
    case 'failed':
      return {
        title: 'Computer task stopped',
        subtitle: task,
        status: statusLabel(status),
        primary: truncate(state.errorMessage || 'The task stopped. Recovery details are available.', 180),
        secondary: countSummary,
      };
    case 'starting':
      return {
        title: 'Starting computer task',
        subtitle: task,
        status: statusLabel(status),
        primary: currentAction?.label || 'Preparing the browser or app workspace.',
        secondary: countSummary,
      };
    case 'running':
      return {
        title: 'Computer task running',
        subtitle: task,
        status: statusLabel(status),
        primary: currentAction?.label || latestReasoning(state) || 'Watching the active task.',
        secondary: countSummary,
      };
    case 'idle':
      return {
        title: 'No active computer task',
        subtitle: task,
        status: statusLabel(status),
        primary: 'No active task.',
        secondary: null,
      };
    default:
      return assertNever(status);
  }
}

function deterministicId(state: AgentMonitorComputerUseLikeState, title: string, prefix: string): string {
  const stableSource = textOrNull(state.runId) || textOrNull(state.sessionId) || textOrNull(title) || 'idle';
  return `${prefix}:${stableSource}`;
}

export function normalizeAgentMonitorComputerUseTask(
  state: AgentMonitorComputerUseLikeState | null | undefined,
  opts: AgentMonitorNormalizeOptions = {},
): AgentMonitorTask | null {
  if (!state) return null;
  const status = mapComputerUseStatus(state);
  if (status === 'idle' && opts.hideIdle !== false) return null;

  const actions = state.actions || [];
  const rawFrames = state.screenshots || state.frames || [];
  const frames = normalizeFrames(rawFrames, actions);
  const currentAction = currentActionForStatus(status, state, actions);
  const counts = buildCounts(state, actions.length, frames.length);
  const displayText = buildDisplayText(status, state, currentAction, counts);
  const latestFrame = frames.length > 0 ? frames[frames.length - 1] : null;
  const sourceLabel = opts.sourceLabel || 'Computer Use';
  const title = truncate(state.task || 'Computer Use task', 120);
  const id = deterministicId(state, title, opts.idPrefix || 'computer-use');
  const needsAttention = status === 'needs_input' || status === 'failed';

  return {
    id,
    source: 'computer_use',
    sourceLabel,
    title,
    status,
    statusLabel: displayText.status,
    runId: state.runId || null,
    sessionId: state.sessionId || null,
    liveUrl: state.liveUrl || null,
    currentAction,
    latestAction: currentAction,
    frames,
    latestFrame,
    counts,
    actionCount: counts.actions,
    frameCount: counts.frames,
    needsAttention,
    attentionLabel: status === 'needs_input'
      ? 'Approval needed'
      : status === 'failed'
        ? 'Review recovery'
        : null,
    displayText,
    summary: displayText.primary,
  };
}

export function buildAgentMonitorTaskFromComputerUseState(
  state: AgentMonitorComputerUseLikeState,
  opts: AgentMonitorNormalizeOptions = {},
): AgentMonitorTask | null {
  return normalizeAgentMonitorComputerUseTask(state, opts);
}

export function getAgentMonitorStatusTone(status: AgentMonitorStatus): AgentMonitorTone {
  switch (status) {
    case 'running':
    case 'starting':
      return 'active';
    case 'needs_input':
      return 'approval';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'idle':
      return 'neutral';
    default:
      return assertNever(status);
  }
}

export function shouldShowAgentMonitor(task: AgentMonitorTask | null): boolean {
  return !!task && task.status !== 'idle';
}
