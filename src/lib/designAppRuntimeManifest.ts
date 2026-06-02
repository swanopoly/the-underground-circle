import type { OpenSwanExecutionStatus } from './openswanExecution';
import type { RuntimeToolActionForLedger } from './agentRunLedgerPersistence';
import { buildDesignAppManifestLedgerAction } from './designAppManifestLedger';
import {
  buildDesignAppObjectManifestArtifact,
  buildDesignAppObjectManifestPlan,
  type DesignAppObjectManifestApproval,
  type DesignAppObjectManifestToolCapture,
} from './designAppObjectManifest';

type ToolPolicyLike = {
  approvalMode?: string | null;
};

export type DesignAppRuntimeToolEvent = {
  tool: string;
  input?: unknown;
  result?: string;
  status?: OpenSwanExecutionStatus | string | null;
  metadata?: Record<string, unknown> | null;
};

export interface DesignAppRuntimeManifestOptions {
  task: string;
  toolEvents: DesignAppRuntimeToolEvent[];
  runId?: string | null;
  messageId?: string | null;
}

const DESIGN_TOOL_CAPTURE_KEY = 'designAppCapture';

const DESIGN_OBSERVE_TOOLS = new Set([
  'desktop.file_stat',
  'desktop.indesign_document_status',
  'desktop.indesign_text_inventory',
  'desktop.photoshop_document_status',
  'desktop.photoshop_layer_inventory',
]);

const DESIGN_ACTION_TOOLS = new Set([
  'desktop.indesign_set_layer_state',
  'desktop.indesign_batch_find_change',
  'desktop.indesign_batch_update_text_layers',
  'desktop.indesign_update_text_layer',
  'desktop.indesign_relink_asset',
  'desktop.indesign_package_document',
  'desktop.indesign_export_proof',
  'desktop.photoshop_set_layer_state',
  'desktop.photoshop_update_text_layer',
  'desktop.photoshop_place_asset',
  'desktop.photoshop_export_proof',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compact(value: unknown, max = 260): string {
  return String(value || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function basename(value: unknown): string | null {
  const text = compact(value, 1_500);
  if (!text) return null;
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function copyKeys(data: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = data[key];
    if (value == null || value === '') continue;
    if (typeof value === 'string') out[key] = compact(value, 260);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function compactFrames(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.slice(0, 80).map((frame) => {
        const row = isRecord(frame) ? frame : {};
        return {
          layerName: compact(row.layerName, 160),
          itemName: compact(row.itemName, 160),
          label: compact(row.label, 160),
          pageName: compact(row.pageName, 80),
          contentPreview: compact(row.contentPreview, 160),
          chars: numberOrNull(row.chars),
          overflows: booleanOrNull(row.overflows),
          locked: booleanOrNull(row.locked),
          visible: booleanOrNull(row.visible),
          matchCount: numberOrNull(row.matchCount),
        };
      })
    : [];
}

function compactLayers(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.slice(0, 80).map((layer) => {
        const row = isRecord(layer) ? layer : {};
        return {
          name: compact(row.name, 160),
          path: compact(row.path || row.name, 220),
          type: compact(row.type, 80),
          kind: compact(row.kind, 80),
          textPreview: compact(row.textPreview, 140),
          visible: booleanOrNull(row.visible),
          locked: booleanOrNull(row.locked),
          opacity: numberOrNull(row.opacity),
          hasMask: booleanOrNull(row.hasMask),
          depth: numberOrNull(row.depth),
        };
      })
    : [];
}

function compactActionRows(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.slice(0, 30).map((item) => {
        const row = isRecord(item) ? item : {};
        return {
          fieldName: compact(row.fieldName, 180),
          replacementText: compact(row.replacementText, 140),
          matchedFrames: numberOrNull(row.matchedFrames),
          updatedFrames: numberOrNull(row.updatedFrames),
          matchedLayers: numberOrNull(row.matchedLayers),
          updatedLayers: numberOrNull(row.updatedLayers),
          replacementMatches: numberOrNull(row.replacementMatches),
          unlockedCount: numberOrNull(row.unlockedCount),
        };
      })
    : [];
}

function normalizeDesignCaptureData(tool: string, result: unknown, input?: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  const args = isRecord(input) ? input : {};
  const merged = { ...args, ...result };
  const data: Record<string, unknown> = {
    ...copyKeys(merged, [
      'activeDocumentName',
      'documentName',
      'activeDocumentSaved',
      'activeDocumentModified',
      'pageCount',
      'spreadCount',
      'layerCount',
      'linkCount',
      'missingLinks',
      'modifiedLinks',
      'problemLinks',
      'fontCount',
      'missingFonts',
      'oversetFrames',
      'widthPx',
      'heightPx',
      'resolution',
      'mode',
      'textLayerCount',
      'smartObjectCount',
      'adjustmentLayerCount',
      'selectionActive',
      'matchedFrames',
      'updatedFrames',
      'matchedLayers',
      'updatedLayers',
      'replacementMatches',
      'unlockedCount',
      'relinkedLinks',
      'matchedLinks',
      'missingBefore',
      'missingAfter',
      'fileExists',
      'format',
      'sizeBytes',
      'packageOk',
      'fileCount',
      'missingLinksBefore',
      'modifiedLinksBefore',
      'missingFontsBefore',
      'docModified',
      'docSaved',
    ]),
  };

  const documentPath = basename(merged.activeDocumentPath || merged.sourceDocumentPath);
  if (documentPath) data.activeDocumentPath = documentPath;
  const path = basename(merged.path);
  if (path) data.path = path;
  if (data.sizeBytes == null && numberOrNull(merged.size) != null) data.sizeBytes = numberOrNull(merged.size);

  const outputPath = basename(merged.outputPath);
  if (outputPath) data.outputPath = outputPath;
  const outputFolderPath = basename(merged.outputFolderPath);
  if (outputFolderPath) data.outputFolderPath = outputFolderPath;
  const assetPath = basename(merged.assetPath);
  if (assetPath) data.assetPath = assetPath;

  if (tool === 'desktop.indesign_text_inventory') data.frames = compactFrames(merged.frames);
  if (tool === 'desktop.photoshop_layer_inventory') data.layers = compactLayers(merged.layers);
  if (tool.includes('batch_update_text_layers') || tool.includes('batch_find_change')) data.results = compactActionRows(merged.results);

  const linkNames = Array.isArray(merged.linkNames)
    ? merged.linkNames.slice(0, 20).map((name) => compact(name, 120)).filter(Boolean)
    : [];
  if (linkNames.length > 0) data.linkNames = linkNames;

  const layerNames = Array.isArray(merged.layerNames)
    ? merged.layerNames.slice(0, 20).map((name) => compact(name, 120)).filter(Boolean)
    : [];
  if (layerNames.length > 0) data.layerNames = layerNames;

  const fieldName = compact(merged.fieldName, 180);
  if (fieldName) data.fieldName = fieldName;
  const layerName = compact(merged.layerName || merged.placedLayerName, 180);
  if (layerName) {
    data.layerName = layerName;
    if (merged.placedLayerName) data.placedLayerName = layerName;
  }
  const action = compact(merged.action, 60);
  if (action) data.action = action;
  const replacementText = compact(merged.replacementText, 140);
  if (replacementText) data.replacementText = replacementText;
  const linkQuery = compact(merged.linkQuery, 180);
  if (linkQuery) data.linkQuery = linkQuery;
  const error = compact(merged.error, 240);
  if (error) data.error = error;

  return Object.keys(data).length > 0 ? data : null;
}

export function buildDesignAppRuntimeToolCaptureMetadata(
  tool: string,
  result: unknown,
  input?: unknown,
): DesignAppObjectManifestToolCapture | null {
  if (!DESIGN_OBSERVE_TOOLS.has(tool) && !DESIGN_ACTION_TOOLS.has(tool)) return null;
  const data = normalizeDesignCaptureData(tool, result, input);
  if (!data) return null;
  return {
    tool,
    ok: isRecord(result) ? result.ok !== false : true,
    timestamp: new Date().toISOString(),
    data,
  };
}

export function stripDesignAppRuntimeCaptureMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const { [DESIGN_TOOL_CAPTURE_KEY]: _capture, ...rest } = metadata;
  return rest;
}

function getCapture(event: DesignAppRuntimeToolEvent): DesignAppObjectManifestToolCapture | null {
  const capture = isRecord(event.metadata) ? event.metadata[DESIGN_TOOL_CAPTURE_KEY] : null;
  if (!isRecord(capture) || typeof capture.tool !== 'string') return null;
  return {
    tool: capture.tool,
    ok: capture.ok !== false && event.status !== 'failed' && event.status !== 'blocked',
    timestamp: typeof capture.timestamp === 'string' ? capture.timestamp : null,
    data: isRecord(capture.data) ? capture.data : {},
  };
}

function toolPolicy(event: DesignAppRuntimeToolEvent): ToolPolicyLike | null {
  const policy = isRecord(event.metadata) ? event.metadata.toolPolicy : null;
  return isRecord(policy) ? policy : null;
}

function approvalEvidenceFor(events: DesignAppRuntimeToolEvent[]): DesignAppObjectManifestApproval[] {
  const approvedActionTools = events.filter((event) => (
    DESIGN_ACTION_TOOLS.has(event.tool)
    && event.status === 'passed'
    && toolPolicy(event)?.approvalMode === 'ask'
  ));
  if (approvedActionTools.length < 1) return [];
  return [{
    id: null,
    summary: `OpenSwan approval gate passed for ${approvedActionTools.length} design-app action${approvedActionTools.length === 1 ? '' : 's'}.`,
    approved: true,
    timestamp: new Date().toISOString(),
  }];
}

function matchesPlanApp(tool: string, appId: string): boolean {
  if (tool === 'desktop.file_stat') return true;
  if (appId === 'adobe_photoshop') return tool.includes('photoshop');
  if (appId === 'adobe_indesign') return tool.includes('indesign');
  return false;
}

export function buildDesignAppRuntimeManifestLedgerActions(
  options: DesignAppRuntimeManifestOptions,
): RuntimeToolActionForLedger[] {
  const plan = buildDesignAppObjectManifestPlan(options.task);
  if (!plan) return [];

  const beforeCaptures: DesignAppObjectManifestToolCapture[] = [];
  const afterCaptures: DesignAppObjectManifestToolCapture[] = [];
  const actionCaptures: DesignAppObjectManifestToolCapture[] = [];
  let sawAction = false;

  for (const event of options.toolEvents || []) {
    if (!matchesPlanApp(event.tool, plan.appId)) continue;
    const capture = getCapture(event);
    if (!capture) continue;
    if (DESIGN_ACTION_TOOLS.has(event.tool)) {
      actionCaptures.push(capture);
      sawAction = true;
      continue;
    }
    if (DESIGN_OBSERVE_TOOLS.has(event.tool)) {
      (sawAction ? afterCaptures : beforeCaptures).push(capture);
    }
  }

  if (beforeCaptures.length + afterCaptures.length + actionCaptures.length < 1) return [];

  const manifest = buildDesignAppObjectManifestArtifact({
    task: options.task,
    beforeCaptures,
    afterCaptures,
    actionCaptures,
    approvals: approvalEvidenceFor(options.toolEvents),
    generatedAt: new Date().toISOString(),
  });
  const action = buildDesignAppManifestLedgerAction(manifest, {
    source: 'openswan_runtime_design_manifest',
    runId: options.runId || null,
    messageId: options.messageId || null,
  });
  return action ? [action] : [];
}

export function withDesignAppRuntimeCaptureMetadata(
  metadata: Record<string, unknown>,
  capture: DesignAppObjectManifestToolCapture | null,
): Record<string, unknown> {
  return capture ? { ...metadata, [DESIGN_TOOL_CAPTURE_KEY]: capture } : metadata;
}
