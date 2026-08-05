/**
 * computer-pipeline-e2e-smoketest — END-TO-END integration smoke for the
 * app/browser/desktop task pipeline (route → contract → loop inputs →
 * resume/recovery → verify artifacts).
 *
 * Every layer below has its own unit smoke; nothing else chains them. This
 * smoke runs five representative task journeys where each module's REAL
 * output feeds the next module's input (no hand-built intermediate
 * fixtures), so cross-module contract drift fails here first:
 *
 *   1. Browser task with always-confirm floor ("buy"): route → evidence
 *      contract → complexity plan → UX notice → handoff metadata →
 *      persisted-route JSON round-trip re-validation.
 *   2. Desktop app task (Photoshop): route E4 precision rules → complexity
 *      checkpoints → prepareComputerTaskExecution readiness against stubbed
 *      capability audits (ready / partial / offline-bridge staged variant
 *      that must fail closed at launch).
 *   3. Hybrid staged task (portal download → spreadsheet import): ≥2 stages
 *      with handoff contract → simulated stage-2 failure → checkpoint
 *      recovery infers the failed stage + do-not-redo completed stages →
 *      consistency with the route's app decision and evidence recovery.
 *   4. Constraint + sticky-scope interplay: forbidden(submit) hard-block via
 *      constraintBlocksToolCall, sticky downgrade fires only with full
 *      non-floor coverage, floor categories never downgrade, notice copy
 *      stays consistent across route/notice/handoff.
 *   5. Recovery loop: failing evidence contract → recovery emits required
 *      tools + readiness (missing → stale → ready → blocked), and every
 *      recovery/recommended tool name is cross-checked against the REAL
 *      openswanToolRuntime catalog (the drift class this smoke exists for).
 *
 * Junction asserts throughout: runtime types align (no `undefined` leaks
 * into prompt strings), bounded fields stay bounded after JSON round-trips,
 * and every prompt-block string the chain promises (floor line, E4 rules,
 * staged execution contract, autonomy escalation language) appears in the
 * final assembled artifacts.
 *
 * `openswanToolRuntime` transitively imports react-native via the supabase
 * singleton, which tsx/esbuild cannot parse — journey 5 stubs the native
 * module specifiers with `node:module.registerHooks` (same technique as
 * progressive-tool-disclosure-smoketest) and dynamically imports the REAL
 * catalog. All other modules in the chain are pure and imported directly.
 *
 * Run: npm run smoke:computer-pipeline-e2e
 */

import { registerHooks } from 'node:module';

// The supabase singleton creates a client at import time — give it inert
// values BEFORE the runtime module loads. Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://pipeline-e2e-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'pipeline-e2e-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ── Pure pipeline modules (no native deps — imported directly) ──────────────
import {
  buildChatComputerRequestRoute,
  buildChatComputerRequestRoutePromptBlock,
  constraintBlocksToolCall,
  formatAlwaysConfirmFloorPromptLine,
  type ChatComputerRequestRoute,
} from '../src/lib/chatComputerRequestRouter';
import {
  buildComputerTaskEvidenceContract,
  formatComputerTaskEvidenceContractPromptBlock,
} from '../src/lib/computerTaskEvidenceContract';
import {
  buildComputerTaskComplexityPlan,
  complexityPlanTouchesDesktopSurface,
  DATA_TRANSFER_PRECISION_RULES,
  formatComputerTaskComplexityDispatchBlock,
  planComputerTaskStages,
  validateComputerTaskStageSurfaces,
} from '../src/lib/computerTaskComplexityPlan';
import { prepareComputerTaskExecution } from '../src/lib/computerTaskExecution';
import {
  diagnoseComputerTaskCheckpointFailure,
  formatComputerTaskCheckpointRecoveryForPrompt,
} from '../src/lib/computerTaskCheckpointRecovery';
import {
  diagnoseComputerTaskEvidenceFailure,
  evaluateComputerTaskEvidenceRecoveryReadiness,
  formatComputerTaskEvidenceRecoveryForPrompt,
  type ComputerTaskEvidenceRecoveryObservation,
} from '../src/lib/computerTaskEvidenceRecovery';
import {
  buildChatComputerRequestUserNotice,
  buildChatComputerTaskPlanPreview,
  formatChatComputerRequestUserNotice,
} from '../src/lib/chatComputerRequestUx';
import { buildChatComputerHandoffContext, formatChatComputerHandoffForMessage } from '../src/lib/chatComputerHandoffContext';
import { buildDesignAppAdapterGapPlan } from '../src/lib/designAppAdapterGaps';
import { buildChatComputerTaskAutonomy } from '../src/lib/chatComputerTaskAutonomy';
import {
  createStickyScope,
  formatStickyScopeAppliedNotice,
  setActiveStickyScopes,
  type StickyAllowScope,
} from '../src/lib/computerGrantGate';
import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';

// ── Assertion harness ────────────────────────────────────────────────────────

let failures = 0;
let passes = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { passes += 1; console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: unknown) {
  if (condition) pass(message);
  else fail(`${message}${detail !== undefined ? ` — got ${JSON.stringify(detail)?.slice(0, 400)}` : ''}`);
}
function section(title: string) { console.log(`\n=== ${title} ===`); }

/** No `undefined`/`[object Object]` leaks in an assembled prompt artifact. */
function assertNoLeaks(text: string, label: string) {
  assert(typeof text === 'string' && text.length > 0, `${label}: non-empty string artifact`);
  assert(!/\bundefined\b/.test(text), `${label}: no "undefined" leak`, text.match(/.{0,60}undefined.{0,60}/)?.[0]);
  assert(!text.includes('[object Object]'), `${label}: no "[object Object]" leak`);
  assert(!/\bNaN\b/.test(text), `${label}: no "NaN" leak`);
}

// ── Stubbed capability audit (same fixture shape as the unit smokes) ─────────

const CAPABILITY_IDS: ComputerCapabilityId[] = [
  'browser_automation',
  'browser_sessions',
  'file_search',
  'file_read',
  'file_write',
  'app_tools',
  'agent_bridges',
  'desktop_control',
];

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => {
    const status = overrides[id] || 'ready';
    return {
      id,
      label: id,
      status,
      detail: `${id} ${status}`,
      sources: status === 'missing' ? [] : ['e2e-smoke'],
    };
  });
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: ['web_automation', 'remote_browser_sessions'],
    activeBridgeProviders: ['openswan'],
    activeMcpServerCount: 1,
    activeMcpToolCount: 8,
  };
}

function mustRoute(message: string, opts?: { stickyScopes?: StickyAllowScope[] | null }): ChatComputerRequestRoute {
  const route = buildChatComputerRequestRoute(message, opts);
  if (!route) throw new Error(`expected a computer route for: ${message}`);
  return route;
}

/** Collected across journeys for the journey-5 catalog cross-check. */
const referencedRecoveryTools = new Map<string, string>(); // tool -> first source label
function collectTools(source: string, tools: Array<{ tool: string }>) {
  for (const item of tools) {
    if (!referencedRecoveryTools.has(item.tool)) referencedRecoveryTools.set(item.tool, source);
  }
}
const referencedRecommendedTools = new Map<string, string>();
/**
 * Adapter-gap PROPOSAL tool names (e.g. desktop.photoshop_resize_canvas_or_image)
 * are deliberately not in the catalog — they're the connected-agent buildout
 * targets the same chain proposes. Collected per task so the catalog check can
 * tell "proposed by this chain" apart from genuine drift.
 */
const gapProposalTools = new Set<string>();
function collectRecommended(source: string, task: string, tools: string[]) {
  for (const tool of tools) {
    if (/^(browser|desktop|approvals|vault|wp)\./.test(tool) && !referencedRecommendedTools.has(tool)) {
      referencedRecommendedTools.set(tool, source);
    }
  }
  const gapPlan = buildDesignAppAdapterGapPlan(task);
  for (const gap of gapPlan?.gaps || []) {
    for (const tool of [...gap.missingBridgeTools, ...gap.requiredBridgeToolsBeforeRetry]) gapProposalTools.add(tool);
  }
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // Journey 1 — Browser task with always-confirm floor
  // ═══════════════════════════════════════════════════════════════════════════
  section('Journey 1: browser purchase with floor + stop-condition constraint');

  // WI-2: a browser purchase is zero-tap at the ROUTE level by default (its
  // single commit is confirmed mid-run at the payment floor). To exercise the
  // route-level approval junction below, J1 uses a purchase that ALSO carries
  // an explicit "ask me before you buy" constraint — that user constraint (not
  // the pay floor) is what forces route-level approval now. The pay floor is
  // still stamped for per-step (mid-run) enforcement. The zero-tap default is
  // proven separately in J1b.
  const MSG1 = 'go to acme.com and buy the basic plan, but ask me before you buy, and stop if it asks for a captcha';
  const route1 = mustRoute(MSG1);

  // Route junction
  assert(route1.kind === 'browser', 'J1 route classifies as browser', route1.kind);
  assert(route1.executionKind === 'run_computer_task', 'J1 route executionKind is run_computer_task');
  assert(route1.alwaysConfirmFloor?.includes('pay'), 'J1 floor detects "buy" as pay category (stamped for mid-run enforcement)', route1.alwaysConfirmFloor);
  assert(route1.approvalRequired === true, 'J1 explicit ask-before constraint forces route-level approvalRequired');
  assert(/asked to be checked with before|always-confirm/i.test(route1.approvalReason || ''), 'J1 approval reason names the ask-before/floor policy', route1.approvalReason);
  assert(route1.userConstraints?.approvalBefore.includes('pay'), 'J1 ask-before constraint parsed (pay)', route1.userConstraints);
  assert(route1.userConstraints?.stopConditions.includes('captcha'), 'J1 stop-condition constraint parsed (captcha)', route1.userConstraints);
  assert((route1.userConstraints?.sourcePhrases.length || 0) > 0 && (route1.userConstraints?.sourcePhrases.length || 0) <= 6,
    'J1 constraint source phrases bounded (1..6)', route1.userConstraints?.sourcePhrases);

  // J1b (WI-2) — the zero-tap default: a browser purchase WITHOUT an explicit
  // ask-before constraint routes to the browser with NO route-level approval;
  // the pay floor is still stamped for mid-run per-step enforcement. This is
  // the core "book me a hotel / buy the plan" zero-friction behavior.
  {
    const zeroTap = mustRoute('go to acme.com and buy the basic plan');
    assert(zeroTap.kind === 'browser', 'J1b zero-tap browser purchase routes to browser', zeroTap.kind);
    assert(zeroTap.approvalRequired === false, 'J1b browser purchase is zero-tap at the route level (no up-front approval)', zeroTap.approvalRequired);
    assert(zeroTap.alwaysConfirmFloor?.includes('pay'), 'J1b pay floor stays stamped for mid-run per-step enforcement', zeroTap.alwaysConfirmFloor);
    // A URL-less hotel booking phrasing (WI-6) routes to browser zero-tap with
    // an EMPTY route floor ("book" is not a route-level pay verb).
    const hotel = mustRoute('book me a hotel in chicago');
    assert(hotel.kind === 'browser', 'J1b URL-less hotel booking routes to browser', hotel.kind);
    assert(hotel.approvalRequired === false, 'J1b URL-less hotel booking is zero-tap', hotel.approvalRequired);
    assert((hotel.alwaysConfirmFloor || []).length === 0, 'J1b hotel booking route floor is empty ("book" is not a route pay verb)', hotel.alwaysConfirmFloor);
  }

  // Route → evidence contract junction (derived by the route builder itself)
  const contract1 = route1.evidenceContract!;
  assert(contract1 && contract1.schemaVersion === 1 && contract1.kind === 'browser', 'J1 route carries a browser evidence contract', contract1?.kind);
  assert(contract1.approvalBefore.some((line) => line === route1.approvalReason), 'J1 contract approvalBefore folds in the route approval reason', contract1.approvalBefore);
  assert(contract1.proofAfter.length > 0 && contract1.proofAfter.length <= 8, 'J1 contract proofAfter bounded (1..8)');
  assert(contract1.proofAfter.every((line) => route1.completionProof.includes(line)) || contract1.proofAfter.some((line) => route1.completionProof.includes(line)),
    'J1 route completionProof absorbed contract proofAfter items', { proofAfter: contract1.proofAfter, completionProof: route1.completionProof });
  // Re-deriving the contract from the same route is deterministic.
  const rederived1 = buildComputerTaskEvidenceContract(route1);
  assert(JSON.stringify(rederived1) === JSON.stringify(contract1), 'J1 contract derivation is deterministic for the same route');

  // Route → prompt block junction (the userMessage block the loop receives)
  const block1 = buildChatComputerRequestRoutePromptBlock(MSG1)!;
  assertNoLeaks(block1, 'J1 route prompt block');
  const floorLine1 = formatAlwaysConfirmFloorPromptLine(route1.alwaysConfirmFloor)!;
  assert(block1.includes(floorLine1), 'J1 prompt block carries the exact floor line');
  assert(block1.includes('User constraint: stop and hand back to the user if the task hits: captcha'),
    'J1 prompt block carries the stop-condition constraint rule');
  assert(block1.includes('## Computer Task Evidence Contract'), 'J1 prompt block embeds the evidence contract');
  assert(block1.includes(formatComputerTaskEvidenceContractPromptBlock(contract1)), 'J1 embedded contract block matches the formatter output exactly');
  assert(block1.includes('## Least User Effort Policy'), 'J1 prompt block embeds the autonomy policy');
  assert(block1.includes('stop at the approval boundary'), 'J1 prompt block carries the approve escalation language');
  assert(!block1.includes('Data transfer & precision rules'), 'J1 browser route excludes E4 desktop precision rules (edge loop owns them)');

  // Route preview → complexity plan junction
  const plan1 = buildComputerTaskComplexityPlan({ task: MSG1, preview: route1.computerPreview });
  assert(plan1.level !== 'simple', 'J1 purchase task is at least moderate complexity', plan1.level);
  const approvalCheckpoint1 = plan1.checkpoints.find((checkpoint) => checkpoint.id === 'approval-before-side-effect');
  assert(approvalCheckpoint1?.requiresApproval === true, 'J1 complexity plan stages an approval-before-side-effect checkpoint', plan1.checkpoints.map((c) => c.id));
  assert(plan1.stages.length === 0, 'J1 single-surface task has no stages', plan1.stages);
  const dispatch1 = formatComputerTaskComplexityDispatchBlock(plan1)!;
  assertNoLeaks(dispatch1, 'J1 complexity dispatch block');
  assert(!complexityPlanTouchesDesktopSurface(plan1), 'J1 browser-only plan does not touch a desktop surface');
  assert(!dispatch1.includes('Data transfer & precision rules'), 'J1 dispatch block excludes E4 rules for browser-only plan');

  // Route → UX notice junction
  const notice1 = buildChatComputerRequestUserNotice(route1);
  assert(notice1.visibility === 'user' && notice1.tone === 'approval', 'J1 notice is user-visible with approval tone', { visibility: notice1.visibility, tone: notice1.tone });
  assert(notice1.primaryAction?.kind === 'approve_browser', 'J1 notice primary action approves the browser run', notice1.primaryAction);
  assert(notice1.autonomy.userEffort === 'approve', 'J1 autonomy demands one approval', notice1.autonomy.userEffort);
  const noticeText1 = formatChatComputerRequestUserNotice(notice1);
  assertNoLeaks(noticeText1, 'J1 formatted notice');
  assert(noticeText1.includes(notice1.primaryAction!.label), 'J1 formatted notice shows the approval action');

  // Notice + contract → handoff metadata junction
  const handoff1 = buildChatComputerHandoffContext({
    task: MSG1,
    entrypoint: 'browser_runtime',
    taskKind: route1.computerPreview.kind,
    taskLabel: route1.bestPath,
    approvalSummary: route1.approvalReason,
    requestNotice: notice1,
    evidenceContract: contract1,
    appAutomationRouteDecision: route1.appAutomationRouteDecision,
  });
  assert(handoff1.surface === 'browser', 'J1 handoff infers the browser surface', handoff1.surface);
  assert(handoff1.metadata.evidenceContract === contract1, 'J1 handoff metadata carries the route evidence contract by reference');
  assert(handoff1.metadata.requestNotice === notice1, 'J1 handoff metadata carries the request notice');
  const handoffMessage1 = formatChatComputerHandoffForMessage(handoff1);
  assertNoLeaks(handoffMessage1, 'J1 handoff message');
  assert(handoffMessage1.includes('Ready for review'), 'J1 handoff message resolves to the approval presentation');
  const metadataJson1 = JSON.stringify(handoff1.metadata);
  assert(metadataJson1.length < 20_000, 'J1 handoff metadata stays bounded (<20KB)', metadataJson1.length);
  assert(handoff1.metadata.warnings.length <= 4 && handoff1.metadata.blockers.length <= 4, 'J1 handoff warnings/blockers bounded (≤4)');

  // Persisted-route round-trip junction: stringify/parse and re-validate.
  const persisted1 = JSON.parse(JSON.stringify(route1)) as ChatComputerRequestRoute;
  assert(JSON.stringify(buildComputerTaskEvidenceContract(persisted1)) === JSON.stringify(contract1),
    'J1 round-trip: contract re-derived from the persisted route matches');
  const persistedNotice1 = buildChatComputerRequestUserNotice(persisted1);
  assert(JSON.stringify(persistedNotice1) === JSON.stringify(notice1), 'J1 round-trip: notice re-derived from the persisted route matches');
  assert(formatAlwaysConfirmFloorPromptLine(persisted1.alwaysConfirmFloor) === floorLine1, 'J1 round-trip: floor line survives persistence');
  // notes bound matches the router's own cap (chatComputerRequestRouter.ts notes .slice(0, 10))
  assert(persisted1.notes.length <= 10 && persisted1.recommendedTools.length <= 28 && persisted1.completionProof.length <= 12,
    'J1 round-trip: bounded route fields stay bounded', { notes: persisted1.notes.length, tools: persisted1.recommendedTools.length, proof: persisted1.completionProof.length });
  collectRecommended('J1 route', MSG1, route1.recommendedTools);

  // ═══════════════════════════════════════════════════════════════════════════
  // Journey 2 — Desktop app task (Photoshop) + execution readiness
  // ═══════════════════════════════════════════════════════════════════════════
  section('Journey 2: Photoshop desktop task → E4 rules + execution readiness');

  const MSG2 = 'resize the canvas in Photoshop and export a PNG';
  const route2 = mustRoute(MSG2);
  assert(route2.kind === 'desktop_app', 'J2 route classifies as desktop_app', route2.kind);
  const contract2 = route2.evidenceContract!;
  assert(/photoshop/i.test(contract2.targetName), 'J2 contract targets Photoshop', contract2.targetName);
  assert(contract2.observeBefore.some((line) => /photoshop/i.test(line)), 'J2 contract requires Photoshop-specific observation', contract2.observeBefore);
  assert(contract2.failClosedRules.length > 0 && contract2.freshEvidenceRequired.length > 0, 'J2 contract carries fail-closed + fresh-evidence rules');

  const block2 = buildChatComputerRequestRoutePromptBlock(MSG2)!;
  assertNoLeaks(block2, 'J2 route prompt block');
  assert(block2.includes('Data transfer & precision rules'), 'J2 desktop route prompt block carries the E4 rules header');
  for (const rule of DATA_TRANSFER_PRECISION_RULES) {
    assert(block2.includes(rule), `J2 prompt block carries E4 rule: ${rule.slice(0, 48)}…`);
  }
  assert(block2.includes('## Computer Task Evidence Contract'), 'J2 prompt block embeds the evidence contract');

  // Route preview → complexity plan → dispatch block junction
  const plan2 = buildComputerTaskComplexityPlan({ task: MSG2, preview: route2.computerPreview });
  assert(plan2.level !== 'simple', 'J2 visual precision desktop task is not simple', { level: plan2.level, score: plan2.score, reasons: plan2.reasons });
  assert(complexityPlanTouchesDesktopSurface(plan2), 'J2 complexity plan touches the desktop surface');
  assert(plan2.checkpoints.some((checkpoint) => checkpoint.id === 'observe-desktop'), 'J2 plan includes the observe-desktop checkpoint', plan2.checkpoints.map((c) => c.id));
  const dispatch2 = formatComputerTaskComplexityDispatchBlock(plan2)!;
  assertNoLeaks(dispatch2, 'J2 complexity dispatch block');
  assert(dispatch2.includes('Data transfer & precision rules'), 'J2 dispatch block repeats the E4 rules for desktop work');

  // prepareComputerTaskExecution junction — ready audit
  const envReady2 = prepareComputerTaskExecution({ task: MSG2, audit: audit() });
  assert(envReady2.readiness.ready === true, 'J2 ready audit: execution envelope is ready', envReady2.readiness);
  assert(envReady2.entrypoint === 'agent_runtime', 'J2 desktop task dispatches via the agent runtime', envReady2.entrypoint);
  assert(envReady2.stagePreflightBlockers.length === 0, 'J2 single-surface task has no stage preflight blockers');
  assert(envReady2.complexityPlan.level === plan2.level && envReady2.complexityPlan.score === plan2.score,
    'J2 envelope complexity plan matches the chain-built plan', { envelope: envReady2.complexityPlan.level, chain: plan2.level });
  assertNoLeaks(envReady2.dispatchPrefix, 'J2 dispatch prefix (ready)');
  assert(envReady2.dispatchPrefix.includes('COMPUTER TASK DISPATCH CONTEXT'), 'J2 dispatch prefix has the dispatch header');
  assert(envReady2.dispatchPrefix.includes(DATA_TRANSFER_PRECISION_RULES[0]), 'J2 dispatch prefix carries the E4 rules end-to-end');

  // Partial audit: degraded but not blocked.
  const envPartial2 = prepareComputerTaskExecution({
    task: MSG2,
    audit: audit({ app_tools: 'partial', desktop_control: 'partial' }),
  });
  assert(envPartial2.readiness.ready === true, 'J2 partial audit: partial capabilities do not block readiness', envPartial2.readiness);
  assert(/partial/i.test(envPartial2.readiness.summary), 'J2 partial audit: readiness summary names the partial surfaces', envPartial2.readiness.summary);
  assert(envPartial2.stagePreflightBlockers.length === 0, 'J2 partial audit: no stage blockers');

  // Staged variant: browser stage → Photoshop stage; offline desktop bridge
  // must fail closed AT LAUNCH (stage preflight), not at step 9.
  const MSG2_STAGED = 'download the brand asset from assets.acme.com, then resize the canvas in Photoshop and export a PNG';
  const stages2 = planComputerTaskStages(MSG2_STAGED);
  assert(stages2.length === 2 && stages2[0].surface === 'browser' && stages2[1].surface === 'desktop_app',
    'J2 staged variant decomposes browser → desktop_app', stages2.map((stage) => stage.surface));
  const offlineAudit = audit({ desktop_control: 'missing', app_tools: 'missing' });
  const blockers2 = validateComputerTaskStageSurfaces(stages2, offlineAudit);
  assert(blockers2.length === 1 && blockers2[0].ordinal === 2 && blockers2[0].surface === 'desktop_app',
    'J2 offline bridge: stage-2 desktop surface produces the preflight blocker', blockers2);
  assert(blockers2[0].missing.includes('desktop_control') && blockers2[0].missing.includes('app_tools'),
    'J2 offline bridge: blocker names both missing capabilities', blockers2[0].missing);
  const envOffline2 = prepareComputerTaskExecution({ task: MSG2_STAGED, audit: offlineAudit });
  assert(envOffline2.readiness.ready === false, 'J2 offline bridge: whole task fails closed at launch', envOffline2.readiness);
  assert(envOffline2.stagePreflightBlockers.length === 1, 'J2 offline bridge: envelope carries the stage blocker');
  assert(/stage 2/i.test(envOffline2.readiness.summary), 'J2 offline bridge: readiness summary names the blocked stage', envOffline2.readiness.summary);
  assert(envOffline2.readiness.missing.includes('desktop_control'), 'J2 offline bridge: readiness missing list absorbs stage capabilities', envOffline2.readiness.missing);
  assert(envOffline2.dispatchPrefix.includes(envOffline2.readiness.summary), 'J2 offline bridge: dispatch prefix surfaces the stage blocker');

  // Partial desktop on the staged variant must NOT block (runtime can degrade).
  const envStagedPartial2 = prepareComputerTaskExecution({
    task: MSG2_STAGED,
    audit: audit({ desktop_control: 'partial', app_tools: 'partial' }),
  });
  assert(envStagedPartial2.stagePreflightBlockers.length === 0, 'J2 staged partial audit: partial desktop does not trip stage preflight', envStagedPartial2.stagePreflightBlockers);
  collectRecommended('J2 route', MSG2, route2.recommendedTools);

  // ═══════════════════════════════════════════════════════════════════════════
  // Journey 3 — Hybrid staged task → stage-aware checkpoint recovery
  // ═══════════════════════════════════════════════════════════════════════════
  section('Journey 3: staged hybrid task → stage-2 failure → stage-aware recovery');

  const recalledTransferRoute = mustRoute('download the report from the portal, then import it into the spreadsheet app');
  assert(recalledTransferRoute.kind === 'hybrid',
    'J3 recovered route: "download…, then import it into the … app" routes as a staged hybrid task', recalledTransferRoute.kind);
  assert(recalledTransferRoute.recommendedTools.includes('desktop.launch_app') && recalledTransferRoute.recommendedTools.includes('desktop.window_state'),
    'J3 recovered route: staged app-transfer route carries desktop launch and observation tools', recalledTransferRoute.recommendedTools);

  const MSG3 = 'download the report from the client portal website, then import it into the spreadsheet desktop app';
  const route3 = mustRoute(MSG3);
  const plan3 = buildComputerTaskComplexityPlan({ task: MSG3, preview: route3.computerPreview });
  assert(plan3.stages.length === 2, 'J3 task decomposes into 2 stages', plan3.stages.map((stage) => stage.id));
  assert(plan3.stages[0].surface === 'browser' && plan3.stages[1].surface === 'desktop_app',
    'J3 stage surfaces are browser → desktop_app', plan3.stages.map((stage) => stage.surface));
  assert(plan3.stages.every((stage, index) => stage.ordinal === index + 1), 'J3 stage ordinals are sequential');
  assert(plan3.stages[0].handoff.includes('exact artifacts'), 'J3 stage 1 handoff demands explicit artifacts', plan3.stages[0].handoff);
  assert(plan3.stages[1].handoff.includes('final proof summary'), 'J3 last stage handoff folds into final proof', plan3.stages[1].handoff);
  assert(plan3.level === 'complex' && plan3.score >= 5, 'J3 staged task is complex by construction', { level: plan3.level, score: plan3.score });
  assert(plan3.reasons.some((reason) => reason.includes('staged 2-surface workflow')), 'J3 plan reasons name the staged workflow', plan3.reasons);
  assert(plan3.visibleNextSteps.every((step) => /^Stage \d:/.test(step)), 'J3 visible next steps are the stage list', plan3.visibleNextSteps);

  const dispatch3 = formatComputerTaskComplexityDispatchBlock(plan3)!;
  assertNoLeaks(dispatch3, 'J3 staged dispatch block');
  assert(dispatch3.includes('### Staged execution contract (multi-surface task)'), 'J3 dispatch block carries the staged contract header');
  for (const stage of plan3.stages) {
    assert(dispatch3.includes(`Stage ${stage.ordinal} [${stage.surface.replace(/_/g, ' ')}]`), `J3 dispatch block lists stage ${stage.ordinal}`);
    assert(dispatch3.includes(stage.doneWhen), `J3 dispatch block carries stage ${stage.ordinal} done-when`);
  }
  assert(dispatch3.includes('recovery resumes from the failed stage, not from the start'), 'J3 dispatch block carries the stage recovery rule');
  assert(dispatch3.includes('Data transfer & precision rules'), 'J3 desktop-touching staged plan carries E4 rules');

  // Simulated stage-2 failure → checkpoint recovery (REAL plan object in).
  const failure3 = 'The spreadsheet desktop app window lost focus and the accessibility tree could not be read before the import ran.';
  const checkpointRec3 = diagnoseComputerTaskCheckpointFailure({
    task: MSG3,
    failureMessage: failure3,
    outcomeStatus: 'failed',
    executionKind: 'run_computer_task',
    source: 'e2e-smoke',
    complexityPlan: plan3,
  })!;
  assert(Boolean(checkpointRec3), 'J3 checkpoint recovery diagnoses the staged failure');
  assert(checkpointRec3.failedStageId === plan3.stages[1].id, 'J3 recovery infers the failed stage (stage 2)', checkpointRec3.failedStageId);
  assert(JSON.stringify(checkpointRec3.completedStageIds) === JSON.stringify([plan3.stages[0].id]),
    'J3 recovery marks stage 1 as completed (do not redo)', checkpointRec3.completedStageIds);
  assert((checkpointRec3.failedStageGoal || '').includes('import'), 'J3 recovery carries the failed stage goal', checkpointRec3.failedStageGoal);
  assert(checkpointRec3.failedCheckpointId === 'observe-desktop', 'J3 failure maps to the observe-desktop checkpoint', checkpointRec3.failedCheckpointId);
  assert(checkpointRec3.surface === 'desktop', 'J3 failed checkpoint surface matches the failed stage surface family', checkpointRec3.surface);
  assert(checkpointRec3.retryPolicy.canRetry === true && checkpointRec3.retryPolicy.retryLimit === 1,
    'J3 retry policy allows one evidence-backed retry', checkpointRec3.retryPolicy);
  assert(checkpointRec3.retryPolicy.requiredEvidence.every((item) => typeof item.tool === 'string' && item.tool.length > 0),
    'J3 retry policy evidence tools are concrete strings');
  collectTools('J3 checkpoint recovery', checkpointRec3.retryPolicy.requiredEvidence);

  const checkpointPrompt3 = formatComputerTaskCheckpointRecoveryForPrompt(checkpointRec3)!;
  assertNoLeaks(checkpointPrompt3, 'J3 checkpoint recovery prompt');
  assert(checkpointPrompt3.includes(`failed stage: ${plan3.stages[1].id}`), 'J3 recovery prompt names the failed stage');
  assert(checkpointPrompt3.includes('resume from this stage'), 'J3 recovery prompt carries the resume-from-stage language');
  assert(checkpointPrompt3.includes(`completed stages (do NOT redo; reuse their artifacts): ${plan3.stages[0].id}`),
    'J3 recovery prompt forbids redoing completed stages');

  // Evidence recovery on the SAME failure with the route's contract + app
  // decision — the two recovery layers must agree about user/retry posture.
  const evidenceRec3 = diagnoseComputerTaskEvidenceFailure({
    contract: route3.evidenceContract,
    appRouteDecision: route3.appAutomationRouteDecision,
    task: MSG3,
    failureMessage: failure3,
    outcomeStatus: 'failed',
  })!;
  assert(Boolean(evidenceRec3), 'J3 evidence recovery diagnoses the same failure');
  if (route3.appAutomationRouteDecision) {
    assert(evidenceRec3.appRouteDecision?.status === route3.appAutomationRouteDecision.status,
      'J3 evidence recovery carries the route app decision status', { evidence: evidenceRec3.appRouteDecision?.status, route: route3.appAutomationRouteDecision.status });
    const blockingStatuses = ['needs_user_action', 'needs_approval', 'needs_connected_agent_buildout'];
    if (blockingStatuses.includes(route3.appAutomationRouteDecision.status)) {
      assert(evidenceRec3.retryAllowed === false, 'J3 blocking app-route status forbids blind retry', evidenceRec3.retryAllowed);
    }
  }
  // recommendedOptionId must be consistent with its own flags (cross-field type contract).
  const expectedOption3 = evidenceRec3.userActionRequired
    ? 'resolve_contract_blocker'
    : evidenceRec3.connectedAgentAllowed
      ? 'let_connected_agent_repair'
      : evidenceRec3.retryAllowed
        ? 'retry_with_fresh_evidence'
        : 'stop_and_report';
  assert(evidenceRec3.recommendedOptionId === expectedOption3, 'J3 evidence recovery option matches its flags', evidenceRec3.recommendedOptionId);
  collectTools('J3 evidence recovery', evidenceRec3.requiredEvidence);
  assertNoLeaks(formatComputerTaskEvidenceRecoveryForPrompt(evidenceRec3)!, 'J3 evidence recovery prompt');
  collectRecommended('J3 route', MSG3, route3.recommendedTools);

  // ═══════════════════════════════════════════════════════════════════════════
  // Journey 4 — Constraint + sticky-scope interplay
  // ═══════════════════════════════════════════════════════════════════════════
  section('Journey 4: forbidden(submit) hard-block + sticky downgrade gating');

  const created = createStickyScope({
    scopeKind: 'site',
    scopeKey: 'acme.com',
    allowedCategories: ['upload', 'download'],
    grantedByUserId: 'e2e-user',
  });
  if (!created.ok) throw new Error(`sticky scope creation failed: ${created.error}`);
  const scope = created.scope;

  // A floor category can never be granted into a sticky scope.
  const floorScopeAttempt = createStickyScope({
    scopeKind: 'site',
    scopeKey: 'acme.com',
    allowedCategories: ['pay'] as never[],
    grantedByUserId: 'e2e-user',
  });
  assert(floorScopeAttempt.ok === false, 'J4 floor category (pay) is rejected at scope creation');

  // WI-2: a browser upload/side-effect route is now zero-tap at the route
  // level (external side effects defer to the mid-run payment floor), so the
  // baseline no longer requires approval. A matching standing grant is still
  // recorded (stamped) so the user can see/revoke it later even though it no
  // longer flips an approval decision for browser routes.
  const MSG_UPLOAD = 'go to acme.com and upload the report.pdf to the client portal';
  const baselineUpload = mustRoute(MSG_UPLOAD);
  assert(baselineUpload.approvalRequired === false && !baselineUpload.stickyScopeApplied,
    'J4 baseline browser upload is zero-tap (WI-2) with no sticky stamp when no scope is present', { approval: baselineUpload.approvalRequired, sticky: baselineUpload.stickyScopeApplied });
  const stickyUpload = mustRoute(MSG_UPLOAD, { stickyScopes: [scope] });
  assert(stickyUpload.approvalRequired === false && stickyUpload.stickyScopeApplied?.scopeKey === 'acme.com',
    'J4 covered upload stays zero-tap and still records the standing grant', { approval: stickyUpload.approvalRequired, sticky: stickyUpload.stickyScopeApplied });
  assert(stickyUpload.stickyScopeApplied?.categories.includes('upload'), 'J4 sticky stamp records the auto-approved category', stickyUpload.stickyScopeApplied);
  const stickyNoticeLine = formatStickyScopeAppliedNotice({ scopeKey: 'acme.com' });
  assert(stickyUpload.notes.some((note) => note.includes(stickyNoticeLine)), 'J4 route notes carry the standing-grant notice', stickyUpload.notes);

  // Sticky-downgraded route runs quietly — and the handoff still carries the
  // standing-grant stamp so the user can see/revoke it later.
  const stickyAutonomy = buildChatComputerTaskAutonomy(stickyUpload);
  assert(stickyAutonomy.userEffort === 'none' && stickyAutonomy.canRunQuietly, 'J4 sticky route needs no user step', stickyAutonomy.userEffort);
  const stickyNotice = buildChatComputerRequestUserNotice(stickyUpload);
  assert(stickyNotice.visibility === 'hidden' && formatChatComputerRequestUserNotice(stickyNotice) === '',
    'J4 sticky route notice stays quiet', stickyNotice.visibility);
  const stickyHandoff = buildChatComputerHandoffContext({
    task: MSG_UPLOAD,
    entrypoint: 'browser_runtime',
    requestNotice: stickyNotice,
    evidenceContract: stickyUpload.evidenceContract,
    stickyScopeApplied: stickyUpload.stickyScopeApplied,
  });
  assert(stickyHandoff.metadata.standingGrant?.scopeKey === 'acme.com', 'J4 handoff metadata stamps the standing grant', stickyHandoff.metadata.standingGrant);
  assert((stickyHandoff.metadata.standingGrant?.notice || '').includes(stickyNoticeLine.slice(0, 60)),
    'J4 handoff standing-grant notice copy matches the route notice copy');
  assert((stickyHandoff.metadata.standingGrant?.notice || '').length <= 240, 'J4 standing-grant notice stays bounded (≤240 chars)');

  // Prompt block via the hydrated default registry path (the live wiring).
  setActiveStickyScopes([scope]);
  try {
    const stickyBlock = buildChatComputerRequestRoutePromptBlock(MSG_UPLOAD)!;
    assert(stickyBlock.includes('Standing grant applied:'), 'J4 prompt block carries the standing-grant line via the default registry');
    assert(stickyBlock.includes('The always-confirm floor (pay, delete, login, grant) still requires fresh confirmation.'),
      'J4 prompt block reminds that the floor survives the grant');
    assertNoLeaks(stickyBlock, 'J4 sticky prompt block');
  } finally {
    setActiveStickyScopes([]);
  }

  // Constraint interplay: "don't submit" adds a non-covered category, so the
  // sticky downgrade must NOT fire even though upload itself is covered.
  const MSG_CONSTRAINED = "go to acme.com and upload the report.pdf to the client portal, but don't submit the publish form";
  const constrainedRoute = mustRoute(MSG_CONSTRAINED, { stickyScopes: [scope] });
  assert(constrainedRoute.userConstraints?.forbidden.includes('submit'), 'J4 constrained route parses forbidden(submit)', constrainedRoute.userConstraints);
  assert(!constrainedRoute.stickyScopeApplied, 'J4 sticky downgrade does not fire when an uncovered constraint category is present', constrainedRoute.stickyScopeApplied);
  // WI-2: the route is zero-tap (browser external side effect deferred); the
  // forbidden(submit) constraint is still enforced as a HARD per-step block
  // below via constraintBlocksToolCall, not as a route-level approval.
  assert(constrainedRoute.approvalRequired === false, 'J4 constrained browser route is zero-tap; forbidden(submit) enforced per-step (WI-2)');
  const constrainedBlock = buildChatComputerRequestRoutePromptBlock(MSG_CONSTRAINED)!;
  assert(constrainedBlock.includes('User constraint (HARD): never perform submit'), 'J4 prompt block carries the hard forbidden(submit) rule');
  const constrainedPreview = buildChatComputerTaskPlanPreview(constrainedRoute);
  assert(constrainedPreview.constraints.some((line) => line.includes("Won't: submit")), 'J4 plan preview shows the user-facing constraint copy', constrainedPreview.constraints);

  // Floor interplay (WI-2): a browser pay route stamps the pay floor for
  // per-step (mid-run) enforcement but is zero-tap at the route level — the
  // single pay confirmation fires mid-run at the payment floor, not up front.
  // A sticky scope still never covers a floor category (the pay floor cannot be
  // granted, verified at scope creation above).
  const MSG_FLOOR = 'go to acme.com, download the receipt and pay the outstanding invoice';
  const floorRoute = mustRoute(MSG_FLOOR, { stickyScopes: [scope] });
  assert(floorRoute.alwaysConfirmFloor?.includes('pay'), 'J4 floor route stamps pay for mid-run per-step enforcement', floorRoute.alwaysConfirmFloor);
  assert(floorRoute.approvalRequired === false && !floorRoute.stickyScopeApplied,
    'J4 browser pay route is zero-tap at route level; pay confirmed mid-run at the payment floor (WI-2)', { approval: floorRoute.approvalRequired, sticky: floorRoute.stickyScopeApplied });

  // constraintBlocksToolCall verdicts — the R11 enforcement junction.
  const constraints4 = constrainedRoute.userConstraints!;
  const submitVerdict = constraintBlocksToolCall(constraints4, 'browser.submit_form', { selector: '#publish' });
  assert(submitVerdict.blocked === true && submitVerdict.category === 'submit', 'J4 forbidden(submit) hard-blocks a submit tool call', submitVerdict);
  const readVerdict = constraintBlocksToolCall(constraints4, 'browser.dom_snapshot', {});
  assert(readVerdict.blocked === false && !readVerdict.floorConfirmRequired, 'J4 read-only tool call passes the constraint gate', readVerdict);
  const floorVerdict = constraintBlocksToolCall(null, 'browser.click_role', { role: 'button', name: 'Pay now and charge my card' });
  assert(floorVerdict.blocked === false && floorVerdict.floorConfirmRequired === true && floorVerdict.floorCategory === 'pay',
    'J4 floor verdict asks for fresh confirmation without hard-blocking', floorVerdict);
  const precedenceVerdict = constraintBlocksToolCall(
    { forbidden: ['pay'], approvalBefore: [], stopConditions: [], sourcePhrases: [] },
    'payments.pay_invoice',
    {},
  );
  assert(precedenceVerdict.blocked === true && precedenceVerdict.category === 'pay',
    'J4 a forbidden-constraint block takes precedence over the floor confirm', precedenceVerdict);
  collectRecommended('J4 routes', MSG_UPLOAD, [...stickyUpload.recommendedTools, ...constrainedRoute.recommendedTools, ...floorRoute.recommendedTools]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Journey 5 — Recovery loop + tool-catalog cross-check
  // ═══════════════════════════════════════════════════════════════════════════
  section('Journey 5: evidence-recovery loop + real tool-catalog cross-check');

  // Actionability failure on a clean browser purchase route → bounded retry.
  // (A fresh route through the same chain — MSG1's "stop if … captcha" stop
  // condition poisons failure classification; locked + reported below.)
  const MSG5 = 'go to acme.com and buy the basic plan';
  const route5 = mustRoute(MSG5);
  const failure5 = 'Locator timeout: the "Buy basic plan" button was not visible and failed actionability checks twice.';
  const evidenceRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: route5.evidenceContract,
    task: MSG5,
    failureMessage: failure5,
    outcomeStatus: 'failed',
  })!;
  assert(evidenceRec5.failureArea === 'actionability', 'J5 actionability failure classified', evidenceRec5.failureArea);
  assert(evidenceRec5.retryAllowed === true && evidenceRec5.recommendedOptionId === 'retry_with_fresh_evidence',
    'J5 actionability failure recommends one fresh-evidence retry', { retry: evidenceRec5.retryAllowed, option: evidenceRec5.recommendedOptionId });
  const requiredTools5 = evidenceRec5.requiredEvidence.filter((item) => item.required).map((item) => item.tool);
  assert(requiredTools5.includes('browser.dom_snapshot') && requiredTools5.includes('browser.verification_state'),
    'J5 recovery requires fresh browser observation tools', requiredTools5);
  collectTools('J5 actionability recovery', evidenceRec5.requiredEvidence);

  // Readiness lifecycle: missing → ready → stale → blocked.
  assert(evidenceRec5.evidenceReadiness?.status === 'missing' && evidenceRec5.evidenceReadiness?.ready === false,
    'J5 readiness with no observations fails closed (missing)', evidenceRec5.evidenceReadiness?.status);
  assert(JSON.stringify([...(evidenceRec5.evidenceReadiness?.nextEvidenceTools || [])].sort()) === JSON.stringify([...new Set(requiredTools5)].sort()),
    'J5 missing readiness names exactly the required evidence tools', evidenceRec5.evidenceReadiness?.nextEvidenceTools);
  const nowMs = Date.now();
  const freshObservations: ComputerTaskEvidenceRecoveryObservation[] = requiredTools5.map((tool, index) => ({
    id: `obs-${index}`,
    tool,
    capturedAt: nowMs - 1_000,
    summary: `fresh ${tool} capture`,
  }));
  const readyReadiness = evaluateComputerTaskEvidenceRecoveryReadiness({ recovery: evidenceRec5, observations: freshObservations, nowMs })!;
  assert(readyReadiness.ready === true && readyReadiness.status === 'ready', 'J5 fresh observations make the retry ready', readyReadiness);
  const staleReadiness = evaluateComputerTaskEvidenceRecoveryReadiness({
    recovery: evidenceRec5,
    observations: freshObservations,
    nowMs: nowMs + 10 * 60_000,
  })!;
  assert(staleReadiness.ready === false && staleReadiness.status === 'stale', 'J5 aged observations degrade to stale (fail closed)', staleReadiness.status);

  // Regression: user task stop conditions are intent, not observed failure
  // evidence. "Stop if CAPTCHA" must not override the actual locator
  // actionability failure or disable its one fresh-evidence retry.
  const poisonedRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: contract1,
    task: MSG1,
    failureMessage: failure5,
    outcomeStatus: 'failed',
  })!;
  assert(poisonedRec5.failureArea === 'actionability' && poisonedRec5.retryAllowed === true,
    'J5 task stop-condition "captcha" cannot poison observed actionability recovery',
    { area: poisonedRec5.failureArea, retry: poisonedRec5.retryAllowed });

  // Approval-boundary failure on the floor route → blocked readiness.
  const blockedRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: floorRoute.evidenceContract,
    task: MSG_FLOOR,
    failureMessage: 'Stopped: payment requires approval before the final side effect; approval was not granted.',
    outcomeStatus: 'blocked',
  })!;
  assert(blockedRec5.failureArea === 'approval_boundary' && blockedRec5.retryAllowed === false,
    'J5 approval-boundary failure forbids retry', { area: blockedRec5.failureArea, retry: blockedRec5.retryAllowed });
  assert(blockedRec5.evidenceReadiness?.status === 'blocked', 'J5 blocked recovery reports blocked readiness', blockedRec5.evidenceReadiness?.status);
  collectTools('J5 approval recovery', blockedRec5.requiredEvidence);

  // Capability-gap failure on the Photoshop contract → connected-agent path.
  const gapFailure5 = 'missing bridge tool: desktop.photoshop_set_layer_state is not implemented on this bridge';
  const gapRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: contract2,
    failureMessage: gapFailure5,
    outcomeStatus: 'failed',
  })!;
  assert(gapRec5.failureArea === 'capability_gap' && gapRec5.connectedAgentAllowed === true,
    'J5 missing-adapter failure routes to connected-agent repair', { area: gapRec5.failureArea, agent: gapRec5.connectedAgentAllowed });
  assert(gapRec5.recommendedOptionId === 'let_connected_agent_repair', 'J5 capability gap recommends agent repair', gapRec5.recommendedOptionId);
  collectTools('J5 capability-gap recovery', gapRec5.requiredEvidence);

  // Regression: the requested "export" action is intent, not evidence that an
  // approval boundary caused the failure. The observed missing tool keeps the
  // connected-agent repair route.
  const gapPoisoned5 = diagnoseComputerTaskEvidenceFailure({
    contract: contract2,
    task: MSG2,
    failureMessage: gapFailure5,
    outcomeStatus: 'failed',
  })!;
  assert(gapPoisoned5.failureArea === 'capability_gap' && gapPoisoned5.connectedAgentAllowed === true,
    'J5 requested "export" cannot poison observed missing-adapter recovery',
    { area: gapPoisoned5.failureArea, agent: gapPoisoned5.connectedAgentAllowed });

  // Photoshop fresh-evidence failure → app-specific desktop evidence tools.
  const psRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: contract2,
    failureMessage: 'The layer inventory snapshot was stale; re-observe the document status before retrying.',
    outcomeStatus: 'failed',
  })!;
  const psTools5 = psRec5.requiredEvidence.map((item) => item.tool);
  assert(psTools5.includes('desktop.photoshop_document_status') && psTools5.includes('desktop.photoshop_layer_inventory'),
    'J5 Photoshop recovery demands Photoshop-native evidence tools', psTools5);
  collectTools('J5 photoshop recovery', psRec5.requiredEvidence);

  // User-unblock failure (CAPTCHA) → user action, no retry.
  const unblockRec5 = diagnoseComputerTaskEvidenceFailure({
    contract: contract1,
    task: MSG1,
    failureMessage: 'A CAPTCHA human verification challenge appeared on the checkout page.',
    outcomeStatus: 'blocked',
  })!;
  assert(unblockRec5.failureArea === 'user_unblock' && unblockRec5.userActionRequired === true && unblockRec5.retryAllowed === false,
    'J5 CAPTCHA failure requires the user and forbids retry', { area: unblockRec5.failureArea, user: unblockRec5.userActionRequired });
  collectTools('J5 user-unblock recovery', unblockRec5.requiredEvidence);

  // ── Tool catalog cross-check against the REAL openswanToolRuntime ─────────
  // (dynamic import AFTER registerHooks so the native stubs apply)
  const toolRuntime = await import('../src/lib/openswanToolRuntime');
  const surfaces = ['main_chat', 'room_chat', 'office', 'task_run'] as const;
  const catalog = new Set<string>();
  for (const surface of surfaces) {
    for (const definition of toolRuntime.listOpenSwanToolsForSurface(surface)) catalog.add(definition.name);
  }
  assert(catalog.size > 100, 'J5 real tool catalog loaded (>100 tools)', catalog.size);

  // Recovery contracts promise these catalog tools — they must exist for the
  // loop to ever satisfy a required observation with a real dispatch.
  const MUST_EXIST = [
    'browser.dom_snapshot', 'browser.verification_state', 'browser.locator_actionability', 'browser.screenshot',
    'desktop.read_a11y_tree', 'desktop.window_state', 'desktop.screenshot',
    'desktop.file_search', 'desktop.file_stat',
    'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory',
    'desktop.indesign_document_status', 'desktop.indesign_text_inventory',
    'approvals.request', 'research.search',
  ];
  for (const tool of MUST_EXIST) {
    assert(catalog.has(tool), `J5 catalog contains recovery-promised tool ${tool}`);
  }

  // Names recovery emits that are deliberately NOT dispatchable catalog tools
  // (markers for user steps / runtime-internal evidence). If one of these
  // ever ships as a real catalog tool, remove it here — the disjointness
  // assert below keeps this list honest.
  const KNOWN_VIRTUAL = new Set([
    'user.confirm_unblocked',            // user-step marker, resolved by chat UX not a tool
    'agent.build_app_capability.result', // result artifact of catalog tool agent.build_app_capability
    'computer.focused_smoke',            // runtime-internal verification marker
    'computer.access_plan',              // runtime-internal readiness marker
    'computer.preflight',                // runtime-internal readiness marker
    'computer.result_summary',           // runtime-internal summary marker
    'computer.failure_fingerprint',      // runtime-internal recovery marker
    'computer.grounding_trace',          // runtime-internal recovery marker
  ]);
  for (const virtual of KNOWN_VIRTUAL) {
    assert(!catalog.has(virtual), `J5 virtual name stays out of the catalog: ${virtual}`);
  }

  let recoveryToolFailures = 0;
  for (const [tool, source] of referencedRecoveryTools) {
    if (!catalog.has(tool) && !KNOWN_VIRTUAL.has(tool)) {
      recoveryToolFailures += 1;
      fail(`J5 recovery tool drift: "${tool}" (from ${source}) is neither in the openswanToolRuntime catalog nor the documented virtual set`);
    }
  }
  assert(recoveryToolFailures === 0, `J5 all ${referencedRecoveryTools.size} recovery-referenced tool names resolve (catalog or documented virtual)`);

  // Route recommendedTools (browser./desktop./approvals./vault./wp. prefixed)
  // must also resolve in the OpenSwan catalog.
  // Adapter-gap proposal names collected from the SAME chain (the buildout
  // targets the design pipeline proposes) are allowed but must stay out of
  // the catalog — once one ships, the gap plan should stop proposing it.
  let recommendedFailures = 0;
  for (const [tool, source] of referencedRecommendedTools) {
    if (!catalog.has(tool) && !gapProposalTools.has(tool)) {
      recommendedFailures += 1;
      fail(`J5 recommended-tool drift: "${tool}" (from ${source}) is neither in the openswanToolRuntime catalog nor an adapter-gap buildout proposal`);
    }
  }
  assert(recommendedFailures === 0, `J5 all ${referencedRecommendedTools.size} route-recommended bridge tool names resolve in the catalog`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\ncomputer-pipeline-e2e-smoketest: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error('computer-pipeline-e2e-smoketest crashed:', error);
  process.exit(1);
});
