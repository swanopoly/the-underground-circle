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
  events: string[] = ['push', 'pull_request', 'issues', 'release', 'workflow_run'],
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
