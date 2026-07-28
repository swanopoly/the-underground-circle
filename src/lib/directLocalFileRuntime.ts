import type { ChatComputerRequestRoute } from './chatComputerRequestRouter';

export type DirectLocalFileMode = 'rename' | 'copy' | 'trash' | 'mkdir' | 'write_text' | 'open_path';
type DirectLocalFilePlanMode = DirectLocalFileMode | 'other';

export interface DirectLocalFilePlan {
  mode: DirectLocalFilePlanMode;
  path?: string;
  appName?: string | null;
}

export interface DirectLocalFileAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
}

export type DirectLocalFileFailureKind =
  | 'ambiguous'
  | 'bridge_unavailable'
  | 'conflict'
  | 'missing_proof'
  | 'not_found'
  | 'permission'
  | 'unknown';

export const DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT = [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_name',
  'provider_tool_use_id',
  'tool_iteration',
  'exact_openswan_runtime_approval',
  'fresh_file_stat',
  'fresh_native_app_observation',
  'runtime_mutation_dispatch_receipt',
  'runtime_result_proof_identity',
  'post_open_focus_proof',
] as const;

export const DIRECT_OPEN_PATH_REQUIRED_CONTEXT =
  DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT;

export type DirectLocalFileMutationRuntimeRequirement =
  typeof DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT[number];

export type DirectLocalFileTypedTool =
  | 'desktop.file_rename'
  | 'desktop.file_copy'
  | 'desktop.file_trash'
  | 'desktop.file_mkdir'
  | 'desktop.file_write_text'
  | 'desktop.open_path';

export interface DirectLocalFileMutationRuntimeHandoff {
  kind: 'openswan_typed_tool';
  tool: DirectLocalFileTypedTool;
  sourceLane: 'direct_local_file_runtime';
  reasonCode: 'sealed_runtime_context_required';
  executable: false;
  adapterCalled: false;
  mutationDispatched: false;
  completionClaimed: false;
  carriesRawPath: false;
  carriesRawApp: false;
  carriesRawValue: false;
  carriesSecret: false;
  carriesIdentity: false;
  carriesApproval: false;
  carriesReceipt: false;
  carriesProof: false;
  requiredContext: DirectLocalFileMutationRuntimeRequirement[];
  message: string;
}

export type DirectOpenPathRuntimeRequirement =
  DirectLocalFileMutationRuntimeRequirement;

export type DirectOpenPathRuntimeHandoff =
  DirectLocalFileMutationRuntimeHandoff & { tool: 'desktop.open_path' };

const DIRECT_LOCAL_FILE_MODES = new Set<string>([
  'rename',
  'copy',
  'trash',
  'mkdir',
  'write_text',
  'open_path',
]);

const DIRECT_LOCAL_FILE_TOOLS = new Set<string>([
  'desktop.file_rename',
  'desktop.file_copy',
  'desktop.file_trash',
  'desktop.file_mkdir',
  'desktop.file_write_text',
  'desktop.open_path',
]);

export type DirectLocalFileExecutor = (
  task: string,
  plan: DirectLocalFilePlan,
) => Promise<DirectLocalFileAdapterResult | null>;

export interface DirectLocalFileRuntimeOutcome {
  handled: boolean;
  status: 'handoff' | 'failed';
  message: string;
  warnings: string[];
  data?: {
    mode?: DirectLocalFilePlanMode;
    runtimeHandoff?: DirectLocalFileMutationRuntimeHandoff;
  };
}

export function buildDirectLocalFileMutationRuntimeHandoff(
  mode: DirectLocalFileMode,
): DirectLocalFileMutationRuntimeHandoff {
  const tool = directLocalFileToolForMode(mode);
  if (!tool) {
    throw new Error('Direct local-file handoff requires a recognized mutation mode.');
  }
  return {
    kind: 'openswan_typed_tool',
    tool,
    sourceLane: 'direct_local_file_runtime',
    reasonCode: 'sealed_runtime_context_required',
    executable: false,
    adapterCalled: false,
    mutationDispatched: false,
    completionClaimed: false,
    carriesRawPath: false,
    carriesRawApp: false,
    carriesRawValue: false,
    carriesSecret: false,
    carriesIdentity: false,
    carriesApproval: false,
    carriesReceipt: false,
    carriesProof: false,
    requiredContext: [...DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT],
    message: 'The local-file mutation was not executed here. Continue through the authenticated OpenSwan typed runtime after it seals the required context.',
  };
}

export function buildDirectOpenPathRuntimeHandoff(): DirectOpenPathRuntimeHandoff {
  return buildDirectLocalFileMutationRuntimeHandoff('open_path') as DirectOpenPathRuntimeHandoff;
}
export function planDirectLocalFileRequest(task: string): DirectLocalFilePlan {
  const text = String(task || '');
  if (/\b(?:write|save|create|make)\b[\s\S]{0,140}\b(?:text\s+file|file|txt|markdown|md)\b/i.test(text)) {
    return { mode: 'write_text' };
  }
  if (/\b(?:called|named)\s+[^.]+\.(?:txt|md|json|csv)\b[\s\S]{0,120}\b(?:with|containing|that says|saying)\b/i.test(text)) {
    return { mode: 'write_text' };
  }
  if (/\b(?:create|make|new)\b[\s\S]{0,80}\b(?:folder|directory)\b/i.test(text)) return { mode: 'mkdir' };
  if (/\b(?:copy|duplicate|make a copy of)\b/i.test(text)) return { mode: 'copy' };
  if (/\b(?:delete|remove|trash|move\s+[\s\S]{1,120}\s+to\s+trash)\b/i.test(text)) return { mode: 'trash' };
  if (/\b(?:rename|change)\b[\s\S]{0,140}\b(?:to|as)\b/i.test(text)) return { mode: 'rename' };
  const openPath = extractOpenPathPlan(text);
  if (openPath) return openPath;
  return { mode: 'other' };
}

function extractAppNameForOpenPath(text: string): string | null {
  if (/\b(?:microsoft\s+word|ms\s+word|word)\b/i.test(text)) return 'Microsoft Word';
  if (/\b(?:microsoft\s+excel|ms\s+excel|excel)\b/i.test(text)) return 'Microsoft Excel';
  if (/\b(?:microsoft\s+powerpoint|ms\s+powerpoint|powerpoint)\b/i.test(text)) return 'Microsoft PowerPoint';
  if (/\b(?:adobe\s+acrobat|acrobat)\b/i.test(text)) return 'Adobe Acrobat';
  if (/\bphotoshop\b/i.test(text)) return 'Adobe Photoshop';
  if (/\bphotos\b/i.test(text)) return 'Photos';
  if (/\bfinder\b/i.test(text)) return 'Finder';
  if (/\bpreview\b/i.test(text)) return 'Preview';
  if (/\btext\s*edit\b/i.test(text)) return 'TextEdit';
  return null;
}

function normalizeFolderName(value: string): string | null {
  const lower = String(value || '').toLowerCase();
  if (/\bdesktop\b/.test(lower)) return '~/Desktop';
  if (/\bdownloads?\b/.test(lower)) return '~/Downloads';
  if (/\bdocuments?\b/.test(lower)) return '~/Documents';
  if (/\b(pictures?|photos?)\b/.test(lower)) return '~/Pictures';
  if (/\bmovies?|videos?\b/.test(lower)) return '~/Movies';
  if (/\bmusic|audio\b/.test(lower)) return '~/Music';
  return null;
}

function rootTargetPath(rootPath: string, pathOrName: string): string {
  const target = String(pathOrName || '').trim();
  if (target.startsWith('/') || target.startsWith('~/') || target.startsWith('./') || target.startsWith('../')) return target;
  return `${String(rootPath || '~').replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
}

function extractExplicitPath(text: string): string | null {
  const match = String(text || '').match(/(?:~\/[\w.\- /()@]+|\/[\w.\- /()@]+|\b(?:desktop|downloads|documents|pictures|photos|movies|music)\/[\w.\- /()@]+)/i);
  if (!match) return null;
  const raw = match[0].trim().replace(/[.!?]+$/g, '');
  if (/^(desktop|downloads|documents|pictures|photos|movies|music)\//i.test(raw)) return `~/${raw[0].toUpperCase()}${raw.slice(1)}`;
  return raw;
}

function extractFilename(text: string): string | null {
  const match = String(text || '').match(/\b([A-Za-z0-9][A-Za-z0-9 ._@()+-]{0,120}\.(?:pdf|txt|md|json|csv|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|tiff?|bmp|heic|psd|psb|indd|idml|zip))\b/i);
  return match?.[1]
    ?.trim()
    .replace(/^(?:open|show|preview|view|reveal|browse|display)\s+(?:the\s+)?(?:(?:file|image|photo|picture|document)\s+)?/i, '')
    .replace(/[.!?]+$/g, '') || null;
}

function extractOpenPathPlan(text: string): DirectLocalFilePlan | null {
  if (!/\b(?:open|show|preview|view|reveal|browse|display)\b/i.test(text)) return null;
  const appName = extractAppNameForOpenPath(text);
  const explicitPath = extractExplicitPath(text);
  if (explicitPath) return { mode: 'open_path', path: explicitPath, appName };
  const filename = extractFilename(text);
  const root = normalizeFolderName(text);
  if (filename && root) return { mode: 'open_path', path: rootTargetPath(root, filename), appName };
  if (!filename && root && /\b(?:open|show|browse|view|reveal)\b/i.test(text)) {
    return { mode: 'open_path', path: root, appName: appName || 'Finder' };
  }
  return null;
}

export function directLocalFileToolForMode(mode: string): DirectLocalFileTypedTool | null {
  switch (mode) {
    case 'rename':
      return 'desktop.file_rename';
    case 'copy':
      return 'desktop.file_copy';
    case 'trash':
      return 'desktop.file_trash';
    case 'mkdir':
      return 'desktop.file_mkdir';
    case 'write_text':
      return 'desktop.file_write_text';
    case 'open_path':
      return 'desktop.open_path';
    default:
      return null;
  }
}

export function isDirectLocalFileMode(mode: string): mode is DirectLocalFileMode {
  return DIRECT_LOCAL_FILE_MODES.has(mode);
}

export function routeHasDirectLocalFileActionItems(
  route: Pick<ChatComputerRequestRoute, 'kind' | 'actionItems' | 'sourceMessage'> | null | undefined,
): boolean {
  if (route?.kind !== 'local_file') return false;
  return Boolean(route.actionItems?.some((item) => {
    if (!DIRECT_LOCAL_FILE_TOOLS.has(item.tool)) return false;
    if (item.tool !== 'desktop.open_path') return true;
    return planDirectLocalFileRequest(route.sourceMessage || '').mode === 'open_path';
  }));
}

export async function executeDirectLocalFileRequest(
  task: string,
  executor?: DirectLocalFileExecutor,
): Promise<DirectLocalFileRuntimeOutcome> {
  const plan = planDirectLocalFileRequest(task);
  if (!isDirectLocalFileMode(plan.mode)) {
    return {
      handled: false,
      status: 'failed',
      message: 'This is not a direct local-file mutation request.',
      warnings: [],
    };
  }

  // Compatibility-only injection seam: callers may still pass the legacy
  // executor while migrating, but this runtime never invokes it. All mutation
  // input remains solely in the authenticated agent prompt.
  void executor;
  return {
    handled: true,
    status: 'handoff',
    message: 'The local-file mutation was not executed directly. It must continue through the authenticated OpenSwan typed runtime.',
    warnings: ['Direct local-file mutation dispatch is sealed behind the typed runtime.'],
    data: {
      mode: plan.mode,
      runtimeHandoff: buildDirectLocalFileMutationRuntimeHandoff(plan.mode),
    },
  };
}
