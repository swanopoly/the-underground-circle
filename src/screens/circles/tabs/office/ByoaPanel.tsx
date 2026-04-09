import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Modal,
  TextInput,
} from 'react-native';

interface Props {
  circleId: string;
  apiKey?: string;
  onClose: () => void;
}

const EVENTS = [
  { type: 'agent.activity', desc: 'Agent posts an update or completes a task' },
  { type: 'approval.request', desc: 'Agent requests human approval' },
  { type: 'member.checkin', desc: 'Circle member submits daily check-in' },
  { type: 'circle.update', desc: 'Circle settings or membership change' },
];

const CONNECT_OPTIONS = [
  { icon: '🦞', name: 'OpenSwan', desc: 'Connect your OpenSwan gateway', btn: 'Configure' },
  { icon: '🔗', name: 'Webhook', desc: 'Any HTTP endpoint', btn: 'Setup' },
  { icon: '⚡', name: 'n8n / Make / Zapier', desc: 'Automation platforms', btn: 'View Guide' },
  { icon: '📦', name: 'Python / Node SDK', desc: 'npm i uc-agent-sdk', btn: 'Copy Install' },
];

function copyText(text: string) {
  if (Platform.OS === 'web') {
    navigator.clipboard?.writeText(text).catch(() => {});
  }
}

export default function ByoaPanel({ circleId, apiKey, onClose }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [showMcpSample, setShowMcpSample] = useState(false);

  const webhookUrl = `https://app.chrisswanson.xyz/api/webhook/${circleId}`;
  const mcpUrl = `https://app.chrisswanson.xyz/mcp/${circleId}`;
  const maskedKey = apiKey ? apiKey.slice(0, 8) + '••••••••••••••••' + apiKey.slice(-4) : '(not set)';

  const mcpSampleJson = JSON.stringify({
    mcpServers: {
      'underground-circle': {
        url: mcpUrl,
        headers: { Authorization: `Bearer ${apiKey || 'YOUR_API_KEY'}` },
      },
    },
  }, null, 2);

  const doCopy = (text: string, key: string) => {
    copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>BRING YOUR OWN AGENT</Text>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Section 1: Your Endpoints */}
        <Text style={styles.sectionTitle}>YOUR ENDPOINTS</Text>

        <View style={styles.endpointCard}>
          <Text style={styles.endpointLabel}>WEBHOOK URL</Text>
          <Text style={styles.endpointValue} numberOfLines={1}>{webhookUrl}</Text>
          <Pressable style={styles.copyBtn} onPress={() => doCopy(webhookUrl, 'webhook')}>
            <Text style={styles.copyBtnText}>{copied === 'webhook' ? '✓ COPIED' : 'COPY'}</Text>
          </Pressable>
        </View>

        <View style={styles.endpointCard}>
          <Text style={styles.endpointLabel}>API KEY</Text>
          <Text style={styles.endpointValue}>{maskedKey}</Text>
          <Pressable style={styles.copyBtn} onPress={() => doCopy(apiKey || '', 'apikey')}>
            <Text style={styles.copyBtnText}>{copied === 'apikey' ? '✓ COPIED' : 'COPY'}</Text>
          </Pressable>
        </View>

        {/* Section 2: Events */}
        <Text style={styles.sectionTitle}>SUPPORTED EVENTS</Text>
        <View style={styles.eventsCard}>
          {EVENTS.map((e) => (
            <View key={e.type} style={styles.eventRow}>
              <Text style={styles.eventType}>{e.type}</Text>
              <Text style={styles.eventDesc}>{e.desc}</Text>
            </View>
          ))}
        </View>

        {/* Section 3: Quick Connect */}
        <Text style={styles.sectionTitle}>QUICK CONNECT</Text>
        <View style={styles.connectGrid}>
          {CONNECT_OPTIONS.map((opt) => (
            <View key={opt.name} style={styles.connectCard}>
              <Text style={styles.connectIcon}>{opt.icon}</Text>
              <Text style={styles.connectName}>{opt.name}</Text>
              <Text style={styles.connectDesc}>{opt.desc}</Text>
              <Pressable
                style={styles.connectBtn}
                onPress={() => {
                  if (opt.name.includes('SDK')) doCopy('npm install uc-agent-sdk', 'sdk');
                }}
              >
                <Text style={styles.connectBtnText}>{opt.btn}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        {/* Section 4: MCP */}
        <Text style={styles.sectionTitle}>MCP SERVER</Text>
        <View style={styles.mcpCard}>
          <Text style={styles.mcpHeadline}>Model Context Protocol</Text>
          <Text style={styles.mcpDesc}>
            Connect any MCP-compatible client (Claude Desktop, Cursor, etc.) directly to this
            circle's tools and memory.
          </Text>
          <View style={styles.mcpEndpointRow}>
            <Text style={styles.endpointValue} numberOfLines={1}>{mcpUrl}</Text>
            <Pressable style={styles.copyBtn} onPress={() => doCopy(mcpUrl, 'mcp')}>
              <Text style={styles.copyBtnText}>{copied === 'mcp' ? '✓ COPIED' : 'COPY'}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.sampleBtn} onPress={() => setShowMcpSample(!showMcpSample)}>
            <Text style={styles.sampleBtnText}>{showMcpSample ? 'HIDE' : 'SHOW'} CLAUDE DESKTOP CONFIG</Text>
          </Pressable>
          {showMcpSample && (
            <View style={styles.codeBlock}>
              <Text style={styles.codeText}>{mcpSampleJson}</Text>
              <Pressable style={styles.copyBtn} onPress={() => doCopy(mcpSampleJson, 'mcpjson')}>
                <Text style={styles.copyBtnText}>{copied === 'mcpjson' ? '✓ COPIED' : 'COPY'}</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
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
  scroll: { padding: 20 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#444',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 10,
    marginTop: 20,
  },
  endpointCard: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  endpointLabel: {
    color: '#555',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  endpointValue: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: 'monospace',
    flex: 1,
    marginBottom: 8,
  },
  copyBtn: {
    backgroundColor: '#6366f120',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  copyBtnText: {
    color: '#6366f1',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  eventsCard: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    overflow: 'hidden',
  },
  eventRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#000000',
  },
  eventType: {
    color: '#06b6d4',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  eventDesc: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
  connectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  connectCard: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    width: '47%' as any,
    minWidth: 140,
    flex: 1,
  },
  connectIcon: { fontSize: 22, marginBottom: 8 },
  connectName: {
    color: '#eee',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  connectDesc: {
    color: '#666',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
    marginBottom: 10,
    flex: 1,
  },
  connectBtn: {
    backgroundColor: '#6366f118',
    borderWidth: 1,
    borderColor: '#6366f140',
    borderRadius: 5,
    paddingVertical: 6,
    alignItems: 'center',
  },
  connectBtnText: {
    color: '#6366f1',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  mcpCard: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
  },
  mcpHeadline: {
    color: '#eee',
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  mcpDesc: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
    marginBottom: 12,
  },
  mcpEndpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  sampleBtn: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  sampleBtnText: { color: '#888', fontSize: 9, fontWeight: '700', fontFamily: 'monospace' },
  codeBlock: {
    backgroundColor: '#050508',
    borderRadius: 6,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  codeText: {
    color: '#6366f1',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 16,
    marginBottom: 8,
  },
});
