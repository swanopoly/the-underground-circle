/**
 * netlifyDeploy — One-click deploy for the Chat Live Builder.
 *
 * Given a circle-scoped Netlify Personal Access Token + the builder's
 * current artifact, creates (or reuses) a site and publishes a new
 * deploy. Returns a live URL the user can share.
 *
 * Uses the File Digest API — lists files by path with SHA1 digests,
 * Netlify tells us which ones it needs, we PUT the raw bytes. Zero
 * zip machinery, zero extra deps.
 *
 * Token is stored per-circle via the shared localSecrets helper, same
 * as the GitHub PAT pattern in lib/github.ts.
 */

import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localSecrets';

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const NETLIFY_SECRET_NS = 'netlify_pat';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetlifyUser {
  id: string;
  email: string;
  full_name: string | null;
}

export interface NetlifySite {
  id: string;
  name: string;
  url: string;
  ssl_url: string;
  admin_url: string;
  updated_at: string;
  published_deploy?: { deploy_ssl_url?: string } | null;
}

export interface NetlifyDeploy {
  id: string;
  site_id: string;
  state: string;
  deploy_ssl_url: string;
  deploy_url: string;
  required?: string[];
  error_message?: string | null;
}

export interface DeployResult {
  site: NetlifySite;
  deploy: NetlifyDeploy;
  /** The URL to share — prefers the deploy-specific permalink. */
  url: string;
}

export interface DeployArtifactInput {
  circleId: string;
  /** Pick an existing site by id, or leave null to create a fresh one. */
  siteId?: string | null;
  /** Used when creating a new site. Netlify will slug + suffix this. */
  suggestedName?: string;
  /** The artifact to publish as index.html. */
  html: string;
}

// ─── Token storage (per-circle, same pattern as GitHub PAT) ──────────────────

export async function getStoredNetlifyToken(circleId: string): Promise<string | null> {
  return (await readLocalSecret(NETLIFY_SECRET_NS, circleId)) || null;
}

export async function storeNetlifyToken(circleId: string, token: string): Promise<void> {
  await writeLocalSecret(NETLIFY_SECRET_NS, circleId, token);
}

export async function removeNetlifyToken(circleId: string): Promise<void> {
  await deleteLocalSecret(NETLIFY_SECRET_NS, circleId);
}

// ─── Low-level fetch helper ──────────────────────────────────────────────────

interface NfRes<T> { data: T | null; error: string | null; status: number }

async function nfFetch<T>(path: string, token: string, init?: RequestInit): Promise<NfRes<T>> {
  try {
    const res = await fetch(`${NETLIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init?.body && !(init.headers as any)?.['Content-Type']
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(bodyTxt);
        msg = parsed.message || parsed.error || msg;
      } catch { if (bodyTxt) msg = bodyTxt.slice(0, 200); }
      return { data: null, error: msg, status: res.status };
    }
    // 204 No Content still means success
    if (res.status === 204) return { data: null as unknown as T, error: null, status: 204 };
    const data = (await res.json()) as T;
    return { data, error: null, status: res.status };
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error', status: 0 };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function validateNetlifyToken(token: string): Promise<{ user: NetlifyUser | null; error: string | null; status: number }> {
  const { data, error, status } = await nfFetch<NetlifyUser>('/user', token);
  return { user: data, error, status };
}

export async function listNetlifySites(token: string, page = 1): Promise<{ sites: NetlifySite[]; error: string | null }> {
  const { data, error } = await nfFetch<NetlifySite[]>(`/sites?page=${page}&per_page=50&sort_by=updated_at`, token);
  return { sites: data || [], error };
}

async function createSite(token: string, suggestedName?: string): Promise<{ site: NetlifySite | null; error: string | null }> {
  const body = suggestedName ? JSON.stringify({ name: slugifyForNetlify(suggestedName) }) : '{}';
  const { data, error } = await nfFetch<NetlifySite>('/sites', token, { method: 'POST', body });
  return { site: data, error };
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function slugifyForNetlify(name: string): string {
  // Netlify names: lowercase alphanumeric + hyphens, 3-63 chars.
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'uc-build';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

async function uploadDeployFile(
  token: string,
  deployId: string,
  path: string,
  html: string,
): Promise<{ error: string | null }> {
  // Netlify expects the file at its path WITHOUT a leading slash in the URL.
  const cleanPath = path.replace(/^\/+/, '');
  try {
    const res = await fetch(`${NETLIFY_API}/deploys/${deployId}/files/${cleanPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: html,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `Upload failed (${res.status}): ${body.slice(0, 140)}` };
    }
    return { error: null };
  } catch (e: any) {
    return { error: e?.message || 'Upload network error' };
  }
}

async function pollDeployReady(
  token: string,
  deployId: string,
  timeoutMs = 60_000,
): Promise<{ deploy: NetlifyDeploy | null; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1000;
  while (Date.now() < deadline) {
    const { data, error } = await nfFetch<NetlifyDeploy>(`/deploys/${deployId}`, token);
    if (error) return { deploy: null, error };
    if (!data) return { deploy: null, error: 'Deploy poll returned no data' };
    if (data.state === 'ready') return { deploy: data, error: null };
    if (data.state === 'error') return { deploy: null, error: data.error_message || 'Deploy failed' };
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay + 500, 3000);
  }
  return { deploy: null, error: 'Deploy still processing after 60s — check Netlify dashboard' };
}

/**
 * Publish the current artifact HTML as index.html to Netlify.
 * Creates a new site if `siteId` is not provided.
 */
export async function deployArtifact(input: DeployArtifactInput): Promise<DeployResult> {
  const token = await getStoredNetlifyToken(input.circleId);
  if (!token) throw new Error('No Netlify token stored for this circle. Connect Netlify first.');

  // Resolve or create the site
  let site: NetlifySite | null = null;
  if (input.siteId) {
    const { data, error } = await nfFetch<NetlifySite>(`/sites/${input.siteId}`, token);
    if (error || !data) throw new Error(`Could not load site: ${error || 'unknown'}`);
    site = data;
  } else {
    const { site: created, error } = await createSite(token, input.suggestedName);
    if (error || !created) throw new Error(`Create site failed: ${error || 'unknown'}`);
    site = created;
  }

  // Start deploy via digest API — list files keyed by path with SHA1 as value
  const hash = await sha1Hex(input.html);
  const digest = { files: { '/index.html': hash } };
  const { data: deploy, error: deployErr } = await nfFetch<NetlifyDeploy>(
    `/sites/${site.id}/deploys`,
    token,
    { method: 'POST', body: JSON.stringify(digest) },
  );
  if (deployErr || !deploy) throw new Error(`Start deploy failed: ${deployErr || 'unknown'}`);

  // Upload any required files (Netlify skips ones it already has)
  const needs = new Set(deploy.required || []);
  if (needs.has(hash)) {
    const { error: upErr } = await uploadDeployFile(token, deploy.id, 'index.html', input.html);
    if (upErr) throw new Error(upErr);
  }

  // Wait for the deploy to flip to "ready"
  const { deploy: ready, error: pollErr } = await pollDeployReady(token, deploy.id);
  if (pollErr || !ready) throw new Error(pollErr || 'Deploy never reported ready');

  return {
    site,
    deploy: ready,
    url: ready.deploy_ssl_url || ready.deploy_url || site.ssl_url || site.url,
  };
}
