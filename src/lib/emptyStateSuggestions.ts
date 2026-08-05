/**
 * emptyStateSuggestions.ts — reusable, deterministic "next action" suggestions
 * for first-time (empty) surfaces.
 *
 * WHY: first-time non-chat surfaces render "No X yet" voids with no guidance,
 * which is a peak bounce moment. One concrete suggestion turns "what now?" into
 * "oh, I could try that". This module is the single source of truth for those
 * suggestions so the wording, ceilings, and action mapping stay consistent
 * across Missions / Feed / Office / Rooms.
 *
 * PURE MODULE: no React, no react-native, no Supabase, no DOM. Only `import
 * type` is allowed so this stays smoke-testable under tsx/esbuild (see the
 * "smoke tests need pure modules" memory). All data is inline + deterministic.
 *
 * ACTION MAPPING — every suggestion maps to a REAL capability that already
 * exists. Two action kinds:
 *   - `seed_command`: a real slash command from src/lib/chatCommandRegistry.ts
 *     OR a real same-surface handler token that the host surface interprets
 *     (documented per-value in the comments below). The presentational chip
 *     component does NOT execute anything — the host surface's `onPick`
 *     decides what "seed_command" means for that surface.
 *   - `open`: navigate to an existing tab. `value` is an UPPERCASE tab key
 *     from CircleDetailScreen's TAB_META (CHAT, ROOMS, OFFICE, FEED, …). The
 *     host dispatches the existing `uc:switch-tab` CustomEvent.
 *
 * Do NOT invent commands. Each entry cites the real command id / handler it
 * maps to in an inline comment.
 */

/** Surfaces that render a first-run empty state we want to de-void. */
export type EmptyStateSurface = 'missions' | 'feed' | 'office' | 'rooms';

/** What a chip does when picked. */
export type EmptyStateSuggestionAction =
  | {
      /**
       * Seed / trigger a real command or same-surface handler. `value` is
       * either a real slash command (e.g. `/mission create`, `/watch`) that
       * exists in chatCommandRegistry, or a same-surface handler token the
       * host surface recognizes (e.g. `mission:create`, `office:deploy-agent`).
       * The host surface's onPick decides the wiring; see per-value comments.
       */
      kind: 'seed_command';
      value: string;
    }
  | {
      /** Navigate to an existing tab. `value` is an UPPERCASE tab key. */
      kind: 'open';
      value: string;
    };

export interface EmptyStateSuggestion {
  /** Short call to action shown on the chip. ≤ LABEL_MAX chars. */
  label: string;
  /** One-line explanation of what happens. ≤ HINT_MAX chars. */
  hint: string;
  /** What picking the chip should do. */
  action: EmptyStateSuggestionAction;
}

/** Copy ceilings — enforced by the smoke test and clamped defensively. */
export const EMPTY_STATE_LABEL_MAX = 48;
export const EMPTY_STATE_HINT_MAX = 80;

/** Never show more than this many chips in an empty state. */
export const EMPTY_STATE_MAX_SUGGESTIONS = 4;

/** Valid tab keys for `open` actions (mirror of CircleDetailScreen TAB_META). */
const OPEN_TAB_KEYS = new Set([
  'CHAT',
  'ROOMS',
  'OFFICE',
  'FEED',
  'BACKPACK',
  'INTEGRATIONS',
  'VAULT',
  'MEMBERS',
  'ANALYTICS',
  'WALLET',
  'PROFILE',
]);

/**
 * Raw suggestion sets per surface. Kept private + frozen so callers can't
 * mutate the shared source of truth. `getEmptyStateSuggestions` returns fresh
 * copies clamped to the ceilings.
 *
 * NOTE: there is NO `MISSIONS` tab — missions live inside the FEED tab — so
 * mission/goal navigation targets FEED. There is also NO `/room create`
 * command in the registry, so "create a room" is an `open` ROOMS action, not
 * a fabricated slash command.
 */
const SUGGESTIONS: Record<EmptyStateSurface, readonly EmptyStateSuggestion[]> = {
  missions: [
    {
      label: 'Create your first mission',
      hint: 'Opens the mission form to set a goal for your circle.',
      // seed_command → real `/mission create` (chatCommandRegistry id
      // "mission-create"). MissionsTab handles this same-surface via
      // setShowCreate(true) — no navigation needed.
      action: { kind: 'seed_command', value: '/mission create' },
    },
    {
      label: 'Add a task to track',
      hint: 'Opens the task form so work has a home before it starts.',
      // seed_command → real `/task new` (chatCommandRegistry id "task-new").
      // MissionsTab reuses its create flow (setShowCreate) for this.
      action: { kind: 'seed_command', value: '/task new' },
    },
    {
      label: 'See goals & the team board',
      hint: 'Jump to the Feed for goals, plans, and proof of work.',
      // open → FEED tab (goals/plans/kanban live there via useGoals/usePlans).
      action: { kind: 'open', value: 'FEED' },
    },
  ],
  feed: [
    {
      label: 'Ask the agent to build a landing page',
      hint: 'Describe a page and the agent builds it for you.',
      // seed_command → real `/create` (chatCommandRegistry id "create"; routes
      // build/image/doc briefs). Chat-bound; host lands the user in CHAT.
      action: { kind: 'seed_command', value: '/create ' },
    },
    {
      label: 'Watch a page for changes',
      hint: 'Re-checks a page on a schedule and reports what changed.',
      // seed_command → real `/watch` (chatCommandRegistry id "watch").
      action: { kind: 'seed_command', value: '/watch ' },
    },
    {
      label: 'Review a pull request',
      hint: 'Runs a code review on a PR (correctness, security, design).',
      // seed_command → real `/review` (chatCommandRegistry id "review").
      action: { kind: 'seed_command', value: '/review ' },
    },
    {
      label: 'Generate an image',
      hint: 'Describe an image and an AI model generates it.',
      // seed_command → real `/imagine` (chatCommandRegistry id "imagine").
      action: { kind: 'seed_command', value: '/imagine ' },
    },
  ],
  office: [
    {
      label: 'Deploy an agent to a task',
      hint: 'Opens the setup wizard to connect or bond an agent.',
      // seed_command → same-surface handler token. OfficeTab interprets this
      // via setShowSetupWizard(true) (the existing AgentQuickConnect wizard).
      // No `/deploy` slash command exists, so this is a handler token, not a
      // fabricated command.
      action: { kind: 'seed_command', value: 'office:deploy-agent' },
    },
    {
      label: 'See what your agents can do',
      hint: 'Lists which apps and tasks chat can automate for you.',
      // seed_command → real `/apps` (chatCommandRegistry id "apps").
      // Chat-bound; host lands the user in CHAT.
      action: { kind: 'seed_command', value: '/apps' },
    },
    {
      label: 'Check what changed on screen',
      hint: 'Looks at the frontmost app and suggests a next step.',
      // seed_command → real `/screen` (chatCommandRegistry id "screen").
      action: { kind: 'seed_command', value: '/screen' },
    },
  ],
  rooms: [
    {
      label: 'Create a project room',
      hint: 'Opens Rooms to spin up a space for files and services.',
      // open → ROOMS tab. There is NO `/room create` command in the registry,
      // so this deliberately navigates rather than seeding a fake command.
      action: { kind: 'open', value: 'ROOMS' },
    },
    {
      label: 'List your rooms',
      hint: 'Shows every project room in this circle.',
      // seed_command → real `/room list` (chatCommandRegistry id "room-list").
      action: { kind: 'seed_command', value: '/room list' },
    },
    {
      label: 'Browse room files',
      hint: 'Lists the files inside a project room.',
      // seed_command → real `/room files` (chatCommandRegistry id "room-files").
      action: { kind: 'seed_command', value: '/room files ' },
    },
  ],
};

function clampText(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve one char for the ellipsis so the result never exceeds `max`.
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function isValidAction(action: EmptyStateSuggestionAction | undefined | null): boolean {
  if (!action) return false;
  if (action.kind === 'seed_command') {
    return typeof action.value === 'string' && action.value.trim().length > 0;
  }
  if (action.kind === 'open') {
    return typeof action.value === 'string' && OPEN_TAB_KEYS.has(action.value.trim().toUpperCase());
  }
  return false;
}

/**
 * Returns 3–4 bounded, deterministic suggestions for a surface's empty state.
 *
 * - Labels/hints are clamped to the ceilings so a chip can never overflow.
 * - Malformed entries (missing action, empty command, unknown tab) are
 *   dropped rather than surfaced.
 * - An unknown / degenerate surface returns [] (never throws).
 * - Returned objects are fresh copies; the shared source is never mutated.
 */
export function getEmptyStateSuggestions(surface: EmptyStateSurface): EmptyStateSuggestion[] {
  const set = SUGGESTIONS[surface];
  if (!set || set.length === 0) return [];

  const cleaned: EmptyStateSuggestion[] = [];
  for (const entry of set) {
    if (!entry || typeof entry.label !== 'string' || typeof entry.hint !== 'string') continue;
    if (!isValidAction(entry.action)) continue;
    const label = clampText(entry.label, EMPTY_STATE_LABEL_MAX);
    const hint = clampText(entry.hint, EMPTY_STATE_HINT_MAX);
    if (!label) continue;
    cleaned.push({
      label,
      hint,
      action:
        entry.action.kind === 'open'
          ? { kind: 'open', value: entry.action.value.trim().toUpperCase() }
          : { kind: 'seed_command', value: entry.action.value },
    });
    if (cleaned.length >= EMPTY_STATE_MAX_SUGGESTIONS) break;
  }
  return cleaned;
}

/**
 * Compact, PII-free description of a picked suggestion for analytics /
 * telemetry. Deterministic; safe to log (contains no user content — only the
 * static label + action, both authored in this file).
 *
 * Example: `empty_state:office pick=seed_command:/apps "See what your agents…"`
 */
export function describeSuggestionForAnalytics(
  surface: EmptyStateSurface,
  suggestion: Pick<EmptyStateSuggestion, 'label' | 'action'>,
): string {
  const label = typeof suggestion?.label === 'string' ? clampText(suggestion.label, EMPTY_STATE_LABEL_MAX) : '';
  const action = suggestion?.action;
  const actionPart = isValidAction(action)
    ? `${action!.kind}:${action!.value.trim()}`
    : 'invalid';
  return `empty_state:${surface} pick=${actionPart} "${label}"`;
}
