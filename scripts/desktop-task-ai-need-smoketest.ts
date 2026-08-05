import assert from 'node:assert/strict';
import { classifyDesktopTaskAiNeed } from '../src/lib/desktopTaskAiNeed';
import {
  buildChatComputerRequestRoute,
  buildChatComputerRequestRoutePromptBlock,
} from '../src/lib/chatComputerRequestRouter';

function assertRouteAiNeed(input: string, expected: 'none' | 'assistive' | 'required') {
  const route = buildChatComputerRequestRoute(input);
  assert(route, `${input} should build a route`);
  assert.equal(route.aiNeed?.level, expected, `${input} AI need`);
  assert(route.notes.some((note) => note.startsWith('AI need:')), `${input} route notes include AI need`);
}

assertRouteAiNeed('on the desktop open pearsoncdjr-img in photoshop and save it as a png', 'none');
assertRouteAiNeed('Open Finder and rename landscaping-img.png on my desktop to landscaping-img-1.png', 'none');
assertRouteAiNeed('Open Preview and show ~/Downloads/report.pdf', 'none');
assertRouteAiNeed('Search files in Downloads for invoice', 'none');
assertRouteAiNeed('Log into Shopify and update this product page after I approve', 'assistive');
assertRouteAiNeed('Open Photoshop and generate a background then save png', 'required');
assertRouteAiNeed('Use Ableton Live to create a four-bar drum loop and export it after approval', 'required');

const direct = classifyDesktopTaskAiNeed({
  message: 'write a text file on my desktop called notes.txt with hello',
  kind: 'local_file',
  strategyId: 'file_readonly',
  recommendedTools: ['desktop.file_write_text', 'desktop.file_stat'],
});
assert.equal(direct.level, 'none', 'direct text-file write does not need AI');
assert.deepEqual(direct.aiSurfaces, [], 'direct text-file write has no AI surfaces');

const prompt = buildChatComputerRequestRoutePromptBlock('Open Preview and show ~/Downloads/report.pdf') || '';
assert(prompt.includes('AI need: No AI needed'), 'prompt block exposes no-AI classification');
assert(prompt.includes('desktop.open_path'), 'prompt block keeps deterministic open_path action');

const creativePrompt = buildChatComputerRequestRoutePromptBlock('Open Photoshop and generate a background then save png') || '';
assert(creativePrompt.includes('AI need: AI required'), 'prompt block exposes required-AI classification');

console.log('All desktop task AI-need smoke cases passed.');
