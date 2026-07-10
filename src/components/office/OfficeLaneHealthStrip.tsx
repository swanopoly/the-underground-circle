/**
 * OfficeLaneHealthStrip — X7 tail (P53): the per-lane quality signal on the
 * MAIN Office view. Sibling of OfficeBridgeReadinessStrip and follows its
 * contract exactly: WARN/DANGER-ONLY, silent when healthy — a degraded chat
 * lane (P48 chatLaneHealthRegistry) was previously visible only via the
 * `/lanes` chat command and archive tags.
 *
 * `warn` (amber) = lane-isolated degradation — one lane failing while others
 * stay healthy; suspect that lane's transport/model, not global quality.
 * `danger` (red) = multi-lane — treat as systemic (provider/auth/network).
 *
 * Self-polling: the registry is in-memory and non-reactive, so the strip
 * re-reads the pure model on mount + every 20s while mounted (pure reads —
 * no I/O, no re-render churn when the model is unchanged).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  buildChatLaneHealthStripModelNow,
  type ChatLaneHealthStripModel,
} from '../../lib/chatLaneHealthRegistry';

const POLL_MS = 20_000;

export default function OfficeLaneHealthStrip() {
  const [model, setModel] = useState<ChatLaneHealthStripModel | null>(null);

  useEffect(() => {
    const read = () => {
      try {
        const next = buildChatLaneHealthStripModelNow();
        setModel((prev) => {
          // Avoid re-render churn: only update when the rendered text changes.
          if (prev?.tone === next?.tone && prev?.headline === next?.headline && prev?.detail === next?.detail) {
            return prev;
          }
          return next;
        });
      } catch {
        // Observability only — a registry read error must never break Office.
        setModel(null);
      }
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  if (!model) return null;

  const color = model.tone === 'danger' ? '#ef4444' : '#e8b339';

  return (
    <View style={[styles.strip, { borderColor: color + '55' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.textCol}>
        <Text style={[styles.headline, { color }]} numberOfLines={1}>
          {model.headline}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>{model.detail}</Text>
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
