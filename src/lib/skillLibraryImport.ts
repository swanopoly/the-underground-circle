/**
 * skillLibraryImport — fetch + validate + stage SKILL.md files from URLs
 * or pasted text into the HITL approval queue.
 *
 * Part of Phase 2b (roadmap + CHAT_AUTOMATION_AUDIT_PLAN). Chris can drop
 * a link to any SKILL.md (agentskills.io spec — also what Claude Code /
 * Cursor / Codex export), we validate, and file a `skill.create` proposal.
 * A circle member approves; `applyApprovedSkillAction` applies it.
 *
 * Sources supported:
 *   - GitHub blob URLs (auto-converted to `raw.githubusercontent.com`)
 *   - GitHub gist URLs (auto-converted to `.../raw`)
 *   - Any raw HTTPS URL pointing at a markdown file
 *   - Pasted SKILL.md text via `importLibrarySkillFromText`
 *
 * Safety rules enforced here (not later):
 *   - HTTPS only — we never fetch `http://` or `file://`
 *   - Max 256 KB — SKILL.md isn't a website
 *   - Valid YAML frontmatter with a `name` + `description` required
 *   - Name must match the circle's existing skill-naming conventions
 *     (lowercase letters, digits, hyphens, underscores; 2-64 chars)
 *   - Duplicate-name check against existing skills — offer patch instead
 *
 * All writes go through `agent_approvals` via the existing
 * `manageLibrarySkill` pathway. We don't invent a new HITL channel.
 */

import { supabase } from './supabase';
import { parseSkillFrontmatter, viewLibrarySkill } from './skillLibrary';

const MAX_FETCH_BYTES = 256 * 1024; // 256 KB
const FETCH_TIMEOUT_MS = 15_000;
const NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export type ImportResult =
  | {
      ok: true;
      approvalId: string;
      skillName: string;
      circleId: string;
      mode: 'create' | 'patch';
      /** Short summary for UI confirmation toast. */
      summary: string;
    }
  | {
      ok: false;
      error: string;
      /** Populated when the failure is a duplicate — caller may offer patch. */
      existingSkillName?: string;
    };

export type ImportOptions = {
  circleId: string;
  userId: string;
  /** Optional per-import note shown on the approval row. */
  rationale?: string;
  /**
   * If true and a skill with the same name already exists, file a patch
   * proposal instead of rejecting. Defaults to false — callers that want
   * patch behavior should opt in explicitly.
   */
  allowPatch?: boolean;
  /**
   * Custom sessionKey + agentName for the approval row. Defaults match
   * the BlackSwan identity so the approval banner categorises correctly.
   */
  sessionKey?: string;
  agentName?: string;
};

// ─── URL normalization ──────────────────────────────────────────────────────

/** Converts common share URLs into the raw-text variant we can fetch. */
export function normalizeSkillUrl(url: string): string {
  let out = url.trim();

  // github.com/{org}/{repo}/blob/{ref}/{path} → raw.githubusercontent.com
  const blobMatch = out.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (blobMatch) {
    const [, owner, repo, ref, path] = blobMatch;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  }

  // gist.github.com/{user}/{id} → /raw
  const gistMatch = out.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)\/?$/);
  if (gistMatch) {
    const [, user, id] = gistMatch;
    return `https://gist.githubusercontent.com/${user}/${id}/raw`;
  }

  return out;
}

async function fetchWithCap(url: string): Promise<string> {
  if (!url.startsWith('https://')) {
    throw new Error('Only https:// URLs are supported for skill import.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`fetch failed (${res.status}): ${res.statusText}`);
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength ?? 0;
      if (received > MAX_FETCH_BYTES) {
        try { reader.cancel(); } catch {}
        throw new Error(`SKILL.md exceeds ${MAX_FETCH_BYTES} bytes; refuse to import.`);
      }
      if (value) chunks.push(value);
    }
    const total = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { total.set(c, offset); offset += c.byteLength; }
    return new TextDecoder('utf-8').decode(total);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

type ValidationOutcome =
  | { ok: true; name: string; description: string; version: string; tags: string[]; content: string }
  | { ok: false; error: string };

function validate(content: string): ValidationOutcome {
  if (!content || content.trim().length < 40) {
    return { ok: false, error: 'Skill body too short to be a real SKILL.md.' };
  }
  if (content.length > MAX_FETCH_BYTES) {
    return { ok: false, error: `SKILL.md exceeds ${MAX_FETCH_BYTES} bytes.` };
  }
  const parsed = parseSkillFrontmatter(content);
  if (!parsed.name) {
    return { ok: false, error: 'SKILL.md frontmatter is missing `name`.' };
  }
  if (!NAME_PATTERN.test(parsed.name)) {
    return { ok: false, error: `Skill name "${parsed.name}" must be lowercase kebab/underscore, 2-64 chars.` };
  }
  if (!parsed.description || parsed.description.trim().length < 10) {
    return { ok: false, error: 'SKILL.md frontmatter is missing `description` (or it is too short).' };
  }
  // Body must include at least the "When to use" and "Procedure" sections
  // per the agentskills.io spec. We're lenient about heading casing.
  const bodyLower = parsed.body.toLowerCase();
  if (!/#+\s*when to use/i.test(bodyLower)) {
    return { ok: false, error: 'SKILL.md body is missing the "When to use" section.' };
  }
  if (!/#+\s*procedure/i.test(bodyLower)) {
    return { ok: false, error: 'SKILL.md body is missing the "Procedure" section.' };
  }
  return {
    ok: true,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version || '1.0.0',
    tags: parsed.tags || [],
    content,
  };
}

// ─── File approval proposal ─────────────────────────────────────────────────

async function fileApproval(args: {
  validated: Extract<ValidationOutcome, { ok: true }>;
  circleId: string;
  userId: string;
  mode: 'create' | 'patch';
  sourceUrl?: string;
  rationale?: string;
  sessionKey: string;
  agentName: string;
}): Promise<{ approvalId: string } | { error: string }> {
  const { validated, circleId, userId, mode, sourceUrl, rationale, sessionKey, agentName } = args;
  const human =
    mode === 'create'
      ? `Import new SKILL.md "${validated.name}" (v${validated.version})`
      : `Patch SKILL.md "${validated.name}" to v${validated.version}`;
  const payload = {
    action: mode,
    circleId,
    name: validated.name,
    content: validated.content,
    description: validated.description,
    version: validated.version,
    tags: validated.tags,
    rationale: rationale ?? (sourceUrl ? `Imported from ${sourceUrl}` : 'Imported via /skill import'),
    authorId: userId,
    sourceUrl: sourceUrl ?? null,
    sourceKind: sourceUrl ? 'url' : 'text',
  };
  const { data, error } = await supabase
    .from('agent_approvals')
    .insert({
      circle_id: circleId,
      session_key: sessionKey,
      agent_name: agentName,
      action_type: `skill.${mode}`,
      description: human + (rationale ? ` — ${rationale.slice(0, 200)}` : ''),
      payload,
      timeout_seconds: 60 * 60 * 24,
    })
    .select('id')
    .single();
  if (error) return { error: error.message };
  return { approvalId: data.id };
}

// ─── Public entry: text ─────────────────────────────────────────────────────

export async function importLibrarySkillFromText(
  content: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const validated = validate(content);
  if (!validated.ok) return { ok: false, error: validated.error };

  const existing = await viewLibrarySkill(opts.circleId, validated.name);
  if (existing && !opts.allowPatch) {
    return {
      ok: false,
      error: `A skill named "${validated.name}" already exists in this circle. Use allowPatch=true to propose an update.`,
      existingSkillName: validated.name,
    };
  }
  const mode: 'create' | 'patch' = existing ? 'patch' : 'create';

  const filed = await fileApproval({
    validated,
    circleId: opts.circleId,
    userId: opts.userId,
    mode,
    rationale: opts.rationale,
    sessionKey: opts.sessionKey || 'default::blackswan',
    agentName: opts.agentName || 'BlackSwan',
  });
  if ('error' in filed) return { ok: false, error: filed.error };

  return {
    ok: true,
    approvalId: filed.approvalId,
    skillName: validated.name,
    circleId: opts.circleId,
    mode,
    summary:
      mode === 'create'
        ? `Filed create proposal for "${validated.name}" (v${validated.version}).`
        : `Filed patch proposal to update "${validated.name}" to v${validated.version}.`,
  };
}

// ─── Public entry: URL ──────────────────────────────────────────────────────

export async function importLibrarySkillFromUrl(
  rawUrl: string,
  opts: ImportOptions,
): Promise<ImportResult> {
  const url = normalizeSkillUrl(rawUrl);
  let content: string;
  try {
    content = await fetchWithCap(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const result = await importLibrarySkillFromText(content, opts);
  if (!result.ok) return result;
  // Stamp the source url into the summary so the approval banner shows it.
  return { ...result, summary: `${result.summary} Source: ${url}` };
}
