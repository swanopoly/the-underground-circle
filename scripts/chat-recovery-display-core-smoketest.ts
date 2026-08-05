/**
 * chat-recovery-display-core-smoketest — decomposition unit U2
 * (docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md). Pins the REAL output of
 * the 16 recovery-display formatters + customer-safe sanitizers moved VERBATIM
 * out of src/screens/circles/tabs/ChatTab.tsx into src/lib/chatRecoveryDisplayCore.ts.
 *
 * Load-bearing assertions:
 *   FORMATTERS: every actor/surface/status/availability branch maps to its exact
 *   label + hex accent; the reliability card composes surface + failure-area +
 *   evidence chips; the app-choice card parses both the structured appChoice and
 *   the "Using <app> (<why>) — say 'use <alt>'" fallback line; the summary line
 *   prefers notice → app → first-sentence → 'Computer task' and truncates at 140.
 *
 *   CUSTOMER-SAFE: isSupportOnlyComputerTaskWarning + sanitizeVisibleComputerTaskMessage
 *   strip desktop-tool / bridge / errno / transport technical strings from copy,
 *   but let clean prose and 'completed' outcomes through untouched.
 *
 *   POLICY BADGES: getRecoveryOptionPolicyBadges is pinned against the real
 *   chatFailureRecovery execution-policy derivation (the one runtime dependency).
 *
 *   And: every export is total — null/undefined/junk/huge/cyclic never throws.
 *
 * Pure — loads under tsx (chatRecoveryDisplayCore imports one runtime helper from
 * the already-pure chatFailureRecovery lib; all other deps are `import type`).
 */

import {
  appendCustomerSafeRecoveryMessage,
  isSupportOnlyComputerTaskWarning,
  sanitizeVisibleComputerTaskMessage,
  getRecoveryOptionActorLabel,
  getRecoveryOptionAccent,
  formatRecoverySurfaceKind,
  formatRecoveryFailureArea,
  formatRecoveryEvidenceLabel,
  formatHandoffSurfaceRouteLabel,
  buildComputerTaskSummaryLine,
  getRecoveryReliabilityStatus,
  buildRecoveryReliabilityCard,
  buildChatAppChoiceCard,
  stripChatAppChoiceLine,
  getRecoveryOptionPolicyBadges,
  getRecoveryReliabilityFromArchive,
} from '../src/lib/chatRecoveryDisplayCore';
import type { ChatFailureRecoveryOption } from '../src/lib/chatFailureRecovery';
import type { ChatComputerHandoffMetadata } from '../src/lib/chatComputerHandoffContext';
import type { ChatComputerRequestUserNotice, ChatComputerAppChoiceCard } from '../src/lib/chatComputerRequestUx';
import type { ChatComputerTaskAutonomy } from '../src/lib/chatComputerTaskAutonomy';
import type { PersistedChatRecoveryReliabilitySummary } from '../src/lib/persistedChatMetadata';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertDeep(a: unknown, b: unknown, msg: string): void {
  assertEq(JSON.stringify(a), JSON.stringify(b), msg);
}
function noThrow(fn: () => unknown, msg: string): unknown {
  try {
    const out = fn();
    passes += 1;
    return out;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: ${msg} threw :: ${(e as Error)?.message}`);
    return undefined;
  }
}

// ─── typed fixtures (match the real cited types) ────────────────────────────
const BASE_AUTONOMY: ChatComputerTaskAutonomy = {
  userEffort: 'none',
  shouldShowUserNotice: false,
  canRunQuietly: true,
  canAutoPrepare: false,
  autoPreparationTargets: [],
  primaryUserAction: null,
  hiddenReason: null,
  reason: 'test',
  userActionBlockers: [],
  guardrails: [],
  automationSteps: [],
};
function makeNotice(partial: Partial<ChatComputerRequestUserNotice>): ChatComputerRequestUserNotice {
  return {
    visibility: 'user',
    tone: 'ready',
    title: 'Test',
    summary: '',
    autonomy: BASE_AUTONOMY,
    primaryAction: null,
    secondaryActions: [],
    badges: [],
    proof: [],
    hiddenReason: null,
    planPreview: null,
    ...partial,
  };
}
function makeAppChoice(partial: Partial<ChatComputerAppChoiceCard>): ChatComputerAppChoiceCard {
  return {
    visibility: 'user',
    selectedAppId: 'app',
    selectedAppName: 'Photoshop',
    selectedSurface: 'desktop',
    openVia: 'desktop_launch',
    reason: '',
    line: '',
    alternatives: [],
    switchHint: null,
    explicitAppNamed: false,
    openStepLines: [],
    ...partial,
  };
}
function makeHandoff(partial: Partial<ChatComputerHandoffMetadata>): ChatComputerHandoffMetadata {
  return {
    surface: 'desktop',
    warningCount: 0,
    blockerCount: 0,
    warnings: [],
    blockers: [],
    ...partial,
  };
}
function makeOption(partial: Partial<ChatFailureRecoveryOption>): ChatFailureRecoveryOption {
  return {
    id: 'opt',
    label: 'Option',
    detail: 'detail',
    actor: 'openswan',
    recommended: false,
    source: 'recovery_policy',
    ...partial,
  };
}

function main(): void {
  // ─── (1) appendCustomerSafeRecoveryMessage ────────────────────────────────
  assertEq(appendCustomerSafeRecoveryMessage('Done here.', 'Details saved.'), 'Done here.\n\nDetails saved.', '(1) appends recovery with blank line');
  assertEq(appendCustomerSafeRecoveryMessage('Done here.', ''), 'Done here.', '(1) empty recovery => base only');
  assertEq(appendCustomerSafeRecoveryMessage('Done here.', null), 'Done here.', '(1) null recovery => base only');
  assertEq(appendCustomerSafeRecoveryMessage('Done here.', undefined), 'Done here.', '(1) undefined recovery => base only');
  assertEq(appendCustomerSafeRecoveryMessage('  Hello  ', '  Recovery  '), 'Hello\n\nRecovery', '(1) trims both sides');
  assertEq(appendCustomerSafeRecoveryMessage('Trailing   ', 'ok'), 'Trailing\n\nok', '(1) strips trailing whitespace from base');
  assertEq(appendCustomerSafeRecoveryMessage('Done here.', '   '), 'Done here.', '(1) whitespace-only recovery => base only');

  // ─── (2) isSupportOnlyComputerTaskWarning ─────────────────────────────────
  assertEq(isSupportOnlyComputerTaskWarning('desktop.observe_app failed'), true, '(2) desktop.* is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('at x/desktop/exec'), true, '(2) /desktop/ preceded by a word char is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('/desktop/exec returned 500'), false, '(2) leading /desktop/ has no preceding word boundary => false (verbatim quirk)');
  assertEq(isSupportOnlyComputerTaskWarning('stale_bridge detected'), true, '(2) stale_bridge is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('errorCode 42'), true, '(2) errorCode is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('MCP endpoint down'), true, '(2) MCP is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('fetch failed unexpectedly'), true, '(2) fetch failed is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('TypeError: x is undefined'), true, '(2) TypeError is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('ECONN reset by peer'), true, '(2) ECONN token is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('ETIMEDOUT after 30s'), true, '(2) ETIMEDOUT is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('Desktop bridge health check failed'), true, '(2) Desktop bridge .*failed is support-only');
  assertEq(isSupportOnlyComputerTaskWarning('DESKTOP.OBSERVE_APP failed'), true, '(2) case-insensitive desktop.* match');
  assertEq(isSupportOnlyComputerTaskWarning('The report is ready for review.'), false, '(2) clean prose is not support-only');
  assertEq(isSupportOnlyComputerTaskWarning('I saved your notes.'), false, '(2) benign message is not support-only');
  assertEq(isSupportOnlyComputerTaskWarning('endpoints of the graph'), false, '(2) endpoint substring inside word does not match');
  assertEq(isSupportOnlyComputerTaskWarning(''), false, '(2) empty string is not support-only');
  assertEq(isSupportOnlyComputerTaskWarning(null as unknown as string), false, '(2) null coerces to empty => false');

  // ─── (3) sanitizeVisibleComputerTaskMessage ───────────────────────────────
  assertEq(
    sanitizeVisibleComputerTaskMessage('desktop.edit_file failed', 'failed'),
    'I could not finish that app or file action. Technical details were saved for recovery.',
    '(3) technical message on failure is replaced',
  );
  assertEq(sanitizeVisibleComputerTaskMessage('All good, notes saved.', 'failed'), 'All good, notes saved.', '(3) clean message passes through on failure');
  assertEq(sanitizeVisibleComputerTaskMessage('desktop.edit_file failed', 'completed'), 'desktop.edit_file failed', '(3) completed status passes technical text through');
  assertEq(sanitizeVisibleComputerTaskMessage('', 'failed'), '', '(3) empty message stays empty');
  assertEq(sanitizeVisibleComputerTaskMessage('   ', 'failed'), '', '(3) whitespace-only trims to empty');
  assertEq(
    sanitizeVisibleComputerTaskMessage('EACCES: permission denied', 'error'),
    'I could not finish that app or file action. Technical details were saved for recovery.',
    '(3) EACCES errno is replaced',
  );
  assertEq(
    sanitizeVisibleComputerTaskMessage('ENOENT: no such file', 'failed'),
    'I could not finish that app or file action. Technical details were saved for recovery.',
    '(3) ENOENT errno is replaced',
  );
  assertEq(
    sanitizeVisibleComputerTaskMessage('File or folder does not exist', 'failed'),
    'I could not finish that app or file action. Technical details were saved for recovery.',
    '(3) file-not-exist phrase is replaced',
  );
  assertEq(
    sanitizeVisibleComputerTaskMessage('Transport threw an error', 'failed'),
    'I could not finish that app or file action. Technical details were saved for recovery.',
    '(3) Transport threw is replaced',
  );
  assertEq(sanitizeVisibleComputerTaskMessage('The document was updated.', 'failed'), 'The document was updated.', '(3) plain success sentence passes through');
  assertEq(sanitizeVisibleComputerTaskMessage(null as unknown as string, 'failed'), '', '(3) null message => empty');

  // ─── (4) getRecoveryOptionActorLabel ──────────────────────────────────────
  assertEq(getRecoveryOptionActorLabel('openswan'), 'OpenSwan', '(4) openswan label');
  assertEq(getRecoveryOptionActorLabel('connected_agent'), 'Connected agent', '(4) connected_agent label');
  assertEq(getRecoveryOptionActorLabel('llm'), 'LLM', '(4) llm label');
  assertEq(getRecoveryOptionActorLabel('user'), 'User', '(4) user label');
  assertEq(getRecoveryOptionActorLabel('none'), 'Stop', '(4) none => Stop (default)');
  assertEq(getRecoveryOptionActorLabel('garbage' as ChatFailureRecoveryOption['actor']), 'Stop', '(4) unknown actor => Stop');

  // ─── (5) getRecoveryOptionAccent ──────────────────────────────────────────
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'connected_agent' })), '#22c55e', '(5) connected_agent accent');
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'openswan' })), '#38bdf8', '(5) openswan accent');
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'user' })), '#f59e0b', '(5) user accent');
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'llm' })), '#a78bfa', '(5) llm accent');
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'none' })), '#ef4444', '(5) none accent (fallthrough)');
  assertEq(getRecoveryOptionAccent(makeOption({ actor: 'weird' as ChatFailureRecoveryOption['actor'] })), '#ef4444', '(5) unknown actor => red');

  // ─── (6) formatRecoverySurfaceKind ────────────────────────────────────────
  assertEq(formatRecoverySurfaceKind('desktop_app'), 'Desktop app', '(6) desktop_app');
  assertEq(formatRecoverySurfaceKind('local_file'), 'Local files', '(6) local_file');
  assertEq(formatRecoverySurfaceKind('browser'), 'Browser', '(6) browser');
  assertEq(formatRecoverySurfaceKind('hybrid'), 'Multi-surface', '(6) hybrid');
  assertEq(formatRecoverySurfaceKind('agent_buildout'), 'Capability buildout', '(6) agent_buildout');
  assertEq(formatRecoverySurfaceKind('other'), 'Task', '(6) unknown => Task');
  assertEq(formatRecoverySurfaceKind(null), 'Task', '(6) null => Task');
  assertEq(formatRecoverySurfaceKind(undefined), 'Task', '(6) undefined => Task');

  // ─── (7) formatRecoveryFailureArea ────────────────────────────────────────
  assertEq(formatRecoveryFailureArea('evidence_capture'), 'Evidence Capture', '(7) snake => Title Case');
  assertEq(formatRecoveryFailureArea('proof_after'), 'Proof After', '(7) proof_after');
  assertEq(formatRecoveryFailureArea('a_b_c'), 'A B C', '(7) each token capitalized');
  assertEq(formatRecoveryFailureArea(''), 'Recovery', '(7) empty => Recovery');
  assertEq(formatRecoveryFailureArea(null), 'Recovery', '(7) null => Recovery');
  assertEq(formatRecoveryFailureArea(undefined), 'Recovery', '(7) undefined => Recovery');

  // ─── (8) formatRecoveryEvidenceLabel ──────────────────────────────────────
  assertEq(formatRecoveryEvidenceLabel('desktop.observe_app'), 'observe app', '(8) strips desktop. prefix + underscores');
  assertEq(formatRecoveryEvidenceLabel('browser.read_dom'), 'read dom', '(8) strips browser. prefix');
  assertEq(formatRecoveryEvidenceLabel('agent.buildout:tool'), 'buildout tool', '(8) strips agent. prefix + colon');
  assertEq(formatRecoveryEvidenceLabel('  spaced   out  '), 'spaced out', '(8) collapses + trims whitespace');
  assertEq(formatRecoveryEvidenceLabel('plain_label'), 'plain label', '(8) no-prefix label');
  assertEq(formatRecoveryEvidenceLabel(''), '', '(8) empty stays empty');

  // ─── (9) formatHandoffSurfaceRouteLabel ───────────────────────────────────
  assertEq(formatHandoffSurfaceRouteLabel(makeHandoff({ surface: 'desktop' })), 'Desktop app', '(9) desktop surface');
  assertEq(formatHandoffSurfaceRouteLabel(makeHandoff({ surface: 'local_files' })), 'Local files', '(9) local_files surface');
  assertEq(formatHandoffSurfaceRouteLabel(makeHandoff({ surface: 'browser' })), 'Browser', '(9) browser surface');
  assertEq(formatHandoffSurfaceRouteLabel(makeHandoff({ surface: 'computer' })), 'Computer', '(9) computer surface');
  assertEq(formatHandoffSurfaceRouteLabel(null), null, '(9) null handoff => null');
  assertEq(formatHandoffSurfaceRouteLabel(undefined), null, '(9) undefined handoff => null');

  // ─── (10) buildComputerTaskSummaryLine ────────────────────────────────────
  assertEq(
    buildComputerTaskSummaryLine({
      handoff: makeHandoff({ surface: 'desktop', requestNotice: makeNotice({ summary: 'Booking   a\n table' }) }),
      appChoiceCard: null,
      body: 'ignored body sentence.',
    }),
    'Booking a table',
    '(10) prefers notice summary (whitespace-collapsed)',
  );
  assertEq(
    buildComputerTaskSummaryLine({
      handoff: null,
      appChoiceCard: { selectedAppName: 'Photoshop', surfaceLabel: 'Desktop app' },
      body: 'ignored',
    }),
    'Using Photoshop · Desktop app',
    '(10) falls to app-choice line',
  );
  assertEq(
    buildComputerTaskSummaryLine({ handoff: null, appChoiceCard: null, body: 'First sentence. Second one.' }),
    'First sentence.',
    '(10) falls to first sentence of body',
  );
  assertEq(
    buildComputerTaskSummaryLine({ handoff: null, appChoiceCard: null, body: '' }),
    'Computer task',
    '(10) empty everything => Computer task',
  );
  const truncated = buildComputerTaskSummaryLine({ handoff: null, appChoiceCard: null, body: 'x'.repeat(200) });
  assertEq(truncated.length, 140, '(10) long summary truncated to 140 chars');
  assert(truncated.endsWith('…'), '(10) truncated summary ends with ellipsis');
  assertEq(truncated.slice(0, 139), 'x'.repeat(139), '(10) truncated summary keeps first 139 chars');
  const notTruncated = buildComputerTaskSummaryLine({ handoff: null, appChoiceCard: null, body: 'y'.repeat(140) });
  assertEq(notTruncated.length, 140, '(10) exactly-140 body is not truncated');
  assert(!notTruncated.endsWith('…'), '(10) exactly-140 body keeps no ellipsis');

  // ─── (11) getRecoveryReliabilityStatus ────────────────────────────────────
  assertEq(getRecoveryReliabilityStatus(null), null, '(11) null summary => null');
  assertEq(getRecoveryReliabilityStatus(undefined), null, '(11) undefined summary => null');
  assertDeep(
    getRecoveryReliabilityStatus({ userActionRequired: true, connectedAgentAllowed: true, retryAllowed: true, readinessStatus: 'ready' }),
    { label: 'User step', color: '#f59e0b', detail: 'Waiting for a permission, login, approval, bridge, or app blocker to be resolved.' },
    '(11) userActionRequired wins first',
  );
  assertDeep(
    getRecoveryReliabilityStatus({ connectedAgentAllowed: true, retryAllowed: true, readinessStatus: 'ready' }),
    { label: 'Agent repair', color: '#22c55e', detail: 'A connected agent can repair the missing adapter or runtime capability before retrying.' },
    '(11) connectedAgentAllowed wins second',
  );
  assertDeep(
    getRecoveryReliabilityStatus({ retryAllowed: true, readinessStatus: 'ready' }),
    { label: 'Ready', color: '#22c55e', detail: 'Required evidence is fresh enough for one bounded retry.' },
    '(11) retry + ready => Ready',
  );
  assertDeep(
    getRecoveryReliabilityStatus({ retryAllowed: true, readinessStatus: 'stale' }),
    { label: 'Needs evidence', color: '#38bdf8', detail: 'Fresh evidence is required before retrying the failed step.' },
    '(11) retry + not-ready => Needs evidence',
  );
  assertDeep(
    getRecoveryReliabilityStatus({}),
    { label: 'Stopped', color: '#ef4444', detail: 'The recovery path is blocked until the cause is reviewed.' },
    '(11) empty summary => Stopped',
  );

  // ─── (12) buildRecoveryReliabilityCard ────────────────────────────────────
  assertEq(buildRecoveryReliabilityCard(null), null, '(12) null summary => null card');
  assertEq(buildRecoveryReliabilityCard(undefined), null, '(12) undefined summary => null card');
  assertDeep(
    buildRecoveryReliabilityCard({}),
    {
      title: 'Task recovery',
      subtitle: 'Recovery',
      statusLabel: 'Stopped',
      color: '#ef4444',
      detail: 'The recovery path is blocked until the cause is reviewed.',
      chips: [],
    },
    '(12) empty summary still yields a Stopped card (status is non-null for {})',
  );
  assertDeep(
    buildRecoveryReliabilityCard({
      surfaceKind: 'desktop_app',
      targetName: 'Photoshop',
      failureArea: 'evidence_capture',
      retryAllowed: true,
      readinessStatus: 'ready',
      nextEvidenceTools: ['desktop.observe_app', 'desktop.screenshot'],
      requiredFreshEvidence: ['desktop.observe_app'],
      verificationCommands: ['a', 'b'],
    }),
    {
      title: 'Desktop app recovery',
      subtitle: 'Photoshop · Evidence Capture',
      statusLabel: 'Ready',
      color: '#22c55e',
      detail: 'desktop.observe_app',
      chips: ['Evidence ready', 'observe app', 'screenshot', '2 checks'],
    },
    '(12) full card composes surface + target + fresh-evidence + chips',
  );
  assertDeep(
    buildRecoveryReliabilityCard({
      surfaceKind: 'browser',
      failureArea: 'proof_after',
      userActionRequired: true,
      requiredEvidenceTools: ['browser.read_dom'],
    }),
    {
      title: 'Browser recovery',
      subtitle: 'Proof After',
      statusLabel: 'User step',
      color: '#f59e0b',
      detail: 'browser.read_dom',
      chips: ['read dom'],
    },
    '(12) no targetName => subtitle is area; falls back to requiredEvidenceTools',
  );

  // ─── (13) buildChatAppChoiceCard ──────────────────────────────────────────
  assertEq(buildChatAppChoiceCard(null), null, '(13) null handoff => null');
  assertEq(buildChatAppChoiceCard(makeHandoff({ surface: 'desktop' })), null, '(13) no notice => null');
  assertDeep(
    buildChatAppChoiceCard(makeHandoff({
      surface: 'desktop',
      requestNotice: makeNotice({
        appChoice: makeAppChoice({
          availability: 'installed',
          reason: 'best fit',
          switchHint: 'say "use GIMP"',
          alternatives: ['A', 'B', 'C', 'D'],
          openStepLines: ['Open it', 'next'],
        }),
      }),
    })),
    {
      selectedAppName: 'Photoshop',
      surfaceLabel: 'Desktop app',
      availabilityLabel: 'Installed',
      reason: 'best fit',
      switchHint: 'say "use GIMP"',
      alternatives: ['A', 'B', 'C'],
      openStep: 'Open it',
    },
    '(13) structured appChoice installed/desktop, alternatives clamped to 3',
  );
  assertEq(
    buildChatAppChoiceCard(makeHandoff({ surface: 'desktop', requestNotice: makeNotice({ appChoice: makeAppChoice({ availability: 'maybe' }) }) }))?.availabilityLabel,
    'Bridge check',
    '(13) availability maybe => Bridge check',
  );
  const webChoice = buildChatAppChoiceCard(makeHandoff({ surface: 'browser', requestNotice: makeNotice({ appChoice: makeAppChoice({ selectedSurface: 'browser', availability: 'web' }) }) }));
  assertEq(webChoice?.surfaceLabel, 'Web app', '(13) selectedSurface browser => Web app');
  assertEq(webChoice?.availabilityLabel, 'Web ready', '(13) availability web => Web ready');
  assertEq(webChoice?.reason, 'best available app for this task', '(13) empty reason => default reason');
  assertEq(
    buildChatAppChoiceCard(makeHandoff({ surface: 'desktop', requestNotice: makeNotice({ appChoice: makeAppChoice({ availability: undefined }) }) }))?.availabilityLabel,
    'Desktop app',
    '(13) missing availability => surfaceLabel',
  );
  assertEq(
    buildChatAppChoiceCard(makeHandoff({ surface: 'desktop', requestNotice: makeNotice({ appChoice: makeAppChoice({ visibility: 'hidden' }) }) })),
    null,
    '(13) hidden appChoice + no fallback line => null',
  );
  assertDeep(
    buildChatAppChoiceCard(makeHandoff({
      surface: 'desktop',
      requestNotice: makeNotice({ appChoiceLine: 'Using Photoshop (installed locally) — say "use Illustrator" to switch' }),
    })),
    {
      selectedAppName: 'Photoshop',
      surfaceLabel: 'Desktop app',
      availabilityLabel: 'Selected',
      reason: 'installed locally',
      switchHint: 'say "use Illustrator"',
      alternatives: [],
      openStep: null,
    },
    '(13) fallback line parses app + reason + switch hint',
  );
  assertDeep(
    buildChatAppChoiceCard(makeHandoff({ surface: 'browser', requestNotice: makeNotice({ appChoiceLine: 'Using Notes.' }) })),
    {
      selectedAppName: 'Notes',
      surfaceLabel: 'Web app',
      availabilityLabel: 'Selected',
      reason: 'Using Notes.',
      switchHint: null,
      alternatives: [],
      openStep: null,
    },
    '(13) fallback line without parens keeps whole line as reason, no switch hint',
  );
  assertEq(
    buildChatAppChoiceCard(makeHandoff({ surface: 'computer', requestNotice: makeNotice({ appChoiceLine: 'Picked something for you' }) }))?.selectedAppName,
    'Selected app',
    '(13) non-"Using" fallback line => Selected app',
  );
  assertEq(
    buildChatAppChoiceCard(makeHandoff({ surface: 'computer', requestNotice: makeNotice({ appChoiceLine: 'Picked something for you' }) }))?.surfaceLabel,
    'App task',
    '(13) non-desktop/browser surface => App task',
  );

  // ─── (14) stripChatAppChoiceLine ──────────────────────────────────────────
  assertEq(stripChatAppChoiceLine('Line A\nUsing Photoshop\nLine B', 'Using Photoshop'), 'Line A\nLine B', '(14) removes the matching line');
  assertEq(stripChatAppChoiceLine('A\n\nUsing X\n\nB', 'Using X'), 'A\n\nB', '(14) collapses resulting 3+ newlines to 2');
  assertEq(stripChatAppChoiceLine('Keep me', ''), 'Keep me', '(14) empty target => content unchanged');
  assertEq(stripChatAppChoiceLine('Keep me', null), 'Keep me', '(14) null target => content unchanged');
  assertEq(stripChatAppChoiceLine('  Using X  \nBody', 'Using X'), 'Body', '(14) trims line before comparing to target');
  assertEq(stripChatAppChoiceLine('', 'Using X'), '', '(14) empty content => empty');
  assertEq(stripChatAppChoiceLine(null as unknown as string, 'Using X'), '', '(14) null content coerces to empty');

  // ─── (15) getRecoveryOptionPolicyBadges (pinned vs real policy) ────────────
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ actor: 'connected_agent' })), ['APPROVAL', 'CONNECTED AGENT', 'PATCH', '1 TRY'], '(15) connected_agent badges');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ actor: 'openswan', source: 'checkpoint_guard' })), ['APPROVAL', 'FRESH EVIDENCE', '1 TRY'], '(15) openswan checkpoint-guard badges');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ actor: 'user' })), ['USER STEP'], '(15) user badges');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ actor: 'llm' })), ['APPROVAL', 'FRESH EVIDENCE', '1 TRY'], '(15) llm badges');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ actor: 'none' })), ['NO RETRY'], '(15) none => NO RETRY');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ id: 'repair_or_restart_bridge', actor: 'user' })), ['USER STEP'], '(15) user bridge repair');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ id: 'repair_or_restart_bridge', actor: 'openswan' })), ['APPROVAL', 'CONNECTED AGENT', 'PATCH', '1 TRY'], '(15) agent bridge repair');
  assertDeep(getRecoveryOptionPolicyBadges(makeOption({ id: 'something_random', actor: 'openswan', source: 'recovery_policy' })), ['APPROVAL', '1 TRY'], '(15) unmatched => diagnostic continue_recovery');
  assert(getRecoveryOptionPolicyBadges(makeOption({ actor: 'connected_agent' })).length <= 4, '(15) badges clamped to 4');

  // ─── (16) getRecoveryReliabilityFromArchive ───────────────────────────────
  const reliability: PersistedChatRecoveryReliabilitySummary = { surfaceKind: 'browser', retryAllowed: true };
  const fromArchive = getRecoveryReliabilityFromArchive({ recoveryReliability: reliability });
  assertEq(fromArchive, reliability, '(16) returns the same summary object reference');
  assertEq(getRecoveryReliabilityFromArchive(null), null, '(16) null metadata => null');
  assertEq(getRecoveryReliabilityFromArchive(undefined), null, '(16) undefined metadata => null');
  assertEq(getRecoveryReliabilityFromArchive({}), null, '(16) missing field => null');
  assertEq(getRecoveryReliabilityFromArchive({ recoveryReliability: 'str' }), null, '(16) non-object field => null');
  assertEq(getRecoveryReliabilityFromArchive({ recoveryReliability: null }), null, '(16) null field => null');
  assertEq(getRecoveryReliabilityFromArchive({ recoveryReliability: 123 }), null, '(16) number field => null');

  // ─── (17) hostile inputs never throw ──────────────────────────────────────
  {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const huge = 'z'.repeat(100000);
    const weird = ' \u{1F4A9}\t\n control—chars…';

    // total functions tolerate null/undefined/junk directly
    assertEq(noThrow(() => getRecoveryOptionActorLabel(undefined as unknown as ChatFailureRecoveryOption['actor']), '(17) actor label undefined'), 'Stop', '(17) actor label undefined => Stop');
    assertEq(noThrow(() => getRecoveryOptionActorLabel(null as unknown as ChatFailureRecoveryOption['actor']), '(17) actor label null'), 'Stop', '(17) actor label null => Stop');
    noThrow(() => formatRecoverySurfaceKind(huge), '(17) surface kind huge');
    noThrow(() => formatRecoveryFailureArea(weird), '(17) failure area weird chars');
    noThrow(() => formatRecoveryEvidenceLabel(huge), '(17) evidence label huge');
    noThrow(() => formatRecoveryEvidenceLabel(weird), '(17) evidence label weird chars');
    noThrow(() => formatHandoffSurfaceRouteLabel(cyclic as unknown as ChatComputerHandoffMetadata), '(17) route label cyclic');
    noThrow(() => formatHandoffSurfaceRouteLabel(null), '(17) route label null');
    noThrow(() => getRecoveryReliabilityStatus(cyclic as unknown as PersistedChatRecoveryReliabilitySummary), '(17) status cyclic');
    noThrow(() => buildRecoveryReliabilityCard(cyclic as unknown as PersistedChatRecoveryReliabilitySummary), '(17) card cyclic');
    noThrow(() => buildChatAppChoiceCard(cyclic as unknown as ChatComputerHandoffMetadata), '(17) app-choice cyclic');
    noThrow(() => buildChatAppChoiceCard(null), '(17) app-choice null');
    noThrow(() => stripChatAppChoiceLine(huge, weird), '(17) strip huge/weird');
    noThrow(() => stripChatAppChoiceLine(null as unknown as string, null), '(17) strip null/null');
    assertDeep(noThrow(() => getRecoveryOptionPolicyBadges(null as unknown as ChatFailureRecoveryOption), '(17) badges null'), ['NO RETRY'], '(17) badges null => NO RETRY');
    assertDeep(noThrow(() => getRecoveryOptionPolicyBadges(cyclic as unknown as ChatFailureRecoveryOption), '(17) badges cyclic'), ['NO RETRY'], '(17) badges cyclic => NO RETRY');
    noThrow(() => getRecoveryReliabilityFromArchive(cyclic), '(17) archive cyclic');
    assert(Array.isArray(getRecoveryReliabilityFromArchive({ recoveryReliability: [] })), '(17) array field passes typeof-object gate (real edge behavior)');

    // non-null-required functions tolerate hostile-but-typed payloads
    noThrow(() => getRecoveryOptionAccent({} as ChatFailureRecoveryOption), '(17) accent empty object');
    assertEq(noThrow(() => getRecoveryOptionAccent({ actor: 'garbage' } as unknown as ChatFailureRecoveryOption), '(17) accent junk actor'), '#ef4444', '(17) accent junk actor => red');
    noThrow(() => appendCustomerSafeRecoveryMessage(huge, huge), '(17) append huge/huge');
    noThrow(() => appendCustomerSafeRecoveryMessage(weird, weird), '(17) append weird/weird');
    noThrow(() => isSupportOnlyComputerTaskWarning(huge), '(17) warning huge');
    noThrow(() => sanitizeVisibleComputerTaskMessage(huge, weird), '(17) sanitize huge/weird status');
    noThrow(() => buildComputerTaskSummaryLine({ handoff: cyclic as unknown as ChatComputerHandoffMetadata, appChoiceCard: null, body: huge }), '(17) summary cyclic handoff + huge body');
    noThrow(() => buildComputerTaskSummaryLine({ handoff: null, appChoiceCard: { selectedAppName: weird, surfaceLabel: weird }, body: '' }), '(17) summary weird app-choice');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-recovery-display-core smoke cases passed (${passes} passed).`);
}

main();
