/**
 * chat-computer-request-ux-smoketest — verifies that computer/app request
 * routing exposes a user-friendly notice model without leaking internal
 * routing details into normal chat.
 *
 * Run: npm run smoke:chat-computer-request-ux
 */

import { buildChatAutomationPlan, summarisePlanForTelemetry } from '../src/lib/chatAutomationPlanner';
import { buildChatComputerTaskAutonomy } from '../src/lib/chatComputerTaskAutonomy';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import {
  buildChatComputerRequestUserNotice,
  formatChatComputerRequestUserNotice,
  summarizeChatComputerRequestUserNotice,
} from '../src/lib/chatComputerRequestUx';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function routeOrFail(input: string) {
  const route = buildChatComputerRequestRoute(input);
  if (!route) {
    fail(`${input} expected a computer request route`);
    return null;
  }
  return route;
}

const photoshopRoute = routeOrFail('Open Photoshop and generate a background then save png');
if (photoshopRoute) {
  const notice = buildChatComputerRequestUserNotice(photoshopRoute);
  const formatted = formatChatComputerRequestUserNotice(notice);
  expect(notice.visibility === 'user', 'Photoshop approval route should be user-visible');
  expect(notice.tone === 'approval', 'Photoshop approval route should use approval tone');
  expect(notice.autonomy.userEffort === 'approve', 'Photoshop route should require one approval');
  expect(notice.autonomy.canAutoPrepare, 'Photoshop route should be eligible for quiet desktop preparation');
  expect(!notice.autonomy.canRunQuietly, 'Photoshop approval route should not run quietly past approval');
  expect(notice.primaryAction?.kind === 'approve_desktop', 'Photoshop route should ask for desktop approval');
  expect(notice.badges.includes('One approval'), 'Photoshop route should badge least-effort approval state');
  expect(notice.badges.includes('Adobe Photoshop'), 'Photoshop route should badge the target app');
  expect(notice.summary.includes('desktop-app path'), 'Photoshop notice should explain the desktop path plainly');
  expect(notice.proof.length > 0 && notice.proof.length <= 3, 'Photoshop notice should include compact proof');
  expect(formatted.includes('Ready for review'), 'formatted Photoshop notice should include a concise title');
  expect(!formatted.includes('/Users/'), 'formatted Photoshop notice should not leak local absolute paths');
  pass('Photoshop notice is concise, approval-focused, and sanitized');
}

// Rename-free export is the bounded low-risk shape (computerTaskPlanner
// isLowRiskLocalImageExportTask); a rename makes it a named-output write and
// must require approval.
const photoshopExportRoute = routeOrFail('open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and save it as a png');
if (photoshopExportRoute) {
  const notice = buildChatComputerRequestUserNotice(photoshopExportRoute);
  expect(photoshopExportRoute.approvalRequired === false, 'Bounded Photoshop Save for Web route should not require approval');
  expect(notice.visibility === 'hidden', 'Bounded Photoshop Save for Web route should stay hidden unless it hits a blocker');
  expect(notice.autonomy.userEffort === 'none', 'Bounded Photoshop Save for Web route should require no user step');
  expect(notice.autonomy.canRunQuietly, 'Bounded Photoshop Save for Web route should run quietly');
  expect(!notice.primaryAction, 'Bounded Photoshop Save for Web route should not show an approval action');
  expect(formatChatComputerRequestUserNotice(notice) === '', 'Hidden bounded Photoshop route should format to an empty message');
  pass('Bounded Photoshop Save for Web routing stays quiet and approval-free');
}

const photoshopRenameExportRoute = routeOrFail('open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png');
if (photoshopRenameExportRoute) {
  expect(photoshopRenameExportRoute.approvalRequired === true, 'Photoshop export with a rename is a named-output write and must require approval');
  pass('Photoshop rename-export stays approval-gated');
}

const localFileRoute = routeOrFail('Search files in Downloads for invoice');
if (localFileRoute) {
  const notice = buildChatComputerRequestUserNotice(localFileRoute);
  expect(notice.visibility === 'hidden', 'Safe local file search should stay hidden until a result or blocker exists');
  expect(notice.tone === 'quiet', 'Safe local file search should use quiet tone');
  expect(notice.autonomy.userEffort === 'none', 'Safe local file search should require no user step');
  expect(notice.autonomy.canRunQuietly, 'Safe local file search should be allowed to run quietly');
  expect(notice.autonomy.canAutoPrepare, 'Safe local file search should quietly prepare the local bridge/file scope');
  expect(!notice.primaryAction, 'Safe local file search should not ask for approval');
  expect(Boolean(notice.hiddenReason), 'Hidden safe route should explain why the notice is quiet');
  expect(formatChatComputerRequestUserNotice(notice) === '', 'Hidden safe route should format to an empty message');
  pass('Safe local-file routing stays quiet by default');
}

const browserRoute = routeOrFail('Log into Shopify and update this product page after I approve');
if (browserRoute) {
  const notice = buildChatComputerRequestUserNotice(browserRoute);
  expect(notice.visibility === 'user', 'Credentialed browser route should be user-visible');
  expect(notice.autonomy.userEffort === 'approve', 'Credentialed browser route should use approval effort');
  expect(!notice.autonomy.canAutoPrepare, 'Browser-only route should not prepare the desktop bridge');
  expect(notice.primaryAction?.kind === 'approve_browser', 'Credentialed browser route should ask for browser approval');
  expect(notice.badges.includes('Browser'), 'Credentialed browser route should badge Browser');
  expect(notice.summary.includes('stop before any submit'), 'Credentialed browser notice should state side-effect stop behavior');
  pass('Credentialed browser notice surfaces approval and stop behavior');
}

const abletonRoute = routeOrFail('Use Ableton Live to create a four-bar drum loop and export it after approval');
if (abletonRoute) {
  const notice = buildChatComputerRequestUserNotice(abletonRoute);
  expect(notice.visibility === 'user', 'Universal desktop-app route should be user-visible when approval is required');
  expect(notice.autonomy.userEffort === 'approve', 'Universal desktop-app route should require approval before mutation');
  expect(notice.autonomy.canAutoPrepare, 'Universal desktop-app route should quietly prepare desktop capabilities');
  expect(notice.primaryAction?.kind === 'approve_desktop', 'Universal app route should ask for desktop approval');
  expect(notice.badges.includes('Ableton Live'), 'Universal app route should badge the inferred app target');
  expect(notice.badges.includes('Build if missing'), 'Universal app route should badge build-if-missing support');
  expect(notice.summary.includes('desktop-app path for Ableton Live file/save/export work'), 'Universal app route should name the inferred app target and task family plainly');
  const compactAbletonNotice = summarizeChatComputerRequestUserNotice(abletonRoute).routeDecision;
  expect(compactAbletonNotice?.targetName === 'Ableton Live', 'Compact universal app notice should preserve inferred app target');
  expect(compactAbletonNotice?.taskFamily === 'file/save/export work', 'Compact universal app notice should preserve task family');
  pass('Universal desktop-app notice supports unfamiliar apps without overexplaining internals');
}

const pureImageRoute = buildChatComputerRequestRoute('Generate an image of a neon swan');
if (pureImageRoute) {
  fail('Pure image generation should not create a computer request UX notice');
} else {
  pass('Pure image generation does not produce computer request UX');
}

const photoshopPlan = buildChatAutomationPlan({ message: 'Open Photoshop and generate a background then save png' });
const telemetry = summarisePlanForTelemetry(photoshopPlan);
const telemetryNotice = (telemetry.computerRequestRoute as any)?.userNotice;
if (telemetryNotice?.primaryAction?.kind !== 'approve_desktop' || telemetryNotice?.visibility !== 'user') {
  fail('Planner telemetry should include the compact computer request user notice');
} else {
  pass('Planner telemetry includes compact user notice');
}
if (telemetryNotice?.autonomy?.userEffort !== 'approve' || telemetryNotice?.autonomy?.canAutoPrepare !== true) {
  fail('Planner telemetry should include compact least-effort autonomy state');
} else {
  pass('Planner telemetry includes least-effort autonomy state');
}
if (telemetryNotice?.routeDecision?.status !== 'needs_observation' || telemetryNotice?.routeDecision?.chosenSurfaceId !== 'adobe_photoshop_uxp_dom') {
  fail('Planner telemetry should include compact app automation route decision');
} else {
  pass('Planner telemetry includes compact app automation route decision');
}

if (photoshopRoute) {
  const compact = summarizeChatComputerRequestUserNotice(photoshopRoute);
  if ('secondaryActions' in compact) {
    fail('Compact notice summary should omit secondary action detail by default');
  } else {
    pass('Compact notice summary omits secondary detail by default');
  }
  const blockedAutonomy = buildChatComputerTaskAutonomy({
    ...photoshopRoute,
    appAutomationRouteDecision: photoshopRoute.appAutomationRouteDecision
      ? {
          ...photoshopRoute.appAutomationRouteDecision,
          status: 'needs_user_action',
          userActionBlockers: ['Grant macOS Accessibility permission for Photoshop control.'],
        }
      : null,
  });
  if (blockedAutonomy.userEffort !== 'unblock' || blockedAutonomy.canRunQuietly || blockedAutonomy.canAutoPrepare) {
    fail('Blocked app route should require user unblock and prevent quiet execution');
  } else {
    pass('Blocked app route fails closed to a user unblock state');
  }
}

// ─── D1: plan preview card ──────────────────────────────────────────────────

{
  const { buildChatComputerTaskPlanPreview, formatChatComputerTaskPlanPreview } =
    require('../src/lib/chatComputerRequestUx') as typeof import('../src/lib/chatComputerRequestUx');

  // Approval-needing multi-step task → preview visible with ordered steps,
  // constraints, and proof; formatted output numbers the steps.
  const route = buildChatComputerRequestRoute(
    "open the browser, log into my supplier portal at portal.acme.com, fill the reorder form, but don't submit it",
  );
  if (!route) fail('plan preview: complicated browser task should route');
  else {
    const notice = buildChatComputerRequestUserNotice(route);
    if (notice.visibility !== 'user') fail('plan preview: approval-needing task should show a notice');
    if (!notice.planPreview) fail('plan preview: notice should carry a plan preview');
    else {
      expect(notice.planPreview.steps.length >= 2, 'plan preview: at least 2 steps');
      expect(notice.planPreview.constraints.some((c) => /Won't: .*submit/.test(c)), `plan preview: constraint surfaced (got ${JSON.stringify(notice.planPreview.constraints)})`);
      const formatted = formatChatComputerRequestUserNotice(notice);
      expect(/\*\*Plan — /.test(formatted), 'plan preview: formatted notice contains plan block');
      expect(/^1\. /m.test(formatted), 'plan preview: steps are numbered');
      expect(/Reply with changes/.test(formatted), 'plan preview: edit hint present');
      pass('plan preview: visible, constrained, numbered, editable');
    }
    const summary = summarizeChatComputerRequestUserNotice(route) as { planPreview?: { stepCount?: number } | null };
    expect(summary.planPreview && (summary.planPreview.stepCount || 0) >= 2, 'plan preview: persisted summary carries compact plan');
    if (summary.planPreview) pass('plan preview: persisted summary bounded + populated');
  }

  // Quiet task → preview hidden, formatter returns empty.
  const quietRoute = buildChatComputerRequestRoute('search my downloads folder for the latest invoice pdf and tell me its name');
  if (quietRoute) {
    const quietPreview = buildChatComputerTaskPlanPreview(quietRoute);
    const quietNotice = buildChatComputerRequestUserNotice(quietRoute);
    if (quietNotice.visibility === 'hidden') {
      expect(quietPreview.visibility === 'hidden', 'plan preview: quiet task preview hidden');
      expect(formatChatComputerTaskPlanPreview(quietPreview) === '', 'plan preview: hidden preview formats to empty');
      expect(quietNotice.planPreview === null, 'plan preview: quiet notice carries no plan');
      pass('plan preview: quiet task stays quiet');
    } else {
      // Visibility is autonomy-derived; if this read task surfaces a notice the
      // preview riding it is acceptable — just assert consistency.
      expect(quietPreview.visibility === 'user', 'plan preview: preview visibility matches notice');
      pass('plan preview: read task notice/preview visibility consistent');
    }
  }
}

// ─── Wave-2: one-line app choice on the visible notice ───────────────────────

{
  const { setAppResolutionContext } =
    require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  // Hydrated context with Photoshop installed → visible approval notice
  // carries exactly one "Using <app> (<why>) — say 'use <alt>' to switch" line.
  setAppResolutionContext({ bridgeOnline: true, installedApps: ['adobe photoshop 2025'] });
  const resolvedRoute = buildChatComputerRequestRoute('edit this photo');
  if (!resolvedRoute || !resolvedRoute.appResolution) {
    fail('app choice: hydrated photo edit should route with an app resolution');
  } else {
    const notice = buildChatComputerRequestUserNotice(resolvedRoute);
    const formatted = formatChatComputerRequestUserNotice(notice);
    expect(
      Boolean(notice.appChoiceLine && /^Using Adobe Photoshop/.test(notice.appChoiceLine)),
      `app choice: notice should carry the Using line (got ${notice.appChoiceLine || 'none'})`,
    );
    expect(notice.appChoice?.visibility === 'user', 'app choice: chip should be user-visible even when notice visibility changes');
    expect(/^Adobe Photoshop/.test(notice.appChoice?.selectedAppName || ''), 'app choice: chip should carry the selected app name');
    expect(notice.appChoice?.selectedSurface === 'desktop', 'app choice: chip should carry the selected app surface');
    expect((notice.appChoice?.alternatives.length || 0) > 0, 'app choice: chip should carry bounded alternatives');
    expect(
      Boolean(notice.appChoiceLine?.includes('say "use ') && notice.appChoiceLine.includes('" to switch')),
      'app choice: Using line should name the cheapest switch path',
    );
    if (notice.visibility === 'user') {
      expect(formatted.includes(notice.appChoiceLine || '~'), 'app choice: visible notice should render the Using line');
      expect((formatted.match(/Using Adobe Photoshop/g) || []).length === 1, 'app choice: the Using line appears exactly once');
    } else {
      expect(formatted === '', 'app choice: hidden notice formats empty even with an app choice');
    }
    const compact = summarizeChatComputerRequestUserNotice(resolvedRoute);
    expect(Boolean((compact as any).appChoiceLine), 'app choice: compact summary carries the line for persistence');
    expect(/^Adobe Photoshop/.test((compact as any).appChoice?.selectedAppName || ''), 'app choice: compact summary carries structured selected app');
    expect((compact as any).appChoice?.alternativeCount > 0, 'app choice: compact summary carries alternative count');
    pass('app choice: visible notice carries one compact Using line');
  }

  // Quiet tasks still keep the full notice/body quiet, but the separate app
  // choice chip remains visible so the user can redirect the selected app.
  setAppResolutionContext({ bridgeOnline: false });
  const quietResolved = buildChatComputerRequestRoute('edit this photo');
  if (quietResolved?.appResolution && !quietResolved.approvalRequired) {
    const quietNotice = buildChatComputerRequestUserNotice(quietResolved);
    if (quietNotice.visibility === 'hidden') {
      expect(formatChatComputerRequestUserNotice(quietNotice) === '', 'app choice: quiet resolved route formats to empty');
      expect(quietNotice.appChoice?.visibility === 'user', 'app choice: quiet resolved route still exposes app chip');
      expect(Boolean(quietNotice.appChoiceLine), 'app choice: quiet resolved route still stores the Using line');
      pass('app choice: quiet tasks keep the full notice hidden but expose app choice');
    } else {
      expect(Boolean(quietNotice.appChoiceLine), 'app choice: visible resolved route carries the line');
      pass('app choice: resolved route notice is visibility-consistent');
    }
  }

  // Routes without a resolution have no line, and persisted notices missing
  // the optional field still format (pre-wave-2 rows).
  const plainRoute = buildChatComputerRequestRoute('Search files in Downloads for invoice');
  if (plainRoute) {
    const plainNotice = buildChatComputerRequestUserNotice(plainRoute);
    expect(plainNotice.appChoiceLine === null, 'app choice: no resolution → no Using line');
    const legacyNotice = JSON.parse(JSON.stringify(plainNotice));
    delete (legacyNotice as any).appChoiceLine;
    delete (legacyNotice as any).appChoice;
    expect(typeof formatChatComputerRequestUserNotice(legacyNotice) === 'string', 'app choice: pre-wave-2 persisted notice still formats');
    pass('app choice: notices without the field stay compatible');
  }
}

if (failures > 0) {
  console.error(`\n${failures} chat computer request UX smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat computer request UX smoke cases passed.');
