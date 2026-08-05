/**
 * google-workspace-token-smoketest — the shared Gmail/Workspace access-token
 * resolver (supabase/functions/_shared/google-workspace-token.ts) that fixes
 * the scheduled-action-runner "// TODO: refresh if expired" bug: scheduled
 * Gmail sends now prefer the refreshing `user_google_credentials` store.
 * Load-bearing assertions:
 *
 *   googleTokenNeedsRefresh (pure, total): null/undefined/'' → true; ISO
 *   1h-future → false; within-margin (now+60s @120s) → true; beyond-margin
 *   (now+180s @120s) → false; already-expired → true; 'garbage' → true;
 *   custom margin both ways; exact-margin boundary → true, one past → false;
 *   determinism (same inputs twice); never throws for number/object/NaN.
 *
 *   resolveGoogleWorkspaceAccessToken (fake supabase; Deno/fetch stubbed):
 *   no row → not_connected; row without access_token → not_connected; fresh
 *   cached token → {ok, refreshed:false, accessToken:'cached'} WITHOUT calling
 *   fetch; expired + refresh_token + configured → live refresh → {ok,
 *   refreshed:true} with the new token persisted; expired + no refresh_token →
 *   reconnect_required; expired but no client env → not_configured;
 *   invalid_grant → reconnect_required; 5xx → refresh_failed; 200 without an
 *   access_token → refresh_failed; a throwing supabase → not_connected.
 *
 * Pure loader: google-workspace-token.ts has zero imports and only touches
 * Deno.env/fetch inside the refresh branch, which the stubs below supply.
 */

import {
  googleTokenNeedsRefresh,
  resolveGoogleWorkspaceAccessToken,
} from '../supabase/functions/_shared/google-workspace-token.ts';
import { readFileSync } from 'node:fs';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// A fixed clock so the expiry math is deterministic.
const NOW = Date.parse('2026-07-13T00:00:00.000Z');
const now = () => NOW;
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

/**
 * Minimal fake of the Supabase edge client. `from()` supports BOTH the read
 * chain (`.select().eq().maybeSingle()`) and the write chain
 * (`.update().eq()`), matching resolveGoogleWorkspaceAccessToken's two calls.
 */
function fakeSupabase(
  row: unknown,
  opts: { onUpdate?: (patch: Record<string, unknown>) => void; throwOnRead?: boolean } = {},
): any {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => {
            if (opts.throwOnRead) throw new Error('boom (should be swallowed)');
            return { data: row };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, _val: string) => {
          opts.onUpdate?.(patch);
          return { data: null, error: null };
        },
      }),
    }),
  };
}

// ── fetch / Deno stubbing helpers (save + restore so cases don't bleed) ──────
const realFetch = globalThis.fetch;
const realDeno = (globalThis as any).Deno;

function stubEnv(vals: Record<string, string | undefined>): void {
  (globalThis as any).Deno = { env: { get: (k: string) => vals[k] } };
}
function restoreEnv(): void { (globalThis as any).Deno = realDeno; }

let fetchCalls = 0;
function stubFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }): void {
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ''),
    } as unknown as Response;
  }) as typeof fetch;
}
function restoreFetch(): void { globalThis.fetch = realFetch; }

async function main(): Promise<void> {
  // The browser's Authorization-bearing status fetch preflights before the
  // edge function sees it. Keep the hosted router and function response in
  // lockstep so localhost does not log a CORS failure on every Chat load.
  const supabaseConfig = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const oauthSource = readFileSync(new URL('../supabase/functions/google-oauth/index.ts', import.meta.url), 'utf8');
  assert(
    /\[functions\.google-oauth\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/google-oauth\/index\.ts"/.test(supabaseConfig),
    '(0) google-oauth lets unauthenticated OPTIONS/callback reach its own auth boundary',
  );
  assert(
    oauthSource.includes('"Access-Control-Allow-Methods": "GET, POST, OPTIONS"')
      && oauthSource.includes('if (req.method === "OPTIONS")'),
    '(0) google-oauth answers browser preflight with explicit allowed methods',
  );

  // ─── (1) googleTokenNeedsRefresh: missing / empty expiry → true ───────────
  assertEq(googleTokenNeedsRefresh(null, NOW), true, '(1) null expiry needs refresh');
  assertEq(googleTokenNeedsRefresh(undefined, NOW), true, '(1) undefined expiry needs refresh');
  assertEq(googleTokenNeedsRefresh('', NOW), true, '(1) empty-string expiry needs refresh');

  // ─── (2) well-formed expiry vs the default 2-minute margin ────────────────
  assertEq(googleTokenNeedsRefresh(iso(60 * 60 * 1000), NOW), false, '(2) 1h-future token is fresh');
  assertEq(googleTokenNeedsRefresh(iso(60_000), NOW), true, '(2) now+60s within 120s margin needs refresh');
  assertEq(googleTokenNeedsRefresh(iso(180_000), NOW), false, '(2) now+180s beyond 120s margin is fresh');
  assertEq(googleTokenNeedsRefresh(iso(-60_000), NOW), true, '(2) already-expired token needs refresh');

  // ─── (3) unparseable expiry → true ────────────────────────────────────────
  assertEq(googleTokenNeedsRefresh('garbage', NOW), true, '(3) garbage expiry needs refresh');
  assertEq(googleTokenNeedsRefresh('2026-13-99T99:99:99Z', NOW), true, '(3) impossible date needs refresh');

  // ─── (4) custom margin, both directions ───────────────────────────────────
  assertEq(googleTokenNeedsRefresh(iso(200_000), NOW, 300_000), true, '(4) 200s < 300s margin → refresh');
  assertEq(googleTokenNeedsRefresh(iso(400_000), NOW, 300_000), false, '(4) 400s > 300s margin → fresh');

  // ─── (5) exact-margin boundary is inclusive (<=) ──────────────────────────
  assertEq(googleTokenNeedsRefresh(iso(120_000), NOW), true, '(5) exactly at margin → refresh (<= boundary)');
  assertEq(googleTokenNeedsRefresh(iso(120_001), NOW), false, '(5) one ms past margin → fresh');

  // ─── (6) determinism: same inputs, same output twice ──────────────────────
  const d1 = googleTokenNeedsRefresh(iso(90_000), NOW);
  const d2 = googleTokenNeedsRefresh(iso(90_000), NOW);
  assertEq(d1, d2, '(6) deterministic for identical inputs');
  assertEq(d1, true, '(6) now+90s within default margin → refresh');

  // ─── (7) never throws on out-of-contract inputs ───────────────────────────
  try {
    const r1 = googleTokenNeedsRefresh(1234567890 as unknown as string, NOW);
    const r2 = googleTokenNeedsRefresh({} as unknown as string, NOW);
    const r3 = googleTokenNeedsRefresh(NaN as unknown as string, NOW);
    const r4 = googleTokenNeedsRefresh([] as unknown as string, NOW);
    assert(typeof r1 === 'boolean' && typeof r2 === 'boolean', '(7) number/object inputs return a boolean');
    assertEq(r2, true, '(7) object expiry → unparseable → refresh');
    assertEq(r3, true, '(7) NaN expiry → unparseable → refresh');
    assert(typeof r4 === 'boolean', '(7) array input returns a boolean');
    passes += 1; // reached here without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (7) googleTokenNeedsRefresh threw: ${(e as Error)?.message}`);
  }

  // ─── (8) resolve: no row → not_connected ──────────────────────────────────
  {
    const r = await resolveGoogleWorkspaceAccessToken(fakeSupabase(null), 'u1', now);
    assertEq(r.ok, false, '(8) no row → not ok');
    assertEq((r as { code: string }).code, 'not_connected', '(8) no row → not_connected');
  }

  // ─── (9) resolve: row without access_token → not_connected ────────────────
  {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: null, refresh_token: 'r', expires_at: iso(3_600_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(9) missing access_token → not ok');
    assertEq((r as { code: string }).code, 'not_connected', '(9) missing access_token → not_connected');
  }

  // ─── (10) resolve: fresh cached token returns WITHOUT touching fetch ───────
  stubFetch({ ok: false, status: 500 }); // if called, refresh would look failed
  try {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'cached', refresh_token: 'r', expires_at: iso(3_600_000) }),
      'u1',
      now,
    );
    assert(r.ok, '(10) fresh token → ok');
    assertEq((r as { accessToken: string }).accessToken, 'cached', '(10) returns the cached access token');
    assertEq((r as { refreshed: boolean }).refreshed, false, '(10) refreshed:false for a cached token');
    assertEq(fetchCalls, 0, '(10) fresh token path never calls fetch');
  } finally {
    restoreFetch();
  }

  // ─── (11) resolve: expired + refresh_token + configured → live refresh ────
  {
    let captured: Record<string, unknown> | null = null;
    const supabase = fakeSupabase(
      { access_token: 'old', refresh_token: 'refresh-xyz', expires_at: iso(-60_000) },
      { onUpdate: (patch) => { captured = patch; } },
    );
    stubEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' });
    stubFetch({ ok: true, status: 200, json: async () => ({ access_token: 'new-access', expires_in: 3600 }) });
    try {
      const r = await resolveGoogleWorkspaceAccessToken(supabase, 'u1', now);
      assert(r.ok, '(11) refresh → ok');
      assertEq((r as { refreshed: boolean }).refreshed, true, '(11) refreshed:true after live refresh');
      assertEq((r as { accessToken: string }).accessToken, 'new-access', '(11) returns the newly-minted token');
      assertEq(fetchCalls, 1, '(11) refresh path hits the token endpoint exactly once');
      assert(captured !== null, '(11) row was updated');
      assertEq((captured as unknown as Record<string, unknown>)?.access_token, 'new-access', '(11) persisted the new access token');
      assertEq((captured as unknown as Record<string, unknown>)?.expires_at, iso(3600 * 1000), '(11) persisted expires_at = now + expires_in');
      assert(typeof (captured as unknown as Record<string, unknown>)?.updated_at === 'string', '(11) persisted an updated_at timestamp');
    } finally {
      restoreFetch();
      restoreEnv();
    }
  }

  // ─── (12) resolve: expired but no refresh_token → reconnect_required ───────
  {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'old', refresh_token: null, expires_at: iso(-60_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(12) no refresh_token → not ok');
    assertEq((r as { code: string }).code, 'reconnect_required', '(12) no refresh_token → reconnect_required');
  }

  // ─── (13) resolve: needs refresh but client env not configured ────────────
  stubEnv({}); // Deno.env.get returns undefined for the client id/secret keys
  try {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'old', refresh_token: 'refresh-xyz', expires_at: iso(-60_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(13) unconfigured → not ok');
    assertEq((r as { code: string }).code, 'not_configured', '(13) missing client id/secret → not_configured');
  } finally {
    restoreEnv();
  }

  // ─── (14) resolve: invalid_grant refresh error → reconnect_required ───────
  stubEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' });
  stubFetch({ ok: false, status: 400, text: async () => '{"error":"invalid_grant","error_description":"Token has been revoked."}' });
  try {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'old', refresh_token: 'refresh-xyz', expires_at: iso(-60_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(14) invalid_grant → not ok');
    assertEq((r as { code: string }).code, 'reconnect_required', '(14) invalid_grant → reconnect_required');
  } finally {
    restoreFetch();
    restoreEnv();
  }

  // ─── (15) resolve: 5xx refresh error → refresh_failed ─────────────────────
  stubEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' });
  stubFetch({ ok: false, status: 503, text: async () => 'upstream unavailable' });
  try {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'old', refresh_token: 'refresh-xyz', expires_at: iso(-60_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(15) 5xx → not ok');
    assertEq((r as { code: string }).code, 'refresh_failed', '(15) non-invalid_grant error → refresh_failed');
  } finally {
    restoreFetch();
    restoreEnv();
  }

  // ─── (16) resolve: 200 without an access_token → refresh_failed ───────────
  stubEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' });
  stubFetch({ ok: true, status: 200, json: async () => ({ expires_in: 3600 }) });
  try {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase({ access_token: 'old', refresh_token: 'refresh-xyz', expires_at: iso(-60_000) }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(16) malformed 200 → not ok');
    assertEq((r as { code: string }).code, 'refresh_failed', '(16) 200 without access_token → refresh_failed');
  } finally {
    restoreFetch();
    restoreEnv();
  }

  // ─── (17) resolve: a throwing supabase is swallowed → not_connected ───────
  {
    const r = await resolveGoogleWorkspaceAccessToken(
      fakeSupabase(null, { throwOnRead: true }),
      'u1',
      now,
    );
    assertEq(r.ok, false, '(17) thrown read → not ok');
    assertEq((r as { code: string }).code, 'not_connected', '(17) any throw is caught → not_connected');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll google-workspace-token smoke cases passed (${passes} passed).`);
}

main();
