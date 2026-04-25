/**
 * ComputerRunDetailModal — full-screen detail view for a past Computer
 * Use run. Classic Mac Platinum look — sits on a dimmed backdrop with
 * a MacWindow frame, pinstriped title bar, close box, beveled metrics
 * tiles, and MacButton footer actions.
 *
 * Shows: task, status, timing (created → completed + duration),
 * iteration count, cost + token breakdown, summary, findings grid
 * (tappable — opens URL or copies), error message, live-session link,
 * final-screenshot thumbnail. Footer: Re-run / Copy Summary / Copy MD
 * / Open Live.
 */

import React, { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getComputerUseRun, type ComputerUseRunRow } from '../lib/computerUseHistory';
import { formatBudgetUsd } from '../lib/circleCostTelemetry';
import ScreenshotZoomModal from './computer-use/ScreenshotZoomModal';
import HybridFocusChain from './computer-use/HybridFocusChain';
import MacWindow from './classic-mac/MacWindow';
import MacButton from './classic-mac/MacButton';
import { MAC } from './classic-mac/theme';

interface Props {
  runId: string | null;
  onClose: () => void;
  onRerun?: (task: string) => void;
  accentColor?: string; // unused — Mac palette enforced
}

function statusColor(status: ComputerUseRunRow['status']): string {
  switch (status) {
    case 'done':      return MAC.success;
    case 'error':     return MAC.danger;
    case 'cancelled': return MAC.soft;
    case 'running':
    default:          return MAC.accent;
  }
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '—';
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString();
}

function copyToClipboard(text: string): void {
  if (Platform.OS !== 'web') return;
  try {
    if ((globalThis as any).navigator?.clipboard?.writeText) {
      (globalThis as any).navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch { /* best-effort */ }
}

/** Serialize a ComputerUseRunRow into a self-contained markdown blob. */
function renderRunAsMarkdown(row: ComputerUseRunRow): string {
  const parts: string[] = [];
  parts.push(`# Computer Use Run`);
  parts.push('');
  parts.push(`**Task:** ${row.task || '(no task)'}`);
  parts.push(`**Status:** ${row.status}`);
  parts.push(`**Started:** ${formatDate(row.created_at)}`);
  if (row.completed_at) {
    parts.push(`**Completed:** ${formatDate(row.completed_at)}`);
    parts.push(`**Duration:** ${formatDuration(row.created_at, row.completed_at)}`);
  }
  if (row.iterations > 0) parts.push(`**Steps:** ${row.iterations}`);
  if (row.estimated_cost) parts.push(`**Cost:** $${Number(row.estimated_cost).toFixed(4)}`);
  if (row.input_tokens || row.output_tokens) {
    parts.push(`**Tokens:** ${(row.input_tokens || 0).toLocaleString()} in · ${(row.output_tokens || 0).toLocaleString()} out`);
  }
  if (row.summary) {
    parts.push('', '## Summary', '', row.summary);
  }
  if (Array.isArray(row.findings) && row.findings.length > 0) {
    parts.push('', `## Findings (${row.findings.length})`, '');
    row.findings.forEach((f, i) => {
      const headerBits = [`**${f.title || '(untitled)'}**`];
      if (f.price) headerBits.push(f.price);
      if (f.rating) headerBits.push(f.rating);
      parts.push(`${i + 1}. ${headerBits.join(' — ')}`);
      if (f.notes) parts.push(`   ${f.notes}`);
      if (f.url) parts.push(`   ${f.url}`);
    });
  }
  if (row.error_message) {
    parts.push('', '## Error', '', '```', row.error_message, '```');
  }
  if (row.session_id || row.live_url) {
    parts.push('', '## Session', '');
    if (row.session_id) parts.push(`- Session ID: \`${row.session_id}\``);
    if (row.live_url) parts.push(`- Live URL: ${row.live_url}`);
  }
  return parts.join('\n');
}

export default function ComputerRunDetailModal({ runId, onClose, onRerun }: Props) {
  const [row, setRow] = useState<ComputerUseRunRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState<'md' | 'summary' | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (!copiedFlash) return;
    const id = setTimeout(() => setCopiedFlash(null), 1500);
    return () => clearTimeout(id);
  }, [copiedFlash]);

  useEffect(() => {
    if (!runId) { setRow(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const r = await getComputerUseRun(runId);
      if (!cancelled) {
        setRow(r);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  async function handleResume() {
    if (!runId || !row || resuming) return;
    setResuming(true);
    try {
      const { resumeHybridTask, synthesizeHybridSummary } = await import('../lib/computerHybridRuntime');
      const { awaitStepApproval } = await import('../lib/computerTaskSteps');
      const { supabase } = await import('../lib/supabase');

      const result = await resumeHybridTask({
        runId,
        circleId: row.circle_id,
        onApprovalRequired: async (step) =>
          awaitStepApproval({ stepId: step.id, runId }),
      });

      const summary = await synthesizeHybridSummary({
        task: row.task,
        stepRecords: result.stepRecords,
      });

      const finalStatus = result.warnings.some((w) => w.includes('dispatch failed'))
        ? 'error'
        : 'done';

      await supabase
        .from('computer_use_runs')
        .update({
          status: finalStatus,
          summary,
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId);

      // Refresh the local row so the UI reflects the updated status.
      const { getComputerUseRun } = await import('../lib/computerUseHistory');
      const fresh = await getComputerUseRun(runId);
      if (fresh) setRow(fresh);
    } catch (err: any) {
      console.warn('[ComputerRunDetailModal] resume failed', err?.message);
    } finally {
      setResuming(false);
    }
  }

  const isVisible = !!runId;
  const tone = row ? statusColor(row.status) : MAC.accent;

  const accessory = row ? (
    <View style={[s.statusPill, { backgroundColor: tone }]}>
      <Text style={s.statusPillText}>{row.status.toUpperCase()}</Text>
    </View>
  ) : null;

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={s.windowShell}>
          <MacWindow
            title="Run Details"
            onClose={onClose}
            accessory={accessory}
            padding={0}
            draggable
          >
            {loading && !row ? (
              <View style={s.loadingBox}>
                <Text style={s.loadingText}>Loading…</Text>
              </View>
            ) : !row ? (
              <View style={s.loadingBox}>
                <Text style={s.loadingText}>Run not found.</Text>
              </View>
            ) : (
              <ScrollView
                style={s.body}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              >
                {row.status === 'running' ? (
                  <View style={[s.liveBanner, { borderColor: tone, backgroundColor: MAC.cardBgAlt }]}>
                    <View style={[s.liveDot, { backgroundColor: tone }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.liveLabel, { color: tone }]}>RUN IN PROGRESS</Text>
                      <Text style={s.liveHint}>
                        Live reasoning + screenshots stream in the floating card. Summary and findings fill in here when it completes.
                      </Text>
                    </View>
                  </View>
                ) : null}

                <View style={s.section}>
                  <Text style={s.sectionLabel}>TASK</Text>
                  <Text style={s.taskText}>{row.task || '(no task text)'}</Text>
                </View>

                <View style={s.metricsGrid}>
                  <MetricTile label="STARTED" value={formatDate(row.created_at)} />
                  <MetricTile label="COMPLETED" value={formatDate(row.completed_at)} />
                  <MetricTile label="DURATION" value={formatDuration(row.created_at, row.completed_at)} />
                  <MetricTile label="STEPS" value={String(row.iterations || 0)} />
                  <MetricTile label="COST" value={formatBudgetUsd(Number(row.estimated_cost || 0))} mono />
                  <MetricTile
                    label="TOKENS"
                    value={`${(row.input_tokens || 0).toLocaleString()} in · ${(row.output_tokens || 0).toLocaleString()} out`}
                    mono
                  />
                </View>

                {row.summary ? (
                  <View style={s.section}>
                    <Text style={s.sectionLabel}>SUMMARY</Text>
                    <View style={s.summaryBox}>
                      <Text style={s.summaryText}>{row.summary}</Text>
                    </View>
                  </View>
                ) : null}

                {row.error_message ? (
                  <View style={s.section}>
                    <Text style={[s.sectionLabel, { color: MAC.danger }]}>ERROR</Text>
                    <View style={s.errorBox}>
                      <Text style={s.errorText}>{row.error_message}</Text>
                    </View>
                  </View>
                ) : null}

                {Array.isArray(row.findings) && row.findings.length > 0 ? (
                  <View style={s.section}>
                    <Text style={s.sectionLabel}>FINDINGS · {row.findings.length}</Text>
                    <View style={{ gap: 8 }}>
                      {row.findings.map((f, i) => (
                        <Pressable
                          key={`${f.title}-${i}`}
                          style={s.findingCard}
                          onPress={() => {
                            if (f.url) Linking.openURL(f.url).catch(() => {});
                            else copyToClipboard(f.title || '');
                          }}
                          accessibilityRole="button"
                        >
                          <View style={s.findingHead}>
                            <Text style={s.findingIndex}>{i + 1}</Text>
                            <Text style={s.findingTitle} numberOfLines={2}>{f.title || '(untitled)'}</Text>
                            {f.price ? (
                              <Text style={s.findingPrice}>{f.price}</Text>
                            ) : null}
                          </View>
                          {f.notes ? (
                            <Text style={s.findingNotes} numberOfLines={3}>{f.notes}</Text>
                          ) : null}
                          <View style={s.findingFoot}>
                            {f.rating ? <Text style={s.findingMeta}>{f.rating}</Text> : null}
                            {f.url ? (
                              <Text style={[s.findingMeta, { color: MAC.info }]} numberOfLines={1}>{f.url}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* ── HybridFocusChain — step timeline if this is a hybrid run ────── */}
                <HybridFocusChain runId={runId} variant="panel" />

                {row.final_screenshot_url ? (
                  <View style={s.section}>
                    <Text style={s.sectionLabel}>FINAL SCREENSHOT · TAP TO ZOOM</Text>
                    <Pressable
                      style={s.screenshotBox}
                      onPress={() => setZoomSrc(row.final_screenshot_url!)}
                      accessibilityRole="button"
                    >
                      <Image
                        source={{ uri: row.final_screenshot_url }}
                        style={s.screenshotImg}
                        resizeMode="contain"
                      />
                    </Pressable>
                  </View>
                ) : null}

                {row.session_id || row.live_url ? (
                  <View style={s.section}>
                    <Text style={s.sectionLabel}>SESSION</Text>
                    {row.session_id ? (
                      <View style={s.linkRow}>
                        <Text style={s.linkLabel}>ID</Text>
                        <Text style={s.linkValue} selectable numberOfLines={1}>{row.session_id}</Text>
                      </View>
                    ) : null}
                    {row.live_url ? (
                      <Pressable
                        style={s.linkRow}
                        onPress={() => Linking.openURL(row.live_url!).catch(() => {})}
                        accessibilityRole="button"
                      >
                        <Text style={s.linkLabel}>LIVE</Text>
                        <Text style={[s.linkValue, { color: MAC.info }]} numberOfLines={1}>{row.live_url}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>
            )}

            {row ? (
              <View style={s.footer}>
                {onRerun && row.status !== 'running' ? (
                  <MacButton
                    label="RE-RUN"
                    primary
                    onPress={() => {
                      onRerun(row.task);
                      onClose();
                    }}
                  />
                ) : null}
                {(row.status === 'running' || row.status === 'error') ? (
                  <MacButton
                    label={resuming ? 'RESUMING...' : 'RESUME'}
                    primary={row.status === 'running'}
                    onPress={handleResume}
                    disabled={resuming}
                  />
                ) : null}
                {row.summary ? (
                  <MacButton
                    label={copiedFlash === 'summary' ? 'COPIED ✓' : 'COPY SUMMARY'}
                    onPress={() => {
                      copyToClipboard(row.summary || '');
                      setCopiedFlash('summary');
                    }}
                  />
                ) : null}
                <MacButton
                  label={copiedFlash === 'md' ? 'COPIED ✓' : 'COPY MD'}
                  onPress={() => {
                    copyToClipboard(renderRunAsMarkdown(row));
                    setCopiedFlash('md');
                  }}
                />
                {row.live_url ? (
                  <MacButton
                    label="OPEN LIVE ↗"
                    onPress={() => Linking.openURL(row.live_url!).catch(() => {})}
                  />
                ) : null}
              </View>
            ) : null}
          </MacWindow>
        </View>
      </View>
      <ScreenshotZoomModal
        src={zoomSrc}
        caption={row?.task || null}
        onClose={() => setZoomSrc(null)}
      />
    </Modal>
  );
}

function MetricTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={s.metricTile}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text
        style={[
          s.metricValue,
          mono && { fontFamily: MAC.fontMono },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Platform.OS === 'web' ? 32 : 8,
  },
  windowShell: {
    width: '100%',
    maxWidth: 760,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: MAC.line,
    borderRadius: 2,
  },
  statusPillText: {
    fontFamily: MAC.fontTitle,
    fontSize: 10,
    letterSpacing: 0.6,
    fontWeight: '700',
    color: MAC.textInverse,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: MAC.fontMono,
    fontSize: 12,
    color: MAC.textMuted,
  },
  body: {
    maxHeight: Platform.OS === 'web' ? 620 : 520,
    padding: 16,
  },
  section: {
    marginBottom: 18,
  },
  sectionLabel: {
    fontFamily: MAC.fontTitle,
    fontSize: 10,
    letterSpacing: 1.2,
    color: MAC.textMuted,
    marginBottom: 8,
    fontWeight: '700',
  },
  taskText: {
    fontFamily: MAC.fontBody,
    color: MAC.text,
    fontSize: 15,
    lineHeight: 22,
  },
  // Metrics grid — beveled inset tiles
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginBottom: 18,
  },
  metricTile: {
    width: '33.33%',
    padding: 4,
  },
  metricLabel: {
    fontFamily: MAC.fontTitle,
    fontSize: 9,
    letterSpacing: 1,
    color: MAC.textMuted,
    marginBottom: 4,
    fontWeight: '700',
  },
  metricValue: {
    fontFamily: MAC.fontTitle,
    color: MAC.text,
    fontSize: 13,
    fontWeight: '700',
  },
  // Summary
  summaryBox: {
    padding: 12,
    backgroundColor: MAC.cardBgAlt,
    borderWidth: 1,
    borderColor: MAC.line,
    borderRadius: 3,
    ...(Platform.OS === 'web'
      ? { boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF' } as any
      : {}),
  },
  summaryText: {
    fontFamily: MAC.fontBody,
    color: MAC.text,
    fontSize: 13,
    lineHeight: 20,
  },
  // Error
  errorBox: {
    padding: 12,
    backgroundColor: '#FFE0E0',
    borderWidth: 1,
    borderColor: MAC.danger,
    borderRadius: 3,
  },
  errorText: {
    fontFamily: MAC.fontMono,
    color: MAC.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  // Findings
  findingCard: {
    padding: 12,
    backgroundColor: MAC.cardBg,
    borderWidth: 1,
    borderColor: MAC.line,
    borderRadius: 3,
    ...(Platform.OS === 'web'
      ? { cursor: 'pointer', boxShadow: 'inset 1px 1px 0 #FFFFFF, inset -1px -1px 0 #808080' } as any
      : {}),
  },
  findingHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  findingIndex: {
    fontFamily: MAC.fontMono,
    fontSize: 11,
    color: MAC.textMuted,
    fontWeight: '700',
    minWidth: 20,
  },
  findingTitle: {
    flex: 1,
    fontFamily: MAC.fontTitle,
    color: MAC.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  findingPrice: {
    fontFamily: MAC.fontMono,
    fontSize: 12,
    fontWeight: '700',
    color: MAC.accent,
  },
  findingNotes: {
    fontFamily: MAC.fontBody,
    color: MAC.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    paddingLeft: 30,
  },
  findingFoot: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    paddingLeft: 30,
    flexWrap: 'wrap',
  },
  findingMeta: {
    fontFamily: MAC.fontMono,
    fontSize: 10,
    color: MAC.textMuted,
  },
  // Screenshot
  screenshotBox: {
    borderWidth: 2,
    borderColor: MAC.line,
    backgroundColor: '#000',
    borderRadius: 3,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? { boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF' } as any
      : {}),
  },
  screenshotImg: {
    width: '100%',
    aspectRatio: 16 / 10,
  },
  // Active-run banner
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 3,
    marginBottom: 18,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: MAC.line,
    marginTop: 4,
  },
  liveLabel: {
    fontFamily: MAC.fontTitle,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: 4,
  },
  liveHint: {
    fontFamily: MAC.fontBody,
    color: MAC.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  // Links
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  linkLabel: {
    fontFamily: MAC.fontTitle,
    fontSize: 10,
    letterSpacing: 0.8,
    color: MAC.textMuted,
    fontWeight: '700',
    minWidth: 40,
  },
  linkValue: {
    flex: 1,
    fontFamily: MAC.fontMono,
    fontSize: 11,
    color: MAC.text,
  },
  // Footer
  footer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: MAC.line,
    backgroundColor: MAC.windowBg,
    flexWrap: 'wrap',
  },
});
