import type { ComputerCapabilityId, ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  classifyBrowserbaseWorkflow,
  type BrowserbaseWorkflowIntent,
} from './browserbaseWorkflowIntent';
import {
  buildAutomationVerificationSafetyNotes,
  detectAutomationVerificationGate,
  type AutomationVerificationGate,
} from './desktopAutomationSafety';
import {
  detectLocalComputerAwarenessIntent,
  detectLocalComputerAwarenessIntentSequence,
  type LocalComputerAwarenessIntent,
} from './localComputerAwarenessIntent';
import { DESKTOP_ATTACHMENT_TASK_MARKER } from './chatDesktopAttachmentRouting';

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
  browserbaseWorkflow?: BrowserbaseWorkflowIntent;
  verificationGate?: AutomationVerificationGate;
  safetyNotes?: string[];
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function matchesAny(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(haystack));
}

function looksLikeUnfamiliarAppControl(task: string): boolean {
  const text = String(task || '');
  return (
    /\b(?:app|application|desktop app|native app|program|window)\b[\s\S]{0,120}\b(?:open|launch|focus|control|drive|automate|take over|click|type|paste|press|menu|create|make|build|edit|update|export|save|run)\b/i.test(text) ||
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?!the\s+(?:website|browser|page|site|file|folder)\b)(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})(?:\s+(?:app|application|window|program))?\s+(?:and|then|to|for|with)\s+\b(?:create|make|build|edit|update|export|save|click|type|paste|press|fill|draw|design|run|do)\b/i.test(text) ||
    /\b(?:click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|export|save|run)\b[\s\S]{0,160}\b(?:in|inside|on|with|using)\s+(?:the\s+)?(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})\s+(?:app|application|window|program)\b/i.test(text)
  );
}

// Curated, word-boundary desktop-app names for operativeKnownAppReference. Only
// unambiguous names are listed: any that doubles as a common word ("word",
// "pages", "mail", "notes", "logic", "terminal", "maya", "sketch") is omitted or
// vendor-qualified ("microsoft word"), so it can't false-match prose even behind
// an operative prefix.
const OPERATIVE_KNOWN_APP_RE = new RegExp(
  '\\b(?:in|on|with|using|inside|within|via|open|launch|use|run|control|automate|drive|switch\\s+to)\\s+' +
    '(?:the\\s+|my\\s+|adobe\\s+|apple\\s+)?(?:' +
    [
      // Adobe / creative / media
      'photoshop', 'illustrator', 'indesign', 'premiere(?:\\s+pro)?', 'after\\s+effects',
      'lightroom', 'acrobat', 'audition', 'media\\s+encoder', 'davinci\\s+resolve',
      'final\\s+cut(?:\\s+pro)?', 'logic\\s+pro', 'garageband', 'imovie',
      'blender', 'cinema\\s*4d', 'gimp', 'inkscape',
      'affinity(?:\\s+(?:photo|designer|publisher))?', 'figma', 'canva',
      'obs(?:\\s+studio)?', 'handbrake',
      // Office / productivity (ambiguous bare names are vendor-qualified)
      'powerpoint', 'excel', 'keynote', 'outlook', 'onenote',
      'microsoft\\s+word', 'ms\\s+word', 'google\\s+(?:docs|sheets|slides|drive)',
      // CAD / engineering / audio production
      'autocad', 'solidworks', 'fusion\\s*360', 'revit', 'sketchup',
      'ableton', 'pro\\s+tools', 'fl\\s+studio', 'cubase',
      // dev / collaboration / desktop
      'notion', 'slack', 'discord', 'obsidian', 'xcode', 'finder',
    ].join('|') +
    ')\\b',
  'i',
);

/**
 * High-precision "operating a named app" signal: an operative prefix
 * (in/with/using/open/launch/use/…) immediately followed by a curated,
 * word-boundary desktop-app name (multi-word aware). Catches "in PowerPoint",
 * "using DaVinci Resolve", "with GIMP", "in Microsoft Word" — which the
 * verb-gated path misses — while the curated word-boundary list keeps "in the
 * mail" / "in other words" / "use logic" from false-matching. Complements
 * appControlVerb (which needs a verb but matches a much broader, riskier list).
 */
export function operativeKnownAppReference(task: string): boolean {
  return OPERATIVE_KNOWN_APP_RE.test(String(task || ''));
}

function deterministicSequenceCapabilities(sequence: LocalComputerAwarenessIntent[]): ComputerCapabilityId[] {
  const capabilities = new Set<ComputerCapabilityId>();
  const fileReadKinds = new Set([
    'file_list',
    'file_read',
    'file_search',
    'file_stat',
    'open_file_search_match',
    'indesign_relink_asset',
    'photoshop_place_asset',
  ]);
  const fileWriteKinds = new Set([
    'file_rename',
    'file_copy',
    'file_trash',
    'file_mkdir',
    'file_write_text',
    'indesign_package_document',
    'indesign_export_proof',
    'photoshop_export_proof',
  ]);
  const appKinds = new Set([
    'launch_app',
    'focus_app',
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
    'wait_for_app',
    'mouse_move',
    'mouse_click',
    'mouse_down',
    'mouse_up',
    'mouse_drag',
    'mouse_scroll',
    'a11y_tree',
  ]);

  for (const intent of sequence) {
    const kind = intent.kind || '';
    if (fileReadKinds.has(kind)) {
      capabilities.add('file_search');
      capabilities.add('file_read');
    }
    if (fileWriteKinds.has(kind)) {
      capabilities.add('file_search');
      capabilities.add('file_read');
      capabilities.add('file_write');
    }
    if (kind === 'paste_text' && (intent.reason === 'local-save-dialog-filename' || intent.reason === 'local-save-dialog-output-path')) {
      capabilities.add('file_write');
    }
    if (appKinds.has(kind)) {
      capabilities.add('app_tools');
    }
  }

  if (capabilities.size === 0) capabilities.add('app_tools');
  return Array.from(capabilities);
}

const LOW_RISK_PHOTOSHOP_IMAGE_EXPORT_DISALLOWED_RE = /\b(?:generative|generate|ai\s+edit|fill|remove|delete|erase|crop|resize|retouch|replace|background|mask|selection|selected|highlighted|brush|layers?|text|headline|color|adjust|filter|blur|sharpen|harmonize|expand|create\s+canvas|new\s+document|overwrite|save\s+over|same\s+file|source|original|send|publish|upload|submit|email|post|pay|purchase|checkout)\b/i;
const LOW_RISK_PHOTOSHOP_IMAGE_EXPORT_FORMAT_RE = /(?:\.(?:png|jpe?g)\b|\b(?:png|jpe?g)\b|\bsave\s+for\s+web\b|\bweb\s+optimized\b|\boptimized\s+for\s+web\b)/i;

export function isLowRiskLocalImageExportTask(task: string): boolean {
  const text = String(task || '').trim();
  if (!/\bphotoshop\b/i.test(text)) return false;
  if (!/\b(?:save|export)\b/i.test(text) || !LOW_RISK_PHOTOSHOP_IMAGE_EXPORT_FORMAT_RE.test(text)) return false;
  if (LOW_RISK_PHOTOSHOP_IMAGE_EXPORT_DISALLOWED_RE.test(text)) return false;

  const sequence = detectLocalComputerAwarenessIntentSequence(text);
  if (sequence.length <= 1) return false;

  let hasPhotoshopSurface = false;
  let hasSaveForWeb = false;
  let hasSafeFilename = false;

  const allowed = sequence.every((intent) => {
    const appQuery = String(intent.appQuery || '').toLowerCase();
    const reason = String(intent.reason || '');
    const isPhotoshop = appQuery === 'photoshop';
    if (isPhotoshop) hasPhotoshopSurface = true;

    if (intent.kind === 'wait') return true;
    if (intent.kind === 'launch_app' || intent.kind === 'focus_app' || intent.kind === 'wait_for_app') {
      return isPhotoshop;
    }
    if (intent.kind === 'open_file_search_match') {
      return isPhotoshop;
    }
    if (intent.kind === 'press_keys') {
      const combo = String(intent.combo || '');
      if (isPhotoshop && (reason === 'local-save-for-web-shortcut' || combo === 'Cmd+Opt+Shift+S')) {
        hasSaveForWeb = true;
        return true;
      }
      return isPhotoshop && reason === 'local-confirm-dialog-shortcut' && combo === 'Return';
    }
    if (intent.kind === 'semantic_click') {
      if (isPhotoshop && reason === 'local-save-for-web-save-button' && /^save$/i.test(String(intent.targetLabel || ''))) {
        hasSaveForWeb = true;
        return true;
      }
      return false;
    }
    if (intent.kind === 'paste_text') {
      const targetPath = String(intent.text || '').trim();
      if (
        isPhotoshop
        && (reason === 'local-save-dialog-filename' || reason === 'local-save-dialog-output-path')
        && /\.(?:png|jpe?g)$/i.test(targetPath)
      ) {
        hasSafeFilename = true;
        return true;
      }
      return false;
    }
    return false;
  });

  return allowed && hasPhotoshopSurface && hasSaveForWeb && hasSafeFilename;
}

export function planComputerTaskPreview(task: string): ComputerTaskPlanPreview {
  const text = String(task || '').trim().toLowerCase();
  const localComputerIntent = detectLocalComputerAwarenessIntent(task);
  const localComputerSequence = detectLocalComputerAwarenessIntentSequence(task);
  const browserbaseWorkflow = classifyBrowserbaseWorkflow(task);
  const verificationGate = detectAutomationVerificationGate(task) || undefined;
  const verificationSafetyNotes = buildAutomationVerificationSafetyNotes(task);
  const finalize = (plan: ComputerTaskPlanPreview): ComputerTaskPlanPreview => {
    const safetyNotes = Array.from(new Set([...(plan.safetyNotes || []), ...verificationSafetyNotes]));
    return {
      ...plan,
      verificationGate,
      safetyNotes: safetyNotes.length > 0 ? safetyNotes : plan.safetyNotes,
      requiredCapabilities: verificationGate && !plan.requiredCapabilities.includes('browser_automation')
        ? [...plan.requiredCapabilities, 'browser_automation']
        : plan.requiredCapabilities,
    };
  };

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

  if (String(task || '').includes(DESKTOP_ATTACHMENT_TASK_MARKER)) {
    const isEdit = /\bRequested operation:\s*edit\b/i.test(task);
    return finalize({
      kind: 'hybrid_task',
      label: 'Uploaded desktop file task',
      detail: isEdit
        ? 'This request uses file(s) uploaded to chat, stages them locally, opens them in the best desktop app, and may save changes to the staged copy.'
        : 'This request uses file(s) uploaded to chat, stages them locally, and opens them in the best desktop app.',
      requiredCapabilities: isEdit
        ? ['file_search', 'file_read', 'file_write', 'app_tools']
        : ['file_search', 'file_read', 'app_tools'],
    });
  }

  if (localComputerSequence.length > 1) {
    const requiredCapabilities = deterministicSequenceCapabilities(localComputerSequence);
    const hasFile = requiredCapabilities.includes('file_search') || requiredCapabilities.includes('file_read');
    const hasApp = requiredCapabilities.includes('app_tools');
    return finalize({
      kind: hasFile && hasApp ? 'hybrid_task' : hasFile ? 'file_task' : 'app_task',
      label: 'Deterministic desktop sequence',
      detail: 'This request maps to an explicit local desktop/browser action sequence and should execute through the local bridge instead of model planning.',
      requiredCapabilities,
    });
  }

  const browser = includesAny(text, [
    'website', 'site', 'browser', 'tab', 'visit ', 'navigate', 'search the web',
    'log in', 'login', 'sign in', 'fill out', 'form', 'checkout', 'page', 'url', 'docs',
    'browserbase', 'stagehand', 'scrape', 'extract data', 'data retrieval', 'structured data',
    'form submission', 'submit form', 'data entry', 'captcha', 'recaptcha', 'hcaptcha',
    'turnstile', 'not a robot', 'human verification', 'bot verification', 'security check',
  ]) || matchesAny(text, [
    /\b(open|go to|visit|browse|check)\b.*\b(website|site|page|tab|url|link)\b/i,
    /\b(find|search|look up|research|compare|review|summarize|show me|list)\b.*\b(website|site|page|web|online|docs|documentation|pricing|reviews?)\b/i,
    /\b(extract|scrape|collect|gather|capture|export|pull)\b.*\b(from|on)\b.*\b(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})\b/i,
    /\b(fill|complete|submit|populate)\b.*\b(form|survey|application|registration|checkout)\b/i,
    /\bstagehand\b.*\b(act|extract|click|fill|navigate|form|website|page)\b/i,
    // A navigation verb pointed at a real domain (known web TLD, so file
    // extensions / "node.js" don't match) is a clear browser signal even with no
    // "website/page" noun: "go to example.com", "visit acme.io/contact".
    /\b(?:go ?to|goto|visit|browse|navigate to|head to|pull up|load|open)\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com|org|net|io|co|ai|app|dev|gov|edu|info|biz|xyz|shop|store|me|us|uk|ca)\b/i,
  ]) || appResearch;

  const file = includesAny(text, [
    'file', 'folder', 'directory', 'path', 'desktop', 'downloads', 'documents', 'find on my computer',
    'locate', 'search files', 'read this file', 'open this file', 'scan my computer', 'scan through my computer',
    'local computer files', 'local files', 'hard drive', 'home folder', 'finder search',
    '.md', '.ts', '.tsx', '.json', '.csv', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.psd', '.indd',
  ]) || matchesAny(text, [
    /\b(find|locate|search|look for|show me)\b[\s\S]{0,80}\b(on|in)\b[\s\S]{0,40}\b(my )?(computer|mac|laptop|desktop|downloads?|documents?|files?|folders?)\b/i,
    /\bwhere (is|are)\b[\s\S]{0,80}\b(file|folder|document|download|pdf|image|photo|screenshot)\b/i,
    /\b(all|anything|everything)\b[\s\S]{0,40}\b(on|in)\b[\s\S]{0,30}\b(my )?(computer|mac|laptop|files?)\b/i,
  ]);
  const fileWrite = matchesAny(text, [
    /\b(rename|change|move|copy|delete|remove|edit|write|save|replace|create)\b[\s\S]{0,120}\b(file|folder|directory|image|photo|picture|document|desktop|downloads?|documents?)\b/i,
    /\b(file|folder|directory|image|photo|picture|document)\b[\s\S]{0,120}\b(rename|change|move|copy|delete|remove|edit|write|save|replace|create)\b/i,
    /\b(rename|change)\b[\s\S]{0,120}\b(?:to|as)\b[\s\S]{0,80}\.[a-z0-9]{1,12}\b/i,
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
    /\b(open|launch|start|switch to|use|check|review|update|send in|post in|message in|click|press|select|choose|drag|scroll|resize|minimize|maximize|zoom|type|enter|paste|hotkey|shortcut|menu|hold|release|wait|pause)\b/i,
    /\bapplication\b/i,
    /\bdesktop app\b/i,
    /\bon my computer\b/i,
  ]);
  const localDesktopAction = [
    'launch_app',
    'focus_app',
    'window_manage',
    'semantic_click',
    'menu_click',
    'type_text',
    'paste_text',
    'set_field_text',
    'indesign_find_change',
    'press_keys',
    'wait',
    'mouse_move',
    'mouse_click',
    'mouse_down',
    'mouse_up',
    'mouse_drag',
    'mouse_scroll',
  ].includes(localComputerIntent.kind || '');
  const app = localDesktopAction || looksLikeUnfamiliarAppControl(task) || operativeKnownAppReference(text) || (explicitAppName && appControlVerb) || matchesAny(text, [
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
    /\b(click|press|select|choose)\b.*\b(button|menu|control|field|checkbox|tab|icon)\b.*\b(app|application|window)\b/i,
  ]);

  const activeKinds = [browser, file, app].filter(Boolean).length;
  if (activeKinds > 1) {
    return finalize({
      kind: 'hybrid_task',
      label: 'Hybrid computer task',
      detail: 'This request likely spans more than one surface, such as browser plus files or app plus browser.',
      requiredCapabilities: file && fileWrite
        ? ['browser_automation', 'app_tools', 'file_search', 'file_read', 'file_write']
        : ['browser_automation', 'app_tools', 'file_search'],
    });
  }
  if (file) {
    return finalize({
      kind: 'file_task',
      label: 'File task',
      detail: fileWrite
        ? 'This request looks primarily about locating and changing local files the user has granted write access to.'
        : 'This request looks primarily about locating or reading local files the user has granted access to.',
      requiredCapabilities: fileWrite ? ['file_search', 'file_read', 'file_write'] : ['file_search', 'file_read'],
    });
  }
  if (app) {
    return finalize({
      kind: 'app_task',
      label: 'App task',
      detail: 'This request looks primarily about using a connected app, integration, or bridge-exposed tool.',
      requiredCapabilities: ['app_tools'],
    });
  }
  if (browser) {
    return finalize({
      kind: 'browser_task',
      label: browserbaseWorkflow.label === 'General browser automation'
        ? 'Browser task'
        : browserbaseWorkflow.label,
      detail: browserbaseWorkflow.kind === 'general_browser'
        ? 'This request looks primarily about websites, forms, browsing, or live web execution.'
        : browserbaseWorkflow.summary,
      requiredCapabilities: browserbaseWorkflow.requiresPersistentContext
        ? ['browser_automation', 'browser_sessions']
        : browserbaseWorkflow.kind === 'web_data_retrieval' || browserbaseWorkflow.kind === 'form_submission' || browserbaseWorkflow.requiresStagehand
          ? ['browser_automation', 'browser_sessions']
          : ['browser_automation'],
      browserbaseWorkflow,
    });
  }
  return finalize({
    kind: 'unknown',
    label: 'General computer task',
    detail: 'The task may need browser, file, or app access. The runtime should resolve the best surface after more detail.',
    requiredCapabilities: ['browser_automation', 'app_tools', 'file_search'],
  });
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
