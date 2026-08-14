import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

const chat = read('src/screens/circles/tabs/ChatTab.tsx');
const hitl = read('src/components/HitlApprovalBanner.tsx');
const runApproval = read('src/components/RunApprovalBanner.tsx');

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  if (!condition) throw new Error(message);
};

check(
  chat.includes('buildChatMinimalRecoveryPresentation({'),
  'Chat must project technical recovery state through the minimal presentation adapter.',
);
check(
  chat.includes('? recoveryPresentation.statusLine'),
  'The default transcript must use one short status without repeating the recovery reason.',
);
check(
  chat.includes('<Text style={styles.messageSourceLabel}>Next step</Text>'),
  'Recovery must present one clearly labelled next step.',
);
check(
  chat.includes('summary={secondaryRecoveryOptions.length > 0 ? `More options (${secondaryRecoveryOptions.length})` : recoveryPresentation.detailsLabel}'),
  'Secondary recovery choices must remain behind a disclosure.',
);
check(
  !chat.includes('getRecoveryOptionActorLabel(option.actor)'),
  'Default recovery cards must not expose internal actor labels.',
);
check(
  !chat.includes('getRecoveryOptionPolicyBadges(option)'),
  'Default recovery cards must not expose approval-policy badges.',
);
check(
  chat.includes('const chatAttentionForDisplay = buildChatAttentionState({'),
  'Chat must keep a presentation-only attention projection.',
);
check(
  chat.includes('!isApprovalRowLive(approval.requested_at, approval.timeout_seconds, Date.now())'),
  'A live approval card must not also appear in the attention strip.',
);
check(
  chat.includes("status={Platform.OS === 'web' && agentMonitorTask ? 'idle' : runStatus}"),
  'The compact monitor must be the only default live task chrome on web.',
);
check(
  chat.includes('const preparedCapabilitySnapshot = buildComputerCapabilityPreparedSnapshot({'),
  'A computer task must capture one prepared capability snapshot.',
);
check(
  chat.includes('preparedSnapshot: preparedCapabilitySnapshot'),
  'Capability audit must consume the prepared task snapshot instead of re-probing independently.',
);
check(
  chat.includes('await hydrateAppResolutionContext(taskBridgeInstanceId);'),
  'App resolution must be rebound to the exact task-start bridge process.',
);
check(
  chat.includes('observedBridgeInstanceId !== expectedBridgeInstanceId'),
  'Installed/running-app evidence must be discarded when the bridge changes during observation.',
);
check(
  chat.indexOf('await hydrateAppResolutionContext(taskBridgeInstanceId);') < chat.indexOf('const preparedCapabilitySnapshot = buildComputerCapabilityPreparedSnapshot({'),
  'Bound app resolution must finish before the immutable task-start snapshot is built.',
);
check(
  !hitl.includes('JSON.stringify(ap.payload'),
  'Legacy approvals must not dump raw payload JSON into the default Chat surface.',
);
check(
  hitl.includes('Technical details are saved with this approval.'),
  'Legacy approvals should acknowledge hidden technical details without exposing them.',
);
check(
  runApproval.includes('One decision for this bounded step.'),
  'Safe grouped approval copy must describe one bounded decision.',
);
check(
  runApproval.includes('Review separately'),
  'A grouped approval must preserve an obvious path to per-action review.',
);

console.log(`chat minimal OpenSwan UX smoke: ${assertions} assertions passed`);
