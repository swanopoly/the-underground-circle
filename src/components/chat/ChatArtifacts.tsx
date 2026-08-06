import React, { useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getOpenSwanExecutionStatusLabel } from '../../lib/openswanExecution';
import { buildOpenSwanExecutionStream } from '../../lib/openswanExecution';
import type { SwanBotStructuredArtifact } from '../../lib/swanbot';
// LOCKSTEP(src/lib/tableArtifact.ts): kind:'table' artifacts carry raw CSV in
// `content`; parse/serialize rules live in tableArtifact.ts (swanbot upgrades
// csv code fences to this kind).
import { parseCsvText, tableToCsv, type ParsedTable } from '../../lib/tableArtifact';
import { resolveSessionCodingProfile, type SessionCodingProfile } from '../../lib/chatSessionProfile';
import { buildOpenSwanTaskPlan } from '../../lib/openswanTaskPlanner';
import { executeOpenSwanTool, type OpenSwanToolEvent } from '../../lib/openswanToolRuntime';
import { executeOpenSwanVerificationPlan, type OpenSwanVerificationResult } from '../../lib/openswanVerificationRuntime';
import { appendRunToolEvent, mergeRunMetadata } from '../../lib/agentRunSystem';
import VerificationResultCard from './VerificationResultCard';

type ChatArtifactsProps = {
  artifacts?: SwanBotStructuredArtifact[];
  accentColor: string;
  circleId?: string;
  sessionProfile?: SessionCodingProfile;
  runId?: string | null;
  onRunLedgerUpdate?: (update: { verificationResults?: OpenSwanVerificationResult[]; toolEvents?: OpenSwanToolEvent[] }) => void;
  roomContext?: {
    roomId: string;
    onArtifactApplied?: (fileId: string | null) => void;
  };
};

const SANDBOXED_PREVIEW_PERMISSIONS = 'allow-scripts';

function summarizeVerificationResults(results: OpenSwanVerificationResult[]): string {
  return results
    .map((result) => `${getOpenSwanExecutionStatusLabel(result.status)} ${result.check.label}: ${result.summary}`)
    .join('\n');
}

type ArtifactTarget =
  | {
      mode: 'workspace';
      roomId: string;
      label: string;
      primaryFileId: string | null;
    }
  | {
      mode: 'room';
      roomId: string;
      label: string;
      primaryFileId: string | null;
    };

function getArtifactKey(artifact: SwanBotStructuredArtifact, index: number): string {
  return `${artifact.kind}:${artifact.title}:${index}`;
}

function canCreateWorkspace(artifact: SwanBotStructuredArtifact): boolean {
  return Boolean(artifact.content?.trim());
}

function inferArtifactFileName(artifact: SwanBotStructuredArtifact): string {
  const metaName = typeof artifact.metadata?.fileName === 'string' ? artifact.metadata.fileName : '';
  if (metaName.trim()) return metaName.trim();
  const title = (artifact.title || 'generated-file').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'generated-file';
  const language = String(artifact.metadata?.language || '').toLowerCase();
  if (artifact.kind === 'webpage') return 'index.html';
  if (artifact.kind === 'table' || language === 'csv') return `${title}.csv`;
  if (language.includes('tsx') || language.includes('react')) return `${title}.tsx`;
  if (language.includes('typescript') || language === 'ts') return `${title}.ts`;
  if (language.includes('javascript') || language === 'js') return `${title}.js`;
  if (language.includes('css')) return `${title}.css`;
  if (language.includes('json')) return `${title}.json`;
  if (language.includes('sql')) return `${title}.sql`;
  return `${title}.txt`;
}

function renderCodeLines(content: string) {
  return content.slice(0, 2000).split('\n').map((line, index) => (
    <View key={`${index}-${line}`} style={styles.codeRow}>
      <Text style={styles.codeLineNo}>{String(index + 1).padStart(2, '0')}</Text>
      <Text style={styles.codeLine}>{line || ' '}</Text>
    </View>
  ));
}

// Same download mechanism as the webpage "Download HTML" action: Blob →
// object URL → anchor click. Web-only (guarded at every call site).
function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function tableDownloadFileName(artifact: SwanBotStructuredArtifact): string {
  const base = (artifact.title || '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[-.]+|[-.]+$/g, '');
  return `${base || 'table'}.csv`;
}

function describeTableDimensions(table: ParsedTable): string {
  const sourceRows = table.sourceRowCount ?? table.rows.length;
  const sourceCols = table.sourceColCount ?? table.headers.length;
  const truncated = sourceRows > table.rows.length || sourceCols > table.headers.length;
  const base = `${sourceRows} row${sourceRows === 1 ? '' : 's'} × ${sourceCols} col${sourceCols === 1 ? '' : 's'}`;
  return truncated ? `${base} — showing first ${table.rows.length}×${table.headers.length}` : base;
}

/**
 * kind:'table' body — real grid (styled header, zebra rows, horizontal
 * scroll, pinned header with vertical scroll for long tables) plus a
 * row/col caption and a "Download CSV" action. Unparseable content never
 * renders blank: it falls back to the code-style frame with the raw text.
 */
function TableArtifactBody({
  artifact,
  accentColor,
  workspaceActionLabel,
  showWorkspaceAction,
  onWorkspaceAction,
}: {
  artifact: SwanBotStructuredArtifact;
  accentColor: string;
  workspaceActionLabel: string;
  showWorkspaceAction: boolean;
  onWorkspaceAction: () => void;
}) {
  const content = artifact.content || '';
  const table = useMemo(() => parseCsvText(content), [content]);

  const handleDownloadCsv = () => {
    // Round-trip through the parser for clean quoting; fall back to the raw
    // content when it never parsed.
    downloadTextFile(tableDownloadFileName(artifact), 'text/csv', table ? tableToCsv(table) : content);
  };

  const actions = (
    <View style={styles.webActions}>
      {Platform.OS === 'web' ? (
        <Pressable onPress={handleDownloadCsv} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Download CSV</Text>
        </Pressable>
      ) : null}
      {showWorkspaceAction ? (
        <Pressable onPress={onWorkspaceAction} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>{workspaceActionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!table) {
    // CSV that fails to parse still shows as text — never a blank card.
    return (
      <View>
        <View style={styles.codeFrame}>
          <View style={styles.codeFrameHeader}>
            <View style={styles.codeFrameDots}>
              <View style={[styles.codeFrameDot, { backgroundColor: '#ef4444' }]} />
              <View style={[styles.codeFrameDot, { backgroundColor: '#f59e0b' }]} />
              <View style={[styles.codeFrameDot, { backgroundColor: '#22c55e' }]} />
            </View>
            <Text style={styles.codeFrameFile}>{inferArtifactFileName(artifact)}</Text>
            <Text style={[styles.codeFrameLang, { color: accentColor }]}>CSV</Text>
          </View>
          <ScrollView horizontal style={styles.codeScroll} contentContainerStyle={styles.codeScrollContent}>
            <View style={styles.codeBlock}>
              {renderCodeLines(content)}
            </View>
          </ScrollView>
        </View>
        {actions}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.tableFrame}>
        <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={styles.tableScrollContent}>
          <View>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              {table.headers.map((header, colIndex) => (
                <Text
                  key={`h-${colIndex}`}
                  style={[styles.tableCell, styles.tableHeaderCell, { color: accentColor }]}
                  numberOfLines={1}
                >
                  {header || ' '}
                </Text>
              ))}
            </View>
            <ScrollView style={styles.tableBodyScroll} nestedScrollEnabled>
              {table.rows.map((row, rowIndex) => (
                <View
                  key={`r-${rowIndex}`}
                  style={[styles.tableRow, rowIndex % 2 === 1 && styles.tableRowZebra]}
                >
                  {row.map((cell, colIndex) => (
                    <Text key={`c-${rowIndex}-${colIndex}`} style={styles.tableCell} numberOfLines={1}>
                      {cell || ' '}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
      <Text style={styles.tableCaption}>{describeTableDimensions(table)}</Text>
      {actions}
    </View>
  );
}

export default function ChatArtifacts({ artifacts, accentColor, circleId, sessionProfile = 'senior', runId, onRunLedgerUpdate, roomContext }: ChatArtifactsProps) {
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);
  const [createdTargets, setCreatedTargets] = useState<Record<string, ArtifactTarget>>({});
  const [verificationByKey, setVerificationByKey] = useState<Record<string, OpenSwanVerificationResult[]>>({});
  const [toolEventsByKey, setToolEventsByKey] = useState<Record<string, OpenSwanToolEvent[]>>({});

  const artifactEntries = useMemo(
    () => (artifacts ?? []).map((artifact, index) => ({
      artifact,
      key: getArtifactKey(artifact, index),
    })),
    [artifacts],
  );

  if (!artifacts || artifacts.length === 0) return null;

  return (
    <View style={styles.stack}>
      {artifactEntries.map(({ artifact, key }) => {
        const isCreating = creatingKey === key;
        const isVerifying = verifyingKey === key;
        const createdTarget = createdTargets[key];
        const verificationResults = verificationByKey[key] || [];
        const toolEvents = toolEventsByKey[key] || [];
        const canVerify = artifact.kind === 'code' || artifact.kind === 'webpage';

        const handleCreateWorkspace = async () => {
          if (!canCreateWorkspace(artifact) || isCreating) return;
          setCreatingKey(key);
          try {
            if (roomContext) {
              const result = await executeOpenSwanTool('workspace.apply_artifacts', {
                roomId: roomContext.roomId,
                artifact,
              });
              setCreatedTargets(prev => ({
                ...prev,
                [key]: {
                  mode: 'room',
                  roomId: result.roomId,
                  label: result.primaryFileName || `${result.fileCount} file${result.fileCount === 1 ? '' : 's'}`,
                  primaryFileId: result.primaryFileId,
                },
              }));
              await executeOpenSwanTool('workspace.open_preview', {
                roomId: result.roomId,
                primaryFileId: result.primaryFileId,
                preferredPanel: 'playground',
              });
              roomContext.onArtifactApplied?.(result.primaryFileId);
              return;
            }

            if (!circleId) return;
            const result = await executeOpenSwanTool('workspace.create_room', {
              circleId,
              artifact,
            });
            if (!result.roomId) return;
            const createdRoomId = result.roomId;
            setCreatedTargets(prev => ({
              ...prev,
              [key]: {
                mode: 'workspace',
                roomId: createdRoomId,
                label: result.roomName,
                primaryFileId: result.primaryFileId,
                },
              }));
            await executeOpenSwanTool('workspace.open_preview', {
              circleId,
              roomId: createdRoomId,
              primaryFileId: result.primaryFileId,
              preferredPanel: 'playground',
            });
          } finally {
            setCreatingKey(current => (current === key ? null : current));
          }
        };

        const handleOpenWorkspace = () => {
          if (!createdTarget) return;
          if (createdTarget.mode === 'room') {
            void executeOpenSwanTool('workspace.open_preview', {
              roomId: createdTarget.roomId,
              primaryFileId: createdTarget.primaryFileId,
              preferredPanel: 'playground',
            });
            roomContext?.onArtifactApplied?.(createdTarget.primaryFileId);
            return;
          }
          if (!circleId) return;
          void executeOpenSwanTool('workspace.open_preview', {
            circleId,
            roomId: createdTarget.roomId,
            primaryFileId: createdTarget.primaryFileId,
            preferredPanel: 'playground',
          });
        };

        const handleRunVerification = async () => {
          if (!canVerify || isVerifying) return;
          setVerifyingKey(key);
          let nextToolEvents: OpenSwanToolEvent[] = [];
          try {
            const artifactPrompt = `${artifact.title || 'Generated artifact'}\n\n${artifact.content || ''}`.slice(0, 4000);
            const plan = buildOpenSwanTaskPlan(
              artifactPrompt,
              resolveSessionCodingProfile(sessionProfile, artifactPrompt, 'main_chat'),
            );
            const results = await executeOpenSwanVerificationPlan(plan, {
              onToolEvent: (event) => {
                setToolEventsByKey((prev) => {
                  nextToolEvents = [...(prev[key] || []), event];
                  onRunLedgerUpdate?.({ toolEvents: nextToolEvents });
                  return { ...prev, [key]: nextToolEvents };
                });
                if (runId && circleId) {
                  const nextExecutionStream = buildOpenSwanExecutionStream({
                    toolEvents: nextToolEvents,
                    verificationResults: verificationByKey[key] || [],
                  });
                  void appendRunToolEvent({
                    runId,
                    circleId,
                    event,
                  });
                  void mergeRunMetadata(runId, { tool_events: nextToolEvents, execution_stream: nextExecutionStream });
                }
              },
            });
            setVerificationByKey((prev) => ({ ...prev, [key]: results }));
            onRunLedgerUpdate?.({ verificationResults: results, toolEvents: nextToolEvents });
            if (runId) {
              const nextExecutionStream = buildOpenSwanExecutionStream({
                toolEvents: nextToolEvents,
                verificationResults: results,
              });
              void mergeRunMetadata(runId, {
                verification_results: results,
                tool_events: nextToolEvents,
                execution_stream: nextExecutionStream,
                verification_summary: summarizeVerificationResults(results),
              });
            }
          } finally {
            setVerifyingKey((current) => (current === key ? null : current));
          }
        };

        const actionLabel = isCreating
          ? roomContext ? 'Adding Files...' : 'Building Sandbox...'
          : createdTarget
            ? (createdTarget.mode === 'room' ? 'Open In Room' : 'Open Sandbox Room')
            : (roomContext ? 'Add Files To Room' : 'Create Sandbox Room');

        return (
        <View key={key} style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.kindChip, { borderColor: `${accentColor}40`, backgroundColor: `${accentColor}12` }]}>
              <Text style={[styles.kindChipText, { color: accentColor }]}>
                {artifact.kind === 'image' ? 'IMG' : artifact.kind === 'webpage' ? 'WEB' : artifact.kind === 'code' ? '</>' : artifact.kind === 'table' ? 'TBL' : artifact.kind === 'audio' ? 'AUD' : 'TXT'}
              </Text>
            </View>
            <Text style={[styles.title, { color: accentColor, flex: 1 }]} numberOfLines={1}>
              {artifact.title}
            </Text>
            {(artifact.metadata as any)?.model && (
              <Text style={styles.meta}>{String((artifact.metadata as any).model)}</Text>
            )}
          </View>

          {artifact.kind === 'image' && artifact.url ? (
            <View>
              <Image source={{ uri: artifact.url }} style={styles.image} resizeMode="contain" />
              {Platform.OS === 'web' && artifact.url.startsWith('data:') ? (
                <Pressable
                  onPress={() => {
                    // Build the node with DOM APIs, never by interpolating the
                    // URL into an HTML string. The old
                    // `document.write(\`<img src="${'${url}'}">\`)` let a crafted
                    // data: URL close the src attribute and add its own
                    // onerror handler — and because about:blank inherits the
                    // OPENER's origin, that handler ran on the app origin with
                    // access to localStorage (Supabase access + refresh token).
                    // Artifacts persist in message metadata and render for
                    // every circle member, so this was cross-user reachable.
                    // A property assignment is not parsed, so there is nothing
                    // to break out of.
                    const w = window.open('');
                    if (w) {
                      w.document.title = artifact.title;
                      w.document.body.style.margin = '0';
                      const img = w.document.createElement('img');
                      img.src = artifact.url!;
                      img.style.maxWidth = '100%';
                      img.style.background = '#000';
                      w.document.body.appendChild(img);
                    }
                  }}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonText}>Open Full Size</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {artifact.kind === 'webpage' && artifact.content && Platform.OS === 'web' ? (
            <View>
              <View style={styles.webPreview}>
                <iframe
                  srcDoc={artifact.content}
                  style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#0a0a10' } as any}
                  sandbox={SANDBOXED_PREVIEW_PERMISSIONS}
                  title={artifact.title}
                />
              </View>
              <View style={styles.webActions}>
                <Pressable
                  onPress={() => {
                    // The inline preview above is correctly sandboxed, but this
                    // button used to `document.write` the SAME untrusted HTML
                    // into a fresh about:blank — which inherits the opener's
                    // origin, so the sandbox was bypassed entirely and the
                    // content ran as the app (localStorage holds the Supabase
                    // access AND refresh token). Artifacts render for every
                    // circle member, so any member could take over another's
                    // account with one artifact.
                    //
                    // Now the new tab holds only OUR shell; the untrusted HTML
                    // goes into a sandboxed iframe (no allow-same-origin ⇒
                    // opaque origin) via the srcdoc PROPERTY, so it is never
                    // parsed as part of a string we built.
                    const w = window.open('');
                    if (w) {
                      w.document.title = artifact.title;
                      w.document.body.style.margin = '0';
                      const frame = w.document.createElement('iframe');
                      frame.setAttribute('sandbox', SANDBOXED_PREVIEW_PERMISSIONS);
                      frame.style.width = '100vw';
                      frame.style.height = '100vh';
                      frame.style.border = 'none';
                      frame.style.background = '#0a0a10';
                      frame.srcdoc = artifact.content!;
                      w.document.body.appendChild(frame);
                    }
                  }}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonText}>Open in New Tab</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const blob = new Blob([artifact.content!], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.html`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={styles.actionButton}
                >
                  <Text style={styles.actionButtonText}>Download HTML</Text>
                </Pressable>
                {canCreateWorkspace(artifact) ? (
                  <Pressable
                    onPress={createdTarget ? handleOpenWorkspace : handleCreateWorkspace}
                    style={[styles.actionButton, createdTarget && styles.primaryActionButton]}
                  >
                    <Text style={[styles.actionButtonText, createdTarget && styles.primaryActionButtonText]}>
                      {actionLabel}
                    </Text>
                  </Pressable>
                ) : null}
                {canVerify ? (
                  <Pressable
                    onPress={handleRunVerification}
                    style={[styles.actionButton, verificationResults.length > 0 && styles.primaryActionButton]}
                  >
                    <Text style={[styles.actionButtonText, verificationResults.length > 0 && styles.primaryActionButtonText]}>
                      {isVerifying ? 'Running Checks...' : verificationResults.length > 0 ? 'Re-Run Verification' : 'Run Verification'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (artifact.kind === 'webpage' || artifact.kind === 'code') && artifact.content ? (
            <View>
              <View style={styles.codeFrame}>
                <View style={styles.codeFrameHeader}>
                  <View style={styles.codeFrameDots}>
                    <View style={[styles.codeFrameDot, { backgroundColor: '#ef4444' }]} />
                    <View style={[styles.codeFrameDot, { backgroundColor: '#f59e0b' }]} />
                    <View style={[styles.codeFrameDot, { backgroundColor: '#22c55e' }]} />
                  </View>
                  <Text style={styles.codeFrameFile}>{inferArtifactFileName(artifact)}</Text>
                  <Text style={[styles.codeFrameLang, { color: accentColor }]}>
                    {String(artifact.metadata?.language || (artifact.kind === 'webpage' ? 'html' : 'code')).toUpperCase()}
                  </Text>
                </View>
                <ScrollView horizontal style={styles.codeScroll} contentContainerStyle={styles.codeScrollContent}>
                  <View style={styles.codeBlock}>
                    {renderCodeLines(artifact.content)}
                  </View>
                </ScrollView>
              </View>
              <View style={styles.webActions}>
                <Pressable
                  onPress={createdTarget ? handleOpenWorkspace : handleCreateWorkspace}
                  style={[styles.actionButton, createdTarget && styles.primaryActionButton]}
                >
                  <Text style={[styles.actionButtonText, createdTarget && styles.primaryActionButtonText]}>
                    {actionLabel}
                  </Text>
                </Pressable>
                {canVerify ? (
                  <Pressable
                    onPress={handleRunVerification}
                    style={[styles.actionButton, verificationResults.length > 0 && styles.primaryActionButton]}
                  >
                    <Text style={[styles.actionButtonText, verificationResults.length > 0 && styles.primaryActionButtonText]}>
                      {isVerifying ? 'Running Checks...' : verificationResults.length > 0 ? 'Re-Run Verification' : 'Run Verification'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {artifact.kind === 'table' && artifact.content ? (
            <TableArtifactBody
              artifact={artifact}
              accentColor={accentColor}
              workspaceActionLabel={actionLabel}
              showWorkspaceAction={canCreateWorkspace(artifact) && (Boolean(roomContext) || Boolean(circleId))}
              onWorkspaceAction={createdTarget ? handleOpenWorkspace : handleCreateWorkspace}
            />
          ) : null}

          {artifact.kind !== 'image' && artifact.kind !== 'code' && artifact.kind !== 'webpage' && artifact.kind !== 'table' && artifact.content ? (
            <View>
              <Text style={styles.textContent}>{artifact.content}</Text>
              {canCreateWorkspace(artifact) ? (
                <View style={styles.webActions}>
                  <Pressable
                    onPress={createdTarget ? handleOpenWorkspace : handleCreateWorkspace}
                    style={[styles.actionButton, createdTarget && styles.primaryActionButton]}
                  >
                    <Text style={[styles.actionButtonText, createdTarget && styles.primaryActionButtonText]}>
                      {actionLabel}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {artifact.kind === 'audio' && artifact.url ? (
            <Text style={styles.audioMeta}>Audio artifact generated.</Text>
          ) : null}

          {createdTarget ? (
            <Text style={styles.workspaceNote}>
              {createdTarget.mode === 'room'
                ? `Files added to this room: ${createdTarget.label}`
                : `Sandbox ready in room: ${createdTarget.label}`}
            </Text>
          ) : null}
          {verificationResults.length > 0 ? (
            <VerificationResultCard results={verificationResults} accentColor={accentColor} />
          ) : null}
        </View>
      )})}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    marginTop: 10,
    gap: 8,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24243a',
    backgroundColor: '#0b0b12',
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  kindChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  kindChipText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    color: '#3a3a4e',
    fontSize: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    backgroundColor: '#05050a',
  },
  actionButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a28',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  actionButtonText: {
    color: '#a0a0b0',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  primaryActionButton: {
    backgroundColor: '#171f14',
    borderColor: '#2e4a28',
  },
  primaryActionButtonText: {
    color: '#b8ff61',
  },
  webPreview: {
    height: 300,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  webActions: {
    flexDirection: 'row',
    gap: 6,
  },
  codeScroll: {
    maxHeight: 260,
  },
  codeScrollContent: {
    minWidth: '100%',
  },
  tableFrame: {
    borderWidth: 1,
    borderColor: '#22304a',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#08101a',
  },
  tableScroll: {
    maxHeight: 300,
  },
  tableScrollContent: {
    minWidth: '100%',
  },
  tableBodyScroll: {
    maxHeight: 252,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#22304a',
    backgroundColor: '#0d1624',
  },
  tableRowZebra: {
    backgroundColor: '#0d0d16',
  },
  tableCell: {
    width: 120,
    paddingHorizontal: 8,
    paddingVertical: 5,
    color: '#d6d6e4',
    fontSize: 11,
    lineHeight: 16,
  },
  tableHeaderCell: {
    fontWeight: '800',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tableCaption: {
    color: '#8d8da3',
    fontSize: 9,
    marginTop: 4,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeFrame: {
    borderWidth: 1,
    borderColor: '#22304a',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#08101a',
  },
  codeFrameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#182131',
    backgroundColor: '#0d1624',
  },
  codeFrameDots: { flexDirection: 'row', gap: 5 },
  codeFrameDot: { width: 8, height: 8, borderRadius: 4 },
  codeFrameFile: {
    flex: 1,
    color: '#dbe4f0',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeFrameLang: {
    fontSize: 9,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeBlock: {
    minWidth: '100%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 3,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeLineNo: {
    width: 24,
    color: '#415169',
    fontSize: 10,
    textAlign: 'right',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  codeLine: {
    color: '#d6d6e4',
    fontSize: 11,
    lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  textContent: {
    color: '#c9c9d6',
    fontSize: 12,
    lineHeight: 18,
  },
  audioMeta: {
    color: '#8d8da3',
    fontSize: 10,
    marginTop: 2,
  },
  workspaceNote: {
    color: '#7fb85c',
    fontSize: 10,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
