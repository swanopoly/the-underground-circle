import type { RuntimeToolActionForLedger } from './agentRunLedgerPersistence';
import {
  summarizeDesignAppObjectManifestArtifact,
  type DesignAppObjectManifestArtifact,
  type DesignAppObjectManifestArtifactSummary,
} from './designAppObjectManifest';

export interface DesignAppManifestLedgerActionOptions {
  source?: string;
  runId?: string | null;
  messageId?: string | null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function compact(value: unknown, max = 260): string {
  const text = String(value || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function artifactRefBasenames(summary: DesignAppObjectManifestArtifactSummary): string[] {
  return unique([
    ...summary.proofArtifacts.map((artifact) => artifact.basename || ''),
    ...summary.packageArtifacts.map((artifact) => artifact.basename || ''),
  ]).slice(0, 12);
}

function completionPreview(summary: DesignAppObjectManifestArtifactSummary): string {
  const proof = summary.proofArtifacts.length
    ? `${summary.proofArtifacts.length} proof artifact${summary.proofArtifacts.length === 1 ? '' : 's'}`
    : '';
  const packages = summary.packageArtifacts.length
    ? `${summary.packageArtifacts.length} package artifact${summary.packageArtifacts.length === 1 ? '' : 's'}`
    : '';
  const artifacts = [proof, packages].filter(Boolean).join(', ') || `${summary.artifactCount} artifact${summary.artifactCount === 1 ? '' : 's'}`;
  const changed = summary.changedEntityKinds.length
    ? ` Changed entities: ${summary.changedEntityKinds.join(', ')}.`
    : '';
  return compact(`${summary.appName} manifest verified for ${summary.activeDocumentBasename || summary.activeDocumentName || 'active document'}: ${summary.actionCount} action receipt${summary.actionCount === 1 ? '' : 's'}, ${artifacts}.${changed}`, 700);
}

function blockedPreview(summary: DesignAppObjectManifestArtifactSummary): string {
  const blockers = summary.blockers.length
    ? summary.blockers.join('; ')
    : 'missing required design manifest evidence';
  return compact(`${summary.appName} manifest blocked for ${summary.activeDocumentBasename || summary.activeDocumentName || 'active document'}: ${blockers}`, 700);
}

export function buildDesignAppManifestLedgerAction(
  manifest: DesignAppObjectManifestArtifact | DesignAppObjectManifestArtifactSummary | null | undefined,
  options: DesignAppManifestLedgerActionOptions = {},
): RuntimeToolActionForLedger | null {
  const summary = manifest && 'audit' in manifest
    ? summarizeDesignAppObjectManifestArtifact(manifest)
    : manifest || null;
  if (!summary) return null;

  const artifactRefs = artifactRefBasenames(summary);
  return {
    tool_name: 'design.object_manifest',
    title: `${summary.appName} object manifest`,
    status: summary.auditOk ? 'completed' : 'blocked',
    input_preview: compact(`${summary.appName} ${summary.taskKind}: ${summary.operations.join(', ')}`, 500),
    output_preview: summary.auditOk ? completionPreview(summary) : blockedPreview(summary),
    artifact_refs: artifactRefs,
    metadata: {
      source: options.source || 'design_object_manifest',
      runId: options.runId || null,
      messageId: options.messageId || null,
      ledgerArtifactKind: 'design_object_manifest',
      auditOk: summary.auditOk,
      blockerCount: summary.blockerCount,
      warningCount: summary.warningCount,
      appId: summary.appId,
      appName: summary.appName,
      taskKind: summary.taskKind,
      operations: summary.operations,
      activeDocumentName: summary.activeDocumentName,
      activeDocumentBasename: summary.activeDocumentBasename,
      changedEntityKinds: summary.changedEntityKinds,
      artifactKinds: summary.artifactKinds,
      artifactRefs,
      proofArtifacts: summary.proofArtifacts,
      packageArtifacts: summary.packageArtifacts,
      comparisonStatuses: summary.comparisonStatuses,
      beforeToolCount: summary.beforeToolCount,
      afterToolCount: summary.afterToolCount,
      actionCount: summary.actionCount,
      artifactCount: summary.artifactCount,
      blockers: summary.blockers,
      warnings: summary.warnings,
      redaction: summary.redaction,
    },
  };
}
