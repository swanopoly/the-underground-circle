/**
 * design-app-runtime-manifest-smoketest
 *
 * Verifies live OpenSwan desktop design tool events can assemble an audited
 * design.object_manifest ledger action while stripping hidden capture payloads
 * from normal tool metadata.
 *
 * Run: npm run smoke:design-app-runtime-manifest
 */

import assert from 'node:assert/strict';

import {
  buildDesignAppRuntimeManifestLedgerActions,
  buildDesignAppRuntimeToolCaptureMetadata,
  stripDesignAppRuntimeCaptureMetadata,
  type DesignAppRuntimeToolEvent,
} from '../src/lib/designAppRuntimeManifest';

function event(tool: string, result: Record<string, unknown>, policy: 'auto' | 'ask' = 'auto'): DesignAppRuntimeToolEvent {
  const capture = buildDesignAppRuntimeToolCaptureMetadata(tool, result, {});
  assert(capture, `${tool} produced design-app capture metadata`);
  return {
    tool,
    status: 'passed',
    result: String(result.resultsText || ''),
    metadata: {
      toolPolicy: { approvalMode: policy },
      designAppCapture: capture,
    },
  };
}

const task = 'Open the InDesign banner, update the headline copy, export a proof PDF, and verify it before saying it is done.';
const events: DesignAppRuntimeToolEvent[] = [
  event('desktop.file_stat', {
    ok: true,
    path: '/Users/cswanson/Desktop/banner/banner.indd',
    sizeBytes: 2048,
    resultsText: 'File exists.',
  }),
  event('desktop.indesign_document_status', {
    ok: true,
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
    resultsText: 'InDesign document status for banner.indd.',
  }),
  event('desktop.indesign_text_inventory', {
    ok: true,
    documentName: 'banner.indd',
    textFrameCount: 1,
    oversetFrames: 0,
    frames: [{ layerName: 'Headline', label: 'headline', contentPreview: 'Old offer', overflows: false, locked: false, visible: true }],
    resultsText: 'InDesign text inventory for banner.indd.',
  }),
  event('desktop.indesign_batch_update_text_layers', {
    ok: true,
    documentName: 'banner.indd',
    updatedFrames: 1,
    results: [{ fieldName: 'headline', replacementText: 'New offer', matchedFrames: 1, updatedFrames: 1 }],
    resultsText: 'Batch InDesign text-layer update for banner.indd.',
  }, 'ask'),
  event('desktop.indesign_export_proof', {
    ok: true,
    documentName: 'banner.indd',
    outputPath: '/Users/cswanson/Desktop/proofs/banner-proof.pdf',
    format: 'pdf',
    fileExists: true,
    sizeBytes: 40960,
    pageCount: 1,
    resultsText: 'Exported InDesign PDF proof for banner.indd.',
  }, 'ask'),
  event('desktop.indesign_document_status', {
    ok: true,
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
    resultsText: 'InDesign document status for banner.indd.',
  }),
  event('desktop.indesign_text_inventory', {
    ok: true,
    documentName: 'banner.indd',
    textFrameCount: 1,
    oversetFrames: 0,
    frames: [{ layerName: 'Headline', label: 'headline', contentPreview: 'New offer', overflows: false, locked: false, visible: true }],
    resultsText: 'InDesign text inventory for banner.indd.',
  }),
];

const actions = buildDesignAppRuntimeManifestLedgerActions({
  task,
  toolEvents: events,
  runId: 'run-live-design-1',
});
assert.equal(actions.length, 1);
assert.equal(actions[0]?.tool_name, 'design.object_manifest');
assert.equal(actions[0]?.status, 'completed');
assert(actions[0]?.artifact_refs?.includes('banner-proof.pdf'));
assert.equal((actions[0]?.metadata as any)?.source, 'openswan_runtime_design_manifest');
assert.equal((actions[0]?.metadata as any)?.auditOk, true);
assert(!JSON.stringify(actions[0]).includes('/Users/'), 'runtime manifest ledger action does not leak local paths');

const stripped = stripDesignAppRuntimeCaptureMetadata(events[0].metadata);
assert(!('designAppCapture' in stripped), 'runtime capture metadata is stripped before normal tool-action persistence');
assert.equal((stripped.toolPolicy as any)?.approvalMode, 'auto');

const blockedActions = buildDesignAppRuntimeManifestLedgerActions({
  task,
  toolEvents: events.map((item) => (
    item.tool.includes('batch_update') || item.tool.includes('export_proof')
      ? { ...item, metadata: { ...(item.metadata || {}), toolPolicy: { approvalMode: 'auto' } } }
      : item
  )),
});
assert.equal(blockedActions[0]?.status, 'blocked');
assert(String(blockedActions[0]?.output_preview || '').includes('missing approval evidence'));

console.log('All design app runtime manifest smoke cases passed.');
