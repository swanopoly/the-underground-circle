/**
 * Source-level security contract for the public llm-proxy edge boundary.
 *
 * This deliberately does not invoke a live function or provider. It pins the
 * authorization and outbound-network ordering in the deployable source.
 *
 * Run:
 *   npx tsx scripts/llm-proxy-security-smoketest.ts
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(
  root,
  "supabase",
  "functions",
  "llm-proxy",
  "index.ts",
);
const source = fs.readFileSync(sourcePath, "utf8");
const sharedEdgeSource = fs.readFileSync(
  path.join(root, "supabase", "functions", "_shared", "edge.ts"),
  "utf8",
);

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) {
    throw new Error(`llm-proxy security smoke failed: ${message}`);
  }
}

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function ordered(haystack: string, needles: string[], message: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1);
    check(next > cursor, `${message}: ${needle}`);
    cursor = next;
  }
}

function parseStringMap(block: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (
    const match of block.matchAll(
      /^\s*(?:"([^"]+)"|([A-Za-z0-9_-]+)):\s*"([^"]+)",?$/gm,
    )
  ) {
    entries.set(match[1] || match[2], match[3]);
  }
  return entries;
}

// ── Authentication and exact circle authorization ─────────────────────────

check(
  source.includes("getAuthenticatedUser,"),
  "uses the shared authenticated-user verifier",
);
check(
  source.includes("createServiceRoleClient,"),
  "uses the shared service-role constructor",
);
check(
  !source.includes(
    'Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
  ),
  "never substitutes the service-role key for the anonymous auth verifier",
);
check(!source.includes("body.userId"), "never trusts the request-body userId");
check(
  source.includes("StoredApiKeyLookupError,"),
  "imports the typed unreadable-credential boundary",
);
check(
  /if \(error instanceof StoredApiKeyLookupError\) \{\s*return errResponse\(\s*409,\s*"credential_unreadable",\s*"A saved provider credential could not be read\./s.test(source),
  "unreadable ciphertext is distinct from a missing provider key",
);
check(
  sharedEdgeSource.includes("if (error) throw new StoredApiKeyLookupError();"),
  "stored-key RPC failures never collapse to an absent key",
);
ordered(sharedEdgeSource, [
  "if (platformKey && canUsePlatformModelKey(opts.userId))",
  "if (storedLookupError && opts.failOnStoredLookupError === true) throw storedLookupError",
], "owner/test platform fallback remains available before surfacing stored-key corruption");
check(
  (source.match(/failOnStoredLookupError: true/g) || []).length === 2,
  "both llm-proxy credential lookups opt into fail-visible ciphertext errors",
);

const membership = section(
  "async function verifyExactCircleMembership(",
  "// ─── Call OpenAI-compatible API",
);
check(
  membership.includes('.from("circle_members")'),
  "membership reads circle_members",
);
ordered(membership, [
  '.eq("circle_id", circleId)',
  '.eq("user_id", userId)',
  ".limit(1)",
  ".maybeSingle()",
], "membership query binds the exact circle and authenticated user");
check(
  membership.includes('if (error) return "unavailable"'),
  "membership lookup errors fail closed",
);
check(
  membership.includes('data?.circle_id === circleId ? "member" : "not_member"'),
  "membership requires the requested circle row",
);

const handler = source.slice(source.indexOf("Deno.serve(async"));
ordered(handler, [
  "const user = await getAuthenticatedUser(req)",
  "body = await req.json()",
  "const supabase = createServiceRoleClient()",
  "const membership = await verifyExactCircleMembership(",
  'if (membership === "unavailable")',
  'if (membership !== "member")',
  'if (provider === "ollama" || provider === "openai_compatible")',
  "const embedKey = await resolveUserModelApiKey({",
], "auth and membership precede every credential/provider fast path");
check(
  handler.indexOf("const user = await getAuthenticatedUser(req)") <
    handler.indexOf("body = await req.json()"),
  "authentication precedes request-body parsing",
);
check(
  handler.includes('return jsonResponse({ status: "ok", service: "llm-proxy" })'),
  "GET exposes minimal health metadata only",
);
check(!handler.includes("providers: Object.keys(PROVIDER_ENDPOINTS)"),
  "GET does not enumerate configured providers");
check(handler.includes('if (req.method !== "POST")'), "non-health methods are rejected before parsing");
check(
  /return errResponse\(\s*403,\s*"forbidden",\s*"You are not a member of this circle\."\s*,?\s*\)/s
    .test(handler),
  "a nonmember receives a fail-closed 403",
);
check(
  /return errResponse\(\s*503,\s*"internal",\s*"Circle access could not be verified\."\s*,?\s*\)/s
    .test(handler),
  "an indeterminate membership lookup cannot fall through",
);

// ── Hosted SSRF boundary ───────────────────────────────────────────────────

const compatibleList = section(
  "const OPENAI_COMPATIBLE: Provider[] = [",
  "function getTrustedProviderEndpoint(provider: Provider): string {",
);
check(
  !compatibleList.includes('"ollama"'),
  "hosted compatible list excludes Ollama",
);
check(
  !compatibleList.includes('"openai_compatible"'),
  "hosted compatible list excludes arbitrary endpoints",
);
check(!source.includes("body.endpoint"), "request endpoint is never consumed");
check(
  !source.includes("keyData.endpoint"),
  "stored custom endpoint is never consumed",
);
check(
  !source.includes("localhost:11434"),
  "hosted proxy has no localhost fallback",
);
check(
  !source.includes("normalizeOpenAICompatibleEndpoint"),
  "no custom endpoint normalizer survives",
);
check(
  !source.includes("endpointIsBlocked"),
  "no bypass-prone blocklist protects a caller URL",
);

const customRejectionIndex = handler.indexOf(
  'if (provider === "ollama" || provider === "openai_compatible")',
);
const firstCredentialLookupIndex = handler.indexOf(
  "await resolveUserModelApiKey({",
);
check(
  customRejectionIndex >= 0 &&
    customRejectionIndex < firstCredentialLookupIndex,
  "custom/local providers are rejected before credential lookup",
);
check(
  handler.includes(
    "Local and custom model endpoints are not available through the hosted proxy.",
  ),
  "custom endpoint rejection gives a safe local-bridge recovery path",
);

const endpointBlock = section(
  "const PROVIDER_ENDPOINTS: Record<string, string> = {",
  "const PROVIDER_HOSTNAMES: Record<string, string> = {",
);
const hostnameBlock = section(
  "const PROVIDER_HOSTNAMES: Record<string, string> = {",
  "// Hosted OpenAI-compatible providers",
);
const endpoints = parseStringMap(endpointBlock);
const hostnames = parseStringMap(hostnameBlock);
check(
  endpoints.size > 0 && endpoints.size === hostnames.size,
  "every fixed endpoint has one exact hostname contract",
);
for (const [provider, endpoint] of endpoints) {
  const parsed = new URL(endpoint);
  check(parsed.protocol === "https:", `${provider}: fixed endpoint uses HTTPS`);
  check(
    parsed.username === "" && parsed.password === "",
    `${provider}: fixed endpoint has no URL credentials`,
  );
  check(parsed.hash === "", `${provider}: fixed endpoint has no fragment`);
  check(
    parsed.port === "" || parsed.port === "443",
    `${provider}: fixed endpoint has no custom port`,
  );
  check(
    parsed.hostname === hostnames.get(provider),
    `${provider}: fixed endpoint host matches exact allowlist`,
  );
}

const trustedEndpoint = section(
  "function getTrustedProviderEndpoint(provider: Provider): string {",
  "function normalizeProviderModel(",
);
for (
  const guard of [
    'parsed.protocol !== "https:"',
    'parsed.username !== ""',
    'parsed.password !== ""',
    'parsed.hash !== ""',
    'parsed.port !== "" && parsed.port !== "443"',
    "parsed.hostname.toLowerCase() !== expectedHostname",
  ]
) {
  check(
    trustedEndpoint.includes(guard),
    `fixed endpoint validator pins ${guard}`,
  );
}

// These common SSRF spellings cannot enter the network path because no
// request URL is consumed and every reachable endpoint must equal a checked-in
// provider/hostname pair. Keep the vectors visible so future reintroduction of
// custom dispatch forces an explicit redesign of this smoke.
for (
  const vector of [
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://100.64.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[fe80::1]",
    "http://[fc00::1]",
    "http://[::ffff:127.0.0.1]",
    "https://user:pass@example.com",
    "file:///etc/passwd",
    "gopher://127.0.0.1",
    "https://example.com/#@169.254.169.254",
  ]
) {
  check(
    ![...endpoints.values()].includes(vector),
    `SSRF vector is unreachable: ${vector}`,
  );
}

const openAiCall = section(
  "async function callOpenAICompatible(",
  "// ─── Call Anthropic API",
);
check(
  !/^\s*endpoint:\s*string,/m.test(openAiCall),
  "provider call cannot accept a caller endpoint argument",
);
check(
  openAiCall.includes("const endpoint = getTrustedProviderEndpoint(provider)"),
  "provider call resolves its endpoint from checked-in contracts only",
);
check(
  (source.match(/await fetch\(/g) || []).length === 1,
  "all network dispatch is centralized in the redirect-blocking wrapper",
);

const fetchBoundary = section(
  "async function fetchUpstream(",
  "async function parseUpstreamJson(",
);
check(
  fetchBoundary.includes('redirect: "manual"'),
  "fetch never follows redirects",
);
check(
  fetchBoundary.includes("response.status >= 300 && response.status < 400"),
  "every redirect status is rejected",
);
check(
  fetchBoundary.includes('response.type === "opaqueredirect"'),
  "opaque redirects are rejected",
);

// ── Upstream response and error sanitization ───────────────────────────────

const parseBoundary = section(
  "async function parseUpstreamJson(",
  "// ─── Types",
);
check(
  parseBoundary.includes("await response.body?.cancel()"),
  "upstream error body is discarded unread",
);
check(!source.includes("await res.text()"), "raw upstream text is never read");
check(
  !source.includes("err?.message"),
  "raw exception messages are never sent to clients",
);
check(
  !source.includes("error.message"),
  "raw exception messages are never logged or returned",
);
check(
  source.includes(
    "`The selected model provider could not complete the request${statusDetail}.`",
  ),
  "upstream failures use fixed client-safe copy",
);
check(
  source.includes('"The model request could not be completed."'),
  "internal failures use fixed client-safe copy",
);
check(
  source.includes('console.error("llm-proxy upstream failure", {'),
  "logs contain structured metadata instead of upstream bodies",
);

console.log(`llm-proxy security smoke passed (${assertions} assertions)`);
