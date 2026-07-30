/**
 * desktopBridge — UC-side client for the Claude Code bridge's
 * desktop-automation endpoints (Phase 1a — see
 * `docs/DESKTOP_AUTOMATION_PHASE_1_PLAN.md`).
 *
 * Usage from an agent tool / chat action:
 *
 *   if (!(await isDesktopBridgeAvailable())) { ... }
 *   await pairDesktopBridge(); // first time only
 *   await launchApp('Zoom');
 *   await pressKeys('Cmd+N');
 *   await typeText('Chris');
 *
 * All calls return `{ ok, error?, errorCode?, data? }` — no throws at
 * the boundary (matches the rest of our lib posture).
 */

import {
  parseKeyCombo,
  isValidAppName,
  validateDesktopUrl,
  validateDesktopPath,
  validateClickCoords,
  type DesktopBridgeError,
  type DesktopResult,
  type DesktopHealth,
} from './desktopBridgeProtocol';
import { getBridgeUrl } from './bridgeEnvironment';
import { requestBridgePairToken } from './bridgeAuth';
import { normalizeDesktopFileSearchQuery } from './fileSearchQuery';
import { sanitizeUntrustedForModel } from './untrustedContent';
import {
  describeCadInstallGuidance,
  isAllowedOpenScadExtraArg,
  OPENSCAD_OUTPUT_EXTENSIONS,
  type CadEngine,
} from './cadCodeExecutor';
import {
  describeDesignExportInstallGuidance,
  INKSCAPE_OUTPUT_EXTENSIONS,
  validateDesignExportOptions,
  type DesignExportEngine,
  type DesignExportOptions,
} from './designCliExecutor';
import {
  validatePhotoshopApplyAdjustmentLayerParams,
  validatePhotoshopApplySelectionOrMaskParams,
  validatePhotoshopResizeCanvasOrImageParams,
  validatePhotoshopManageLayersParams,
  validatePhotoshopTransformLayerParams,
  validatePhotoshopConvertColorModeParams,
  type PhotoshopAdjustmentLayerKind,
  type PhotoshopCanvasAnchor,
  type PhotoshopColorMode,
  type PhotoshopLayerReorderPosition,
  type PhotoshopManageLayerAction,
  type PhotoshopResizeOp,
  type PhotoshopSelectionBoundsPx,
  type PhotoshopSelectionMaskMode,
  type PhotoshopTransformOp,
} from './photoshopExtendScriptAdapters';

export type {
  PhotoshopAdjustmentLayerKind,
  PhotoshopCanvasAnchor,
  PhotoshopColorMode,
  PhotoshopLayerReorderPosition,
  PhotoshopManageLayerAction,
  PhotoshopResizeOp,
  PhotoshopSelectionBoundsPx,
  PhotoshopSelectionMaskMode,
  PhotoshopTransformOp,
} from './photoshopExtendScriptAdapters';

import {
  validateIllustratorDocumentStatusParams,
  validateIllustratorExportProofParams,
  validateIllustratorTextInventoryParams,
  validateIllustratorSetLayerStateParams,
  validateIllustratorUpdateTextLayerParams,
  type IllustratorExportProofFormat,
} from './illustratorExtendScriptAdapters';

export type { IllustratorExportProofFormat } from './illustratorExtendScriptAdapters';

export type { DesktopBridgeError, DesktopResult, DesktopHealth } from './desktopBridgeProtocol';

const BRIDGE_PORT = 7778;
export const BRIDGE_HEALTH_URL = 'http://localhost:7778/desktop/health';
const TOKEN_KEY = 'uc_desktop_bridge_token_v1';
const LOCAL_FILE_SESSION_GRANT_KEY = 'uc_local_file_session_grant_v1';
const LOCAL_FILE_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export function getDesktopBridgeBaseUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

export function getDesktopBridgeHealthUrl(): string | null {
  const base = getDesktopBridgeBaseUrl();
  return base ? `${base}/desktop/health` : null;
}

// ─── Availability probe ────────────────────────────────────────────────────

export async function isDesktopBridgeAvailable(): Promise<boolean> {
  const base = getDesktopBridgeBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/desktop/health`, { cache: 'no-store' });
    if (!res.ok) return false;
    const json = (await res.json()) as DesktopHealth;
    return !!json?.supported;
  } catch {
    return false;
  }
}

export async function getDesktopBridgeHealth(): Promise<DesktopHealth | null> {
  const base = getDesktopBridgeBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/desktop/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as DesktopHealth;
  } catch {
    return null;
  }
}

// ─── Token storage ────────────────────────────────────────────────────────
//
// The web client caches the paired token in localStorage. It's
// intentionally plain-text on disk (same trust level as any other
// localStorage secret we hold — session cookies, BYO API keys) because
// the token is only useful against a bridge running on THIS machine,
// and any attacker with disk access can read ~/.uc-desktop-token
// directly anyway.

function readToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, value);
  } catch {
    /* quota / private-mode — caller proceeds without persistence */
  }
}

// ── Secondary token copy (gap #9: survive a localStorage clear) ───────────
//
// localStorage is the fast/sync primary, but "Clear site data" wipes it and
// forces a re-pair. The secondary copy lives where that clear does not
// reach by accident:
//   - web: IndexedDB (own tiny DB), value AES-GCM-encrypted via
//     `webCrypto.encryptString` when available (plaintext fallback —
//     same posture as `localSecrets`).
//   - native: `localSecrets` (expo-secure-store keychain/keystore).
// Every helper is silent — storage problems must never break bridge calls.

const SECONDARY_DB_NAME = 'uc_desktop_bridge_v1';
const SECONDARY_DB_STORE = 'kv';
const SECONDARY_TOKEN_KEY = 'pair_token_v1';
const SECONDARY_SECRET_NAMESPACE = 'desktop_bridge';
const SECONDARY_SECRET_ID = 'pair_token';

function openSecondaryDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(SECONDARY_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SECONDARY_DB_STORE)) {
          db.createObjectStore(SECONDARY_DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function secondaryIdbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SECONDARY_DB_STORE, 'readonly');
      const req = tx.objectStore(SECONDARY_DB_STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function secondaryIdbPut(db: IDBDatabase, key: string, value: string | null): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SECONDARY_DB_STORE, 'readwrite');
      const store = tx.objectStore(SECONDARY_DB_STORE);
      const req = value === null ? store.delete(key) : store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch { resolve(); }
  });
}

async function writeSecondaryToken(value: string | null): Promise<void> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openSecondaryDb();
      if (!db) return;
      let stored = value;
      if (value) {
        try {
          // Lazy import — webCrypto pulls in react-native; this module must
          // stay loadable in dependency-light runtimes.
          const { encryptString, isWebCryptoAvailable } = await import('./webCrypto');
          if (isWebCryptoAvailable()) stored = (await encryptString(value)) || value;
        } catch { /* plaintext fallback */ }
      }
      await secondaryIdbPut(db, SECONDARY_TOKEN_KEY, stored);
      return;
    }
    // Native (no IndexedDB): OS keychain via localSecrets.
    const { writeLocalSecret } = await import('./localSecrets');
    await writeLocalSecret(SECONDARY_SECRET_NAMESPACE, SECONDARY_SECRET_ID, value || '');
  } catch { /* silent — storage must never break bridge calls */ }
}

async function readSecondaryToken(): Promise<string | null> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const db = await openSecondaryDb();
      if (!db) return null;
      const raw = await secondaryIdbGet(db, SECONDARY_TOKEN_KEY);
      if (!raw) return null;
      try {
        const { decryptString, isEncryptedBlob } = await import('./webCrypto');
        if (isEncryptedBlob(raw)) return await decryptString(raw);
      } catch { /* fall through to raw */ }
      return raw;
    }
    const { readLocalSecret } = await import('./localSecrets');
    const stored = await readLocalSecret(SECONDARY_SECRET_NAMESPACE, SECONDARY_SECRET_ID);
    return stored || null;
  } catch {
    return null;
  }
}

export function clearDesktopBridgeToken(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
  } catch {}
  void writeSecondaryToken(null);
}

/**
 * Returns cached token status so the UI can render chips and so agent
 * tool wrappers can short-circuit without hitting the network.
 */
export function isDesktopBridgePaired(): boolean {
  const t = readToken();
  return !!t && t.length >= 32;
}

/**
 * Returns the cached desktop-bridge token (synchronously, localStorage only)
 * so credentialed callers like credentialService can attach the
 * `X-UC-Desktop-Token` header. Returns null when not yet paired — callers
 * should fall back to `ensureDesktopBridgePaired()` to auto-pair.
 */
export function getDesktopBridgeToken(): string | null {
  const t = readToken();
  return t && t.length >= 32 ? t : null;
}

/**
 * Best-effort "make sure we're paired" used by every write-path helper.
 * If the loopback-only bridge is reachable and supported and we don't have a
 * token yet, completes its short-lived one-time challenge exchange. On any
 * failure the caller surfaces the original error to the user.
 */
export async function ensureDesktopBridgePaired(): Promise<DesktopResult<{ token: string; autoPaired: boolean }>> {
  const cached = readToken();
  if (cached && cached.length >= 32) {
    return { ok: true, data: { token: cached, autoPaired: false } };
  }
  // Read-through fallback (gap #9): localStorage was cleared but the
  // secondary copy survived — repopulate the primary and skip re-pairing.
  const recovered = await readSecondaryToken();
  if (recovered && recovered.length >= 32) {
    writeToken(recovered);
    return { ok: true, data: { token: recovered, autoPaired: false } };
  }
  const health = await getDesktopBridgeHealth();
  if (!health) {
    return { ok: false, error: 'bridge_offline', errorCode: 'bridge_offline' };
  }
  if (!health.supported) {
    return { ok: false, error: 'platform_unsupported', errorCode: 'platform_unsupported' };
  }
  const paired = await pairDesktopBridge();
  if (!paired.ok) return paired as DesktopResult<{ token: string; autoPaired: boolean }>;
  return { ok: true, data: { token: paired.data!.token, autoPaired: true } };
}

// ─── Pairing ───────────────────────────────────────────────────────────────

/**
 * One-time handshake with the local bridge. Completes a short-lived challenge
 * before the bridge returns the shared token, then caches it locally. Call once
 * per device.
 */
export async function pairDesktopBridge(): Promise<DesktopResult<{ token: string }>> {
  const base = getDesktopBridgeBaseUrl();
  if (!base) {
    return { ok: false, error: 'bridge unavailable in this environment', errorCode: 'bridge_offline' };
  }
  try {
    const paired = await requestBridgePairToken(`${base}/desktop/pair`);
    if (!paired.ok || !paired.token) {
      return {
        ok: false,
        error: paired.error || 'pairing response missing token',
        errorCode: paired.status === 401 || paired.status === 403 ? 'not_paired' : 'unknown',
      };
    }
    writeToken(paired.token);
    // Dual-write: secondary copy survives a localStorage clear (gap #9).
    void writeSecondaryToken(paired.token);
    return { ok: true, data: { token: paired.token } };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'bridge unreachable', errorCode: 'bridge_offline' };
  }
}

// ─── Desktop actions ───────────────────────────────────────────────────────

export async function listRunningApps(): Promise<DesktopResult<string[]>> {
  const r = await callBridge('GET', '/desktop/running-apps');
  if (!r.ok) return r as DesktopResult<string[]>;
  return { ok: true, data: ((r.data as any)?.apps as string[]) || [] };
}

// ─── Installed-application detection ──────────────────────────────────────
//
// Feeds task→app resolution ("is Photoshop actually installed?"). The
// bridge already caches enumeration server-side for 5 minutes; the client
// cache below saves the HTTP round-trip too, keyed by bridge base URL so a
// bridge URL change never serves another machine's app list.

export type InstalledAppEntry = { name: string; path?: string };

export type InstalledAppsResult = {
  apps: InstalledAppEntry[];
  source: 'spotlight' | 'fs';
  truncated: boolean;
};

const INSTALLED_APPS_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const installedAppsClientCache = new Map<string, { ts: number; data: InstalledAppsResult }>();

/** Test/diagnostic hook — drops the client-side installed-apps cache. */
export function clearInstalledAppsClientCache(): void {
  installedAppsClientCache.clear();
}

/**
 * Lists applications installed on the local Mac (Spotlight when fast,
 * standard app folders otherwise). Bounded at 400 entries, names deduped
 * case-insensitively by the bridge. Cached client-side for 5 minutes.
 */
export async function listInstalledApps(): Promise<DesktopResult<InstalledAppsResult>> {
  const base = getDesktopBridgeBaseUrl();
  const cacheKey = base || 'no-bridge';
  const cached = installedAppsClientCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < INSTALLED_APPS_CLIENT_CACHE_TTL_MS) {
    return { ok: true, data: cached.data };
  }
  const r = await callBridge('GET', '/desktop/installed-apps');
  if (!r.ok) return r as DesktopResult<InstalledAppsResult>;
  const d = r.data as any;
  const apps: InstalledAppEntry[] = (Array.isArray(d?.apps) ? d.apps : [])
    .map((entry: any): InstalledAppEntry | null => {
      const name = String(entry?.name || '').trim();
      if (!name) return null;
      const path = String(entry?.path || '').trim();
      return path ? { name, path } : { name };
    })
    .filter((entry: InstalledAppEntry | null): entry is InstalledAppEntry => !!entry);
  const data: InstalledAppsResult = {
    apps,
    source: d?.source === 'spotlight' ? 'spotlight' : 'fs',
    truncated: d?.truncated === true,
  };
  installedAppsClientCache.set(cacheKey, { ts: Date.now(), data });
  return { ok: true, data };
}

/**
 * Silent-fail convenience for the model layer's `installedApps?: string[]`
 * field: lowercased installed-app names, `[]` on any bridge/availability
 * failure. Never throws.
 */
export async function listInstalledAppNamesLower(): Promise<string[]> {
  try {
    const r = await listInstalledApps();
    if (!r.ok || !r.data) return [];
    return r.data.apps.map((app) => app.name.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Cheap point query: is a single named app installed? Uses the bridge's
 * `open -Ra` LaunchServices check plus its fuzzy bundle resolver, so
 * "Photoshop" reports installed even when the bundle is
 * "Adobe Photoshop 2025" (returned via `resolvedName`/`appPath`).
 */
export async function checkAppInstalled(
  appName: string,
): Promise<DesktopResult<{ appName: string; installed: boolean; resolvedName?: string; appPath?: string }>> {
  const clean = String(appName || '').trim();
  if (!isValidAppName(clean)) {
    return { ok: false, error: 'Invalid app name.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('GET', `/desktop/app-installed?name=${encodeURIComponent(clean)}`);
  if (!r.ok) return r as DesktopResult<{ appName: string; installed: boolean; resolvedName?: string; appPath?: string }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      appName: String(d?.appName || clean),
      installed: d?.installed === true,
      ...(d?.resolvedName ? { resolvedName: String(d.resolvedName) } : {}),
      ...(d?.appPath ? { appPath: String(d.appPath) } : {}),
    },
  };
}

export type DesktopBrowserTab = {
  browser: string;
  title: string;
  url: string;
  // QW2: page-controlled tab title/URL are UNTRUSTED. Raw `title`/`url` stay
  // verbatim (actionable — e.g. re-open the tab); `modelTitle`/`modelUrl` are
  // the sanitized copies for the model-facing tab list (Tag-char smuggling
  // stripped, auto-loading markdown link/image syntax defanged).
  modelTitle: string;
  modelUrl: string;
};

function normalizeBrowserFilter(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'google chrome') return 'chrome';
  if (normalized === 'microsoft edge') return 'edge';
  if (normalized === 'brave browser') return 'brave';
  return normalized;
}

function filterBrowserTabs(
  tabs: DesktopBrowserTab[],
  browsers?: string[],
): DesktopBrowserTab[] {
  if (!browsers || browsers.length === 0) return tabs;
  const wanted = new Set(browsers.map(normalizeBrowserFilter).filter(Boolean));
  if (wanted.size === 0) return tabs;
  return tabs.filter((tab) => wanted.has(normalizeBrowserFilter(tab.browser)));
}

function normalizeBrowserTab(raw: any): DesktopBrowserTab {
  const browser = String(raw?.browser || '');
  const title = String(raw?.title || '');
  const url = String(raw?.url || '');
  // QW2: attach the sanitized model-facing copies; raw title/url preserved.
  return { browser, title, url, modelTitle: sanitizeUntrustedForModel(title), modelUrl: sanitizeUntrustedForModel(url) };
}

function parseBrowserTabsResult(r: DesktopResult, browsers?: string[]): DesktopResult<{ tabs: DesktopBrowserTab[]; errors: string[] }> {
  if (!r.ok) return r as DesktopResult<{ tabs: DesktopBrowserTab[]; errors: string[] }>;
  const d = r.data as any;
  const tabs = (Array.isArray(d?.tabs) ? d.tabs : []).map(normalizeBrowserTab);
  return {
    ok: true,
    data: {
      tabs: filterBrowserTabs(tabs, browsers),
      errors: Array.isArray(d?.errors) ? d.errors : [],
    },
  };
}

export async function listBrowserTabs(browsers?: string[]): Promise<DesktopResult<{ tabs: DesktopBrowserTab[]; errors: string[] }>> {
  const query = browsers && browsers.length > 0 ? `?browsers=${encodeURIComponent(browsers.join(','))}` : '';
  const r = await callBridge('GET', `/desktop/browser_tabs${query}`);
  if (r.ok || !query) return parseBrowserTabsResult(r, browsers);

  // Older running bridge processes matched the full URL instead of the
  // pathname, so `/desktop/browser_tabs?browsers=chrome` 404ed while the
  // no-query endpoint worked. Retry without the query and filter locally
  // so users don't have to restart the bridge just to read Chrome tabs.
  const fallback = await callBridge('GET', '/desktop/browser_tabs');
  return parseBrowserTabsResult(fallback.ok ? fallback : r, browsers);
}

export type DesktopWindowState = {
  frontmostApp: string;
  activeWindowTitle: string;
  activeWindowBounds: { x: number; y: number; width: number; height: number } | null;
  windows: string[];
};

export async function getWindowState(): Promise<DesktopResult<DesktopWindowState>> {
  const r = await callBridge('GET', '/desktop/window_state');
  if (!r.ok) return r as DesktopResult<DesktopWindowState>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      frontmostApp: String(d?.frontmostApp || ''),
      activeWindowTitle: String(d?.activeWindowTitle || ''),
      activeWindowBounds: d?.activeWindowBounds || null,
      windows: Array.isArray(d?.windows) ? d.windows : [],
    },
  };
}

export async function readClipboard(): Promise<DesktopResult<{ text: string; modelText: string; chars: number; truncated: boolean }>> {
  const r = await callBridge('GET', '/desktop/clipboard');
  if (!r.ok) return r as DesktopResult<{ text: string; modelText: string; chars: number; truncated: boolean }>;
  const d = r.data as any;
  const text = String(d?.text || '');
  // QW2: clipboard text is UNTRUSTED (whatever the user/an app copied). Raw
  // `text` is preserved verbatim for round-trip / user display / file ops;
  // `modelText` is the sanitized copy the model path should fence + show
  // (Tag-char smuggling stripped, auto-loading markdown links defanged).
  return { ok: true, data: { text, modelText: sanitizeUntrustedForModel(text), chars: Number(d?.chars || 0), truncated: Boolean(d?.truncated) } };
}

export async function writeClipboard(text: string): Promise<DesktopResult<{ chars: number }>> {
  if (typeof text !== 'string') return { ok: false, error: 'text must be a string', errorCode: 'invalid_input' };
  if (text.length > 4000) return { ok: false, error: 'text too long (max 4000 chars)', errorCode: 'invalid_input' };
  const r = await callBridge('POST', '/desktop/clipboard_write', { text });
  if (!r.ok) return r as DesktopResult<{ chars: number }>;
  return { ok: true, data: { chars: Number((r.data as any)?.chars ?? text.length) } };
}

export async function clearClipboard(): Promise<DesktopResult<Record<string, never>>> {
  const r = await callBridge('POST', '/desktop/clipboard_clear', {});
  if (!r.ok) return r as DesktopResult<Record<string, never>>;
  return { ok: true, data: {} };
}

/**
 * Create a note in the macOS Notes app via a deterministic AppleScript recipe
 * (`make new note with properties {body:…}`). The body text is passed to the
 * bridge as an argv item, so arbitrary content never needs escaping. Notes
 * launches itself if it isn't already open.
 */
export async function createNote(
  args: { text: string; title?: string },
): Promise<DesktopResult<{ title: string; chars: number }>> {
  const text = typeof args?.text === 'string' ? args.text : '';
  const title = typeof args?.title === 'string' ? args.title : '';
  if (!text.trim() && !title.trim()) {
    return { ok: false, error: 'text is required', errorCode: 'invalid_input' };
  }
  if (text.length > 20_000) {
    return { ok: false, error: 'text too long (max 20000 chars)', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/notes_create', { text, title });
  if (!r.ok) return r as DesktopResult<{ title: string; chars: number }>;
  return {
    ok: true,
    data: {
      title: String((r.data as any)?.title || ''),
      chars: Number((r.data as any)?.chars ?? text.length),
    },
  };
}

/**
 * Run a small AppleScript program against any scriptable macOS app — the
 * general "research how, then do it" surface. Pass `scriptLines` (osascript
 * `-e` lines, typically an `on run argv` program) and `args` (read as
 * `item N of argv`, so user content needs no escaping). Build these with
 * `scriptableMacApps` recipes for common intents, or supply your own for an
 * app the agent researched. Mutating — the runtime gates it behind approval.
 */
export async function runDesktopAppleScript(
  program: { scriptLines: string[]; args?: string[] },
): Promise<DesktopResult<{ output: string }>> {
  const scriptLines = Array.isArray(program?.scriptLines)
    ? program.scriptLines.map((l) => String(l)).filter((l) => l.length > 0)
    : [];
  if (scriptLines.length === 0) {
    return { ok: false, error: 'scriptLines is required', errorCode: 'invalid_input' };
  }
  if (scriptLines.join('\n').length > 10_000) {
    return { ok: false, error: 'script too long (max 10000 chars)', errorCode: 'invalid_input' };
  }
  const args = Array.isArray(program?.args) ? program.args.map((a) => String(a)).slice(0, 16) : [];
  const r = await callBridge('POST', '/desktop/applescript', { scriptLines, args });
  if (!r.ok) return r as DesktopResult<{ output: string }>;
  return { ok: true, data: { output: String((r.data as any)?.output || '') } };
}

/**
 * Convert an image to another format (PNG/JPG/TIFF/GIF/BMP/HEIC) deterministically
 * via macOS sips — no GUI, no modal dialogs. This is the reliable path for
 * "save/convert/export this image as PNG": it never depends on a desktop app's
 * scriptable export (which stalls on color-profile / format dialogs). `source`
 * may be a full path OR a bare name resolved across Desktop/Downloads/
 * Documents/Pictures. Mutating (writes a new file next to the source), but
 * bounded and non-clobbering so the runtime can use it as the fast path.
 */
export async function convertImage(
  args: { source: string; format?: string },
): Promise<DesktopResult<{ sourcePath: string; outputPath: string; format: string; bytes: number }>> {
  const source = typeof args?.source === 'string' ? args.source.trim() : '';
  if (!source) return { ok: false, error: 'source (image path or name) is required', errorCode: 'invalid_input' };
  const grantRoots = inferConvertImageGrantRoots(source);
  const grantHeaders = await ensureLocalFileGrantHeaders(grantRoots, 'write', `Convert local image ${source}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ sourcePath: string; outputPath: string; format: string; bytes: number }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/convert_image', {
    source,
    format: typeof args?.format === 'string' ? args.format : 'png',
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ sourcePath: string; outputPath: string; format: string; bytes: number }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      sourcePath: String(d?.sourcePath || ''),
      outputPath: String(d?.outputPath || ''),
      format: String(d?.format || ''),
      bytes: Number(d?.bytes ?? 0),
    },
  };
}

function inferConvertImageGrantRoots(source: string): string[] {
  const value = String(source || '').trim();
  if (
    value.startsWith('/')
    || value.startsWith('~/')
    || value.startsWith('./')
    || value.startsWith('../')
    || /^[A-Za-z0-9 ._-]+\/.+/.test(value)
  ) {
    // Conversion intentionally creates a non-clobbering sibling whose final
    // name can vary on conflict. Grant the exact source plus its explicit
    // containing directory for that bounded output operation.
    const slash = value.lastIndexOf('/');
    const parent = slash > 0 ? value.slice(0, slash) : (slash === 0 ? '/' : '.');
    return [value, parent];
  }
  return ['~/Desktop', '~/Downloads', '~/Documents', '~/Pictures'];
}

// ─── Headless code-CAD compilation (/desktop/cad_compile) ─────────────────

export type CadCompileOutputInfo = { path: string; bytes: number; exists: boolean };

/**
 * Structured compile diagnostics. Present on success AND on ok:false
 * failures where the compile actually ran (non-zero exit, timeout, missing
 * output) or the engine was missing — so the agent loop can read stderr,
 * fix the generated code, or surface the install hint.
 */
export type CadCompileData = {
  engine: string;
  binaryPath: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  output: CadCompileOutputInfo;
  installHint: string | null;
};

function normalizeCadCompileData(engine: CadEngine, body: unknown): CadCompileData {
  const d = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const output = (d.output && typeof d.output === 'object' ? d.output : {}) as Record<string, unknown>;
  const exitCode = Number(d.exitCode);
  return {
    engine: String(d.engine || engine).slice(0, 40),
    binaryPath: String(d.binaryPath || '').slice(0, 300),
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    timedOut: d.timedOut === true,
    durationMs: Number.isFinite(Number(d.durationMs)) ? Number(d.durationMs) : 0,
    stdoutTail: String(d.stdoutTail || '').slice(0, 2000),
    stderrTail: String(d.stderrTail || '').slice(0, 2000),
    output: {
      path: String(output.path || '').slice(0, 1024),
      bytes: Number.isFinite(Number(output.bytes)) ? Number(output.bytes) : 0,
      exists: output.exists === true,
    },
    installHint: typeof d.installHint === 'string' ? d.installHint.slice(0, 200) : null,
  };
}

/**
 * Compile code-CAD locally and deterministically via the bridge's
 * `/desktop/cad_compile` endpoint — no GUI, no dialogs, execFile argv only.
 *
 *   - engine 'openscad': sourcePath is a .scad program, outputPath one of
 *     .stl/.off/.amf/.3mf/.png/.svg/.dxf; `extraArgs` accepts ONLY
 *     -Dname=<number|true|false>, --render, --imgsize=W,H (allowlist
 *     enforced here AND server-side — LOCKSTEP with cadCodeExecutor.ts and
 *     scripts/claude-bridge.js).
 *   - engine 'freecadcmd': sourcePath is a generated .py script (build it
 *     with buildFreeCadPythonScript); no extraArgs; the script writes its
 *     own outputs and the bridge verifies outputPath exists AFTERWARD.
 *   - engine 'blender': sourcePath is a generated .py bpy script (build it
 *     with buildBlenderPythonScript); no extraArgs; the bridge runs it via
 *     `--background --factory-startup --python` and verifies outputPath
 *     exists AFTERWARD (mesh conversion + Workbench render previews).
 *
 * Failure results carry `data` diagnostics (exitCode/stderrTail/output),
 * and `engine_not_installed` failures include a plain-language install
 * hint in the error text. Mutating (writes outputPath) — run it behind the
 * same approval gates as other local file writes.
 */
export async function compileCadCode(args: {
  engine: CadEngine;
  sourcePath: string;
  outputPath: string;
  extraArgs?: string[];
  timeoutMs?: number;
}): Promise<DesktopResult<CadCompileData>> {
  const engine = args?.engine;
  if (engine !== 'openscad' && engine !== 'freecadcmd' && engine !== 'blender') {
    return { ok: false, error: 'engine must be "openscad", "freecadcmd", or "blender"', errorCode: 'invalid_input' };
  }
  const source = validateDesktopPath(typeof args?.sourcePath === 'string' ? args.sourcePath : '');
  if (!source.ok) return { ok: false, error: `sourcePath: ${source.error}`, errorCode: 'invalid_input' };
  const output = validateDesktopPath(typeof args?.outputPath === 'string' ? args.outputPath : '');
  if (!output.ok) return { ok: false, error: `outputPath: ${output.error}`, errorCode: 'invalid_input' };

  // LOCKSTEP extension/extraArgs preflight — mirrors /desktop/cad_compile in
  // scripts/claude-bridge.js so we fail fast with the same contract.
  const extraArgs = Array.isArray(args?.extraArgs) ? args.extraArgs.map((a) => String(a)) : [];
  if (engine === 'openscad') {
    if (!/\.scad$/i.test(source.path)) {
      return { ok: false, error: 'openscad sourcePath must end in .scad', errorCode: 'invalid_input' };
    }
    const outputExtRegex = new RegExp(`\\.(${OPENSCAD_OUTPUT_EXTENSIONS.join('|')})$`, 'i');
    if (!outputExtRegex.test(output.path)) {
      return { ok: false, error: `openscad outputPath must end in one of: ${OPENSCAD_OUTPUT_EXTENSIONS.map((e) => `.${e}`).join(', ')}`, errorCode: 'invalid_input' };
    }
    if (extraArgs.length > 8) {
      return { ok: false, error: 'too many extraArgs (max 8)', errorCode: 'invalid_input' };
    }
    for (const arg of extraArgs) {
      if (!isAllowedOpenScadExtraArg(arg)) {
        return { ok: false, error: `extraArgs item not allowed: "${arg.slice(0, 80)}" — allowed: -Dname=<number|true|false>, --render, --imgsize=W,H`, errorCode: 'invalid_input' };
      }
    }
  } else {
    // freecadcmd AND blender both consume a generated python script and
    // accept no extraArgs (LOCKSTEP with /desktop/cad_compile in the bridge).
    if (!/\.py$/i.test(source.path)) {
      return { ok: false, error: `${engine} sourcePath must end in .py (the generated ${engine === 'blender' ? 'Blender bpy' : 'FreeCAD'} script)`, errorCode: 'invalid_input' };
    }
    if (extraArgs.length > 0) {
      return { ok: false, error: `${engine} accepts no extraArgs — the generated script carries its own IO`, errorCode: 'invalid_input' };
    }
  }

  // One write-scoped grant covering the exact source and output paths.
  const grantHeaders = await ensureLocalFileGrantHeaders(
    [source.path, output.path],
    'write',
    `Compile CAD (${engine}) ${source.path.split('/').pop() || source.path}`,
  );
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<CadCompileData>(grantHeaders);

  const r = await callBridge('POST', '/desktop/cad_compile', {
    engine,
    sourcePath: source.path,
    outputPath: output.path,
    extraArgs,
    ...(typeof args?.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
  }, { headers: grantHeaders.data, attachBodyOnError: true });

  if (!r.ok) {
    const body = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : null;
    const isEngineMissing = r.error === 'engine_not_installed' || body?.error === 'engine_not_installed';
    return {
      ok: false,
      error: isEngineMissing ? `engine_not_installed — ${describeCadInstallGuidance(engine)}` : r.error,
      errorCode: r.errorCode,
      recoveryHint: r.recoveryHint,
      ...(body ? { data: normalizeCadCompileData(engine, body) } : {}),
    };
  }
  return { ok: true, data: normalizeCadCompileData(engine, r.data) };
}

// ─── Headless design export (/desktop/design_export) ──────────────────────

export type DesignExportOutputInfo = { path: string; bytes: number; exists: boolean };

/**
 * Structured export diagnostics. Present on success AND on ok:false
 * failures where the export actually ran (non-zero exit, timeout, missing
 * output) or the engine was missing — so the agent loop can read stderr,
 * fix the source, or surface the install hint. Same shape as CadCompileData.
 */
export type DesignExportData = {
  engine: string;
  binaryPath: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  output: DesignExportOutputInfo;
  installHint: string | null;
};

function normalizeDesignExportData(engine: DesignExportEngine, body: unknown): DesignExportData {
  const d = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const output = (d.output && typeof d.output === 'object' ? d.output : {}) as Record<string, unknown>;
  const exitCode = Number(d.exitCode);
  return {
    engine: String(d.engine || engine).slice(0, 40),
    binaryPath: String(d.binaryPath || '').slice(0, 300),
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    timedOut: d.timedOut === true,
    durationMs: Number.isFinite(Number(d.durationMs)) ? Number(d.durationMs) : 0,
    stdoutTail: String(d.stdoutTail || '').slice(0, 2000),
    stderrTail: String(d.stderrTail || '').slice(0, 2000),
    output: {
      path: String(output.path || '').slice(0, 1024),
      bytes: Number.isFinite(Number(output.bytes)) ? Number(output.bytes) : 0,
      exists: output.exists === true,
    },
    installHint: typeof d.installHint === 'string' ? d.installHint.slice(0, 200) : null,
  };
}

/**
 * Export a design file locally and deterministically via the bridge's
 * `/desktop/design_export` endpoint — no GUI, no dialogs, execFile argv
 * only (same executor class as compileCadCode).
 *
 *   - engine 'inkscape': sourcePath is an .svg, outputPath one of
 *     .png/.pdf/.eps; `options` accepts ONLY widthPx/heightPx (integers
 *     16..16384; they size the PNG raster) and pdfVersion ('1.4'..'1.7',
 *     emitted only for .pdf outputs) — allowlist enforced here AND
 *     server-side (LOCKSTEP with designCliExecutor.ts and
 *     scripts/claude-bridge.js).
 *   - engine 'sketchtool': sourcePath is a .sketch document, outputPath a
 *     .png; v1 runs `sketchtool export preview` (ONE document-preview
 *     image — artboard-set export is a follow-up lane); `options` accepts
 *     ONLY format ('png') and scale (1|2|3 → --max-size 2048×scale).
 *     sketchtool writes its own `preview.png` into the output folder; the
 *     bridge renames the FRESH preview onto outputPath and verifies it.
 *
 * Failure results carry `data` diagnostics (exitCode/stderrTail/output),
 * and `engine_not_installed` failures include a plain-language install
 * hint in the error text. Mutating (writes outputPath) — run it behind the
 * same approval gates as other local file writes.
 */
export async function designExport(args: {
  engine: DesignExportEngine;
  sourcePath: string;
  outputPath: string;
  options?: DesignExportOptions;
  timeoutMs?: number;
}): Promise<DesktopResult<DesignExportData>> {
  const engine = args?.engine;
  if (engine !== 'inkscape' && engine !== 'sketchtool') {
    return { ok: false, error: 'engine must be "inkscape" or "sketchtool"', errorCode: 'invalid_input' };
  }
  const source = validateDesktopPath(typeof args?.sourcePath === 'string' ? args.sourcePath : '');
  if (!source.ok) return { ok: false, error: `sourcePath: ${source.error}`, errorCode: 'invalid_input' };
  const output = validateDesktopPath(typeof args?.outputPath === 'string' ? args.outputPath : '');
  if (!output.ok) return { ok: false, error: `outputPath: ${output.error}`, errorCode: 'invalid_input' };

  // LOCKSTEP extension/options preflight — mirrors /desktop/design_export
  // in scripts/claude-bridge.js so we fail fast with the same contract.
  if (engine === 'inkscape') {
    if (!/\.svg$/i.test(source.path)) {
      return { ok: false, error: 'inkscape sourcePath must end in .svg', errorCode: 'invalid_input' };
    }
    const outputExtRegex = new RegExp(`\\.(${INKSCAPE_OUTPUT_EXTENSIONS.join('|')})$`, 'i');
    if (!outputExtRegex.test(output.path)) {
      return { ok: false, error: `inkscape outputPath must end in one of: ${INKSCAPE_OUTPUT_EXTENSIONS.map((e) => `.${e}`).join(', ')}`, errorCode: 'invalid_input' };
    }
  } else {
    if (!/\.sketch$/i.test(source.path)) {
      return { ok: false, error: 'sketchtool sourcePath must end in .sketch', errorCode: 'invalid_input' };
    }
    if (!/\.png$/i.test(output.path)) {
      return { ok: false, error: 'sketchtool outputPath must end in .png (document preview export)', errorCode: 'invalid_input' };
    }
  }
  const optionsValidated = validateDesignExportOptions(engine, args?.options);
  if (!optionsValidated.ok) {
    return { ok: false, error: optionsValidated.error, errorCode: 'invalid_input' };
  }

  // One write-scoped grant covering the exact source and output paths.
  const grantHeaders = await ensureLocalFileGrantHeaders(
    [source.path, output.path],
    'write',
    `Design export (${engine}) ${source.path.split('/').pop() || source.path}`,
  );
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<DesignExportData>(grantHeaders);

  const r = await callBridge('POST', '/desktop/design_export', {
    engine,
    sourcePath: source.path,
    outputPath: output.path,
    options: optionsValidated.options,
    ...(typeof args?.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
  }, { headers: grantHeaders.data, attachBodyOnError: true });

  if (!r.ok) {
    const body = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : null;
    const isEngineMissing = r.error === 'engine_not_installed' || body?.error === 'engine_not_installed';
    return {
      ok: false,
      error: isEngineMissing ? `engine_not_installed — ${describeDesignExportInstallGuidance(engine)}` : r.error,
      errorCode: r.errorCode,
      recoveryHint: r.recoveryHint,
      ...(body ? { data: normalizeDesignExportData(engine, body) } : {}),
    };
  }
  return { ok: true, data: normalizeDesignExportData(engine, r.data) };
}

export type DesktopFileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'other';
  size: number | null;
  modifiedAt: string | null;
};

export type LocalFileSessionGrant = {
  token: string;
  roots: string[];
  scope: 'read' | 'write';
  expiresAt: string;
};

export type LocalFileSessionGrantRequest = {
  roots?: string[];
  ttlMs?: number;
  reason?: string;
  scope?: 'read' | 'write';
};

function validateExactLocalFileGrantRoots(
  rawRoots: string[] | undefined,
): DesktopResult<string[]> {
  if (!Array.isArray(rawRoots) || rawRoots.length === 0) {
    return {
      ok: false,
      error: 'Local file access requires an exact project, folder, or file path. Home-directory defaults are not allowed.',
      errorCode: 'invalid_input',
    };
  }
  const roots = rawRoots.map((root) => String(root || '').trim());
  if (roots.some((root) => !root)) {
    return {
      ok: false,
      error: 'Local file access roots must be non-empty paths.',
      errorCode: 'invalid_input',
    };
  }
  const includesBroadRoot = roots.some((root) => {
    const lower = root.toLowerCase().replace(/\/+$/, '');
    return lower === '~'
      || lower === 'home'
      || lower === 'home folder'
      || lower === 'home directory'
      || lower === '/'
      || /^\/users\/[^/]+$/.test(lower);
  });
  if (includesBroadRoot) {
    return {
      ok: false,
      error: 'Home-directory-wide local file grants are refused. Request exact project, folder, or file paths.',
      errorCode: 'invalid_input',
    };
  }
  return { ok: true, data: Array.from(new Set(roots)) };
}

function normalizeGrantRootForCompare(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (/^(?:google[_\s-]*drive|gdrive|my\s+drive)$/.test(lower)) return '~/Library/CloudStorage';
  if (lower === 'home' || lower === 'home folder' || lower === 'home directory') return '~';
  if (lower === 'downloads' || lower === 'download') return '~/Downloads';
  if (lower === 'documents' || lower === 'document') return '~/Documents';
  if (lower === 'desktop') return '~/Desktop';
  if (lower === 'pictures' || lower === 'photos') return '~/Pictures';
  if (lower === 'movies' || lower === 'videos') return '~/Movies';
  if (lower === 'music' || lower === 'audio') return '~/Music';
  return trimmed.replace(/\/+$/, '');
}

function grantCoversRequestedRoots(grant: LocalFileSessionGrant, requestedRoots?: string[]): boolean {
  if (!requestedRoots || requestedRoots.length === 0) return false;
  const grantRoots = grant.roots.map(normalizeGrantRootForCompare).filter(Boolean);
  if (grantRoots.some((root) => root === '~' || root.endsWith('/Users') || root.includes('/Users/'))) {
    const coversHome = grantRoots.some((root) => root === '~' || /\/Users\/[^/]+$/.test(root));
    if (coversHome) return true;
  }
  return requestedRoots.every((rawRoot) => {
    const root = normalizeGrantRootForCompare(rawRoot);
    return grantRoots.some((grantRoot) => {
      if (grantRoot === '~') return true;
      if (root === grantRoot || root.startsWith(`${grantRoot}/`)) return true;
      if (root === '~' && /\/Users\/[^/]+$/.test(grantRoot)) return true;
      const homeMatch = grantRoot.match(/^\/Users\/[^/]+(?:\/(.+))?$/);
      if (homeMatch) {
        const homeAlias = homeMatch[1] ? `~/${homeMatch[1]}` : '~';
        if (root === homeAlias || root.startsWith(`${homeAlias}/`)) return true;
      }
      if (root.startsWith('~/') && grantRoot.endsWith(root.slice(1))) return true;
      return false;
    });
  });
}

function grantSatisfiesScope(grant: LocalFileSessionGrant, requiredScope: 'read' | 'write' = 'read'): boolean {
  if (requiredScope === 'read') return grant.scope === 'read' || grant.scope === 'write';
  return grant.scope === 'write';
}

export function getActiveLocalFileSessionGrant(
  requestedRoots?: string[],
  requiredScope: 'read' | 'write' = 'read',
): LocalFileSessionGrant | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(LOCAL_FILE_SESSION_GRANT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalFileSessionGrant;
    if (!parsed?.token || !parsed?.expiresAt || Date.parse(parsed.expiresAt) <= Date.now()) {
      sessionStorage.removeItem(LOCAL_FILE_SESSION_GRANT_KEY);
      return null;
    }
    parsed.scope = parsed.scope === 'write' ? 'write' : 'read';
    if (!grantSatisfiesScope(parsed, requiredScope)) return null;
    if (!grantCoversRequestedRoots(parsed, requestedRoots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hasActiveLocalFileSessionGrant(
  requestedRoots?: string[],
  requiredScope: 'read' | 'write' = 'read',
): boolean {
  return !!getActiveLocalFileSessionGrant(requestedRoots, requiredScope);
}

export function clearLocalFileSessionGrant(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LOCAL_FILE_SESSION_GRANT_KEY);
  } catch {}
}

function writeLocalFileSessionGrant(grant: LocalFileSessionGrant): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(LOCAL_FILE_SESSION_GRANT_KEY, JSON.stringify(grant));
  } catch {}
}

function localFileGrantHeaderFromGrant(grant: LocalFileSessionGrant): Record<string, string> {
  return { 'X-UC-File-Session-Token': grant.token };
}

function localFileGrantFailure<T>(
  result: DesktopResult<unknown>,
  fallback = 'Local file access could not be prepared.',
): DesktopResult<T> {
  return {
    ok: false,
    error: result.error || fallback,
    errorCode: result.errorCode || 'file_access_not_granted',
    recoveryHint: result.recoveryHint,
    requiredEvidence: result.requiredEvidence,
  };
}

async function ensureLocalFileGrantHeaders(
  requestedRoots?: string[],
  requiredScope: 'read' | 'write' = 'read',
  reason = 'OpenSwan local file session access',
): Promise<DesktopResult<Record<string, string>>> {
  const validatedRoots = validateExactLocalFileGrantRoots(requestedRoots);
  if (!validatedRoots.ok || !validatedRoots.data) {
    return localFileGrantFailure<Record<string, string>>(validatedRoots);
  }
  const roots = validatedRoots.data;
  const cached = getActiveLocalFileSessionGrant(roots, requiredScope);
  if (cached) return { ok: true, data: localFileGrantHeaderFromGrant(cached) };
  const granted = await requestLocalFileSessionGrant({ roots, scope: requiredScope, reason });
  if (!granted.ok || !granted.data) return localFileGrantFailure<Record<string, string>>(granted);
  return { ok: true, data: localFileGrantHeaderFromGrant(granted.data) };
}

export function inferLocalFileGrantRootsForTask(task: string): string[] {
  const normalized = String(task || '').toLowerCase();
  const roots = new Set<string>();
  if (/\b(?:google\s+drive|gdrive|my\s+drive)\b/.test(normalized)) {
    roots.add('~/Library/CloudStorage');
    roots.add('~/Google Drive');
    roots.add('~/My Drive');
    roots.add('~/Drive');
    if (/\b(?:open|launch|load|indesign|in\s*design|photoshop|illustrator)\b/.test(normalized)) {
      roots.add('~/Desktop');
    }
  }
  if (/\bdownloads?\b/.test(normalized)) roots.add('~/Downloads');
  if (/\bdocuments?\b/.test(normalized)) roots.add('~/Documents');
  if (/\bdesktop\b/.test(normalized)) roots.add('~/Desktop');
  if (/\bpictures?|photos?\b/.test(normalized)) roots.add('~/Pictures');
  if (/\bmovies?|videos?\b/.test(normalized)) roots.add('~/Movies');
  if (/\bmusic|audio\b/.test(normalized)) roots.add('~/Music');
  return Array.from(roots);
}

export async function requestLocalFileSessionGrant(request: LocalFileSessionGrantRequest = {}): Promise<DesktopResult<LocalFileSessionGrant>> {
  const validatedRoots = validateExactLocalFileGrantRoots(request.roots);
  if (!validatedRoots.ok || !validatedRoots.data) {
    return localFileGrantFailure<LocalFileSessionGrant>(validatedRoots);
  }
  const roots = validatedRoots.data;
  const scope = request.scope === 'write' ? 'write' : 'read';
  const cached = getActiveLocalFileSessionGrant(roots, scope);
  if (cached) return { ok: true, data: cached };
  const r = await callBridge('POST', '/desktop/file_grant', {
    roots,
    scope,
    ttlMs: typeof request.ttlMs === 'number' ? request.ttlMs : LOCAL_FILE_SESSION_TTL_MS,
    reason: request.reason || 'OpenSwan local file session access',
  });
  if (!r.ok) return r as DesktopResult<LocalFileSessionGrant>;
  const d = r.data as any;
  const grant: LocalFileSessionGrant = {
    token: String(d?.token || ''),
    roots: Array.isArray(d?.roots) ? d.roots.map(String) : roots,
    scope: d?.scope === 'write' ? 'write' : 'read',
    expiresAt: String(d?.expiresAt || new Date(Date.now() + LOCAL_FILE_SESSION_TTL_MS).toISOString()),
  };
  if (!grant.token) return { ok: false, error: 'bridge did not return a local file session token', errorCode: 'unknown' };
  if (scope === 'write' && grant.scope !== 'write') {
    return {
      ok: false,
      error: 'Running desktop bridge does not support write-scoped local file grants yet. Restart the bridge to enable local file changes.',
      errorCode: 'stale_bridge',
    };
  }
  writeLocalFileSessionGrant(grant);
  return { ok: true, data: grant };
}

export async function listFiles(rawPath: string): Promise<DesktopResult<{ path: string; entries: DesktopFileEntry[]; truncated: boolean }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'read', `List files in ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; entries: DesktopFileEntry[]; truncated: boolean }>(grantHeaders);
  const r = await callBridge('GET', `/desktop/file_list?path=${encodeURIComponent(v.path)}`, undefined, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; entries: DesktopFileEntry[]; truncated: boolean }>;
  const d = r.data as any;
  return { ok: true, data: { path: String(d?.path || v.path), entries: Array.isArray(d?.entries) ? d.entries : [], truncated: Boolean(d?.truncated) } };
}

export async function readFile(rawPath: string, maxBytes?: number): Promise<DesktopResult<{ path: string; content: string; modelContent: string; size: number; truncated: boolean }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'read', `Read local file ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; content: string; modelContent: string; size: number; truncated: boolean }>(grantHeaders);
  const params = new URLSearchParams({ path: v.path });
  if (typeof maxBytes === 'number') params.set('maxBytes', String(maxBytes));
  const r = await callBridge('GET', `/desktop/file_read?${params.toString()}`, undefined, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; content: string; modelContent: string; size: number; truncated: boolean }>;
  const d = r.data as any;
  const content = String(d?.content || '');
  // QW2: file contents are UNTRUSTED local data. Raw `content` is preserved
  // verbatim for file ops / user display (e.g. computerFileAdapter's read
  // result); `modelContent` is the sanitized copy for the model path
  // (invisible Tag-char smuggling stripped, auto-loading markdown defanged).
  return {
    ok: true,
    data: { path: String(d?.path || v.path), content, modelContent: sanitizeUntrustedForModel(content), size: Number(d?.size || 0), truncated: Boolean(d?.truncated) },
  };
}

/**
 * Binary-safe file read (base64 → bytes) for genuinely binary files (STL
 * meshes) that `readFile` refuses. Grant-gated read scope, bounded 8 MB.
 * Returns the raw bytes for a pure inspector to parse.
 */
export async function readFileBinary(rawPath: string, maxBytes?: number): Promise<DesktopResult<{ path: string; bytes: Uint8Array; size: number }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'read', `Read local binary file ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; bytes: Uint8Array; size: number }>(grantHeaders);
  const params = new URLSearchParams({ path: v.path });
  if (typeof maxBytes === 'number') params.set('maxBytes', String(maxBytes));
  const r = await callBridge('GET', `/desktop/file_read_binary?${params.toString()}`, undefined, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; bytes: Uint8Array; size: number }>;
  const d = r.data as any;
  const b64 = String(d?.base64 || '');
  let bytes: Uint8Array;
  try {
    bytes = typeof Buffer !== 'undefined'
      ? new Uint8Array(Buffer.from(b64, 'base64'))
      : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, error: 'could not decode binary file payload', errorCode: 'invalid_input' };
  }
  return { ok: true, data: { path: String(d?.path || v.path), bytes, size: Number(d?.size || bytes.length) } };
}

export type DesktopFileSearchMatch = {
  path: string;
  name: string;
  reason: 'name' | 'content';
  size: number;
  modifiedAt: string;
  snippet?: string;
};

export type DesktopFileSearchOptions = {
  maxResults?: number;
  maxFiles?: number;
  maxDepth?: number;
  includeContent?: boolean;
  extensions?: string[];
};

export async function searchFiles(rootPath: string, query: string, options: DesktopFileSearchOptions = {}): Promise<DesktopResult<{ rootPath: string; query: string; matches: DesktopFileSearchMatch[]; visited: number; searchedContent?: number; truncated: boolean }>> {
  const v = validateDesktopPath(rootPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const q = normalizeDesktopFileSearchQuery(query);
  if (!q || q.length > 120) return { ok: false, error: 'query is required and must be <= 120 chars', errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'read', `Search local files in ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ rootPath: string; query: string; matches: DesktopFileSearchMatch[]; visited: number; searchedContent?: number; truncated: boolean }>(grantHeaders);
  const params = new URLSearchParams({ rootPath: v.path, query: q });
  if (typeof options.maxResults === 'number') params.set('maxResults', String(options.maxResults));
  if (typeof options.maxFiles === 'number') params.set('maxFiles', String(options.maxFiles));
  if (typeof options.maxDepth === 'number') params.set('maxDepth', String(options.maxDepth));
  if (typeof options.includeContent === 'boolean') params.set('includeContent', String(options.includeContent));
  if (Array.isArray(options.extensions) && options.extensions.length > 0) params.set('extensions', options.extensions.join(','));
  const r = await callBridge('GET', `/desktop/file_search?${params.toString()}`, undefined, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ rootPath: string; query: string; matches: DesktopFileSearchMatch[]; visited: number; searchedContent?: number; truncated: boolean }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      rootPath: String(d?.rootPath || v.path),
      query: String(d?.query || q),
      matches: Array.isArray(d?.matches) ? d.matches : [],
      visited: Number(d?.visited || 0),
      searchedContent: Number(d?.searchedContent || 0),
      truncated: Boolean(d?.truncated),
    },
  };
}

export type DesktopFileStat = {
  path: string;
  exists: boolean;
  kind: 'file' | 'directory' | 'symlink' | 'other' | null;
  size: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
};

export async function statFile(rawPath: string): Promise<DesktopResult<DesktopFileStat>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'read', `Inspect local file ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<DesktopFileStat>(grantHeaders);
  const r = await callBridge('GET', `/desktop/file_stat?path=${encodeURIComponent(v.path)}`, undefined, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<DesktopFileStat>;
  const d = r.data as any;
  const kind = d?.kind === 'file' || d?.kind === 'directory' || d?.kind === 'symlink' || d?.kind === 'other'
    ? d.kind
    : null;
  return {
    ok: true,
    data: {
      path: String(d?.path || v.path),
      exists: Boolean(d?.exists),
      kind,
      size: typeof d?.size === 'number' ? d.size : null,
      modifiedAt: typeof d?.modifiedAt === 'string' ? d.modifiedAt : null,
      createdAt: typeof d?.createdAt === 'string' ? d.createdAt : null,
    },
  };
}

export async function renameFile(
  fromRawPath: string,
  toRawPath: string,
  options: { overwrite?: boolean } = {},
): Promise<DesktopResult<{ fromPath: string; toPath: string; kind: 'file' | 'directory' | 'other' }>> {
  const from = validateDesktopPath(fromRawPath);
  if (!from.ok) return { ok: false, error: from.error, errorCode: 'invalid_input' };
  const to = validateDesktopPath(toRawPath);
  if (!to.ok) return { ok: false, error: to.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([from.path, to.path], 'write', `Rename local file ${from.path} to ${to.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ fromPath: string; toPath: string; kind: 'file' | 'directory' | 'other' }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/file_rename', {
    fromPath: from.path,
    toPath: to.path,
    overwrite: Boolean(options.overwrite),
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ fromPath: string; toPath: string; kind: 'file' | 'directory' | 'other' }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      fromPath: String(d?.fromPath || from.path),
      toPath: String(d?.toPath || to.path),
      kind: d?.kind === 'directory' ? 'directory' : d?.kind === 'other' ? 'other' : 'file',
    },
  };
}

export async function writeTextFile(
  rawPath: string,
  content: string,
  options: { append?: boolean; overwrite?: boolean } = {},
): Promise<DesktopResult<{ path: string; kind: 'file'; bytes: number; size: number; append: boolean; overwrite: boolean }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  if (typeof content !== 'string') return { ok: false, error: 'content must be a string', errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'write', `Write local file ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; kind: 'file'; bytes: number; size: number; append: boolean; overwrite: boolean }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/file_write_text', {
    path: v.path,
    content,
    append: Boolean(options.append),
    overwrite: Boolean(options.overwrite),
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; kind: 'file'; bytes: number; size: number; append: boolean; overwrite: boolean }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      path: String(d?.path || v.path),
      kind: 'file',
      bytes: Number(d?.bytes || 0),
      size: Number(d?.size || 0),
      append: Boolean(d?.append),
      overwrite: Boolean(d?.overwrite),
    },
  };
}

export async function createDirectory(
  rawPath: string,
  options: { recursive?: boolean } = {},
): Promise<DesktopResult<{ path: string; kind: 'directory'; existed: boolean }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'write', `Create local directory ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; kind: 'directory'; existed: boolean }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/file_mkdir', {
    path: v.path,
    recursive: options.recursive !== false,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; kind: 'directory'; existed: boolean }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      path: String(d?.path || v.path),
      kind: 'directory',
      existed: Boolean(d?.existed),
    },
  };
}

export async function copyFile(
  fromRawPath: string,
  toRawPath: string,
  options: { overwrite?: boolean } = {},
): Promise<DesktopResult<{ fromPath: string; toPath: string; kind: 'file' | 'directory' }>> {
  const from = validateDesktopPath(fromRawPath);
  if (!from.ok) return { ok: false, error: from.error, errorCode: 'invalid_input' };
  const to = validateDesktopPath(toRawPath);
  if (!to.ok) return { ok: false, error: to.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([from.path, to.path], 'write', `Copy local file ${from.path} to ${to.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ fromPath: string; toPath: string; kind: 'file' | 'directory' }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/file_copy', {
    fromPath: from.path,
    toPath: to.path,
    overwrite: Boolean(options.overwrite),
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ fromPath: string; toPath: string; kind: 'file' | 'directory' }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      fromPath: String(d?.fromPath || from.path),
      toPath: String(d?.toPath || to.path),
      kind: d?.kind === 'directory' ? 'directory' : 'file',
    },
  };
}

export interface DesktopExecFileOutcome {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputOverflow: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
}

export function validateSupportedExecFileArgv(argv: string[]): DesktopResult<string[]> {
  if (!Array.isArray(argv) || argv.length < 1) {
    return { ok: false, error: 'argv is required.', errorCode: 'invalid_input' };
  }
  const binary = String(argv[0] || '').split(/[\\/]/).pop()?.toLowerCase() || '';
  const args = argv.slice(1);
  if (binary === 'node') {
    const supported = (args.length === 1 && (args[0] === '--version' || args[0] === '-v'))
      || (args.length === 2 && args[0] === '--check' && !args[1].startsWith('/') && /\.(?:c|m)?js$/i.test(args[1]));
    return supported
      ? { ok: true, data: argv }
      : { ok: false, error: 'node is limited to --version and --check <relative JavaScript file>.', errorCode: 'invalid_input' };
  }
  if (binary !== 'git') {
    return {
      ok: false,
      error: 'Local exec supports only read-only git diagnostics and node --check/--version. Delegate tests, builds, package scripts, and mutations to a connected coding agent with its normal approval flow.',
      errorCode: 'invalid_input',
    };
  }
  const command = args[0];
  const rest = args.slice(1);
  const allowed = command === 'status'
    ? rest.every((arg) => [
      '--short', '--branch', '--porcelain', '--porcelain=v1', '--porcelain=v2',
      '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all',
    ].includes(arg))
    : command === 'diff'
      ? rest.every((arg) => [
        '--check', '--stat', '--name-only', '--name-status', '--cached', '--staged',
        '--quiet', '--exit-code', '--no-color',
      ].includes(arg))
      : command === 'log'
        ? rest.every((arg) => [
          '--oneline', '--stat', '--name-only', '--no-color', '--decorate', '--no-decorate',
        ].includes(arg) || /^-[1-9]\d?$/.test(arg) || /^--max-count=[1-9]\d?$/.test(arg))
        : command === 'rev-parse'
          ? rest.length > 0 && rest.every((arg) => [
            '--show-toplevel', '--show-prefix', '--is-inside-work-tree', '--abbrev-ref', 'HEAD',
          ].includes(arg))
          : command === 'branch'
            ? rest.length === 1 && rest[0] === '--show-current'
            : command === 'ls-files'
              ? rest.every((arg) => [
                '--cached', '--modified', '--deleted', '--others', '--exclude-standard', '--stage',
              ].includes(arg))
              : false;
  return allowed
    ? { ok: true, data: argv }
    : { ok: false, error: 'Git invocation is outside the read-only diagnostic allowlist.', errorCode: 'invalid_input' };
}

/**
 * Fixed read-only diagnostic surface. The server independently validates the
 * same narrow git/node contract and runs fixed binaries without a shell.
 */
export async function execFileOnBridge(
  argv: string[],
  rawCwd: string,
  options: { timeoutMs?: number; reason?: string } = {},
): Promise<DesktopResult<DesktopExecFileOutcome>> {
  const invocation = validateSupportedExecFileArgv(argv);
  if (!invocation.ok) {
    return { ok: false, error: invocation.error, errorCode: invocation.errorCode };
  }
  const v = validateDesktopPath(rawCwd);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders(
    [v.path],
    'read',
    options.reason || `Run read-only ${String(argv?.[0] || 'diagnostic')} in ${v.path}`,
  );
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<DesktopExecFileOutcome>(grantHeaders);
  const r = await callBridge('POST', '/desktop/exec_file', {
    argv,
    cwd: v.path,
    timeoutMs: options.timeoutMs,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<DesktopExecFileOutcome>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      exitCode: typeof d?.exitCode === 'number' ? d.exitCode : null,
      signal: d?.signal ? String(d.signal) : null,
      timedOut: Boolean(d?.timedOut),
      outputOverflow: Boolean(d?.outputOverflow),
      durationMs: Number(d?.durationMs) || 0,
      stdout: String(d?.stdout || ''),
      stderr: String(d?.stderr || ''),
      truncatedStdout: Boolean(d?.truncatedStdout),
      truncatedStderr: Boolean(d?.truncatedStderr),
    },
  };
}

export async function trashFile(
  rawPath: string,
): Promise<DesktopResult<{ path: string; trashPath: string; kind: 'file' | 'directory' }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([v.path], 'write', `Move local file to Trash ${v.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<{ path: string; trashPath: string; kind: 'file' | 'directory' }>(grantHeaders);
  const r = await callBridge('POST', '/desktop/file_trash', { path: v.path }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<{ path: string; trashPath: string; kind: 'file' | 'directory' }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      path: String(d?.path || v.path),
      trashPath: String(d?.trashPath || ''),
      kind: d?.kind === 'directory' ? 'directory' : 'file',
    },
  };
}

export async function listShortcuts(): Promise<DesktopResult<string[]>> {
  const r = await callBridge('GET', '/desktop/shortcuts/list');
  if (!r.ok) return r as DesktopResult<string[]>;
  return { ok: true, data: Array.isArray((r.data as any)?.shortcuts) ? (r.data as any).shortcuts : [] };
}

export async function runShortcut(name: string): Promise<DesktopResult<{ name: string; output: string }>> {
  const clean = String(name || '').trim();
  if (!clean || clean.length > 120) return { ok: false, error: 'shortcut name is required and must be <= 120 chars', errorCode: 'invalid_input' };
  const r = await callBridge('POST', '/desktop/shortcuts/run', { name: clean });
  if (!r.ok) return r as DesktopResult<{ name: string; output: string }>;
  return { ok: true, data: { name: String((r.data as any)?.name || clean), output: String((r.data as any)?.output || '') } };
}

export async function manageWindow(args: {
  action: 'focus' | 'raise' | 'minimize' | 'unminimize' | 'zoom' | 'resize';
  appName?: string;
  width?: number;
  height?: number;
}): Promise<DesktopResult<{ action: string; appName: string | null; width: number | null; height: number | null }>> {
  const r = await callBridge('POST', '/desktop/window_manage', args as Record<string, unknown>);
  if (!r.ok) return r as DesktopResult<{ action: string; appName: string | null; width: number | null; height: number | null }>;
  const d = r.data as any;
  return { ok: true, data: { action: String(d?.action || args.action), appName: d?.appName || null, width: d?.width ?? null, height: d?.height ?? null } };
}

export interface DesktopNativeUiTargetWindow {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Transient exact native target authority; never persist or expose to a model. */
export interface DesktopNativeUiTargetGuard {
  appName: string;
  pid: number;
  window: DesktopNativeUiTargetWindow;
}

function normalizeDesktopNativeUiTargetGuard(
  value: DesktopNativeUiTargetGuard | undefined,
): DesktopNativeUiTargetGuard | null {
  const appName = String(value?.appName || '').trim();
  const window = value?.window;
  if (
    !isValidAppName(appName)
    || !Number.isSafeInteger(value?.pid)
    || Number(value?.pid) <= 0
    || !window
    || !Number.isSafeInteger(window.id)
    || window.id <= 0
    || !Number.isSafeInteger(window.x)
    || !Number.isSafeInteger(window.y)
    || !Number.isSafeInteger(window.width)
    || !Number.isSafeInteger(window.height)
    || window.x < -32_768
    || window.y < -32_768
    || window.x > 32_768
    || window.y > 32_768
    || window.width < 1
    || window.height < 1
    || window.width > 32_768
    || window.height > 32_768
  ) {
    return null;
  }
  return {
    appName,
    pid: Number(value?.pid),
    window: { ...window },
  };
}

function guardedDesktopMutationBody(
  targetGuard: DesktopNativeUiTargetGuard | undefined,
): { ok: true; targetGuard: DesktopNativeUiTargetGuard } | {
  ok: false;
  result: DesktopResult<never>;
} {
  const normalized = normalizeDesktopNativeUiTargetGuard(targetGuard);
  return normalized
    ? { ok: true, targetGuard: normalized }
    : {
        ok: false,
        result: {
          ok: false,
          error: 'Exact frontmost app/PID/CGWindow/bounds target guard is required.',
          errorCode: 'uncertain_ui_target',
        },
      };
}

export async function mouseMove(
  x: number,
  y: number,
  targetGuard?: DesktopNativeUiTargetGuard,
): Promise<DesktopResult<{ x: number; y: number }>> {
  const v = validateClickCoords(x, y);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const guarded = guardedDesktopMutationBody(targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_move', {
    x: v.x,
    y: v.y,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number }>;
  const d = r.data as any;
  return { ok: true, data: { x: Number(d?.x ?? v.x), y: Number(d?.y ?? v.y) } };
}

export async function mouseClick(args: {
  x: number;
  y: number;
  button?: 'left' | 'right';
  count?: number;
  targetGuard?: DesktopNativeUiTargetGuard;
}): Promise<DesktopResult<{ x: number; y: number; button: string; count: number }>> {
  const v = validateClickCoords(args.x, args.y);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const button = args.button === 'right' ? 'right' : 'left';
  const count = Math.max(1, Math.min(3, Math.trunc(Number(args.count || 1))));
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_click', {
    x: v.x,
    y: v.y,
    button,
    count,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number; button: string; count: number }>;
  const d = r.data as any;
  return { ok: true, data: { x: Number(d?.x ?? v.x), y: Number(d?.y ?? v.y), button: String(d?.button || button), count: Number(d?.count || count) } };
}

export async function mouseDown(args: {
  x: number;
  y: number;
  button?: 'left' | 'right';
  targetGuard?: DesktopNativeUiTargetGuard;
}): Promise<DesktopResult<{ x: number; y: number; button: string }>> {
  const v = validateClickCoords(args.x, args.y);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const button = args.button === 'right' ? 'right' : 'left';
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_down', {
    x: v.x,
    y: v.y,
    button,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number; button: string }>;
  const d = r.data as any;
  return { ok: true, data: { x: Number(d?.x ?? v.x), y: Number(d?.y ?? v.y), button: String(d?.button || button) } };
}

export async function mouseUp(args: {
  /** OPTIONAL on purpose: the bridge skips coordinate validation for mouse_up
   *  when x/y are absent (`if (isDown || xRaw !== undefined || yRaw !== undefined)`
   *  in claude-bridge.js), releasing wherever the pointer already is. Typing
   *  these as required contradicted the server and forced callers to pass
   *  `number | undefined` into a `number` slot. `mouseDown` is different — the
   *  server always requires coords there, so it stays required. */
  x?: number;
  y?: number;
  button?: 'left' | 'right';
  targetGuard?: DesktopNativeUiTargetGuard;
} = {}): Promise<DesktopResult<{ x: number; y: number; button: string }>> {
  // Coord-less release ("let go wherever the pointer is") is a real, supported
  // operation: the bridge only validates x/y for mouse_up when they are present,
  // and `SwanBotDesktopClientToolBridge` declares this method's whole argument
  // object as optional. The client used to validate unconditionally, so that
  // path always failed with invalid_input and the capability never worked.
  // Coordinates, when supplied, are still validated exactly as before.
  const wantsPoint = args.x !== undefined || args.y !== undefined;
  let point: { ok: true; x: number; y: number } | { ok: false; error: string } | null = null;
  if (wantsPoint) {
    const validated = validateClickCoords(args.x, args.y);
    if (!validated.ok) return { ok: false, error: validated.error, errorCode: 'invalid_input' };
    point = validated;
  }
  const button = args.button === 'right' ? 'right' : 'left';
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_up', {
    // Omit x/y entirely when absent so the bridge takes its coord-less path
    // rather than coercing `undefined` into a coordinate.
    ...(point && point.ok ? { x: point.x, y: point.y } : {}),
    button,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number; button: string }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      // The bridge echoes the coordinates it actually released at, which is the
      // only source of truth for a coord-less release. Fall back to the
      // requested point when one was supplied; otherwise report 0 rather than
      // NaN, and let the caller read the echoed values.
      x: Number(d?.x ?? (point && point.ok ? point.x : 0)),
      y: Number(d?.y ?? (point && point.ok ? point.y : 0)),
      button: String(d?.button || button),
    },
  };
}

export async function mouseDrag(args: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs?: number;
  targetGuard?: DesktopNativeUiTargetGuard;
}): Promise<DesktopResult<{ fromX: number; fromY: number; toX: number; toY: number; durationMs: number }>> {
  const start = validateClickCoords(args.fromX, args.fromY);
  if (!start.ok) return { ok: false, error: start.error, errorCode: 'invalid_input' };
  const end = validateClickCoords(args.toX, args.toY);
  if (!end.ok) return { ok: false, error: end.error, errorCode: 'invalid_input' };
  const durationMs = Math.max(50, Math.min(5000, Math.trunc(Number(args.durationMs || 450))));
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_drag', {
    fromX: start.x,
    fromY: start.y,
    toX: end.x,
    toY: end.y,
    durationMs,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ fromX: number; fromY: number; toX: number; toY: number; durationMs: number }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      fromX: Number(d?.fromX ?? start.x),
      fromY: Number(d?.fromY ?? start.y),
      toX: Number(d?.toX ?? end.x),
      toY: Number(d?.toY ?? end.y),
      durationMs: Number(d?.durationMs || durationMs),
    },
  };
}

export async function mouseScroll(args: {
  deltaY?: number;
  deltaX?: number;
  x: number;
  y: number;
  targetGuard?: DesktopNativeUiTargetGuard;
}): Promise<DesktopResult<{ x: number; y: number; deltaX: number; deltaY: number }>> {
  const point = validateClickCoords(args.x, args.y);
  if (!point.ok) return { ok: false, error: point.error, errorCode: 'invalid_input' };
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/mouse_scroll', {
    deltaY: args.deltaY,
    deltaX: args.deltaX,
    x: point.x,
    y: point.y,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number; deltaX: number; deltaY: number }>;
  const d = r.data as any;
  return { ok: true, data: { x: Number(d?.x || 0), y: Number(d?.y || 0), deltaX: Number(d?.deltaX || 0), deltaY: Number(d?.deltaY || 0) } };
}

export interface DesktopAppActivationDispatchData {
  appName: string;
  requestedAppName: string;
  resolvedAppName: string;
}

function parseDesktopAppActivationDispatch(
  data: unknown,
  requestedAppName: string,
): DesktopAppActivationDispatchData {
  const d = data as any;
  const resolvedAppName = String(d?.resolvedAppName || d?.appName || requestedAppName)
    .trim()
    .slice(0, 120);
  return {
    appName: String(d?.appName || resolvedAppName).trim().slice(0, 120),
    requestedAppName: String(d?.requestedAppName || requestedAppName).trim().slice(0, 120),
    resolvedAppName,
  };
}

export async function launchApp(appName: string): Promise<DesktopResult<DesktopAppActivationDispatchData>> {
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName (letters/numbers/space/.-_() only)', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/launch', { appName });
  if (!r.ok) return r as DesktopResult<DesktopAppActivationDispatchData>;
  return { ok: true, data: parseDesktopAppActivationDispatch(r.data, appName) };
}

export async function focusApp(appName: string): Promise<DesktopResult<DesktopAppActivationDispatchData>> {
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/focus', { appName });
  if (!r.ok) return r as DesktopResult<DesktopAppActivationDispatchData>;
  return { ok: true, data: parseDesktopAppActivationDispatch(r.data, appName) };
}

export async function typeText(
  text: string,
  targetGuard?: DesktopNativeUiTargetGuard,
): Promise<DesktopResult<{ chars: number }>> {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'text must be a non-empty string', errorCode: 'invalid_input' };
  }
  if (text.length > 4000) {
    return { ok: false, error: 'text too long (max 4000 chars per call)', errorCode: 'invalid_input' };
  }
  const guarded = guardedDesktopMutationBody(targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/type', {
    text,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ chars: number }>;
  return { ok: true, data: { chars: (r.data as any)?.chars ?? text.length } };
}

export async function pasteText(
  text: string,
  options: {
    appName?: string;
    restoreClipboard?: boolean;
    focusMode?: 'require' | 'best_effort' | 'skip';
    targetGuard?: DesktopNativeUiTargetGuard;
  } = {},
): Promise<DesktopResult<{ chars: number; appName: string | null; restoredClipboard: boolean; focusWarning?: string | null }>> {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'text must be a non-empty string', errorCode: 'invalid_input' };
  }
  if (text.length > 20_000) {
    return { ok: false, error: 'text too long (max 20000 chars per paste)', errorCode: 'invalid_input' };
  }
  const appName = String(options.appName || '').trim();
  if (appName && !isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  const focusMode = options.focusMode || 'skip';
  if (!['require', 'best_effort', 'skip'].includes(focusMode)) {
    return { ok: false, error: 'Invalid paste focusMode', errorCode: 'invalid_input' };
  }
  const guarded = guardedDesktopMutationBody(options.targetGuard);
  if (!guarded.ok) return guarded.result;
  if (appName && appName !== guarded.targetGuard.appName) {
    return {
      ok: false,
      error: 'Paste appName must exactly match the sealed native target guard.',
      errorCode: 'uncertain_ui_target',
    };
  }
  const body: Record<string, unknown> = {
    text,
    restoreClipboard: options.restoreClipboard !== false,
    // A guarded paste never activates or guesses a process. The bridge checks
    // and pastes within one exact System Events handler operation.
    focusMode: 'skip',
    appName: guarded.targetGuard.appName,
    targetGuard: guarded.targetGuard,
  };
  const r = await callBridge('POST', '/desktop/paste_text', body);
  if (!r.ok) return r as DesktopResult<{ chars: number; appName: string | null; restoredClipboard: boolean; focusWarning?: string | null }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      chars: Number(d?.chars ?? text.length),
      appName: d?.appName ? String(d.appName) : null,
      restoredClipboard: Boolean(d?.restoredClipboard),
      focusWarning: d?.focusWarning ? String(d.focusWarning) : null,
    },
  };
}

/** Phase 1c — waits until `appName` shows up in the running-app list.
 *  Replaces the old `sleep(1200)` race in auto-chain — we start typing
 *  only after the app has rendered its first window. */
export async function waitForApp(
  appName: string,
  timeoutMs?: number,
): Promise<DesktopResult<{ appName: string; elapsedMs: number }>> {
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  const body: Record<string, unknown> = { appName };
  if (typeof timeoutMs === 'number') body.timeoutMs = timeoutMs;
  const r = await callBridge('POST', '/desktop/wait_for_app', body);
  if (!r.ok) return r as DesktopResult<{ appName: string; elapsedMs: number }>;
  // Bridge returns `{ ok: false, error: 'timeout', appName, waitedMs }`
  // as a 200 — callBridge normalised it. We re-project onto the
  // typed shape with the elapsedMs it gave us.
  const d = r.data as any;
  return { ok: true, data: { appName: d?.appName || appName, elapsedMs: Number(d?.elapsedMs ?? 0) } };
}

/** Phase 1c — full-screen screenshot as a base64 PNG data URL. Lets
 *  the agent verify what happened after a destructive tool call.
 *  E3 — pass `region: [x1, y1, x2, y2]` to crop the capture
 *  (`screencapture -R`): re-observe a SMALL target at full resolution
 *  (zoom) before a coordinate click instead of squinting at a scaled
 *  full-screen frame. Bounds are validated against the screen size. */
export async function takeScreenshot(args: {
  region?: [number, number, number, number];
} = {}): Promise<DesktopResult<{ base64: string; mimeType: string; sizeBytes: number; dataUrl: string; region?: [number, number, number, number] }>> {
  type ScreenshotData = { base64: string; mimeType: string; sizeBytes: number; dataUrl: string; region?: [number, number, number, number] };
  let path = '/desktop/screenshot';
  if (args.region) {
    const region = args.region;
    const valid = Array.isArray(region)
      && region.length === 4
      && region.every((value) => Number.isInteger(value) && value >= 0)
      && region[2] > region[0]
      && region[3] > region[1];
    if (!valid) {
      return { ok: false, error: 'region must be [x1, y1, x2, y2] with non-negative integers, x2 > x1, y2 > y1', errorCode: 'invalid_input' };
    }
    path += `?region=${region.join(',')}`;
  }
  const r = await callBridge('GET', path);
  if (!r.ok) return r as DesktopResult<ScreenshotData>;
  const d = r.data as any;
  const base64 = String(d?.base64 || '');
  const mimeType = String(d?.mimeType || 'image/png');
  const sizeBytes = Number(d?.sizeBytes ?? 0);
  if (!base64) {
    return { ok: false, error: 'bridge returned empty screenshot payload', errorCode: 'unknown' };
  }
  const regionEcho = Array.isArray(d?.region) && d.region.length === 4
    ? (d.region.map((value: unknown) => Number(value)) as [number, number, number, number])
    : undefined;
  return {
    ok: true,
    data: { base64, mimeType, sizeBytes, dataUrl: `data:${mimeType};base64,${base64}`, ...(regionEcho ? { region: regionEcho } : {}) },
  };
}

/** Phase 1d — opens a URL in the user's default browser via `open`.
 *  Validated client-side + server-side; accepts http / https / file /
 *  mailto schemes. */
export async function openUrl(rawUrl: string): Promise<DesktopResult<{ url: string; scheme: string }>> {
  const v = validateDesktopUrl(rawUrl);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const r = await callBridge('POST', '/desktop/open_url', { url: v.url });
  if (!r.ok) return r as DesktopResult<{ url: string; scheme: string }>;
  const d = r.data as any;
  return { ok: true, data: { url: d?.url || v.url, scheme: d?.scheme || v.scheme } };
}

/** Phase 1d — `open <path>` in the default app. Path must not contain
 *  shell metacharacters. */
export async function openPath(rawPath: string, options: { appName?: string } = {}): Promise<DesktopResult<{ path: string; appName: string | null }>> {
  const v = validateDesktopPath(rawPath);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const appName = String(options.appName || '').trim();
  if (appName && !isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/open_path', {
    path: v.path,
    appName: appName || undefined,
  });
  if (!r.ok) {
    // Surface `path_not_found` as a typed errorCode so callers can
    // choose a better fallback than a generic HTTP 400.
    if (String(r.error || '').includes('path_not_found')) {
      return { ok: false, error: 'File or folder does not exist at that path.', errorCode: 'path_not_found' };
    }
    return r as DesktopResult<{ path: string; appName: string | null }>;
  }
  return {
    ok: true,
    data: {
      path: (r.data as any)?.path || v.path,
      appName: (r.data as any)?.appName ? String((r.data as any).appName) : (appName || null),
    },
  };
}

export async function stageAttachmentForDesktop(args: {
  filename: string;
  mimeType?: string | null;
  sourceUrl?: string | null;
  base64?: string | null;
  groupId?: string | null;
}): Promise<DesktopResult<{ path: string; filename: string; sizeBytes: number; directory?: string; sha256?: string }>> {
  const filename = String(args.filename || '').trim();
  if (!filename) return { ok: false, error: 'filename is required', errorCode: 'invalid_input' };
  if (!args.sourceUrl && !args.base64) {
    return { ok: false, error: 'sourceUrl or base64 is required', errorCode: 'invalid_input' };
  }
  if (args.sourceUrl) {
    const v = validateDesktopUrl(args.sourceUrl);
    if (!v.ok || (v.scheme !== 'http' && v.scheme !== 'https')) {
      return { ok: false, error: v.ok ? 'sourceUrl must be http or https' : v.error, errorCode: 'invalid_input' };
    }
  }
  const r = await callBridge('POST', '/desktop/stage_attachment', {
    filename,
    mimeType: args.mimeType || 'application/octet-stream',
    sourceUrl: args.sourceUrl || undefined,
    base64: args.base64 || undefined,
    groupId: args.groupId || undefined,
  });
  if (!r.ok) return r as DesktopResult<{ path: string; filename: string; sizeBytes: number; directory?: string; sha256?: string }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      path: String(d?.path || ''),
      filename: String(d?.filename || filename),
      sizeBytes: Number(d?.sizeBytes || 0),
      directory: d?.directory ? String(d.directory) : undefined,
      sha256: d?.sha256 ? String(d.sha256) : undefined,
    },
  };
}

export async function stageAttachmentManifestForDesktop(args: {
  groupId: string;
  manifest: unknown;
}): Promise<DesktopResult<{ path: string; directory: string; sizeBytes: number; sha256?: string }>> {
  const groupId = String(args.groupId || '').trim();
  if (!groupId) return { ok: false, error: 'groupId is required', errorCode: 'invalid_input' };
  const r = await callBridge('POST', '/desktop/stage_attachment_manifest', {
    groupId,
    manifest: args.manifest,
  });
  if (!r.ok) return r as DesktopResult<{ path: string; directory: string; sizeBytes: number; sha256?: string }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      path: String(d?.path || ''),
      directory: String(d?.directory || ''),
      sizeBytes: Number(d?.sizeBytes || 0),
      sha256: d?.sha256 ? String(d.sha256) : undefined,
    },
  };
}

/** Phase 1d — mouse click at absolute screen coords. Uses cliclick when
 *  installed (accurate), falls back to AppleScript otherwise (best-
 *  effort). The health response's `optional.cliclick` flag tells clients
 *  whether to try at all. */
export async function clickAt(
  x: number,
  y: number,
  targetGuard?: DesktopNativeUiTargetGuard,
): Promise<DesktopResult<{ x: number; y: number; via: string }>> {
  const v = validateClickCoords(x, y);
  if (!v.ok) return { ok: false, error: v.error, errorCode: 'invalid_input' };
  const guarded = guardedDesktopMutationBody(targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/click_at', {
    x: v.x,
    y: v.y,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ x: number; y: number; via: string }>;
  const d = r.data as any;
  return { ok: true, data: { x: d?.x ?? v.x, y: d?.y ?? v.y, via: d?.via || 'unknown' } };
}

/** Phase 1d — returns the primary screen resolution so callers can
 *  bound click coordinates before sending them. */
export async function getScreenSize(): Promise<DesktopResult<{ width: number; height: number }>> {
  const r = await callBridge('GET', '/desktop/screen_size');
  if (!r.ok) return r as DesktopResult<{ width: number; height: number }>;
  const d = r.data as any;
  return { ok: true, data: { width: Number(d?.width || 0), height: Number(d?.height || 0) } };
}

// ─── UC-1: accessibility tree ────────────────────────────────────────────
//
// A11y-tree-grounded automation is ~75% cheaper per step than
// screenshot-grounded because a pruned tree fits in ~400 tokens vs
// ~1,500 for an XGA screenshot, and selectors ("role=button
// label='Send'") survive window resizes / theme changes / retina mixes
// that break pixel coordinates. Backed by the Swift helper at
// scripts/bin/uc-ax-helper which walks AXUIElement.

export interface A11yNode {
  id: string;                     // dotted path from root, e.g. "0.2.1"
  role: string;                   // AX role, e.g. "AXButton"
  label?: string;                 // title / description / identifier
  value?: string;                 // state (text-field contents etc.)
  bbox?: [number, number, number, number]; // [x, y, w, h] in screen coords
  /** E2 — SoM-style stable node index ([#1], [#2], …) assigned by the
   *  bridge per tree read. clickElement/setElementValue accept
   *  `elementIndex` resolved against the LAST tree read for the pid. */
  index?: number;
  children?: A11yNode[];
}

export interface A11yTreeResult {
  app: string;                    // frontmost app name or requested appName
  pid: number;                    // used for click_element path resolution
  budget_used: number;            // nodes walked before the maxNodes cap
  tree: A11yNode;
  /** E2 — 'interactive' when the bridge returned a pruned targeting slice. */
  slice?: 'interactive' | 'full';
  /** E2 — the target string the slice was pruned around (sliced reads only). */
  target?: string | null;
  /** E2 — node counts before/after pruning (sliced reads only). */
  totalNodes?: number;
  slicedNodes?: number;
  /** E2 — bridge-built slice marker, e.g. `[slice: 38 of 412 nodes — …]`.
   *  Safe to surface OUTSIDE an untrusted-content fence. */
  sliceMarker?: string | null;
  /** E2 — generation of the bridge's index→path map for this read. */
  indexGeneration?: number;
}

/**
 * Read the accessibility tree for a named app (or the frontmost app
 * when `appName` is omitted). The returned tree is pruned: layout
 * scaffolding without labels is elided, deeply-nested unaddressable
 * leaves are dropped, and a node budget keeps the payload under ~400
 * tokens for typical app windows.
 *
 * Returns `helper_missing` when the Swift helper binary isn't compiled
 * yet — callers should fall back to the vision path.
 */
/** One retry, then fail closed with the screenshot fallback hint. */
const A11Y_EMPTY_TREE_RETRY_DELAY_MS = 800;

/**
 * True when an a11y payload is effectively empty: no tree at all, or
 * a bare root with no children and no label/value. Apps frequently
 * report this transiently right after launch or a focus change while
 * their AX server is still wiring up — which is why the read path
 * retries once before declaring the tree empty.
 */
export function isEmptyA11yTreePayload(payload: unknown): boolean {
  const tree = (payload as { tree?: A11yNode } | null | undefined)?.tree;
  if (!tree) return true;
  const hasChildren = Array.isArray(tree.children) && tree.children.length > 0;
  const hasContent = !!(tree.label || tree.value);
  return !hasChildren && !hasContent;
}

/** E2 — last index-map generation per pid (from the bridge's tree read).
 *  Passed alongside `elementIndex` so the bridge can detect that the tree
 *  was re-read since the index was issued (`index_stale`). */
const lastA11yIndexGenerationByPid = new Map<number, number>();

/** Record the bridge's index-map generation for a pid (bounded map) —
 *  shared by readA11yTree and observeApp so `elementIndex` actions after
 *  EITHER read style can detect staleness. */
function recordA11yIndexGeneration(pid: number, indexGeneration: number | undefined): void {
  if (!(pid > 0) || !indexGeneration) return;
  lastA11yIndexGenerationByPid.set(pid, indexGeneration);
  // Bounded: this map only needs the handful of apps in a session.
  if (lastA11yIndexGenerationByPid.size > 16) {
    const firstKey = lastA11yIndexGenerationByPid.keys().next().value;
    if (typeof firstKey === 'number') lastA11yIndexGenerationByPid.delete(firstKey);
  }
}

export async function readA11yTree(args: {
  appName?: string;
  maxDepth?: number;
  maxNodes?: number;
  /** E2 — label/value the caller wants to act on. When set, the bridge
   *  defaults to a pruned 'interactive' targeting slice (matches +
   *  ancestors + ±2 siblings + actionable roles, capped ~120 nodes). */
  target?: string;
  /** E2 — 'interactive' forces a pruned slice; 'full' forces the legacy
   *  full tree. Default: 'interactive' when `target` is set, else 'full'. */
  slice?: 'interactive' | 'full';
} = {}): Promise<DesktopResult<A11yTreeResult>> {
  const params = new URLSearchParams();
  if (args.appName) params.set('app', args.appName);
  if (typeof args.maxDepth === 'number') params.set('max_depth', String(args.maxDepth));
  if (typeof args.maxNodes === 'number') params.set('max_nodes', String(args.maxNodes));
  if (args.target && args.target.trim()) params.set('target', args.target.trim().slice(0, 200));
  if (args.slice === 'interactive' || args.slice === 'full') params.set('slice', args.slice);
  const qs = params.toString();
  const pathWithQuery = `/desktop/a11y_tree${qs ? `?${qs}` : ''}`;

  let d: any = null;
  // Empty/stale-tree retry ladder (LOCAL, bounded): one retry after a
  // short backoff — apps often need a beat after focus changes before
  // their AX tree populates. No further escalation here; failure-time
  // recovery stays owned by the existing last-resort surface.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, A11Y_EMPTY_TREE_RETRY_DELAY_MS));
    }
    const r = await callBridge('GET', pathWithQuery);
    if (!r.ok) {
      // The bridge returns 503 when the helper binary isn't compiled
      // yet. Normalise that into a specific error code so callers can
      // fall back to screenshot grounding without guessing from text.
      const looksMissing = /not compiled|xcode-select/i.test(r.error || '');
      return {
        ok: false,
        error: r.error || 'a11y tree unavailable',
        errorCode: looksMissing ? 'helper_missing' : (r.errorCode || 'unknown'),
      } as DesktopResult<A11yTreeResult>;
    }
    d = r.data as any;
    if (!isEmptyA11yTreePayload(d)) break;
    d = null;
  }
  if (!d) {
    return {
      ok: false,
      error: `a11y_tree_empty: the accessibility tree for ${args.appName || 'the frontmost app'} came back empty twice (retried once after ${A11Y_EMPTY_TREE_RETRY_DELAY_MS}ms).`,
      errorCode: 'a11y_tree_empty',
      recoveryHint: 'The a11y path returned nothing for this app. Use the screenshot + coordinate path as the fallback: take a desktop screenshot, locate the target visually, then click at its coordinates.',
    };
  }
  const pid = Number(d.pid || 0);
  const indexGeneration = Number(d.index_generation || 0) || undefined;
  recordA11yIndexGeneration(pid, indexGeneration);
  return {
    ok: true,
    data: {
      app: String(d.app || args.appName || ''),
      pid,
      budget_used: Number(d.budget_used || 0),
      tree: d.tree as A11yNode,
      ...(d.slice === 'interactive' ? {
        slice: 'interactive' as const,
        target: typeof d.target === 'string' ? d.target : null,
        totalNodes: Number(d.total_nodes || 0) || undefined,
        slicedNodes: Number(d.sliced_nodes || 0) || undefined,
        sliceMarker: typeof d.slice_marker === 'string' ? d.slice_marker : null,
      } : {}),
      ...(indexGeneration ? { indexGeneration } : {}),
    },
  };
}

// ─── One-round-trip app observation ──────────────────────────────────────

export interface ObserveAppData {
  /** Exact requested name echoed by the paired bridge, or null for frontmost. */
  requestedAppName: string | null;
  /** Immutable installed/process name resolved before the observation. */
  resolvedAppName: string;
  /** Native process id. Positive whenever appRunning is true. */
  pid: number;
  /** Bridge identity contract version. */
  processIdentityVersion: 1;
  /** Resolved app/process name (resolved name even when not running). */
  app: string;
  appRunning: boolean;
  /** True when the target app is the frontmost application. */
  frontmost: boolean;
  frontmostApp: string | null;
  windowCount: number;
  /** ≤8 titles, each ≤160 chars. UNTRUSTED app-controlled text — fence
   *  before rendering into model-visible output. */
  windowTitles: string[];
  /**
   * Exact topmost visible normal CGWindow for the focused process. Missing
   * means the bridge could not prove a concrete target window; generic native
   * mutations must fail closed.
   */
  targetWindow?: DesktopNativeUiTargetWindow;
  /** Same pruned/SoM-indexed node shape as readA11yTree; null when the
   *  app is not running or the tree read degraded (helper missing / AX
   *  trust) — the window-state half still lands. */
  tree: A11yNode | null;
  budget_used: number;
  /** E2 slice marker when the bridge returned a pruned targeting slice
   *  (present only on sliced reads; null when the bridge had no marker). */
  sliceMarker?: string | null;
  /** SoM/a11y index generation when a tree was captured for this process. */
  indexGeneration?: number;
}

/**
 * Examine an app's screen in ONE bridge round trip (`/desktop/observe_app`):
 * running check + frontmost + window count/titles + the same pruned,
 * SoM-indexed a11y tree `readA11yTree` returns — instead of three calls
 * (running-apps, window_state, a11y_tree). `appName` empty → frontmost
 * app. A non-running app is a SUCCESSFUL observation
 * (`{ appRunning: false, tree: null }`), not an error. Feed the result
 * (plus a `snapshotA11ySummary` of `tree`) to `buildAppScreenNextStep`
 * in src/lib/appScreenNextStep.ts to decide launch/focus/dialog/
 * screenshot next steps deterministically.
 */
export async function observeApp(args: {
  appName?: string;
  maxDepth?: number;
  maxNodes?: number;
  /** E2 — label/value the caller wants to act on; triggers the bridge's
   *  pruned 'interactive' targeting slice, same as readA11yTree. */
  target?: string;
} = {}): Promise<DesktopResult<ObserveAppData>> {
  const body: Record<string, unknown> = {};
  const appName = typeof args.appName === 'string' ? args.appName.trim().slice(0, 120) : '';
  if (appName) body.appName = appName;
  if (typeof args.maxDepth === 'number') body.maxDepth = args.maxDepth;
  if (typeof args.maxNodes === 'number') body.maxNodes = args.maxNodes;
  if (args.target && args.target.trim()) body.target = args.target.trim().slice(0, 200);
  const r = await callBridge('POST', '/desktop/observe_app', body);
  if (!r.ok) return r as DesktopResult<ObserveAppData>;
  const d = r.data as any;
  const requestedAppName = String(d?.requestedAppName || appName || '').trim().slice(0, 120);
  const resolvedAppName = String(d?.resolvedAppName || d?.app || appName || '').trim().slice(0, 120);
  const pid = Math.max(0, Math.trunc(Number(d?.pid || 0)));
  if (appName && requestedAppName.toLowerCase() !== appName.toLowerCase()) {
    return {
      ok: false,
      error: 'The desktop bridge returned a different requested app identity.',
      errorCode: 'uncertain_ui_target',
    };
  }
  if (!resolvedAppName) {
    return {
      ok: false,
      error: 'The desktop bridge did not return a resolved app identity.',
      errorCode: 'stale_bridge',
      recoveryHint: 'Restart the local desktop bridge, then observe the exact app again.',
    };
  }
  if (d?.appRunning === true && pid <= 0) {
    return {
      ok: false,
      error: 'The desktop bridge reported a running app without a positive process identity.',
      errorCode: 'stale_bridge',
      recoveryHint: 'Restart the local desktop bridge, then observe the exact app again.',
    };
  }
  // Mirror readA11yTree: remember the bridge's index-map generation so
  // clickElement/setElementValue `elementIndex` calls made after an
  // observe read can detect `index_stale`.
  const indexGeneration = Number(d?.index_generation || 0) || undefined;
  recordA11yIndexGeneration(pid, indexGeneration);
  const rawTargetWindow = d?.targetWindow;
  const targetWindow = (
    rawTargetWindow
    && Number.isSafeInteger(Number(rawTargetWindow.id))
    && Number(rawTargetWindow.id) > 0
    && [rawTargetWindow.x, rawTargetWindow.y, rawTargetWindow.width, rawTargetWindow.height]
      .every((value) => Number.isSafeInteger(Number(value)))
    && Number(rawTargetWindow.width) > 0
    && Number(rawTargetWindow.height) > 0
  )
    ? {
        id: Number(rawTargetWindow.id),
        x: Number(rawTargetWindow.x),
        y: Number(rawTargetWindow.y),
        width: Number(rawTargetWindow.width),
        height: Number(rawTargetWindow.height),
      }
    : null;
  return {
    ok: true,
    data: {
      requestedAppName: requestedAppName || null,
      resolvedAppName,
      pid,
      processIdentityVersion: 1,
      app: String(d?.app || resolvedAppName),
      appRunning: d?.appRunning === true,
      frontmost: d?.frontmost === true,
      frontmostApp: d?.frontmostApp ? String(d.frontmostApp).slice(0, 160) : null,
      windowCount: Math.max(0, Number(d?.windowCount || 0)),
      windowTitles: Array.isArray(d?.windowTitles)
        ? d.windowTitles
            .slice(0, 8)
            .map((title: unknown) => String(title ?? '').slice(0, 160))
            .filter(Boolean)
        : [],
      ...(targetWindow ? { targetWindow } : {}),
      tree: d?.tree && typeof d.tree === 'object' ? (d.tree as A11yNode) : null,
      budget_used: Number(d?.budget_used || 0),
      ...(d?.slice === 'interactive'
        ? { sliceMarker: typeof d.slice_marker === 'string' ? d.slice_marker : null }
        : {}),
      ...(indexGeneration ? { indexGeneration } : {}),
    },
  };
}

// ─── Guarded exact native semantic action canary ────────────────────────

export type NativeSemanticAction = 'press';

export interface NativeSemanticActionTarget {
  schemaVersion: 1;
  action: NativeSemanticAction;
  /** Short-lived one-shot bearer capability. Never persist or render it. */
  targetId: string;
  targetFingerprint: string;
  evidenceId: string;
  observedAt: string;
  expiresAt: string;
  app: string;
  resolvedAppName: string;
  pid: number;
  /** Exact dotted AX path from the fresh observation. Approval-time only. */
  targetPath: string;
  targetRole: string;
  /** Bounded bridge-classified safe label. Approval-time only. */
  targetLabel: string;
  indexGeneration: number;
  /** Redacted, bounded approval copy; never includes surrounding app text. */
  targetSummary: string;
  approvalRequired: true;
  risk: 'medium';
}

export interface NativeSemanticActionProofSnapshot {
  observedAt: string;
  app: string;
  pid: number;
  nodeCount: number;
  treeFingerprint: string;
  targetPresent: boolean;
  targetFingerprint: string | null;
}

export type NativeSemanticActionDiffKind =
  | 'target_disappeared'
  | 'target_semantics_changed'
  | 'tree_changed'
  | 'unchanged'
  | 'identity_unavailable'
  | 'not_dispatched';

export interface NativeSemanticActionProof {
  schemaVersion: 1;
  operation: 'native_semantic_press';
  action: NativeSemanticAction;
  app: string;
  pid: number;
  targetRole: string;
  /** Receipts carry hashes, never the raw AX path or label. */
  targetPathHash: string;
  targetLabelHash: string;
  targetFingerprint: string;
  evidenceId: string;
  approvalRequired: true;
  approvalReceiptHash: string;
  mutationNeeded: true;
  mutationAttempted: boolean;
  mutationPerformed: boolean;
  noOp: false;
  dispatchedAt?: string;
  dispatchAcknowledged: boolean;
  dispatchMethod: 'ax_press' | 'cg_event' | 'unknown' | 'none';
  completionVerified: boolean;
  outcomeUnknown: boolean;
  outcomeUnknownPolicy: 'verify_before_retry';
  replayAllowed: false;
  before: NativeSemanticActionProofSnapshot | null;
  after: NativeSemanticActionProofSnapshot | null;
  diff: {
    kind: NativeSemanticActionDiffKind;
    treeChanged: boolean;
    targetPresentBefore: boolean;
    targetPresentAfter: boolean;
  };
}

export interface NativeSemanticActionExecution {
  app: string;
  pid: number;
  action: NativeSemanticAction;
  targetRole: string;
  targetPathHash: string;
  targetLabelHash: string;
  targetFingerprint: string;
  evidenceId: string;
  completionVerified: boolean;
  outcomeUnknown: boolean;
  replayAllowed: false;
  proof: NativeSemanticActionProof;
}

function semanticActionHash(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
}

function semanticActionIso(value: unknown): string {
  const text = String(value || '').trim();
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function mapNativeSemanticProofSnapshot(value: unknown): NativeSemanticActionProofSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  const treeFingerprint = semanticActionHash(d.treeFingerprint);
  const targetFingerprint = d.targetFingerprint == null ? null : semanticActionHash(d.targetFingerprint);
  const observedAt = semanticActionIso(d.observedAt);
  const app = String(d.app || '').trim().slice(0, 120);
  const pid = Math.max(0, Math.trunc(Number(d.pid || 0)));
  if (!observedAt || !app || !(pid > 0) || !treeFingerprint || (d.targetFingerprint != null && !targetFingerprint)) {
    return null;
  }
  return {
    observedAt,
    app,
    pid,
    nodeCount: Math.max(0, Math.min(400, Math.trunc(Number(d.nodeCount || 0)))),
    treeFingerprint,
    targetPresent: d.targetPresent === true,
    targetFingerprint,
  };
}

function mapNativeSemanticActionProof(value: unknown): NativeSemanticActionProof | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, any>;
  const allowedDiffKinds = new Set<NativeSemanticActionDiffKind>([
    'target_disappeared',
    'target_semantics_changed',
    'tree_changed',
    'unchanged',
    'identity_unavailable',
    'not_dispatched',
  ]);
  const diffKind = String(d.diff?.kind || '') as NativeSemanticActionDiffKind;
  const dispatchMethod = String(d.dispatchMethod || '') as NativeSemanticActionProof['dispatchMethod'];
  const targetPathHash = semanticActionHash(d.targetPathHash);
  const targetLabelHash = semanticActionHash(d.targetLabelHash);
  const targetFingerprint = semanticActionHash(d.targetFingerprint);
  const approvalReceiptHash = String(d.approvalReceiptHash || '').trim().toLowerCase();
  const before = mapNativeSemanticProofSnapshot(d.before);
  const after = mapNativeSemanticProofSnapshot(d.after);
  if (
    d.schemaVersion !== 1
    || d.operation !== 'native_semantic_press'
    || d.action !== 'press'
    || !String(d.app || '').trim()
    || !(Number(d.pid) > 0)
    || !targetPathHash
    || !targetLabelHash
    || !targetFingerprint
    || !/^[a-f0-9]{16}$/.test(approvalReceiptHash)
    || !allowedDiffKinds.has(diffKind)
    || !['ax_press', 'cg_event', 'unknown', 'none'].includes(dispatchMethod)
    || d.mutationNeeded !== true
    || d.noOp !== false
    || d.outcomeUnknownPolicy !== 'verify_before_retry'
    || d.replayAllowed !== false
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    operation: 'native_semantic_press',
    action: 'press',
    app: String(d.app).trim().slice(0, 120),
    pid: Math.trunc(Number(d.pid)),
    targetRole: String(d.targetRole || '').trim().slice(0, 80),
    targetPathHash,
    targetLabelHash,
    targetFingerprint,
    evidenceId: String(d.evidenceId || '').trim().slice(0, 80),
    approvalRequired: true,
    approvalReceiptHash,
    mutationNeeded: true,
    mutationAttempted: d.mutationAttempted === true,
    mutationPerformed: d.mutationPerformed === true,
    noOp: false,
    ...(semanticActionIso(d.dispatchedAt) ? { dispatchedAt: semanticActionIso(d.dispatchedAt) } : {}),
    dispatchAcknowledged: d.dispatchAcknowledged === true,
    dispatchMethod,
    completionVerified: d.completionVerified === true,
    outcomeUnknown: d.outcomeUnknown === true,
    outcomeUnknownPolicy: 'verify_before_retry',
    replayAllowed: false,
    before,
    after,
    diff: {
      kind: diffKind,
      treeChanged: d.diff?.treeChanged === true,
      targetPresentBefore: d.diff?.targetPresentBefore === true,
      targetPresentAfter: d.diff?.targetPresentAfter === true,
    },
  };
}

function hasExactNativeSemanticTargetPostcondition(proof: NativeSemanticActionProof): boolean {
  const before = proof.before;
  const after = proof.after;
  if (
    !before
    || !after
    || before.app !== proof.app
    || after.app !== proof.app
    || before.pid !== proof.pid
    || after.pid !== proof.pid
    || before.targetPresent !== true
    || before.targetFingerprint !== proof.targetFingerprint
  ) {
    return false;
  }
  if (proof.diff.kind === 'target_disappeared') {
    return after.targetPresent === false && after.targetFingerprint === null;
  }
  if (proof.diff.kind === 'target_semantics_changed') {
    return (
      after.targetPresent === true
      && !!after.targetFingerprint
      && after.targetFingerprint !== before.targetFingerprint
    );
  }
  return false;
}

/**
 * Seal one exact low-consequence AX node from the latest fresh observeApp
 * generation into a short-lived, one-shot target. This does not mutate.
 */
export async function observeNativeSemanticActionTarget(args: {
  action: NativeSemanticAction;
  appName: string;
  pid: number;
  indexGeneration: number;
  targetPath: string;
  expectedRole: string;
  expectedLabel: string;
}): Promise<DesktopResult<NativeSemanticActionTarget>> {
  const appName = String(args.appName || '').trim().slice(0, 120);
  const targetPath = String(args.targetPath || '').trim();
  const expectedRole = String(args.expectedRole || '').trim().slice(0, 80);
  const expectedLabel = String(args.expectedLabel || '').trim().slice(0, 120);
  if (
    args.action !== 'press'
    || !appName
    || !/^[A-Za-z0-9 .\-_()]+$/.test(appName)
    || !(Number.isInteger(args.pid) && args.pid > 0)
    || !(Number.isInteger(args.indexGeneration) && args.indexGeneration > 0)
    || !/^[0-9]+(\.[0-9]+)*$/.test(targetPath)
    || !expectedRole
    || !expectedLabel
  ) {
    return {
      ok: false,
      error: 'press, exact appName/PID/indexGeneration/path/role/label are required',
      errorCode: 'invalid_input',
    };
  }
  const r = await callBridge('POST', '/desktop/semantic_action_target', {
    action: 'press',
    appName,
    pid: args.pid,
    indexGeneration: args.indexGeneration,
    targetPath,
    expectedRole,
    expectedLabel,
  });
  if (!r.ok) return r as DesktopResult<NativeSemanticActionTarget>;
  const d = r.data as any;
  const targetId = String(d?.targetId || '').trim().toLowerCase();
  const targetFingerprint = semanticActionHash(d?.targetFingerprint);
  const observedAt = semanticActionIso(d?.observedAt);
  const expiresAt = semanticActionIso(d?.expiresAt);
  const identityMatched = (
    d?.schemaVersion === 1
    && d?.action === 'press'
    && /^[a-f0-9]{48}$/.test(targetId)
    && !!targetFingerprint
    && !!observedAt
    && !!expiresAt
    && String(d?.app || '').trim().toLowerCase() === appName.toLowerCase()
    && String(d?.resolvedAppName || '').trim().toLowerCase() === appName.toLowerCase()
    && Number(d?.pid) === args.pid
    && String(d?.targetPath || '') === targetPath
    && String(d?.targetRole || '') === expectedRole
    && String(d?.targetLabel || '').trim().toLowerCase() === expectedLabel.toLowerCase()
    && Number(d?.indexGeneration) === args.indexGeneration
    && d?.approvalRequired === true
    && d?.risk === 'medium'
  );
  if (!identityMatched) {
    return {
      ok: false,
      error: 'The desktop bridge returned a different or malformed native semantic target.',
      errorCode: 'uncertain_ui_target',
    };
  }
  return {
    ok: true,
    data: {
      schemaVersion: 1,
      action: 'press',
      targetId,
      targetFingerprint,
      evidenceId: String(d.evidenceId || '').trim().slice(0, 80),
      observedAt,
      expiresAt,
      app: appName,
      resolvedAppName: appName,
      pid: args.pid,
      targetPath,
      targetRole: expectedRole,
      targetLabel: expectedLabel,
      indexGeneration: args.indexGeneration,
      targetSummary: `Press "${expectedLabel}" (${expectedRole}) in ${appName}`.slice(0, 240),
      approvalRequired: true,
      risk: 'medium',
    },
  };
}

/**
 * Consume one prepared target exactly once. A transport error after this
 * call starts is outcome-unknown to callers; never replay the target ID.
 */
export async function performNativeSemanticAction(args: {
  targetId: string;
  targetFingerprint: string;
  approvalId: string;
}): Promise<DesktopResult<NativeSemanticActionExecution>> {
  const targetId = String(args.targetId || '').trim().toLowerCase();
  const targetFingerprint = semanticActionHash(args.targetFingerprint);
  const approvalId = String(args.approvalId || '').trim();
  if (
    !/^[a-f0-9]{48}$/.test(targetId)
    || !targetFingerprint
    || !/^[A-Za-z0-9._:-]{8,160}$/.test(approvalId)
  ) {
    return {
      ok: false,
      error: 'valid one-shot targetId, targetFingerprint, and approvalId are required',
      errorCode: 'invalid_input',
    };
  }
  const r = await callBridge('POST', '/desktop/semantic_action', {
    targetId,
    targetFingerprint,
    approvalId,
  }, { attachBodyOnError: true });
  const d = r.data as any;
  const proof = mapNativeSemanticActionProof(d?.proof);
  const mapped = proof ? {
    app: String(d?.app || proof.app).trim().slice(0, 120),
    pid: Math.max(0, Math.trunc(Number(d?.pid || proof.pid))),
    action: 'press' as const,
    targetRole: String(d?.targetRole || proof.targetRole).trim().slice(0, 80),
    targetPathHash: semanticActionHash(d?.targetPathHash) || proof.targetPathHash,
    targetLabelHash: semanticActionHash(d?.targetLabelHash) || proof.targetLabelHash,
    targetFingerprint: semanticActionHash(d?.targetFingerprint) || proof.targetFingerprint,
    evidenceId: String(d?.evidenceId || proof.evidenceId).trim().slice(0, 80),
    completionVerified: d?.completionVerified === true,
    outcomeUnknown: d?.outcomeUnknown === true,
    replayAllowed: false as const,
    proof,
  } : null;
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      errorCode: r.errorCode,
      recoveryHint: r.recoveryHint,
      ...(mapped ? { data: mapped } : {}),
    };
  }
  if (
    !mapped
    || !mapped.completionVerified
    || mapped.outcomeUnknown
    || mapped.proof.completionVerified !== true
    || mapped.proof.outcomeUnknown !== false
    || mapped.proof.replayAllowed !== false
    || mapped.proof.mutationAttempted !== true
    || mapped.proof.mutationPerformed !== true
    || mapped.proof.dispatchAcknowledged !== true
    || !['ax_press', 'cg_event'].includes(mapped.proof.dispatchMethod)
    || !hasExactNativeSemanticTargetPostcondition(mapped.proof)
  ) {
    return {
      ok: false,
      error: 'The desktop bridge did not return exact-target semantic action completion proof.',
      errorCode: 'stale_bridge',
      ...(mapped ? { data: mapped } : {}),
    };
  }
  return { ok: true, data: mapped };
}

/**
 * Click an element by its dotted path (as returned from readA11yTree).
 * `pid` must match the PID the tree was fetched from — element paths
 * are only meaningful within their source process. The helper tries
 * AXPress first (native accessibility click) and falls back to a
 * synthesised CGEvent at the bbox centre for elements that don't
 * implement Press.
 */
export async function clickElement(args: {
  pid: number;
  path?: string;
  /** E2 — SoM node index ([#N]) from the LAST tree read for this pid.
   *  Resolved server-side; structured `index_stale` / `no_indexed_tree`
   *  errors when the map is superseded or missing. Use `path` OR this. */
  elementIndex?: number;
  /** App name the tree was read from. When set, the bridge verifies
   *  the app's CURRENT PID still matches `pid` before clicking and
   *  returns `a11y_path_stale` on mismatch (app restarted → element
   *  paths are invalid) instead of clicking a wrong element. */
  appName?: string;
}): Promise<DesktopResult<{ method: string }>> {
  if (!args.pid || args.pid <= 0) {
    return { ok: false, error: 'pid required', errorCode: 'invalid_input' };
  }
  const hasIndex = typeof args.elementIndex === 'number' && Number.isInteger(args.elementIndex) && args.elementIndex > 0;
  if (!hasIndex && (!args.path || !/^[0-9]+(\.[0-9]+)*$/.test(args.path))) {
    return { ok: false, error: 'path must be a dotted integer sequence (or pass elementIndex from the last tree read)', errorCode: 'invalid_input' };
  }
  const knownGeneration = hasIndex ? lastA11yIndexGenerationByPid.get(args.pid) : undefined;
  const r = await callBridge('POST', '/desktop/click_element', {
    pid: args.pid,
    ...(args.path ? { path: args.path } : {}),
    ...(hasIndex ? { elementIndex: args.elementIndex } : {}),
    ...(hasIndex && knownGeneration ? { indexGeneration: knownGeneration } : {}),
    ...(args.appName ? { expectApp: args.appName } : {}),
  });
  if (!r.ok) return r as DesktopResult<{ method: string }>;
  const d = r.data as any;
  return { ok: true, data: { method: String(d?.method || 'unknown') } };
}

export async function setElementValue(args: {
  pid: number;
  path?: string;
  text: string;
  /** E2 — SoM node index from the last tree read. See clickElement. */
  elementIndex?: number;
  /** See clickElement — PID-staleness guard before mutating. */
  appName?: string;
}): Promise<DesktopResult<{ method: string; chars: number }>> {
  if (!args.pid || args.pid <= 0) {
    return { ok: false, error: 'pid required', errorCode: 'invalid_input' };
  }
  const hasIndex = typeof args.elementIndex === 'number' && Number.isInteger(args.elementIndex) && args.elementIndex > 0;
  if (!hasIndex && (!args.path || !/^[0-9]+(\.[0-9]+)*$/.test(args.path))) {
    return { ok: false, error: 'path must be a dotted integer sequence (or pass elementIndex from the last tree read)', errorCode: 'invalid_input' };
  }
  if (typeof args.text !== 'string' || args.text.length === 0) {
    return { ok: false, error: 'text must be a non-empty string', errorCode: 'invalid_input' };
  }
  if (args.text.length > 20_000) {
    return { ok: false, error: 'text too long (max 20000 chars)', errorCode: 'invalid_input' };
  }
  const knownGeneration = hasIndex ? lastA11yIndexGenerationByPid.get(args.pid) : undefined;
  const r = await callBridge('POST', '/desktop/set_element_value', {
    pid: args.pid,
    ...(args.path ? { path: args.path } : {}),
    text: args.text,
    ...(hasIndex ? { elementIndex: args.elementIndex } : {}),
    ...(hasIndex && knownGeneration ? { indexGeneration: knownGeneration } : {}),
    ...(args.appName ? { expectApp: args.appName } : {}),
  });
  if (!r.ok) return r as DesktopResult<{ method: string; chars: number }>;
  const d = r.data as any;
  return { ok: true, data: { method: String(d?.method || 'ax_set_value'), chars: Number(d?.chars ?? args.text.length) } };
}

/**
 * Flatten a pruned tree into a list of addressable nodes + a compact
 * rendering suitable for LLM consumption (one line per node, indented
 * by depth). Kept as a pure helper so both the client dispatcher and
 * smoke tests can format the same way.
 */
export function renderA11yTree(node: A11yNode, depth = 0, out: string[] = []): string[] {
  const indent = '  '.repeat(depth);
  // E2 — SoM index prefix ([#N]) when the bridge numbered this read.
  // Distinct from the dotted-path [id] so neither is ambiguous.
  const parts = typeof node.index === 'number' && node.index > 0
    ? [`${indent}[#${node.index}]`, `[${node.id}]`, node.role]
    : [`${indent}[${node.id}]`, node.role];
  // QW2: `label`/`value` are app-controlled UNTRUSTED text — sanitize the
  // MODEL-VISIBLE render (strip invisible Tag-char smuggling, defang
  // auto-loading markdown image/link syntax). The raw `node` is untouched;
  // structural fields (id/role/index) are ours, not app content.
  if (node.label) parts.push(`"${sanitizeUntrustedForModel(node.label).replace(/"/g, '\\"').slice(0, 120)}"`);
  if (node.value && node.value !== node.label) parts.push(`= "${sanitizeUntrustedForModel(node.value).replace(/"/g, '\\"').slice(0, 80)}"`);
  out.push(parts.join(' '));
  for (const child of node.children || []) {
    renderA11yTree(child, depth + 1, out);
  }
  return out;
}

export async function pressKeys(
  combo: string,
  targetGuard?: DesktopNativeUiTargetGuard,
): Promise<DesktopResult<{ combo: string }>> {
  const parsed = parseKeyCombo(combo);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, errorCode: 'invalid_input' };
  }
  const guarded = guardedDesktopMutationBody(targetGuard);
  if (!guarded.ok) return guarded.result;
  const r = await callBridge('POST', '/desktop/keys', {
    combo,
    targetGuard: guarded.targetGuard,
  });
  if (!r.ok) return r as DesktopResult<{ combo: string }>;
  return { ok: true, data: { combo: (r.data as any)?.combo || combo } };
}

export async function clickMenu(args: {
  appName?: string;
  menuPath: string[];
  targetGuard?: DesktopNativeUiTargetGuard;
}): Promise<DesktopResult<{ appName: string | null; menuPath: string[] }>> {
  const appName = String(args.appName || '').trim();
  if (appName && !isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  const menuPath = Array.isArray(args.menuPath)
    ? args.menuPath.map((part) => String(part || '').trim()).filter(Boolean)
    : [];
  if (menuPath.length < 2 || menuPath.length > 6) {
    return { ok: false, error: 'menuPath must contain 2-6 menu labels', errorCode: 'invalid_input' };
  }
  if (menuPath.some((part) => part.length > 80 || /[\x00-\x1f]/.test(part))) {
    return { ok: false, error: 'menuPath labels must be <= 80 chars and cannot contain control characters', errorCode: 'invalid_input' };
  }
  const guarded = guardedDesktopMutationBody(args.targetGuard);
  if (!guarded.ok) return guarded.result;
  if (appName && appName !== guarded.targetGuard.appName) {
    return {
      ok: false,
      error: 'Menu appName must exactly match the sealed native target guard.',
      errorCode: 'uncertain_ui_target',
    };
  }
  const body: Record<string, unknown> = {
    menuPath,
    appName: guarded.targetGuard.appName,
    targetGuard: guarded.targetGuard,
  };
  const r = await callBridge('POST', '/desktop/menu_click', body);
  if (!r.ok) return r as DesktopResult<{ appName: string | null; menuPath: string[] }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : null,
      menuPath: Array.isArray(d?.menuPath) ? d.menuPath.map(String) : menuPath,
    },
  };
}

export async function indesignFindChange(args: {
  appName?: string;
  findText: string;
  changeText: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<{
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  findText: string;
  changeText: string;
  matched: number;
  changed: number;
  remaining: number;
  replacementMatches: number;
  method: string | null;
  unlockedCount: number;
  lockedLayers: number;
  hiddenLayers: number;
  lockedPageItems: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  fallbackReason: string | null;
  error: string | null;
}>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const findText = String(args.findText ?? '');
  const changeText = String(args.changeText ?? '');
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (!findText || findText.length > 5000 || changeText.length > 5000 || /[\x00]/.test(`${findText}${changeText}`)) {
    return { ok: false, error: 'findText/changeText must be 1-5000 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_find_change', {
    appName,
    findText,
    changeText,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<{
    appName: string | null;
    documentName: string | null;
    expectedDocumentName: string | null;
    sourceDocumentPath: string | null;
    findText: string;
    changeText: string;
    matched: number;
    changed: number;
    remaining: number;
    replacementMatches: number;
    method: string | null;
    unlockedCount: number;
    lockedLayers: number;
    hiddenLayers: number;
    lockedPageItems: number;
    docWasModified: boolean;
    docModified: boolean;
    docSaved: boolean;
    fallbackReason: string | null;
    error: string | null;
  }>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      findText: String(d?.findText ?? findText),
      changeText: String(d?.changeText ?? changeText),
      matched: Number.isFinite(Number(d?.matched)) ? Number(d.matched) : 0,
      changed: Number.isFinite(Number(d?.changed)) ? Number(d.changed) : 0,
      remaining: Number.isFinite(Number(d?.remaining)) ? Number(d.remaining) : 0,
      replacementMatches: Number.isFinite(Number(d?.replacementMatches)) ? Number(d.replacementMatches) : 0,
      method: d?.method ? String(d.method) : null,
      unlockedCount: Number.isFinite(Number(d?.unlockedCount)) ? Number(d.unlockedCount) : 0,
      lockedLayers: Number.isFinite(Number(d?.lockedLayers)) ? Number(d.lockedLayers) : 0,
      hiddenLayers: Number.isFinite(Number(d?.hiddenLayers)) ? Number(d.hiddenLayers) : 0,
      lockedPageItems: Number.isFinite(Number(d?.lockedPageItems)) ? Number(d.lockedPageItems) : 0,
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      fallbackReason: d?.fallbackReason ? String(d.fallbackReason) : null,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type InDesignBatchFindChangePair = {
  findText: string;
  changeText: string;
};

export type InDesignBatchFindChangeItemResult = InDesignBatchFindChangePair & {
  matched: number;
  changed: number;
  remaining: number;
  replacementMatches: number;
  method: string | null;
  unlockedCount: number;
  fallbackReason: string | null;
  error: string | null;
};

export type InDesignBatchFindChangeResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  pairCount: number;
  matched: number;
  changed: number;
  remaining: number;
  replacementMatches: number;
  unlockedCount: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  results: InDesignBatchFindChangeItemResult[];
  error: string | null;
};

export async function indesignBatchFindChange(args: {
  appName?: string;
  pairs: InDesignBatchFindChangePair[];
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignBatchFindChangeResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  const pairs = Array.isArray(args.pairs)
    ? args.pairs.slice(0, 20).map((pair) => ({
        findText: String(pair?.findText ?? ''),
        changeText: String(pair?.changeText ?? ''),
      })).filter((pair) => pair.findText)
    : [];
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (pairs.length < 1 || pairs.length > 20 || pairs.some((pair) => !pair.findText || pair.findText.length > 5000 || pair.changeText.length > 5000 || /[\x00]/.test(`${pair.findText}${pair.changeText}`))) {
    return { ok: false, error: 'pairs must contain 1-20 find/change values, each <= 5000 chars and without NUL.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_batch_find_change', {
    appName,
    pairs,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<InDesignBatchFindChangeResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const results = Array.isArray(d?.results)
    ? d.results.slice(0, pairs.length).map((item: any, index: number) => ({
        findText: item?.findText ? String(item.findText) : pairs[index]?.findText || '',
        changeText: item?.changeText !== undefined ? String(item.changeText) : pairs[index]?.changeText || '',
        matched: toNumber(item?.matched),
        changed: toNumber(item?.changed),
        remaining: toNumber(item?.remaining),
        replacementMatches: toNumber(item?.replacementMatches),
        method: item?.method ? String(item.method) : null,
        unlockedCount: toNumber(item?.unlockedCount),
        fallbackReason: item?.fallbackReason ? String(item.fallbackReason) : null,
        error: item?.error ? String(item.error) : null,
      }))
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      pairCount: toNumber(d?.pairCount || results.length),
      matched: toNumber(d?.matched),
      changed: toNumber(d?.changed),
      remaining: toNumber(d?.remaining),
      replacementMatches: toNumber(d?.replacementMatches),
      unlockedCount: toNumber(d?.unlockedCount),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      results,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type InDesignDocumentSummary = {
  name: string;
  path: string | null;
  modified: boolean;
  saved: boolean;
  pageCount: number;
};

export type InDesignDocumentStatus = {
  appName: string | null;
  appRunning: boolean;
  status: string;
  documentCount: number;
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  activeDocumentModified: boolean;
  activeDocumentSaved: boolean;
  pageCount: number;
  spreadCount: number;
  layerCount: number;
  lockedLayers: number;
  hiddenLayers: number;
  linkCount: number;
  missingLinks: number;
  modifiedLinks: number;
  problemLinks: number;
  fontCount: number;
  missingFonts: number;
  selectionCount: number;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  documents: InDesignDocumentSummary[];
  error: string | null;
};

export async function indesignDocumentStatus(args: {
  appName?: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
} = {}): Promise<DesktopResult<InDesignDocumentStatus>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_document_status', {
    appName,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<InDesignDocumentStatus>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const documents = Array.isArray(d?.documents)
    ? d.documents.slice(0, 12).map((doc: any) => ({
        name: doc?.name ? String(doc.name) : '',
        path: doc?.path ? String(doc.path) : null,
        modified: doc?.modified === true,
        saved: doc?.saved === true,
        pageCount: toNumber(doc?.pageCount),
      })).filter((doc: InDesignDocumentSummary) => !!doc.name)
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentCount: toNumber(d?.documentCount),
      activeDocumentName: d?.activeDocumentName ? String(d.activeDocumentName) : null,
      activeDocumentPath: d?.activeDocumentPath ? String(d.activeDocumentPath) : null,
      activeDocumentModified: d?.activeDocumentModified === true,
      activeDocumentSaved: d?.activeDocumentSaved === true,
      pageCount: toNumber(d?.pageCount),
      spreadCount: toNumber(d?.spreadCount),
      layerCount: toNumber(d?.layerCount),
      lockedLayers: toNumber(d?.lockedLayers),
      hiddenLayers: toNumber(d?.hiddenLayers),
      linkCount: toNumber(d?.linkCount),
      missingLinks: toNumber(d?.missingLinks),
      modifiedLinks: toNumber(d?.modifiedLinks),
      problemLinks: toNumber(d?.problemLinks),
      fontCount: toNumber(d?.fontCount),
      missingFonts: toNumber(d?.missingFonts),
      selectionCount: toNumber(d?.selectionCount),
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      documents,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type InDesignUpdateTextLayerResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  fieldName: string;
  replacementText: string;
  matchedLayers: number;
  matchedFrames: number;
  updatedFrames: number;
  replacementMatches: number;
  layerNames: string[];
  unlockedCount: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type InDesignBatchUpdateTextLayerUpdate = {
  fieldName: string;
  replacementText: string;
};

export type InDesignBatchUpdateTextLayerItemResult = InDesignBatchUpdateTextLayerUpdate & {
  matchedLayers: number;
  matchedFrames: number;
  updatedFrames: number;
  replacementMatches: number;
  layerNames: string[];
  unlockedCount: number;
  error: string | null;
};

export type InDesignBatchUpdateTextLayersResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  fieldCount: number;
  matchedLayers: number;
  matchedFrames: number;
  updatedFrames: number;
  replacementMatches: number;
  unlockedCount: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  results: InDesignBatchUpdateTextLayerItemResult[];
  error: string | null;
};

export type InDesignExportProofResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  outputPath: string;
  format: 'pdf';
  pageCount: number;
  spreadCount: number;
  fileExists: boolean;
  sizeBytes: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type InDesignRelinkAssetResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  assetPath: string;
  linkQuery: string | null;
  matchedLinks: number;
  relinkedLinks: number;
  missingBefore: number;
  missingAfter: number;
  linkNames: string[];
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type InDesignPackageDocumentResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  outputFolderPath: string;
  packageOk: boolean;
  includeIdml: boolean;
  includePdf: boolean;
  copyFonts: boolean;
  copyLinkedGraphics: boolean;
  copyProfiles: boolean;
  createReport: boolean;
  fileCount: number;
  folderCount: number;
  sizeBytes: number;
  sampleFiles: string[];
  missingLinksBefore: number;
  modifiedLinksBefore: number;
  missingFontsBefore: number;
  linkCount: number;
  fontCount: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type InDesignTextInventoryFrame = {
  layerName: string;
  itemName: string;
  label: string;
  pageName: string;
  contentPreview: string;
  chars: number;
  matchCount: number;
  overflows: boolean;
  locked: boolean;
  visible: boolean;
};

export type InDesignTextInventoryResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  query: string;
  textFrameCount: number;
  matchedFrames: number;
  oversetFrames: number;
  lockedLayers: number;
  hiddenLayers: number;
  queryMatches: number;
  layerNames: string[];
  frames: InDesignTextInventoryFrame[];
  error: string | null;
};

export type InDesignLayerStateAction = 'show' | 'hide' | 'lock' | 'unlock';

export type InDesignLayerStateSummary = {
  name: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
};

export type InDesignSetLayerStateResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  layerName: string;
  action: InDesignLayerStateAction;
  matchedLayers: number;
  changedLayers: number;
  beforeVisible: boolean;
  afterVisible: boolean;
  beforeLocked: boolean;
  afterLocked: boolean;
  beforePrintable: boolean;
  afterPrintable: boolean;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  matches: InDesignLayerStateSummary[];
  error: string | null;
};

export async function indesignTextInventory(args: {
  appName?: string;
  query?: string | null;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
  maxItems?: number;
} = {}): Promise<DesktopResult<InDesignTextInventoryResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const query = args.query == null ? '' : String(args.query).trim();
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  const maxItems = Math.max(1, Math.min(80, Math.trunc(Number(args.maxItems || 30))));
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (query.length > 160 || /[\x00-\x1f]/.test(query)) {
    return { ok: false, error: 'query must be <= 160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_text_inventory', {
    appName,
    query: query || undefined,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
    maxItems,
  });
  if (!r.ok) return r as DesktopResult<InDesignTextInventoryResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const frames = Array.isArray(d?.frames)
    ? d.frames.slice(0, maxItems).map((frame: any) => ({
        layerName: frame?.layerName ? String(frame.layerName) : '',
        itemName: frame?.itemName ? String(frame.itemName) : '',
        label: frame?.label ? String(frame.label) : '',
        pageName: frame?.pageName ? String(frame.pageName) : '',
        contentPreview: frame?.contentPreview ? String(frame.contentPreview) : '',
        chars: toNumber(frame?.chars),
        matchCount: toNumber(frame?.matchCount),
        overflows: frame?.overflows === true,
        locked: frame?.locked === true,
        visible: frame?.visible !== false,
      }))
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      query: d?.query ? String(d.query) : query,
      textFrameCount: toNumber(d?.textFrameCount),
      matchedFrames: toNumber(d?.matchedFrames),
      oversetFrames: toNumber(d?.oversetFrames),
      lockedLayers: toNumber(d?.lockedLayers),
      hiddenLayers: toNumber(d?.hiddenLayers),
      queryMatches: toNumber(d?.queryMatches),
      layerNames: Array.isArray(d?.layerNames) ? d.layerNames.map((name: unknown) => String(name)).filter(Boolean).slice(0, 80) : [],
      frames,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignSetLayerState(args: {
  appName?: string;
  layerName: string;
  action: InDesignLayerStateAction;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignSetLayerStateResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const layerName = String(args.layerName || '').trim();
  const action = String(args.action || '').trim().toLowerCase() as InDesignLayerStateAction;
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (!layerName || layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
    return { ok: false, error: 'layerName must be 1-160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (!['show', 'hide', 'lock', 'unlock'].includes(action)) {
    return { ok: false, error: 'action must be show, hide, lock, or unlock.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_set_layer_state', {
    appName,
    layerName,
    action,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<InDesignSetLayerStateResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const matches = Array.isArray(d?.matches)
    ? d.matches.slice(0, 12).map((item: any) => ({
        name: item?.name ? String(item.name) : '',
        visible: item?.visible !== false,
        locked: item?.locked === true,
        printable: item?.printable === true,
      })).filter((item: InDesignLayerStateSummary) => !!item.name)
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      layerName: String(d?.layerName ?? layerName),
      action: (['show', 'hide', 'lock', 'unlock'].includes(String(d?.action || '').toLowerCase())
        ? String(d.action).toLowerCase()
        : action) as InDesignLayerStateAction,
      matchedLayers: toNumber(d?.matchedLayers),
      changedLayers: toNumber(d?.changedLayers),
      beforeVisible: d?.beforeVisible === true,
      afterVisible: d?.afterVisible === true,
      beforeLocked: d?.beforeLocked === true,
      afterLocked: d?.afterLocked === true,
      beforePrintable: d?.beforePrintable === true,
      afterPrintable: d?.afterPrintable === true,
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      matches,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignUpdateTextLayer(args: {
  appName?: string;
  fieldName: string;
  replacementText: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignUpdateTextLayerResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const fieldName = String(args.fieldName || '').trim();
  const replacementText = String(args.replacementText ?? '');
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (!fieldName || fieldName.length > 160 || /[\x00-\x1f]/.test(fieldName)) {
    return { ok: false, error: 'fieldName must be 1-160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (replacementText.length > 5000 || /[\x00]/.test(replacementText)) {
    return { ok: false, error: 'replacementText must be <= 5000 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_update_text_layer', {
    appName,
    fieldName,
    replacementText,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<InDesignUpdateTextLayerResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      fieldName: String(d?.fieldName ?? fieldName),
      replacementText: String(d?.replacementText ?? replacementText),
      matchedLayers: toNumber(d?.matchedLayers),
      matchedFrames: toNumber(d?.matchedFrames),
      updatedFrames: toNumber(d?.updatedFrames),
      replacementMatches: toNumber(d?.replacementMatches),
      layerNames: Array.isArray(d?.layerNames) ? d.layerNames.map((name: unknown) => String(name)).filter(Boolean).slice(0, 20) : [],
      unlockedCount: toNumber(d?.unlockedCount),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignBatchUpdateTextLayers(args: {
  appName?: string;
  updates: InDesignBatchUpdateTextLayerUpdate[];
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignBatchUpdateTextLayersResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  const updates = Array.isArray(args.updates)
    ? args.updates.slice(0, 12).map((update) => ({
        fieldName: String(update?.fieldName ?? '').trim(),
        replacementText: String(update?.replacementText ?? ''),
      })).filter((update) => update.fieldName)
    : [];
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (
    updates.length < 1 ||
    updates.length > 12 ||
    updates.some((update) => !update.fieldName || update.fieldName.length > 160 || /[\x00-\x1f]/.test(update.fieldName) || update.replacementText.length > 5000 || /[\x00]/.test(update.replacementText))
  ) {
    return { ok: false, error: 'updates must contain 1-12 field/replacement values with valid field names and replacement text <= 5000 chars.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/indesign_batch_update_text_layers', {
    appName,
    updates,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<InDesignBatchUpdateTextLayersResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const results = Array.isArray(d?.results)
    ? d.results.slice(0, updates.length).map((item: any, index: number) => ({
        fieldName: item?.fieldName ? String(item.fieldName) : updates[index]?.fieldName || '',
        replacementText: item?.replacementText !== undefined ? String(item.replacementText) : updates[index]?.replacementText || '',
        matchedLayers: toNumber(item?.matchedLayers),
        matchedFrames: toNumber(item?.matchedFrames),
        updatedFrames: toNumber(item?.updatedFrames),
        replacementMatches: toNumber(item?.replacementMatches),
        layerNames: Array.isArray(item?.layerNames) ? item.layerNames.map((name: unknown) => String(name)).filter(Boolean).slice(0, 20) : [],
        unlockedCount: toNumber(item?.unlockedCount),
        error: item?.error ? String(item.error) : null,
      }))
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      fieldCount: toNumber(d?.fieldCount || results.length),
      matchedLayers: toNumber(d?.matchedLayers),
      matchedFrames: toNumber(d?.matchedFrames),
      updatedFrames: toNumber(d?.updatedFrames),
      replacementMatches: toNumber(d?.replacementMatches),
      unlockedCount: toNumber(d?.unlockedCount),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      results,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignRelinkAsset(args: {
  appName?: string;
  assetPath: string;
  linkQuery?: string | null;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignRelinkAssetResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const assetPathResult = validateDesktopPath(String(args.assetPath || '').trim());
  if (!assetPathResult.ok) return { ok: false, error: assetPathResult.error, errorCode: 'invalid_input' };
  const linkQuery = args.linkQuery == null ? '' : String(args.linkQuery).trim();
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (linkQuery.length > 240 || /[\x00-\x1f]/.test(linkQuery)) {
    return { ok: false, error: 'linkQuery must be <= 240 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const grantHeaders = await ensureLocalFileGrantHeaders([assetPathResult.path], 'read', `Relink InDesign asset ${assetPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<InDesignRelinkAssetResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/indesign_relink_asset', {
    appName,
    assetPath: assetPathResult.path,
    linkQuery: linkQuery || undefined,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<InDesignRelinkAssetResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      assetPath: d?.assetPath ? String(d.assetPath) : assetPathResult.path,
      linkQuery: d?.linkQuery ? String(d.linkQuery) : (linkQuery || null),
      matchedLinks: toNumber(d?.matchedLinks),
      relinkedLinks: toNumber(d?.relinkedLinks),
      missingBefore: toNumber(d?.missingBefore),
      missingAfter: toNumber(d?.missingAfter),
      linkNames: Array.isArray(d?.linkNames) ? d.linkNames.map((name: unknown) => String(name)).filter(Boolean).slice(0, 20) : [],
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignPackageDocument(args: {
  appName?: string;
  outputFolderPath: string;
  includeIdml?: boolean;
  includePdf?: boolean;
  copyFonts?: boolean;
  copyLinkedGraphics?: boolean;
  copyProfiles?: boolean;
  updateGraphics?: boolean;
  includeHiddenLayers?: boolean;
  ignorePreflightErrors?: boolean;
  createReport?: boolean;
  forceSave?: boolean;
  pdfStyle?: string | null;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignPackageDocumentResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const outputPathResult = validateDesktopPath(String(args.outputFolderPath || '').trim());
  if (!outputPathResult.ok) return { ok: false, error: outputPathResult.error, errorCode: 'invalid_input' };
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  const pdfStyle = args.pdfStyle == null ? '' : String(args.pdfStyle).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (pdfStyle.length > 180 || /[\x00-\x1f]/.test(pdfStyle)) {
    return { ok: false, error: 'pdfStyle must be <= 180 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const grantHeaders = await ensureLocalFileGrantHeaders([outputPathResult.path], 'write', `Package InDesign document to ${outputPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<InDesignPackageDocumentResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/indesign_package_document', {
    appName,
    outputFolderPath: outputPathResult.path,
    includeIdml: args.includeIdml === true,
    includePdf: args.includePdf === true,
    copyFonts: args.copyFonts !== false,
    copyLinkedGraphics: args.copyLinkedGraphics !== false,
    copyProfiles: args.copyProfiles !== false,
    updateGraphics: args.updateGraphics !== false,
    includeHiddenLayers: args.includeHiddenLayers !== false,
    ignorePreflightErrors: args.ignorePreflightErrors === true,
    createReport: args.createReport !== false,
    forceSave: args.forceSave !== false,
    pdfStyle: pdfStyle || undefined,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<InDesignPackageDocumentResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      outputFolderPath: d?.outputFolderPath ? String(d.outputFolderPath) : outputPathResult.path,
      packageOk: d?.packageOk === true,
      includeIdml: d?.includeIdml === true,
      includePdf: d?.includePdf === true,
      copyFonts: d?.copyFonts !== false,
      copyLinkedGraphics: d?.copyLinkedGraphics !== false,
      copyProfiles: d?.copyProfiles !== false,
      createReport: d?.createReport !== false,
      fileCount: toNumber(d?.fileCount),
      folderCount: toNumber(d?.folderCount),
      sizeBytes: toNumber(d?.sizeBytes),
      sampleFiles: Array.isArray(d?.sampleFiles) ? d.sampleFiles.map((name: unknown) => String(name)).filter(Boolean).slice(0, 40) : [],
      missingLinksBefore: toNumber(d?.missingLinksBefore),
      modifiedLinksBefore: toNumber(d?.modifiedLinksBefore),
      missingFontsBefore: toNumber(d?.missingFontsBefore),
      linkCount: toNumber(d?.linkCount),
      fontCount: toNumber(d?.fontCount),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function indesignExportProof(args: {
  appName?: string;
  outputPath: string;
  format?: 'pdf';
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<InDesignExportProofResult>> {
  const appName = String(args.appName || 'InDesign').trim() || 'InDesign';
  const outputPathResult = validateDesktopPath(String(args.outputPath || '').trim());
  if (!outputPathResult.ok) return { ok: false, error: outputPathResult.error, errorCode: 'invalid_input' };
  const format = String(args.format || 'pdf').trim().toLowerCase();
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (format !== 'pdf') {
    return { ok: false, error: 'format must be pdf.', errorCode: 'invalid_input' };
  }
  if (!/\.pdf$/i.test(outputPathResult.path)) {
    return { ok: false, error: 'outputPath must end in .pdf for InDesign proof export.', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const grantHeaders = await ensureLocalFileGrantHeaders([outputPathResult.path], 'write', `Export InDesign proof to ${outputPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<InDesignExportProofResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/indesign_export_proof', {
    appName,
    outputPath: outputPathResult.path,
    format: 'pdf',
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<InDesignExportProofResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      outputPath: d?.outputPath ? String(d.outputPath) : outputPathResult.path,
      format: 'pdf',
      pageCount: toNumber(d?.pageCount),
      spreadCount: toNumber(d?.spreadCount),
      fileExists: d?.fileExists === true,
      sizeBytes: toNumber(d?.sizeBytes),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type PhotoshopDocumentSummary = {
  name: string;
  path: string | null;
  modified: boolean;
  saved: boolean;
  widthPx: number;
  heightPx: number;
};

export type PhotoshopDocumentStatus = {
  appName: string | null;
  appRunning: boolean;
  status: string;
  documentCount: number;
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  activeDocumentModified: boolean;
  activeDocumentSaved: boolean;
  widthPx: number;
  heightPx: number;
  resolution: number;
  mode: string | null;
  bitsPerChannel: string | null;
  layerCount: number;
  groupCount: number;
  textLayerCount: number;
  smartObjectCount: number;
  adjustmentLayerCount: number;
  lockedLayers: number;
  hiddenLayers: number;
  selectionActive: boolean;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  documents: PhotoshopDocumentSummary[];
  error: string | null;
};

export type PhotoshopLayerInventoryLayer = {
  name: string;
  path: string;
  type: string;
  kind: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  textPreview: string;
  hasMask: boolean;
  bounds: number[];
  depth: number;
};

export type PhotoshopLayerInventoryResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  query: string;
  layerCount: number;
  matchedLayers: number;
  textLayerCount: number;
  smartObjectCount: number;
  adjustmentLayerCount: number;
  groupCount: number;
  lockedLayers: number;
  hiddenLayers: number;
  selectionActive: boolean;
  maskLayerCount: number;
  layers: PhotoshopLayerInventoryLayer[];
  error: string | null;
};

export type PhotoshopLayerStateAction = 'show' | 'hide' | 'lock' | 'unlock';

export type PhotoshopLayerStateSummary = {
  name: string;
  path: string;
  type: string;
  kind: string;
  visible: boolean;
  locked: boolean;
};

export type PhotoshopSetLayerStateResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  layerName: string;
  action: PhotoshopLayerStateAction;
  matchedLayers: number;
  changedLayers: number;
  beforeVisible: boolean;
  afterVisible: boolean;
  beforeLocked: boolean;
  afterLocked: boolean;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  matches: PhotoshopLayerStateSummary[];
  error: string | null;
};

export type PhotoshopUpdateTextLayerResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  layerName: string;
  replacementText: string;
  matchedLayers: number;
  updatedLayers: number;
  replacementMatches: number;
  layerNames: string[];
  /** Locked/hidden targets (layer or ancestor group) temporarily unlocked for the write, then restored. */
  unlockedCount: number;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type PhotoshopPlaceAssetResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  assetPath: string;
  layerName: string | null;
  placedLayerName: string | null;
  docWasModified: boolean;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

export type PhotoshopExportProofResult = {
  appName: string | null;
  documentName: string | null;
  expectedDocumentName: string | null;
  sourceDocumentPath: string | null;
  outputPath: string;
  format: string;
  quality: number | null;
  widthPx: number;
  heightPx: number;
  fileExists: boolean;
  sizeBytes: number;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

function normalizePhotoshopAppName(value?: string): string {
  return String(value || 'Photoshop').trim() || 'Photoshop';
}

function validatePhotoshopDocumentGuards(args: {
  appName?: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): DesktopResult<{ appName: string; expectedDocumentName: string; sourceDocumentPath: string }> {
  const appName = normalizePhotoshopAppName(args.appName);
  const expectedDocumentName = args.expectedDocumentName == null ? '' : String(args.expectedDocumentName).trim();
  const sourceDocumentPath = args.sourceDocumentPath == null ? '' : String(args.sourceDocumentPath).trim();
  if (!isValidAppName(appName)) {
    return { ok: false, error: 'Invalid appName', errorCode: 'invalid_input' };
  }
  if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  if (sourceDocumentPath.length > 1024 || /[\x00-\x1f]/.test(sourceDocumentPath)) {
    return { ok: false, error: 'sourceDocumentPath must be <= 1024 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  return { ok: true, data: { appName, expectedDocumentName, sourceDocumentPath } };
}

export async function photoshopDocumentStatus(args: {
  appName?: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
} = {}): Promise<DesktopResult<PhotoshopDocumentStatus>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopDocumentStatus>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const r = await callBridge('POST', '/desktop/photoshop_document_status', {
    appName,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopDocumentStatus>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const documents = Array.isArray(d?.documents)
    ? d.documents.slice(0, 12).map((doc: any) => ({
        name: doc?.name ? String(doc.name) : '',
        path: doc?.path ? String(doc.path) : null,
        modified: doc?.modified === true,
        saved: doc?.saved === true,
        widthPx: toNumber(doc?.widthPx),
        heightPx: toNumber(doc?.heightPx),
      })).filter((doc: PhotoshopDocumentSummary) => !!doc.name)
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentCount: toNumber(d?.documentCount),
      activeDocumentName: d?.activeDocumentName ? String(d.activeDocumentName) : null,
      activeDocumentPath: d?.activeDocumentPath ? String(d.activeDocumentPath) : null,
      activeDocumentModified: d?.activeDocumentModified === true,
      activeDocumentSaved: d?.activeDocumentSaved === true,
      widthPx: toNumber(d?.widthPx),
      heightPx: toNumber(d?.heightPx),
      resolution: toNumber(d?.resolution),
      mode: d?.mode ? String(d.mode) : null,
      bitsPerChannel: d?.bitsPerChannel ? String(d.bitsPerChannel) : null,
      layerCount: toNumber(d?.layerCount),
      groupCount: toNumber(d?.groupCount),
      textLayerCount: toNumber(d?.textLayerCount),
      smartObjectCount: toNumber(d?.smartObjectCount),
      adjustmentLayerCount: toNumber(d?.adjustmentLayerCount),
      lockedLayers: toNumber(d?.lockedLayers),
      hiddenLayers: toNumber(d?.hiddenLayers),
      selectionActive: d?.selectionActive === true,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      documents,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopLayerInventory(args: {
  appName?: string;
  query?: string | null;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
  maxItems?: number;
} = {}): Promise<DesktopResult<PhotoshopLayerInventoryResult>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopLayerInventoryResult>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const query = args.query == null ? '' : String(args.query).trim();
  const maxItems = Math.max(1, Math.min(120, Math.trunc(Number(args.maxItems || 40))));
  if (query.length > 160 || /[\x00-\x1f]/.test(query)) {
    return { ok: false, error: 'query must be <= 160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/photoshop_layer_inventory', {
    appName,
    query: query || undefined,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
    maxItems,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopLayerInventoryResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const layers = Array.isArray(d?.layers)
    ? d.layers.slice(0, maxItems).map((layer: any) => ({
        name: layer?.name ? String(layer.name) : '',
        path: layer?.path ? String(layer.path) : '',
        type: layer?.type ? String(layer.type) : '',
        kind: layer?.kind ? String(layer.kind) : '',
        visible: layer?.visible !== false,
        locked: layer?.locked === true,
        opacity: toNumber(layer?.opacity),
        textPreview: layer?.textPreview ? String(layer.textPreview) : '',
        hasMask: layer?.hasMask === true,
        bounds: Array.isArray(layer?.bounds) ? layer.bounds.slice(0, 4).map(toNumber) : [],
        depth: toNumber(layer?.depth),
      }))
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      query: d?.query ? String(d.query) : query,
      layerCount: toNumber(d?.layerCount),
      matchedLayers: toNumber(d?.matchedLayers),
      textLayerCount: toNumber(d?.textLayerCount),
      smartObjectCount: toNumber(d?.smartObjectCount),
      adjustmentLayerCount: toNumber(d?.adjustmentLayerCount),
      groupCount: toNumber(d?.groupCount),
      lockedLayers: toNumber(d?.lockedLayers),
      hiddenLayers: toNumber(d?.hiddenLayers),
      selectionActive: d?.selectionActive === true,
      maskLayerCount: toNumber(d?.maskLayerCount),
      layers,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopSetLayerState(args: {
  appName?: string;
  layerName: string;
  action: PhotoshopLayerStateAction;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<PhotoshopSetLayerStateResult>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopSetLayerStateResult>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const layerName = String(args.layerName || '').trim();
  const action = String(args.action || '').trim().toLowerCase() as PhotoshopLayerStateAction;
  if (!layerName || layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
    return { ok: false, error: 'layerName must be 1-160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (!['show', 'hide', 'lock', 'unlock'].includes(action)) {
    return { ok: false, error: 'action must be show, hide, lock, or unlock.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/photoshop_set_layer_state', {
    appName,
    layerName,
    action,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopSetLayerStateResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const matches = Array.isArray(d?.matches)
    ? d.matches.slice(0, 12).map((item: any) => ({
        name: item?.name ? String(item.name) : '',
        path: item?.path ? String(item.path) : '',
        type: item?.type ? String(item.type) : '',
        kind: item?.kind ? String(item.kind) : '',
        visible: item?.visible !== false,
        locked: item?.locked === true,
      })).filter((item: PhotoshopLayerStateSummary) => !!(item.name || item.path))
    : [];
  const normalizedAction = ['show', 'hide', 'lock', 'unlock'].includes(String(d?.action || action))
    ? String(d?.action || action) as PhotoshopLayerStateAction
    : action;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      layerName: String(d?.layerName ?? layerName),
      action: normalizedAction,
      matchedLayers: toNumber(d?.matchedLayers),
      changedLayers: toNumber(d?.changedLayers),
      beforeVisible: d?.beforeVisible === true,
      afterVisible: d?.afterVisible === true,
      beforeLocked: d?.beforeLocked === true,
      afterLocked: d?.afterLocked === true,
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      matches,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopUpdateTextLayer(args: {
  appName?: string;
  layerName: string;
  replacementText: string;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<PhotoshopUpdateTextLayerResult>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopUpdateTextLayerResult>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const layerName = String(args.layerName || '').trim();
  const replacementText = String(args.replacementText ?? '');
  if (!layerName || layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
    return { ok: false, error: 'layerName must be 1-160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  if (replacementText.length > 5000 || /[\x00]/.test(replacementText)) {
    return { ok: false, error: 'replacementText must be <= 5000 chars and cannot contain NUL.', errorCode: 'invalid_input' };
  }
  const r = await callBridge('POST', '/desktop/photoshop_update_text_layer', {
    appName,
    layerName,
    replacementText,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopUpdateTextLayerResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      layerName: String(d?.layerName ?? layerName),
      replacementText: String(d?.replacementText ?? replacementText),
      matchedLayers: toNumber(d?.matchedLayers),
      updatedLayers: toNumber(d?.updatedLayers),
      replacementMatches: toNumber(d?.replacementMatches),
      layerNames: Array.isArray(d?.layerNames) ? d.layerNames.map((name: unknown) => String(name)).filter(Boolean).slice(0, 20) : [],
      unlockedCount: toNumber(d?.unlockedCount),
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopPlaceAsset(args: {
  appName?: string;
  assetPath: string;
  layerName?: string | null;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<PhotoshopPlaceAssetResult>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopPlaceAssetResult>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const assetPathResult = validateDesktopPath(String(args.assetPath || '').trim());
  if (!assetPathResult.ok) return { ok: false, error: assetPathResult.error, errorCode: 'invalid_input' };
  const layerName = args.layerName == null ? '' : String(args.layerName).trim();
  if (layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
    return { ok: false, error: 'layerName must be <= 160 chars and cannot contain control characters.', errorCode: 'invalid_input' };
  }
  const grantHeaders = await ensureLocalFileGrantHeaders([assetPathResult.path], 'read', `Place Photoshop asset ${assetPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<PhotoshopPlaceAssetResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/photoshop_place_asset', {
    appName,
    assetPath: assetPathResult.path,
    layerName: layerName || undefined,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<PhotoshopPlaceAssetResult>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      assetPath: d?.assetPath ? String(d.assetPath) : assetPathResult.path,
      layerName: d?.layerName ? String(d.layerName) : (layerName || null),
      placedLayerName: d?.placedLayerName ? String(d.placedLayerName) : null,
      docWasModified: d?.docWasModified === true,
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopExportProof(args: {
  appName?: string;
  outputPath: string;
  format?: 'png' | 'jpg' | 'jpeg';
  quality?: number;
  expectedDocumentName?: string | null;
  sourceDocumentPath?: string | null;
}): Promise<DesktopResult<PhotoshopExportProofResult>> {
  const guards = validatePhotoshopDocumentGuards(args);
  if (!guards.ok || !guards.data) return guards as DesktopResult<PhotoshopExportProofResult>;
  const { appName, expectedDocumentName, sourceDocumentPath } = guards.data;
  const outputPathResult = validateDesktopPath(String(args.outputPath || '').trim());
  if (!outputPathResult.ok) return { ok: false, error: outputPathResult.error, errorCode: 'invalid_input' };
  const format = String(args.format || '').trim().toLowerCase() || (
    /\.jpe?g$/i.test(outputPathResult.path) ? 'jpg' : 'png'
  );
  if (!['png', 'jpg', 'jpeg'].includes(format)) {
    return { ok: false, error: 'format must be png, jpg, or jpeg.', errorCode: 'invalid_input' };
  }
  const quality = Number.isFinite(Number(args.quality)) ? Math.max(1, Math.min(12, Math.trunc(Number(args.quality)))) : undefined;
  const grantHeaders = await ensureLocalFileGrantHeaders([outputPathResult.path], 'write', `Export Photoshop proof to ${outputPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<PhotoshopExportProofResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/photoshop_export_proof', {
    appName,
    outputPath: outputPathResult.path,
    format,
    quality,
    expectedDocumentName: expectedDocumentName || undefined,
    sourceDocumentPath: sourceDocumentPath || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<PhotoshopExportProofResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (expectedDocumentName || null),
      sourceDocumentPath: d?.sourceDocumentPath ? String(d.sourceDocumentPath) : (sourceDocumentPath || null),
      outputPath: d?.outputPath ? String(d.outputPath) : outputPathResult.path,
      format: d?.format ? String(d.format) : format,
      quality: d?.quality == null ? (quality ?? null) : toNumber(d.quality),
      widthPx: toNumber(d?.widthPx),
      heightPx: toNumber(d?.heightPx),
      fileExists: d?.fileExists === true,
      sizeBytes: toNumber(d?.sizeBytes),
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

// ─── Photoshop ExtendScript mutation adapters ──────────────────────────────
//
// Deterministic Photoshop mutations executed via AppleScript `do javascript`.
// Validation lives in `src/lib/photoshopExtendScriptAdapters.ts` (shared with
// the bridge's LOCKSTEP duplicate). All three verify the target document
// bridge-side and fail closed ('document_mismatch'), never save the document
// (saving stays a separate approval-gated step), and never delete pixels.

export type PhotoshopApplyAdjustmentLayerResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  kind: PhotoshopAdjustmentLayerKind;
  layerName: string | null;
  createdLayerName: string | null;
  layerCountBefore: number;
  layerCountAfter: number;
  error: string | null;
};

export type PhotoshopApplySelectionOrMaskResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  layerName: string | null;
  mode: PhotoshopSelectionMaskMode;
  selectionBounds: PhotoshopSelectionBoundsPx | null;
  maskApplied: boolean;
  error: string | null;
};

export type PhotoshopResizeCanvasOrImageResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  op: PhotoshopResizeOp;
  anchor: PhotoshopCanvasAnchor | null;
  widthPxBefore: number;
  heightPxBefore: number;
  widthPxAfter: number;
  heightPxAfter: number;
  error: string | null;
};

export async function photoshopApplyAdjustmentLayer(args: {
  appName?: string;
  targetDocumentName?: string | null;
  layerName?: string | null;
  kind: PhotoshopAdjustmentLayerKind;
  preserveExisting?: boolean;
}): Promise<DesktopResult<PhotoshopApplyAdjustmentLayerResult>> {
  const validated = validatePhotoshopApplyAdjustmentLayerParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_apply_adjustment_layer', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    layerName: params.layerName || undefined,
    kind: params.kind,
    preserveExisting: params.preserveExisting,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopApplyAdjustmentLayerResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      kind: params.kind,
      layerName: d?.layerName ? String(d.layerName) : (params.layerName || null),
      createdLayerName: d?.createdLayerName ? String(d.createdLayerName) : null,
      layerCountBefore: toNumber(d?.layerCountBefore),
      layerCountAfter: toNumber(d?.layerCountAfter),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopApplySelectionOrMask(args: {
  appName?: string;
  targetDocumentName?: string | null;
  layerName?: string | null;
  mode: PhotoshopSelectionMaskMode;
}): Promise<DesktopResult<PhotoshopApplySelectionOrMaskResult>> {
  const validated = validatePhotoshopApplySelectionOrMaskParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_apply_selection_or_mask', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    layerName: params.layerName || undefined,
    mode: params.mode,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopApplySelectionOrMaskResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const rawBounds = d?.selectionBounds;
  const selectionBounds: PhotoshopSelectionBoundsPx | null = rawBounds && typeof rawBounds === 'object'
    ? {
        left: toNumber(rawBounds.left),
        top: toNumber(rawBounds.top),
        right: toNumber(rawBounds.right),
        bottom: toNumber(rawBounds.bottom),
      }
    : null;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      layerName: d?.layerName ? String(d.layerName) : (params.layerName || null),
      mode: params.mode,
      selectionBounds,
      maskApplied: d?.maskApplied === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export async function photoshopResizeCanvasOrImage(args: {
  appName?: string;
  targetDocumentName?: string | null;
  op: PhotoshopResizeOp;
  widthPx?: number | null;
  heightPx?: number | null;
  anchor?: PhotoshopCanvasAnchor | null;
}): Promise<DesktopResult<PhotoshopResizeCanvasOrImageResult>> {
  const validated = validatePhotoshopResizeCanvasOrImageParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_resize_canvas_or_image', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    op: params.op,
    widthPx: params.widthPx == null ? undefined : params.widthPx,
    heightPx: params.heightPx == null ? undefined : params.heightPx,
    anchor: params.op === 'canvas_resize' ? params.anchor : undefined,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopResizeCanvasOrImageResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      op: params.op,
      anchor: params.op === 'canvas_resize' ? params.anchor : null,
      widthPxBefore: toNumber(d?.widthPxBefore),
      heightPxBefore: toNumber(d?.heightPxBefore),
      widthPxAfter: toNumber(d?.widthPxAfter),
      heightPxAfter: toNumber(d?.heightPxAfter),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type PhotoshopManageLayersResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  action: PhotoshopManageLayerAction;
  layerName: string | null;
  newName: string | null;
  position: PhotoshopLayerReorderPosition | null;
  referenceLayerName: string | null;
  resultLayerName: string | null;
  layerCountBefore: number;
  layerCountAfter: number;
  layerIndexBefore: number;
  layerIndexAfter: number;
  error: string | null;
};

/**
 * Rename, duplicate, reorder, or group ONE exact-named layer. Organizational
 * only: there is no delete/merge/flatten action, ambiguous layer names fail
 * closed ('layer_ambiguous'), and the document is never saved.
 */
export async function photoshopManageLayers(args: {
  appName?: string;
  targetDocumentName?: string | null;
  action: PhotoshopManageLayerAction;
  layerName: string;
  newName?: string | null;
  position?: PhotoshopLayerReorderPosition | null;
  referenceLayerName?: string | null;
}): Promise<DesktopResult<PhotoshopManageLayersResult>> {
  const validated = validatePhotoshopManageLayersParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_manage_layers', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    action: params.action,
    layerName: params.layerName,
    newName: params.newName || undefined,
    position: params.position || undefined,
    referenceLayerName: params.referenceLayerName || undefined,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopManageLayersResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      action: params.action,
      layerName: d?.layerName ? String(d.layerName) : (params.layerName || null),
      newName: params.newName || null,
      position: params.action === 'reorder' && params.position ? (params.position as PhotoshopLayerReorderPosition) : null,
      referenceLayerName: params.referenceLayerName || null,
      resultLayerName: d?.resultLayerName ? String(d.resultLayerName) : null,
      layerCountBefore: toNumber(d?.layerCountBefore),
      layerCountAfter: toNumber(d?.layerCountAfter),
      layerIndexBefore: toNumber(d?.layerIndexBefore),
      layerIndexAfter: toNumber(d?.layerIndexAfter),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type PhotoshopTransformLayerResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  layerName: string | null;
  op: PhotoshopTransformOp;
  boundsBefore: PhotoshopSelectionBoundsPx | null;
  boundsAfter: PhotoshopSelectionBoundsPx | null;
  error: string | null;
};

/**
 * Move (relative px), scale (uniform percent), or rotate (degrees) ONE
 * exact-named layer around its center. Background layers fail closed with
 * 'background_layer_locked' and locked layers with 'layer_locked'; the
 * receipt carries before/after pixel bounds as proof.
 */
export async function photoshopTransformLayer(args: {
  appName?: string;
  targetDocumentName?: string | null;
  layerName: string;
  op: PhotoshopTransformOp;
  deltaX?: number | null;
  deltaY?: number | null;
  scalePercent?: number | null;
  rotateDegrees?: number | null;
}): Promise<DesktopResult<PhotoshopTransformLayerResult>> {
  const validated = validatePhotoshopTransformLayerParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_transform_layer', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    layerName: params.layerName,
    op: params.op,
    deltaX: params.deltaX == null ? undefined : params.deltaX,
    deltaY: params.deltaY == null ? undefined : params.deltaY,
    scalePercent: params.scalePercent == null ? undefined : params.scalePercent,
    rotateDegrees: params.rotateDegrees == null ? undefined : params.rotateDegrees,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopTransformLayerResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const toBounds = (raw: unknown): PhotoshopSelectionBoundsPx | null => raw && typeof raw === 'object'
    ? {
        left: toNumber((raw as any).left),
        top: toNumber((raw as any).top),
        right: toNumber((raw as any).right),
        bottom: toNumber((raw as any).bottom),
      }
    : null;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      layerName: d?.layerName ? String(d.layerName) : (params.layerName || null),
      op: params.op,
      boundsBefore: toBounds(d?.boundsBefore),
      boundsAfter: toBounds(d?.boundsAfter),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type PhotoshopConvertColorModeResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  targetDocumentName: string | null;
  mode: PhotoshopColorMode;
  modeBefore: string | null;
  modeAfter: string | null;
  converted: boolean;
  error: string | null;
};

/**
 * Convert the document color mode (rgb / cmyk / grayscale) via
 * doc.changeMode. Reports an honest no-op (converted:false) when the document
 * is already in the requested mode. NOTE: CMYK/Grayscale conversion discards
 * color data in the working copy — reversible only until save, and this tool
 * NEVER saves (saving stays a separate approval-gated step).
 */
export async function photoshopConvertColorMode(args: {
  appName?: string;
  targetDocumentName?: string | null;
  mode: PhotoshopColorMode;
}): Promise<DesktopResult<PhotoshopConvertColorModeResult>> {
  const validated = validatePhotoshopConvertColorModeParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/photoshop_convert_color_mode', {
    appName: params.appName,
    targetDocumentName: params.targetDocumentName || undefined,
    mode: params.mode,
  });
  if (!r.ok) return r as DesktopResult<PhotoshopConvertColorModeResult>;
  const d = r.data as any;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      targetDocumentName: d?.targetDocumentName ? String(d.targetDocumentName) : (params.targetDocumentName || null),
      mode: params.mode,
      modeBefore: d?.modeBefore ? String(d.modeBefore) : null,
      modeAfter: d?.modeAfter ? String(d.modeAfter) : null,
      converted: d?.converted === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

// ─── Illustrator ExtendScript base pair ─────────────────────────────────────
//
// Same ExtendScript-via-AppleScript mechanism as the Photoshop tools.
// Validation lives in `src/lib/illustratorExtendScriptAdapters.ts` (shared
// with the bridge's LOCKSTEP duplicate). document_status is READ-ONLY;
// export_proof writes ONLY the export outputPath and never saves/closes/
// re-associates the source document (which is also why the format enum is
// png|svg — Illustrator can only write PDF via a source-document save-as).

export type IllustratorDocumentSummary = {
  name: string;
  path: string | null;
  modified: boolean;
  saved: boolean;
  widthPt: number;
  heightPt: number;
  artboardCount: number;
  layerCount: number;
  selectionCount: number;
};

export type IllustratorDocumentStatus = {
  appName: string | null;
  appRunning: boolean;
  status: string;
  documentCount: number;
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  widthPt: number;
  heightPt: number;
  artboardCount: number;
  layerCount: number;
  selectionCount: number;
  expectedDocumentName: string | null;
  documents: IllustratorDocumentSummary[];
  error: string | null;
};

export type IllustratorExportProofResult = {
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  expectedDocumentName: string | null;
  outputPath: string;
  outputFileName: string | null;
  format: string;
  scalePercent: number | null;
  fileExists: boolean;
  sizeBytes: number;
  docModified: boolean;
  docSaved: boolean;
  error: string | null;
};

/** READ-ONLY Illustrator observation — documents, artboards, layers, selection. */
export async function illustratorDocumentStatus(args: {
  appName?: string;
  expectedDocumentName?: string | null;
} = {}): Promise<DesktopResult<IllustratorDocumentStatus>> {
  const validated = validateIllustratorDocumentStatusParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/illustrator_document_status', {
    appName: params.appName,
    expectedDocumentName: params.expectedDocumentName || undefined,
  });
  if (!r.ok) return r as DesktopResult<IllustratorDocumentStatus>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const documents = Array.isArray(d?.documents)
    ? d.documents.slice(0, 12).map((doc: any) => ({
        name: doc?.name ? String(doc.name) : '',
        path: doc?.path ? String(doc.path) : null,
        modified: doc?.modified === true,
        saved: doc?.saved === true,
        widthPt: toNumber(doc?.widthPt),
        heightPt: toNumber(doc?.heightPt),
        artboardCount: toNumber(doc?.artboardCount),
        layerCount: toNumber(doc?.layerCount),
        selectionCount: toNumber(doc?.selectionCount),
      })).filter((doc: IllustratorDocumentSummary) => !!doc.name)
    : [];
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentCount: toNumber(d?.documentCount),
      activeDocumentName: d?.activeDocumentName ? String(d.activeDocumentName) : null,
      activeDocumentPath: d?.activeDocumentPath ? String(d.activeDocumentPath) : null,
      widthPt: toNumber(d?.widthPt),
      heightPt: toNumber(d?.heightPt),
      artboardCount: toNumber(d?.artboardCount),
      layerCount: toNumber(d?.layerCount),
      selectionCount: toNumber(d?.selectionCount),
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (params.expectedDocumentName || null),
      documents,
      error: d?.error ? String(d.error) : null,
    },
  };
}

/**
 * Export a PNG/SVG proof of the guarded Illustrator document to a NEW file.
 * Mutating (writes outputPath) — approval-gated like other local file
 * writes. The SOURCE document is never saved/closed/re-associated.
 */
export async function illustratorExportProof(args: {
  appName?: string;
  outputPath: string;
  format?: IllustratorExportProofFormat;
  scalePercent?: number;
  expectedDocumentName?: string | null;
}): Promise<DesktopResult<IllustratorExportProofResult>> {
  const validated = validateIllustratorExportProofParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const outputPathResult = validateDesktopPath(params.outputPath);
  if (!outputPathResult.ok) return { ok: false, error: outputPathResult.error, errorCode: 'invalid_input' };
  const grantHeaders = await ensureLocalFileGrantHeaders([outputPathResult.path], 'write', `Export Illustrator proof to ${outputPathResult.path}`);
  if (!grantHeaders.ok || !grantHeaders.data) return localFileGrantFailure<IllustratorExportProofResult>(grantHeaders);
  const r = await callBridge('POST', '/desktop/illustrator_export_proof', {
    appName: params.appName,
    outputPath: outputPathResult.path,
    format: params.format,
    scalePercent: params.scalePercent == null ? undefined : params.scalePercent,
    expectedDocumentName: params.expectedDocumentName || undefined,
  }, { headers: grantHeaders.data });
  if (!r.ok) return r as DesktopResult<IllustratorExportProofResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    ok: true,
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      documentName: d?.documentName ? String(d.documentName) : null,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (params.expectedDocumentName || null),
      outputPath: d?.outputPath ? String(d.outputPath) : outputPathResult.path,
      outputFileName: d?.outputFileName ? String(d.outputFileName) : null,
      format: d?.format ? String(d.format) : params.format,
      scalePercent: d?.scalePercent == null ? params.scalePercent : toNumber(d.scalePercent),
      fileExists: d?.fileExists === true,
      sizeBytes: toNumber(d?.sizeBytes),
      docModified: d?.docModified === true,
      docSaved: d?.docSaved === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type IllustratorTextFrameSummary = {
  index: number;
  name: string | null;
  layerName: string | null;
  charCount: number;
  locked: boolean;
  hidden: boolean;
  contentsTruncated: boolean;
  contents: string;
};

export type IllustratorTextInventory = {
  appName: string;
  appRunning: boolean;
  status: string;
  documentName: string | null;
  frameCount: number;
  truncated: boolean;
  frames: IllustratorTextFrameSummary[];
  expectedDocumentName: string | null;
  error: string | null;
};

/** READ-ONLY inventory of the document's text frames (name/layer/contents). */
export async function illustratorTextInventory(args: {
  appName?: string;
  expectedDocumentName?: string | null;
} = {}): Promise<DesktopResult<IllustratorTextInventory>> {
  const validated = validateIllustratorTextInventoryParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/illustrator_text_inventory', {
    appName: params.appName,
    expectedDocumentName: params.expectedDocumentName || undefined,
  });
  if (!r.ok) return r as DesktopResult<IllustratorTextInventory>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const frames: IllustratorTextFrameSummary[] = Array.isArray(d?.frames)
    ? d.frames.slice(0, 60).map((f: any) => ({
        index: toNumber(f?.index),
        name: f?.name ? String(f.name) : null,
        layerName: f?.layerName ? String(f.layerName) : null,
        charCount: toNumber(f?.charCount),
        locked: f?.locked === true,
        hidden: f?.hidden === true,
        contentsTruncated: f?.contentsTruncated === true,
        contents: typeof f?.contents === 'string' ? f.contents : '',
      }))
    : [];
  return {
    ok: d?.ok === true,
    ...(d?.ok === true ? {} : { error: d?.error ? String(d.error) : 'Illustrator text inventory failed.' }),
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentName: d?.documentName ? String(d.documentName) : null,
      frameCount: toNumber(d?.frameCount),
      truncated: d?.truncated === true,
      frames,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (params.expectedDocumentName || null),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type IllustratorLayerStateResult = {
  appName: string;
  appRunning: boolean;
  status: string;
  documentName: string | null;
  layerName: string | null;
  beforeVisible: boolean | null;
  beforeLocked: boolean | null;
  afterVisible: boolean | null;
  afterLocked: boolean | null;
  changed: boolean;
  expectedDocumentName: string | null;
  error: string | null;
};

/**
 * Show/hide/lock/unlock ONE exactly-named layer. Mutating — approval-gated by
 * the runtime. `ok` reflects the JSX's re-read after-state ("applied"), never
 * merely that the script ran; ambiguous/duplicate layer names fail closed.
 */
export async function illustratorSetLayerState(args: {
  appName?: string;
  expectedDocumentName?: string | null;
  layerName: string;
  visible?: boolean | null;
  locked?: boolean | null;
}): Promise<DesktopResult<IllustratorLayerStateResult>> {
  const validated = validateIllustratorSetLayerStateParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/illustrator_set_layer_state', {
    appName: params.appName,
    expectedDocumentName: params.expectedDocumentName || undefined,
    layerName: params.layerName,
    visible: params.visible === null ? undefined : params.visible,
    locked: params.locked === null ? undefined : params.locked,
  });
  if (!r.ok) return r as DesktopResult<IllustratorLayerStateResult>;
  const d = r.data as any;
  const nullableBool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
  return {
    ok: d?.ok === true,
    ...(d?.ok === true ? {} : { error: d?.error ? String(d.error) : 'Illustrator layer-state change was not applied.' }),
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentName: d?.documentName ? String(d.documentName) : null,
      layerName: d?.layerName ? String(d.layerName) : null,
      beforeVisible: nullableBool(d?.beforeVisible),
      beforeLocked: nullableBool(d?.beforeLocked),
      afterVisible: nullableBool(d?.afterVisible),
      afterLocked: nullableBool(d?.afterLocked),
      changed: d?.changed === true,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (params.expectedDocumentName || null),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type IllustratorUpdateTextResult = {
  appName: string;
  appRunning: boolean;
  status: string;
  documentName: string | null;
  target: string | null;
  beforeCharCount: number | null;
  afterCharCount: number | null;
  changed: boolean;
  expectedDocumentName: string | null;
  error: string | null;
};

/**
 * Replace the copy in ONE exactly-named text frame (or the frame on an
 * exactly-named layer). Mutating — approval-gated by the runtime. `ok` requires
 * the JSX's same-frame re-read to equal the requested copy; locked/hidden/
 * ambiguous targets fail closed. The source document is NEVER saved.
 */
export async function illustratorUpdateTextLayer(args: {
  appName?: string;
  expectedDocumentName?: string | null;
  target: string;
  text: string;
}): Promise<DesktopResult<IllustratorUpdateTextResult>> {
  const validated = validateIllustratorUpdateTextLayerParams(args);
  if (!validated.ok) {
    return { ok: false, error: validated.errors.join(' '), errorCode: 'invalid_input' };
  }
  const params = validated.params;
  const r = await callBridge('POST', '/desktop/illustrator_update_text_layer', {
    appName: params.appName,
    expectedDocumentName: params.expectedDocumentName || undefined,
    target: params.target,
    text: params.text,
  });
  if (!r.ok) return r as DesktopResult<IllustratorUpdateTextResult>;
  const d = r.data as any;
  const toNumber = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
  const nullableCount = (value: unknown): number | null => (value === null || value === undefined ? null : toNumber(value));
  return {
    ok: d?.ok === true,
    ...(d?.ok === true ? {} : { error: d?.error ? String(d.error) : 'Illustrator text update was not applied.' }),
    data: {
      appName: d?.appName ? String(d.appName) : params.appName,
      appRunning: d?.appRunning === true,
      status: d?.status ? String(d.status) : 'unknown',
      documentName: d?.documentName ? String(d.documentName) : null,
      target: d?.target ? String(d.target) : null,
      beforeCharCount: nullableCount(d?.beforeCharCount),
      afterCharCount: nullableCount(d?.afterCharCount),
      changed: d?.changed === true,
      expectedDocumentName: d?.expectedDocumentName ? String(d.expectedDocumentName) : (params.expectedDocumentName || null),
      error: d?.error ? String(d.error) : null,
    },
  };
}

export type MenuInventoryItem = {
  name: string;
  enabled: boolean;
  hasSubmenu: boolean;
  submenuItems?: string[];
};

export type MenuInventory = {
  appName: string;
  appRunning: boolean;
  menuTitle: string | null;
  menus: Array<{ title: string; items: MenuInventoryItem[] }>;
  menuCount: number;
  itemCount: number;
  truncated: boolean;
  error: string | null;
};

/**
 * READ-ONLY menu-bar catalog of a RUNNING app via System Events. Never clicks,
 * activates, focuses, or launches. The unknown-app discovery primitive: feeds
 * exact labels into desktop.menu_click instead of guessing them.
 */
export async function menuInventory(args: {
  appName: string;
  /** Deep-read one named top-level menu (adds submenu expansion). */
  menuTitle?: string;
}): Promise<DesktopResult<MenuInventory>> {
  const appName = String(args?.appName || '').trim();
  if (!appName) return { ok: false, error: 'appName is required.', errorCode: 'invalid_input' };
  const r = await callBridge('POST', '/desktop/menu_inventory', {
    appName,
    menuTitle: args?.menuTitle ? String(args.menuTitle).trim() : undefined,
  });
  if (!r.ok) return r as DesktopResult<MenuInventory>;
  const d = r.data as any;
  const menus = Array.isArray(d?.menus)
    ? d.menus.slice(0, 16).map((m: any) => ({
        title: m?.title ? String(m.title) : '',
        items: Array.isArray(m?.items)
          ? m.items.map((i: any) => ({
              name: i?.name ? String(i.name) : '',
              enabled: i?.enabled === true,
              hasSubmenu: i?.hasSubmenu === true,
              ...(Array.isArray(i?.submenuItems)
                ? { submenuItems: i.submenuItems.map((x: unknown) => String(x)).filter(Boolean).slice(0, 24) }
                : {}),
            })).filter((i: MenuInventoryItem) => !!i.name)
          : [],
      })).filter((m: { title: string }) => !!m.title)
    : [];
  return {
    ok: d?.ok === true,
    ...(d?.ok === true ? {} : { error: d?.error ? String(d.error) : 'Menu inventory failed.' }),
    data: {
      appName: d?.appName ? String(d.appName) : appName,
      appRunning: d?.appRunning === true,
      menuTitle: d?.menuTitle ? String(d.menuTitle) : null,
      menus,
      menuCount: Number.isFinite(Number(d?.menuCount)) ? Number(d.menuCount) : menus.length,
      itemCount: Number.isFinite(Number(d?.itemCount)) ? Number(d.itemCount) : 0,
      truncated: d?.truncated === true,
      error: d?.error ? String(d.error) : null,
    },
  };
}

// ─── Internals ────────────────────────────────────────────────────────────

async function callBridge(
  method: 'GET' | 'POST',
  pathname: string,
  body?: Record<string, unknown>,
  options?: {
    headers?: Record<string, string>;
    /**
     * When true, an HTTP-200 `ok:false` body is attached as `data` on the
     * failure result so callers can read structured diagnostics (e.g.
     * cad_compile's stderrTail/exitCode). Default off — existing callers
     * keep the lean failure shape.
     */
    attachBodyOnError?: boolean;
  },
): Promise<DesktopResult> {
  let token = readToken();
  // Auto-pair on first call — the bridge binds to localhost so a same-
  // origin fetch is the same trust boundary as the user's own shell.
  // Saves the user an explicit "Pair Desktop Bridge" tap on fresh
  // installs. No-op if already paired.
  if (!token) {
    const ensured = await ensureDesktopBridgePaired();
    if (!ensured.ok) return ensured;
    token = ensured.data!.token;
  }
  try {
    const base = getDesktopBridgeBaseUrl();
    if (!base) {
      return { ok: false, error: 'bridge unavailable in this environment', errorCode: 'bridge_offline' };
    }
    const send = (desktopToken: string) => fetch(`${base}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-UC-Desktop-Token': desktopToken,
        ...(options?.headers || {}),
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
    let res = await send(token);
    if (res.status === 401) {
      // Token files can rotate when the bridge is reinstalled/restarted.
      // Clear both caches, complete a fresh challenge, and replay once. Auth
      // rejection occurs before route dispatch, so POST replay is safe here.
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
      } catch {}
      await writeSecondaryToken(null);
      const paired = await pairDesktopBridge();
      if (!paired.ok || !paired.data?.token) return paired;
      token = paired.data.token;
      res = await send(token);
    }
    if (!res.ok) return failFromStatus(res.status, await safeText(res));
    const json = (await res.json()) as { ok?: boolean; error?: string; [k: string]: unknown };
    if (!json.ok) {
      // Honor explicit structured codes from the bridge body (e.g. the
      // PID-staleness guard's `a11y_path_stale`) instead of re-deriving
      // a code from prose and losing the machine-readable class.
      const explicitCode = normalizeExplicitBridgeBodyCode(json.errorCode);
      return {
        ok: false,
        error: json.error || `bridge returned ok:false`,
        errorCode: explicitCode || mapBodyErrorToCode(json.error),
        recoveryHint: typeof json.recoveryHint === 'string' ? json.recoveryHint : undefined,
        ...(options?.attachBodyOnError ? { data: json } : {}),
      };
    }
    return { ok: true, data: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'bridge unreachable', errorCode: 'bridge_offline' };
  }
}

function failFromStatus(status: number, bodyText: string): DesktopResult {
  if (status === 401) return { ok: false, error: 'Desktop token rejected — re-pair.', errorCode: 'not_paired' };
  if (status === 403) {
    const parsed = tryParseJsonError(bodyText);
    if (parsed && parsed.toLowerCase().includes('local file access')) {
      return { ok: false, error: parsed, errorCode: 'file_access_not_granted' };
    }
    return { ok: false, error: parsed || 'Origin blocked by bridge.', errorCode: parsed ? mapBodyErrorToCode(parsed) : 'origin_blocked' };
  }
  if (status === 501) return { ok: false, error: 'Bridge is on a platform that does not support desktop automation.', errorCode: 'platform_unsupported' };
  if (status === 400) {
    const parsed = tryParseJsonError(bodyText);
    return { ok: false, error: parsed || 'bad request', errorCode: mapBodyErrorToCode(parsed || '') };
  }
  if (status === 404) {
    const parsed = tryParseJsonError(bodyText);
    const message = parsed || bodyText || 'not found';
    return { ok: false, error: message, errorCode: mapBodyErrorToCode(message) };
  }
  if (status === 409) {
    const parsed = tryParseJsonError(bodyText);
    const message = parsed || bodyText || 'conflict';
    return { ok: false, error: message, errorCode: mapBodyErrorToCode(message) };
  }
  return { ok: false, error: bodyText || `HTTP ${status}`, errorCode: mapBodyErrorToCode(bodyText || '') };
}

// Structured codes the bridge sets explicitly in ok:false bodies.
// Kept to a whitelist so an arbitrary string can't masquerade as a
// typed DesktopBridgeError.
const EXPLICIT_BRIDGE_BODY_CODES = new Set<DesktopBridgeError>([
  'a11y_path_stale',
  'a11y_tree_empty',
  'helper_missing',
  'human_verification_required',
  'invalid_input',
  // E2/E3 bridge-issued codes. The canonical union lives in
  // desktopBridgeProtocol.ts; until it is extended there these ride
  // through as bridge-body codes (callers read errorCode as string).
  'index_stale' as DesktopBridgeError,
  'no_indexed_tree' as DesktopBridgeError,
  'region_out_of_bounds' as DesktopBridgeError,
  'native_semantic_target_blocked' as DesktopBridgeError,
  'native_semantic_target_stale' as DesktopBridgeError,
  'native_semantic_target_expired' as DesktopBridgeError,
  'native_semantic_target_replayed' as DesktopBridgeError,
  'native_semantic_dispatch_failed' as DesktopBridgeError,
  'native_semantic_verification_failed' as DesktopBridgeError,
  // /desktop/cad_compile bridge-issued codes (same rideshare posture).
  'engine_not_installed' as DesktopBridgeError,
  'cad_compile_failed' as DesktopBridgeError,
  'cad_compile_timeout' as DesktopBridgeError,
  'output_not_created' as DesktopBridgeError,
  // /desktop/design_export bridge-issued codes — engine_not_installed and
  // output_not_created above are shared with cad_compile.
  'design_export_failed' as DesktopBridgeError,
  'design_export_timeout' as DesktopBridgeError,
]);

function normalizeExplicitBridgeBodyCode(value: unknown): DesktopBridgeError | null {
  const code = String(value || '').trim().toLowerCase() as DesktopBridgeError;
  return EXPLICIT_BRIDGE_BODY_CODES.has(code) ? code : null;
}

function mapBodyErrorToCode(err: string | undefined | null): DesktopBridgeError {
  const m = String(err || '').toLowerCase();
  if (m.includes('unknown /desktop endpoint')) return 'stale_bridge';
  if (m.includes('local file access') || m.includes('file access grant')) return 'file_access_not_granted';
  if (m.includes('path_not_found') || m.includes('path does not exist') || m.includes('file or folder does not exist') || m.includes('no such file')) return 'path_not_found';
  if (m.includes('could not find an image') || m.includes('no file named') || m.includes('no file matches')) return 'file_not_found';
  if (m.includes('ambiguous_file_match') || m.includes('multiple images matched') || m.includes('multiple matches found')) return 'ambiguous_file_match';
  if (m.includes('app_not_found') || m.includes('app not found')) return 'app_not_found';
  if (m.includes('not allowed') || m.includes('permission')) return 'permission_denied';
  if (m.includes('timed out')) return 'timeout';
  if (m.includes('invalid')) return 'invalid_input';
  return 'unknown';
}

function tryParseJsonError(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch {}
  return null;
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}
