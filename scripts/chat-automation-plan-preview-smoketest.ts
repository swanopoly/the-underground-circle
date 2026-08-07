/**
 * chat-automation-plan-preview-smoketest
 *
 * Covers the pure Chat Plan Card payload before UI wiring. The UI should be
 * able to render these fields without re-interpreting planner internals.
 *
 * Run: `npm run smoke:chat-automation-plan-preview`
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildChatAutomationPlanPreview } from '../src/lib/chatAutomationPlanPreview';
import { readMessageChatAutomationPlanPreview } from '../src/lib/messageMetadataReaders';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}

function previewFor(message: string, selectedMode?: string | null) {
  return buildChatAutomationPlanPreview(buildChatAutomationPlan({ message, selectedMode }));
}

function main() {
  {
    const preview = previewFor('hello there');
    assertEqual(preview.title, 'Model chat', 'plain chat: title');
    assertEqual(preview.routeLabel, 'Chat', 'plain chat: route label');
    assertEqual(preview.mode, 'agentic', 'plain chat: mode');
    assertEqual(preview.approvalRequired, false, 'plain chat: no approval');
    assert(preview.evidence.includes('final answer'), 'plain chat: final answer evidence');
  }

  {
    const preview = previewFor('Open Photoshop and create a new 600 by 600 document');
    assertEqual(preview.title, 'Computer task', 'photoshop: title');
    assertEqual(preview.routeLabel, 'Desktop app', 'photoshop: native route is not mislabeled as browser/direct');
  }

  {
    const preview = previewFor('Search files in my Downloads folder for invoice');
    assertEqual(preview.title, 'Computer task', 'local file: title');
    assertEqual(preview.routeLabel, 'Local files', 'local file: route label');
  }

  {
    const preview = previewFor('Publish the homepage update to WordPress');
    assertEqual(preview.routeLabel, 'wordpress', 'wordpress: route label');
    assertEqual(preview.riskTone, 'danger', 'wordpress: external side effect tone');
    assertEqual(preview.approvalRequired, true, 'wordpress: approval required');
    assert(preview.approvalLabel.toLowerCase().includes('external'), 'wordpress: approval copy explains external effect');
  }

  {
    const preview = previewFor('/browser open https://example.com and collect the docs links');
    assertEqual(preview.title, 'Browser plan', 'browser slash: title');
    assertEqual(preview.routeLabel, 'browser', 'browser slash: route label');
    assertEqual(preview.approvalRequired, true, 'browser slash: approval required');
    assert(preview.evidence.includes('browser plan and approval status'), 'browser slash: evidence');
  }

  {
    const preview = previewFor('Open AutoCAD and measure the area of the current drawing and export a PDF proof');
    assertEqual(preview.title, 'Computer task', 'autocad: title');
    assertEqual(preview.mode, 'agentic', 'autocad: mode from AI-need metadata');
    assertEqual(preview.approvalRequired, true, 'autocad: approval required');
    assert(preview.surfaceLabel.toLowerCase().includes('engineering'), 'autocad: surface label uses app route');
    assert(preview.tools.length > 0, 'autocad: recommended tools exposed');
    assert(preview.evidence.length > 0, 'autocad: evidence requirements exposed');
    assert(preview.evidencePanel?.kind === 'desktop_app' || preview.evidencePanel?.kind === 'hybrid', 'autocad: evidence panel kind');
    assert(preview.evidencePanel?.observeBefore.some((item) => /cad|engineering|document|model/i.test(item)) === true, 'autocad: observe-before contract');
    assert(preview.evidencePanel?.approvalBefore.some((item) => /mutation|export|save|document/i.test(item)) === true, 'autocad: approval-before contract');
    assert(preview.evidencePanel?.proofAfter.some((item) => /cad|proof|file_stat|artifact/i.test(item)) === true, 'autocad: proof-after contract');
    assert(preview.evidencePanel?.failClosedRules.some((item) => /units|active document|proof|license|permission/i.test(item)) === true, 'autocad: fail-closed contract');
    assert(preview.recovery.some((item) => item.includes('fresh observation')), 'autocad: recovery requires fresh observation');
    assert(preview.chips.some((chip) => chip.label === 'AI required'), 'autocad: AI-need chip present');
  }

  {
    const preview = previewFor('Open MATLAB, run the current script, inspect the workspace, and export the plot');
    assertEqual(preview.title, 'Computer task', 'matlab: title');
    assert(preview.surfaceLabel.toLowerCase().includes('engineering'), 'matlab: engineering control surface');
    assertEqual(preview.approvalRequired, true, 'matlab: approval required');
    assert(preview.evidencePanel?.targetLabel.toLowerCase().includes('engineering') === true || preview.evidencePanel?.targetLabel.toLowerCase().includes('matlab') === true, 'matlab: evidence target label');
    assert(preview.evidencePanel?.freshEvidenceRequired.some((item) => /fresh/i.test(item)) === true, 'matlab: fresh evidence requirement');
  }

  {
    const preview = previewFor('Open AutoCAD and measure the area of the current drawing and export a PDF proof');
    const persisted = formatPersistedChatBotMessage('OpenSwan', 'I can run this with approval.', {
      localMessageId: 'bot-smoke-plan-card',
      chatAutomationPlanPreview: preview,
    });
    const metadata = readPersistedChatBotMetadata(persisted);
    const roundTrip = readMessageChatAutomationPlanPreview(metadata);
    assertEqual(roundTrip?.title, 'Computer task', 'persisted preview: title round trip');
    assertEqual(roundTrip?.mode, 'agentic', 'persisted preview: mode round trip');
    assertEqual(roundTrip?.approvalRequired, true, 'persisted preview: approval round trip');
    assert(roundTrip?.tools.includes('desktop.launch_app') === true, 'persisted preview: tools round trip');
    assert(roundTrip?.evidencePanel?.proofAfter.some((item) => /proof|cad|file_stat|artifact/i.test(item)) === true, 'persisted preview: evidence panel round trip');
    assert((roundTrip?.evidencePanel?.observeBefore.length || 0) <= 4, 'persisted preview: evidence panel bounded');
  }

  {
    const preview = previewFor('review the latest office run', 'review');
    assertEqual(preview.title, 'OpenSwan agent', 'openswan: title');
    assertEqual(preview.routeLabel, 'OpenSwan', 'openswan: route label');
    assertEqual(preview.mode, 'agentic', 'openswan: mode');
    assert(preview.evidence.includes('agent run summary'), 'openswan: evidence');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-automation-plan-preview smoke cases passed.');
}

main();
