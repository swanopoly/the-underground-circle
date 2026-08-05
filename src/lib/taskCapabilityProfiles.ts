// Task Capability Profiles — define what each task type can do
import { inferImpactDomain, type ImpactDomainKey } from './impactDomains';

export type TaskType = 'code_change' | 'design_work' | 'ui_qa' | 'research' | 'content' | 'ops' | 'room_update' | 'mixed';
export type TaskCapabilityProfileKey =
  | 'research_basic'
  | 'ai_research'
  | 'scientific_research'
  | 'medical_imaging'
  | 'clinical_decision_support'
  | 'materials_research'
  | 'renewable_energy_systems'
  | 'human_flourishing_research'
  | 'ui_design'
  | 'frontend_build'
  | 'browser_qa'
  | 'computer_files'
  | 'computer_apps'
  | 'computer_hybrid'
  | 'room_curator';

/**
 * A hard execution-surface ceiling derived from the task profile. This is
 * intentionally narrower than prompt guidance: downstream model loops use it
 * to remove incompatible tools from their advertised catalog and from their
 * dispatchable handler set.
 */
export type TaskExecutionSurfaceGuard = 'desktop_app_only' | 'local_file_only';

const NON_BROWSER_EXECUTION_SURFACE_ESCAPE_TOOLS = new Set([
  'desktop.open_url',
  // The generic catalog search can reveal excluded browser tools and is not
  // needed when the complete guard-scoped catalog is already advertised.
  'tools.search',
]);

export function resolveTaskExecutionSurfaceGuard(
  profileKey?: string | null,
): TaskExecutionSurfaceGuard | undefined {
  if (profileKey === 'computer_apps') return 'desktop_app_only';
  if (profileKey === 'computer_files') return 'local_file_only';
  return undefined;
}

export function taskExecutionSurfaceAllowsTool(
  guard: TaskExecutionSurfaceGuard | undefined,
  toolName: string,
): boolean {
  if (!guard) return true;
  const normalized = String(toolName || '').trim().toLowerCase();
  if (!normalized) return false;
  if (guard === 'desktop_app_only' || guard === 'local_file_only') {
    return !normalized.startsWith('browser.')
      && !NON_BROWSER_EXECUTION_SURFACE_ESCAPE_TOOLS.has(normalized);
  }
  return false;
}

export type TaskExecutionSurfaceToolCallVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

const KNOWN_BROWSER_APP_TARGET_PREFIXES = [
  'google chrome',
  'chrome',
  'chromium',
  'safari',
  'firefox',
  'microsoft edge',
  'edge',
  'arc',
  'brave',
  'opera',
  'vivaldi',
] as const;

const KNOWN_BROWSER_BUNDLE_PREFIXES = [
  'com.google.chrome',
  'org.chromium.chromium',
  'com.apple.safari',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
  'company.thebrowser.browser',
  'com.brave.browser',
  'com.operasoftware.opera',
  'com.vivaldi.vivaldi',
] as const;

function hasAppNameBoundary(value: string, prefix: string): boolean {
  if (value === prefix) return true;
  const next = value.charAt(prefix.length);
  return value.startsWith(prefix) && (next === ' ' || next === '-' || next === '(');
}

export function isKnownBrowserAppTarget(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase().replace(/\.app$/i, '').trim();
  if (!normalized) return false;
  if (KNOWN_BROWSER_APP_TARGET_PREFIXES.some((prefix) =>
    hasAppNameBoundary(normalized, prefix),
  )) {
    return true;
  }
  return KNOWN_BROWSER_BUNDLE_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}.`),
  );
}

/**
 * Evaluate the exact tool call after catalog scoping but before any approval
 * or handler dispatch. Desktop-app-only and local-file-only runs may use their
 * allowed native tools, but may never use them as a side door to activate or
 * control a browser process.
 */
export function evaluateTaskExecutionSurfaceToolCall(
  guard: TaskExecutionSurfaceGuard | undefined,
  toolName: string,
  input: unknown,
): TaskExecutionSurfaceToolCallVerdict {
  if (!taskExecutionSurfaceAllowsTool(guard, toolName)) {
    const guardLabel = guard === 'local_file_only' ? 'local-file-only' : 'desktop-app-only';
    return {
      allowed: false,
      reason: `Execution-surface guard blocked "${String(toolName || 'unknown')}". This ${guardLabel} task cannot use browser tools or open a URL in the browser.`,
    };
  }
  if (guard !== 'desktop_app_only' && guard !== 'local_file_only') return { allowed: true };

  const args = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const normalizedToolName = String(toolName || '').trim().toLowerCase();
  const appName = args?.appName;
  if (normalizedToolName.startsWith('desktop.') && isKnownBrowserAppTarget(appName)) {
    return {
      allowed: false,
      reason: `Execution-surface guard blocked browser app target "${String(appName)}" for "${toolName}". Use a computer_hybrid or browser task for browser control.`,
    };
  }

  if (normalizedToolName === 'desktop.window_manage') {
    const action = typeof args?.action === 'string' ? args.action.trim().toLowerCase() : '';
    const hasExplicitAppName = typeof appName === 'string' && appName.trim().length > 0;
    if (['focus', 'raise', 'unminimize'].includes(action) && !hasExplicitAppName) {
      return {
        allowed: false,
        reason: `Execution-surface guard requires an explicit non-browser appName before desktop.window_manage can ${action || 'raise'} a window.`,
      };
    }
  }

  return { allowed: true };
}

export interface TaskCapabilityProfile {
  key: TaskCapabilityProfileKey;
  label: string;
  capabilities: string[];
  impactDomain?: ImpactDomainKey;
  defaults: {
    required_artifacts?: string[];
    approval_required?: boolean;
    checks?: string[];
  };
}

export const TASK_CAPABILITY_PROFILES: Record<TaskCapabilityProfileKey, TaskCapabilityProfile> = {
  research_basic: {
    key: 'research_basic', label: 'Research & Analysis',
    capabilities: ['search', 'fetch', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: false },
  },
  ai_research: {
    key: 'ai_research', label: 'AI Research & Evaluation',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle', 'benchmark_design'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: false, checks: ['evidence_review', 'evaluation_review'] },
  },
  scientific_research: {
    key: 'scientific_research', label: 'Scientific Research',
    impactDomain: 'cancer_research',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: false, checks: ['evidence_review', 'human_review'] },
  },
  medical_imaging: {
    key: 'medical_imaging', label: 'Medical Imaging Analysis Support',
    impactDomain: 'medical_imaging',
    capabilities: ['search', 'fetch', 'classification', 'vision_review', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: true, checks: ['safety_review', 'human_review'] },
  },
  clinical_decision_support: {
    key: 'clinical_decision_support', label: 'Clinical Decision Support',
    impactDomain: 'clinical_decision_support',
    capabilities: ['search', 'fetch', 'classification', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: true, checks: ['clinical_review', 'safety_review'] },
  },
  materials_research: {
    key: 'materials_research', label: 'Materials Research',
    impactDomain: 'materials_science',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['evidence_review'] },
  },
  renewable_energy_systems: {
    key: 'renewable_energy_systems', label: 'Renewable Energy Systems',
    impactDomain: 'renewable_energy',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['system_tradeoff_review'] },
  },
  human_flourishing_research: {
    key: 'human_flourishing_research', label: 'Human Flourishing Research',
    impactDomain: 'human_flourishing',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['impact_review', 'human_review'] },
  },
  ui_design: {
    key: 'ui_design', label: 'UI/UX Design',
    capabilities: ['image_generate', 'figma_inspect', 'visual_artifact'],
    defaults: { required_artifacts: ['image', 'design_spec'], approval_required: false, checks: ['design_handoff', 'human_review'] },
  },
  frontend_build: {
    key: 'frontend_build', label: 'Frontend Build',
    capabilities: ['code_read', 'code_patch', 'static_analysis', 'test_run'],
    defaults: { required_artifacts: ['code_patch'], approval_required: false, checks: ['test_pass', 'human_review'] },
  },
  browser_qa: {
    key: 'browser_qa', label: 'Browser QA',
    capabilities: ['browser_open', 'browser_navigate', 'screenshot_capture'],
    defaults: { required_artifacts: ['screenshot'], approval_required: false, checks: ['browser_check'] },
  },
  computer_files: {
    key: 'computer_files', label: 'Computer File Access',
    capabilities: ['file_search', 'file_read', 'search', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['access_review'] },
  },
  computer_apps: {
    key: 'computer_apps', label: 'Computer App Access',
    capabilities: ['app_connect', 'app_read', 'app_action', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: true, checks: ['integration_review', 'access_review'] },
  },
  computer_hybrid: {
    key: 'computer_hybrid', label: 'Computer Hybrid Workflow',
    capabilities: ['file_search', 'file_read', 'app_connect', 'browser_open', 'browser_navigate', 'comment'],
    defaults: { required_artifacts: ['report', 'checklist'], approval_required: true, checks: ['execution_plan_review', 'access_review'] },
  },
  room_curator: {
    key: 'room_curator', label: 'Room Curator',
    capabilities: ['room_file_read', 'patch_propose'],
    defaults: { required_artifacts: ['code_patch'], approval_required: true, checks: ['room_patch_review'] },
  },
};

export function getTaskCapabilityProfile(key: string): TaskCapabilityProfile | undefined {
  return TASK_CAPABILITY_PROFILES[key as TaskCapabilityProfileKey];
}

export function inferTaskCapabilityProfile(task: { title: string; description?: string }): TaskCapabilityProfileKey {
  const text = `${task.title} ${task.description || ''}`.toLowerCase();
  const domain = inferImpactDomain(task);
  if (/llm|large language model|agentic ai|multimodal|benchmark|ablation|eval harness|research scientist|model eval|fine[- ]?tuning|inference optimization/i.test(text)) return 'ai_research';
  if (/mri|ct|xray|scan|radiology|imaging|dicom|lesion|segmentation/i.test(text)) return 'medical_imaging';
  if (/disease|diagnos|clinical|physician|doctor|triage|screening|accuracy/i.test(text)) return 'clinical_decision_support';
  if (/cancer|oncology|tumou?r|biomarker|metastasis|tumor/i.test(text)) return 'scientific_research';
  if (/material|materials|battery chemistry|alloy|polymer|catalyst|nanomaterial/i.test(text)) return 'materials_research';
  if (/renewable|solar|wind|grid|energy storage|geothermal|battery storage|power system/i.test(text)) return 'renewable_energy_systems';
  if (/human life|human flourishing|education|public health|culture|global wellbeing|society/i.test(text)) return 'human_flourishing_research';
  if (/mock|redesign|visual|landing|figma|wireframe|ui.*design|design.*comp/i.test(text)) return 'ui_design';
  if (/bug|component|refactor|implement|screen|feature|build|code/i.test(text)) return 'frontend_build';
  if (/test|verify|responsive|regression|qa|browser|screenshot/i.test(text)) return 'browser_qa';
  if (/file|folder|directory|document|downloads|desktop|documents|pdf|csv|json|markdown|search files|find on my computer/i.test(text)) return 'computer_files';
  if (/slack|notion|figma|github|calendar|email|mail|discord|teams|app|application/i.test(text)) return 'computer_apps';
  if (/computer task|hybrid|browser.*file|file.*browser|app.*file|file.*app/i.test(text)) return 'computer_hybrid';
  if (/research|analyze|audit|compare|investigate|explore/i.test(text)) return 'research_basic';
  if (/room|knowledge|doc|organize|curate|wiki/i.test(text)) return 'room_curator';
  if (domain === 'cancer_research') return 'scientific_research';
  if (domain === 'medical_imaging') return 'medical_imaging';
  if (domain === 'clinical_decision_support') return 'clinical_decision_support';
  if (domain === 'materials_science') return 'materials_research';
  if (domain === 'renewable_energy') return 'renewable_energy_systems';
  if (domain === 'human_flourishing') return 'human_flourishing_research';
  return 'research_basic';
}

export function profileRequiresApproval(profileKey: string): boolean {
  const profile = getTaskCapabilityProfile(profileKey);
  return profile?.defaults.approval_required ?? false;
}
