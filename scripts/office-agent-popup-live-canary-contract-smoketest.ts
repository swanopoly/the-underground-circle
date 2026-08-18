/**
 * Offline contract for the opt-in authenticated Office Agent popup canary.
 *
 * This smoke never opens a browser, reads credentials, or mutates Supabase.
 * It pins the safety envelope and the real-browser assertions that the live
 * disposable-fixture canary must execute when an operator opts in.
 *
 * Run: npx tsx scripts/office-agent-popup-live-canary-contract-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const canary = read('scripts/office-authenticated-local-e2e.mjs');
const packageJson = read('package.json');
const app = read('App.tsx');
const supabase = read('src/lib/supabase.ts');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const layout = read('src/screens/circles/tabs/office/useAgentPanelLayout.ts');
const floatingChat = read('src/components/FloatingChat.tsx');

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

function section(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  check(startAt >= 0, `source marker exists: ${start}`);
  check(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const popupLane = section(
  canary,
  'async function runAgentPopupCanary(session)',
  'async function cleanupImpl()',
);
const fixtureLane = section(
  canary,
  'let result = null;',
  'let cleanupFailure = null;',
);

check(
  canary.includes("if (process.env.RUN_LIVE_OFFICE_E2E !== '1')")
    && canary.includes('OFFICE_E2E_EXPECTED_PROJECT_REF')
    && canary.includes('expectedProjectRef !== supabaseProjectRef')
    && canary.includes("process.env.OFFICE_E2E_ALLOW_DISPOSABLE_FIXTURE !== '1'")
    && canary.includes("!isLocalAppTarget && process.env.RUN_REMOTE_OFFICE_E2E !== '1'"),
  'the authenticated browser canary requires live, exact-project, destructive-fixture, and remote-target acknowledgements',
);
check(
  packageJson.includes('"smoke:office-agent-popup-live-canary-contract": "npx tsx scripts/office-agent-popup-live-canary-contract-smoketest.ts"')
    && packageJson.includes('smoke:office-agent-panel-native-layout && npm run smoke:office-agent-popup-live-canary-contract && npm run smoke:office-agent-panel-safety')
    && packageJson.includes('"e2e:office-authenticated-local": "node scripts/office-authenticated-local-e2e.mjs"'),
  'the offline contract is package-wired while the live package command cannot silently supply its opt-in acknowledgement',
);
check(
  fixtureLane.indexOf("managementDatabaseQuery('select 1 as cleanup_authority_ready;')")
    < fixtureLane.indexOf("supabaseRequest('/auth/v1/signup'"),
  'cleanup authority is proven before the disposable user is created',
);
check(
  canary.includes('await cleanup();')
    && canary.includes("cleanupComplete ? null : { email, userId, circleId }"),
  'verified cleanup and an exact recovery marker remain mandatory',
);
check(
  canary.includes("where id = ${userSelector} and email = '${escapedEmail}' limit 2;")
    && canary.includes("where id = '${circleId}'::uuid and created_by = ${userSelector} limit 2;")
    && canary.includes("delete from public.circles where id = '${circleId}'::uuid and created_by = ${userSelector};")
    && canary.includes("delete from auth.users where id = ${userSelector} and email = '${escapedEmail}';")
    && !canary.includes("where id = '${circleId}'::uuid or created_by"),
  'management cleanup proves exact random user and circle ownership and never widens a returned id with OR',
);

check(
  popupLane.includes("viewport: { width: 1180, height: 820 }")
    && popupLane.includes("reducedMotion: 'reduce'"),
  'the popup lane starts in a real reduced-motion landscape browser context',
);
check(
  (popupLane.match(/openAuthenticatedOffice\(/g) || []).length === 2
    && popupLane.includes("'agent-popup-tab-a'")
    && popupLane.includes("'agent-popup-tab-b'")
    && popupLane.includes('{ seedSession: false }'),
  'two tabs share one seeded same-origin browser context without clearing each other\'s auth storage',
);
check(
  canary.includes("'[aria-label=\"Open OpenSwan agent panel\"]:visible'")
    && popupLane.includes("agent: 'OpenSwan'"),
  'the lane opens the immutable built-in OpenSwan projection and creates no disposable agent row',
);
check(
  !popupLane.includes('supabaseRequest(')
    && !popupLane.includes('managementDatabaseQuery(')
    && !popupLane.includes('.from(')
    && !popupLane.includes('fetch('),
  'the runner issues no direct agent/provider/application-data control mutation inside the lane; routine app background writes stay on the disposable fixture',
);

check(
  canary.includes("role: root.getAttribute('role')")
    && canary.includes("ariaModal: root.getAttribute('aria-modal')")
    && canary.includes("titleId !== 'uc-agent-panel-title'")
    && canary.includes("evidence.title !== 'OpenSwan'"),
  'live evidence verifies one exact labelled modal dialog',
);
check(
  canary.includes('root.contains(document.activeElement)')
    && canary.includes("document.activeElement?.getAttribute('aria-label') === 'Open OpenSwan agent panel'"),
  'opening contains focus and closing restores it to the semantic opener',
);
check(
  canary.includes("await page.keyboard.press('Tab');")
    && canary.includes("await page.keyboard.press('Shift+Tab');")
    && canary.includes("await page.keyboard.press('Escape');")
    && canary.includes('hitsBackdrop: Boolean(hit && (hit === backdrop || backdrop.contains(hit)))')
    && canary.includes('await page.mouse.click(clickPoint.x, clickPoint.y);')
    && popupLane.includes('openFloatingChatBehindOffice(firstPage)')
    && canary.includes("document.getElementById('section-floating-chat')")
    && canary.includes('floatingChatBackdropHit'),
  'the live centered dialog wraps focus and proves Escape plus real header-area and visible floating-Chat backdrop blocking',
);
check(
  floatingChat.includes('zIndex: 9000')
    && canary.includes('!Number.isFinite(floatingChatZIndex)')
    && canary.includes('backdropZIndex <= floatingChatZIndex')
    && canary.includes('panelZIndex <= backdropZIndex'),
  'the live hit test rejects a modal backdrop below floating Chat and a panel below its backdrop',
);
check(
  popupLane.includes('setViewportSize({ width: 820, height: 1180 })')
    && popupLane.includes('setViewportSize({ width: 1180, height: 820 })')
    && popupLane.includes("responsiveWebTabletViewports: ['1180x820', '820x1180', '1180x820']"),
  'one open popup crosses the web desktop breakpoint in both rotation directions',
);
check(
  canary.includes('evidence.rect.right > evidence.viewport.width + margin')
    && canary.includes('evidence.rect.bottom > evidence.viewport.height + margin')
    && popupLane.includes("assertAgentPopupEvidence(portraitEvidence, 'Portrait Agent popup', false)")
    && popupLane.includes("assertAgentPopupEvidence(landscapeEvidence, 'Restored landscape Agent popup', true)"),
  'each rotation proves viewport containment and responsive dock visibility',
);
check(
  popupLane.includes("getByRole('img', { name: 'Appearance preview for OpenSwan' })")
    && popupLane.includes("element.getAnimations({ subtree: true })")
    && canary.includes("matchMedia('(prefers-reduced-motion: reduce)').matches")
    && canary.includes('hasMotion(evidence.backdropTransitionDuration)'),
  'reduced motion is checked at media, dialog/backdrop, and live Customize-preview levels',
);

check(
  popupLane.includes('const refreshReceipts = await settleWithin(Promise.all([')
    && popupLane.includes('refreshDisposableSessionInTab(firstPage, userId)')
    && popupLane.includes('refreshDisposableSessionInTab(secondPage, userId)')
    && popupLane.includes("]), 30_000, 'two-tab disposable session refresh');"),
  'both real tabs request a bounded concurrent refresh instead of serially simulating a lifecycle',
);
check(
  canary.includes('const client = globalThis.__supabaseClient;')
    && canary.includes('!client?.auth?.refreshSession || !navigator.locks')
    && canary.includes("event !== 'TOKEN_REFRESHED'")
    && canary.includes("entry?.event === 'TOKEN_REFRESHED' && entry.userMatches === true")
    && supabase.includes('Do not override Auth\'s lock')
    && supabase.includes('autoRefreshToken: true'),
  'the live lane exercises the app Supabase client with its default cross-tab Web Lock and observes exact-user refresh events',
);
check(
  (popupLane.match(/selectAgentCustomize\(/g) || []).length === 2
    && popupLane.includes('!preRefreshFirstEvidence.customizeSelected || !preRefreshSecondEvidence.customizeSelected')
    && !popupLane.includes('accessTokenRotated'),
  'both tabs hold a non-Overview route before refresh and do not use token-string inequality as a lifecycle oracle',
);
check(
  canary.includes("persisted = parsed?.currentSession || parsed?.session || parsed;")
    && canary.includes('current.data.session.access_token === persisted?.access_token'),
  'each client must converge to the shared persisted session without exposing token material in the receipt',
);
check(
  popupLane.includes("multiTabAuthorityRefresh: 'converged'")
    && popupLane.includes('!refreshedFirstEvidence.overviewSelected || !refreshedSecondEvidence.overviewSelected')
    && canary.includes("getByLabel(/^(Pause|Resume) OpenSwan$/)")
    && (popupLane.match(/waitForExactPopupAuthorityReady\(/g) || []).length >= 4
    && panel.includes('const contentKey = `${panelScopeKey}:${panelTab}`;')
    && panel.includes("? current\n      : { scopeKey: panelScopeKey, tab: 'overview' }"),
  'an exact token-generation change remounts scoped content, returns both tabs to Overview, and restores authenticated control reads',
);
check(
  app.includes("} else if (event === 'SIGNED_OUT')")
    && app.includes('Supabase delivers remote and cross-tab sign-outs through this path.'),
  'the app retains an explicit cross-tab signed-out retirement path beyond this refresh canary',
);
check(
  canary.includes('/\\/auth\\/v1\\//i.test(requestUrl)')
    && popupLane.includes('essentialRequestFailures.length > 0')
    && popupLane.includes('pageErrors.length > 0')
    && popupLane.includes('serverErrors.length > 0')
    && popupLane.includes("7_500,\n      'Agent popup evidence screenshot',"),
  'auth/app request failures, uncaught errors, essential 5xx responses, and a stalled evidence capture fail the live lane',
);

check(
  panel.includes("const supportsDockedPanel = !!isDesktop && Platform.OS === 'web';")
    && shell.includes("if (Platform.OS !== 'web' && panelMode === 'center')")
    && shell.includes("animationType={reduceMotion ? 'none' : 'fade'}")
    && layout.includes('const measuredViewport = useWindowDimensions();'),
  'native tablet safety remains source-pinned to a live viewport and a reduced-motion Modal boundary',
);
check(
  popupLane.includes('responsiveWebTabletViewports')
    && !popupLane.includes('nativeTabletVerified')
    && !popupLane.includes('voiceOverVerified')
    && !popupLane.includes('talkBackVerified')
    && popupLane.includes('headerAreaBackdropIsolation')
    && !popupLane.includes('modalIsolation'),
  'the browser receipt names its tested backdrop areas and does not overclaim full native or screen-reader isolation',
);

console.log(`office agent popup live-canary contract smoke passed (${assertions} assertions)`);
console.log('native simulator/device rotation plus VoiceOver/TalkBack remains a separate manual or device-harness gate');
