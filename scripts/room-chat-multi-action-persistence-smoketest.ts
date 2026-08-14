/**
 * Focused fail-closed Room Chat smoke.
 *
 * Proves two persistence/routing contracts without mounting React:
 *  - >3-action requests persist one clarification and never reach OpenSwan.
 *  - Room's immutable-message RLS gets one final INSERT, never a durable
 *    placeholder/UPDATE; null or thrown insert outcomes fail truthfully.
 *
 * Run:
 *   npx tsx scripts/room-chat-multi-action-persistence-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

const root = process.cwd();
const servicePath = resolve(root, 'src/lib/roomChatService.ts');
const source = readFileSync(servicePath, 'utf8');
const sourceFile = ts.createSourceFile(
  servicePath,
  source,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
);

let assertions = 0;

function pass(name: string): void {
  assertions += 1;
  console.log('pass:', name);
}

function functionDeclaration(name: string): ts.FunctionDeclaration {
  const match = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert(match, `${name} declaration exists`);
  return match;
}

function executableFunction<T extends (...args: never[]) => unknown>(name: string, injections: Record<string, unknown>): T {
  const declaration = functionDeclaration(name).getText(sourceFile);
  const javascript = ts.transpileModule(declaration, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      strict: true,
    },
  }).outputText;
  const injectionNames = Object.keys(injections);
  const factory = new Function(
    ...injectionNames,
    `'use strict';\n${javascript}\nreturn ${name};`,
  );
  return factory(...injectionNames.map((key) => injections[key])) as T;
}

async function main(): Promise<void> {
  const overflowPlan = buildChatAutomationPlan({
    message: 'List tasks, then research the blocker, then create a task, then show memories',
    selectedMode: 'room_chat',
  });
  assert.equal(overflowPlan.execution.kind, 'ask_clarification');
  assert.equal(overflowPlan.execution.clarification?.reason, 'multi_action_limit');
  assert.equal(overflowPlan.multiActionOverflow?.actionCount, 4);
  assert.equal(overflowPlan.multiActionLedger, undefined);
  pass('planner returns one bounded overflow clarification');

  const roomFunction = functionDeclaration('sendRoomStructuredChatMessage');
  const roomBody = roomFunction.body?.getText(sourceFile) || '';
  const overflowIndex = roomBody.indexOf('if (automationPlan.multiActionOverflow)');
  const runtimeIndex = roomBody.indexOf('runOpenSwanSessionTurn({');
  assert(overflowIndex >= 0, 'Room has an explicit overflow branch');
  assert(runtimeIndex > overflowIndex, 'overflow branch is evaluated before OpenSwan dispatch');
  const overflowBranch = roomBody.slice(overflowIndex, runtimeIndex);
  assert.match(overflowBranch, /await persistRoomAgentOutput\(/);
  assert.match(overflowBranch, /return\s*\{\s*response:\s*clarificationContent,\s*artifacts:\s*\[\],?\s*\}/);
  assert.match(overflowBranch, /multi_action_overflow/);
  assert.doesNotMatch(overflowBranch, /runOpenSwanSessionTurn\(/);
  pass('Room overflow returns after one persisted clarification before runtime');

  const finalContentIndex = roomBody.indexOf('const finalContent');
  assert(finalContentIndex > runtimeIndex);
  const finalPersistence = roomBody.slice(finalContentIndex);
  assert.match(finalPersistence, /await persistRoomAgentOutput\(\{/);
  assert.doesNotMatch(roomBody, /placeholderId|generating:\s*true/);
  assert.doesNotMatch(roomBody, /\.from\(['"]room_messages['"]\)|\.update\(/);
  assert.equal((finalPersistence.match(/await persistRoomAgentOutput\(\{/g) || []).length, 1);
  pass('final response uses one immutable insert path with no placeholder or UPDATE');

  const runtimeCatchIndex = roomBody.indexOf('} catch (err: any) {');
  assert(runtimeCatchIndex > runtimeIndex);
  const runtimeFailureBranch = roomBody.slice(runtimeCatchIndex, finalContentIndex);
  assert.equal((runtimeFailureBranch.match(/await persistRoomAgentOutput\(\{/g) || []).length, 1);
  assert.match(
    runtimeFailureBranch,
    /return\s*\{\s*response:\s*failureContent,\s*artifacts:\s*\[\],?\s*\}/,
  );
  assert.doesNotMatch(runtimeFailureBranch, /throw\s+err/);
  pass('runtime failure persists and returns one truthful bot row without triggering a duplicate caller fallback');

  const insertCalls: Array<{
    roomId: string;
    agentName: string;
    content: string;
    metadata: Record<string, unknown>;
  }> = [];
  const persist = executableFunction<(
    args: Record<string, unknown>,
  ) => Promise<string>>('persistRoomAgentOutput', {
    sendAgentMessage: async (
      roomId: string,
      agentName: string,
      content: string,
      metadata: Record<string, unknown>,
    ) => {
      insertCalls.push({ roomId, agentName, content, metadata });
      return 'final-row';
    },
  });
  const base = {
    roomId: 'room-1',
    content: 'final answer',
    metadata: { bot: true },
  };
  assert.equal(await persist(base), 'final-row');
  assert.deepEqual(insertCalls, [{
    roomId: 'room-1',
    agentName: 'Agent',
    content: 'final answer',
    metadata: { bot: true },
  }]);
  pass('one successful final insert returns its exact durable row id');

  const persistNull = executableFunction<(
    args: Record<string, unknown>,
  ) => Promise<string>>('persistRoomAgentOutput', {
    sendAgentMessage: async () => null,
  });
  await assert.rejects(
    () => persistNull(base),
    /agent response could not be saved/i,
  );

  const persistThrow = executableFunction<(
    args: Record<string, unknown>,
  ) => Promise<string>>('persistRoomAgentOutput', {
    sendAgentMessage: async () => { throw new Error('offline'); },
  });
  await assert.rejects(() => persistThrow(base), /offline/);
  pass('null and thrown final inserts never report durable success');

  console.log(`\nRoom multi-action persistence smoke passed (${assertions} groups).`);
}

void main();
