/**
 * chatCapabilityManifest — "the AI models select what they need from the
 * application" (PURE).
 *
 * The chat answers normal turns by streaming a plain model answer. When a turn
 * needs real capability, the model should ACTIVATE app tools (SwanBot/OpenSwan)
 * or deploy agents rather than guessing. This module is the bridge: a compact,
 * declarative manifest of the capability *families* the app exposes, plus a
 * short system-prompt block that tells the model those families exist and to
 * call `tools.search` to load the concrete tool schemas only when a turn
 * actually needs them.
 *
 * Why a manifest at all, when `tools.search` already exists?
 *   - `tools.search` is a *retrieval* primitive: the model must already know
 *     roughly what to look for. The manifest is the *menu* — it makes the model
 *     aware of the long-tail families (browser, desktop, WordPress, Adobe
 *     design, vault, rooms, research, code/verification, agent deploy …) that
 *     are otherwise DEFERRED out of the prompt until unlocked. Manifest =
 *     "these powers exist + when to reach for them"; tools.search =
 *     "load the exact tools now".
 *   - Keeping the manifest declarative (no react-native imports) means it is
 *     tsx-loadable and unit-smokeable, and that frontier models + BlackSwan /
 *     OpenSwan all read the *same* capability surface, so a future app-trained
 *     checkpoint (BlackSwan-v5) collaborates from an identical menu.
 *
 * Grounding: the families, example tool names, and approval posture here are
 * lifted from the REAL OpenSwan tool catalog in `openswanToolRuntime.ts`
 * (its `TOOL_DEFINITIONS`, the `getOpenSwanToolDisclosureFamily` name-prefix
 * families, the `TOOL_DISCLOSURE_FAMILY_DEFAULTS` pinned/deferred split, and
 * each family's `approvalMode`). This file intentionally does NOT import that
 * module at runtime (it is react-native-coupled); it mirrors the small, stable
 * facts so smokes load under tsx. If a family's name prefix changes there,
 * update the `family`/`exampleTools` here to match.
 *
 * Quiet-in-chat (per CLAUDE.md): the prompt block is short and tells the model
 * to keep capability discovery silent — the user should see approvals, proof,
 * or actionable blockers, not the routing chatter.
 */

// Type-only — keep this module tsx-loadable. `OpenSwanToolApprovalMode` is the
// real approval enum ('auto' | 'ask') from the runtime; importing the *type*
// adds no react-native dependency, but anchors our `approval` field to the
// source of truth so a future widening there shows up here as a type error.
import type { OpenSwanToolApprovalMode } from './openswanToolRuntime';
// Runtime imports — both modules are pure (no react-native), so they stay
// tsx-loadable. The machine-capability catalog (QW5) expands the coarse
// 'desktop' family into its real observe + gated-act menu; matchKnownApp lets
// the advertisement stay honest about deep (Adobe/Finder) vs generic (Figma/
// Blender) desktop support.
import {
  LOCAL_COMPUTER_CAPABILITY_CATALOG,
  getLocalComputerObserveTools,
  type LocalComputerCapabilityEntry,
} from './localComputerAwarenessIntent';
import { matchKnownApp } from './knownAppShortcuts';

/**
 * One discoverable capability family the model can activate. Deliberately
 * coarse: a family maps to a tool-name prefix (or a small flat cluster) in the
 * OpenSwan catalog, NOT to a single tool. The model uses `tools.search` to go
 * from a family to the concrete tool + schema.
 */
export interface AppCapability {
  /**
   * Disclosure family key — matches `getOpenSwanToolDisclosureFamily` in the
   * runtime (the tool-name prefix before the first '.', or the full name for
   * flat tools). This is what you pass as the `family` filter to `tools.search`
   * to browse the whole family.
   */
  family: string;
  /** Short human/model-facing title for the capability. */
  title: string;
  /** One line: when the model should reach for this family. */
  whenToUse: string;
  /**
   * A few representative tool names from the real catalog, so the model knows
   * what `tools.search` will surface. Not exhaustive — discovery is the point.
   */
  exampleTools: string[];
  /**
   * Coarsest approval posture in the family. 'auto' = read-like / no human gate
   * by default; 'ask' = at least one tool in the family mutates state or has an
   * external side effect and is HITL-gated. The exact per-tool gate is enforced
   * downstream by OpenSwan tool policy — this is only a hint so the model can
   * pre-warn the user that approval is coming.
   */
  approval: OpenSwanToolApprovalMode;
}

/**
 * The capability menu. Order is roughly "most-reached-for first": knowledge &
 * coordination (mostly auto) before the heavier, approval-gated automation
 * families. Each entry is grounded in a real catalog family — see the module
 * doc for the source-of-truth mapping.
 */
export const APP_CAPABILITIES: readonly AppCapability[] = [
  {
    family: 'memory',
    title: 'Memory & recall',
    whenToUse:
      'Recall or save what the user/circle already told you, prior decisions, or saved context before answering from a blank slate.',
    exampleTools: ['search_memories', 'save_memory', 'memory.pin', 'user_memory.manage'],
    approval: 'auto',
  },
  {
    family: 'research',
    title: 'Research & web fetch',
    whenToUse:
      'Look something up: read a specific public URL, run a web/knowledge search, or save a finding to the research corpus.',
    exampleTools: ['research.search', 'research.save', 'fetch_url', 'context.search'],
    approval: 'auto',
  },
  {
    family: 'tasks',
    title: 'Tasks, goals & missions',
    whenToUse:
      'Read or move the accountability loop: list/create/update tasks, goals, missions, and assignments for the team.',
    exampleTools: ['tasks.list', 'tasks.create', 'goals.list', 'missions.create_task'],
    approval: 'auto',
  },
  {
    family: 'messages',
    title: 'Team messaging & check-ins',
    whenToUse:
      'See or post team chat / check-ins, list circle members, or schedule an outbound action when coordination is the actual ask.',
    exampleTools: ['messages.list', 'messages.create', 'list_circle_members', 'schedule_action'],
    approval: 'ask',
  },
  {
    family: 'rooms',
    title: 'Rooms & workspaces',
    whenToUse:
      'Multi-file iteration: open/create a project room, read/write room files, run room tasks, or open a live preview of generated work.',
    exampleTools: ['rooms.list', 'rooms.create_file', 'workspace.apply_artifacts', 'workspace.open_preview'],
    approval: 'ask',
  },
  {
    family: 'code',
    title: 'Code & verification',
    whenToUse:
      'Inspect, generate, or review code, then verify it with typecheck/tests/lint/preview before claiming it works.',
    exampleTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
    approval: 'auto',
  },
  {
    family: 'github',
    title: 'GitHub repos & activity',
    whenToUse:
      'Read repo files, list connected repos, or surface recent GitHub activity for accountability context.',
    exampleTools: ['github.list_repos', 'github.read_file', 'github.activity'],
    approval: 'auto',
  },
  {
    family: 'browser',
    title: 'Browser automation',
    whenToUse:
      'Operate a real website that needs logged-in state, form submission, or DOM-level action — plan first with browser.plan_task, then act.',
    exampleTools: ['browser.plan_task', 'browser.open_url', 'browser.dom_snapshot', 'browser.click_role'],
    approval: 'ask',
  },
  {
    family: 'desktop',
    title: 'Local desktop & app control',
    whenToUse:
      "Drive the user's actual machine: read tabs/clipboard/files (low risk) or launch/focus apps, type, click, and run shortcuts (gated).",
    exampleTools: ['desktop.list_running_apps', 'desktop.screenshot', 'desktop.launch_app', 'desktop.click_element'],
    approval: 'ask',
  },
  {
    family: 'wp',
    title: 'WordPress / Dealer Inspire admin',
    whenToUse:
      'Manage live WordPress or Dealer Inspire content — discover post types, upload media, create DI slides, update or trash posts.',
    exampleTools: ['wp.discover_types', 'wp.list_posts', 'wp.create_slide', 'wp.update_post'],
    approval: 'ask',
  },
  {
    family: 'desktop:design',
    title: 'Photoshop / InDesign creative automation',
    whenToUse:
      'Drive Adobe Photoshop/InDesign: inventory layers, update text, place assets, batch find/change, and export or package proofs.',
    exampleTools: [
      'desktop.photoshop_layer_inventory',
      'desktop.photoshop_place_asset',
      'desktop.indesign_batch_find_change',
      'desktop.indesign_export_proof',
    ],
    approval: 'ask',
  },
  {
    family: 'vault',
    title: 'Credentials & vault grants',
    whenToUse:
      'Find a saved credential or grant/revoke scoped automation access — never to reveal secrets, only to authorize a task. Secrets stay vaulted.',
    exampleTools: ['vault.find', 'vault.grants', 'vault.grant', 'vault.resolve_for_task'],
    approval: 'ask',
  },
  {
    family: 'integrations',
    title: 'Connected integrations & custom APIs',
    whenToUse:
      'Use a connected integration or Custom API: list what is connected, read it, or run an approved write request through the proxy.',
    exampleTools: ['integrations.list', 'custom_api.read', 'custom_api.request'],
    approval: 'ask',
  },
  {
    family: 'approvals',
    title: 'Approvals & HITL control',
    whenToUse:
      'When a gated action is pending: list, request, or resolve human approvals so a circle member can unblock or stop a run.',
    exampleTools: ['approvals.list', 'approvals.request', 'approvals.resolve'],
    approval: 'auto',
  },
  {
    family: 'skills',
    title: 'Skill library',
    whenToUse:
      'Reuse or manage saved team skills/runbooks instead of re-deriving a procedure the circle has already captured.',
    exampleTools: ['skills.view', 'skills.manage'],
    approval: 'ask',
  },
  {
    family: 'agent',
    title: 'Connected-agent buildout & recovery',
    whenToUse:
      'When no existing tool covers an app/task: delegate a bounded capability buildout, asset acquisition, or failed-task recovery to a managed agent session.',
    exampleTools: ['agent.build_app_capability', 'agent.codex_acquire_asset', 'agent.recover_failed_task'],
    approval: 'ask',
  },
  {
    family: 'circle',
    title: 'Circle & office settings',
    whenToUse:
      'Adjust circle/office configuration the user explicitly asks for: settings, budget caps, office theme, agent appearance/identity.',
    exampleTools: ['circle.update_settings', 'circle.update_budget_caps', 'office.list_agents', 'agent.rename'],
    approval: 'ask',
  },
  {
    family: 'team.deploy_agents',
    title: 'Deploy a swarm of transient agents',
    whenToUse:
      'Only for genuinely parallelizable work: fan a single task out to multiple TRANSIENT agents. One agent is the default; large/costly fan-outs require approval.',
    exampleTools: ['team.deploy_agents'],
    approval: 'ask',
  },
] as const;

// ─── Desktop family expansion (QW5) ─────────────────────────────────────────
//
// The single coarse 'desktop' AppCapability above is honest but shallow. When a
// turn actually reaches for local desktop control, the model benefits from the
// REAL read-first menu (a11y tree, window/screen state, clipboard-inspect, file
// read/search/stat/list) plus the gated action set — all DERIVED from the
// machine-capability catalog so this can never drift from the kinds the parser
// can emit. This is read-only advertisement metadata; the actual per-action gate
// is still enforced by getLocalComputerAwarenessRiskProfile + the typed-runtime
// floor. Nothing here changes what is or is not gated.

export interface DesktopCapabilityExpansion {
  /** Read-first observe tools the model should reach for before any action. */
  observeTools: string[];
  /** Distinct gated-act intent kinds (mutating / external side effect). */
  gatedActKinds: string[];
  /** Coordinate action kinds that require a fresh screenshot first. */
  coordinateKinds: string[];
  /** Number of catalog entries at each risk tier, for an honest posture line. */
  riskCounts: { safe: number; review: number; external_side_effect: number };
}

/** Build the expanded desktop menu from the machine-capability catalog. */
export function buildDesktopCapabilityExpansion(): DesktopCapabilityExpansion {
  const catalog: readonly LocalComputerCapabilityEntry[] = LOCAL_COMPUTER_CAPABILITY_CATALOG;
  const riskCounts = { safe: 0, review: 0, external_side_effect: 0 };
  const gatedActKinds: string[] = [];
  const coordinateKinds: string[] = [];
  for (const entry of catalog) {
    riskCounts[entry.risk] += 1;
    if (entry.family === 'gated_act') gatedActKinds.push(entry.kind);
    if (entry.coordinate) coordinateKinds.push(entry.kind);
  }
  return {
    observeTools: getLocalComputerObserveTools(),
    gatedActKinds,
    coordinateKinds,
    riskCounts,
  };
}

// Apps with DEEP, script-backed desktop support (dedicated bridge tools beyond
// generic a11y/coordinate control): Adobe Photoshop/InDesign have script-backed
// document/layer tools; Finder has scoped file read/search/stat/write/trash.
// Everything else the bridge can drive falls back to GENERIC universal control.
const DEEP_SUPPORT_APP_IDS: ReadonlySet<string> = new Set([
  'adobe-photoshop',
  'adobe-indesign',
  'finder',
]);

export type AppDesktopSupportDepth = 'deep' | 'generic' | 'unknown';

/**
 * Honest depth of desktop support for an app the user named. 'deep' →
 * Adobe Photoshop/InDesign or Finder (script-backed tools); 'generic' → any
 * other known launchable app (universal a11y/coordinate control only);
 * 'unknown' → no known-app match. Never over-promises deep automation for
 * Figma/Blender/etc.
 */
export function describeAppDesktopSupport(appText: string): {
  depth: AppDesktopSupportDepth;
  appId: string | null;
  displayName: string | null;
} {
  const app = matchKnownApp(String(appText || ''));
  if (!app) return { depth: 'unknown', appId: null, displayName: null };
  return {
    depth: DEEP_SUPPORT_APP_IDS.has(app.id) ? 'deep' : 'generic',
    appId: app.id,
    displayName: app.displayName,
  };
}

/** Families whose name prefix is a single literal token used by tools.search. */
const KNOWN_FAMILY_TOKENS: ReadonlySet<string> = new Set(
  APP_CAPABILITIES.map((c) => c.family.split(/[.:]/)[0]).filter(Boolean),
);

/**
 * Lightweight keyword → family routing so the host can pre-suggest which
 * capability families a turn is likely to need (e.g. to widen `tools.search`
 * or to pre-warn the user about approvals). This is a HINT, not a gate: the
 * model still decides, and the real tool policy still enforces approvals.
 *
 * Ordering note: more specific families (design, wordpress, deploy) are checked
 * before broad ones (desktop, code) so a "edit this Photoshop file" message
 * resolves to the design family rather than only generic desktop.
 */
interface FamilyMatcher {
  family: string;
  patterns: RegExp[];
}

const FAMILY_MATCHERS: readonly FamilyMatcher[] = [
  {
    family: 'wp',
    patterns: [/\bwordpress\b/i, /\bwp[- ]?admin\b/i, /\bdealer\s*inspire\b/i, /\bdi[- ]?slide/i, /\bwoocommerce\b/i],
  },
  {
    family: 'desktop:design',
    patterns: [
      /\bphotoshop\b/i,
      /\bindesign\b/i,
      /\bfirefly\b/i,
      /\bgenerative (fill|expand|remove)\b/i,
      /\bdata[- ]?merge\b/i,
      /\b(psd|indd)\b/i,
      /\badobe\b/i,
    ],
  },
  {
    family: 'team.deploy_agents',
    patterns: [/\bdeploy\b.*\bagents?\b/i, /\bswarm\b/i, /\bfan[- ]?out\b/i, /\b(parallel|in parallel)\b.*\bagents?\b/i],
  },
  {
    family: 'browser',
    patterns: [/\bbrowser\b/i, /\bbrowserbase\b/i, /\bstagehand\b/i, /\bplaywright\b/i, /\blog ?in to\b/i, /\bnavigate\b/i, /\bweb ?form\b/i, /\bclick\b.*\bbutton\b/i],
  },
  {
    family: 'desktop',
    patterns: [
      /\bdesktop\b/i,
      /\bmy (mac|computer|machine)\b/i,
      /\blocal (file|app|folder)/i,
      /\bclipboard\b/i,
      /\bscreenshot\b/i,
      /\blaunch (the )?app\b/i,
      /\bopen (the )?app\b/i,
      /\bapplescript\b/i,
    ],
  },
  {
    family: 'github',
    patterns: [/\bgithub\b/i, /\bpull request\b/i, /\bpr\b/i, /\brepo(sitory)?\b/i, /\bcommit\b/i],
  },
  {
    family: 'code',
    patterns: [/\bcode\b/i, /\bfunction\b/i, /\bbug\b/i, /\bcompile\b/i, /\btypecheck\b/i, /\bunit test/i, /\blint\b/i, /\brefactor\b/i],
  },
  {
    family: 'vault',
    patterns: [/\bcredential/i, /\bvault\b/i, /\b1password\b/i, /\bapi key\b/i, /\bsecret/i, /\bgrant (access|automation)/i],
  },
  {
    family: 'integrations',
    patterns: [/\bintegration/i, /\bcustom api\b/i, /\bconnected (api|service)\b/i, /\bwebhook\b/i],
  },
  {
    family: 'rooms',
    patterns: [/\broom\b/i, /\bworkspace\b/i, /\bpreview\b/i, /\bplayground\b/i, /\bbuild (a|an|me) (page|app|site|component)\b/i],
  },
  {
    family: 'research',
    patterns: [/\bresearch\b/i, /\bsearch the web\b/i, /\blook ?up\b/i, /\bfetch\b.*\burl\b/i, /\bgo to (https?:\/\/|www\.)/i, /\bfind out\b/i],
  },
  {
    family: 'tasks',
    patterns: [/\btask\b/i, /\bgoal\b/i, /\bmission\b/i, /\bassign\b/i, /\bto-?do\b/i, /\bbacklog\b/i],
  },
  {
    family: 'messages',
    patterns: [/\bmessage\b/i, /\bcheck[- ]?in\b/i, /\bnotify\b/i, /\bschedule\b.*\b(post|tweet|email|reminder)\b/i, /\bcircle member/i],
  },
  {
    family: 'memory',
    patterns: [/\bremember\b/i, /\bremind me\b/i, /\bwhat did (i|we) (say|decide)/i, /\bsave (this|that) (for later|to memory)/i, /\brecall\b/i],
  },
  {
    family: 'skills',
    patterns: [/\bskill\b/i, /\brunbook\b/i, /\bplaybook\b/i],
  },
  {
    family: 'agent',
    patterns: [/\bbuild (a|the) capability\b/i, /\bconnected agent\b/i, /\bcodex\b/i, /\brecover (the )?(failed )?task\b/i, /\backquire asset/i],
  },
  {
    family: 'circle',
    patterns: [/\bbudget cap/i, /\boffice theme\b/i, /\bcircle setting/i, /\brename (the )?agent\b/i, /\bagent appearance\b/i],
  },
];

/**
 * Suggest the capability families a message is likely to need, most-specific
 * first, de-duplicated. Empty/whitespace input → []. This never throws and is
 * conservative: an unmatched message returns [] so the host falls back to the
 * model's own `tools.search` judgment rather than forcing a family.
 */
export function suggestCapabilitiesForMessage(message: string): string[] {
  const text = String(message || '').trim();
  if (!text) return [];

  const hits: string[] = [];
  const seen = new Set<string>();
  for (const matcher of FAMILY_MATCHERS) {
    if (seen.has(matcher.family)) continue;
    if (matcher.patterns.some((re) => re.test(text))) {
      hits.push(matcher.family);
      seen.add(matcher.family);
    }
  }
  return hits;
}

/** True if `family` is a real, known capability family token. */
export function isKnownCapabilityFamily(family: string | null | undefined): boolean {
  const token = String(family || '').trim().split(/[.:]/)[0].toLowerCase();
  if (!token) return false;
  return KNOWN_FAMILY_TOKENS.has(token);
}

export interface CapabilityManifestPromptOptions {
  /** Surface label for context, e.g. 'main_chat', 'office', 'room_chat'. */
  surface?: string;
  /**
   * Optional allowlist of family tokens to advertise. When provided, only
   * capabilities whose family token is in the list are listed (others stay
   * fully deferred). When omitted, the full manifest is summarized.
   */
  enabledFamilies?: string[];
}

/**
 * Build the compact system-prompt block that makes the model capability-aware.
 *
 * Design constraints:
 *   - SHORT. One intro line + one bullet per family (title — whenToUse, with a
 *     [approval] tag and a couple example tools). No JSON, no schemas.
 *   - Tells the model the default is to STREAM a plain answer, and to call
 *     `tools.search` to load the concrete tool only when a turn needs it.
 *   - Quiet-in-chat: capability discovery is silent; surface approvals/proof/
 *     blockers, not routing.
 *   - Always mentions `tools.search`, and the heavy families (browser/desktop/
 *     deploy_agents) so the model knows the powerful long-tail exists.
 */
export function buildCapabilityManifestPrompt(opts?: CapabilityManifestPromptOptions): string {
  const surface = (opts?.surface || 'chat').trim() || 'chat';
  const allow = normalizeFamilyAllowlist(opts?.enabledFamilies);

  const visible = allow
    ? APP_CAPABILITIES.filter((c) => allow.has(c.family.split(/[.:]/)[0].toLowerCase()))
    : APP_CAPABILITIES;

  const lines: string[] = [
    '## App Capabilities (model-selected)',
    `Surface: ${surface}. Default: answer normal turns by streaming a plain reply from your own reasoning.`,
    'When a turn actually needs to DO something in the app — operate a site/desktop app, touch files, run code, move team work, or deploy agents — ACTIVATE the matching capability instead of guessing.',
    'These tools are not all in this prompt. Call `tools.search` (query, optional `family`) to load the concrete tool + schema for the capability you need, then call that tool. Unlock only what the current step needs.',
    'Capability families available:',
  ];

  for (const cap of visible) {
    const examples = cap.exampleTools.slice(0, 3).join(', ');
    const gate = cap.approval === 'ask' ? 'approval' : 'auto';
    lines.push(`- ${cap.title} [${cap.family}] (${gate}) — ${cap.whenToUse} e.g. ${examples}.`);
    // Expand the coarse 'desktop' family into its real read-first menu + gated
    // actions so the model knows the local machine surface is much wider than a
    // single line. Advertisement only — gates are unchanged.
    if (cap.family === 'desktop') {
      const expansion = buildDesktopCapabilityExpansion();
      const observe = expansion.observeTools.slice(0, 8).join(', ');
      lines.push(
        `  · Read-first (auto/low-risk): ${observe}. Reach for these BEFORE any local action.`,
      );
      lines.push(
        `  · Gated actions (approval / observe-before): ${expansion.gatedActKinds.length} kinds incl. launch/focus/open, type/paste/press_keys, menu/semantic click, clipboard write/clear, file rename/copy/trash/mkdir/write, notes create, shortcut run, and Adobe design mutations.`,
      );
      lines.push(
        `  · Coordinate actions (${expansion.coordinateKinds.join(', ')}) need a FRESH screenshot before any blind coordinate click/drag.`,
      );
      lines.push(
        '  · Deep, script-backed support: Adobe Photoshop/InDesign and Finder. Other apps (Figma, Blender, etc.) get generic accessibility/coordinate control only — do not promise deep automation you cannot verify.',
      );
    }
  }

  lines.push(
    'Approval-gated families need human approval before any state-changing or external action; pre-warn the user, then proceed once approved. Never reveal secrets — vault tools authorize, they do not expose.',
    'Keep capability discovery and routing quiet in chat. Show the user only approvals, proof of work, or actionable blockers — not the search/activation chatter.',
    'You collaborate with BlackSwan/OpenSwan and any app-trained model from this same capability menu, so route consistently regardless of which model is answering.',
  );

  return lines.join('\n');
}

function normalizeFamilyAllowlist(input: string[] | undefined): Set<string> | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const set = new Set<string>();
  for (const raw of input) {
    const token = String(raw || '').trim().split(/[.:]/)[0].toLowerCase();
    if (token) set.add(token);
  }
  return set.size > 0 ? set : null;
}
