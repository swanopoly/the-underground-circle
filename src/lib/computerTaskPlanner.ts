import type { ComputerCapabilityId, ComputerCapabilityAudit } from './computerCapabilityRegistry';
import { supabase } from './supabase';
import type { HybridPlan } from './computerHybridTypes';

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
    // Common search-engine + look-up phrasings that imply web work but were
    // previously missed (causing "find file in downloads AND google X" to
    // classify as single-surface file_task instead of hybrid_task).
    'google', 'duckduckgo', 'bing it', 'web search',
  ]) || matchesAny(text, [
    /\b(open|go to|visit|browse|check)\b.*\b(website|site|page|tab|url|link)\b/i,
    /\b(find|search|look up|research|compare|review|summarize|show me|list)\b.*\b(website|site|page|web|online|docs|documentation|pricing|reviews?)\b/i,
    // Bare "look up X", "google X", "search for X online" — search verbs
    // without an explicit web-noun. Excludes "search files/folder/disk/drive"
    // so file-search phrasings stay classified as file_task.
    /\b(look\s*up|google|bing)\s+\w/i,
    /\bsearch\s+(?!(files?|folders?|the\s+(files?|folder|disk|drive)|disk|drive|my\s+(files?|disk|drive))\b)\w+.*\b(online|on the (web|internet)|for)\b/i,
    // Bare-domain URLs: 'stripe.com', 'github.io', 'app.slack.com' — common
    // phrasings users drop into chat without an http:// prefix.
    /\b\w[\w-]*\.(com|org|net|io|co|app|dev|ai|gov|edu|so|to|me)\b/i,
  ]) || appResearch;

  const file = includesAny(text, [
    'file', 'folder', 'directory', 'path', 'desktop', 'downloads', 'documents', 'find on my computer',
    'locate', 'search files', 'read this file', 'open this file', '.md', '.ts', '.tsx', '.json', '.csv', '.pdf',
    '.txt', '.log', '.yaml', '.yml', '~/', '/users/',
    'disk', 'drive',
  ]);
  const explicitAppName = includesAny(text, [
    // Third-party dev
    'slack', 'notion', 'figma', 'github', 'discord', 'teams', 'zoom', 'linear',
    'chrome', 'cursor', 'vs code', 'vscode', 'iterm', 'xcode', 'docker',
    'chatgpt', 'copilot', 'comet', 'codellm', 'codex', 'deepagent', 'ollama',
    'obsidian', 'evernote', 'onenote', 'unity', 'epic games',
    // Office / content
    'word', 'excel', 'onedrive', 'onenote',
    'pages', 'numbers', 'keynote', 'imovie', 'garageband',
    'google docs', 'google sheets', 'google slides', 'google drive',
    'photoshop', 'illustrator', 'indesign', 'premiere', 'after effects',
    'acrobat', 'media encoder', 'creative cloud',
    // Apple built-ins (core)
    'safari', 'mail', 'calendar', 'messages', 'notes', 'reminders', 'photos',
    'music', 'maps', 'facetime', 'podcasts', 'find my', 'app store',
    'stocks', 'weather', 'home', 'books', 'tv', 'news', 'journal',
    'contacts', 'clock', 'shortcuts', 'freeform', 'stickies', 'chess',
    'voice memos', 'image capture', 'image playground', 'passwords',
    'quicktime', 'photo booth', 'font book', 'dictionary', 'magnifier',
    // Apple built-ins (utilities)
    'finder', 'preview', 'calculator', 'system settings', 'activity monitor',
    'terminal', 'textedit', 'console', 'disk utility', 'system information',
    'time machine', 'audio midi', 'colorsync', 'color meter', 'airport',
    'boot camp', 'migration assistant', 'voiceover', 'screen sharing',
    'print center', 'screenshot', 'iphone mirroring', 'mission control',
    'siri', 'automator', 'script editor', 'grapher',
    // Media hubs
    'spotify', 'insta360',
    // Generic nouns that still imply a desktop app
    'email',
  ]);
  const appControlVerb = matchesAny(text, [
    /\b(open|launch|start|switch to|use|check|review|update|send in|post in|message in)\b/i,
    /\bapplication\b/i,
    /\bdesktop app\b/i,
    /\bon my computer\b/i,
  ]);
  const app = (explicitAppName && appControlVerb) || matchesAny(text, [
    // Keep a focused regex for the "open X" form since it's the most common
    // phrasing. The full app list is covered by `explicitAppName +
    // appControlVerb` above; this regex is the fallback for bare "open X"
    // where X is a single word without other verb cues. Grouped by type
    // for readability; order doesn't matter to the regex engine.
    /\bopen\b.*\b(slack|notion|figma|github|linear|discord|teams|zoom|spotify|chrome|safari|cursor|docker|chatgpt|copilot|ollama|obsidian|evernote|onenote|comet)\b/i,
    /\bopen\b.*\b(mail|email|calendar|messages|notes|reminders|photos|music|maps|facetime|podcasts|stocks|weather|books|tv|news|contacts|clock|shortcuts|freeform|stickies|journal|passwords|home)\b/i,
    /\bopen\b.*\b(finder|preview|calculator|terminal|iterm|textedit|console|xcode|screenshot|quicktime|automator|grapher|magnifier|dictionary)\b/i,
    /\bopen\b.*\b(pages|numbers|keynote|imovie|garageband|photoshop|illustrator|indesign|premiere|acrobat)\b/i,
    /\bopen\b.*\b(find my|app store|system settings|activity monitor|disk utility|time machine|image capture|photo booth|font book|script editor|voice memos|mission control|iphone mirroring|screen sharing|print center)\b/i,
    /\blaunch\b.*\bapp/i,
    /\bopen\b.*\bapplication\b/i,
  ]);

  // If multiple distinct app names appear with a conjunction, treat as
  // hybrid even though both signals are 'app' — the work spans multiple
  // surfaces and benefits from the planner's step decomposition.
  const appNameMatches = ([
    'slack', 'notion', 'figma', 'github', 'discord', 'teams', 'zoom', 'linear',
    'chrome', 'cursor', 'vs code', 'vscode', 'iterm', 'xcode', 'docker', 'safari',
    'mail', 'calendar', 'messages', 'notes', 'reminders', 'photos', 'music', 'maps',
    'finder', 'preview', 'calculator', 'terminal', 'textedit',
  ]).filter((name) => text.includes(name));
  const hasConjunction = /\b(and|then|after|next)\b/.test(text);
  const multiApp = appNameMatches.length >= 2 && hasConjunction;

  const activeKinds = [browser, file, app].filter(Boolean).length;
  if (activeKinds > 1 || multiApp) {
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

/**
 * Fetch a HybridPlan from the hybrid-task-planner edge function.
 * Throws on network/auth/empty-plan failure; caller surfaces a
 * user-facing error.
 */
export async function decomposeHybridTask(args: {
  task: string;
  circleId: string;
  audit: ComputerCapabilityAudit | null;
}): Promise<HybridPlan> {
  const { data, error } = await supabase.functions.invoke('hybrid-task-planner', {
    body: {
      task: args.task,
      circleId: args.circleId,
      audit: args.audit ? { findings: args.audit.findings } : undefined,
    },
  });

  if (error) {
    throw new Error(`hybrid-task-planner failed: ${error.message || error}`);
  }
  if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
    throw new Error('planner returned empty plan');
  }
  return data as HybridPlan;
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
