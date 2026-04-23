/**
 * claudeSkillsBridge — client-side helper to enumerate and stage Claude
 * Code skills from `~/.claude/skills/` through the local bridge.
 *
 * Complements `skillLibraryImport.ts`. The flow:
 *   1. `listClaudeCodeSkills()` → hits `GET /skills` on the bridge,
 *      returns the names + paths + sizes.
 *   2. UI shows the user a tick-list of skills to import.
 *   3. For each picked skill, `importSelectedClaudeCodeSkills()` calls
 *      `GET /skills/<name>` to fetch the raw SKILL.md, then feeds it
 *      through the existing `importLibrarySkillFromText` path (HITL
 *      approval, never a direct DB write).
 *
 * Only reachable when the local bridge is running (not production web).
 * `bridgeEnvironment` already gates that check; we re-use its URL.
 */

import { getBridgeUrl } from './bridgeEnvironment';
import { importLibrarySkillFromText, type ImportResult } from './skillLibraryImport';

const CLAUDE_BRIDGE_PORT = 7778;
const FETCH_TIMEOUT_MS = 10_000;

export type ClaudeCodeSkillEntry = {
  name: string;
  format: 'directory' | 'file';
  path: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type ListClaudeSkillsResult =
  | { ok: true; root: string; skills: ClaudeCodeSkillEntry[]; count: number }
  | { ok: false; error: string };

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** True when the Claude Code bridge is reachable. Used to gate UI. */
export async function claudeBridgeAvailable(): Promise<boolean> {
  const base = getBridgeUrl(CLAUDE_BRIDGE_PORT);
  if (!base) return false;
  try {
    const res = await fetchWithTimeout(`${base}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.ok;
  } catch {
    return false;
  }
}

/** Enumerate skills in `~/.claude/skills`. Never throws. */
export async function listClaudeCodeSkills(): Promise<ListClaudeSkillsResult> {
  const base = getBridgeUrl(CLAUDE_BRIDGE_PORT);
  if (!base) {
    return {
      ok: false,
      error: 'Claude Code bridge is not available — run `npm run dev` locally or set EXPO_PUBLIC_BRIDGE_HOST.',
    };
  }
  try {
    const res = await fetchWithTimeout(`${base}/skills`);
    if (!res.ok) return { ok: false, error: `bridge returned ${res.status}` };
    const data = await res.json();
    if (data?.error && !Array.isArray(data?.skills)) {
      return { ok: false, error: data.error };
    }
    return {
      ok: true,
      root: data.root,
      skills: (data.skills || []) as ClaudeCodeSkillEntry[],
      count: data.count ?? (data.skills?.length ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch a single skill's raw SKILL.md content from the bridge. */
async function readClaudeCodeSkill(name: string): Promise<
  | { ok: true; content: string }
  | { ok: false; error: string }
> {
  const base = getBridgeUrl(CLAUDE_BRIDGE_PORT);
  if (!base) return { ok: false, error: 'bridge not available' };
  try {
    const res = await fetchWithTimeout(`${base}/skills/${encodeURIComponent(name)}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `bridge ${res.status}: ${body.slice(0, 200)}` };
    }
    const content = await res.text();
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BulkImportResult = {
  requested: number;
  succeeded: number;
  failed: number;
  items: Array<{
    name: string;
    result: ImportResult | { ok: false; error: string };
  }>;
};

/**
 * Bulk-stage the selected skills. Each fetches from the bridge, validates,
 * and files an `agent_approvals` row — nothing hits `circle_skills`
 * directly. Fails in isolation: one bad skill doesn't break the rest.
 */
export async function importSelectedClaudeCodeSkills(
  names: string[],
  opts: {
    circleId: string;
    userId: string;
    /** If true, existing circle skills with the same name become patch proposals. Default false. */
    allowPatch?: boolean;
  },
): Promise<BulkImportResult> {
  const result: BulkImportResult = { requested: names.length, succeeded: 0, failed: 0, items: [] };
  for (const name of names) {
    const read = await readClaudeCodeSkill(name);
    if (!read.ok) {
      result.failed += 1;
      result.items.push({ name, result: { ok: false, error: read.error } });
      continue;
    }
    const imported = await importLibrarySkillFromText(read.content, {
      circleId: opts.circleId,
      userId: opts.userId,
      allowPatch: opts.allowPatch,
      rationale: `Imported from ~/.claude/skills/${name} via local bridge.`,
    });
    if (imported.ok) result.succeeded += 1;
    else result.failed += 1;
    result.items.push({ name, result: imported });
  }
  return result;
}
