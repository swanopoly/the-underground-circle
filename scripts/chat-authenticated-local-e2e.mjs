/**
 * Authenticated Chat canary against the linked Supabase project.
 *
 * This creates one temporary user and circle, opens the local app through an
 * isolated Chrome DevTools target, sends the deterministic `/help` command,
 * then removes the circle, profile, and auth user in a finally block.
 *
 * Preconditions:
 *   RUN_LIVE_CHAT_E2E=1 node scripts/chat-authenticated-local-e2e.mjs
 *   - localhost:8081 is running, or CHAT_E2E_APP_URL names an HTTPS deployment
 *   - an isolated Chrome is listening on 127.0.0.1:9333
 *   - Supabase CLI is authenticated and the repo is linked
 * Optional exact-turn regression:
 *   CHAT_E2E_MESSAGE=hello CHAT_E2E_EXPECT=greeting-routing CHAT_E2E_WEB_SEARCH=1
 * Optional Actions-only surface regression (does not send a chat turn):
 *   CHAT_E2E_ACTIONS=1
 */

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

if (process.env.RUN_LIVE_CHAT_E2E !== '1') {
  throw new Error('Refusing live canary without RUN_LIVE_CHAT_E2E=1.');
}

const env = Object.fromEntries(
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

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) throw new Error('Supabase public configuration is missing.');
if (new URL(supabaseUrl).protocol !== 'https:') throw new Error('Supabase URL must use HTTPS.');

const appBaseUrl = (process.env.CHAT_E2E_APP_URL || 'http://localhost:8081').replace(/\/$/, '');
const parsedAppUrl = new URL(appBaseUrl);
if (
  parsedAppUrl.protocol !== 'https:'
  && !(parsedAppUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedAppUrl.hostname))
) {
  throw new Error('Chat canary target must use HTTPS unless it is localhost.');
}
const chatMessage = (process.env.CHAT_E2E_MESSAGE || '/help').trim();
const expectedOutcome = process.env.CHAT_E2E_EXPECT || (chatMessage === '/help' ? 'help' : 'greeting-routing');
const enableWebSearch = process.env.CHAT_E2E_WEB_SEARCH === '1';
const enableActionsProbe = process.env.CHAT_E2E_ACTIONS === '1';
if (!chatMessage || chatMessage.length > 240) throw new Error('Chat canary message must contain 1-240 characters.');
if (!['help', 'greeting-routing'].includes(expectedOutcome)) throw new Error('Unsupported CHAT_E2E_EXPECT value.');

const marker = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const email = `openswan-chat-e2e-${marker}@example.com`;
const password = `Aa9!${crypto.randomBytes(18).toString('base64url')}`;

let userId = null;
let circleId = null;
let bootstrapProbe = null;
let socket = null;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const webSearchRequests = [];
const openSwanTaskRequests = [];
const greetingToolPayloads = [];
const actionsProbeChatSendRequests = [];
let greetingSubmitted = false;
let actionsProbeCapturingNetwork = false;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function supabaseRequest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${path} returned ${response.status}: ${detail.slice(0, 240)}`);
  }
  return body;
}

const BOT_META_MARKER = '\n[[UC_CHAT_META]]';

function normalizePersistedAssistantReply(row) {
  const rawContent = typeof row?.content === 'string' ? row.content : '';
  const markerIndex = rawContent.indexOf(BOT_META_MARKER);
  const visibleContent = (markerIndex >= 0 ? rawContent.slice(0, markerIndex) : rawContent)
    .replace(/^\s*(?:\[BOT\]|♛\s*)/i, '')
    .trim();
  let metadata = null;
  if (markerIndex >= 0) {
    try {
      metadata = JSON.parse(rawContent.slice(markerIndex + BOT_META_MARKER.length).trim());
    } catch { /* malformed metadata is not positive response proof */ }
  }
  const surface = typeof metadata?.source?.surface === 'string'
    ? metadata.source.surface
    : '';
  const recoveryOptions = Array.isArray(metadata?.recoveryOptions)
    ? metadata.recoveryOptions
    : [];
  const isNormalMainChat = surface.startsWith('main_chat')
    && surface !== 'main_chat_session_greeting'
    && surface !== 'main_chat_pending'
    && !surface.endsWith('_error');
  const hasFailureCopy = /couldn['’]t finish|did not complete|failed before|action did not complete|web search failed/i
    .test(visibleContent);

  if (!visibleContent || !isNormalMainChat || recoveryOptions.length > 0 || hasFailureCopy) {
    return null;
  }
  return {
    id: row.id,
    surface,
    createdAt: row.created_at,
    visibleCharacters: visibleContent.length,
  };
}

async function waitForPersistedAssistantReply(accessToken, sentAt) {
  const deadline = Date.now() + 45_000;
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  while (Date.now() < deadline) {
    const query = new URLSearchParams({
      select: 'id,content,is_bot,created_at',
      circle_id: `eq.${circleId}`,
      is_bot: 'eq.true',
      created_at: `gte.${sentAt}`,
      order: 'created_at.asc',
      limit: '20',
    });
    const rows = await supabaseRequest(`/rest/v1/messages?${query.toString()}`, {
      headers: authHeaders,
    });
    for (const row of Array.isArray(rows) ? rows : []) {
      const reply = normalizePersistedAssistantReply(row);
      if (reply) return reply;
    }
    await delay(2_000);
  }
  return null;
}

function readDevToolsJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9333, path: pathname }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function cdpCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdpCall('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Browser evaluation failed.',
    );
  }
  return result.result.value;
}

async function connectChrome() {
  const pages = await readDevToolsJson('/json/list');
  const page = pages.find((candidate) => candidate.type === 'page') || pages[0];
  if (!page) throw new Error('No isolated Chrome page target is available on port 9333.');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(
        message.params.exceptionDetails?.exception?.description
        || message.params.exceptionDetails?.text
        || 'Browser exception',
      );
    }
    if (
      message.method === 'Runtime.consoleAPICalled'
      && ['error', 'warning'].includes(message.params.type)
    ) {
      const text = message.params.args
        ?.map((arg) => arg.value || arg.description || '')
        .join(' ');
      if (text) consoleErrors.push(text);
    }
    if (message.method === 'Network.requestWillBeSent') {
      const request = message.params?.request;
      if (
        actionsProbeCapturingNetwork
        && typeof request?.url === 'string'
        && (
          /\/functions\/v1\/(?:chat-stream|llm-proxy|swanbot-ai|swanbot-v2-ai|automation-executor|room-task-executor)(?:[/?]|$)/i.test(request.url)
          || (
            /\/rest\/v1\/messages(?:[?]|$)/i.test(request.url)
            && !['GET', 'HEAD', 'OPTIONS'].includes(String(request.method || '').toUpperCase())
          )
        )
      ) {
        // Keep only a count. URLs and request bodies may carry authenticated
        // context and are not needed to prove that prefill stayed local.
        actionsProbeChatSendRequests.push(true);
      }
      if (
        greetingSubmitted
        && typeof request?.url === 'string'
        && /\/functions\/v1\/(?:chat-stream|llm-proxy)(?:[/?]|$)/i.test(request.url)
        && typeof request.postData === 'string'
      ) {
        try {
          const payload = JSON.parse(request.postData);
          const hasTools = Array.isArray(payload?.tools) && payload.tools.length > 0;
          const hasPlugins = Array.isArray(payload?.plugins) && payload.plugins.length > 0;
          if (hasTools || hasPlugins) greetingToolPayloads.push(request.url);
        } catch {
          // An unreadable request body cannot prove a tool-less greeting.
          greetingToolPayloads.push(request.url);
        }
      }
      if (
        typeof request?.url === 'string'
        && request.url.includes('/functions/v1/llm-proxy')
        && typeof request.postData === 'string'
        && request.postData.includes('openrouter:web_search')
      ) {
        webSearchRequests.push(request.url);
      }
      if (
        greetingSubmitted
        && typeof request?.url === 'string'
        && /\/functions\/v1\/(?:swanbot-ai|swanbot-v2-ai|automation-executor|room-task-executor)(?:[/?]|$)/i.test(request.url)
      ) {
        openSwanTaskRequests.push(request.url);
      }
    }
  };
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  await cdpCall('Runtime.enable');
  await cdpCall('Page.enable');
  await cdpCall('Network.enable');
  await cdpCall('Network.setCacheDisabled', { cacheDisabled: true });
  await cdpCall('Network.clearBrowserCache');
}

async function waitForBrowserValue(expression, label, timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(expression);
    if (lastValue) return lastValue;
    await delay(100);
  }
  throw new Error(`Actions probe timed out waiting for ${label}: ${JSON.stringify({ found: Boolean(lastValue) })}`);
}

function requireActionsProbe(condition, label, detail = {}) {
  if (condition) return;
  throw new Error(`Actions probe failed at ${label}: ${JSON.stringify(detail)}`);
}

async function openActionsMenu() {
  const opened = await waitForBrowserValue(`(() => {
    const trigger = document.querySelector('[data-testid="chat-actions-trigger"]');
    if (!trigger || trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return null;
    const rect = trigger.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    trigger.focus();
    trigger.click();
    return true;
  })()`, 'an enabled chat-actions-trigger');
  requireActionsProbe(opened === true, 'open-trigger', { opened: Boolean(opened) });

  return waitForBrowserValue(`(() => {
    const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
    const search = document.querySelector('[data-testid="chat-actions-search"]');
    if (!dialog || !search) return null;
    const dialogRect = dialog.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    if (!dialogRect.width || !dialogRect.height || !searchRect.width || !searchRect.height) return null;
    return true;
  })()`, 'the Actions dialog and search input');
}

async function waitForActionsMenuClosed() {
  return waitForBrowserValue(`(() => {
    const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
    if (!dialog) return true;
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return !rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden';
  })()`, 'the Actions dialog to close');
}

async function runActionsSurfaceProbe() {
  const originalViewport = await evaluate(`({
    width: window.innerWidth,
    height: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio || 1,
  })`);
  const summary = {
    enabled: true,
    desktopDialogVisible: false,
    desktopSearchVisible: false,
    desktopViewportBounded: false,
    desktopSuggestedHidden: false,
    desktopCommonVisible: false,
    desktopBrowseVisible: false,
    desktopSectionsVisible: false,
    prefillClosedDialog: false,
    prefillReachedComposer: false,
    prefillChatSendRequestCount: 0,
    escapeClosedDialog: false,
    escapeRestoredTriggerFocus: false,
    mobileNoHorizontalOverflow: false,
    mobileDialogViewportBounded: false,
    mobileContentScrollable: false,
    mobileClosedDialog: false,
    viewportRestored: false,
    passed: false,
  };

  try {
    await cdpCall('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(250);
    await openActionsMenu();

    const desktopState = await evaluate(`(() => {
      const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
      const search = document.querySelector('[data-testid="chat-actions-search"]');
      if (!dialog || !search) return null;
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const rect = dialog.getBoundingClientRect();
      const text = String(dialog.innerText || '');
      return {
        dialogVisible: visible(dialog),
        searchVisible: visible(search)
          && /search actions/i.test(String(search.getAttribute('placeholder') || search.getAttribute('aria-label') || '')),
        viewportBounded: rect.left >= -1
          && rect.top >= -1
          && rect.right <= window.innerWidth + 1
          && rect.bottom <= window.innerHeight + 1,
        suggestedHidden: !/Suggested/i.test(text),
        commonVisible: /Common/i.test(text),
        browseVisible: /Browse/i.test(text),
      };
    })()`);
    summary.desktopDialogVisible = desktopState?.dialogVisible === true;
    summary.desktopSearchVisible = desktopState?.searchVisible === true;
    summary.desktopViewportBounded = desktopState?.viewportBounded === true;
    summary.desktopSuggestedHidden = desktopState?.suggestedHidden === true;
    summary.desktopCommonVisible = desktopState?.commonVisible === true;
    summary.desktopBrowseVisible = desktopState?.browseVisible === true;
    summary.desktopSectionsVisible = summary.desktopSuggestedHidden
      && summary.desktopCommonVisible
      && summary.desktopBrowseVisible;
    requireActionsProbe(summary.desktopDialogVisible, 'desktop-dialog-visible', summary);
    requireActionsProbe(summary.desktopSearchVisible, 'desktop-search-visible', summary);
    requireActionsProbe(summary.desktopViewportBounded, 'desktop-dialog-bounds', summary);
    requireActionsProbe(summary.desktopSectionsVisible, 'desktop-sections', summary);

    const searchUpdated = await evaluate(`(() => {
      const input = document.querySelector('[data-testid="chat-actions-search"]');
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(input, 'Summarize');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    requireActionsProbe(searchUpdated === true, 'search-input', { updated: Boolean(searchUpdated) });

    await waitForBrowserValue(`(() => {
      const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
      if (!dialog || !/Search results/i.test(String(dialog.innerText || ''))) return null;
      return [...dialog.querySelectorAll('[data-testid^="chat-action-"]')].some((candidate) => (
        !String(candidate.getAttribute('data-testid') || '').startsWith('chat-action-section-')
        && /^summarize$/i.test(String(candidate.getAttribute('aria-label') || '').trim())
      ));
    })()`, 'a Summarize search result');

    actionsProbeChatSendRequests.length = 0;
    actionsProbeCapturingNetwork = true;
    try {
      const resultClicked = await evaluate(`(() => {
        const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
        if (!dialog) return false;
        const result = [...dialog.querySelectorAll('[data-testid^="chat-action-"]')].find((candidate) => (
          !String(candidate.getAttribute('data-testid') || '').startsWith('chat-action-section-')
          && /^summarize$/i.test(String(candidate.getAttribute('aria-label') || '').trim())
        ));
        if (!result) return false;
        result.click();
        return true;
      })()`);
      requireActionsProbe(resultClicked === true, 'summarize-result-click', { clicked: Boolean(resultClicked) });
      summary.prefillClosedDialog = await waitForActionsMenuClosed() === true;
      summary.prefillReachedComposer = await waitForBrowserValue(`(() => {
        const candidates = [...document.querySelectorAll('textarea,input,[contenteditable=true]')];
        const composer = candidates.find((candidate) => (
          candidate.getAttribute('type') !== 'search'
          && /message|ask|chat|openswan|type/i.test([
            candidate.getAttribute('placeholder'),
            candidate.getAttribute('aria-label'),
          ].filter(Boolean).join(' '))
        )) || candidates.find((candidate) => candidate.tagName === 'TEXTAREA');
        if (!composer) return null;
        const value = composer.isContentEditable ? composer.textContent : composer.value;
        return String(value || '').trimStart().toLowerCase().startsWith('/summarize') ? true : null;
      })()`, 'the Summarize prefill in the composer') === true;
      // Keep the capture open for one settled browser turn after both UI
      // assertions so a deferred chat request cannot slip past the probe.
      await delay(500);
    } finally {
      actionsProbeCapturingNetwork = false;
    }

    summary.prefillChatSendRequestCount = actionsProbeChatSendRequests.length;
    requireActionsProbe(summary.prefillClosedDialog, 'prefill-dialog-close', summary);
    requireActionsProbe(summary.prefillReachedComposer, 'prefill-composer', summary);
    requireActionsProbe(summary.prefillChatSendRequestCount === 0, 'prefill-network-send', summary);

    await openActionsMenu();
    await waitForBrowserValue(`(() => {
      const search = document.querySelector('[data-testid="chat-actions-search"]');
      return search && document.activeElement === search ? true : null;
    })()`, 'Actions search to receive initial focus');
    // React attaches the modal's document/dialog listeners in a passive
    // effect after focus lands. Yield one browser turn before dispatching.
    await delay(100);
    await cdpCall('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await cdpCall('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    summary.escapeClosedDialog = await waitForActionsMenuClosed() === true;
    summary.escapeRestoredTriggerFocus = await waitForBrowserValue(`(() => {
      const trigger = document.querySelector('[data-testid="chat-actions-trigger"]');
      return trigger && (document.activeElement === trigger || trigger.contains(document.activeElement)) ? true : null;
    })()`, 'focus to return to the Actions trigger') === true;
    requireActionsProbe(summary.escapeClosedDialog, 'escape-dialog-close', summary);
    requireActionsProbe(summary.escapeRestoredTriggerFocus, 'escape-focus-return', summary);

    await cdpCall('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      screenWidth: 390,
      screenHeight: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(300);
    await openActionsMenu();
    const mobileState = await evaluate(`(() => {
      const dialog = document.querySelector('[data-testid="chat-actions-menu"], #chat-actions-dialog');
      if (!dialog) return null;
      const rect = dialog.getBoundingClientRect();
      const scrollable = [dialog, ...dialog.querySelectorAll('*')].some((candidate) => {
        const style = getComputedStyle(candidate);
        return /auto|scroll/i.test(style.overflowY)
          && candidate.clientHeight > 0
          && candidate.scrollHeight > candidate.clientHeight + 1;
      });
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
          && (!document.body || document.body.scrollWidth <= window.innerWidth + 1),
        dialogViewportBounded: rect.width > 0
          && rect.height > 0
          && rect.left >= -1
          && rect.top >= -1
          && rect.right <= window.innerWidth + 1
          && rect.bottom <= window.innerHeight + 1,
        contentScrollable: scrollable,
      };
    })()`);
    summary.mobileNoHorizontalOverflow = mobileState?.noHorizontalOverflow === true;
    summary.mobileDialogViewportBounded = mobileState?.dialogViewportBounded === true;
    summary.mobileContentScrollable = mobileState?.contentScrollable === true;
    requireActionsProbe(summary.mobileNoHorizontalOverflow, 'mobile-horizontal-overflow', summary);
    requireActionsProbe(summary.mobileDialogViewportBounded, 'mobile-dialog-bounds', summary);
    requireActionsProbe(summary.mobileContentScrollable, 'mobile-scrollable-content', summary);

    const mobileCloseClicked = await evaluate(`(() => {
      const close = document.querySelector('[data-testid="chat-actions-close"]');
      if (!close) return false;
      close.click();
      return true;
    })()`);
    requireActionsProbe(mobileCloseClicked === true, 'mobile-close-control', { clicked: Boolean(mobileCloseClicked) });
    summary.mobileClosedDialog = await waitForActionsMenuClosed() === true;
    requireActionsProbe(summary.mobileClosedDialog, 'mobile-dialog-close', summary);
  } finally {
    actionsProbeCapturingNetwork = false;
    try {
      await evaluate(`(() => {
        const close = document.querySelector('[data-testid="chat-actions-close"]');
        close?.click?.();
        return true;
      })()`);
    } catch { /* viewport restoration must still run */ }
    await cdpCall('Emulation.clearDeviceMetricsOverride');
    await delay(300);
  }

  const restoredViewport = await waitForBrowserValue(`(() => (
    window.innerWidth === ${Number(originalViewport?.width) || 0}
    && window.innerHeight === ${Number(originalViewport?.height) || 0}
      ? { restored: true }
      : null
  ))()`, 'the original browser viewport');
  summary.viewportRestored = restoredViewport?.restored === true;
  requireActionsProbe(summary.viewportRestored, 'viewport-restore', {
    restored: summary.viewportRestored,
  });
  summary.passed = true;
  return summary;
}

async function runChatCanary(session) {
  await connectChrome();
  await cdpCall('Storage.clearDataForOrigin', {
    origin: parsedAppUrl.origin,
    storageTypes: 'all',
  });
  await cdpCall('Page.navigate', { url: `${appBaseUrl}/login` });
  await delay(4_000);
  // This Chrome profile is dedicated to the canary but reused across runs.
  // Clear Expo/React Navigation persistence as well as the prior auth row so
  // a stale circle route cannot override the exact temporary circle below.
  await evaluate(`localStorage.clear(); sessionStorage.clear(); true`);
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const storedSession = {
    ...session,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
  };
  await evaluate(
    `localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(storedSession))}); true`,
  );
  await cdpCall('Page.navigate', {
    url: `${appBaseUrl}/circle/${circleId}/chat`,
  });
  await delay(12_000);

  // A brand-new canary user sees onboarding. Dismiss it inside the isolated
  // profile so it cannot cover the composer or consume the first key event.
  const tutorialSkipTarget = await evaluate(`(() => {
    const exactText = [...document.querySelectorAll('*')]
      .find((candidate) => /^skip tutorial$/i.test(String(candidate.textContent || '').trim()));
    if (!exactText) return null;
    const pressable = exactText.closest('button,[role=button],[tabindex="0"]') || exactText;
    const rect = pressable.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (tutorialSkipTarget) {
    await cdpCall('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: tutorialSkipTarget.x, y: tutorialSkipTarget.y, button: 'left', clickCount: 1,
    });
    await cdpCall('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: tutorialSkipTarget.x, y: tutorialSkipTarget.y, button: 'left', clickCount: 1,
    });
    await delay(1_000);
  }

  // Optional semantic Actions probe. It runs before the normal message is
  // placed in the composer, then restores the browser viewport so the existing
  // canary path stays byte-for-byte equivalent when the flag is disabled.
  const actionsProbe = enableActionsProbe
    ? await runActionsSurfaceProbe()
    : null;

  if (actionsProbe) {
    const browserState = JSON.parse(await evaluate(`JSON.stringify({
      href: location.href,
      body: (document.body?.innerText || '').slice(-7000),
      sessionUserId: (() => {
        try {
          const key = Object.keys(localStorage)
            .find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
          return key ? JSON.parse(localStorage.getItem(key) || 'null')?.user?.id || null : null;
        } catch { return null; }
      })(),
    })`));
    const lazyModuleFailures = [...exceptions, ...consoleErrors].filter((message) =>
      /metro-require|ENOENT|authSession\.bundle|memoryIntentCore\.bundle|crossSurfaceReferenceResolverCore\.bundle|circleContextSnapshot\.bundle/i.test(message)
    );
    return {
      route: browserState.href,
      routeMatchesRequestedCircle: browserState.href.includes(`/circle/${circleId}/chat`),
      sessionMatchesTemporaryUser: browserState.sessionUserId === userId,
      expectedOutcome: 'actions-surface',
      webSearchEnabled: enableWebSearch,
      lazyModuleFailures: lazyModuleFailures.length,
      bootstrapProbe,
      actionsProbe,
      bodyTail: browserState.body.slice(-700),
    };
  }

  const composer = await evaluate(`(() => {
    const candidates = [...document.querySelectorAll('textarea,input,[contenteditable=true]')];
    const element = candidates.find((candidate) =>
      /message|ask|chat|openswan|type/i.test([
        candidate.getAttribute('placeholder'),
        candidate.getAttribute('aria-label'),
      ].filter(Boolean).join(' '))
      && candidate.getAttribute('type') !== 'search'
    ) || candidates.find((candidate) => candidate.tagName === 'TEXTAREA');
    if (!element) {
      return {
        ok: false,
        candidates: candidates.map((candidate) => ({
          tag: candidate.tagName,
          placeholder: candidate.getAttribute('placeholder'),
          aria: candidate.getAttribute('aria-label'),
          type: candidate.getAttribute('type'),
        })),
      };
    }
    element.focus();
    if (element.isContentEditable) {
      element.textContent = ${JSON.stringify(chatMessage)};
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: ${JSON.stringify(chatMessage)},
      }));
    } else {
      const prototype = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, ${JSON.stringify(chatMessage)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return {
      ok: true,
      tag: element.tagName,
      placeholder: element.getAttribute('placeholder'),
      aria: element.getAttribute('aria-label'),
    };
  })()`);
  if (!composer?.ok) {
    const diagnostic = JSON.parse(await evaluate(`JSON.stringify({
      href: location.href,
      title: document.title,
      bodyTail: (document.body?.innerText || '').slice(-2400),
    })`));
    throw new Error(`Chat composer not found: ${JSON.stringify({
      composer,
      diagnostic,
      exceptions: exceptions.slice(-8),
      consoleErrors: consoleErrors.slice(-8),
    })}`);
  }

  await waitForBrowserValue(`(() => {
    const composer = document.querySelector('textarea');
    const send = document.querySelector('[data-testid="chat-send-button"]');
    if (!composer || !send) return null;
    const value = String(composer.value || '').trim();
    const enabled = !send.disabled && send.getAttribute('aria-disabled') !== 'true';
    return value === ${JSON.stringify(chatMessage)} && enabled ? true : null;
  })()`, 'the exact chat draft and enabled send control');

  const sentAt = new Date(Date.now() - 1_000).toISOString();
  await delay(400);
  if (chatMessage.startsWith('/')) {
    const slashSuggestionTarget = await evaluate(`(() => {
      const exactText = [...document.querySelectorAll('*')]
        .filter((candidate) => String(candidate.textContent || '').trim() === ${JSON.stringify(chatMessage)})
        .find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      if (!exactText) return null;
      const pressable = exactText.closest('button,[role=button],[tabindex="0"]') || exactText.parentElement || exactText;
      const rect = pressable.getBoundingClientRect();
      return rect.width && rect.height
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null;
    })()`);
    if (slashSuggestionTarget) {
      await cdpCall('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: slashSuggestionTarget.x, y: slashSuggestionTarget.y,
        button: 'left', clickCount: 1,
      });
      await cdpCall('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: slashSuggestionTarget.x, y: slashSuggestionTarget.y,
        button: 'left', clickCount: 1,
      });
      await delay(400);
    }
  }
  // `/help` opens autocomplete. Escape closes only that suggestion surface so
  // the following Enter submits the exact command rather than selecting it.
  await cdpCall('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
  await cdpCall('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
  });
  greetingSubmitted = expectedOutcome === 'greeting-routing';
  let sendControl = null;
  const visualSendTarget = await evaluate(`(() => {
    const send = document.querySelector('[data-testid="chat-send-button"]');
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') return null;
    const rect = send.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`);
  if (visualSendTarget) {
    await cdpCall('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: visualSendTarget.x, y: visualSendTarget.y, button: 'left', clickCount: 1,
    });
    await cdpCall('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: visualSendTarget.x, y: visualSendTarget.y, button: 'left', clickCount: 1,
    });
    sendControl = { ok: true, via: 'visual-send-control' };
  }
  if (!sendControl) sendControl = await evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button,[role=button]')];
    const button = candidates.find((candidate) => /send/i.test([
      candidate.innerText,
      candidate.getAttribute('aria-label'),
      candidate.getAttribute('title'),
    ].filter(Boolean).join(' '))) || (() => {
      const composer = document.querySelector('textarea');
      if (!composer) return null;
      const composerRect = composer.getBoundingClientRect();
      return candidates
        .filter((candidate) => String(candidate.innerText || '').trim() === '↑')
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          const dx = (rect.left + rect.width / 2) - (composerRect.right + 20);
          const dy = (rect.top + rect.height / 2) - (composerRect.top + composerRect.height / 2);
          return { candidate, distance: Math.hypot(dx, dy) };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.candidate || null;
    })();
    if (!button) return { ok: false, via: null };
    button.click();
    return {
      ok: true,
      via: 'button',
      text: button.innerText,
      aria: button.getAttribute('aria-label'),
    };
  })()`);
  if (!sendControl?.ok) {
    await cdpCall('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await cdpCall('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    sendControl = { ok: true, via: 'keyboard-enter' };
    await delay(500);
    const composerStillContainsMessage = await evaluate(`(() => {
      const element = [...document.querySelectorAll('textarea,input,[contenteditable=true]')]
        .find((candidate) => candidate.tagName === 'TEXTAREA');
      if (!element) return false;
      const value = element.isContentEditable ? element.textContent : element.value;
      return String(value || '').trim() === ${JSON.stringify(chatMessage)};
    })()`);
    if (composerStillContainsMessage) {
      await cdpCall('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await cdpCall('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      sendControl = { ok: true, via: 'keyboard-enter-twice-after-autocomplete' };
    }
  }

  await delay(8_000);
  const persistedAssistantReply = expectedOutcome === 'greeting-routing'
    ? await waitForPersistedAssistantReply(session.access_token, sentAt)
    : null;
  const browserState = JSON.parse(await evaluate(`JSON.stringify({
    href: location.href,
    body: (document.body?.innerText || '').slice(-7000),
    sessionUserId: (() => {
      try {
        const key = Object.keys(localStorage)
          .find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
        return key ? JSON.parse(localStorage.getItem(key) || 'null')?.user?.id || null : null;
      } catch { return null; }
    })(),
  })`));
  const lazyModuleFailures = [...exceptions, ...consoleErrors].filter((message) =>
    /metro-require|ENOENT|authSession\.bundle|memoryIntentCore\.bundle|crossSurfaceReferenceResolverCore\.bundle|circleContextSnapshot\.bundle/i.test(message)
  );

  return {
    route: browserState.href,
    routeMatchesRequestedCircle: browserState.href.includes(`/circle/${circleId}/chat`),
    sessionMatchesTemporaryUser: browserState.sessionUserId === userId,
    chatMessage,
    expectedOutcome,
    webSearchEnabled: enableWebSearch,
    composer,
    sendControl,
    helpVisible: /Available commands/i.test(browserState.body)
      || (/Pinned Messages/i.test(browserState.body) && /Search chat history\./i.test(browserState.body)),
    lazyModuleFailures: lazyModuleFailures.length,
    webSearchRequestCount: webSearchRequests.length,
    openSwanTaskRequestCount: openSwanTaskRequests.length,
    greetingToolPayloadCount: greetingToolPayloads.length,
    webSearchFailureVisible: /Web search failed|Web search.+non-2xx status code/i.test(browserState.body),
    connectedRepairVisible: /Let connected agent repair it|CONNECTED AGENT\s*[•·-]\s*RECOMMENDED/i.test(browserState.body),
    failedReceiptVisible: /RECEIPT\s+FAILED\s+Action did not complete/i.test(browserState.body),
    submittedMessageVisible: browserState.body.includes(chatMessage),
    assistantReplyPersisted: Boolean(persistedAssistantReply),
    assistantReplySurface: persistedAssistantReply?.surface || null,
    assistantReplyCharacters: persistedAssistantReply?.visibleCharacters || 0,
    bootstrapProbe,
    ...(actionsProbe ? { actionsProbe } : {}),
    bodyTail: browserState.body.slice(-700),
  };
}

async function cleanup() {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await cdpCall('Storage.clearDataForOrigin', {
        origin: parsedAppUrl.origin,
        storageTypes: 'all',
      });
      await cdpCall('Page.navigate', { url: `${appBaseUrl}/login` });
    } catch { /* cleanup continues through SQL */ }
    try { socket.close(); } catch { /* noop */ }
  }

  if (!userId) return;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || (circleId && !/^[0-9a-f-]{36}$/i.test(circleId))) {
    throw new Error('Refusing cleanup for malformed identifiers.');
  }
  const sql = [
    circleId ? `DELETE FROM public.circles WHERE id = '${circleId}'::uuid;` : '',
    `DELETE FROM public.profiles WHERE id = '${userId}'::uuid;`,
    `DELETE FROM auth.users WHERE id = '${userId}'::uuid;`,
  ].filter(Boolean).join(' ');
  const supabaseCli = fs.existsSync('node_modules/.bin/supabase')
    ? 'node_modules/.bin/supabase'
    : 'supabase';
  execFileSync(supabaseCli, ['db', 'query', '--linked', sql], {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 30_000,
  });
}

let result = null;
try {
  const signup = await supabaseRequest('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { full_name: 'OpenSwan Chat E2E' },
    }),
  });
  if (!signup.access_token || !signup.user?.id) {
    throw new Error('Signup did not return an authenticated session.');
  }
  userId = signup.user.id;
  const authHeaders = {
    Authorization: `Bearer ${signup.access_token}`,
    Prefer: 'return=representation',
  };

  const circles = await supabaseRequest('/rest/v1/circles?select=id,name', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: `OpenSwan Chat E2E ${marker}`,
      description: 'Temporary automated chat validation',
      max_members: 3,
      created_by: userId,
      circle_type: 'custom',
      icon: '▲',
      accent_color: '#6366f1',
      check_in_format: { type: 'text', label: 'Daily Check-in' },
      tags: [],
      settings: enableWebSearch ? { chatWebSearch: { enabled: true } } : {},
    }),
  });
  if (!Array.isArray(circles) || !circles[0]?.id) {
    throw new Error('Circle creation returned no identifier.');
  }
  circleId = circles[0].id;

  // Distinguish a database bootstrap/RLS failure from a browser hydration
  // failure before navigating the UI. Keep the evidence value-free: counts
  // and the selected default model are enough to locate the broken boundary.
  const membershipQuery = new URLSearchParams({
    select: 'role',
    circle_id: `eq.${circleId}`,
    user_id: `eq.${userId}`,
  });
  const threadQuery = new URLSearchParams({
    select: 'visibility,default_model',
    circle_id: `eq.${circleId}`,
    visibility: 'eq.circle',
  });
  const [visibleMemberships, visibleThreads] = await Promise.all([
    supabaseRequest(`/rest/v1/circle_members?${membershipQuery.toString()}`, {
      headers: { Authorization: `Bearer ${signup.access_token}` },
    }),
    supabaseRequest(`/rest/v1/circle_chat_threads?${threadQuery.toString()}`, {
      headers: { Authorization: `Bearer ${signup.access_token}` },
    }),
  ]);
  bootstrapProbe = {
    visibleMembershipCount: Array.isArray(visibleMemberships) ? visibleMemberships.length : 0,
    visibleThreadCount: Array.isArray(visibleThreads) ? visibleThreads.length : 0,
    defaultModel: Array.isArray(visibleThreads) && typeof visibleThreads[0]?.default_model === 'string'
      ? visibleThreads[0].default_model
      : null,
  };

  result = await runChatCanary(signup);
  if (enableActionsProbe) {
    const probe = result.actionsProbe;
    const probePassed = probe?.enabled === true
      && probe.desktopDialogVisible === true
      && probe.desktopSearchVisible === true
      && probe.desktopViewportBounded === true
      && probe.desktopSectionsVisible === true
      && probe.prefillClosedDialog === true
      && probe.prefillReachedComposer === true
      && probe.prefillChatSendRequestCount === 0
      && probe.escapeClosedDialog === true
      && probe.escapeRestoredTriggerFocus === true
      && probe.mobileNoHorizontalOverflow === true
      && probe.mobileDialogViewportBounded === true
      && probe.mobileContentScrollable === true
      && probe.mobileClosedDialog === true
      && probe.viewportRestored === true
      && probe.passed === true;
    if (!probePassed) {
      throw new Error(`The authenticated Actions probe did not pass: ${JSON.stringify(probe || { enabled: false })}`);
    }
  }
  if (!enableActionsProbe && expectedOutcome === 'help' && !result.helpVisible) {
    throw new Error(`The deterministic /help response did not render: ${JSON.stringify(result)}`);
  }
  if (!enableActionsProbe && expectedOutcome === 'greeting-routing') {
    if (!result.submittedMessageVisible) {
      throw new Error(`The submitted greeting did not render: ${JSON.stringify(result)}`);
    }
    if (result.webSearchRequestCount > 0 || result.webSearchFailureVisible) {
      throw new Error(`A social greeting entered the Web Search lane: ${JSON.stringify(result)}`);
    }
    if (result.connectedRepairVisible || result.failedReceiptVisible) {
      throw new Error(`A social greeting rendered runtime-repair failure UI: ${JSON.stringify(result)}`);
    }
    if (!result.assistantReplyPersisted) {
      throw new Error(`A normal assistant reply was not finalized and persisted: ${JSON.stringify(result)}`);
    }
    if (result.openSwanTaskRequestCount > 0) {
      throw new Error(`A social greeting called an OpenSwan task endpoint: ${JSON.stringify(result)}`);
    }
    if (result.greetingToolPayloadCount > 0) {
      throw new Error(`A social greeting advertised tools or plugins to its model: ${JSON.stringify(result)}`);
    }
    if (!['main_chat_stream', 'main_chat_plain_model'].includes(result.assistantReplySurface)) {
      throw new Error(`A social greeting persisted through a non-plain surface: ${JSON.stringify(result)}`);
    }
  }
  if (result.lazyModuleFailures > 0) {
    throw new Error(`Observed ${result.lazyModuleFailures} lazy-module failure(s).`);
  }
} finally {
  await cleanup();
}

console.log(JSON.stringify({
  target: appBaseUrl,
  temporarySignup: true,
  temporaryCircle: true,
  cleanup: 'complete',
  ...result,
}, null, 2));
