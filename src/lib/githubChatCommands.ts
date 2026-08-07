/**
 * githubChatCommands.ts — Bridge between chat interface and GitHub API
 *
 * Parses /gh commands and natural language GitHub requests from circle
 * chat or room chat, executes the corresponding GitHub operation, and
 * returns a formatted response suitable for display in the chat UI.
 */

import { supabase } from './supabase';
import {
  getStoredToken,
  getRepoTree,
  getFileContent,
  createOrUpdateFile,
  deleteFileFromRepo,
  createBranch,
  listBranches,
  createPullRequest,
  listPullRequests,
  commitMultipleFiles,
  listCommits,
  compareBranches,
  getFileSha,
  getRepoInfo,
  type GitHubRepo,
  type GitHubTreeEntry,
} from './github';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitHubChatContext {
  circleId: string;
  userId: string;
  repoFullName?: string; // "owner/repo" — if set, commands target this repo
}

export interface GitHubCommandResult {
  success: boolean;
  message: string;     // formatted response to show in chat
  data?: any;          // raw data for further processing
}

// ─── Token Resolution ────────────────────────────────────────────────────────

/**
 * Get a client-held GitHub PAT for this circle. OAuth tokens are server-only;
 * browser-side GitHub commands fail closed until their operation is available
 * through the authenticated GitHub edge proxy.
 */
async function getToken(circleId: string, _userId: string): Promise<string | null> {
  return (await getStoredToken(circleId)) || null;
}

// ─── Repo Resolution ─────────────────────────────────────────────────────────

/**
 * Get the default connected repo for this circle from circle_github_connections.
 * Returns the most recently active connection.
 */
async function getDefaultRepo(
  circleId: string,
): Promise<{ owner: string; repo: string; branch: string } | null> {
  try {
    const { data } = await supabase
      .from('circle_github_connections')
      .select('owner, repo, default_branch')
      .eq('circle_id', circleId)
      .eq('is_active', true)
      .order('last_event_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return {
        owner: data.owner,
        repo: data.repo,
        branch: data.default_branch || 'main',
      };
    }
  } catch {
    // Table missing or RLS issue
  }
  return null;
}

/**
 * Parse an "owner/repo" string, falling back to the context or default repo.
 */
function resolveRepo(
  context: GitHubChatContext,
  defaultRepo: { owner: string; repo: string; branch: string } | null,
  explicitRepo?: string,
): { owner: string; repo: string; branch: string } | null {
  if (explicitRepo) {
    const parts = explicitRepo.split('/');
    if (parts.length === 2) {
      return { owner: parts[0], repo: parts[1], branch: defaultRepo?.branch || 'main' };
    }
  }
  if (context.repoFullName) {
    const parts = context.repoFullName.split('/');
    if (parts.length === 2) {
      return { owner: parts[0], repo: parts[1], branch: defaultRepo?.branch || 'main' };
    }
  }
  return defaultRepo;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noRepo(): GitHubCommandResult {
  return {
    success: false,
    message: 'Error: No GitHub repository connected to this circle. Use the GitHub tab to connect one first.',
  };
}

function noToken(): GitHubCommandResult {
  return {
    success: false,
    message: 'Error: No GitHub token found. Connect via OAuth in the GitHub tab or add a Personal Access Token.',
  };
}

function errorResult(msg: string): GitHubCommandResult {
  return { success: false, message: `Error: ${msg}` };
}

/** Truncate text to a max number of lines */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines truncated)`;
}

// ─── Command Handlers ────────────────────────────────────────────────────────

async function handleStatus(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  circleId: string,
): Promise<GitHubCommandResult> {
  try {
    // Fetch repo info and recent connections
    const [repoResult, connectionsResult] = await Promise.all([
      getRepoInfo(token, repo.owner, repo.repo),
      supabase
        .from('circle_github_connections')
        .select('full_name, default_branch, is_active, event_count, last_event_at')
        .eq('circle_id', circleId)
        .eq('is_active', true),
    ]);

    const lines: string[] = ['**GitHub Status**', ''];

    if (connectionsResult.data && connectionsResult.data.length > 0) {
      lines.push('**Connected Repos:**');
      for (const conn of connectionsResult.data) {
        const eventInfo = conn.event_count > 0
          ? ` (${conn.event_count} events)`
          : '';
        const lastEvent = conn.last_event_at
          ? ` | last activity: ${new Date(conn.last_event_at).toLocaleDateString()}`
          : '';
        lines.push(`- \`${conn.full_name}\` [${conn.default_branch}]${eventInfo}${lastEvent}`);
      }
    } else {
      lines.push('No repos connected.');
    }

    if (repoResult.repo) {
      const r = repoResult.repo;
      lines.push('', '**Active Repo Details:**');
      lines.push(`- Name: \`${r.full_name}\``);
      lines.push(`- Default branch: \`${r.default_branch}\``);
      lines.push(`- Language: ${r.language || 'N/A'}`);
      lines.push(`- Stars: ${r.stargazers_count} | Forks: ${r.forks_count} | Open Issues: ${r.open_issues_count}`);
      lines.push(`- Private: ${r.private ? 'Yes' : 'No'}`);
      lines.push(`- Last updated: ${new Date(r.updated_at).toLocaleDateString()}`);
    } else if (repoResult.error) {
      lines.push('', `Could not fetch repo details: ${repoResult.error}`);
    }

    return { success: true, message: lines.join('\n'), data: repoResult.repo };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to fetch status');
  }
}

async function handleTree(
  token: string,
  repo: { owner: string; repo: string; branch: string },
): Promise<GitHubCommandResult> {
  try {
    const { tree, truncated, error } = await getRepoTree(token, repo.owner, repo.repo, repo.branch);
    if (error) return errorResult(error);

    // Build a concise tree view — folders and top-level files
    const MAX_ENTRIES = 50;
    const folders = new Set<string>();
    const files: string[] = [];

    for (const entry of tree) {
      if (entry.type === 'tree') {
        folders.add(entry.path);
      }
    }

    // Sort entries: folders first, then files, alphabetically
    const sortedEntries = [...tree]
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
        return a.path.localeCompare(b.path);
      })
      .slice(0, MAX_ENTRIES);

    const lines: string[] = [
      `**File Tree** \`${repo.owner}/${repo.repo}\` (\`${repo.branch}\`)`,
      '',
    ];

    for (const entry of sortedEntries) {
      const depth = entry.path.split('/').length - 1;
      const indent = '  '.repeat(depth);
      const name = entry.path.split('/').pop() || entry.path;
      if (entry.type === 'tree') {
        lines.push(`${indent}📁 ${name}/`);
      } else {
        const sizeStr = entry.size ? ` (${formatSize(entry.size)})` : '';
        lines.push(`${indent}📄 ${name}${sizeStr}`);
      }
    }

    if (tree.length > MAX_ENTRIES) {
      lines.push('', `... and ${tree.length - MAX_ENTRIES} more entries`);
    }
    if (truncated) {
      lines.push('(tree was truncated by GitHub — repo is very large)');
    }

    return { success: true, message: lines.join('\n'), data: tree };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to fetch file tree');
  }
}

async function handleCat(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  filePath: string,
): Promise<GitHubCommandResult> {
  try {
    const { content, size, sha, error } = await getFileContent(
      token, repo.owner, repo.repo, filePath,
    );
    if (error) return errorResult(error);

    const ext = filePath.split('.').pop() || '';
    const lang = getLanguageHint(ext);
    const truncated = truncateLines(content, 80);

    const lines: string[] = [
      `**${filePath}** (${formatSize(size)})`,
      '',
      '```' + lang,
      truncated,
      '```',
    ];

    return { success: true, message: lines.join('\n'), data: { content, sha, size } };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to fetch file');
  }
}

async function handleEdit(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  filePath: string,
): Promise<GitHubCommandResult> {
  try {
    const { content, sha, size, error } = await getFileContent(
      token, repo.owner, repo.repo, filePath,
    );
    if (error) return errorResult(error);

    const ext = filePath.split('.').pop() || '';
    const lang = getLanguageHint(ext);

    const lines: string[] = [
      `**Editing:** \`${filePath}\` (${formatSize(size)})`,
      `**Branch:** \`${repo.branch}\``,
      `**SHA:** \`${sha.slice(0, 8)}\``,
      '',
      'Current content:',
      '',
      '```' + lang,
      truncateLines(content, 100),
      '```',
      '',
      'To save changes, use: `/gh save ' + filePath + '` with the new content.',
    ];

    return { success: true, message: lines.join('\n'), data: { content, sha, size, filePath } };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to fetch file for editing');
  }
}

async function handleSave(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  filePath: string,
  content: string,
  commitMessage?: string,
): Promise<GitHubCommandResult> {
  try {
    // Try to get existing file SHA (needed for updates)
    const existingSha = await getFileSha(token, repo.owner, repo.repo, filePath, repo.branch);

    const message = commitMessage || `Update ${filePath} via chat`;

    const result = await createOrUpdateFile(
      token, repo.owner, repo.repo, filePath, content, message, repo.branch,
      existingSha || undefined,
    );

    if (!result.success) {
      return errorResult(result.error || 'Failed to save file');
    }

    const action = existingSha ? 'Updated' : 'Created';
    return {
      success: true,
      message: `${action} \`${filePath}\` on \`${repo.branch}\`\nCommit: "${message}"`,
      data: { sha: result.sha, filePath },
    };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to save file');
  }
}

async function handleCreateBranch(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  branchName: string,
  fromBranch?: string,
): Promise<GitHubCommandResult> {
  try {
    const source = fromBranch || repo.branch;
    const result = await createBranch(token, repo.owner, repo.repo, branchName, source);

    if (!result.success) {
      return errorResult(result.error || 'Failed to create branch');
    }

    return {
      success: true,
      message: `Branch \`${branchName}\` created from \`${source}\``,
      data: { branchName, fromBranch: source },
    };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to create branch');
  }
}

async function handleListBranches(
  token: string,
  repo: { owner: string; repo: string; branch: string },
): Promise<GitHubCommandResult> {
  try {
    const { branches, error } = await listBranches(token, repo.owner, repo.repo);
    if (error) return errorResult(error);

    if (branches.length === 0) {
      return { success: true, message: 'No branches found.', data: [] };
    }

    const lines: string[] = [
      `**Branches** \`${repo.owner}/${repo.repo}\` (${branches.length})`,
      '',
    ];

    for (const b of branches) {
      const isDefault = b.name === repo.branch ? ' (default)' : '';
      const isProtected = b.protected ? ' [protected]' : '';
      lines.push(`- \`${b.name}\`${isDefault}${isProtected}`);
    }

    return { success: true, message: lines.join('\n'), data: branches };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to list branches');
  }
}

async function handleCreatePR(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  title: string,
  headBranch?: string,
  baseBranch?: string,
  body?: string,
): Promise<GitHubCommandResult> {
  try {
    const head = headBranch || repo.branch;
    const base = baseBranch || repo.branch;

    // Don't allow PR from default to default
    if (head === base) {
      return errorResult(
        `Source branch (\`${head}\`) and target branch (\`${base}\`) are the same. Specify a different source branch.`,
      );
    }

    const result = await createPullRequest(
      token, repo.owner, repo.repo, title, body || '', head, base,
    );

    if (!result.pr) {
      return errorResult(result.error || 'Failed to create pull request');
    }

    return {
      success: true,
      message: `**Pull Request #${result.pr.number} created**\n` +
        `Title: ${title}\n` +
        `\`${head}\` -> \`${base}\`\n` +
        `URL: ${result.pr.html_url}`,
      data: result.pr,
    };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to create pull request');
  }
}

async function handleListPRs(
  token: string,
  repo: { owner: string; repo: string; branch: string },
): Promise<GitHubCommandResult> {
  try {
    const { prs, error } = await listPullRequests(token, repo.owner, repo.repo, 'open');
    if (error) return errorResult(error);

    if (prs.length === 0) {
      return { success: true, message: 'No open pull requests.', data: [] };
    }

    const lines: string[] = [
      `**Open Pull Requests** \`${repo.owner}/${repo.repo}\` (${prs.length})`,
      '',
    ];

    for (const pr of prs.slice(0, 20)) {
      const date = new Date(pr.created_at).toLocaleDateString();
      lines.push(
        `- **#${pr.number}** ${pr.title}`,
        `  \`${pr.head.ref}\` -> \`${pr.base.ref}\` | by @${pr.user.login} | ${date}`,
      );
    }

    if (prs.length > 20) {
      lines.push('', `... and ${prs.length - 20} more`);
    }

    return { success: true, message: lines.join('\n'), data: prs };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to list pull requests');
  }
}

async function handleCommits(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  branch?: string,
): Promise<GitHubCommandResult> {
  try {
    const targetBranch = branch || repo.branch;
    const { commits, error } = await listCommits(token, repo.owner, repo.repo, targetBranch, 15);
    if (error) return errorResult(error);

    if (commits.length === 0) {
      return { success: true, message: 'No commits found.', data: [] };
    }

    const lines: string[] = [
      `**Recent Commits** \`${repo.owner}/${repo.repo}\` (\`${targetBranch}\`)`,
      '',
    ];

    for (const c of commits) {
      const shortSha = c.sha.slice(0, 7);
      const date = c.date ? new Date(c.date).toLocaleDateString() : '';
      // First line of commit message only
      const msg = c.message.split('\n')[0];
      lines.push(`- \`${shortSha}\` ${msg} — @${c.author.login} ${date}`);
    }

    return { success: true, message: lines.join('\n'), data: commits };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to list commits');
  }
}

async function handleDiff(
  token: string,
  repo: { owner: string; repo: string; branch: string },
  base: string,
  head: string,
): Promise<GitHubCommandResult> {
  try {
    const result = await compareBranches(token, repo.owner, repo.repo, base, head);
    if (result.error) return errorResult(result.error);

    const lines: string[] = [
      `**Comparing** \`${base}\` ... \`${head}\``,
      '',
      `- Ahead by: ${result.ahead} commits`,
      `- Behind by: ${result.behind} commits`,
      `- Files changed: ${result.files.length}`,
    ];

    if (result.files.length > 0) {
      lines.push('', '**Changed Files:**');
      for (const f of result.files.slice(0, 30)) {
        const stat = `+${f.additions} -${f.deletions}`;
        lines.push(`- \`${f.filename}\` (${f.status}) ${stat}`);
      }
      if (result.files.length > 30) {
        lines.push(`... and ${result.files.length - 30} more files`);
      }
    }

    return { success: true, message: lines.join('\n'), data: result };
  } catch (e: any) {
    return errorResult(e.message || 'Failed to compare branches');
  }
}

function handleHelp(): GitHubCommandResult {
  const lines = [
    '**GitHub Commands**',
    '',
    '| Command | Description |',
    '|---------|-------------|',
    '| `/gh status` | Show connected repos and activity |',
    '| `/gh tree` | List repo file tree |',
    '| `/gh cat <path>` | Show file contents |',
    '| `/gh edit <path>` | Start editing a file |',
    '| `/gh save <path>` | Save/create a file (include content after path) |',
    '| `/gh branch <name>` | Create a new branch |',
    '| `/gh branches` | List all branches |',
    '| `/gh pr <title>` | Create a pull request |',
    '| `/gh prs` | List open pull requests |',
    '| `/gh commits` | Show recent commits |',
    '| `/gh diff <base> <head>` | Compare two branches |',
    '| `/gh help` | Show this help |',
    '',
    'You can also use natural language: "show me the files", "what\'s in README.md", "create a branch called fix-bug", etc.',
  ];

  return { success: true, message: lines.join('\n') };
}

// ─── Formatting Utilities ────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getLanguageHint(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    css: 'css', scss: 'scss', html: 'html',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
    dockerfile: 'dockerfile', xml: 'xml', graphql: 'graphql',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  };
  return map[ext.toLowerCase()] || '';
}

// ─── Command Parser ──────────────────────────────────────────────────────────

/** Parse a /gh command string into a command name and arguments. */
function parseSlashCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();

  // Match /gh <command> [args...]
  const match = trimmed.match(/^\/gh\s+(\S+)(?:\s+(.*))?$/is);
  if (!match) {
    // Also match bare "/gh" as help
    if (/^\/gh\s*$/i.test(trimmed)) {
      return { command: 'help', args: '' };
    }
    return null;
  }

  return { command: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

/** Attempt to match natural language patterns to GitHub commands. */
function parseNaturalLanguage(input: string): { command: string; args: string } | null {
  const lower = input.toLowerCase().trim();

  // Status patterns
  if (/^(github|gh)\s+status$/i.test(lower) || /^(show|check)\s+(github|gh|repo)\s+status$/i.test(lower)) {
    return { command: 'status', args: '' };
  }

  // Tree / file listing patterns
  if (
    /^(show|list|display)\s+(me\s+)?(the\s+)?files$/i.test(lower) ||
    /^(show|list|display)\s+(me\s+)?(the\s+)?file\s+tree$/i.test(lower) ||
    /^(show|list)\s+(me\s+)?(the\s+)?repo\s+(files|tree|structure)$/i.test(lower) ||
    /^what('s| is)\s+in\s+the\s+repo$/i.test(lower)
  ) {
    return { command: 'tree', args: '' };
  }

  // Show/cat file patterns
  const catMatch = lower.match(
    /^(?:show|display|cat|print|read)\s+(?:me\s+)?(?:the\s+)?(?:file\s+)?(?:contents?\s+(?:of\s+)?)?["`']?([^\s"`']+\.\w+)["`']?$/i,
  );
  if (catMatch) {
    return { command: 'cat', args: catMatch[1] };
  }

  // "what's in <file>" pattern
  const whatsInMatch = lower.match(
    /^what(?:'s| is)\s+in\s+["`']?([^\s"`']+\.\w+)["`']?\s*\??$/i,
  );
  if (whatsInMatch) {
    return { command: 'cat', args: whatsInMatch[1] };
  }

  // Create branch patterns
  const branchMatch = lower.match(
    /^(?:create|make|new)\s+(?:a\s+)?branch\s+(?:called\s+|named\s+)?["`']?(\S+)["`']?$/i,
  );
  if (branchMatch) {
    return { command: 'branch', args: branchMatch[1] };
  }

  // List branches patterns
  if (
    /^(?:show|list|display)\s+(?:me\s+)?(?:the\s+)?branches$/i.test(lower) ||
    /^what\s+branches\s+(?:are\s+there|exist|do\s+we\s+have)\s*\??$/i.test(lower)
  ) {
    return { command: 'branches', args: '' };
  }

  // Open/create PR patterns
  const prMatch = lower.match(
    /^(?:open|create|make|submit)\s+(?:a\s+)?(?:pull\s+request|pr)\s*(?::\s*|titled?\s+|called\s+)?["`']?(.+?)["`']?\s*$/i,
  );
  if (prMatch) {
    return { command: 'pr', args: prMatch[1] };
  }

  // List PRs patterns
  if (
    /^(?:show|list|display)\s+(?:me\s+)?(?:the\s+)?(?:open\s+)?(?:pull\s+requests|prs)$/i.test(lower) ||
    /^what\s+(?:pull\s+requests|prs)\s+are\s+open\s*\??$/i.test(lower)
  ) {
    return { command: 'prs', args: '' };
  }

  // Show commits patterns
  if (
    /^(?:show|list|display)\s+(?:me\s+)?(?:the\s+)?(?:recent\s+)?commits$/i.test(lower) ||
    /^what(?:'s| has)\s+been\s+(?:committed|pushed|shipped)\s*\??$/i.test(lower) ||
    /^recent\s+commits$/i.test(lower)
  ) {
    return { command: 'commits', args: '' };
  }

  // Diff patterns
  const diffMatch = lower.match(
    /^(?:compare|diff)\s+["`']?(\S+)["`']?\s+(?:and|with|to|vs|\.\.\.?)\s+["`']?(\S+)["`']?$/i,
  );
  if (diffMatch) {
    return { command: 'diff', args: `${diffMatch[1]} ${diffMatch[2]}` };
  }

  // GitHub help
  if (
    /^(?:github|gh)\s+help$/i.test(lower) ||
    /^what\s+(?:github|gh)\s+commands\s+(?:are\s+there|can\s+i\s+use|do\s+you\s+support)\s*\??$/i.test(lower)
  ) {
    return { command: 'help', args: '' };
  }

  // No match
  return null;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Main command parser — takes user input and executes the right GitHub operation.
 *
 * Returns `{ success: false, message: '' }` if the input doesn't match any
 * GitHub command, so the caller can pass it to the regular AI instead.
 */
export async function executeGitHubCommand(
  input: string,
  context: GitHubChatContext,
): Promise<GitHubCommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false, message: '' };
  }

  // 1. Try /gh slash command
  let parsed = parseSlashCommand(trimmed);

  // 2. Try natural language patterns
  if (!parsed) {
    parsed = parseNaturalLanguage(trimmed);
  }

  // 3. No match — not a GitHub command
  if (!parsed) {
    return { success: false, message: '' };
  }

  const { command, args } = parsed;

  // Help doesn't need token or repo
  if (command === 'help') {
    return handleHelp();
  }

  // Resolve token
  const token = await getToken(context.circleId, context.userId);
  if (!token) return noToken();

  // Resolve repo
  const defaultRepo = await getDefaultRepo(context.circleId);
  const repo = resolveRepo(context, defaultRepo);

  // Commands that need a repo
  if (!repo && command !== 'status') {
    return noRepo();
  }

  switch (command) {
    case 'status':
      if (!repo) return noRepo();
      return handleStatus(token, repo, context.circleId);

    case 'tree':
    case 'files':
      return handleTree(token, repo!);

    case 'cat':
    case 'show':
    case 'view': {
      if (!args) return errorResult('Please specify a file path. Example: `/gh cat README.md`');
      return handleCat(token, repo!, args.split(/\s+/)[0]);
    }

    case 'edit': {
      if (!args) return errorResult('Please specify a file path. Example: `/gh edit src/index.ts`');
      return handleEdit(token, repo!, args.split(/\s+/)[0]);
    }

    case 'save':
    case 'write':
    case 'create': {
      if (!args) return errorResult('Please specify a file path and content. Example: `/gh save README.md`');
      // Parse: first token is path, rest is content (optionally after a newline)
      const spaceIdx = args.indexOf(' ');
      const newlineIdx = args.indexOf('\n');
      const splitIdx = newlineIdx !== -1 && (newlineIdx < spaceIdx || spaceIdx === -1)
        ? newlineIdx
        : spaceIdx;

      if (splitIdx === -1) {
        return errorResult('Please provide content after the file path. Example: `/gh save README.md # My Project`');
      }

      const filePath = args.slice(0, splitIdx).trim();
      const content = args.slice(splitIdx + 1).trim();

      if (!content) {
        return errorResult('No content provided. Include the file content after the path.');
      }

      return handleSave(token, repo!, filePath, content);
    }

    case 'branch': {
      if (!args) return errorResult('Please specify a branch name. Example: `/gh branch feature/my-fix`');
      const branchParts = args.split(/\s+/);
      const branchName = branchParts[0];
      const fromBranch = branchParts.length > 1 ? branchParts[1] : undefined;
      return handleCreateBranch(token, repo!, branchName, fromBranch);
    }

    case 'branches':
      return handleListBranches(token, repo!);

    case 'pr': {
      if (!args) return errorResult('Please specify a PR title. Example: `/gh pr Fix login bug`');
      // Parse optional head/base from args: "title --head feature --base main"
      let title = args;
      let headBranch: string | undefined;
      let baseBranch: string | undefined;

      const headMatch = args.match(/--head\s+(\S+)/i);
      const baseMatch = args.match(/--base\s+(\S+)/i);

      if (headMatch) {
        headBranch = headMatch[1];
        title = title.replace(headMatch[0], '').trim();
      }
      if (baseMatch) {
        baseBranch = baseMatch[1];
        title = title.replace(baseMatch[0], '').trim();
      }

      return handleCreatePR(token, repo!, title, headBranch, baseBranch);
    }

    case 'prs':
    case 'pulls':
      return handleListPRs(token, repo!);

    case 'commits':
    case 'log': {
      const branch = args || undefined;
      return handleCommits(token, repo!, branch);
    }

    case 'diff':
    case 'compare': {
      const diffParts = args.split(/\s+/);
      if (diffParts.length < 2) {
        return errorResult('Please specify two branches. Example: `/gh diff main feature/my-fix`');
      }
      return handleDiff(token, repo!, diffParts[0], diffParts[1]);
    }

    default:
      return errorResult(
        `Unknown command: \`${command}\`. Type \`/gh help\` to see available commands.`,
      );
  }
}
