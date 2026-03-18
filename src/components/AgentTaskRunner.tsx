/**
 * AgentTaskRunner — Quick-launch component for running agentic tasks
 *
 * Supports 6 task types: general, web_research, run_script, file_ops, db_query, api_call.
 * Shows live result with typewriter effect via room_messages realtime subscription.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

const MONO = Platform.OS === 'web' ? 'monospace' : 'Courier New';

const TASK_TYPES = [
  { key: 'general', emoji: '💬', label: 'General' },
  { key: 'web_research', emoji: '🔍', label: 'Research' },
  { key: 'run_script', emoji: '⚙️', label: 'Script' },
  { key: 'file_ops', emoji: '📁', label: 'Files' },
  { key: 'db_query', emoji: '🗄️', label: 'DB Query' },
  { key: 'api_call', emoji: '🌐', label: 'API' },
] as const;

interface AgentTaskRunnerProps {
  circleId: string;
  roomId: string;
  agentName: string;
  accentColor: string;
}

export default function AgentTaskRunner({ circleId, roomId, agentName, accentColor }: AgentTaskRunnerProps) {
  const [taskType, setTaskType] = useState('general');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [resultText, setResultText] = useState('');
  const [displayText, setDisplayText] = useState('');
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const charIndexRef = useRef(0);

  // Typewriter effect: reveal 3 chars per 16ms
  useEffect(() => {
    if (!resultText) {
      setDisplayText('');
      charIndexRef.current = 0;
      return;
    }
    charIndexRef.current = 0;
    setDisplayText('');
    typewriterRef.current = setInterval(() => {
      charIndexRef.current += 3;
      if (charIndexRef.current >= resultText.length) {
        setDisplayText(resultText);
        if (typewriterRef.current) clearInterval(typewriterRef.current);
        return;
      }
      setDisplayText(resultText.slice(0, charIndexRef.current));
    }, 16);
    return () => {
      if (typewriterRef.current) clearInterval(typewriterRef.current);
    };
  }, [resultText]);

  // Subscribe to room_messages realtime to catch agent_output
  useEffect(() => {
    if (!running) return;
    const channel = supabase
      .channel(`task-runner-${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'room_messages',
        filter: `room_id=eq.${roomId}`,
      }, (payload: any) => {
        const msg = payload.new;
        if (msg.message_type === 'agent_output' && msg.metadata?.task_reply) {
          setResultText(msg.content || 'Task completed.');
          setRunning(false);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [running, roomId]);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setResultText('');
    setDisplayText('');

    // Create a task row first
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    const { data: taskRow } = await supabase.from('room_tasks').insert({
      room_id: roomId,
      name: `Quick: ${prompt.slice(0, 40)}`,
      schedule: 'once',
      agent: agentName,
      prompt: prompt.trim(),
      enabled: true,
      task_type: taskType,
      created_by: user?.id || null,
    }).select('id').single();

    if (!taskRow) {
      setResultText('Failed to create task.');
      setRunning(false);
      return;
    }

    // Invoke edge function
    const { error } = await supabase.functions.invoke('room-task-executor', {
      body: {
        taskId: taskRow.id,
        roomId,
        prompt: prompt.trim(),
        agentName,
        task_type: taskType,
        taskName: `Quick: ${prompt.slice(0, 40)}`,
      },
    });

    if (error) {
      setResultText(`Error: ${error.message}`);
      setRunning(false);
    }
    // Otherwise, the realtime subscription will catch the result
  }, [prompt, running, roomId, agentName, taskType]);

  return (
    <View style={[st.container, { borderColor: '#111' }]}>
      {/* Header */}
      <View style={st.header}>
        <Text style={st.headerLabel}>⚡ Quick Task</Text>
        <View style={[st.agentBadge, { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}>
          <Text style={[st.agentBadgeText, { color: accentColor }]}>{agentName}</Text>
        </View>
      </View>

      {/* Task type pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.typePills}>
        {TASK_TYPES.map(tt => {
          const sel = taskType === tt.key;
          return (
            <Pressable key={tt.key} onPress={() => setTaskType(tt.key)}
              style={[st.pill, sel && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
                !sel && { backgroundColor: '#0d0d0d', borderColor: '#222' }]}>
              <Text style={[st.pillText, sel && { color: accentColor }]}>{tt.emoji} {tt.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Prompt input */}
      <TextInput
        style={st.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="What should the agent do?"
        placeholderTextColor="#555"
        multiline
        numberOfLines={3}
        editable={!running}
      />

      {/* Run button */}
      <Pressable onPress={handleRun} disabled={!prompt.trim() || running}
        style={[st.runBtn, { backgroundColor: accentColor, opacity: (!prompt.trim() || running) ? 0.5 : 1 }]}>
        {running ? (
          <View style={st.runningRow}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={st.runBtnText}>Running...</Text>
          </View>
        ) : (
          <Text style={st.runBtnText}>▶ Run</Text>
        )}
      </Pressable>

      {/* Result area */}
      {(running || displayText) && (
        <ScrollView style={st.resultArea} contentContainerStyle={{ padding: 10 }}>
          {running && !displayText && (
            <Text style={st.dots}>⏳ Working...</Text>
          )}
          {displayText ? (
            <Text style={st.resultText} selectable>{displayText}</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    backgroundColor: '#0d0d0d',
    borderWidth: 2,
    borderRadius: 2,
    padding: 14,
    gap: 10,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #050508' } as any : {}),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: MONO,
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  agentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 2,
  },
  agentBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
  },
  typePills: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 2,
    borderWidth: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  pillText: {
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
  },
  input: {
    backgroundColor: '#050508',
    borderWidth: 2,
    borderColor: '#222',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 12,
    fontFamily: MONO,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  runBtn: {
    paddingVertical: 10,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: '#ffffff20',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  runBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: MONO,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultArea: {
    backgroundColor: '#050508',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    maxHeight: 200,
  },
  resultText: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: MONO,
    lineHeight: 16,
  },
  dots: {
    color: '#666',
    fontSize: 11,
    fontFamily: MONO,
  },
});
