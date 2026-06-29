export type DesktopTaskAiNeedLevel = 'none' | 'assistive' | 'required';

export interface DesktopTaskAiNeedClassification {
  level: DesktopTaskAiNeedLevel;
  label: string;
  reason: string;
  deterministicTools: string[];
  aiSurfaces: string[];
}

export interface DesktopTaskAiNeedInput {
  message: string;
  kind?: string | null;
  strategyId?: string | null;
  risk?: string | null;
  hasDesignPipeline?: boolean;
  recommendedTools?: string[];
}

const DIRECT_NO_AI_TOOLS = new Set([
  'desktop.convert_image',
  'desktop.file_list',
  'desktop.file_read',
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.file_rename',
  'desktop.file_write_text',
  'desktop.file_copy',
  'desktop.file_trash',
  'desktop.file_mkdir',
  'desktop.open_path',
  'desktop.open_url',
  'desktop.list_browser_tabs',
  'desktop.window_state',
  'desktop.list_running_apps',
  'desktop.clipboard',
  'desktop.clipboard_write',
  'desktop.clipboard_clear',
  'desktop.shortcuts_list',
  'desktop.shortcuts_run',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.wait_for_app',
  'desktop.press_keys',
  'desktop.menu_click',
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.window_manage',
]);

const AI_REQUIRED_STRATEGIES = new Set([
  'agent_asset_acquisition',
  'terminal_agent_orchestration',
]);

const AI_ASSISTIVE_STRATEGIES = new Set([
  'browser_semantic',
  'credentialed_browser',
  'approval_sensitive_browser',
  'browser_file_transfer',
  'desktop_semantic',
  'productivity_app_control',
  'universal_app_control',
  'document_data_workbench',
  'ops_console_control',
  'hybrid_control_loop',
  'adobe_cc_control',
  'engineering_cad_control',
]);

const GENERATIVE_OR_REASONING_RE = /\b(?:ai\s+edit|generative|generate|create\s+(?:an?\s+)?(?:image|background|illustration|design|layout|floor plan|song|music|video|ad|copy|blog|email|article)|write\s+(?:copy|a\s+blog|an?\s+email|an?\s+article|a\s+post)|draft\s+(?:copy|an?\s+email|a\s+post)|design\s+(?:a|an|the)|draw|compose|summari[sz]e|analy[sz]e|extract\s+(?:data|fields|insights)|research|compare|recommend|decide|classify|translate|rewrite|brainstorm|plan\b|debug|fix\s+(?:the|this)\s+(?:app|code|workflow|bridge|agent))\b/i;
const APP_SPECIFIC_AI_RE = /\b(?:agent\.build_app_capability|agent\.recover_failed_task|research\.search|vision\.extract_text|browser\.data_extract)\b/i;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function directNoAiTools(tools: string[]): string[] {
  return uniqueStrings(tools.filter((tool) => DIRECT_NO_AI_TOOLS.has(tool)));
}

function toolRequiresAi(tools: string[]): boolean {
  return tools.some((tool) => APP_SPECIFIC_AI_RE.test(tool));
}

function exactLocalOrDesktopNoAi(input: DesktopTaskAiNeedInput, tools: string[]): boolean {
  const text = String(input.message || '');
  if (input.kind === 'local_file' && directNoAiTools(tools).length > 0 && !GENERATION_EXCEPTION_RE.test(text)) return true;
  return /\b(?:open|launch|focus|switch to|show|list|find|search|read|rename|change|copy|duplicate|trash|delete|create\s+(?:a\s+)?folder|write\s+a\s+text\s+file|save\s+as|convert|press|paste|type|click\s+file\s*>|run shortcut|clipboard|what apps|active window|tabs open)\b/i.test(text)
    && directNoAiTools(tools).length > 0
    && !GENERATION_EXCEPTION_RE.test(text);
}

const GENERATION_EXCEPTION_RE = /\b(?:generate|generative|ai\s+edit|design|draw|compose|brainstorm|research|recommend|summari[sz]e|analy[sz]e|extract\s+(?:fields|insights|data)|rewrite|translate|debug|fix)\b/i;

export function classifyDesktopTaskAiNeed(input: DesktopTaskAiNeedInput): DesktopTaskAiNeedClassification {
  const message = String(input.message || '');
  const tools = uniqueStrings(input.recommendedTools || []);
  const deterministicTools = directNoAiTools(tools);
  const aiSurfaces: string[] = [];

  if (toolRequiresAi(tools)) {
    aiSurfaces.push(...tools.filter((tool) => APP_SPECIFIC_AI_RE.test(tool)));
  }

  if (
    AI_REQUIRED_STRATEGIES.has(String(input.strategyId || '')) ||
    toolRequiresAi(tools) ||
    GENERATIVE_OR_REASONING_RE.test(message)
  ) {
    return {
      level: 'required',
      label: 'AI required',
      reason: 'The task asks for generation, reasoning, research, recovery, extraction, or capability buildout that cannot be completed by a fixed bridge action alone.',
      deterministicTools,
      aiSurfaces: uniqueStrings(aiSurfaces.length ? aiSurfaces : ['model reasoning']),
    };
  }

  if (exactLocalOrDesktopNoAi(input, tools)) {
    return {
      level: 'none',
      label: 'No AI needed',
      reason: 'The request can be completed with deterministic bridge tools and proof receipts.',
      deterministicTools,
      aiSurfaces: [],
    };
  }

  if (
    input.hasDesignPipeline ||
    AI_ASSISTIVE_STRATEGIES.has(String(input.strategyId || '')) ||
    input.kind === 'browser' ||
    input.kind === 'desktop_app' ||
    input.kind === 'hybrid'
  ) {
    return {
      level: 'assistive',
      label: 'AI assisted',
      reason: 'A model may be needed to choose semantic controls, interpret app/browser state, or monitor the task, while deterministic tools still execute the actions.',
      deterministicTools,
      aiSurfaces: uniqueStrings(aiSurfaces.length ? aiSurfaces : ['semantic control selection']),
    };
  }

  return {
    level: 'none',
    label: 'No AI needed',
    reason: 'No model-only reasoning was detected; use deterministic tools and report an exact blocker if the bridge cannot prove completion.',
    deterministicTools,
    aiSurfaces: [],
  };
}
