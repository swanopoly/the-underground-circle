import { fetchAllMcpTools, callMcpTool, type McpTool } from './mcpClient';
import { loadConnections } from './connectionManager';
import { callBridgeExec } from './computerFileAdapter';
import {
  getInstalledIntegrationProviders,
  getCircleIntegrationCapabilities,
  type CircleIntegrationProvider,
} from './circleIntegrations';
import {
  matchKnownApp,
  resolveMacLaunchName,
  renderAppShortcut,
  detectPlatform,
} from './knownAppShortcuts';
import {
  isDesktopBridgeAvailable,
  launchApp as bridgeLaunchApp,
  focusApp as bridgeFocusApp,
  typeText as bridgeTypeText,
  pressKeys as bridgePressKeys,
  waitForApp as bridgeWaitForApp,
  ensureDesktopBridgePaired,
} from './desktopBridge';

export interface ComputerAppAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function toolMatches(tool: Pick<McpTool, 'name' | 'description'>, needles: string[]): boolean {
  const haystack = `${normalizeText(tool.name)} ${normalizeText(tool.description)}`;
  return needles.some((needle) => haystack.includes(needle));
}

function isDesktopOrAppTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'desktop',
    'application',
    'window',
    'slack',
    'figma',
    'notion',
    'github',
    'browser',
    'computer',
    'app',
    'mail',
    'calendar',
    'discord',
    'teams',
  ]);
}

function providerMentioned(task: string, provider: string): boolean {
  return new RegExp(`\\b${provider.replace(/[_-]/g, '[-_ ]?')}\\b`, 'i').test(task);
}

function inferTargetProviders(task: string): CircleIntegrationProvider[] {
  const providers: CircleIntegrationProvider[] = [
    'slack', 'github', 'notion', 'figma', 'discord', 'teams', 'wordpress', 'shopify',
    'stripe', 'salesforce', 'pipedrive', 'mailchimp', 'convertkit', 'posthog',
  ];
  return providers.filter((provider) => providerMentioned(task, provider));
}

function hasInputProp(tool: McpTool, key: string): boolean {
  const props = tool.inputSchema?.properties;
  return !!props && typeof props === 'object' && key in props;
}

function inferQuery(task: string): string {
  return String(task || '')
    .replace(/\b(check|open|inspect|review|look at|look up|search|find|show|use|in)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildArgs(tool: McpTool, task: string): Record<string, unknown> {
  const query = inferQuery(task);
  const args: Record<string, unknown> = {};
  if (hasInputProp(tool, 'query')) args.query = query;
  if (hasInputProp(tool, 'q')) args.q = query;
  if (hasInputProp(tool, 'search')) args.search = query;
  if (hasInputProp(tool, 'prompt')) args.prompt = query;
  if (hasInputProp(tool, 'task')) args.task = task;
  if (hasInputProp(tool, 'message')) args.message = query;
  if (hasInputProp(tool, 'limit')) args.limit = 10;
  return Object.keys(args).length > 0 ? args : { query };
}

function stringifyResult(result: any): string {
  if (result == null) return 'No result returned.';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.slice(0, 8).map((item) => JSON.stringify(item)).join('\n');
  if (typeof result === 'object') {
    if (Array.isArray(result.content)) {
      return result.content
        .slice(0, 8)
        .map((item: any) => typeof item?.text === 'string' ? item.text : JSON.stringify(item))
        .join('\n');
    }
    return JSON.stringify(result, null, 2).slice(0, 2000);
  }
  return String(result);
}

interface AutoChainResult {
  ok: boolean;
  steps: string[];
  error?: string;
  elapsedMs?: number;
}

// Common utterance → sequence patterns. Pure bridge calls, no model
// turns. Add entries here only when the sequence is stable + universal
// across users (not personalised).
//
// Phase 1c replaced the old `sleep(1200)` race with `waitForApp` —
// polls the running-app list until the named app appears before
// issuing the follow-up keystrokes. Means we start typing into the
// RIGHT app, not whichever app happened to be focused when `open -a`
// returned.
async function runAutoChain(appId: string): Promise<AutoChainResult> {
  const started = Date.now();
  const steps: string[] = [];
  try {
    if (appId === 'terminal-claude') {
      const waited = await bridgeWaitForApp('Terminal', 5_000);
      steps.push(waited.ok ? `wait for Terminal (${waited.data?.elapsedMs}ms)` : 'wait for Terminal timed out');
      const focus = await bridgeFocusApp('Terminal');
      steps.push(focus.ok ? 'focus Terminal' : `focus Terminal failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const type = await bridgeTypeText('claude');
      steps.push(type.ok ? 'type "claude"' : `type failed: ${type.error}`);
      if (!type.ok) return { ok: false, steps, error: type.error };
      const enter = await bridgePressKeys('Return');
      steps.push(enter.ok ? 'press Return' : `press Return failed: ${enter.error}`);
      if (!enter.ok) return { ok: false, steps, error: enter.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    if (appId === 'zoom') {
      // macOS bundle display name is `zoom.us`, not `Zoom` — same
      // reason the launch call needs resolveMacLaunchName().
      const zoomName = 'zoom.us';
      const waited = await bridgeWaitForApp(zoomName, 8_000);
      steps.push(waited.ok ? `wait for Zoom (${waited.data?.elapsedMs}ms)` : 'wait for Zoom timed out');
      const focus = await bridgeFocusApp(zoomName);
      steps.push(focus.ok ? 'focus Zoom' : `focus failed: ${focus.error}`);
      if (!focus.ok) return { ok: false, steps, error: focus.error };
      const press = await bridgePressKeys('Cmd+N');
      steps.push(press.ok ? 'press Cmd+N' : `keys failed: ${press.error}`);
      if (!press.ok) return { ok: false, steps, error: press.error };
      return { ok: true, steps, elapsedMs: Date.now() - started };
    }
    // No auto-chain — callers rely on the model to invoke desktop.*
    // tools for additional actions.
    return { ok: true, steps: ['no auto-chain'], elapsedMs: Date.now() - started };
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || 'auto-chain threw' };
  }
}

// ─── Claude-bridge osascript fallback ──────────────────────────────────────

/**
 * Well-known Mac app names the planner classifier recognises.
 * Keep in sync with the planner's app-name vocabulary.
 */
const KNOWN_APP_NAMES: string[] = [
  'Notes',
  'Reminders',
  'Calendar',
  'Mail',
  'Messages',
  'FaceTime',
  'Safari',
  'Chrome',
  'Google Chrome',
  'Firefox',
  'Slack',
  'Zoom',
  'Finder',
  'Terminal',
  'iTerm',
  'iTerm2',
  'Xcode',
  'Visual Studio Code',
  'Code',
  'Spotify',
  'Music',
  'Photos',
  'Preview',
  'TextEdit',
  'Pages',
  'Numbers',
  'Keynote',
  'Word',
  'Excel',
  'PowerPoint',
  'Notion',
  'Figma',
  'Discord',
  'Teams',
  'Microsoft Teams',
  'Outlook',
  'System Preferences',
  'System Settings',
  'Activity Monitor',
];

/** Allowed characters in a Mac app name used in an osascript command. */
const APP_NAME_SAFE_RE = /^[A-Za-z0-9 \-_.&]+$/;

/**
 * Find the first known app name mentioned in `task` (case-insensitive).
 * Returns the canonical cased name from KNOWN_APP_NAMES, or null.
 */
function inferAppNameFromTask(task: string): string | null {
  const lower = task.toLowerCase();
  // Sort by length descending so longer multi-word names (e.g. "Google Chrome")
  // are tested before shorter substrings (e.g. "Chrome").
  const sorted = [...KNOWN_APP_NAMES].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

type OsaVerb = 'activate' | 'quit';

/**
 * Infer whether the user wants to launch/activate or quit the app.
 * Default is 'activate' (bring forward / open).
 */
function inferOsaVerb(task: string): OsaVerb {
  const lower = task.toLowerCase();
  if (/\b(quit|close|exit|kill|stop)\b/.test(lower)) return 'quit';
  return 'activate'; // launch, open, start, switch to → activate
}

/**
 * Sanitize an app name for safe inclusion in an osascript one-liner.
 * Returns null if the name contains shell metacharacters.
 */
function sanitizeAppName(appName: string): string | null {
  if (!APP_NAME_SAFE_RE.test(appName)) return null;
  // Escape embedded single quotes (rare for Mac app names but defensive)
  return appName.replace(/'/g, "'\\''");
}

/**
 * Attempt to satisfy a Mac app launch / quit task via the local
 * claude-bridge /exec endpoint using `osascript`. Returns null when
 * the bridge is unreachable, the app name can't be inferred, or the
 * name fails the safety check — letting the caller fall through to
 * the existing no-surface response.
 */
async function tryBridgeAppFallback(task: string): Promise<ComputerAppAdapterResult | null> {
  const appName = inferAppNameFromTask(task);
  if (!appName) return null;

  const safeAppName = sanitizeAppName(appName);
  if (!safeAppName) return null;

  const verb = inferOsaVerb(task);
  const command = `osascript -e 'tell application "${safeAppName}" to ${verb}'`;

  let bridgeResult: { ok: boolean; stdout: string; stderr: string; code?: number };
  try {
    const raw = await callBridgeExec(command);
    // callBridgeExec does not return `code` — treat ok:true as code 0
    bridgeResult = { ...raw, code: raw.ok ? 0 : 1 };
  } catch {
    return null;
  }

  // Bridge unreachable or command hard-failed
  if (!bridgeResult.ok && !bridgeResult.stdout && !bridgeResult.stderr) {
    return null;
  }

  const succeeded = bridgeResult.ok && (bridgeResult.code ?? 1) === 0;
  const verbLabel = verb === 'quit' ? 'Quit' : 'Launched';

  return {
    ok: succeeded,
    message: succeeded
      ? `${verbLabel} **${appName}** via osascript (claude-bridge).`
      : `osascript failed for **${appName}**: ${bridgeResult.stderr || 'unknown error'}`,
    warnings: succeeded ? [] : [`osascript exit: ${bridgeResult.code ?? 'unknown'}`],
    data: {
      kind: 'desktop_bridge_launch',
      toolName: 'claude-bridge:osascript',
      appName,
      verb,
      command,
    },
  };
}

export async function executeComputerAppTask(args: {
  circleId: string;
  task: string;
}): Promise<ComputerAppAdapterResult> {
  const task = String(args.task || '').trim();
  if (!task) {
    return {
      ok: false,
      message: 'No app task was provided.',
      warnings: [],
    };
  }

  // ─── Precedence step 1: Claude Code bridge (Phase 1b) ─────────────────
  // If the user has the local desktop bridge running + a known app is in
  // the utterance, launch natively — most reliable path, single HITL
  // gate, follow-up tool calls (type/keys) happen via the agent loop.
  //
  // We probe health first so we can distinguish "bridge offline" from
  // "bridge running but call errored" — the user's experience is very
  // different in those two states and silently falling through to the
  // URL-scheme shortcut (with a muddled warning) is the opposite of
  // what the user wants when they HAVE paired.
  const bridgeCandidate = matchKnownApp(task);
  if (bridgeCandidate) {
    try {
      const bridgeAvailable = await isDesktopBridgeAvailable();
      if (bridgeAvailable) {
        // Auto-pair if needed — ensureDesktopBridgePaired is idempotent
        // and silent when already paired.
        await ensureDesktopBridgePaired().catch(() => null);
        const r = await bridgeLaunchApp(resolveMacLaunchName(bridgeCandidate));
        if (r.ok) {
          // For utterances with a built-in follow-up pattern we know
          // from the alias match (e.g. "open Claude Code" → launch
          // Terminal + type `claude` + Return), auto-chain the
          // sequence here rather than relying on the model to call
          // desktop.* tools. Client-side only — same trust boundary
          // as the launch itself, and avoids needing the hardcoded
          // swanbot-ai edge fn to know about desktop tools.
          const autoChainSteps = await runAutoChain(bridgeCandidate.id);

          const followupMessages: Record<string, string> = {
            'terminal-claude': 'Ran `claude` in Terminal.',
            zoom: 'Sent Cmd+N to start a new meeting.',
          };
          const chainMsg = autoChainSteps.ok && followupMessages[bridgeCandidate.id]
            ? ` ${followupMessages[bridgeCandidate.id]}`
            : autoChainSteps.error
              ? ` Auto-chain hit an issue: ${autoChainSteps.error}.`
              : '';

          return {
            ok: true,
            message:
              `Launched **${bridgeCandidate.displayName}** via the local bridge.${chainMsg}` +
              (autoChainSteps.ok
                ? ''
                : ' Follow up with `desktop.type_text` / `desktop.press_keys` for further actions.'),
            warnings: [],
            data: {
              kind: 'desktop_bridge_launch',
              appId: bridgeCandidate.id,
              displayName: bridgeCandidate.displayName,
              capability: 'desktop_action',
              autoChain: autoChainSteps,
            },
          };
        }
        // Bridge reachable but launch failed — surface the specific
        // error state inline rather than silently returning the URL
        // shortcut. The user wants to know WHY the real path didn't
        // work so they can fix it.
        if (r.errorCode === 'permission_denied') {
          return {
            ok: false,
            message:
              `**macOS Accessibility permission required.**\n\n` +
              `The bridge tried to launch **${bridgeCandidate.displayName}** but was blocked. ` +
              `Open **System Settings → Privacy & Security → Accessibility** and enable it for ` +
              `whichever Terminal / iTerm is running \`node scripts/claude-bridge.js\`. ` +
              `Retry the same command afterwards — no re-pairing needed.`,
            warnings: ['desktop_action failed with permission_denied'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, displayName: bridgeCandidate.displayName },
          };
        }
        if (r.errorCode === 'app_not_found') {
          return {
            ok: false,
            message:
              `**${bridgeCandidate.displayName} isn't installed on this Mac.**\n\n` +
              `The bridge tried \`open -a "${bridgeCandidate.displayName}"\` and got "not found." ` +
              `Install the app or ask me for a browser fallback (${bridgeCandidate.webUrl}).`,
            warnings: ['desktop_action failed with app_not_found'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode, displayName: bridgeCandidate.displayName, webFallback: bridgeCandidate.webUrl },
          };
        }
        if (r.errorCode === 'not_paired') {
          return {
            ok: false,
            message:
              `**Bridge running but not paired.** Tap **⎇ Pair Desktop Bridge** ` +
              `in the Chat Actions menu once, then retry.`,
            warnings: ['desktop_action failed with not_paired'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
          };
        }
        if (r.errorCode === 'origin_blocked') {
          // CORS preflight failed. Before 2026-04-23 the bridge didn't
          // include `X-UC-Desktop-Token` in Access-Control-Allow-Headers,
          // so every authed call died here even with a paired token.
          // Fixed in scripts/claude-bridge.js; users on older builds see
          // this path. Tell them to restart the bridge.
          return {
            ok: false,
            message:
              `**Bridge CORS rejected the token header.**\n\n` +
              `Stop your \`node scripts/claude-bridge.js\` process and start it again ` +
              `after running \`git pull\` — the CORS allow-list was widened to accept ` +
              `the desktop-token header. Then run \`/desktop diag\` to confirm.`,
            warnings: ['desktop_action failed with origin_blocked'],
            data: { kind: 'desktop_bridge_error', errorCode: r.errorCode },
          };
        }
        // Unknown error state — note it but fall through to URL-scheme
        // shortcut so the user still has SOME path.
      }
    } catch {
      // Bridge probe threw — continue with the non-bridge paths.
    }
  }

  const [tools, connections, providers, capabilities] = await Promise.all([
    fetchAllMcpTools(args.circleId).catch(() => [] as McpTool[]),
    loadConnections().catch(() => []),
    getInstalledIntegrationProviders(args.circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(args.circleId).catch(() => [] as string[]),
  ]);

  const appTools = tools.filter(isDesktopOrAppTool);
  const targetProviders = inferTargetProviders(task);
  const matchingTool = [...appTools].sort((a, b) => {
    const aScore = targetProviders.some((provider) => toolMatches(a, [provider])) ? 2 : 0;
    const bScore = targetProviders.some((provider) => toolMatches(b, [provider])) ? 2 : 0;
    return bScore - aScore;
  })[0];

  if (matchingTool) {
    const toolArgs = buildArgs(matchingTool, task);
    try {
      const result = await callMcpTool(matchingTool.serverId, matchingTool.name, toolArgs);
      return {
        ok: true,
        message: [
          `Executed app task with **${matchingTool.name}**.`,
          '',
          stringifyResult(result),
        ].join('\n'),
        warnings: [],
        data: {
          toolName: matchingTool.name,
          toolArgs,
          rawResult: result,
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        message: `App tool execution failed: ${error?.message || 'Unknown error'}`,
        warnings: ['App MCP call failed.'],
        data: {
          toolName: matchingTool.name,
          toolArgs,
        },
      };
    }
  }

  const enabledConnections = connections.filter((connection) => connection.enabled);
  const lines: string[] = [];
  if (providers.length > 0) {
    lines.push(`Connected integrations: ${providers.join(', ')}`);
  }
  if (capabilities.length > 0) {
    lines.push(`Integration capabilities: ${capabilities.slice(0, 10).join(', ')}`);
  }
  if (enabledConnections.length > 0) {
    lines.push(`Enabled bridges: ${enabledConnections.map((connection) => connection.provider).join(', ')}`);
  }
  if (appTools.length > 0) {
    lines.push(`MCP app tools: ${appTools.slice(0, 6).map((tool) => tool.name).join(', ')}`);
  }

  // Before giving up, check whether the user asked for a well-known
  // desktop app (Zoom, Slack, Notion, …). If so, hand back a clickable
  // shortcut that uses the OS URL handler — native launch in one click
  // even without an app_tools bridge. This is the "Option A" fallback
  // documented in `docs/DESKTOP_APP_CAPABILITY_PATHS.md`.
  //
  // NOTE: by the time we reach this branch, the bridge-first step
  // above already failed (bridge offline, or bridge running but launch
  // errored with an unrecognised code). Include an inline prompt to
  // start the bridge for full automation — otherwise the user has no
  // signal that there's a stronger path available.
  const knownApp = matchKnownApp(task);
  if (knownApp) {
    const platform = detectPlatform();
    const shortcut = renderAppShortcut(knownApp, { platform });
    const bridgeHint = [
      '',
      '— — —',
      '**Want full automation?** Launch, type, and press keys without clicking anything:',
      '1. Run `node scripts/claude-bridge.js` in a terminal',
      '2. Tap **⎇ Pair Desktop Bridge** in the Chat Actions menu once',
      '3. Retry your request — the agent will drive the app directly.',
    ].join('\n');
    return {
      ok: true,
      message: shortcut.markdown + '\n' + bridgeHint,
      warnings: lines.length === 0
        ? ['Desktop bridge offline — served via known-app URL-scheme shortcut. Run the bridge for full automation.']
        : ['Missing app MCP tool match — offering known-app URL-scheme shortcut as fallback.'],
      data: {
        kind: 'known_app_shortcut',
        appId: knownApp.id,
        displayName: knownApp.displayName,
        osUrl: shortcut.osUrl,
        webUrl: shortcut.webUrl,
        keyboardHint: shortcut.keyboardHint,
        platform,
        bridgeHint: true,
      },
    };
  }

  // ─── Claude-bridge osascript fallback ────────────────────────────────────
  // If no MCP app/desktop tools, no known-app URL shortcut matched (or it
  // was reached without a match), try launching via osascript through the
  // local claude-bridge /exec endpoint. Mirrors the filesystem fallback in
  // computerFileAdapter.ts.
  const bridgeFallback = await tryBridgeAppFallback(task);
  if (bridgeFallback) return bridgeFallback;

  if (lines.length === 0) {
    return {
      ok: false,
      message: 'No connected app surfaces are available for this circle yet.',
      warnings: ['Missing app MCP / integration / bridge surface.'],
    };
  }

  return {
    ok: true,
    message: [
      'App-capable surfaces are available, but no single MCP app tool was a clear execution match yet.',
      '',
      ...lines.map((line) => `- ${line}`),
      '',
      'The next step is to use these surfaces through a richer app-specific action adapter or with explicit access guidance.',
    ].join('\n'),
    warnings: ['No direct app MCP tool match; returning surface inventory instead.'],
    data: {
      providers,
      capabilities,
      enabledBridgeProviders: enabledConnections.map((connection) => connection.provider),
      appToolNames: appTools.map((tool) => tool.name),
    },
  };
}
