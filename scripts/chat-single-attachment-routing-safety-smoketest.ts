/**
 * Chat single-attachment routing safety smoke.
 *
 * This test combines pure planner/plan-draft behavior with narrow source
 * invariants for ChatTab's stateful send pipeline. It performs no provider,
 * Supabase, storage, vision, desktop-bridge, or network I/O.
 *
 * Run:
 *   npx tsx scripts/chat-single-attachment-routing-safety-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { buildAgentPlanDraft } from '../src/lib/agentPlanMode';
import {
  bindChatAttachmentActionContract,
  buildChatAutomationPlan,
} from '../src/lib/chatAutomationPlanner';

const root = process.cwd();
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const chat = readFileSync(chatPath, 'utf8');
const chatAst = ts.createSourceFile(
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

function sourceIndex(needle: string, after = 0, label = needle): number {
  const index = chat.indexOf(needle, after);
  assert(index >= 0, `${label}: source marker exists`);
  return index;
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
  visit(chatAst);
  assert.equal(matches.length, 1, `${name} has one unambiguous declaration`);
  return matches[0]!.initializer!.getText(chatAst);
}

function bindOneAttachment(
  message: string,
  options: Readonly<{
    addressedToCurrentAgent?: boolean;
    preserveExistingExecutor?: boolean;
  }> = {},
) {
  const base = buildChatAutomationPlan({ message, selectedMode: 'none' });
  const bound = bindChatAttachmentActionContract(base, {
    message,
    hasCurrentTurnAttachment: true,
    ...options,
  });
  return { base, bound };
}

async function main(): Promise<void> {
  console.log('\nRecipient identity and executor ownership');

  await check('an exact loaded member identity outranks reserved OpenSwan alias text', () => {
    // Chat has already resolved @swan to an exact loaded member and therefore
    // passes addressedToCurrentAgent:false. The binder must honor that typed
    // identity instead of reinterpreting the raw handle as an agent alias.
    const { base, bound } = bindOneAttachment('@swan review the attached private brief', {
      addressedToCurrentAgent: false,
    });
    assert.strictEqual(bound, base);
    assert.equal(bound.multiActionLedger, undefined);
  });

  await check('an exact human alias collision strips a stale compound execution ledger', () => {
    const message = '@swan, generate a logo, then create a task called review';
    const { base, bound } = bindOneAttachment(message, {
      addressedToCurrentAgent: false,
    });
    assert.ok(base.multiActionLedger, 'lexical preflight demonstrates the reserved-alias collision');
    assert.equal(bound.multiActionLedger, undefined);
    assert.equal(bound.multiActionOverflow, undefined);
  });

  await check('Chat resolves exact member identity before consulting text aliases', () => {
    const member = variableInitializer('leadingMentionMember');
    const addressed = variableInitializer('addressedToCurrentAgentForPreflight');
    const elsewhere = variableInitializer('addressedElsewhereForPreflight');
    assert.match(member, /members\.find\(/);
    assert.match(member, /member\?\.username/);
    assert.match(member, /leadingMentionHandle\.toLowerCase\(\)/);
    assert.match(
      addressed,
      /leadingMentionMember\s*\?\s*leadingMentionMember\.id\s*===\s*BLACKSWAN_ID\s*:/,
    );
    assert.match(addressed, /agent\|blackswan\|swanbot\|swan/);
    assert.match(elsewhere, /leadingMentionHandle\s*&&\s*!addressedToCurrentAgentForPreflight/);

    const binder = sourceSection(
      'bindChatAttachmentActionContract(basePreflightAutomationForTurn',
      'const preflightHasAuthoritativeMultiActionContract =',
      'attachment binder call',
    );
    assert.match(binder, /addressedToCurrentAgent:\s*addressedToCurrentAgentForPreflight/);
  });

  await check('a selected connected-agent attachment keeps its existing executor', () => {
    const message = 'Review the attached private brief';
    const { base, bound } = bindOneAttachment(message, { preserveExistingExecutor: true });
    assert.strictEqual(bound, base);
    assert.equal(bound.multiActionLedger, undefined);

    const preserved = variableInitializer('preservesConnectedAgentExecutorForPreflight');
    assert.match(preserved, /selectedChatAgentTarget/);
    assert.match(preserved, /!isOpenSwanChatAgentTarget/);
    const binder = sourceSection(
      'bindChatAttachmentActionContract(basePreflightAutomationForTurn',
      'const preflightHasAuthoritativeMultiActionContract =',
      'attachment binder call',
    );
    assert.match(binder, /preserveExistingExecutor:\s*preservesConnectedAgentExecutorForPreflight/);
  });

  console.log('\nEarly stops retain attachment state');

  await check('bound Continue with pending attachments stops before send and retains the composer files', () => {
    const resume = sourceSection(
      'const boundOpenSwanResume = options?.openSwanResume || null;',
      'const conversationOnlyTurn =',
      'bound Continue attachment stop',
    );
    assert.match(resume, /if\s*\(boundOpenSwanResume\s*&&\s*hasPendingAttachments\)/);
    assert.match(resume, /cannot consume files waiting in the composer/i);
    assert.match(resume, /Your attachments are still here/i);
    assert.match(resume, /localOnly:\s*true/);
    assert.match(resume, /return;/);
    assert.doesNotMatch(resume, /setAttachments\(|setStagedFiles\(|revokeStagedPreviews\(/);
    assert.doesNotMatch(resume, /addUserMessage\(|runOpenSwanSessionTurn\(|executeSharedComputerTask\(/);
  });

  await check('slash plus attachment stops before message persistence, provider, or bridge dispatch', () => {
    const slashStart = sourceIndex("if (hasPendingAttachments && content.startsWith('/'))", 0, 'slash attachment stop');
    const slashEnd = sourceIndex('// A curated shelf is discovery', slashStart, 'post-slash readiness marker');
    const slash = chat.slice(slashStart, slashEnd);
    assert.match(slash, /cannot run through a slash shortcut yet/i);
    assert.match(slash, /Your files are still attached/i);
    assert.match(slash, /localOnly:\s*true/);
    assert.match(slash, /return;/);
    assert.doesNotMatch(slash, /setAttachments\(|setStagedFiles\(|addUserMessage\(/);
    assert.doesNotMatch(slash, /routeByCapability\(|runOpenSwanSessionTurn\(|executeSharedComputerTask\(/);

    const mainUserMessage = sourceIndex(
      'const userMessage = resumedSourceUserMessage || addUserMessage(',
      slashEnd,
      'main user-message persistence call',
    );
    assert(slashStart < mainUserMessage, 'slash attachment stop precedes the main user-message persistence call');
  });

  await check('picker-only or native attachment state stops before attachment I/O and is retained', () => {
    const picker = sourceSection(
      'if (currentAttachments.length > 0) {',
      'const unavailableStagedFile =',
      'picker-only attachment stop',
    );
    assert.match(picker, /has not finished entering the secure upload path/i);
    assert.match(picker, /nothing was sent or opened/i);
    assert.match(picker, /localOnly:\s*true/);
    assert.match(picker, /return;/);
    assert.doesNotMatch(picker, /setAttachments\(|setStagedFiles\(|revokeStagedPreviews\(/);
    assert.doesNotMatch(
      picker,
      /uploadAttachment\(|linkAttachmentsToMessage\(|getTurnVisualBriefs\(|routeByCapability\(|dispatchAssignedAgentTask\(|executeSharedComputerTask\(|runOpenSwanSessionTurn\(/,
    );

    const pickerIndex = sourceIndex('if (currentAttachments.length > 0) {');
    const persistenceIndex = sourceIndex('const requiresAttachmentPersistence =', pickerIndex);
    assert(pickerIndex < persistenceIndex, 'picker-only state stops before the attachment persistence observer exists');

    // Any early stateful shortcut that could precede this guard yields to the
    // bound A1, exact-human, or selected-executor classification first.
    const readiness = sourceSection(
      '// A curated shelf is discovery',
      '// ── Resume a pending clarification',
      'pre-picker model readiness',
    );
    assert.match(readiness, /!preflightHasAuthoritativeMultiActionContract/);
    assert.match(readiness, /!addressedElsewhereForPreflight/);
    assert.match(readiness, /!preservesConnectedAgentExecutorForPreflight/);
    const clarificationAndBooking = sourceSection(
      '// ── Resume a pending clarification',
      'const recoverySelectionForDisplay',
      'pre-picker clarification and booking seams',
    );
    assert((clarificationAndBooking.match(/!addressedElsewhereForPreflight/g) || []).length >= 2);
    assert((clarificationAndBooking.match(/!preservesConnectedAgentExecutorForPreflight/g) || []).length >= 2);
  });

  console.log('\nShared persistence and routing barrier');

  await check('every executable attachment consumer is downstream of exact message linking', () => {
    const linkIndex = sourceIndex('await linkAttachmentsToMessage(');
    const humanStopIndex = sourceIndex(
      'if (addressedElsewhereForPreflight && requiresAttachmentPersistence) {',
      linkIndex,
      'human-addressed attachment stop',
    );
    assert(humanStopIndex > linkIndex, 'human routing is decided only after exact attachment linkage');

    for (const consumer of [
      "requireTurnVisualBriefs('the terminal agent')",
      'dispatchAssignedAgentTask(',
      'executeAgentRun({',
      'runOptionalWebSearchLane(',
      'routeByCapability(',
      'assembleOpenSwanAttachmentTurnSources(',
      'runOpenSwanSessionTurn({',
    ]) {
      const consumerIndex = sourceIndex(consumer, 0, `${consumer} consumer`);
      assert(consumerIndex > linkIndex, `${consumer} remains downstream of exact message linking`);
    }

    // The only desktop attachment invocation above the barrier is sealed in a
    // permanently disabled legacy branch. Keeping both assertions together
    // prevents a later boolean flip from silently reviving path-bearing I/O.
    assert.equal(variableInitializer('legacyDesktopAttachmentRouteEnabled'), 'false');
    const legacyDesktop = sourceSection(
      'const shouldRunDesktopAttachmentTask =',
      'const resolvedFigmaRefs =',
      'disabled legacy desktop attachment route',
    );
    assert.match(legacyDesktop, /legacyDesktopAttachmentRouteEnabled/);
    assert.match(legacyDesktop, /stageUploadedFilesForDesktopTask\(/);
    assert.match(legacyDesktop, /executeSharedComputerTask\(/);
  });

  await check('a human-addressed upload persists and links, then reaches no agent or automation consumer', () => {
    const mainUserMessage = sourceIndex('const userMessage = resumedSourceUserMessage || addUserMessage(');
    const linkIndex = sourceIndex('await linkAttachmentsToMessage(', mainUserMessage);
    const humanStopIndex = sourceIndex(
      'if (addressedElsewhereForPreflight && requiresAttachmentPersistence) {',
      linkIndex,
      'human-addressed attachment stop',
    );
    const afterHumanStop = sourceIndex(
      'if (\n      preservesConnectedAgentExecutorForPreflight',
      humanStopIndex,
      'connected-agent private-file guard',
    );
    const humanStop = chat.slice(humanStopIndex, afterHumanStop);

    assert(mainUserMessage < linkIndex && linkIndex < humanStopIndex);
    assert.match(humanStop, /return;/);
    assert.doesNotMatch(
      humanStop,
      /getTurnVisualBriefs\(|requireTurnVisualBriefs\(|runOptionalWebSearchLane\(|routeByCapability\(|dispatchAssignedAgentTask\(|executeSharedComputerTask\(|runOpenSwanSessionTurn\(/,
    );

    // All named consumers live after this unconditional human-only return;
    // the earlier desktop branch is non-executable by the pinned false gate.
    for (const consumer of [
      "requireTurnVisualBriefs('the terminal agent')",
      'runOptionalWebSearchLane(',
      'routeByCapability(',
      'runOpenSwanSessionTurn({',
    ]) {
      assert(sourceIndex(consumer, humanStopIndex, `${consumer} post-human route`) > humanStopIndex);
    }
  });

  await check('link failure exits before every downstream attachment consumer', () => {
    const persistenceHelper = sourceSection(
      'const requirePersistedUserMessageId = (): Promise<string> => {',
      '// Every attachment consumer shares one durability barrier.',
      'exact message persistence helper',
    );
    const boundary = sourceSection(
      '// Every attachment consumer shares one durability barrier.',
      '// A human-addressed upload is now durably attached',
      'shared attachment durability boundary',
    );
    const persistence = boundary.indexOf('const persistedMessageId = await requirePersistedUserMessageId();');
    const link = boundary.indexOf('await linkAttachmentsToMessage(');
    const blocked = boundary.indexOf('addAuthoritativeAttachmentBlockedMessage(');
    const stop = boundary.indexOf('return;', blocked);
    assert(persistence >= 0 && link > persistence);
    assert(blocked > link && stop > blocked);
    assert.match(persistenceHelper, /persistenceOutcome\s*=\s*await\s+Promise\.race/);
    assert.match(persistenceHelper, /persistedSourceUserMessageId\s*=\s*persistenceOutcome\.persistedMessageId/);
    assert.doesNotMatch(
      boundary,
      /requireTurnVisualBriefs\(|runOptionalWebSearchLane\(|routeByCapability\(|dispatchAssignedAgentTask\(|executeSharedComputerTask\(|runOpenSwanSessionTurn\(/,
    );
  });

  await check('a selected connected agent with a non-image private file blocks after link without OpenSwan fallback', () => {
    const guard = sourceSection(
      'if (\n      preservesConnectedAgentExecutorForPreflight',
      "if (desktopAttachmentRequest?.intent === 'desktop_edit')",
      'connected-agent private-file guard',
    );
    assert.match(guard, /effectiveChatMode\s*!==\s*['"]plan['"]/);
    assert.match(guard, /currentStagedFiles\.some\(\(file\)\s*=>\s*!file\.mimeType\.startsWith\(['"]image\/['"]\)\)/);
    assert.match(guard, /cannot receive this private file through a verified source capability yet/i);
    assert.match(guard, /did not substitute OpenSwan/i);
    assert.match(guard, /outcomeVerdict:\s*['"]blocked['"]/);
    assert.match(guard, /return;/);
    assert.doesNotMatch(guard, /dispatchAssignedAgentTask\(|executeAgentRun\(|runOpenSwanSessionTurn\(/);

    const linkIndex = sourceIndex('await linkAttachmentsToMessage(');
    const guardIndex = sourceIndex('if (\n      preservesConnectedAgentExecutorForPreflight', linkIndex);
    const selectedRouteIndex = sourceIndex('// ─── Selected connected-agent route', guardIndex);
    const openSwanIndex = sourceIndex('runOpenSwanSessionTurn({', selectedRouteIndex);
    assert(linkIndex < guardIndex && guardIndex < selectedRouteIndex && selectedRouteIndex < openSwanIndex);
  });

  console.log('\nPlan-mode identity and exact plan retention');

  await check('plan mode retains the exact bound attachment plan and persisted DB message id', () => {
    const message = 'Summarize the attached launch brief';
    const { bound } = bindOneAttachment(message, { addressedToCurrentAgent: true });
    assert.equal(bound.multiActionLedger?.actionCount, 1);

    const draft = buildAgentPlanDraft({
      task: message,
      chatPlan: bound,
      selectedMode: 'plan',
      selectedModel: 'claude-sonnet-4-6',
      circleId: 'circle-1',
      threadId: 'thread-1',
      sourceMessageId: 'persisted-message-db-1',
      createdBy: 'user-1',
    });
    assert.equal(draft.mode, 'plan');
    assert.equal(draft.sourceMessageId, 'persisted-message-db-1');
    assert.strictEqual(draft.metadata.chatPlan, bound);
    assert.deepEqual(draft.metadata.chatPlan.multiActionLedger, bound.multiActionLedger);

    const planMode = sourceSection(
      '// ─── Agent Plan Mode',
      '// ─── Conversational intent routing',
      'agent plan mode',
    );
    assert.match(planMode, /chatPlan:\s*preflightAutomationForTurn/);
    assert.equal(
      (planMode.match(/sourceMessageId:\s*persistedAttachmentMessageId\s*\|\|\s*userMessage\.id/g) || []).length,
      2,
      'draft construction and durable plan save share the exact persisted attachment message id',
    );
  });

  if (failures > 0) {
    console.error(`\n${failures}/${assertions} single-attachment routing safety assertion(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nChat single-attachment routing safety smoke passed (${assertions} assertions).`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
