import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  Modal,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { AgentBot } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  getUserAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  toggleAgentActive,
  sendMessageToAgent,
  getAgentActivity,
  checkAgentHealth,
  agentTemplates,
} from '../../lib/agents';

type Tab = 'agents' | 'activity' | 'templates';

export default function AgentsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [agents, setAgents] = useState<AgentBot[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Create agent modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<keyof typeof agentTemplates | null>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentEndpoint, setNewAgentEndpoint] = useState('');
  const [newAgentApiKey, setNewAgentApiKey] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');
  
  // Test modal state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testAgent, setTestAgent] = useState<AgentBot | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [testResponse, setTestResponse] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [agentsData, activityData] = await Promise.all([
        getUserAgents(),
        getAgentActivity(undefined, 50),
      ]);
      setAgents(agentsData);
      setActivity(activityData);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleCreateAgent = async () => {
    if (!newAgentName.trim() || !newAgentEndpoint.trim() || !newAgentApiKey.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const template = selectedTemplate ? agentTemplates[selectedTemplate] : null;
      await createAgent(
        newAgentName.trim(),
        newAgentEndpoint.trim(),
        newAgentApiKey.trim(),
        template?.type || 'custom',
        newAgentDescription.trim() || template?.description,
        undefined, // avatarUrl - will add upload later
        template?.example_metadata
      );

      Alert.alert('Success', 'Agent created successfully!');
      setShowCreateModal(false);
      resetCreateForm();
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const resetCreateForm = () => {
    setNewAgentName('');
    setNewAgentEndpoint('');
    setNewAgentApiKey('');
    setNewAgentDescription('');
    setSelectedTemplate(null);
  };

  const handleToggleAgent = async (agentId: string, isActive: boolean) => {
    try {
      await toggleAgentActive(agentId, !isActive);
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleDeleteAgent = async (agent: AgentBot) => {
    Alert.alert(
      'Delete Agent',
      `Are you sure you want to delete "${agent.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAgent(agent.id);
              Alert.alert('Success', 'Agent deleted');
              loadData();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
  };

  const handleTestAgent = async () => {
    if (!testAgent || !testMessage.trim()) return;

    setLoading(true);
    setTestResponse('');
    try {
      const response = await sendMessageToAgent(testAgent.id, testMessage.trim());
      setTestResponse(response);
      loadData(); // Refresh activity
    } catch (error: any) {
      setTestResponse(`Error: ${error.message}`);
    }
    setLoading(false);
  };

  const handleCheckHealth = async (agent: AgentBot) => {
    try {
      const health = await checkAgentHealth(agent.id);
      Alert.alert(
        'Health Check',
        `Agent: ${agent.name}\nStatus: ${health.isHealthy ? 'Healthy' : 'Unhealthy'}\nLast Checked: ${new Date(health.lastChecked).toLocaleString()}${health.error ? `\nError: ${health.error}` : ''}`,
      );
      loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const applyTemplate = (templateKey: keyof typeof agentTemplates) => {
    const template = agentTemplates[templateKey];
    setSelectedTemplate(templateKey);
    setNewAgentName(template.name);
    setNewAgentEndpoint(template.placeholder_endpoint);
    setNewAgentDescription(template.description);
  };

  const formatActivityTime = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>← BACK</Text>
        </Pressable>
        <Text style={styles.headerTitle}>AI AGENTS</Text>
        <Pressable onPress={() => setShowCreateModal(true)}>
          <Text style={styles.addButton}>+ ADD</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['agents', 'activity', 'templates'] as Tab[]).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.inner}>
          {/* Agents Tab */}
          {activeTab === 'agents' && (
            <View>
              {agents.length === 0 ? (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No AI Agents Yet</Text>
                  <Text style={styles.emptyDesc}>
                    Create your first AI agent to automate tasks and enhance your grinding experience!
                  </Text>
                  <Button
                    title="CREATE AGENT"
                    onPress={() => setShowCreateModal(true)}
                    style={styles.createFirstButton}
                  />
                </Card>
              ) : (
                agents.map(agent => (
                  <Card key={agent.id} style={styles.agentCard}>
                    <View style={styles.agentHeader}>
                      <View style={styles.agentInfo}>
                        <View style={styles.agentIcon}>
                          <Text style={styles.agentIconText}>🤖</Text>
                        </View>
                        <View style={styles.agentDetails}>
                          <View style={styles.agentTitleRow}>
                            <Text style={styles.agentName}>{agent.name}</Text>
                            <View style={[
                              styles.statusBadge,
                              { backgroundColor: agent.is_active ? '#22c55e' : '#666' }
                            ]}>
                              <Text style={styles.statusText}>
                                {agent.is_active ? 'ACTIVE' : 'INACTIVE'}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.agentType}>{agent.type.toUpperCase()}</Text>
                          {agent.description && (
                            <Text style={styles.agentDesc}>{agent.description}</Text>
                          )}
                          <Text style={styles.agentEndpoint}>{agent.api_endpoint}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.agentActions}>
                      <Button
                        title="TEST"
                        variant="ghost"
                        onPress={() => {
                          setTestAgent(agent);
                          setTestMessage('');
                          setTestResponse('');
                          setShowTestModal(true);
                        }}
                        style={styles.agentActionButton}
                      />
                      <Button
                        title="HEALTH"
                        variant="ghost"
                        onPress={() => handleCheckHealth(agent)}
                        style={styles.agentActionButton}
                      />
                      <Button
                        title={agent.is_active ? 'DISABLE' : 'ENABLE'}
                        variant="secondary"
                        onPress={() => handleToggleAgent(agent.id, agent.is_active)}
                        style={styles.agentActionButton}
                      />
                      <Pressable
                        style={styles.deleteButton}
                        onPress={() => handleDeleteAgent(agent)}
                      >
                        <Text style={styles.deleteButtonText}>🗑️</Text>
                      </Pressable>
                    </View>
                  </Card>
                ))
              )}
            </View>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <View>
              {activity.length === 0 ? (
                <Card style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No Activity Yet</Text>
                  <Text style={styles.emptyDesc}>
                    Agent activity and conversations will appear here.
                  </Text>
                </Card>
              ) : (
                activity.map(event => (
                  <Card key={event.id} style={styles.activityCard}>
                    <View style={styles.activityHeader}>
                      <Text style={styles.activityType}>
                        {event.metadata.activity_type?.replace('_', ' ').toUpperCase() || 'ACTIVITY'}
                      </Text>
                      <Text style={styles.activityTime}>
                        {formatActivityTime(event.created_at)}
                      </Text>
                    </View>
                    {event.metadata.user_message && (
                      <Text style={styles.activityMessage}>
                        You: {event.metadata.user_message}
                      </Text>
                    )}
                    {event.metadata.agent_response && (
                      <Text style={styles.activityResponse}>
                        Agent: {event.metadata.agent_response}
                      </Text>
                    )}
                  </Card>
                ))
              )}
            </View>
          )}

          {/* Templates Tab */}
          {activeTab === 'templates' && (
            <View>
              <Text style={styles.sectionTitle}>AGENT TEMPLATES</Text>
              <Text style={styles.sectionDesc}>
                Pre-configured templates to get you started quickly
              </Text>

              {Object.entries(agentTemplates).map(([key, template]) => (
                <Card key={key} style={styles.templateCard}>
                  <View style={styles.templateHeader}>
                    <Text style={styles.templateName}>{template.name}</Text>
                    <View style={styles.templateTypeBadge}>
                      <Text style={styles.templateTypeText}>{template.type.toUpperCase()}</Text>
                    </View>
                  </View>
                  <Text style={styles.templateDesc}>{template.description}</Text>
                  <Text style={styles.templateEndpoint}>{template.placeholder_endpoint}</Text>
                  
                  <Button
                    title="USE TEMPLATE"
                    variant="secondary"
                    onPress={() => {
                      applyTemplate(key as keyof typeof agentTemplates);
                      setShowCreateModal(true);
                    }}
                    style={styles.templateButton}
                  />
                </Card>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Create Agent Modal */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>CREATE AI AGENT</Text>
            
            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>NAME *</Text>
              <TextInput
                style={styles.modalInput}
                value={newAgentName}
                onChangeText={setNewAgentName}
                placeholder="My Assistant"
                placeholderTextColor="#444"
              />
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>API ENDPOINT *</Text>
              <TextInput
                style={styles.modalInput}
                value={newAgentEndpoint}
                onChangeText={setNewAgentEndpoint}
                placeholder="https://your-api.com/webhook"
                placeholderTextColor="#444"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>API KEY *</Text>
              <TextInput
                style={styles.modalInput}
                value={newAgentApiKey}
                onChangeText={setNewAgentApiKey}
                placeholder="Your API key"
                placeholderTextColor="#444"
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>DESCRIPTION</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={newAgentDescription}
                onChangeText={setNewAgentDescription}
                placeholder="What does this agent do?"
                placeholderTextColor="#444"
                multiline
                maxLength={200}
              />
            </View>

            <View style={styles.modalActions}>
              <Button
                title="CANCEL"
                variant="ghost"
                onPress={() => {
                  setShowCreateModal(false);
                  resetCreateForm();
                }}
                style={styles.modalButton}
              />
              <Button
                title="CREATE"
                onPress={handleCreateAgent}
                loading={loading}
                style={styles.modalButton}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Test Agent Modal */}
      <Modal visible={showTestModal} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>TEST AGENT: {testAgent?.name}</Text>
            
            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>MESSAGE</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={testMessage}
                onChangeText={setTestMessage}
                placeholder="Send a test message to your agent..."
                placeholderTextColor="#444"
                multiline
              />
            </View>

            {testResponse ? (
              <View style={styles.modalField}>
                <Text style={styles.modalLabel}>RESPONSE</Text>
                <View style={styles.responseBox}>
                  <Text style={styles.responseText}>{testResponse}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Button
                title="CLOSE"
                variant="ghost"
                onPress={() => setShowTestModal(false)}
                style={styles.modalButton}
              />
              <Button
                title="SEND"
                onPress={handleTestAgent}
                loading={loading}
                disabled={!testMessage.trim()}
                style={styles.modalButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  headerBack: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  addButton: { color: '#6366f1', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#6366f1' },
  tabText: { color: '#666', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  activeTabText: { color: '#fff' },

  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  sectionDesc: { color: '#666', fontSize: 12, marginBottom: 16, lineHeight: 16 },

  // Empty state
  emptyCard: { alignItems: 'center', padding: 32 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyDesc: { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  createFirstButton: { marginTop: 8 },

  // Agent cards
  agentCard: { marginBottom: 16, padding: 16 },
  agentHeader: { marginBottom: 16 },
  agentInfo: { flexDirection: 'row', alignItems: 'flex-start' },
  agentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  agentIconText: { fontSize: 20 },
  agentDetails: { flex: 1 },
  agentTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  agentName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  agentType: { color: '#888', fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  agentDesc: { color: '#ccc', fontSize: 12, marginBottom: 4, lineHeight: 16 },
  agentEndpoint: { color: '#444', fontSize: 10, fontFamily: 'monospace' },
  
  agentActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  agentActionButton: { minHeight: 32, paddingHorizontal: 12, flex: 1 },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: { fontSize: 14 },

  // Activity
  activityCard: { marginBottom: 12, padding: 16 },
  activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  activityType: { color: '#6366f1', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  activityTime: { color: '#444', fontSize: 10 },
  activityMessage: { color: '#ccc', fontSize: 12, marginBottom: 4 },
  activityResponse: { color: '#888', fontSize: 12, fontStyle: 'italic' },

  // Templates
  templateCard: { marginBottom: 16, padding: 16 },
  templateHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  templateName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  templateTypeBadge: { backgroundColor: '#333', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  templateTypeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  templateDesc: { color: '#ccc', fontSize: 12, marginBottom: 8, lineHeight: 16 },
  templateEndpoint: { color: '#444', fontSize: 10, fontFamily: 'monospace', marginBottom: 12 },
  templateButton: { alignSelf: 'flex-start' },

  // Modals
  modalBackdrop: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.8)', 
    justifyContent: 'center', 
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#222',
    width: '100%',
    maxWidth: 720,
    maxHeight: '80%',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 2, marginBottom: 20 },
  
  modalField: { marginBottom: 16 },
  modalLabel: { color: '#888', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  modalInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  modalTextArea: { minHeight: 60, textAlignVertical: 'top' },
  
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalButton: { flex: 1, minHeight: 40 },

  responseBox: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 12,
    minHeight: 60,
  },
  responseText: { color: '#ccc', fontSize: 12, lineHeight: 16 },
});