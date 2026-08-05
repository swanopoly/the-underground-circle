/**
 * agent-monitor-state-smoketest - verifies the pure Agent Monitor Computer Use
 * state normalizer without React, Supabase, or browser runtime dependencies.
 *
 * Suggested package script:
 *   "smoke:agent-monitor-state": "npx tsx scripts/agent-monitor-state-smoketest.ts"
 */

import assert from 'node:assert/strict';
import {
  buildAgentMonitorTaskFromComputerUseState,
  formatAgentMonitorComputerUseAction,
  normalizeAgentMonitorComputerUseTask,
  shouldShowAgentMonitor,
  type AgentMonitorComputerUseLikeState,
} from '../src/lib/agentMonitorState';

function makeState(overrides: Partial<AgentMonitorComputerUseLikeState>): AgentMonitorComputerUseLikeState {
  return {
    status: 'idle',
    task: '',
    runId: null,
    sessionId: null,
    liveUrl: null,
    reasoning: [],
    actions: [],
    screenshots: [],
    usage: null,
    pendingConfirmation: null,
    result: null,
    errorMessage: null,
    ...overrides,
  };
}

// Starting: visible, deterministic, no React/Supabase state required.
{
  const monitor = normalizeAgentMonitorComputerUseTask(makeState({
    status: 'starting',
    task: 'Research local venue pricing',
    sessionId: 'sess-start',
  }));

  assert(monitor, 'starting task should build a monitor model');
  assert.equal(monitor.status, 'starting');
  assert.equal(monitor.currentAction?.tool, 'computer_use.start');
  assert.equal(monitor.currentAction?.label, 'Preparing the browser or app workspace.');
  assert.equal(monitor.displayText.title, 'Starting computer task');
  assert.equal(monitor.needsAttention, false);
  assert.equal(monitor.liveUrl, null);
  assert.deepEqual(monitor.counts, {
    actions: 0,
    frames: 0,
    reasoning: 0,
    iterations: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    findings: 0,
  });
}

// Running with frames/actions: latest action is current, frames are compact.
{
  const monitor = buildAgentMonitorTaskFromComputerUseState(makeState({
    status: 'running',
    task: 'Open example.com and capture the headline',
    runId: 'run-1',
    sessionId: 'sess-1',
    liveUrl: 'https://browserbase.example/live/sess-1',
    reasoning: ['I need to navigate first.'],
    actions: [
      { tool: 'computer', input: { action: 'navigate', url: 'https://example.com/?token=secret#hash' }, at: 10 },
      { tool: 'computer', input: { action: 'screenshot' }, at: 20 },
    ],
    screenshots: [
      { b64: 'frame-one', at: 15 },
      { b64: 'frame-two', url: 'https://cdn.example/frame-two.png', at: 25 },
    ],
    usage: { iteration: 2, inputTokens: 1200, outputTokens: 140, estimatedCost: 0.0123 },
  }));

  assert(monitor, 'running task should build a monitor model');
  assert.equal(monitor.id, 'computer-use:run-1');
  assert.equal(monitor.status, 'running');
  assert.equal(monitor.currentAction?.label, 'Capturing proof');
  assert.equal(monitor.frames.length, 2);
  assert.equal(monitor.frames[0]?.index, 1);
  assert.equal(monitor.frames[0]?.actionLabel, 'Opening https://example.com/');
  assert.equal(monitor.latestFrame?.b64, 'frame-two');
  assert.equal(monitor.counts.actions, 2);
  assert.equal(monitor.counts.frames, 2);
  assert.equal(monitor.counts.reasoning, 1);
  assert.equal(monitor.counts.iterations, 2);
  assert.equal(monitor.counts.inputTokens, 1200);
  assert.equal(monitor.counts.outputTokens, 140);
  assert.equal(monitor.counts.estimatedCostUsd, 0.0123);
  assert.equal(monitor.liveUrl, 'https://browserbase.example/live/sess-1');
  assert.equal(monitor.displayText.secondary, '2 actions | 2 frames | 2 iterations');
}

// Pending approval: status and attention move from running to needs_input.
{
  const monitor = normalizeAgentMonitorComputerUseTask(makeState({
    status: 'running',
    task: 'Submit the form after approval',
    actions: [{ tool: 'ask_user', input: { question: 'Submit this form?', action: 'wait' }, at: 33 }],
    pendingConfirmation: {
      id: 'approval-1',
      question: 'Submit this form?',
      options: ['Submit', 'Cancel'],
      context: 'External side effect',
      timeoutSec: 60,
      askedAt: 30,
    },
  }));

  assert(monitor, 'pending approval should build a monitor model');
  assert.equal(monitor.status, 'needs_input');
  assert.equal(monitor.needsAttention, true);
  assert.equal(monitor.attentionLabel, 'Approval needed');
  assert.equal(monitor.currentAction?.tool, 'ask_user');
  assert.equal(monitor.currentAction?.label, 'Waiting for approval: Submit this form?');
  assert.equal(monitor.currentAction?.at, 30);
  assert.equal(monitor.displayText.status, 'Approval needed');
  assert.equal(monitor.displayText.secondary, 'Options: Submit, Cancel');
  assert.equal(shouldShowAgentMonitor(monitor), true);
}

// Done: result summary and final counts come from the finished task result.
{
  const monitor = normalizeAgentMonitorComputerUseTask(makeState({
    status: 'done',
    task: 'Compare product options',
    actions: [{ tool: 'computer', input: { action: 'scroll', scroll_direction: 'down' }, at: 40 }],
    screenshots: [{ b64: 'final-frame', at: 45 }],
    usage: { iteration: 1, inputTokens: 100, outputTokens: 50, estimatedCost: 0.004 },
    result: {
      summary: 'Found three options and saved the comparison.',
      iterations: 7,
      tokens: { input: 2000, output: 450 },
      findings: [{ title: 'A' }, { title: 'B' }],
    },
  }));

  assert(monitor, 'done task should build a monitor model');
  assert.equal(monitor.status, 'completed');
  assert.equal(monitor.needsAttention, false);
  assert.equal(monitor.displayText.title, 'Computer task finished');
  assert.equal(monitor.summary, 'Found three options and saved the comparison.');
  assert.equal(monitor.counts.iterations, 7);
  assert.equal(monitor.counts.inputTokens, 2000);
  assert.equal(monitor.counts.outputTokens, 450);
  assert.equal(monitor.counts.findings, 2);
}

// Error: visible, attention-needed, and safe recovery display text.
{
  const monitor = normalizeAgentMonitorComputerUseTask(makeState({
    status: 'error',
    task: 'Book a demo',
    actions: [{ tool: 'computer', input: { action: 'left_click', coordinate: [12, 34] }, at: 50 }],
    errorMessage: 'Budget cap reached before completion.',
  }));

  assert(monitor, 'error task should build a monitor model');
  assert.equal(monitor.status, 'failed');
  assert.equal(monitor.needsAttention, true);
  assert.equal(monitor.attentionLabel, 'Review recovery');
  assert.equal(monitor.displayText.title, 'Computer task stopped');
  assert.equal(monitor.displayText.primary, 'Budget cap reached before completion.');
  assert.equal(monitor.currentAction?.label, 'Clicking at (12, 34)');
}

// Hidden idle states: empty idle tasks are omitted by default, but can be
// represented explicitly when a caller needs a hidden placeholder.
{
  assert.equal(normalizeAgentMonitorComputerUseTask(null), null);
  assert.equal(normalizeAgentMonitorComputerUseTask(makeState({ status: 'idle', task: '' })), null);

  const explicitIdle = normalizeAgentMonitorComputerUseTask(makeState({
    status: 'idle',
    task: 'Waiting for the next task',
  }), { hideIdle: false });

  assert(explicitIdle, 'explicit idle should build a hidden placeholder model');
  assert.equal(explicitIdle.status, 'idle');
  assert.equal(explicitIdle.needsAttention, false);
  assert.equal(shouldShowAgentMonitor(explicitIdle), false);
  assert.equal(explicitIdle.displayText.title, 'No active computer task');
}

// Public action formatter strips URL query/hash and avoids echoing typed text.
{
  assert.equal(
    formatAgentMonitorComputerUseAction({ tool: 'computer', input: { action: 'navigate', url: 'https://example.com/path?token=secret#frag' } }),
    'Opening https://example.com/path',
  );
  assert.equal(
    formatAgentMonitorComputerUseAction({ tool: 'computer', input: { action: 'type', text: 'super secret' } }),
    'Typing text',
  );
}

console.log('All agent monitor state smoke cases passed.');
