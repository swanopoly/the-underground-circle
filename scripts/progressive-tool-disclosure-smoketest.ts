/**
 * progressive-tool-disclosure-smoketest
 *
 * Locks the T2 progressive tool-disclosure mechanism (opt-in, dark):
 *
 *   1. Default full-catalog path is unchanged (counts/names) — progressive
 *      shipping must not move any existing caller.
 *   2. `getProgressiveOpenSwanTools` advertises only the pinned core plus
 *      `tools.search` (~25–40 tools per surface, not ~150).
 *   3. `searchOpenSwanToolCatalog` ranking: exact name > name substring >
 *      label > description tokens; surface + family filters apply.
 *   4. A deferred tool found via `tools.search` becomes callable on the NEXT
 *      iteration through `resolveAdditionalTools` in a real `runAgent` run
 *      with a mock provider (mirrors agent-core-smoketest).
 *   5. The resolver only ever ADDS tools — the advertised set never shrinks.
 *   6. `approvals.*` and `tools.search` are always pinned; a deferred-only
 *      tool is NOT advertised initially but IS searchable + in the full path.
 *   7. Token evidence — rough char/token estimate of the advertised tool
 *      schema payload, full catalog vs pinned core, per surface.
 *
 * `openswanToolRuntime` transitively imports react-native (via the supabase
 * singleton), which tsx/esbuild cannot parse. Instead of mirroring the
 * catalog, this smoke stubs the two react-native module specifiers with
 * `node:module.registerHooks` and dynamically imports the REAL runtime —
 * so pinned counts, search ranking, and token estimates are measured
 * against the real ~157-tool catalog, not a fixture.
 *
 * Run: npm run smoke:progressive-tool-disclosure
 */

import { registerHooks } from 'node:module';

// The supabase singleton creates a client at import time — give it inert
// values BEFORE any app module loads. Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://progressive-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'progressive-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Type-only imports are erased at compile time — safe before the hooks run.
import type { AgentMessageContentBlock, AgentProvider, AgentToolDefinition, ProviderTurnResult } from '../src/lib/agentExecutionCore';
import type { OpenSwanRuntimeToolContext, OpenSwanToolSurface } from '../src/lib/openswanToolRuntime';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

const SURFACES: OpenSwanToolSurface[] = ['main_chat', 'room_chat', 'office', 'task_run'];
const ctx: OpenSwanRuntimeToolContext = { circleId: 'smoke-circle', userId: 'smoke-user' };

/** Mock provider that also records the tool names advertised on each turn. */
function capturingProvider(turns: ProviderTurnResult[]): { provider: AgentProvider; advertisedPerTurn: string[][] } {
  let i = 0;
  const advertisedPerTurn: string[][] = [];
  return {
    advertisedPerTurn,
    provider: {
      async turn({ tools }: { tools: AgentToolDefinition[] }) {
        advertisedPerTurn.push(tools.map((t) => t.name));
        if (i >= turns.length) throw new Error(`capturingProvider: out of scripted turns at index ${i}`);
        return turns[i++];
      },
    },
  };
}

async function main() {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const bridge = await import('../src/lib/openswanBridge');
  const core = await import('../src/lib/agentExecutionCore');

  // ── Case 1 — default full-catalog path unchanged ──────────────────────────
  for (const surface of SURFACES) {
    const catalogNames = runtime
      .listOpenSwanAnthropicToolsForSurface(surface)
      .map((t) => t.name);
    const bridgeNames = bridge.getOpenSwanToolsForSurface(surface, ctx).map((t) => t.name);
    assert(
      JSON.stringify(bridgeNames) === JSON.stringify(catalogNames),
      `case1: ${surface} — full bridge path mirrors the runtime catalog (${catalogNames.length} tools)`,
    );
  }
  const fullMain = runtime.listOpenSwanAnthropicToolsForSurface('main_chat').map((t) => t.name);
  assert(fullMain.length >= 140, `case1: main_chat full catalog is still the long tail (${fullMain.length} tools)`);
  assert(fullMain.includes('desktop.launch_app'), 'case1: full path still advertises deferred desktop tools');
  assert(fullMain.includes('tools.search'), 'case1: full path includes the new tools.search tool');

  // ── Case 2 — progressive path advertises pinned core + tools.search only ──
  const progressive = bridge.getProgressiveOpenSwanTools('main_chat', ctx);
  const progressiveNames = progressive.tools.map((t) => t.name);
  assert(
    progressiveNames.every((name) => runtime.getOpenSwanToolDisclosure(name as never) === 'pinned'),
    'case2: every progressive tool is classified pinned',
  );
  assert(
    progressiveNames.length >= 25 && progressiveNames.length <= 40,
    `case2: pinned core size in the 25–40 target band (${progressiveNames.length})`,
  );
  for (const expected of [
    'tools.search', 'approvals.list', 'approvals.request', 'approvals.resolve',
    'search_memories', 'save_memory', 'fetch_url', 'list_circle_members',
    'schedule_action', 'browser.plan_task', 'messages.list', 'messages.create',
    'tasks.list', 'goals.list', 'missions.list', 'context.search',
  ]) {
    assert(progressiveNames.includes(expected), `case2: pinned core includes ${expected}`);
  }
  for (const prefix of ['desktop.', 'vault.', 'github.', 'wp.', 'code.', 'verification.', 'rooms.', 'circle.']) {
    assert(
      !progressiveNames.some((n) => n.startsWith(prefix)),
      `case2: no ${prefix}* tool advertised initially`,
    );
  }
  assert(!progressiveNames.includes('skills.view'), 'case2: skills.view stays deferred');

  // ── Case 3 — catalog search ranking + filters ─────────────────────────────
  const exact = runtime.searchOpenSwanToolCatalog('desktop.photoshop_export_proof');
  assert(exact[0]?.name === 'desktop.photoshop_export_proof', 'case3: exact tool name ranks first');
  assert(typeof exact[0]?.summary === 'string' && exact[0].summary.length > 0, 'case3: matches carry a policy summary');
  assert(exact[0]?.approvalMode === 'ask' || exact[0]?.approvalMode === 'auto', 'case3: matches carry an approval mode');

  const substring = runtime.searchOpenSwanToolCatalog('screenshot');
  assert(substring.length > 0 && substring[0].name.includes('screenshot'), 'case3: name substring outranks description hits');

  const surfaceFiltered = runtime.searchOpenSwanToolCatalog('launch_app', { surface: 'office' });
  assert(
    !surfaceFiltered.some((m) => m.name === 'desktop.launch_app'),
    'case3: surface filter hides tools not exposed on that surface',
  );

  const familyFiltered = runtime.searchOpenSwanToolCatalog('export proof', { family: 'desktop' });
  assert(familyFiltered.length > 0 && familyFiltered.every((m) => m.family === 'desktop'), 'case3: family filter restricts matches');
  assert(familyFiltered.some((m) => m.name === 'desktop.photoshop_export_proof'), 'case3: family-filtered search finds the Adobe tool');

  const familyBrowse = runtime.searchOpenSwanToolCatalog('', { family: 'vault' });
  assert(familyBrowse.length > 0 && familyBrowse.every((m) => m.family === 'vault'), 'case3: empty query + family browses the family');

  const savedLoginSearch = runtime.searchOpenSwanToolCatalog('saved login', { family: 'browser', surface: 'task_run' });
  assert(
    savedLoginSearch.some((m) => m.name === 'browser.fill_credential_field'),
    'case3: saved-login search finds browser.fill_credential_field',
  );

  // ── Case 3b — natural-phrasing search QUALITY (P24 ranking regressions) ───
  // These are the deferred-tool-loading gate: if search can't surface the
  // right tool for a plain task phrasing, the model can't unlock it.
  const topName = (q: string, opts?: any) => runtime.searchOpenSwanToolCatalog(q, { surface: 'main_chat', limit: 4, ...(opts || {}) })[0]?.name;
  const names = (q: string, opts?: any) => runtime.searchOpenSwanToolCatalog(q, { surface: 'main_chat', limit: 6, ...(opts || {}) }).map((m: any) => m.name);
  // "app" must not let agent.update_appearance outrank desktop.launch_app
  // (segment vs substring pollution).
  assert(topName('launch an app') === 'desktop.launch_app', 'case3b: "launch an app" ranks desktop.launch_app first', topName('launch an app'));
  assert(!names('launch an app').slice(0, 3).includes('agent.update_appearance'), 'case3b: update_appearance not in top-3 for an app-launch query');
  // The defining domain word must surface the domain tool (family synonym).
  assert(topName('upload an image to wordpress') === 'wp.upload_media', 'case3b: "upload an image to wordpress" ranks wp.upload_media first', topName('upload an image to wordpress'));
  // Generic CRUD verb must not top a semantically different family.
  assert(String(topName('remove the background from a photo')).startsWith('desktop.photoshop'), 'case3b: "remove the background from a photo" ranks a photoshop tool first', topName('remove the background from a photo'));
  assert(topName('open photoshop') === 'desktop.photoshop_document_status', 'case3b: "open photoshop" ranks the photoshop status tool first (not open_path)', topName('open photoshop'));
  assert(String(topName('post a message to a room')).startsWith('rooms.'), 'case3b: "post a message to a room" ranks a rooms tool first', topName('post a message to a room'));
  assert(topName('create a google doc') === 'docs.create_document', 'case3b: "create a google doc" ranks docs.create_document first', topName('create a google doc'));

  // ── Case 3c — P25 mode discipline holds on the progressive path ───────────
  // The legacy full-catalog path filters mode-tagged tools (TOOL_MODE_TAGS);
  // progressive disclosure must apply the SAME filter to the pinned core AND
  // to search-unlocked additions, or plan mode could leak execute-only tools.
  {
    const planPinned = bridge.getProgressiveOpenSwanTools('main_chat', ctx, { mode: 'plan' });
    const planNames = planPinned.tools.map((t: any) => t.name);
    assert(!planNames.includes('schedule_action'), 'case3c: plan mode hides execute-only schedule_action from the pinned core', planNames.filter((n: string) => !n.includes('.')).join(','));
    assert(planNames.includes('tools.search'), 'case3c: tools.search stays pinned in plan mode');
    assert(planNames.includes('approvals.request') || planNames.some((n: string) => n.startsWith('approvals.')), 'case3c: approvals plumbing stays pinned in plan mode');
    const executePinned = bridge.getProgressiveOpenSwanTools('main_chat', ctx, { mode: 'execute' });
    assert(executePinned.tools.some((t: any) => t.name === 'schedule_action'), 'case3c: execute mode keeps schedule_action pinned');

    // Unlock path: search for a desktop execute-tagged tool in plan mode —
    // the resolver must NOT hand it back.
    const searchTool = planPinned.tools.find((t: any) => t.name === 'tools.search');
    assert(!!searchTool, 'case3c: search tool present for the unlock probe');
    if (searchTool) {
      await searchTool.handler({ query: 'desktop.launch_app' }, { session: {}, iteration: 1 } as any);
      const additions = planPinned.resolveAdditionalTools({ session: {}, iteration: 2 });
      assert(!additions.some((t: any) => t.name === 'desktop.launch_app'), 'case3c: plan mode blocks the execute-tagged unlock', additions.map((t: any) => t.name).join(','));
      const executeRun = bridge.getProgressiveOpenSwanTools('main_chat', ctx, { mode: 'execute' });
      const executeSearch = executeRun.tools.find((t: any) => t.name === 'tools.search');
      await executeSearch!.handler({ query: 'desktop.launch_app' }, { session: {}, iteration: 1 } as any);
      const executeAdditions = executeRun.resolveAdditionalTools({ session: {}, iteration: 2 });
      assert(executeAdditions.some((t: any) => t.name === 'desktop.launch_app'), 'case3c: execute mode unlocks the same tool', executeAdditions.map((t: any) => t.name).join(','));
    }
  }

  // ── Case 4/5 — search-unlocked tool becomes callable next iteration ───────
  const run = bridge.getProgressiveOpenSwanTools('main_chat', ctx);
  const searchUse: AgentMessageContentBlock = {
    type: 'tool_use', id: 'tu_search', name: 'tools.search', input: { query: 'skills.view' },
  };
  // skills.view with an empty name fails fast inside the runtime (no DB, no
  // bridge) — perfect for proving "registered + dispatched" offline.
  const deferredUse: AgentMessageContentBlock = {
    type: 'tool_use', id: 'tu_deferred', name: 'skills.view', input: {},
  };
  const { provider, advertisedPerTurn } = capturingProvider([
    { stop_reason: 'tool_use', content: [searchUse] },
    { stop_reason: 'tool_use', content: [deferredUse] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ]);
  const result = await core.runAgent({
    initialMessages: [{ role: 'user', content: 'view the deploy skill' }],
    tools: run.tools,
    provider,
    resolveAdditionalTools: run.resolveAdditionalTools,
    maxIterations: 5,
  });
  assert(result.text === 'done', 'case4: run completed cleanly');
  assert(!advertisedPerTurn[0].includes('skills.view'), 'case4: deferred tool NOT advertised on turn 1');
  assert(advertisedPerTurn[1].includes('skills.view'), 'case4: deferred tool advertised on turn 2 after tools.search');

  const blocks2 = result.messages[2].content as AgentMessageContentBlock[];
  const searchResult = blocks2.find((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_search');
  assert(
    !!searchResult && searchResult.type === 'tool_result' && searchResult.content.includes('now available for direct calling'),
    'case4: tools.search result tells the model the matches are callable',
  );
  const blocks4 = result.messages[4].content as AgentMessageContentBlock[];
  const deferredResult = blocks4.find((b) => b.type === 'tool_result' && b.tool_use_id === 'tu_deferred');
  assert(
    !!deferredResult && deferredResult.type === 'tool_result' && !deferredResult.content.includes('not registered'),
    'case4: unlocked deferred tool dispatched through the real runtime handler',
  );
  assert(
    !!deferredResult && deferredResult.type === 'tool_result' && deferredResult.content.includes('is required'),
    'case4: unlocked tool produced its real validation result',
  );
  assert(
    advertisedPerTurn[0].every((name) => advertisedPerTurn[1].includes(name)) &&
      advertisedPerTurn[1].every((name) => advertisedPerTurn[2].includes(name)),
    'case5: resolver only adds — advertised set never shrinks across turns',
  );

  // ── Case 6 — always-pinned guarantees + deferred-only invisibility ────────
  for (const name of ['tools.search', 'context.search', 'approvals.list', 'approvals.request', 'approvals.resolve'] as const) {
    assert(runtime.getOpenSwanToolDisclosure(name) === 'pinned', `case6: ${name} is always pinned`);
  }
  assert(
    runtime.getOpenSwanToolDisclosure('desktop.photoshop_export_proof') === 'deferred',
    'case6: desktop.photoshop_export_proof is deferred',
  );
  assert(
    !progressiveNames.includes('desktop.photoshop_export_proof'),
    'case6: deferred-only tool absent from the initial progressive set',
  );
  assert(
    runtime.getOpenSwanToolDisclosure('browser.fill_credential_field') === 'deferred',
    'case6: browser.fill_credential_field is searchable/deferred, not pinned',
  );
  assert(
    !progressiveNames.includes('browser.fill_credential_field'),
    'case6: browser.fill_credential_field absent from the initial progressive set',
  );
  assert(
    fullMain.includes('browser.fill_credential_field'),
    'case6: browser.fill_credential_field still present on the default full path',
  );
  assert(
    fullMain.includes('desktop.photoshop_export_proof'),
    'case6: same tool still present on the default full path',
  );

  // ── Case 7 — token evidence: full catalog vs pinned core, per surface ─────
  console.log('\nAdvertised tool-schema payload (chars ≈ 4 chars/token):');
  console.log('surface     | full tools | full chars (≈tokens) | pinned tools | pinned chars (≈tokens) | reduction');
  for (const surface of SURFACES) {
    const full = runtime.listOpenSwanAnthropicToolsForSurface(surface);
    const pinned = runtime.listPinnedOpenSwanToolsForSurface(surface).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    }));
    const fullChars = JSON.stringify(full).length;
    const pinnedChars = JSON.stringify(pinned).length;
    const reduction = (100 * (1 - pinnedChars / fullChars)).toFixed(1);
    console.log(
      `${surface.padEnd(11)} | ${String(full.length).padStart(10)} | ${String(fullChars).padStart(11)} (≈${Math.round(fullChars / 4)}) | ${String(pinned.length).padStart(12)} | ${String(pinnedChars).padStart(13)} (≈${Math.round(pinnedChars / 4)}) | ${reduction}%`,
    );
    assert(
      pinnedChars < fullChars * 0.5,
      `case7: ${surface} — pinned payload is under half the full catalog payload`,
    );
  }
  console.log('');

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll progressive-tool-disclosure cases passed.');
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
