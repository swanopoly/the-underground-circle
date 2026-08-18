import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const xpFeed = read('src/components/rpg/XPEventFeed.tsx');

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  assert.ok(condition, message);
};

for (const marker of [
  'type TerminalProfileLoadState =',
  "| 'refresh-needed'",
  "| 'outcome-unknown'",
  "setProfileLoadState('loading')",
  'syncAgentIdentitiesFromServerExact(exactIdentityAuthority)',
  "if (!serverResult.ok) {\n          setProfileLoadState('error')",
  "setProfileLoadState('ready')",
  'Retry loading exact terminal profile',
  'setProfileReloadGeneration(value => value + 1)',
  "profileLoadState !== 'ready'",
]) {
  check(terminal.includes(marker), `Terminal profile wires ${marker}`);
}
check(
  terminal.indexOf("profileLoadState === 'refresh-needed'") < terminal.indexOf('accessibilityLabel="Terminal profile model"')
    && terminal.indexOf("profileLoadState === 'outcome-unknown'") < terminal.indexOf('accessibilityLabel="Terminal profile model"')
    && terminal.indexOf("profileLoadState === 'error'") < terminal.indexOf('accessibilityLabel="Terminal profile model"')
    && terminal.includes('saved on the server, but this view could not refresh')
    && terminal.includes('outcome could not be verified')
    && terminal.includes(") : (\n          <>"),
  'Terminal renders editable profile fields only in the verified-ready branch and makes partial or unknown receipts reload-only',
);
check(
  terminal.includes('latestIdentityRequestKeyRef.current !== capturedRequestKey')
    && terminal.includes('latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken')
    && terminal.includes('!isIdentityAuthorityCurrent(capturedAuthority)'),
  'Terminal exact reads are fenced across subject, bearer, and authority generation',
);

for (const marker of [
  "type SyncState = 'locked' | 'loading'",
  "setState('locked')",
  "label: 'LOCKED'",
  "setMainAgentStatus('loading')",
  'syncAgentIdentitiesFromServerExact(exactIdentityAuthority)',
  "if (!serverResult.ok) {\n          setMainAgentStatus('error')",
  "setMainAgentStatus('ready')",
  'const mainAgentDisabled = !exactIdentityAuthority || !mainAgentVerified || isMainAgent || mainAgentBusy',
  'disabled={mainAgentDisabled}',
  'Retry loading main Office agent status',
  'setMainAgentReloadGeneration(value => value + 1)',
]) {
  check(overview.includes(marker), `Overview wires ${marker}`);
}
check(
  overview.includes("receipt.error === 'outcome_unknown' || receipt.serverSaved === null")
    && overview.includes('receipt.serverSaved === true && !receipt.localSaved')
    && overview.includes('!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true')
    && overview.includes("setMainAgentStatus('outcome-unknown')")
    && overview.includes("setMainAgentStatus('refresh-needed')")
    && overview.includes('latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken')
    && overview.includes('!isIdentityAuthorityCurrent(capturedAuthority)'),
  'Set-as-main requires a durable local receipt, distinguishes uncertain refresh states, and rejects stale authority results',
);

for (const marker of [
  'AccessibilityInfo.isReduceMotionEnabled()',
  "AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)",
  'const [reduceMotion, setReduceMotion] = useState(true)',
  'subscription.remove()',
  'slideY.stopAnimation()',
  'rowOpacity.stopAnimation()',
  'if (!isNew || reduceMotion)',
  'slideY.setValue(0)',
  'rowOpacity.setValue(1)',
  'return () => entranceAnimation.stop()',
  'reduceMotion={reduceMotion}',
]) {
  check(xpFeed.includes(marker), `XP feed reduced motion wires ${marker}`);
}
check(
  xpFeed.indexOf('if (!isNew || reduceMotion)') < xpFeed.indexOf('const entranceAnimation = Animated.parallel(['),
  'XP entrance motion starts only after the reduced-motion guard',
);
check(
  xpFeed.includes('nestedScrollEnabled')
    && xpFeed.includes('accessibilityLabel="Recent XP events"'),
  'the bounded XP feed remains reachable inside the panel scroll owner on Android and has an accessible name',
);

console.log(`office agent read-state and reduced-motion smoke passed (${assertions} assertions)`);
