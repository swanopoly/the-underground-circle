/**
 * skillLibrary — Phase 2a of the Hermes-inspired OpenSwan rewrite.
 *
 * READ PATH for agentskills.io SKILL.md files stored in the `circle_skills`
 * table. This is DISTINCT from `skillRegistry.ts` which owns the DB-column
 * persona skills (`skills` table + `circle_soul_skills` join) — the two
 * systems coexist on purpose:
 *
 *   skillRegistry : DB-column (`prompt_fragment`) persona skills wired to
 *                   SOULs. Codex-built. Load with `loadPreparedSkillsForSoul`.
 *   skillLibrary  : agentskills.io SKILL.md markdown bodies. Imported
 *                   cleanly from Claude Code / Cursor / Codex. Load with
 *                   `listLibrarySkills` / `viewLibrarySkill`.
 *
 * The two layers will eventually converge (probably by teaching
 * skillRegistry.buildSkillsPromptBlock to pull library skills alongside
 * persona skills) but we avoid mixing them in Phase 2a to keep the
 * migration reversible.
 *
 * Progressive disclosure follows Hermes:
 *   - `listLibrarySkills(circleId)` → cheap metadata only (~20 tokens/row)
 *   - `viewLibrarySkill(circleId, name)` → full SKILL.md body
 *
 * Phase 2b will add write operations (`create`, `patch`, `delete`) gated
 * behind the HITL approval queue.
 *
 * Content format — the `content` column follows the
 * https://agentskills.io standard: YAML frontmatter (`name`, `description`,
 * `version`, optional `tags`) followed by markdown sections:
 *   ## When to use
 *   ## Procedure
 *   ## Pitfalls
 *   ## Verification
 *
 * Prompt-injection hygiene: even though skills are authored by trusted
 * circle members, retrieved skill bodies MUST NOT cause the agent to
 * blindly follow embedded instructions. Phase 2b will wrap `viewLibrarySkill`
 * responses in `<untrusted_quoted>…</untrusted_quoted>` for turns that
 * execute after a `skill_manage create` proposal is pending.
 */

import { supabase } from './supabase';

export type LibrarySkillMetadata = {
  id: string;
  circleId: string;
  authorId: string | null;
  name: string;
  description: string;
  version: string;
  tags: string[];
  usageCount: number;
  successCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LibrarySkill = LibrarySkillMetadata & {
  content: string;
};

export type ListLibrarySkillsOptions = {
  /** Only return skills whose tag array overlaps one of these. */
  tags?: string[];
  /** Cap result count. Default 100, max 500. */
  limit?: number;
};

/**
 * Returns metadata only for every SKILL.md a caller can see (RLS enforces
 * circle membership). `content` column is intentionally NOT fetched — use
 * `viewLibrarySkill(circleId, name)` for the body.
 *
 * Never throws — failures return [] and log a warning so the agent loop
 * is not blocked on a missing skill library.
 */
export async function listLibrarySkills(
  circleId: string,
  opts: ListLibrarySkillsOptions = {},
): Promise<LibrarySkillMetadata[]> {
  let query = supabase
    .from('circle_skills')
    .select('id, circle_id, author_id, name, description, version, tags, usage_count, success_count, created_at, updated_at')
    .eq('circle_id', circleId)
    .order('name', { ascending: true })
    .limit(Math.min(opts.limit ?? 100, 500));

  if (opts.tags?.length) {
    query = query.overlaps('tags', opts.tags);
  }

  const { data, error } = await query;
  if (error) {
    // Known error code PGRST205 = relation missing; quietly return empty
    // so dev environments without the Phase 2 migration keep working.
    if ((error as any).code !== 'PGRST205') {
      console.warn('[skillLibrary] listLibrarySkills failed:', error.message);
    }
    return [];
  }
  return (data || []).map(rowToMetadata);
}

/**
 * Fetches a single SKILL.md body. Returns null if not found or RLS blocks.
 */
export async function viewLibrarySkill(circleId: string, name: string): Promise<LibrarySkill | null> {
  const { data, error } = await supabase
    .from('circle_skills')
    .select('id, circle_id, author_id, name, description, version, tags, content, usage_count, success_count, created_at, updated_at')
    .eq('circle_id', circleId)
    .eq('name', name)
    .maybeSingle();
  if (error) {
    if ((error as any).code !== 'PGRST205') {
      console.warn(`[skillLibrary] viewLibrarySkill(${name}) failed:`, error.message);
    }
    return null;
  }
  if (!data) return null;
  return { ...rowToMetadata(data), content: data.content || '' };
}

/**
 * Compact metadata table for system-prompt injection. Inject as a
 * USER-role message, NOT into the system block — the system block stays
 * stable so Anthropic prompt caching keeps hitting. Hermes' trick; see
 * `agentSystemPrompt.ts` comments.
 */
export function renderLibraryMetadataTable(skills: LibrarySkillMetadata[]): string {
  if (skills.length === 0) {
    return 'No SKILL.md files in this circle yet. Once the library has entries, call `skill_view(name)` to read one.';
  }
  const lines = ['Available SKILL.md procedures — call `skill_view(name)` for the body:'];
  for (const s of skills) {
    const tagTail = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
    lines.push(`- ${s.name} (v${s.version})${tagTail}: ${s.description}`);
  }
  return lines.join('\n');
}

// ─── Level-2 sub-file retrieval (Phase CA-8c) ───────────────────────────────

export type LibrarySkillFile = {
  id: string;
  skillId: string;
  relpath: string;
  content: string;
  isPrimary: boolean;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type LibrarySkillFileSummary = Omit<LibrarySkillFile, 'content'>;

/**
 * Returns the file manifest for a skill — every sibling in its
 * directory (references/, templates/, scripts/, etc.). Never returns
 * the body; call `viewLibrarySkillFile` for individual contents.
 *
 * Empty array on DB failure / RLS miss, matching the rest of this
 * module's error posture (don't block the agent loop).
 */
export async function listLibrarySkillFiles(
  circleId: string,
  name: string,
): Promise<LibrarySkillFileSummary[]> {
  const parent = await viewLibrarySkillRow(circleId, name);
  if (!parent) return [];
  const { data, error } = await supabase
    .from('circle_skill_files')
    .select('id, skill_id, relpath, is_primary, mime_type, size_bytes, created_at, updated_at')
    .eq('skill_id', parent.id)
    .order('relpath', { ascending: true });
  if (error) {
    if ((error as any).code !== 'PGRST205') {
      console.warn(`[skillLibrary] listLibrarySkillFiles(${name}) failed:`, error.message);
    }
    return [];
  }
  return (data || []).map(fileRowToSummary);
}

/**
 * Fetches a single sub-file body. `relpath` must pass
 * `parseSkillRelPath` — callers on the tool-layer should validate
 * upstream so the error surface stays structured.
 *
 * Null when the parent skill doesn't exist, the file isn't registered,
 * or RLS blocks.
 */
export async function viewLibrarySkillFile(
  circleId: string,
  name: string,
  relpath: string,
): Promise<LibrarySkillFile | null> {
  const { parseSkillRelPath } = await import('./skillRelPath');
  const parsed = parseSkillRelPath(relpath);
  if (!parsed.ok) return null;
  const parent = await viewLibrarySkillRow(circleId, name);
  if (!parent) return null;
  const { data, error } = await supabase
    .from('circle_skill_files')
    .select('id, skill_id, relpath, content, is_primary, mime_type, size_bytes, created_at, updated_at')
    .eq('skill_id', parent.id)
    .eq('relpath', parsed.relpath)
    .maybeSingle();
  if (error) {
    if ((error as any).code !== 'PGRST205') {
      console.warn(`[skillLibrary] viewLibrarySkillFile(${name}, ${parsed.relpath}) failed:`, error.message);
    }
    return null;
  }
  if (!data) return null;
  return fileRowToFull(data);
}

async function viewLibrarySkillRow(circleId: string, name: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('circle_skills')
    .select('id')
    .eq('circle_id', circleId)
    .eq('name', name)
    .maybeSingle();
  return data ? { id: (data as any).id } : null;
}

function fileRowToSummary(row: any): LibrarySkillFileSummary {
  return {
    id: row.id,
    skillId: row.skill_id,
    relpath: row.relpath,
    isPrimary: !!row.is_primary,
    mimeType: row.mime_type ?? null,
    sizeBytes: Number(row.size_bytes ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function fileRowToFull(row: any): LibrarySkillFile {
  return {
    ...fileRowToSummary(row),
    content: row.content || '',
  };
}

// ─── Frontmatter parser (read-side convenience) ─────────────────────────────

/**
 * Extracts YAML frontmatter + body from a SKILL.md content string. Used by
 * the importer and by future write-path validators. Minimal: handles the
 * five fields we care about (name, description, version, tags, platform)
 * without pulling in a full YAML dependency. Anything beyond those is
 * returned in `rawFrontmatter` for caller inspection.
 *
 * Implementation lives in `./skillFrontmatter.ts` so it's importable from
 * smoke tests and non-RN environments without dragging Supabase in.
 */
export { parseSkillFrontmatter } from './skillFrontmatter';
// Re-export the pure relpath validator so `/skill view <name> <path>`
// handlers and the importer don't duplicate the rule.
export { parseSkillRelPath, isSafeSkillRelPath, type SkillRelPathResult } from './skillRelPath';

// ─── Internals ──────────────────────────────────────────────────────────────

function rowToMetadata(row: any): LibrarySkillMetadata {
  return {
    id: row.id,
    circleId: row.circle_id,
    authorId: row.author_id ?? null,
    name: row.name,
    description: row.description,
    version: row.version,
    tags: Array.isArray(row.tags) ? row.tags : [],
    usageCount: row.usage_count ?? 0,
    successCount: row.success_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
