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
if (!chatMessage || chatMessage.length > 240) throw new Error('Chat canary message must contain 1-240 characters.');
if (!['help', 'greeting-routing'].includes(expectedOutcome)) throw new Error('Unsupported CHAT_E2E_EXPECT value.');

const marker = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const email = `openswan-chat-e2e-${marker}@example.com`;
const password = `Aa9!${crypto.randomBytes(18).toString('base64url')}`;

let userId = null;
let circleId = null;
let socket = null;
let sequence = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
const webSearchRequests = [];

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
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
        typeof request?.url === 'string'
        && request.url.includes('/functions/v1/llm-proxy')
        && typeof request.postData === 'string'
        && request.postData.includes('openrouter:web_search')
      ) {
        webSearchRequests.push(request.url);
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

async function runChatCanary(session) {
  await connectChrome();
  await cdpCall('Page.navigate', { url: `${appBaseUrl}/login` });
  await delay(4_000);
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

  const sentAt = new Date(Date.now() - 1_000).toISOString();
  await delay(400);
  let sendControl = await evaluate(`(() => {
    const candidates = [...document.querySelectorAll('button,[role=button]')];
    const button = candidates.find((candidate) => /send/i.test([
      candidate.innerText,
      candidate.getAttribute('aria-label'),
      candidate.getAttribute('title'),
    ].filter(Boolean).join(' ')));
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
  }

  await delay(8_000);
  const persistedAssistantReply = expectedOutcome === 'greeting-routing'
    ? await waitForPersistedAssistantReply(session.access_token, sentAt)
    : null;
  const browserState = JSON.parse(await evaluate(`JSON.stringify({
    href: location.href,
    body: (document.body?.innerText || '').slice(-7000),
  })`));
  const lazyModuleFailures = [...exceptions, ...consoleErrors].filter((message) =>
    /metro-require|ENOENT|authSession\.bundle|memoryIntentCore\.bundle|crossSurfaceReferenceResolverCore\.bundle|circleContextSnapshot\.bundle/i.test(message)
  );

  return {
    route: browserState.href,
    chatMessage,
    expectedOutcome,
    webSearchEnabled: enableWebSearch,
    composer,
    sendControl,
    helpVisible: /Available commands/i.test(browserState.body)
      || (/Pinned Messages/i.test(browserState.body) && /Search chat history\./i.test(browserState.body)),
    lazyModuleFailures: lazyModuleFailures.length,
    webSearchRequestCount: webSearchRequests.length,
    webSearchFailureVisible: /Web search failed|Web search.+non-2xx status code/i.test(browserState.body),
    connectedRepairVisible: /Let connected agent repair it|CONNECTED AGENT\s*[•·-]\s*RECOMMENDED/i.test(browserState.body),
    failedReceiptVisible: /RECEIPT\s+FAILED\s+Action did not complete/i.test(browserState.body),
    submittedMessageVisible: browserState.body.includes(chatMessage),
    assistantReplyPersisted: Boolean(persistedAssistantReply),
    assistantReplySurface: persistedAssistantReply?.surface || null,
    assistantReplyCharacters: persistedAssistantReply?.visibleCharacters || 0,
    bodyTail: browserState.body.slice(-700),
  };
}

async function cleanup() {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      await evaluate(`Object.keys(localStorage)
        .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
        .forEach((key) => localStorage.removeItem(key)); true`);
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
  execFileSync('npx', ['supabase', 'db', 'query', '--linked', sql], {
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

  result = await runChatCanary(signup);
  if (expectedOutcome === 'help' && !result.helpVisible) {
    throw new Error(`The deterministic /help response did not render: ${JSON.stringify(result)}`);
  }
  if (expectedOutcome === 'greeting-routing') {
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
