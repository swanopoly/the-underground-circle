/** Regression guard for the production browser network boundary. */

import fs from 'node:fs';
import path from 'node:path';

const config = fs.readFileSync(path.resolve('netlify.toml'), 'utf8');
const rootEntry = fs.readFileSync(path.resolve('index.ts'), 'utf8');
const mainNavigator = fs.readFileSync(path.resolve('src/navigation/MainNavigator.tsx'), 'utf8');
const authNavigator = fs.readFileSync(path.resolve('src/navigation/AuthNavigator.tsx'), 'utf8');
const cspMatch = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
if (!cspMatch) throw new Error('FAIL: Netlify CSP header is missing');
const csp = cspMatch[1];

let assertions = 0;
function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

assert(csp.includes("default-src 'self'"), 'default source is same-origin');
assert(csp.includes("script-src 'self'"), 'scripts are same-origin only');
assert(!csp.includes("script-src 'self' 'unsafe-inline'"), 'inline scripts are not allowed');
assert(!csp.includes("script-src 'self' 'unsafe-eval'"), 'eval is not allowed');
assert(csp.includes("object-src 'none'"), 'plugins are disabled');
assert(csp.includes("frame-ancestors 'none'"), 'embedding is disabled');
assert(csp.includes("base-uri 'self'"), 'base URI injection is blocked');
assert(csp.includes('https://rjkniqiqdtroeholxacg.supabase.co'), 'only the configured Supabase HTTP origin is present');
assert(csp.includes('wss://rjkniqiqdtroeholxacg.supabase.co'), 'only the configured Supabase realtime origin is present');
assert(!csp.includes('https://*.supabase.co'), 'arbitrary Supabase projects cannot receive browser requests');
assert(!csp.includes('wss://*.supabase.co'), 'arbitrary Supabase projects cannot receive realtime requests');
assert(!csp.includes('https://api.openai.com'), 'browser cannot call OpenAI directly');
assert(!csp.includes('https://api.anthropic.com'), 'browser cannot call Anthropic directly');
assert(!csp.includes('https://generativelanguage.googleapis.com'), 'browser cannot call Google AI directly');
assert(csp.includes('http://localhost:*'), 'authenticated local bridges remain reachable');
assert(csp.includes('ws://127.0.0.1:*'), 'local websocket bridges remain reachable');
assert(csp.includes("form-action 'self' https://rjkniqiqdtroeholxacg.supabase.co"), 'form posts are limited to the app and configured Auth origin');
assert(csp.includes('upgrade-insecure-requests'), 'production subresources upgrade to HTTPS');
assert(config.includes('Cross-Origin-Opener-Policy = "same-origin-allow-popups"'), 'OAuth popup isolation policy remains compatible');
assert(config.includes('Permissions-Policy = "camera=(), geolocation=(), microphone=(), payment=(), usb=()"'), 'unused sensitive browser capabilities are disabled');

const jsCacheHeader = config.match(/\[\[headers\]\]\s*\n\s*for\s*=\s*"\*\.js"[\s\S]*?Cache-Control\s*=\s*"([^"]+)"/);
assert(Boolean(jsCacheHeader), 'JavaScript cache policy is explicit');
assert(jsCacheHeader?.[1].includes('max-age=0') === true, 'JavaScript is revalidated after every deployment');
assert(jsCacheHeader?.[1].includes('must-revalidate') === true, 'stale JavaScript cannot be reused without validation');
assert(jsCacheHeader?.[1].includes('immutable') === false, 'JavaScript is not marked immutable across Metro module-graph changes');
assert(config.includes('for = "/assets/*"') && config.includes('max-age=31536000, immutable'), 'content-addressed assets retain long-lived caching');

const revisionPattern = /WEB_MODULE_GRAPH_REVISION\s*=\s*'([^']+)'/;
const graphRevisions = [rootEntry, mainNavigator, authNavigator]
  .map((source) => source.match(revisionPattern)?.[1]);
assert(graphRevisions.every(Boolean), 'root and navigator chunks carry an explicit cache-recovery revision');
assert(new Set(graphRevisions).size === 1, 'root and navigator cache-recovery revisions stay synchronized');

console.log(`netlify-csp-security-smoketest: ${assertions} assertions passed`);
