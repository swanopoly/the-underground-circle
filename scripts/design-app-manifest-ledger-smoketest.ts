/**
 * design-app-manifest-ledger-smoketest
 *
 * Verifies audited Photoshop/InDesign design object manifests can become
 * compact run-ledger tool actions without leaking local paths.
 *
 * Run: npm run smoke:design-app-manifest-ledger
 */

import assert from 'node:assert/strict';

import { buildDesignAppManifestLedgerAction } from '../src/lib/designAppManifestLedger';
import { buildDesignAppObjectManifestArtifact } from '../src/lib/designAppObjectManifest';

const indesignTask = 'Open this InDesign package, update the headline layer, relink the hero image, export a proof PDF, and package it for handoff.';
const indesignArtifact = buildDesignAppObjectManifestArtifact({
  task: indesignTask,
  generatedAt: '2026-05-27T12:00:00.000Z',
  beforeCaptures: [
    { tool: 'desktop.file_stat', data: { path: '/Users/cswanson/Desktop/banner/banner.indd', sizeBytes: 2048 } },
    {
      tool: 'desktop.indesign_document_status',
      data: {
        activeDocumentName: 'banner.indd',
        activeDocumentPath: '/Users/cswanson/Desktop/banner/banner.indd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        pageCount: 1,
        spreadCount: 1,
        layerCount: 4,
        linkCount: 1,
        missingLinks: 0,
        modifiedLinks: 0,
        fontCount: 3,
        missingFonts: 0,
      },
    },
    {
      tool: 'desktop.indesign_text_inventory',
      data: {
        documentName: 'banner.indd',
        textFrameCount: 1,
        oversetFrames: 0,
        frames: [{ layerName: 'Headline', label: 'headline', contentPreview: 'Old offer', overflows: false, locked: false, visible: true }],
      },
    },
  ],
  afterCaptures: [
    {
      tool: 'desktop.indesign_document_status',
      data: {
        activeDocumentName: 'banner.indd',
        activeDocumentPath: '/Users/cswanson/Desktop/banner/banner.indd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        pageCount: 1,
        spreadCount: 1,
        layerCount: 4,
        linkCount: 1,
        missingLinks: 0,
        modifiedLinks: 0,
        fontCount: 3,
        missingFonts: 0,
      },
    },
    {
      tool: 'desktop.indesign_text_inventory',
      data: {
        documentName: 'banner.indd',
        textFrameCount: 1,
        oversetFrames: 0,
        frames: [{ layerName: 'Headline', label: 'headline', contentPreview: 'New offer', overflows: false, locked: false, visible: true }],
      },
    },
  ],
  actionCaptures: [
    {
      tool: 'desktop.indesign_batch_update_text_layers',
      data: {
        documentName: 'banner.indd',
        updatedFrames: 1,
        results: [{ fieldName: 'headline', replacementText: 'New offer', matchedFrames: 1, updatedFrames: 1 }],
      },
    },
    {
      tool: 'desktop.indesign_relink_asset',
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
  approvals: [{ id: 'approval-design-1', summary: 'Approved headline copy, proof export, and package folder.', approved: true }],
});

const indesignAction = buildDesignAppManifestLedgerAction(indesignArtifact, { runId: 'run-design-1', source: 'smoke' });
assert.equal(indesignAction?.tool_name, 'design.object_manifest');
assert.equal(indesignAction?.status, 'completed');
assert(indesignAction?.output_preview?.includes('manifest verified'));
assert(indesignAction?.artifact_refs?.includes('banner-proof.pdf'));
assert(indesignAction?.artifact_refs?.includes('banner-package-final'));
assert.equal((indesignAction?.metadata as any)?.ledgerArtifactKind, 'design_object_manifest');
assert.equal((indesignAction?.metadata as any)?.auditOk, true);
assert(!JSON.stringify(indesignAction).includes('/Users/'), 'ledger action does not leak local paths');

const blockedArtifact = buildDesignAppObjectManifestArtifact({
  task: indesignTask,
  beforeCaptures: [
    { tool: 'desktop.file_stat', data: { path: '/Users/cswanson/Desktop/banner/banner.indd', sizeBytes: 2048 } },
    { tool: 'desktop.indesign_document_status', data: { activeDocumentName: 'banner.indd' } },
    { tool: 'desktop.indesign_text_inventory', data: { frames: [{ label: 'headline', contentPreview: 'Old offer' }] } },
  ],
  afterCaptures: [],
  actionCaptures: [],
  approvals: [],
});

const blockedAction = buildDesignAppManifestLedgerAction(blockedArtifact);
assert.equal(blockedAction?.status, 'blocked');
assert(blockedAction?.output_preview?.includes('missing approval evidence'));
assert.equal((blockedAction?.metadata as any)?.auditOk, false);
assert(((blockedAction?.metadata as any)?.blockers || []).some((blocker: string) => blocker.includes('missing after active document identity')));
assert(!JSON.stringify(blockedAction).includes('/Users/'), 'blocked ledger action does not leak local paths');

console.log('All design app manifest ledger smoke cases passed.');
