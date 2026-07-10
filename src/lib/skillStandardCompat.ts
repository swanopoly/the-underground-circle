/**
 * skillStandardCompat — X8 (P50): audit + import/export mapping between our
 * skill library (`circle_skills` + `circle_skill_files`) and Anthropic's
 * Agent Skills open standard (folder + SKILL.md, Dec 2025; also the
 * agentskills.io shape our library already targets).
 *
 * Spec facts (verified against the agent-skills overview doc, fetched
 * 2026-07-10):
 *   - Required frontmatter: `name`, `description`.
 *   - `name`: ≤64 chars; ONLY lowercase letters, numbers, hyphens; no XML
 *     tags; must not contain the reserved words "anthropic" or "claude".
 *   - `description`: non-empty; ≤1024 chars; no XML tags; should say both
 *     WHAT the skill does and WHEN to use it (triggering guidance).
 *   - SKILL.md body (Level-2, loaded on trigger): keep under ~5k tokens.
 *   - Supporting files are referenced by RELATIVE path inside the folder.
 *   - Portability: the same folder/zip uploads to claude.ai, the Skills API
 *     (`/v1/skills`), and drops into Claude Code — but only when the
 *     constraints above hold; violations are rejected at upload.
 *
 * Why this exists: a circle skill that violates the standard silently loses
 * portability — it works in OUR prompt injection but is rejected the moment
 * someone exports it to claude.ai/API/Claude Code. The auditor makes that
 * legible (fail-visible) at proposal time and in CI; the builder produces a
 * standard-conformant SKILL.md for export.
 *
 * Composes with the existing pure helpers (`skillFrontmatter`,
 * `skillRelPath`) — no new parsing dialects. Pure: tsx-loadable, bounded,
 * non-mutating, never throws.
 */

import { parseSkillFrontmatter } from './skillFrontmatter';
import { parseSkillRelPath } from './skillRelPath';

// ─── Spec constants (pinned by smoke) ───────────────────────────────────────

export const ANTHROPIC_SKILL_NAME_MAX_CHARS = 64;
export const ANTHROPIC_SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;
export const ANTHROPIC_SKILL_RESERVED_NAME_WORDS: ReadonlyArray<string> = ['anthropic', 'claude'];
export const ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS = 1024;
/** Level-2 guidance from the doc: SKILL.md body "Under 5k tokens". */
export const SKILL_BODY_TOKEN_GUIDANCE = 5_000;

const XML_TAG_PATTERN = /<[^<>]+>/;
/** WHEN-signal heuristic — the doc says descriptions should include when to
 *  use the skill; absence is a quality warning, not a rejection. */
const WHEN_SIGNAL_PATTERN = /\buse (?:this )?(?:skill )?when\b|\bwhen (?:the )?user\b|\bwhen (?:working|asked|you)\b|\btrigger/i;

// ─── Audit ──────────────────────────────────────────────────────────────────

export type SkillCompatSeverity = 'error' | 'warning';

export interface SkillCompatFinding {
  rule: string;
  severity: SkillCompatSeverity;
  field: 'name' | 'description' | 'content' | 'files';
  message: string;
}

export interface SkillCompatAudit {
  /** True when NO error-severity findings exist — the skill would survive a
   *  standard upload as-is (warnings are quality, not rejection). */
  portable: boolean;
  findings: SkillCompatFinding[];
  /** The name a standard export would use (see normalizeSkillNameForStandard). */
  normalizedName: string;
}

export interface SkillCompatInput {
  name: string;
  description?: string | null;
  /** Full SKILL.md content (frontmatter + body) when available. */
  content?: string | null;
  /** Supporting-file relative paths (circle_skill_files.relpath). */
  fileRelpaths?: ReadonlyArray<string> | null;
}

function findingsForName(name: string, findings: SkillCompatFinding[]): void {
  if (!name || !name.trim()) {
    findings.push({ rule: 'name-empty', severity: 'error', field: 'name', message: 'name is required by the standard' });
    return;
  }
  if (name.length > ANTHROPIC_SKILL_NAME_MAX_CHARS) {
    findings.push({ rule: 'name-too-long', severity: 'error', field: 'name', message: `name exceeds ${ANTHROPIC_SKILL_NAME_MAX_CHARS} chars (${name.length})` });
  }
  if (XML_TAG_PATTERN.test(name)) {
    findings.push({ rule: 'name-xml', severity: 'error', field: 'name', message: 'name must not contain XML tags' });
  } else if (!ANTHROPIC_SKILL_NAME_PATTERN.test(name)) {
    findings.push({ rule: 'name-charset', severity: 'error', field: 'name', message: 'name must be lowercase letters, numbers, and hyphens only' });
  }
  const lower = name.toLowerCase();
  for (const reserved of ANTHROPIC_SKILL_RESERVED_NAME_WORDS) {
    if (lower.includes(reserved)) {
      findings.push({ rule: 'name-reserved-word', severity: 'error', field: 'name', message: `name must not contain the reserved word "${reserved}"` });
    }
  }
}

function findingsForDescription(description: string | null | undefined, findings: SkillCompatFinding[]): void {
  const text = typeof description === 'string' ? description.trim() : '';
  if (!text) {
    findings.push({ rule: 'description-empty', severity: 'error', field: 'description', message: 'description is required and must be non-empty' });
    return;
  }
  if (text.length > ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS) {
    findings.push({ rule: 'description-too-long', severity: 'error', field: 'description', message: `description exceeds ${ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS} chars (${text.length})` });
  }
  if (XML_TAG_PATTERN.test(text)) {
    findings.push({ rule: 'description-xml', severity: 'error', field: 'description', message: 'description must not contain XML tags' });
  }
  if (!WHEN_SIGNAL_PATTERN.test(text)) {
    findings.push({ rule: 'description-missing-when-signal', severity: 'warning', field: 'description', message: 'description should say WHEN to use the skill (triggering guidance), not just what it does' });
  }
}

/**
 * Audit one skill against the Agent Skills standard. `portable` is true only
 * when no error-severity findings exist. Never throws.
 */
export function auditSkillStandardCompat(input: SkillCompatInput): SkillCompatAudit {
  const findings: SkillCompatFinding[] = [];
  const name = typeof input?.name === 'string' ? input.name : '';

  findingsForName(name, findings);
  findingsForDescription(input?.description, findings);

  if (typeof input?.content === 'string' && input.content.trim()) {
    const parsed = parseSkillFrontmatter(input.content);
    if (!parsed.rawFrontmatter) {
      findings.push({ rule: 'content-missing-frontmatter', severity: 'warning', field: 'content', message: 'SKILL.md content has no frontmatter block — the standard export will synthesize one' });
    } else if (parsed.name && name && parsed.name !== name) {
      findings.push({ rule: 'frontmatter-name-mismatch', severity: 'warning', field: 'content', message: `frontmatter name "${parsed.name}" differs from the library name "${name}" — export rewrites it` });
    }
    const body = parsed.rawFrontmatter ? parsed.body : input.content;
    const estimatedTokens = Math.ceil(body.length / 4);
    if (estimatedTokens > SKILL_BODY_TOKEN_GUIDANCE) {
      findings.push({ rule: 'body-over-token-guidance', severity: 'warning', field: 'content', message: `body is ~${estimatedTokens} tokens; the standard's Level-2 guidance is under ${SKILL_BODY_TOKEN_GUIDANCE} — consider moving detail into supporting files` });
    }
  }

  for (const relpath of input?.fileRelpaths ?? []) {
    const parsed = parseSkillRelPath(relpath);
    if (!parsed.ok) {
      findings.push({ rule: 'file-unsafe-relpath', severity: 'error', field: 'files', message: `supporting file path "${String(relpath).slice(0, 120)}" is not a safe relative path (folder-portable paths only)` });
    }
  }

  return {
    portable: !findings.some((f) => f.severity === 'error'),
    findings,
    normalizedName: normalizeSkillNameForStandard(name),
  };
}

// ─── Name normalization (export-side) ───────────────────────────────────────

/**
 * Coerce an arbitrary library name to the standard's charset: lowercase;
 * spaces/underscores/dots → hyphens; other illegal chars dropped; hyphens
 * collapsed and trimmed; clipped to 64. Reserved-word violations are NOT
 * fixable mechanically — they stay an audit error the author must resolve.
 */
export function normalizeSkillNameForStandard(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ANTHROPIC_SKILL_NAME_MAX_CHARS);
}

// ─── Standard SKILL.md builder (export-side) ────────────────────────────────

export interface BuildStandardSkillMdInput {
  name: string;
  description: string;
  /** Full library content — when it has frontmatter, only its BODY is used
   *  (the standard frontmatter is rewritten from the fields here). */
  content?: string | null;
  version?: string | null;
  tags?: ReadonlyArray<string> | null;
}

export interface BuildStandardSkillMdResult {
  markdown: string;
  normalizedName: string;
  /** Residual findings on the EXPORTED artifact (reserved-word names etc.). */
  findings: SkillCompatFinding[];
}

function scrubInline(text: string, maxChars: number): string {
  return text.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/**
 * Produce a standard-conformant SKILL.md: normalized name, scrubbed/clipped
 * description, body carried from the library content (frontmatter stripped),
 * optional version/tags extras (tolerated by the standard). Round-trips
 * through `parseSkillFrontmatter`. The residual audit reports anything an
 * export can NOT mechanically fix (empty name after normalization,
 * reserved words).
 */
export function buildStandardSkillMd(input: BuildStandardSkillMdInput): BuildStandardSkillMdResult {
  const normalizedName = normalizeSkillNameForStandard(input?.name);
  const description = scrubInline(String(input?.description ?? ''), ANTHROPIC_SKILL_DESCRIPTION_MAX_CHARS);

  let body = '';
  if (typeof input?.content === 'string' && input.content.trim()) {
    const parsed = parseSkillFrontmatter(input.content);
    body = (parsed.rawFrontmatter ? parsed.body : input.content).trim();
  }

  const lines = ['---', `name: ${normalizedName}`, `description: ${description}`];
  if (typeof input?.version === 'string' && input.version.trim()) {
    lines.push(`version: ${input.version.trim().slice(0, 32)}`);
  }
  const tags = (input?.tags ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  if (tags.length > 0) lines.push(`tags: [${tags.join(', ')}]`);
  lines.push('---', '');

  const markdown = lines.join('\n') + (body ? `${body}\n` : '');
  const residual = auditSkillStandardCompat({ name: normalizedName, description, content: markdown });
  return { markdown, normalizedName, findings: residual.findings };
}

// ─── Chat-safe summary (for approval descriptions / tool results) ──────────

/**
 * One bounded line describing portability — or null when fully portable with
 * no warnings (no noise). Errors lead; warnings only surface when there are
 * no errors.
 */
export function summarizeSkillCompat(audit: SkillCompatAudit): string | null {
  if (!audit || audit.findings.length === 0) return null;
  const errors = audit.findings.filter((f) => f.severity === 'error');
  if (errors.length > 0) {
    const first = errors[0].message;
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
    return `⚠️ not portable to the Agent Skills standard: ${first}${more}`;
  }
  const warnings = audit.findings.map((f) => f.rule).join(', ');
  return `portable with warnings: ${warnings}`;
}
