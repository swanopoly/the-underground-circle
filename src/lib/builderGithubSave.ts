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

import {
  commitMultipleFiles,
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  getFileContent,
  getStoredToken,
  listRepos,
  getRepoInfo,
} from './github';

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

export interface GitHubSubmitFile {
  path: string;
  content: string;
}

export interface SubmitFilesToGitHubInput {
  circleId: string;
  owner: string;
  repo: string;
  files: GitHubSubmitFile[];
  title: string;
  commitMessage?: string;
  branch?: string;
  baseBranch?: string;
  createDraftPullRequest?: boolean;
  pullRequestBody?: string;
}

export interface SubmitFilesToGitHubResult {
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  branchUrl: string;
  commitSha: string;
  commitUrl: string;
  fileUrls: Array<{ path: string; url: string; sha: string }>;
  verifiedPaths: string[];
  pullRequest?: { number: number; url: string; draft: boolean };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'build';
}

function normalizeGitHubPath(path: string): string {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim();
  const segments = normalized.split('/');
  if (!normalized || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid GitHub file path: ${path || '(empty)'}`);
  }
  return normalized;
}

function normalizeGitHubBranch(branch: string): string {
  const normalized = String(branch || '').trim();
  const invalid = !normalized
    || normalized.length > 240
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.endsWith('.')
    || normalized.includes('..')
    || normalized.includes('//')
    || normalized.includes('@{')
    || /[\x00-\x20~^:?*\\[\]]/.test(normalized)
    || normalized.split('/').some(segment => !segment || segment.endsWith('.lock'));
  if (invalid) throw new Error(`Invalid GitHub branch name: ${branch || '(empty)'}`);
  return normalized;
}

function githubBlobUrl(owner: string, repo: string, branch: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${encodedPath}`;
}

/**
 * Explicit, review-first Room/file submission. The caller chooses the exact
 * files and repository, this helper creates or reuses one named branch, writes
 * one atomic multi-file commit, then reads every file back from that branch.
 * A success result is therefore content-verified rather than "request sent".
 */
export async function submitFilesToGitHub(input: SubmitFilesToGitHubInput): Promise<SubmitFilesToGitHubResult> {
  const token = await getStoredToken(input.circleId);
  if (!token) {
    throw new Error('GitHub write access needs a Personal Access Token for this circle. Connect one in Marketplace, then retry.');
  }

  const deduped = new Map<string, string>();
  for (const file of input.files || []) {
    const path = normalizeGitHubPath(file.path);
    if (deduped.has(path)) throw new Error(`Duplicate GitHub file path: ${path}`);
    deduped.set(path, String(file.content ?? ''));
  }
  const files = Array.from(deduped, ([path, content]) => ({ path, content }));
  if (files.length === 0) throw new Error('Choose at least one file to submit.');
  if (files.length > 100) throw new Error('Submit at most 100 files in one commit.');
  let totalBytes = 0;
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > 900_000) throw new Error(`${file.path} is too large for verified GitHub readback (max 900 KB).`);
    totalBytes += bytes;
  }
  if (totalBytes > 5_000_000) throw new Error('Selected files exceed the 5 MB verified submission limit.');

  const repoInfo = await getRepoInfo(token, input.owner, input.repo);
  if (repoInfo.error || !repoInfo.repo) throw new Error(repoInfo.error || 'Repository not found');
  const baseBranch = input.baseBranch || (repoInfo.repo as any).default_branch || 'main';
  const branch = normalizeGitHubBranch(input.branch?.trim()
    || `uc-room/${Math.floor(Date.now() / 1000)}-${slugify(input.title || 'room-changes')}`);

  const branchResult = await createBranch(token, input.owner, input.repo, branch, baseBranch);
  if (!branchResult.success && !/already exists|reference already exists/i.test(branchResult.error || '')) {
    throw new Error(`Create branch failed: ${branchResult.error || 'unknown error'}`);
  }

  const commitMessage = input.commitMessage?.trim() || `Room changes — ${(input.title || 'file update').slice(0, 72)}`;
  const commit = await commitMultipleFiles(token, input.owner, input.repo, branch, commitMessage, files);
  if (!commit.success || !commit.sha) throw new Error(`Commit failed: ${commit.error || 'unknown error'}`);

  const readbacks = await Promise.all(files.map(async file => ({
    file,
    result: await getFileContent(token, input.owner, input.repo, file.path, branch),
  })));
  const failedReadback = readbacks.find(({ file, result }) => result.error || result.content !== file.content);
  if (failedReadback) {
    throw new Error(`GitHub readback did not match ${failedReadback.file.path}; the commit exists but could not be verified.`);
  }

  let pullRequest: SubmitFilesToGitHubResult['pullRequest'];
  if (input.createDraftPullRequest) {
    const body = input.pullRequestBody?.trim() || [
      'Submitted from an Underground Circle Room after file review.',
      '',
      `Files: ${files.map(file => `\`${file.path}\``).join(', ')}`,
      `Verified commit: ${commit.sha}`,
    ].join('\n');
    const prResult = await createPullRequest(
      token,
      input.owner,
      input.repo,
      input.title.slice(0, 120) || 'Room file changes',
      body,
      branch,
      baseBranch,
      true,
    );
    if (prResult.error || !prResult.pr) throw new Error(`Commit verified, but draft pull request failed: ${prResult.error || 'unknown error'}`);
    pullRequest = { number: prResult.pr.number, url: prResult.pr.html_url, draft: true };
  }

  return {
    owner: input.owner,
    repo: input.repo,
    baseBranch,
    branch,
    branchUrl: `https://github.com/${input.owner}/${input.repo}/tree/${encodeURIComponent(branch)}`,
    commitSha: commit.sha,
    commitUrl: `https://github.com/${input.owner}/${input.repo}/commit/${commit.sha}`,
    fileUrls: readbacks.map(({ file, result }) => ({
      path: file.path,
      url: githubBlobUrl(input.owner, input.repo, branch, file.path),
      sha: result.sha || '',
    })),
    verifiedPaths: files.map(file => file.path),
    ...(pullRequest ? { pullRequest } : {}),
  };
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
