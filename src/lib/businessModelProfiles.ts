import { supabase } from './supabase';
import type { LLMProvider, ProviderKey } from './llmProviders';
import type { ComputerTaskPlanPreview } from './computerTaskPlanner';

export type BusinessTaskSurface =
  | 'chat'
  | 'browser'
  | 'desktop'
  | 'files'
  | 'apps'
  | 'mcp'
  | 'automation'
  | 'code';

export type BusinessRiskLevel = 'low' | 'medium' | 'high';

export interface BusinessModelProfile {
  id: string;
  label: string;
  provider: LLMProvider;
  modelId: string;
  enabled: boolean;
  priority: number;
  description?: string;
  allowedSurfaces: BusinessTaskSurface[];
  allowedOrigins?: string[];
  allowedApps?: string[];
  capabilities?: {
    toolUse?: boolean;
    browserPlanning?: boolean;
    desktopPlanning?: boolean;
    structuredOutput?: boolean;
    vision?: boolean;
    code?: boolean;
    contextWindow?: number;
  };
  governance?: {
    dataBoundary?: 'internal' | 'customer' | 'public';
    requireApprovalFor?: BusinessTaskSurface[];
    maxAutonomousRisk?: BusinessRiskLevel;
    allowCredentialUse?: boolean;
    allowExternalSideEffects?: boolean;
  };
  promptBoundary?: string;
}

export interface BusinessModelTaskPlan {
  selectedProfile: BusinessModelProfile | null;
  matchedSurface: BusinessTaskSurface | null;
  routeProvider: LLMProvider | null;
  routeModel: string | null;
  approvalRequired: boolean;
  canUseCredentials: boolean;
  canCreateExternalSideEffects: boolean;
  notes: string[];
  blockers: string[];
}

const SETTINGS_KEY = 'businessModelProfiles';

const DEFAULT_GOVERNANCE: NonNullable<BusinessModelProfile['governance']> = {
  dataBoundary: 'internal',
  requireApprovalFor: ['browser', 'desktop', 'apps', 'automation'],
  maxAutonomousRisk: 'medium',
  allowCredentialUse: false,
  allowExternalSideEffects: false,
};

function normalizeSurface(surface: unknown): BusinessTaskSurface | null {
  if (typeof surface !== 'string') return null;
  const value = surface.trim().toLowerCase();
  if ([
    'chat',
    'browser',
    'desktop',
    'files',
    'apps',
    'mcp',
    'automation',
    'code',
  ].includes(value)) return value as BusinessTaskSurface;
  return null;
}

function coerceProfile(raw: any, index: number): BusinessModelProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() as LLMProvider : null;
  const modelId = typeof raw.modelId === 'string' ? raw.modelId.trim() : '';
  const label = typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim()
    : modelId || `Business Model ${index + 1}`;
  if (!provider || !modelId) return null;
  const surfaces = Array.isArray(raw.allowedSurfaces)
    ? raw.allowedSurfaces.map(normalizeSurface).filter(Boolean) as BusinessTaskSurface[]
    : ['chat'];
  const governance = {
    ...DEFAULT_GOVERNANCE,
    ...(raw.governance && typeof raw.governance === 'object' ? raw.governance : {}),
  };
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${provider}:${modelId}`,
    label,
    provider,
    modelId,
    enabled: raw.enabled !== false,
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 100 + index,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    allowedSurfaces: surfaces.length ? surfaces : ['chat'],
    allowedOrigins: Array.isArray(raw.allowedOrigins) ? raw.allowedOrigins.filter((v: unknown) => typeof v === 'string') : undefined,
    allowedApps: Array.isArray(raw.allowedApps) ? raw.allowedApps.filter((v: unknown) => typeof v === 'string') : undefined,
    capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : undefined,
    governance,
    promptBoundary: typeof raw.promptBoundary === 'string' ? raw.promptBoundary : undefined,
  };
}

export function coerceBusinessModelProfiles(raw: unknown): BusinessModelProfile[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map(coerceProfile)
    .filter(Boolean)
    .sort((a, b) => (a!.priority - b!.priority) || a!.label.localeCompare(b!.label)) as BusinessModelProfile[];
}

export function buildImplicitBusinessModelProfiles(keys: ProviderKey[]): BusinessModelProfile[] {
  return keys
    .filter((key) => key.isActive && key.provider === 'openai_compatible')
    .map((key, index) => {
      const modelId = (key.label && key.label !== 'default') ? key.label : 'business-default';
      return {
        id: `implicit-openai-compatible-${key.id || index}`,
        label: key.label && key.label !== 'default' ? key.label : 'Business Model',
        provider: 'openai_compatible' as LLMProvider,
        modelId,
        enabled: true,
        priority: 10 + index,
        description: 'Implicit profile from a connected OpenAI-compatible business model endpoint.',
        allowedSurfaces: ['chat', 'browser', 'desktop', 'apps', 'mcp', 'automation', 'code'],
        capabilities: {
          toolUse: true,
          browserPlanning: true,
          desktopPlanning: true,
          structuredOutput: true,
          code: true,
          contextWindow: 128000,
        },
        governance: DEFAULT_GOVERNANCE,
        promptBoundary: 'Use this business model for planning and reasoning. Execute browser and desktop changes only through approved tools and grants.',
      } satisfies BusinessModelProfile;
    });
}

export async function loadCircleBusinessModelProfiles(circleId: string): Promise<BusinessModelProfile[]> {
  if (!circleId) return [];
  const { data, error } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (error || !data) return [];
  return coerceBusinessModelProfiles((data.settings as any)?.[SETTINGS_KEY]);
}

export async function saveCircleBusinessModelProfiles(
  circleId: string,
  profiles: BusinessModelProfile[],
): Promise<{ ok: boolean; error?: string }> {
  if (!circleId) return { ok: false, error: 'missing circleId' };
  const { data, error: readErr } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const merged = {
    ...(data?.settings as any || {}),
    [SETTINGS_KEY]: coerceBusinessModelProfiles(profiles),
  };
  const { error } = await supabase.from('circles').update({ settings: merged }).eq('id', circleId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export function surfaceForComputerTask(preview: ComputerTaskPlanPreview): BusinessTaskSurface {
  switch (preview.kind) {
    case 'browser_task':
      return 'browser';
    case 'file_task':
      return 'files';
    case 'app_task':
      return 'desktop';
    case 'hybrid_task':
      return 'automation';
    default:
      return 'chat';
  }
}

function riskForTask(task: string, preview: ComputerTaskPlanPreview): BusinessRiskLevel {
  const text = task.toLowerCase();
  if (/\b(submit|send|post|publish|delete|purchase|checkout|transfer|invite|change password|pay|deploy)\b/i.test(text)) return 'high';
  if (preview.kind === 'browser_task' || preview.kind === 'app_task' || preview.kind === 'hybrid_task') return 'medium';
  return 'low';
}

function providerIsAvailable(provider: LLMProvider, keys: ProviderKey[]): boolean {
  return keys.some((key) => key.provider === provider && key.isActive);
}

function profileScore(profile: BusinessModelProfile, surface: BusinessTaskSurface, task: string, preview: ComputerTaskPlanPreview): number {
  let score = 0;
  if (profile.allowedSurfaces.includes(surface)) score += 80;
  if (surface === 'automation' && (profile.allowedSurfaces.includes('browser') || profile.allowedSurfaces.includes('desktop'))) score += 20;
  if (surface === 'browser' && profile.capabilities?.browserPlanning) score += 20;
  if (surface === 'desktop' && profile.capabilities?.desktopPlanning) score += 20;
  if (surface === 'code' && profile.capabilities?.code) score += 20;
  if (profile.capabilities?.toolUse) score += 10;
  if (profile.capabilities?.structuredOutput) score += 5;
  if (preview.browserbaseWorkflow?.requiresStagehand && profile.capabilities?.browserPlanning) score += 10;
  if (/\b(code|repo|pull request|typescript|sql|debug)\b/i.test(task) && profile.capabilities?.code) score += 10;
  return score - profile.priority / 1000;
}

export function planBusinessModelForComputerTask(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
  profiles: BusinessModelProfile[];
  providerKeys: ProviderKey[];
}): BusinessModelTaskPlan {
  const surface = surfaceForComputerTask(args.preview);
  const risk = riskForTask(args.task, args.preview);
  const notes: string[] = [];
  const blockers: string[] = [];
  const candidates = args.profiles
    .filter((profile) => profile.enabled)
    .filter((profile) => providerIsAvailable(profile.provider, args.providerKeys))
    .filter((profile) => profile.allowedSurfaces.includes(surface) || profile.allowedSurfaces.includes('automation'))
    .sort((a, b) => profileScore(b, surface, args.task, args.preview) - profileScore(a, surface, args.task, args.preview));

  if (args.profiles.length === 0) {
    notes.push('No business model profiles are configured for this circle.');
  }
  if (args.profiles.length > 0 && candidates.length === 0) {
    blockers.push(`No enabled business model profile is connected for the ${surface} surface.`);
  }

  const selected = candidates[0] || null;
  const governance = { ...DEFAULT_GOVERNANCE, ...(selected?.governance || {}) };
  const approvalRequired = selected
    ? (governance.requireApprovalFor || []).includes(surface) || risk === 'high'
    : false;
  const canUseCredentials = !!selected && governance.allowCredentialUse === true;
  const canCreateExternalSideEffects = !!selected && governance.allowExternalSideEffects === true && risk !== 'high';

  if (selected) {
    notes.push(`Selected ${selected.label} for ${surface} planning.`);
    if (!selected.capabilities?.toolUse) {
      notes.push('Use this model as planner/reasoner only; execute browser and desktop actions through approved app tools.');
    }
    if (!canUseCredentials) {
      notes.push('Do not expose credentials to the model. Use vault injection or user-approved browser profile state only.');
    }
    if (!canCreateExternalSideEffects && risk !== 'low') {
      notes.push('External side effects require a human approval step before execution.');
    }
  }

  return {
    selectedProfile: selected,
    matchedSurface: selected ? surface : null,
    routeProvider: selected?.provider || null,
    routeModel: selected?.modelId || null,
    approvalRequired,
    canUseCredentials,
    canCreateExternalSideEffects,
    notes,
    blockers,
  };
}

export function formatBusinessModelTaskBlock(plan: BusinessModelTaskPlan | null): string | null {
  if (!plan) return null;
  const lines: string[] = ['BUSINESS MODEL ROUTING'];
  if (!plan.selectedProfile) {
    lines.push('Selected profile: none');
    if (plan.blockers.length) lines.push(`Blockers: ${plan.blockers.join(' ')}`);
    if (plan.notes.length) lines.push(`Notes: ${plan.notes.join(' ')}`);
    return lines.join('\n');
  }
  const p = plan.selectedProfile;
  lines.push(`Selected profile: ${p.label}`);
  lines.push(`Model route: ${plan.routeProvider}/${plan.routeModel}`);
  lines.push(`Allowed surfaces: ${p.allowedSurfaces.join(', ')}`);
  if (p.allowedOrigins?.length) lines.push(`Allowed origins: ${p.allowedOrigins.join(', ')}`);
  if (p.allowedApps?.length) lines.push(`Allowed apps: ${p.allowedApps.join(', ')}`);
  lines.push(`Approval required: ${plan.approvalRequired ? 'yes' : 'no'}`);
  lines.push(`Credential policy: ${plan.canUseCredentials ? 'vault/browser-profile only when granted' : 'do not use or reveal credentials'}`);
  lines.push(`External side effects: ${plan.canCreateExternalSideEffects ? 'allowed within grants' : 'approval required before writes/submissions'}`);
  if (p.promptBoundary) lines.push(`Business boundary: ${p.promptBoundary}`);
  if (plan.notes.length) lines.push(`Notes: ${plan.notes.join(' ')}`);
  if (plan.blockers.length) lines.push(`Blockers: ${plan.blockers.join(' ')}`);
  return lines.join('\n');
}
