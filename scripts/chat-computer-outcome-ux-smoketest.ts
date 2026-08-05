import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildChatComputerOutcomePresentation,
  isCompactDirectImageConversionBridgeFailure,
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

function visibleText(value: ReturnType<typeof buildChatComputerOutcomePresentation>): string {
  return [
    value.compactUserMessage || '',
    value.warningBlock,
    value.blockerList.join('\n'),
    value.nextSteps.join('\n'),
  ].join('\n');
}

function assertNoTechnicalLeak(value: ReturnType<typeof buildChatComputerOutcomePresentation>, pattern: RegExp, label: string) {
  assert.doesNotMatch(visibleText(value), pattern, label);
}

const cancelledOutcome = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'cancelled',
  outcomeMessage: 'Tool transport failed after STOP.',
  rawWarnings: ['desktop.launch_app failed', 'retry this action'],
  visibleWarnings: ['desktop.launch_app failed', 'retry this action'],
  preflightBlockers: ['Photoshop was not observed'],
  preflightWarnings: ['Observe before action'],
  groundingBlockers: ['window state missing'],
  capabilityBlockers: ['desktop bridge unavailable'],
  capabilityPhase: 'failed',
});
assert.equal(cancelledOutcome.compactUserMessage, 'Stopped.', 'cancelled outcome uses compact neutral copy');
assert.equal(cancelledOutcome.shouldRecoverOutcome, false, 'cancelled outcome never launches failure recovery');
assert.equal(cancelledOutcome.hideRecoveryDetails, true, 'cancelled outcome hides recovery details');
assert.equal(cancelledOutcome.hideComputerHandoff, true, 'cancelled outcome hides stale handoff data');
assert.equal(cancelledOutcome.hideComputerTaskStatus, true, 'cancelled outcome clears the durable task card');
assert.deepEqual(cancelledOutcome.blockerList, [], 'cancelled outcome carries no blockers');
assert.deepEqual(cancelledOutcome.nextSteps, [], 'cancelled outcome proposes no retry');
assert.equal(cancelledOutcome.warningBlock, '', 'cancelled outcome suppresses warning prose');

const chatTabSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
const cancellationStart = chatTabSource.indexOf("if (computerTaskStatus === 'cancelled')");
const browserAutoStart = chatTabSource.indexOf('const browserAutoStart =', cancellationStart);
const cancellationEnd = chatTabSource.indexOf('// WI-1: zero-tap auto-start.', cancellationStart);
assert(cancellationStart >= 0 && cancellationEnd > cancellationStart, 'Chat has an explicit typed cancellation terminal');
assert(browserAutoStart > cancellationEnd, 'Chat terminalizes cancellation before any browser-plan auto-start decision');
const cancellationSection = chatTabSource.slice(cancellationStart, cancellationEnd);
assert.match(cancellationSection, /setComputerTaskState\(null\)[\s\S]*clearComputerTaskState\(circleId, activeThreadId\)/,
  'Chat clears in-memory and durable task state on cancellation');
assert.match(cancellationSection, /status:\s*'cancelled'[\s\S]*addBotMessage\('Stopped\.'/,
  'Chat records a typed cancelled terminal and concise stop acknowledgement');
assert.doesNotMatch(cancellationSection, /diagnoseComputerTaskCheckpointFailure|startMainChatFailureRecoveryPayload|recoveryOptions/,
  'Chat cancellation exits without recovery');

const exactApprovalWait = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'waiting_approval',
  outcomeMessage: 'Filed approval for chat.run_computer_task.',
  approvalCategory: 'filed',
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});
assert.equal(exactApprovalWait.statePhase, 'awaiting_approval', 'filed exact approval remains an awaiting-approval state');
assert.equal(exactApprovalWait.shouldRecoverOutcome, false, 'filed exact approval does not launch generic failure recovery');
assert.equal(exactApprovalWait.hideRecoveryDetails, true, 'filed exact approval hides the failure-recovery wall');
assert.equal(exactApprovalWait.hideComputerHandoff, false, 'filed exact approval keeps the compact task card visible');
assert.deepEqual(exactApprovalWait.nextSteps, ['Approve this exact plan to continue automatically.']);

const exactApprovalServiceError = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'waiting_approval',
  outcomeMessage: 'Approval lookup failed.',
  approvalCategory: 'error',
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});
assert.equal(exactApprovalServiceError.statePhase, 'blocked', 'approval service errors remain blocked rather than pretending to await a person');
assert.equal(exactApprovalServiceError.shouldRecoverOutcome, true, 'approval service errors retain bounded recovery');

const exactPostDispatchUnknown = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'partial',
  outcomeMessage: 'The 600x600 Photoshop create request was dispatched, but its result could not be verified. The action will not be replayed automatically.',
  replayPolicy: 'manual_verify_only',
  mutationDispatched: true,
  verificationOnlyTools: ['desktop.photoshop_document_status'],
  rawWarnings: ['Photoshop document creation outcome is unknown after dispatch; automatic replay is disabled'],
  visibleWarnings: ['Photoshop document creation outcome is unknown after dispatch; automatic replay is disabled'],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});
assert.equal(exactPostDispatchUnknown.shouldRecoverOutcome, false, 'post-dispatch exact mutation cannot become generic retry recovery');
assert.equal(exactPostDispatchUnknown.hideRecoveryDetails, true, 'post-dispatch exact mutation hides every replay option');
assert.equal(exactPostDispatchUnknown.hideComputerTaskStatus, false, 'manual-verification-only outcome remains visible after refresh');
assert.equal(exactPostDispatchUnknown.hideComputerHandoff, false, 'manual-verification-only handoff persists its no-replay contract');
assert.match(exactPostDispatchUnknown.compactUserMessage || '', /will not send it again|duplicate document/i);
assert.deepEqual(
  exactPostDispatchUnknown.nextSteps,
  ['Check the active document with Photoshop document status; do not run Create again.'],
  'manual verification permits only read-only Photoshop status',
);

const textOnlyNoReplayWarning = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'partial',
  outcomeMessage: 'The action will not be replayed automatically.',
  rawWarnings: ['automatic replay is disabled'],
  visibleWarnings: ['automatic replay is disabled'],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});
assert.equal(
  textOnlyNoReplayWarning.shouldRecoverOutcome,
  true,
  'untrusted warning prose alone cannot forge the structured no-replay policy',
);

assert(
  isQuietSuccessfulComputerTaskWarning('photoshop_export_proof stale_bridge; used save_for_web_fallback'),
  'successful Save for Web fallback stale warning is quiet',
);

assert(
  !isCompactPhotoshopSaveForWebBridgeFailure(
    screenshotSaveForWebTask,
    'failed',
    staleBridgeMessage,
    staleBridgeWarnings,
  ),
  'direct screenshot export bridge failure does not use Photoshop Save for Web copy',
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
assert.equal(compactFailure.shouldRecoverOutcome, true, 'Photoshop rename/export bridge failure keeps generic recovery cards');
assert.equal(compactFailure.hideComputerHandoff, false, 'Photoshop rename/export bridge failure keeps handoff details available');
assert.equal(compactFailure.hideRecoveryDetails, false, 'Photoshop rename/export bridge failure keeps recovery option wall');
assert.equal(compactFailure.hideComputerTaskStatus, false, 'Photoshop rename/export bridge failure keeps a reconnect status available');
assert.equal(compactFailure.compactUserMessage, null, 'Photoshop rename/export bridge failure does not use direct conversion compact copy');

const directImageConversionTask = 'on the desktop open pearsoncdjr-img in photoshop and save it as a png';
const directConversionBridgeFailureMessage = 'I could not finish the Photoshop PNG export because the desktop bridge needs to reconnect before Photoshop actions can continue.';
const directConversionBridgeFailureWarnings = [
  'desktop_photoshop_export_proof failed with stale_bridge',
  'Direct image format conversion is blocked',
];

assert(
  isCompactDirectImageConversionBridgeFailure(
    directImageConversionTask,
    'failed',
    directConversionBridgeFailureMessage,
    directConversionBridgeFailureWarnings,
  ),
  'direct image conversion bridge failure is compactable separately from Photoshop Save for Web',
);

assert(
  !isCompactPhotoshopSaveForWebBridgeFailure(
    directImageConversionTask,
    'failed',
    directConversionBridgeFailureMessage,
    directConversionBridgeFailureWarnings,
  ),
  'direct image conversion bridge failure does not use Photoshop Save for Web copy',
);

const directConversionCompactFailure = buildChatComputerOutcomePresentation({
  task: directImageConversionTask,
  outcomeStatus: 'failed',
  outcomeMessage: directConversionBridgeFailureMessage,
  rawWarnings: directConversionBridgeFailureWarnings,
  visibleWarnings: directConversionBridgeFailureWarnings,
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(directConversionCompactFailure.statePhase, 'blocked', 'direct image conversion reconnect failure stays blocked');
assert.equal(directConversionCompactFailure.shouldRecoverOutcome, false, 'direct image conversion reconnect failure suppresses generic recovery cards');
assert(directConversionCompactFailure.compactUserMessage?.includes('desktop bridge is not ready'), 'direct image conversion reconnect copy explains the customer blocker');
assert.doesNotMatch(directConversionCompactFailure.compactUserMessage || '', /desktop\.convert_image|npm run bridge|\/desktop\//i, 'direct image conversion reconnect copy hides tool and endpoint details');
assert(!directConversionCompactFailure.compactUserMessage?.includes('Save for Web'), 'direct image conversion reconnect copy avoids Save for Web');
assert(directConversionCompactFailure.blockerList.some((blocker) => /folder access/i.test(blocker)), 'direct image conversion reconnect stores customer blocker');
assert(directConversionCompactFailure.nextSteps.some((step) => /Reconnect the desktop bridge/i.test(step)), 'direct image conversion reconnect stores direct next step');

const directConversionNotFoundFailure = buildChatComputerOutcomePresentation({
  task: 'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg',
  outcomeStatus: 'failed',
  outcomeMessage: 'I could not find that image. Check the filename or send the exact file path, then try again.',
  rawWarnings: [
    'desktop.convert_image preflight failed (file_not_found): No matching source image named Gemini_Generated_Image_lppqo8lppqo8lppq.png was found in the allowed folders.',
    'desktop.file_search:~/Desktop:ok',
    'desktop.file_stat:source_not_verified',
  ],
  visibleWarnings: [
    'desktop.convert_image preflight failed (file_not_found): No matching source image named Gemini_Generated_Image_lppqo8lppqo8lppq.png was found in the allowed folders.',
  ],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(directConversionNotFoundFailure.statePhase, 'blocked', 'direct image conversion missing source stays blocked');
assert.equal(directConversionNotFoundFailure.shouldRecoverOutcome, false, 'direct image conversion missing source suppresses generic recovery cards');
assert(directConversionNotFoundFailure.compactUserMessage?.includes('could not find the image'), 'direct image conversion missing source keeps not-found copy');
assert(!directConversionNotFoundFailure.compactUserMessage?.includes('desktop bridge is not ready'), 'direct image conversion missing source does not show reconnect copy');
assert(directConversionNotFoundFailure.blockerList.some((blocker) => /Source image could not be found/i.test(blocker)), 'direct image conversion missing source stores not-found blocker');
assert.deepEqual(directConversionNotFoundFailure.nextSteps, ['Send the exact image path or refresh the file search, then retry the conversion once.'], 'direct image conversion missing source stores exact-path retry step');
assertNoTechnicalLeak(
  directConversionNotFoundFailure,
  /desktop\.convert_image|desktop\.file_search|desktop\.file_stat|file_not_found|allowed folders/i,
  'direct image conversion missing source compact copy hides tool and path-resolution internals',
);

const successfulFallback = buildChatComputerOutcomePresentation({
  task: screenshotSaveForWebTask,
  outcomeStatus: 'completed',
  outcomeMessage: 'Photoshop proof export endpoint was unavailable, so I used Save for Web. Saved /Users/cswanson/Desktop/lmao.png (png, 12345 bytes).',
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
assert(!successfulFallback.compactUserMessage?.includes('Photoshop'), 'successful direct image proof does not claim Photoshop opened');
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
    '11. Verified output file_stat for /Users/cswanson/Desktop/lmao.png with 12345 bytes.',
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

const falseSuccessWithoutProof = buildChatComputerOutcomePresentation({
  task: 'on the desktop open pearsoncdjr-img in photoshop and save it as a png',
  outcomeStatus: 'completed',
  outcomeMessage: 'Done. I opened the image in Photoshop and saved the renamed image file.',
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(falseSuccessWithoutProof.statePhase, 'blocked', 'local image export without file proof is blocked');
assert.equal(falseSuccessWithoutProof.shouldRecoverOutcome, true, 'local image export without file proof triggers recovery');
assert.equal(falseSuccessWithoutProof.hideRecoveryDetails, false, 'missing-proof local image export keeps recovery details available');
assert.equal(falseSuccessWithoutProof.hideComputerHandoff, false, 'missing-proof local image export keeps handoff details available');
assert.equal(falseSuccessWithoutProof.hideComputerTaskStatus, false, 'missing-proof local image export keeps task status visible');
assert(falseSuccessWithoutProof.compactUserMessage?.includes('could not verify'), 'missing-proof local image export replaces false done copy');
assert(falseSuccessWithoutProof.blockerList.some((blocker) => /Saved-image proof/i.test(blocker)), 'missing-proof local image export stores proof blocker');
assert(falseSuccessWithoutProof.nextSteps.some((step) => /verify the saved image/i.test(step)), 'missing-proof local image export stores direct conversion next step');
assert.doesNotMatch(falseSuccessWithoutProof.compactUserMessage || '', /desktop\.convert_image|desktop\.file_stat|byte-size/i, 'missing-proof local image export hides tool contract details');

const savedPathWithoutStatProof = buildChatComputerOutcomePresentation({
  task: 'open screenshot from desktop and save it as lmao.png',
  outcomeStatus: 'completed',
  outcomeMessage: 'Saved /Users/cswanson/Desktop/lmao.png.',
  rawWarnings: [],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(savedPathWithoutStatProof.statePhase, 'blocked', 'saved-path-only image export without file proof is blocked');
assert.equal(savedPathWithoutStatProof.shouldRecoverOutcome, true, 'saved-path-only image export without file proof triggers recovery');
assert(savedPathWithoutStatProof.compactUserMessage?.includes('could not verify'), 'saved-path-only image export replaces optimistic saved copy');
assert.doesNotMatch(savedPathWithoutStatProof.compactUserMessage || '', /desktop\.file_stat|desktop\.convert_image|byte-size/i, 'saved-path-only image export hides tool proof internals');

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

assert.equal(completedWithPreflightDiagnostics.statePhase, 'blocked', 'completed Photoshop export without proof is blocked');
assert.equal(completedWithPreflightDiagnostics.shouldRecoverOutcome, true, 'completed Photoshop export without proof launches recovery');
assert.equal(completedWithPreflightDiagnostics.hideRecoveryDetails, false, 'completed Photoshop export without proof keeps recovery details available');
assert.equal(completedWithPreflightDiagnostics.hideComputerHandoff, false, 'completed Photoshop export without proof keeps technical handoff available');
assert.equal(completedWithPreflightDiagnostics.hideComputerTaskStatus, false, 'completed Photoshop export without proof keeps status visible');
assert(completedWithPreflightDiagnostics.compactUserMessage?.includes('could not verify'), 'completed Photoshop export without proof replaces false done copy');
assert(completedWithPreflightDiagnostics.blockerList.some((blocker) => /Saved-image proof/i.test(blocker)), 'completed Photoshop export without proof stores proof blocker');
assert(completedWithPreflightDiagnostics.nextSteps.some((step) => /verify the saved image/i.test(step)), 'completed Photoshop export without proof stores verification next step');

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
// Preflight WARNINGS are standing advisory guidance that fires on every app
// task ("control surface order required", "inventory before edit") — the
// user cannot act on them, so they never render under "Blockers:". They stay
// in metadata and the model prompt (2026-07-31, user-output honesty).
assert(!failedWithPreflightDiagnostics.blockerList.some((blocker) => /Fresh app evidence/i.test(blocker)), 'failed task keeps advisory preflight warnings OUT of the user blocker list');

const failedWordPressAutomation = buildChatComputerOutcomePresentation({
  task: 'Update the Dealer Inspire DI Slides Promaster expiration in wp-admin',
  outcomeStatus: 'failed',
  outcomeMessage: 'WP update di_slide failed: HTTP 403 rest_forbidden. Raw endpoint: /wp-json/wp/v2/di_slide/14030',
  rawWarnings: ['wp.update_post failed before proof-after verification.'],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedWordPressAutomation.shouldRecoverOutcome, true, 'failed WordPress automation keeps recovery active');
assert.equal(failedWordPressAutomation.hideRecoveryDetails, true, 'failed WordPress automation hides recovery details from customer view');
assert.equal(failedWordPressAutomation.hideComputerHandoff, true, 'failed WordPress automation hides technical handoff from customer view');
assert.equal(failedWordPressAutomation.hideComputerTaskStatus, true, 'failed WordPress automation hides task status from customer view');
assert(failedWordPressAutomation.compactUserMessage?.includes('could not finish the WordPress automation'), 'failed WordPress automation gets compact customer copy');
assert.doesNotMatch(failedWordPressAutomation.compactUserMessage || '', /HTTP 403|rest_forbidden|wp-json|WP update/i, 'failed WordPress automation compact copy hides endpoint/tool noise');
assert(failedWordPressAutomation.blockerList.some((blocker) => /WordPress automation stopped/i.test(blocker)), 'failed WordPress automation stores a plain blocker');
assert(failedWordPressAutomation.nextSteps.some((step) => /Technical details were saved/i.test(step)), 'failed WordPress automation stores support-safe recovery evidence step');

const failedWordPressSourceIntelligence = buildChatComputerOutcomePresentation({
  task: 'Open wp-admin and inspect the Plugins page before installing SEO tools',
  outcomeStatus: 'failed',
  outcomeMessage: 'browser.wp_admin_source_intelligence failed: Unknown /browser/page_source endpoint. HTTP 404',
  rawWarnings: ['wp_admin_source_intelligence blocked before DOM proof. Raw endpoint: /browser/page_source'],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedWordPressSourceIntelligence.shouldRecoverOutcome, true, 'source intelligence failure keeps recovery active');
assert.equal(failedWordPressSourceIntelligence.hideRecoveryDetails, true, 'source intelligence failure hides recovery details from customer view');
assert.equal(failedWordPressSourceIntelligence.hideComputerHandoff, true, 'source intelligence failure hides technical handoff from customer view');
assert.equal(failedWordPressSourceIntelligence.hideComputerTaskStatus, true, 'source intelligence failure hides task status from customer view');
assert(failedWordPressSourceIntelligence.compactUserMessage?.includes('could not finish the WordPress automation'), 'source intelligence failure gets compact customer copy');
assertNoTechnicalLeak(
  failedWordPressSourceIntelligence,
  /browser\.wp_admin_source_intelligence|wp_admin_source_intelligence|\/browser\/page_source|HTTP 404|wp-json|rest_forbidden/i,
  'source intelligence compact copy hides tool and endpoint noise',
);

const failedCredentialAutomation = buildChatComputerOutcomePresentation({
  task: 'Log into WordPress with my saved credentials',
  outcomeStatus: 'failed',
  outcomeMessage: 'credentials.get failed: vault_grant_missing credentialId=abc123 login_url=https://dealer.example/wp-login.php',
  rawWarnings: ['browser.fill_credential_field blocked before origin proof; credentialId=abc123 login_url=https://dealer.example/wp-login.php'],
  visibleWarnings: ['browser.fill_credential_field blocked before origin proof; credentialId=abc123 login_url=https://dealer.example/wp-login.php'],
  preflightBlockers: ['vault_grant_missing credentialId=abc123'],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedCredentialAutomation.hideRecoveryDetails, true, 'credential failure hides recovery details from customer view');
assert.equal(failedCredentialAutomation.hideComputerHandoff, true, 'credential failure hides technical handoff from customer view');
assert.equal(failedCredentialAutomation.hideComputerTaskStatus, true, 'credential failure hides task status from customer view');
assert(failedCredentialAutomation.compactUserMessage?.includes('login step safely'), 'credential failure gets compact customer copy');
assertNoTechnicalLeak(
  failedCredentialAutomation,
  /credentials\.get|credentialId|login_url|vault_grant_missing|browser\.fill_credential_field/i,
  'credential failure visible copy hides tool, vault, and URL internals',
);

const failedAppAutomation = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and click the Save button',
  outcomeStatus: 'failed',
  outcomeMessage: 'desktop.click_element failed: a11y_path_stale AXPath=0.1.2 pid=991 /desktop/a11y_tree',
  rawWarnings: ['desktop.click_element failed with a11y_path_stale pid=991'],
  visibleWarnings: ['desktop.click_element failed with a11y_path_stale pid=991'],
  preflightBlockers: ['AXPath=0.1.2 stale'],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedAppAutomation.hideRecoveryDetails, true, 'app automation failure hides recovery details from customer view');
assert(failedAppAutomation.compactUserMessage?.includes('app action'), 'app automation failure gets compact customer copy');
assertNoTechnicalLeak(
  failedAppAutomation,
  /desktop\.click_element|a11y_path_stale|AXPath|pid=|\/desktop\/a11y_tree/i,
  'app automation visible copy hides bridge and accessibility internals',
);

const failedPhotoshopSequenceWithFileAdvisory = buildChatComputerOutcomePresentation({
  task: 'Open Photoshop and start a new project 600 x 600',
  outcomeStatus: 'blocked',
  outcomeMessage: 'The required local typed tool loop returned no result.',
  rawWarnings: [
    'Research-backed control surface order required: Use Photoshop UXP DOM/app API before semantic desktop fallback.',
    'Photoshop document inventory required: Use desktop.file_stat, desktop.open_path, desktop.photoshop_document_status, and desktop.photoshop_layer_inventory before editing an existing source document.',
  ],
  visibleWarnings: [],
  preflightBlockers: [],
  preflightWarnings: [
    'Photoshop document inventory required: Use desktop.file_stat before editing an existing source document.',
  ],
  groundingBlockers: [],
});

assert.equal(
  failedPhotoshopSequenceWithFileAdvisory.compactUserMessage,
  null,
  'advisory file_stat text does not fabricate compact local-file failure copy for a fileless Photoshop task',
);
assert(
  !failedPhotoshopSequenceWithFileAdvisory.blockerList.some((blocker) => /local file|folder permission|file search/i.test(blocker)),
  'advisory file_stat text does not fabricate a local-file blocker',
);
assert.equal(
  failedPhotoshopSequenceWithFileAdvisory.hideRecoveryDetails,
  false,
  'the real non-file failure remains available to normal recovery',
);

const failedLocalFileAutomation = buildChatComputerOutcomePresentation({
  task: 'Open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the Desktop and make it a jpg',
  outcomeStatus: 'failed',
  outcomeMessage: 'Desktop bridge open path failed: ENOENT File or folder does not exist at /Users/cswanson/Desktop/Gemini_Generated_Image_lppqo8lppqo8lppq.png. desktop.open_path',
  rawWarnings: ['desktop.file_stat EACCES /Users/cswanson/Desktop/report.pdf X-UC-File-Session-Token missing'],
  visibleWarnings: ['desktop.file_stat EACCES /Users/cswanson/Desktop/report.pdf X-UC-File-Session-Token missing'],
  preflightBlockers: ['EPERM /Users/cswanson/Desktop/report.pdf'],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedLocalFileAutomation.hideRecoveryDetails, true, 'local file failure hides recovery details from customer view');
assert(failedLocalFileAutomation.compactUserMessage?.includes('requested local file'), 'local file failure gets compact customer copy');
assert(failedLocalFileAutomation.compactUserMessage?.includes('could not find'), 'missing local file gets not-found copy');
assert.deepEqual(failedLocalFileAutomation.nextSteps, ['Send the exact file path or refresh the file search, then retry once.'], 'missing local file gets a simple retry step');
assertNoTechnicalLeak(
  failedLocalFileAutomation,
  /EACCES|EPERM|ENOENT|\/Users\/|desktop\.open_path|desktop\.file_stat|X-UC-File-Session-Token/i,
  'local file visible copy hides permission, path, and token internals',
);

const failedLocalFilePermission = buildChatComputerOutcomePresentation({
  task: 'Rename report.pdf on my Desktop to final-report.pdf',
  outcomeStatus: 'failed',
  outcomeMessage: 'desktop.file_rename failed: EPERM operation not permitted /Users/cswanson/Desktop/report.pdf',
  rawWarnings: ['X-UC-File-Session-Token missing for desktop.file_rename'],
  visibleWarnings: ['X-UC-File-Session-Token missing for desktop.file_rename'],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedLocalFilePermission.hideRecoveryDetails, true, 'local file permission failure hides recovery details from customer view');
assert(failedLocalFilePermission.compactUserMessage?.includes('folder access'), 'permission local file failure gets folder-access copy');
assert.deepEqual(failedLocalFilePermission.nextSteps, ['Approve the requested folder access, then retry once.'], 'permission local file failure gets a grant-focused retry step');
assertNoTechnicalLeak(
  failedLocalFilePermission,
  /EPERM|operation not permitted|\/Users\/|desktop\.file_rename|X-UC-File-Session-Token/i,
  'local file permission copy hides bridge and token internals',
);

const failedLocalFileAmbiguous = buildChatComputerOutcomePresentation({
  task: 'Open report.pdf from Downloads',
  outcomeStatus: 'failed',
  outcomeMessage: 'Desktop bridge open path needs an exact file match before launch: multiple matches found for report.pdf; choose the exact file before opening. desktop.file_search',
  rawWarnings: ['desktop.file_search found multiple matching paths'],
  visibleWarnings: ['desktop.file_search found multiple matching paths'],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedLocalFileAmbiguous.hideRecoveryDetails, true, 'ambiguous local file failure hides recovery details from customer view');
assert(failedLocalFileAmbiguous.compactUserMessage?.includes('more than one matching local file'), 'ambiguous local file failure gets exact-path copy');
assert.deepEqual(failedLocalFileAmbiguous.nextSteps, ['Send the exact file path for the one you want, then retry once.'], 'ambiguous local file failure gets exact-path retry step');
assertNoTechnicalLeak(
  failedLocalFileAmbiguous,
  /desktop\.file_search|multiple matching paths/i,
  'ambiguous local file copy hides file-search internals',
);

const failedGenericBrowserAutomation = buildChatComputerOutcomePresentation({
  task: 'Open the dealer portal and click Reports',
  outcomeStatus: 'failed',
  outcomeMessage: 'browser.dom_snapshot failed: HTTP 401 token_rejected /browser/dom_snapshot',
  rawWarnings: ['browser.click_role failed after /browser/click_role returned HTTP 404'],
  visibleWarnings: ['browser.click_role failed after /browser/click_role returned HTTP 404'],
  preflightBlockers: [],
  preflightWarnings: [],
  groundingBlockers: [],
});

assert.equal(failedGenericBrowserAutomation.hideRecoveryDetails, true, 'generic browser failure hides recovery details from customer view');
assert(failedGenericBrowserAutomation.compactUserMessage?.includes('browser step'), 'generic browser failure gets compact customer copy');
assertNoTechnicalLeak(
  failedGenericBrowserAutomation,
  /\/browser\/|browser\.dom_snapshot|browser\.click_role|HTTP 40[14]|token_rejected/i,
  'generic browser visible copy hides endpoint and token internals',
);

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
