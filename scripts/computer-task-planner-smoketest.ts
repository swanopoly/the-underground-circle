/**
 * computer-task-planner-smoketest — pins the planComputerTaskPreview
 * classifier that decides whether a task is hybrid_task, file_task,
 * browser_task, app_task, or unknown.
 *
 * Run: npm run smoke:computer-task-planner
 *
 * Can't import directly from src/lib/computerTaskPlanner — it drags in
 * supabase (via the decomposeHybridTask export) which transitively pulls
 * in React Native on native builds. Mirror the classifier logic here.
 * Keep in lockstep with the real one (src/lib/computerTaskPlanner.ts).
 */

// ─── Inlined classifier — keep in lockstep with computerTaskPlanner.ts ───────

type ComputerTaskKind =
  | 'browser_task'
  | 'file_task'
  | 'app_task'
  | 'hybrid_task'
  | 'unknown';

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function matchesAny(haystack: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(haystack));
}

function classifyTask(task: string): ComputerTaskKind {
  const text = String(task || '').trim().toLowerCase();
  if (!text) return 'unknown';

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
  if (activeKinds > 1 || multiApp) return 'hybrid_task';
  if (file) return 'file_task';
  if (app) return 'app_task';
  if (browser) return 'browser_task';
  return 'unknown';
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── hybrid_task ──────────────────────────────────────────────────────────
  const hybridCases: string[] = [
    'find a file in my downloads folder and google something',
    'find pdf invoices in downloads then check stripe.com for matching charges',
    'open notes and post to slack',
    'search my desktop and look up the result on github',
  ];
  for (const u of hybridCases) {
    const got = classifyTask(u);
    assert(got === 'hybrid_task', `hybrid_task: "${u}"`, `got ${got}`);
  }

  // ─── file_task ────────────────────────────────────────────────────────────
  const fileCases: string[] = [
    'search files in downloads',
    'search the disk for old logs',
    'find foo.txt in ~/projects',
    "show me what's in my downloads folder",
  ];
  for (const u of fileCases) {
    const got = classifyTask(u);
    assert(got === 'file_task', `file_task: "${u}"`, `got ${got}`);
  }

  // ─── browser_task ─────────────────────────────────────────────────────────
  const browserCases: string[] = [
    'look up the latest typescript docs',
    'google arrigo cdjr dealership',
    'search for the cheapest flights online',
    'open stripe.com',
  ];
  for (const u of browserCases) {
    const got = classifyTask(u);
    assert(got === 'browser_task', `browser_task: "${u}"`, `got ${got}`);
  }

  // ─── app_task ─────────────────────────────────────────────────────────────
  const appCases: string[] = [
    'open notes and create a new note',
    'launch terminal',
    'switch to slack',
  ];
  for (const u of appCases) {
    const got = classifyTask(u);
    assert(got === 'app_task', `app_task: "${u}"`, `got ${got}`);
  }

  // ─── unknown ──────────────────────────────────────────────────────────────
  const unknownCases: string[] = [
    '',
    'hello',
  ];
  for (const u of unknownCases) {
    const got = classifyTask(u);
    assert(got === 'unknown', `unknown: "${u || '(empty)'}"`, `got ${got}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} computer-task-planner smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-task-planner smoke cases passed.');
}

main();
