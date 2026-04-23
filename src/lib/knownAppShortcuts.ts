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
   */
  macLaunchName?: string;
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
    category: 'dev',
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
    aliases: ['finder', 'files', 'mac finder'],
    webUrl: 'https://support.apple.com/finder',
    keyboardHint: { mac: 'Cmd+Option+Space (search for files) or click Finder in Dock' },
  },
  {
    id: 'safari',
    displayName: 'Safari',
    category: 'other',
    aliases: ['safari'],
    webUrl: 'https://www.apple.com/safari',
    keyboardHint: { mac: 'Cmd+Space → "Safari" → Enter' },
  },
  {
    id: 'preview',
    displayName: 'Preview',
    category: 'other',
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
    aliases: ['xcode'],
    webUrl: 'https://developer.apple.com/xcode/',
    keyboardHint: { mac: 'Cmd+Space → "Xcode" → Enter' },
  },
  {
    id: 'textedit',
    displayName: 'TextEdit',
    category: 'notes',
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
  { id: 'stickies',   displayName: 'Stickies',   category: 'notes',  aliases: ['stickies', 'sticky notes'], webUrl: 'https://support.apple.com/guide/stickies/', keyboardHint: { mac: 'Cmd+Space → "Stickies" → Enter' } },
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
  { id: 'pages',     displayName: 'Pages',     category: 'notes', aliases: ['pages', 'apple pages', 'iwork pages'], osUrlByPlatform: { mac: 'pages-app:' }, webUrl: 'https://www.icloud.com/pages', keyboardHint: { mac: 'Cmd+Space → "Pages" → Enter' } },
  { id: 'numbers',   displayName: 'Numbers',   category: 'notes', aliases: ['numbers', 'apple numbers', 'iwork numbers', 'spreadsheet'], osUrlByPlatform: { mac: 'numbers-app:' }, webUrl: 'https://www.icloud.com/numbers', keyboardHint: { mac: 'Cmd+Space → "Numbers" → Enter' } },
  { id: 'keynote',   displayName: 'Keynote',   category: 'design', aliases: ['keynote', 'apple keynote', 'iwork keynote', 'presentation'], osUrlByPlatform: { mac: 'keynote-app:' }, webUrl: 'https://www.icloud.com/keynote', keyboardHint: { mac: 'Cmd+Space → "Keynote" → Enter' } },
  { id: 'imovie',    displayName: 'iMovie',    category: 'media', aliases: ['imovie', 'movie editor'], webUrl: 'https://www.apple.com/imovie/', keyboardHint: { mac: 'Cmd+Space → "iMovie" → Enter' } },
  { id: 'garageband', displayName: 'GarageBand', category: 'media', aliases: ['garageband', 'garage band', 'music studio'], webUrl: 'https://www.apple.com/mac/garageband/', keyboardHint: { mac: 'Cmd+Space → "GarageBand" → Enter' } },
  { id: 'onenote',   displayName: 'Microsoft OneNote', category: 'notes', aliases: ['onenote', 'one note', 'microsoft onenote'], osUrlByPlatform: { mac: 'onenote:' }, webUrl: 'https://www.onenote.com', keyboardHint: { mac: 'Cmd+Space → "OneNote" → Enter' } },
  { id: 'google-docs', displayName: 'Google Docs', category: 'notes', aliases: ['google docs', 'gdocs', 'docs'], webUrl: 'https://docs.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Docs" → Enter' } },
  { id: 'google-sheets', displayName: 'Google Sheets', category: 'notes', aliases: ['google sheets', 'gsheets', 'sheets', 'spreadsheet google'], webUrl: 'https://sheets.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Sheets" → Enter' } },
  { id: 'google-slides', displayName: 'Google Slides', category: 'design', aliases: ['google slides', 'gslides', 'slides'], webUrl: 'https://slides.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Slides" → Enter' } },
  { id: 'google-drive', displayName: 'Google Drive', category: 'other', aliases: ['google drive', 'gdrive', 'drive'], webUrl: 'https://drive.google.com', keyboardHint: { mac: 'Cmd+Space → "Google Drive" → Enter' } },

  // ─── Notes / knowledge ───────────────────────────────────────────
  { id: 'obsidian',  displayName: 'Obsidian',  category: 'notes', aliases: ['obsidian', 'obsidian vault'], osUrlByPlatform: { mac: 'obsidian:' }, webUrl: 'https://obsidian.md', keyboardHint: { mac: 'Cmd+Space → "Obsidian" → Enter' } },
  { id: 'evernote',  displayName: 'Evernote',  category: 'notes', aliases: ['evernote'], osUrlByPlatform: { mac: 'evernote:' }, webUrl: 'https://www.evernote.com', keyboardHint: { mac: 'Cmd+Space → "Evernote" → Enter' } },

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
  { id: 'adobe-acrobat',     displayName: 'Adobe Acrobat DC',     category: 'notes',  aliases: ['adobe acrobat', 'acrobat', 'acrobat dc', 'pdf reader', 'pdf editor'], webUrl: 'https://www.adobe.com/acrobat.html', keyboardHint: { mac: 'Cmd+Space → "Acrobat" → Enter' } },
  { id: 'adobe-photoshop',   displayName: 'Adobe Photoshop 2026', macLaunchName: 'Adobe Photoshop 2026', category: 'design', aliases: ['photoshop', 'ps', 'adobe photoshop'], webUrl: 'https://www.adobe.com/products/photoshop.html', keyboardHint: { mac: 'Cmd+Space → "Photoshop" → Enter' } },
  { id: 'adobe-illustrator', displayName: 'Adobe Illustrator 2026', macLaunchName: 'Adobe Illustrator 2026', category: 'design', aliases: ['illustrator', 'ai', 'adobe illustrator'], webUrl: 'https://www.adobe.com/products/illustrator.html', keyboardHint: { mac: 'Cmd+Space → "Illustrator" → Enter' } },
  { id: 'adobe-indesign',    displayName: 'Adobe InDesign 2026', macLaunchName: 'Adobe InDesign 2026', category: 'design', aliases: ['indesign', 'adobe indesign'], webUrl: 'https://www.adobe.com/products/indesign.html', keyboardHint: { mac: 'Cmd+Space → "InDesign" → Enter' } },
  { id: 'adobe-premiere',    displayName: 'Adobe Premiere Pro 2026', macLaunchName: 'Adobe Premiere Pro 2026', category: 'media', aliases: ['premiere', 'premiere pro', 'adobe premiere'], webUrl: 'https://www.adobe.com/products/premiere.html', keyboardHint: { mac: 'Cmd+Space → "Premiere Pro" → Enter' } },
  { id: 'adobe-after-effects', displayName: 'Adobe After Effects 2026', macLaunchName: 'Adobe After Effects 2026', category: 'media', aliases: ['after effects', 'ae', 'adobe after effects'], webUrl: 'https://www.adobe.com/products/aftereffects.html', keyboardHint: { mac: 'Cmd+Space → "After Effects" → Enter' } },
  { id: 'adobe-media-encoder', displayName: 'Adobe Media Encoder 2026', macLaunchName: 'Adobe Media Encoder 2026', category: 'media', aliases: ['media encoder', 'adobe media encoder', 'ame'], webUrl: 'https://www.adobe.com/products/media-encoder.html', keyboardHint: { mac: 'Cmd+Space → "Media Encoder" → Enter' } },
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
