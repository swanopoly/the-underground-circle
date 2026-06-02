import assert from 'node:assert/strict';
import {
  buildChatComputerOutcomePresentation,
  isCompactPhotoshopSaveForWebBridgeFailure,
  isQuietSuccessfulComputerTaskWarning,
} from '../src/lib/chatComputerOutcomeUx';

const screenshotSaveForWebTask = 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png';
const staleBridgeMessage = 'Stopped at step 4/4: Photoshop proof export failed: Unknown /desktop endpoint. Try /desktop/health.';
const staleBridgeWarnings = [
  'desktop sequence stopped',
  'desktop_photoshop_export_proof failed with stale_bridge',
  'photoshop_export_proof stale_bridge; save_for_web_fallback failed',
];

assert(
  isQuietSuccessfulComputerTaskWarning('photoshop_export_proof stale_bridge; used save_for_web_fallback'),
  'successful Save for Web fallback stale warning is quiet',
);

assert(
  isCompactPhotoshopSaveForWebBridgeFailure(
    screenshotSaveForWebTask,
    'failed',
    staleBridgeMessage,
    staleBridgeWarnings,
  ),
  'bounded Photoshop Save for Web stale bridge failure is compactable',
);

const compactFailure = buildChatComputerOutcomePresentation({
  task: screenshotSaveForWebTask,
  outcomeStatus: 'failed',
  outcomeMessage: staleBridgeMessage,
  rawWarnings: staleBridgeWarnings,
  visibleWarnings: staleBridgeWarnings.filter((warning) => !isQuietSuccessfulComputerTaskWarning(warning)),
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(compactFailure.statePhase, 'blocked', 'compact stale bridge failure persists as blocked, not completed');
assert.equal(compactFailure.shouldRecoverOutcome, false, 'compact stale bridge failure suppresses generic recovery cards');
assert.equal(compactFailure.hideComputerHandoff, true, 'compact stale bridge failure hides design handoff card');
assert.equal(compactFailure.hideRecoveryDetails, true, 'compact stale bridge failure hides recovery option wall');
assert.equal(compactFailure.hideComputerTaskStatus, false, 'compact stale bridge failure keeps a reconnect status available');
assert(compactFailure.compactUserMessage?.includes('desktop bridge needs to reconnect'), 'compact stale bridge failure explains the one action');
assert(compactFailure.nextSteps.some((step) => /desktop bridge/i.test(step)), 'compact stale bridge failure stores reconnect next step');
assert(compactFailure.blockerList.some((blocker) => /Save for Web/i.test(blocker)), 'compact stale bridge failure stores user-readable blocker');

const successfulFallback = buildChatComputerOutcomePresentation({
  task: screenshotSaveForWebTask,
  outcomeStatus: 'completed',
  outcomeMessage: 'Photoshop proof export endpoint was unavailable, so I used Save for Web and saved lmao.png.',
  rawWarnings: ['photoshop_export_proof stale_bridge; used save_for_web_fallback'],
  visibleWarnings: ['photoshop_export_proof stale_bridge; used save_for_web_fallback'].filter((warning) => !isQuietSuccessfulComputerTaskWarning(warning)),
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(successfulFallback.statePhase, 'completed', 'successful Save for Web fallback remains completed');
assert.equal(successfulFallback.warningBlock, '', 'successful Save for Web fallback hides quiet stale warning');
assert.equal(successfulFallback.shouldRecoverOutcome, false, 'successful Save for Web fallback does not launch recovery');
assert(successfulFallback.compactUserMessage?.includes('lmao.png'), 'successful Save for Web fallback shows compact user result');
assert.equal(successfulFallback.hideComputerHandoff, true, 'successful low-risk Save for Web hides technical handoff details');
assert.equal(successfulFallback.hideRecoveryDetails, true, 'successful low-risk Save for Web hides recovery metadata');
assert.equal(successfulFallback.hideComputerTaskStatus, true, 'successful low-risk Save for Web clears transient task status');

const completedSequence = buildChatComputerOutcomePresentation({
  task: screenshotSaveForWebTask,
  outcomeStatus: 'completed',
  outcomeMessage: [
    'Completed 11 desktop app steps:',
    '1. Found and opened Screenshot 2026-05-21 at 4.44.42 PM.png from /Users/cswanson/Desktop/Screenshot 2026-05-21 at 4.44.42 PM.png.',
    '8. Verified the Save dialog and set the filename field to lmao.png via accessibility.',
    '10. Confirmed the save extension warning by keeping .png for lmao.png.',
  ].join('\n'),
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(completedSequence.shouldRecoverOutcome, false, 'completed desktop sequence does not launch recovery');
assert(completedSequence.compactUserMessage?.includes('lmao.png'), 'completed desktop sequence is compacted to saved filename');
assert(!completedSequence.compactUserMessage?.includes('Completed 11 desktop app steps'), 'completed desktop sequence hides internal step list');
assert.equal(completedSequence.hideRecoveryDetails, true, 'completed compact desktop sequence hides stale recovery details');
assert.equal(completedSequence.hideComputerTaskStatus, true, 'completed compact desktop sequence clears status panel');

const completedWithPreflightDiagnostics = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop, save the desktop screenshot as lmao.png, and replace it if it already exists',
  outcomeStatus: 'completed',
  outcomeMessage: 'Done. I opened the image in Photoshop and saved the renamed file as lmao.png.',
  rawWarnings: [
    'Photoshop document inventory required before editing layers.',
    'Fresh app evidence required before mutation.',
  ],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [
    'Photoshop document inventory required before editing layers.',
    'Fresh app evidence required before mutation.',
  ],
  groundingBlockers: [],
});

assert.equal(completedWithPreflightDiagnostics.shouldRecoverOutcome, false, 'completed task with hidden diagnostics does not launch recovery');
assert.equal(completedWithPreflightDiagnostics.hideRecoveryDetails, true, 'completed task with hidden diagnostics hides recovery details');
assert.equal(completedWithPreflightDiagnostics.hideComputerHandoff, true, 'completed task with hidden diagnostics hides technical handoff');
assert.equal(completedWithPreflightDiagnostics.hideComputerTaskStatus, true, 'completed task with hidden diagnostics clears status panel');
assert.deepEqual(completedWithPreflightDiagnostics.blockerList, [], 'completed task does not turn preflight diagnostics into visible blockers');

const failedWithPreflightDiagnostics = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop, save the desktop screenshot as lmao.png, and replace it if it already exists',
  outcomeStatus: 'failed',
  outcomeMessage: 'Could not finish the Photoshop save.',
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: ['Fresh app evidence required before mutation.'],
  groundingBlockers: [],
});

assert.equal(failedWithPreflightDiagnostics.shouldRecoverOutcome, true, 'failed task still launches recovery');
assert.equal(failedWithPreflightDiagnostics.hideRecoveryDetails, false, 'failed task keeps recovery details visible');
assert(failedWithPreflightDiagnostics.blockerList.some((blocker) => /Fresh app evidence/i.test(blocker)), 'failed task keeps preflight diagnostics actionable');

const nonCompactPhotoshopFailure = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and use generative fill to remove the selected object',
  outcomeStatus: 'failed',
  outcomeMessage: staleBridgeMessage,
  rawWarnings: staleBridgeWarnings,
  visibleWarnings: staleBridgeWarnings,
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(nonCompactPhotoshopFailure.compactUserMessage, null, 'complex Photoshop edit does not use Save for Web compact copy');
assert.equal(nonCompactPhotoshopFailure.shouldRecoverOutcome, true, 'complex Photoshop failure keeps normal recovery available');
assert.equal(nonCompactPhotoshopFailure.hideComputerHandoff, false, 'complex Photoshop failure keeps handoff details available');

console.log('All chat computer outcome UX smoke cases passed.');
