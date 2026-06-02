export type OpenSwanWorktreeConfigStatus = 'ready' | 'watch' | 'blocked';
export type OpenSwanWorktreeConfigItemStatus = 'pass' | 'warn' | 'fail';

export interface OpenSwanWorktreeConfigFile {
  path: string;
  content?: string | null;
  exists?: boolean;
}

export interface OpenSwanWorktreeConfigInput {
  currentPath?: string | null;
  files?: OpenSwanWorktreeConfigFile[];
  packageScripts?: Record<string, string | undefined>;
  ignoredPatterns?: string[];
  statusLines?: string[];
  worktreePaths?: string[];
}

export interface OpenSwanWorktreeConfigItem {
  id: string;
  label: string;
  status: OpenSwanWorktreeConfigItemStatus;
  detail: string;
  fix?: string;
}

export interface OpenSwanWorktreeConfigSnapshot {
  status: OpenSwanWorktreeConfigStatus;
  score: number;
  label: string;
  summary: string;
  isOpenSwanWorktree: boolean;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
  items: OpenSwanWorktreeConfigItem[];
}

export interface OpenSwanWorktreeRequiredFile {
  id: string;
  path: string;
  label: string;
  requiredSnippets: string[];
  fix: string;
}

export const OPENSWAN_WORKTREE_REQUIRED_FILES: OpenSwanWorktreeRequiredFile[] = [
  {
    id: 'agents-entry',
    path: 'AGENTS.md',
    label: 'Agent entrypoint',
    requiredSnippets: [
      'docs/AGENTS_ROADMAP.md',
      'docs/UC_APP_STACK_REFERENCE.md',
      'If you are in an openswan worktree',
      '.openswan-worktrees/',
    ],
    fix: 'Keep AGENTS.md as the short read-order entrypoint for all agents and worktrees.',
  },
  {
    id: 'codex-notes',
    path: 'AGENT.md',
    label: 'Codex worktree notes',
    requiredSnippets: [
      'docs/AGENTS_ROADMAP.md',
      'Treat the worktree as shared',
      'runtime changes',
    ],
    fix: 'Update AGENT.md with current shared-worktree and runtime verification rules.',
  },
  {
    id: 'claude-context',
    path: 'CLAUDE.md',
    label: 'Project context',
    requiredSnippets: [
      'BlackSwan/OpenSwan',
      'swanbot-v2-ai',
      'Computer Use',
      'Provider Routing',
    ],
    fix: 'Refresh CLAUDE.md when app-wide runtime, provider, or computer-use direction changes.',
  },
  {
    id: 'roadmap',
    path: 'docs/AGENTS_ROADMAP.md',
    label: 'Canonical roadmap',
    requiredSnippets: [
      'SwanBot/OpenSwan M4 readiness gate',
      'worktree quality',
      'OpenSwan runtime',
    ],
    fix: 'Record shipped runtime/configuration work in docs/AGENTS_ROADMAP.md.',
  },
  {
    id: 'stack-reference',
    path: 'docs/UC_APP_STACK_REFERENCE.md',
    label: 'Stack reference',
    requiredSnippets: [
      'SwanBot/OpenSwan default readiness',
      'Agent standards and worktree quality',
      'Office bridge readiness',
    ],
    fix: 'Keep docs/UC_APP_STACK_REFERENCE.md aligned with the active runtime file map.',
  },
  {
    id: 'standards-index',
    path: 'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    label: 'Agent development standards index',
    requiredSnippets: [
      'Worktree Integration Checklist',
      'buildAgentWorktreeQualityChecklist',
      'src/lib/openswanWorktreeConfig.ts',
      'buildOpenSwanWorktreeConfigSnapshot',
      'npm run smoke:agent-standards-wiki',
      'npm run smoke:openswan-worktree-config',
    ],
    fix: 'Keep the standards index in sync with agentDevelopmentStandards and worktree smoke coverage.',
  },
];

export const OPENSWAN_WORKTREE_REQUIRED_PACKAGE_SCRIPTS: Record<string, string> = {
  'typecheck:app': 'tsc --noEmit',
  'typecheck:functions': 'typecheck-functions',
  'smoke:agent-standards-wiki': 'agent-standards-wiki-smoketest',
  'smoke:swanbot-openswan-readiness': 'swanbot-openswan-readiness-smoketest',
  'smoke:openswan-task-planner': 'openswan-task-planner-smoketest',
  'smoke:openswan-worktree-config': 'openswan-worktree-config-smoketest',
  'check:openswan-worktree-config': 'openswan-worktree-config-report',
  'smoke:office-roster-grouping': 'office-roster-grouping-smoketest',
  'smoke:desktop-diag': 'desktop-diag-smoketest',
  'check:bridges': 'check-bridges',
};

export const OPENSWAN_WORKTREE_REQUIRED_IGNORES = [
  '.openswan-worktrees/',
  '.remember/logs/',
  '.remember/tmp/',
];

export const OPENSWAN_WORKTREE_RUNTIME_ARTIFACT_PREFIXES = [
  '.remember/logs/',
  '.remember/tmp/',
];

export function buildOpenSwanWorktreeConfigSnapshot(
  input: OpenSwanWorktreeConfigInput = {},
): OpenSwanWorktreeConfigSnapshot {
  const items: OpenSwanWorktreeConfigItem[] = [];
  const files = new Map((input.files || []).map((file) => [normalizePath(file.path), file]));
  const packageScripts = input.packageScripts || {};
  const ignoredPatterns = new Set((input.ignoredPatterns || []).map(normalizeDirectoryPattern));
  const isOpenSwanWorktree = normalizePath(input.currentPath || '').includes('.openswan-worktrees/');

  for (const requiredFile of OPENSWAN_WORKTREE_REQUIRED_FILES) {
    if (isOpenSwanWorktree && (requiredFile.path === 'AGENT.md' || requiredFile.path === 'CLAUDE.md')) {
      continue;
    }

    const file = files.get(normalizePath(requiredFile.path));
    const exists = file?.exists !== false && typeof file?.content === 'string';
    if (!exists) {
      items.push({
        id: requiredFile.id,
        label: requiredFile.label,
        status: 'fail',
        detail: `${requiredFile.path} is missing from the worktree config snapshot.`,
        fix: requiredFile.fix,
      });
      continue;
    }

    const missingSnippets = requiredFile.requiredSnippets.filter((snippet) => !String(file?.content || '').includes(snippet));
    items.push({
      id: requiredFile.id,
      label: requiredFile.label,
      status: missingSnippets.length > 0 ? 'fail' : 'pass',
      detail: missingSnippets.length > 0
        ? `${requiredFile.path} is missing required config text: ${missingSnippets.join(', ')}.`
        : `${requiredFile.path} carries the required SwanBot/OpenSwan worktree guidance.`,
      fix: missingSnippets.length > 0 ? requiredFile.fix : undefined,
    });
  }

  for (const [scriptName, expectedFragment] of Object.entries(OPENSWAN_WORKTREE_REQUIRED_PACKAGE_SCRIPTS)) {
    const command = packageScripts[scriptName] || '';
    items.push({
      id: `script:${scriptName}`,
      label: `Package script ${scriptName}`,
      status: command.includes(expectedFragment) ? 'pass' : 'fail',
      detail: command.includes(expectedFragment)
        ? `${scriptName} is wired to ${command}.`
        : `${scriptName} is missing or does not include ${expectedFragment}.`,
      fix: `Add or fix package.json script ${scriptName}.`,
    });
  }

  for (const ignorePattern of OPENSWAN_WORKTREE_REQUIRED_IGNORES) {
    items.push({
      id: `ignore:${ignorePattern}`,
      label: `Ignore ${ignorePattern}`,
      status: ignoredPatterns.has(normalizeDirectoryPattern(ignorePattern)) ? 'pass' : 'warn',
      detail: ignoredPatterns.has(normalizeDirectoryPattern(ignorePattern))
        ? `${ignorePattern} is ignored.`
        : `${ignorePattern} is not ignored, so local/generated worktree artifacts may pollute agent reviews.`,
      fix: `Add ${ignorePattern} to .gitignore when it is local/generated output.`,
    });
  }

  for (const line of input.statusLines || []) {
    const statusPath = normalizeStatusPath(line);
    const runtimeArtifact = OPENSWAN_WORKTREE_RUNTIME_ARTIFACT_PREFIXES.find((prefix) => statusPath.startsWith(prefix));
    if (runtimeArtifact) {
      items.push({
        id: `status-noise:${runtimeArtifact}`,
        label: `Unignored runtime artifact ${runtimeArtifact}`,
        status: 'warn',
        detail: `${line.trim()} is visible in git status and should be ignored or cleaned before review.`,
        fix: `Keep ${runtimeArtifact} local-only and out of agent review diffs.`,
      });
    }
  }

  if (isOpenSwanWorktree) {
    const agentFile = files.get('AGENT.md');
    const claudeFile = files.get('CLAUDE.md');
    const agentOk = String(agentFile?.content || '').includes('isolated git worktree')
      && String(agentFile?.content || '').includes('docs/AGENTS_ROADMAP.md');
    const claudeOk = String(claudeFile?.content || '').includes('WORKTREE COPY')
      && String(claudeFile?.content || '').includes('root `CLAUDE.md`');
    items.push({
      id: 'openswan-worktree-local-agent-notes',
      label: 'OpenSwan worktree-local notes',
      status: agentOk && claudeOk ? 'pass' : 'fail',
      detail: agentOk && claudeOk
        ? 'OpenSwan worktree-local AGENT.md and CLAUDE.md defer correctly to root canonical docs.'
        : 'OpenSwan worktree-local notes do not clearly defer to the root roadmap and CLAUDE.md.',
      fix: 'Regenerate or update the worktree-local notes before delegating work into this worktree.',
    });
  } else if ((input.worktreePaths || []).length > 0) {
    items.push({
      id: 'openswan-worktree-inventory',
      label: 'OpenSwan worktree inventory',
      status: 'pass',
      detail: `${input.worktreePaths?.length || 0} OpenSwan worktree path${(input.worktreePaths?.length || 0) === 1 ? '' : 's'} detected.`,
    });
  }

  const blockers = items.filter((item) => item.status === 'fail').map((item) => item.detail);
  const warnings = items.filter((item) => item.status === 'warn').map((item) => item.detail);
  const status: OpenSwanWorktreeConfigStatus = blockers.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'watch'
      : 'ready';
  const score = scoreWorktreeConfig(items);
  const label = status === 'ready'
    ? 'WORKTREE READY'
    : status === 'watch'
      ? 'WORKTREE WATCH'
      : 'WORKTREE BLOCKED';
  const nextActions = buildNextActions(items, status);

  return {
    status,
    score,
    label,
    summary: buildSummary(status, blockers.length, warnings.length),
    isOpenSwanWorktree,
    blockers,
    warnings,
    nextActions,
    items,
  };
}

export function formatOpenSwanWorktreeConfigPromptBlock(
  snapshot: OpenSwanWorktreeConfigSnapshot,
): string {
  const blockers = snapshot.blockers.length ? snapshot.blockers.join(' | ') : 'none';
  const warnings = snapshot.warnings.length ? snapshot.warnings.join(' | ') : 'none';
  const actions = snapshot.nextActions.length ? snapshot.nextActions.join(' | ') : 'none';
  const checks = snapshot.items
    .slice(0, 18)
    .map((item) => `${item.status}:${item.id}`)
    .join(', ');
  const remaining = snapshot.items.length > 18 ? `, +${snapshot.items.length - 18} more` : '';

  return [
    '## SwanBot/OpenSwan Worktree Config',
    `status: ${snapshot.status}`,
    `label: ${snapshot.label}`,
    `score: ${snapshot.score}`,
    `is_openswan_worktree: ${snapshot.isOpenSwanWorktree ? 'yes' : 'no'}`,
    `summary: ${snapshot.summary}`,
    `checks: ${checks}${remaining}`,
    `blockers: ${blockers}`,
    `warnings: ${warnings}`,
    `next_actions: ${actions}`,
  ].join('\n');
}

function buildSummary(status: OpenSwanWorktreeConfigStatus, blockerCount: number, warningCount: number): string {
  if (status === 'ready') {
    return 'SwanBot/OpenSwan worktree configuration is complete and ready for agent handoff.';
  }
  if (status === 'watch') {
    return `SwanBot/OpenSwan worktree configuration has ${warningCount} warning${warningCount === 1 ? '' : 's'} to clean up.`;
  }
  return `SwanBot/OpenSwan worktree configuration is blocked by ${blockerCount} required item${blockerCount === 1 ? '' : 's'}.`;
}

function buildNextActions(items: OpenSwanWorktreeConfigItem[], status: OpenSwanWorktreeConfigStatus): string[] {
  if (status === 'ready') {
    return ['Use this worktree for SwanBot/OpenSwan tasks, then run the focused smoke plus typecheck before handoff.'];
  }
  return Array.from(new Set(
    items
      .filter((item) => item.status !== 'pass' && item.fix)
      .map((item) => item.fix as string),
  )).slice(0, 6);
}

function scoreWorktreeConfig(items: OpenSwanWorktreeConfigItem[]): number {
  if (items.length === 0) return 0;
  const raw = items.reduce((sum, item) => {
    if (item.status === 'pass') return sum + 1;
    if (item.status === 'warn') return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((raw / items.length) * 100);
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeDirectoryPattern(pattern: string): string {
  const normalized = normalizePath(pattern);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeStatusPath(line: string): string {
  const trimmed = String(line || '').trim();
  const statusMatch = trimmed.match(/^(?:[ MADRCU?!]{1,2})\s+(.+)$/);
  const rawPath = statusMatch?.[1] || trimmed;
  return normalizePath(rawPath);
}
