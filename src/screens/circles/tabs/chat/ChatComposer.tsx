import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  ScrollView,
} from 'react-native';
import { ProviderModel } from '../../../../lib/llmProviders';
import {
  ChatMode,
  ChatRun,
  ChatCommand,
  CHAT_COMMANDS,
  MODE_CONFIG,
} from './chatTypes';

const MODES: ChatMode[] = ['talk', 'plan', 'execute', 'review'];
const CAPABILITY_PRESETS = [
  { label: 'Image', command: '/imagine ', hint: 'Generate an image or logo' },
  { label: 'Web Page', command: '/build-page ', hint: 'Draft a landing page' },
  { label: 'Code', command: '/code ', hint: 'Generate or refactor code' },
  { label: 'Vision', command: '/vision ', hint: 'Analyze an image or screenshot' },
  { label: 'Open Model', command: '/openmodel ', hint: 'Ask an open model' },
  { label: 'Translate', command: '/translate ', hint: 'Translate text' },
];

interface Props {
  sessionId: string | null;
  circleId: string;
  userId: string;
  mode: ChatMode;
  activeRun: ChatRun | null;
  onSend: (content: string, mode: ChatMode) => void;
  onModeChange: (mode: ChatMode) => void;
  selectedModel: string;
  availableModels: ProviderModel[];
  onSelectModel: (model: string) => void;
  accentColor: string;
}

function ChatComposer({
  sessionId,
  mode,
  activeRun,
  onSend,
  onModeChange,
  selectedModel,
  availableModels,
  onSelectModel,
  accentColor,
}: Props) {
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(56);
  const [showCommands, setShowCommands] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<ChatCommand[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const sendAnim = useRef(new Animated.Value(1)).current;

  const isRunning = activeRun?.status === 'running';
  const canSend = text.trim().length > 0 && sessionId !== null;

  useEffect(() => {
    if (text.startsWith('/')) {
      const query = text.slice(1).toLowerCase();
      const matched = CHAT_COMMANDS.filter(
        cmd => cmd.name.toLowerCase().includes(query) ||
               cmd.description.toLowerCase().includes(query)
      );
      setFilteredCommands(matched.slice(0, 6));
      setShowCommands(matched.length > 0);
    } else {
      setShowCommands(false);
      setFilteredCommands([]);
    }
  }, [text]);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const content = text.trim();
    setText('');
    setInputHeight(56);
    setShowCommands(false);
    Animated.sequence([
      Animated.timing(sendAnim, { toValue: 0.92, duration: 80, useNativeDriver: false }),
      Animated.timing(sendAnim, { toValue: 1, duration: 120, useNativeDriver: false }),
    ]).start();
    onSend(content, mode);
  }, [canSend, text, mode, onSend, sendAnim]);

  const handleCommandSelect = useCallback((cmd: ChatCommand) => {
    setText(`${cmd.name} `);
    setShowCommands(false);
    inputRef.current?.focus();
  }, []);

  const handlePresetSelect = useCallback((command: string) => {
    setText(command);
    inputRef.current?.focus();
  }, []);

  const handleKeyPress = useCallback((e: any) => {
    if (Platform.OS === 'web') {
      const nativeEvent = e.nativeEvent;
      if (nativeEvent.key === 'Enter' && !nativeEvent.shiftKey) {
        e.preventDefault?.();
        handleSend();
      }
    }
  }, [handleSend]);

  const handleContentSizeChange = useCallback((e: any) => {
    const height = e.nativeEvent.contentSize.height;
    setInputHeight(Math.min(Math.max(56, height + 10), 160));
  }, []);

  return (
    <View style={[styles.container, { borderTopColor: accentColor + '20' }]}>
      {showCommands && (
        <View style={[styles.commandDropdown, { borderColor: accentColor + '22' }]}>
          <ScrollView style={styles.commandScroll} keyboardShouldPersistTaps="handled">
            {filteredCommands.map(cmd => (
              <Pressable key={cmd.name} style={styles.commandItem} onPress={() => handleCommandSelect(cmd)}>
                <Text style={[styles.commandName, { color: accentColor }]}>{cmd.name}</Text>
                <Text style={styles.commandDesc} numberOfLines={1}>{cmd.description}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.topRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeRow}>
          {MODES.map(m => {
            const conf = MODE_CONFIG[m];
            const isActive = m === mode;
            return (
              <Pressable
                key={m}
                style={[
                  styles.modePill,
                  isActive && { backgroundColor: conf.color + '20', borderColor: conf.color + '55' },
                ]}
                onPress={() => onModeChange(m)}
              >
                <Text style={[styles.modePillText, { color: isActive ? conf.color : '#8f9b8f' }]}>
                  {conf.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          style={[styles.modelToggle, { borderColor: accentColor + '35', backgroundColor: accentColor + '12' }]}
          onPress={() => setShowAllModels(prev => !prev)}
        >
          <Text style={[styles.modelToggleText, { color: accentColor }]}>
            {selectedModel === 'auto' ? 'Auto model' : selectedModel}
          </Text>
          <Text style={[styles.modelToggleCaret, { color: accentColor }]}>{showAllModels ? '▴' : '▾'}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modelRow}>
        <Pressable
          style={[
            styles.modelChip,
            selectedModel === 'auto' && { backgroundColor: accentColor + '18', borderColor: accentColor + '55' },
          ]}
          onPress={() => onSelectModel('auto')}
        >
          <Text style={[styles.modelChipText, { color: selectedModel === 'auto' ? accentColor : '#9aa79a' }]}>Auto</Text>
        </Pressable>
        {availableModels.slice(0, showAllModels ? availableModels.length : 10).map(model => (
          <Pressable
            key={`${model.provider}-${model.id}`}
            style={[
              styles.modelChip,
              selectedModel === model.id && { backgroundColor: accentColor + '18', borderColor: accentColor + '55' },
            ]}
            onPress={() => onSelectModel(model.id)}
          >
            <Text style={[styles.modelChipText, { color: selectedModel === model.id ? accentColor : '#9aa79a' }]}>
              {model.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
        {CAPABILITY_PRESETS.map(preset => (
          <Pressable
            key={preset.label}
            style={[styles.presetChip, { borderColor: accentColor + '2f', backgroundColor: accentColor + '10' }]}
            onPress={() => handlePresetSelect(preset.command)}
          >
            <Text style={[styles.presetLabel, { color: accentColor }]}>{preset.label}</Text>
            <Text style={styles.presetHint}>{preset.hint}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.inputRow, { borderColor: accentColor + '25' }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { height: inputHeight }]}
          value={text}
          onChangeText={setText}
          placeholder="Ask a question, vent, plan, reflect, or just start talking..."
          placeholderTextColor="#647164"
          multiline
          onContentSizeChange={handleContentSizeChange}
          onKeyPress={handleKeyPress}
          editable={sessionId !== null}
        />

        {isRunning ? (
          <View style={styles.runningActions}>
            <Pressable
              style={[styles.secondaryAction, { borderColor: accentColor + '35' }]}
              onPress={() => {
                if (text.trim()) onSend(text.trim(), mode);
                setText('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Send follow-up to active run"
            >
              <Text style={[styles.secondaryActionText, { color: accentColor }]}>Follow up</Text>
            </Pressable>
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: sendAnim }] }}>
            <Pressable
              style={[
                styles.sendButton,
                canSend && { backgroundColor: accentColor, borderColor: accentColor },
              ]}
              onPress={handleSend}
              disabled={!canSend}
            >
              <Text style={[styles.sendIcon, { color: canSend ? '#0a1409' : '#4c564c' }]}>→</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#09120a',
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    paddingTop: 10,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeRow: {
    gap: 8,
    paddingRight: 10,
  },
  modePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1d2a1f',
    backgroundColor: '#0f1811',
  },
  modePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modelToggle: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  modelToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modelToggleCaret: {
    fontSize: 11,
    fontWeight: '800',
  },
  modelRow: {
    gap: 8,
    paddingRight: 12,
  },
  presetRow: {
    gap: 8,
    paddingRight: 12,
  },
  modelChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1d2a1f',
    backgroundColor: '#0d160f',
  },
  modelChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 112,
    backgroundColor: '#0d160f',
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  presetHint: {
    fontSize: 11,
    color: '#91a291',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderRadius: 28,
    borderWidth: 1,
    backgroundColor: '#101910',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: '#eef7e6',
    fontSize: 15,
    lineHeight: 21,
    paddingTop: 0,
    paddingBottom: 0,
  },
  runningActions: {
    gap: 8,
  },
  secondaryAction: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#0f1c11',
  },
  secondaryActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  queueButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d7e3d1',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1d2a1f',
    backgroundColor: '#101910',
  },
  sendIcon: {
    fontSize: 22,
    fontWeight: '900',
  },
  commandDropdown: {
    maxHeight: 180,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#0d160f',
  },
  commandScroll: {
    maxHeight: 180,
  },
  commandItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#152016',
  },
  commandName: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  commandDesc: {
    fontSize: 12,
    color: '#92a092',
  },
});

export default ChatComposer;
