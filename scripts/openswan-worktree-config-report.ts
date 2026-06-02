import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  OPENSWAN_WORKTREE_REQUIRED_FILES,
  buildOpenSwanWorktreeConfigSnapshot,
  formatOpenSwanWorktreeConfigPromptBlock,
  type OpenSwanWorktreeConfigFile,
} from '../src/lib/openswanWorktreeConfig';

interface CliOptions {
  repoRoot: string;
  format: 'summary' | 'json' | 'prompt';
  failOnBlocked: boolean;
  failOnWatch: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let repoRoot = resolve(__dirname, '..');
  let format: CliOptions['format'] = 'summary';
  let failOnBlocked = false;
  let failOnWatch = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      repoRoot = resolve(argv[i + 1] || repoRoot);
      i += 1;
    } else if (arg === '--json') {
      format = 'json';
    } else if (arg === '--prompt') {
      format = 'prompt';
    } else if (arg === '--fail-on-blocked') {
      failOnBlocked = true;
    } else if (arg === '--fail-on-watch') {
      failOnBlocked = true;
      failOnWatch = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return { repoRoot, format, failOnBlocked, failOnWatch };
}

function printHelp(): void {
  console.log([
    'Usage: npx tsx scripts/openswan-worktree-config-report.ts [options]',
    '',
    'Options:',
    '  --repo <path>       Repo/worktree root to inspect. Defaults to this repo.',
    '  --json              Print the full snapshot as JSON.',
    '  --prompt            Print the hidden prompt block for agent handoff.',
    '  --fail-on-blocked   Exit 2 when required config is blocked.',
    '  --fail-on-watch     Exit 3 on warnings and 2 on blockers.',
  ].join('\n'));
}

function readRepoFile(repoRoot: string, path: string): OpenSwanWorktreeConfigFile {
  const absolutePath = resolve(repoRoot, path);
  return {
    path,
    exists: existsSync(absolutePath),
    content: existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null,
  };
}

function readPackageScripts(repoRoot: string): Record<string, string | undefined> {
  const pkgPath = resolve(repoRoot, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

function currentIgnoredPatterns(repoRoot: string): string[] {
  const gitignorePath = resolve(repoRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return [];
  return readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function gitOutput(repoRoot: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function currentStatusLines(repoRoot: string): string[] {
  return gitOutput(repoRoot, ['status', '--short'])
    .split(/\r?\n/)
    .filter(Boolean);
}

function currentWorktreePaths(repoRoot: string): string[] {
  const output = gitOutput(repoRoot, ['worktree', 'list', '--porcelain']);
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.replace(/^worktree\s+/, '').trim())
    .filter((path) => path.includes('.openswan-worktrees/'));
}

function buildLiveSnapshot(repoRoot: string) {
  return buildOpenSwanWorktreeConfigSnapshot({
    currentPath: repoRoot,
    files: OPENSWAN_WORKTREE_REQUIRED_FILES.map((file) => readRepoFile(repoRoot, file.path)),
    packageScripts: readPackageScripts(repoRoot),
    ignoredPatterns: currentIgnoredPatterns(repoRoot),
    statusLines: currentStatusLines(repoRoot),
    worktreePaths: currentWorktreePaths(repoRoot),
  });
}

function formatSummary(snapshot: ReturnType<typeof buildLiveSnapshot>): string {
  const lines = [
    `SwanBot/OpenSwan worktree config: ${snapshot.label} (${snapshot.score})`,
    `status: ${snapshot.status}`,
    `summary: ${snapshot.summary}`,
  ];

  if (snapshot.blockers.length) {
    lines.push('blockers:');
    lines.push(...snapshot.blockers.map((item) => `- ${item}`));
  }
  if (snapshot.warnings.length) {
    lines.push('warnings:');
    lines.push(...snapshot.warnings.map((item) => `- ${item}`));
  }
  if (snapshot.nextActions.length) {
    lines.push('next actions:');
    lines.push(...snapshot.nextActions.map((item) => `- ${item}`));
  }
  return lines.join('\n');
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = buildLiveSnapshot(options.repoRoot);

  if (options.format === 'json') {
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (options.format === 'prompt') {
    console.log(formatOpenSwanWorktreeConfigPromptBlock(snapshot));
  } else {
    console.log(formatSummary(snapshot));
  }

  if (snapshot.status === 'blocked' && options.failOnBlocked) process.exit(2);
  if (snapshot.status === 'watch' && options.failOnWatch) process.exit(3);
}

main();
