import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
  type DesignAppAutomationPlan,
} from './designAppAutomation';

export type DesignAppManifestEntityKind =
  | 'document'
  | 'layer'
  | 'text_frame'
  | 'link'
  | 'font_preflight'
  | 'proof'
  | 'package_folder'
  | 'selection_mask'
  | 'smart_object'
  | 'adjustment_layer';

export interface DesignAppManifestField {
  key: string;
  label: string;
  required: boolean;
  sourceTool: string;
  redaction: 'none' | 'basename_only' | 'hash_or_basename' | 'summary_only';
}

export interface DesignAppManifestEntitySpec {
  kind: DesignAppManifestEntityKind;
  label: string;
  when: string;
  fields: DesignAppManifestField[];
}

export interface DesignAppObjectManifestPlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  schemaVersion: 1;
  manifestArtifactKind: 'design_object_manifest';
  beforeSnapshotTools: string[];
  afterSnapshotTools: string[];
  entities: DesignAppManifestEntitySpec[];
  comparisons: string[];
  approvalEvidence: string[];
  redactionRules: string[];
  failClosedConditions: string[];
  jsonContract: string[];
}

function field(
  key: string,
  label: string,
  sourceTool: string,
  opts: {
    required?: boolean;
    redaction?: DesignAppManifestField['redaction'];
  } = {},
): DesignAppManifestField {
  return {
    key,
    label,
    sourceTool,
    required: opts.required ?? true,
    redaction: opts.redaction || 'none',
  };
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function has(operations: DesignAppAutomationOperation[], operation: DesignAppAutomationOperation): boolean {
  return operations.includes(operation);
}

function commonJsonContract(): string[] {
  return [
    'DESIGN_OBJECT_MANIFEST_JSON with schemaVersion=1',
    'appId, appName, activeDocument, sourceFile, operations, before, after, comparisons, approvals, artifacts, blockers',
    'before and after entries must cite the source tool and timestamp',
    'local paths must be redacted to basename/hash unless the user explicitly requested debug paths',
    'changed entities must include beforeValue, afterValue, and requestedChange when available',
    'blocked entities must include reason, requiredUserAction, and safeRetryHint',
  ];
}

function indesignEntities(operations: DesignAppAutomationOperation[]): DesignAppManifestEntitySpec[] {
  return [
    {
      kind: 'document',
      label: 'InDesign document',
      when: 'always before and after mutation/export/package',
      fields: [
        field('documentName', 'Document name', 'desktop.indesign_document_status'),
        field('documentPathBasename', 'Document path basename/hash', 'desktop.indesign_document_status', { redaction: 'hash_or_basename' }),
        field('saved', 'Saved state', 'desktop.indesign_document_status'),
        field('modified', 'Modified state', 'desktop.indesign_document_status'),
        field('pageCount', 'Page count', 'desktop.indesign_document_status'),
        field('spreadCount', 'Spread count', 'desktop.indesign_document_status'),
        field('preflightSummary', 'Preflight summary', 'desktop.indesign_document_status'),
      ],
    },
    {
      kind: 'layer',
      label: 'InDesign layer',
      when: 'before layout/text/link changes and after any layer-affecting mutation',
      fields: [
        field('layerName', 'Layer name', 'desktop.indesign_document_status'),
        field('visible', 'Visibility', 'desktop.indesign_document_status'),
        field('locked', 'Lock state', 'desktop.indesign_document_status'),
        field('printable', 'Printable state', 'desktop.indesign_document_status', { required: false }),
        field('itemCount', 'Layer item count', 'desktop.indesign_document_status', { required: false }),
      ],
    },
    {
      kind: 'text_frame',
      label: 'InDesign text frame',
      when: has(operations, 'update_text_layers') || has(operations, 'inspect_layers')
        ? 'required before and after text or copy edits'
        : 'required when text inventory is used',
      fields: [
        field('textFrameId', 'Text frame id/name/label', 'desktop.indesign_text_inventory'),
        field('layerName', 'Containing layer', 'desktop.indesign_text_inventory'),
        field('contentPreview', 'Content preview or hash', 'desktop.indesign_text_inventory', { redaction: 'summary_only' }),
        field('contentHash', 'Content hash', 'desktop.indesign_text_inventory'),
        field('overset', 'Overset text state', 'desktop.indesign_text_inventory'),
        field('locked', 'Locked state', 'desktop.indesign_text_inventory'),
        field('visible', 'Visible state', 'desktop.indesign_text_inventory'),
      ],
    },
    {
      kind: 'link',
      label: 'InDesign placed link',
      when: has(operations, 'replace_linked_asset') || has(operations, 'package_handoff')
        ? 'required before and after relink/package handoff'
        : 'required before proof/package export when links exist',
      fields: [
        field('linkId', 'Link id/name', 'desktop.indesign_document_status'),
        field('linkStatus', 'Link status', 'desktop.indesign_document_status'),
        field('assetBasename', 'Linked asset basename/hash', 'desktop.indesign_document_status', { redaction: 'hash_or_basename' }),
        field('modifiedOrMissing', 'Modified or missing flag', 'desktop.indesign_document_status'),
      ],
    },
    {
      kind: 'font_preflight',
      label: 'Font/preflight issue',
      when: 'required before proof export or package handoff',
      fields: [
        field('fontName', 'Font family/style', 'desktop.indesign_document_status', { redaction: 'summary_only' }),
        field('fontStatus', 'Font status', 'desktop.indesign_document_status'),
        field('preflightSeverity', 'Preflight severity', 'desktop.indesign_document_status'),
      ],
    },
    {
      kind: 'proof',
      label: 'Proof PDF/image',
      when: has(operations, 'export_proof') ? 'required after proof export' : 'required when proof artifact is produced',
      fields: [
        field('proofBasename', 'Proof file basename/hash', 'desktop.indesign_export_proof + desktop.file_stat', { redaction: 'hash_or_basename' }),
        field('format', 'Proof format', 'desktop.indesign_export_proof'),
        field('sizeBytes', 'Proof file size', 'desktop.file_stat'),
        field('createdOrModifiedAt', 'Proof timestamp', 'desktop.file_stat', { required: false }),
      ],
    },
    {
      kind: 'package_folder',
      label: 'Package folder',
      when: has(operations, 'package_handoff') ? 'required after package handoff' : 'required only when packaging',
      fields: [
        field('packageFolderBasename', 'Package folder basename/hash', 'desktop.indesign_package_document + desktop.file_stat', { redaction: 'hash_or_basename' }),
        field('reportBasename', 'Package report basename/hash', 'desktop.indesign_package_document', { redaction: 'hash_or_basename' }),
        field('sourceDocumentIncluded', 'Source document included', 'desktop.indesign_package_document'),
        field('linkCount', 'Packaged link count', 'desktop.indesign_package_document'),
        field('fontCount', 'Packaged font count when allowed', 'desktop.indesign_package_document', { required: false }),
      ],
    },
  ];
}

function photoshopEntities(operations: DesignAppAutomationOperation[]): DesignAppManifestEntitySpec[] {
  return [
    {
      kind: 'document',
      label: 'Photoshop document',
      when: 'always before and after mutation/export',
      fields: [
        field('documentName', 'Document name', 'desktop.photoshop_document_status'),
        field('documentPathBasename', 'Document path basename/hash', 'desktop.photoshop_document_status', { redaction: 'hash_or_basename' }),
        field('saved', 'Saved state', 'desktop.photoshop_document_status'),
        field('modified', 'Modified state', 'desktop.photoshop_document_status'),
        field('width', 'Width', 'desktop.photoshop_document_status'),
        field('height', 'Height', 'desktop.photoshop_document_status'),
        field('resolution', 'Resolution', 'desktop.photoshop_document_status'),
        field('colorModeProfile', 'Color mode/profile', 'desktop.photoshop_document_status'),
      ],
    },
    {
      kind: 'layer',
      label: 'Photoshop layer',
      when: 'always before and after layer/image mutations',
      fields: [
        field('layerId', 'Layer id/name', 'desktop.photoshop_layer_inventory'),
        field('layerKind', 'Layer kind', 'desktop.photoshop_layer_inventory'),
        field('visible', 'Visibility', 'desktop.photoshop_layer_inventory'),
        field('locked', 'Lock state', 'desktop.photoshop_layer_inventory'),
        field('opacity', 'Opacity', 'desktop.photoshop_layer_inventory', { required: false }),
        field('blendMode', 'Blend mode', 'desktop.photoshop_layer_inventory', { required: false }),
      ],
    },
    {
      kind: 'text_frame',
      label: 'Photoshop text layer',
      when: has(operations, 'update_text_layers') ? 'required before and after text-layer edits' : 'required when text layers are present',
      fields: [
        field('layerId', 'Text layer id/name', 'desktop.photoshop_layer_inventory'),
        field('textPreview', 'Text preview or hash', 'desktop.photoshop_layer_inventory', { redaction: 'summary_only' }),
        field('textHash', 'Text content hash', 'desktop.photoshop_layer_inventory'),
        field('fontSummary', 'Font summary', 'desktop.photoshop_layer_inventory', { required: false, redaction: 'summary_only' }),
      ],
    },
    {
      kind: 'smart_object',
      label: 'Smart object or placed asset',
      when: has(operations, 'replace_linked_asset') ? 'required before and after asset placement/replacement' : 'required when smart objects exist',
      fields: [
        field('layerId', 'Smart object layer id/name', 'desktop.photoshop_layer_inventory'),
        field('linkedOrEmbedded', 'Linked or embedded state', 'desktop.photoshop_layer_inventory'),
        field('assetBasename', 'Asset basename/hash', 'desktop.photoshop_layer_inventory', { redaction: 'hash_or_basename' }),
        field('placedReceiptId', 'Placement receipt id', 'desktop.photoshop_place_asset', { required: false }),
      ],
    },
    {
      kind: 'selection_mask',
      label: 'Selection or mask target',
      when: has(operations, 'apply_selection_or_mask') || has(operations, 'generative_fill_or_remove')
        ? 'required before localized/generative edits and after mutation'
        : 'required when a localized edit is requested',
      fields: [
        field('selectionExists', 'Selection exists', 'desktop.photoshop_document_status'),
        field('selectionBoundsSummary', 'Selection bounds summary', 'desktop.photoshop_document_status', { required: false, redaction: 'summary_only' }),
        field('maskLayerId', 'Mask layer id/name', 'desktop.photoshop_layer_inventory', { required: false }),
        field('targetAreaDescription', 'Target area description', 'desktop.screenshot', { redaction: 'summary_only' }),
      ],
    },
    {
      kind: 'adjustment_layer',
      label: 'Adjustment layer',
      when: has(operations, 'edit_adjustment_layers') ? 'required before and after adjustment edits' : 'required when adjustment layers are changed',
      fields: [
        field('layerId', 'Adjustment layer id/name', 'desktop.photoshop_layer_inventory'),
        field('adjustmentKind', 'Adjustment kind', 'desktop.photoshop_layer_inventory'),
        field('maskState', 'Mask state', 'desktop.photoshop_layer_inventory', { required: false }),
      ],
    },
    {
      kind: 'proof',
      label: 'Raster proof',
      when: has(operations, 'export_raster_proof') ? 'required after raster proof export' : 'required when proof artifact is produced',
      fields: [
        field('proofBasename', 'Proof file basename/hash', 'desktop.photoshop_export_proof + desktop.file_stat', { redaction: 'hash_or_basename' }),
        field('format', 'Proof format', 'desktop.photoshop_export_proof'),
        field('sizeBytes', 'Proof file size', 'desktop.file_stat'),
        field('widthHeight', 'Output dimensions when returned', 'desktop.photoshop_export_proof', { required: false }),
      ],
    },
  ];
}

function comparisonsFor(plan: DesignAppAutomationPlan): string[] {
  const operations = plan.operations;
  const comparisons = [
    'active document identity before vs after',
    'source file/package identity vs active document',
  ];
  const creativeAi = has(operations, 'generate_ai_asset') || has(operations, 'generative_expand_asset') || has(operations, 'create_creative_variants');
  if (has(operations, 'update_text_layers')) comparisons.push('text content hash/preview before vs after for each changed target');
  if (has(operations, 'replace_linked_asset')) comparisons.push('asset/link/smart-object basename/hash before vs after');
  if (has(operations, 'toggle_layer_visibility')) comparisons.push('layer visibility/lock state before vs after');
  if (has(operations, 'apply_selection_or_mask') || has(operations, 'generative_fill_or_remove')) comparisons.push('selection/mask target evidence before vs proof after');
  if (creativeAi) comparisons.push('creative AI prompt/data-source approval plus generated output receipt vs placed/proof evidence');
  if (has(operations, 'edit_adjustment_layers')) comparisons.push('adjustment layer stack before vs after');
  if (has(operations, 'export_proof') || has(operations, 'export_raster_proof')) comparisons.push('proof output file_stat and visual evidence after export');
  if (has(operations, 'package_handoff')) comparisons.push('package folder summary vs pre-package link/font status');
  return unique(comparisons);
}

function approvalEvidenceFor(plan: DesignAppAutomationPlan): string[] {
  const operations = plan.operations;
  const creativeAi = has(operations, 'generate_ai_asset') || has(operations, 'generative_expand_asset') || has(operations, 'create_creative_variants');
  return unique([
    has(operations, 'update_text_layers') ? 'approved text target ids/names and old/new copy summary' : '',
    has(operations, 'replace_linked_asset') ? 'approved asset path basename/hash and target link/layer id' : '',
    has(operations, 'apply_selection_or_mask') || has(operations, 'generative_fill_or_remove') ? 'approved selection/mask target and localized edit prompt/action' : '',
    creativeAi ? 'approved creative AI prompt/variant data, target layer/frame, cloud-processing scope, and output basename/hash' : '',
    has(operations, 'export_proof') || has(operations, 'export_raster_proof') ? 'approved output basename/hash, format, and overwrite state' : '',
    has(operations, 'package_handoff') ? 'approved package folder basename/hash and package options' : '',
    'approval id or explicit no-approval-needed reason for every mutation/export/save/package step',
  ]);
}

function beforeTools(plan: DesignAppAutomationPlan): string[] {
  return plan.appId === 'adobe_photoshop'
    ? ['desktop.file_stat', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory']
    : ['desktop.file_stat', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory'];
}

function afterTools(plan: DesignAppAutomationPlan): string[] {
  const tools = plan.appId === 'adobe_photoshop'
    ? ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory']
    : ['desktop.indesign_document_status', 'desktop.indesign_text_inventory'];
  if (has(plan.operations, 'export_raster_proof')) tools.push('desktop.photoshop_export_proof', 'desktop.file_stat');
  if (has(plan.operations, 'export_proof')) tools.push('desktop.indesign_export_proof', 'desktop.file_stat');
  if (has(plan.operations, 'package_handoff')) tools.push('desktop.indesign_package_document', 'desktop.file_stat');
  if (has(plan.operations, 'replace_linked_asset')) tools.push(plan.appId === 'adobe_photoshop' ? 'desktop.photoshop_place_asset' : 'desktop.indesign_relink_asset');
  if (
    has(plan.operations, 'apply_selection_or_mask')
    || has(plan.operations, 'generative_fill_or_remove')
    || has(plan.operations, 'generate_ai_asset')
    || has(plan.operations, 'generative_expand_asset')
    || has(plan.operations, 'create_creative_variants')
  ) tools.push('desktop.screenshot', 'desktop.file_stat');
  return unique(tools);
}

export function buildDesignAppObjectManifestPlan(task: string): DesignAppObjectManifestPlan | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;
  const entities = plan.appId === 'adobe_photoshop'
    ? photoshopEntities(plan.operations)
    : indesignEntities(plan.operations);
  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations: plan.operations,
    schemaVersion: 1,
    manifestArtifactKind: 'design_object_manifest',
    beforeSnapshotTools: beforeTools(plan),
    afterSnapshotTools: afterTools(plan),
    entities,
    comparisons: comparisonsFor(plan),
    approvalEvidence: approvalEvidenceFor(plan),
    redactionRules: [
      'store local source/output paths as basename plus hash unless debug paths were explicitly requested',
      'store copy/text previews as short summaries plus content hashes for before/after comparison',
      'store image/asset paths as basename/hash; do not expose full local user directory paths in chat',
      'store screenshots/proofs as artifact references, not raw binary data inside message metadata',
    ],
    failClosedConditions: [
      'manifest before snapshot is missing for a mutating operation',
      'active document identity does not match source file/package identity',
      'changed entity cannot be matched to a before snapshot',
      'approval evidence is missing for mutation/export/package/destructive edit',
      'after snapshot or proof/file_stat is missing for claimed completion',
    ],
    jsonContract: commonJsonContract(),
  };
}

export interface DesignAppObjectManifestToolCapture {
  tool: string;
  ok?: boolean;
  timestamp?: string | null;
  data?: Record<string, unknown> | null;
}

export interface DesignAppObjectManifestApproval {
  id?: string | null;
  operation?: DesignAppAutomationOperation | string | null;
  summary: string;
  approved?: boolean;
  timestamp?: string | null;
}

export interface DesignAppObjectManifestArtifactInput {
  task: string;
  beforeCaptures: DesignAppObjectManifestToolCapture[];
  afterCaptures: DesignAppObjectManifestToolCapture[];
  actionCaptures?: DesignAppObjectManifestToolCapture[];
  approvals?: DesignAppObjectManifestApproval[];
  artifacts?: DesignAppObjectManifestArtifactRef[];
  blockers?: string[];
  generatedAt?: string;
}

export interface RedactedDesignPath {
  basename: string;
  hash: string;
  extension: string | null;
}

export interface DesignAppObjectManifestToolSummary {
  tool: string;
  ok: boolean;
  timestamp: string;
  keys: string[];
}

export interface DesignAppObjectManifestDocumentEvidence {
  name: string | null;
  path: RedactedDesignPath | null;
  saved: boolean | null;
  modified: boolean | null;
  widthPx?: number | null;
  heightPx?: number | null;
  resolution?: number | null;
  colorMode?: string | null;
  pageCount?: number | null;
  spreadCount?: number | null;
  layerCount?: number | null;
  textLayerCount?: number | null;
  smartObjectCount?: number | null;
  adjustmentLayerCount?: number | null;
  linkCount?: number | null;
  missingLinks?: number | null;
  modifiedLinks?: number | null;
  fontCount?: number | null;
  missingFonts?: number | null;
  oversetFrames?: number | null;
  selectionActive?: boolean | null;
}

export interface DesignAppObjectManifestEntityEvidence {
  kind: DesignAppManifestEntityKind;
  id: string;
  name?: string | null;
  layerName?: string | null;
  path?: RedactedDesignPath | null;
  sourceTool: string;
  contentPreview?: string | null;
  contentHash?: string | null;
  state: Record<string, string | number | boolean | null>;
}

export interface DesignAppObjectManifestSnapshot {
  phase: 'before' | 'after';
  timestamp: string;
  tools: DesignAppObjectManifestToolSummary[];
  activeDocument: DesignAppObjectManifestDocumentEvidence | null;
  textFrames: DesignAppObjectManifestEntityEvidence[];
  layers: DesignAppObjectManifestEntityEvidence[];
  links: DesignAppObjectManifestEntityEvidence[];
  blockers: string[];
}

export interface DesignAppObjectManifestActionEvidence {
  tool: string;
  ok: boolean;
  timestamp: string;
  summary: string;
  approvalId?: string | null;
  changedEntities: DesignAppObjectManifestEntityEvidence[];
  artifacts: DesignAppObjectManifestArtifactRef[];
  blockers: string[];
}

export interface DesignAppObjectManifestArtifactRef {
  kind: 'proof' | 'package_folder' | 'source_file' | 'placed_asset' | 'report' | 'screenshot' | 'other';
  label: string;
  path: RedactedDesignPath | null;
  sourceTool?: string | null;
  format?: string | null;
  sizeBytes?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  pageCount?: number | null;
  timestamp?: string | null;
}

export interface DesignAppObjectManifestComparisonEvidence {
  label: string;
  status: 'pass' | 'warning' | 'blocker' | 'unknown';
  detail: string;
}

export interface DesignAppObjectManifestAudit {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface DesignAppObjectManifestArtifact {
  schemaVersion: 1;
  artifactKind: 'design_object_manifest';
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  task: string;
  operations: DesignAppAutomationOperation[];
  generatedAt: string;
  requiredBeforeTools: string[];
  requiredAfterTools: string[];
  before: DesignAppObjectManifestSnapshot;
  after: DesignAppObjectManifestSnapshot;
  actions: DesignAppObjectManifestActionEvidence[];
  approvals: DesignAppObjectManifestApproval[];
  artifacts: DesignAppObjectManifestArtifactRef[];
  comparisons: DesignAppObjectManifestComparisonEvidence[];
  redactionRules: string[];
  blockers: string[];
  audit: DesignAppObjectManifestAudit;
}

export interface DesignAppObjectManifestArtifactSummary {
  schemaVersion: 1;
  artifactKind: 'design_object_manifest';
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  generatedAt: string;
  auditOk: boolean;
  blockerCount: number;
  warningCount: number;
  beforeToolCount: number;
  afterToolCount: number;
  actionCount: number;
  artifactCount: number;
  activeDocumentName: string | null;
  activeDocumentBasename: string | null;
  changedEntityKinds: DesignAppManifestEntityKind[];
  artifactKinds: DesignAppObjectManifestArtifactRef['kind'][];
  comparisonStatuses: Array<{
    label: string;
    status: DesignAppObjectManifestComparisonEvidence['status'];
  }>;
  proofArtifacts: Array<{
    label: string;
    basename: string | null;
    format?: string | null;
    sizeBytes?: number | null;
    widthPx?: number | null;
    heightPx?: number | null;
    pageCount?: number | null;
  }>;
  packageArtifacts: Array<{
    label: string;
    basename: string | null;
    sizeBytes?: number | null;
  }>;
  blockers: string[];
  warnings: string[];
  redaction: 'basename_hash_only';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function getNumber(data: Record<string, unknown>, key: string): number | null {
  const value = Number(data[key]);
  return Number.isFinite(value) ? value : null;
}

function getBool(data: Record<string, unknown>, key: string): boolean | null {
  return typeof data[key] === 'boolean' ? data[key] as boolean : null;
}

function cleanText(value: unknown, max = 180): string {
  return String(value || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableHash(value: unknown): string {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function redactPath(value: unknown): RedactedDesignPath | null {
  const text = cleanText(value, 1_500);
  if (!text) return null;
  const basename = text.split(/[\\/]/).filter(Boolean).pop() || text;
  const dot = basename.lastIndexOf('.');
  return {
    basename: basename.slice(0, 180),
    hash: stableHash(text),
    extension: dot >= 0 ? basename.slice(dot + 1).toLowerCase().slice(0, 16) : null,
  };
}

function redactLocalPathsInText(value: unknown): string {
  const text = String(value || '');
  return text
    .replace(/\/Users\/[^;\n\r`'"]+/g, (match) => {
      const redacted = redactPath(match);
      return redacted ? `[local-path:${redacted.basename}#${redacted.hash}]` : '[local-path]';
    })
    .replace(/\/private\/[^;\n\r`'"]+/g, (match) => {
      const redacted = redactPath(match);
      return redacted ? `[local-path:${redacted.basename}#${redacted.hash}]` : '[local-path]';
    })
    .replace(/[A-Za-z]:\\[^;\n\r`'"]+/g, (match) => {
      const redacted = redactPath(match);
      return redacted ? `[local-path:${redacted.basename}#${redacted.hash}]` : '[local-path]';
    });
}

function nowIso(value?: string | null): string {
  if (value && !Number.isNaN(Date.parse(value))) return value;
  return new Date(0).toISOString();
}

function toolSummary(capture: DesignAppObjectManifestToolCapture): DesignAppObjectManifestToolSummary {
  const data = asRecord(capture.data);
  return {
    tool: cleanText(capture.tool, 120),
    ok: capture.ok !== false,
    timestamp: nowIso(capture.timestamp),
    keys: Object.keys(data).sort().slice(0, 18),
  };
}

function latestCapture(
  captures: DesignAppObjectManifestToolCapture[],
  predicate: (tool: string) => boolean,
): DesignAppObjectManifestToolCapture | null {
  for (let index = captures.length - 1; index >= 0; index -= 1) {
    const capture = captures[index];
    if (predicate(cleanText(capture.tool))) return capture;
  }
  return null;
}

function buildDocumentEvidence(
  plan: DesignAppObjectManifestPlan,
  captures: DesignAppObjectManifestToolCapture[],
): DesignAppObjectManifestDocumentEvidence | null {
  const statusCapture = latestCapture(captures, (tool) => tool.includes('_document_status'));
  if (!statusCapture) return null;
  const data = asRecord(statusCapture.data);
  if (plan.appId === 'adobe_photoshop') {
    return {
      name: getString(data, 'activeDocumentName') || getString(data, 'documentName') || null,
      path: redactPath(getString(data, 'activeDocumentPath') || getString(data, 'sourceDocumentPath')),
      saved: getBool(data, 'activeDocumentSaved'),
      modified: getBool(data, 'activeDocumentModified'),
      widthPx: getNumber(data, 'widthPx'),
      heightPx: getNumber(data, 'heightPx'),
      resolution: getNumber(data, 'resolution'),
      colorMode: getString(data, 'mode') || null,
      layerCount: getNumber(data, 'layerCount'),
      textLayerCount: getNumber(data, 'textLayerCount'),
      smartObjectCount: getNumber(data, 'smartObjectCount'),
      adjustmentLayerCount: getNumber(data, 'adjustmentLayerCount'),
      selectionActive: getBool(data, 'selectionActive'),
    };
  }
  return {
    name: getString(data, 'activeDocumentName') || getString(data, 'documentName') || null,
    path: redactPath(getString(data, 'activeDocumentPath') || getString(data, 'sourceDocumentPath')),
    saved: getBool(data, 'activeDocumentSaved'),
    modified: getBool(data, 'activeDocumentModified'),
    pageCount: getNumber(data, 'pageCount'),
    spreadCount: getNumber(data, 'spreadCount'),
    layerCount: getNumber(data, 'layerCount'),
    linkCount: getNumber(data, 'linkCount'),
    missingLinks: getNumber(data, 'missingLinks'),
    modifiedLinks: getNumber(data, 'modifiedLinks'),
    fontCount: getNumber(data, 'fontCount'),
    missingFonts: getNumber(data, 'missingFonts'),
  };
}

function buildTextFrameEvidence(
  plan: DesignAppObjectManifestPlan,
  captures: DesignAppObjectManifestToolCapture[],
): DesignAppObjectManifestEntityEvidence[] {
  if (plan.appId === 'adobe_photoshop') {
    const inventory = latestCapture(captures, (tool) => tool.includes('photoshop_layer_inventory'));
    const layers = asArray(asRecord(inventory?.data).layers);
    return layers
      .map((item) => asRecord(item))
      .filter((layer) => cleanText(layer.kind || layer.type).toLowerCase().includes('text') || cleanText(layer.textPreview))
      .slice(0, 40)
      .map((layer) => {
        const id = cleanText(layer.path || layer.name || 'text-layer', 220);
        const preview = cleanText(layer.textPreview, 140);
        return {
          kind: 'text_frame',
          id,
          name: cleanText(layer.name, 160) || null,
          layerName: cleanText(layer.path || layer.name, 220) || null,
          sourceTool: 'desktop.photoshop_layer_inventory',
          contentPreview: preview || null,
          contentHash: preview ? stableHash(preview) : null,
          state: {
            visible: typeof layer.visible === 'boolean' ? layer.visible : null,
            locked: typeof layer.locked === 'boolean' ? layer.locked : null,
            kind: cleanText(layer.kind || layer.type, 80) || null,
          },
        };
      });
  }

  const inventory = latestCapture(captures, (tool) => tool.includes('indesign_text_inventory'));
  const frames = asArray(asRecord(inventory?.data).frames);
  return frames.slice(0, 80).map((item) => {
    const frame = asRecord(item);
    const id = cleanText([frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / '), 240) || 'text-frame';
    const preview = cleanText(frame.contentPreview, 160);
    return {
      kind: 'text_frame',
      id,
      name: cleanText(frame.itemName || frame.label, 160) || null,
      layerName: cleanText(frame.layerName, 160) || null,
      sourceTool: 'desktop.indesign_text_inventory',
      contentPreview: preview || null,
      contentHash: preview ? stableHash(preview) : null,
      state: {
        pageName: cleanText(frame.pageName, 80) || null,
        chars: Number.isFinite(Number(frame.chars)) ? Number(frame.chars) : null,
        overflows: typeof frame.overflows === 'boolean' ? frame.overflows : null,
        locked: typeof frame.locked === 'boolean' ? frame.locked : null,
        visible: typeof frame.visible === 'boolean' ? frame.visible : null,
        matchCount: Number.isFinite(Number(frame.matchCount)) ? Number(frame.matchCount) : null,
      },
    };
  });
}

function buildLayerEvidence(
  plan: DesignAppObjectManifestPlan,
  captures: DesignAppObjectManifestToolCapture[],
): DesignAppObjectManifestEntityEvidence[] {
  if (plan.appId !== 'adobe_photoshop') return [];
  const inventory = latestCapture(captures, (tool) => tool.includes('photoshop_layer_inventory'));
  const layers = asArray(asRecord(inventory?.data).layers);
  return layers.slice(0, 80).map((item) => {
    const layer = asRecord(item);
    const id = cleanText(layer.path || layer.name || 'layer', 220);
    return {
      kind: 'layer',
      id,
      name: cleanText(layer.name, 160) || null,
      layerName: cleanText(layer.path || layer.name, 220) || null,
      sourceTool: 'desktop.photoshop_layer_inventory',
      contentPreview: cleanText(layer.textPreview, 140) || null,
      contentHash: cleanText(layer.textPreview) ? stableHash(layer.textPreview) : null,
      state: {
        type: cleanText(layer.type, 80) || null,
        kind: cleanText(layer.kind, 80) || null,
        visible: typeof layer.visible === 'boolean' ? layer.visible : null,
        locked: typeof layer.locked === 'boolean' ? layer.locked : null,
        opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : null,
        hasMask: typeof layer.hasMask === 'boolean' ? layer.hasMask : null,
        depth: Number.isFinite(Number(layer.depth)) ? Number(layer.depth) : null,
      },
    };
  });
}

function buildLinkEvidence(
  plan: DesignAppObjectManifestPlan,
  captures: DesignAppObjectManifestToolCapture[],
): DesignAppObjectManifestEntityEvidence[] {
  if (plan.appId !== 'adobe_indesign') return [];
  const statusCapture = latestCapture(captures, (tool) => tool.includes('indesign_document_status'));
  const data = asRecord(statusCapture?.data);
  const linkCount = Number(data.linkCount || 0);
  if (!linkCount) return [];
  return [{
    kind: 'link',
    id: 'indesign-link-summary',
    name: 'Placed link summary',
    sourceTool: 'desktop.indesign_document_status',
    state: {
      linkCount,
      missingLinks: Number(data.missingLinks || 0),
      modifiedLinks: Number(data.modifiedLinks || 0),
      problemLinks: Number(data.problemLinks || 0),
    },
  }];
}

function buildSnapshot(
  plan: DesignAppObjectManifestPlan,
  phase: 'before' | 'after',
  captures: DesignAppObjectManifestToolCapture[],
): DesignAppObjectManifestSnapshot {
  const tools = captures.map(toolSummary).filter((tool) => tool.tool);
  const failed = tools.filter((tool) => !tool.ok).map((tool) => `${tool.tool} failed`);
  const textFrames = buildTextFrameEvidence(plan, captures);
  const activeDocument = buildDocumentEvidence(plan, captures);
  const documentOverset = plan.appId === 'adobe_indesign'
    ? getNumber(asRecord(latestCapture(captures, (tool) => tool.includes('indesign_text_inventory'))?.data), 'oversetFrames')
    : null;
  if (activeDocument && documentOverset != null) activeDocument.oversetFrames = documentOverset;
  return {
    phase,
    timestamp: tools[tools.length - 1]?.timestamp || new Date(0).toISOString(),
    tools,
    activeDocument,
    textFrames,
    layers: buildLayerEvidence(plan, captures),
    links: buildLinkEvidence(plan, captures),
    blockers: failed,
  };
}

function artifactFromCapture(capture: DesignAppObjectManifestToolCapture): DesignAppObjectManifestArtifactRef | null {
  const tool = cleanText(capture.tool);
  const data = asRecord(capture.data);
  if (tool.includes('export_proof')) {
    return {
      kind: 'proof',
      label: tool.includes('photoshop') ? 'Photoshop raster proof' : 'InDesign proof PDF',
      path: redactPath(getString(data, 'outputPath')),
      sourceTool: tool,
      format: getString(data, 'format') || (tool.includes('indesign') ? 'pdf' : null),
      sizeBytes: getNumber(data, 'sizeBytes'),
      widthPx: getNumber(data, 'widthPx'),
      heightPx: getNumber(data, 'heightPx'),
      pageCount: getNumber(data, 'pageCount'),
      timestamp: nowIso(capture.timestamp),
    };
  }
  if (tool.includes('package_document')) {
    return {
      kind: 'package_folder',
      label: 'InDesign package folder',
      path: redactPath(getString(data, 'outputFolderPath')),
      sourceTool: tool,
      sizeBytes: getNumber(data, 'sizeBytes'),
      timestamp: nowIso(capture.timestamp),
    };
  }
  if (tool.includes('place_asset') || tool.includes('relink_asset')) {
    return {
      kind: 'placed_asset',
      label: tool.includes('photoshop') ? 'Photoshop placed asset' : 'InDesign relinked asset',
      path: redactPath(getString(data, 'assetPath')),
      sourceTool: tool,
      timestamp: nowIso(capture.timestamp),
    };
  }
  return null;
}

function changedEntitiesFromAction(capture: DesignAppObjectManifestToolCapture): DesignAppObjectManifestEntityEvidence[] {
  const tool = cleanText(capture.tool);
  const data = asRecord(capture.data);
  const sourceTool = tool;
  if (tool.includes('batch_update_text_layers')) {
    return asArray(data.results).slice(0, 30).map((item) => {
      const row = asRecord(item);
      const id = cleanText(row.fieldName || 'text-update', 180);
      const replacement = cleanText(row.replacementText, 140);
      return {
        kind: 'text_frame',
        id,
        name: id,
        sourceTool,
        contentPreview: replacement || null,
        contentHash: replacement ? stableHash(replacement) : null,
        state: {
          matchedFrames: Number(row.matchedFrames || 0),
          updatedFrames: Number(row.updatedFrames || 0),
          replacementMatches: Number(row.replacementMatches || 0),
          unlockedCount: Number(row.unlockedCount || 0),
        },
      };
    });
  }
  if (tool.includes('update_text_layer')) {
    const target = cleanText(data.fieldName || data.layerName || 'text-update', 180);
    const replacement = cleanText(data.replacementText, 140);
    return [{
      kind: 'text_frame',
      id: target,
      name: target,
      sourceTool,
      contentPreview: replacement || null,
      contentHash: replacement ? stableHash(replacement) : null,
      state: {
        matchedFrames: Number(data.matchedFrames || data.matchedLayers || 0),
        updatedFrames: Number(data.updatedFrames || data.updatedLayers || 0),
        replacementMatches: Number(data.replacementMatches || 0),
      },
    }];
  }
  if (tool.includes('place_asset')) {
    const layerName = cleanText(data.placedLayerName || data.layerName || 'placed-asset', 180);
    return [{
      kind: 'smart_object',
      id: layerName,
      name: layerName,
      path: redactPath(data.assetPath),
      sourceTool,
      state: {
        docModified: typeof data.docModified === 'boolean' ? data.docModified : null,
        docSaved: typeof data.docSaved === 'boolean' ? data.docSaved : null,
      },
    }];
  }
  if (tool.includes('relink_asset')) {
    const names = asArray(data.linkNames).map((name) => cleanText(name, 120)).filter(Boolean);
    return [{
      kind: 'link',
      id: names.join(', ') || cleanText(data.linkQuery || 'relinked-link', 180),
      name: names.join(', ') || null,
      path: redactPath(data.assetPath),
      sourceTool,
      state: {
        matchedLinks: Number(data.matchedLinks || 0),
        relinkedLinks: Number(data.relinkedLinks || 0),
        missingBefore: Number(data.missingBefore || 0),
        missingAfter: Number(data.missingAfter || 0),
      },
    }];
  }
  return [];
}

function actionSummary(capture: DesignAppObjectManifestToolCapture): string {
  const tool = cleanText(capture.tool);
  const data = asRecord(capture.data);
  const documentName = getString(data, 'documentName') || getString(data, 'activeDocumentName') || 'active document';
  if (tool.includes('export_proof')) {
    const artifact = artifactFromCapture(capture);
    return `${tool} created ${artifact?.path?.basename || 'proof artifact'} for ${documentName}`;
  }
  if (tool.includes('package_document')) {
    const artifact = artifactFromCapture(capture);
    return `${tool} created ${artifact?.path?.basename || 'package folder'} for ${documentName}`;
  }
  if (tool.includes('batch_update_text_layers')) {
    return `${tool} updated ${Number(data.updatedFrames || 0)} text frame(s) in ${documentName}`;
  }
  if (tool.includes('update_text_layer')) {
    return `${tool} updated ${Number(data.updatedFrames || data.updatedLayers || 0)} text target(s) in ${documentName}`;
  }
  if (tool.includes('place_asset') || tool.includes('relink_asset')) {
    const artifact = artifactFromCapture(capture);
    return `${tool} used asset ${artifact?.path?.basename || 'approved asset'} in ${documentName}`;
  }
  return `${tool} returned ${capture.ok === false ? 'a failed result' : 'a result'} for ${documentName}`;
}

function buildActionEvidence(captures: DesignAppObjectManifestToolCapture[]): DesignAppObjectManifestActionEvidence[] {
  return captures.map((capture) => {
    const tool = cleanText(capture.tool, 120);
    const artifact = artifactFromCapture(capture);
    const data = asRecord(capture.data);
    const error = cleanText(data.error, 240);
    return {
      tool,
      ok: capture.ok !== false && !error,
      timestamp: nowIso(capture.timestamp),
      summary: actionSummary(capture),
      approvalId: getString(data, 'approvalId') || null,
      changedEntities: changedEntitiesFromAction(capture),
      artifacts: artifact ? [artifact] : [],
      blockers: error ? [error] : [],
    };
  });
}

function comparisonEvidence(
  plan: DesignAppObjectManifestPlan,
  before: DesignAppObjectManifestSnapshot,
  after: DesignAppObjectManifestSnapshot,
  actions: DesignAppObjectManifestActionEvidence[],
): DesignAppObjectManifestComparisonEvidence[] {
  const rows: DesignAppObjectManifestComparisonEvidence[] = [];
  const beforeName = before.activeDocument?.name || '';
  const afterName = after.activeDocument?.name || '';
  rows.push({
    label: 'active document identity before vs after',
    status: beforeName && afterName ? (beforeName === afterName ? 'pass' : 'blocker') : 'unknown',
    detail: beforeName && afterName
      ? `${beforeName === afterName ? 'Matched' : 'Mismatched'} active document: ${beforeName} -> ${afterName}.`
      : 'Active document identity is missing from before or after snapshot.',
  });
  if (has(plan.operations, 'update_text_layers')) {
    const changedText = actions.flatMap((action) => action.changedEntities).filter((entity) => entity.kind === 'text_frame');
    rows.push({
      label: 'text content hash/preview before vs after for each changed target',
      status: changedText.length > 0 && after.textFrames.length > 0 ? 'pass' : 'blocker',
      detail: changedText.length > 0
        ? `${changedText.length} text target(s) have action evidence and ${after.textFrames.length} post-change text frame(s) were captured.`
        : 'No text action evidence was captured.',
    });
  }
  if (has(plan.operations, 'replace_linked_asset')) {
    const assetActions = actions.flatMap((action) => action.changedEntities).filter((entity) => entity.kind === 'link' || entity.kind === 'smart_object');
    rows.push({
      label: 'asset/link/smart-object basename/hash before vs after',
      status: assetActions.length > 0 ? 'pass' : 'blocker',
      detail: assetActions.length > 0 ? `${assetActions.length} asset/link action target(s) captured.` : 'No placed-asset or relink action evidence was captured.',
    });
  }
  if (has(plan.operations, 'export_proof') || has(plan.operations, 'export_raster_proof')) {
    const proofCount = actions.flatMap((action) => action.artifacts).filter((artifact) => artifact.kind === 'proof').length;
    rows.push({
      label: 'proof output file_stat and visual evidence after export',
      status: proofCount > 0 ? 'pass' : 'blocker',
      detail: proofCount > 0 ? `${proofCount} proof artifact(s) captured.` : 'No proof artifact was captured.',
    });
  }
  if (has(plan.operations, 'package_handoff')) {
    const packageCount = actions.flatMap((action) => action.artifacts).filter((artifact) => artifact.kind === 'package_folder').length;
    rows.push({
      label: 'package folder summary vs pre-package link/font status',
      status: packageCount > 0 ? 'pass' : 'blocker',
      detail: packageCount > 0 ? `${packageCount} package folder artifact(s) captured.` : 'No package folder artifact was captured.',
    });
  }
  return rows;
}

function toolNames(snapshot: DesignAppObjectManifestSnapshot): Set<string> {
  return new Set(snapshot.tools.map((tool) => tool.tool));
}

function pathLeakInArtifact(artifact: Omit<DesignAppObjectManifestArtifact, 'audit'>): boolean {
  const json = JSON.stringify(artifact);
  return /\/Users\/|\/private\/|[A-Za-z]:\\\\/.test(json);
}

function requiresApproval(operations: DesignAppAutomationOperation[]): boolean {
  return operations.some((operation) => !['inspect_layers', 'inspect_image_document'].includes(operation));
}

export function auditDesignAppObjectManifestArtifact(
  artifact: Omit<DesignAppObjectManifestArtifact, 'audit'>,
): DesignAppObjectManifestAudit {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const beforeTools = toolNames(artifact.before);
  const afterTools = toolNames(artifact.after);

  for (const tool of artifact.requiredBeforeTools) {
    if (!beforeTools.has(tool)) blockers.push(`missing before snapshot tool: ${tool}`);
  }
  for (const tool of artifact.requiredAfterTools.filter((tool) => !tool.includes('export_') && !tool.includes('package_') && !tool.includes('place_asset') && !tool.includes('relink_asset'))) {
    const fileStatCoveredByArtifact = tool === 'desktop.file_stat' && artifact.artifacts.some((item) => Number(item.sizeBytes || 0) > 0);
    if (!afterTools.has(tool) && !fileStatCoveredByArtifact) blockers.push(`missing after snapshot tool: ${tool}`);
  }
  if (requiresApproval(artifact.operations) && artifact.approvals.filter((approval) => approval.approved !== false).length < 1) {
    blockers.push('missing approval evidence for mutating/export/package operation');
  }
  if (requiresApproval(artifact.operations) && !artifact.before.activeDocument) {
    blockers.push('missing before active document identity');
  }
  if (requiresApproval(artifact.operations) && !artifact.after.activeDocument) {
    blockers.push('missing after active document identity');
  }
  if (artifact.operations.includes('update_text_layers') && (artifact.before.textFrames.length < 1 || artifact.after.textFrames.length < 1)) {
    blockers.push('missing before/after text-frame evidence for text update');
  }
  if (artifact.operations.includes('replace_linked_asset')) {
    const assetEntities = artifact.actions.flatMap((action) => action.changedEntities).filter((entity) => entity.kind === 'link' || entity.kind === 'smart_object');
    if (assetEntities.length < 1) blockers.push('missing placed-asset/link action evidence');
  }
  if ((artifact.operations.includes('export_proof') || artifact.operations.includes('export_raster_proof')) && artifact.artifacts.filter((item) => item.kind === 'proof').length < 1) {
    blockers.push('missing proof artifact evidence');
  }
  if (artifact.operations.includes('package_handoff') && artifact.artifacts.filter((item) => item.kind === 'package_folder').length < 1) {
    blockers.push('missing package-folder artifact evidence');
  }
  if (pathLeakInArtifact(artifact)) blockers.push('manifest contains an unredacted local path');
  if (artifact.before.blockers.length > 0) warnings.push(...artifact.before.blockers);
  if (artifact.after.blockers.length > 0) warnings.push(...artifact.after.blockers);
  for (const action of artifact.actions) {
    if (!action.ok) warnings.push(`${action.tool} did not return a clean success result`);
    warnings.push(...action.blockers.map((blocker) => `${action.tool}: ${blocker}`));
  }

  return {
    ok: blockers.length === 0,
    blockers: unique(blockers),
    warnings: unique(warnings),
  };
}

export function buildDesignAppObjectManifestArtifact(
  input: DesignAppObjectManifestArtifactInput,
): DesignAppObjectManifestArtifact | null {
  const plan = buildDesignAppObjectManifestPlan(input.task);
  if (!plan) return null;
  const before = buildSnapshot(plan, 'before', input.beforeCaptures || []);
  const after = buildSnapshot(plan, 'after', input.afterCaptures || []);
  const actions = buildActionEvidence(input.actionCaptures || []);
  const actionArtifacts = actions.flatMap((action) => action.artifacts);
  const artifactWithoutAudit: Omit<DesignAppObjectManifestArtifact, 'audit'> = {
    schemaVersion: 1,
    artifactKind: 'design_object_manifest',
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    task: cleanText(redactLocalPathsInText(input.task), 1_000),
    operations: plan.operations,
    generatedAt: input.generatedAt || new Date(0).toISOString(),
    requiredBeforeTools: plan.beforeSnapshotTools,
    requiredAfterTools: plan.afterSnapshotTools,
    before,
    after,
    actions,
    approvals: (input.approvals || []).slice(0, 20).map((approval) => ({
      id: approval.id ? cleanText(approval.id, 120) : null,
      operation: approval.operation ? cleanText(approval.operation, 120) : null,
      summary: cleanText(approval.summary, 240),
      approved: approval.approved !== false,
      timestamp: approval.timestamp || null,
    })),
    artifacts: [...actionArtifacts, ...(input.artifacts || [])].slice(0, 30),
    comparisons: comparisonEvidence(plan, before, after, actions),
    redactionRules: plan.redactionRules,
    blockers: unique([...(input.blockers || []), ...before.blockers, ...after.blockers]),
  };
  const audit = auditDesignAppObjectManifestArtifact(artifactWithoutAudit);
  return {
    ...artifactWithoutAudit,
    blockers: unique([...artifactWithoutAudit.blockers, ...audit.blockers]),
    audit,
  };
}

export function summarizeDesignAppObjectManifestArtifact(
  artifact: DesignAppObjectManifestArtifact | null | undefined,
): DesignAppObjectManifestArtifactSummary | null {
  if (!artifact) return null;
  const changedEntityKinds = unique(
    artifact.actions.flatMap((action) => action.changedEntities.map((entity) => entity.kind)),
  ).slice(0, 12);
  const artifactKinds = unique(artifact.artifacts.map((item) => item.kind)).slice(0, 12);
  const proofArtifacts = artifact.artifacts
    .filter((item) => item.kind === 'proof')
    .slice(0, 6)
    .map((item) => ({
      label: cleanText(item.label, 120),
      basename: item.path?.basename || null,
      format: item.format || null,
      sizeBytes: item.sizeBytes ?? null,
      widthPx: item.widthPx ?? null,
      heightPx: item.heightPx ?? null,
      pageCount: item.pageCount ?? null,
    }));
  const packageArtifacts = artifact.artifacts
    .filter((item) => item.kind === 'package_folder')
    .slice(0, 4)
    .map((item) => ({
      label: cleanText(item.label, 120),
      basename: item.path?.basename || null,
      sizeBytes: item.sizeBytes ?? null,
    }));
  return {
    schemaVersion: 1,
    artifactKind: 'design_object_manifest',
    appId: artifact.appId,
    appName: artifact.appName,
    taskKind: artifact.taskKind,
    operations: artifact.operations.slice(0, 12),
    generatedAt: artifact.generatedAt,
    auditOk: artifact.audit.ok,
    blockerCount: artifact.audit.blockers.length,
    warningCount: artifact.audit.warnings.length,
    beforeToolCount: artifact.before.tools.length,
    afterToolCount: artifact.after.tools.length,
    actionCount: artifact.actions.length,
    artifactCount: artifact.artifacts.length,
    activeDocumentName: artifact.after.activeDocument?.name || artifact.before.activeDocument?.name || null,
    activeDocumentBasename: artifact.after.activeDocument?.path?.basename || artifact.before.activeDocument?.path?.basename || null,
    changedEntityKinds,
    artifactKinds,
    comparisonStatuses: artifact.comparisons.slice(0, 10).map((item) => ({
      label: cleanText(item.label, 160),
      status: item.status,
    })),
    proofArtifacts,
    packageArtifacts,
    blockers: artifact.audit.blockers.slice(0, 8).map((item) => cleanText(item, 220)),
    warnings: artifact.audit.warnings.slice(0, 8).map((item) => cleanText(item, 220)),
    redaction: 'basename_hash_only',
  };
}

export function buildDesignAppObjectManifestPromptBlock(task: string): string | null {
  const plan = buildDesignAppObjectManifestPlan(task);
  if (!plan) return null;
  const entityLines = plan.entities
    .filter((entity) => {
      if (entity.kind === 'package_folder') return plan.operations.includes('package_handoff');
      if (entity.kind === 'proof') return plan.operations.includes('export_proof') || plan.operations.includes('export_raster_proof');
      if (entity.kind === 'selection_mask') return plan.operations.includes('apply_selection_or_mask') || plan.operations.includes('generative_fill_or_remove');
      if (entity.kind === 'adjustment_layer') return plan.operations.includes('edit_adjustment_layers');
      return true;
    })
    .slice(0, 8)
    .map((entity) => {
      const fields = entity.fields
        .filter((item) => item.required)
        .slice(0, 8)
        .map((item) => `${item.key}(${item.sourceTool})`)
        .join(', ');
      return `- ${entity.kind}: ${entity.when}; fields: ${fields}`;
    });
  return [
    '## Design Object Manifest',
    `Schema: ${plan.manifestArtifactKind} v${plan.schemaVersion}`,
    `App: ${plan.appName} (${plan.appId})`,
    `Operations: ${plan.operations.join(' | ')}`,
    `Before snapshot tools: ${plan.beforeSnapshotTools.join(' | ')}`,
    `After snapshot tools: ${plan.afterSnapshotTools.join(' | ')}`,
    'Required entities:',
    ...entityLines,
    `Comparisons: ${plan.comparisons.join(' | ')}`,
    `Approval evidence: ${plan.approvalEvidence.join(' | ')}`,
    `Redaction rules: ${plan.redactionRules.join(' | ')}`,
    `Fail closed if: ${plan.failClosedConditions.join(' | ')}`,
    `JSON contract: ${plan.jsonContract.join(' | ')}`,
    'When tool results are available, normalize them into this redacted manifest artifact and audit it before claiming completion; audit blockers must return a blocked result with the missing evidence.',
    'Do not claim a Photoshop/InDesign task is complete unless this manifest can be populated or a blocked manifest reason is returned.',
  ].join('\n');
}
