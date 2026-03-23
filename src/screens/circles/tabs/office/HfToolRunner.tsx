import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, Image, Platform,
} from 'react-native';
import { LoadingScreen } from '../../../../components/LoadingWave';
import { supabase } from '../../../../lib/supabase';
import { listHfTools, invokeHfTool, invokeHfInference, HfTool, HfTask, HF_TASK_META } from '../../../../lib/hfService';

interface Props {
  circleId: string;
  onClose: () => void;
}

type RunMode = 'tools' | 'inference';

const INFERENCE_TASKS: { key: HfTask; label: string; icon: string; placeholder: string }[] = [
  { key: 'chat',                     label: 'Chat',       icon: '💬', placeholder: 'Ask anything...' },
  { key: 'text-to-image',            label: 'Image Gen',  icon: '🎨', placeholder: 'Describe the image you want...' },
  { key: 'summarization',            label: 'Summarize',  icon: '📋', placeholder: 'Paste text to summarize...' },
  { key: 'sentiment',                label: 'Sentiment',  icon: '😊', placeholder: 'Enter text to analyze sentiment...' },
  { key: 'text-classification',      label: 'Classify',   icon: '🏷️', placeholder: 'Enter text to classify...' },
  { key: 'zero-shot-classification', label: 'Zero-Shot',  icon: '🎯', placeholder: 'Enter text (add labels in options)...' },
  { key: 'question-answering',       label: 'Q&A',        icon: '❓', placeholder: 'Enter question (add context in options)...' },
  { key: 'image-to-text',            label: 'Caption',    icon: '👁️', placeholder: 'Enter image URL to caption...' },
  { key: 'translation',              label: 'Translate',   icon: '🌍', placeholder: 'Enter text to translate...' },
  { key: 'embeddings',               label: 'Embeddings', icon: '🧮', placeholder: 'Enter text to embed...' },
  { key: 'text-to-speech',           label: 'TTS',        icon: '🔊', placeholder: 'Enter text to speak...' },
];

const MODEL_PRESETS: { task: HfTask; models: { id: string; label: string }[] }[] = [
  { task: 'chat', models: [
    { id: 'Qwen/Qwen2.5-7B-Instruct-1M', label: 'Qwen 2.5 7B' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
    { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.3', label: 'Mistral 7B' },
  ]},
  { task: 'text-to-image', models: [
    { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1 Schnell (fast)' },
    { id: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1 Dev (quality)' },
  ]},
  { task: 'summarization', models: [
    { id: 'facebook/bart-large-cnn', label: 'BART Large CNN' },
  ]},
  { task: 'translation', models: [
    { id: 'facebook/mbart-large-50-many-to-many-mmt', label: 'mBART 50 (50 languages)' },
  ]},
];

export default function HfToolRunner({ circleId, onClose }: Props) {
  const [mode, setMode] = useState<RunMode>('inference');
  const [tools, setTools] = useState<HfTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<HfTool | null>(null);
  const [selectedTask, setSelectedTask] = useState<HfTask>('chat');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTools();
  }, [circleId]);

  const loadTools = async () => {
    setLoading(true);
    const data = await listHfTools(circleId);
    setTools(data);
    if (data.length > 0) setSelectedTool(data[0]);
    setLoading(false);
  };

  const currentPlaceholder = INFERENCE_TASKS.find(t => t.key === selectedTask)?.placeholder || 'Enter input...';

  const handleRun = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setResult(null);
    setImageUrl(null);
    setError(null);

    try {
      let output: any;

      if (mode === 'tools' && selectedTool) {
        output = await invokeHfTool(selectedTool.id, { inputs: input });

        // Log to activity
        await supabase.from('agent_activity').insert({
          circle_id: circleId,
          agent_name: 'HF Proxy',
          source: 'system',
          activity_type: 'tool_call',
          title: `HF Tool: ${selectedTool.space_name}`,
          body: `Input: ${input.slice(0, 100)}${input.length > 100 ? '...' : ''}`,
          status: 'completed',
          metadata: { space_id: selectedTool.space_id },
        });
      } else {
        output = await invokeHfInference(selectedTask, input);
      }

      // Handle image results
      if (output?.result?.image) {
        setImageUrl(output.result.image);
        setResult({ model: output.model, task: output.task, prompt: output.result.prompt });
      } else if (output?.result?.choices) {
        // Chat completion
        const msg = output.result.choices[0]?.message?.content || JSON.stringify(output.result);
        setResult(msg);
      } else if (Array.isArray(output?.result)) {
        // Classification / sentiment
        const formatted = output.result.flat?.() || output.result;
        setResult(formatted);
      } else if (output?.result?.[0]?.summary_text) {
        setResult(output.result[0].summary_text);
      } else if (output?.result?.[0]?.translation_text) {
        setResult(output.result[0].translation_text);
      } else {
        setResult(output?.result || output);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to run');
      console.error(e);
    }
    setRunning(false);
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>HF Runner</Text>
          <Text style={s.subtitle}>Run models and tools</Text>
        </View>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeText}>x</Text>
        </Pressable>
      </View>

      {/* Mode toggle */}
      <View style={s.modeTabs}>
        <Pressable onPress={() => setMode('inference')} style={[s.modeTab, mode === 'inference' && s.modeTabActive]}>
          <Text style={[s.modeTabText, mode === 'inference' && s.modeTabTextActive]}>Inference</Text>
        </Pressable>
        <Pressable onPress={() => setMode('tools')} style={[s.modeTab, mode === 'tools' && s.modeTabActive]}>
          <Text style={[s.modeTabText, mode === 'tools' && s.modeTabTextActive]}>
            Saved Tools{tools.length > 0 ? ` (${tools.length})` : ''}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Task / tool selector */}
        {mode === 'inference' ? (
          <View style={s.section}>
            <Text style={s.label}>Task</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {INFERENCE_TASKS.map(t => (
                <Pressable
                  key={t.key}
                  style={[s.chip, selectedTask === t.key && s.chipActive]}
                  onPress={() => setSelectedTask(t.key)}
                >
                  <Text style={[s.chipText, selectedTask === t.key && s.chipTextActive]}>{t.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : tools.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>No tools added yet. Use the Explorer to add HF Spaces.</Text>
          </View>
        ) : (
          <View style={s.section}>
            <Text style={s.label}>Tool</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {tools.map(t => (
                <Pressable
                  key={t.id}
                  style={[s.chip, selectedTool?.id === t.id && s.chipActive]}
                  onPress={() => setSelectedTool(t)}
                >
                  <Text style={[s.chipText, selectedTool?.id === t.id && s.chipTextActive]}>{t.space_name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Input */}
        <View style={s.section}>
          <Text style={s.label}>Input</Text>
          <TextInput
            style={s.input}
            multiline
            placeholder={mode === 'inference' ? currentPlaceholder : 'Enter input for the tool...'}
            placeholderTextColor="#4f4f4f"
            value={input}
            onChangeText={setInput}
            autoCorrect={false}
          />
        </View>

        {/* Run button */}
        <Pressable
          style={[s.runBtn, (running || !input.trim() || (mode === 'tools' && !selectedTool)) && { opacity: 0.4 }]}
          onPress={handleRun}
          disabled={running || !input.trim() || (mode === 'tools' && !selectedTool)}
        >
          {running ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={s.runText}>Run</Text>
          )}
        </Pressable>

        {/* Error */}
        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Image result */}
        {imageUrl && (
          <View style={s.section}>
            <Text style={s.label}>Generated Image</Text>
            <View style={s.imageContainer}>
              <Image source={{ uri: imageUrl }} style={s.image} resizeMode="contain" />
            </View>
          </View>
        )}

        {/* Text / JSON result */}
        {result && !imageUrl && (
          <View style={s.section}>
            <Text style={s.label}>Result</Text>
            <View style={s.resultBox}>
              <Text style={s.resultText} selectable>
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </Text>
            </View>
          </View>
        )}

        {/* Result metadata when image */}
        {result && imageUrl && (
          <View style={s.metaRow}>
            <Text style={s.metaText}>Model: {result.model}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  title: { color: '#e8e8e8', fontSize: 18, fontWeight: '600' },
  subtitle: { color: '#6f6f6f', fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 10 },
  closeText: { color: '#6f6f6f', fontSize: 18, fontWeight: '600' },
  modeTabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    paddingHorizontal: 16,
  },
  modeTab: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  modeTabActive: { borderBottomColor: '#e8e8e8' },
  modeTabText: { color: '#4f4f4f', fontSize: 13, fontWeight: '500' },
  modeTabTextActive: { color: '#e8e8e8', fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 20 },
  label: { color: '#6f6f6f', fontSize: 11, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  chipRow: { gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  chipActive: { backgroundColor: '#252525', borderColor: '#e8e8e8' },
  chipText: { color: '#6f6f6f', fontSize: 12 },
  chipTextActive: { color: '#e8e8e8', fontWeight: '600' },
  input: {
    backgroundColor: '#0a0a0a', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    color: '#e8e8e8', fontSize: 14, minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1, borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  runBtn: {
    backgroundColor: '#ffffff', paddingVertical: 12, borderRadius: 12,
    alignItems: 'center', marginBottom: 20,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  runText: { color: '#000000', fontSize: 14, fontWeight: '700' },
  errorBox: {
    backgroundColor: '#1a1a1a', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 20,
  },
  errorText: { color: '#e8e8e8', fontSize: 13 },
  resultBox: {
    backgroundColor: '#0a0a0a', padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  resultText: {
    color: '#e8e8e8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12, lineHeight: 18,
  },
  imageContainer: {
    backgroundColor: '#0a0a0a', borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  image: { width: '100%', height: 300 },
  metaRow: { paddingHorizontal: 4, marginBottom: 20 },
  metaText: { color: '#4f4f4f', fontSize: 11 },
  emptyBox: {
    backgroundColor: '#0a0a0a', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#1a1a1a', marginBottom: 20,
    alignItems: 'center',
  },
  emptyText: { color: '#4f4f4f', fontSize: 13, textAlign: 'center' },
});
