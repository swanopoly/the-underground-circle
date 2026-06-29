/**
 * wordpressCommandRisk — pure risk classification + confirm-token parsing for
 * `/wp` slash commands.
 *
 * Live mutations (publish / delete / schedule) require an explicit ` confirm`
 * token appended to the command so a single mis-typed line cannot push a post
 * live or trash it. Draft/AI-write stay UNgated — they only create drafts.
 *
 * Dependency-light on purpose: no react-native, no siteAutomation, no swanbot
 * imports, so the smoke harness (tsx/esbuild) can load it directly.
 */

export type WpCommandAction = 'publish' | 'delete' | 'schedule' | 'other';
export type WpListTarget = 'posts' | 'pages' | 'categories' | 'tags';

export interface WpCommandRisk {
  action: WpCommandAction;
  /** True for live mutations that need a confirm token. */
  mutating: boolean;
  /** Numeric post id when the args lead with one (publish/delete). */
  targetId?: number;
  /** True when a trailing ` confirm` token was present. */
  hasConfirmToken: boolean;
  /** The args with any trailing confirm token stripped, ready for handlers. */
  argsWithoutToken: string;
}

/** Strips a trailing, word-bounded ` confirm` token (case-insensitive). */
function stripConfirmToken(args: string): { stripped: string; had: boolean } {
  const m = args.match(/\s+confirm\s*$/i);
  if (m) return { stripped: args.slice(0, m.index).trim(), had: true };
  return { stripped: args.trim(), had: false };
}

/**
 * Classifies a `/wp` command body (the text AFTER `/wp `, e.g. `publish 42`,
 * `delete 7 confirm`, `schedule 2026-07-01 Title`). Returns the action,
 * whether it is a live mutation, an extracted target id where applicable, the
 * confirm-token state, and the args with the token removed.
 */
export function classifyWpCommandRisk(cmd: string): WpCommandRisk {
  const raw = String(cmd || '').trim();
  const lower = raw.toLowerCase();

  let action: WpCommandAction = 'other';
  if (lower.startsWith('publish ') || lower === 'publish') action = 'publish';
  else if (lower.startsWith('delete ') || lower === 'delete' || lower.startsWith('trash ') || lower === 'trash') action = 'delete';
  else if (lower.startsWith('schedule ') || lower === 'schedule') action = 'schedule';

  const mutating = action === 'publish' || action === 'delete' || action === 'schedule';

  // Drop the leading verb, then strip the confirm token from the remainder.
  const afterVerb = raw.replace(/^(publish|delete|trash|schedule)\s*/i, '');
  const { stripped, had } = stripConfirmToken(afterVerb);

  let targetId: number | undefined;
  const idMatch = stripped.match(/^(\d+)/);
  if ((action === 'publish' || action === 'delete') && idMatch) {
    targetId = parseInt(idMatch[1], 10);
  }

  return {
    action,
    mutating,
    targetId,
    hasConfirmToken: had,
    argsWithoutToken: stripped,
  };
}

/**
 * Classifies read-only `/wp` list aliases. Kept pure so command routing can be
 * smoke-tested without loading WordPress credentials or network clients.
 */
export function classifyWpListTarget(cmd: string): WpListTarget | null {
  const raw = String(cmd || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'pages' || /^list\s+pages?\b/.test(raw)) return 'pages';
  if (raw === 'categories' || raw === 'cats' || /^list\s+(categories|cats)\b/.test(raw)) return 'categories';
  if (raw === 'tags' || /^list\s+tags\b/.test(raw)) return 'tags';
  if (raw === 'posts' || raw === 'list' || /^list\b/.test(raw)) return 'posts';
  return null;
}

export type WpPostListStatus = 'draft' | 'pending' | 'any';

export function inferWpListTargetFromText(text: string): WpListTarget {
  const raw = String(text || '').toLowerCase();
  if (/\bpages?\b/.test(raw)) return 'pages';
  if (/\b(categories|category|cats)\b/.test(raw)) return 'categories';
  if (/\btags?\b/.test(raw)) return 'tags';
  return 'posts';
}

export function inferWpPostListStatusFromText(text: string): WpPostListStatus | undefined {
  const raw = String(text || '').toLowerCase();
  if (/\bdrafts?\b/.test(raw)) return 'draft';
  if (/\bpending\b/.test(raw)) return 'pending';
  if (/\b(all|any)\b/.test(raw)) return 'any';
  return undefined;
}

/**
 * Builds the user-facing pre-publish/pre-delete confirmation prompt. The
 * caller passes a resolved post title/summary where known so the user sees
 * WHAT will change before re-issuing with `confirm`.
 */
export function buildWpConfirmPrompt(action: WpCommandAction, targetId?: number, summary?: string): string {
  const target = targetId ? `post #${targetId}` : 'this post';
  const what = summary ? ` (**${summary}**)` : '';
  const reissue = (() => {
    switch (action) {
      case 'publish':
        return targetId ? `\`/wp publish ${targetId} confirm\`` : '`/wp publish <id> confirm`';
      case 'delete':
        return targetId ? `\`/wp delete ${targetId} confirm\`` : '`/wp delete <id> confirm`';
      case 'schedule':
        return '`/wp schedule <date> <title> confirm`';
      default:
        return '`/wp <command> confirm`';
    }
  })();

  const verb = action === 'publish'
    ? `publish ${target}${what} **live**`
    : action === 'delete'
      ? `move ${target}${what} **to trash**`
      : `schedule ${target}${what} to **go live automatically**`;

  return `This will ${verb}. Re-issue with the confirm token to proceed: ${reissue}`;
}
