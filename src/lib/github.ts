/**
 * github.ts — GitHub REST API service for browsing repositories
 *
 * Uses plain fetch (no npm packages). Tokens are stored locally per-circle
 * via the shared local-secret helper, not synced to the backend.
 */

import { supabase } from './supabase';
import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localSecrets';
import { safeGetUserId } from './authSession';
import { storage } from './storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string | null;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  private: boolean;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  size: number;
  fork: boolean;
  archived: boolean;
  open_issues_count: number;
  forks_count: number;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string;
  encoding: string;
}

// ─── Token Storage ────────────────────────────────────────────────────────────

const GITHUB_PAT_SCOPE_INDEX_PREFIX = '@github_pat_scopes_v2:';

function githubPatSecretId(userId: string, circleId: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(circleId)}`;
}

async function rememberGithubPatCircle(userId: string, circleId: string): Promise<void> {
  const key = `${GITHUB_PAT_SCOPE_INDEX_PREFIX}${encodeURIComponent(userId)}`;
  let circles: string[] = [];
  try {
    const raw = await storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) circles = parsed.filter((value): value is string => typeof value === 'string');
  } catch {}
  const next = [...new Set([...circles, circleId])].slice(-200);
  await storage.setItem(key, JSON.stringify(next));
}

export async function getStoredToken(circleId: string): Promise<string | null> {
  const userId = await safeGetUserId();
  if (!userId || !circleId) return null;
  // Never import the historical Circle-only secret: another account on the
  // same browser/device may have created it. Retire it fail-closed instead.
  await deleteLocalSecret('github_pat', circleId);
  return (await readLocalSecret('github_pat_v2', githubPatSecretId(userId, circleId))) || null;
}

export async function storeToken(circleId: string, token: string): Promise<void> {
  const userId = await safeGetUserId();
  if (!userId || !circleId) throw new Error('An authenticated user and Circle are required.');
  await deleteLocalSecret('github_pat', circleId);
  await writeLocalSecret('github_pat_v2', githubPatSecretId(userId, circleId), token);
  await rememberGithubPatCircle(userId, circleId);
}

export async function removeToken(circleId: string): Promise<void> {
  const userId = await safeGetUserId();
  await deleteLocalSecret('github_pat', circleId);
  if (userId && circleId) {
    await deleteLocalSecret('github_pat_v2', githubPatSecretId(userId, circleId));
  }
}

/** Remove this account's device-local GitHub PATs before account replacement. */
export async function clearLocalGitHubTokensForLogout(userId: string | null | undefined): Promise<number> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return 0;
  const key = `${GITHUB_PAT_SCOPE_INDEX_PREFIX}${encodeURIComponent(normalizedUserId)}`;
  let circles: string[] = [];
  try {
    const raw = await storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) circles = parsed.filter((value): value is string => typeof value === 'string');
  } catch {}
  await Promise.all(circles.map((circleId) => (
    deleteLocalSecret('github_pat_v2', githubPatSecretId(normalizedUserId, circleId))
  )));
  await storage.removeItem(key);
  return circles.length;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

const API = 'https://api.github.com';

async function ghFetch<T>(path: string, token: string): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: (body as any).message || `HTTP ${res.status}`, status: res.status };
    }
    const data = await res.json();
    return { data: data as T, error: null, status: res.status };
  } catch (e: any) {
    // status 0 = network failure / CORS / offline — never an auth problem
    return { data: null, error: e.message || 'Network error', status: 0 };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Validate a PAT and return the authenticated user.
 *  `status` lets callers distinguish auth failure (401/403 → wipe token)
 *  from transient errors (0/5xx/429 → keep token, retry later). */
export async function validateToken(token: string): Promise<{ user: GitHubUser | null; error: string | null; status: number }> {
  const { data, error, status } = await ghFetch<GitHubUser>('/user', token);
  return { user: data, error, status };
}

/** List repos visible to the authenticated user (up to 100 per page) */
export async function listRepos(token: string, page = 1): Promise<{ repos: GitHubRepo[]; error: string | null }> {
  const { data, error } = await ghFetch<GitHubRepo[]>(
    `/user/repos?per_page=100&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`,
    token,
  );
  return { repos: data || [], error };
}

/** Search repos by query */
export async function searchRepos(token: string, query: string): Promise<{ repos: GitHubRepo[]; error: string | null }> {
  const { data, error } = await ghFetch<{ items: GitHubRepo[] }>(
    `/search/repositories?q=${encodeURIComponent(query)}&per_page=30&sort=updated`,
    token,
  );
  return { repos: data?.items || [], error };
}

/** Fetch the full recursive file tree for a repo branch */
export async function getRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ tree: GitHubTreeEntry[]; truncated: boolean; error: string | null }> {
  // Get branch HEAD SHA
  const { data: branchData, error: branchErr } = await ghFetch<{ commit: { sha: string } }>(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    token,
  );
  if (branchErr || !branchData) return { tree: [], truncated: false, error: branchErr || 'Could not resolve branch' };

  const treeSha = branchData.commit.sha;
  const { data, error } = await ghFetch<{ tree: GitHubTreeEntry[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    token,
  );
  return { tree: data?.tree || [], truncated: data?.truncated ?? false, error };
}

/** Fetch and decode a single file's content */
export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch?: string,
): Promise<{ content: string; size: number; sha: string; error: string | null }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const { data, error } = await ghFetch<GitHubFileContent>(
    `/repos/${owner}/${repo}/contents/${encodedPath}${refQuery}`,
    token,
  );
  if (error || !data) return { content: '', size: 0, sha: '', error: error || 'No data' };

  // The contents endpoint can omit inline content for larger files. Treat that
  // as an explicit readback failure instead of decoding an absent payload.
  if (typeof data.content !== 'string' || !data.content || data.encoding !== 'base64') {
    return { content: '', size: data.size, sha: data.sha, error: 'GitHub did not return inline base64 file content' };
  }

  // Decode base64
  try {
    const binary = atob(data.content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    return { content: decoded, size: data.size, sha: data.sha, error: null };
  } catch {
    return { content: '', size: data.size, sha: data.sha, error: 'GitHub file content was not valid base64 text' };
  }
}

/** Get repo details (useful for default_branch, etc.) */
export async function getRepoInfo(
  token: string,
  owner: string,
  repo: string,
): Promise<{ repo: GitHubRepo | null; error: string | null }> {
  const { data, error } = await ghFetch<GitHubRepo>(`/repos/${owner}/${repo}`, token);
  return { repo: data, error };
}

// ─── Webhook Management ──────────────────────────────────────────────────────

export interface GitHubWebhook {
  id: number;
  active: boolean;
  events: string[];
  config: { url: string; content_type: string; insecure_ssl: string };
}

/** Create a webhook on a repo pointing to our edge function */
export async function createWebhook(
  token: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  secret: string,
  events: string[] = [
    'push', 'pull_request', 'issues', 'release', 'workflow_run',
  ],
): Promise<{ webhook: GitHubWebhook | null; error: string | null }> {
  try {
    const res = await fetch(`${API}/repos/${owner}/${repo}/hooks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret,
          insecure_ssl: '0',
        },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as any).message || `HTTP ${res.status}`;
      // If webhook already exists for this URL, find and return it
      if (res.status === 422 && msg.includes('already')) {
        const existing = await findExistingWebhook(token, owner, repo, webhookUrl);
        if (existing) return { webhook: existing, error: null };
      }
      return { webhook: null, error: msg };
    }
    const data = await res.json();
    return { webhook: data as GitHubWebhook, error: null };
  } catch (e: any) {
    return { webhook: null, error: e.message || 'Network error' };
  }
}

/** Find an existing webhook by URL (used when creation returns 422 duplicate) */
async function findExistingWebhook(
  token: string, owner: string, repo: string, url: string,
): Promise<GitHubWebhook | null> {
  try {
    const { data } = await ghFetch<GitHubWebhook[]>(`/repos/${owner}/${repo}/hooks`, token);
    return data?.find(h => h.config?.url === url) || null;
  } catch { return null; }
}

/** Delete a webhook from a repo */
export async function deleteWebhook(
  token: string,
  owner: string,
  repo: string,
  hookId: number,
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`${API}/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as any).message || `HTTP ${res.status}` };
    }
    return { error: null };
  } catch (e: any) {
    return { error: e.message || 'Network error' };
  }
}

/** List webhooks on a repo (to check existing) */
export async function listWebhooks(
  token: string,
  owner: string,
  repo: string,
): Promise<{ webhooks: GitHubWebhook[]; error: string | null }> {
  const { data, error } = await ghFetch<GitHubWebhook[]>(`/repos/${owner}/${repo}/hooks`, token);
  return { webhooks: data || [], error };
}

// ─── Pull Request Analysis ────────────────────────────────────────────────────

export interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/** Fetch the raw diff for a pull request */
export async function getPullRequestDiff(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string,
): Promise<{ diff?: string; error?: string }> {
  try {
    const res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3.diff',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: body || `HTTP ${res.status}` };
    }
    const diff = await res.text();
    // Truncate to ~50KB to keep token costs manageable
    const maxLen = 50_000;
    return { diff: diff.length > maxLen ? diff.slice(0, maxLen) + '\n...[truncated]' : diff };
  } catch (e: any) {
    return { error: e.message || 'Network error' };
  }
}

/** Fetch the list of files changed in a pull request */
export async function getPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  token: string,
): Promise<{ files?: GitHubPRFile[]; error?: string }> {
  const { data, error } = await ghFetch<GitHubPRFile[]>(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/files`,
    token,
  );
  if (error || !data) return { error: error || 'No data' };
  return { files: data };
}

/** Post a comment on a pull request (uses the Issues API) */
export async function createPullRequestComment(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
  token: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      return { success: false, error: (respBody as any).message || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Network error' };
  }
}

// ─── Tree Helpers ─────────────────────────────────────────────────────────────

/** Group a flat tree into folder → entries[] map (blobs only, sorted) */
export function groupTreeByFolder(tree: GitHubTreeEntry[]): Record<string, GitHubTreeEntry[]> {
  const result: Record<string, GitHubTreeEntry[]> = {};

  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    const lastSlash = entry.path.lastIndexOf('/');
    const folder = lastSlash === -1 ? '/' : '/' + entry.path.substring(0, lastSlash);
    if (!result[folder]) result[folder] = [];
    result[folder].push(entry);
  }

  // Sort: root first, then alphabetical
  const sorted: Record<string, GitHubTreeEntry[]> = {};
  const keys = Object.keys(result).sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });
  for (const k of keys) {
    sorted[k] = result[k].sort((a, b) => {
      const aName = a.path.split('/').pop() || '';
      const bName = b.path.split('/').pop() || '';
      return aName.localeCompare(bName);
    });
  }
  return sorted;
}

// ─── Copilot Coding Agent ────────────────────────────────────────────────────

const COPILOT_BOT_LOGIN = 'copilot-swe-agent[bot]';

/** Assign a GitHub issue to the Copilot coding agent for autonomous PR creation */
export async function assignIssueToCopilot(
  owner: string,
  repo: string,
  issueNumber: number,
  token: string,
  options?: {
    customInstructions?: string;
    baseBranch?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    // If custom instructions or base branch are provided, add them as a comment first
    if (options?.customInstructions || options?.baseBranch) {
      const commentParts: string[] = [];
      if (options.baseBranch) {
        commentParts.push(`Base branch: \`${options.baseBranch}\``);
      }
      if (options.customInstructions) {
        commentParts.push(`Instructions for Copilot:\n${options.customInstructions}`);
      }
      await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: commentParts.join('\n\n') }),
      });
    }

    // Assign the Copilot bot to the issue
    const res = await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assignees: [COPILOT_BOT_LOGIN] }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { success: false, error: (body as any).message || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Network error' };
  }
}

/** Create a new GitHub issue and immediately assign it to the Copilot coding agent */
export async function createIssueAndAssignToCopilot(
  owner: string,
  repo: string,
  title: string,
  body: string,
  token: string,
  options?: {
    labels?: string[];
    customInstructions?: string;
    baseBranch?: string;
  },
): Promise<{ issueNumber?: number; error?: string }> {
  try {
    // Build the issue body, appending instructions/branch if provided
    let fullBody = body;
    if (options?.baseBranch) {
      fullBody += `\n\n**Base branch:** \`${options.baseBranch}\``;
    }
    if (options?.customInstructions) {
      fullBody += `\n\n**Instructions for Copilot:**\n${options.customInstructions}`;
    }

    // Create the issue
    const createRes = await fetch(`${API}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: fullBody,
        labels: options?.labels || [],
      }),
    });
    if (!createRes.ok) {
      const createBody = await createRes.json().catch(() => ({}));
      return { error: (createBody as any).message || `HTTP ${createRes.status}` };
    }
    const issue = await createRes.json();
    const issueNumber = (issue as any).number as number;

    // Assign Copilot to the newly created issue
    const assignRes = await fetch(`${API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assignees: [COPILOT_BOT_LOGIN] }),
    });
    if (!assignRes.ok) {
      const assignBody = await assignRes.json().catch(() => ({}));
      return { issueNumber, error: `Issue created (#${issueNumber}) but Copilot assignment failed: ${(assignBody as any).message || `HTTP ${assignRes.status}`}` };
    }

    return { issueNumber };
  } catch (e: any) {
    return { error: e.message || 'Network error' };
  }
}

/** Check if the Copilot coding agent is available/enabled for a repo */
export async function checkCopilotAgentStatus(
  owner: string,
  repo: string,
  token: string,
): Promise<{ available: boolean; error?: string }> {
  try {
    // Check if copilot-swe-agent[bot] can be assigned by listing assignees
    const { data, error } = await ghFetch<Array<{ login: string }>>(
      `/repos/${owner}/${repo}/assignees`,
      token,
    );
    if (error) return { available: false, error };

    const hasCopilot = (data || []).some(
      (user) => user.login === COPILOT_BOT_LOGIN,
    );
    return { available: hasCopilot };
  } catch (e: any) {
    return { available: false, error: e.message || 'Network error' };
  }
}

// ─── OAuth Integration ───────────────────────────────────────────────────────

const SUPABASE_FUNCTIONS_URL = 'https://rjkniqiqdtroeholxacg.supabase.co/functions/v1';

export interface GitHubOAuthStatus {
  connected: boolean;
  github_username?: string;
  github_user_id?: number;
  connected_at?: string;
  /** Set when we couldn't reach or parse the status endpoint. Callers can
   *  distinguish a genuine "not connected" from a transient failure and
   *  avoid flipping the UI to the reconnect screen on flakes. */
  error?: string;
}

/** Start GitHub OAuth flow — opens GitHub authorization page */
export async function connectViaOAuth(circleId: string, userId: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=authorize&circle_id=${circleId}&user_id=${userId}`,
      { headers: await getEdgeAuthHeaders() },
    );
    const data = await res.json();
    if (data.error) return { error: data.error };
    return { url: data.url };
  } catch (e: any) {
    return { error: e.message || 'Failed to start OAuth flow' };
  }
}

/** Build auth headers for edge-function calls. We pass the user's access
 *  token when available so these calls work even if the function's
 *  verify_jwt flag ever flips back to true. The GitHub OAuth callback itself
 *  (GitHub → our edge function) still can't send a JWT, so the function must
 *  stay verify_jwt=false in config.toml — this is belt-and-suspenders. */
async function getEdgeAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
}

/** Check if user has connected GitHub via OAuth */
export async function getOAuthStatus(userId: string): Promise<GitHubOAuthStatus> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=status&user_id=${userId}`,
      { headers: await getEdgeAuthHeaders() },
    );
    // If the edge function rejects the request (401/5xx/etc), don't treat the
    // error payload as "connected=false" — signal that we couldn't determine
    // status so callers can back off instead of flipping the UI to a stale
    // "disconnected" state. Previously a transient 401 from the router would
    // parse as {code:401,...}, fall through `connected ? ... : false`, and
    // silently bounce the user back to the reconnect screen.
    if (!res.ok) return { connected: false, error: `status_${res.status}` };
    const data = await res.json();
    return data;
  } catch {
    return { connected: false, error: 'network' };
  }
}

/** List repos for a user connected via OAuth */
export async function getConnectedRepos(userId: string): Promise<{ repos: GitHubRepo[]; github_username?: string; error?: string }> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=list_repos&user_id=${userId}`,
      { headers: await getEdgeAuthHeaders() },
    );
    const data = await res.json();
    if (data.error) return { repos: [], error: data.error };
    return { repos: data.repos || [], github_username: data.github_username };
  } catch (e: any) {
    return { repos: [], error: e.message || 'Failed to fetch repos' };
  }
}

// ─── Write Operations — Create/Update/Delete files, branches, PRs ───────────

/** Create or update a file in a repo (single-file commit) */
export async function createOrUpdateFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string, // required for updates, omit for new files
): Promise<{ success: boolean; sha?: string; error?: string }> {
  const body: Record<string, unknown> = {
    message,
    content: btoa(encodeURIComponent(content).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))), // base64 encode (Unicode-safe)
    branch,
  };
  if (sha) body.sha = sha;

  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: (err as any).message || `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { success: true, sha: data.content?.sha };
}

/** Delete a file from a repo */
export async function deleteFileFromRepo(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
  sha: string,
): Promise<{ success: boolean; error?: string }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: (err as any).message || `HTTP ${res.status}` };
  }
  return { success: true };
}

/** Create a new branch from an existing ref */
export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  newBranch: string,
  fromBranch: string,
): Promise<{ success: boolean; error?: string }> {
  // Get the SHA of the source branch
  const { data: refData, error: refErr } = await ghFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`, token,
  );
  if (refErr || !refData) return { success: false, error: refErr || 'Source branch not found' };

  const res = await fetch(`${API}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: `refs/heads/${newBranch}`,
      sha: refData.object.sha,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { success: false, error: (err as any).message || `HTTP ${res.status}` };
  }
  return { success: true };
}

/** List branches for a repo */
export async function listBranches(
  token: string, owner: string, repo: string,
): Promise<{ branches: { name: string; protected: boolean }[]; error?: string }> {
  const { data, error } = await ghFetch<{ name: string; protected: boolean }[]>(
    `/repos/${owner}/${repo}/branches?per_page=100`, token,
  );
  return { branches: data || [], error: error || undefined };
}

/** Create a pull request */
export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,  // source branch
  base: string,  // target branch
  draft?: boolean,
): Promise<{ pr: { number: number; html_url: string } | null; error?: string }> {
  const res = await fetch(`${API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head, base, draft: draft ?? false }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { pr: null, error: (err as any).message || `HTTP ${res.status}` };
  }
  const data = await res.json();
  return { pr: { number: data.number, html_url: data.html_url } };
}

/** List open pull requests */
export async function listPullRequests(
  token: string, owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open',
): Promise<{ prs: { number: number; title: string; html_url: string; state: string; user: { login: string }; created_at: string; head: { ref: string }; base: { ref: string } }[]; error?: string }> {
  const { data, error } = await ghFetch<any[]>(
    `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`, token,
  );
  return { prs: data || [], error: error || undefined };
}

/** Get the SHA of a file (needed for updates/deletes) */
export async function getFileSha(
  token: string, owner: string, repo: string, path: string, branch: string,
): Promise<string | null> {
  const { data } = await ghFetch<{ sha: string }>(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, token,
  );
  return data?.sha || null;
}

/** Multi-file commit via the Git Data API (create tree + commit) */
export async function commitMultipleFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: { path: string; content: string }[],
): Promise<{ success: boolean; sha?: string; error?: string }> {
  try {
    // 1. Get current branch HEAD
    const { data: refData } = await ghFetch<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token,
    );
    if (!refData) return { success: false, error: 'Branch not found' };
    const baseSha = refData.object.sha;
    const { data: baseCommit, error: baseCommitError } = await ghFetch<{ tree: { sha: string } }>(
      `/repos/${owner}/${repo}/git/commits/${encodeURIComponent(baseSha)}`,
      token,
    );
    if (baseCommitError || !baseCommit?.tree?.sha) {
      return { success: false, error: baseCommitError || 'Base commit tree not found' };
    }
    const baseTreeSha = baseCommit.tree.sha;

    // 2. Create blobs for each file
    const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
    for (const file of files) {
      const blobRes = await fetch(`${API}/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      if (!blobRes.ok) return { success: false, error: `Failed to create blob for ${file.path}` };
      const blob = await blobRes.json();
      treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    // 3. Create tree
    const treeRes = await fetch(`${API}/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!treeRes.ok) return { success: false, error: 'Failed to create tree' };
    const tree = await treeRes.json();

    // 4. Create commit
    const commitRes = await fetch(`${API}/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
    });
    if (!commitRes.ok) return { success: false, error: 'Failed to create commit' };
    const commit = await commitRes.json();

    // 5. Update branch ref
    const updateRes = await fetch(`${API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sha: commit.sha }),
    });
    if (!updateRes.ok) return { success: false, error: 'Failed to update branch' };

    return { success: true, sha: commit.sha };
  } catch (e: any) {
    return { success: false, error: e.message || 'Commit failed' };
  }
}

/** List recent commits on a branch */
export async function listCommits(
  token: string, owner: string, repo: string, branch: string, perPage = 20,
): Promise<{ commits: { sha: string; message: string; author: { login: string }; date: string; html_url: string }[]; error?: string }> {
  const { data, error } = await ghFetch<any[]>(
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`, token,
  );
  const commits = (data || []).map((c: any) => ({
    sha: c.sha,
    message: c.commit?.message || '',
    author: { login: c.author?.login || c.commit?.author?.name || 'unknown' },
    date: c.commit?.author?.date || '',
    html_url: c.html_url || '',
  }));
  return { commits, error: error || undefined };
}

/** Get diff between two branches */
export async function compareBranches(
  token: string, owner: string, repo: string, base: string, head: string,
): Promise<{ ahead: number; behind: number; files: { filename: string; status: string; additions: number; deletions: number }[]; error?: string }> {
  const { data, error } = await ghFetch<any>(
    `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, token,
  );
  if (error || !data) return { ahead: 0, behind: 0, files: [], error: error || undefined };
  return {
    ahead: data.ahead_by || 0,
    behind: data.behind_by || 0,
    files: (data.files || []).map((f: any) => ({
      filename: f.filename, status: f.status,
      additions: f.additions, deletions: f.deletions,
    })),
  };
}
