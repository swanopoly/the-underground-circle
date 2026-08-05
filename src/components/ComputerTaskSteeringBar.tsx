import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_STEERING_NOTE_CHARS } from '../lib/computerUseSteering';

/**
 * ComputerTaskSteeringBar — mid-run steering input for a live computer task
 * (Phase 4e of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
 *
 * Rendered only while a task is running and NOT paused on a question (a
 * pending confirmation card owns the input then). The note applies at the
 * task's next step boundary as guidance — it can never approve anything;
 * "Stop" remains the explicit alternative.
 */

interface Props {
  /** Short label of the running task for context. */
  taskLabel: string;
  onSend: (note: string) => Promise<{ ok: boolean; error?: string }>;
  /** Omit when the surface has no cancel handle (e.g. OpenSwan turns). */
  onStop?: () => void;
  accentColor?: string;
}

export default function ComputerTaskSteeringBar({ taskLabel, onSend, onStop, accentColor = '#22c55e' }: Props) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const send = async () => {
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setStatus(null);
    const result = await onSend(trimmed);
    setBusy(false);
    if (result.ok) {
      setNote('');
      setStatus('Sent — applies at the next step.');
    } else {
      setStatus(result.error || 'Could not send the note.');
    }
  };

  return (
    <View style={[styles.container, { borderColor: accentColor + '33' }]}>
      <View style={styles.headerRow}>
        <View style={[styles.liveDot, { backgroundColor: accentColor }]} />
        <Text style={styles.headerText} numberOfLines={1}>
          Steer the running task: {taskLabel}
        </Text>
        {onStop ? (
          <Pressable onPress={onStop} style={styles.stopButton}>
            <Text style={styles.stopText}>STOP</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={note}
          onChangeText={setNote}
          onSubmitEditing={() => { void send(); }}
          placeholder='Guidance for its next steps — e.g. "skip that site, try the official store"'
          placeholderTextColor="#5d6e5d"
          maxLength={MAX_STEERING_NOTE_CHARS}
          style={styles.input}
          editable={!busy}
        />
        <Pressable
          disabled={busy || !note.trim()}
          onPress={() => { void send(); }}
          style={({ hovered }: any) => [
            styles.sendButton,
            { borderColor: accentColor + '55', backgroundColor: accentColor + '22' },
            hovered && !busy && { backgroundColor: accentColor + '33' },
            (busy || !note.trim()) && { opacity: 0.5 },
            Platform.OS === 'web' && ({ cursor: busy ? 'wait' : 'pointer' } as any),
          ]}
        >
          <Text style={[styles.sendText, { color: accentColor }]}>{busy ? 'SENDING…' : 'STEER'}</Text>
        </Pressable>
      </View>
      <Text style={styles.hint} numberOfLines={2}>
        {status ?? 'Guidance only — purchases, deletes, and logins still stop for your confirmation.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#0d150d',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerText: {
    flex: 1,
    color: '#d9e4d3',
    fontSize: 12,
    fontWeight: '700',
  },
  stopButton: {
    borderWidth: 1,
    borderColor: '#3a1d1d',
    backgroundColor: '#1d0f0f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stopText: {
    color: '#f87171',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#e6efe2',
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#1b271b',
    borderRadius: 8,
    backgroundColor: '#0a110a',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sendButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sendText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  hint: {
    color: '#6f7f6f',
    fontSize: 10,
  },
});
