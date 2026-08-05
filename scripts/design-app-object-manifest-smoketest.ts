/**
 * design-app-object-manifest-smoketest
 *
 * Verifies before/after object manifest contracts for Photoshop/InDesign tasks.
 *
 * Run: npm run smoke:design-app-object-manifest
 */

import assert from 'node:assert/strict';

import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import {
  buildDesignAppObjectManifestArtifact,
  buildDesignAppObjectManifestPlan,
  buildDesignAppObjectManifestPromptBlock,
  summarizeDesignAppObjectManifestArtifact,
} from '../src/lib/designAppObjectManifest';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';

const indesignTask = 'Open this InDesign package, update the headline layer, relink the hero image, export a proof PDF, and package it for handoff.';
const indesignPlan = buildDesignAppObjectManifestPlan(indesignTask);

assert.equal(indesignPlan?.appId, 'adobe_indesign');
assert.equal(indesignPlan?.manifestArtifactKind, 'design_object_manifest');
assert(indesignPlan?.beforeSnapshotTools.includes('desktop.indesign_document_status'));
assert(indesignPlan?.beforeSnapshotTools.includes('desktop.indesign_text_inventory'));
assert(indesignPlan?.afterSnapshotTools.includes('desktop.indesign_package_document'));
assert(indesignPlan?.afterSnapshotTools.includes('desktop.indesign_export_proof'));
assert(indesignPlan?.entities.some((entity) => entity.kind === 'text_frame' && entity.fields.some((field) => field.key === 'textFrameId')));
assert(indesignPlan?.entities.some((entity) => entity.kind === 'link' && entity.fields.some((field) => field.key === 'linkId')));
assert(indesignPlan?.entities.some((entity) => entity.kind === 'package_folder'));
assert(indesignPlan?.comparisons.some((item) => item.includes('text content hash')));
assert(indesignPlan?.redactionRules.some((item) => item.includes('basename plus hash')));

const indesignPrompt = buildDesignAppObjectManifestPromptBlock(indesignTask) || '';
assert(indesignPrompt.includes('Design Object Manifest'));
assert(indesignPrompt.includes('text_frame'));
assert(indesignPrompt.includes('DESIGN_OBJECT_MANIFEST_JSON'));
assert(indesignPrompt.includes('Do not claim'));
assert(indesignPrompt.includes('audit blockers'));

const indesignArtifact = buildDesignAppObjectManifestArtifact({
  task: indesignTask,
  generatedAt: '2026-05-27T12:00:00.000Z',
  beforeCaptures: [
    {
      tool: 'desktop.file_stat',
      timestamp: '2026-05-27T12:00:01.000Z',
      data: { path: '/Users/cswanson/Desktop/banner-package/banner.indd', sizeBytes: 2048 },
    },
    {
      tool: 'desktop.indesign_document_status',
      timestamp: '2026-05-27T12:00:02.000Z',
      data: {
        activeDocumentName: 'banner.indd',
        activeDocumentPath: '/Users/cswanson/Desktop/banner-package/banner.indd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        pageCount: 1,
        spreadCount: 1,
        layerCount: 4,
        linkCount: 2,
        missingLinks: 0,
        modifiedLinks: 0,
        fontCount: 3,
        missingFonts: 0,
      },
    },
    {
      tool: 'desktop.indesign_text_inventory',
      timestamp: '2026-05-27T12:00:03.000Z',
      data: {
        documentName: 'banner.indd',
        textFrameCount: 2,
        oversetFrames: 0,
        frames: [
          {
            layerName: 'Headline',
            itemName: 'Hero Headline',
            label: 'headline',
            pageName: '1',
            contentPreview: 'Old spring offer',
            chars: 16,
            matchCount: 1,
            overflows: false,
            locked: false,
            visible: true,
          },
        ],
      },
    },
  ],
  afterCaptures: [
    {
      tool: 'desktop.indesign_document_status',
      timestamp: '2026-05-27T12:05:01.000Z',
      data: {
        activeDocumentName: 'banner.indd',
        activeDocumentPath: '/Users/cswanson/Desktop/banner-package/banner.indd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        pageCount: 1,
        spreadCount: 1,
        layerCount: 4,
        linkCount: 2,
        missingLinks: 0,
        modifiedLinks: 0,
        fontCount: 3,
        missingFonts: 0,
      },
    },
    {
      tool: 'desktop.indesign_text_inventory',
      timestamp: '2026-05-27T12:05:02.000Z',
      data: {
        documentName: 'banner.indd',
        textFrameCount: 2,
        oversetFrames: 0,
        frames: [
          {
            layerName: 'Headline',
            itemName: 'Hero Headline',
            label: 'headline',
            pageName: '1',
            contentPreview: 'New summer offer',
            chars: 16,
            matchCount: 1,
            overflows: false,
            locked: false,
            visible: true,
          },
        ],
      },
    },
  ],
  actionCaptures: [
    {
      tool: 'desktop.indesign_batch_update_text_layers',
      timestamp: '2026-05-27T12:03:00.000Z',
      data: {
        documentName: 'banner.indd',
        updatedFrames: 1,
        results: [{ fieldName: 'headline', replacementText: 'New summer offer', matchedFrames: 1, updatedFrames: 1 }],
      },
    },
    {
      tool: 'desktop.indesign_relink_asset',
      timestamp: '2026-05-27T12:03:30.000Z',
      data: {
        documentName: 'banner.indd',
        assetPath: '/Users/cswanson/Desktop/assets/new-hero.png',
        matchedLinks: 1,
        relinkedLinks: 1,
        missingBefore: 0,
        missingAfter: 0,
        linkNames: ['hero.png'],
      },
    },
    {
      tool: 'desktop.indesign_export_proof',
      timestamp: '2026-05-27T12:04:00.000Z',
      data: {
        documentName: 'banner.indd',
        outputPath: '/Users/cswanson/Desktop/proofs/banner-proof.pdf',
        format: 'pdf',
        fileExists: true,
        sizeBytes: 40960,
        pageCount: 1,
      },
    },
    {
      tool: 'desktop.indesign_package_document',
      timestamp: '2026-05-27T12:04:30.000Z',
      data: {
        documentName: 'banner.indd',
        outputFolderPath: '/Users/cswanson/Desktop/handoff/banner-package-final',
        packageOk: true,
        fileCount: 8,
        sizeBytes: 102400,
        missingLinksBefore: 0,
        modifiedLinksBefore: 0,
        missingFontsBefore: 0,
      },
    },
  ],
  approvals: [{ id: 'approval-design-1', summary: 'Approved headline copy, hero relink, proof export, and package folder.', approved: true }],
});
assert.equal(indesignArtifact?.audit.ok, true, indesignArtifact?.audit.blockers.join(', '));
assert.equal(indesignArtifact?.before.activeDocument?.path?.basename, 'banner.indd');
assert(indesignArtifact?.actions.some((action) => action.changedEntities.some((entity) => entity.kind === 'link')));
assert(indesignArtifact?.artifacts.some((artifact) => artifact.kind === 'proof' && artifact.path?.basename === 'banner-proof.pdf'));
assert(indesignArtifact?.artifacts.some((artifact) => artifact.kind === 'package_folder' && artifact.path?.basename === 'banner-package-final'));
assert(!JSON.stringify(indesignArtifact).includes('/Users/'), 'InDesign artifact redacts local paths');
const indesignSummary = summarizeDesignAppObjectManifestArtifact(indesignArtifact);
assert.equal(indesignSummary?.auditOk, true);
assert.equal(indesignSummary?.activeDocumentBasename, 'banner.indd');
assert(indesignSummary?.changedEntityKinds.includes('text_frame'));
assert(indesignSummary?.artifactKinds.includes('proof'));
assert(indesignSummary?.artifactKinds.includes('package_folder'));
assert.equal(indesignSummary?.redaction, 'basename_hash_only');
assert(!JSON.stringify(indesignSummary).includes('/Users/'), 'InDesign summary redacts local paths');

const blockedIndesignArtifact = buildDesignAppObjectManifestArtifact({
  task: indesignTask,
  beforeCaptures: indesignArtifact ? [
    { tool: 'desktop.file_stat', data: { path: '/Users/cswanson/Desktop/banner-package/banner.indd' } },
    { tool: 'desktop.indesign_document_status', data: { activeDocumentName: 'banner.indd' } },
    { tool: 'desktop.indesign_text_inventory', data: { frames: [{ label: 'headline', contentPreview: 'Old' }] } },
  ] : [],
  afterCaptures: [],
  actionCaptures: [],
  approvals: [],
});
assert.equal(blockedIndesignArtifact?.audit.ok, false);
assert(blockedIndesignArtifact?.audit.blockers.some((blocker) => blocker.includes('missing approval evidence')));
assert(blockedIndesignArtifact?.audit.blockers.some((blocker) => blocker.includes('missing after active document identity')));

const photoshopTask = 'Open this Photoshop PSD, update the CTA text layer, place the new logo smart object, remove the background with generative fill, and export a PNG proof.';
const photoshopPlan = buildDesignAppObjectManifestPlan(photoshopTask);

assert.equal(photoshopPlan?.appId, 'adobe_photoshop');
assert(photoshopPlan?.beforeSnapshotTools.includes('desktop.photoshop_document_status'));
assert(photoshopPlan?.beforeSnapshotTools.includes('desktop.photoshop_layer_inventory'));
assert(photoshopPlan?.afterSnapshotTools.includes('desktop.photoshop_export_proof'));
assert(photoshopPlan?.entities.some((entity) => entity.kind === 'smart_object' && entity.fields.some((field) => field.key === 'assetBasename')));
assert(photoshopPlan?.entities.some((entity) => entity.kind === 'selection_mask' && entity.fields.some((field) => field.key === 'selectionExists')));
assert(photoshopPlan?.comparisons.some((item) => item.includes('selection/mask target evidence')));
assert(photoshopPlan?.approvalEvidence.some((item) => item.includes('localized edit prompt')));
assert(photoshopPlan?.failClosedConditions.some((item) => item.includes('after snapshot')));

const photoshopArtifact = buildDesignAppObjectManifestArtifact({
  task: photoshopTask,
  beforeCaptures: [
    { tool: 'desktop.file_stat', data: { path: '/Users/cswanson/Desktop/designs/social.psd', sizeBytes: 1234 } },
    {
      tool: 'desktop.photoshop_document_status',
      data: {
        activeDocumentName: 'social.psd',
        activeDocumentPath: '/Users/cswanson/Desktop/designs/social.psd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        widthPx: 1080,
        heightPx: 1080,
        resolution: 144,
        mode: 'RGB',
        layerCount: 9,
        textLayerCount: 2,
        smartObjectCount: 1,
        adjustmentLayerCount: 1,
        selectionActive: true,
      },
    },
    {
      tool: 'desktop.photoshop_layer_inventory',
      data: {
        documentName: 'social.psd',
        layers: [
          { name: 'CTA', path: 'Group / CTA', kind: 'textLayer', visible: true, locked: false, textPreview: 'Buy now', hasMask: false },
          { name: 'Logo', path: 'Group / Logo', kind: 'smartObject', visible: true, locked: false, hasMask: false },
        ],
      },
    },
  ],
  afterCaptures: [
    {
      tool: 'desktop.photoshop_document_status',
      data: {
        activeDocumentName: 'social.psd',
        activeDocumentPath: '/Users/cswanson/Desktop/designs/social.psd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        widthPx: 1080,
        heightPx: 1080,
        resolution: 144,
        mode: 'RGB',
        layerCount: 10,
        textLayerCount: 2,
        smartObjectCount: 2,
        adjustmentLayerCount: 1,
        selectionActive: false,
      },
    },
    {
      tool: 'desktop.photoshop_layer_inventory',
      data: {
        documentName: 'social.psd',
        layers: [
          { name: 'CTA', path: 'Group / CTA', kind: 'textLayer', visible: true, locked: false, textPreview: 'Shop today', hasMask: false },
          { name: 'Logo New', path: 'Group / Logo New', kind: 'smartObject', visible: true, locked: false, hasMask: false },
        ],
      },
    },
    { tool: 'desktop.screenshot', data: { artifactId: 'screen-1' } },
  ],
  actionCaptures: [
    {
      tool: 'desktop.photoshop_update_text_layer',
      data: { documentName: 'social.psd', layerName: 'CTA', replacementText: 'Shop today', updatedLayers: 1, replacementMatches: 1 },
    },
    {
      tool: 'desktop.photoshop_place_asset',
      data: { documentName: 'social.psd', assetPath: '/Users/cswanson/Desktop/assets/logo.png', placedLayerName: 'Logo New' },
    },
    {
      tool: 'desktop.photoshop_export_proof',
      data: {
        documentName: 'social.psd',
        outputPath: '/Users/cswanson/Desktop/proofs/social.png',
        format: 'png',
        fileExists: true,
        sizeBytes: 88200,
        widthPx: 1080,
        heightPx: 1080,
      },
    },
  ],
  approvals: [{ id: 'approval-ps-1', summary: 'Approved CTA text, logo placement, localized edit, and PNG proof export.', approved: true }],
});
assert.equal(photoshopArtifact?.audit.ok, true, photoshopArtifact?.audit.blockers.join(', '));
assert(photoshopArtifact?.before.textFrames.some((entity) => entity.contentHash));
assert(photoshopArtifact?.actions.some((action) => action.changedEntities.some((entity) => entity.kind === 'smart_object' && entity.path?.basename === 'logo.png')));
assert(photoshopArtifact?.artifacts.some((artifact) => artifact.kind === 'proof' && artifact.path?.basename === 'social.png'));
assert(!JSON.stringify(photoshopArtifact).includes('/Users/'), 'Photoshop artifact redacts local paths');
const photoshopSummary = summarizeDesignAppObjectManifestArtifact(photoshopArtifact);
assert.equal(photoshopSummary?.auditOk, true);
assert.equal(photoshopSummary?.activeDocumentBasename, 'social.psd');
assert(photoshopSummary?.changedEntityKinds.includes('smart_object'));
assert(photoshopSummary?.proofArtifacts.some((artifact) => artifact.basename === 'social.png'));
assert(!JSON.stringify(photoshopSummary).includes('/Users/'), 'Photoshop summary redacts local paths');

const handoff = buildChatComputerHandoffContext({
  task: photoshopTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert.equal(handoff.metadata.designObjectManifest?.artifactKind, 'design_object_manifest');
assert(handoff.metadata.designObjectManifest?.entityKinds.includes('selection_mask'));
assert(handoff.metadata.designObjectManifest?.redactionRules.some((item) => item.includes('raw binary')));
assert(!JSON.stringify(handoff.metadata.designObjectManifest).includes('/Users/'), 'manifest metadata does not leak local paths');

const saved = formatPersistedChatBotMessage('OpenSwan', 'Photoshop manifest ready.', {
  source: 'computer_task',
  computerHandoff: handoff.metadata,
} as any);
const compacted = readPersistedChatBotMetadata(saved);
assert(compacted?.computerHandoff?.designObjectManifest?.entityKinds.includes('selection_mask'));
assert(compacted?.computerHandoff?.designProofReview?.reviewTitle === 'Photoshop Proof Review');
assert(compacted?.computerHandoff?.designOperationRunbooks?.some((runbook) => runbook.operation === 'generative_fill_or_remove'));

console.log('All design app object manifest smoke cases passed.');
