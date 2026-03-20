/**
 * github.ts — GitHub REST API service for browsing repositories
 *
 * Uses plain fetch (no npm packages). Tokens stored per-circle
 * via the cross-platform storage abstraction.
 */

import { storage } from './storage';
import { supabase } from './supabase';

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

function storageKey(circleId: string): string {
  return `@github_pat_${circleId}`;
}

export async function getStoredToken(circleId: string): Promise<string | null> {
  return storage.getItem(storageKey(circleId));
}

export async function storeToken(circleId: string, token: string): Promise<void> {
  await storage.setItem(storageKey(circleId), token);
}

export async function removeToken(circleId: string): Promise<void> {
  await storage.removeItem(storageKey(circleId));
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

const API = 'https://api.github.com';

async function ghFetch<T>(path: string, token: string): Promise<{ data: T | null; error: string | null }> {
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
      return { data: null, error: (body as any).message || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { data: data as T, error: null };
  } catch (e: any) {
    return { data: null, error: e.message || 'Network error' };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Validate a PAT and return the authenticated user */
export async function validateToken(token: string): Promise<{ user: GitHubUser | null; error: string | null }> {
  const { data, error } = await ghFetch<GitHubUser>('/user', token);
  return { user: data, error };
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
): Promise<{ content: string; size: number; sha: string; error: string | null }> {
  const { data, error } = await ghFetch<GitHubFileContent>(
    `/repos/${owner}/${repo}/contents/${path}`,
    token,
  );
  if (error || !data) return { content: '', size: 0, sha: '', error: error || 'No data' };

  // Decode base64
  try {
    const decoded = atob(data.content.replace(/\n/g, ''));
    return { content: decoded, size: data.size, sha: data.sha, error: null };
  } catch {
    return { content: '[Binary file — cannot display]', size: data.size, sha: data.sha, error: null };
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
    'push', 'pull_request', 'pull_request_review', 'issues',
    'release', 'workflow_run', 'check_run', 'check_suite',
    'deployment', 'deployment_status',
    'code_scanning_alert', 'secret_scanning_alert', 'dependabot_alert',
    'projects_v2_item', 'discussion', 'discussion_comment',
    'star', 'fork',
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
      return { webhook: null, error: (body as any).message || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { webhook: data as GitHubWebhook, error: null };
  } catch (e: any) {
    return { webhook: null, error: e.message || 'Network error' };
  }
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
}

/** Start GitHub OAuth flow — opens GitHub authorization page */
export async function connectViaOAuth(circleId: string, userId: string): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=authorize&circle_id=${circleId}&user_id=${userId}`,
    );
    const data = await res.json();
    if (data.error) return { error: data.error };
    return { url: data.url };
  } catch (e: any) {
    return { error: e.message || 'Failed to start OAuth flow' };
  }
}

/** Check if user has connected GitHub via OAuth */
export async function getOAuthStatus(userId: string): Promise<GitHubOAuthStatus> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=status&user_id=${userId}`,
    );
    const data = await res.json();
    return data;
  } catch {
    return { connected: false };
  }
}

/** List repos for a user connected via OAuth */
export async function getConnectedRepos(userId: string): Promise<{ repos: GitHubRepo[]; github_username?: string; error?: string }> {
  try {
    const res = await fetch(
      `${SUPABASE_FUNCTIONS_URL}/github-oauth?action=list_repos&user_id=${userId}`,
    );
    const data = await res.json();
    if (data.error) return { repos: [], error: data.error };
    return { repos: data.repos || [], github_username: data.github_username };
  } catch (e: any) {
    return { repos: [], error: e.message || 'Failed to fetch repos' };
  }
}
