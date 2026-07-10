/**
 * screenChatCommand — PURE parsing + formatting for the `/screen` chat
 * command ("what's on my screen and what should we do next?"):
 *
 *   /screen             → observe the frontmost app
 *   /screen <app name>  → observe a named app
 *
 * The LIVE composition (bridge observeApp → snapshotA11ySummary → diff vs
 * last look → classifyA11yDiffOutcome → buildAppScreenNextStep) lives in
 * src/lib/appScreenObserver.ts — the impure sibling, mirroring
 * appReachabilityProbe.ts. This module owns parse → report card → quick
 * replies ONLY, so scripts/screen-chat-command-smoketest.ts can execute it
 * under tsx (MEMORY: smoke-tests-need-pure-modules). Type-only imports only;
 * no react-native, no supabase, no bridge.
 *
 * Dependency direction stays pure ← impure: the observation input shape
 * (`ScreenChatObservation`) is defined HERE and appScreenObserver imports
 * the type from us, never the other way around.
 *
 * SECURITY: window titles and dialog labels are app/page-controlled
 * UNTRUSTED text (same channel as the E6 note on
 * `fenceUntrustedObservationText` in src/lib/openswanToolRuntime.ts). Every
 * such fragment renders through {@link fenceUntrustedScreenText}; structural
 * wording (our own fixed copy, charset-stripped app names, +/−/~ counts)
 * stays outside the fence so the reader can still trust it.
 */

import type { AppScreenNextStepResult } from './appScreenNextStep';
import type { A11yDiffOutcome } from './a11yTreeDiff';

// ─── Bounds (CLAUDE.md: bounded payloads) ────────────────────────────────────

/** App queries are names, not briefs — same cap as `/apps`. */
export const MAX_SCREEN_QUERY_LENGTH = 120;
/** Hard cap on the rendered report card. */
export const MAX_SCREEN_REPORT_LENGTH = 1_200;
export const MAX_SCREEN_QUICK_REPLIES = 3;
export const MAX_SCREEN_QUICK_REPLY_LENGTH = 64;
/** Window titles rendered on the card (more collapse into "+K more"). */
export const MAX_SCREEN_WINDOW_TITLES_SHOWN = 3;
/** Per-title display clamp applied BEFORE fencing. */
export const MAX_SCREEN_WINDOW_TITLE_CHARS = 60;
/** Dialog labels rendered on the suggested-next line. */
export const MAX_SCREEN_DIALOG_LABELS_SHOWN = 3;
const SCREEN_DIALOG_LABEL_CHARS = 60;
const SCREEN_HEADS_UP_MAX_CHARS = 400;
const SAFE_NAME_MAX_CHARS = 60;

// ─── Observation shape (impure composer imports this type) ──────────────────

/** Compact +/−/~ summary of what changed since the last `/screen` look. */
export interface ScreenChatDiffSummary {
  /** Pre-cap totals from diffA11ySummaries (addedTotal/removedTotal/changedTotal). */
  added: number;
  removed: number;
  changed: number;
  outcome: A11yDiffOutcome;
}

/**
 * One app-screen observation, ready for formatting. Built by
 * `runAppScreenObservation` in src/lib/appScreenObserver.ts; smokes build it
 * by hand. `windowTitles` are RAW app-controlled text — ONLY
 * {@link formatScreenReportForChat} may render them, and it fences every one.
 */
export interface ScreenChatObservation {
  /** Resolved app name (task-side identity; charset-stripped before display). */
  appName: string;
  appRunning: boolean;
  frontmost: boolean;
  frontmostApp: string | null;
  windowCount: number;
  /** RAW untrusted titles (≤8 × ≤160 chars from the bridge). */
  windowTitles: string[];
  /** Nodes walked by the a11y read (bridge `budget_used`). */
  a11yNodeCount: number;
  /** Null on the first look at an app (no baseline to diff against). */
  diff: ScreenChatDiffSummary | null;
  /** Deterministic advice from buildAppScreenNextStep (dialogLabels RAW). */
  advice: AppScreenNextStepResult;
}

// ─── Command parsing ─────────────────────────────────────────────────────────

/**
 * Parse a `/screen` chat command.
 *
 * Returns null when the input is not this command (whole-token only —
 * `/screenx …` falls through to the next handler). Grammar: `/screen` →
 * frontmost app (`appName: null`); `/screen <name…>` → named app with inner
 * whitespace collapsed. Case-insensitive. Over-long names fail closed.
 */
export function parseScreenCommand(
  raw: string,
): { ok: true; appName: string | null } | { ok: false; error: string } | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/screen(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const appName = (match[1] || '').replace(/\s+/g, ' ').trim();
  if (!appName) return { ok: true, appName: null };
  if (appName.length > MAX_SCREEN_QUERY_LENGTH) {
    return {
      ok: false,
      error:
        `That /screen lookup is too long (${appName.length} chars — max ${MAX_SCREEN_QUERY_LENGTH}). ` +
        'Give me just the app name, e.g. `/screen photoshop` — or run `/screen` for whatever is in front.',
    };
  }
  return { ok: true, appName };
}

// ─── Untrusted-content fence ─────────────────────────────────────────────────

/**
 * LOCKSTEP copy of `fenceUntrustedObservationText` in
 * src/lib/openswanToolRuntime.ts (~4731, the E6 fence): wrap the body in the
 * codebase's `<untrusted_quoted>` fence, neutralizing embedded fence tags
 * first so observed content (window titles, dialog labels) cannot break out
 * and smuggle instructions. This pure module cannot import the runtime (it
 * is react-native-heavy and would kill the tsx smoke), so it carries a
 * minimal byte-identical duplicate — the established convention for
 * runtime-unreachable duplicates (see computerUseSteering.ts, whose marker +
 * bound are duplicated into the Deno edge function, and the
 * `fenceLikeRuntime` mirror in scripts/a11y-tree-diff-smoketest.ts). Keep
 * the two implementations in lockstep.
 */
export function fenceUntrustedScreenText(text: string): string {
  const body = String(text ?? '').replace(/<\s*(\/?)\s*untrusted_quoted\s*>/gi, '[$1untrusted_quoted-tag-removed]');
  return `<untrusted_quoted>\n${body}\n</untrusted_quoted>`;
}

// ─── Small helpers (self-contained, never throw) ─────────────────────────────

function collapseWhitespace(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

function clampInline(text: string, max: number): string {
  const collapsed = collapseWhitespace(text);
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * App names render OUTSIDE the untrusted fence, so they are charset-stripped
 * to [A-Za-z0-9 ._()-] and bounded — same posture as `safeAppName` in
 * src/lib/appScreenNextStep.ts (structural tokens must stay trustworthy).
 */
function safeScreenAppName(raw: unknown, fallback = 'the app'): string {
  const cleaned = collapseWhitespace(raw)
    .replace(/[^A-Za-z0-9 ._()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAFE_NAME_MAX_CHARS)
    .trim();
  return cleaned || fallback;
}

function safeCount(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// ─── Report card ─────────────────────────────────────────────────────────────

const SCREEN_REPORT_FALLBACK =
  "I couldn't get a screen observation — the desktop bridge may be offline. " +
  'Start it with `npm run bridge`, then run /screen again.';

/**
 * Render one observation as a novice-friendly chat card, hard-bounded to
 * ≤{@link MAX_SCREEN_REPORT_LENGTH} chars:
 *
 *   headline    — app + running/frontmost state (structural, safe names)
 *   Windows:    — ≤3 titles, ALL inside one untrusted fence, "+K more" outside
 *   Since my last look: — plain-words diff (+N −N ~N) when a baseline existed
 *   Suggested next:     — advice.nextStep.hint (structural wording); dialog
 *                         labels ride along inside their own fence; for
 *                         launch/focus the card offers "I can … — just say so"
 *   Heads up:   — advice.blockers when present (structural wording)
 *
 * NO raw tool names are rendered (the advice `tool` field never appears).
 * Assembly is atomic per line, so an expanding fence is never sliced open and
 * the char budget always holds. NEVER throws — degenerate input degrades to
 * a bridge-offline hint.
 */
export function formatScreenReportForChat(obs: ScreenChatObservation | null | undefined): string {
  if (
    !obs || typeof obs !== 'object' ||
    !obs.advice || typeof obs.advice !== 'object' ||
    !obs.advice.nextStep || typeof obs.advice.nextStep !== 'object'
  ) {
    return SCREEN_REPORT_FALLBACK;
  }

  const name = safeScreenAppName(obs.appName);
  const front = safeScreenAppName(obs.frontmostApp, '');
  const running = obs.appRunning === true;
  const frontmost = obs.frontmost === true;
  const windowCount = safeCount(obs.windowCount);

  // Atomic line assembly: a line lands whole or not at all, with 2 chars
  // reserved for a final "…" line — so ≤MAX_SCREEN_REPORT_LENGTH always
  // holds and a fenced block can never be cut mid-tag.
  const lines: string[] = [];
  let used = 0;
  let exhausted = false;
  const push = (line: string): void => {
    if (exhausted || !line) return;
    const cost = (lines.length > 0 ? 1 : 0) + line.length;
    if (used + cost > MAX_SCREEN_REPORT_LENGTH - 2) {
      exhausted = true;
      return;
    }
    lines.push(line);
    used += cost;
  };

  // 1. Headline — structural state in plain words.
  if (!running) {
    push(`🖥️ **${name}** isn't running right now${front ? ` — **${front}** is in front` : ''}.`);
  } else if (!frontmost) {
    push(`🖥️ **${name}** is running but ${front ? `**${front}**` : 'another app'} is in front.`);
  } else {
    push(
      `🖥️ **${name}** is in front with ${
        windowCount === 0 ? 'no windows' : `${windowCount} window${windowCount === 1 ? '' : 's'}`
      } open.`,
    );
  }

  // 2. Window titles — RAW app text, so every title goes inside ONE fence;
  // the "+K more" tail stays outside (structural).
  const titles = (Array.isArray(obs.windowTitles) ? obs.windowTitles : [])
    .map((title) => clampInline(String(title ?? ''), MAX_SCREEN_WINDOW_TITLE_CHARS))
    .filter(Boolean);
  if (running && titles.length > 0) {
    const shown = titles.slice(0, MAX_SCREEN_WINDOW_TITLES_SHOWN);
    const more = titles.length - shown.length;
    push(`Windows: ${fenceUntrustedScreenText(shown.join(' | '))}${more > 0 ? ` (+${more} more)` : ''}`);
  }

  // 3. What changed since the last look — plain words + compact counts.
  if (obs.diff && typeof obs.diff === 'object') {
    const added = safeCount(obs.diff.added);
    const removed = safeCount(obs.diff.removed);
    const changed = safeCount(obs.diff.changed);
    if (obs.diff.outcome === 'no_change' || added + removed + changed === 0) {
      push('Since my last look: nothing has changed.');
    } else {
      push(
        `Since my last look: ${added} thing${added === 1 ? '' : 's'} appeared, ` +
          `${removed} went away, ${changed} changed (+${added} −${removed} ~${changed}).`,
      );
    }
  }

  // 4. Suggested next — structural hint wording; dialog labels are RAW so
  // they ride inside their own fence. No raw tool names: the only
  // chat-can-act phrasing is the launch/focus "just say so" offer.
  const kind = obs.advice.nextStep.kind;
  const hint = collapseWhitespace(obs.advice.nextStep.hint) || 'Take another look and decide from there.';
  let offer = '';
  if (kind === 'launch_app') offer = ' I can open it for you — just say so.';
  else if (kind === 'focus_app') offer = ' I can bring it to the front — just say so.';
  push(`Suggested next: ${hint}${offer}`);

  const dialogLabels = (Array.isArray(obs.advice.dialogLabels) ? obs.advice.dialogLabels : [])
    .map((label) => clampInline(String(label ?? ''), SCREEN_DIALOG_LABEL_CHARS))
    .filter(Boolean)
    .slice(0, MAX_SCREEN_DIALOG_LABELS_SHOWN);
  if (dialogLabels.length > 0) {
    push(`The dialog says: ${fenceUntrustedScreenText(dialogLabels.join(' | '))}`);
  }

  // 5. Heads up — structural blocker wording from the advisor.
  const blockers = (Array.isArray(obs.advice.blockers) ? obs.advice.blockers : [])
    .map((blocker) => collapseWhitespace(blocker))
    .filter(Boolean);
  if (blockers.length > 0) {
    push(`Heads up: ${clampInline(blockers.join('; '), SCREEN_HEADS_UP_MAX_CHARS)}`);
  }

  if (exhausted) lines.push('…');
  return lines.join('\n') || SCREEN_REPORT_FALLBACK;
}

// ─── Quick replies ───────────────────────────────────────────────────────────

/**
 * ≤{@link MAX_SCREEN_QUICK_REPLIES} chips, each
 * ≤{@link MAX_SCREEN_QUICK_REPLY_LENGTH} chars. Deliberately minimal: chips
 * only for the states chat can act on right now —
 *
 *   launch_app                    → "Open <app> for me"
 *   focus_app                     → "Bring <app> to the front"
 *   handle_dialog / confirm_with_user → "What are my options?"
 *   everything else               → [] (no chip beats a noisy chip)
 *
 * App names are charset-stripped (they render as tappable chips). NEVER
 * throws on degenerate input.
 */
export function buildScreenQuickReplies(obs: ScreenChatObservation | null | undefined): string[] {
  const kind = obs?.advice?.nextStep?.kind;
  if (!kind) return [];
  const name = safeScreenAppName(obs?.appName);
  let replies: string[];
  switch (kind) {
    case 'launch_app':
      replies = [`Open ${name} for me`];
      break;
    case 'focus_app':
      replies = [`Bring ${name} to the front`];
      break;
    case 'handle_dialog':
    case 'confirm_with_user':
      replies = ['What are my options?'];
      break;
    default:
      return [];
  }
  return replies
    .slice(0, MAX_SCREEN_QUICK_REPLIES)
    .map((reply) => clampInline(reply, MAX_SCREEN_QUICK_REPLY_LENGTH));
}
