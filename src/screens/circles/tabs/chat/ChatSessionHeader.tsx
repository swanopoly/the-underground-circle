import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ChatSession, MODE_CONFIG } from './chatTypes';

interface Props {
  session: ChatSession | null;
  onBack?: () => void;
  accentColor: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** The concrete model Auto has resolved to for the current input.
   *  Shown as "Auto → Sonnet" so the user knows what will run. */
  resolvedAutoModel?: string | null;
}

function shortModelLabel(modelId: string): string {
  const part = modelId.split('/').pop() || modelId;
  return part
    .replace(/:[a-z0-9_-]+$/i, '')
    .replace(/\b(20\d{4,6})\b/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/\bClaude\s*/i, '')
    .replace(/\bGpt\b/i, 'GPT')
    .trim()
    .slice(0, 22);
}

function ChatSessionHeader({ session, onBack, accentColor, isFullscreen = false, onToggleFullscreen, resolvedAutoModel }: Props) {
  if (!session) {
    return (
      <View style={[styles.container, { borderBottomColor: accentColor + '16' }]}>
        <View style={styles.inner}>
          {onBack ? (
            <Pressable style={[styles.backButton, { borderColor: accentColor + '24' }]} onPress={onBack}>
              <Text style={[styles.backIcon, { color: accentColor }]}>‹</Text>
            </Pressable>
          ) : null}
          <View>
            <Text style={styles.eyebrow}>Main Chat</Text>
            <Text style={styles.title}>Start a fresh conversation</Text>
          </View>
          {onToggleFullscreen ? (
            <Pressable style={[styles.utilityButton, { borderColor: accentColor + '24' }]} onPress={onToggleFullscreen}>
              <Text style={[styles.utilityButtonText, { color: accentColor }]}>{isFullscreen ? 'Exit full' : 'Full screen'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const modeConf = MODE_CONFIG[session.mode];

  return (
    <View style={[styles.container, { borderBottomColor: accentColor + '16' }]}>
      <View style={styles.inner}>
        {onBack ? (
          <Pressable style={[styles.backButton, { borderColor: accentColor + '24' }]} onPress={onBack}>
            <Text style={[styles.backIcon, { color: accentColor }]}>‹</Text>
          </Pressable>
        ) : null}
        <View style={styles.copyBlock}>
          <Text style={[styles.eyebrow, { color: accentColor }]}>Main Chat</Text>
          <Text style={styles.title} numberOfLines={1}>{session.title}</Text>
          <Text style={styles.subtitle}>
            Talk, plan, reflect, and get help in one place.
          </Text>
        </View>
        <View style={styles.metaWrap}>
          <View style={[styles.pill, { backgroundColor: modeConf.color + '18', borderColor: modeConf.color + '40' }]}>
            <Text style={[styles.pillText, { color: modeConf.color }]}>{modeConf.label}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: accentColor + '12', borderColor: accentColor + '30' }]}>
            <Text style={[styles.pillText, { color: accentColor }]}>
              {(!session.model || session.model === 'auto')
                ? (resolvedAutoModel
                    ? `Auto → ${shortModelLabel(resolvedAutoModel)}`
                    : 'Auto')
                : shortModelLabel(session.model)}
            </Text>
          </View>
          {onToggleFullscreen ? (
            <Pressable style={[styles.utilityButton, { borderColor: accentColor + '24' }]} onPress={onToggleFullscreen}>
              <Text style={[styles.utilityButtonText, { color: accentColor }]}>{isFullscreen ? 'Exit full' : 'Full screen'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#09120a',
    borderBottomWidth: 1,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d160f',
  },
  backIcon: {
    fontSize: 20,
    fontWeight: '900',
  },
  copyBlock: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#88a588',
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f2f8ee',
  },
  subtitle: {
    fontSize: 13,
    color: '#91a391',
    marginTop: 4,
  },
  metaWrap: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  utilityButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#0d160f',
  },
  utilityButtonText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default ChatSessionHeader;
