import assert from 'node:assert/strict';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import {
  DESKTOP_ATTACHMENT_MANIFEST_FILENAME,
  buildDesktopAttachmentComputerTask,
} from '../src/lib/chatDesktopAttachmentRouting';
import { buildChatDesignTaskCardModel } from '../src/lib/chatDesignTaskCard';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import { buildChatComputerRequestUserNotice } from '../src/lib/chatComputerRequestUx';

const desktopTask = buildDesktopAttachmentComputerTask('change APR to 2.9% and export a proof from the InDesign banner', [{
  name: 'dealer-banner.indd',
  mimeType: 'application/octet-stream',
  sizeBytes: 4_200_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/dealer-banner.indd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/banner',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/banner/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'a'.repeat(64),
  appName: 'Adobe InDesign',
}, {
  name: 'hero.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 900_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/hero.jpg',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/banner',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/banner/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'b'.repeat(64),
  appName: 'Adobe Photoshop',
}]);

const readyHandoff = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded desktop file task',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
  groundingSummary: 'Document inventory is ready.',
});
const readyCard = buildChatDesignTaskCardModel(readyHandoff.metadata);
assert(readyCard, 'InDesign handoff builds a design-task card model');
assert.equal(readyCard.title, 'Adobe InDesign');
assert.equal(readyCard.statusTone, 'ready');
assert.equal(readyCard.statusLabel, 'Ready');
assert(readyCard.operations.includes('Update text'));
assert(readyCard.operations.includes('Export proof'));
assert(readyCard.proofSignals.some((signal) => /inventory|proof|export/i.test(signal)));
assert(readyCard.reviewChecklist.some((item) => /Text inventory/i.test(item)), 'InDesign card includes text inventory review item');
assert(readyCard.reviewChecklist.some((item) => /fonts|links|overset/i.test(item)), 'InDesign card includes production blocker review item');
assert(readyCard.phases.some((phase) => phase.id === 'inspect' && phase.state === 'done'));
assert(readyCard.phases.some((phase) => phase.id === 'verify' && phase.state === 'pending'));
assert.equal(readyCard.packageSummary, '2 files, 1 primary, 2 hashed');
assert(!JSON.stringify(readyCard).includes('/Users/chris'), 'card model hides local package paths');
assert(!JSON.stringify(readyCard).includes(DESKTOP_ATTACHMENT_MANIFEST_FILENAME), 'card model hides manifest path');

const approvalHandoff = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  approvalSummary: 'Review before editing text, relinking assets, save, export, or package.',
});
const approvalCard = buildChatDesignTaskCardModel(approvalHandoff.metadata);
assert(approvalCard, 'approval handoff builds a design-task card model');
assert.equal(approvalCard.statusTone, 'approval');
assert.equal(approvalCard.statusLabel, 'Approval needed');
assert.match(approvalCard.nextAction, /Review before editing/i);
assert(approvalCard.phases.some((phase) => phase.id === 'edit' && phase.state === 'current'));

const blockedHandoff = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  blockers: ['InDesign needs Accessibility permission'],
});
const blockedCard = buildChatDesignTaskCardModel(blockedHandoff.metadata);
assert(blockedCard, 'blocked handoff builds a design-task card model');
assert.equal(blockedCard.statusTone, 'attention');
assert.equal(blockedCard.statusLabel, 'Needs attention');
assert.match(blockedCard.nextAction, /InDesign needs Accessibility permission/i);
assert.equal(blockedCard.blockerSummary, 'InDesign needs Accessibility permission');
assert(blockedCard.phases.some((phase) => phase.state === 'blocked'));

const photoshopTask = buildDesktopAttachmentComputerTask('remove the background with Photoshop generative fill, adjust color, and export a PNG proof', [{
  name: 'hero.psd',
  mimeType: 'application/octet-stream',
  sizeBytes: 9_200_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/photo/hero.psd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/photo',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/photo/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'c'.repeat(64),
  appName: 'Adobe Photoshop',
}]);
const photoshopHandoff = buildChatComputerHandoffContext({
  task: photoshopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded Photoshop file task',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
});
const photoshopCard = buildChatDesignTaskCardModel(photoshopHandoff.metadata);
assert(photoshopCard, 'Photoshop handoff builds a design-task card model');
assert.equal(photoshopCard.title, 'Adobe Photoshop');
assert.equal(photoshopCard.subtitle, 'Raster Image Edit');
assert(photoshopCard.operations.includes('Inspect image'));
assert(photoshopCard.operations.includes('Generative edit'));
assert(photoshopCard.operations.includes('Export raster'));
assert.equal(photoshopCard.creativeAiSummary, 'Localized cleanup or replacement');
assert(photoshopCard.proofSignals.some((signal) => /raster proof|screenshot/i.test(signal)));
assert(photoshopCard.reviewChecklist.some((item) => /Layer inventory/i.test(item)), 'Photoshop card includes layer inventory review item');
assert(photoshopCard.reviewChecklist.some((item) => /Selection\/mask/i.test(item)), 'Photoshop card includes selection/mask review item');
assert.equal(photoshopCard.packageSummary, '1 file, 1 primary, 1 hashed');

const photoshopSaveForWebHandoff = buildChatComputerHandoffContext({
  task: 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png',
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Deterministic desktop sequence',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
});
const photoshopSaveForWebCard = buildChatDesignTaskCardModel(photoshopSaveForWebHandoff.metadata);
assert(photoshopSaveForWebCard, 'Photoshop Save for Web handoff builds a design-task card model');
assert.equal(photoshopSaveForWebCard.title, 'Adobe Photoshop');
assert.equal(photoshopSaveForWebCard.statusTone, 'ready');
assert.equal(photoshopSaveForWebCard.statusLabel, 'Ready');
assert.notEqual(photoshopSaveForWebCard.statusLabel, 'Approval needed');

const quietPhotoshopSaveForWebRoute = buildChatComputerRequestRoute('open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png');
assert(quietPhotoshopSaveForWebRoute, 'quiet Photoshop Save for Web route exists');
const quietPhotoshopSaveForWebHandoff = buildChatComputerHandoffContext({
  task: 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png',
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Deterministic desktop sequence',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
  requestNotice: buildChatComputerRequestUserNotice(quietPhotoshopSaveForWebRoute!),
});
// Policy update (P12): "save it as a png" now trips the `save` constraint
// category, so desktop/app routes carry route-level approval — the notice is
// approval-tone, NOT quiet, and the design card must therefore SHOW (hiding
// an approval-needed card would bury the gate). The quiet-suppression
// predicate itself stays covered synthetically below.
const approvalSaveCard = buildChatDesignTaskCardModel(quietPhotoshopSaveForWebHandoff.metadata);
assert(approvalSaveCard, 'approval-gated Photoshop save route keeps the design-task card visible');
const syntheticQuietNotice = {
  ...buildChatComputerRequestUserNotice(quietPhotoshopSaveForWebRoute!),
  visibility: 'hidden',
} as any;
syntheticQuietNotice.autonomy = { ...syntheticQuietNotice.autonomy, canRunQuietly: true };
const syntheticQuietHandoff = buildChatComputerHandoffContext({
  task: 'inspect the open Photoshop document layers',
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Deterministic desktop sequence',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
  requestNotice: syntheticQuietNotice,
});
assert.equal(
  buildChatDesignTaskCardModel(syntheticQuietHandoff.metadata),
  null,
  'genuinely quiet (hidden + canRunQuietly) design route still suppresses the card',
);

const browserHandoff = buildChatComputerHandoffContext({
  task: 'Open https://example.com and list prices',
  entrypoint: 'browser_runtime',
  adapterId: 'browser_adapter',
  taskKind: 'browser_task',
});
assert.equal(buildChatDesignTaskCardModel(browserHandoff.metadata), null, 'non-design handoff has no design-task card');

console.log('All chat design task card smoke cases passed.');
