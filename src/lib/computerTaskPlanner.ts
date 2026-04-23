import type { ComputerCapabilityId, ComputerCapabilityAudit } from './computerCapabilityRegistry';

export type ComputerTaskKind =
  | 'browser_task'
  | 'file_task'
  | 'app_task'
  | 'hybrid_task'
  | 'unknown';

export interface ComputerTaskPlanPreview {
  kind: ComputerTaskKind;
  label: string;
  detail: string;
  requiredCapabilities: ComputerCapabilityId[];
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function matchesAny(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(haystack));
}

export function planComputerTaskPreview(task: string): ComputerTaskPlanPreview {
  const text = String(task || '').trim().toLowerCase();
  if (!text) {
    return {
      kind: 'unknown',
      label: 'Unclassified',
      detail: 'Describe the computer task and the planner will infer whether it is primarily browser, file, app, or hybrid work.',
      requiredCapabilities: [],
    };
  }

  const appResearch = matchesAny(text, [
    /\b(best|top|compare|comparison|review|reviews|recommend|recommended|list|ranking|rank|find)\b.*\bapps?\b/i,
    /\bapps?\b.*\b(202[0-9]|for|under|with|without|best|top|compare|reviews?)\b/i,
  ]);

  const browser = includesAny(text, [
    'website', 'site', 'browser', 'tab', 'visit ', 'navigate', 'search the web',
    'log in', 'login', 'sign in', 'fill out', 'form', 'checkout', 'page', 'url', 'docs',
  ]) || matchesAny(text, [
    /\b(open|go to|visit|browse|check)\b.*\b(website|site|page|tab|url|link)\b/i,
    /\b(find|search|look up|research|compare|review|summarize|show me|list)\b.*\b(website|site|page|web|online|docs|documentation|pricing|reviews?)\b/i,
  ]) || appResearch;

  const file = includesAny(text, [
    'file', 'folder', 'directory', 'path', 'desktop', 'downloads', 'documents', 'find on my computer',
    'locate', 'search files', 'read this file', 'open this file', '.md', '.ts', '.tsx', '.json', '.csv', '.pdf',
  ]);
  const explicitAppName = includesAny(text, [
    'slack', 'notion', 'figma', 'github', 'word', 'excel', 'calendar', 'email', 'mail',
    'messages', 'discord', 'teams', 'zoom', 'spotify', 'finder', 'chrome', 'safari', 'terminal',
  ]);
  const appControlVerb = matchesAny(text, [
    /\b(open|launch|start|switch to|use|check|review|update|send in|post in|message in)\b/i,
    /\bapplication\b/i,
    /\bdesktop app\b/i,
    /\bon my computer\b/i,
  ]);
  const app = (explicitAppName && appControlVerb) || matchesAny(text, [
    /\bopen\b.*\b(slack|notion|figma|github|word|excel|calendar|email|mail|discord|teams|zoom|spotify|finder|chrome|safari|terminal)\b/i,
    /\blaunch\b.*\bapp/i,
    /\bopen\b.*\bapplication\b/i,
  ]);

  const activeKinds = [browser, file, app].filter(Boolean).length;
  if (activeKinds > 1) {
    return {
      kind: 'hybrid_task',
      label: 'Hybrid computer task',
      detail: 'This request likely spans more than one surface, such as browser plus files or app plus browser.',
      requiredCapabilities: ['browser_automation', 'app_tools', 'file_search'],
    };
  }
  if (file) {
    return {
      kind: 'file_task',
      label: 'File task',
      detail: 'This request looks primarily about locating or reading local files the user has granted access to.',
      requiredCapabilities: ['file_search', 'file_read'],
    };
  }
  if (app) {
    return {
      kind: 'app_task',
      label: 'App task',
      detail: 'This request looks primarily about using a connected app, integration, or bridge-exposed tool.',
      requiredCapabilities: ['app_tools'],
    };
  }
  if (browser) {
    return {
      kind: 'browser_task',
      label: 'Browser task',
      detail: 'This request looks primarily about websites, forms, browsing, or live web execution.',
      requiredCapabilities: ['browser_automation'],
    };
  }
  return {
    kind: 'unknown',
    label: 'General computer task',
    detail: 'The task may need browser, file, or app access. The runtime should resolve the best surface after more detail.',
    requiredCapabilities: ['browser_automation', 'app_tools', 'file_search'],
  };
}

export function summarizeComputerTaskCapabilityReadiness(
  preview: ComputerTaskPlanPreview,
  audit: ComputerCapabilityAudit | null,
): {
  ready: boolean;
  missing: ComputerCapabilityId[];
  summary: string;
} {
  if (!audit) {
    return {
      ready: false,
      missing: preview.requiredCapabilities,
      summary: 'Checking computer capabilities for this circle.',
    };
  }

  const statusById = new Map(audit.findings.map((finding) => [finding.id, finding.status]));
  const missing = preview.requiredCapabilities.filter((capability) => statusById.get(capability) === 'missing');
  const partial = preview.requiredCapabilities.filter((capability) => statusById.get(capability) === 'partial');

  if (missing.length === 0 && partial.length === 0) {
    return {
      ready: true,
      missing: [],
      summary: 'Required capability surfaces look ready for this task.',
    };
  }

  const fragments: string[] = [];
  if (partial.length > 0) fragments.push(`partial: ${partial.join(', ')}`);
  if (missing.length > 0) fragments.push(`missing: ${missing.join(', ')}`);

  return {
    ready: missing.length === 0,
    missing,
    summary: `Capability check: ${fragments.join(' · ')}`,
  };
}
