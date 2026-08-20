/**
 * Authenticated Office editor and Agent popup canary against the linked
 * Supabase project.
 *
 * The canary is deliberately opt-in because it creates a temporary user and
 * circle. It uses an ephemeral headless system-Chrome context rather than the
 * persistent browser bridge, exercises desktop and compact web editing, then
 * opens the built-in OpenSwan popup in two same-origin tabs for reduced-motion,
 * every advertised read-only route, 390px responsive-modal containment, focus,
 * and concurrent auth-refresh lifecycle proof. It deletes all temporary server
 * state in a finally block.
 *
 * Run:
 *   RUN_LIVE_OFFICE_E2E=1 \
 *   OFFICE_E2E_ALLOW_DISPOSABLE_FIXTURE=1 \
 *   OFFICE_E2E_EXPECTED_PROJECT_REF=<linked-project-ref> \
 *   OFFICE_E2E_EXPECTED_APP_ARTIFACT_SHA256=<64-lowercase-hex-digest> \
 *   node scripts/office-authenticated-local-e2e.mjs
 *
 * A non-local OFFICE_E2E_APP_URL additionally requires
 * RUN_REMOTE_OFFICE_E2E=1. These independent acknowledgements keep a generic
 * live flag or an accidentally linked .env from selecting an unintended
 * Supabase project or remote deployment for destructive fixture work.
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

if (process.env.RUN_LIVE_OFFICE_E2E !== '1') {
  throw new Error('Refusing live Office canary without RUN_LIVE_OFFICE_E2E=1.');
}

function readDotEnv() {
  if (!fs.existsSync('.env')) return {};
  return Object.fromEntries(
    fs.readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ''),
        ];
      }),
  );
}

const env = readDotEnv();
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error('Supabase public configuration is missing.');
if (new URL(supabaseUrl).protocol !== 'https:') throw new Error('Supabase URL must use HTTPS.');
const supabaseProjectRef = new URL(supabaseUrl).hostname.split('.')[0];
if (!/^[a-z0-9]{20}$/.test(supabaseProjectRef)) {
  throw new Error('Supabase project reference is malformed.');
}
const expectedProjectRef = process.env.OFFICE_E2E_EXPECTED_PROJECT_REF?.trim();
if (!expectedProjectRef || !/^[a-z0-9]{20}$/.test(expectedProjectRef)) {
  throw new Error('Set OFFICE_E2E_EXPECTED_PROJECT_REF to the exact linked Supabase project reference.');
}
if (expectedProjectRef !== supabaseProjectRef) {
  throw new Error(
    `Refusing Office canary project mismatch: expected ${expectedProjectRef}, linked ${supabaseProjectRef}.`,
  );
}
if (process.env.OFFICE_E2E_ALLOW_DISPOSABLE_FIXTURE !== '1') {
  throw new Error('Refusing disposable Supabase fixture without OFFICE_E2E_ALLOW_DISPOSABLE_FIXTURE=1.');
}

const appBaseUrl = (process.env.OFFICE_E2E_APP_URL || 'http://localhost:8081').replace(/\/$/, '');
const parsedAppUrl = new URL(appBaseUrl);
const isLocalAppTarget = parsedAppUrl.protocol === 'http:'
  && ['localhost', '127.0.0.1'].includes(parsedAppUrl.hostname);
if (
  parsedAppUrl.protocol !== 'https:'
  && !isLocalAppTarget
) {
  throw new Error('Office canary target must use HTTPS unless it is localhost.');
}
if (!isLocalAppTarget && process.env.RUN_REMOTE_OFFICE_E2E !== '1') {
  throw new Error('Refusing non-local Office target without RUN_REMOTE_OFFICE_E2E=1.');
}
const expectedAppArtifactSha256 = process.env.OFFICE_E2E_EXPECTED_APP_ARTIFACT_SHA256?.trim().toLowerCase();
if (!expectedAppArtifactSha256 || !/^[a-f0-9]{64}$/.test(expectedAppArtifactSha256)) {
  throw new Error(
    'Set OFFICE_E2E_EXPECTED_APP_ARTIFACT_SHA256 to the exact 64-character SHA-256 of the tested app entry artifact.',
  );
}

const marker = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const email = `openswan-office-e2e-${marker}@example.com`;
const password = `Aa9!${crypto.randomBytes(18).toString('base64url')}`;
const requestedArtifactDir = path.resolve(
  process.env.OFFICE_E2E_ARTIFACT_DIR || path.join(os.tmpdir(), 'openswan-office-e2e-artifacts'),
);
fs.mkdirSync(requestedArtifactDir, { recursive: true, mode: 0o700 });
const artifactDirStats = fs.lstatSync(requestedArtifactDir);
if (!artifactDirStats.isDirectory() || artifactDirStats.isSymbolicLink()) {
  throw new Error('Office canary artifact target must be a real directory, not a symlink.');
}
fs.accessSync(requestedArtifactDir, fs.constants.W_OK);
const artifactDir = fs.realpathSync(requestedArtifactDir);
const desktopScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-desktop.png`);
const mobileScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-mobile.png`);
const agentPopupScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-agent-popup.png`);
const desktopFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-desktop-failure.png`);
const mobileFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-mobile-failure.png`);
const agentPopupFirstFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-agent-popup-tab-a-failure.png`);
const agentPopupSecondFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-agent-popup-tab-b-failure.png`);

let userId = null;
let circleId = null;
let browser = null;
let cleanupComplete = false;
let cleanupPromise = null;
const diagnostics = [];
const liveRequestAbortController = new AbortController();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeReceipt(payload) {
  fs.writeSync(process.stdout.fd, `${JSON.stringify(payload)}\n`);
}

function progress(stage) {
  writeReceipt({ officeCanary: 'progress', stage });
}

async function settleWithin(promise, milliseconds, label) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} did not settle within ${milliseconds}ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function closePlaywrightResource(resource, label) {
  if (!resource) return;
  try {
    await settleWithin(resource.close(), 7_500, label);
  } catch (error) {
    progress(`${label}:forced-process-exit`);
  }
}

async function supabaseRequest(requestPath, init = {}) {
  const response = await fetch(`${supabaseUrl}${requestPath}`, {
    ...init,
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.any([
      liveRequestAbortController.signal,
      AbortSignal.timeout(15_000),
    ]),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${requestPath} returned ${response.status}: ${detail.slice(0, 240)}`);
  }
  return body;
}

function resolveManagementAccessToken() {
  const fromEnvironment = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnvironment) return fromEnvironment;
  if (process.platform !== 'darwin') {
    throw new Error(
      'Set SUPABASE_ACCESS_TOKEN before running this live canary outside macOS.',
    );
  }
  try {
    const fromKeychain = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-w'],
      {
        encoding: 'utf8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (fromKeychain) return fromKeychain;
  } catch {
    // The canary fails before signup below, so missing cleanup authority never
    // leaves a disposable user behind.
  }
  throw new Error(
    'Supabase cleanup authority is unavailable. Authenticate the Supabase CLI or set SUPABASE_ACCESS_TOKEN.',
  );
}

const managementAccessToken = resolveManagementAccessToken();

async function managementDatabaseQuery(query) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        `https://api.supabase.com/v1/projects/${supabaseProjectRef}/database/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${managementAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const raw = await response.text();
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      if (response.ok) return body;
      const detail = typeof body === 'string' ? body : JSON.stringify(body);
      const error = new Error(`Supabase management query returned ${response.status}: ${detail.slice(0, 240)}`);
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      const status = Number(String(error?.message || '').match(/returned (\d{3})/)?.[1]);
      if (Number.isFinite(status) && ![408, 429, 500, 502, 503, 504].includes(status)) throw error;
    }
    if (attempt < 2) await delay(750 * (attempt + 1));
  }
  throw lastError || new Error('Supabase management query failed without a result.');
}

function isOfficeCanaryEssentialRequest(requestUrl) {
  return requestUrl.startsWith(appBaseUrl)
    || /\/auth\/v1\//i.test(requestUrl)
    || /\/rest\/v1\/office_layouts(?:\?|$)|\/rest\/v1\/rpc\/save_office_layout_v2(?:\?|$)/i.test(requestUrl);
}

const POPUP_CONSOLE_ERROR_ALLOWLIST = Object.freeze([
  {
    id: 'missing-favicon',
    message: /^Failed to load resource: the server responded with a status of 404\b/i,
    url: /\/favicon\.ico(?:\?|$)/i,
  },
]);

function classifyAllowedPopupConsoleError(text, location) {
  const url = String(location?.url || '');
  return POPUP_CONSOLE_ERROR_ALLOWLIST.find((entry) => (
    entry.message.test(text) && entry.url.test(url)
  ))?.id || null;
}

function attachDiagnostics(page, viewport) {
  const record = {
    viewport,
    pageErrors: [],
    consoleErrors: [],
    consoleErrorDetails: [],
    consoleErrorReads: [],
    failedRequests: [],
    serverErrors: [],
    layoutResponses: [],
    layoutResponseReads: [],
    supabaseHosts: new Set(),
    bundleIdentity: null,
    failureScreenshot: null,
    popupConsoleCaptureActive: false,
    popupConsoleErrors: [],
    popupAllowedConsoleErrors: [],
    popupSectionErrors: [],
  };
  diagnostics.push(record);
  page.on('pageerror', (error) => record.pageErrors.push(String(error?.message || error).slice(0, 500)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text().slice(0, 500);
    record.consoleErrors.push(text);
    const detailRead = Promise.all(message.args().map(async (argument) => {
      try {
        const value = await argument.jsonValue();
        if (typeof value === 'string') return value.slice(0, 2_000);
        const serialized = JSON.stringify(value);
        return (serialized === undefined ? String(value) : serialized).slice(0, 2_000);
      } catch {
        return argument.toString().slice(0, 2_000);
      }
    })).then((args) => {
      record.consoleErrorDetails.push({ text, args });
    });
    record.consoleErrorReads.push(detailRead);
    if (!record.popupConsoleCaptureActive) return;
    const location = message.location();
    const evidence = {
      text,
      url: String(location?.url || '').slice(0, 500),
      lineNumber: Number(location?.lineNumber) || 0,
      columnNumber: Number(location?.columnNumber) || 0,
    };
    const allowlistId = classifyAllowedPopupConsoleError(text, location);
    if (allowlistId) record.popupAllowedConsoleErrors.push({ ...evidence, allowlistId });
    else record.popupConsoleErrors.push(evidence);
  });
  page.on('requestfailed', (request) => {
    record.failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.slice(0, 700));
  });
  page.on('request', (request) => {
    try {
      const hostname = new URL(request.url()).hostname;
      if (hostname.endsWith('.supabase.co')) record.supabaseHosts.add(hostname);
    } catch {
      // Non-URL browser resources are irrelevant to project identity.
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 500 && isOfficeCanaryEssentialRequest(response.url())) {
      record.serverErrors.push(`${response.status()} ${response.url()}`.slice(0, 700));
    }
    if (/save_office_layout_v2/i.test(response.url())) {
      const bodyRead = response.text().then((body) => {
        record.layoutResponses.push(`${response.status()} ${body.slice(0, 300)}`);
      }).catch(() => {
        record.layoutResponses.push(`${response.status()} body-unavailable`);
      });
      record.layoutResponseReads.push(bodyRead);
    }
  });
  return record;
}

function assertNoReactUpdateLoopErrors(record, label) {
  const updateLoopPattern = /Maximum update depth exceeded|Too many re-renders/i;
  const failures = [...record.pageErrors, ...record.consoleErrors]
    .filter((message) => updateLoopPattern.test(message));
  if (failures.length > 0) {
    throw new Error(`${label} observed a React update loop: ${JSON.stringify(failures.slice(0, 3))}.`);
  }
}

async function readBundleIdentity(page) {
  const resources = await page.evaluate(() => {
    const byKey = new Map();
    for (const entry of performance.getEntriesByType('resource')) {
      try {
        const url = new URL(entry.name);
        if (url.origin !== location.origin) continue;
        if (!url.pathname.includes('/_expo/static/js/web/') && !/\.bundle$/i.test(url.pathname)) continue;
        const key = `${url.pathname}${url.search}`;
        byKey.set(key, { key, url: url.href, pathname: url.pathname });
      } catch {
        // Non-URL browser resources cannot identify the tested app artifact.
      }
    }
    return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
  });
  if (resources.length === 0) throw new Error('Office canary observed no Expo web bundle resources.');
  const entryResources = resources.filter((resource) => (
    /\/(?:index|__common)-[^/]+\.js$/i.test(resource.pathname)
    || /\/index(?:\.[cm]?[jt]sx?)?\.bundle$/i.test(resource.pathname)
  ));
  if (entryResources.length === 0) {
    throw new Error('Office canary observed no exact Expo entry resource to bind as the tested app artifact.');
  }
  const entryContentBindings = await page.evaluate(async (entries) => {
    const toHex = (bytes) => Array.from(new Uint8Array(bytes))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return Promise.all(entries.map(async (entry) => {
      const response = await fetch(entry.url, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`App entry artifact ${entry.key} returned ${response.status}.`);
      const body = await response.arrayBuffer();
      return {
        key: entry.key,
        contentSha256: toHex(await crypto.subtle.digest('SHA-256', body)),
        byteLength: body.byteLength,
      };
    }));
  }, entryResources);
  const artifactBinding = entryContentBindings
    .map((entry) => `${entry.key}\0${entry.contentSha256}\0${entry.byteLength}`)
    .join('\n');
  return {
    resourceManifestSha256: crypto.createHash('sha256').update(resources.map((entry) => entry.key).join('\n')).digest('hex'),
    appArtifactSha256: crypto.createHash('sha256').update(artifactBinding).digest('hex'),
    resourceCount: resources.length,
    entryResources: entryContentBindings.slice(0, 8),
  };
}

function assertExpectedAppArtifact(identity, label) {
  if (identity?.appArtifactSha256 !== expectedAppArtifactSha256) {
    throw new Error(
      `${label} app artifact mismatch: expected ${expectedAppArtifactSha256}, observed ${identity?.appArtifactSha256 || 'none'}.`,
    );
  }
}

async function preflightExpectedAppArtifact() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await context.newPage();
  try {
    await page.goto(`${appBaseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => {
      try {
        const url = new URL(entry.name);
        return url.pathname.includes('/_expo/static/js/web/') || /\.bundle$/i.test(url.pathname);
      } catch {
        return false;
      }
    }), undefined, { timeout: 30_000 });
    const identity = await readBundleIdentity(page);
    assertExpectedAppArtifact(identity, 'Preflight');
    return identity;
  } finally {
    await closePlaywrightResource(context, 'app-artifact-preflight-context-close');
  }
}

async function settleFailureEvidence(page, record, screenshotPath) {
  await settleWithin(Promise.allSettled(record?.layoutResponseReads || []), 5_000, 'layout diagnostics')
    .catch(() => undefined);
  if (!page || page.isClosed()) return;
  await settleWithin(page.screenshot({ path: screenshotPath, fullPage: true }), 7_500, 'failure screenshot')
    .then(() => { record.failureScreenshot = screenshotPath; })
    .catch(() => undefined);
}

async function dismissTutorial(page) {
  const skip = page.getByText(/^skip tutorial$/i).last();
  if (await skip.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await skip.click();
    await delay(500);
  }
}

async function openAuthenticatedOffice(context, session, viewportName, options = {}) {
  const seedSession = options.seedSession !== false;
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const record = attachDiagnostics(page, viewportName);
  const storageKey = `sb-${supabaseProjectRef}-auth-token`;
  if (seedSession) {
    await page.goto(`${appBaseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    const storedSession = {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    };
    await page.evaluate(({ key, value }) => {
      localStorage.setItem(key, value);
    }, { key: storageKey, value: JSON.stringify(storedSession) });
  }
  await page.goto(`${appBaseUrl}/circle/${circleId}/office`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await dismissTutorial(page);
  await page.getByTestId('office-workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
  await dismissTutorial(page);
  const observedRoute = new URL(page.url());
  if (
    observedRoute.origin !== parsedAppUrl.origin
    || observedRoute.pathname !== `/circle/${circleId}/office`
  ) {
    throw new Error(`Office route did not remain authoritative: ${page.url()}`);
  }
  const expectedSupabaseHost = new URL(supabaseUrl).hostname;
  const observedSupabaseHosts = [...record.supabaseHosts].sort();
  if (
    !observedSupabaseHosts.includes(expectedSupabaseHost)
    || observedSupabaseHosts.some((hostname) => hostname !== expectedSupabaseHost)
  ) {
    throw new Error(
      `Office app Supabase project mismatch: expected ${expectedSupabaseHost}; observed ${observedSupabaseHosts.join(', ') || 'none'}.`,
    );
  }
  record.bundleIdentity = await readBundleIdentity(page);
  assertExpectedAppArtifact(record.bundleIdentity, viewportName);
  return { page, record };
}

async function openEditor(page) {
  const editor = page.getByTestId('office-editor-open');
  if (!await editor.isVisible({ timeout: 1_000 }).catch(() => false)) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const officeTools = page.getByLabel('Office tools', { exact: true });
        if (await officeTools.getAttribute('aria-expanded') !== 'true') await officeTools.click();
        const addItems = page.getByLabel('Add Items', { exact: true });
        await addItems.waitFor({ state: 'visible' });
        await addItems.click();
        if (await editor.isVisible({ timeout: 5_000 }).catch(() => false)) break;
        throw new Error('The Office Add Items action had no observable effect.');
      } catch (error) {
        if (attempt === 2) {
          throw new Error(`The Office Add Items action did not open the editor: ${error instanceof Error ? error.message : String(error)}`);
        }
        progress('office:editor-open-safe-retry');
      }
    }
  }
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('office-catalog-ready').waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByLabel('Search Office items', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function placedTypeCount(page, type) {
  return page.locator(`[data-office-addon-type="${type}"]`).count();
}

async function placeCompactCatalogItemWithOneSafeRetry(page, type) {
  const beforeCount = await placedTypeCount(page, type);
  const searchText = type.split('_').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await openEditor(page);
      const search = page.getByLabel('Search Office items', { exact: true });
      // Own the complete semantic precondition on every attempt. Clearing
      // first guarantees React receives a fresh search transition.
      await search.fill('');
      await search.fill(searchText);
      const control = page.getByTestId(`office-catalog-item-${type}`);
      await control.waitFor({ state: 'visible', timeout: 15_000 });
      // React Native Web can replace a filtered ScrollView child immediately
      // after the input event. Two paint frames establish the current semantic
      // target before asking Playwright to activate it.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await control.click({ timeout: 7_500 });
      await page.waitForFunction(
        ({ type: expectedType, before }) => document.querySelectorAll(`[data-office-addon-type="${expectedType}"]`).length > before,
        { type, before: beforeCount },
        { timeout: 15_000 },
      );
      return attempt;
    } catch (error) {
      if (await placedTypeCount(page, type) > beforeCount) return attempt;
      if (attempt === 2) {
        const state = await page.evaluate(({ type: expectedType }) => ({
          editorOpen: Boolean(document.querySelector('[data-testid="office-editor-open"]')),
          catalogReady: Boolean(document.querySelector('[data-testid="office-catalog-ready"]')),
          itemPresent: Boolean(document.querySelector(`[data-testid="office-catalog-item-${expectedType}"]`)),
          placedCount: document.querySelectorAll(`[data-office-addon-type="${expectedType}"]`).length,
          activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('data-testid') || null,
        }), { type });
        throw new Error(`Compact ${type} placement had no observable effect after one safe retry: ${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(state)}`);
      }
      progress(`mobile:${type}-placement-safe-retry`);
    }
  }
  throw new Error(`Could not place ${type} through the compact Office catalog.`);
}

async function findVisibleUnobstructedCanvasPosition(page, canvas, preferred = { x: 0.5, y: 0.5 }) {
  const result = await canvas.evaluate((element, desired) => {
    const rect = element.getBoundingClientRect();
    const inset = 18;
    const left = Math.max(rect.left + inset, 0);
    const right = Math.min(rect.right - inset, window.innerWidth);
    const top = Math.max(rect.top + inset, 0);
    const bottom = Math.min(rect.bottom - inset, window.innerHeight);
    if (right <= left || bottom <= top) return null;

    const preferredX = Math.max(left, Math.min(right, rect.left + rect.width * desired.x));
    const preferredY = Math.max(top, Math.min(bottom, rect.top + rect.height * desired.y));
    const fractions = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
    const candidates = [
      { clientX: preferredX, clientY: preferredY },
      ...fractions.flatMap((yFraction) => fractions.map((xFraction) => ({
        clientX: left + (right - left) * xFraction,
        clientY: top + (bottom - top) * yFraction,
      }))),
    ];
    for (const point of candidates) {
      const hit = document.elementFromPoint(point.clientX, point.clientY);
      if (!hit || !(hit === element || element.contains(hit))) continue;
      if (hit.closest?.('[data-office-addon-type]')) continue;
      return {
        x: point.clientX - rect.left,
        y: point.clientY - rect.top,
        clientX: point.clientX,
        clientY: point.clientY,
        hitTestId: hit.closest?.('[data-testid]')?.getAttribute('data-testid') || null,
        hitAriaLabel: hit.closest?.('[aria-label]')?.getAttribute('aria-label') || null,
      };
    }
    return null;
  }, preferred);
  if (!result) throw new Error('No visible unobstructed point on the Office floor was actionable.');
  return result;
}

async function placeDesktopCatalogItem(page, canvas, type, searchText, position) {
  const before = await readPlacedAddonGeometry(page, type);
  const search = page.getByLabel('Search Office items', { exact: true });
  await page.getByTestId('office-catalog-scope-all').click();
  await search.fill('');
  await search.fill(searchText);
  const catalogItem = page.getByTestId(`office-catalog-item-${type}`);
  await catalogItem.waitFor({ state: 'visible', timeout: 15_000 });
  await catalogItem.click();
  await catalogItem.evaluate((element) => element.getAttribute('aria-pressed') === 'true')
    .then(async (armed) => {
      if (!armed) {
        await page.waitForFunction(
          ({ expectedType }) => document.querySelector(`[data-testid="office-catalog-item-${expectedType}"]`)?.getAttribute('aria-pressed') === 'true',
          { expectedType: type },
          { timeout: 7_500 },
        );
      }
    });
  const actionablePosition = await findVisibleUnobstructedCanvasPosition(page, canvas, position);
  await canvas.click({ position: actionablePosition });
  await page.waitForFunction(
    ({ expectedType, count }) => document.querySelectorAll(`[data-office-addon-type="${expectedType}"]`).length === count + 1,
    { expectedType: type, count: before.length },
    { timeout: 15_000 },
  );
  const after = await readPlacedAddonGeometry(page, type);
  const priorIds = new Set(before.map((entry) => entry.id));
  const added = after.find((entry) => !priorIds.has(entry.id));
  if (!added?.id) throw new Error(`${type} placement did not expose one new exact item identity.`);
  return added;
}

function countLayoutType(layout, type) {
  if (!layout || !Array.isArray(layout.floors)) return 0;
  return layout.floors.reduce((count, floor) => (
    count + (Array.isArray(floor?.furniture)
      ? floor.furniture.filter((item) => item?.type === type).length
      : 0)
  ), 0);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function layoutFingerprint(layout) {
  return JSON.stringify(canonicalJson(layout));
}

function userOwnedLayoutSurfaceFingerprint(layout) {
  return layoutFingerprint(layout ? {
    currentFloorId: layout.currentFloorId,
    floors: (layout.floors || []).map(({ agentIds, ...floor }) => (
      floor.agentAssignmentMode === 'manual' ? { ...floor, agentIds } : floor
    )),
  } : null);
}

function localLayoutFromEnvelope(envelope) {
  return envelope ? {
    floors: envelope.floors,
    currentFloorId: envelope.currentFloorId,
    updatedAt: envelope.updatedAt,
  } : null;
}

function assertExactLocalServerLayout(envelope, row, label) {
  if (Number(envelope?.updatedAt) !== Number(row?.layout_version)) {
    throw new Error(`${label}: local and server layout versions differ.`);
  }
  if (layoutFingerprint(localLayoutFromEnvelope(envelope)) !== layoutFingerprint(row?.layout)) {
    throw new Error(`${label}: local and authenticated server layout payloads differ.`);
  }
}

async function readLocalOfficeLayoutEnvelope(page) {
  const key = `@office_layout_cache_v2:${userId}:${circleId}`;
  return page.evaluate((storageKey) => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  }, key);
}

async function readPlacedAddonGeometry(page, type) {
  return page.locator(`[data-office-addon-type="${type}"]`).evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-office-addon-id'),
    x: Number(element.getAttribute('data-office-addon-x')),
    y: Number(element.getAttribute('data-office-addon-y')),
    width: Number(element.getAttribute('data-office-addon-width')),
    height: Number(element.getAttribute('data-office-addon-height')),
    rotation: Number(element.getAttribute('data-office-addon-rotation')),
  })).sort((left, right) => String(left.id).localeCompare(String(right.id))));
}

async function waitForPlacedAddonGeometry(page, type, id, predicate, failureMessage) {
  const deadline = Date.now() + 15_000;
  let lastGeometry = null;
  while (Date.now() < deadline) {
    const geometries = await readPlacedAddonGeometry(page, type);
    lastGeometry = geometries.find((entry) => entry.id === id) || null;
    if (lastGeometry && predicate(lastGeometry)) return lastGeometry;
    await delay(100);
  }
  throw new Error(`${failureMessage} Last geometry: ${JSON.stringify(lastGeometry)}.`);
}

async function dragLocatorByFloorDelta(page, canvas, locator, dx, dy) {
  const [canvasBox, targetBox] = await Promise.all([canvas.boundingBox(), locator.boundingBox()]);
  if (!canvasBox || !targetBox) throw new Error('Pointer target is not visible on the Office floor.');
  const scale = canvasBox.width / 900;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Office floor scale is invalid.');
  const startX = targetBox.x + targetBox.width / 2;
  const startY = targetBox.y + targetBox.height / 2;
  let pressed = false;
  try {
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });
    pressed = true;
    await page.mouse.move(startX + dx * scale, startY + dy * scale, { steps: 8 });
  } finally {
    if (pressed) await page.mouse.up({ button: 'left' });
  }
}

async function preparePointerTrace(locator, traceKey) {
  return locator.evaluate((element, key) => {
    const target = element;
    const rect = target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    const trace = [];
    window[key] = trace;
    const describe = (node) => ({
      tag: node?.tagName || null,
      testId: node?.getAttribute?.('data-testid') || null,
      nearestTestId: node?.closest?.('[data-testid]')?.getAttribute?.('data-testid') || null,
      officeType: node?.getAttribute?.('data-office-addon-type') || null,
      nearestOfficeType: node?.closest?.('[data-office-addon-type]')?.getAttribute?.('data-office-addon-type') || null,
      ariaLabel: node?.getAttribute?.('aria-label') || null,
      className: typeof node?.className === 'string' ? node.className.slice(0, 160) : null,
      text: typeof node?.textContent === 'string' ? node.textContent.trim().slice(0, 120) : null,
      ancestors: Array.from({ length: 5 }).reduce((entries, _, index) => {
        const ancestor = index === 0 ? node?.parentElement : entries[index - 1]?.node?.parentElement;
        if (!ancestor) return entries;
        entries.push({
          node: ancestor,
          tag: ancestor.tagName,
          testId: ancestor.getAttribute('data-testid'),
          ariaLabel: ancestor.getAttribute('aria-label'),
          className: typeof ancestor.className === 'string' ? ancestor.className.slice(0, 120) : null,
        });
        return entries;
      }, []).map(({ node: _node, ...entry }) => entry),
    });
    const record = (scope) => (event) => {
      if (trace.length >= 80) return;
      trace.push({
        scope,
        type: event.type,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        target: describe(event.target),
      });
    };
    const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'];
    types.forEach((type) => {
      target.addEventListener(type, record('handle-capture'), { capture: true });
      document.addEventListener(type, record('document-capture'), { capture: true });
    });
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: describe(hit),
      target: describe(target),
      hitInsideTarget: !!hit && (hit === target || target.contains(hit)),
      pointerEvents: getComputedStyle(target).pointerEvents,
      visibility: getComputedStyle(target).visibility,
    };
  }, traceKey);
}

async function readPointerTrace(page, traceKey) {
  return page.evaluate((key) => window[key] || [], traceKey);
}

async function readPersistedOfficeLayout(accessToken) {
  const query = new URLSearchParams({
    select: 'layout,layout_version',
    user_id: `eq.${userId}`,
    circle_id: `eq.${circleId}`,
    limit: '1',
  });
  const requestPath = `/rest/v1/office_layouts?${query.toString()}`;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await supabaseRequest(requestPath, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const transient = error?.name === 'TimeoutError'
        || error?.name === 'TypeError'
        || /returned (408|429|500|502|503|504):/i.test(message);
      if (!transient || liveRequestAbortController.signal.aborted || attempt === 1) throw error;
      progress('office-layout-read:transient-safe-retry');
      await delay(400);
    }
  }
  throw lastError || new Error('Office layout read failed without a result.');
}

async function countUserTerminalCommands(accessToken) {
  const query = new URLSearchParams({
    select: 'id',
    circle_id: `eq.${circleId}`,
    sender_id: `eq.${userId}`,
  });
  const rows = await supabaseRequest(`/rest/v1/office_terminal_messages?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!Array.isArray(rows)) throw new Error('Terminal command evidence did not return a row list.');
  return rows.length;
}

async function waitForConvergedOfficeLayout(page, accessToken, predicate, failureMessage) {
  const deadline = Date.now() + 30_000;
  let lastLocalVersion = null;
  let lastServerVersion = null;
  let lastPayloadsMatched = false;
  let lastRow = null;
  let lastEnvelope = null;
  while (Date.now() < deadline) {
    const row = await readPersistedOfficeLayout(accessToken);
    const envelope = await readLocalOfficeLayoutEnvelope(page);
    lastRow = row;
    lastEnvelope = envelope;
    lastLocalVersion = Number.isFinite(Number(envelope?.updatedAt)) ? Number(envelope.updatedAt) : null;
    lastServerVersion = Number.isFinite(Number(row?.layout_version)) ? Number(row.layout_version) : null;
    lastPayloadsMatched = Boolean(
      envelope
      && row
      && layoutFingerprint(localLayoutFromEnvelope(envelope)) === layoutFingerprint(row.layout),
    );
    if (
      row
      && predicate(row)
      && lastLocalVersion === lastServerVersion
      && lastPayloadsMatched
    ) return { row, envelope };
    await delay(750);
  }
  const saveState = await page.evaluate(() => {
    const status = document.querySelector('[data-testid="office-layout-save-status"]');
    return {
      text: status?.textContent?.trim().slice(0, 160) || null,
      label: status?.getAttribute('aria-label') || null,
    };
  }).catch(() => ({ text: null, label: null }));
  const summarizeLayout = (layout) => ({
    currentFloorId: layout?.currentFloorId || null,
    floors: Array.isArray(layout?.floors) ? layout.floors.map((floor) => ({
      id: floor?.id || null,
      agentAssignmentMode: floor?.agentAssignmentMode || null,
      agentIds: Array.isArray(floor?.agentIds) ? floor.agentIds.slice(0, 8) : [],
      furniture: Array.isArray(floor?.furniture)
        ? floor.furniture.map((item) => `${item?.type || 'unknown'}:${item?.id || 'missing'}`).slice(0, 20)
        : [],
    })) : [],
  });
  throw new Error(
    `${failureMessage} Last local version: ${lastLocalVersion ?? 'none'}; `
    + `server version: ${lastServerVersion ?? 'none'}; exact payload match: ${lastPayloadsMatched}; `
    + `save state: ${JSON.stringify(saveState)}; local: ${JSON.stringify(summarizeLayout(localLayoutFromEnvelope(lastEnvelope)))}; `
    + `server: ${JSON.stringify(summarizeLayout(lastRow?.layout))}.`,
  );
}

async function verifyPersistedDeskLayout(
  page,
  accessToken,
  { expectedFloorCount = 1, minimumVersionExclusive = 0, expectedDesks = null } = {},
) {
  const localStorageKey = `@office_layout_cache_v2:${userId}:${circleId}`;
  await page.waitForFunction(({ key, expectedFloorCount: expectedCount, userId: expectedUserId, circleId: expectedCircleId, minimumVersion }) => {
    try {
      const envelope = JSON.parse(localStorage.getItem(key) || 'null');
      return envelope?.schemaVersion === 2
        && envelope?.userId === expectedUserId
        && envelope?.circleId === expectedCircleId
        && Number(envelope?.updatedAt) > minimumVersion
        && Array.isArray(envelope?.floors)
        && envelope.floors.length === expectedCount
        && envelope.floors.reduce((count, floor) => count + (
          Array.isArray(floor?.furniture)
            ? floor.furniture.filter((item) => item?.type === 'desk').length
            : 0
        ), 0) === 2;
    } catch {
      return false;
    }
  }, {
    key: localStorageKey,
    expectedFloorCount,
    userId,
    circleId,
    minimumVersion: minimumVersionExclusive,
  }, { timeout: 30_000 });

  const { row, envelope } = await waitForConvergedOfficeLayout(
    page,
    accessToken,
    (candidate) => (
      candidate
      && Array.isArray(candidate.layout?.floors)
      && candidate.layout.floors.length === expectedFloorCount
      && countLayoutType(candidate.layout, 'desk') === 2
      && Number(candidate.layout_version) > minimumVersionExclusive
    ),
    'The exact two-desk layout was not durably visible through authenticated Office storage.',
  );
  assertExactLocalServerLayout(envelope, row, 'Desk layout verification');
  if (expectedDesks) {
    const actualDesks = envelope?.floors?.flatMap((floor) => floor?.furniture || [])
      .filter((item) => item?.type === 'desk')
      .map((item) => ({
        id: item.id,
        x: item.x,
        y: item.y,
        width: item.itemWidth,
        height: item.itemHeight,
        rotation: item.rotation || 0,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    if (layoutFingerprint(actualDesks) !== layoutFingerprint(expectedDesks)) {
      throw new Error('The exact moved, rotated, and duplicated Desk geometry was not persisted.');
    }
  }
  return Number(row.layout_version);
}

// Keep this exact set aligned with OFFICE_ROOM_KITS.focus_lab. The canary
// verifies the whole template, not merely a six-item count.
const focusLabTypes = ['focus_candle', 'plant', 'pomodoro_room', 'progress_bar', 'rug', 'standingdesk'];

async function verifyPersistedFocusLab(page, accessToken, floorId, minimumVersionExclusive) {
  const localStorageKey = `@office_layout_cache_v2:${userId}:${circleId}`;
  await page.waitForFunction(({ key, floorId: expectedFloorId, expectedTypes, userId: expectedUserId, circleId: expectedCircleId, minimumVersion }) => {
    try {
      const envelope = JSON.parse(localStorage.getItem(key) || 'null');
      const floor = envelope?.floors?.find((entry) => entry?.id === expectedFloorId);
      const firstFloor = envelope?.floors?.find((entry) => entry?.id === 'floor_1');
      const types = Array.isArray(floor?.furniture) ? floor.furniture.map((item) => item?.type).sort() : [];
      const firstFloorDeskCount = Array.isArray(firstFloor?.furniture)
        ? firstFloor.furniture.filter((item) => item?.type === 'desk').length
        : 0;
      return envelope?.schemaVersion === 2
        && envelope?.userId === expectedUserId
        && envelope?.circleId === expectedCircleId
        && Number(envelope?.updatedAt) > minimumVersion
        && envelope?.currentFloorId === expectedFloorId
        && envelope?.floors?.length === 2
        && firstFloorDeskCount === 2
        && floor?.name === 'QA Focus Lab'
        && JSON.stringify(types) === JSON.stringify([...expectedTypes].sort());
    } catch { return false; }
  }, {
    key: localStorageKey,
    floorId,
    expectedTypes: focusLabTypes,
    userId,
    circleId,
    minimumVersion: minimumVersionExclusive,
  }, { timeout: 30_000 });

  const { row, envelope } = await waitForConvergedOfficeLayout(
    page,
    accessToken,
    (candidate) => {
      const floor = candidate.layout?.floors?.find((entry) => entry?.id === floorId);
      const types = Array.isArray(floor?.furniture) ? floor.furniture.map((item) => item?.type).sort() : [];
      return Number(candidate.layout_version) > minimumVersionExclusive
        && candidate.layout?.currentFloorId === floorId
        && candidate.layout?.floors?.length === 2
        && countLayoutType(candidate.layout, 'desk') === 2
        && floor?.name === 'QA Focus Lab'
        && JSON.stringify(types) === JSON.stringify([...focusLabTypes].sort());
    },
    'The exact renamed two-floor Focus Lab snapshot was not durably visible.',
  );
  assertExactLocalServerLayout(envelope, row, 'Focus Lab verification');
  return Number(row.layout_version);
}

async function runDesktopCanary(session) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });
  let page = null;
  let record = null;
  try {
    ({ page, record } = await openAuthenticatedOffice(context, session, 'desktop'));
    progress('desktop:office-ready');
    await openEditor(page);
    progress('desktop:editor-open');
    const search = page.getByLabel('Search Office items', { exact: true });
    await search.fill('Desk');
    progress('desktop:desk-search-ready');
    const deskFavorite = page.getByTestId('office-catalog-favorite-desk');
    await deskFavorite.click();
    await deskFavorite.getByText('★', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    // The favorite toggle replaces catalog children. Let that current list
    // settle before activating the Desk control that remains in the All scope.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const desktopDeskCatalogItem = page.getByTestId('office-catalog-item-desk');
    try {
      await desktopDeskCatalogItem.waitFor({ state: 'visible', timeout: 15_000 });
    } catch (error) {
      const catalogState = await page.evaluate(() => ({
        route: location.href,
        editorOpen: Boolean(document.querySelector('[data-testid="office-editor-open"]')),
        catalogReady: Boolean(document.querySelector('[data-testid="office-catalog-ready"]')),
        searchValue: document.querySelector('[aria-label="Search Office items"]')?.value || null,
        allScopePressed: document.querySelector('[data-testid="office-catalog-scope-all"]')?.getAttribute('aria-pressed') || null,
        selectedScope: Array.from(document.querySelectorAll('[data-testid^="office-catalog-scope-"]'))
          .find((element) => element.getAttribute('aria-pressed') === 'true')?.getAttribute('data-testid') || null,
        deskFavoritePresent: Boolean(document.querySelector('[data-testid="office-catalog-favorite-desk"]')),
        itemTestIds: Array.from(document.querySelectorAll('[data-testid^="office-catalog-item-"]'))
          .map((element) => element.getAttribute('data-testid')).filter(Boolean).slice(0, 20),
        activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('data-testid') || null,
      }));
      throw new Error(`Desk disappeared after favorite update: ${error instanceof Error ? error.message : String(error)}; state=${JSON.stringify(catalogState)}; console=${JSON.stringify(record.consoleErrors.slice(-5))}; pageErrors=${JSON.stringify(record.pageErrors.slice(-5))}`);
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const desksBeforePlacement = await placedTypeCount(page, 'desk');
    await desktopDeskCatalogItem.click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="office-catalog-item-desk"]')?.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 15_000 },
    );
    progress('desktop:desk-placement-armed');

    const canvas = page.getByTestId('office-floor-canvas');
    await canvas.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'center' }));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = await canvas.boundingBox();
    if (!box || box.width < 80 || box.height < 80) throw new Error('Office floor canvas is not actionable.');
    const deskPlacementPosition = await findVisibleUnobstructedCanvasPosition(
      page,
      canvas,
      { x: 0.58, y: 0.62 },
    );
    const deskPlacementHit = await page.evaluate(({ clientX, clientY }) => {
      const hit = document.elementFromPoint(clientX, clientY);
      const canvasElement = document.querySelector('[data-testid="office-floor-canvas"]');
      return {
        clientX,
        clientY,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        hitTestId: hit?.closest?.('[data-testid]')?.getAttribute('data-testid') || null,
        hitOfficeType: hit?.closest?.('[data-office-addon-type]')?.getAttribute('data-office-addon-type') || null,
        hitAriaLabel: hit?.closest?.('[aria-label]')?.getAttribute('aria-label') || null,
        hitInsideCanvas: Boolean(hit && canvasElement && (hit === canvasElement || canvasElement.contains(hit))),
      };
    }, {
      clientX: deskPlacementPosition.clientX,
      clientY: deskPlacementPosition.clientY,
    });
    if (!deskPlacementHit.hitInsideCanvas) {
      throw new Error(`Desk placement point was obstructed before mutation: ${JSON.stringify(deskPlacementHit)}.`);
    }
    await canvas.click({ position: deskPlacementPosition });
    try {
      await page.waitForFunction(
        ({ before }) => document.querySelectorAll('[data-office-addon-type="desk"]').length === before + 1,
        { before: desksBeforePlacement },
        { timeout: 15_000 },
      );
    } catch (error) {
      const placementState = await page.evaluate(() => ({
        route: location.href,
        deskCount: document.querySelectorAll('[data-office-addon-type="desk"]').length,
        catalogSelected: document.querySelector('[data-testid="office-catalog-item-desk"]')?.getAttribute('aria-pressed') || null,
        catalogReady: Boolean(document.querySelector('[data-testid="office-catalog-ready"]')),
        workspaceReady: Boolean(document.querySelector('[data-testid="office-workspace-ready"]')),
        bodyText: document.body?.textContent?.trim().slice(0, 360) || null,
        editorStatus: document.querySelector('[data-testid="office-editor-open"]')?.textContent?.trim().slice(0, 240) || null,
        activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('data-testid') || null,
      }));
      throw new Error(`Armed Desk placement had no exact effect: ${error instanceof Error ? error.message : String(error)}; hit=${JSON.stringify(deskPlacementHit)}; state=${JSON.stringify(placementState)}; console=${JSON.stringify(record.consoleErrors.slice(-8))}; pageErrors=${JSON.stringify(record.pageErrors.slice(-5))}; failedRequests=${JSON.stringify(record.failedRequests.slice(-8))}`);
    }
    progress('desktop:desk-placed');
    const [deskBeforeMove] = await readPlacedAddonGeometry(page, 'desk');
    if (!deskBeforeMove?.id) throw new Error('Placed Desk did not expose exact geometry evidence.');

    const desk = page.getByTestId(`office-floor-item-${deskBeforeMove.id}`);
    await desk.scrollIntoViewIfNeeded();
    const deskSemantics = await desk.evaluate((element) => ({
      role: element.getAttribute('role'),
      ariaPressed: element.getAttribute('aria-pressed'),
      ariaLabel: element.getAttribute('aria-label'),
      tabIndex: element.getAttribute('tabindex'),
    }));
    if (
      deskSemantics.role !== 'button'
      || deskSemantics.ariaPressed !== 'true'
      || deskSemantics.tabIndex !== '0'
      || !deskSemantics.ariaLabel
    ) {
      throw new Error(`Selected Desk did not expose its semantic editable-item contract: ${JSON.stringify(deskSemantics)}.`);
    }
    await dragLocatorByFloorDelta(page, canvas, desk, 32, 16);
    const deskAfterPointerMove = await waitForPlacedAddonGeometry(
      page,
      'desk',
      deskBeforeMove.id,
      (geometry) => geometry.x === deskBeforeMove.x + 32 && geometry.y === deskBeforeMove.y + 16,
      'Trusted mouse drag did not move Desk by the exact snapped floor delta.',
    );
    if (
      deskAfterPointerMove.width !== deskBeforeMove.width
      || deskAfterPointerMove.height !== deskBeforeMove.height
      || deskAfterPointerMove.rotation !== deskBeforeMove.rotation
    ) throw new Error('Trusted mouse drag changed Desk size or rotation.');
    await page.getByLabel(/Undo Move Desk/i).waitFor({ state: 'visible' });
    progress('desktop:real-pointer-move-verified');

    const resizeHandle = page.getByTestId(`office-floor-resize-${deskBeforeMove.id}-br`);
    const resizeTraceKey = '__officeResizePointerTrace';
    const resizeTargetEvidence = await preparePointerTrace(resizeHandle, resizeTraceKey);
    if (!resizeTargetEvidence.hitInsideTarget || resizeTargetEvidence.pointerEvents === 'none') {
      throw new Error(`Desk resize handle is not the actionable hit target: ${JSON.stringify(resizeTargetEvidence)}.`);
    }
    await dragLocatorByFloorDelta(page, canvas, resizeHandle, 32, 32);
    const expectedPointerWidth = Math.max(16, Math.round((deskAfterPointerMove.width + 32) / 16) * 16);
    const expectedPointerHeight = Math.max(16, Math.round((deskAfterPointerMove.height + 32) / 16) * 16);
    let deskAfterPointerResize;
    try {
      deskAfterPointerResize = await waitForPlacedAddonGeometry(
        page,
        'desk',
        deskBeforeMove.id,
        (geometry) => geometry.width === expectedPointerWidth && geometry.height === expectedPointerHeight,
        'Trusted mouse resize did not commit the exact snapped Desk dimensions.',
      );
    } catch (error) {
      const pointerTrace = await readPointerTrace(page, resizeTraceKey);
      throw new Error(`${error instanceof Error ? error.message : String(error)} Target: ${JSON.stringify(resizeTargetEvidence)}. Trace: ${JSON.stringify(pointerTrace)}.`);
    }
    if (
      deskAfterPointerResize.x !== deskAfterPointerMove.x
      || deskAfterPointerResize.y !== deskAfterPointerMove.y
      || deskAfterPointerResize.rotation !== deskAfterPointerMove.rotation
    ) throw new Error('Bottom-right Desk resize unexpectedly changed position or rotation.');
    await page.getByLabel(/Undo Resize Desk/i).click();
    await waitForPlacedAddonGeometry(
      page,
      'desk',
      deskBeforeMove.id,
      (geometry) => layoutFingerprint(geometry) === layoutFingerprint(deskAfterPointerMove),
      'Undo did not atomically restore the pre-resize Desk geometry.',
    );
    await page.getByLabel(/Redo Resize Desk/i).click();
    await waitForPlacedAddonGeometry(
      page,
      'desk',
      deskBeforeMove.id,
      (geometry) => layoutFingerprint(geometry) === layoutFingerprint(deskAfterPointerResize),
      'Redo did not atomically restore the pointer-resized Desk geometry.',
    );
    // History restoration intentionally clears selection so stale inspectors
    // cannot mutate a removed/replaced item. Re-select through the real floor
    // control before exercising the semantic inspector actions.
    await page.getByTestId(`office-floor-item-${deskBeforeMove.id}`).click();
    await page.getByTestId(`office-floor-item-${deskBeforeMove.id}`).getAttribute('aria-pressed').then((value) => {
      if (value !== 'true') throw new Error('Desk did not become selected again after pointer resize history restoration.');
    });
    progress('desktop:real-pointer-resize-verified');

    await page.getByLabel(/Move Desk right/i).click();
    const [deskAfterMove] = await readPlacedAddonGeometry(page, 'desk');
    if (deskAfterMove.x !== deskAfterPointerResize.x + 16 || deskAfterMove.y !== deskAfterPointerResize.y) {
      throw new Error('The semantic Move Desk right action did not move exactly one grid step.');
    }
    await page.getByLabel(/rotate 90° Desk/i).click();
    const [deskAfterRotate] = await readPlacedAddonGeometry(page, 'desk');
    if (deskAfterRotate.rotation !== 90) throw new Error('The Desk did not rotate exactly 90 degrees.');
    await page.getByLabel(/duplicate Desk/i).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-office-addon-type="desk"]').length === 2);
    const expectedDesks = await readPlacedAddonGeometry(page, 'desk');
    const duplicateDesk = expectedDesks.find((desk) => desk.id !== deskAfterRotate.id);
    if (
      expectedDesks.length !== 2
      || !duplicateDesk?.id?.startsWith(`${deskAfterRotate.id}_copy`)
      || duplicateDesk.rotation !== 90
      || duplicateDesk.x !== deskAfterRotate.x + 16
      || duplicateDesk.y !== deskAfterRotate.y + 16
    ) {
      throw new Error('Duplicate Desk did not preserve rotation and use the exact one-grid offset.');
    }
    progress('desktop:edit-history-verified');

    await page.getByLabel(/Undo Duplicate Desk/i).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-office-addon-type="desk"]').length === 1);
    await page.getByLabel(/Redo Duplicate Desk/i).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-office-addon-type="desk"]').length === 2);

    const favoritesScope = page.getByTestId('office-catalog-scope-favorites');
    await favoritesScope.click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="office-catalog-scope-favorites"]')?.getAttribute('aria-pressed') === 'true',
      undefined,
      { timeout: 15_000 },
    );
    await page.getByTestId('office-catalog-item-desk').waitFor({ state: 'visible', timeout: 15_000 });

    const preferences = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('@office_addon_catalog_preferences_v1:'));
      try { return key ? JSON.parse(localStorage.getItem(key) || 'null') : null; } catch { return null; }
    });
    if (!preferences?.favoriteTypes?.includes('desk')) throw new Error('Desk favorite was not persisted.');
    if (preferences?.recentTypes?.[0] !== 'desk') throw new Error('Desk was not recorded as the newest recent item.');
    progress('desktop:catalog-preferences-verified');

    const buttonPanel = await placeDesktopCatalogItem(
      page,
      canvas,
      'button_panel',
      'Button Panel',
      { x: 0.24, y: 0.34 },
    );
    const spotifySetup = await placeDesktopCatalogItem(
      page,
      canvas,
      'spotify_jukebox',
      'Spotify Jukebox',
      { x: 0.36, y: 0.40 },
    );
    const catalogItemsOverlap = (
      buttonPanel.x < spotifySetup.x + spotifySetup.width
      && buttonPanel.x + buttonPanel.width > spotifySetup.x
      && buttonPanel.y < spotifySetup.y + spotifySetup.height
      && buttonPanel.y + buttonPanel.height > spotifySetup.y
    );
    if (catalogItemsOverlap) {
      const spotifyFloorItem = page.getByTestId(`office-floor-item-${spotifySetup.id}`);
      await dragLocatorByFloorDelta(page, canvas, spotifyFloorItem, 192, 0);
      const movedSpotify = await waitForPlacedAddonGeometry(
        page,
        'spotify_jukebox',
        spotifySetup.id,
        (geometry) => geometry.x === spotifySetup.x + 192 && geometry.y === spotifySetup.y,
        'The deterministic Office fixture could not separate overlapping interactive add-ons.',
      );
      const stillOverlapping = (
        buttonPanel.x < movedSpotify.x + movedSpotify.width
        && buttonPanel.x + buttonPanel.width > movedSpotify.x
        && buttonPanel.y < movedSpotify.y + movedSpotify.height
        && buttonPanel.y + buttonPanel.height > movedSpotify.y
      );
      if (stillOverlapping) {
        throw new Error('The deterministic Office fixture left Button Panel obscured by Spotify Jukebox.');
      }
    }
    await page.getByLabel('Office tools', { exact: true }).click();
    await page.getByLabel('Done', { exact: true }).click();
    await page.getByTestId('office-editor-open').waitFor({ state: 'detached', timeout: 15_000 });

    const terminalDraft = 'Verify this terminal draft survives editing';
    await page.getByLabel('Open terminal', { exact: true }).click();
    const terminalInput = page.getByTestId('office-terminal-command-input');
    await terminalInput.waitFor({ state: 'visible', timeout: 45_000 });
    await terminalInput.fill(terminalDraft);
    await page.getByText('▬ Half', { exact: true }).click();
    await openEditor(page);
    await terminalInput.waitFor({ state: 'hidden', timeout: 15_000 });
    await page.getByLabel('Office tools', { exact: true }).click();
    await page.getByLabel('Done', { exact: true }).click();
    await terminalInput.waitFor({ state: 'visible', timeout: 15_000 });
    if (await terminalInput.inputValue() !== terminalDraft) {
      throw new Error('Office edit mode unmounted the terminal and lost its unsent draft.');
    }
    await terminalInput.fill('');
    await page.getByLabel('Close terminal', { exact: true }).click();
    progress('desktop:terminal-state-preserved');

    const spotifyFloorItem = page.getByTestId(`office-floor-item-${spotifySetup.id}`);
    await spotifyFloorItem.scrollIntoViewIfNeeded();
    await spotifyFloorItem.click();
    await page.getByText('🎧 SET UP SPOTIFY', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByLabel('Spotify URL', { exact: true }).fill('http://not-allowed.example');
    await page.getByLabel('Save service setup', { exact: true }).click();
    await page.getByText('Use a complete HTTPS link. Your previous setup has not been changed.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('🎧 SET UP SPOTIFY', { exact: true }).waitFor({ state: 'visible' });
    await page.getByLabel('Close service setup', { exact: true }).click();

    const terminalCommandsBeforeReview = await countUserTerminalCommands(session.access_token);
    const buttonPanelFloorItem = page.getByTestId(`office-floor-item-${buttonPanel.id}`);
    await buttonPanelFloorItem.scrollIntoViewIfNeeded();
    await buttonPanelFloorItem.click();
    const commandReview = page.getByTestId('office-command-review-input');
    await commandReview.waitFor({ state: 'visible', timeout: 15_000 });
    if (await commandReview.inputValue() !== 'Status update') {
      throw new Error('Button Panel did not stage its exact preset for review.');
    }
    const sendReviewedCommand = page.getByLabel('Send reviewed command to selected agent', { exact: true });
    const exactTargets = page.locator('[aria-label^="Send reviewed command to "]:not([aria-label="Send reviewed command to selected agent"])');
    const targetCount = await exactTargets.count();
    const selectedTargetCount = await exactTargets.evaluateAll((elements) => (
      elements.filter((element) => element.getAttribute('aria-pressed') === 'true').length
    ));
    if (targetCount > 0) {
      if (selectedTargetCount !== 1 || await sendReviewedCommand.isDisabled()) {
        throw new Error(`Button Panel did not stage one exact connected target: targets=${targetCount}; selected=${selectedTargetCount}.`);
      }
    } else if (!await sendReviewedCommand.isDisabled()) {
      throw new Error('Button Panel allowed dispatch without one exact connected agent target.');
    }
    await page.getByLabel('Close command review', { exact: true }).click();
    await page.waitForTimeout(1_000);
    const terminalCommandsAfterReview = await countUserTerminalCommands(session.access_token);
    if (terminalCommandsAfterReview !== terminalCommandsBeforeReview) {
      throw new Error(`Button Panel dispatched before explicit Send: ${terminalCommandsBeforeReview} -> ${terminalCommandsAfterReview}.`);
    }
    progress('desktop:truthful-addon-actions-verified');

    const savedLayoutVersion = await verifyPersistedDeskLayout(page, session.access_token, { expectedDesks });
    const savedDeskSurfaceFingerprint = userOwnedLayoutSurfaceFingerprint(
      (await readPersistedOfficeLayout(session.access_token))?.layout,
    );
    await page.getByTestId('office-layout-save-status').getByText(/SAVED/).waitFor({ state: 'visible', timeout: 15_000 });
    progress('desktop:local-and-server-save-verified');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissTutorial(page);
    await page.getByTestId('office-workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await dismissTutorial(page);
    progress('desktop:reload-ready');
    await page.getByTestId('office-layout-save-status').getByText(/SAVED/).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-office-addon-type="desk"]').length === 2,
      null,
      { timeout: 30_000 },
    );
    const reloadLayoutVersion = await verifyPersistedDeskLayout(page, session.access_token, {
      minimumVersionExclusive: savedLayoutVersion - 1,
      expectedDesks,
    });
    const reloadedDeskRow = await readPersistedOfficeLayout(session.access_token);
    if (reloadLayoutVersion < savedLayoutVersion) throw new Error('Desk reload observed an older layout revision.');
    if (userOwnedLayoutSurfaceFingerprint(reloadedDeskRow?.layout) !== savedDeskSurfaceFingerprint) {
      throw new Error('Desk reload changed user-owned floor or furniture state.');
    }
    await openEditor(page);
    await page.getByTestId('office-floor-add').click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="office-floor-switch-"]').length === 2,
    );
    const newFloorSwitch = page.locator('[data-testid^="office-floor-switch-"]').last();
    const newFloorTestId = await newFloorSwitch.getAttribute('data-testid');
    const newFloorId = newFloorTestId?.replace('office-floor-switch-', '');
    if (!newFloorId || newFloorId === 'floor_1') throw new Error('New Office floor did not expose a unique identifier.');

    await page.getByTestId(`office-floor-rename-${newFloorId}`).click();
    const floorNameInput = page.getByTestId(`office-floor-name-input-${newFloorId}`);
    await floorNameInput.fill('QA Focus Lab');
    await floorNameInput.press('Enter');
    await page.getByLabel(/^QA Focus Lab, 0 items, \d+ agents$/).waitFor({ state: 'visible' });
    progress('desktop:floor-add-and-rename-verified');

    await page.getByTestId('office-room-kits-toggle').click();
    await page.getByTestId('office-room-kit-focus_lab').click();
    await page.waitForFunction(
      () => document.querySelectorAll('[data-office-addon-id]').length === 6,
    );
    await page.getByTestId('office-workspace-status').getByText(/Focus Lab added with 6 items/i).waitFor({ state: 'visible' });
    const nestedFocusableCount = await page.locator(
      '[data-office-addon-type="pomodoro_room"] [data-resize-content] button, '
      + '[data-office-addon-type="pomodoro_room"] [data-resize-content] input, '
      + '[data-office-addon-type="pomodoro_room"] [data-resize-content] [tabindex="0"]',
    ).evaluateAll((elements) => elements.filter((element) => !element.closest('[inert]')).length);
    if (nestedFocusableCount !== 0) {
      throw new Error('Edit mode left a nested room-kit control in the sequential focus order.');
    }
    const focusLabLayoutVersion = await verifyPersistedFocusLab(
      page,
      session.access_token,
      newFloorId,
      savedLayoutVersion,
    );
    const focusLabSurfaceFingerprint = userOwnedLayoutSurfaceFingerprint(
      (await readPersistedOfficeLayout(session.access_token))?.layout,
    );
    progress('desktop:room-kit-durable-state-verified');
    await page.screenshot({ path: desktopScreenshot, fullPage: true });
    progress('desktop:persistence-screenshot-complete');

    // A durable write is not enough: reload the actual app and prove that the
    // selected floor, name, and exact kit are reconstructed from persistence.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissTutorial(page);
    await page.getByTestId('office-workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await dismissTutorial(page);
    await page.getByLabel(/^QA Focus Lab, 6 items, \d+ agents$/).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForFunction((expectedTypes) => {
      const actualTypes = Array.from(document.querySelectorAll('[data-office-addon-type]'))
        .map((element) => element.getAttribute('data-office-addon-type'))
        .filter(Boolean)
        .sort();
      return JSON.stringify(actualTypes) === JSON.stringify([...expectedTypes].sort());
    }, focusLabTypes, { timeout: 30_000 });
    const reloadedFocusLabVersion = await verifyPersistedFocusLab(
      page,
      session.access_token,
      newFloorId,
      savedLayoutVersion,
    );
    const reloadedFocusLabRow = await readPersistedOfficeLayout(session.access_token);
    if (reloadedFocusLabVersion < focusLabLayoutVersion) throw new Error('Focus Lab reload observed an older layout revision.');
    if (userOwnedLayoutSurfaceFingerprint(reloadedFocusLabRow?.layout) !== focusLabSurfaceFingerprint) {
      throw new Error('The Focus Lab changed user-owned floor or furniture state during reload.');
    }
    progress('desktop:room-kit-reload-verified');
    await openEditor(page);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId(`office-floor-delete-${newFloorId}`).click();
    await page.getByTestId(`office-floor-switch-${newFloorId}`).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('[data-office-addon-type="desk"]').length === 2);
    const postLifecycleLayoutVersion = await verifyPersistedDeskLayout(
      page,
      session.access_token,
      { expectedFloorCount: 1, minimumVersionExclusive: focusLabLayoutVersion, expectedDesks },
    );
    const postDeleteSurfaceFingerprint = userOwnedLayoutSurfaceFingerprint(
      (await readPersistedOfficeLayout(session.access_token))?.layout,
    );
    progress('desktop:floor-delete-and-server-save-verified');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissTutorial(page);
    await page.getByTestId('office-workspace-ready').waitFor({ state: 'visible', timeout: 45_000 });
    await dismissTutorial(page);
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-testid^="office-floor-switch-"]').length === 1
      && document.querySelectorAll('[data-office-addon-type="desk"]').length === 2
    ), null, { timeout: 30_000 });
    const finalRow = await readPersistedOfficeLayout(session.access_token);
    const finalLayoutVersion = Number(finalRow?.layout_version);
    if (
      !Number.isFinite(finalLayoutVersion)
      || finalLayoutVersion < postLifecycleLayoutVersion
      || finalRow?.layout?.floors?.length !== 1
      || finalRow?.layout?.currentFloorId !== 'floor_1'
      || countLayoutType(finalRow?.layout, 'desk') !== 2
    ) {
      throw new Error('The deleted Office floor was not reconstructed exactly after the final reload.');
    }
    if (userOwnedLayoutSurfaceFingerprint(finalRow?.layout) !== postDeleteSurfaceFingerprint) {
      throw new Error('Final reload changed user-owned floor or furniture state.');
    }
    const finalVerifiedVersion = await verifyPersistedDeskLayout(page, session.access_token, {
      minimumVersionExclusive: focusLabLayoutVersion,
      expectedDesks,
    });
    if (finalVerifiedVersion < postLifecycleLayoutVersion) {
      throw new Error('Final reload observed an older Office layout revision.');
    }
    progress('desktop:floor-delete-reload-verified');

    assertNoReactUpdateLoopErrors(record, 'Desktop Office');
    const lazyFailures = record.consoleErrors.filter((message) =>
      /metro-require|ENOENT|authSession\.bundle|memoryIntentCore\.bundle|crossSurfaceReferenceResolverCore\.bundle|circleContextSnapshot\.bundle/i.test(message)
    );
    await Promise.allSettled(record.layoutResponseReads);
    if (lazyFailures.length > 0) throw new Error(`Desktop Office observed ${lazyFailures.length} lazy-module failure(s).`);
    if (record.pageErrors.length > 0) throw new Error(`Desktop Office observed ${record.pageErrors.length} uncaught page error(s).`);
    if (record.serverErrors.length > 0) throw new Error(`Desktop Office observed ${record.serverErrors.length} HTTP 5xx response(s).`);
    const essentialRequestFailures = record.failedRequests.filter((message) => {
      const requestUrl = message.match(/^\S+\s+(\S+)/)?.[1] || '';
      return isOfficeCanaryEssentialRequest(requestUrl);
    });
    if (essentialRequestFailures.length > 0) {
      throw new Error(`Desktop Office observed ${essentialRequestFailures.length} essential request failure(s).`);
    }
    return {
      route: page.url(),
      deskCountAfterReload: await placedTypeCount(page, 'desk'),
      favoritePersisted: true,
      recentPersisted: true,
      savedLayoutVersion,
      focusLabLayoutVersion,
      postLifecycleLayoutVersion,
      floorLifecycleVerified: true,
      roomKitVerified: 'focus_lab',
      realPointerMoveVerified: true,
      realPointerResizeVerified: true,
      terminalStatePreserved: true,
      truthfulAddonActionsVerified: true,
      pageErrors: record.pageErrors.length,
      serverErrors: record.serverErrors.length,
      bundleIdentity: record.bundleIdentity,
      screenshot: desktopScreenshot,
    };
  } catch (error) {
    await settleFailureEvidence(page, record, desktopFailureScreenshot);
    throw error;
  } finally {
    await closePlaywrightResource(context, 'desktop-context-close');
  }
}

async function runMobileCanary(session) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    isMobile: true,
    hasTouch: true,
  });
  let page = null;
  let record = null;
  try {
    ({ page, record } = await openAuthenticatedOffice(context, session, 'mobile'));
    progress('mobile:office-ready');
    await openEditor(page);
    progress('mobile:editor-open');
    await page.getByLabel('Search Office items', { exact: true }).fill('Plant');
    const placementAttempts = await placeCompactCatalogItemWithOneSafeRetry(page, 'plant');
    const [plantBeforeEdit] = await readPlacedAddonGeometry(page, 'plant');
    if (!plantBeforeEdit?.id) throw new Error('Compact Plant placement exposed no exact item identity.');
    await page.getByTestId('office-compact-placed-items').waitFor({ state: 'visible', timeout: 15_000 });
    const placedPlantControl = page.getByTestId(`office-compact-placed-item-${plantBeforeEdit.id}`);
    const placedPlantBox = await placedPlantControl.boundingBox();
    if (!placedPlantBox || placedPlantBox.height < 44) {
      throw new Error('Compact placed-item selector does not meet the 44px semantic target.');
    }
    await placedPlantControl.click();
    await page.getByLabel(/Move Plant right/i).click();
    const plantAfterNudge = await waitForPlacedAddonGeometry(
      page,
      'plant',
      plantBeforeEdit.id,
      (geometry) => geometry.x === plantBeforeEdit.x + 16 && geometry.y === plantBeforeEdit.y,
      'Compact placed-item selection did not expose a working one-grid Plant nudge.',
    );
    await page.getByLabel(/Make Plant wider/i).click();
    // The semantic W+ control means exactly one grid unit. It preserves a
    // catalog item's native non-grid dimensions (Plant starts at 30px), while
    // free-form pointer resizing snaps the resulting boundary to the grid.
    const expectedPlantWidth = plantAfterNudge.width + 16;
    const plantAfterResize = await waitForPlacedAddonGeometry(
      page,
      'plant',
      plantBeforeEdit.id,
      (geometry) => geometry.width === expectedPlantWidth,
      'Compact inspector did not resize the selected Plant.',
    );
    const { row: compactRow, envelope: compactEnvelope } = await waitForConvergedOfficeLayout(
      page,
      session.access_token,
      (candidate) => candidate.layout?.floors?.some((floor) => floor?.furniture?.some((item) => (
        item?.id === plantAfterResize.id
        && item?.x === plantAfterResize.x
        && item?.y === plantAfterResize.y
        && item?.itemWidth === plantAfterResize.width
      ))),
      'Compact selected-item geometry did not converge to authenticated Office storage.',
    );
    assertExactLocalServerLayout(compactEnvelope, compactRow, 'Compact inspector verification');
    progress('mobile:placed-item-inspector-verified');

    // Collapse the active Items tray and prove the floor—not only the catalog
    // mutation—is meaningfully visible and operable in a 390px viewport.
    await page.getByTestId('office-compact-editor-panel-inspector').click();
    await page.getByTestId('office-compact-editor-tray').waitFor({ state: 'detached' });
    const compactCanvas = page.getByTestId('office-floor-canvas');
    await compactCanvas.scrollIntoViewIfNeeded();
    const compactCanvasBox = await compactCanvas.boundingBox();
    const compactViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    if (!compactCanvasBox) throw new Error('Compact Office floor canvas is not rendered.');
    const visibleFloorHeight = Math.max(0, Math.min(compactViewport.height, compactCanvasBox.y + compactCanvasBox.height) - Math.max(0, compactCanvasBox.y));
    if (visibleFloorHeight < 220) throw new Error(`Compact Office floor exposes only ${visibleFloorHeight}px of visible height.`);
    if (compactViewport.scrollWidth > compactViewport.clientWidth + 1) {
      throw new Error(`Compact Office introduced document-level horizontal overflow (${compactViewport.scrollWidth} > ${compactViewport.clientWidth}).`);
    }
    progress('mobile:floor-visibility-verified');
    const reducedMotionMatches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!reducedMotionMatches) throw new Error('Mobile reduced-motion context was not honored.');
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    progress('mobile:placement-screenshot-complete');

    assertNoReactUpdateLoopErrors(record, 'Mobile Office');
    const lazyFailures = record.consoleErrors.filter((message) =>
      /metro-require|ENOENT|authSession\.bundle|memoryIntentCore\.bundle|crossSurfaceReferenceResolverCore\.bundle|circleContextSnapshot\.bundle/i.test(message)
    );
    await Promise.allSettled(record.layoutResponseReads);
    if (lazyFailures.length > 0) throw new Error(`Mobile Office observed ${lazyFailures.length} lazy-module failure(s).`);
    if (record.pageErrors.length > 0) throw new Error(`Mobile Office observed ${record.pageErrors.length} uncaught page error(s).`);
    if (record.serverErrors.length > 0) throw new Error(`Mobile Office observed ${record.serverErrors.length} HTTP 5xx response(s).`);
    const essentialRequestFailures = record.failedRequests.filter((message) => {
      const requestUrl = message.match(/^\S+\s+(\S+)/)?.[1] || '';
      return isOfficeCanaryEssentialRequest(requestUrl);
    });
    if (essentialRequestFailures.length > 0) {
      throw new Error(`Mobile Office observed ${essentialRequestFailures.length} essential request failure(s).`);
    }
    return {
      route: page.url(),
      plantCount: await placedTypeCount(page, 'plant'),
      placementAttempts,
      placedItemInspectorVerified: true,
      visibleFloorHeight,
      documentHorizontalOverflow: false,
      reducedMotionMatches,
      pageErrors: record.pageErrors.length,
      serverErrors: record.serverErrors.length,
      bundleIdentity: record.bundleIdentity,
      screenshot: mobileScreenshot,
    };
  } catch (error) {
    await settleFailureEvidence(page, record, mobileFailureScreenshot);
    throw error;
  } finally {
    await closePlaywrightResource(context, 'mobile-context-close');
  }
}

async function openOpenSwanAgentPopup(page) {
  const opener = page.locator('[aria-label="Open OpenSwan agent panel"]:visible').first();
  await opener.waitFor({ state: 'visible', timeout: 30_000 });
  await opener.focus();
  await opener.click();
  await page.locator('#uc-agent-panel-root').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('uc-agent-panel-root');
    return Boolean(root && document.activeElement && root.contains(document.activeElement));
  }, undefined, { timeout: 15_000 });
}

async function openFloatingChatBehindOffice(page) {
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
  const popout = page.getByLabel('Pop out chat to floating window', { exact: true });
  await popout.waitFor({ state: 'visible', timeout: 30_000 });
  await popout.click();
  await page.locator('#section-floating-chat').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('tab', { name: 'Office', exact: true }).click();
  await page.getByTestId('office-workspace-ready').waitFor({ state: 'visible', timeout: 30_000 });
}

async function waitForExactPopupAuthorityReady(page) {
  await page.getByLabel(/^(Pause|Resume) OpenSwan$/).waitFor({ state: 'visible', timeout: 30_000 });
}

async function selectAgentCustomize(page) {
  await page.getByLabel('More destination', { exact: true }).click();
  await page.getByLabel('Customize tab', { exact: true }).click();
  await page.waitForFunction(() => (
    document.querySelector('[aria-label="Customize tab"]')?.getAttribute('aria-selected') === 'true'
  ), undefined, { timeout: 15_000 });
}

function startPopupDiagnostics(record) {
  record.popupConsoleErrors = [];
  record.popupAllowedConsoleErrors = [];
  record.popupSectionErrors = [];
  record.popupConsoleCaptureActive = true;
}

function stopPopupDiagnostics(record) {
  if (record) record.popupConsoleCaptureActive = false;
}

async function assertPopupSectionHealthy(page, record, label) {
  const errors = await page.locator('#uc-agent-panel-root').evaluate((root) => {
    const alerts = Array.from(root.querySelectorAll('[role="alert"]'))
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() || '')
      .filter(Boolean);
    const fallback = Array.from(root.querySelectorAll('*'))
      .find((element) => element.textContent?.trim() === 'This section could not load');
    return Array.from(new Set([
      ...alerts,
      ...(fallback ? ['This section could not load'] : []),
    ])).slice(0, 12);
  });
  await Promise.allSettled(record.consoleErrorReads);
  if (record.popupConsoleErrors.length > 0) {
    const updateLoopStacks = await page.evaluate(() => (
      Array.isArray(globalThis.__officeUpdateLoopStacks)
        ? globalThis.__officeUpdateLoopStacks.slice(-3)
        : []
    ));
    const details = record.consoleErrorDetails.filter((entry) => (
      /Maximum update depth exceeded|Too many re-renders/i.test(entry.text)
    ));
    throw new Error(
      `${label} observed non-allowlisted console errors: ${JSON.stringify({ errors: record.popupConsoleErrors.slice(-5), details: details.slice(-3), updateLoopStacks })}.`,
    );
  }
  if (errors.length === 0) return;
  record.popupSectionErrors.push(...errors.map((message) => `${label}: ${message}`.slice(0, 700)));
  throw new Error(`${label} exposed ${errors.length} popup section error(s): ${JSON.stringify(errors)}.`);
}

async function waitForAgentPanelRouteSettled(page, destinationLabel, routeLabel, expectedSectionLabel) {
  await page.waitForFunction(({ destination, route, section }) => {
    const root = document.getElementById('uc-agent-panel-root');
    if (!root) return false;
    const controls = Array.from(root.querySelectorAll('[aria-label]'));
    const destinationControl = controls.find(
      (element) => element.getAttribute('aria-label') === destination,
    );
    const routeControl = route
      ? controls.find((element) => element.getAttribute('aria-label') === route)
      : null;
    const tabpanel = root.querySelector('#uc-agent-panel-tabpanel');
    const loadingLeaf = Array.from(root.querySelectorAll('*')).some((element) => (
      element.children.length === 0
      && /^Loading\s+.+(?:…|\.\.\.)$/u.test(element.textContent?.trim() || '')
    ));
    const labelledBy = tabpanel?.getAttribute('aria-labelledby');
    const activeControl = routeControl || destinationControl;
    return destinationControl?.getAttribute('aria-selected') === 'true'
      && (!route || routeControl?.getAttribute('aria-selected') === 'true')
      && destinationControl?.getAttribute('aria-controls') === 'uc-agent-panel-tabpanel'
      && (!routeControl || routeControl.getAttribute('aria-controls') === 'uc-agent-panel-tabpanel')
      && tabpanel?.getAttribute('role') === 'tabpanel'
      && tabpanel?.getAttribute('aria-label') === section
      && Boolean(activeControl?.id)
      && labelledBy === activeControl?.id
      && !loadingLeaf;
  }, {
    destination: destinationLabel,
    route: routeLabel,
    section: expectedSectionLabel,
  }, { timeout: 30_000 });
}

async function assertVisitedAgentPanelRoute(page, record, destinationLabel, routeLabel, expectedSectionLabel) {
  await waitForAgentPanelRouteSettled(page, destinationLabel, routeLabel, expectedSectionLabel);
  const label = routeLabel || destinationLabel;
  await assertPopupSectionHealthy(page, record, `Agent popup route ${label}`);
  if (record.popupConsoleErrors.length > 0) {
    throw new Error(
      `Agent popup route ${label} observed non-allowlisted console errors: ${JSON.stringify(record.popupConsoleErrors.slice(-5))}.`,
    );
  }
}

async function visitEveryAvailableAgentPanelRoute(page, record) {
  const root = page.locator('#uc-agent-panel-root');
  const destinationLabels = await root.evaluate((element) => {
    const destinationList = Array.from(element.querySelectorAll('[role="tablist"]')).find(
      (candidate) => candidate.getAttribute('aria-label') === 'Agent panel destinations',
    );
    if (!destinationList) return [];
    return Array.from(destinationList.querySelectorAll('[role="tab"]'))
      .map((control) => control.getAttribute('aria-label'))
      .filter((label) => typeof label === 'string' && label.endsWith(' destination'));
  });
  if (destinationLabels.length === 0) {
    throw new Error('The Agent popup exposed no available primary destinations.');
  }

  const visited = [];
  for (const destinationLabel of destinationLabels) {
    await root.getByLabel(destinationLabel, { exact: true }).click();
    const destinationName = destinationLabel.replace(/ destination$/, '');
    await page.waitForFunction(({ destination, groupName }) => {
      const panelRoot = document.getElementById('uc-agent-panel-root');
      if (!panelRoot) return false;
      const destinationControl = Array.from(panelRoot.querySelectorAll('[aria-label]')).find(
        (element) => element.getAttribute('aria-label') === destination,
      );
      if (!destinationControl?.id || destinationControl.getAttribute('aria-selected') !== 'true') return false;
      const tabpanel = panelRoot.querySelector('#uc-agent-panel-tabpanel');
      const routeList = Array.from(panelRoot.querySelectorAll('[role="tablist"]')).find(
        (candidate) => candidate.getAttribute('aria-label') === `${groupName} sections`,
      );
      const visibleRoutes = routeList?.querySelectorAll('[role="tab"]').length || 0;
      return visibleRoutes > 0 || tabpanel?.getAttribute('aria-labelledby') === destinationControl.id;
    }, { destination: destinationLabel, groupName: destinationName }, { timeout: 15_000 });
    const routeLabels = await root.evaluate((element, groupName) => {
      const routeList = Array.from(element.querySelectorAll('[role="tablist"]')).find(
        (candidate) => candidate.getAttribute('aria-label') === `${groupName} sections`,
      );
      if (!routeList) return [];
      return Array.from(routeList.querySelectorAll('[role="tab"]'))
        .map((control) => control.getAttribute('aria-label'))
        .filter((label) => typeof label === 'string' && label.endsWith(' tab'));
    }, destinationName);

    if (routeLabels.length === 0) {
      await page.waitForFunction((destination) => {
        const root = document.getElementById('uc-agent-panel-root');
        const destinationControl = Array.from(root?.querySelectorAll('[aria-label]') || []).find(
          (element) => element.getAttribute('aria-label') === destination,
        );
        return destinationControl?.getAttribute('aria-selected') === 'true'
          && Boolean(root?.querySelector('#uc-agent-panel-tabpanel')?.getAttribute('aria-label'));
      }, destinationLabel, { timeout: 15_000 });
      const sectionLabel = await root.locator('#uc-agent-panel-tabpanel').getAttribute('aria-label');
      if (!sectionLabel?.endsWith(' section')) {
        throw new Error(`${destinationLabel} exposed no exact single-route tabpanel label.`);
      }
      await assertVisitedAgentPanelRoute(page, record, destinationLabel, null, sectionLabel);
      visited.push({ destination: destinationLabel, routes: [sectionLabel] });
      continue;
    }

    const routes = [];
    for (const routeLabel of routeLabels) {
      await root.getByLabel(routeLabel, { exact: true }).click();
      const sectionLabel = `${routeLabel.replace(/ tab$/, '')} section`;
      await assertVisitedAgentPanelRoute(page, record, destinationLabel, routeLabel, sectionLabel);
      routes.push(sectionLabel);
    }
    visited.push({ destination: destinationLabel, routes });
  }
  return visited;
}

async function readSelectedAgentPanelRoute(page) {
  return page.locator('#uc-agent-panel-root').evaluate((root) => {
    const selectedDestinations = Array.from(root.querySelectorAll('[aria-label$=" destination"][aria-selected="true"]'));
    const selectedRoutes = Array.from(root.querySelectorAll('[aria-label$=" tab"][aria-selected="true"]'));
    const tabpanel = root.querySelector('#uc-agent-panel-tabpanel');
    return {
      destination: selectedDestinations[0]?.getAttribute('aria-label') || null,
      destinationCount: selectedDestinations.length,
      route: selectedRoutes[0]?.getAttribute('aria-label') || null,
      routeCount: selectedRoutes.length,
      section: tabpanel?.getAttribute('aria-label') || null,
      labelledBy: tabpanel?.getAttribute('aria-labelledby') || null,
    };
  });
}

function assertSameAgentPanelRoute(actual, expected, label) {
  if (
    actual.destinationCount !== 1
    || actual.routeCount > 1
    || actual.destination !== expected.destination
    || actual.route !== expected.route
    || actual.section !== expected.section
    || actual.labelledBy !== expected.labelledBy
  ) {
    throw new Error(`${label} discarded the active Agent popup route: ${JSON.stringify({ expected, actual })}.`);
  }
}

async function readAgentPopupEvidence(page) {
  return page.locator('#uc-agent-panel-root').evaluate((root) => {
    const rect = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    const backdrop = document.querySelector('[data-testid="agent-panel-backdrop"]');
    const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
    const dockControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Dock agent panel to the right',
    );
    const popOutControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Open agent panel as a centered pop-up',
    );
    const resizeControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Resize docked agent panel',
    );
    const titleId = root.getAttribute('aria-labelledby');
    return {
      role: root.getAttribute('role'),
      ariaModal: root.getAttribute('aria-modal'),
      titleId,
      title: titleId ? document.getElementById(titleId)?.textContent?.trim() || null : null,
      focusInside: Boolean(document.activeElement && root.contains(document.activeElement)),
      activeElementLabel: document.activeElement?.getAttribute('aria-label') || null,
      viewport: { width: innerWidth, height: innerHeight },
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      reducedMotionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationName: rootStyle.animationName,
      animationDuration: rootStyle.animationDuration,
      transitionDuration: rootStyle.transitionDuration,
      backdropTransitionDuration: backdropStyle?.transitionDuration || null,
      backdropPresent: Boolean(backdrop),
      dockControlVisible: Boolean(dockControl && dockControl.getBoundingClientRect().width > 0),
      popOutControlVisible: Boolean(popOutControl && popOutControl.getBoundingClientRect().width > 0),
      resizeControlVisible: Boolean(resizeControl && resizeControl.getBoundingClientRect().width > 0),
      resizeValueNow: resizeControl?.getAttribute('aria-valuenow') || null,
      overviewSelected: document.querySelector('[aria-label="Overview destination"]')?.getAttribute('aria-selected') === 'true',
      customizeSelected: document.querySelector('[aria-label="Customize tab"]')?.getAttribute('aria-selected') === 'true',
    };
  });
}

async function waitForResponsiveAgentPopup(page, expectedDockControlVisible) {
  await page.waitForFunction((expectDock) => {
    const root = document.getElementById('uc-agent-panel-root');
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    const dockControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Dock agent panel to the right',
    );
    const dockVisible = Boolean(dockControl && dockControl.getBoundingClientRect().width > 0);
    const backdrop = document.querySelector('[data-testid="agent-panel-backdrop"]');
    return dockVisible === expectDock
      && root.getAttribute('aria-modal') === 'true'
      && Boolean(backdrop)
      && rect.width >= 280
      && rect.height >= 280
      && rect.left >= -1
      && rect.top >= -1
      && rect.right <= innerWidth + 1
      && rect.bottom <= innerHeight + 1;
  }, expectedDockControlVisible, { timeout: 15_000 });
}

function assertAgentPopupEvidence(evidence, label, expectedDockControlVisible) {
  const margin = 1;
  if (
    evidence.role !== 'dialog'
    || evidence.ariaModal !== 'true'
    || evidence.titleId !== 'uc-agent-panel-title'
    || evidence.title !== 'OpenSwan'
    || !evidence.backdropPresent
    || evidence.popOutControlVisible
    || evidence.resizeControlVisible
  ) {
    throw new Error(`${label} did not retain the exact labelled modal-dialog contract: ${JSON.stringify(evidence)}.`);
  }
  if (!evidence.focusInside) {
    throw new Error(`${label} did not contain keyboard focus: ${JSON.stringify(evidence)}.`);
  }
  if (
    evidence.rect.width < 280
    || evidence.rect.height < 280
    || evidence.rect.left < -margin
    || evidence.rect.top < -margin
    || evidence.rect.right > evidence.viewport.width + margin
    || evidence.rect.bottom > evidence.viewport.height + margin
  ) {
    throw new Error(`${label} escaped the live viewport: ${JSON.stringify(evidence)}.`);
  }
  const horizontalCenter = evidence.rect.left + (evidence.rect.width / 2);
  if (Math.abs(horizontalCenter - (evidence.viewport.width / 2)) > 2) {
    throw new Error(`${label} did not use centered modal geometry: ${JSON.stringify(evidence)}.`);
  }
  if (!evidence.reducedMotionMatches) {
    throw new Error(`${label} lost the reduced-motion browser preference.`);
  }
  const hasMotion = (duration) => String(duration || '')
    .split(',')
    .some((value) => Number.parseFloat(value) > 0);
  if (
    (evidence.animationName && evidence.animationName !== 'none')
    || hasMotion(evidence.animationDuration)
    || hasMotion(evidence.transitionDuration)
    || hasMotion(evidence.backdropTransitionDuration)
  ) {
    throw new Error(`${label} exposed entrance or layout motion under reduced motion: ${JSON.stringify(evidence)}.`);
  }
  if (evidence.dockControlVisible !== expectedDockControlVisible) {
    throw new Error(`${label} exposed the wrong responsive docking affordance: ${JSON.stringify(evidence)}.`);
  }
}

async function verifyCompactCenteredAgentPopupLifecycle(page, record) {
  const beforeRoute = await readSelectedAgentPanelRoute(page);
  if (beforeRoute.destinationCount !== 1 || beforeRoute.routeCount > 1 || !beforeRoute.section) {
    throw new Error(`Desktop Agent popup exposed ambiguous selected-route semantics: ${JSON.stringify(beforeRoute)}.`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => innerWidth === 390 && innerHeight === 844);
  await waitForResponsiveAgentPopup(page, false);
  const compactEvidence = await readAgentPopupEvidence(page);
  assertAgentPopupEvidence(compactEvidence, '390x844 centered Agent popup', false);
  const compactRoute = await readSelectedAgentPanelRoute(page);
  assertSameAgentPanelRoute(compactRoute, beforeRoute, '390x844 viewport transition');
  const compactDocument = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body?.clientWidth || 0,
    bodyScrollWidth: document.body?.scrollWidth || 0,
  }));
  if (
    compactDocument.scrollWidth > compactDocument.clientWidth + 1
    || compactDocument.bodyScrollWidth > compactDocument.bodyClientWidth + 1
  ) {
    throw new Error(`390x844 Agent popup introduced document horizontal overflow: ${JSON.stringify(compactDocument)}.`);
  }
  await assertPopupSectionHealthy(page, record, '390x844 active Agent popup route');
  if (record.popupConsoleErrors.length > 0) {
    throw new Error(
      `390x844 Agent popup observed non-allowlisted console errors: ${JSON.stringify(record.popupConsoleErrors.slice(-5))}.`,
    );
  }

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForFunction(() => innerWidth === 1180 && innerHeight === 820);
  await waitForResponsiveAgentPopup(page, true);
  const restoredEvidence = await readAgentPopupEvidence(page);
  assertAgentPopupEvidence(restoredEvidence, 'Restored desktop Agent popup after 390x844', true);
  const restoredRoute = await readSelectedAgentPanelRoute(page);
  assertSameAgentPanelRoute(restoredRoute, beforeRoute, '390x844 desktop restoration');
  await assertPopupSectionHealthy(page, record, 'Restored desktop active Agent popup route');

  return {
    viewport: '390x844',
    modalContained: true,
    documentHorizontalOverflow: false,
    retainedRoute: beforeRoute,
    restoredDesktopViewport: '1180x820',
  };
}

async function waitForDockedAgentPopup(page, expectedWidth = null) {
  await page.waitForFunction((width) => {
    const root = document.getElementById('uc-agent-panel-root');
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    const backdrop = document.querySelector('[data-testid="agent-panel-backdrop"]');
    const popOutControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Open agent panel as a centered pop-up',
    );
    const resizeControl = Array.from(document.querySelectorAll('[aria-label]')).find(
      (element) => element.getAttribute('aria-label') === 'Resize docked agent panel',
    );
    return root.getAttribute('aria-modal') === null
      && !backdrop
      && Boolean(popOutControl && popOutControl.getBoundingClientRect().width > 0)
      && Boolean(resizeControl && resizeControl.getBoundingClientRect().width > 0)
      && rect.left >= -1
      && rect.top >= -1
      && rect.right <= innerWidth + 1
      && rect.bottom <= innerHeight + 1
      && Math.abs(rect.right - innerWidth) <= 1
      && (width === null || Math.abs(rect.width - width) <= 1);
  }, expectedWidth, { timeout: 15_000 });
}

function assertDockedAgentPopupEvidence(evidence, label, expectedWidth = null) {
  const hasMotion = (duration) => String(duration || '')
    .split(',')
    .some((value) => Number.parseFloat(value) > 0);
  if (
    evidence.role !== 'dialog'
    || evidence.ariaModal !== null
    || evidence.titleId !== 'uc-agent-panel-title'
    || evidence.title !== 'OpenSwan'
    || evidence.backdropPresent
    || evidence.dockControlVisible
    || !evidence.popOutControlVisible
    || !evidence.resizeControlVisible
  ) {
    throw new Error(`${label} did not retain exact non-modal dock semantics: ${JSON.stringify(evidence)}.`);
  }
  if (
    evidence.rect.width < 280
    || evidence.rect.height < 280
    || evidence.rect.left < -1
    || evidence.rect.top < -1
    || evidence.rect.right > evidence.viewport.width + 1
    || evidence.rect.bottom > evidence.viewport.height + 1
    || Math.abs(evidence.rect.right - evidence.viewport.width) > 1
  ) {
    throw new Error(`${label} escaped the docked viewport edge: ${JSON.stringify(evidence)}.`);
  }
  if (expectedWidth !== null && Math.abs(evidence.rect.width - expectedWidth) > 1) {
    throw new Error(`${label} did not retain the expected clamped width ${expectedWidth}: ${JSON.stringify(evidence)}.`);
  }
  if (
    !evidence.reducedMotionMatches
    || (evidence.animationName && evidence.animationName !== 'none')
    || hasMotion(evidence.animationDuration)
    || hasMotion(evidence.transitionDuration)
  ) {
    throw new Error(`${label} exposed motion under reduced motion: ${JSON.stringify(evidence)}.`);
  }
}

async function resizeDockedAgentPopupToMaximum(page) {
  const handle = page.getByLabel('Resize docked agent panel', { exact: true });
  await handle.focus();
  for (let press = 0; press < 20; press += 1) await page.keyboard.press('ArrowLeft');
  await waitForDockedAgentPopup(page, 720);
  const evidence = await readAgentPopupEvidence(page);
  assertDockedAgentPopupEvidence(evidence, 'Maximum-width docked Agent popup', 720);
  if (Number(evidence.resizeValueNow) !== 720) {
    throw new Error(`Docked resize semantics did not report the 720px maximum: ${JSON.stringify(evidence)}.`);
  }
  return evidence;
}

async function closeAgentPopupAndVerifyFocus(page) {
  await page.getByLabel('Close agent panel', { exact: true }).click();
  await waitForAgentPopupClosedAndFocus(page);
}

async function waitForAgentPopupClosedAndFocus(page) {
  await page.locator('#uc-agent-panel-root').waitFor({ state: 'detached', timeout: 15_000 });
  await page.waitForFunction(() => (
    document.activeElement?.getAttribute('aria-label') === 'Open OpenSwan agent panel'
  ), undefined, { timeout: 15_000 });
}

async function verifyCenteredHeaderBackdropIsolation(page) {
  const focusEndpoints = await page.locator('#uc-agent-panel-root').evaluate((root) => {
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(root.querySelectorAll(selector)).filter((element) => (
      !element.hasAttribute('aria-hidden') && element.offsetParent !== null
    ));
    if (focusables.length < 2) return null;
    focusables[focusables.length - 1].focus();
    return { count: focusables.length };
  });
  if (!focusEndpoints) throw new Error('The centered Agent popup exposed fewer than two focusable controls.');

  await page.keyboard.press('Tab');
  const forwardWrapped = await page.locator('#uc-agent-panel-root').evaluate((root) => {
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(root.querySelectorAll(selector)).filter((element) => (
      !element.hasAttribute('aria-hidden') && element.offsetParent !== null
    ));
    return focusables[0] === document.activeElement;
  });
  if (!forwardWrapped) throw new Error('Tab escaped the end of the centered Agent popup.');

  await page.keyboard.press('Shift+Tab');
  const reverseWrapped = await page.locator('#uc-agent-panel-root').evaluate((root) => {
    const selector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(root.querySelectorAll(selector)).filter((element) => (
      !element.hasAttribute('aria-hidden') && element.offsetParent !== null
    ));
    return focusables[focusables.length - 1] === document.activeElement;
  });
  if (!reverseWrapped) throw new Error('Shift+Tab escaped the start of the centered Agent popup.');

  const backdropEvidence = await page.evaluate(() => {
    const root = document.getElementById('uc-agent-panel-root');
    const backdrop = document.querySelector('[data-testid="agent-panel-backdrop"]');
    if (!root || !backdrop) return null;
    const rootRect = root.getBoundingClientRect();
    const point = {
      x: Math.max(1, Math.min(innerWidth - 2, rootRect.left - 8)),
      y: Math.max(1, Math.min(innerHeight - 2, Math.min(24, rootRect.top - 8))),
    };
    const hit = document.elementFromPoint(point.x, point.y);
    const style = getComputedStyle(backdrop);
    const floatingChat = document.getElementById('section-floating-chat');
    const floatingRect = floatingChat?.getBoundingClientRect() || null;
    const floatingVisible = Boolean(
      floatingChat
      && floatingRect
      && floatingRect.width > 0
      && floatingRect.height > 0
      && getComputedStyle(floatingChat).visibility !== 'hidden',
    );
    let floatingChatBackdropHit = false;
    let floatingChatPoint = null;
    if (floatingVisible && floatingRect) {
      const candidate = {
        x: Math.max(floatingRect.left + 2, rootRect.right + 8),
        y: Math.max(floatingRect.top + 2, Math.min(floatingRect.bottom - 2, rootRect.top + 80)),
      };
      if (candidate.x < floatingRect.right - 1) {
        floatingChatPoint = candidate;
        const floatingHit = document.elementFromPoint(candidate.x, candidate.y);
        floatingChatBackdropHit = Boolean(
          floatingHit && (floatingHit === backdrop || backdrop.contains(floatingHit)),
        );
      }
    }
    return {
      point,
      hitsBackdrop: Boolean(hit && (hit === backdrop || backdrop.contains(hit))),
      backdropAriaHidden: backdrop.getAttribute('aria-hidden'),
      backdropPointerEvents: style.pointerEvents,
      backdropZIndex: style.zIndex,
      panelZIndex: getComputedStyle(root).zIndex,
      floatingChatVisible: floatingVisible,
      floatingChatZIndex: floatingChat ? getComputedStyle(floatingChat).zIndex : null,
      floatingChatPoint,
      floatingChatBackdropHit,
    };
  });
  const backdropZIndex = Number(backdropEvidence?.backdropZIndex);
  const panelZIndex = Number(backdropEvidence?.panelZIndex);
  const floatingChatZIndex = Number(backdropEvidence?.floatingChatZIndex);
  if (
    !backdropEvidence?.hitsBackdrop
    || backdropEvidence.backdropAriaHidden !== 'true'
    || backdropEvidence.backdropPointerEvents === 'none'
    || !Number.isFinite(backdropZIndex)
    || !Number.isFinite(panelZIndex)
    || !Number.isFinite(floatingChatZIndex)
    || backdropZIndex <= 1000
    || panelZIndex <= backdropZIndex
    || !backdropEvidence.floatingChatVisible
    || !backdropEvidence.floatingChatPoint
    || !backdropEvidence.floatingChatBackdropHit
    || backdropZIndex <= floatingChatZIndex
  ) {
    throw new Error(`The centered popup did not isolate the tested header and floating-Chat backdrop areas: ${JSON.stringify(backdropEvidence)}.`);
  }

  await page.keyboard.press('Escape');
  await waitForAgentPopupClosedAndFocus(page);
  await openOpenSwanAgentPopup(page);
  await waitForExactPopupAuthorityReady(page);

  const clickPoint = await page.evaluate(() => {
    const root = document.getElementById('uc-agent-panel-root');
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    return {
      x: Math.max(1, Math.min(innerWidth - 2, rect.left - 8)),
      y: Math.max(1, Math.min(innerHeight - 2, Math.min(24, rect.top - 8))),
    };
  });
  if (!clickPoint) throw new Error('The reopened Agent popup exposed no backdrop test point.');
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await waitForAgentPopupClosedAndFocus(page);
  await openOpenSwanAgentPopup(page);
  await waitForExactPopupAuthorityReady(page);

  return {
    focusableCount: focusEndpoints.count,
    tabWrap: true,
    shiftTabWrap: true,
    escapeRestoredFocus: true,
    headerBackdropClickRestoredFocus: true,
    floatingChatBackdropBlocked: true,
  };
}

async function armDisposableSessionRefreshEvidence(page, expectedUserId) {
  await page.evaluate((userId) => {
    const client = globalThis.__supabaseClient;
    if (!client?.auth?.onAuthStateChange || !navigator.locks) {
      throw new Error('The app Supabase client or browser Web Locks API is unavailable.');
    }
    globalThis.__officePopupCanaryAuthSubscription?.unsubscribe?.();
    globalThis.__officePopupCanaryAuthEvents = [];
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event !== 'TOKEN_REFRESHED') return;
      globalThis.__officePopupCanaryAuthEvents.push({
        event,
        userMatches: session?.user?.id === userId,
      });
    });
    globalThis.__officePopupCanaryAuthSubscription = data.subscription;
  }, expectedUserId);
}

async function refreshDisposableSessionInTab(page, expectedUserId) {
  return page.evaluate(async (userId) => {
    const client = globalThis.__supabaseClient;
    if (!client?.auth?.refreshSession || !navigator.locks) {
      throw new Error('The app Supabase client or browser Web Locks API is unavailable.');
    }
    const before = await client.auth.getSession();
    if (before.error || before.data.session?.user?.id !== userId) {
      throw new Error('The tab did not hold the exact disposable user before refresh.');
    }
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || refreshed.data.session?.user?.id !== userId) {
      throw new Error(`The exact disposable session did not refresh: ${refreshed.error?.message || 'missing session'}.`);
    }
    return {
      userMatches: true,
      refreshAccepted: true,
    };
  }, expectedUserId);
}

async function waitForDisposableSessionRefreshEvidence(page) {
  await page.waitForFunction(() => (
    Array.isArray(globalThis.__officePopupCanaryAuthEvents)
    && globalThis.__officePopupCanaryAuthEvents.some(
      (entry) => entry?.event === 'TOKEN_REFRESHED' && entry.userMatches === true,
    )
  ), undefined, { timeout: 45_000 });
  return page.evaluate(() => {
    const events = Array.isArray(globalThis.__officePopupCanaryAuthEvents)
      ? globalThis.__officePopupCanaryAuthEvents
      : [];
    const receipt = {
      tokenRefreshedForExpectedUser: events.some(
        (entry) => entry?.event === 'TOKEN_REFRESHED' && entry.userMatches === true,
      ),
      unexpectedUserEvents: events.filter(
        (entry) => entry?.event === 'TOKEN_REFRESHED' && entry.userMatches !== true,
      ).length,
    };
    globalThis.__officePopupCanaryAuthSubscription?.unsubscribe?.();
    globalThis.__officePopupCanaryAuthSubscription = null;
    globalThis.__officePopupCanaryAuthEvents = [];
    return receipt;
  });
}

async function waitForSharedSessionConvergence(page, expectedUserId) {
  const storageKey = `sb-${supabaseProjectRef}-auth-token`;
  await page.waitForFunction(async ({ key, userId: expectedUserId }) => {
    const client = globalThis.__supabaseClient;
    if (!client?.auth?.getSession) return false;
    let persisted = null;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      persisted = parsed?.currentSession || parsed?.session || parsed;
    } catch {
      return false;
    }
    const current = await client.auth.getSession();
    return !current.error
      && current.data.session?.user?.id === expectedUserId
      && typeof current.data.session?.access_token === 'string'
      && current.data.session.access_token === persisted?.access_token;
  }, { key: storageKey, userId: expectedUserId }, { timeout: 45_000 });
}

/**
 * Passive popup-control lane over the disposable Office fixture.
 *
 * Two real same-origin tabs share the browser's auth storage and Web Lock.
 * The runner deliberately invokes no Office agent or provider control mutation;
 * the mounted app may still persist its routine activity/snapshot state, which
 * remains confined to the disposable user/circle. Concurrent refresh requests
 * touch only that disposable auth session. The popup must survive the resulting
 * authority-generation change while resetting any deeper route to Overview.
 */
async function runAgentPopupCanary(session) {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('Agent popup canary requires the exact disposable user identity.');
  }
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    const captured = [];
    Object.defineProperty(globalThis, '__officeUpdateLoopStacks', {
      configurable: true,
      value: captured,
    });
    const originalError = console.error;
    console.error = function (...args) {
      const text = args.map((value) => String(value)).join(' ');
      if (/Maximum update depth exceeded|Too many re-renders/i.test(text) && captured.length < 5) {
        captured.push({ text: text.slice(0, 500), stack: String(new Error().stack || '').slice(0, 4_000) });
      }
      return originalError.apply(this, args);
    };
  });
  let firstPage = null;
  let secondPage = null;
  let firstRecord = null;
  let secondRecord = null;
  try {
    ({ page: firstPage, record: firstRecord } = await openAuthenticatedOffice(
      context,
      session,
      'agent-popup-tab-a',
    ));
    ({ page: secondPage, record: secondRecord } = await openAuthenticatedOffice(
      context,
      session,
      'agent-popup-tab-b',
      { seedSession: false },
    ));
    progress('agent-popup:two-tabs-ready');

    if (
      firstRecord.bundleIdentity?.appArtifactSha256
      !== secondRecord.bundleIdentity?.appArtifactSha256
    ) {
      throw new Error('The two popup tabs loaded different Expo entry artifacts.');
    }

    await openFloatingChatBehindOffice(firstPage);
    startPopupDiagnostics(firstRecord);
    await openOpenSwanAgentPopup(firstPage);
    let landscapeEvidence = await readAgentPopupEvidence(firstPage);
    assertAgentPopupEvidence(landscapeEvidence, 'Landscape Agent popup', true);
    if (!landscapeEvidence.overviewSelected) {
      throw new Error('The Agent popup did not open at the Overview destination.');
    }
    await waitForExactPopupAuthorityReady(firstPage);
    await assertPopupSectionHealthy(firstPage, firstRecord, 'First-tab Overview');
    const headerAreaBackdropIsolation = await verifyCenteredHeaderBackdropIsolation(firstPage);
    progress('agent-popup:centered-header-and-chat-backdrop-isolation-verified');

    await selectAgentCustomize(firstPage);
    const appearancePreview = firstPage.getByRole('img', { name: 'Appearance preview for OpenSwan' });
    await appearancePreview.waitFor({ state: 'visible', timeout: 30_000 });
    const previewAnimationCount = await appearancePreview.evaluate((element) => (
      typeof element.getAnimations === 'function'
        ? element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length
        : -1
    ));
    if (previewAnimationCount !== 0) {
      throw new Error(`The reduced-motion appearance preview retained ${previewAnimationCount} running animation(s).`);
    }
    await assertPopupSectionHealthy(firstPage, firstRecord, 'First-tab Customize');
    progress('agent-popup:reduced-motion-preview-verified');

    await firstPage.setViewportSize({ width: 820, height: 1180 });
    await firstPage.waitForFunction(() => innerWidth === 820 && innerHeight === 1180);
    await waitForResponsiveAgentPopup(firstPage, false);
    const portraitEvidence = await readAgentPopupEvidence(firstPage);
    assertAgentPopupEvidence(portraitEvidence, 'Portrait Agent popup', false);
    if (!portraitEvidence.customizeSelected) {
      throw new Error('Tablet portrait resize discarded the active Customize section.');
    }
    await assertPopupSectionHealthy(firstPage, firstRecord, 'Portrait Customize');

    await firstPage.setViewportSize({ width: 1180, height: 820 });
    await firstPage.waitForFunction(() => innerWidth === 1180 && innerHeight === 820);
    await waitForResponsiveAgentPopup(firstPage, true);
    landscapeEvidence = await readAgentPopupEvidence(firstPage);
    assertAgentPopupEvidence(landscapeEvidence, 'Restored landscape Agent popup', true);
    if (!landscapeEvidence.customizeSelected) {
      throw new Error('Tablet landscape resize discarded the active Customize section.');
    }
    progress('agent-popup:responsive-modal-verified');

    await firstPage.getByLabel('Dock agent panel to the right', { exact: true }).click();
    await waitForDockedAgentPopup(firstPage, 480);
    const initialDockEvidence = await readAgentPopupEvidence(firstPage);
    assertDockedAgentPopupEvidence(initialDockEvidence, 'Initial docked Agent popup', 480);
    if (!initialDockEvidence.customizeSelected) {
      throw new Error('Docking discarded the active Customize section.');
    }
    const maximumDockEvidence = await resizeDockedAgentPopupToMaximum(firstPage);
    await assertPopupSectionHealthy(firstPage, firstRecord, 'Maximum-width docked Customize');

    await firstPage.setViewportSize({ width: 620, height: 900 });
    await firstPage.waitForFunction(() => innerWidth === 620 && innerHeight === 900);
    await waitForResponsiveAgentPopup(firstPage, false);
    await firstPage.waitForFunction(() => localStorage.getItem('uc_agent_panel_side_w_v1') === '540');
    const compactDockFallbackEvidence = await readAgentPopupEvidence(firstPage);
    assertAgentPopupEvidence(compactDockFallbackEvidence, 'Compact fallback for docked Agent popup', false);
    if (!compactDockFallbackEvidence.customizeSelected) {
      throw new Error('The dock-to-compact breakpoint transition discarded Customize.');
    }

    await firstPage.setViewportSize({ width: 1180, height: 820 });
    await firstPage.waitForFunction(() => innerWidth === 1180 && innerHeight === 820);
    await waitForDockedAgentPopup(firstPage, 540);
    const restoredDockEvidence = await readAgentPopupEvidence(firstPage);
    assertDockedAgentPopupEvidence(restoredDockEvidence, 'Restored docked Agent popup', 540);
    if (!restoredDockEvidence.customizeSelected) {
      throw new Error('The compact-to-dock breakpoint restoration discarded Customize.');
    }
    await firstPage.getByLabel('Open agent panel as a centered pop-up', { exact: true }).click();
    await waitForResponsiveAgentPopup(firstPage, true);
    landscapeEvidence = await readAgentPopupEvidence(firstPage);
    assertAgentPopupEvidence(landscapeEvidence, 'Re-centered Agent popup after dock lifecycle', true);
    await assertPopupSectionHealthy(firstPage, firstRecord, 'Re-centered Customize');
    progress('agent-popup:docked-resize-breakpoint-restoration-verified');

    const availablePanelRoutes = await visitEveryAvailableAgentPanelRoute(firstPage, firstRecord);
    await selectAgentCustomize(firstPage);
    await assertPopupSectionHealthy(firstPage, firstRecord, 'Customize restored after available-route sweep');
    progress('agent-popup:all-available-routes-verified');
    const compactCenteredLifecycle = await verifyCompactCenteredAgentPopupLifecycle(firstPage, firstRecord);
    progress('agent-popup:390x844-centered-route-retention-verified');

    startPopupDiagnostics(secondRecord);
    await openOpenSwanAgentPopup(secondPage);
    const secondTabEvidence = await readAgentPopupEvidence(secondPage);
    assertAgentPopupEvidence(secondTabEvidence, 'Second-tab Agent popup', true);
    if (!secondTabEvidence.overviewSelected) {
      throw new Error('The second tab did not open the same exact OpenSwan Overview projection.');
    }
    await waitForExactPopupAuthorityReady(secondPage);
    await assertPopupSectionHealthy(secondPage, secondRecord, 'Second-tab Overview');
    await selectAgentCustomize(secondPage);
    await Promise.all([
      assertPopupSectionHealthy(firstPage, firstRecord, 'Pre-refresh first-tab Customize'),
      assertPopupSectionHealthy(secondPage, secondRecord, 'Pre-refresh second-tab Customize'),
    ]);
    const preRefreshFirstEvidence = await readAgentPopupEvidence(firstPage);
    const preRefreshSecondEvidence = await readAgentPopupEvidence(secondPage);
    if (!preRefreshFirstEvidence.customizeSelected || !preRefreshSecondEvidence.customizeSelected) {
      throw new Error('Both popup tabs must hold a non-Overview route before auth refresh.');
    }
    await Promise.all([
      armDisposableSessionRefreshEvidence(firstPage, userId),
      armDisposableSessionRefreshEvidence(secondPage, userId),
    ]);

    const refreshReceipts = await settleWithin(Promise.all([
      refreshDisposableSessionInTab(firstPage, userId),
      refreshDisposableSessionInTab(secondPage, userId),
    ]), 30_000, 'two-tab disposable session refresh');
    if (refreshReceipts.some((receipt) => !receipt.userMatches || !receipt.refreshAccepted)) {
      throw new Error('Concurrent tab refresh did not retain the exact disposable user in both views.');
    }
    const authRefreshEvidence = await Promise.all([
      waitForDisposableSessionRefreshEvidence(firstPage),
      waitForDisposableSessionRefreshEvidence(secondPage),
    ]);
    if (authRefreshEvidence.some((receipt) => (
      !receipt.tokenRefreshedForExpectedUser || receipt.unexpectedUserEvents > 0
    ))) {
      throw new Error('The two tabs did not observe exact-user TOKEN_REFRESHED lifecycle events.');
    }
    await waitForSharedSessionConvergence(firstPage, userId);
    await waitForSharedSessionConvergence(secondPage, userId);
    await Promise.all([
      firstPage.getByLabel('Overview destination', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 }),
      secondPage.getByLabel('Overview destination', { exact: true }).waitFor({ state: 'visible', timeout: 45_000 }),
    ]);
    await firstPage.waitForFunction(() => (
      document.querySelector('[aria-label="Overview destination"]')?.getAttribute('aria-selected') === 'true'
    ), undefined, { timeout: 45_000 });
    await secondPage.waitForFunction(() => (
      document.querySelector('[aria-label="Overview destination"]')?.getAttribute('aria-selected') === 'true'
    ), undefined, { timeout: 45_000 });
    await Promise.all([
      waitForExactPopupAuthorityReady(firstPage),
      waitForExactPopupAuthorityReady(secondPage),
    ]);
    await Promise.all([
      assertPopupSectionHealthy(firstPage, firstRecord, 'Refreshed first-tab Overview'),
      assertPopupSectionHealthy(secondPage, secondRecord, 'Refreshed second-tab Overview'),
    ]);
    progress('agent-popup:multi-tab-authority-refresh-verified');

    const refreshedFirstEvidence = await readAgentPopupEvidence(firstPage);
    const refreshedSecondEvidence = await readAgentPopupEvidence(secondPage);
    assertAgentPopupEvidence(refreshedFirstEvidence, 'Refreshed first-tab Agent popup', true);
    assertAgentPopupEvidence(refreshedSecondEvidence, 'Refreshed second-tab Agent popup', true);
    if (!refreshedFirstEvidence.overviewSelected || !refreshedSecondEvidence.overviewSelected) {
      throw new Error('Authority refresh did not reset both popup routes to Overview.');
    }

    await settleWithin(
      firstPage.screenshot({ path: agentPopupScreenshot, fullPage: true }),
      7_500,
      'Agent popup evidence screenshot',
    );
    await closeAgentPopupAndVerifyFocus(firstPage);
    await closeAgentPopupAndVerifyFocus(secondPage);
    stopPopupDiagnostics(firstRecord);
    stopPopupDiagnostics(secondRecord);
    progress('agent-popup:focus-restoration-verified');

    const records = [firstRecord, secondRecord];
    await Promise.allSettled(records.flatMap((record) => record.consoleErrorReads));
    records.forEach((record) => assertNoReactUpdateLoopErrors(record, `Agent popup ${record.viewport}`));
    const pageErrors = records.flatMap((record) => record.pageErrors);
    const serverErrors = records.flatMap((record) => record.serverErrors);
    const popupConsoleErrors = records.flatMap((record) => record.popupConsoleErrors);
    const popupSectionErrors = records.flatMap((record) => record.popupSectionErrors);
    const essentialRequestFailures = records.flatMap((record) => record.failedRequests).filter((message) => {
      const requestUrl = message.match(/^\S+\s+(\S+)/)?.[1] || '';
      return isOfficeCanaryEssentialRequest(requestUrl);
    });
    if (pageErrors.length > 0) throw new Error(`Agent popup tabs observed ${pageErrors.length} uncaught page error(s).`);
    if (serverErrors.length > 0) throw new Error(`Agent popup tabs observed ${serverErrors.length} essential HTTP 5xx response(s).`);
    if (popupConsoleErrors.length > 0) {
      throw new Error(`Agent popup tabs observed ${popupConsoleErrors.length} non-allowlisted popup console error(s): ${JSON.stringify(popupConsoleErrors.slice(0, 5))}.`);
    }
    if (popupSectionErrors.length > 0) {
      throw new Error(`Agent popup tabs observed ${popupSectionErrors.length} visible section error(s): ${JSON.stringify(popupSectionErrors.slice(0, 5))}.`);
    }
    if (essentialRequestFailures.length > 0) {
      throw new Error(`Agent popup tabs observed ${essentialRequestFailures.length} essential request failure(s).`);
    }

    return {
      routes: [firstPage.url(), secondPage.url()],
      agent: 'OpenSwan',
      sameBundleManifest: true,
      expectedAppArtifactSha256,
      multiTabAuthorityRefresh: 'converged',
      tokenRefreshEvents: authRefreshEvidence,
      responsiveWebTabletViewports: ['1180x820', '820x1180', '1180x820'],
      availablePanelRoutes,
      compactCenteredLifecycle,
      dockedWebLifecycle: {
        initialWidth: initialDockEvidence.rect.width,
        maximumClampedWidth: maximumDockEvidence.rect.width,
        compactModalFallback: '620x900',
        restoredWidth: restoredDockEvidence.rect.width,
        restoredAsDock: true,
        returnedToCenteredPopup: true,
      },
      reducedMotionPreviewAnimations: previewAnimationCount,
      headerAreaBackdropIsolation,
      focusRestoredInBothTabs: true,
      pageErrors: 0,
      popupConsoleErrors: 0,
      popupAllowedConsoleErrors: records.flatMap((record) => record.popupAllowedConsoleErrors),
      popupSectionErrors: 0,
      serverErrors: 0,
      screenshot: agentPopupScreenshot,
    };
  } catch (error) {
    stopPopupDiagnostics(firstRecord);
    stopPopupDiagnostics(secondRecord);
    await Promise.all([
      settleFailureEvidence(firstPage, firstRecord, agentPopupFirstFailureScreenshot),
      settleFailureEvidence(secondPage, secondRecord, agentPopupSecondFailureScreenshot),
    ]);
    throw error;
  } finally {
    await closePlaywrightResource(context, 'agent-popup-context-close');
  }
}

async function cleanupImpl() {
  progress('cleanup:start');
  await closePlaywrightResource(browser, 'browser-close');
  if ((userId && !/^[0-9a-f-]{36}$/i.test(userId)) || (circleId && !/^[0-9a-f-]{36}$/i.test(circleId))) {
    throw new Error('Refusing cleanup for malformed identifiers.');
  }
  const escapedEmail = email.replace(/'/g, "''");
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    // A timed-out signup may still be committing. Reconcile the exact random
    // email for a bounded window before claiming that no fixture exists.
    for (let attempt = 0; attempt < 6 && !resolvedUserId; attempt += 1) {
      const matchingUsers = await managementDatabaseQuery(
        `select id::text from auth.users where email = '${escapedEmail}' limit 1;`,
      );
      const candidate = Array.isArray(matchingUsers) ? matchingUsers[0]?.id : null;
      if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate)) {
        resolvedUserId = candidate;
        userId = candidate;
        break;
      }
      if (attempt < 5) await delay(750);
    }
  }
  if (!resolvedUserId && !circleId) {
    cleanupComplete = true;
    progress('cleanup:verified-no-fixture');
    return;
  }
  if (!resolvedUserId) {
    throw new Error('Refusing management cleanup without an exact disposable user identity.');
  }
  const userSelector = resolvedUserId ? `'${resolvedUserId}'::uuid` : 'null::uuid';
  const exactDisposableUsers = await managementDatabaseQuery(
    `select id::text from auth.users where id = ${userSelector} and email = '${escapedEmail}' limit 2;`,
  );
  if (
    !Array.isArray(exactDisposableUsers)
    || exactDisposableUsers.length !== 1
    || exactDisposableUsers[0]?.id !== resolvedUserId
  ) {
    throw new Error('Refusing management cleanup because disposable user ownership was not proven.');
  }
  if (circleId) {
    const exactDisposableCircles = await managementDatabaseQuery(
      `select id::text from public.circles where id = '${circleId}'::uuid and created_by = ${userSelector} limit 2;`,
    );
    if (
      !Array.isArray(exactDisposableCircles)
      || exactDisposableCircles.length !== 1
      || exactDisposableCircles[0]?.id !== circleId
    ) {
      throw new Error('Refusing management cleanup because disposable circle ownership was not proven.');
    }
  }
  const statements = [
    'begin;',
    circleId
      ? `delete from public.circles where id = '${circleId}'::uuid and created_by = ${userSelector};`
      : `delete from public.circles where created_by = ${userSelector};`,
    `delete from public.profiles where id = ${userSelector};`,
    `delete from auth.users where id = ${userSelector} and email = '${escapedEmail}';`,
    'commit;',
  ].filter(Boolean).join('\n');
  await managementDatabaseQuery(statements);

  const receipt = await managementDatabaseQuery(`select
    (select count(*)::int from public.circles where created_by = ${userSelector}) as circle_count,
    (select count(*)::int from public.profiles where id = ${userSelector}) as profile_count,
    (select count(*)::int from auth.users where id = ${userSelector} or email = '${escapedEmail}') as user_count;`);
  const counts = Array.isArray(receipt) ? receipt[0] : null;
  if (
    counts?.circle_count !== 0
    || counts?.profile_count !== 0
    || counts?.user_count !== 0
  ) {
    throw new Error('Supabase cleanup verification found temporary records still present.');
  }
  cleanupComplete = true;
  progress('cleanup:verified');
}

function cleanup() {
  if (!cleanupPromise) cleanupPromise = cleanupImpl();
  return cleanupPromise;
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    liveRequestAbortController.abort(new Error(`Office canary interrupted by ${signal}.`));
    progress(`signal:${signal}:cleanup-requested`);
    const hardExit = setTimeout(() => {
      writeReceipt({
        officeCanary: 'cleanup-timeout',
        recoveryMarker: { email, userId, circleId },
      });
      process.exit(exitCode);
    }, 25_000);
    void cleanup().then(() => {
      clearTimeout(hardExit);
      process.exit(exitCode);
    }).catch((error) => {
      clearTimeout(hardExit);
      writeReceipt({
        officeCanary: 'cleanup-failed-after-signal',
        cleanup: error instanceof Error ? error.message : String(error),
        recoveryMarker: { email, userId, circleId },
      });
      process.exit(exitCode);
    });
  });
}

let result = null;
let runFailure = null;
let appArtifactPreflight = null;
try {
  // Verify cleanup authority before creating any temporary server state.
  await managementDatabaseQuery('select 1 as cleanup_authority_ready;');
  progress('preflight:cleanup-authority-ready');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  progress('browser:ephemeral-headless-launched');
  appArtifactPreflight = await preflightExpectedAppArtifact();
  progress('preflight:app-artifact-digest-verified');
  const signup = await supabaseRequest('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { full_name: 'OpenSwan Office E2E' },
    }),
  });
  if (signup?.user?.id) userId = signup.user.id;
  if (!signup.access_token || !signup.user?.id) {
    throw new Error('Signup did not return an authenticated session.');
  }
  progress('fixture:temporary-user-created');
  const authHeaders = {
    Authorization: `Bearer ${signup.access_token}`,
    Prefer: 'return=representation',
  };
  const circles = await supabaseRequest('/rest/v1/circles?select=id,name', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: `OpenSwan Office E2E ${marker}`,
      description: 'Temporary automated Office validation',
      max_members: 3,
      created_by: userId,
      circle_type: 'custom',
      icon: '🏢',
      accent_color: '#6366f1',
      check_in_format: { type: 'text', label: 'Daily Check-in' },
      tags: [],
      settings: {},
    }),
  });
  if (!Array.isArray(circles) || !circles[0]?.id) throw new Error('Circle creation returned no identifier.');
  circleId = circles[0].id;
  progress('fixture:temporary-circle-created');

  const membershipQuery = new URLSearchParams({
    select: 'role',
    circle_id: `eq.${circleId}`,
    user_id: `eq.${userId}`,
  });
  const memberships = await supabaseRequest(`/rest/v1/circle_members?${membershipQuery.toString()}`, {
    headers: { Authorization: `Bearer ${signup.access_token}` },
  });
  if (!Array.isArray(memberships) || memberships.length !== 1) {
    throw new Error('Temporary circle membership is not visible to the temporary user.');
  }

  const desktop = await runDesktopCanary(signup);
  progress('desktop:complete');
  const mobile = await runMobileCanary(signup);
  progress('mobile:complete');
  const agentPopup = await runAgentPopupCanary(signup);
  progress('agent-popup:complete');
  result = {
    target: appBaseUrl,
    temporarySignup: true,
    temporaryCircle: true,
    browserMode: 'ephemeral-headless-system-chrome',
    appArtifact: {
      expectedSha256: expectedAppArtifactSha256,
      observedSha256: appArtifactPreflight.appArtifactSha256,
      entryResources: appArtifactPreflight.entryResources,
    },
    desktop,
    mobile,
    agentPopup,
    diagnostics: diagnostics.map((entry) => ({
      viewport: entry.viewport,
      pageErrors: entry.pageErrors.length,
      consoleErrors: entry.consoleErrors.length,
      failedRequests: entry.failedRequests.length,
      serverErrors: entry.serverErrors.length,
      sampleConsoleErrors: entry.consoleErrors.slice(0, 3),
      updateLoopConsoleDetails: entry.consoleErrorDetails.filter((detail) => (
        /Maximum update depth exceeded|Too many re-renders/i.test(detail.text)
      )).slice(0, 3),
      popupConsoleErrors: entry.popupConsoleErrors.slice(0, 5),
      popupAllowedConsoleErrors: entry.popupAllowedConsoleErrors.slice(0, 5),
      popupSectionErrors: entry.popupSectionErrors.slice(0, 5),
      sampleFailedRequests: entry.failedRequests.slice(0, 3),
      sampleServerErrors: entry.serverErrors.slice(0, 3),
      layoutResponses: entry.layoutResponses.slice(-12),
      supabaseHosts: [...entry.supabaseHosts].sort(),
      bundleIdentity: entry.bundleIdentity,
      failureScreenshot: entry.failureScreenshot,
    })),
  };
} catch (error) {
  runFailure = error;
}

let cleanupFailure = null;
try {
  await cleanup();
} catch (error) {
  cleanupFailure = error;
}

if (runFailure || cleanupFailure) {
  const summarizeError = (error) => error ? {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 5).join('\n') : undefined,
  } : null;
  writeReceipt({
    officeCanary: 'failed',
    primary: summarizeError(runFailure),
    cleanup: summarizeError(cleanupFailure),
    cleanupComplete,
    diagnostics: diagnostics.map((entry) => ({
      viewport: entry.viewport,
      pageErrors: entry.pageErrors.length,
      consoleErrors: entry.consoleErrors.length,
      sampleConsoleErrors: entry.consoleErrors.slice(-5),
      updateLoopConsoleDetails: entry.consoleErrorDetails.filter((detail) => (
        /Maximum update depth exceeded|Too many re-renders/i.test(detail.text)
      )).slice(-3),
      popupConsoleErrors: entry.popupConsoleErrors.slice(-8),
      popupAllowedConsoleErrors: entry.popupAllowedConsoleErrors.slice(-8),
      popupSectionErrors: entry.popupSectionErrors.slice(-8),
      failedRequests: entry.failedRequests.slice(-8),
      serverErrors: entry.serverErrors.slice(-5),
      layoutResponses: entry.layoutResponses.slice(-12),
      supabaseHosts: [...entry.supabaseHosts].sort(),
      bundleIdentity: entry.bundleIdentity,
      failureScreenshot: entry.failureScreenshot,
    })),
    recoveryMarker: cleanupComplete ? null : { email, userId, circleId },
  });
  process.exit(1);
}

fs.writeSync(
  process.stdout.fd,
  `${JSON.stringify({ ...result, cleanup: cleanupComplete ? 'complete' : 'failed' }, null, 2)}\n`,
);
process.exit(0);
