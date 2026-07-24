/**
 * knownAppShortcuts — when the user asks to "open X app" and we don't
 * have OS-level launch permissions (the `app_tools` capability), we
 * can still be useful by handing back:
 *
 *   1. An **OS URL-scheme deep link** (`zoommtg://`, `slack://`, etc.).
 *      Clicking these fires the registered URL handler on macOS /
 *      Windows — same path Safari or Slack notifications use when
 *      they launch the native app.
 *   2. A **web fallback** (e.g. `https://zoom.us`, `https://app.slack.com`).
 *      Lower fidelity but always works even if the native app isn't
 *      installed.
 *   3. A **keyboard shortcut hint** so the user can still launch it
 *      themselves in < 2 seconds.
 *
 * This file is a pure, zero-dep lookup table. The computer task
 * adapter consumes it when MCP app tools are missing.
 */

export type KnownAppPlatform = 'mac' | 'windows' | 'linux' | 'web';

/**
 * Everyday-task taxonomy for the task→best-app resolver ("edit this photo",
 * "make a budget spreadsheet", "schedule a meeting"). Each category maps to
 * the apps that can fulfil it via `KnownApp.taskCategories`.
 */
export type TaskAppCategory =
  | 'photo_editing'
  | 'image_design'
  | 'vector_design'
  | 'video_editing'
  | 'audio_music'
  | 'spreadsheet'
  | 'document_writing'
  | 'presentation'
  | 'email'
  | 'calendar'
  | 'meetings'
  | 'chat_messaging'
  | 'notes'
  | 'task_management'
  | 'code_editing'
  | 'pdf'
  | 'file_management'
  | 'web_browsing'
  | 'cad_3d'
  | 'data_analysis';

export const TASK_APP_CATEGORIES: TaskAppCategory[] = [
  'photo_editing', 'image_design', 'vector_design', 'video_editing',
  'audio_music', 'spreadsheet', 'document_writing', 'presentation',
  'email', 'calendar', 'meetings', 'chat_messaging', 'notes',
  'task_management', 'code_editing', 'pdf', 'file_management',
  'web_browsing', 'cad_3d', 'data_analysis',
];

export interface KnownApp {
  id: string;                         // stable identifier ('zoom', 'slack', etc.)
  displayName: string;
  category: 'meetings' | 'chat' | 'notes' | 'dev' | 'design' | 'pm' | 'media' | 'other';
  /** Aliases the user might type. Lowercase; `includes` match. */
  aliases: string[];
  /** Deep link the OS will hand to the native app. Platform-agnostic
   *  where available; per-platform overrides when the scheme differs. */
  osUrlScheme?: string;
  /** Per-platform URL overrides (Slack / Teams often differ). */
  osUrlByPlatform?: Partial<Record<KnownAppPlatform, string>>;
  /** Browser fallback. Always non-null. */
  webUrl: string;
  /** Short human note ("Mac: Cmd+Space → Zoom → Enter"). */
  keyboardHint?: Partial<Record<KnownAppPlatform, string>>;
  /**
   * Name `open -a` should use on macOS when it differs from
   * `displayName`. Example: Zoom's bundle is `zoom.us.app`, so
   * `open -a "Zoom"` fails but `open -a "zoom.us"` succeeds. Chat
   * messages still use `displayName` for human readability — this
   * field only affects the shell-out.
   *
   * Version fuzziness: several vendors version-pin the bundle name
   * ("Adobe Photoshop 2026.app", "Autodesk Fusion 360.app" vs the newer
   * "Autodesk Fusion.app"). `open -a` needs the exact registered name, so
   * installed-app matching (`isKnownAppInstalled`) strips trailing
   * year/version tokens and does prefix matching in BOTH directions —
   * never rely on an exact string compare against the probe list.
   */
  macLaunchName?: string;
  /**
   * Everyday-task categories this app can fulfil. Absent/empty = the app
   * is launchable by name but is not a task-resolution candidate
   * (Weather, Tips, Activity Monitor, ...).
   */
  taskCategories?: TaskAppCategory[];
  /**
   * Is `webUrl` a genuinely capable web APP for the task categories?
   * - 'full'    → the web variant can actually do the work (Google Docs,
   *               Photopea, Figma, Excel online, ...)
   * - 'limited' → real web app but materially weaker / paywalled.
   * Absent = the webUrl is a marketing/support page, treated as 'limited'
   * minus — it ranks last and only exists so we always have SOME link.
   */
  webAppQuality?: 'full' | 'limited';
  /**
   * True for web-only products (Photopea, Onshape, Gmail, ...). They never
   * become desktop-launch candidates even when the bridge is online and
   * the installed-app list is unknown.
   */
  webOnly?: boolean;
}

/**
 * Resolve the string passed to `open -a` on macOS. Prefers the
 * explicit `macLaunchName` when present; otherwise falls back to the
 * human display name. Centralised so every call site (bridge launch,
 * auto-chain, diag probe) uses the same resolution.
 */
export function resolveMacLaunchName(app: KnownApp): string {
  return app.macLaunchName || app.displayName;
}

export const KNOWN_APPS: KnownApp[] = [
  {
    id: 'zoom',
    displayName: 'Zoom',
    // macOS installs Zoom as `zoom.us.app`, so `open -a Zoom` returns
    // "Unable to find application named 'Zoom'". Use the real bundle
    // display name when shelling out.
    macLaunchName: 'zoom.us',
    category: 'meetings',
    taskCategories: ['meetings'],
    webAppQuality: 'limited',
    aliases: ['zoom', 'zoom meeting', 'zoom call'],
    osUrlScheme: 'zoommtg://',
    webUrl: 'https://zoom.us',
    keyboardHint: {
      mac: 'Cmd+Space → "Zoom" → Enter',
      windows: 'Win → "Zoom" → Enter',
    },
  },
  {
    id: 'slack',
    displayName: 'Slack',
    category: 'chat',
    taskCategories: ['chat_messaging'],
    webAppQuality: 'full',
    aliases: ['slack'],
    osUrlScheme: 'slack://open',
    webUrl: 'https://app.slack.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Slack" → Enter',
      windows: 'Win → "Slack" → Enter',
    },
  },
  {
    id: 'discord',
    displayName: 'Discord',
    category: 'chat',
    taskCategories: ['chat_messaging'],
    webAppQuality: 'full',
    aliases: ['discord'],
    osUrlScheme: 'discord://',
    webUrl: 'https://discord.com/app',
    keyboardHint: {
      mac: 'Cmd+Space → "Discord" → Enter',
      windows: 'Win → "Discord" → Enter',
    },
  },
  {
    id: 'teams',
    displayName: 'Microsoft Teams',
    category: 'chat',
    taskCategories: ['meetings', 'chat_messaging'],
    webAppQuality: 'full',
    aliases: ['teams', 'microsoft teams', 'ms teams'],
    osUrlScheme: 'msteams://',
    webUrl: 'https://teams.microsoft.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Teams" → Enter',
      windows: 'Win → "Teams" → Enter',
    },
  },
  {
    id: 'notion',
    displayName: 'Notion',
    category: 'notes',
    taskCategories: ['notes', 'task_management'],
    webAppQuality: 'full',
    aliases: ['notion'],
    osUrlScheme: 'notion://',
    webUrl: 'https://www.notion.so',
    keyboardHint: {
      mac: 'Cmd+Space → "Notion" → Enter',
      windows: 'Win → "Notion" → Enter',
    },
  },
  {
    id: 'linear',
    displayName: 'Linear',
    category: 'pm',
    taskCategories: ['task_management'],
    webAppQuality: 'full',
    aliases: ['linear'],
    osUrlScheme: 'linear://',
    webUrl: 'https://linear.app',
    keyboardHint: {
      mac: 'Cmd+Space → "Linear" → Enter',
      windows: 'Win → "Linear" → Enter',
    },
  },
  {
    id: 'figma',
    displayName: 'Figma',
    category: 'design',
    taskCategories: ['image_design', 'vector_design'],
    webAppQuality: 'full',
    aliases: ['figma'],
    osUrlScheme: 'figma://',
    webUrl: 'https://www.figma.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Figma" → Enter',
      windows: 'Win → "Figma" → Enter',
    },
  },
  {
    id: 'vscode',
    displayName: 'VS Code',
    // Bundle is "Visual Studio Code.app" — `open -a "VS Code"` fails.
    macLaunchName: 'Visual Studio Code',
    category: 'dev',
    taskCategories: ['code_editing'],
    webAppQuality: 'limited',
    aliases: ['vscode', 'vs code', 'visual studio code', 'code editor'],
    osUrlScheme: 'vscode://',
    webUrl: 'https://vscode.dev',
    keyboardHint: {
      mac: 'Cmd+Space → "Visual Studio Code" → Enter',
      windows: 'Win → "Code" → Enter',
    },
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    category: 'dev',
    taskCategories: ['code_editing'],
    aliases: ['cursor'],
    osUrlScheme: 'cursor://',
    webUrl: 'https://www.cursor.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Cursor" → Enter',
      windows: 'Win → "Cursor" → Enter',
    },
  },
  {
    id: 'spotify',
    displayName: 'Spotify',
    category: 'media',
    // "music" alone ambiguates with Apple Music; require the brand
    // name (or "spotify music") so "open music" correctly resolves
    // to the Apple Music entry.
    aliases: ['spotify', 'spotify music'],
    osUrlScheme: 'spotify:',
    webUrl: 'https://open.spotify.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Spotify" → Enter',
      windows: 'Win → "Spotify" → Enter',
    },
  },
  {
    id: 'github-desktop',
    displayName: 'GitHub Desktop',
    category: 'dev',
    aliases: ['github desktop'],
    osUrlScheme: 'x-github-client://',
    webUrl: 'https://github.com',
    keyboardHint: {
      mac: 'Cmd+Space → "GitHub Desktop" → Enter',
      windows: 'Win → "GitHub Desktop" → Enter',
    },
  },
  {
    id: 'mail',
    displayName: 'Mail',
    category: 'other',
    taskCategories: ['email'],
    // Web fallback is Gmail — genuinely full email on the web.
    webAppQuality: 'full',
    aliases: ['mail', 'email', 'apple mail'],
    osUrlByPlatform: { mac: 'message:', windows: 'mailto:' },
    webUrl: 'https://mail.google.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Mail" → Enter',
      windows: 'Win → "Mail" → Enter',
    },
  },
  {
    id: 'calendar',
    displayName: 'Calendar',
    category: 'other',
    taskCategories: ['calendar'],
    // Web fallback is Google Calendar — fully capable.
    webAppQuality: 'full',
    aliases: ['calendar', 'cal'],
    osUrlByPlatform: { mac: 'ical://' },
    webUrl: 'https://calendar.google.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Calendar" → Enter',
      windows: 'Win → "Calendar" → Enter',
    },
  },
  // ─── Built-in Apple apps ─────────────────────────────────────────
  // These live in /System/Applications/ and are reachable via
  // `open -a Notes` / `open -a Reminders` etc. Bundle names match the
  // displayName so no `macLaunchName` override is needed.
  {
    id: 'apple-notes',
    displayName: 'Notes',
    category: 'notes',
    taskCategories: ['notes'],
    webAppQuality: 'limited',
    // Keep alias ordering specific-first so "open apple notes" doesn't
    // lose to a shorter match.
    aliases: ['apple notes', 'notes app', 'notes', 'apple note'],
    osUrlByPlatform: { mac: 'notes://' },
    webUrl: 'https://www.icloud.com/notes',
    keyboardHint: {
      mac: 'Cmd+Space → "Notes" → Enter',
    },
  },
  {
    id: 'reminders',
    displayName: 'Reminders',
    category: 'other',
    taskCategories: ['task_management'],
    webAppQuality: 'limited',
    aliases: ['reminders', 'reminder', 'apple reminders'],
    osUrlByPlatform: { mac: 'x-apple-reminderkit://' },
    webUrl: 'https://www.icloud.com/reminders',
    keyboardHint: {
      mac: 'Cmd+Space → "Reminders" → Enter',
    },
  },
  {
    id: 'messages',
    displayName: 'Messages',
    category: 'chat',
    taskCategories: ['chat_messaging'],
    webAppQuality: 'limited',
    aliases: ['messages', 'imessage', 'apple messages', 'texts'],
    osUrlByPlatform: { mac: 'messages://' },
    webUrl: 'https://www.icloud.com/messages',
    keyboardHint: {
      mac: 'Cmd+Space → "Messages" → Enter',
    },
  },
  {
    id: 'photos',
    displayName: 'Photos',
    category: 'media',
    taskCategories: ['photo_editing'],
    webAppQuality: 'limited',
    aliases: ['photos', 'apple photos', 'photo library'],
    osUrlByPlatform: { mac: 'photos://' },
    webUrl: 'https://www.icloud.com/photos',
    keyboardHint: { mac: 'Cmd+Space → "Photos" → Enter' },
  },
  {
    id: 'music',
    displayName: 'Music',
    category: 'media',
    aliases: ['music', 'apple music', 'itunes'],
    osUrlByPlatform: { mac: 'music://' },
    webUrl: 'https://music.apple.com',
    keyboardHint: { mac: 'Cmd+Space → "Music" → Enter' },
  },
  {
    id: 'maps',
    displayName: 'Maps',
    category: 'other',
    aliases: ['maps', 'apple maps'],
    osUrlByPlatform: { mac: 'maps://' },
    webUrl: 'https://maps.apple.com',
    keyboardHint: { mac: 'Cmd+Space → "Maps" → Enter' },
  },
  {
    id: 'facetime',
    displayName: 'FaceTime',
    category: 'meetings',
    taskCategories: ['meetings'],
    webAppQuality: 'limited',
    aliases: ['facetime', 'face time'],
    osUrlByPlatform: { mac: 'facetime://' },
    webUrl: 'https://facetime.apple.com',
    keyboardHint: { mac: 'Cmd+Space → "FaceTime" → Enter' },
  },
  {
    id: 'podcasts',
    displayName: 'Podcasts',
    category: 'media',
    aliases: ['podcasts', 'apple podcasts'],
    osUrlByPlatform: { mac: 'podcasts://' },
    webUrl: 'https://podcasts.apple.com',
    keyboardHint: { mac: 'Cmd+Space → "Podcasts" → Enter' },
  },
  {
    id: 'find-my',
    displayName: 'Find My',
    category: 'other',
    aliases: ['find my', 'findmy', 'find my iphone', 'find my mac'],
    webUrl: 'https://www.icloud.com/find',
    keyboardHint: { mac: 'Cmd+Space → "Find My" → Enter' },
  },
  {
    id: 'app-store',
    displayName: 'App Store',
    category: 'other',
    aliases: ['app store', 'appstore', 'mac app store'],
    osUrlByPlatform: { mac: 'macappstore://' },
    webUrl: 'https://apps.apple.com',
    keyboardHint: { mac: 'Cmd+Space → "App Store" → Enter' },
  },
  {
    id: 'chrome',
    displayName: 'Chrome',
    category: 'other',
    taskCategories: ['web_browsing'],
    aliases: ['chrome', 'google chrome'],
    osUrlByPlatform: { mac: 'googlechrome://' },
    webUrl: 'https://www.google.com',
    keyboardHint: {
      mac: 'Cmd+Space → "Chrome" → Enter',
      windows: 'Win → "Chrome" → Enter',
    },
  },
  // ─── macOS built-ins & dev tools (no URL schemes — bridge-only) ──────
  // These have no OS URL handler but launch cleanly via `open -a`, which
  // is what the Claude Code desktop bridge uses. `webUrl` is a fallback
  // only for users without the bridge running.
  {
    id: 'terminal',
    displayName: 'Terminal',
    category: 'dev',
    aliases: ['terminal', 'mac terminal', 'cli', 'shell'],
    webUrl: 'https://support.apple.com/guide/terminal/',
    keyboardHint: { mac: 'Cmd+Space → "Terminal" → Enter' },
  },
  {
    id: 'iterm',
    displayName: 'iTerm',
    category: 'dev',
    aliases: ['iterm', 'iterm2'],
    webUrl: 'https://iterm2.com',
    keyboardHint: { mac: 'Cmd+Space → "iTerm" → Enter' },
  },
  {
    id: 'finder',
    displayName: 'Finder',
    category: 'other',
    taskCategories: ['file_management'],
    aliases: ['finder', 'files', 'mac finder'],
    webUrl: 'https://support.apple.com/finder',
    keyboardHint: { mac: 'Cmd+Option+Space (search for files) or click Finder in Dock' },
  },
  {
    id: 'safari',
    displayName: 'Safari',
    category: 'other',
    taskCategories: ['web_browsing'],
    aliases: ['safari'],
    webUrl: 'https://www.apple.com/safari',
    keyboardHint: { mac: 'Cmd+Space → "Safari" → Enter' },
  },
  {
    id: 'preview',
    displayName: 'Preview',
    category: 'other',
    taskCategories: ['pdf', 'photo_editing'],
    aliases: ['preview', 'apple preview'],
    webUrl: 'https://support.apple.com/guide/preview/',
    keyboardHint: { mac: 'Cmd+Space → "Preview" → Enter' },
  },
  {
    id: 'calculator',
    displayName: 'Calculator',
    category: 'other',
    aliases: ['calculator', 'calc'],
    webUrl: 'https://www.google.com/search?q=calculator',
    keyboardHint: { mac: 'Cmd+Space → "Calculator" → Enter' },
  },
  {
    id: 'system-settings',
    displayName: 'System Settings',
    category: 'other',
    aliases: ['system settings', 'system preferences', 'settings', 'preferences'],
    webUrl: 'https://support.apple.com/guide/mac-help/change-system-preferences-mh15217/mac',
    keyboardHint: { mac: 'Cmd+Space → "System Settings" → Enter' },
  },
  {
    id: 'activity-monitor',
    displayName: 'Activity Monitor',
    category: 'other',
    aliases: ['activity monitor', 'task manager', 'process viewer'],
    webUrl: 'https://support.apple.com/guide/activity-monitor/',
    keyboardHint: { mac: 'Cmd+Space → "Activity Monitor" → Enter' },
  },
  {
    id: 'xcode',
    displayName: 'Xcode',
    category: 'dev',
    taskCategories: ['code_editing'],
    aliases: ['xcode'],
    webUrl: 'https://developer.apple.com/xcode/',
    keyboardHint: { mac: 'Cmd+Space → "Xcode" → Enter' },
  },
  {
    id: 'textedit',
    displayName: 'TextEdit',
    category: 'notes',
    taskCategories: ['document_writing'],
    aliases: ['textedit', 'text edit'],
    webUrl: 'https://support.apple.com/guide/textedit/',
    keyboardHint: { mac: 'Cmd+Space → "TextEdit" → Enter' },
  },
  // Claude Code is a CLI — not a .app. But when the user says "open
  // Claude Code", the best resolution is: launch Terminal + tell the
  // agent to type `claude`. We register it as an alias of Terminal so
  // `matchKnownApp('open claude code')` returns Terminal.
  {
    id: 'terminal-claude',
    displayName: 'Terminal',
    category: 'dev',
    aliases: ['claude code', 'claude cli', 'claude-code', 'cc'],
    webUrl: 'https://claude.com/code',
    keyboardHint: { mac: 'Cmd+Space → "Terminal" → Enter, then type: claude' },
  },

  // ─── More Apple built-ins (installed on every recent macOS) ──────
  { id: 'contacts',   displayName: 'Contacts',   category: 'other',  aliases: ['contacts', 'address book'], osUrlByPlatform: { mac: 'addressbook:' }, webUrl: 'https://www.icloud.com/contacts', keyboardHint: { mac: 'Cmd+Space → "Contacts" → Enter' } },
  { id: 'weather',    displayName: 'Weather',    category: 'other',  aliases: ['weather', 'forecast'],      webUrl: 'https://weather.apple.com', keyboardHint: { mac: 'Cmd+Space → "Weather" → Enter' } },
  { id: 'stocks',     displayName: 'Stocks',     category: 'other',  aliases: ['stocks', 'stock market', 'market'], webUrl: 'https://www.apple.com/apple-news/', keyboardHint: { mac: 'Cmd+Space → "Stocks" → Enter' } },
  { id: 'home',       displayName: 'Home',       category: 'other',  aliases: ['home', 'homekit', 'home app'], webUrl: 'https://www.icloud.com/home', keyboardHint: { mac: 'Cmd+Space → "Home" → Enter' } },
  { id: 'books',      displayName: 'Books',      category: 'media',  aliases: ['books', 'apple books', 'ibooks'], osUrlByPlatform: { mac: 'ibooks:' }, webUrl: 'https://books.apple.com', keyboardHint: { mac: 'Cmd+Space → "Books" → Enter' } },
  { id: 'clock',      displayName: 'Clock',      category: 'other',  aliases: ['clock', 'alarm', 'timer'], webUrl: 'https://support.apple.com/guide/clock/', keyboardHint: { mac: 'Cmd+Space → "Clock" → Enter' } },
  { id: 'shortcuts',  displayName: 'Shortcuts',  category: 'dev',    aliases: ['shortcuts', 'apple shortcuts', 'automation'], osUrlByPlatform: { mac: 'shortcuts:' }, webUrl: 'https://support.apple.com/guide/shortcuts-mac/', keyboardHint: { mac: 'Cmd+Space → "Shortcuts" → Enter' } },
  { id: 'freeform',   displayName: 'Freeform',   category: 'notes',  aliases: ['freeform', 'whiteboard', 'apple freeform'], webUrl: 'https://www.apple.com/freeform/', keyboardHint: { mac: 'Cmd+Space → "Freeform" → Enter' } },
  { id: 'journal',    displayName: 'Journal',    category: 'notes',  aliases: ['journal', 'apple journal'], webUrl: 'https://support.apple.com/guide/journal/', keyboardHint: { mac: 'Cmd+Space → "Journal" → Enter' } },
  { id: 'passwords',  displayName: 'Passwords',  category: 'other',  aliases: ['passwords', 'apple passwords', 'keychain'], webUrl: 'https://support.apple.com/guide/passwords/', keyboardHint: { mac: 'Cmd+Space → "Passwords" → Enter' } },
  { id: 'phone',      displayName: 'Phone',      category: 'meetings', aliases: ['phone', 'apple phone'], osUrlByPlatform: { mac: 'tel:' }, webUrl: 'https://support.apple.com/guide/iphone/', keyboardHint: { mac: 'Cmd+Space → "Phone" → Enter' } },
  { id: 'tv',         displayName: 'TV',         category: 'media',  aliases: ['tv', 'apple tv', 'tv app'], osUrlByPlatform: { mac: 'videos:' }, webUrl: 'https://tv.apple.com', keyboardHint: { mac: 'Cmd+Space → "TV" → Enter' } },
  { id: 'news',       displayName: 'News',       category: 'other',  aliases: ['news', 'apple news'], webUrl: 'https://www.apple.com/apple-news/', keyboardHint: { mac: 'Cmd+Space → "News" → Enter' } },
  { id: 'tips',       displayName: 'Tips',       category: 'other',  aliases: ['tips', 'apple tips'], webUrl: 'https://support.apple.com', keyboardHint: { mac: 'Cmd+Space → "Tips" → Enter' } },
  { id: 'image-capture', displayName: 'Image Capture', category: 'media', aliases: ['image capture', 'scan', 'scanner'], webUrl: 'https://support.apple.com/guide/image-capture/', keyboardHint: { mac: 'Cmd+Space → "Image Capture" → Enter' } },
  { id: 'image-playground', displayName: 'Image Playground', category: 'media', aliases: ['image playground', 'imageplayground', 'ai image'], webUrl: 'https://www.apple.com/apple-intelligence/', keyboardHint: { mac: 'Cmd+Space → "Image Playground" → Enter' } },
  { id: 'voice-memos', displayName: 'VoiceMemos', category: 'media', aliases: ['voice memos', 'voicememos', 'voice recorder', 'audio recorder'], webUrl: 'https://support.apple.com/voice-memos/', keyboardHint: { mac: 'Cmd+Space → "VoiceMemos" → Enter' } },
  { id: 'stickies',   displayName: 'Stickies',   category: 'notes',  taskCategories: ['notes'], aliases: ['stickies', 'sticky notes'], webUrl: 'https://support.apple.com/guide/stickies/', keyboardHint: { mac: 'Cmd+Space → "Stickies" → Enter' } },
  { id: 'chess',      displayName: 'Chess',      category: 'other',  aliases: ['chess', 'apple chess'], webUrl: 'https://en.wikipedia.org/wiki/Chess_(application)', keyboardHint: { mac: 'Cmd+Space → "Chess" → Enter' } },
  { id: 'quicktime',  displayName: 'QuickTime Player', category: 'media', aliases: ['quicktime', 'quicktime player', 'qt', 'screen record', 'screen recording'], webUrl: 'https://support.apple.com/downloads/quicktime', keyboardHint: { mac: 'Cmd+Space → "QuickTime" → Enter' } },
  { id: 'photo-booth', displayName: 'Photo Booth', category: 'media', aliases: ['photo booth', 'photobooth'], webUrl: 'https://support.apple.com/guide/photo-booth/', keyboardHint: { mac: 'Cmd+Space → "Photo Booth" → Enter' } },
  { id: 'font-book',  displayName: 'Font Book',  category: 'design', aliases: ['font book', 'fonts', 'fontbook'], webUrl: 'https://support.apple.com/guide/font-book/', keyboardHint: { mac: 'Cmd+Space → "Font Book" → Enter' } },
  { id: 'dictionary', displayName: 'Dictionary', category: 'other',  aliases: ['dictionary', 'thesaurus', 'lookup'], webUrl: 'https://support.apple.com/guide/dictionary/', keyboardHint: { mac: 'Cmd+Space → "Dictionary" → Enter' } },
  { id: 'clock-app',  displayName: 'Apps',       category: 'other',  aliases: ['apps', 'app library'], webUrl: 'https://apps.apple.com', keyboardHint: { mac: 'Cmd+Space → "Apps" → Enter' } },
  { id: 'games-app',  displayName: 'Games',      category: 'media',  aliases: ['games app', 'apple games'], webUrl: 'https://apps.apple.com/genre/mac-games/', keyboardHint: { mac: 'Cmd+Space → "Games" → Enter' } },
  { id: 'mission-control', displayName: 'Mission Control', category: 'other', aliases: ['mission control', 'exposé'], webUrl: 'https://support.apple.com/guide/mac-help/mission-control/', keyboardHint: { mac: 'F3 or 3-finger swipe up' } },
  { id: 'screenshot', displayName: 'Screenshot', category: 'other',  aliases: ['screenshot app', 'screenshot utility', 'screen capture', 'snip'], webUrl: 'https://support.apple.com/guide/mac-help/take-screenshots/', keyboardHint: { mac: 'Cmd+Shift+5' } },
  { id: 'iphone-mirroring', displayName: 'iPhone Mirroring', category: 'other', aliases: ['iphone mirroring', 'iphone mirror', 'mirror iphone'], webUrl: 'https://support.apple.com/guide/iphone-mirroring/', keyboardHint: { mac: 'Cmd+Space → "iPhone Mirroring" → Enter' } },
  { id: 'developer',  displayName: 'Developer',  category: 'dev',    aliases: ['developer', 'apple developer'], webUrl: 'https://developer.apple.com', keyboardHint: { mac: 'Cmd+Space → "Developer" → Enter' } },
  { id: 'magnifier',  displayName: 'Magnifier',  category: 'other',  aliases: ['magnifier', 'zoom in', 'loupe'], webUrl: 'https://support.apple.com/guide/mac-help/use-magnifier/', keyboardHint: { mac: 'Cmd+Space → "Magnifier" → Enter' } },
  { id: 'script-editor', displayName: 'Script Editor', category: 'dev', aliases: ['script editor', 'applescript editor'], webUrl: 'https://support.apple.com/guide/script-editor/', keyboardHint: { mac: 'Cmd+Space → "Script Editor" → Enter' } },
  { id: 'automator',  displayName: 'Automator',  category: 'dev',    aliases: ['automator'], webUrl: 'https://support.apple.com/guide/automator/', keyboardHint: { mac: 'Cmd+Space → "Automator" → Enter' } },
  { id: 'grapher',    displayName: 'Grapher',    category: 'other',  aliases: ['grapher', 'graph calculator', 'equation grapher'], webUrl: 'https://support.apple.com/guide/grapher/', keyboardHint: { mac: 'Cmd+Space → "Grapher" → Enter' } },
  { id: 'siri',       displayName: 'Siri',       category: 'other',  aliases: ['siri', 'voice assistant'], webUrl: 'https://www.apple.com/siri/', keyboardHint: { mac: 'Hold Cmd+Space or say "Hey Siri"' } },

  // ─── System utilities ─────────────────────────────────────────────
  { id: 'console',          displayName: 'Console',          category: 'dev',   aliases: ['console', 'system console', 'syslog', 'logs'], webUrl: 'https://support.apple.com/guide/console/', keyboardHint: { mac: 'Cmd+Space → "Console" → Enter' } },
  { id: 'disk-utility',     displayName: 'Disk Utility',     category: 'dev',   aliases: ['disk utility', 'disk manager', 'format disk'], webUrl: 'https://support.apple.com/guide/disk-utility/', keyboardHint: { mac: 'Cmd+Space → "Disk Utility" → Enter' } },
  { id: 'system-info',      displayName: 'System Information', category: 'dev', aliases: ['system information', 'system info', 'about this mac'], webUrl: 'https://support.apple.com/guide/mac-help/system-information/', keyboardHint: { mac: 'Cmd+Space → "System Information" → Enter' } },
  { id: 'time-machine',     displayName: 'Time Machine',     category: 'other', aliases: ['time machine', 'backup'], webUrl: 'https://support.apple.com/guide/mac-help/back-up-your-mac/', keyboardHint: { mac: 'Cmd+Space → "Time Machine" → Enter' } },
  { id: 'audio-midi',       displayName: 'Audio MIDI Setup', category: 'media', aliases: ['audio midi setup', 'audio midi', 'midi setup', 'audio devices'], webUrl: 'https://support.apple.com/guide/audio-midi-setup/', keyboardHint: { mac: 'Cmd+Space → "Audio MIDI Setup" → Enter' } },
  { id: 'colorsync',        displayName: 'ColorSync Utility', category: 'design', aliases: ['colorsync', 'color sync', 'color profile', 'color management'], webUrl: 'https://support.apple.com/guide/colorsync-utility/', keyboardHint: { mac: 'Cmd+Space → "ColorSync" → Enter' } },
  { id: 'digital-color-meter', displayName: 'Digital Color Meter', category: 'design', aliases: ['digital color meter', 'color meter', 'color picker'], webUrl: 'https://support.apple.com/guide/digital-color-meter/', keyboardHint: { mac: 'Cmd+Space → "Digital Color Meter" → Enter' } },
  { id: 'bluetooth-file',   displayName: 'Bluetooth File Exchange', category: 'other', aliases: ['bluetooth file exchange', 'bluetooth transfer', 'bluetooth share'], webUrl: 'https://support.apple.com/guide/mac-help/send-receive-files-bluetooth/', keyboardHint: { mac: 'Cmd+Space → "Bluetooth File Exchange" → Enter' } },
  { id: 'airport-utility',  displayName: 'AirPort Utility',  category: 'dev',   aliases: ['airport utility', 'airport', 'wifi utility'], webUrl: 'https://support.apple.com/guide/airport-utility/', keyboardHint: { mac: 'Cmd+Space → "AirPort Utility" → Enter' } },
  { id: 'boot-camp',        displayName: 'Boot Camp Assistant', category: 'dev', aliases: ['boot camp', 'bootcamp', 'windows install'], webUrl: 'https://support.apple.com/guide/bootcamp-assistant/', keyboardHint: { mac: 'Cmd+Space → "Boot Camp" → Enter' } },
  { id: 'migration',        displayName: 'Migration Assistant', category: 'dev', aliases: ['migration assistant', 'migrate mac', 'transfer data'], webUrl: 'https://support.apple.com/en-us/HT204350', keyboardHint: { mac: 'Cmd+Space → "Migration Assistant" → Enter' } },
  { id: 'voiceover',        displayName: 'VoiceOver Utility', category: 'other', aliases: ['voiceover', 'voice over', 'screen reader'], webUrl: 'https://support.apple.com/voiceover/', keyboardHint: { mac: 'Cmd+F5 to toggle VoiceOver' } },
  { id: 'screen-sharing',   displayName: 'Screen Sharing',   category: 'other', aliases: ['screen sharing', 'screen share', 'remote desktop', 'vnc'], webUrl: 'https://support.apple.com/guide/mac-help/share-screens/', keyboardHint: { mac: 'Cmd+Space → "Screen Sharing" → Enter' } },
  { id: 'print-center',     displayName: 'Print Center',     category: 'other', aliases: ['print center', 'printer', 'printers'], webUrl: 'https://support.apple.com/guide/mac-help/print-center/', keyboardHint: { mac: 'Cmd+Space → "Print Center" → Enter' } },

  // ─── Productivity (iWork + Microsoft + Google) ────────────────────
  { id: 'pages',     displayName: 'Pages',     category: 'notes', taskCategories: ['document_writing'], webAppQuality: 'limited', aliases: ['pages', 'apple pages', 'iwork pages'], osUrlByPlatform: { mac: 'pages-app:' }, webUrl: 'https://www.icloud.com/pages', keyboardHint: { mac: 'Cmd+Space → "Pages" → Enter' } },
  { id: 'numbers',   displayName: 'Numbers',   category: 'notes', taskCategories: ['spreadsheet', 'data_analysis'], webAppQuality: 'limited', aliases: ['numbers', 'apple numbers', 'iwork numbers', 'spreadsheet'], osUrlByPlatform: { mac: 'numbers-app:' }, webUrl: 'https://www.icloud.com/numbers', keyboardHint: { mac: 'Cmd+Space → "Numbers" → Enter' } },
  { id: 'keynote',   displayName: 'Keynote',   category: 'design', taskCategories: ['presentation'], webAppQuality: 'limited', aliases: ['keynote', 'apple keynote', 'iwork keynote', 'presentation'], osUrlByPlatform: { mac: 'keynote-app:' }, webUrl: 'https://www.icloud.com/keynote', keyboardHint: { mac: 'Cmd+Space → "Keynote" → Enter' } },
  { id: 'imovie',    displayName: 'iMovie',    category: 'media', taskCategories: ['video_editing'], aliases: ['imovie', 'movie editor'], webUrl: 'https://www.apple.com/imovie/', keyboardHint: { mac: 'Cmd+Space → "iMovie" → Enter' } },
  { id: 'garageband', displayName: 'GarageBand', category: 'media', taskCategories: ['audio_music'], aliases: ['garageband', 'garage band', 'music studio'], webUrl: 'https://www.apple.com/mac/garageband/', keyboardHint: { mac: 'Cmd+Space → "GarageBand" → Enter' } },
  { id: 'onenote',   displayName: 'Microsoft OneNote', category: 'notes', taskCategories: ['notes'], webAppQuality: 'full', aliases: ['onenote', 'one note', 'microsoft onenote'], osUrlByPlatform: { mac: 'onenote:' }, webUrl: 'https://www.onenote.com', keyboardHint: { mac: 'Cmd+Space → "OneNote" → Enter' } },
  { id: 'google-docs', displayName: 'Google Docs', category: 'notes', taskCategories: ['document_writing'], webAppQuality: 'full', webOnly: true, aliases: ['google docs', 'gdocs', 'docs'], webUrl: 'https://docs.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Docs" → Enter' } },
  { id: 'google-sheets', displayName: 'Google Sheets', category: 'notes', taskCategories: ['spreadsheet', 'data_analysis'], webAppQuality: 'full', webOnly: true, aliases: ['google sheets', 'gsheets', 'sheets', 'spreadsheet google'], webUrl: 'https://sheets.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Sheets" → Enter' } },
  { id: 'google-slides', displayName: 'Google Slides', category: 'design', taskCategories: ['presentation'], webAppQuality: 'full', webOnly: true, aliases: ['google slides', 'gslides', 'slides'], webUrl: 'https://slides.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Slides" → Enter' } },
  { id: 'google-drive', displayName: 'Google Drive', category: 'other', taskCategories: ['file_management'], webAppQuality: 'full', aliases: ['google drive', 'gdrive', 'drive'], webUrl: 'https://drive.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Drive" → Enter' } },

  // ─── Notes / knowledge ───────────────────────────────────────────
  { id: 'obsidian',  displayName: 'Obsidian',  category: 'notes', taskCategories: ['notes'], aliases: ['obsidian', 'obsidian vault'], osUrlByPlatform: { mac: 'obsidian:' }, webUrl: 'https://obsidian.md', keyboardHint: { mac: 'Cmd+Space → "Obsidian" → Enter' } },
  { id: 'evernote',  displayName: 'Evernote',  category: 'notes', taskCategories: ['notes'], webAppQuality: 'full', aliases: ['evernote'], osUrlByPlatform: { mac: 'evernote:' }, webUrl: 'https://www.evernote.com', keyboardHint: { mac: 'Cmd+Space → "Evernote" → Enter' } },

  // ─── AI / dev tools ──────────────────────────────────────────────
  { id: 'chatgpt',    displayName: 'ChatGPT',    category: 'dev',  aliases: ['chatgpt', 'chat gpt', 'gpt', 'openai'], osUrlByPlatform: { mac: 'chatgpt:' }, webUrl: 'https://chat.openai.com', keyboardHint: { mac: 'Cmd+Space → "ChatGPT" → Enter' } },
  { id: 'copilot',    displayName: 'Copilot',    category: 'dev',  aliases: ['copilot', 'microsoft copilot', 'ms copilot'], webUrl: 'https://copilot.microsoft.com', keyboardHint: { mac: 'Cmd+Space → "Copilot" → Enter' } },
  { id: 'comet',      displayName: 'Comet',      category: 'dev',  aliases: ['comet', 'perplexity comet', 'comet browser'], webUrl: 'https://comet.perplexity.ai', keyboardHint: { mac: 'Cmd+Space → "Comet" → Enter' } },
  { id: 'codellm',    displayName: 'CodeLLM',    category: 'dev',  aliases: ['codellm', 'code llm'], webUrl: 'https://codellm.abacus.ai', keyboardHint: { mac: 'Cmd+Space → "CodeLLM" → Enter' } },
  { id: 'codex-bar',  displayName: 'CodexBar',   category: 'dev',  aliases: ['codexbar', 'codex bar', 'codex'], webUrl: 'https://github.com/openai/codex', keyboardHint: { mac: 'Cmd+Space → "CodexBar" → Enter' } },
  { id: 'deepagent',  displayName: 'DeepAgent',  category: 'dev',  aliases: ['deepagent', 'deep agent'], webUrl: 'https://deepagent.abacus.ai', keyboardHint: { mac: 'Cmd+Space → "DeepAgent" → Enter' } },
  { id: 'ollama',     displayName: 'Ollama',     category: 'dev',  aliases: ['ollama', 'local llm'], webUrl: 'https://ollama.com', keyboardHint: { mac: 'Cmd+Space → "Ollama" → Enter' } },
  { id: 'docker',     displayName: 'Docker',     category: 'dev',  aliases: ['docker', 'docker desktop', 'containers'], osUrlByPlatform: { mac: 'docker-desktop:' }, webUrl: 'https://www.docker.com', keyboardHint: { mac: 'Cmd+Space → "Docker" → Enter' } },
  { id: 'unity-hub',  displayName: 'Unity Hub',  category: 'dev',  aliases: ['unity hub', 'unity', 'unity3d'], webUrl: 'https://unity.com', keyboardHint: { mac: 'Cmd+Space → "Unity Hub" → Enter' } },

  // ─── Gaming ──────────────────────────────────────────────────────
  { id: 'epic-games', displayName: 'Epic Games Launcher', category: 'media', aliases: ['epic games', 'epic games launcher', 'epic launcher', 'epic'], webUrl: 'https://store.epicgames.com', keyboardHint: { mac: 'Cmd+Space → "Epic Games" → Enter' } },
  { id: 'insta360',   displayName: 'Insta360 Studio',     category: 'media', aliases: ['insta360', 'insta360 studio', '360 video'], webUrl: 'https://www.insta360.com', keyboardHint: { mac: 'Cmd+Space → "Insta360" → Enter' } },

  // ─── Adobe Creative Cloud ────────────────────────────────────────
  // `open -a` resolves to the latest installed version of each app
  // by default when multiple versions are present. Using macLaunchName
  // pins to the 2026 release on this machine; for other installs just
  // the display-name alias is sufficient.
  { id: 'adobe-cc',          displayName: 'Adobe Creative Cloud', category: 'design', aliases: ['adobe creative cloud', 'creative cloud', 'adobe cc'], webUrl: 'https://www.adobe.com/creativecloud.html', keyboardHint: { mac: 'Cmd+Space → "Adobe Creative Cloud" → Enter' } },
  { id: 'adobe-acrobat',     displayName: 'Adobe Acrobat DC',     category: 'notes',  taskCategories: ['pdf'], webAppQuality: 'full', aliases: ['adobe acrobat', 'acrobat', 'acrobat dc', 'pdf reader', 'pdf editor'], webUrl: 'https://acrobat.adobe.com', keyboardHint: { mac: 'Cmd+Space → "Acrobat" → Enter' } },
  { id: 'adobe-photoshop',   displayName: 'Adobe Photoshop 2026', macLaunchName: 'Adobe Photoshop 2026', category: 'design', taskCategories: ['photo_editing', 'image_design'], webAppQuality: 'limited', aliases: ['photoshop', 'ps', 'adobe photoshop'], webUrl: 'https://photoshop.adobe.com', keyboardHint: { mac: 'Cmd+Space → "Photoshop" → Enter' } },
  { id: 'adobe-illustrator', displayName: 'Adobe Illustrator 2026', macLaunchName: 'Adobe Illustrator 2026', category: 'design', taskCategories: ['vector_design'], aliases: ['illustrator', 'ai', 'adobe illustrator'], webUrl: 'https://www.adobe.com/products/illustrator.html', keyboardHint: { mac: 'Cmd+Space → "Illustrator" → Enter' } },
  { id: 'adobe-indesign',    displayName: 'Adobe InDesign 2026', macLaunchName: 'Adobe InDesign 2026', category: 'design', taskCategories: ['image_design'], aliases: ['indesign', 'adobe indesign'], webUrl: 'https://www.adobe.com/products/indesign.html', keyboardHint: { mac: 'Cmd+Space → "InDesign" → Enter' } },
  { id: 'adobe-premiere',    displayName: 'Adobe Premiere Pro 2026', macLaunchName: 'Adobe Premiere Pro 2026', category: 'media', taskCategories: ['video_editing'], aliases: ['premiere', 'premiere pro', 'adobe premiere'], webUrl: 'https://www.adobe.com/products/premiere.html', keyboardHint: { mac: 'Cmd+Space → "Premiere Pro" → Enter' } },
  { id: 'adobe-after-effects', displayName: 'Adobe After Effects 2026', macLaunchName: 'Adobe After Effects 2026', category: 'media', taskCategories: ['video_editing'], aliases: ['after effects', 'ae', 'adobe after effects'], webUrl: 'https://www.adobe.com/products/aftereffects.html', keyboardHint: { mac: 'Cmd+Space → "After Effects" → Enter' } },
  { id: 'adobe-media-encoder', displayName: 'Adobe Media Encoder 2026', macLaunchName: 'Adobe Media Encoder 2026', category: 'media', aliases: ['media encoder', 'adobe media encoder', 'ame'], webUrl: 'https://www.adobe.com/products/media-encoder.html', keyboardHint: { mac: 'Cmd+Space → "Media Encoder" → Enter' } },

  // ─── Task-resolution gap fillers (task → best app coverage) ───────
  // Every TaskAppCategory should have ≥1 desktop and ≥1 capable web
  // option where one exists. macLaunchName values follow `open -a`
  // conventions; version-pinned bundles (Adobe, Fusion) rely on the
  // fuzzy prefix matching in `isKnownAppInstalled` — see the KnownApp
  // doc comment.
  { id: 'photopea', displayName: 'Photopea', category: 'design', taskCategories: ['photo_editing', 'image_design'], webAppQuality: 'full', webOnly: true, aliases: ['photopea'], webUrl: 'https://www.photopea.com' },
  { id: 'gimp', displayName: 'GIMP', macLaunchName: 'GIMP', category: 'design', taskCategories: ['photo_editing', 'image_design'], aliases: ['gimp'], webUrl: 'https://www.gimp.org', keyboardHint: { mac: 'Cmd+Space → "GIMP" → Enter' } },
  { id: 'canva', displayName: 'Canva', macLaunchName: 'Canva', category: 'design', taskCategories: ['image_design', 'presentation'], webAppQuality: 'full', aliases: ['canva'], webUrl: 'https://www.canva.com', keyboardHint: { mac: 'Cmd+Space → "Canva" → Enter' } },
  { id: 'inkscape', displayName: 'Inkscape', macLaunchName: 'Inkscape', category: 'design', taskCategories: ['vector_design'], aliases: ['inkscape'], webUrl: 'https://inkscape.org', keyboardHint: { mac: 'Cmd+Space → "Inkscape" → Enter' } },
  { id: 'capcut', displayName: 'CapCut', macLaunchName: 'CapCut', category: 'media', taskCategories: ['video_editing'], webAppQuality: 'full', aliases: ['capcut', 'cap cut'], webUrl: 'https://www.capcut.com', keyboardHint: { mac: 'Cmd+Space → "CapCut" → Enter' } },
  { id: 'davinci-resolve', displayName: 'DaVinci Resolve', macLaunchName: 'DaVinci Resolve', category: 'media', taskCategories: ['video_editing'], aliases: ['davinci resolve', 'davinci'], webUrl: 'https://www.blackmagicdesign.com/products/davinciresolve', keyboardHint: { mac: 'Cmd+Space → "DaVinci Resolve" → Enter' } },
  { id: 'logic-pro', displayName: 'Logic Pro', macLaunchName: 'Logic Pro', category: 'media', taskCategories: ['audio_music'], aliases: ['logic pro', 'logic pro x'], webUrl: 'https://www.apple.com/logic-pro/', keyboardHint: { mac: 'Cmd+Space → "Logic Pro" → Enter' } },
  { id: 'audacity', displayName: 'Audacity', macLaunchName: 'Audacity', category: 'media', taskCategories: ['audio_music'], aliases: ['audacity'], webUrl: 'https://www.audacityteam.org', keyboardHint: { mac: 'Cmd+Space → "Audacity" → Enter' } },
  { id: 'excel', displayName: 'Microsoft Excel', macLaunchName: 'Microsoft Excel', category: 'other', taskCategories: ['spreadsheet', 'data_analysis'], webAppQuality: 'full', osUrlScheme: 'ms-excel:', aliases: ['excel', 'microsoft excel', 'ms excel'], webUrl: 'https://www.office.com/launch/excel', keyboardHint: { mac: 'Cmd+Space → "Excel" → Enter' } },
  { id: 'word', displayName: 'Microsoft Word', macLaunchName: 'Microsoft Word', category: 'other', taskCategories: ['document_writing'], webAppQuality: 'full', osUrlScheme: 'ms-word:', aliases: ['word', 'microsoft word', 'ms word'], webUrl: 'https://www.office.com/launch/word', keyboardHint: { mac: 'Cmd+Space → "Word" → Enter' } },
  { id: 'powerpoint', displayName: 'Microsoft PowerPoint', macLaunchName: 'Microsoft PowerPoint', category: 'other', taskCategories: ['presentation'], webAppQuality: 'full', osUrlScheme: 'ms-powerpoint:', aliases: ['powerpoint', 'power point', 'microsoft powerpoint', 'ppt'], webUrl: 'https://www.office.com/launch/powerpoint', keyboardHint: { mac: 'Cmd+Space → "PowerPoint" → Enter' } },
  { id: 'outlook', displayName: 'Microsoft Outlook', macLaunchName: 'Microsoft Outlook', category: 'other', taskCategories: ['email', 'calendar'], webAppQuality: 'full', osUrlScheme: 'ms-outlook:', aliases: ['outlook', 'microsoft outlook'], webUrl: 'https://outlook.live.com', keyboardHint: { mac: 'Cmd+Space → "Outlook" → Enter' } },
  { id: 'gmail', displayName: 'Gmail', category: 'other', taskCategories: ['email'], webAppQuality: 'full', webOnly: true, aliases: ['gmail', 'google mail'], webUrl: 'https://mail.google.com' },
  { id: 'google-calendar', displayName: 'Google Calendar', category: 'other', taskCategories: ['calendar'], webAppQuality: 'full', webOnly: true, aliases: ['google calendar', 'gcal'], webUrl: 'https://calendar.google.com' },
  { id: 'google-meet', displayName: 'Google Meet', category: 'meetings', taskCategories: ['meetings'], webAppQuality: 'full', webOnly: true, aliases: ['google meet', 'gmeet'], webUrl: 'https://meet.google.com' },
  { id: 'whatsapp', displayName: 'WhatsApp', macLaunchName: 'WhatsApp', category: 'chat', taskCategories: ['chat_messaging'], webAppQuality: 'full', osUrlScheme: 'whatsapp://', aliases: ['whatsapp', 'whats app'], webUrl: 'https://web.whatsapp.com', keyboardHint: { mac: 'Cmd+Space → "WhatsApp" → Enter' } },
  { id: 'trello', displayName: 'Trello', macLaunchName: 'Trello', category: 'pm', taskCategories: ['task_management'], webAppQuality: 'full', aliases: ['trello'], webUrl: 'https://trello.com', keyboardHint: { mac: 'Cmd+Space → "Trello" → Enter' } },
  { id: 'todoist', displayName: 'Todoist', macLaunchName: 'Todoist', category: 'pm', taskCategories: ['task_management'], webAppQuality: 'full', osUrlScheme: 'todoist://', aliases: ['todoist'], webUrl: 'https://app.todoist.com', keyboardHint: { mac: 'Cmd+Space → "Todoist" → Enter' } },
  { id: 'asana', displayName: 'Asana', macLaunchName: 'Asana', category: 'pm', taskCategories: ['task_management'], webAppQuality: 'full', aliases: ['asana'], webUrl: 'https://app.asana.com', keyboardHint: { mac: 'Cmd+Space → "Asana" → Enter' } },
  { id: 'blender', displayName: 'Blender', macLaunchName: 'Blender', category: 'design', taskCategories: ['cad_3d'], aliases: ['blender'], webUrl: 'https://www.blender.org', keyboardHint: { mac: 'Cmd+Space → "Blender" → Enter' } },
  // Newer installs are "Autodesk Fusion.app"; older ones "Autodesk Fusion
  // 360.app". Launch name + fuzzy installed matching cover both. Naming
  // stays consistent with appAutomationControlSurfaces' Fusion rung.
  { id: 'fusion-360', displayName: 'Fusion 360', macLaunchName: 'Autodesk Fusion', category: 'design', taskCategories: ['cad_3d'], aliases: ['fusion 360', 'fusion360', 'autodesk fusion', 'fusion'], webUrl: 'https://www.autodesk.com/products/fusion-360/overview', keyboardHint: { mac: 'Cmd+Space → "Fusion" → Enter' } },
  { id: 'onshape', displayName: 'Onshape', category: 'design', taskCategories: ['cad_3d'], webAppQuality: 'full', webOnly: true, aliases: ['onshape'], webUrl: 'https://cad.onshape.com' },
];

// ─── Matching ──────────────────────────────────────────────────────────────

/** Strip common noise words so "open zoom app on my computer" matches
 *  the same way as "launch zoom". Pure — safe for smoke tests. */
export function normaliseAppIntentText(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/\b(please|can you|could you|would you)\b/g, ' ')
    .replace(/\b(open|launch|start|run|fire up|boot|show|bring up|switch to|use)\b/g, ' ')
    .replace(/\b(the|my|a|an|on|in|to|for|this|that|up)\b/g, ' ')
    .replace(/\b(app|application|program|software|desktop|computer|machine|mac|pc|laptop)\b/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Finds the best KNOWN_APPS match for a user utterance like
 *  "open zoom app on my computer". Returns null when nothing matches.
 *
 *  Matches against two haystacks so compound aliases work: the
 *  normalised text (verbs + fillers stripped) catches "zoom" from
 *  "please open zoom please", and the raw-lowercased text catches
 *  "app store" / "find my" / "system settings" — aliases that contain
 *  the stopwords the normaliser would strip. Longest alias always
 *  wins, so a match on the raw haystack only beats a shorter match
 *  on the normalised one by length, not preference. */
export function matchKnownApp(task: string): KnownApp | null {
  const needle = normaliseAppIntentText(task);
  const raw = String(task || '').toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!needle && !raw) return null;
  const haystacks = [` ${needle} `, ` ${raw} `];
  let best: { app: KnownApp; score: number } | null = null;
  for (const app of KNOWN_APPS) {
    for (const alias of app.aliases) {
      const a = alias.toLowerCase();
      const pat = ` ${a} `;
      const hit = haystacks.some((h) => h.includes(pat));
      if (!hit) continue;
      const score = a.length;
      if (!best || score > best.score) best = { app, score };
    }
  }
  return best?.app ?? null;
}

// ─── Rendering ─────────────────────────────────────────────────────────────

export interface AppShortcutsOptions {
  /** Pre-supply the caller platform so we pick the right URL scheme.
   *  Defaults to 'mac' (our primary dev surface) when unknown. */
  platform?: KnownAppPlatform;
}

/** Produces both a clickable markdown block and a structured payload
 *  so callers can render either text or cards. */
export function renderAppShortcut(
  app: KnownApp,
  opts: AppShortcutsOptions = {},
): {
  markdown: string;
  osUrl: string | null;
  webUrl: string;
  keyboardHint: string | null;
} {
  const platform = opts.platform ?? 'mac';
  const osUrl = resolveOsUrl(app, platform);
  const keyboardHint = app.keyboardHint?.[platform] ?? null;
  const lines: string[] = [];

  lines.push(`**Open ${app.displayName}** — one of these will work:`);
  if (osUrl) {
    lines.push('');
    lines.push(`1. Click to launch the native app: [${app.displayName} →](${osUrl})`);
  }
  lines.push('');
  lines.push(`${osUrl ? '2.' : '1.'} Open in browser: [${app.webUrl}](${app.webUrl})`);
  if (keyboardHint) {
    lines.push('');
    lines.push(`${osUrl ? '3.' : '2.'} Keyboard shortcut: \`${keyboardHint}\``);
  }

  return {
    markdown: lines.join('\n'),
    osUrl,
    webUrl: app.webUrl,
    keyboardHint,
  };
}

function resolveOsUrl(app: KnownApp, platform: KnownAppPlatform): string | null {
  const perPlatform = app.osUrlByPlatform?.[platform];
  if (perPlatform) return perPlatform;
  return app.osUrlScheme ?? null;
}

/** Best-effort runtime platform detection. Web bundle uses userAgent;
 *  native returns 'mac' placeholder since this path only matters on web
 *  today (the console is web-only). */
export function detectPlatform(): KnownAppPlatform {
  if (typeof navigator === 'undefined') return 'mac';
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'web';
}

// ═══ Task → best-app resolution ═══════════════════════════════════════════
//
// The user types WHAT they want ("edit this photo", "make a budget
// spreadsheet") and SwanBot decides the best APPLICATION and how to OPEN it
// (desktop launch via the bridge, OS URL scheme, or web app in the browser).
// Everything below is pure and smoke-testable
// (scripts/app-task-resolver-smoketest.ts); the chat router consumes it.

// ─── Explicit app naming (named app always beats category inference) ────────

/**
 * Aliases that double as everyday TASK nouns/verbs ("spreadsheet", "notes",
 * "preview", "ai", ...). They stay valid for the LAUNCH path
 * (`matchKnownApp('open notes')`) but must not count as the user explicitly
 * NAMING an app inside a task sentence — "make a budget spreadsheet" names a
 * task, not the Numbers app.
 */
const GENERIC_TASK_NOUN_ALIASES = new Set<string>([
  'ai', 'spreadsheet', 'spreadsheet google', 'presentation', 'email', 'mail',
  'calendar', 'cal', 'docs', 'sheets', 'slides', 'drive', 'notes', 'notes app',
  'apple note', 'numbers', 'pages', 'preview', 'music', 'photos',
  'photo library', 'files', 'texts', 'reminder', 'phone', 'home', 'home app',
  'weather', 'forecast', 'news', 'stock market', 'market', 'alarm', 'timer',
  'clock', 'scan', 'scanner', 'code editor', 'cli', 'shell', 'automation',
  'whiteboard', 'keychain', 'color picker', 'color meter', 'backup', 'printer',
  'printers', 'settings', 'preferences', 'lookup', 'thesaurus', 'dictionary',
  'screen record', 'screen recording', 'task manager', 'process viewer',
  'apps', 'app library', 'fonts', 'sticky notes', 'voice recorder',
  'audio recorder', 'movie editor', 'music studio', 'zoom in', 'books',
  'containers', 'local llm', 'tv', 'logs', 'syslog', 'snip',
]);

export interface KnownAppNameMatch {
  app: KnownApp;
  /** The alias that matched, lowercased (becomes the resolution's matchedPhrase). */
  matchedAlias: string;
}

/**
 * Did the task text explicitly NAME a known app ("edit this photo in
 * photoshop")? Stricter than `matchKnownApp`: generic task-noun aliases are
 * skipped so "make a budget spreadsheet" does not read as naming Numbers.
 * Longest surviving alias wins, mirroring `matchKnownApp` semantics.
 */
export function findKnownAppInText(taskText: string): KnownAppNameMatch | null {
  const needle = normaliseAppIntentText(taskText);
  const raw = String(taskText || '').toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!needle && !raw) return null;
  const haystacks = [` ${needle} `, ` ${raw} `];
  // "zoom in/out on ..." is camera language, not the Zoom app.
  const zoomIsDirection = /\bzoom\s+(?:in|out)\b/i.test(String(taskText || ''));
  let best: { app: KnownApp; alias: string; score: number } | null = null;
  for (const app of KNOWN_APPS) {
    for (const alias of app.aliases) {
      const a = alias.toLowerCase();
      if (GENERIC_TASK_NOUN_ALIASES.has(a)) continue;
      if (a === 'zoom' && zoomIsDirection) continue;
      const pat = ` ${a} `;
      if (!haystacks.some((h) => h.includes(pat))) continue;
      const score = a.length;
      if (!best || score > best.score) best = { app, alias: a, score };
    }
  }
  return best ? { app: best.app, matchedAlias: best.alias } : null;
}

// ─── URL-bearing tasks resolve straight to the browser ──────────────────────

const TASK_URL_RE = /\bhttps?:\/\/\S+/i;
const TASK_BARE_DOMAIN_RE = /\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\.(?:com|org|net|io|app|dev|ai|co|us|gov|edu)(?:\/\S*)?\b/i;

/** Extract the website/URL a task already names, or null. Pure. */
export function findUrlInTaskText(taskText: string): string | null {
  const text = String(taskText || '');
  const explicit = text.match(TASK_URL_RE);
  if (explicit) return explicit[0].replace(/[.,;:!?)\]]+$/, '');
  const bare = text.match(TASK_BARE_DOMAIN_RE);
  if (bare) {
    const cleaned = bare[0].replace(/[.,;:!?)\]]+$/, '');
    return `https://${cleaned}`;
  }
  return null;
}

// ─── Category detection (verb/noun-anchored, conservative) ──────────────────

export interface TaskAppCategoryDetection {
  category: TaskAppCategory;
  confidence: 'high' | 'medium';
  matchedPhrase: string;
}

interface CategoryRule {
  category: TaskAppCategory;
  confidence: 'high' | 'medium';
  re: RegExp;
}

/**
 * Conservative verb/noun-anchored patterns. A missed detection returns null
 * and chat behaves exactly as today — false positives are the failure mode
 * we guard against, so bare nouns ("meeting", "budget", "code") never fire
 * without an action verb or an unambiguous compound noun.
 *
 * Calendar vs meetings split: scheduling/inviting → calendar app;
 * joining/hosting a live call → meetings app.
 */
const TASK_CATEGORY_RULES: CategoryRule[] = [
  // photo_editing
  { category: 'photo_editing', confidence: 'high', re: /\b(?:edit|retouch|touch\s*up|fix|enhance|crop|resize|brighten|sharpen|restore|color[\s-]*correct)\b[^.!?]{0,50}\b(?:photo|picture|image|pic|selfie|headshot)s?\b/i },
  { category: 'photo_editing', confidence: 'high', re: /\bremove\s+(?:the\s+)?background\b/i },
  { category: 'photo_editing', confidence: 'medium', re: /\b(?:photo|image)\s*edit(?:ing|or)?\b/i },
  // image_design
  { category: 'image_design', confidence: 'high', re: /\b(?:design|create|make|build|draw)\b[^.!?]{0,50}\b(?:logo|poster|flyer|banner|thumbnail|graphic|mock\s*up|mockup|social\s+(?:media\s+)?post|instagram\s+post)s?\b/i },
  // vector_design
  { category: 'vector_design', confidence: 'high', re: /\b(?:design|create|draw|make|edit|trace|vectori[sz]e|outline|expand)\b[^.!?]{0,50}\b(?:vector|svg|logo|icon\s+set|icons)\b/i },
  { category: 'vector_design', confidence: 'medium', re: /\bvector\s+(?:art|graphic|illustration|file)s?\b/i },
  // video_editing
  { category: 'video_editing', confidence: 'high', re: /\b(?:edit|cut|trim|splice|stitch\s+together)\b[^.!?]{0,50}\b(?:video|clip|footage|movie)s?\b/i },
  { category: 'video_editing', confidence: 'medium', re: /\bvideo\s*edit(?:ing|or)?\b/i },
  // audio_music
  { category: 'audio_music', confidence: 'high', re: /\b(?:record|edit|mix|master|produce|trim)\b[^.!?]{0,50}\b(?:audio|song|track|podcast|voice\s*over|beat)s?\b/i },
  { category: 'audio_music', confidence: 'medium', re: /\bmake\s+(?:a\s+|some\s+)?(?:music|song|beat)\b/i },
  // spreadsheet
  { category: 'spreadsheet', confidence: 'high', re: /\bspread\s*sheets?\b/i },
  { category: 'spreadsheet', confidence: 'high', re: /\b(?:make|create|build|start|set\s+up)\b[^.!?]{0,50}\b(?:budget|expense\s+(?:tracker|report|sheet))s?\b/i },
  { category: 'spreadsheet', confidence: 'medium', re: /\btrack\b[^.!?]{0,50}\b(?:in\s+a\s+table|expenses|budget|spending)\b/i },
  // document_writing
  { category: 'document_writing', confidence: 'high', re: /\b(?:write|draft|compose|type\s+up)\b[^.!?]{0,60}\b(?:document|doc|letter|essay|report|memo|resume|cv|cover\s+letter|proposal)s?\b/i },
  // presentation
  { category: 'presentation', confidence: 'high', re: /\b(?:slide\s*deck|slideshow|pitch\s+deck)s?\b/i },
  { category: 'presentation', confidence: 'high', re: /\b(?:make|create|build|prepare|put\s+together)\b[^.!?]{0,50}\b(?:presentation|slides|deck)\b/i },
  // email
  { category: 'email', confidence: 'high', re: /\b(?:send|write|draft|compose|reply\s+to|forward|check)\b[^.!?]{0,40}\be-?mails?\b/i },
  { category: 'email', confidence: 'medium', re: /\bcheck\s+(?:my\s+)?inbox\b/i },
  // calendar (scheduling + invites)
  { category: 'calendar', confidence: 'high', re: /\b(?:schedule|set\s+up|book|reschedule)\b[^.!?]{0,50}\b(?:meeting|appointment|event|call|1:1|one[\s-]on[\s-]one)s?\b/i },
  { category: 'calendar', confidence: 'high', re: /\bsend\s+(?:a\s+|out\s+)?(?:calendar\s+)?invites?\b/i },
  { category: 'calendar', confidence: 'medium', re: /\b(?:add|put)\b[^.!?]{0,40}\b(?:on|to)\s+(?:my\s+|the\s+)?calendar\b/i },
  // meetings (joining/hosting live)
  { category: 'meetings', confidence: 'high', re: /\b(?:join|start|host|hop\s+on|jump\s+on)\b[^.!?]{0,40}\b(?:meeting|call|video\s+call|standup|huddle)s?\b/i },
  // chat_messaging
  { category: 'chat_messaging', confidence: 'high', re: /\bsend\s+(?:a\s+|him\s+a\s+|her\s+a\s+|them\s+a\s+|everyone\s+a\s+)?(?:message|dm|text)s?\b/i },
  { category: 'chat_messaging', confidence: 'medium', re: /\b(?:message|dm|ping)\s+(?:the\s+team|him|her|them|everyone|my\s+\w+)\b/i },
  // notes
  { category: 'notes', confidence: 'high', re: /\b(?:take|jot\s+down|jot|write\s+down|capture)\b[^.!?]{0,30}\bnotes?\b/i },
  { category: 'notes', confidence: 'medium', re: /\bmeeting\s+notes\b/i },
  // task_management
  { category: 'task_management', confidence: 'high', re: /\b(?:to-?do|task)\s+lists?\b/i },
  { category: 'task_management', confidence: 'high', re: /\b(?:add|create|make)\b[^.!?]{0,40}\b(?:task|to-?do|reminder)s?\b/i },
  { category: 'task_management', confidence: 'medium', re: /\bremind\s+me\b/i },
  // code_editing
  { category: 'code_editing', confidence: 'high', re: /\b(?:write|edit|debug|refactor|review)\b[^.!?]{0,50}\b(?:code|script|function|program|repo(?:sitory)?)s?\b/i },
  // pdf
  { category: 'pdf', confidence: 'high', re: /\b(?:fill(?:\s+out)?|sign|merge|split|annotate|combine|compress|redact)\b[^.!?]{0,50}\bpdfs?\b/i },
  { category: 'pdf', confidence: 'medium', re: /\b(?:open|read|view|edit)\b[^.!?]{0,40}\bpdfs?\b/i },
  // file_management
  { category: 'file_management', confidence: 'high', re: /\b(?:organi[sz]e|clean\s+up|sort|rename|tidy(?:\s+up)?)\b[^.!?]{0,50}\b(?:files|folders|downloads|desktop)\b/i },
  // web_browsing
  { category: 'web_browsing', confidence: 'high', re: /\b(?:search\s+the\s+(?:web|internet)|browse\s+the\s+web|look\s+(?:it\s+|that\s+)?up\s+online|google\s+(?:it|that|for))\b/i },
  // cad_3d
  { category: 'cad_3d', confidence: 'high', re: /\b(?:3d[\s-]*(?:model|print|design)|cad\s+(?:model|drawing|file)|stl\s+file)s?\b/i },
  { category: 'cad_3d', confidence: 'medium', re: /\b(?:model|design)\b[^.!?]{0,40}\bin\s+3d\b/i },
  // data_analysis
  { category: 'data_analysis', confidence: 'high', re: /\b(?:analy[sz]e|chart|plot|graph|visuali[sz]e)\b[^.!?]{0,50}\b(?:data|csv|dataset|numbers|sales|metrics|results)\b/i },
  { category: 'data_analysis', confidence: 'high', re: /\bpivot\s+tables?\b/i },
];

/**
 * Detect the everyday-task category of a request. Conservative: a miss
 * returns null (chat behaves as today). Never fires when the task already
 * names a website/URL — those go straight to the browser. High-confidence
 * matches beat medium; ties go to the longest matched phrase.
 */
export function detectTaskAppCategory(taskText: string): TaskAppCategoryDetection | null {
  const text = String(taskText || '');
  if (!text.trim()) return null;
  if (findUrlInTaskText(text)) return null;
  let best: TaskAppCategoryDetection | null = null;
  for (const rule of TASK_CATEGORY_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const candidate: TaskAppCategoryDetection = {
      category: rule.category,
      confidence: rule.confidence,
      matchedPhrase: m[0].replace(/\s+/g, ' ').trim().slice(0, 80),
    };
    if (
      !best
      || (candidate.confidence === 'high' && best.confidence === 'medium')
      || (candidate.confidence === best.confidence && candidate.matchedPhrase.length > best.matchedPhrase.length)
    ) {
      best = candidate;
    }
  }
  return best;
}

// ─── Installed / running matching (fuzzy — bundle names are version-pinned) ─

function stripVersionTokens(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\.app$/, '')
    .replace(/\s+(?:\d{4}|\d+(?:\.\d+)*|x)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function appNameCandidates(app: KnownApp): string[] {
  const out = new Set<string>();
  for (const name of [app.macLaunchName, app.displayName]) {
    if (!name) continue;
    const lower = name.toLowerCase().trim();
    if (lower) out.add(lower);
    const stripped = stripVersionTokens(lower);
    if (stripped) out.add(stripped);
  }
  return [...out];
}

function namesLooselyMatch(installed: string, candidate: string): boolean {
  if (!installed || !candidate) return false;
  if (installed === candidate) return true;
  // Version fuzziness both ways: catalog "adobe photoshop 2026" matches an
  // installed "adobe photoshop 2025"; catalog "autodesk fusion" matches an
  // installed "autodesk fusion 360".
  return installed.startsWith(`${candidate} `) || candidate.startsWith(`${installed} `);
}

/**
 * Is the app present in the bridge's installed-apps probe? `installedApps`
 * entries are lowercased app names (contract with the desktop bridge probe).
 * Fuzzy on version suffixes — see the KnownApp.macLaunchName doc comment.
 */
export function isKnownAppInstalled(app: KnownApp, installedApps: string[]): boolean {
  if (app.webOnly) return false;
  const candidates = appNameCandidates(app);
  return (installedApps || []).some((raw) => {
    const installed = stripVersionTokens(raw) || String(raw || '').toLowerCase().trim();
    const installedFull = String(raw || '').toLowerCase().replace(/\.app$/, '').trim();
    return candidates.some((c) => namesLooselyMatch(installed, c) || namesLooselyMatch(installedFull, c));
  });
}

/** Same fuzzy matching against the running-apps list. */
export function isKnownAppRunning(app: KnownApp, runningApps: string[] | undefined): boolean {
  if (app.webOnly || !Array.isArray(runningApps)) return false;
  return isKnownAppInstalled(app, runningApps);
}

// ─── Resolver ────────────────────────────────────────────────────────────────

export interface ResolvedAppOption {
  appId: string;
  displayName: string;
  openVia: 'desktop_launch' | 'url_scheme' | 'browser_url';
  /** `open -a` launch name, URL scheme, or web URL depending on openVia. */
  openTarget: string;
  surface: 'desktop' | 'browser';
  /** Human-readable: "installed + you used it successfully before". */
  reason: string;
  /** True when the app is already running (open plan focuses instead of launching). */
  running?: boolean;
  /**
   * How confidently this option can be opened right now:
   *  - 'installed': desktop app confirmed present (probe or running) — launchable;
   *  - 'maybe': desktop bridge online but the installed-app probe is unavailable —
   *    it MIGHT not be installed, so the open step must be treated as fail-fast;
   *  - 'web': a browser option (web app or browser surface) — always launchable.
   * Optional so options parsed from older persisted rows still satisfy the type.
   */
  availability?: 'installed' | 'maybe' | 'web';
}

/** True when an option can be opened with confidence right now (not a 'maybe' desktop guess). */
export function isAppOptionConfidentlyLaunchable(option: ResolvedAppOption): boolean {
  return option.availability === 'installed' || option.availability === 'web';
}

export interface AppTaskResolution {
  category: TaskAppCategory;
  matchedPhrase: string;
  best: ResolvedAppOption;
  /** Distinct other apps, best option each, ≤3. */
  alternatives: ResolvedAppOption[];
  explicitAppNamed: boolean;
}

export interface ResolveBestAppContext {
  bridgeOnline: boolean;
  /** Lowercased app names from the desktop bridge installed-apps probe. */
  installedApps?: string[];
  runningApps?: string[];
  preferredAppByCategory?: Partial<Record<TaskAppCategory, string>>;
  /** appLearnedFacts store keyed by normalized app key. */
  appFactsByKey?: Record<string, { lastSuccessSurfaceId?: string | null }>;
}

/** Synthetic appId for "just use the browser surface" resolutions. */
export const BROWSER_SURFACE_APP_ID = 'browser';

const MAX_ALTERNATIVES = 3;

type DesktopAvailability = 'installed' | 'maybe' | 'unavailable';

function desktopAvailabilityForApp(app: KnownApp, ctx: ResolveBestAppContext): DesktopAvailability {
  if (!ctx.bridgeOnline || app.webOnly) return 'unavailable';
  // A running app is by definition installed, even when the probe is missing.
  if (isKnownAppRunning(app, ctx.runningApps)) return 'installed';
  if (!Array.isArray(ctx.installedApps)) return 'maybe';
  return isKnownAppInstalled(app, ctx.installedApps) ? 'installed' : 'unavailable';
}

function hasLearnedSuccess(app: KnownApp, ctx: ResolveBestAppContext): boolean {
  const facts = ctx.appFactsByKey;
  if (!facts) return false;
  const keys = new Set<string>([app.id, ...appNameCandidates(app)]);
  for (const key of keys) {
    const entry = facts[key];
    if (entry && entry.lastSuccessSurfaceId) return true;
  }
  return false;
}

interface ScoredOption {
  app: KnownApp;
  option: ResolvedAppOption;
  score: number;
}

// Ranking tiers. Honesty rule: a "maybe installed" desktop candidate (bridge
// online, installed-apps probe unavailable) ranks BELOW a known-'full' web
// app — fail honest, not optimistic.
const SCORE_PREFERRED_BONUS = 1000;
const SCORE_INSTALLED_LEARNED = 800;
const SCORE_INSTALLED = 700;
const SCORE_WEB_FULL = 500;
const SCORE_DESKTOP_MAYBE = 400;
const SCORE_WEB_LIMITED = 300;
const SCORE_WEB_MARKETING = 250;
const SCORE_RUNNING_BONUS = 150;

function buildScoredOptionsForApp(
  app: KnownApp,
  category: TaskAppCategory,
  ctx: ResolveBestAppContext,
): ScoredOption[] {
  const out: ScoredOption[] = [];
  const preferred = ctx.preferredAppByCategory?.[category] === app.id;
  const preferredBonus = preferred ? SCORE_PREFERRED_BONUS : 0;
  const availability = desktopAvailabilityForApp(app, ctx);

  if (availability !== 'unavailable') {
    const running = isKnownAppRunning(app, ctx.runningApps);
    const learned = availability === 'installed' && hasLearnedSuccess(app, ctx);
    let score = availability === 'installed'
      ? (learned ? SCORE_INSTALLED_LEARNED : SCORE_INSTALLED)
      : SCORE_DESKTOP_MAYBE;
    const reasons: string[] = [];
    if (preferred) reasons.push(`your preferred app for ${category.replace(/_/g, ' ')} tasks`);
    if (availability === 'installed') {
      reasons.push(learned ? 'installed + you used it successfully before' : 'installed on this Mac');
    } else {
      reasons.push('desktop bridge is online but the installed-app list is unavailable — it may not be installed');
    }
    if (running) {
      score += SCORE_RUNNING_BONUS;
      reasons.push('already running');
    }
    out.push({
      app,
      score: score + preferredBonus,
      option: {
        appId: app.id,
        displayName: app.displayName,
        openVia: 'desktop_launch',
        openTarget: resolveMacLaunchName(app),
        surface: 'desktop',
        reason: reasons.join('; '),
        availability: availability === 'installed' ? 'installed' : 'maybe',
        ...(running ? { running: true } : {}),
      },
    });
  }

  if (app.webUrl) {
    const quality = app.webAppQuality;
    const score = quality === 'full'
      ? SCORE_WEB_FULL
      : quality === 'limited' ? SCORE_WEB_LIMITED : SCORE_WEB_MARKETING;
    const reasons: string[] = [];
    if (preferred) reasons.push(`your preferred app for ${category.replace(/_/g, ' ')} tasks`);
    reasons.push(
      quality === 'full'
        ? 'full-featured web app — works in the browser'
        : quality === 'limited'
          ? 'limited web version'
          : 'web fallback only (informational page)',
    );
    out.push({
      app,
      score: score + preferredBonus,
      option: {
        appId: app.id,
        displayName: app.displayName,
        openVia: 'browser_url',
        openTarget: app.webUrl,
        surface: 'browser',
        reason: reasons.join('; '),
        availability: 'web',
      },
    });
  }

  return out;
}

/** Best option per distinct app, sorted by score desc then catalog order. */
function rankCategoryCandidates(
  category: TaskAppCategory,
  ctx: ResolveBestAppContext,
  excludeAppId?: string,
): ScoredOption[] {
  const byApp: ScoredOption[] = [];
  for (const app of KNOWN_APPS) {
    if (!app.taskCategories || !app.taskCategories.includes(category)) continue;
    if (excludeAppId && app.id === excludeAppId) continue;
    const options = buildScoredOptionsForApp(app, category, ctx);
    if (options.length === 0) continue;
    options.sort((a, b) => b.score - a.score);
    byApp.push(options[0]);
  }
  // Stable: catalog order breaks score ties deterministically.
  return byApp.sort((a, b) => b.score - a.score);
}

function browserOption(url: string, reason: string): ResolvedAppOption {
  return {
    appId: BROWSER_SURFACE_APP_ID,
    displayName: 'Browser',
    openVia: 'browser_url',
    openTarget: url,
    surface: 'browser',
    reason,
    availability: 'web',
  };
}

const LEGACY_CATEGORY_TO_TASK_CATEGORY: Partial<Record<KnownApp['category'], TaskAppCategory>> = {
  meetings: 'meetings',
  chat: 'chat_messaging',
  notes: 'notes',
  dev: 'code_editing',
  design: 'image_design',
  pm: 'task_management',
  media: 'video_editing',
};

/**
 * Resolve the best application for an everyday task and how to open it.
 *
 * Ranking (high → low):
 *  1. explicitly NAMED app — any availability; if its desktop app is
 *     unavailable we fall to its own web variant with a note;
 *  2. the user's preferred app for the category;
 *  3. installed desktop app with learned success (appFactsByKey);
 *  4. installed desktop app (running already > needs launching);
 *  5. 'full' web app — also outranks bridge-online-but-unprobed desktop
 *     candidates (the honesty rule);
 *  6. maybe-installed desktop, then 'limited' web, then marketing pages.
 *
 * URL-bearing tasks and web_browsing detections resolve straight to the
 * browser. Returns null when nothing matches — chat behaves as today.
 */
export function resolveBestAppForTask(
  taskText: string,
  ctx: ResolveBestAppContext,
): AppTaskResolution | null {
  const text = String(taskText || '');
  if (!text.trim()) return null;

  // 1. Task already names a website/URL → browser, directly.
  const url = findUrlInTaskText(text);
  if (url) {
    return {
      category: 'web_browsing',
      matchedPhrase: url,
      best: browserOption(url, 'the task names this site — opening it in the browser'),
      alternatives: [],
      explicitAppNamed: false,
    };
  }

  const detection = detectTaskAppCategory(text);
  const named = findKnownAppInText(text);

  // 2. Explicitly named app always wins over category inference.
  if (named) {
    const category = detection?.category
      ?? named.app.taskCategories?.[0]
      ?? LEGACY_CATEGORY_TO_TASK_CATEGORY[named.app.category]
      ?? null;
    if (!category) return null; // not a task→app shaped request; launch path owns it
    const options = buildScoredOptionsForApp(named.app, category, ctx);
    if (options.length === 0) return null;
    const desktop = options.find((o) => o.option.surface === 'desktop');
    const web = options.find((o) => o.option.surface === 'browser');
    const chosen = desktop ?? web!;
    const best: ResolvedAppOption = {
      ...chosen.option,
      reason: desktop
        ? `you named it — ${chosen.option.reason}`
        : `you named it — the desktop app isn't available right now, opening the web version (${chosen.option.reason})`,
    };
    return {
      category,
      matchedPhrase: named.matchedAlias,
      best,
      alternatives: rankCategoryCandidates(category, ctx, named.app.id)
        .slice(0, MAX_ALTERNATIVES)
        .map((s) => s.option),
      explicitAppNamed: true,
    };
  }

  if (!detection) return null;

  // 3. Browser tasks resolve to the browser directly.
  if (detection.category === 'web_browsing') {
    return {
      category: 'web_browsing',
      matchedPhrase: detection.matchedPhrase,
      best: browserOption('https://www.google.com', 'browser task — opening the browser directly'),
      alternatives: [],
      explicitAppNamed: false,
    };
  }

  // 4. Category candidates, ranked.
  const ranked = rankCategoryCandidates(detection.category, ctx);
  if (ranked.length === 0) return null;
  return {
    category: detection.category,
    matchedPhrase: detection.matchedPhrase,
    best: ranked[0].option,
    alternatives: ranked.slice(1, 1 + MAX_ALTERNATIVES).map((s) => s.option),
    explicitAppNamed: false,
  };
}

// ─── Fallback ladder (AR: honest, recoverable app selection) ────────────────

/**
 * The ordered ladder of apps to try for a resolution: the chosen best first,
 * then its ranked alternatives, deduped by app+surface. The dispatch contract
 * and recovery both walk this instead of re-deriving the order.
 */
export function buildAppFallbackLadder(resolution: AppTaskResolution): ResolvedAppOption[] {
  const ladder: ResolvedAppOption[] = [];
  const seen = new Set<string>();
  for (const option of [resolution.best, ...resolution.alternatives]) {
    const key = `${option.appId}:${option.surface}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ladder.push(option);
  }
  return ladder;
}

/**
 * The next-best app to try when the CHOSEN app fails to open — used by the
 * dispatch contract's "fall back once" line and by recovery. Picks from the
 * alternatives (never the best, which already failed) and prefers options that
 * are CONFIDENTLY launchable so the fallback doesn't chain into another
 * "maybe it's installed" guess:
 *   1. a full web app (works without the desktop bridge — most reliable);
 *   2. a confirmed-installed desktop app;
 *   3. otherwise the first alternative as-is (honest about the uncertainty).
 * Returns null when there is no alternative to fall back to.
 */
export function pickRecoveryAppFallback(resolution: AppTaskResolution): ResolvedAppOption | null {
  const alternatives = resolution.alternatives.filter(
    (alt) => !(alt.appId === resolution.best.appId && alt.surface === resolution.best.surface),
  );
  if (alternatives.length === 0) return null;
  const webFull = alternatives.find((alt) => alt.availability === 'web');
  if (webFull) return webFull;
  const installed = alternatives.find((alt) => alt.availability === 'installed');
  if (installed) return installed;
  return alternatives[0];
}

// ─── Preference memory (device storage; same discipline as appLearnedFacts) ─

export const PREFERRED_APPS_MAX_CATEGORIES = 20;
const MAX_PREFERRED_APP_ID_CHARS = 60;

export interface PreferredAppsByCategoryStore {
  v: 1;
  prefs: Partial<Record<TaskAppCategory, string>>;
}

const TASK_APP_CATEGORY_SET = new Set<string>(TASK_APP_CATEGORIES);

/** Parse + validate the persisted store. Corrupted/foreign data → empty. Pure. */
export function parsePreferredAppsByCategoryStore(
  raw: string | null | undefined,
): PreferredAppsByCategoryStore {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === 1 && parsed.prefs && typeof parsed.prefs === 'object') {
      const prefs: Partial<Record<TaskAppCategory, string>> = {};
      let count = 0;
      for (const [key, value] of Object.entries(parsed.prefs as Record<string, unknown>)) {
        if (count >= PREFERRED_APPS_MAX_CATEGORIES) break;
        if (!TASK_APP_CATEGORY_SET.has(key) || typeof value !== 'string' || !value.trim()) continue;
        prefs[key as TaskAppCategory] = value.trim().slice(0, MAX_PREFERRED_APP_ID_CHARS);
        count += 1;
      }
      return { v: 1, prefs };
    }
  } catch { /* corrupted store → start fresh (silent fail) */ }
  return { v: 1, prefs: {} };
}

/** Pure merge: set one category's preferred app, bounded ≤20 categories. */
export function upsertPreferredAppInStore(
  store: PreferredAppsByCategoryStore,
  category: TaskAppCategory,
  appId: string,
): PreferredAppsByCategoryStore {
  if (!TASK_APP_CATEGORY_SET.has(category)) return store;
  const cleanId = String(appId || '').trim().slice(0, MAX_PREFERRED_APP_ID_CHARS);
  if (!cleanId) return store;
  const prefs: Partial<Record<TaskAppCategory, string>> = { ...(store?.prefs || {}) };
  prefs[category] = cleanId;
  // The union has exactly 20 members, but enforce the bound defensively
  // against foreign keys smuggled in by older/corrupted payloads.
  const keys = Object.keys(prefs);
  if (keys.length > PREFERRED_APPS_MAX_CATEGORIES) {
    for (const key of keys) {
      if (key === category) continue;
      if (Object.keys(prefs).length <= PREFERRED_APPS_MAX_CATEGORIES) break;
      delete prefs[key as TaskAppCategory];
    }
  }
  return { v: 1, prefs };
}

function preferredAppsStoreKey(circleId: string): string {
  return `uc_preferred_apps_by_category::${String(circleId || 'unknown').slice(0, 80)}`;
}

/** Persist the user's preferred app for a category. Silent-fail, fire-and-forget. */
export async function recordPreferredAppForCategory(
  circleId: string,
  category: TaskAppCategory,
  appId: string,
): Promise<void> {
  try {
    const { storage } = await import('./storage');
    const key = preferredAppsStoreKey(circleId);
    const raw = await storage.getItem(key);
    const next = upsertPreferredAppInStore(parsePreferredAppsByCategoryStore(raw), category, appId);
    await storage.setItem(key, JSON.stringify(next));
  } catch { /* preferences are hints — never block the task */ }
}

/** Load the preferred-app map for a circle. Silent-fail → {}. */
export async function loadPreferredAppsByCategory(
  circleId: string,
): Promise<Partial<Record<TaskAppCategory, string>>> {
  try {
    const { storage } = await import('./storage');
    const raw = await storage.getItem(preferredAppsStoreKey(circleId));
    return parsePreferredAppsByCategoryStore(raw).prefs;
  } catch {
    return {};
  }
}

// ─── Open-step plan ──────────────────────────────────────────────────────────

/** Tool names MUST stay aligned with the openswanToolRuntime catalog. */
export type AppOpenPlanToolName =
  | 'desktop.launch_app'
  | 'desktop.focus_app'
  | 'desktop.open_url'
  | 'desktop.wait_for_app'
  | 'browser.open_url';

export const APP_OPEN_PLAN_TOOL_NAMES: AppOpenPlanToolName[] = [
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.open_url',
  'desktop.wait_for_app',
  'browser.open_url',
];

export interface AppOpenPlanStep {
  tool: AppOpenPlanToolName;
  input: Record<string, unknown>;
}

export interface AppOpenPlan {
  steps: AppOpenPlanStep[];
  note: string;
}

const WAIT_FOR_APP_TIMEOUT_MS = 15000;

/**
 * Turn a resolved option into concrete open steps using REAL catalog tool
 * names (openswanToolRuntime): desktop launch (focus when already running)
 * + wait_for_app; URL-scheme deep link via desktop.open_url; web apps via
 * browser.open_url.
 */
export function buildAppOpenPlan(option: ResolvedAppOption): AppOpenPlan {
  if (option.openVia === 'browser_url') {
    return {
      steps: [{ tool: 'browser.open_url', input: { url: option.openTarget } }],
      note: `Open ${option.displayName} in the browser.`,
    };
  }
  if (option.openVia === 'url_scheme') {
    return {
      steps: [{ tool: 'desktop.open_url', input: { url: option.openTarget } }],
      note: `Open the ${option.displayName} deep link — the OS hands it to the installed app.`,
    };
  }
  const appName = option.openTarget;
  return {
    steps: [
      option.running
        ? { tool: 'desktop.focus_app', input: { appName } }
        : { tool: 'desktop.launch_app', input: { appName } },
      { tool: 'desktop.wait_for_app', input: { appName, timeoutMs: WAIT_FOR_APP_TIMEOUT_MS } },
    ],
    note: option.running
      ? `${option.displayName} is already running — focus it and confirm it is frontmost.`
      : `Launch ${option.displayName} on the desktop and wait for it to be ready.`,
  };
}
