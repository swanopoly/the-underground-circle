/**
 * tool-loop-resume-smoketest
 *
 * Verifies auto-resume detection + block formatting: a checkpoint in the most
 * recent turn is pending; a checkpoint resolved by a later clean turn is not;
 * the resume block carries the last observation + failed step and defers to the
 * user's new message. Pure helpers → no heavy imports.
 *
 * Run: npm run smoke:tool-loop-resume
 */

import assert from 'node:assert/strict';

import { findPendingResumeCheckpoint, buildResumeContextBlock, type ResumeScanEvent } from '../src/lib/toolLoopResume';
import type { ToolLoopCheckpoint } from '../src/lib/toolLoopProgress';

const checkpoint: ToolLoopCheckpoint = {
  schemaVersion: 1,
  stepCount: 4,
  maxRounds: 6,
  completedSteps: [{ tool: 'desktop.launch_app', ok: true }],
  lastObservation: { tool: 'desktop.read_a11y_tree', summary: 'File / Edit / Export As…' },
  lastFailure: { tool: 'desktop.click_element', ok: false, reason: 'element not found: Export' },
  resumeHint: 'Re-observe, then retry desktop.click_element via the menu.',
};

const cpEvent = (cp: ToolLoopCheckpoint): ResumeScanEvent => ({ kind: 'tool_activity', data: { checkpoint: cp } });
const ar = (): ResumeScanEvent => ({ kind: 'assistant_response', data: {} });
const noise = (): ResumeScanEvent => ({ kind: 'tool_activity', data: {} });

// ── findPendingResumeCheckpoint ──────────────────────────────────────────────
// Last turn ended at the cap → its checkpoint is pending.
const incompleteLast: ResumeScanEvent[] = [ar(), noise(), cpEvent(checkpoint), noise(), ar()];
const found = findPendingResumeCheckpoint(incompleteLast);
assert(found && found.stepCount === 4, 'checkpoint in the most recent turn is returned');

// Last turn completed cleanly (no checkpoint of its own) → the older checkpoint
// is behind the 2nd assistant_response → not resumed.
const resolved: ResumeScanEvent[] = [ar(), cpEvent(checkpoint), ar(), noise(), ar()];
assert.equal(findPendingResumeCheckpoint(resolved), null, 'a checkpoint resolved by a later clean turn is not re-resumed');

// Two incomplete turns in a row → resume from the latest checkpoint.
const cp2: ToolLoopCheckpoint = { ...checkpoint, stepCount: 9 };
const twoIncomplete: ResumeScanEvent[] = [cpEvent(checkpoint), ar(), cpEvent(cp2), ar()];
assert.equal(findPendingResumeCheckpoint(twoIncomplete)?.stepCount, 9, 'returns the most recent checkpoint');

// Single incomplete turn (only one assistant_response) → still found.
assert(findPendingResumeCheckpoint([noise(), cpEvent(checkpoint), ar()]) !== null, 'single incomplete turn is detected');

// No checkpoints at all, or empty/invalid → null.
assert.equal(findPendingResumeCheckpoint([ar(), noise(), ar()]), null, 'no checkpoint → null');
assert.equal(findPendingResumeCheckpoint([]), null, 'empty → null');
assert.equal(findPendingResumeCheckpoint(null), null, 'null → null');

// ── buildResumeContextBlock ──────────────────────────────────────────────────
const block = buildResumeContextBlock(checkpoint);
assert(/CONTINUATION/.test(block), 'flags the continuation');
assert(block.includes('Steps already completed: 4'), 'reports completed step count');
assert(block.includes('desktop.read_a11y_tree') && block.includes('File / Edit / Export As…'), 'carries the last observation');
assert(block.includes('desktop.click_element') && block.includes('element not found: Export'), 'carries the failed step to retry');
assert(block.includes('Re-observe, then retry'), 'carries the resume hint');
assert(/follow their new request/i.test(block), 'defers to the user if they moved on');

// Missing optional fields don't break the block.
const minimal = buildResumeContextBlock({ schemaVersion: 1, stepCount: 0, completedSteps: [], lastObservation: null, lastFailure: null, resumeHint: '' });
assert(/CONTINUATION/.test(minimal) && minimal.includes('Steps already completed: 0'), 'minimal checkpoint still renders');
assert(!minimal.includes('Last failed step'), 'omits absent failure line');

// Null checkpoint → empty string (caller appends nothing).
assert.equal(buildResumeContextBlock(null), '', 'null checkpoint → empty');

console.log('All tool loop resume smoke cases passed.');
