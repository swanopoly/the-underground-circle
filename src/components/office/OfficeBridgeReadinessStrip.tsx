/**
 * OfficeBridgeReadinessStrip — compact, fail-visible bridge status on the MAIN
 * Office view (O5, P38 plan / built P39). Before this, the classified
 * readiness snapshot (core proxy + execution bridges → ready-for-agent-tasks)
 * only existed inside the desktop Whiteboard overlay, so a dead bridge was
 * invisible until a task failed.
 *
 * Deliberately warn/danger-only: the happy state is already covered by
 * ConnectAllBridgesPanel's "✓ Connected" chip, and the muted states (bridges
 * unavailable in this runtime — e.g. the hosted web app on a phone) would be
 * permanent noise. Renders nothing in those cases.
 *
 * Pure presentational — OfficeTab owns the probe/polling (via the shared
 * officeBridgeReadinessProbe owner, same one the Whiteboard uses).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OfficeBridgeReadinessSnapshot } from '../../lib/officeBridgeReadiness';

export default function OfficeBridgeReadinessStrip({
  snapshot,
}: {
  snapshot: OfficeBridgeReadinessSnapshot | null;
}) {
  if (!snapshot) return null;
  if (snapshot.tone !== 'warn' && snapshot.tone !== 'danger') return null;

  const color = snapshot.tone === 'danger' ? '#ef4444' : '#e8b339';
  const issue = snapshot.primaryIssue || snapshot.summary || '';
  const detail = snapshot.actionDetail || '';

  return (
    <View style={[styles.strip, { borderColor: color + '55' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.textCol}>
        <Text style={[styles.headline, { color }]} numberOfLines={1}>
          {snapshot.statusLabel}{issue ? ` — ${issue}` : ''}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  detail: {
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    marginTop: 2,
  },
});
