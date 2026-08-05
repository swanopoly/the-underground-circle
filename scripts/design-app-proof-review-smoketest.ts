/**
 * design-app-proof-review-smoketest
 *
 * Locks the structured proof-review contract for Photoshop/InDesign work.
 *
 * Run: npm run smoke:design-app-proof-review
 */

import assert from 'node:assert/strict';

import {
  buildDesignAppProofReviewPlan,
  buildDesignAppProofReviewPromptBlock,
} from '../src/lib/designAppProofReview';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import { buildDesktopAttachmentComputerTask } from '../src/lib/chatDesktopAttachmentRouting';
import { buildChatDesignTaskCardModel } from '../src/lib/chatDesignTaskCard';

const inDesignTask = 'Open this InDesign banner package, update the headline layer, replace the image, export a proof PDF, and package for handoff.';
const inDesignReview = buildDesignAppProofReviewPlan(inDesignTask);
assert.equal(inDesignReview?.appId, 'adobe_indesign');
assert.equal(inDesignReview?.reviewTitle, 'InDesign Package Review');
assert(inDesignReview?.checklist.some((item) => /Text inventory/i.test(item)));
assert(inDesignReview?.checklist.some((item) => /Package folder/i.test(item)));
assert(inDesignReview?.requiredEvidence.includes('post-change desktop.indesign_document_status'));
assert(inDesignReview?.requiredEvidence.some((item) => /desktop.indesign_package_document/i.test(item)));
assert(inDesignReview?.approvalBefore.some((item) => /packaging/i.test(item)));
assert(inDesignReview?.failClosedConditions.some((item) => /missing fonts/i.test(item)));
assert(inDesignReview?.artifactKinds.includes('package_folder_summary'));

const photoshopTask = 'Open this Photoshop PSD, remove the background with generative fill, place the new logo asset, and export a PNG proof.';
const photoshopReview = buildDesignAppProofReviewPlan(photoshopTask);
assert.equal(photoshopReview?.appId, 'adobe_photoshop');
assert.equal(photoshopReview?.reviewTitle, 'Photoshop Proof Review');
assert(photoshopReview?.checklist.some((item) => /Layer inventory/i.test(item)));
assert(photoshopReview?.checklist.some((item) => /Selection\/mask/i.test(item)));
assert(photoshopReview?.requiredEvidence.some((item) => /photoshop_layer_inventory/i.test(item)));
assert(photoshopReview?.requiredEvidence.some((item) => /selection or mask/i.test(item)));
assert(photoshopReview?.approvalBefore.some((item) => /generative fill/i.test(item)));
assert(photoshopReview?.artifactKinds.includes('raster_proof'));

const promptBlock = buildDesignAppProofReviewPromptBlock(photoshopTask) || '';
assert(promptBlock.includes('Design Proof Review'));
assert(promptBlock.includes('Fail closed if:'));
assert(promptBlock.includes('selection or mask state'));

const stagedPhotoshopTask = buildDesktopAttachmentComputerTask(photoshopTask, [{
  name: 'hero.psd',
  mimeType: 'application/octet-stream',
  sizeBytes: 9_200_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/photo/hero.psd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/photo',
  sha256: 'd'.repeat(64),
  appName: 'Adobe Photoshop',
}]);
const handoff = buildChatComputerHandoffContext({
  task: stagedPhotoshopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
});
assert.equal(handoff.metadata.designProofReview?.reviewTitle, 'Photoshop Proof Review');
assert(handoff.metadata.designProofReview?.requiredEvidence.some((item) => /photoshop_document_status/i.test(item)));
assert(!JSON.stringify(handoff.metadata.designProofReview).includes('/Users/chris'), 'proof review metadata hides local paths');

const card = buildChatDesignTaskCardModel(handoff.metadata);
assert(card?.reviewChecklist.some((item) => /Layer inventory/i.test(item)));
assert(card?.reviewChecklist.some((item) => /Selection\/mask/i.test(item)));

assert.equal(buildDesignAppProofReviewPlan('Summarize unread emails'), null);

console.log('All design app proof review smoke cases passed.');
