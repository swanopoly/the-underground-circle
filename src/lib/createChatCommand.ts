/**
 * createChatCommand — ONE friendly entry point for making anything from chat:
 *
 *   /create <anything>        (alias: /make <anything>)
 *
 * A novice never needs to know `/build-page` vs `/imagine` vs `/wp draft` vs
 * `/task new`. This module only CLASSIFIES the brief into a creation intent
 * and REWRITES it into the right existing lane:
 *
 *   - `resend_as`: the caller re-dispatches the rewritten text through
 *     sendMessage, so the EXISTING planner / slash-command handlers execute
 *     it (build discovery, /imagine, WordPress conversational intent,
 *     /task new, /watch, /automation, plain-chat coding/document/CSV lanes).
 *   - `reply`: answer directly (bare `/create` menu, honest
 *     not-yet-supported guidance for presentations — never pretend).
 *
 * This module executes nothing itself — no supabase, no react, no side
 * effects. The ChatTab/registry wiring lives with the orchestrator; this
 * file owns parse → classify → directive → routing note only.
 *
 * CRITICAL: keep this module import-free (pure) so it loads under tsx for
 * scripts/create-chat-command-smoketest.ts.
 */

export type CreateIntentClass =
  | 'webpage' | 'image' | 'code' | 'document' | 'spreadsheet'
  | 'wordpress_post' | 'task' | 'design' | 'presentation' | 'automation' | 'watch';

export interface CreateRouteDirective {
  /**
   * Classified creation intent. `null` for the two class-less directives:
   * the bare `/create` menu reply and the unclassified pass-through
   * ("letting the planner decide").
   */
  intent: CreateIntentClass | null;
  /** How the caller should run it. */
  action:
    | { kind: 'resend_as'; message: string }   // re-dispatch this text through sendMessage (hits existing planner/commands)
    | { kind: 'reply'; message: string };      // just answer (menus, not-yet-supported guidance)
  /** One user-facing line explaining the routing ("webpage → live builder"). */
  note: string;
}

/** Creation briefs stay bounded — long source material belongs in a follow-up message. */
export const MAX_CREATE_BRIEF_LENGTH = 2000;

/** Directive notes are one short line; the formatted routing line is bounded too. */
export const MAX_CREATE_NOTE_LENGTH = 120;
const MAX_ROUTING_LINE_LENGTH = 160;

/**
 * `/create <brief>` (alias `/make <brief>`) — whole-token only, so
 * `/created x` or `/maker x` fall through (`null`) to the next handler.
 * Bare `/create` returns `{ ok: true, brief: '' }` — the menu case.
 */
export function parseCreateCommand(
  raw: string,
): { ok: true; brief: string } | { ok: false; error: string } | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/(create|make)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  const brief = (match[2] || '').trim();
  if (brief.length > MAX_CREATE_BRIEF_LENGTH) {
    return {
      ok: false,
      error:
        `That /create brief is too long (${brief.length} chars — max ${MAX_CREATE_BRIEF_LENGTH}). ` +
        'Describe WHAT to create here; paste long source material in a follow-up message.',
    };
  }
  return { ok: true, brief };
}

// ── Classification ──────────────────────────────────────────────────────────
// High-precision keyword classes. Order matters — the MOST specific class is
// checked first so precedence holds: wordpress_post beats document ("an
// article on my wordpress site"), spreadsheet beats document ("a spreadsheet
// report"), presentation beats document ("a slide deck report"), etc.

const WATCH_RECURRENCE = /\b(recurring|hourly|daily|weekly|nightly|every\s+(hour|day|week|month|morning|afternoon|night|evening))\b/i;
const WATCH_CHECK_VERB = /\b(check|checks|checking|watch|watches|watching|monitor|monitors|monitoring)\b/i;

function isWatchBrief(text: string): boolean {
  // Needs BOTH a recurrence marker and a check verb (either order), or the
  // explicit "watch <thing> price/changes" phrasing — keeps precision high.
  if (WATCH_RECURRENCE.test(text) && WATCH_CHECK_VERB.test(text)) return true;
  return /\bwatch\b[\s\S]+\b(price|prices|pricing|changes)\b/i.test(text);
}

export function classifyCreateIntent(brief: string): CreateIntentClass | null {
  const text = String(brief || '').trim();
  if (!text) return null;

  if (
    /\bwordpress\b/i.test(text)
    || /\bwp posts?\b/i.test(text)
    || /\bblog posts? on\b[\s\S]*\b(site|wordpress)\b/i.test(text)
  ) return 'wordpress_post';

  if (/\b(presentation|slide deck|slides|keynote|powerpoint|ppt)s?\b/i.test(text)) return 'presentation';

  if (/\b(spreadsheet|csv|excel)s?\b/i.test(text) || /\b(sheet|table) of\b/i.test(text)) return 'spreadsheet';

  if (/\b(webpage|web page|landing page|website|html page)s?\b/i.test(text)) return 'webpage';

  if (/\b(image|picture|logo|icon|illustration|banner)s?\b/i.test(text) || /\bphotos? of\b/i.test(text)) return 'image';

  if (/\b(photoshop|indesign|psd|mockup|poster)s?\b/i.test(text)) return 'design';

  if (isWatchBrief(text)) return 'watch';

  if (
    /\bautomations?\b/i.test(text)
    || /\bautomate\b[\s\S]*\bwhen(ever)?\b/i.test(text)
    || /\bwhenever\b[\s\S]*\bthen\b/i.test(text)
  ) return 'automation';

  if (/\b(task|todo|to-do)s?\b/i.test(text) || /\bmissions? (for|to)\b/i.test(text)) return 'task';

  if (
    /\b(code|function|component|script|cli|program)s?\b/i.test(text)
    || /\b(api endpoints?|app that|bot that)\b/i.test(text)
  ) return 'code';

  if (
    /\b(cover letter|resume|proposal|contract|essay|article|report|letter)s?\b/i.test(text)
    || /\bdoc(ument)?s?\b/i.test(text)
  ) return 'document';

  return null;
}

// ── Directives ──────────────────────────────────────────────────────────────

// Menu bullets: label + one realistic example each (order = classify order-ish,
// friendliest first). Kept as data so the smoke test can count the lanes.
const CREATE_MENU_ITEMS: Array<{ label: string; example: string }> = [
  { label: 'Webpage', example: '/create a landing page for my bakery' },
  { label: 'Image', example: '/create a logo for my podcast' },
  { label: 'Code', example: '/create a python script that renames files' },
  { label: 'Document', example: '/create a resume for a nurse' },
  { label: 'Spreadsheet', example: '/create a spreadsheet of my monthly bills' },
  { label: 'WordPress post', example: '/create a blog post on my wordpress site about spring' },
  { label: 'Task', example: '/create a task for Dana to call the vendor' },
  { label: 'Recurring watch', example: '/create a daily watch on the weather' },
  { label: 'Automation', example: '/create an automation that posts a summary every friday' },
];

function buildCreateMenuMessage(): string {
  return [
    '🪄 **What should I create?** Just describe it after `/create` — I pick the right builder for you.',
    '',
    ...CREATE_MENU_ITEMS.map((item) => `• **${item.label}** — \`${item.example}\``),
    '',
    'No command names to memorize — just describe it after `/create` (`/make` works too).',
  ].join('\n');
}

function sniffWatchCadence(text: string): 'hourly' | 'daily' | 'weekly' {
  if (/\b(hourly|every hour)\b/i.test(text)) return 'hourly';
  if (/\b(weekly|every week)\b/i.test(text)) return 'weekly';
  return 'daily';
}

/**
 * "a task for Dana to call the vendor" → "Dana to call the vendor" so
 * `/task new <title>` pre-fills a clean title instead of create-command filler.
 */
function stripTaskFiller(text: string): string {
  let title = text.trim();
  title = title.replace(/^(please\s+)?(create|make|add|open|new)\s+/i, '');
  title = title.replace(/^(a|an|the)\s+/i, '');
  title = title.replace(/^(task|todo|to-do|ticket)s?\s*/i, '');
  title = title.replace(/^(for|to|that|about|:)\s+/i, '');
  return title.trim() || text.trim();
}

const DOC_TYPES: Array<{ pattern: RegExp; docType: string }> = [
  { pattern: /\bresumes?\b/i, docType: 'resume' },
  { pattern: /\bcover letters?\b/i, docType: 'cover letter' },
  { pattern: /\bproposals?\b/i, docType: 'proposal' },
  { pattern: /\bcontracts?\b/i, docType: 'contract' },
  { pattern: /\bessays?\b/i, docType: 'essay' },
  { pattern: /\barticles?\b/i, docType: 'article' },
  { pattern: /\breports?\b/i, docType: 'report' },
  { pattern: /\bletters?\b/i, docType: 'letter' },
];

function inferDocumentType(text: string): string {
  for (const { pattern, docType } of DOC_TYPES) {
    if (pattern.test(text)) return docType;
  }
  return 'document';
}

export function buildCreateDirective(brief: string): CreateRouteDirective {
  const text = String(brief || '').trim();

  // Bare `/create` → show the menu, never guess.
  if (!text) {
    return {
      intent: null,
      action: { kind: 'reply', message: buildCreateMenuMessage() },
      note: 'showing the /create menu — describe what you want after /create',
    };
  }

  const intent = classifyCreateIntent(text);
  switch (intent) {
    case 'webpage':
      return {
        intent,
        action: { kind: 'resend_as', message: `/build-page ${text}` },
        note: 'webpage → live page builder (/build-page)',
      };
    case 'image':
      return {
        intent,
        action: { kind: 'resend_as', message: `/imagine ${text}` },
        note: 'image → AI image generator (/imagine)',
      };
    case 'wordpress_post':
      // Natural phrasing on purpose — the planner's conversational WordPress
      // intent catches "draft … wordpress" and keeps publishes approval-gated.
      return {
        intent,
        action: { kind: 'resend_as', message: `draft a wordpress post: ${text}` },
        note: 'WordPress post → drafts on your site first; publishing stays approval-gated',
      };
    case 'task':
      return {
        intent,
        action: { kind: 'resend_as', message: `/task new ${stripTaskFiller(text)}` },
        note: 'task → task board form (/task new) with the title pre-filled',
      };
    case 'watch': {
      const cadence = sniffWatchCadence(text);
      return {
        intent,
        action: { kind: 'resend_as', message: `/watch ${cadence} ${text}` },
        note: `recurring watch → /watch ${cadence} (cadence editable: /watch hourly|daily|weekly <task>)`,
      };
    }
    case 'automation':
      return {
        intent,
        action: { kind: 'resend_as', message: `/automation ${text}` },
        note: 'automation → automation builder (/automation)',
      };
    case 'code':
      return {
        intent,
        action: { kind: 'resend_as', message: `Write the code: ${text}` },
        note: 'code → coding lane (the code is written right here in chat)',
      };
    case 'design':
      // Verbatim on purpose — the agent design pipeline catches
      // Photoshop/InDesign wording and owns its own approval gates.
      return {
        intent,
        action: { kind: 'resend_as', message: text },
        note: 'design → Photoshop/InDesign agent pipeline — mutations pause for your approval',
      };
    case 'document': {
      const docType = inferDocumentType(text);
      return {
        intent,
        action: {
          kind: 'resend_as',
          message: `Write the full ${docType} as a markdown code block I can download: ${text}`,
        },
        note: `document → ${docType} as a downloadable artifact card`,
      };
    }
    case 'spreadsheet':
      // Pragmatic CSV-artifact path: a csv code block renders as a
      // downloadable file on the artifact card.
      return {
        intent,
        action: {
          kind: 'resend_as',
          message: `Create this as CSV. Return ONLY a csv code block (language csv) so it downloads as a file: ${text}`,
        },
        note: 'spreadsheet → CSV file, downloadable from the artifact card',
      };
    case 'presentation':
      // P14 (capability map gap #3): presentations ship as HTML slide decks
      // through the EXISTING live page builder — single-file deck with
      // keyboard navigation and print-to-PDF-friendly slide pages. Honest
      // framing stays in the note: it's an HTML deck (exportable to PDF via
      // print), not a .pptx file.
      return {
        intent,
        action: {
          kind: 'resend_as',
          message: `/build-page a single-file HTML slide presentation deck: ${text}. Requirements: one <section class="slide"> per slide, full-viewport slides, left/right arrow-key and click navigation with a slide counter, a title slide, clean large readable typography, and a print stylesheet where each slide prints as one page (so Print → Save as PDF exports the deck).`,
        },
        note: 'presentation → HTML slide deck via the live builder (print = PDF export; .pptx not supported yet)',
      };
    default:
      return {
        intent: null,
        action: { kind: 'resend_as', message: text },
        note: 'letting the planner decide',
      };
  }
}

// ── Routing note ────────────────────────────────────────────────────────────

const CREATE_LANE_LABELS: Record<CreateIntentClass, string> = {
  webpage: 'live page builder',
  image: 'image generator',
  code: 'coding lane',
  document: 'document writer',
  spreadsheet: 'CSV builder',
  wordpress_post: 'WordPress drafts',
  task: 'task board',
  design: 'design pipeline',
  presentation: 'direct answer',
  automation: 'automation builder',
  watch: 'recurring watch',
};
const FALLBACK_LANE_LABEL = 'chat planner';

/** "🪄 Creating via <lane> — <note>" — one bounded, newline-free line. */
export function formatCreateRoutingNote(directive: CreateRouteDirective): string {
  const lane = directive.intent ? CREATE_LANE_LABELS[directive.intent] : FALLBACK_LANE_LABEL;
  const line = `🪄 Creating via ${lane} — ${directive.note}`.replace(/\s*\n+\s*/g, ' ').trim();
  if (line.length <= MAX_ROUTING_LINE_LENGTH) return line;
  return line.slice(0, MAX_ROUTING_LINE_LENGTH - 1).trimEnd() + '…';
}
