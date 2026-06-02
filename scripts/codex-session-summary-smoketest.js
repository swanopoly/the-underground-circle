#!/usr/bin/env node

const {
  buildCodexSessionRecentActions,
  classifyAppCapabilityResultText,
  summarizeCodexJsonl,
} = require('./codex-session-summary');

let failures = 0;

function fail(message) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message) {
  console.log('pass:', message);
}

function assert(condition, message, detail) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const readyText = `
APP_CAPABILITY_SUMMARY: Added the missing reusable SuperRender queue adapter.
FILES_CHANGED: src/lib/localComputerAwarenessIntent.ts
RETRY_PLAN: Retry the SuperRender queue task.
VERIFICATION: npm run smoke:local-desktop-bridge-intent passed.
USER_ACTION_NEEDED: none
`;

const blockedText = `
APP_CAPABILITY_SUMMARY: Could not inspect Ableton Live.
FILES_CHANGED: none
RETRY_PLAN: Retry after installing Ableton Live.
VERIFICATION: not run - target app missing.
USER_ACTION_NEEDED: Install Ableton Live and grant Accessibility.
`;

assert(classifyAppCapabilityResultText(readyText) === 'ready_to_retry', 'classifies verified capability result as ready');
assert(classifyAppCapabilityResultText(blockedText) === 'blocked', 'classifies user-action capability result as blocked');
assert(classifyAppCapabilityResultText('ordinary assistant response') === null, 'ignores ordinary assistant text');

const jsonl = [
  {
    timestamp: '2026-05-21T10:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '[UC-CODEX:codex-launch-test-1]\nUser task:\nBuild the missing SuperRender adapter.',
        },
      ],
    },
  },
  {
    timestamp: '2026-05-21T10:01:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: readyText,
        },
      ],
    },
  },
].map((record) => JSON.stringify(record)).join('\n');

const summary = summarizeCodexJsonl(jsonl);
assert(summary.sessionMarker === 'codex-launch-test-1', 'extracts managed UC-CODEX session marker', summary.sessionMarker);
assert(summary.messageCount === 2, 'counts user and assistant messages', String(summary.messageCount));
assert(summary.appCapabilityResultStatus === 'ready_to_retry', 'extracts app capability status from assistant message', String(summary.appCapabilityResultStatus));
assert(summary.appCapabilityResultText.includes('SuperRender'), 'extracts app capability result text');

const actions = buildCodexSessionRecentActions(summary, ['Launched in Terminal.app']);
assert(actions.some((action) => action.includes('App capability result: ready_to_retry')), 'recent actions include app capability result');
assert(actions.some((action) => action.includes('Agent:')), 'recent actions include assistant preview');

if (failures > 0) {
  console.error(`\n${failures} codex session summary smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll codex session summary smoke cases passed.');
