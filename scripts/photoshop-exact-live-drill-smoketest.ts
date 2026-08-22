/**
 * Offline smoke for the Chrome-free Photoshop exact live drill.
 *
 * This test never opens a socket or an app. Mutation-bearing scenarios run in
 * separate child processes so the production process-lifetime create latch is
 * exercised without adding a reset seam to the live contract.
 *
 * Run: npx tsx scripts/photoshop-exact-live-drill-smoketest.ts
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST,
  PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT,
  PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV,
  PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS,
  PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_DELAY_MS,
  PHOTOSHOP_EXACT_DRILL_MAX_DOCUMENT_NAME_LENGTH,
  buildPhotoshopExactDrillManifest,
  isPhotoshopExactDrillIdentity,
  isValidPhotoshopExactDrillPairingSecret,
  runPhotoshopExactDrill,
  validatedPhotoshopExactDrillRawDocumentName,
  validatePhotoshopExactDrillCall,
  validatePhotoshopExactDrillTrace,
  type PhotoshopExactDrillCall,
  type PhotoshopExactDrillTraceEntry,
  type PhotoshopExactDrillTransport,
} from './photoshop-exact-drill-core';

type ChildScenario =
  | 'happy'
  | 'ambiguous_create'
  | 'mismatched_final_name'
  | 'stale_then_exact'
  | 'angle_name_collision'
  | 'whitespace_name_collision'
  | 'unsafe_created_name'
  | 'unsafe_final_name'
  | 'missing_created_name'
  | 'false_photoshop_identity'
  | 'process_latch';

type FakeTransport = PhotoshopExactDrillTransport & {
  calls: PhotoshopExactDrillCall[];
  createCalls: number;
  disposeCalls: number;
};

let passed = 0;
const failures: string[] = [];

function assert(condition: unknown, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`pass: ${label}`);
  } else {
    failures.push(label);
    console.error(`FAIL: ${label}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'null' : serialized;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function makeFakeTransport(scenario: ChildScenario): FakeTransport {
  let created = false;
  let postCreateStatusCalls = 0;
  const transport: FakeTransport = {
    calls: [],
    createCalls: 0,
    disposeCalls: 0,
    async request(call): Promise<unknown> {
      transport.calls.push({
        ...call,
        ...(call.body ? { body: { ...call.body } } : {}),
      });
      switch (call.tool) {
        case 'bridge.health':
          return {
            ok: true,
            supported: true,
            tools: [
              'launch',
              'focus',
              'wait_for_app',
              'window_state',
              'photoshop_document_status',
              'photoshop_create_document',
            ],
          };
        case 'bridge.pair':
          return { ok: true };
        case 'desktop.photoshop_document_status':
          if (created) postCreateStatusCalls += 1;
          return created
            ? {
                ok: true,
                appRunning: true,
                activeDocumentName: scenario === 'mismatched_final_name'
                  || (scenario === 'stale_then_exact' && postCreateStatusCalls === 1)
                    ? 'Untitled-Different'
                    : scenario === 'angle_name_collision'
                      ? 'A>B'
                      : scenario === 'whitespace_name_collision'
                        ? 'A B'
                        : scenario === 'unsafe_final_name'
                          ? 'Unsafe\u202eName'
                          : 'Untitled-Drill',
                widthPx: 600,
                heightPx: 600,
              }
            : { ok: true, appRunning: true, activeDocumentName: '' };
        case 'desktop.window_state':
          return {
            ok: true,
            frontmostApp: scenario === 'false_photoshop_identity'
              ? 'Not Photoshop'
              : 'Adobe Photoshop 2025',
          };
        case 'desktop.focus_app':
          return {
            ok: true,
            requestedAppName: 'Photoshop',
            resolvedAppName: scenario === 'false_photoshop_identity'
              ? 'Not Photoshop'
              : 'Adobe Photoshop 2025',
          };
        case 'desktop.launch_app':
          return { ok: true, requestedAppName: 'Photoshop', resolvedAppName: 'Adobe Photoshop 2025' };
        case 'desktop.wait_for_app':
          return { ok: true, appRunning: true, appName: 'Adobe Photoshop 2025' };
        case 'desktop.photoshop_create_document':
          transport.createCalls += 1;
          created = true;
          if (scenario === 'ambiguous_create') throw new Error('simulated_socket_drop');
          return {
            ok: true,
            created: true,
            ...(scenario === 'missing_created_name'
              ? {}
              : {
                  documentName: scenario === 'angle_name_collision'
                    ? 'A<B'
                    : scenario === 'whitespace_name_collision'
                      ? 'A  B'
                      : scenario === 'unsafe_created_name'
                        ? 'Unsafe\u202eName'
                        : 'Untitled-Drill',
                }),
            widthPx: 600,
            heightPx: 600,
          };
      }
    },
    dispose(): void {
      transport.disposeCalls += 1;
    },
  };
  return transport;
}

async function runLiveWithFake(scenario: ChildScenario, transport = makeFakeTransport(scenario)) {
  const manifest = buildPhotoshopExactDrillManifest();
  const result = await runPhotoshopExactDrill({
    argv: ['--live'],
    env: { [PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV]: manifest.fingerprint },
    transportFactory: () => transport,
  });
  return { result, transport };
}

async function runChildScenario(scenario: ChildScenario): Promise<Record<string, unknown>> {
  const firstTransport = makeFakeTransport(scenario);
  const first = await runLiveWithFake(scenario, firstTransport);
  if (scenario !== 'process_latch') {
    const createIndex = firstTransport.calls.findIndex(
      (call) => call.tool === 'desktop.photoshop_create_document',
    );
    return {
      status: first.result.receipt.status,
      exitCode: first.result.exitCode,
      createCalls: firstTransport.createCalls,
      disposeCalls: firstTransport.disposeCalls,
      browserInvocationCount: first.result.receipt.browserInvocationCount,
      proof: first.result.receipt.proof || null,
      reason: first.result.receipt.reason,
      trace: first.result.receipt.trace,
      postCreateTools: createIndex >= 0
        ? firstTransport.calls.slice(createIndex + 1).map((call) => call.tool)
        : [],
    };
  }
  const secondTransport = makeFakeTransport('happy');
  const second = await runLiveWithFake('happy', secondTransport);
  return {
    firstStatus: first.result.receipt.status,
    firstCreateCalls: firstTransport.createCalls,
    firstDisposeCalls: firstTransport.disposeCalls,
    secondStatus: second.result.receipt.status,
    secondExitCode: second.result.exitCode,
    secondCreateCalls: secondTransport.createCalls,
    secondDisposeCalls: secondTransport.disposeCalls,
    secondReason: second.result.receipt.reason,
  };
}

function runIsolatedScenario(scenario: ChildScenario): Record<string, any> {
  const script = fileURLToPath(import.meta.url);
  const inheritedTsxLoaderArgs: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const arg = process.execArgv[index];
    if ((arg === '--require' || arg === '--import') && process.execArgv[index + 1]?.includes('/tsx/')) {
      inheritedTsxLoaderArgs.push(arg, process.execArgv[index + 1]);
      index += 1;
    } else if ((arg.startsWith('--require=') || arg.startsWith('--import=')) && arg.includes('/tsx/')) {
      inheritedTsxLoaderArgs.push(arg);
    }
  }
  if (inheritedTsxLoaderArgs.length === 0) throw new Error('tsx_loader_not_inherited');
  const child = spawnSync(process.execPath, [...inheritedTsxLoaderArgs, script, `--child=${scenario}`], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 30_000,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`child_${scenario}_failed:${child.error?.message || child.stderr || child.status}`);
  }
  const marker = 'PHOTOSHOP_EXACT_CHILD_RESULT=';
  const line = child.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(marker));
  if (!line) throw new Error(`child_${scenario}_missing_result`);
  return JSON.parse(line.slice(marker.length)) as Record<string, any>;
}

async function main(): Promise<void> {
  const childArg = process.argv.find((arg) => arg.startsWith('--child='));
  if (childArg) {
    const scenario = childArg.slice('--child='.length) as ChildScenario;
    const allowed: ChildScenario[] = [
      'happy',
      'ambiguous_create',
      'mismatched_final_name',
      'stale_then_exact',
      'angle_name_collision',
      'whitespace_name_collision',
      'unsafe_created_name',
      'unsafe_final_name',
      'missing_created_name',
      'false_photoshop_identity',
      'process_latch',
    ];
    if (!allowed.includes(scenario)) process.exit(2);
    const result = await runChildScenario(scenario);
    process.stdout.write(`PHOTOSHOP_EXACT_CHILD_RESULT=${JSON.stringify(result)}\n`);
    return;
  }

  const manifest = buildPhotoshopExactDrillManifest();
  const { fingerprint: actualFingerprint, ...unsignedManifest } = manifest;
  assert(/^sha256:[a-f0-9]{64}$/.test(actualFingerprint), 'manifest has a SHA-256 fingerprint');
  assert(fingerprint(unsignedManifest) === actualFingerprint, 'fingerprint covers the complete manifest');
  assert(manifest.programId === 'photoshop_new_document', 'manifest pins the exact compiler family');
  assert(manifest.authorizationMode === 'direct_user_request', 'manifest preserves direct-request authority');
  assert(
    manifest.steps.map((step) => step.tool).join('|') === [
      'desktop.photoshop_document_status',
      'desktop.launch_app',
      'desktop.photoshop_document_status',
      'desktop.photoshop_create_document',
      'desktop.photoshop_document_status',
    ].join('|'),
    'manifest preserves the exact five-step compiler program',
  );
  const createStep = manifest.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  assert(createStep?.args.widthPx === 600 && createStep?.args.heightPx === 600, 'compiler create is exactly 600x600');

  const contract = manifest.executionContract;
  assert(
    contract.bridge.host === PHOTOSHOP_EXACT_DRILL_BRIDGE_HOST
      && contract.bridge.host === '127.0.0.1'
      && contract.bridge.port === PHOTOSHOP_EXACT_DRILL_BRIDGE_PORT
      && contract.bridge.port === 7778,
    'fingerprinted bridge target is fixed to 127.0.0.1:7778',
  );
  assert(contract.callAllowlist.length === 8, 'fingerprinted contract contains exactly eight typed calls');
  const createCall = contract.callAllowlist.find((call) => call.tool === 'desktop.photoshop_create_document');
  assert(
    createCall?.method === 'POST'
      && createCall.path === '/desktop/photoshop_create_document'
      && stableJson(createCall.body) === stableJson({ appName: 'Photoshop', widthPx: 600, heightPx: 600 }),
    'fingerprinted allowlist binds the create endpoint and exact body',
  );
  assert(
    contract.safety.createAtMostOnceScope === 'node_process_lifetime'
      && contract.safety.replayCreateAfterAmbiguityAllowed === false
      && contract.safety.browserInvocationAllowed === false
      && contract.safety.originHeaderAllowed === false
      && contract.safety.documentNameComparison === 'bounded_raw_exact'
      && contract.safety.documentNameNormalizationAllowed === false
      && contract.safety.unsafeDocumentNamesAllowed === false
      && contract.safety.receiptDocumentNameRendering === 'escape_after_raw_validation',
    'fingerprinted contract binds the process latch and Chrome-free safety rules',
  );
  assert(
    contract.pairingExchange.tokenPattern === '^[a-f0-9]{48}$'
      && contract.pairingExchange.endpoint === '/desktop/pair',
    'fingerprinted contract binds the strict two-leg pairing shape',
  );
  assert(
    contract.finalStatusProofRetry.tool === 'desktop.photoshop_document_status'
      && contract.finalStatusProofRetry.maxAttempts === PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_ATTEMPTS
      && contract.finalStatusProofRetry.maxAttempts === 3
      && contract.finalStatusProofRetry.delayMs === PHOTOSHOP_EXACT_DRILL_FINAL_PROOF_DELAY_MS
      && contract.finalStatusProofRetry.delayMs <= 400
      && contract.finalStatusProofRetry.retryClass === 'read_only_status_only'
      && contract.finalStatusProofRetry.requiredSuffixOrder === 'one_to_three_status_reads_then_foreground_proof'
      && stableJson(contract.finalStatusProofRetry.allowedForegroundSuffixes) === stableJson([
        ['desktop.window_state'],
        ['desktop.window_state', 'desktop.focus_app', 'desktop.window_state'],
      ])
      && stableJson(contract.finalStatusProofRetry.forbiddenToolsAfterCreate) === stableJson([
        'desktop.launch_app',
        'desktop.wait_for_app',
        'desktop.photoshop_create_document',
        'browser_surface',
      ])
      && contract.finalStatusProofRetry.createRetryAllowed === false
      && contract.finalStatusProofRetry.foregroundProofRequired === true,
    'fingerprinted contract binds three short read-only status retries and forbids create retry',
  );
  const hostMutated = {
    ...unsignedManifest,
    executionContract: {
      ...unsignedManifest.executionContract,
      bridge: { ...unsignedManifest.executionContract.bridge, host: 'localhost' },
    },
  };
  assert(fingerprint(hostMutated) !== actualFingerprint, 'changing the bridge host invalidates live confirmation');

  assert(
    validatedPhotoshopExactDrillRawDocumentName('A<B') === 'A<B'
      && validatedPhotoshopExactDrillRawDocumentName('A>B') === 'A>B'
      && validatedPhotoshopExactDrillRawDocumentName(' A  B ') === ' A  B ',
    'raw document-name validation preserves angle and whitespace distinctions exactly',
  );
  for (const unsafe of [
    'Unsafe\nName',
    'Unsafe\u202eName',
    'Unsafe\u2066Name',
    '   ',
    'x'.repeat(PHOTOSHOP_EXACT_DRILL_MAX_DOCUMENT_NAME_LENGTH + 1),
    `broken-${String.fromCharCode(0xd800)}`,
  ]) {
    assert(
      validatedPhotoshopExactDrillRawDocumentName(unsafe) === null,
      `unsafe or unbounded raw document name is rejected (${unsafe.length} code units)`,
    );
  }

  let factoryCalls = 0;
  const dry = await runPhotoshopExactDrill({
    argv: [],
    env: {},
    transportFactory: () => {
      factoryCalls += 1;
      return makeFakeTransport('happy');
    },
  });
  assert(dry.receipt.status === 'dry_run' && dry.receipt.trace.length === 0, 'default mode is zero-call dry run');
  assert(factoryCalls === 0, 'dry run never constructs the bridge transport');

  const dryWithConfirmation = await runPhotoshopExactDrill({
    argv: [],
    env: { [PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV]: manifest.fingerprint },
    transportFactory: () => {
      factoryCalls += 1;
      return makeFakeTransport('happy');
    },
  });
  assert(dryWithConfirmation.receipt.status === 'dry_run' && factoryCalls === 0, 'fingerprint alone cannot enable live mode');

  for (const [label, argv, confirmation] of [
    ['missing confirmation', ['--live'], undefined],
    ['mismatched confirmation', ['--live'], 'sha256:not-the-contract'],
    ['conflicting flags', ['--live', '--dry-run'], manifest.fingerprint],
    ['unknown argument', ['--live', '--surprise'], manifest.fingerprint],
  ] as const) {
    const refused = await runPhotoshopExactDrill({
      argv: [...argv],
      env: { [PHOTOSHOP_EXACT_DRILL_CONFIRM_ENV]: confirmation },
      transportFactory: () => {
        factoryCalls += 1;
        return makeFakeTransport('happy');
      },
    });
    assert(refused.exitCode === 2 && refused.receipt.status === 'gate_refused', `live gate refuses ${label}`);
  }
  assert(factoryCalls === 0, 'all refused modes remain zero transport calls');

  for (const accepted of [
    'Photoshop',
    'Adobe Photoshop',
    'Adobe Photoshop 2025',
    'Photoshop 2026',
    'Adobe Photoshop 2025.app',
    'Adobe Photoshop (Beta)',
  ]) {
    assert(isPhotoshopExactDrillIdentity(accepted), `exact Photoshop identity accepts ${accepted}`);
  }
  for (const rejected of [
    'Not Photoshop',
    'Photoshop Helper',
    'Fake Adobe Photoshop 2025',
    'Photoshop and Chrome',
    'Google Chrome',
    '',
  ]) {
    assert(!isPhotoshopExactDrillIdentity(rejected), `exact Photoshop identity rejects ${rejected || '(empty)'}`);
  }

  assert(isValidPhotoshopExactDrillPairingSecret('a'.repeat(48)), '48 lowercase hex pairing secret accepted');
  assert(isValidPhotoshopExactDrillPairingSecret('ABCDEF'.repeat(8)), '48 uppercase hex pairing secret accepted');
  for (const rejected of ['a'.repeat(47), 'a'.repeat(49), `${'a'.repeat(47)}g`, `x${'a'.repeat(48)}`, '']) {
    assert(!isValidPhotoshopExactDrillPairingSecret(rejected), `malformed pairing secret rejected (${rejected.length} chars)`);
  }

  assert(
    validatePhotoshopExactDrillCall({
      tool: 'desktop.launch_app',
      method: 'POST',
      path: '/desktop/launch',
      body: { appName: 'Google Chrome' },
    }) === 'body_mismatch',
    'call validator rejects a browser target body',
  );
  assert(
    validatePhotoshopExactDrillCall({
      tool: 'desktop.launch_app',
      method: 'POST',
      path: '/desktop/browser/open',
      body: { appName: 'Photoshop' },
    }) === 'path_mismatch',
    'call validator rejects a browser endpoint',
  );

  const happy = runIsolatedScenario('happy');
  assert(happy.status === 'completed' && happy.exitCode === 0, 'fake live drill completes only with terminal proof');
  assert(
    happy.proof?.activeDocumentName === 'Untitled-Drill'
      && happy.proof?.widthPx === 600
      && happy.proof?.heightPx === 600,
    'fake live proof reports the exact created 600x600 document',
  );
  assert(happy.createCalls === 1 && happy.disposeCalls === 1, 'happy path creates once and clears transport state');
  assert(happy.browserInvocationCount === 0, 'happy path invokes no browser surface');
  assert(
    validatePhotoshopExactDrillTrace(happy.trace as PhotoshopExactDrillTraceEntry[]).length === 0,
    'happy receipt satisfies the fingerprinted post-create trace grammar',
  );

  const reindexTrace = (trace: PhotoshopExactDrillTraceEntry[]): PhotoshopExactDrillTraceEntry[] => (
    trace.map((entry, index) => ({ ...entry, index: index + 1 }))
  );
  const happyTrace = happy.trace as PhotoshopExactDrillTraceEntry[];
  const happyCreateIndex = happyTrace.findIndex((entry) => entry.tool === 'desktop.photoshop_create_document');
  const statusTemplate = happyTrace[happyCreateIndex + 1];
  const launchAfterCreate: PhotoshopExactDrillTraceEntry = {
    index: 0,
    tool: 'desktop.launch_app',
    method: 'POST',
    path: '/desktop/launch',
    stage: 'succeeded',
    mutation: false,
  };

  const fourStatusTrace = reindexTrace([
    ...happyTrace.slice(0, happyCreateIndex + 2),
    { ...statusTemplate },
    { ...statusTemplate },
    { ...statusTemplate },
    ...happyTrace.slice(happyCreateIndex + 2),
  ]);
  assert(
    validatePhotoshopExactDrillTrace(fourStatusTrace).includes('post_create_status_reads_exceeded'),
    'adversarial trace rejects a fourth post-create status read',
  );

  const launchTrace = reindexTrace([
    ...happyTrace.slice(0, happyCreateIndex + 2),
    launchAfterCreate,
    ...happyTrace.slice(happyCreateIndex + 2),
  ]);
  assert(
    validatePhotoshopExactDrillTrace(launchTrace).includes('post_create_forbidden_tool'),
    'adversarial trace rejects launch after create',
  );

  const lateStatusTrace = reindexTrace([...happyTrace, { ...statusTemplate }]);
  const lateStatusIssues = validatePhotoshopExactDrillTrace(lateStatusTrace);
  assert(
    lateStatusIssues.includes('post_create_status_reads_not_consecutive')
      && lateStatusIssues.includes('post_create_suffix_invalid'),
    'adversarial trace rejects status observation after foreground proof begins',
  );

  const forgedMutationTrace = reindexTrace(
    happyTrace.map((entry, index) => (
      index === happyCreateIndex + 1 ? { ...entry, mutation: true } : { ...entry }
    )),
  );
  assert(
    validatePhotoshopExactDrillTrace(forgedMutationTrace).includes('post_create_status_not_read_only'),
    'adversarial trace rejects a mutation-class status retry',
  );

  const browserTrace = reindexTrace([
    ...happyTrace.slice(0, happyCreateIndex + 2),
    {
      index: 0,
      tool: 'browser.open_url',
      method: 'POST',
      path: '/browser/open_url',
      stage: 'succeeded',
      mutation: false,
    } as unknown as PhotoshopExactDrillTraceEntry,
    ...happyTrace.slice(happyCreateIndex + 2),
  ]);
  const browserTraceIssues = validatePhotoshopExactDrillTrace(browserTrace);
  assert(
    browserTraceIssues.includes('browser_invocation')
      && browserTraceIssues.includes('post_create_forbidden_tool'),
    'adversarial trace rejects every browser surface after create',
  );

  const ambiguous = runIsolatedScenario('ambiguous_create');
  assert(
    ambiguous.status === 'mutation_outcome_unknown' && ambiguous.exitCode === 5 && ambiguous.createCalls === 1,
    'ambiguous create exits unknown and is never replayed',
  );
  assert(ambiguous.disposeCalls === 1, 'ambiguous terminal path clears transport state');

  const mismatch = runIsolatedScenario('mismatched_final_name');
  assert(
    mismatch.status === 'verification_incomplete'
      && mismatch.exitCode === 4
      && mismatch.createCalls === 1
      && (mismatch.postCreateTools as string[]).filter(
        (tool) => tool === 'desktop.photoshop_document_status',
      ).length === 3
      && !(mismatch.postCreateTools as string[]).some((tool) => (
        tool === 'desktop.launch_app'
        || tool === 'desktop.wait_for_app'
        || tool === 'desktop.photoshop_create_document'
        || /browser/i.test(tool)
      )),
    'exhausted mismatch uses exactly three status reads and no launch, wait, create, or browser after create',
  );

  const staleThenExact = runIsolatedScenario('stale_then_exact');
  assert(
    staleThenExact.status === 'completed'
      && staleThenExact.exitCode === 0
      && staleThenExact.createCalls === 1
      && stableJson(staleThenExact.postCreateTools) === stableJson([
        'desktop.photoshop_document_status',
        'desktop.photoshop_document_status',
        'desktop.window_state',
      ]),
    'one stale post-create status settles on a fresh read-only retry without replaying create',
  );

  const angleCollision = runIsolatedScenario('angle_name_collision');
  assert(
    angleCollision.status === 'verification_incomplete'
      && angleCollision.exitCode === 4
      && angleCollision.createCalls === 1
      && !angleCollision.proof,
    'raw A<B create name cannot match raw A>B final name',
  );

  const whitespaceCollision = runIsolatedScenario('whitespace_name_collision');
  assert(
    whitespaceCollision.status === 'verification_incomplete'
      && whitespaceCollision.exitCode === 4
      && whitespaceCollision.createCalls === 1
      && !whitespaceCollision.proof,
    'raw repeated-whitespace distinctions cannot collapse into proof equality',
  );

  const unsafeCreatedName = runIsolatedScenario('unsafe_created_name');
  const unsafeFinalName = runIsolatedScenario('unsafe_final_name');
  assert(
    unsafeCreatedName.status === 'mutation_outcome_unknown'
      && unsafeCreatedName.exitCode === 5
      && unsafeCreatedName.createCalls === 1
      && !unsafeCreatedName.proof
      && unsafeFinalName.status === 'verification_incomplete'
      && unsafeFinalName.exitCode === 4
      && unsafeFinalName.createCalls === 1
      && !unsafeFinalName.proof,
    'unsafe created or final names can never prove completion',
  );

  const missingName = runIsolatedScenario('missing_created_name');
  assert(
    missingName.status === 'mutation_outcome_unknown' && missingName.exitCode === 5 && missingName.createCalls === 1,
    'missing create acknowledgement document name is outcome-unknown',
  );

  const falseIdentity = runIsolatedScenario('false_photoshop_identity');
  assert(
    falseIdentity.status === 'blocked_before_mutation'
      && falseIdentity.exitCode === 3
      && falseIdentity.createCalls === 0,
    'substring-only fake Photoshop identity blocks before mutation',
  );

  const processLatch = runIsolatedScenario('process_latch');
  assert(
    processLatch.firstStatus === 'completed'
      && processLatch.firstCreateCalls === 1
      && processLatch.secondStatus === 'blocked_before_mutation'
      && processLatch.secondCreateCalls === 0,
    'process-lifetime latch refuses a second create across run invocations',
  );
  assert(
    processLatch.firstDisposeCalls === 1 && processLatch.secondDisposeCalls === 1,
    'process-latch paths both clear transport state',
  );

  const coreSource = readFileSync(new URL('./photoshop-exact-drill-core.ts', import.meta.url), 'utf8');
  const liveSource = readFileSync(new URL('./photoshop-exact-live-drill.ts', import.meta.url), 'utf8');
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const packageScripts = packageJson.scripts || {};
  const exactOccurrences = (value: string, needle: string): number => value.split(needle).length - 1;
  const dailyCheck = String(packageScripts['check:swanbot-chat:daily'] || '');
  const releaseCheck = String(packageScripts['check:swanbot-chat:release'] || '');
  const dailyPrecheck = String(packageScripts['precheck:swanbot-chat:daily'] || '');
  const releasePrecheck = String(packageScripts['precheck:swanbot-chat:release'] || '');
  assert(
    dailyCheck.length > 0 && !dailyCheck.includes('precheck:swanbot-chat:daily'),
    'package wiring: canonical daily check relies on npm lifecycle and does not invoke its precheck twice',
  );
  assert(
    releaseCheck.length > 0 && !releaseCheck.includes('precheck:swanbot-chat:release'),
    'package wiring: canonical release check relies on npm lifecycle and does not invoke its precheck twice',
  );
  assert(
    dailyPrecheck.length > 0 && releasePrecheck.length > 0,
    'package wiring: matching daily and release npm lifecycle prechecks are defined',
  );
  assert(
    exactOccurrences(dailyPrecheck, 'smoke:photoshop-exact-drill') === 1
      && exactOccurrences(releasePrecheck, 'smoke:photoshop-exact-drill') === 1,
    'package wiring: daily and release prechecks each contain the Photoshop drill smoke exactly once',
  );
  const smokeAllCommand = String(packageScripts['smoke:all'] || '');
  assert(
    smokeAllCommand.includes('scripts/run-smokes.mjs')
      ? typeof packageScripts['smoke:photoshop-exact-drill'] === 'string'
      : exactOccurrences(smokeAllCommand, 'smoke:photoshop-exact-drill') === 1,
    'package wiring: smoke:all discovers the Photoshop drill smoke exactly once',
  );
  assert(
    !/computerTaskRuntime|desktopBridge|react-native/.test(coreSource.replace(/\*[^]*?\*\//g, '')),
    'Node-only core imports no React Native or app-runtime module',
  );
  assert(
    !/["']Origin["']\s*:/.test(liveSource),
    'loopback request source supplies no Origin header',
  );
  assert(
    !/console\.(?:log|error|warn)[^\n]*(?:pairedToken|challenge|token)/i.test(liveSource),
    'pairing challenge and token never enter console output',
  );
  assert(
    liveSource.includes('dispose(): void') && liveSource.includes("pairedToken = '';"),
    'live transport drops its closure-held token during disposal',
  );
  assert(
    !/status\s*===?\s*401[^]*?(?:pair\(|request\(call)/.test(liveSource),
    'live transport has no 401 re-pair or replay branch',
  );

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('All Photoshop exact live-drill smoke cases passed without contacting the bridge.');
  }
}

main().catch((error) => {
  console.error(`FAIL: smoke initialization — ${error instanceof Error ? error.message : 'unknown_error'}`);
  process.exitCode = 1;
});
