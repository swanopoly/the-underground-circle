/**
 * skillChatCommands — `/skill` slash command family for ChatTab.
 *
 * Matches the shape of `missionChatCommands.ts` so `chatCommandRegistry`
 * can wire this in alongside the existing commands. Phase 2b of the
 * Hermes-adoption plan — gives users a first-class way to import + manage
 * SKILL.md library entries from the chat.
 *
 * Supported sub-commands (phase 1):
 *   /skill                      → help (lists available sub-commands)
 *   /skill list [tag:<t>]       → renders the metadata table
 *   /skill view <name>          → renders the full SKILL.md body
 *   /skill import <url>         → fetches, validates, files a create approval
 *   /skill import --replace <url>  → allowPatch variant
 *
 * Future (phase 2b.1):
 *   /skill export <name>        → returns the markdown so users can share
 *   /skill delete <name>        → files a delete approval (HITL)
 */

import {
  importLibrarySkillFromUrl,
  importLibrarySkillFromText,
  type ImportResult,
} from './skillLibraryImport';
import { listLibrarySkills, viewLibrarySkill } from './skillLibrary';
import {
  claudeBridgeAvailable,
  importSelectedClaudeCodeSkills,
  listClaudeCodeSkills,
} from './claudeSkillsBridge';

export type SkillCommandResult = {
  message: string;
  success: boolean;
};

export type SkillCommandContext = {
  circleId: string;
  userId: string;
};

function helpMessage(): string {
  return [
    '**Skill commands**',
    '• `/skill list [tag:<t>]` — show circle SKILL.md library',
    '• `/skill view <name>` — read a skill\'s full body',
    '• `/skill import <url>` — stage a new skill for review (HITL)',
    '• `/skill import --replace <url>` — update an existing skill',
    '• `/skill import --from-claude-code [name …]` — pull from `~/.claude/skills/` via the local bridge',
    '',
    'Skills follow the [agentskills.io](https://agentskills.io) SKILL.md format — ' +
    'you can paste URLs from Claude Code / Cursor / Codex skill directories.',
  ].join('\n');
}

function parseArgs(input: string): { flags: Set<string>; rest: string } {
  const flags = new Set<string>();
  const tokens = input.split(/\s+/).filter(Boolean);
  const rest: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('--')) flags.add(t.slice(2).toLowerCase());
    else rest.push(t);
  }
  return { flags, rest: rest.join(' ').trim() };
}

function formatImportResult(res: ImportResult): string {
  if (!res.ok) {
    const hint = res.existingSkillName
      ? '\n_Tip: use `/skill import --replace <url>` to file a patch proposal instead._'
      : '';
    return `Skill import failed: ${res.error}${hint}`;
  }
  return `${res.summary}\n\n_Approval id: \`${res.approvalId}\`. A circle member must approve before the skill becomes active._`;
}

// ─── Subcommands ────────────────────────────────────────────────────────────

async function listSubcommand(args: string, ctx: SkillCommandContext): Promise<SkillCommandResult> {
  const tagMatch = args.match(/\btag:([a-z0-9_-]+)\b/i);
  const tags = tagMatch ? [tagMatch[1]] : undefined;
  const skills = await listLibrarySkills(ctx.circleId, { tags, limit: 50 });
  if (skills.length === 0) {
    return {
      success: true,
      message: tags
        ? `No SKILL.md entries with tag \`${tags[0]}\` in this circle yet. Import one with \`/skill import <url>\`.`
        : 'No SKILL.md entries in this circle yet. Import one with `/skill import <url>`.',
    };
  }
  const lines = [
    `**Circle SKILL.md library** (${skills.length} skill${skills.length === 1 ? '' : 's'})`,
    '',
    ...skills.map((s) => {
      const tagTail = s.tags.length > 0 ? ` \`[${s.tags.join(', ')}]\`` : '';
      return `• **${s.name}** v${s.version}${tagTail} — ${s.description}`;
    }),
    '',
    '_Use `/skill view <name>` for the full body._',
  ];
  return { success: true, message: lines.join('\n') };
}

async function viewSubcommand(args: string, ctx: SkillCommandContext): Promise<SkillCommandResult> {
  const name = args.trim();
  if (!name) {
    return { success: false, message: 'Usage: `/skill view <name>` — run `/skill list` to see available skills.' };
  }
  const skill = await viewLibrarySkill(ctx.circleId, name);
  if (!skill) {
    return { success: false, message: `No skill named **${name}** in this circle.` };
  }
  return {
    success: true,
    message: [
      `**${skill.name}** v${skill.version}${skill.tags.length > 0 ? ` \`[${skill.tags.join(', ')}]\`` : ''}`,
      skill.description,
      '',
      '```markdown',
      skill.content,
      '```',
    ].join('\n'),
  };
}

async function importSubcommand(args: string, ctx: SkillCommandContext): Promise<SkillCommandResult> {
  const { flags, rest } = parseArgs(args);

  const allowPatch = flags.has('replace') || flags.has('patch');

  // ── /skill import --from-claude-code [name …] ─────────────────────────────
  // Pulls SKILL.md files from `~/.claude/skills/` via the local bridge and
  // stages each one through the normal HITL queue. Empty name list =
  // import every skill the bridge lists; specific names = import only those.
  if (flags.has('from-claude-code') || flags.has('from-claude') || flags.has('claude-code')) {
    if (!(await claudeBridgeAvailable())) {
      return {
        success: false,
        message: 'Claude Code bridge not reachable. Run `npm run dev` locally (or set `EXPO_PUBLIC_BRIDGE_HOST`) and retry.',
      };
    }
    const listing = await listClaudeCodeSkills();
    if (!listing.ok) {
      return { success: false, message: `Bridge error: ${listing.error}` };
    }
    if (listing.count === 0) {
      return { success: true, message: `No SKILL.md files in \`${listing.root}\`.` };
    }
    const requested = rest.trim().length > 0
      ? rest.split(/[\s,]+/).filter(Boolean)
      : listing.skills.map((s) => s.name);
    const result = await importSelectedClaudeCodeSkills(requested, {
      circleId: ctx.circleId,
      userId: ctx.userId,
      allowPatch,
    });
    const lines = [
      `Imported ${result.succeeded}/${result.requested} Claude Code skills from \`${listing.root}\` (${result.failed} failed).`,
      '',
      ...result.items.map((item) => {
        const status = item.result.ok
          ? `✓ ${item.name} — ${(item.result as ImportResult & { ok: true }).summary}`
          : `✗ ${item.name} — ${(item.result as { ok: false; error: string }).error}`;
        return `- ${status}`;
      }),
    ];
    return { success: result.failed === 0, message: lines.join('\n') };
  }

  if (!rest) {
    return {
      success: false,
      message: 'Usage: `/skill import <url>`, `/skill import --replace <url>`, or `/skill import --from-claude-code [name …]`.',
    };
  }

  // URL vs. pasted text — if it looks like https://, fetch; otherwise treat
  // as raw SKILL.md content. Users paste from editors sometimes.
  let result: ImportResult;
  if (/^https:\/\/\S+$/i.test(rest)) {
    result = await importLibrarySkillFromUrl(rest, {
      circleId: ctx.circleId,
      userId: ctx.userId,
      allowPatch,
    });
  } else if (rest.startsWith('---')) {
    result = await importLibrarySkillFromText(rest, {
      circleId: ctx.circleId,
      userId: ctx.userId,
      allowPatch,
    });
  } else {
    return {
      success: false,
      message: 'Expected an https URL or pasted SKILL.md (must start with `---` frontmatter).',
    };
  }

  return {
    success: result.ok,
    message: formatImportResult(result),
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Parse and execute a `/skill …` command. Returns null if the input isn't
 * a skill command so callers can fall through to other handlers.
 */
export async function executeSkillCommand(
  input: string,
  ctx: SkillCommandContext,
): Promise<SkillCommandResult | null> {
  const m = input.trim().match(/^\/skills?\b\s*(.*)$/i);
  if (!m) return null;
  const rest = (m[1] || '').trim();
  if (!rest) {
    return { success: true, message: helpMessage() };
  }

  const [subcommand, ...rest2] = rest.split(/\s+/);
  const subArgs = rest2.join(' ');
  switch (subcommand.toLowerCase()) {
    case 'help':    return { success: true, message: helpMessage() };
    case 'list':    return listSubcommand(subArgs, ctx);
    case 'view':    return viewSubcommand(subArgs, ctx);
    case 'import':  return importSubcommand(subArgs, ctx);
    default:
      return {
        success: false,
        message: `Unknown subcommand \`${subcommand}\`. Run \`/skill\` for help.`,
      };
  }
}
