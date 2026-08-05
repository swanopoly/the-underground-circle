/**
 * probe-v2-client-loop-parity — Phase-3 telemetry-parity GO/NO-GO gate for
 * flipping `uc_swanbot_v2_client_loop` default-ON (loop convergence, ADR-0002 /
 * docs/LOOP_CONVERGENCE_RUNBOOK.md §3).
 *
 * Phase-2 delegation already landed: `swanbot.ts` `callSwanBotV2` checks
 * `isSwanbotV2ClientLoopEnabled()` and, when ON, delegates the batch turn to the
 * client-side `runAgent` loop (`runSwanbotV2Batch`) instead of the
 * `swanbot-v2-ai` edge round-trip (swanbot.ts:1232 -> :1264). Before flipping
 * that flag default-ON we must prove the CLIENT loop's telemetry is
 * cohort-visible and vocabulary-clean vs the edge — otherwise a renamed cohort
 * tag or a widened stop-reason vocabulary would silently split the readiness
 * gate's cohort and mask a completion-rate regression. This probe is that gate.
 *
 * TWO MODES:
 *
 *   MODE A — DRY-RUN (default; NO creds, NO network, NO spend, deterministic).
 *     Imports the PURE client-batch telemetry core
 *     (`src/lib/swanbotV2BatchRuntimeCore.ts`) and statically asserts the client
 *     loop still emits rows the readiness gate counts the SAME as the edge:
 *       (1) cohort tags: V2_BATCH_RUN_SURFACE==='main_chat' &&
 *           V2_BATCH_RUN_VERSION==='swanbot-v2-ai' — byte-identical to the edge
 *           `surface`/`metadata.version` writes (index.ts:3154 / :3235). This is
 *           THE parity contract: same tag ⇒ one cohort ⇒ comparable rates.
 *       (2) v2BatchTerminalStatus: end_turn->completed, max_tokens/error->failed
 *           (mirror of edge `terminalStatus = reason==='end_turn'?completed:failed`,
 *           index.ts:3224).
 *       (3) buildV2BatchTerminalRow: metadata.version survives + final_stop_reason
 *           stays in {end_turn,max_tokens,error} (index.ts:3229-3235).
 *       (4) buildV2BatchErrorRow: version kept + final_stop_reason:'error' +
 *           status:'failed' — a client-only crash must NOT leave a clean row the
 *           gate miscounts as a completion (index.ts:3323-3331).
 *       (5) replay-safety parity: the batch runtime supplies
 *           toolParallelPolicyProvider to runAgent (session/typed-core R3 posture)
 *           WITHOUT a parallelToolConcurrency bump — a source assertion so the
 *           replay-safety gap can't silently reopen (swanbotV2BatchRuntime.ts).
 *     Echoes the real flag key + the Phase-2 delegation anchors. GO/NO-GO 0/1.
 *
 *   MODE B — LIVE readiness comparison (creds + UC_PROBE_CONFIRM=1 + a recorded
 *     UC_PROBE_FLIP_TS = the ISO timestamp of the first flag-ON dogfood).
 *     Reads `agent_runs` telemetry TWICE around the flip via
 *     `loadSwanBotOpenSwanAgentRunTelemetry` (windows on `started_at`, cohort-
 *     filtered to surface='main_chat' + metadata.version):
 *       edge baseline  = { circleId, until: flipTs }   (edge-loop v2 rows)
 *       client window  = { circleId, since: flipTs }    (client-loop v2 rows)
 *     then checks four runbook §3 criteria via
 *     `buildSwanBotOpenSwanReadinessSnapshot`:
 *       B1 vocabulary subset       : client v2 stop-reason set ⊆ edge baseline
 *       B2 ignoredRows no-growth   : client ignoredRows <= edge baseline
 *       B3 v2EndTurnRate           : client >= edge
 *       B4 completeness.v2 all-zero: no missing final_stop_reason / tool_calls /
 *                                    iteration_count / token fields on the client
 *                                    cohort
 *     MODE B's verdict is ONLY meaningful POST-SOAK: a cold client cohort (fewer
 *     than the readiness minRuns of client-loop v2 rows) reports 'insufficient
 *     client rows' and exits NO-GO — collect more dogfood before flipping.
 *     LIVE is user-creds-gated and cannot run in CI.
 *
 * Safety (mirrors scripts/native-deferred-tools-probe.ts):
 *   - Secrets from env ONLY (never argv), length-masked, redacted from output.
 *   - MODE B is read-only but still refuses to touch the network without
 *     UC_PROBE_CONFIRM=1.
 *   - RN modules stubbed so any transitive import loads under tsx.
 *   - No src/ or edge change ⇒ evals + Deno deploy untouched.
 *
 * Env (MODE B only):
 *   EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY  (or ./.env)
 *   UC_PROBE_EMAIL + UC_PROBE_PASSWORD    (or UC_PROBE_ACCESS_TOKEN — a user JWT)
 *   UC_PROBE_CIRCLE_ID                    a circle the probe user belongs to
 *   UC_PROBE_FLIP_TS                      ISO ts of the first flag-ON dogfood
 *   UC_PROBE_CONFIRM=1                    the read gate
 *   UC_PROBE_MIN_CLIENT_RUNS             optional; default = readiness minRuns
 *   UC_PROBE_DRY_RUN=1                    optional; force MODE A even with creds
 *
 * Run (dry / default):  npx tsx scripts/probe-v2-client-loop-parity.ts
 * Run (live, post-soak):
 *   UC_PROBE_CONFIRM=1 UC_PROBE_FLIP_TS=2026-07-21T00:00:00Z \
 *   UC_PROBE_CIRCLE_ID=... UC_PROBE_EMAIL=... UC_PROBE_PASSWORD=... \
 *   npx tsx scripts/probe-v2-client-loop-parity.ts
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
const FLIP_TS = process.env.UC_PROBE_FLIP_TS;

const SECRETS = [SUPABASE_ANON_KEY, PROBE_PASSWORD, PROBE_ACCESS_TOKEN, PROBE_EMAIL].filter(Boolean) as string[];
/** Replace every secret occurrence. ALWAYS redact BEFORE truncating — a slice
 *  taken first can cut a secret at the boundary so the remainder no longer
 *  matches and survives into output. */
function redact(text: unknown): string {
  let out = typeof text === 'string' ? text : JSON.stringify(text);
  for (const secret of SECRETS) out = out.split(secret).join('[redacted]');
  return out;
}
/** Length-only mask — never echo any part of the secret itself. */
function mask(secret: string | undefined): string {
  return secret ? `***(${secret.length} chars)` : '<missing>';
}

// ── Mode gates ──────────────────────────────────────────────────────────────
// MODE A (dry) is the default and needs NOTHING. MODE B (live) needs the full
// live env AND the explicit UC_PROBE_CONFIRM=1 read gate. UC_PROBE_DRY_RUN=1
// forces MODE A even when live creds are present.
const FORCE_DRY = process.env.UC_PROBE_DRY_RUN === '1';
const CONFIRM = process.env.UC_PROBE_CONFIRM === '1';
const liveInputsPresent = !!(
  SUPABASE_URL && SUPABASE_ANON_KEY && PROBE_CIRCLE_ID && FLIP_TS &&
  (PROBE_ACCESS_TOKEN || (PROBE_EMAIL && PROBE_PASSWORD))
);
const MODE_B = CONFIRM && !FORCE_DRY && liveInputsPresent;

// If the caller asked for a live run (CONFIRM) but is missing inputs, tell them
// exactly what's missing rather than silently degrading to a dry run.
if (CONFIRM && !FORCE_DRY && !liveInputsPresent) {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_ANON_KEY) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!PROBE_ACCESS_TOKEN && !(PROBE_EMAIL && PROBE_PASSWORD)) missing.push('UC_PROBE_EMAIL+UC_PROBE_PASSWORD (or UC_PROBE_ACCESS_TOKEN)');
  if (!PROBE_CIRCLE_ID) missing.push('UC_PROBE_CIRCLE_ID');
  if (!FLIP_TS) missing.push('UC_PROBE_FLIP_TS (ISO ts of the first flag-ON dogfood)');
  console.error('MODE B (live parity) requested via UC_PROBE_CONFIRM=1 but env is incomplete — no network call made.\n');
  for (const key of missing) console.error(`  ${key} = <missing>`);
  console.error(`\n  (auth: email=${mask(PROBE_EMAIL)} password=${mask(PROBE_PASSWORD)} token=${mask(PROBE_ACCESS_TOKEN)})`);
  console.error('\nExport the env vars above, then re-run. Or drop UC_PROBE_CONFIRM for the MODE A dry run.\n');
  process.exit(2);
}

// ── RN stubs so any transitive import loads under tsx (MODE B safety net; the
//    pure MODE A core imports nothing native). ───────────────────────────────
if (SUPABASE_URL) process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
if (SUPABASE_ANON_KEY) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// The exact cohort tags the edge writes — the static ground truth MODE A checks
// the pure core against (edge index.ts:3154 surface / :3235 metadata.version).
const EDGE_SURFACE = 'main_chat';
const EDGE_VERSION = 'swanbot-v2-ai';
const TERMINAL_VOCAB = ['end_turn', 'max_tokens', 'error'] as const;

// ── MODE A: static telemetry-parity contract ────────────────────────────────
async function runModeA(): Promise<never> {
  const {
    V2_BATCH_RUN_SURFACE,
    V2_BATCH_RUN_VERSION,
    v2BatchTerminalStatus,
    buildV2BatchTerminalRow,
    buildV2BatchErrorRow,
  } = await import('../src/lib/swanbotV2BatchRuntimeCore');
  const { SWANBOT_V2_CLIENT_LOOP_FLAG_KEY } = await import('../src/lib/swanbotV2ClientLoopFlag');

  const checks: Array<{ id: string; ok: boolean; detail: string }> = [];

  // (1) Cohort tags byte-identical to the edge — the parity contract.
  checks.push({
    id: 'cohort-tags',
    ok: V2_BATCH_RUN_SURFACE === EDGE_SURFACE && V2_BATCH_RUN_VERSION === EDGE_VERSION,
    detail: `client surface='${V2_BATCH_RUN_SURFACE}' version='${V2_BATCH_RUN_VERSION}' vs edge '${EDGE_SURFACE}'/'${EDGE_VERSION}'`,
  });

  // (2) Terminal status mapping: end_turn->completed, everything else->failed.
  const statusMap = {
    end_turn: v2BatchTerminalStatus('end_turn'),
    max_tokens: v2BatchTerminalStatus('max_tokens'),
    error: v2BatchTerminalStatus('error'),
  };
  checks.push({
    id: 'terminal-status',
    ok: statusMap.end_turn === 'completed' && statusMap.max_tokens === 'failed' && statusMap.error === 'failed',
    detail: `end_turn->${statusMap.end_turn}, max_tokens->${statusMap.max_tokens}, error->${statusMap.error}`,
  });

  // (3) Terminal row keeps metadata.version + final_stop_reason vocabulary and
  //     the status agrees with (2), for every terminal reason.
  const terminalOk = TERMINAL_VOCAB.every((reason) => {
    const row = buildV2BatchTerminalRow({
      toolCalls: [],
      iterations: 1,
      finalStopReason: reason,
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      targetAgentName: 'BlackSwan',
      rawStopReason: reason,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    const md = row.metadata as { version?: unknown } | undefined;
    const expectedStatus = reason === 'end_turn' ? 'completed' : 'failed';
    return md?.version === EDGE_VERSION
      && row.final_stop_reason === reason
      && (TERMINAL_VOCAB as readonly string[]).includes(String(row.final_stop_reason))
      && row.status === expectedStatus;
  });
  checks.push({
    id: 'terminal-row',
    ok: terminalOk,
    detail: `metadata.version survives + final_stop_reason in {${TERMINAL_VOCAB.join(',')}} + status agrees, for all ${TERMINAL_VOCAB.length} reasons`,
  });

  // (4) Error row (client-only crash) keeps version + fails closed.
  const errRow = buildV2BatchErrorRow({
    targetAgentName: 'BlackSwan',
    errorMessage: new Error('client-loop crash'),
    completedAt: '2026-01-01T00:00:00.000Z',
  });
  const errMd = errRow.metadata as { version?: unknown } | undefined;
  checks.push({
    id: 'error-row',
    ok: errMd?.version === EDGE_VERSION && errRow.final_stop_reason === 'error' && errRow.status === 'failed',
    detail: `version='${String(errMd?.version)}' final_stop_reason='${String(errRow.final_stop_reason)}' status='${String(errRow.status)}'`,
  });

  // (5) Replay-safety parity (B1): the batch runtime must supply the SAME
  //     dependency-aware policy provider the session/typed-core loop uses (R3)
  //     so a failed outcome-unknown mutate gets the bounded "verify first"
  //     appendix instead of a blind replay that could double a committed side
  //     effect — WITHOUT bumping concurrency (the provider must never be paired
  //     with a parallelism bump). The runtime module pulls RN transitively (not
  //     tsx-loadable) and the lane is opt-in, so this is a source-text assertion:
  //     pin the wiring so the replay-safety gap can't silently reopen.
  const batchRuntimeSrc = readFileSync(join(repoRoot, 'src/lib/swanbotV2BatchRuntime.ts'), 'utf8');
  const suppliesPolicyProvider = /toolParallelPolicyProvider:\s*createOpenSwanToolParallelPolicyProvider\(/.test(batchRuntimeSrc);
  const concurrencyStillSequential = /parallelToolConcurrency:\s*1\b/.test(batchRuntimeSrc);
  checks.push({
    id: 'replay-safety-provider',
    ok: suppliesPolicyProvider && concurrencyStillSequential,
    detail: `runAgent supplies toolParallelPolicyProvider=${suppliesPolicyProvider} at parallelToolConcurrency:1=${concurrencyStillSequential} (replay-safety parity, no concurrency bump)`,
  });

  console.log('MODE A — DRY-RUN static telemetry-parity contract (no creds, no network, no spend).\n');
  console.log(`flag key: ${SWANBOT_V2_CLIENT_LOOP_FLAG_KEY}`);
  console.log('Phase-2 delegation (already landed):');
  console.log('  src/lib/swanbot.ts callSwanBotV2 -> if (isSwanbotV2ClientLoopEnabled()) -> runSwanbotV2Batch(...)  [swanbot.ts ~1232 -> ~1264]');
  console.log('  edge revert target: supabase/functions/swanbot-v2-ai/index.ts (terminalStatus + metadata.version)\n');
  console.log('Static parity asserts (client pure core vs edge writes):');
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`);

  const go = checks.every((c) => c.ok);
  console.log(`\n${go ? 'GO' : 'NO-GO'} — client batch telemetry is ${go
    ? 'cohort-visible + vocabulary-clean; the static parity contract holds.'
    : 'DRIFTED from the edge parity contract (see FAIL above).'}`);
  if (go) {
    console.log('  MODE A proves the row SHAPE only. Run MODE B post-soak (creds + UC_PROBE_CONFIRM=1 +');
    console.log('  UC_PROBE_FLIP_TS) for the live end-turn-rate comparison before flipping default-ON.');
  }
  process.exit(go ? 0 : 1);
}

// ── MODE B: live edge-vs-client readiness comparison ────────────────────────
function fmtRate(r: number | null): string {
  return r === null ? 'n/a' : r.toFixed(3);
}

async function runModeB(): Promise<never> {
  // Validate the flip timestamp before spending a round-trip.
  const flipTs = FLIP_TS!;
  if (Number.isNaN(Date.parse(flipTs))) {
    console.error(`UC_PROBE_FLIP_TS is not a parseable timestamp: '${flipTs}'. Use an ISO ts, e.g. 2026-07-21T00:00:00Z.`);
    process.exit(2);
  }

  // ── Auth: user JWT for RLS-scoped reads ─────────────────────────────────
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
      console.error(`auth FAILED (${authRes.status}): ${redact(JSON.stringify(authJson)).slice(0, 200)}`);
      process.exit(1);
    }
    accessToken = authJson.access_token;
    userId = authJson.user?.id || userId;
    SECRETS.push(accessToken);
  }
  console.log(`MODE B — LIVE readiness comparison · auth ok (user ${userId.slice(0, 8)}…) · circle ${PROBE_CIRCLE_ID!.slice(0, 8)}… · flip ${flipTs}\n`);

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { loadSwanBotOpenSwanAgentRunTelemetry, buildSwanBotOpenSwanReadinessSnapshot } =
    await import('../src/lib/swanbotOpenSwanReadiness');
  const clientLike = supabase as unknown as Parameters<typeof loadSwanBotOpenSwanAgentRunTelemetry>[1];

  // Edge baseline: v2 rows BEFORE the flip = edge-loop-produced.
  // Client window: v2 rows AFTER the flip = client-loop-produced.
  const edgeProd = await loadSwanBotOpenSwanAgentRunTelemetry(
    { circleId: PROBE_CIRCLE_ID, until: flipTs }, clientLike,
  );
  const clientProd = await loadSwanBotOpenSwanAgentRunTelemetry(
    { circleId: PROBE_CIRCLE_ID, since: flipTs }, clientLike,
  );

  const edgeSnap = buildSwanBotOpenSwanReadinessSnapshot({
    telemetry: edgeProd.telemetry,
    telemetryCompleteness: { v1: edgeProd.completeness.v1, v2: edgeProd.completeness.v2 },
  });
  const clientSnap = buildSwanBotOpenSwanReadinessSnapshot({
    telemetry: clientProd.telemetry,
    telemetryCompleteness: { v1: clientProd.completeness.v1, v2: clientProd.completeness.v2 },
  });

  const edgeTel = edgeSnap.telemetry;
  const clientTel = clientSnap.telemetry;

  const minClientRunsEnv = Number(process.env.UC_PROBE_MIN_CLIENT_RUNS);
  const minClientRuns = Number.isFinite(minClientRunsEnv) && minClientRunsEnv > 0
    ? Math.floor(minClientRunsEnv)
    : clientTel.minRuns;

  console.log(`edge baseline (until ${flipTs}):  v2 rows=${edgeTel.v2RunCount} end_turn_rate=${fmtRate(edgeTel.v2EndTurnRate)} ignoredRows=${edgeProd.ignoredRows}`);
  console.log(`client window (since ${flipTs}):  v2 rows=${clientTel.v2RunCount} end_turn_rate=${fmtRate(clientTel.v2EndTurnRate)} ignoredRows=${clientProd.ignoredRows}`);
  for (const w of clientProd.warnings) console.log(`  client warning: ${redact(w)}`);
  console.log('');

  // ── Cold-start gate: MODE B is only meaningful post-soak. ────────────────
  if (clientTel.v2RunCount < minClientRuns) {
    console.log(`NO-GO — insufficient client rows: ${clientTel.v2RunCount}/${minClientRuns} client-loop v2 runs since the flip.`);
    console.log('  Keep the flag ON for a soak window and re-run; a cold cohort cannot establish parity.');
    process.exit(1);
  }

  // ── B1 vocabulary subset: client v2 stop-reasons ⊆ edge baseline. ────────
  const edgeVocab = new Set(edgeTel.v2StopReasons.breakdown.map((e) => e.reason));
  const clientVocab = clientTel.v2StopReasons.breakdown.map((e) => e.reason);
  const newReasons = clientVocab.filter((r) => !edgeVocab.has(r));
  const b1 = newReasons.length === 0;

  // ── B2 ignoredRows no-growth: the client cohort must not add uncounted /
  //    stuck rows beyond the edge baseline. ─────────────────────────────────
  const b2 = clientProd.ignoredRows <= edgeProd.ignoredRows;

  // ── B3 v2 end-turn rate: client >= edge. Inconclusive if no edge baseline. ─
  const edgeRate = edgeTel.v2EndTurnRate;
  const clientRate = clientTel.v2EndTurnRate;
  const b3: boolean | null = (edgeRate === null || clientRate === null)
    ? null
    : clientRate >= edgeRate;

  // ── B4 completeness.v2 all-zero on the client cohort (the same completeness
  //    the readiness snapshot turns into blockers). ──────────────────────────
  const cc = clientProd.completeness.v2;
  const b4Fields = {
    missingFinalStopReason: cc.missingFinalStopReason,
    missingToolCalls: cc.missingToolCalls,
    badIterationCount: cc.badIterationCount,
    missingTokenFields: cc.missingTokenFields,
  };
  const b4 = Object.values(b4Fields).every((v) => v === 0);

  console.log('Runbook §3 parity criteria (client vs edge baseline):');
  console.log(`  ${b1 ? 'PASS' : 'FAIL'}  B1 vocabulary subset: client v2 reasons=[${clientVocab.join(', ') || '-'}]${b1 ? '' : ` NEW=[${newReasons.join(', ')}]`}`);
  console.log(`  ${b2 ? 'PASS' : 'FAIL'}  B2 ignoredRows no-growth: client ${clientProd.ignoredRows} <= edge ${edgeProd.ignoredRows}`);
  console.log(`  ${b3 === null ? 'INCONCLUSIVE' : b3 ? 'PASS' : 'FAIL'}  B3 v2 end-turn rate: client ${fmtRate(clientRate)} >= edge ${fmtRate(edgeRate)}${b3 === null ? ' (no edge v2 baseline in this window)' : ''}`);
  console.log(`  ${b4 ? 'PASS' : 'FAIL'}  B4 completeness.v2 all-zero: ${JSON.stringify(b4Fields)} (zeroTokenRows=${cc.zeroTokenRows}, informational)`);

  const go = b1 && b2 && b3 === true && b4;
  console.log(`\n${go ? 'GO' : 'NO-GO'} for uc_swanbot_v2_client_loop default-ON${
    b3 === null ? ' — resolve B3: pick a circle/window with an edge v2 baseline pre-flip.' : ''}`);
  process.exit(go ? 0 : 1);
}

async function main(): Promise<void> {
  if (MODE_B) {
    await runModeB();
  } else {
    await runModeA();
  }
}

main().catch((err) => {
  console.error('PROBE FATAL:', redact(err?.stack || String(err)));
  process.exit(1);
});
