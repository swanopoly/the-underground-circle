/**
 * Closed-world mutation-authority regression smoke.
 *
 * Run:
 *   npx tsx scripts/openswan-mutation-authority-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://mutation-authority.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'mutation-authority-anon-key';

const NATIVE_STUBS = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const SURFACES = ['main_chat', 'room_chat', 'office', 'task_run'] as const;
const AUTHORITIES = new Set([
  'read_only',
  'action_ledger',
  'provider_idempotency',
  'proposal_only',
  'unsupported',
]);
const PLUGIN_IDS = [
  'research-analyst',
  'content-studio',
  'build-sprint',
  'design-sprint',
  'growth-operator',
  'support-triage',
  'community-manager',
  'executive-briefing',
];

async function main(): Promise<void> {
  const imported = await import('../src/lib/openswanToolRuntime');
  // `tsx` may expose the CommonJS-transformed module under default when this
  // smoke is launched in a CommonJS package; normalize both forms.
  const runtime = ((imported as { default?: typeof imported }).default || imported);
  const definitions = Array.from(new Map(
    SURFACES
      .flatMap((surface) => runtime.listOpenSwanToolsForSurface(surface))
      .map((definition) => [definition.name, definition]),
  ).values());

  assert.equal(definitions.length, 219, 'all current catalog definitions are covered');

  const counts = {
    read_only: 0,
    action_ledger: 0,
    provider_idempotency: 0,
    proposal_only: 0,
    unsupported: 0,
  };

  for (const definition of definitions) {
    const tool = definition.name as Parameters<typeof runtime.getOpenSwanToolPolicy>[0];
    const policy = runtime.getOpenSwanToolPolicy(tool);
    assert(
      AUTHORITIES.has(policy.mutationAuthority),
      `${definition.name} has a closed-world mutation authority`,
    );
    counts[policy.mutationAuthority] += 1;

    if (policy.mutatesState) {
      assert(
        runtime.hasExplicitOpenSwanMutationAuthorityClassification(tool),
        `${definition.name} is explicitly present in the mutation manifest`,
      );
      assert.notEqual(
        policy.mutationAuthority,
        'read_only',
        `${definition.name} cannot infer read-only authority for a mutation`,
      );
    } else {
      assert.equal(
        policy.mutationAuthority,
        'read_only',
        `${definition.name} non-mutation is classified read-only`,
      );
    }

    for (const pluginId of PLUGIN_IDS) {
      const pluginPolicy = runtime.getOpenSwanToolPolicy(tool, [pluginId]);
      assert.equal(
        pluginPolicy.mutationAuthority,
        policy.mutationAuthority,
        `${pluginId} cannot widen ${definition.name} mutation authority`,
      );
      if (policy.approvalMode === 'ask') {
        assert.equal(
          pluginPolicy.approvalMode,
          'ask',
          `${pluginId} cannot lower ${definition.name} mandatory approval`,
        );
      }
    }
  }

  assert.deepEqual(
    counts,
    {
      read_only: 92,
      action_ledger: 21,
      provider_idempotency: 0,
      proposal_only: 3,
      unsupported: 103,
    },
    'catalog authority totals are explicit and reviewable',
  );

  const representative = {
    // Browser
    'browser.dom_snapshot': 'read_only',
    'browser.fill_field': 'action_ledger',
    'browser.open_url': 'action_ledger',
    // Desktop and local files
    'desktop.window_state': 'read_only',
    'desktop.open_path': 'action_ledger',
    'desktop.launch_app': 'unsupported',
    'desktop.file_read': 'read_only',
    'desktop.file_write_text': 'unsupported',
    // Provider/edge paths
    'custom_api.read': 'read_only',
    'custom_api.request': 'action_ledger',
    'messaging.notify': 'action_ledger',
    'gmail.write': 'unsupported',
    // Review-only paths
    'approvals.request': 'proposal_only',
    'code.generate': 'proposal_only',
    'skills.manage': 'proposal_only',
  } as const;

  for (const [name, authority] of Object.entries(representative)) {
    assert.equal(
      runtime.getOpenSwanToolPolicy(name as Parameters<typeof runtime.getOpenSwanToolPolicy>[0])
        .mutationAuthority,
      authority,
      `${name} has the reviewed authority classification`,
    );
  }

  const unknownTool = 'future.unclassified_mutation';
  const unknownPolicy = runtime.getOpenSwanToolPolicy(
    unknownTool as Parameters<typeof runtime.getOpenSwanToolPolicy>[0],
  );
  assert.equal(unknownPolicy.mutationAuthority, 'unsupported');
  assert.equal(
    runtime.hasExplicitOpenSwanMutationAuthorityClassification(
      unknownTool as Parameters<typeof runtime.getOpenSwanToolPolicy>[0],
    ),
    false,
  );

  const context = {
    circleId: '33333333-3333-4333-8333-333333333333',
    userId: '22222222-2222-4222-8222-222222222222',
  };
  const unknownResult = await (runtime.executeOpenSwanRuntimeTool as any)(
    unknownTool,
    {},
    context,
  );
  assert.equal(unknownResult.ok, false);
  assert.match(unknownResult.resultsText, /stopped before approval/i);
  assert.match(unknownResult.resultsText, /no supported mutation authority/i);

  const unsupportedKnownResult = await (runtime.executeOpenSwanRuntimeTool as any)(
    'desktop.launch_app',
    { appName: 'Adobe Photoshop' },
    context,
  );
  assert.equal(unsupportedKnownResult.ok, false);
  assert.match(unsupportedKnownResult.resultsText, /stopped before approval/i);

  const proposalResult = await (runtime.executeOpenSwanRuntimeTool as any)(
    'code.generate',
    { note: 'Draft only' },
    context,
  );
  assert.equal(proposalResult.ok, true, 'proposal-only work remains dispatchable');
  assert.equal(proposalResult.planned, true, 'proposal-only code output cannot mutate files');

  for (const path of [
    'supabase/functions/custom-api-proxy/index.ts',
    'supabase/functions/messaging-notify/index.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /claim_agent_action_call/, `${path} claims durable action authority`);
    assert.match(source, /start_agent_action_call/, `${path} seals durable dispatch before I/O`);
    assert.match(source, /finish_agent_action_call/, `${path} finalizes durable action authority`);
  }

  const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  assert.match(
    runtimeSource,
    /Plugins have no mutation-[\s\S]*authority override/,
    'runtime documents that plugin activation cannot override mutation authority',
  );
  assert.match(
    runtimeSource,
    /initialDispatchPolicy\.mutationAuthority === 'unsupported'/,
    'unsupported authority is enforced at the typed pre-approval chokepoint',
  );

  console.log(
    `OpenSwan mutation authority smoke passed (${definitions.length} tools: `
      + `${counts.read_only} read-only, ${counts.action_ledger} action-ledger, `
      + `${counts.proposal_only} proposal-only, ${counts.unsupported} unsupported).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
