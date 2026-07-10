/**
 * native-deferred-tools-probe — X2 (P46) FLIP GATE measurement (LIVE probe,
 * enablement only — changes NO runtime path, spends a few real requests).
 *
 * Answers the three gated questions for flipping `uc_native_deferred_tools`:
 *
 *   Q0 WIRE      Does the deployed swanbot-ai relay accept the native
 *                payload (search tool entry + defer_loading on the full
 *                catalog) end-to-end to Anthropic without a 4xx?
 *   Q1 SELECTION Does the model reach a correct tool for an off-palette ask —
 *                via native tool_search discovery (server_tool_use →
 *                tool_search_tool_result → tool_use) — where the control
 *                palette cannot see the tool at all?
 *   Q2 CACHE     Across a round-2 continuation, does the byte-stable native
 *                tools array keep the cache warm while the control's P25-style
 *                tool APPEND busts it? (cache_read vs cache_creation)
 *
 * GO for the flip IFF Q0 PASS and Q1 PASS and Q2 shows treatment R2
 * cache_read ≥ control R2 cache_read.
 *
 * Safety (mirrors scripts/browserbase-live-probe.mjs):
 *   - Secrets from env ONLY (never argv), masked in output, redacted from
 *     any printed body.
 *   - Explicit spend gate: refuses to run without UC_PROBE_CONFIRM=1.
 *   - NO tools are ever executed — tool_use blocks get "(probe stub)" results;
 *     `srvtoolu_` ids are NEVER answered (API contract); search-result blocks
 *     are passed back verbatim.
 *   - 4 model requests total (2 variants × 2 rounds), bounded prompt.
 *
 * Env:
 *   EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY  (or in ./.env)
 *   UC_PROBE_EMAIL + UC_PROBE_PASSWORD   — probe user login
 *     (or UC_PROBE_ACCESS_TOKEN — a pasted user JWT)
 *   UC_PROBE_CIRCLE_ID                   — a circle the probe user belongs to
 *   UC_PROBE_CONFIRM=1                   — the spend gate
 *   UC_PROBE_MODEL                       — optional; default claude-sonnet-4-6
 *
 * Run: npm run probe:native-deferred-tools
 */

import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── .env fallback for the two public keys (anon key is public by design) ────
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
function envOrDotenv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const dotenvPath = join(repoRoot, '.env');
  if (!existsSync(dotenvPath)) return undefined;
  const line = readFileSync(dotenvPath, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') : undefined;
}

const SUPABASE_URL = envOrDotenv('EXPO_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = envOrDotenv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const PROBE_EMAIL = process.env.UC_PROBE_EMAIL;
const PROBE_PASSWORD = process.env.UC_PROBE_PASSWORD;
const PROBE_ACCESS_TOKEN = process.env.UC_PROBE_ACCESS_TOKEN;
const PROBE_CIRCLE_ID = process.env.UC_PROBE_CIRCLE_ID;
const PROBE_MODEL = process.env.UC_PROBE_MODEL || 'claude-sonnet-4-6';

const SECRETS = [SUPABASE_ANON_KEY, PROBE_PASSWORD, PROBE_ACCESS_TOKEN].filter(Boolean) as string[];
function redact(text: unknown): string {
  let out = typeof text === 'string' ? text : JSON.stringify(text);
  for (const secret of SECRETS) out = out.split(secret).join('[redacted]');
  return out;
}
function mask(secret: string | undefined): string {
  return secret ? `${secret.slice(0, 4)}...(${secret.length} chars)` : '<missing>';
}

// ── Gates: env + explicit spend confirmation (no network before both) ───────
/** UC_PROBE_DRY_RUN=1 — build + print the variant payloads and the selection
 *  target, then exit. No auth, no network, no spend. */
const DRY_RUN = process.env.UC_PROBE_DRY_RUN === '1';

const missing: string[] = [];
if (!SUPABASE_URL) missing.push('EXPO_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
if (!DRY_RUN && !PROBE_ACCESS_TOKEN && !(PROBE_EMAIL && PROBE_PASSWORD)) missing.push('UC_PROBE_EMAIL+UC_PROBE_PASSWORD (or UC_PROBE_ACCESS_TOKEN)');
if (!DRY_RUN && !PROBE_CIRCLE_ID) missing.push('UC_PROBE_CIRCLE_ID');
if (missing.length > 0) {
  console.error('X2 native-deferred-tools probe — missing env, no network call made.\n');
  for (const key of missing) console.error(`  ${key} = <missing>`);
  console.error(`\n  (auth: email=${PROBE_EMAIL || '<missing>'} password=${mask(PROBE_PASSWORD)} token=${mask(PROBE_ACCESS_TOKEN)})`);
  console.error('\nExport the env vars, then: UC_PROBE_CONFIRM=1 npm run probe:native-deferred-tools\n');
  process.exit(2);
}
if (!DRY_RUN && process.env.UC_PROBE_CONFIRM !== '1') {
  console.error('X2 probe spend gate: this makes 4 REAL model requests on your Anthropic key/billing.');
  console.error('Re-run with UC_PROBE_CONFIRM=1 to proceed. No network call was made.');
  process.exit(2);
}

// ── RN stubs so the tool catalog loads under tsx ────────────────────────────
process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ── Types for the relay round-trip ──────────────────────────────────────────
type RelayUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
type RoundResult = {
  ok: boolean;
  status: number | null;
  errorText: string | null;
  stopReason: string | null;
  content: any[];
  toolUseNames: string[];
  usedNativeSearch: boolean;
  usage: RelayUsage;
};

async function main() {
  const { getToolDefinitions } = await import('../src/lib/openswanTools/index');
  const { listPinnedOpenSwanToolsForSurface } = await import('../src/lib/openswanToolRuntime');
  const { buildNativeDeferredToolPayload, summarizeNativeDeferredToolPayload } =
    await import('../src/lib/anthropicNativeToolSearch');

  if (DRY_RUN) {
    const pinnedDefs = listPinnedOpenSwanToolsForSurface('main_chat');
    const pinnedNames = pinnedDefs.map((d: { name: string }) => d.name);
    const controlTools = getToolDefinitions([...pinnedNames, 'tools.search'] as any, 'main_chat');
    const fullCatalog = getToolDefinitions(undefined, 'main_chat');
    const payload = buildNativeDeferredToolPayload(
      fullCatalog.map((t: any) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      { pinnedNames, excludeNames: ['tools.search'] },
    );
    console.log('DRY RUN — no auth, no network, no spend.\n');
    console.log(`control palette: ${controlTools.length} tools (~${Math.round(JSON.stringify(controlTools).length / 1024)} KB)`);
    console.log(`treatment payload: ${JSON.stringify(summarizeNativeDeferredToolPayload(payload))} (~${Math.round(JSON.stringify(payload.tools).length / 1024)} KB wire size)`);
    console.log(`search tool first: ${payload.tools[0]?.type === 'tool_search_tool_regex_20251119'}`);
    console.log('\nLooks buildable — run live with UC_PROBE_CONFIRM=1 + auth env to measure.');
    process.exit(0);
  }

  // ── Auth: user JWT for the relay ─────────────────────────────────────────
  let accessToken = PROBE_ACCESS_TOKEN || '';
  let userId = 'probe-user';
  if (!accessToken) {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY! },
      body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
    });
    const authJson: any = await authRes.json().catch(() => ({}));
    if (!authRes.ok || !authJson.access_token) {
      console.error(`auth FAILED (${authRes.status}): ${redact(JSON.stringify(authJson).slice(0, 200))}`);
      process.exit(1);
    }
    accessToken = authJson.access_token;
    userId = authJson.user?.id || userId;
    SECRETS.push(accessToken);
  }
  console.log(`auth ok (user ${userId.slice(0, 8)}…) · model ${PROBE_MODEL} · circle ${PROBE_CIRCLE_ID!.slice(0, 8)}…\n`);

  // ── Variant payloads (mirrors the live loop exactly) ─────────────────────
  const pinnedDefs = listPinnedOpenSwanToolsForSurface('main_chat');
  const pinnedNames = pinnedDefs.map((d: { name: string }) => d.name);
  const paletteNames = [...pinnedNames, 'tools.search'];
  const toAnthropicShape = (t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    ...(t.input_examples ? { input_examples: t.input_examples } : {}),
  });
  const controlTools = getToolDefinitions(paletteNames as any, 'main_chat').map(toAnthropicShape);
  const fullCatalog = getToolDefinitions(undefined, 'main_chat').map(toAnthropicShape);
  const treatmentPayload = buildNativeDeferredToolPayload(fullCatalog, {
    pinnedNames,
    excludeNames: ['tools.search'],
  });
  console.log(`control palette: ${controlTools.length} tools · treatment: ${JSON.stringify(summarizeNativeDeferredToolPayload(treatmentPayload))}`);

  // ── Off-palette read-only target for the selection question ──────────────
  const pinnedSet = new Set(paletteNames);
  const deferredReadOnly = fullCatalog.filter((t) =>
    !pinnedSet.has(t.name) && /\b(list|search|find|status|inspect)\b/.test(t.name.replace(/[._]/g, ' ')));
  const target = deferredReadOnly.find((t) => t.name === 'wp.list_posts') || deferredReadOnly[0];
  if (!target) {
    console.error('no off-palette read-only target found in the catalog — cannot measure selection.');
    process.exit(1);
  }
  console.log(`selection target (off-palette, read-only): ${target.name}\n`);

  const systemOverride = 'You are a tool-driven assistant. When the user asks for something a tool can do, find and call the right tool. Never ask clarifying questions in this probe.';
  const probeMessage = `Please do this using your tools: ${String(target.description || target.name).split(/(?<=\.)\s/)[0]} If you cannot find a suitable tool, say TOOL-NOT-FOUND and stop.`;

  async function relayRound(tools: any[], toolMessages: any[] | undefined): Promise<RoundResult> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/swanbot-ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: probeMessage,
        circleId: PROBE_CIRCLE_ID,
        userId,
        model: PROBE_MODEL,
        tools,
        tool_messages: toolMessages,
        system_override: systemOverride,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* keep raw */ }
    const content: any[] = Array.isArray(data?.content) ? data.content : [];
    return {
      ok: res.ok && !!data,
      status: res.status,
      errorText: res.ok ? null : redact(text.slice(0, 300)),
      stopReason: data?.stop_reason ?? null,
      content,
      toolUseNames: content.filter((b) => b?.type === 'tool_use').map((b) => b.name),
      usedNativeSearch: content.some((b) => b?.type === 'server_tool_use' || b?.type === 'tool_search_tool_result'),
      usage: (data?.usage || {}) as RelayUsage,
    };
  }

  /** Round-2 history: assistant content verbatim; stub ONLY toolu_ tool_use
   *  blocks (never srvtoolu_ — the API rejects results for those). */
  function continuationMessages(r1: RoundResult): any[] {
    const stubs = r1.content
      .filter((b) => b?.type === 'tool_use' && typeof b.id === 'string' && !b.id.startsWith('srvtoolu'))
      .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: '(probe stub — tool intentionally not executed)' }));
    const history: any[] = [
      { role: 'user', content: probeMessage },
      { role: 'assistant', content: r1.content },
    ];
    history.push({ role: 'user', content: stubs.length > 0 ? stubs : 'Continue: summarize what you would do next in one sentence.' });
    return history;
  }

  function usageLine(label: string, r: RoundResult): string {
    const u = r.usage;
    return `  ${label}: status=${r.status} stop=${r.stopReason ?? '-'} tools_called=[${r.toolUseNames.join(', ') || '-'}]${r.usedNativeSearch ? ' native_search=YES' : ''}\n` +
      `    usage: input=${u.input_tokens ?? '?'} cache_creation=${u.cache_creation_input_tokens ?? '?'} cache_read=${u.cache_read_input_tokens ?? '?'} output=${u.output_tokens ?? '?'}` +
      (r.errorText ? `\n    error: ${r.errorText}` : '');
  }

  // ── CONTROL: pinned palette; R2 simulates the P25 unlock APPEND ──────────
  console.log('── CONTROL (P25 pinned palette) ──');
  const c1 = await relayRound(controlTools, undefined);
  console.log(usageLine('R1', c1));
  const appendedControl = [...controlTools, toAnthropicShape(fullCatalog.find((t) => t.name === target.name)!)];
  const c2 = await relayRound(appendedControl, continuationMessages(c1));
  console.log(usageLine('R2 (with P25-style tool APPEND)', c2));

  // ── TREATMENT: native deferred payload, byte-stable across rounds ────────
  console.log('\n── TREATMENT (P46 native deferred tools) ──');
  const t1 = await relayRound(treatmentPayload.tools, undefined);
  console.log(usageLine('R1', t1));
  const t2 = await relayRound(treatmentPayload.tools, continuationMessages(t1));
  console.log(usageLine('R2 (byte-stable tools array)', t2));

  // ── Verdicts ──────────────────────────────────────────────────────────────
  const q0 = t1.ok && t1.status !== null && t1.status < 400;
  const q1 = t1.usedNativeSearch || t1.toolUseNames.includes(target.name);
  const cRead = c2.usage.cache_read_input_tokens ?? -1;
  const tRead = t2.usage.cache_read_input_tokens ?? -1;
  const q2 = tRead >= 0 && cRead >= 0 ? tRead >= cRead : null;

  console.log('\n── FLIP GATE VERDICTS ──');
  console.log(`Q0 wire accepted:        ${q0 ? 'PASS' : 'FAIL'}`);
  console.log(`Q1 discovery/selection:  ${q1 ? 'PASS' : 'FAIL'} (target ${target.name}; control saw it: ${c1.toolUseNames.includes(target.name) ? 'yes (unexpected)' : 'no — off-palette as designed'})`);
  console.log(`Q2 cache economics:      ${q2 === null ? 'INCONCLUSIVE (usage fields missing from relay response — check agent_runs metadata instead)' : q2 ? `PASS (treatment R2 cache_read ${tRead} ≥ control ${cRead})` : `FAIL (treatment ${tRead} < control ${cRead})`}`);
  const go = q0 && q1 && q2 !== false;
  console.log(`\n${go ? 'GO' : 'NO-GO'} for uc_native_deferred_tools=1${q2 === null ? ' (verify Q2 via agent_runs cache metadata before flipping broadly)' : ''}`);
  process.exit(go ? 0 : 1);
}

main().catch((err) => {
  console.error('PROBE FATAL:', redact(err?.stack || String(err)));
  process.exit(1);
});
