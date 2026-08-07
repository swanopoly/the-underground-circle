/**
 * Source-level security contract for the email/calendar OAuth popup boundary.
 *
 * This test does not contact an identity provider. It pins the browser/edge
 * handshake, one-time state handling, output encoding, and callback headers.
 *
 * Run:
 *   npx tsx scripts/oauth-popup-boundary-smoketest.ts
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const client = fs.readFileSync(path.join(root, "src", "lib", "oauthConnect.ts"), "utf8");
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "email-calendar-oauth", "index.ts"),
  "utf8",
);
const relay = fs.readFileSync(path.join(root, "src", "lib", "oauthCallbackRelay.ts"), "utf8");
const entry = fs.readFileSync(path.join(root, "index.ts"), "utf8");

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`OAuth popup boundary smoke failed: ${message}`);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function ordered(source: string, needles: string[], message: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    check(next > cursor, `${message}: ${needle}`);
    cursor = next;
  }
}

// ── Browser accepts only the expected callback ─────────────────────────────

const clientCallback = section(
  client,
  "function readExpectedCallbackMessage(",
  "export function openOAuthPopup(",
);
check(
  client.includes("window.crypto.getRandomValues(bytes)"),
  "client nonce comes from Web Crypto",
);
check(
  client.includes("const bytes = new Uint8Array(24)"),
  "client nonce has 192 bits of entropy",
);
check(!client.includes("Math.random()"), "OAuth state never uses Math.random");
check(
  client.includes("const origin = window.location.origin"),
  "callback origin is normalized to the exact app origin",
);
check(
  clientCallback.includes("event.origin !== callbackOrigin"),
  "callback rejects a different origin",
);
check(
  clientCallback.includes("event.source !== popup"),
  "callback rejects a different window",
);
ordered(clientCallback, [
  "data.type !== 'oauth-callback'",
  "data.provider !== provider",
  "data.nonce !== clientNonce",
  "typeof data.success !== 'boolean'",
], "callback validates its typed attempt envelope");
check(
  client.includes("client_nonce: clientNonce"),
  "authorize request binds the browser attempt nonce",
);
check(
  client.includes("url.origin === PROVIDER_AUTHORIZE_ORIGINS[provider]"),
  "server-provided authorization URL must match the exact provider origin",
);
check(
  !client.includes("error: e?.message"),
  "browser does not expose raw transport exceptions",
);

// ── Server state is opaque, short-lived, and single-use ────────────────────

check(
  edge.includes("const OAUTH_NONCE_PATTERN = /^[a-f0-9]{48}$/"),
  "server requires fixed-length random nonces",
);
check(
  edge.includes('authUrl.searchParams.set("state", `${nonce}.${clientNonce}`)'),
  "provider state binds server and browser nonces without credentials",
);
const callback = section(
  edge,
  "// ── GET /callback — OAuth redirect handler",
  "// ── POST handlers — require auth",
);
ordered(callback, [
  "const parsedState = parseCombinedOAuthState(stateRaw)",
  '.eq("state", parsedState.serverNonce)',
  '.from("email_calendar_oauth_states")',
  ".delete()",
  '.eq("id", stateRow.id)',
  '.select("id")',
  "fetch(config.tokenUrl",
  'serviceClient.rpc("store_user_api_key_service"',
], "callback claims one-time state before exchanging and storing tokens");
check(
  callback.includes("if (claimError || !claimedState)"),
  "failed or replayed state claims fail closed",
);
check(
  callback.includes("if (storeError)"),
  "credential persistence failures cannot report success",
);
check(
  edge.includes("if (disconnectError)"),
  "disconnect persistence failures cannot report success",
);

// ── Callback uses a trusted-app redirect because edge HTML is sandboxed ───

const resultPage = section(edge, "function oauthResultResponse(", "\n}");
check(resultPage.includes('new URL("/oauth/email-calendar/callback", APP_ORIGIN)'),
  "callback redirects to the exact configured app origin");
check(resultPage.includes("relayUrl.hash = new URLSearchParams"),
  "non-secret callback values stay in the URL fragment");
check(resultPage.includes("status: 303"), "callback uses a non-cacheable redirect");
check(resultPage.includes('"Location": relayUrl.toString()'), "redirect location is explicit");
check(resultPage.includes('"Cache-Control": "no-store"'), "callback redirect is not cached");
check(!edge.includes("return new Response(html"), "edge no longer relies on blocked inline HTML");
check(!edge.includes("window.opener"), "edge response contains no executable opener script");

check(relay.includes("window.location.pathname !== OAUTH_CALLBACK_PATH"),
  "relay runs only on the dedicated callback path");
check(relay.includes("OAUTH_NONCE_PATTERN.test(nonce)"), "relay validates the attempt nonce");
check(relay.includes("OAUTH_PROVIDERS.has(provider)"), "relay validates the provider");
check(relay.includes("window.history.replaceState(null, '', OAUTH_CALLBACK_PATH)"),
  "relay clears callback details from the address bar");
check(relay.includes("window.opener.postMessage({"), "relay messages only its opener");
check(relay.includes("}, window.location.origin)"), "relay targets its exact app origin");
check(!relay.includes("postMessage('*'") && !relay.includes(", '*')"),
  "relay never uses a wildcard postMessage target");
check(entry.includes("if (!relayOAuthCallbackFromAppOrigin())"),
  "callback popup is handled before mounting the full app");

console.log(`OAuth popup boundary smoke passed (${assertions} assertions).`);
