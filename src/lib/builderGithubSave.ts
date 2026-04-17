/**
 * Save-to-GitHub for the Chat Live Builder.
 *
 * Given a circle's stored GitHub token + a target repo, creates a new
 * branch (or uses an existing one), commits the artifact HTML as
 * `index.html` plus a README, and returns the branch + commit URLs.
 *
 * Reuses the existing primitives in `src/lib/github.ts` — we don't touch
 * raw GitHub API calls here, just compose them.
 */

import { createBranch, createOrUpdateFile, getStoredToken, listRepos, getRepoInfo } from './github';

export interface SaveToGitHubInput {
  circleId: string;
  owner: string;
  repo: string;
  /** Optional override; auto-generated if omitted. */
  branch?: string;
  baseBranch?: string;          // defaults to the repo's default_branch
  filename?: string;            // defaults to 'index.html'
  title: string;
  html: string;
  readmeBody?: string;
}

export interface SaveToGitHubResult {
  branch: string;
  branchUrl: string;
  commitSha: string;
  fileUrl: string;
  readmeUrl?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'build';
}

export async function saveArtifactToGitHub(input: SaveToGitHubInput): Promise<SaveToGitHubResult> {
  const token = await getStoredToken(input.circleId);
  if (!token) throw new Error('No GitHub token stored for this circle. Connect GitHub first.');

  // Resolve the repo's default branch to use as base
  const repoInfo = await getRepoInfo(token, input.owner, input.repo);
  if (repoInfo.error || !repoInfo.repo) {
    throw new Error(repoInfo.error || 'Repo not found');
  }
  const baseBranch = input.baseBranch || (repoInfo.repo as any).default_branch || 'main';

  // Decide branch name
  const slug = slugify(input.title || 'build');
  const timestamp = Math.floor(Date.now() / 1000);
  const branch = input.branch || `uc-builder/${timestamp}-${slug}`;

  // Create the branch. Ignore "already exists" (422) — we'll just commit on it.
  const createBranchResult = await createBranch(token, input.owner, input.repo, branch, baseBranch);
  if (!createBranchResult.success && !/already exists|Reference already exists/i.test(createBranchResult.error || '')) {
    throw new Error(`Create branch failed: ${createBranchResult.error}`);
  }

  const filename = input.filename || 'index.html';
  const commitMessage = `Build from Underground Circle — ${input.title.slice(0, 60)}`;

  const writeResult = await createOrUpdateFile(
    token, input.owner, input.repo, filename,
    input.html, commitMessage, branch,
  );
  if (!writeResult.success || !writeResult.sha) {
    throw new Error(`Commit failed: ${writeResult.error || 'unknown'}`);
  }

  // Optional README so the branch tells future-you what this is
  let readmeUrl: string | undefined;
  const readmeBody = input.readmeBody ?? [
    `# ${input.title}`,
    '',
    `Built with the Underground Circle Live Builder on ${new Date().toISOString().slice(0, 10)}.`,
    '',
    `Open \`${filename}\` in a browser or host it anywhere static.`,
  ].join('\n');
  const readmeResult = await createOrUpdateFile(
    token, input.owner, input.repo, 'README.uc-build.md',
    readmeBody, `README for ${input.title.slice(0, 40)}`, branch,
  );
  if (readmeResult.success) {
    readmeUrl = `https://github.com/${input.owner}/${input.repo}/blob/${branch}/README.uc-build.md`;
  }

  return {
    branch,
    branchUrl: `https://github.com/${input.owner}/${input.repo}/tree/${branch}`,
    commitSha: writeResult.sha,
    fileUrl: `https://github.com/${input.owner}/${input.repo}/blob/${branch}/${filename}`,
    readmeUrl,
  };
}

export interface GitHubRepoLite {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch?: string;
}

export async function listReposForSave(circleId: string): Promise<GitHubRepoLite[]> {
  const token = await getStoredToken(circleId);
  if (!token) return [];
  const { repos } = await listRepos(token, 1);
  return (repos || []).map(r => ({
    full_name: (r as any).full_name,
    owner: (r as any).owner?.login || (r as any).full_name.split('/')[0],
    name: (r as any).name,
    private: !!(r as any).private,
    default_branch: (r as any).default_branch,
  }));
}
