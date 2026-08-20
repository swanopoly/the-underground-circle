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
const webPortal = read('src/screens/circles/tabs/office/AgentPanelWebPortal.web.tsx');
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
    && canary.includes('OFFICE_E2E_EXPECTED_APP_ARTIFACT_SHA256')
    && canary.includes('expectedProjectRef !== supabaseProjectRef')
    && canary.includes("process.env.OFFICE_E2E_ALLOW_DISPOSABLE_FIXTURE !== '1'")
    && canary.includes("!isLocalAppTarget && process.env.RUN_REMOTE_OFFICE_E2E !== '1'"),
  'the authenticated browser canary requires live, exact-project, destructive-fixture, and remote-target acknowledgements',
);
check(
  canary.includes("!/^[a-f0-9]{64}$/.test(expectedAppArtifactSha256)")
    && canary.includes('/\\/index(?:\\.[cm]?[jt]sx?)?\\.bundle$/i')
    && canary.includes("fetch(entry.url, { cache: 'no-store', credentials: 'same-origin' })")
    && canary.includes("crypto.subtle.digest('SHA-256', body)")
    && canary.includes("appArtifactSha256: crypto.createHash('sha256').update(artifactBinding).digest('hex')")
    && canary.includes('identity?.appArtifactSha256 !== expectedAppArtifactSha256'),
  'the expected app artifact is a real operator-supplied SHA-256 over same-origin entry-resource content, not a tab-only path comparison',
);
check(
  packageJson.includes('"smoke:office-agent-popup-live-canary-contract": "npx tsx scripts/office-agent-popup-live-canary-contract-smoketest.ts"')
    && packageJson.includes('smoke:office-agent-panel-native-layout && npm run smoke:office-agent-popup-live-canary-contract && npm run smoke:office-agent-panel-safety')
    && packageJson.includes('"e2e:office-authenticated-local": "node scripts/office-authenticated-local-e2e.mjs"'),
  'the offline contract is package-wired while the live package command cannot silently supply its opt-in acknowledgement',
);
check(
  fixtureLane.indexOf("managementDatabaseQuery('select 1 as cleanup_authority_ready;')")
    < fixtureLane.indexOf('appArtifactPreflight = await preflightExpectedAppArtifact()')
    && fixtureLane.indexOf('appArtifactPreflight = await preflightExpectedAppArtifact()')
      < fixtureLane.indexOf("supabaseRequest('/auth/v1/signup'"),
  'cleanup authority and the expected app artifact are proven before the disposable user is created',
);
check(
  canary.includes('assertExpectedAppArtifact(record.bundleIdentity, viewportName)')
    && popupLane.includes('firstRecord.bundleIdentity?.appArtifactSha256')
    && popupLane.includes('!== secondRecord.bundleIdentity?.appArtifactSha256')
    && !popupLane.includes('resourceManifestSha256')
    && popupLane.includes('expectedAppArtifactSha256,'),
  'preflight and every authenticated page remain bound to the expected entry artifact while incidental lazy-resource timing cannot create a false mismatch',
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
    && webPortal.includes('createPortal(children, document.body)')
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
  popupLane.includes("getByLabel('Dock agent panel to the right', { exact: true }).click()")
    && popupLane.includes('waitForDockedAgentPopup(firstPage, 480)')
    && popupLane.includes('resizeDockedAgentPopupToMaximum(firstPage)')
    && canary.includes("page.getByLabel('Resize docked agent panel', { exact: true })")
    && canary.includes("await page.keyboard.press('ArrowLeft')")
    && canary.includes("Number(evidence.resizeValueNow) !== 720"),
  'the live lane activates the non-modal dock and verifies its keyboard resize maximum plus semantic value',
);
check(
  popupLane.includes('setViewportSize({ width: 620, height: 900 })')
    && popupLane.includes("localStorage.getItem('uc_agent_panel_side_w_v1') === '540'")
    && popupLane.includes("assertAgentPopupEvidence(compactDockFallbackEvidence, 'Compact fallback for docked Agent popup', false)")
    && popupLane.includes('waitForDockedAgentPopup(firstPage, 540)')
    && popupLane.includes("getByLabel('Open agent panel as a centered pop-up', { exact: true }).click()"),
  'a docked popup crosses to compact modal-sheet semantics, clamps saved width, restores the dock, and can return to centered mode',
);
check(
  canary.includes("root.getAttribute('aria-modal') === null")
    && canary.includes('!backdrop')
    && canary.includes("element.getAttribute('aria-label') === 'Open agent panel as a centered pop-up'")
    && canary.includes('Math.abs(rect.right - innerWidth) <= 1'),
  'docked evidence explicitly rejects modal/backdrop semantics and pins the panel to the live right viewport edge',
);
check(
  popupLane.includes("getByRole('img', { name: 'Appearance preview for OpenSwan' })")
    && popupLane.includes("element.getAnimations({ subtree: true })")
    && shell.includes('testID="agent-panel-backdrop"')
    && canary.includes("document.querySelector('[data-testid=\"agent-panel-backdrop\"]')")
    && canary.includes("matchMedia('(prefers-reduced-motion: reduce)').matches")
    && canary.includes('hasMotion(evidence.backdropTransitionDuration)'),
  'reduced motion is checked at media, dialog/backdrop, and live Customize-preview levels',
);
check(
  canary.includes('async function visitEveryAvailableAgentPanelRoute(page, record)')
    && canary.includes("candidate.getAttribute('aria-label') === 'Agent panel destinations'")
    && canary.includes("candidate.getAttribute('aria-label') === `${groupName} sections`")
    && canary.includes('for (const destinationLabel of destinationLabels)')
    && canary.includes('for (const routeLabel of routeLabels)')
    && canary.includes("return visibleRoutes > 0 || tabpanel?.getAttribute('aria-labelledby') === destinationControl.id;")
    && canary.includes("root.locator('#uc-agent-panel-tabpanel').getAttribute('aria-label')")
    && canary.includes("if (!sectionLabel?.endsWith(' section'))")
    && popupLane.includes('visitEveryAvailableAgentPanelRoute(firstPage, firstRecord)')
    && popupLane.includes('availablePanelRoutes,'),
  'the live canary discovers and visits every route actually advertised by the exact popup capability snapshot',
);
check(
  canary.includes('async function waitForAgentPanelRouteSettled(')
    && canary.includes("destinationControl?.getAttribute('aria-selected') === 'true'")
    && canary.includes("routeControl?.getAttribute('aria-selected') === 'true'")
    && canary.includes("tabpanel?.getAttribute('role') === 'tabpanel'")
    && canary.includes("labelledBy === activeControl?.id")
    && canary.includes('/^Loading\\s+.+(?:…|\\.\\.\\.)$/u')
    && canary.includes('assertVisitedAgentPanelRoute(page, record, destinationLabel'),
  'each discovered route must settle its lazy loader and expose coherent selected-tab and labelled-tabpanel semantics',
);
check(
  canary.includes('await assertPopupSectionHealthy(page, record, `Agent popup route ${label}`);')
    && canary.includes('`Agent popup route ${label} observed non-allowlisted console errors:')
    && popupLane.includes("assertPopupSectionHealthy(firstPage, firstRecord, 'Customize restored after available-route sweep')"),
  'every live route fails immediately on a section fallback, alert, or non-allowlisted console error without invoking route actions',
);
check(
  canary.includes('async function verifyCompactCenteredAgentPopupLifecycle(page, record)')
    && canary.includes('setViewportSize({ width: 390, height: 844 })')
    && canary.includes("assertAgentPopupEvidence(compactEvidence, '390x844 centered Agent popup', false)")
    && canary.includes('compactDocument.scrollWidth > compactDocument.clientWidth + 1')
    && canary.includes('compactDocument.bodyScrollWidth > compactDocument.bodyClientWidth + 1')
    && canary.includes("assertSameAgentPanelRoute(compactRoute, beforeRoute, '390x844 viewport transition')")
    && canary.includes("assertSameAgentPanelRoute(restoredRoute, beforeRoute, '390x844 desktop restoration')")
    && popupLane.includes('verifyCompactCenteredAgentPopupLifecycle(firstPage, firstRecord)')
    && popupLane.includes('compactCenteredLifecycle,'),
  'the same centered popup reaches 390x844 without viewport escape or document overflow and retains its exact route after desktop restoration',
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
  (popupLane.match(/selectAgentCustomize\(/g) || []).length >= 3
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
  canary.includes('POPUP_CONSOLE_ERROR_ALLOWLIST')
    && canary.includes("id: 'missing-favicon'")
    && canary.includes("url: /\\/favicon\\.ico(?:\\?|$)/i")
    && canary.includes('record.popupConsoleCaptureActive')
    && popupLane.includes('startPopupDiagnostics(firstRecord)')
    && popupLane.includes('startPopupDiagnostics(secondRecord)')
    && popupLane.includes('popupConsoleErrors.length > 0')
    && canary.includes('record.consoleErrorDetails.push({ text, args });')
    && canary.includes('updateLoopConsoleDetails:'),
  'console errors are scoped to the mounted popup and fail completion unless they match the single URL-and-message favicon exception',
);
check(
  canary.includes('function assertNoReactUpdateLoopErrors(record, label)')
    && canary.includes('/Maximum update depth exceeded|Too many re-renders/i')
    && canary.includes("assertNoReactUpdateLoopErrors(record, 'Desktop Office')")
    && canary.includes("assertNoReactUpdateLoopErrors(record, 'Mobile Office')")
    && popupLane.includes('assertNoReactUpdateLoopErrors(record, `Agent popup ${record.viewport}`)'),
  'desktop, mobile, and popup lanes all reject the React update-loop signature even before popup-only console capture begins',
);
check(
  canary.includes("root.querySelectorAll('[role=\"alert\"]')")
    && canary.includes("element.textContent?.trim() === 'This section could not load'")
    && popupLane.includes("assertPopupSectionHealthy(firstPage, firstRecord, 'First-tab Overview')")
    && popupLane.includes("assertPopupSectionHealthy(firstPage, firstRecord, 'First-tab Customize')")
    && popupLane.includes("assertPopupSectionHealthy(secondPage, secondRecord, 'Pre-refresh second-tab Customize')")
    && popupLane.includes("assertPopupSectionHealthy(secondPage, secondRecord, 'Refreshed second-tab Overview')")
    && popupLane.includes('popupSectionErrors.length > 0'),
  'visible section alerts and render fallbacks fail the popup lane across initial, routed, and post-refresh states',
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
    && popupLane.includes('dockedWebLifecycle')
    && popupLane.includes('compactCenteredLifecycle')
    && !popupLane.includes('nativeTabletVerified')
    && !popupLane.includes('voiceOverVerified')
    && !popupLane.includes('talkBackVerified')
    && popupLane.includes('headerAreaBackdropIsolation')
    && !popupLane.includes('modalIsolation'),
  'the browser receipt names its tested backdrop areas and does not overclaim full native or screen-reader isolation',
);

console.log(`office agent popup live-canary contract smoke passed (${assertions} assertions)`);
console.log('native simulator/device rotation plus VoiceOver/TalkBack remains a separate manual or device-harness gate');
