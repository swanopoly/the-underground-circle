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
    aliases: ['spotify', 'music'],
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
 *  "open zoom app on my computer". Returns null when nothing matches. */
export function matchKnownApp(task: string): KnownApp | null {
  const needle = normaliseAppIntentText(task);
  if (!needle) return null;
  // Score by longest alias hit — longer aliases win over shorter ones
  // (so "microsoft teams" beats "teams" when both match).
  let best: { app: KnownApp; score: number } | null = null;
  for (const app of KNOWN_APPS) {
    for (const alias of app.aliases) {
      const a = alias.toLowerCase();
      // Whole-word check via space-padded haystack. Prevents "pm" from
      // matching random substrings.
      const hay = ` ${needle} `;
      const pat = ` ${a} `;
      if (!hay.includes(pat)) continue;
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
