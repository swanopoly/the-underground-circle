/**
 * Authenticated Office editor canary against the linked Supabase project.
 *
 * The canary is deliberately opt-in because it creates a temporary user and
 * circle. It uses an ephemeral headless system-Chrome context rather than the
 * persistent browser bridge, exercises desktop and compact web editing, then
 * deletes all temporary server state in a finally block.
 *
 * Run:
 *   RUN_LIVE_OFFICE_E2E=1 node scripts/office-authenticated-local-e2e.mjs
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

const appBaseUrl = (process.env.OFFICE_E2E_APP_URL || 'http://localhost:8081').replace(/\/$/, '');
const parsedAppUrl = new URL(appBaseUrl);
if (
  parsedAppUrl.protocol !== 'https:'
  && !(parsedAppUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedAppUrl.hostname))
) {
  throw new Error('Office canary target must use HTTPS unless it is localhost.');
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
const desktopFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-desktop-failure.png`);
const mobileFailureScreenshot = path.join(artifactDir, `openswan-office-e2e-${marker}-mobile-failure.png`);

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
    || /\/rest\/v1\/office_layouts(?:\?|$)|\/rest\/v1\/rpc\/save_office_layout_v2(?:\?|$)/i.test(requestUrl);
}

function attachDiagnostics(page, viewport) {
  const record = {
    viewport,
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    serverErrors: [],
    layoutResponses: [],
    layoutResponseReads: [],
    supabaseHosts: new Set(),
    bundleIdentity: null,
    failureScreenshot: null,
  };
  diagnostics.push(record);
  page.on('pageerror', (error) => record.pageErrors.push(String(error?.message || error).slice(0, 500)));
  page.on('console', (message) => {
    if (message.type() === 'error') record.consoleErrors.push(message.text().slice(0, 500));
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

async function readBundleIdentity(page) {
  const resources = await page.evaluate(() => Array.from(new Set(
    performance.getEntriesByType('resource')
      .map((entry) => {
        try {
          const url = new URL(entry.name);
          return (
            url.pathname.includes('/_expo/static/js/web/')
            || /\.bundle$/i.test(url.pathname)
          ) ? url.pathname : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  )).sort());
  if (resources.length === 0) throw new Error('Office canary observed no Expo web bundle resources.');
  return {
    resourceManifestSha256: crypto.createHash('sha256').update(resources.join('\n')).digest('hex'),
    resourceCount: resources.length,
    entryResources: resources.filter((resource) => (
      /\/(?:index|__common)-[^/]+\.js$/.test(resource)
      || /\/index\.bundle$/.test(resource)
    )).slice(0, 8),
  };
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

async function openAuthenticatedOffice(context, session, viewportName) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const record = attachDiagnostics(page, viewportName);
  await page.goto(`${appBaseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  const storageKey = `sb-${supabaseProjectRef}-auth-token`;
  const storedSession = {
    ...session,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
  };
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, value);
  }, { key: storageKey, value: JSON.stringify(storedSession) });
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
  const userSelector = resolvedUserId ? `'${resolvedUserId}'::uuid` : 'null::uuid';
  const statements = [
    'begin;',
    circleId
      ? `delete from public.circles where id = '${circleId}'::uuid or created_by = ${userSelector};`
      : `delete from public.circles where created_by = ${userSelector};`,
    `delete from public.profiles where id = ${userSelector};`,
    `delete from auth.users where id = ${userSelector} or email = '${escapedEmail}';`,
    'commit;',
  ].filter(Boolean).join('\n');
  await managementDatabaseQuery(statements);

  const receipt = await managementDatabaseQuery(`select
    (select count(*)::int from public.circles where
      ${circleId ? `id = '${circleId}'::uuid or` : ''} created_by = ${userSelector}) as circle_count,
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
try {
  // Verify cleanup authority before creating any temporary server state.
  await managementDatabaseQuery('select 1 as cleanup_authority_ready;');
  progress('preflight:cleanup-authority-ready');
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

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  progress('browser:ephemeral-headless-launched');
  const desktop = await runDesktopCanary(signup);
  progress('desktop:complete');
  const mobile = await runMobileCanary(signup);
  progress('mobile:complete');
  result = {
    target: appBaseUrl,
    temporarySignup: true,
    temporaryCircle: true,
    browserMode: 'ephemeral-headless-system-chrome',
    desktop,
    mobile,
    diagnostics: diagnostics.map((entry) => ({
      viewport: entry.viewport,
      pageErrors: entry.pageErrors.length,
      consoleErrors: entry.consoleErrors.length,
      failedRequests: entry.failedRequests.length,
      serverErrors: entry.serverErrors.length,
      sampleConsoleErrors: entry.consoleErrors.slice(0, 3),
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
