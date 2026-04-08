import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

const STARTER_PROMPTS = [
  { icon: '✨', label: 'Help me sort out what matters right now.' },
  { icon: '🌿', label: 'Check in with me and ask how I am doing.' },
  { icon: '🗓', label: 'Build me a simple plan for today.' },
  { icon: '💬', label: 'I just need to talk something through.' },
];

interface Props {
  onNewSession: () => void;
  onQuickPrompt: (prompt: string) => void;
  accentColor: string;
}

function EmptySessionState({ onNewSession, onQuickPrompt, accentColor }: Props) {
  return (
    <View style={styles.container}>
      <View style={[styles.heroCard, { borderColor: accentColor + '20' }]}>
        <View style={[styles.heroGlow, { backgroundColor: accentColor + '18' }]} />
        <Text style={[styles.eyebrow, { color: accentColor }]}>Main Chat</Text>
        <Text style={styles.title}>A calmer place to think, plan, and talk.</Text>
        <Text style={styles.subtitle}>
          This chat is meant to feel useful and welcoming, not overly technical. Pick a starter or begin a fresh conversation.
        </Text>

        <View style={styles.promptGrid}>
          {STARTER_PROMPTS.map(prompt => (
            <Pressable
              key={prompt.label}
              style={styles.promptCard}
              onPress={() => onQuickPrompt(prompt.label)}
            >
              <Text style={styles.promptIcon}>{prompt.icon}</Text>
              <Text style={styles.promptLabel}>{prompt.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.newSessionButton, { backgroundColor: accentColor, borderColor: accentColor }]}
          onPress={onNewSession}
        >
          <Text style={styles.newSessionLabel}>Start a new chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#071009',
  },
  heroCard: {
    width: '100%',
    maxWidth: 760,
    borderRadius: 32,
    borderWidth: 1,
    backgroundColor: '#0e170f',
    padding: 28,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  title: {
    color: '#f4faef',
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 38,
    maxWidth: 520,
    marginBottom: 12,
  },
  subtitle: {
    color: '#95a695',
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 560,
    marginBottom: 22,
  },
  promptGrid: {
    gap: 10,
    marginBottom: 22,
  },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#121d14',
    borderWidth: 1,
    borderColor: '#1a261c',
  },
  promptIcon: {
    fontSize: 18,
  },
  promptLabel: {
    flex: 1,
    color: '#dfead8',
    fontSize: 14,
    fontWeight: '600',
  },
  newSessionButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  newSessionLabel: {
    color: '#071009',
    fontSize: 13,
    fontWeight: '800',
  },
});

export default EmptySessionState;
