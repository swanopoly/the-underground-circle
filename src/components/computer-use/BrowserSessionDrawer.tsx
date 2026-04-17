import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
  Platform,
} from 'react-native';
import type { BrowserSessionRecord } from '../../lib/computerUse';

type Props = {
  session: BrowserSessionRecord | null;
  visible: boolean;
  onClose: () => void;
  onOpenLiveSession?: (session: BrowserSessionRecord) => void;
};

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export default function BrowserSessionDrawer({ session, visible, onClose, onOpenLiveSession }: Props) {
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null);

  if (!session) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>BROWSER SESSION</Text>
              <Text style={styles.title} numberOfLines={2}>{session.task}</Text>
              <Text style={styles.meta}>
                {session.backendLabel.toUpperCase()} · {session.status.toUpperCase()} · {session.actions.length} ACTIONS
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.summaryCard}>
            {session.backendSessionId ? <Text style={styles.summaryLine}>SESSION ID: {session.backendSessionId}</Text> : null}
            {session.currentUrl ? <Text style={styles.summaryLine} numberOfLines={1}>URL: {session.currentUrl}</Text> : null}
            <Text style={styles.summaryLine}>STARTED: {new Date(session.startedAt).toLocaleString()}</Text>
            {session.completedAt ? <Text style={styles.summaryLine}>ENDED: {new Date(session.completedAt).toLocaleString()}</Text> : null}
            {session.backendLiveUrl && onOpenLiveSession ? (
              <Pressable onPress={() => onOpenLiveSession(session)} style={styles.openButton}>
                <Text style={styles.openButtonText}>OPEN LIVE SESSION</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {session.actions.map((action, index) => (
              <View key={`${session.id}-${action.id}`} style={styles.actionCard}>
                <Text style={styles.actionTitle}>
                  {String(index + 1).padStart(2, '0')} · {action.type.toUpperCase()} · {action.status.toUpperCase()}
                </Text>
                <Text style={styles.actionDescription}>{action.description}</Text>
                {action.target ? <Text style={styles.actionMeta} numberOfLines={1}>{action.target}</Text> : null}
                {action.error ? <Text style={styles.actionError}>{action.error}</Text> : null}
                <View style={styles.shotRow}>
                  {action.screenshotBefore ? (
                    <Pressable onPress={() => setSelectedScreenshot(action.screenshotBefore!)} style={styles.shotWrap}>
                      <Image source={{ uri: `data:image/png;base64,${action.screenshotBefore}` }} style={styles.thumb} />
                      <Text style={styles.thumbLabel}>BEFORE</Text>
                    </Pressable>
                  ) : null}
                  {action.screenshotAfter ? (
                    <Pressable onPress={() => setSelectedScreenshot(action.screenshotAfter!)} style={styles.shotWrap}>
                      <Image source={{ uri: `data:image/png;base64,${action.screenshotAfter}` }} style={styles.thumb} />
                      <Text style={styles.thumbLabel}>AFTER</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </ScrollView>

          {selectedScreenshot ? (
            <Pressable style={styles.overlay} onPress={() => setSelectedScreenshot(null)}>
              <View style={styles.overlayCard}>
                <Image source={{ uri: `data:image/png;base64,${selectedScreenshot}` }} style={styles.fullImage} resizeMode="contain" />
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%' as any,
    maxWidth: 960,
    maxHeight: '88%' as any,
    backgroundColor: '#070b12',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#16202e',
  },
  label: {
    color: '#8b5cf6',
    fontSize: 10,
    fontFamily: MONO,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  meta: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: MONO,
    marginTop: 6,
  },
  closeButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  closeButtonText: {
    color: '#94a3b8',
    fontSize: 24,
    lineHeight: 24,
  },
  summaryCard: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#16202e',
    gap: 6,
  },
  summaryLine: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: MONO,
  },
  openButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#8b5cf620',
    borderWidth: 1,
    borderColor: '#8b5cf655',
  },
  openButtonText: {
    color: '#c4b5fd',
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
  },
  body: {
    padding: 14,
  },
  actionCard: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0f1722',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  actionTitle: {
    color: '#f8fafc',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '700',
  },
  actionDescription: {
    color: '#e2e8f0',
    fontSize: 12,
    marginTop: 6,
  },
  actionMeta: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: MONO,
    marginTop: 4,
  },
  actionError: {
    color: '#ef4444',
    fontSize: 11,
    marginTop: 4,
  },
  shotRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  shotWrap: {
    gap: 4,
  },
  thumb: {
    width: 170,
    height: 110,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
  },
  thumbLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: MONO,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayCard: {
    width: '90%' as any,
    height: '80%' as any,
    backgroundColor: '#020617',
    borderRadius: 12,
    overflow: 'hidden',
  },
  fullImage: {
    width: '100%' as any,
    height: '100%' as any,
  },
});
