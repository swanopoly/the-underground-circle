/**
 * Chat bounded multi-action routing invariant smoke.
 *
 * The pure probes prove what Chat decides for ordinary, bounded compound, and
 * Plan-mode turns. The narrow source probes cover stateful React seams that
 * cannot be executed without mounting the full Chat surface: once preflight
 * owns an A1-A3 ledger, no single-purpose shortcut may peel off one clause and
 * return before the authoritative OpenSwan terminal accounts for every action.
 *
 * Run:
 *   npx tsx scripts/chat-multi-action-routing-invariants-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { buildAgentPlanDraft } from '../src/lib/agentPlanMode';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

const root = process.cwd();
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const chat = readFileSync(chatPath, 'utf8');
const chatSource = ts.createSourceFile(
  chatPath,
  chat,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);

let assertions = 0;
let failures = 0;

async function check(name: string, assertion: () => void | Promise<void>): Promise<void> {
  assertions += 1;
  try {
    await assertion();
    console.log('pass:', name);
  } catch (error) {
    failures += 1;
    const detail = error instanceof Error ? error.message : String(error);
    console.error('FAIL:', `${name}\n  ${detail}`);
  }
}

function sourceSection(start: string, end: string, label: string): string {
  const startIndex = chat.indexOf(start);
  assert(startIndex >= 0, `${label}: start marker exists`);
  const endIndex = chat.indexOf(end, startIndex + start.length);
  assert(endIndex > startIndex, `${label}: end marker exists after start`);
  return chat.slice(startIndex, endIndex);
}

function variableInitializer(name: string): string {
  const matches: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(chatSource);
  assert.equal(matches.length, 1, `${name} has one unambiguous declaration`);
  return matches[0]!.initializer!.getText(chatSource);
}

function actionProjection(message: string, selectedMode: string) {
  const plan = buildChatAutomationPlan({ message, selectedMode });
  return {
    plan,
    actions: plan.multiActionLedger?.actions.map((action) => ({
      id: action.id,
      text: action.text,
      dependsOnActionIds: action.dependsOnActionIds,
    })) || null,
  };
}

async function main(): Promise<void> {
  await check('Act mode preserves one exact sequential A1-A3 OpenSwan turn', () => {
    const { plan, actions } = actionProjection(
      'List the open tasks, then create a launch task, then show my memories',
      'act',
    );
    assert.equal(plan.execution.kind, 'run_openswan');
    assert.equal(plan.multiActionLedger?.dispatchMode, 'single_openswan_turn');
    assert.deepEqual(actions, [
      { id: 'A1', text: 'List the open tasks', dependsOnActionIds: [] },
      { id: 'A2', text: 'create a launch task', dependsOnActionIds: ['A1'] },
      { id: 'A3', text: 'show my memories', dependsOnActionIds: ['A2'] },
    ]);
  });

  await check('a then-boundary waits for the complete preceding parallel group', () => {
    const plan = buildChatAutomationPlan({
      message: 'Research the market and list the open tasks, then create a follow-up task',
      selectedMode: 'execute',
    });
    assert.deepEqual(
      plan.multiActionLedger?.actions.map((action) => ({
        id: action.id,
        dependsOnActionIds: action.dependsOnActionIds,
      })),
      [
        { id: 'A1', dependsOnActionIds: [] },
        { id: 'A2', dependsOnActionIds: [] },
        { id: 'A3', dependsOnActionIds: ['A1', 'A2'] },
      ],
    );

    const downstreamParallel = buildChatAutomationPlan({
      message: 'Research the market, then list the open tasks and show my memories',
      selectedMode: 'execute',
    });
    assert.deepEqual(
      downstreamParallel.multiActionLedger?.actions.map((action) => action.dependsOnActionIds),
      [[], ['A1'], ['A1']],
    );
  });

  await check('Build mode preserves one exact read-then-mutate A1-A2 OpenSwan turn', () => {
    const { plan, actions } = actionProjection(
      'List the WordPress drafts, then publish the latest one',
      'build',
    );
    assert.equal(plan.execution.kind, 'run_openswan');
    assert.equal(plan.risk, 'external_side_effect');
    assert.equal(plan.approval.required, true);
    assert.deepEqual(actions, [
      { id: 'A1', text: 'List the WordPress drafts', dependsOnActionIds: [] },
      { id: 'A2', text: 'publish the latest one', dependsOnActionIds: ['A1'] },
    ]);
  });

  await check('Plan mode stays nonexecuting while retaining exact A1-A2 metadata', () => {
    const draft = buildAgentPlanDraft({
      task: 'List the WordPress drafts, then publish the latest one',
      selectedMode: 'plan',
      selectedModel: 'claude-sonnet-4-6',
    });
    assert.equal(draft.mode, 'plan');
    assert.equal(draft.flow.swanbot.role, 'planner');
    assert.equal(draft.status, 'draft');
    assert.equal(draft.buildReady, false);
    assert(draft.steps.every((step) => step.status !== 'running' && step.status !== 'completed'));
    assert.equal(draft.metadata.chatPlan.execution.kind, 'run_openswan');
    assert.deepEqual(
      draft.metadata.chatPlan.multiActionLedger?.actions.map((action) => ({
        id: action.id,
        text: action.text,
        dependsOnActionIds: action.dependsOnActionIds,
      })),
      [
        { id: 'A1', text: 'List the WordPress drafts', dependsOnActionIds: [] },
        { id: 'A2', text: 'publish the latest one', dependsOnActionIds: ['A1'] },
      ],
    );
  });

  await check('ordinary single actions retain their legacy direct routes', () => {
    const taskList = buildChatAutomationPlan({ message: 'List the open tasks', selectedMode: 'act' });
    assert.equal(taskList.execution.kind, 'run_command_handler');
    assert.equal(taskList.multiActionLedger, undefined);

    const illustrator = buildChatAutomationPlan({ message: 'Open Adobe Illustrator', selectedMode: 'act' });
    assert.equal(illustrator.execution.kind, 'run_computer_task');
    assert.equal(illustrator.multiActionLedger, undefined);
  });

  await check('a human-only mention never creates a silently orphaned executable ledger', () => {
    const humanMention = buildChatAutomationPlan({
      message: '@Morgan review the launch brief, then send me your feedback',
      selectedMode: 'act',
    });
    // Chat deliberately leaves leading non-agent @mentions for the human
    // message lane. An A# ledger here would later be skipped by that lane and
    // could leave the user with neither a human-only post nor an agent receipt.
    assert.equal(humanMention.multiActionLedger, undefined);
  });

  await check('generic compounds gain coverage and oversized requests fail closed', () => {
    for (const message of [
      'List tasks, then complete the latest one',
      'Research the issue, then write a report',
      'Review the code, then update the changelog',
    ]) {
      const plan = buildChatAutomationPlan({ message, selectedMode: 'act' });
      assert.equal(plan.execution.kind, 'run_openswan', message);
      assert.equal(plan.multiActionLedger?.actionCount, 2, message);
    }

    const oversized = buildChatAutomationPlan({
      message: 'Create a task, then research competitors, then list office agents, then show memories',
      selectedMode: 'act',
    });
    assert.equal(oversized.execution.kind, 'ask_clarification');
    assert.equal(oversized.execution.clarification?.reason, 'multi_action_limit');
    assert.equal(oversized.multiActionOverflow?.actionCount, 4);
    assert.equal(oversized.multiActionLedger, undefined);
  });

  await check('compound mutation floor includes UI actions and scheduling', () => {
    const click = buildChatAutomationPlan({
      message: 'Click the submit button, then create a task called done',
      selectedMode: 'act',
    });
    assert.equal(click.risk, 'external_side_effect');
    assert.equal(click.approval.required, true);

    const schedule = buildChatAutomationPlan({
      message: 'List meetings, then schedule the latest one',
      selectedMode: 'act',
    });
    assert.equal(schedule.risk, 'external_side_effect');
    assert.equal(schedule.approval.required, true);
  });

  await check('preflight runs before pending clarification and booking follow-up seams', () => {
    const preflightIndex = chat.indexOf('const preflightAutomationForTurn');
    const pendingIndex = chat.indexOf('// ── Resume a pending clarification');
    const bookingIndex = chat.indexOf('// ── Booking follow-up seam');
    assert(preflightIndex > 0 && preflightIndex < pendingIndex && pendingIndex < bookingIndex);

    const pending = sourceSection(
      '// ── Resume a pending clarification',
      '// ── Booking follow-up seam',
      'pending clarification seam',
    );
    const booking = sourceSection(
      '// ── Booking follow-up seam',
      'const recoverySelectionForDisplay',
      'booking follow-up seam',
    );
    assert.match(pending, /if\s*\(\s*!preflightHasAuthoritativeMultiActionContract/);
    assert.match(booking, /if\s*\(\s*!preflightHasAuthoritativeMultiActionContract/);
  });

  await check('the same preflight ledger remains authoritative through final routing', () => {
    assert.match(
      variableInitializer('preflightHasAuthoritativeMultiActionContract'),
      /^Boolean\(\s*preflightAutomationForTurn\?\.multiActionLedger\s*\|\|\s*preflightAutomationForTurn\?\.multiActionOverflow,?\s*\)$/,
    );
    assert.match(
      variableInitializer('plannedAutomationForTurn'),
      /^preflightAutomationForTurn$/,
    );
    assert.match(
      variableInitializer('hasAuthoritativeMultiActionContract'),
      /^Boolean\(\s*plannedAutomationForTurn\?\.multiActionLedger\s*\|\|\s*plannedAutomationForTurn\?\.multiActionOverflow,?\s*\)$/,
    );
  });

  await check('recovery and attachment shortcuts yield to preflight A# ownership', () => {
    assert.match(
      variableInitializer('directRecoverySelection'),
      /preflightHasAuthoritativeMultiActionContract[\s\S]*?\?\s*null\s*:\s*parseChatFailureRecoveryOptionSelection/,
    );
    assert.match(
      variableInitializer('shouldRunDesktopAttachmentTask'),
      /^!preflightHasAuthoritativeMultiActionContract\b/,
    );
    assert.match(
      variableInitializer('recoveryFollowup'),
      /^!preservesIntactMultiIntentTurn\b/,
    );
  });

  await check('terminal status/control and launch shortcuts yield to preflight A# ownership', () => {
    const control = variableInitializer('terminalAgentControl');
    assert.match(control, /^preflightHasAuthoritativeMultiActionContract\s*\?\s*null\s*:/);
    assert.match(control, /executeTerminalAgentControlFromChat/);

    const launch = variableInitializer('terminalAgentLaunch');
    assert.match(launch, /^preflightHasAuthoritativeMultiActionContract\s*\?\s*null\s*:/);
    assert.match(launch, /executeTerminalAgentLaunchFromChat/);
  });

  await check('multi-agent and selected connected-agent shortcuts yield to preflight A# ownership', () => {
    const multiAgent = variableInitializer('multiAgentPlan');
    assert.match(multiAgent, /^preflightHasAuthoritativeMultiActionContract\s*\?\s*null\s*:/);
    assert.match(multiAgent, /parseMultiAgentOrchestrationRequest/);

    const selected = sourceSection(
      '// ─── Selected connected-agent route',
      '// ─── Slash intercepts',
      'selected connected-agent route',
    );
    assert.match(selected, /if\s*\(\s*!preflightHasAuthoritativeMultiActionContract/);
    assert.match(selected, /dispatchAssignedAgentTask/);
  });

  await check('web and model-capability shortcuts yield to final A# ownership', () => {
    const web = sourceSection(
      '// ─── Web Search routing',
      '// Build one image description per turn',
      'web-search route',
    );
    assert.match(web, /if\s*\(webDecision\.attach\s*&&\s*!preservesIntactMultiIntentTurn\)/);
    assert.match(web, /runOptionalWebSearchLane/);

    const capability = sourceSection(
      '// ─── Model capability routing',
      '// Trigger Agent AI',
      'model-capability route',
    );
    assert.match(capability, /&&\s*!preservesIntactMultiIntentTurn/);
    assert.match(capability, /routeByCapability/);
  });

  await check('Photoshop and InDesign clarifiers yield to preflight A# ownership', () => {
    const photoshop = variableInitializer('photoshopGenerativeFillClarification');
    assert.match(photoshop, /^preflightHasAuthoritativeMultiActionContract\s*\?/);
    assert.match(photoshop, /:\s*buildPhotoshopGenerativeFillClarification/);

    const indesign = variableInitializer('indesignBannerClarification');
    assert.match(indesign, /^preflightHasAuthoritativeMultiActionContract\s*\?/);
    assert.match(indesign, /:\s*buildInDesignBannerClarification/);
  });

  await check('A# runtime keeps its ledger while Chat seals an exact connected tool model and image failures stay explicit', () => {
    const readiness = sourceSection(
      'const catalogRequestedTurnModel =',
      '// ── Resume a pending clarification',
      'model-readiness gate',
    );
    assert.doesNotMatch(readiness, /catalogOwnsThisTurn[\s\S]{0,500}!preflightHasAuthoritativeMultiActionContract/);
    assert.match(readiness, /resolveReadyChatModelForTurn/);
    assert.match(readiness, /requireToolUse: requiresToolUse/);
    assert.match(readiness, /No approved connected Chat model could safely run this turn, so nothing ran\./);
    assert.match(readiness, /exactTurnCatalog = await refreshTurnModelCatalogIfNeeded\(\)/);
    assert.match(readiness, /if \(!resolveTurnModelFromCatalog\(exactTurnCatalog\)\) return;/);

    const visualBrief = sourceSection(
      'const requireTurnVisualBriefs = async',
      'const desktopAttachmentCandidates',
      'visual-brief gate',
    );
    assert.match(visualBrief, /no task was sent/);
    assert.match(visualBrief, /did not send guessed image contents/);
    assert.match(visualBrief, /return null;/);

    const selectedModelBrief = sourceSection(
      '// Build one image description per turn',
      '// ─── Model capability routing',
      'selected-model visual-brief caller',
    );
    assert.match(selectedModelBrief, /const briefs = await requireTurnVisualBriefs/);
    assert.match(selectedModelBrief, /if\s*\(briefs === null\)\s*return;/);
  });

  await check('image capability fallback is visible instead of a false silent artifact success', () => {
    const capability = sourceSection(
      '// ─── Model capability routing',
      '// Trigger Agent AI',
      'model-capability fallback',
    );
    assert.match(capability, /if\s*\(capResult\.fallbackNotice\)/);
    assert.match(capability, /addBotMessage\(capResult\.fallbackNotice\)/);
    assert.match(capability, /missing artifact isn't a silent mystery/);
  });

  if (failures > 0) {
    console.error(`\n${failures}/${assertions} Chat multi-action routing invariant assertion(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nChat multi-action routing invariant smoke passed (${assertions} assertions).`);
}

void main();
