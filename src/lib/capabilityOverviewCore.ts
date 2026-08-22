// capabilityOverviewCore — the PURE capability catalog + renderers behind
// "what can you do?", the empty-chat starter suggestions, and per-feature
// discovery hints.
//
// WHY (fixes three findings):
//   1. swanbot.ts's `help|commands|what can you do` local command returned a
//      stale hardcoded 10-item list that hid ~90% of the product — coding
//      tools, computer use, /create, /context, integrations were invisible.
//   2. ChatTab's renderEmptyState shows only a hero image — zero first-run
//      starter prompts.
//   3. Flagship features (@file:/@symbol: mentions, the /context depth dial,
//      desktop/browser automation) were undiscoverable.
//
// WIRING:
//   • src/lib/swanbot.ts localCommands help handler  → buildCapabilityOverview()
//   • buildEmptyChatSuggestions() has NO caller as of 2026-08-07 — the ChatTab
//     empty-state starter chips it fed were removed by request, so a fresh chat
//     shows the hero plus the one-line "See everything I can do →" link. Kept
//     (and still smoke-pinned) because it is a pure, reusable generator.
//   • feature-tip surfaces (help footer, post-answer nudges)
//                                                    → buildFeatureDiscoveryHint(id)
//
// Every example is grounded in a REAL registered surface: chatCommandRegistry
// (/gh, /run, /review, /browser, /apps, /screen, /watch, /create, /imagine,
// /wp, /wiki, /research, /summarize, /remember, /memories, /context,
// /integrations, /bestof, /vault, /poll, /mission), swanbot local commands
// ("who checked in", "leaderboard", "create task …"), and the P4 coding-agent
// mention syntax from codebaseMentionsCore (`@file:` / `@symbol:`).
//
// PURITY (load-bearing — smoke runs under tsx which cannot load react-native):
// zero imports, no side effects at import beyond building frozen consts, no
// Date.now()/Math.random(), fully deterministic. Every export is TOTAL —
// degenerate input (null/undefined/wrong types/huge strings) never throws;
// safe neutral values come back instead. All output is bounded.
// Smoke: scripts/capability-overview-core-smoketest.ts

export interface CapabilityGroup {
  id: string;
  title: string;
  blurb: string;
  examples: string[];
}

// ── Tunables (exported so wiring surfaces share the exact same limits) ─────────

/** Default number of empty-chat starter suggestions. */
export const DEFAULT_EMPTY_CHAT_SUGGESTIONS = 4;

/** Hard cap on empty-chat starter suggestions. */
export const MAX_EMPTY_CHAT_SUGGESTIONS = 6;

/** Hard cap on the rendered overview markdown (belt-and-braces; the fixed
 *  catalog renders well under this). */
export const OVERVIEW_MAX_CHARS = 6000;

/** Each starter suggestion is capped at this many characters. */
const SUGGESTION_MAX_CHARS = 100;

/** Feature ids longer than this are junk — bail to '' immediately. */
const FEATURE_ID_MAX_CHARS = 200;

/** Truncate `text` to `max` chars with a trailing ellipsis. Total. */
function capText(text: string, max: number): string {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function frozenGroup(group: CapabilityGroup): CapabilityGroup {
  return Object.freeze({
    ...group,
    examples: Object.freeze([...group.examples]) as unknown as string[],
  });
}

// ── The catalog ─────────────────────────────────────────────────────────────────
// 9 groups, each 2-3 example prompts. Deep-frozen so no consumer can drift it
// at runtime; renderers below are the only sanctioned views.

export const CAPABILITY_CATALOG: CapabilityGroup[] = Object.freeze(
  ([
    {
      id: 'coding',
      title: 'Coding on your repo',
      blurb:
        'Edit repo files, run tests and builds, work git/GitHub with /gh and /review, and pull real code into chat with @file: / @symbol: mentions.',
      examples: [
        'Fix the bug in @file:src/lib/auth.ts and run the tests',
        '/run npm test',
        '/gh pr ship the login fix',
      ],
    },
    {
      id: 'computer',
      title: 'Computer, browser & apps',
      blurb:
        'Drive the browser and local Mac apps (Photoshop, CAD, more) with approval gates and proof — real clicks, screenshots, extractions.',
      examples: [
        '/browser extract the pricing table from example.com',
        '/apps photoshop',
        '/screen',
      ],
    },
    {
      id: 'tasks',
      title: 'Tasks, missions & schedules',
      blurb:
        'Turn goals into tracked tasks and missions with proof of work, plus recurring runs and monitors that report only what changed.',
      examples: [
        'create task Ship the onboarding email',
        '/watch daily check example.com/status for changes',
        '/mission status',
      ],
    },
    {
      id: 'memory',
      title: 'Memory that sticks',
      blurb:
        'I remember across sessions — save and browse facts, and dial how much context I load each turn with /context lean | standard | max.',
      examples: [
        '/remember we deploy to Netlify on Fridays',
        '/context max',
        '/memories',
      ],
    },
    {
      id: 'knowledge',
      title: 'Knowledge & research',
      blurb:
        'Search the internal wiki and the curated research corpus, or hand me any text or URL to summarize.',
      examples: [
        '/wiki habit stacking',
        '/research sleep and recovery',
        '/summarize https://example.com/article',
      ],
    },
    {
      id: 'create',
      title: 'Create anything',
      blurb:
        'One brief in, real output back: webpages, images, code, docs, spreadsheets (CSV), WordPress posts.',
      examples: [
        '/create a landing page for our beta waitlist',
        '/imagine a minimal swan logo, black on white',
        '/wp write 5 lessons from our first launch',
      ],
    },
    {
      id: 'team',
      title: 'Team accountability',
      blurb:
        "The circle's operating loop — check-ins, streaks, standings, polls, and a live status report.",
      examples: ['who checked in', 'leaderboard', '/poll Ship Friday or Monday?'],
    },
    {
      id: 'integrations',
      title: 'Integrations, models & vault',
      blurb:
        'Connect providers and APIs, race models head-to-head with /bestof, and let agents use vaulted logins without seeing the secrets.',
      examples: [
        '/integrations',
        '/bestof sonnet,gpt summarize this thread',
        '/vault status',
      ],
    },
    {
      id: 'engineering',
      title: 'Engineering & CAD',
      blurb:
        'Design real parts with no CAD install — ~75 engineering calcs (beams, gears, shafts, springs, fits), DXF drawings, 3D STL models built in headless Blender, and measured-back proof.',
      examples: [
        'Design a bracket to hold 50 kg at 100 mm',
        'Size a gearbox: 5 kW, 1500→500 rpm',
        'Draw a 100×60 mounting plate with 4 bolt holes',
      ],
    },
  ] as CapabilityGroup[]).map(frozenGroup)
) as unknown as CapabilityGroup[];

// ── Overview renderer ───────────────────────────────────────────────────────────

/**
 * Grouped markdown overview of everything SwanBot can do. Default renders each
 * group's title + blurb + all example prompts; `{ compact: true }` renders one
 * bullet per group (title + first example). Total: any non-object / degenerate
 * `opts` renders the default view. Output bounded by OVERVIEW_MAX_CHARS.
 */
export function buildCapabilityOverview(opts?: { compact?: boolean }): string {
  const compact = Boolean((opts as { compact?: unknown } | null | undefined)?.compact);
  const lines: string[] = [];
  if (compact) {
    lines.push('**What I can do** — the compact tour:');
    for (const group of CAPABILITY_CATALOG) {
      const first = typeof group.examples[0] === 'string' ? group.examples[0] : '';
      lines.push(first ? `• **${group.title}** — try \`${first}\`` : `• **${group.title}**`);
    }
    lines.push('');
    lines.push('`/help` lists every command · `/context` controls how much I load each turn.');
  } else {
    lines.push(
      "**Here's what I can do** — the short tour. Plain words work everywhere; slash commands are shortcuts."
    );
    lines.push('');
    for (const group of CAPABILITY_CATALOG) {
      lines.push(`**${group.title}** — ${group.blurb}`);
      for (const example of group.examples) lines.push(`• \`${example}\``);
      lines.push('');
    }
    lines.push(
      'More under the hood: `/help` for every command, `/context lean|standard|max` for context depth, `/apps` for which desktop apps I can drive.'
    );
  }
  return capText(lines.join('\n'), OVERVIEW_MAX_CHARS);
}

// ── Empty-chat starter suggestions ──────────────────────────────────────────────

/** Curated flagship-first order for starter suggestions (the default four hit
 *  coding, computer use, create, and team — the least-discoverable headliners).
 *  Ids missing from the catalog are skipped; catalog groups missing from this
 *  list are appended in catalog order. */
const SUGGESTION_GROUP_ORDER: string[] = [
  'coding',
  'computer',
  'create',
  'team',
  'memory',
  'knowledge',
  'tasks',
  'integrations',
];

/**
 * Short first-run starter prompts for the empty chat, drawn from the catalog
 * examples and varied across groups (round-robin: first example of each group
 * in flagship-first order, then second examples, …). Default 4, hard cap
 * MAX_EMPTY_CHAT_SUGGESTIONS. Total + deterministic: invalid `max` falls back
 * to the default, `max <= 0` returns []. Each suggestion is capped at
 * 100 chars; results are deduped and never empty strings.
 */
export function buildEmptyChatSuggestions(opts?: { max?: number }): string[] {
  const rawMax = (opts as { max?: unknown } | null | undefined)?.max;
  let max = DEFAULT_EMPTY_CHAT_SUGGESTIONS;
  if (typeof rawMax === 'number' && !Number.isNaN(rawMax)) max = Math.floor(rawMax);
  if (!(max > 0)) return [];
  if (max > MAX_EMPTY_CHAT_SUGGESTIONS) max = MAX_EMPTY_CHAT_SUGGESTIONS;

  const byId = new Map<string, CapabilityGroup>();
  for (const group of CAPABILITY_CATALOG) byId.set(group.id, group);
  const ordered: CapabilityGroup[] = [];
  for (const id of SUGGESTION_GROUP_ORDER) {
    const group = byId.get(id);
    if (group) ordered.push(group);
  }
  for (const group of CAPABILITY_CATALOG) {
    if (!ordered.includes(group)) ordered.push(group);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (let pass = 0; pass < 3 && out.length < max; pass += 1) {
    for (const group of ordered) {
      if (out.length >= max) break;
      const example = group.examples[pass];
      if (typeof example !== 'string') continue;
      const text = capText(example.trim(), SUGGESTION_MAX_CHARS);
      if (text.length === 0 || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

// ── Feature discovery hints ─────────────────────────────────────────────────────

interface FeatureHintEntry {
  id: string;
  hint: string;
  aliases: string[];
}

// One-line teachers for the flagship features that keep getting missed.
// Stored in a Map (not a bare object) so hostile ids like '__proto__' or
// 'constructor' can never walk the prototype chain.
const FEATURE_HINT_ENTRIES: FeatureHintEntry[] = [
  {
    id: 'mentions',
    hint: 'Tip: type @file:src/... or @symbol:name to pull real code into the chat.',
    aliases: ['mention', 'at_mentions', 'codebase_mentions', 'file_mentions', 'symbol_mentions'],
  },
  {
    id: 'context',
    hint: 'Tip: /context max loads everything I know each turn, /context lean keeps replies fast, and bare /context shows what I loaded last turn.',
    aliases: ['context_dial', 'context_depth', 'context_max'],
  },
  {
    id: 'coding',
    hint: 'Tip: I can edit repo files, run tests with /run, and open PRs with /gh pr — try "fix the failing test and run it".',
    aliases: ['code', 'editor', 'codebase'],
  },
  {
    id: 'computer_use',
    hint: 'Tip: I can drive the browser and Mac apps with your approval — try /browser plan <task>, or /apps to see what I can reach.',
    aliases: ['computer', 'desktop', 'browser', 'computer_control'],
  },
  {
    id: 'create',
    hint: 'Tip: /create makes anything — webpage, image, doc, spreadsheet, or WordPress post — from one description.',
    aliases: ['make'],
  },
  {
    id: 'watch',
    hint: 'Tip: /watch daily <task> re-runs a read-only browser check on a schedule and reports only what changed.',
    aliases: ['monitor', 'watches'],
  },
  {
    id: 'apps',
    hint: 'Tip: /apps shows which desktop apps I can automate, and /apps photoshop checks one live.',
    aliases: ['app_automation', 'desktop_apps'],
  },
  {
    id: 'memory',
    hint: 'Tip: /remember saves a fact across sessions, /memories shows everything saved, /forget removes it.',
    aliases: ['remember', 'memories'],
  },
  {
    id: 'knowledge',
    hint: 'Tip: /wiki <topic> searches the internal wiki and /research <topic> searches the curated research corpus.',
    aliases: ['wiki', 'research'],
  },
  {
    id: 'review',
    hint: 'Tip: paste a PR link, or type /review latest, for a full code review with severity-ranked findings.',
    aliases: ['code_review', 'pr_review'],
  },
  {
    id: 'bestof',
    hint: 'Tip: /bestof sonnet,gpt <task> races models in parallel and a judge picks the winner.',
    aliases: ['best_of', 'best_of_n', 'race'],
  },
  {
    id: 'screen',
    hint: 'Tip: /screen looks at your frontmost app — state, windows, what changed — and suggests the next step.',
    aliases: ['observe', 'whats_on_my_screen'],
  },
  {
    id: 'run',
    hint: 'Tip: /run <command> executes a shell command through the local bridge and posts the output here.',
    aliases: ['shell', 'terminal'],
  },
  {
    id: 'missions',
    hint: 'Tip: say "create task <title>" or use /mission create to turn a goal into tracked, provable work.',
    aliases: ['mission', 'tasks', 'task'],
  },
  {
    id: 'integrations',
    hint: 'Tip: /integrations lists connected APIs, and /integrations act <goal> composes an approval-gated call.',
    aliases: ['integration', 'api', 'apis'],
  },
  {
    id: 'vault',
    hint: 'Tip: /vault status shows credential readiness — agents use vaulted logins via grants without seeing secrets.',
    aliases: ['credentials', 'logins'],
  },
];

const HINT_BY_KEY: Map<string, string> = new Map();
for (const entry of FEATURE_HINT_ENTRIES) {
  HINT_BY_KEY.set(entry.id, entry.hint);
  for (const alias of entry.aliases) {
    if (!HINT_BY_KEY.has(alias)) HINT_BY_KEY.set(alias, entry.hint);
  }
}

/** Canonical hint ids (frozen), for surfaces that rotate or enumerate tips. */
export const KNOWN_FEATURE_HINT_IDS: readonly string[] = Object.freeze(
  FEATURE_HINT_ENTRIES.map((entry) => entry.id)
);

/**
 * One-liner teaching a specific flagship feature. Ids are matched
 * case-insensitively; leading '/' or '@' and '-'/space separators are
 * normalized (so 'computer-use', '/context', '@mentions' all work). Unknown,
 * non-string, empty, or absurdly long ids return ''. Never throws.
 */
export function buildFeatureDiscoveryHint(featureId: string): string {
  if (typeof featureId !== 'string') return '';
  const trimmed = featureId.trim();
  if (trimmed.length === 0 || trimmed.length > FEATURE_ID_MAX_CHARS) return '';
  const key = trimmed
    .toLowerCase()
    .replace(/^[/@]+/, '')
    .replace(/[\s-]+/g, '_');
  return HINT_BY_KEY.get(key) ?? '';
}
