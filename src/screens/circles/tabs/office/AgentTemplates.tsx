import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { safeGetUser } from '../../../../lib/authSession';

interface Props {
  circleId: string;
  onClose: () => void;
  onDeployed?: (agentName: string) => void;
}

interface Template {
  icon: string;
  name: string;
  desc: string;
  tags: string[];
  systemPrompt: string;
  color: string;
}

const TEMPLATES: Template[] = [
  {
    icon: '🔬',
    name: 'Research Agent',
    desc: 'Monitors sources and summarizes intel. Posts findings to your circle daily.',
    tags: ['no-code', 'productivity'],
    systemPrompt: 'You are a research agent. Monitor assigned sources, extract key insights, and post concise summaries to the circle. Focus on actionable intelligence.',
    color: '#6366f1',
  },
  {
    icon: '✅',
    name: 'QA Agent',
    desc: 'Reviews code or content and flags issues with detailed reports.',
    tags: ['developer', 'quality'],
    systemPrompt: 'You are a QA agent. Review submitted code and content for bugs, security issues, and quality problems. Post structured reports with severity levels.',
    color: '#22c55e',
  },
  {
    icon: '✍️',
    name: 'Writer Agent',
    desc: 'Drafts posts, summaries, and outreach content on demand.',
    tags: ['no-code', 'content'],
    systemPrompt: 'You are a writing agent. Draft posts, summaries, emails, and content on request. Match the voice and tone of the circle. Always ask for feedback.',
    color: '#f59e0b',
  },
  {
    icon: '📡',
    name: 'Monitor Agent',
    desc: 'Watches APIs and metrics. Alerts circle to anomalies instantly.',
    tags: ['developer', 'ops'],
    systemPrompt: 'You are a monitoring agent. Check APIs, endpoints, and metrics on schedule. Alert the circle immediately when anomalies or downtime are detected.',
    color: '#ef4444',
  },
  {
    icon: '📊',
    name: 'Data Agent',
    desc: 'Pulls, cleans, and visualizes data from connected sources.',
    tags: ['developer', 'analytics'],
    systemPrompt: 'You are a data agent. Fetch, clean, and analyze data from connected sources. Generate summaries and flag trends worth the circle\'s attention.',
    color: '#06b6d4',
  },
  {
    icon: '⚙️',
    name: 'Custom Agent',
    desc: 'Configure from scratch with your own endpoint and system prompt.',
    tags: ['developer', 'flexible'],
    systemPrompt: '',
    color: '#8b5cf6',
  },
];

function TagPill({ tag }: { tag: string }) {
  const isDev = tag === 'developer';
  return (
    <View style={[styles.tagPill, isDev ? styles.tagDev : styles.tagNoCode]}>
      <Text style={[styles.tagText, isDev ? styles.tagDevText : styles.tagNoCodeText]}>{tag}</Text>
    </View>
  );
}

export default function AgentTemplates({ circleId, onClose, onDeployed }: Props) {
  const [selected, setSelected] = useState<Template | null>(null);
  const [agentName, setAgentName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [deployError, setDeployError] = useState('');

  const openDeploy = (t: Template) => {
    setSelected(t);
    setAgentName(t.name);
    setSystemPrompt(t.systemPrompt);
    setWebhookUrl('');
    setSuccess(false);
    setDeployError('');
  };

  const handleDeploy = async () => {
    if (!selected || !agentName.trim()) return;
    setDeploying(true);
    setDeployError('');
    try {
      const { value: user, error: authError } = await safeGetUser();
      if (!user) {
        throw new Error(authError
          ? 'Secure session verification is temporarily unavailable. Try again.'
          : 'Sign in before deploying an agent.');
      }
      // Log to agent_activity as deployment event
      const { error } = await supabase.from('agent_activity').insert({
        circle_id: circleId,
        agent_name: agentName.trim(),
        source: 'system',
        activity_type: 'task_started',
        content: `Agent deployed from template: ${selected.name}`,
        metadata: {
          template: selected.name,
          webhook_url: webhookUrl || null,
          system_prompt: systemPrompt,
        },
      });
      if (error) throw error;
      setSuccess(true);
      onDeployed?.(agentName.trim());
    } catch (e: any) {
      console.error(e);
      setDeployError(e?.message || 'Agent deployment could not be saved.');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DEPLOY AN AGENT</Text>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {TEMPLATES.map((t) => (
          <View key={t.name} style={styles.card}>
            <View style={[styles.iconCircle, { backgroundColor: t.color + '18', borderColor: t.color + '40' }]}>
              <Text style={styles.icon}>{t.icon}</Text>
            </View>
            <Text style={[styles.cardName, { color: t.color }]}>{t.name}</Text>
            <Text style={styles.cardDesc}>{t.desc}</Text>
            <View style={styles.tags}>
              {t.tags.map((tag) => <TagPill key={tag} tag={tag} />)}
            </View>
            <Pressable
              style={[styles.deployBtn, { backgroundColor: t.color + '18', borderColor: t.color + '40' }]}
              onPress={() => openDeploy(t)}
            >
              <Text style={[styles.deployBtnText, { color: t.color }]}>DEPLOY</Text>
            </Pressable>
          </View>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Deploy Modal */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {success ? (
              <View style={styles.successView}>
                <Text style={styles.successIcon}>✓</Text>
                <Text style={styles.successText}>AGENT DEPLOYED</Text>
                <Text style={styles.successSub}>{agentName} is now active in your circle</Text>
                <Pressable
                  style={styles.doneBtn}
                  onPress={() => { setSelected(null); onClose(); }}
                >
                  <Text style={styles.doneBtnText}>DONE</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.modalTitle}>
                  {selected?.icon} DEPLOY {selected?.name.toUpperCase()}
                </Text>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>AGENT NAME</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={agentName}
                    onChangeText={setAgentName}
                    placeholder="My Research Agent"
                    placeholderTextColor="#333"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>WEBHOOK ENDPOINT (optional)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={webhookUrl}
                    onChangeText={setWebhookUrl}
                    placeholder="https://your-api.com/webhook"
                    placeholderTextColor="#333"
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>SYSTEM PROMPT</Text>
                  <TextInput
                    style={[styles.fieldInput, styles.textArea]}
                    value={systemPrompt}
                    onChangeText={setSystemPrompt}
                    placeholder="Instructions for the agent..."
                    placeholderTextColor="#333"
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                {!!deployError && (
                  <Text style={styles.deployError}>{deployError}</Text>
                )}

                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => setSelected(null)}
                    disabled={deploying}
                  >
                    <Text style={styles.cancelBtnText}>CANCEL</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.confirmBtn, !agentName.trim() && styles.confirmBtnDisabled]}
                    onPress={handleDeploy}
                    disabled={deploying || !agentName.trim()}
                  >
                    {deploying ? (
                      <ActivityIndicator size="small" color="#00FF9C" />
                    ) : (
                      <Text style={styles.confirmBtnText}>DEPLOY</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: '#000000',
  },
  title: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  closeBtn: { padding: 4 },
  closeText: { color: '#666', fontSize: 18 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 10,
  },
  card: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    width: '47%' as any,
    minWidth: 150,
    flex: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  icon: { fontSize: 20 },
  cardName: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  cardDesc: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
    marginBottom: 10,
    flex: 1,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  tagPill: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1 },
  tagDev: { backgroundColor: '#6366f110', borderColor: '#6366f130' },
  tagNoCode: { backgroundColor: '#22c55e10', borderColor: '#22c55e30' },
  tagText: { fontSize: 7, fontWeight: '800', fontFamily: 'monospace' },
  tagDevText: { color: '#6366f1' },
  tagNoCodeText: { color: '#22c55e' },
  deployBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  deployBtnText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace' },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    width: '100%',
    maxWidth: 400,
    padding: 24,
  },
  modalTitle: {
    color: '#eee',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 20,
  },
  field: { marginBottom: 14 },
  fieldLabel: {
    color: '#555',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  fieldInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 10,
    color: '#eee',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  deployError: {
    color: '#ef4444',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
    marginBottom: 12,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#666', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  confirmBtn: {
    flex: 2,
    backgroundColor: '#00FF9C20',
    borderWidth: 1,
    borderColor: '#00FF9C50',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#000000', borderColor: '#000000' },
  confirmBtnText: { color: '#00FF9C', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  // Success
  successView: { alignItems: 'center', paddingVertical: 20 },
  successIcon: { fontSize: 40, color: '#00FF9C', marginBottom: 12 },
  successText: {
    color: '#00FF9C',
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  successSub: { color: '#666', fontSize: 12, fontFamily: 'monospace', marginBottom: 24 },
  doneBtn: {
    backgroundColor: '#00FF9C20',
    borderWidth: 1,
    borderColor: '#00FF9C50',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  doneBtnText: { color: '#00FF9C', fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
});
