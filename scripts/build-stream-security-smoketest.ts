import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/build-stream/index.ts", "utf8");
let assertions = 0;

function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`build-stream security smoke failed: ${message}`);
}

function position(marker: string): number {
  const value = source.indexOf(marker);
  check(value >= 0, `source marker exists: ${marker}`);
  return value;
}

const serve = position("Deno.serve(async (req) => {");
const handler = source.slice(serve);
const methodGate = handler.indexOf('if (req.method !== "POST")');
const authentication = handler.indexOf("const user = await getAuthenticatedUser(req)");
const bodyParse = handler.indexOf("body = await req.json()");
const serviceClient = handler.indexOf("const supabase = createClient(");
const providerCall = handler.indexOf('fetch("https://api.anthropic.com/v1/messages"');

check(methodGate >= 0, "non-POST requests are rejected");
check(authentication > methodGate, "authentication follows the method gate");
check(bodyParse > authentication, "authentication precedes attacker JSON parsing");
check(serviceClient > authentication, "authentication precedes service-role client creation");
check(providerCall > authentication, "authentication precedes provider spend");
check(source.includes("MAX_BRIEF_CHARS = 30_000"), "brief size is bounded");
check(source.includes("MAX_SYSTEM_EXTRA_CHARS = 10_000"), "extra-system input is bounded");
check(source.includes('redirect: "manual"'), "provider redirects are blocked");
check(source.includes("AbortSignal.timeout(60_000)"), "provider request is bounded by time");
check(!source.includes("errText.slice"), "raw upstream response bodies are never reflected");
check(!source.includes("data?.error?.message"), "raw stream errors are never reflected");
check(source.includes('"The model provider ended the stream unexpectedly."'), "stream failures are sanitized");
check(source.includes('"The page stream ended unexpectedly."'), "internal stream errors are sanitized");

console.log(`build-stream security smoke passed (${assertions} assertions)`);
