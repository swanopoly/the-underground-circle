import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  OPENSWAN_WORKTREE_REQUIRED_FILES,
  buildOpenSwanWorktreeConfigSnapshot,
  formatOpenSwanWorktreeConfigPromptBlock,
  type OpenSwanWorktreeConfigFile,
} from '../src/lib/openswanWorktreeConfig';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = resolve(__dirname, '..');

function readRepoFile(path: string): OpenSwanWorktreeConfigFile {
  const absolutePath = resolve(repoRoot, path);
  return {
    path,
    exists: existsSync(absolutePath),
    content: existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null,
  };
}

function currentIgnoredPatterns(): string[] {
  const gitignorePath = resolve(repoRoot, '.gitignore');
  return readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function currentStatusLines(): string[] {
  return execFileSync('git', ['status', '--short'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).split(/\r?\n/).filter(Boolean);
}

const passingScripts = {
  'typecheck:app': 'tsc --noEmit --skipLibCheck -p tsconfig.json',
  'typecheck:functions': 'node scripts/typecheck-functions.mjs',
  'smoke:agent-standards-wiki': 'npx tsx scripts/agent-standards-wiki-smoketest.ts',
  'smoke:swanbot-openswan-readiness': 'npx tsx scripts/swanbot-openswan-readiness-smoketest.ts',
  'smoke:openswan-task-planner': 'npx tsx scripts/openswan-task-planner-smoketest.ts',
  'smoke:openswan-worktree-config': 'npx tsx scripts/openswan-worktree-config-smoketest.ts',
  'check:openswan-worktree-config': 'npx tsx scripts/openswan-worktree-config-report.ts --fail-on-blocked',
  'smoke:office-roster-grouping': 'npx tsx scripts/office-roster-grouping-smoketest.ts',
  'smoke:desktop-diag': 'npx tsx scripts/desktop-diag-smoketest.ts',
  'check:bridges': 'npx tsx scripts/check-bridges.ts',
};

const missingScript = buildOpenSwanWorktreeConfigSnapshot({
  files: OPENSWAN_WORKTREE_REQUIRED_FILES.map((file) => ({
    path: file.path,
    content: file.requiredSnippets.join('\n'),
  })),
  packageScripts: {
    ...passingScripts,
    'smoke:office-roster-grouping': undefined,
  },
  ignoredPatterns: ['.openswan-worktrees/', '.remember/logs/', '.remember/tmp/'],
});

assert(missingScript.status === 'blocked', 'missing required package script should block config');
assert(missingScript.blockers.some((blocker) => blocker.includes('smoke:office-roster-grouping')), 'blocked snapshot names missing script');

const runtimeNoise = buildOpenSwanWorktreeConfigSnapshot({
  files: OPENSWAN_WORKTREE_REQUIRED_FILES.map((file) => ({
    path: file.path,
    content: file.requiredSnippets.join('\n'),
  })),
  packageScripts: passingScripts,
  ignoredPatterns: ['.openswan-worktrees/'],
  statusLines: ['?? .remember/logs/autonomous/save-123.log'],
});

assert(runtimeNoise.status === 'watch', 'runtime artifact status noise should warn, not block');
assert(runtimeNoise.warnings.some((warning) => warning.includes('.remember/logs/')), 'runtime warning names .remember/logs');
assert(runtimeNoise.nextActions.some((action) => action.includes('.remember/logs/')), 'runtime warning suggests local-only cleanup');

const worktreeLocal = buildOpenSwanWorktreeConfigSnapshot({
  currentPath: '/repo/.openswan-worktrees/openswan-agent-1',
  files: [
    {
      path: 'AGENT.md',
      content: 'You are in an isolated git worktree. Read docs/AGENTS_ROADMAP.md first.',
    },
    {
      path: 'CLAUDE.md',
      content: '# CLAUDE.md — The Underground Circle (WORKTREE COPY — STALE)\nUse the root `CLAUDE.md`.',
    },
    ...OPENSWAN_WORKTREE_REQUIRED_FILES.filter((file) => file.path !== 'AGENT.md' && file.path !== 'CLAUDE.md').map((file) => ({
      path: file.path,
      content: file.requiredSnippets.join('\n'),
    })),
  ],
  packageScripts: passingScripts,
  ignoredPatterns: ['.openswan-worktrees/', '.remember/logs/', '.remember/tmp/'],
});

assert(worktreeLocal.status === 'ready', 'openswan worktree-local notes should pass when they defer to root docs');
assert(worktreeLocal.isOpenSwanWorktree, 'worktree path should be detected');

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
const liveSnapshot = buildOpenSwanWorktreeConfigSnapshot({
  currentPath: repoRoot,
  files: OPENSWAN_WORKTREE_REQUIRED_FILES.map((file) => readRepoFile(file.path)),
  packageScripts: pkg.scripts || {},
  ignoredPatterns: currentIgnoredPatterns(),
  statusLines: currentStatusLines(),
});

assert(liveSnapshot.status !== 'blocked', `live worktree config should not be blocked: ${liveSnapshot.blockers.join(' | ')}`);
assert(liveSnapshot.items.some((item) => item.id === 'script:smoke:openswan-worktree-config' && item.status === 'pass'), 'live config sees OpenSwan worktree smoke script');
assert(liveSnapshot.items.some((item) => item.id === 'script:check:openswan-worktree-config' && item.status === 'pass'), 'live config sees OpenSwan worktree check script');
assert(liveSnapshot.items.some((item) => item.id === 'script:smoke:office-roster-grouping' && item.status === 'pass'), 'live config sees roster smoke script');
assert(liveSnapshot.items.some((item) => item.id === 'ignore:.remember/logs/' && item.status === 'pass'), 'live config sees .remember/logs ignore');
assert(liveSnapshot.items.some((item) => item.id === 'ignore:.remember/tmp/' && item.status === 'pass'), 'live config sees .remember/tmp ignore');

const promptBlock = formatOpenSwanWorktreeConfigPromptBlock(liveSnapshot);
assert(promptBlock.includes('SwanBot/OpenSwan Worktree Config'), 'prompt block includes heading');
assert(promptBlock.includes('status:'), 'prompt block includes status');
assert(promptBlock.includes('next_actions:'), 'prompt block includes next actions');

const reportPrompt = execFileSync('npx', ['tsx', 'scripts/openswan-worktree-config-report.ts', '--prompt', '--fail-on-blocked'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
assert(reportPrompt.includes('SwanBot/OpenSwan Worktree Config'), 'report command prints prompt block');
assert(reportPrompt.includes('status:'), 'report command prompt includes status');

const reportJson = execFileSync('npx', ['tsx', 'scripts/openswan-worktree-config-report.ts', '--json', '--fail-on-blocked'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
const parsedReport = JSON.parse(reportJson) as { status?: string; items?: unknown[] };
assert(parsedReport.status !== 'blocked', 'report command JSON is not blocked');
assert(Array.isArray(parsedReport.items) && parsedReport.items.length > 0, 'report command JSON includes checks');

console.log('openswan-worktree-config smoke passed');
