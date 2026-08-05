/**
 * appsChatCommand — the `/apps` user-facing window into app automation:
 *
 *   /apps            → overview: what apps chat can drive, grouped by status
 *   /apps <name…>    → one app's card: status in plain words, fastest lane,
 *                      profile-doc pointer, and a LIVE reachability line when
 *                      the caller injects a probe.
 *
 * Everything renders from `appAutomationDocsIndex` (the registry that keeps
 * docs/apps/*.md load-bearing), so this command can never drift from the
 * canonical profile set: counts, groups, and doc paths are computed from
 * APP_AUTOMATION_DOCS, and app lookup is resolveAppAutomationDoc. The only
 * hand-written parts are the plain-language lane phrases for the apps that
 * ship real tools today — and those cite ONLY tool facts recorded in the
 * profile docs (e.g. Photoshop's 12 script-backed tools, InDesign's 9,
 * `desktop.cad_compile` for FreeCAD/OpenSCAD/Blender). Never invent tool
 * names here; plain descriptions beat fake specifics.
 *
 * Live reachability is a deps seam (`AppsCommandDeps.probeReachability`),
 * wired centrally in ChatTab (it composes desktopBridge probes +
 * appReachability.describeAppReachabilityForChat). The probe resolves an
 * `AppsReachabilityProbeSummary` ({text, status, chatCanFix,
 * resolvedAppName}); older callers may still resolve the plain text string,
 * which is treated as {text, status:'unknown', chatCanFix:false}. The
 * summary powers reachability-aware quick fixes: when chat itself can clear
 * the blocker (needs_launch/needs_focus) the card exposes a fix chip via
 * `AppDetailResult.fixChip` → `buildAppsQuickReplies`' fixChip param, and
 * bridge_offline/bridge_outdated add a restart-the-bridge fix line to the
 * card body (a terminal action chat can't run, so no chip). A null return,
 * a throw, or an absent dep all degrade to the same honest static-profile
 * line — buildAppDetail NEVER throws.
 *
 * The overview has its own optional live seam: `AppsCommandDeps.browserStatus`
 * feeds `buildAppsOverviewWithLive`, which appends a bounded
 * "Browser surface: …" line under the static overview (ChatTab wires it
 * centrally; the sync `buildAppsOverview` stays unchanged for compat).
 *
 * This module executes nothing itself — no supabase, no react, no side
 * effects. The ChatTab/registry wiring lives with the orchestrator; this
 * file owns parse → overview/detail cards → quick replies only.
 *
 * CRITICAL: keep top-level imports pure (`appAutomationDocsIndex` is a pure
 * registry) so this module loads under tsx for
 * scripts/apps-chat-command-smoketest.ts.
 */

import {
  APP_AUTOMATION_DOCS,
  resolveAppAutomationDoc,
} from './appAutomationDocsIndex';
import type {
  AppAutomationDocEntry,
  AppAutomationDocStatus,
} from './appAutomationDocsIndex';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Compact reachability summary the injected probe resolves — a deliberately
 * narrow local mirror of `appReachability.AppReachabilityReport` (status is a
 * plain string, not the enum) so the dep stays trivially mockable in smokes.
 */
export interface AppsReachabilityProbeSummary {
  /** Ready-to-render reachability sentence (rides the Live reachability line). */
  text: string;
  /** An AppReachabilityStatus value ('needs_launch', 'bridge_offline', …). */
  status: string;
  /** True only when chat itself can clear the blocker after approval (launch/focus). */
  chatCanFix: boolean;
  /** Best-known display name from the live install probe, when it has one. */
  resolvedAppName?: string | null;
}

/** Injection seam — ChatTab wires the live probe; smoke tests inject fakes. */
export interface AppsCommandDeps {
  /** Live reachability check for one app (bridge status, install/running
   *  state, …). Resolves an AppsReachabilityProbeSummary — or, for older
   *  callers, just the ready-to-render sentence (treated as
   *  {text, status:'unknown', chatCanFix:false}) — or null when nothing
   *  live is known. Absent dep, null return, and throws all fall back to the
   *  same static-profile line — the card always renders. */
  probeReachability?: (
    appName: string,
  ) => Promise<AppsReachabilityProbeSummary | string | null>;
  /** Live browser-surface status line for the overview footer (e.g. active
   *  Browserbase/managed-browser session state). Our own runtime's wording —
   *  NOT untrusted page content. Resolves a short line, or null when nothing
   *  live is known. Absent dep, null/empty return, and throws all leave the
   *  base overview untouched — `buildAppsOverviewWithLive` NEVER throws. */
  browserStatus?: () => Promise<string | null>;
}

export interface AppDetailResult {
  /** The rendered chat card (found) or honest miss + suggestions (not found). */
  message: string;
  /** Registry slug when the query resolved (feed to buildAppsQuickReplies). */
  resolvedSlug: string | null;
  /** Reachability-aware quick-fix chip ("Open Adobe Photoshop for me" /
   *  "Bring … to the front") when the live probe says chat itself can clear
   *  the blocker — feed it to buildAppsQuickReplies' fixChip param. Null
   *  when there is nothing chat can fix (or no live summary). */
  fixChip: string | null;
}

// ─── Bounds (CLAUDE.md: bounded payloads) ────────────────────────────────────

/** App queries are names, not briefs — long input is not this command's job. */
export const MAX_APPS_QUERY_LENGTH = 120;
export const MAX_APPS_OVERVIEW_LENGTH = 1_800;
export const MAX_APPS_DETAIL_LENGTH = 1_400;
/** Budget for the injected probe's live result inside the detail card. */
export const MAX_APPS_PROBE_RESULT_LENGTH = 400;
/** Budget for the live browser-surface line under the overview. */
export const MAX_APPS_BROWSER_STATUS_LENGTH = 200;
export const MAX_APPS_QUICK_REPLIES = 4;
export const MAX_APPS_QUICK_REPLY_LENGTH = 64;

/** The honest degrade line — absent dep, null probe, and probe throws all
 *  render this exact sentence so the card never dies on a dead bridge. */
export const APPS_REACHABILITY_FALLBACK_LINE =
  'Live reachability: bridge offline or probe unavailable — showing the static profile.';

// ─── Command parsing ─────────────────────────────────────────────────────────

/**
 * Parse an `/apps` chat command.
 *
 * Returns null when the input is not this command (fall through to the next
 * handler — the command must be a whole token, so `/appsx …` is not ours).
 * Grammar: `/apps` → overview (`appQuery: null`); `/apps <name…>` → app
 * detail with the rest joined as the query. Case-insensitive; inner
 * whitespace collapses so `/apps  Affinity   Designer ` still resolves.
 */
export function parseAppsCommand(
  raw: string,
): { ok: true; appQuery: string | null } | { ok: false; error: string } | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/apps(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const appQuery = (match[1] || '').replace(/\s+/g, ' ').trim();
  if (!appQuery) return { ok: true, appQuery: null };
  if (appQuery.length > MAX_APPS_QUERY_LENGTH) {
    return {
      ok: false,
      error:
        `That /apps lookup is too long (${appQuery.length} chars — max ${MAX_APPS_QUERY_LENGTH}). ` +
        'Give me just the app name, e.g. `/apps photoshop` — or run `/apps` for the full list.',
    };
  }
  return { ok: true, appQuery };
}

// ─── Plain-language status + lane phrasing ───────────────────────────────────
// Statuses never leak as raw enum values; lane phrases cite only facts from
// the docs/apps/ profiles (tool counts, cad_compile engines, "no scripting
// API"). Overview phrases stay tool-name-free — names belong in detail view.

const STATUS_PLAIN_WORDS: Record<AppAutomationDocStatus, string> = {
  executable: 'Executable — real script-backed tools ship today',
  partial: 'Partially automated — some real tools today; the rest is careful, approval-gated UI driving',
  buildout_only: 'Buildout-only — no dedicated tools yet; ask chat to build the adapter',
  web_only: 'Web-only — chat drives it in the browser, not as a desktop app',
  cloud_service: 'Cloud service — driven over its API once connected in Marketplace, no desktop install',
};

/** Overview one-phrase lanes for the apps that ship something real today.
 *  Plain words only — no `desktop.*` tool names in the overview. */
const OVERVIEW_LANE_PHRASES: Record<string, string> = {
  photoshop: '12 script-backed tools',
  indesign: '9 script-backed tools',
  freecad: 'headless CAD convert + inspect',
  openscad: 'code-CAD compile with PNG proofs',
  blender: 'headless mesh convert + render proofs',
  illustrator: 'status + proof-export tools',
  autocad: 'DXF inspect/convert + typed commands',
  rhino: 'typed commands + export checks',
  'matlab-simulink': 'MCP tools when configured',
  'affinity-designer': 'menu driving only (no script API)',
  'affinity-photo': 'menu driving only (no script API)',
};

const GENERIC_OVERVIEW_PHRASES: Record<AppAutomationDocStatus, string> = {
  executable: 'script-backed tools ship today',
  partial: 'some real tools today',
  buildout_only: 'adapter buildout on request',
  web_only: 'browser automation',
  cloud_service: 'API automation once connected',
};

/** Detail "fastest lane" one-liners for the executable/partial apps —
 *  hand-written from each app's docs/apps/ profile. Tool names cited here
 *  (`desktop.cad_compile`) are real bridge tools recorded in those docs. */
const DETAIL_LANE_LINES: Record<string, string> = {
  photoshop:
    'Fastest lane: 12 script-backed tools drive the open document — layer state, text edits, selection masks, ' +
    'adjustment layers, resize/crop, and proof exports. Mutations wait for your approval and never auto-save.',
  indesign:
    'Fastest lane: 9 script-backed tools drive the open document — text updates, batch find/change, relinking, ' +
    'print packaging, and proof exports. Mutations wait for your approval and nothing auto-saves.',
  illustrator:
    'Fastest lane: real document-status and proof-export tools ship now; vector edits beyond that ride the ' +
    'generic desktop ladder or a connected-agent adapter buildout.',
  freecad:
    'Fastest lane: headless convert + inspect via `desktop.cad_compile` (freecadcmd engine) — STEP/IGES/FCStd/DXF ' +
    'in, STEP/STL/DXF out, output verified on disk, no GUI session needed.',
  openscad:
    'Fastest lane: code-CAD via `desktop.cad_compile` (openscad engine) — chat writes the .scad program, then ' +
    'compiles STL/3MF/DXF and renders PNG proofs fully headlessly.',
  blender:
    'Fastest lane: headless bpy via `desktop.cad_compile` (blender engine) — mesh format conversion plus PNG ' +
    'render proofs; interactive scene work stays screenshot-driven and last-resort.',
  autocad:
    'Fastest lane: DXF inspection and conversion work with no app open; live drafting types native commands ' +
    'into the AutoCAD command line — one approved, screenshot-verified step at a time.',
  rhino:
    'Fastest lane: typed native commands in a running Rhino plus structural checks of exported STL/STEP files; ' +
    'native .3dm files are honestly unreadable locally.',
  'matlab-simulink':
    'Fastest lane: MATLAB MCP tools (code check, evaluate, run, test) when your MATLAB MCP server is configured; ' +
    'otherwise chat drafts scripts you run and verifies the written outputs.',
  'affinity-designer':
    'Fastest lane: approval-gated menu/dialog driving via accessibility (Affinity has no scripting API) — ' +
    'export via File > Export with output verification; canvas edits stay manual.',
  'affinity-photo':
    'Fastest lane: approval-gated menu/dialog driving via accessibility (Affinity has no scripting API); plain ' +
    'raster conversions often skip the app entirely via local file tools.',
};

const GENERIC_LANE_LINES: Record<AppAutomationDocStatus, string> = {
  executable: 'Fastest lane: dedicated script-backed tools ship today — the profile doc lists exactly what they cover.',
  partial: 'Fastest lane: a few real tools plus careful, approval-gated UI driving — the profile doc ranks the surfaces.',
  buildout_only:
    "Fastest lane: nothing dedicated is built yet — ask chat to build the adapter and it follows the profile doc's ranked control surfaces.",
  web_only: 'Fastest lane: browser automation — chat drives the web app in a managed browser session.',
  cloud_service: 'Fastest lane: API calls once the service is connected in Marketplace — no desktop app involved.',
};

// ─── Overview ────────────────────────────────────────────────────────────────

function groupByStatus(): Record<AppAutomationDocStatus, AppAutomationDocEntry[]> {
  const groups: Record<AppAutomationDocStatus, AppAutomationDocEntry[]> = {
    executable: [], partial: [], buildout_only: [], web_only: [], cloud_service: [],
  };
  for (const doc of APP_AUTOMATION_DOCS) groups[doc.status].push(doc);
  return groups;
}

function overviewBullet(doc: AppAutomationDocEntry): string {
  const phrase = OVERVIEW_LANE_PHRASES[doc.slug] || GENERIC_OVERVIEW_PHRASES[doc.status];
  return `• ${doc.appName} — ${phrase}`;
}

/**
 * `/apps` overview: counts by status, the executable/partial apps each with a
 * one-phrase lane, the remaining groups as name lists, and a usage hint.
 * Plain language, no raw tool names — those belong in the detail view.
 */
export function buildAppsOverview(): string {
  const groups = groupByStatus();
  const lines: string[] = [
    `🖥️ **Apps chat can drive** — ${APP_AUTOMATION_DOCS.length} app profiles: ` +
      `${groups.executable.length} ready now, ${groups.partial.length} partly automated, ` +
      `${groups.buildout_only.length} buildout-only, ${groups.web_only.length} web-only, ` +
      `${groups.cloud_service.length} cloud services.`,
  ];

  if (groups.executable.length > 0) {
    lines.push('', '**Ready now (script-backed):**', ...groups.executable.map(overviewBullet));
  }
  if (groups.partial.length > 0) {
    lines.push('', '**Partly automated:**', ...groups.partial.map(overviewBullet));
  }
  const nameList = (docs: AppAutomationDocEntry[]) => docs.map((doc) => doc.appName).join(', ');
  if (groups.buildout_only.length > 0) {
    lines.push('', `**Buildout-only** — ask chat to build the adapter: ${nameList(groups.buildout_only)}.`);
  }
  if (groups.web_only.length > 0) {
    lines.push(`**Web-only** — driven in the browser: ${nameList(groups.web_only)}.`);
  }
  if (groups.cloud_service.length > 0) {
    lines.push(`**Cloud services** — connect in Marketplace: ${nameList(groups.cloud_service)}.`);
  }

  lines.push('', 'Try `/apps photoshop` for details and a live reachability check.');
  return clampBlock(lines.join('\n'), MAX_APPS_OVERVIEW_LENGTH);
}

/**
 * `/apps` overview + an optional LIVE browser-surface status line. The sync
 * `buildAppsOverview` above stays exported and unchanged (compat path); this
 * async variant appends `\n\nBrowser surface: <line>` when the injected
 * `deps.browserStatus` resolves one. The line is collapsed to a single line
 * and clamped to {@link MAX_APPS_BROWSER_STATUS_LENGTH}, so the combined
 * output stays ≤ MAX_APPS_OVERVIEW_LENGTH + the bounded suffix. Absent dep,
 * null/empty/whitespace return, and a throwing dep all return the base
 * overview unchanged — NEVER throws.
 */
export async function buildAppsOverviewWithLive(deps?: AppsCommandDeps): Promise<string> {
  const base = buildAppsOverview();
  if (!deps?.browserStatus) return base;
  try {
    const raw = await deps.browserStatus();
    const line = typeof raw === 'string' ? clampInline(raw, MAX_APPS_BROWSER_STATUS_LENGTH) : '';
    if (!line) return base;
    return `${base}\n\nBrowser surface: ${line}`;
  } catch {
    // Live browser state is a bonus — the overview never dies over it.
    return base;
  }
}

// ─── Detail card ─────────────────────────────────────────────────────────────

/**
 * A query string that actually round-trips through resolveAppAutomationDoc
 * back to `doc`. Usually the app name; falls back to the first resolvable
 * alias for the odd entries whose display name is not its own alias (Sketch:
 * "sketch" resolves nothing, "sketch app" does).
 */
function resolvableQueryFor(doc: AppAutomationDocEntry): string {
  if (resolveAppAutomationDoc(doc.appName)?.slug === doc.slug) return doc.appName;
  for (const alias of doc.aliases) {
    if (resolveAppAutomationDoc(alias)?.slug === doc.slug) return alias;
  }
  return doc.appName;
}

/**
 * Simple includes-scoring for did-you-mean: the score is the length of the
 * longest chunk of the query found inside the candidate's name/slug/aliases
 * (whole-query containment gets a bonus). "fotoshop" → "photoshop" via the
 * shared "otoshop" run; ties break on registry order.
 */
function includesScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate.includes(query)) return query.length + 1;
  const maxLen = Math.min(query.length, candidate.length);
  for (let len = maxLen; len >= 2; len--) {
    for (let start = 0; start + len <= query.length; start++) {
      if (candidate.includes(query.slice(start, start + len))) return len;
    }
  }
  return 0;
}

function closestDocs(query: string, count: number): AppAutomationDocEntry[] {
  const needle = query.toLowerCase();
  return APP_AUTOMATION_DOCS
    .map((doc, index) => ({
      doc,
      index,
      score: includesScore(
        needle,
        `${doc.appName} ${doc.slug} ${doc.aliases.join(' ')}`.toLowerCase(),
      ),
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, count)
    .map((entry) => entry.doc);
}

function buildMissMessage(appQuery: string): string {
  const suggestions = closestDocs(appQuery, 3)
    .map((doc) => `\`/apps ${resolvableQueryFor(doc)}\``)
    .join(', ');
  return (
    `No automation profile matches "${clampInline(appQuery, 60)}" yet. ` +
    `Closest matches: ${suggestions} — or run \`/apps\` for the full list of what chat can drive.`
  );
}

/**
 * Accepts the probe's new summary shape OR the legacy plain-string return
 * (older callers) — a bare string becomes {text, status:'unknown',
 * chatCanFix:false}. Anything unreadable normalizes to null (fallback line).
 */
function normalizeProbeResult(probed: unknown): AppsReachabilityProbeSummary | null {
  if (typeof probed === 'string') {
    return { text: probed, status: 'unknown', chatCanFix: false };
  }
  if (probed && typeof probed === 'object') {
    const record = probed as Partial<AppsReachabilityProbeSummary>;
    if (typeof record.text === 'string') {
      return {
        text: record.text,
        status: typeof record.status === 'string' ? record.status : 'unknown',
        chatCanFix: record.chatCanFix === true,
        resolvedAppName:
          typeof record.resolvedAppName === 'string' && record.resolvedAppName.trim()
            ? record.resolvedAppName.trim()
            : null,
      };
    }
  }
  return null;
}

/**
 * `/apps <name…>` detail card. Resolves via resolveAppAutomationDoc; a miss
 * returns an honest not-found line with the 3 closest suggestions. A hit
 * renders name, status in plain words, the fastest-lane one-liner, the
 * profile-doc path, and a live reachability line — the injected probe's
 * text when it delivers one, the static-profile fallback otherwise.
 * A live probe summary also powers the reachability-aware quick fixes:
 * needs_launch/needs_focus with chatCanFix → a fix chip in `fixChip`;
 * bridge_offline/bridge_outdated → a restart-the-bridge fix line in the body
 * (terminal action chat can't run, so no chip).
 * NEVER throws: garbage queries, probe failures, and absent deps all render.
 */
export async function buildAppDetail(
  appQuery: string,
  deps?: AppsCommandDeps,
): Promise<AppDetailResult> {
  const query = String(appQuery ?? '').replace(/\s+/g, ' ').trim();
  if (!query) {
    return {
      message:
        'Tell me which app — e.g. `/apps photoshop`. Or run `/apps` for the full list of what chat can drive.',
      resolvedSlug: null,
      fixChip: null,
    };
  }

  let doc: AppAutomationDocEntry | null = null;
  try {
    doc = resolveAppAutomationDoc(query);
  } catch {
    doc = null;
  }
  if (!doc) {
    return { message: buildMissMessage(query), resolvedSlug: null, fixChip: null };
  }

  let reachabilityLine = APPS_REACHABILITY_FALLBACK_LINE;
  let probeSummary: AppsReachabilityProbeSummary | null = null;
  if (deps?.probeReachability) {
    try {
      probeSummary = normalizeProbeResult(await deps.probeReachability(doc.appName));
      const text = probeSummary ? probeSummary.text.trim() : '';
      if (text) {
        reachabilityLine = `Live reachability: ${clampBlock(text, MAX_APPS_PROBE_RESULT_LENGTH)}`;
      }
    } catch {
      // Probe blew up — the static card still renders with the fallback line.
      probeSummary = null;
    }
  }

  // Reachability-aware quick fixes: chip only for the blockers chat itself
  // can clear after approval (launch/focus); the bridge states get a fix
  // line in the body instead — restarting the bridge is terminal work.
  const probeStatus = probeSummary ? probeSummary.status.trim().toLowerCase() : '';
  const fixAppName = probeSummary?.resolvedAppName || doc.appName;
  let fixChip: string | null = null;
  if (probeSummary?.chatCanFix === true && probeStatus === 'needs_launch') {
    fixChip = clampInline(`Open ${fixAppName} for me`, MAX_APPS_QUICK_REPLY_LENGTH);
  } else if (probeSummary?.chatCanFix === true && probeStatus === 'needs_focus') {
    fixChip = clampInline(`Bring ${fixAppName} to the front`, MAX_APPS_QUICK_REPLY_LENGTH);
  }
  const bridgeFixLine =
    probeStatus === 'bridge_outdated' || probeStatus === 'bridge_offline'
      ? `Fix: restart the bridge with npm run bridge, then run /apps ${doc.slug} again.`
      : null;

  const lines = [
    `🖥️ **${doc.appName} — automation profile**`,
    `Status: ${STATUS_PLAIN_WORDS[doc.status]}.`,
    DETAIL_LANE_LINES[doc.slug] || GENERIC_LANE_LINES[doc.status],
    `Full profile: ${doc.docPath}`,
    reachabilityLine,
    ...(bridgeFixLine ? [bridgeFixLine] : []),
  ];
  return {
    message: clampBlock(lines.join('\n'), MAX_APPS_DETAIL_LENGTH),
    resolvedSlug: doc.slug,
    fixChip,
  };
}

// ─── Quick replies ───────────────────────────────────────────────────────────

const OVERVIEW_QUICK_REPLIES = ['/apps photoshop', '/apps freecad', '/apps figma'];

/** Realistic next-step task phrases for the apps with real lanes today —
 *  each one is a request the routed pipelines can genuinely start on. */
const DETAIL_TASK_REPLIES: Record<string, string> = {
  photoshop: 'Remove the background from my open Photoshop file',
  indesign: 'Update the headline text in my InDesign document',
  illustrator: 'Export a PNG proof from my Illustrator file',
  freecad: 'Convert my STEP file to STL with FreeCAD',
  openscad: 'Model a 40mm bracket in OpenSCAD with a PNG proof',
  blender: 'Convert my OBJ to glTF with Blender',
  autocad: 'List the layers in my DXF drawing',
  rhino: 'Inspect my STL export from Rhino',
  'matlab-simulink': 'Run my MATLAB script and capture the output',
  'affinity-designer': 'Export my Affinity Designer file as a PNG',
  'affinity-photo': 'Convert my Affinity Photo export to JPG',
};

function detailTaskReply(doc: AppAutomationDocEntry): string {
  const mapped = DETAIL_TASK_REPLIES[doc.slug];
  if (mapped) return mapped;
  switch (doc.status) {
    case 'web_only':
      return `Open ${doc.appName} in the browser and start my task`;
    case 'buildout_only':
      return `Build the ${doc.appName} adapter for chat`;
    case 'cloud_service':
      return `Connect ${doc.appName} in Marketplace`;
    default:
      return `What can chat do in ${doc.appName}?`;
  }
}

/**
 * Quick replies for the `/apps` cards — ≤4 strings, each ≤64 chars.
 * Overview → three representative detail lookups. Detail → one realistic
 * next-step phrase for the resolved app's status/slug plus the way back to
 * the overview; an unresolved detail (miss card) gets the overview trio.
 * A reachability fix chip (`AppDetailResult.fixChip`) goes FIRST when
 * provided — the ≤4 × ≤64 bounds still hold with it in the list.
 */
export function buildAppsQuickReplies(
  overview: boolean,
  resolvedSlug?: string | null,
  fixChip?: string | null,
): string[] {
  const clamp = (replies: string[]) =>
    replies.slice(0, MAX_APPS_QUICK_REPLIES).map((reply) => clampInline(reply, MAX_APPS_QUICK_REPLY_LENGTH));
  const chip = typeof fixChip === 'string' ? fixChip.replace(/\s+/g, ' ').trim() : '';
  const withFix = (replies: string[]) => (chip ? [chip, ...replies] : replies);

  if (overview) return clamp(withFix(OVERVIEW_QUICK_REPLIES));

  const doc = resolvedSlug
    ? APP_AUTOMATION_DOCS.find((entry) => entry.slug === resolvedSlug) ?? null
    : null;
  if (!doc) return clamp(withFix(OVERVIEW_QUICK_REPLIES));
  return clamp(withFix([detailTaskReply(doc), '/apps']));
}

// ─── Small utilities ─────────────────────────────────────────────────────────

/** Single-line clamp — collapses whitespace so echoes/replies stay one line. */
function clampInline(text: string, max: number): string {
  const collapsed = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Block clamp — preserves newlines, caps total length. */
function clampBlock(text: string, max: number): string {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}
