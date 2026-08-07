/**
 * persisted-chat-metadata-smoketest - protects saved chat rows from
 * oversized bot metadata payloads. Browser/computer plans can be large;
 * persisted messages must stay below the DB content check while keeping
 * valid metadata JSON.
 *
 * Run: npm run smoke:persisted-chat-metadata
 */

import {
  BOT_META_MARKER,
  bestOfNMetadata,
  buildLegacyPersistedChatFallback,
  canReleasePendingAfterPersistedChatRoundTrip,
  formatPersistedChatBotMessage,
  readPersistedBestOfNRace,
  readPersistedChatBotMetadata,
  stripPersistedChatBotPrefix,
} from '../src/lib/persistedChatMetadata';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

const hugePlan = {
  planId: 'plan_1',
  task: 'Inspect a very large browser workflow '.repeat(80),
  backend: 'browserbase_stagehand',
  backendLabel: 'Browserbase Stagehand',
  backendDetails: 'Remote Browserbase session',
  requiresApproval: true,
  status: 'planned',
  actions: Array.from({ length: 60 }, (_, index) => ({
    id: `action_${index}`,
    type: 'click',
    target: `#selector-${index}-${'x'.repeat(500)}`,
    value: 'value '.repeat(120),
    description: `Detailed action ${index} ${'details '.repeat(160)}`,
    requiresApproval: index % 2 === 0,
  })),
};

const message = formatPersistedChatBotMessage(
  'OpenSwan',
  'Long assistant response. '.repeat(600),
  {
    browserPlans: [hugePlan as any],
    taskPlan: {
      kind: 'debug',
      profile: 'senior',
      summary: 'Verify the local desktop bridge and browser tab awareness path.',
      verification: [{
        id: 'desktop-tabs',
        label: 'Chrome tabs can be read',
        kind: 'tests',
        required: true,
        reason: 'The chat response needs the bridge result after refresh.',
      }],
      recommendedTools: [{
        tool: 'desktop.list_browser_tabs',
        reason: 'Read the user browser tab list from the local desktop bridge.',
        priority: 'high',
      }],
    },
    toolEvents: Array.from({ length: 20 }, (_, index) => ({
      tool: 'desktop.list_browser_tabs',
      status: index % 2 === 0 ? 'passed' : 'planned',
      summary: `Desktop bridge tab read ${index} ${'summary '.repeat(60)}`,
      command: `GET /desktop/browser_tabs?browsers=chrome&case=${index}`,
    })) as any,
    verificationResults: Array.from({ length: 12 }, (_, index) => ({
      check: {
        id: `check_${index}`,
        label: `Check ${index}`,
        kind: 'tests',
        required: true,
        reason: 'Ensure persisted OpenSwan verification details survive reload.',
      },
      status: 'passed',
      execution: {
        status: 'passed',
        mode: 'automatic',
        summary: `verified ${index}`,
      },
      ok: true,
      executed: true,
      summary: `Verification result ${index} ${'details '.repeat(80)}`,
      stdout: 'stdout '.repeat(120),
    })) as any,
    executionStream: Array.from({ length: 40 }, (_, index) => ({
      id: `step_${index}`,
      step: `step ${index}`,
      status: 'completed',
      body: 'large execution body '.repeat(200),
    })) as any,
    recoveryOptions: [{
      id: 'retry_with_fresh_evidence',
      label: 'Retry after fresh evidence',
      detail: 'Re-observe the browser DOM and screenshot before retrying the blocked action. '.repeat(12),
      actor: 'openswan',
      recommended: true,
      source: 'checkpoint_guard',
    }] as any,
  },
);

assert(message.length <= 9000, 'formatted bot message stays under DB content cap', `length ${message.length}`);
assert(message.trim().length > 0, 'formatted bot message is never empty');
assert(message.includes(BOT_META_MARKER) || message.includes('[truncated for saved chat]'), 'large metadata is compacted or safely dropped');
assert(stripPersistedChatBotPrefix(message).trim().length > 0, 'visible saved message content remains readable');

if (message.includes(BOT_META_MARKER)) {
  const metadata = readPersistedChatBotMetadata(message);
  assert(!!metadata, 'metadata JSON remains parseable after compaction');
  assert((metadata?.browserPlans?.[0]?.actions?.length || 0) <= 10, 'browser plan actions are compacted');
  assert((metadata?.recoveryOptions?.[0]?.detail?.length || 0) <= 360, 'recovery option details are compacted');
}

// Legacy production schemas still enforcing messages.content <= 1000 must
// never slice through the metadata JSON. Preserve only the bounded routing /
// terminal-status / lineage envelope and trim the visible body around it.
const legacyComputerMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  `Opened Photoshop and created Untitled-1 at 600 x 600px. ${'Verified by app-native status. '.repeat(80)}`,
  {
    localMessageId: 'local-message-legacy-computer-1',
    runId: 'run-legacy-computer-1',
    requestId: 'request-legacy-computer-1',
    requestAuthorId: 'member-legacy-owner-1',
    source: {
      actor: 'OpenSwan',
      surface: 'main_chat_computer_task',
      effectiveModel: 'computer-app-adapter',
    },
    computerTaskStatus: 'completed',
    outcomeSignal: { verdict: 'completed' },
    computerHandoff: {
      surface: 'desktop',
      runId: 'run-legacy-computer-1',
      outcomeStatus: 'completed',
      taskLabel: 'SECRET_RAW_TASK_MUST_NOT_ENTER_LEGACY_ENVELOPE',
      warningCount: 1,
      blockerCount: 0,
      warnings: ['SECRET_OBSERVATION_MUST_NOT_ENTER_LEGACY_ENVELOPE'],
      blockers: [],
      designAppTask: {
        appId: 'adobe_photoshop',
        appName: 'Adobe Photoshop',
        taskKind: 'raster_image_edit',
        documentSignals: ['/Users/example/private/source.psd'],
        operations: ['inspect_image_document'],
        requiredInventory: [],
        approvalGates: [],
        verificationSignals: [],
        recommendedTools: ['desktop.photoshop_document_status'],
      },
    } as any,
  },
);
assert(legacyComputerMessage.length > 1000, 'legacy regression starts with a row the old DB rejects');
const legacyComputerFallback = buildLegacyPersistedChatFallback(legacyComputerMessage, 1000);
assert(legacyComputerFallback.content.length <= 1000, 'legacy fallback fits the old 1000-char constraint');
assert(legacyComputerFallback.mode === 'metadata', 'legacy computer completion keeps a metadata envelope');
assert(legacyComputerFallback.metadataRoundTrips, 'legacy metadata envelope is validated before persistence');
assert(legacyComputerFallback.safeToPersist, 'validated legacy fallback is safe to submit');
const legacyComputerReloaded = readPersistedChatBotMetadata(legacyComputerFallback.content);
assert(!!legacyComputerReloaded, 'legacy fallback reload parses metadata JSON');
assert(legacyComputerReloaded?.source?.surface === 'main_chat_computer_task', 'legacy fallback preserves exact computer-task source surface');
assert(legacyComputerReloaded?.computerTaskStatus === 'completed', 'legacy fallback preserves successful computer status');
assert(legacyComputerReloaded?.runId === 'run-legacy-computer-1', 'legacy fallback preserves run lineage');
assert(legacyComputerReloaded?.requestId === 'request-legacy-computer-1', 'legacy fallback preserves request lineage');
assert(legacyComputerReloaded?.requestAuthorId === 'member-legacy-owner-1', 'legacy fallback preserves stable requester lineage');
assert(legacyComputerReloaded?.localMessageId === 'local-message-legacy-computer-1', 'legacy fallback preserves local message lineage');
assert(legacyComputerReloaded?.computerHandoff?.runId === 'run-legacy-computer-1', 'legacy fallback keeps available handoff run lineage');
assert(legacyComputerReloaded?.computerHandoff?.outcomeStatus === 'completed', 'legacy fallback keeps available handoff terminal status');
assert(!legacyComputerFallback.content.includes('SECRET_RAW_TASK'), 'legacy fallback omits raw task text');
assert(!legacyComputerFallback.content.includes('SECRET_OBSERVATION'), 'legacy fallback omits observation text');
assert(!legacyComputerFallback.content.includes('/Users/example/private'), 'legacy fallback omits local paths');

// A canonical Photoshop handoff is much larger than the synthetic envelope
// above. The normal 9,000-char formatter must retain a minimal structured tier
// first; otherwise the legacy retry receives marker-free text and cannot
// recover the run/source/completion lineage on its own.
const canonicalPhotoshopHandoff = buildChatComputerHandoffContext({
  task: 'Open Photoshop and start a new project 600 x 600',
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Photoshop new 600x600 document exact program',
  runId: 'canonical-photoshop-run',
  outcomeStatus: 'completed',
  preflightStatus: 'ready',
  groundingStatus: 'completed',
  groundingSummary: 'Final Photoshop document status verified 600 x 600.',
  approvalSummary: null,
  blockers: [],
}).metadata;
const canonicalPhotoshopMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Opened Photoshop and verified the requested document. '.repeat(120),
  {
    localMessageId: 'canonical-photoshop-completion',
    runId: 'canonical-photoshop-run',
    source: { actor: 'OpenSwan', surface: 'main_chat_computer_task' },
    computerTaskStatus: 'completed',
    computerHandoff: canonicalPhotoshopHandoff,
  },
);
assert(canonicalPhotoshopMessage.includes(BOT_META_MARKER), 'oversized canonical handoff retains a minimal metadata tier before DB retry');
const canonicalPhotoshopFallback = buildLegacyPersistedChatFallback(canonicalPhotoshopMessage, 1000);
const canonicalPhotoshopReloaded = readPersistedChatBotMetadata(canonicalPhotoshopFallback.content);
assert(canonicalPhotoshopFallback.metadataRoundTrips, 'canonical Photoshop completion round-trips through the legacy cap');
assert(canonicalPhotoshopReloaded?.source?.surface === 'main_chat_computer_task', 'canonical legacy reload keeps the Chat computer-task surface');
assert(canonicalPhotoshopReloaded?.computerTaskStatus === 'completed', 'canonical legacy reload remains a completed computer task');
assert(canonicalPhotoshopReloaded?.runId === 'canonical-photoshop-run', 'canonical legacy reload keeps run lineage');
assert(canonicalPhotoshopReloaded?.computerHandoff?.runId === 'canonical-photoshop-run', 'canonical legacy handoff keeps the same run lineage');
assert(!canonicalPhotoshopFallback.content.includes('Photoshop new 600x600 document exact program'), 'canonical legacy envelope omits the raw task label');

const manualVerificationHandoff = buildChatComputerHandoffContext({
  task: 'Open Photoshop and start a new project 600 x 600',
  entrypoint: 'agent_runtime',
  adapterId: 'app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Photoshop new 600x600 document exact program',
  outcomeStatus: 'partial',
  replayPolicy: 'manual_verify_only',
  mutationDispatched: true,
  verificationOnlyTools: ['desktop.photoshop_document_status'],
  verificationBridgeInstanceId: 'bridge-instance-aaaaaaaaaaaaaaaa',
  verificationTarget: {
    appName: 'Photoshop',
    expectedWidthPx: 600,
    expectedHeightPx: 600,
  },
  blockers: ['Create result could not be verified after dispatch.'],
}).metadata;
const manualVerificationMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  `The Photoshop create request was sent, but its result is uncertain. ${'Do not replay automatically. '.repeat(90)}`,
  {
    localMessageId: 'manual-verification-photoshop',
    source: { actor: 'OpenSwan', surface: 'main_chat_computer_task' },
    computerTaskStatus: 'partial',
    computerHandoff: manualVerificationHandoff,
  },
);
const manualVerificationNormalReloaded = readPersistedChatBotMetadata(manualVerificationMessage);
assert(
  manualVerificationNormalReloaded?.computerHandoff?.verificationBridgeInstanceId === 'bridge-instance-aaaaaaaaaaaaaaaa',
  'normal persisted handoff keeps the exact originating bridge process identity',
);
assert(
  manualVerificationNormalReloaded?.computerHandoff?.verificationTarget?.expectedWidthPx === 600
    && manualVerificationNormalReloaded?.computerHandoff?.verificationTarget?.expectedHeightPx === 600,
  'normal persisted handoff keeps the exact expected Photoshop dimensions',
);
const manualVerificationFallback = buildLegacyPersistedChatFallback(manualVerificationMessage, 1000);
const manualVerificationReloaded = readPersistedChatBotMetadata(manualVerificationFallback.content);
assert(manualVerificationFallback.metadataRoundTrips, 'manual-verification-only handoff survives the legacy content cap');
assert(manualVerificationReloaded?.computerHandoff?.replayPolicy === 'manual_verify_only', 'no-replay policy persists across refresh');
assert(manualVerificationReloaded?.computerHandoff?.mutationDispatched === true, 'mutation-dispatched proof persists across refresh');
assert(
  JSON.stringify(manualVerificationReloaded?.computerHandoff?.verificationOnlyTools) === JSON.stringify(['desktop.photoshop_document_status']),
  'only the read-only Photoshop status tool persists as a recovery surface',
);
assert(
  !manualVerificationReloaded?.computerHandoff?.verificationBridgeInstanceId
    && !manualVerificationReloaded?.computerHandoff?.verificationTarget,
  'emergency legacy envelope drops executable bridge/target binding so the verifier hides fail-closed',
);

const legacyCompactCompletion = formatPersistedChatBotMessage(
  'OpenSwan',
  `Opened Photoshop and created Untitled-1 at 600 x 600px. ${'Completion detail. '.repeat(90)}`,
  {
    localMessageId: 'local-message-compact-completion',
    source: { actor: 'OpenSwan', surface: 'main_chat_computer_task' },
    computerTaskStatus: 'completed',
  },
);
const legacyCompactFallback = buildLegacyPersistedChatFallback(legacyCompactCompletion, 1000);
const legacyCompactReloaded = readPersistedChatBotMetadata(legacyCompactFallback.content);
assert(legacyCompactFallback.mode === 'metadata', 'compact completion without a handoff still keeps metadata');
assert(legacyCompactReloaded?.source?.surface === 'main_chat_computer_task', 'compact completion reload keeps source surface');
assert(legacyCompactReloaded?.computerTaskStatus === 'completed', 'compact completion reload remains distinguishable as successful');

const invalidMetadataFallback = buildLegacyPersistedChatFallback(
  `🦢 **OpenSwan:** Visible safe response${BOT_META_MARKER}{"source":{"surface":"main_chat_computer_task"`,
  1000,
);
assert(invalidMetadataFallback.mode === 'text_only', 'invalid source metadata degrades explicitly to text-only');
assert(!invalidMetadataFallback.content.includes(BOT_META_MARKER), 'text-only fallback removes the invalid metadata marker and suffix');
assert(invalidMetadataFallback.content.includes('Visible safe response'), 'text-only fallback preserves the visible response');
assert(readPersistedChatBotMetadata(invalidMetadataFallback.content) === null, 'text-only fallback cannot masquerade as structured completion');
assert(canReleasePendingAfterPersistedChatRoundTrip({
  submittedContent: legacyComputerFallback.content,
  persistedContent: legacyComputerFallback.content,
  isBot: true,
}), 'parseable DB round-trip allows pending-record release');
const mutateStructuredMetadata = (
  content: string,
  mutate: (metadata: Record<string, any>) => void,
): string => {
  const markerIndex = content.indexOf(BOT_META_MARKER);
  const metadata = JSON.parse(content.slice(markerIndex + BOT_META_MARKER.length)) as Record<string, any>;
  mutate(metadata);
  return `${content.slice(0, markerIndex)}${BOT_META_MARKER}${JSON.stringify(metadata)}`;
};
const criticalMetadataMutations = [
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.localMessageId = 'wrong-local-message'; }),
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.runId = 'wrong-run'; }),
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.requestId = 'wrong-request'; }),
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.requestAuthorId = 'wrong-member'; }),
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.computerTaskStatus = 'blocked'; }),
  mutateStructuredMetadata(legacyComputerFallback.content, (metadata) => { metadata.source.surface = 'office_terminal'; }),
];
assert(
  criticalMetadataMutations.every((content) => readPersistedChatBotMetadata(content) !== null),
  'critical-field mutations remain parseable metadata for the acknowledgement regression',
);
assert(
  criticalMetadataMutations.every((content) => !canReleasePendingAfterPersistedChatRoundTrip({
    submittedContent: legacyComputerFallback.content,
    persistedContent: content,
    isBot: true,
  })),
  'parseable DB metadata with mutated critical lineage/status fields keeps pending state',
);
assert(!canReleasePendingAfterPersistedChatRoundTrip({
  submittedContent: legacyComputerMessage,
  persistedContent: `${legacyComputerFallback.content.slice(0, 990)}…`,
  isBot: true,
}), 'invalid truncated DB metadata keeps the recoverable pending record');
assert(!canReleasePendingAfterPersistedChatRoundTrip({
  submittedContent: legacyComputerMessage,
  persistedContent: stripPersistedChatBotPrefix(legacyComputerMessage),
  isBot: true,
}), 'metadata submission cannot silently downgrade to text-only before pending release');
assert(canReleasePendingAfterPersistedChatRoundTrip({
  submittedContent: invalidMetadataFallback.content,
  persistedContent: invalidMetadataFallback.content,
  isBot: true,
}), 'explicit marker-free text-only DB round-trip may release pending state');
assert(!canReleasePendingAfterPersistedChatRoundTrip({
  submittedContent: invalidMetadataFallback.content,
  persistedContent: `${invalidMetadataFallback.content} changed by storage`,
  isBot: true,
}), 'mutated marker-free DB text keeps the recoverable pending record');

const recoveryOnlyMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Browser task failed after the bridge lost DOM evidence.',
  {
    recoveryOptions: [{
      id: 'retry_with_fresh_evidence',
      label: 'Retry after fresh evidence',
      detail: 'Re-observe the browser DOM and screenshot before retrying the blocked action. '.repeat(12),
      actor: 'openswan',
      recommended: true,
      source: 'checkpoint_guard',
    }] as any,
    recoveryReliability: {
      surfaceKind: 'browser',
      targetName: 'Browser app',
      taskFamily: 'browser semantic workflow',
      failureArea: 'actionability',
      retryAllowed: true,
      userActionRequired: false,
      connectedAgentAllowed: false,
      recommendedOptionId: 'retry_with_fresh_evidence',
      readinessStatus: 'missing',
      nextEvidenceTools: ['browser.verification_state', 'browser.dom_snapshot', 'browser.locator_actionability'],
      requiredEvidenceTools: ['browser.verification_state', 'browser.dom_snapshot', 'browser.locator_actionability'],
      requiredFreshEvidence: ['fresh DOM/ARIA snapshot before retry', 'fresh screenshot when visual state or overlays matter'],
      requiredProof: ['refreshed DOM/ARIA state or confirmation text'],
      approvalBoundaries: ['submit, publish, send, pay, purchase, delete, invite, or external upload'],
      failClosedRules: ['ambiguous locator or repeated actionability timeout requires fresh observation or recovery option'],
      selectedRecoveryOptionId: 'retry_with_fresh_evidence',
      verificationCommands: ['npm run smoke:browser-bridge', 'npm run smoke:computer-task-runtime', 'npm run typecheck:app'],
    } as any,
  },
);
const recoveryOnlyMetadata = readPersistedChatBotMetadata(recoveryOnlyMessage);
assert((recoveryOnlyMetadata?.recoveryOptions?.[0]?.detail?.length || 0) <= 360, 'standalone recovery option details are compacted');
assert(recoveryOnlyMetadata?.recoveryReliability?.surfaceKind === 'browser', 'standalone recovery reliability summary is persisted');
assert((recoveryOnlyMetadata?.recoveryReliability?.nextEvidenceTools?.length || 0) <= 5, 'recovery reliability evidence tools are compacted');
assert((recoveryOnlyMetadata?.recoveryReliability?.verificationCommands?.length || 0) <= 8, 'recovery reliability verification commands are compacted');

const handoffMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'InDesign task is ready for review.',
  {
    computerTaskStatus: 'partial',
    computerHandoff: {
      surface: 'desktop',
      outcomeStatus: 'partial',
      adapterId: 'hybrid_adapter',
      taskKind: 'hybrid_task',
      taskLabel: 'Uploaded desktop file task',
      preflightStatus: 'ready',
      groundingStatus: 'needs_approval',
      warningCount: 0,
      blockerCount: 0,
      warnings: [],
      blockers: [],
      approvalSummary: 'Review before editing text, relinking assets, save, export, or package.',
      requestNotice: {
        visibility: 'user',
        tone: 'approval',
        title: 'Ready for review',
        summary: 'I found the desktop-app path for Adobe InDesign. I will observe the document or window first, use app-native tools when available, and verify the result before saying it is done.',
        primaryAction: {
          kind: 'approve_desktop',
          label: 'Approve desktop run',
          detail: 'Review desktop control before app or file mutation.',
        },
        secondaryActions: [{
          kind: 'connect_bridge',
          label: 'Check desktop bridge',
          detail: 'Use the desktop bridge only when local app or file access is needed.',
        }],
        badges: ['Desktop app', 'Approval', 'Adobe InDesign'],
        proof: ['App-native document status, text inventory, proof screenshot or exported proof, and output file stat.'],
        hiddenReason: null,
        appChoiceLine: 'Using Adobe InDesign (explicitly requested) — say "use Canva" to switch.',
        appChoice: {
          visibility: 'user',
          selectedAppId: 'adobe_indesign',
          selectedAppName: 'Adobe InDesign',
          selectedSurface: 'desktop',
          openVia: 'desktop_launch',
          availability: 'installed',
          reason: 'explicitly requested',
          line: 'Using Adobe InDesign (explicitly requested) — say "use Canva" to switch.',
          alternatives: ['Canva', 'Figma', 'Adobe Illustrator'],
          switchHint: 'Say "use Canva" to switch.',
          explicitAppNamed: true,
          namedAppIntent: 'InDesign',
          openStepLines: ['Open Adobe InDesign from the desktop bridge', 'Focus the current document'],
          recoveryFallbackName: 'Canva',
        },
      },
      appRouteDecision: {
        status: 'needs_observation',
        targetName: 'Adobe InDesign',
        taskFamily: 'layout document mutation',
        chosenSurfaceId: 'adobe_indesign_uxp_dom',
        chosenSurfaceLabel: 'InDesign UXP script/plugin DOM',
        chosenSurfaceFit: 'primary',
        score: 64,
        missingConfirmations: [
          'InDesign installed',
          'active document identity matches the staged file',
          'local file grants for source/assets/output',
        ],
        missingApprovals: ['copy/link/layer mutation', 'save/export/package/write'],
        userActionBlockers: [],
        nextSteps: ['Collect fresh evidence for active document identity and grants'],
        sourceRefs: [{
          label: 'Adobe InDesign UXP scripts',
          url: 'https://developer.adobe.com/indesign/uxp/scripts/',
        }],
      },
      evidenceContract: {
        schemaVersion: 1,
        kind: 'desktop_app',
        targetName: 'Adobe InDesign',
        taskFamily: 'design app execution',
        observeBefore: [
          'confirm app/window identity and active document identity before mutation',
          'capture InDesign document status plus layer/text/link/font or preflight inventory',
        ],
        actionabilityChecks: [
          'InDesign mutation runs through UXP script/plugin DOM or documented app API when available',
          'active document matches the staged file or user-selected target',
        ],
        approvalBefore: ['document mutation', 'save, export, package, render, overwrite, delete, flatten, rasterize, or destructive edit'],
        mutationGuardrails: ['app-native DOM/API/scripted tools run before accessibility, menu, screenshot, or coordinate fallback'],
        proofAfter: ['refreshed InDesign document status plus text/link/layer or preflight inventory', 'proof screenshot or exported proof artifact'],
        failClosedRules: ['active document mismatch blocks mutation', 'missing before/after inventory or proof blocks completion'],
        freshEvidenceRequired: ['fresh app-native document status before retry', 'fresh file_stat after output writes'],
        sourceRefs: [{
          label: 'Adobe InDesign UXP scripts',
          url: 'https://developer.adobe.com/indesign/uxp/scripts/',
          takeaway: 'InDesign UXP scripts are the direct automation surface for local layout/document tasks.',
        }],
        userSummary: 'Use app-native Adobe InDesign automation first, require approval for mutation/output work, and verify with refreshed inventory plus proof artifacts.',
      },
      desktopAttachmentPackage: {
        fileCount: 2,
        primaryFileCount: 1,
        stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/banner',
        manifestPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/_underground-circle-upload-manifest.json',
        sha256Count: 2,
        files: [{
          name: 'dealer-banner.indd',
          localPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/dealer-banner.indd',
          appName: 'Adobe InDesign',
          sha256: 'a'.repeat(64),
        }],
      },
      designAppTask: {
        appId: 'adobe_indesign',
        appName: 'Adobe InDesign',
        taskKind: 'marketing_banner_layout',
        documentSignals: ['marketing/campaign deliverable', 'named layers/text frames'],
        operations: ['inspect_layers', 'update_text_layers', 'replace_linked_asset', 'export_proof'],
        requiredInventory: ['active document name/path and saved/modified state', 'layer count plus locked/hidden layers'],
        approvalGates: ['editing text frames or object/layer state', 'exporting or packaging deliverables'],
        verificationSignals: ['post-change InDesign text inventory shows requested layer/copy updates', 'fresh screenshot or proof export shows the visible banner/layout state'],
        recommendedTools: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_batch_update_text_layers'],
      },
      designObjectManifestArtifact: {
        schemaVersion: 1,
        artifactKind: 'design_object_manifest',
        appId: 'adobe_indesign',
        appName: 'Adobe InDesign',
        taskKind: 'marketing_banner_layout',
        operations: ['inspect_layers', 'update_text_layers', 'replace_linked_asset', 'export_proof'],
        generatedAt: '2026-05-27T12:00:00.000Z',
        auditOk: true,
        blockerCount: 0,
        warningCount: 0,
        beforeToolCount: 3,
        afterToolCount: 2,
        actionCount: 2,
        artifactCount: 1,
        activeDocumentName: 'dealer-banner.indd',
        activeDocumentBasename: 'dealer-banner.indd',
        changedEntityKinds: ['text_frame', 'link'],
        artifactKinds: ['proof'],
        comparisonStatuses: [{ label: 'active document identity before vs after', status: 'pass' }],
        proofArtifacts: [{ label: 'InDesign proof PDF', basename: 'dealer-banner-proof.pdf', format: 'pdf', sizeBytes: 42000, pageCount: 1 }],
        packageArtifacts: [],
        blockers: [],
        warnings: [],
        redaction: 'basename_hash_only',
      },
    } as any,
  },
);
const handoffMetadata = readPersistedChatBotMetadata(handoffMessage);
assert(handoffMetadata?.computerTaskStatus === 'partial', 'rich computer outcome status is persisted at message level');
assert(handoffMetadata?.computerHandoff?.outcomeStatus === 'partial', 'rich computer outcome status is persisted in the handoff');
assert(handoffMetadata?.computerHandoff?.designAppTask?.appName === 'Adobe InDesign', 'computer handoff design app metadata is persisted');
assert((handoffMetadata?.computerHandoff?.desktopAttachmentPackage?.files?.[0]?.sha256 || '').length <= 16, 'computer handoff file hashes are compacted');
assert(handoffMetadata?.computerHandoff?.designObjectManifestArtifact?.auditOk === true, 'design object manifest artifact summary is persisted');
assert(handoffMetadata?.computerHandoff?.designObjectManifestArtifact?.proofArtifacts?.[0]?.basename === 'dealer-banner-proof.pdf', 'design object manifest proof summary is persisted');
assert(handoffMetadata?.computerHandoff?.requestNotice?.primaryAction?.kind === 'approve_desktop', 'computer request user notice is persisted with handoff metadata');
assert((handoffMetadata?.computerHandoff?.requestNotice?.summary || '').includes('desktop-app path'), 'computer request user notice summary is persisted');
assert((handoffMetadata?.computerHandoff?.requestNotice?.appChoiceLine || '').includes('Adobe InDesign'), 'computer request app choice line is persisted');
assert(handoffMetadata?.computerHandoff?.requestNotice?.appChoice?.selectedAppName === 'Adobe InDesign', 'computer request structured app choice is persisted');
assert((handoffMetadata?.computerHandoff?.requestNotice?.appChoice?.alternatives || []).includes('Canva'), 'computer request app alternatives are persisted');
assert(handoffMetadata?.computerHandoff?.requestNotice?.appChoice?.recoveryFallbackName === 'Canva', 'computer request app fallback is persisted');
assert(handoffMetadata?.computerHandoff?.appRouteDecision?.status === 'needs_observation', 'computer app route decision is persisted with handoff metadata');
assert(handoffMetadata?.computerHandoff?.appRouteDecision?.chosenSurfaceId === 'adobe_indesign_uxp_dom', 'computer app route decision chosen surface is persisted');
assert((handoffMetadata?.computerHandoff?.appRouteDecision?.sourceRefs || []).some((ref) => ref.url.includes('/indesign/uxp/scripts')), 'computer app route decision source refs are persisted');
assert(handoffMetadata?.computerHandoff?.evidenceContract?.targetName === 'Adobe InDesign', 'computer task evidence contract is persisted with handoff metadata');
assert((handoffMetadata?.computerHandoff?.evidenceContract?.proofAfter || []).some((item) => /InDesign document status/i.test(item)), 'computer task evidence contract proof rules are persisted');
assert(!JSON.stringify(handoffMetadata?.computerHandoff?.designObjectManifestArtifact || {}).includes('/Users/'), 'design object manifest artifact summary hides local paths');

const openswanMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Chrome tabs were read through the local desktop bridge.',
  {
    taskPlan: {
      kind: 'debug',
      profile: 'senior',
      summary: 'Read Chrome tabs from the local desktop bridge.',
      verification: [{
        id: 'tabs',
        label: 'Tabs listed',
        kind: 'tests',
        required: true,
        reason: 'The user asked what tabs were open.',
      }],
      recommendedTools: [{
        tool: 'desktop.list_browser_tabs',
        reason: 'Read local Chrome tabs.',
        priority: 'high',
      }],
    } as any,
    toolEvents: [{
      tool: 'desktop.list_browser_tabs',
      status: 'passed',
      summary: 'Read 3 Chrome tabs.',
    }] as any,
    verificationResults: [{
      check: {
        id: 'tabs',
        label: 'Tabs listed',
        kind: 'tests',
        required: true,
        reason: 'The user asked what tabs were open.',
      },
      status: 'passed',
      execution: {
        status: 'passed',
        mode: 'automatic',
        summary: 'Verified tab list response.',
      },
      ok: true,
      executed: true,
      summary: 'Verified tab list response.',
    }] as any,
    recoveryOptions: [{
      id: 'let_connected_agent_repair',
      label: 'Let Codex repair it',
      detail: 'Send the failure context to the connected coding agent.',
      actor: 'connected_agent',
      recommended: true,
      source: 'connected_agent_runbook',
    }] as any,
  },
);
const openswanMetadata = readPersistedChatBotMetadata(openswanMessage);
assert(!!openswanMetadata?.taskPlan, 'OpenSwan task plan is persisted');
assert((openswanMetadata?.toolEvents?.length || 0) === 1, 'OpenSwan tool events are persisted');
assert((openswanMetadata?.verificationResults?.length || 0) === 1, 'OpenSwan verification results are persisted');
assert((openswanMetadata?.recoveryOptions?.length || 0) === 1, 'recovery options are persisted');

// Best-of-N race metadata: builder clamps oversized input, the field
// round-trips through format/read, and it survives the byte-cap tiers so
// every candidate stays one tap to adopt after reload.
const oversizedRace = {
  task: 'Compare our deploy strategies and recommend one. '.repeat(8), // > 160 chars
  winnerIndex: 1,
  judged: true,
  candidates: [
    { model: 'model-a', ok: true, score: 6, note: 'thin', durationMs: 120, text: 'Alpha answer: blue/green.' },
    { model: 'model-b', ok: true, score: 9.5, note: 'complete note '.repeat(20), durationMs: 90, text: 'winner text '.repeat(200) }, // note > 120, text > 1500
    { model: 'model-c', ok: false, score: null, note: 'rate limited (429)', durationMs: 30, text: '' },
    { model: 'model-d', ok: true, score: 4, note: '', durationMs: 200, text: 'Delta answer.' },
    { model: 'model-e', ok: true, score: 3, note: '', durationMs: 210, text: 'Echo answer.' },
    { model: 'model-f', ok: true, score: 2, note: '', durationMs: 220, text: 'Foxtrot answer.' },
  ],
};
const builtRace = bestOfNMetadata(oversizedRace);
assert(!!builtRace, 'best-of-n builder accepts a race summary');
assert((builtRace?.candidates.length || 0) === 4, 'best-of-n candidates clamped to 4');
assert((builtRace?.task.length || 0) <= 160, 'best-of-n task clamped to 160');
assert((builtRace?.candidates[1]?.note.length || 0) <= 120, 'best-of-n candidate note clamped to 120');
assert((builtRace?.candidates[1]?.text.length || 0) <= 1500, 'best-of-n candidate text clamped to 1500');
assert(builtRace?.winnerIndex === 1 && builtRace?.judged === true, 'best-of-n winner index and judged flag preserved');
assert(builtRace?.candidates[1]?.score === 9.5, 'best-of-n judge scores preserved');
assert(builtRace?.candidates[2]?.ok === false && builtRace?.candidates[2]?.score === null, 'failed candidate keeps ok:false and null score');
assert(bestOfNMetadata(null) === null, 'best-of-n builder rejects null input');
assert(bestOfNMetadata('junk') === null, 'best-of-n builder rejects non-object input');
assert(bestOfNMetadata({ task: 'x', winnerIndex: null, judged: false, candidates: [] }) === null, 'best-of-n builder rejects empty candidate lists');

const bestOfNMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Race complete — model-b wins on completeness and evidence.',
  { bestOfN: builtRace },
);
assert(bestOfNMessage.length <= 9000, 'best-of-n message stays under DB content cap');
const bestOfNRow = readPersistedChatBotMetadata(bestOfNMessage);
const roundTrippedRace = readPersistedBestOfNRace(bestOfNRow);
assert((roundTrippedRace?.candidates.length || 0) === 4, 'best-of-n round-trip keeps all candidates');
assert(roundTrippedRace?.winnerIndex === 1 && roundTrippedRace?.judged === true, 'best-of-n round-trip keeps winner/judged');
assert(!!roundTrippedRace?.candidates[1]?.text.includes('winner text'), 'best-of-n round-trip keeps adoptable candidate text');
assert((roundTrippedRace?.candidates[1]?.text.length || 0) <= 1500, 'best-of-n reader re-clamps candidate text');
assert(readPersistedBestOfNRace(null) === null, 'best-of-n reader tolerates null metadata');
assert(readPersistedBestOfNRace({}) === null, 'best-of-n reader tolerates metadata without a race');

// Like computerFindings, the race must ride the byte-cap tiers: a big plan
// forces compact/minimal compaction, and the race survives it intact.
const raceWithBigPlanMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Race complete. '.repeat(20),
  { browserPlans: [hugePlan as any], bestOfN: builtRace },
);
assert(raceWithBigPlanMessage.length <= 9000, 'best-of-n + oversized plan message stays under DB content cap');
const raceWithBigPlanRace = readPersistedBestOfNRace(readPersistedChatBotMetadata(raceWithBigPlanMessage));
assert((raceWithBigPlanRace?.candidates.length || 0) === 4, 'best-of-n survives byte-cap compaction tiers');
assert(raceWithBigPlanRace?.winnerIndex === 1, 'best-of-n winner survives byte-cap compaction tiers');

// Durable universal-task correlation must survive a Chat reload without ever
// expanding into approval/dispatch authority or retaining raw task text.
const inertRootPointer = {
  schemaVersion: 1,
  rootRowId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  rootId: `computer_task_${'a'.repeat(64)}`,
  rootFingerprint: `args-v2:sha256:${'b'.repeat(64)}`,
  requestIdentityFingerprint: `args-v2:sha256:${'c'.repeat(64)}`,
  taskFingerprint: `args-v2:sha256:${'d'.repeat(64)}`,
};
const pointerRoundTripMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Browser plan is ready.',
  {
    browserPlans: [{
      ...hugePlan,
      task: 'Bounded browser task',
      computerTaskRootPointer: inertRootPointer,
    } as any],
    browserSessions: [{
      id: 'session-root-pointer',
      task: 'Bounded browser task',
      intent: {},
      backend: 'browserbase_stagehand',
      backendLabel: 'Browserbase Stagehand',
      status: 'awaiting_approval',
      startedAt: new Date(0).toISOString(),
      actions: [],
      computerTaskRootPointer: inertRootPointer,
    } as any],
  },
);
const pointerRoundTrip = readPersistedChatBotMetadata(pointerRoundTripMessage);
assert(
  JSON.stringify(pointerRoundTrip?.browserPlans?.[0]?.computerTaskRootPointer) === JSON.stringify(inertRootPointer),
  'browser plan keeps the inert task-root pointer across saved Chat reload',
);
assert(
  JSON.stringify(pointerRoundTrip?.browserSessions?.[0]?.computerTaskRootPointer) === JSON.stringify(inertRootPointer),
  'browser session keeps the inert task-root pointer across saved Chat reload',
);
assert(
  !pointerRoundTripMessage.includes('normalizedTask'),
  'saved root correlation never contains raw normalized task text',
);

const malformedPointerMessage = formatPersistedChatBotMessage(
  'OpenSwan',
  'Malformed pointer must be discarded.',
  {
    browserPlans: [{
      ...hugePlan,
      computerTaskRootPointer: { ...inertRootPointer, dispatchAuthority: true },
    } as any],
  },
);
const malformedPointerRoundTrip = readPersistedChatBotMetadata(malformedPointerMessage);
assert(
  !malformedPointerRoundTrip?.browserPlans?.[0]?.computerTaskRootPointer,
  'saved Chat drops malformed or authority-bearing root pointers',
);

if (failures > 0) {
  console.error(`\n${failures} persisted-chat metadata smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll persisted-chat metadata smoke cases passed.');
